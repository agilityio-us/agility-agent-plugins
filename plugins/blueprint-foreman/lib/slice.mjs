// A slice, red to green, under a budget of attempts. Red writes the failing tests (and signature-only
// stubs), Green fills the scaffold's gaps and makes them pass with the frozen set untouched, and a fresh
// dispatch that has not seen the tests names the mutant, one small defect in what the slice built, which
// the tests must catch. With red-green off, one Builder writes the code and its tests together instead.
// Every red, green and build must leave the scaffold's locked lines in place and every landed slice's
// tests passing, and the green or build the engine accepts is the proof run that writes the slice's
// exhibit. The replays run inside the mutant's record, or with no mutant the record before it, and land
// inside the record that passes the slice's review, or with no review the one that ran the replays:
// neither takes evidence, so neither is a step. Every refusal that is someone's failed try spends the
// slice's budget; an empty budget is a stop. As the last slice lands, the final gate's own run holds
// every landed slice's tests at HEAD and writes the exhibits again.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENGINE, FOREMAN_CONFIG, EXHIBITS_VARIABLE, GAP_MARKER, containment, isProtected } from './config.mjs';
import { convergeIn } from './convergence.mjs';
import { quote, within } from './git.mjs';
import { LOCK_RULE } from './locks.mjs';
import { isEdit, sliceOf } from './plan.mjs';
import { judgeGreen, judgeKilled, judgeRed, judgeStill, passedNames, runCommand, runSuite, shownRun } from './proof.mjs';
import { answersGiven, authorRefusal, maker, noAuthor, ownPaths, readRunJson, runDirectory, runFile, stop } from './run.mjs';

// Where the slice's current attempt keeps its evidence in the run directory: the mutant, the replays and
// the reviews.
export const attemptDir = (run) => `review/${run.slice.id}-${run.slice.attempt}`;

// A brief is written for each role and attempt, so what a subagent was told is on record, and carries
// every answer given in the cycle: an answer that comes in during an attempt writes it again, for the
// dispatch that resumes it.
function writeBrief(ctx, run, role, lines) {
  const name = `${run.slice.id}-${role}-${run.slice.attempt}.md`;
  const file = runFile(ctx.root, run, path.join('briefs', name));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${[...lines, ...answersGiven(ctx.git, run), containment(ctx.root)].join('\n')}\n`);
  return `${runDirectory(run)}/briefs/${name}`;
}

// The brief lines every Red, Green and Builder shares: what the slice is for, what binds the code, and
// why the last attempt was spent, where it went back to `role`. A plan declares an exhibit only where
// the run holds the exhibits practice.
function grounding(run, slice, role) {
  const exhibit = slice.exhibit?.shows
    ? `Exhibit: ${slice.exhibit.shows} (${slice.exhibit.form}). The tests${slice.exhibit.command ? ` and \`${slice.exhibit.command}\`` : ''} write it into the directory in $${EXHIBITS_VARIABLE}, when set: the system's own output or a capture of it, never a test runner's verdict.`
    : `Exhibit: none (${slice.exhibit?.none}).`;
  return [
    `Outcome: ${slice.outcome}`,
    `Criteria: ${slice.criteria.join(', ')} (in the design as the run admitted it: git show ${run.startCommit}:${run.design})`,
    ...(slice.exhibit ? [exhibit] : []),
    run.scaffold
      ? `The scaffold (commit ${run.scaffold}) is locked. ${LOCK_RULE}`
      : 'The design has no scaffold commit.',
    ...(run.landed?.length ? [`The tests of the slices that landed (${run.landed.join(', ')}) must go on passing.`] : []),
    ...lastSpent(run, role),
  ];
}

// A slice's tests, `test` its { suite, files }, or the whole suite by its `all` where `test` names no
// files, run in the checkout `dir`, after `install`, the adapters' install, when `dir` is a
// scratch checkout that needs its dependencies.
function testsAt(ctx, run, dir, test, { install, exhibits }) {
  if (install) {
    const installed = runCommand({ cwd: dir, command: install, timeoutMs: ctx.config.testTimeoutMs });
    if (installed.exitCode !== 0) return { report: null, why: `the install (${install}) failed in the scratch checkout (exit ${installed.exitCode}):\n${installed.tail}` };
  }
  // Only the accepted green's exhibits, and the final gate's, are kept; every other run writes them
  // where they are discarded.
  const discarded = exhibits ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-foreman-exhibits-'));
  const suite = run.adapters.suites[test.suite];
  try {
    return runSuite({ root: dir, suite: test.files ? suite : { ...suite, command: suite.all }, files: test.files ?? [], timeoutMs: ctx.config.testTimeoutMs, env: { [EXHIBITS_VARIABLE]: exhibits ?? discarded } });
  } finally {
    if (discarded) fs.rmSync(discarded, { recursive: true, force: true });
  }
}

// The run of a slice's tests as its briefs show it.
const shown = (run, slice) => shownRun(run.adapters.suites[slice.test.suite], slice.test.files);

// Every landed slice's passing tests, run again in the checkout `dir`: a later slice may not break what
// landed, other than the tests it names to fail at red and pass at green. The landed slices of one
// suite run it once, over all their files, and the step's own run stands in where it ran that suite
// over every one of them. Without `own`, as for a merge taken in at rest, every landed test must still
// pass. The session's own checkout may hold what the branch does not, so the green replay's scratch
// checkout runs them again.
export function regressions(ctx, run, dir, own = null, ownRun = null) {
  const changing = new Set(own?.test.expectFail ?? []);
  const bySuite = new Map();
  for (const id of run.landed ?? []) {
    const { test } = run.plan.slices.find((s) => s.id === id);
    const entry = bySuite.get(test.suite) ?? { ids: [], files: new Set(), names: [] };
    entry.ids.push(id);
    for (const f of test.files) entry.files.add(f);
    entry.names.push(...(run.passing?.[id] ?? []).filter((n) => !changing.has(n)));
    bySuite.set(test.suite, entry);
  }
  return [...bySuite]
    .filter(([, e]) => e.names.length)
    .flatMap(([suite, e]) => {
      const files = [...e.files];
      const covered = own?.test.suite === suite && files.every((f) => own.test.files.includes(f));
      const result = covered ? ownRun : testsAt(ctx, run, dir, { suite, files }, {});
      return judgeStill(result, e.names).map((r) => `what landed (${e.ids.join(', ')}) no longer passes: ${r}`);
    });
}

function applyEdit(dir, edit) {
  const file = path.join(dir, edit.file);
  if (!fs.existsSync(file)) return `${edit.file} does not exist at this commit`;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(edit.find)) return `${edit.file} does not contain the text to change`;
  fs.writeFileSync(file, text.replace(edit.find, edit.replace));
  return null;
}

// A mutant as the engine names it.
const described = (edit) => `"${edit.find}" became "${edit.replace}" in ${edit.file}`;

// Files under a directory with something in them, repository-relative.
export function exhibitsIn(root, dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return exhibitsIn(root, p);
      return e.isFile() && fs.statSync(p).size > 0 ? [path.relative(root, p).replaceAll('\\', '/')] : [];
    })
    .sort();
}

// A failed try: spend one attempt and go back to the step whose work failed, `to` red or green, or with
// red-green off the Builder, or stop when the budget is empty. What the spent attempt made
// goes with it, its proof run and mutants among them: the slice keeps its base, what its failed reviews
// found, for green the accepted red and its Red, and `kept`, and why the attempt was spent, for the next
// brief of that step. Either way the code is restored to where the retry starts from, the accepted red
// for green and the slice's base for red and the Builder, before the run state is committed.
export function spend(run, reasons, to, kept = {}) {
  const back = maker(run, to);
  const budget = run.slice.budget - 1;
  const { id, base, attempt, redCommit, redAgent, carried } = run.slice;
  const from = back === 'green' ? redCommit : base;
  const spent = { attempt, to: back, reasons };
  const slice = { id, base, attempt, carried, spent, ...(back === 'green' ? { redCommit, redAgent } : {}), ...kept, budget: Math.max(budget, 0) };
  // Once restored, the code is where the engine last accepted it again.
  const accepted = from;
  if (budget <= 0) {
    return {
      refused: [...reasons, `slice "${run.slice.id}" has used all its attempts, and the run stops`],
      next: 'stopped',
      restore: from,
      extra: {
        ...stop(run, { kind: 'budget', need: `slice "${run.slice.id}" used all its attempts; last refusal: ${reasons[0]}`, from: back }),
        accepted,
        slice,
      },
    };
  }
  return {
    refused: [...reasons, `this spends an attempt (${budget} left)`],
    next: back,
    restore: from,
    extra: { accepted, slice: { ...slice, attempt: run.slice.attempt + 1 } },
  };
}

// The brief lines that tell `role`, Red, Green or the Builder, why the slice's last attempt was spent
// going back to it, so the retry starts from what did not hold.
function lastSpent(run, role) {
  const { spent } = run.slice;
  if (spent?.to !== role) return [];
  return ['', `Attempt ${spent.attempt} was spent, and the code restored, because:`, ...spent.reasons.map((r) => `  - ${r.replace(/\n/g, '\n    ')}`)];
}

// The first mutant, once a second of the same behaviour is killed: likely equivalent to the code, and a
// finding on the line it edits for the slice's review.
function equivalent(ctx, run, first) {
  const text = ctx.git.fileAt(run.slice.greenCommit, first.file) ?? '';
  const line = text.slice(0, Math.max(text.indexOf(first.find), 0)).split('\n').length;
  const claim = `the mutant ${described(first)} survived the tests and another of the same behaviour did not, so it is likely equivalent to the code; if it is not, the tests do not pin what it changes`;
  return { file: first.file, line, claim, source: 'mutant' };
}

// The replays, in one scratch checkout, inside the record before them: green on the candidate (green's
// commit, or the Builder's), with every landed slice's tests beside it, then the mutant, when there is
// one, reverted after, then red on the pre-change code, installed again for it, since only the install
// knows what it reads; a substitute's red was judged on its broken state, and a Builder writes no red. A
// first mutant that survives brings a second from a fresh dispatch: killed, the first is likely
// equivalent to the code, a finding for the review, and nothing is spent; surviving too, the tests'
// maker's attempt is. Passed, the slice goes on to its review with the evidence written.
export function replayed(run, ctx, mutant = null, agentId = null) {
  const slice = sliceOf(run);
  const first = run.slice.survivor;
  const outcome = ctx.git.withCheckout(run.slice.greenCommit, (dir) => {
    const own = testsAt(ctx, run, dir, slice.test, { install: run.adapters.install });
    const green = judgeGreen(own, slice.substitute ? [] : (slice.test.expectFail ?? []));
    if (!green.length) green.push(...regressions(ctx, run, dir, slice, own));
    if (green.length) return spend(run, green.map((r) => `green replay: ${r}`), 'green');
    if (mutant) {
      const failed = applyEdit(dir, mutant);
      const judged = failed ? { killed: false, reasons: [failed] } : judgeKilled(testsAt(ctx, run, dir, slice.test, {}));
      ctx.git.checkoutIn(dir, run.slice.greenCommit, mutant.file);
      // A mutant that stops the tests loading breaks the build, not the behaviour: the Mutant names
      // another, and no attempt is spent.
      if (judged.unjudgeable) {
        return { refused: [`the mutant (${described(mutant)}) broke the build rather than the behaviour: ${judged.reasons[0]}`], next: 'mutant', extra: { slice: { ...run.slice, lastMutant: `${described(mutant)}, which broke the build` } } };
      }
      if (!judged.killed && !first) return { next: 'mutant', extra: { slice: { ...run.slice, survivor: mutant, lastMutant: undefined } } };
      if (!judged.killed) return spend(run, judged.reasons.map((r) => `the second mutant (${described(mutant)}) survived, as the first did (${described(first)}): ${r}`), 'red');
    }
    if (slice.substitute || !run.slice.redCommit) return null;
    ctx.git.checkoutIn(dir, run.slice.redCommit);
    const red = judgeRed(testsAt(ctx, run, dir, slice.test, { install: run.adapters.install }), slice.test.expectFail);
    if (red.length) return spend(run, red.map((r) => `red replay: ${r}`), 'red');
    return null;
  });
  if (outcome) return outcome;
  const findings = first ? [equivalent(ctx, run, first)] : [];
  const evidence = {
    redCommit: run.slice.redCommit,
    greenCommit: run.slice.greenCommit,
    redReplay: slice.substitute ? 'substitute: broken state failed at red' : run.slice.redCommit ? 'failed on the named assertions' : 'n/a: the Builder wrote the tests with the code',
    greenReplay: 'passed',
    mutant: mutant ? { ...mutant, outcome: 'killed' } : 'n/a',
    exhibits: run.slice.exhibits ?? [],
    findings,
  };
  const at = runFile(ctx.root, run, attemptDir(run));
  fs.mkdirSync(at, { recursive: true });
  fs.writeFileSync(path.join(at, 'replay.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const named = mutant ? { mutant, mutantAgent: agentId } : {};
  return { onward: 'review', extra: { accepted: run.slice.greenCommit, slice: { ...run.slice, ...named, lastMutant: undefined, findings } } };
}

// The repository file a report names for a test, absolute in the checkout it ran in or relative to it or
// to the suite's `cwd`: the longest tail of its path that `known`, the admitted commit's files, holds, or
// null.
function reportedFile(known, name, cwd) {
  const parts = String(name ?? '').replaceAll('\\', '/').split('/');
  const tails = parts.map((_, i) => parts.slice(i).join('/'));
  return [...(cwd ? [path.posix.join(cwd, tails[0])] : []), ...tails].find((p) => known.has(p)) ?? null;
}

// Each suite that declares `all`, run whole in a scratch checkout of the admitted commit and in `dir`, a
// scratch checkout of HEAD: every test it passed there must pass here, other than those a landed slice
// names to change at red, and each that does not is a finding, so the tests no slice names are held
// too. They are held as the admitted commit wrote them: each test file its report names for a test it
// passed there, changed since, is put back in `dir` first, so a test rewritten since cannot stand in
// for the one it replaced.
function wholeSuites(ctx, run, dir) {
  const names = Object.keys(run.adapters.suites).filter((name) => run.adapters.suites[name].all);
  if (!names.length) return [];
  const before = ctx.git.withCheckout(run.startCommit, (at) => names.map((suite, i) => testsAt(ctx, run, at, { suite }, { install: i === 0 && run.adapters.install })));
  const known = new Set(ctx.git.filesAt(run.startCommit, '.'));
  const changed = new Set(ctx.git.changedFiles(run.startCommit, 'HEAD', ownPaths(run)));
  const admitted = new Set(names.flatMap((suite, i) => (before[i].report?.tests ?? []).filter((t) => t.status === 'passed').map((t) => reportedFile(known, t.file, run.adapters.suites[suite].cwd))));
  const rewritten = [...admitted].filter((file) => file && changed.has(file));
  if (rewritten.length) ctx.git.checkoutIn(dir, run.startCommit, rewritten);
  const changing = new Set((run.landed ?? []).flatMap((id) => run.plan.slices.find((s) => s.id === id)?.test.expectFail ?? []));
  return names.flatMap((suite, i) => {
    const finding = (claim) => ({ file: FOREMAN_CONFIG, line: 1, claim: `the whole of suite "${suite}" ${claim}` });
    if (!before[i].report) return [finding(`could not be judged at the admitted commit, so what it passed there is unchecked: ${before[i].why}`)];
    const held = passedNames(before[i]).filter((n) => !changing.has(n));
    return judgeStill(testsAt(ctx, run, dir, { suite }, {}), held).map((r) => finding(`passed a test at the admitted commit that it does not at HEAD: ${r}`));
  });
}

// The final gate's own run, in one scratch checkout of HEAD: convergence, then every landed slice's
// tests, each promised exhibit written again from the code at HEAD, so none shows what a later slice
// changed, and the whole suites. What does not hold is one of the engine's findings, kept with
// convergence's; the exhibits replace those each green wrote.
function finalRun(ctx, run) {
  return ctx.git.withCheckout(ctx.git.head(), (dir) => {
    const convergence = convergeIn(ctx, run, dir);
    const findings = [];
    const exhibits = { ...run.exhibits };
    for (const id of run.landed) {
      const slice = run.plan.slices.find((s) => s.id === id);
      const at = { file: slice.test.files[0], line: 1 };
      const out = slice.exhibit?.shows ? runFile(ctx.root, run, path.join('exhibits', id)) : undefined;
      if (out) {
        fs.rmSync(out, { recursive: true, force: true });
        fs.mkdirSync(out, { recursive: true });
      }
      const still = judgeStill(testsAt(ctx, run, dir, slice.test, { exhibits: out }), run.passing?.[id] ?? []);
      findings.push(...still.map((r) => ({ ...at, claim: `what landed (${id}) no longer passes at HEAD: ${r}` })));
      if (!out) continue;
      if (!still.length && slice.exhibit.command) {
        const written = runCommand({ cwd: dir, command: slice.exhibit.command, timeoutMs: ctx.config.testTimeoutMs, env: { [EXHIBITS_VARIABLE]: out } });
        if (written.exitCode !== 0) findings.push({ ...at, claim: `slice "${id}"'s exhibit command failed at HEAD (exit ${written.exitCode})` });
      }
      exhibits[id] = exhibitsIn(ctx.root, out).map((file) => ({ file, blob: ctx.git.hashFile(file) }));
      if (!exhibits[id].length) findings.push({ ...at, claim: `slice "${id}" promises an exhibit (${slice.exhibit.shows}), and its tests at HEAD wrote none` });
    }
    findings.push(...wholeSuites(ctx, run, dir));
    return { convergence: { ...convergence, findings: [...convergence.findings, ...findings] }, exhibits };
  });
}

// The final gate, at `gate`, as the run state enters it: no slice in flight, and the engine's own run
// of the code at HEAD first, whose findings and exhibits it keeps.
export function openFinal(ctx, run, gate) {
  return { slice: null, gate, ...finalRun(ctx, run) };
}

// Land, inside the record that passes the slice, or with no review the one that ran its replays: its
// tests are locked and must go on passing, its exhibits kept, and the run goes on to the next slice, or
// with every slice landed to the final gate, which runs, or resumes to confirm the fixes it asked for;
// each time, the engine's own run first checks that the code extracts back to the design, keeps its
// locks and passes what landed, and writes the exhibits again, keeping what it finds in the run state.
export function land(run) {
  const landed = [...run.landed, run.slice.id];
  const kept = {
    landed,
    passing: { ...run.passing, [run.slice.id]: run.slice.passing ?? [] },
    landedTests: [...(run.landedTests ?? []), { id: run.slice.id, base: run.slice.base, commit: run.slice.greenCommit, paths: sliceOf(run).frozen }],
    exhibits: { ...run.exhibits, [run.slice.id]: run.slice.exhibits ?? [] },
  };
  return { onward: 'slice', extra: kept };
}

// The slice's proof run, green's or the Builder's: the engine's own run of its tests in the session's
// checkout, every test passing, `named` among them by name, and every landed slice's passing tests
// still passing; what it writes to the exhibits directory is the exhibit. Returns the candidate it makes
// of HEAD, or the attempt spent: the code's where a test fails, the tests' where the exhibit they
// promise is not written.
function proofRun(run, ctx, slice, named) {
  const dir = runFile(ctx.root, run, path.join('exhibits', slice.id));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const own = testsAt(ctx, run, ctx.root, slice.test, { exhibits: dir });
  const reasons = [...judgeGreen(own, named)];
  if (!reasons.length) reasons.push(...regressions(ctx, run, ctx.root, slice, own));
  if (reasons.length) return spend(run, reasons, 'green');
  if (slice.exhibit?.command) {
    const written = runCommand({ cwd: ctx.root, command: slice.exhibit.command, timeoutMs: ctx.config.testTimeoutMs, env: { [EXHIBITS_VARIABLE]: dir } });
    if (written.exitCode !== 0) return spend(run, [`the exhibit command failed (exit ${written.exitCode}):\n${written.tail}`], 'red');
  }
  // Each exhibit is recorded by the blob id git would store for it, so settle can tell it from a copy;
  // a slice that promises none keeps none, whatever tests it shares a file with wrote.
  const exhibits = slice.exhibit?.shows ? exhibitsIn(ctx.root, dir).map((file) => ({ file, blob: ctx.git.hashFile(file) })) : [];
  if (!slice.exhibit?.shows) fs.rmSync(dir, { recursive: true, force: true });
  if (slice.exhibit?.shows && exhibits.length === 0) {
    return spend(run, [`slice "${slice.id}" promises an exhibit (${slice.exhibit.shows}), but its proof run wrote nothing to $${EXHIBITS_VARIABLE}; its tests must produce it`], 'red');
  }
  // A new candidate's mutants start afresh.
  return { candidate: { ...run.slice, greenCommit: ctx.git.head(), exhibits, passing: passedNames(own), survivor: undefined, lastMutant: undefined } };
}

export const SLICE_STEPS = {
  red: {
    title: 'write the failing tests',
    records: 'red',
    instruct(run, ctx) {
      const slice = sliceOf(run);
      const allowed = [...slice.frozen, ...(slice.stubs ?? [])];
      const brief = writeBrief(ctx, run, 'red', [
        `# Red: ${slice.id} (${run.key}), attempt ${run.slice.attempt}`,
        '',
        ...grounding(run, slice, 'red'),
        '',
        slice.substitute
          ? `Write tests that pass on the current code and would fail on this broken state: in ${slice.substitute.broken.file}, "${slice.substitute.broken.find}" becomes "${slice.substitute.broken.replace}".`
          : `Write tests so that exactly these fail, each on an assertion: ${slice.test.expectFail.map((n) => `"${n}"`).join(', ')}.`,
        `You may create or edit only: ${allowed.join(', ')}.`,
        slice.stubs?.length
          ? 'The stub files may hold signatures only (exports returning a neutral value), so tests fail on an assertion rather than an import; write no behaviour.'
          : 'Write no product code.',
        `Run the suite as the engine does, to see the failure you expect: ${shown(run, slice)}.`,
        'Report what you wrote. Do not commit.',
      ]);
      return [
        `${ctx.models.dispatch('red', slice)} with the brief in ${brief}.`,
        `Then commit only its changes to ${allowed.join(', ')} as "test(${run.key}): red for ${slice.id}", and record them with the Red dispatch's agent id.`,
      ];
    },
    record: (run) => `${ENGINE} record ${run.key} red <the Red dispatch's agent id>`,
    bounds(run) {
      const slice = sliceOf(run);
      return { from: run.slice.base, may: within([...slice.frozen, ...(slice.stubs ?? [])]), must: true };
    },
    spends: true,
    authors: true,
    accept(run, ctx, agentId) {
      if (!agentId) return { refused: ["record the Red dispatch's agent id"] };
      const slice = sliceOf(run);
      let reasons;
      let own;
      if (slice.substitute) {
        own = testsAt(ctx, run, ctx.root, slice.test, {});
        reasons = judgeGreen(own);
        if (!reasons.length) {
          reasons = ctx.git.withCheckout(ctx.git.head(), (dir) => {
            const broken = applyEdit(dir, slice.substitute.broken);
            if (broken) return [broken];
            return judgeKilled(testsAt(ctx, run, dir, slice.test, { install: run.adapters.install })).reasons.map((r) => `on the broken state: ${r}`);
          });
        }
      } else {
        own = testsAt(ctx, run, ctx.root, slice.test, {});
        reasons = judgeRed(own, slice.test.expectFail);
      }
      if (!reasons.length) reasons = regressions(ctx, run, ctx.root, slice, own);
      if (reasons.length) return spend(run, reasons, 'red');
      const redCommit = ctx.git.head();
      return { next: 'green', extra: { accepted: redCommit, slice: { ...run.slice, redCommit, redAgent: agentId } } };
    },
  },

  green: {
    title: 'make the tests pass',
    records: 'green',
    instruct(run, ctx) {
      const slice = sliceOf(run);
      const brief = writeBrief(ctx, run, 'green', [
        `# Green: ${slice.id} (${run.key}), attempt ${run.slice.attempt}`,
        '',
        ...grounding(run, slice, 'green'),
        '',
        `Make every test pass: ${shown(run, slice)}.`,
        `These files are frozen and read-only: ${frozenFor(run, slice).join(', ')}. Changing any of them fails the attempt.`,
        'Change only what the outcome needs. Report what you changed and why. Do not commit.',
      ]);
      return [
        `${ctx.models.dispatch('green', slice)}, not the Red subagent, with the brief in ${brief}.`,
        `Then commit its changes as "feat(${run.key}): ${slice.id}"${slice.substitute ? ', if it made any' : ''}, and record them with the Green dispatch's agent id.`,
      ];
    },
    record: (run) => `${ENGINE} record ${run.key} green <the Green dispatch's agent id>`,
    // A substitute's tests pass at red already, so its green may commit nothing.
    bounds(run) {
      const slice = sliceOf(run);
      const frozen = within(frozenFor(run, slice));
      return { from: run.slice.redCommit, may: (f) => !frozen(f), must: !slice.substitute };
    },
    spends: true,
    authors: true,
    accept(run, ctx, agentId) {
      if (!agentId) return { refused: ["record the Green dispatch's agent id"] };
      if (agentId === run.slice.redAgent) return { refused: ['the green must come from a different dispatch than the Red that wrote the tests'] };
      const slice = sliceOf(run);
      const proof = proofRun(run, ctx, slice, slice.substitute ? [] : slice.test.expectFail);
      if (!proof.candidate) return proof;
      // A substitute has no mutant, so its replays run here.
      if (slice.substitute) return replayed({ ...run, slice: proof.candidate }, ctx);
      return { onward: 'mutant', extra: { accepted: proof.candidate.greenCommit, slice: proof.candidate } };
    },
  },

  // With red-green off, one dispatch writes the slice's code and its tests together, from the slice's
  // base, and every landed slice's frozen set stays as it landed; its own frozen set is locked as the
  // slice lands.
  builder: {
    title: 'build the slice',
    records: 'builder',
    instruct(run, ctx) {
      const slice = sliceOf(run);
      const landed = landedFrozen(run);
      const brief = writeBrief(ctx, run, 'builder', [
        `# Builder: ${slice.id} (${run.key}), attempt ${run.slice.attempt}`,
        '',
        ...grounding(run, slice, 'builder'),
        '',
        `Write the slice's code and its tests together, the tests in ${slice.test.files.join(', ')}, so that every test passes: ${shown(run, slice)}.`,
        `What ${slice.frozen.join(', ')} hold is locked once the slice lands, so write tests that pin the outcome.`,
        ...(landed.length ? [`These files are frozen and read-only: ${landed.join(', ')}. Changing any of them fails the attempt.`] : []),
        'Change only what the outcome needs. Report what you wrote and why. Do not commit.',
      ]);
      return [
        `${ctx.models.dispatch('builder', slice)} with the brief in ${brief}.`,
        `Then commit its changes as "feat(${run.key}): ${slice.id}", and record them with the Builder dispatch's agent id.`,
      ];
    },
    record: (run) => `${ENGINE} record ${run.key} builder <the Builder dispatch's agent id>`,
    bounds(run) {
      const frozen = within(landedFrozen(run));
      return { from: run.slice.base, may: (f) => !frozen(f), must: true };
    },
    spends: true,
    authors: true,
    accept(run, ctx, agentId) {
      if (!agentId) return { refused: ["record the Builder dispatch's agent id"] };
      const proof = proofRun(run, ctx, sliceOf(run), []);
      if (!proof.candidate) return proof;
      return { onward: 'mutant', extra: { accepted: proof.candidate.greenCommit, slice: proof.candidate } };
    },
  },

  mutant: {
    title: 'name the mutant',
    records: 'mutant',
    instruct(run, ctx) {
      const slice = sliceOf(run);
      const at = `${runDirectory(run)}/${attemptDir(run)}`;
      const first = run.slice.survivor;
      const brief = writeBrief(ctx, run, 'mutant', [
        `# Mutant: ${slice.id} (${run.key}), attempt ${run.slice.attempt}`,
        '',
        `Outcome: ${slice.outcome}`,
        `What the defect breaks: ${slice.mutant.breaks}`,
        '',
        `Read the slice's change to its product code, ${productDiff(run, slice)}, and name one small edit to it`,
        'that breaks exactly that behaviour, as a careless change could: a value, a condition, a call left',
        'out. Name it as { "file", "find", "replace" }, where "find" is code (not a comment) the file holds',
        `exactly once at ${run.slice.greenCommit}, in a file the slice changed and did not freeze: ${mutable(ctx, run, slice).join(', ')}.`,
        `Write it to ${at}/mutant.json. Do not read or run the slice's tests, and change nothing else.`,
      ]);
      return [
        ...(first
          ? [
              `The mutant ${described(first)} survived the tests. A second mutant of the same behaviour tells one equivalent to`,
              'the code from tests that do not pin the behaviour: if the tests kill it, the first is a finding for the',
              `${run.practices.review ? "slice's review" : 'description, unreviewed,'} and nothing is spent; if it survives too, the slice goes back to ${maker(run, 'red') === 'red' ? 'red' : 'the Builder'}.`,
            ]
          : []),
        `${ctx.models.dispatch('mutant')}, ${noAuthor(run)}${first ? ', the one that named the first mutant among them' : ''}, with the brief in ${brief}.`,
        ...(first ? [`Tell it another dispatch named ${described(first)}: it must name another edit.`] : []),
        ...(run.slice.lastMutant ? [`Tell it the last mutant (${run.slice.lastMutant}) did not count: it must compile.`] : []),
        "Then record its mutant with the Mutant dispatch's agent id.",
      ];
    },
    record: (run) => `${ENGINE} record ${run.key} mutant <the Mutant dispatch's agent id>`,
    authors: true,
    accept(run, ctx, agentId) {
      if (!agentId) return { refused: ["record the Mutant dispatch's agent id"] };
      // Neither Red nor Green nor the Builder, nor any Mutant before, the first of a reroll among them.
      const author = authorRefusal(run, agentId, 'the mutant');
      if (author) return author;
      const first = run.slice.survivor;
      const edit = readRunJson(ctx.root, run, `${attemptDir(run)}/mutant.json`);
      if (!isEdit(edit)) return { refused: ['mutant.json must be { "file", "find", "replace" }, with a replacement that differs'] };
      const mutant = { file: edit.file, find: edit.find, replace: edit.replace };
      if (first && ['file', 'find', 'replace'].every((k) => first[k] === mutant[k])) return { refused: [`the second mutant must be another edit than the first, ${described(first)}`] };
      const allowed = mutable(ctx, run, sliceOf(run));
      if (!allowed.includes(mutant.file)) return { refused: [`the mutant must edit a file the slice changed and did not freeze: ${allowed.join(', ')}`] };
      const count = (ctx.git.fileAt(run.slice.greenCommit, mutant.file) ?? '').split(mutant.find).length - 1;
      if (count !== 1) return { refused: [`the mutant's "find" must occur exactly once in ${mutant.file}; it occurs ${count} times`] };
      return replayed(run, ctx, mutant, agentId);
    },
  },
};

// The product files a mutant may edit: those the slice changed that its green holds, other than frozen
// or protected ones.
function mutable(ctx, run, slice) {
  const frozen = within(frozenFor(run, slice));
  const kept = (file) => frozen(file) || isProtected(run.protect)(file);
  const green = run.slice.greenCommit;
  return ctx.git.changedFiles(run.slice.base, green, ownPaths(run)).filter((f) => !kept(f) && ctx.git.blobAt(green, f) !== null);
}

// The slice's change as the Mutant reads it: never the tests it must not read, nor the run directory.
const productDiff = (run, slice) =>
  `git diff ${run.slice.base} ${run.slice.greenCommit} -- . ${[...ownPaths(run), ...frozenFor(run, slice)].map((p) => quote(`:(exclude)${p}`)).join(' ')}`;

// Every landed slice's frozen set, which no later slice may touch.
const landedFrozen = (run) => [...new Set((run.landed ?? []).flatMap((id) => run.plan.slices.find((s) => s.id === id)?.frozen ?? []))];

// What Green may not touch: its own slice's frozen set, and every landed slice's.
function frozenFor(run, slice) {
  return [...new Set([...slice.frozen, ...landedFrozen(run)])];
}
