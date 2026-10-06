// `wake`, the one command a fire runs, and the engine's entry. The fire, on stdin, names the item's
// key, Blueprint's branch for it, B, and the agent's own, F, `claude/<B>`, which `wake` has the
// session check out first, cut from B's tip where origin does not have it yet. Then it reads what F
// carries and admits a run, continues one, resumes a stopped one with the answer the fire carries,
// opens a new cycle where B carries a newer scaffold than the run's, or ends, writing nothing. A fire
// whose key or branches the engine cannot read writes nothing; one that falls short of its schema
// otherwise fails. A run is admitted only on the code at the tip of Blueprint's branch, merged in
// where B moved, and keeps the practices it was admitted with. Admission checks every admitted demand of the
// input contract before any work, and an intake that falls short is one empty commit carrying the
// reasons: rejected where only a new design or scaffold puts one right, failed otherwise. A wake on a
// run that meets a failure, its install or a run state that will not load, signals failed the same
// way, and the next fire goes on from the run state last pushed. Every fire is a fresh clone, so
// admission and every wake that goes on install the dependencies in the working tree first. At rest
// the branch may take in only merges, and the wake that goes on judges a merge on the merged code. `run` takes argv and a context (root, git, clock,
// input, the fire) and returns the text to print and the exit code, so tests drive it without a
// process or a real remote. Why: docs/how-it-works.md.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { adversaryRoute, probeAdversary } from './adversary.mjs';
import { mergesSince, restoring, takingOut } from './bounds.mjs';
import { BLUEPRINT_CONFIG, DEFAULTS, ENGINE, FOREMAN_CONFIG, SCAFFOLD_STATUSES, SCAFFOLD_TRAILER, checkAdapters, isProtected, protectedPaths, scaffoldReport } from './config.mjs';
import { extractIn, missingBefore } from './convergence.mjs';
import { checkDesign, eventModel } from './design.mjs';
import { reopenFinal } from './gates.mjs';
import { createGit, quote, within } from './git.mjs';
import { checkLock, latestScaffold, locksAt, scaffoldCommits } from './locks.mjs';
import { MODEL_TABLE, createModels, resolveModels } from './models.mjs';
import { SCHEMA_FILE, checkout, readPayload, wakeCommand } from './payload.mjs';
import { runCommand } from './proof.mjs';
import { AT_REST, STEPS, committing, describe, pinned, record, refusal } from './record.mjs';
import { logLine } from './review.mjs';
import { KEY_PATTERN, advance, conflictCommit, failedCommit, hasCopy, hasRun, intakeCommit, loadRun, located, newRun, ownPaths, runDir, runDirectory, saveRun, signalledCycle, stop } from './run.mjs';
import { regressions } from './slice.mjs';
import { onward } from './stages.mjs';

// What the routine must run: Node for the engine, and git with --trailer for the commits it prints.
const NODE_MAJOR = 18;
const GIT_VERSION = [2, 32];
// The steps of a slice past its red from which it may still spend an attempt, whose restore would put
// the code back to before a merge taken in there.
const IN_FLIGHT = ['green', 'mutant', 'group-review', 'contract-review'];

// A fire that finds nothing it may do leaves the branch as it found it.
function ends(key, reasons) {
  return { code: 1, text: [`blueprint-foreman ${key} · ends`, ...reasons.map((r) => `  - ${r}`), '', 'End the session without writing anything.'].join('\n') };
}

// A wake that goes on but cannot yet: it writes nothing, and the same fire may wake the run again.
function again(run, reasons, payload) {
  return { code: 1, text: `${refusal(run.key, reasons)}\n\nThen wake the run again: ${wakeCommand(payload.value)}` };
}

// A fire not yet on F, or without B's tip beside it: the commands that check both out, and the same
// wake again, the fire as it came. Nothing is written first.
function checkingOut(payload, reason) {
  const lines = [...checkout(payload.branch, payload.runBranch), wakeCommand(payload.value)];
  return { code: 0, text: [`blueprint-foreman ${payload.key} · checkout`, `  - ${reason}`, '', 'Run each line as printed, in order; the last wakes the run again:', ...lines].join('\n') };
}

// An intake's signal, on a branch that carries no run: one empty commit carrying the reasons.
function intake(payload, state, reasons) {
  return { code: 1, text: `${refusal(payload.key, reasons, state)}\n\nCommit the signal, then push it, and end the session: ${intakeCommit(payload.key, state, reasons, payload.signal)}` };
}

// Where the fire falls short of its schema beyond its key and branches, as the one reason that fails it.
const malformed = (payload) => [`the fire does not meet ${SCHEMA_FILE}: ${payload.problems.join('; ')}`];

// A wake on a run that meets a failure it cannot get past: its signal, one empty commit carrying the
// reasons, which changes no run state, so the next fire goes on from the run state last pushed.
function failing(key, reasons, cycle, signal) {
  return { code: 1, text: `${refusal(key, reasons, 'failed')}\n\nCommit the signal, then push it, and end the session: ${failedCommit(key, reasons, cycle, 'failed', signal)}` };
}

// The adapters' install in the working tree, which must leave the tree as clean as it found it: why it
// did not, or nothing. `apart` is the run directory, when there is a run.
function installed(ctx, install, apart) {
  const result = runCommand({ cwd: ctx.root, command: install, timeoutMs: ctx.config.testTimeoutMs });
  if (result.exitCode !== 0) {
    const how = result.timedOut ? 'timed out' : `exit ${result.exitCode}`;
    return [`the install (${install}) failed in the working tree (${how})${result.tail.trim() ? `:\n${result.tail}` : ''}`];
  }
  const changed = ctx.git.dirtyFiles(apart);
  return changed.length ? [`the install left the working tree changed, and it must install without changing it: ${changed.join(', ')}`] : [];
}

const older = (version, [major, minor]) => {
  const [a, b] = (/^(\d+)\.(\d+)/.exec(version) ?? []).slice(1).map(Number);
  return !(a > major || (a === major && b >= minor));
};

// The scaffold report's problems: Blueprint's scaffold.json beside the design, committed with the
// scaffold and unchanged since, saying the scaffold is done or skipped, and a skipped scaffold changing
// nothing; a blocked one is no scaffold to deliver.
function reportProblems(ctx, scaffold, file, apart) {
  const report = scaffoldReport(file);
  const text = ctx.git.fileAt('HEAD', report);
  if (text === null) return [`the branch has no committed ${report} giving the scaffold's status`];
  if (ctx.git.blobAt(scaffold, report) !== ctx.git.blobAt('HEAD', report)) return [`${report} is not as the scaffold commit ${scaffold} left it`];
  let status;
  try {
    status = JSON.parse(text)?.status;
  } catch (e) {
    return [`${report} is not readable JSON (${e.message})`];
  }
  if (!SCAFFOLD_STATUSES.includes(status)) return [`${report} gives the status ${JSON.stringify(status)}, not one of ${SCAFFOLD_STATUSES.join(', ')}`];
  if (status === 'blocked') return [`${report} says the scaffold is blocked; what it owes is listed there`];
  const changed = ctx.git.touchedBy(scaffold).filter((f) => !within([apart])(f));
  return status === 'skipped' && changed.length ? [`${report} says the scaffold was skipped, but its commit ${scaffold} changes ${changed.join(', ')}`] : [];
}

// Every admitted demand of the input contract: the reasons of each that fails, where its check does not
// depend on one that failed, and whether any is the design's or the scaffold's, or the facts the run is
// admitted on. The scaffold in force is the latest commit carrying the item's trailer, found in the
// whole history, and its own checks need it; the install needs the adapters and a clean tree to hold it
// to; the extractions need the install, the scaffold and a sound design.
function admission(payload, ctx) {
  const { key, design: file } = payload;
  const version = ctx.git.version();
  const shallow = ctx.git.isShallow();
  const dirty = ctx.git.dirtyFiles();
  const design = ctx.git.fileAt('HEAD', file);
  // What only a new design or scaffold puts right rejects the item; what the routine, the checkout, the
  // adapters, the install or an extraction fell short of fails the fire.
  let rejected = false;
  const designs = (reasons) => {
    rejected ||= reasons.length > 0;
    return reasons;
  };
  const designed = designs(design === null ? [`the branch has no committed ${file}`] : checkDesign(design, key, file));
  const checked = checkAdapters(ctx.git.fileAt('HEAD', BLUEPRINT_CONFIG), ctx.git.fileAt('HEAD', FOREMAN_CONFIG));
  const { settings } = checked;
  // The design the fire names is where Blueprint's adapter file puts the item's docs.
  const placed = checked.adapters && file !== `${checked.adapters.docsRoot}/${key}/blueprint.md`;
  const adapters = placed ? undefined : checked.adapters;
  const problems = placed ? [`the fire names the design ${file}, but ${BLUEPRINT_CONFIG}'s docsRoot puts ${key}'s at ${checked.adapters.docsRoot}/${key}/blueprint.md`] : checked.problems;
  const reasons = [
    ...(Number(String(ctx.node).split('.')[0]) < NODE_MAJOR ? [`the engine runs on Node ${ctx.node}, and needs Node ${NODE_MAJOR} or later`] : []),
    ...(older(version, GIT_VERSION) ? [`git is ${version}, and the commits the engine prints need git ${GIT_VERSION.join('.')} or later`] : []),
    ...(shallow ? ["the checkout is a shallow clone, and admission reads the branch's whole history: clone it in full"] : []),
    ...(dirty.length ? [`the working tree is not clean: ${dirty.join(', ')}`] : []),
    ...designed,
    ...problems,
  ];

  const scaffolds = shallow ? { exact: [], misspelt: [] } : scaffoldCommits(ctx.git, key);
  const trailer = `"${SCAFFOLD_TRAILER}: ${key}"`;
  if (!shallow) {
    reasons.push(
      ...designs([
        ...(scaffolds.exact.length === 0 ? [`no commit carries the trailer ${trailer}; the scaffold is committed before the fire, empty when there is nothing to scaffold`] : []),
        ...(scaffolds.exact.length > 1 && !latestScaffold(ctx.git, scaffolds.exact) ? [`${scaffolds.exact.length} commits carry the trailer ${trailer}, and none is the latest: they lie on lines apart`] : []),
        ...scaffolds.misspelt.map((c) => `commit ${c} names ${key}'s scaffold, but not as the trailer ${trailer}`),
      ]),
    );
  }

  // The scaffold in force is made from this design, touches nothing it may not but the report beside
  // the design, says it is done or skipped, and its locked lines hold.
  const scaffold = latestScaffold(ctx.git, scaffolds.exact);
  const protect = protectedPaths(file, adapters);
  const apart = path.posix.dirname(file);
  if (scaffold) {
    const madeFrom = ctx.git.blobAt(scaffold, file);
    const touched = ctx.git.touchedBy(scaffold).filter((f) => f !== scaffoldReport(file) && isProtected(protect)(f));
    reasons.push(
      ...designs([
        ...(design !== null && madeFrom === null ? [`the scaffold commit ${scaffold} was not made from the design: ${file} is not committed before it`] : []),
        ...(design !== null && madeFrom !== null && madeFrom !== ctx.git.blobAt('HEAD', file) ? [`${file} changed after the scaffold commit ${scaffold} was made from it`] : []),
        ...(touched.length ? [`the scaffold commit ${scaffold} touches a protected path: ${touched.join(', ')}`] : []),
        ...reportProblems(ctx, scaffold, file, apart),
        ...checkLock(ctx.git, scaffold, 'HEAD', [apart]).map((f) => `${f.file}:${f.line}: ${f.claim}`),
      ]),
    );
  }

  // The install keeps the working tree clean; then one scratch checkout extracts the code as it stood
  // before the work, where what the design modifies or removes must be, and as HEAD holds it. Each is
  // skipped only where a demand it needs failed, so the reasons are never empty then.
  const setup = adapters && !dirty.length ? installed(ctx, adapters.install) : null;
  reasons.push(...(setup ?? []));
  if (!setup || setup.length || !scaffold || designed.length) return { reasons, rejected };
  const head = ctx.git.head();
  const graphs = ctx.git.withCheckout(`${scaffold}~1`, (dir) => {
    const before = extractIn(ctx, adapters, dir);
    ctx.git.checkoutIn(dir, head);
    return { before, at: extractIn(ctx, adapters, dir) };
  });
  // An extraction that fails cannot tell a broken extractor or install from code it cannot read, so it
  // fails the fire; a row naming what the code before the work does not hold is the design's.
  reasons.push(
    ...(graphs.before.graph
      ? designs(missingBefore(eventModel(design), graphs.before.graph, adapters.emits, file))
      : [`the extractor (${adapters.extract}) failed at the scaffold commit's parent, the code before the work: ${graphs.before.why}`]),
    ...(graphs.at.graph ? [] : [`the extractor (${adapters.extract}) failed at HEAD: ${graphs.at.why}`]),
  );
  return reasons.length ? { reasons, rejected } : { facts: { scaffold, adapters, settings, protect, head } };
}

// A branch that carries no run: admitted, at the plan, or signalled rejected or failed by one empty
// commit. The run records F, B and the design the fire names, and pins the fire's practices, each it
// does not name on, the models the settings and then the fire's options name, and the gates'
// Adversary, its route as the routine's environment gives it, so no later fire or environment chooses
// them. With `previous`, the run F carried until B brought a newer scaffold, a new cycle opens on that
// scaffold, the same checks admitting it: the run state starts again, keeping only the run's cycle and
// stop counts and what it pinned, and so does the run directory, but for the calibration log; what
// earlier cycles did is F's history.
function admit(payload, ctx, previous) {
  const { key } = payload;
  const { reasons, rejected, facts } = admission(payload, ctx);
  if (reasons) return previous ? redesignRefused(previous, rejected ? 'rejected' : 'failed', reasons, payload.signal) : intake(payload, rejected ? 'rejected' : 'failed', reasons);
  const models = resolveModels(ctx.models.table, facts.settings, payload.settings);
  const zdr = payload.settings.adversary?.zeroDataRetention ?? facts.settings.adversary.zeroDataRetention;
  const pinning = previous
    ? { cycle: previous.cycle + 1, stops: previous.stops, practices: previous.practices, models: previous.models, adversary: previous.adversary }
    : { practices: payload.practices, models, adversary: adversaryRoute(ctx.env, models.adversary, zdr) };
  // The signal's key is the fire's, so the cycle's commits speak under the key Blueprint reads now.
  pinning.signal = payload.signal;
  if (previous) clearRunDirectory(ctx.root, previous);
  const run = newRun(key, ctx.now(), {
    branch: payload.runBranch,
    itemBranch: payload.branch,
    design: payload.design,
    scaffold: facts.scaffold,
    startCommit: facts.head,
    accepted: facts.head,
    adapters: facts.adapters,
    protect: facts.protect,
    ...pinning,
  });
  saveRun(ctx.root, run);
  const header = previous ? `cycle ${run.cycle} opens on the newer scaffold ${facts.scaffold}` : 'admitted';
  return { code: 0, text: `blueprint-foreman ${key} · ${header}\n\n${committing(run)}\n\n${describe(run, ctx)}` };
}

// The run directory emptied for a new cycle, but for its calibration log, which spans every cycle.
function clearRunDirectory(root, run) {
  const dir = runDir(root, run);
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (name !== 'calibration.log') fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

// B that does not merge into F without conflicts: the needs-human signal, naming the files, and nothing
// else written.
function conflicting(key, payload, files, cycle) {
  const reason = `merging ${payload.branch} into ${payload.runBranch} conflicts in ${files.join(', ')}, which a person resolves`;
  return { code: 1, text: `${refusal(key, [reason], 'needs-human')}\n\nCommit the signal, then push it, and end the session: ${conflictCommit(key, payload.branch, files, cycle, payload.signal)}` };
}

// A newer scaffold on B that the checks refuse: its signal, one empty commit carrying the reasons,
// which leaves the run state as it was; the next fire that brings a newer scaffold still opens a cycle.
function redesignRefused(run, state, reasons, signal) {
  return { code: 1, text: `${refusal(run.key, reasons, state)}\n\nCommit the signal, then push it, and end the session: ${failedCommit(run.key, reasons, run.cycle, state, signal)}` };
}

// B's tip, as the checkout holds it, and the latest scaffold it carries for the item.
const tipOf = (payload) => `refs/remotes/origin/${payload.branch}`;

// Where B carries a newer scaffold than the run's, the new cycle: B merged into F first, after the
// files the run had not accepted, changed since its accepted commit by no merge, are put back, so none
// is merged with the new design; then, B's tip on F, the cycle admitted on it. Null where B carries
// none.
function redesign(run, ctx, payload) {
  const tip = tipOf(payload);
  const latest = latestScaffold(ctx.git, scaffoldCommits(ctx.git, run.key, tip).exact);
  if (!latest || latest === run.scaffold || ctx.git.isAncestor(latest, run.scaffold)) return null;
  const apart = ownPaths(run);
  const dirty = ctx.git.dirtyFiles(apart);
  if (dirty.length) return again(run, [`commit or discard every change first; uncommitted: ${dirty.join(', ')}`], payload);
  if (ctx.git.isAncestor(tip, 'HEAD')) return admit(payload, ctx, run);
  const merged = new Set(mergesSince(ctx, run, run.accepted).flatMap((m) => ctx.git.changedFiles(`${m}^1`, m, apart)));
  const strays = ctx.git.changedFiles(run.accepted, 'HEAD', apart).filter((f) => !merged.has(f));
  const restore = `git restore --source=${run.accepted} --staged --worktree -- ${strays.map(quote).join(' ')} && git commit --allow-empty --quiet -m ${quote(`chore(blueprint-foreman): put back ${run.key}'s unaccepted work before the new design`)}`;
  const conflicted = ctx.git.mergeConflicts('HEAD', tip, { source: run.accepted, files: strays });
  if (conflicted.length) return conflicting(run.key, payload, conflicted, run.cycle);
  const lines = [...(strays.length ? [restore] : []), `git merge --no-edit --quiet ${quote(`origin/${payload.branch}`)}`, wakeCommand(payload.value)];
  return {
    code: 0,
    text: [
      `blueprint-foreman ${run.key} · new design`,
      `  - ${payload.branch} carries the scaffold ${latest}, newer than the run's, ${run.scaffold}: a new cycle opens on it`,
      '',
      'Run each line as printed, in order; the last wakes the run again:',
      ...lines,
    ].join('\n'),
  };
}

// Why the merged code at HEAD cannot be taken: a protected path changed since `from`, the install
// having failed on it or changed the tree (`setup`, its reasons), a locked line gone, or a test no
// longer passing, of a landed slice or of the one about to land. What landed runs again in a scratch
// checkout of HEAD, which nothing left in the session's checkout reaches.
function mergedFails(run, ctx, from, setup) {
  const judges = ctx.git.changedFiles(from, 'HEAD', ownPaths(run)).filter(isProtected(run.protect));
  if (judges.length) return [`it changes a protected path: ${judges.join(', ')}`];
  if (setup.length) return setup;
  const landing = run.slice?.passing ? { ...run, landed: [...(run.landed ?? []), run.slice.id], passing: { ...run.passing, [run.slice.id]: run.slice.passing } } : run;
  const locks = locksAt(ctx, run, 'HEAD').map((f) => `${f.file}:${f.line}: ${f.claim}`);
  if (!landing.landed?.length) return locks;
  const still = ctx.git.withCheckout(ctx.git.head(), (dir) => {
    const install = runCommand({ cwd: dir, command: run.adapters.install, timeoutMs: ctx.config.testTimeoutMs });
    if (install.exitCode !== 0) return [`the install (${run.adapters.install}) failed in a scratch checkout of the merged code (exit ${install.exitCode})`];
    return regressions(ctx, landing, dir);
  });
  return [...locks, ...still];
}

// The steps at which a merge taken in changes what the final gate judged or is about to judge, so the
// final gate opens again at its first round, on the merged code.
const atFinal = (run, to) => to === 'settle' || (['gate', 'gate-dispositions'].includes(to) && run.gate?.name === 'final');

// What came in while the run rested, judged before it goes on to step `to`, with `setup` the reasons
// the install at this wake failed, if any. Since `rest` the code may change only by merges, of B or
// of the default branch, and a merge taken out again is none, so a revert clears what a merge brought;
// after a budget stop with none, the restore undoes whatever else came, and an install that fails
// before it may pass after it. Each merge since `from`, where `to` counts its change from, must be one
// the run can take: not at a step whose later attempts would restore the code to before it, nothing of
// the step's own before it, and the merged code holding; each stop on one says how to take it out.
// Then `to` counts from it, and at the final gate or settle the run goes on to the final run and the
// final gate again, carrying in what the round it interrupts left unsettled. Without a merge, an install that fails on code the run
// accepted fails the wake.
function atRest(run, ctx, { from, rest, to, budget, setup }) {
  const apart = ownPaths(run);
  const merges = mergesSince(ctx, run, from);
  if (budget && !merges.length) {
    if (!setup.length) return { go: {}, restore: true };
    return ctx.git.changedFiles(run.accepted, 'HEAD', apart).length ? { refused: [...setup, restoring(run, run.accepted)] } : { failed: setup };
  }
  const merged = new Set(merges.flatMap((m) => ctx.git.changedFiles(`${m}^1`, m, apart)));
  const strays = ctx.git.changedFiles(rest, 'HEAD', apart).filter((f) => !merged.has(f));
  if (strays.length) {
    return {
      refused: [
        `the branch changed at rest other than by a merge: ${strays.join(', ')}`,
        `${restoring(run, rest)}${merges.length ? '; this takes out the merges too' : ''}`,
      ],
    };
  }
  if (!merges.length) return setup.length ? { failed: setup } : { go: {} };
  const first = merges.at(-1);
  const out = `take ${merges.length > 1 ? 'the merges' : 'it'} out (${takingOut(merges)}) and answer`;
  if (IN_FLIGHT.includes(to)) {
    return { stop: `the branch took in merge ${first} while slice "${run.slice.id}" was at ${to}, where a later attempt would restore the code to before the merge; ${out}, and once the slice has landed, a revert of that revert brings it back` };
  }
  const own = ctx.git.changedFiles(from, `${first}^1`, apart);
  if (own.length) return { stop: `the branch took in merge ${first} while ${to} held work the engine had not accepted (${own.join(', ')}), and the run cannot judge the two apart; ${out}` };
  const failed = mergedFails(run, ctx, from, setup);
  if (failed.length) return { stop: `the branch took in merge ${merges[0]}, and the merged code does not hold: ${failed.join('; ')}; merge a fix and answer, or ${out}` };
  const head = ctx.git.head();
  if (atFinal(run, to)) return { onward: 'final', go: { accepted: head, gate: reopenFinal(run, merges[0]) } };
  // A slice's first step counts from its base, which the merge moves on.
  return { go: { accepted: head, ...(['red', 'builder'].includes(to) ? { slice: { ...run.slice, base: head } } : {}) } };
}

// Out of a stop: back to the stopped step, with a fresh budget after a budget stop and the fire's answer
// in every brief for the rest of the cycle. What came in at rest is judged first, `setup` the reasons
// the install at this wake failed.
function resume(run, ctx, setup, { answer, payload }) {
  const to = run.stop.from;
  const budget = run.stop.kind === 'budget';
  // The answer is kept as the fire gave it, which every brief after quotes.
  const left = { ...run, stop: undefined, answers: [...(run.answers ?? []), { cycle: run.cycle, stop: run.stops, text: answer }], ...(budget ? { slice: { ...run.slice, budget: ctx.config.budget, attempt: run.slice.attempt + 1 } } : {}) };
  const from = { from: left.accepted, ...STEPS[to].bounds?.({ ...left, step: to }, undefined, ctx) }.from;
  // A budget stop rests on the code its slice is restored to; a need stop on the commit it was taken at.
  const rest = budget ? run.accepted : run.stop.at;
  const judged = atRest(left, ctx, { from, rest, to, budget, setup });
  if (judged.failed) return failing(run.key, judged.failed, run.cycle, run.signal);
  if (judged.refused) return again(run, judged.refused, payload);
  if (judged.stop) {
    const stopped = advance(left, 'wake', 'stopped', ctx.now(), stop(left, { kind: 'need', need: judged.stop, from: to, at: rest }));
    saveRun(ctx.root, stopped);
    return { code: 1, text: `${refusal(run.key, [judged.stop])}\n\n${committing(stopped)}\n\n${describe(stopped, ctx)}` };
  }
  const moved = onward(ctx, left, judged.onward ? { onward: judged.onward, extra: judged.go } : { next: to, extra: judged.go });
  const next = advance(left, 'wake', moved.next, ctx.now(), moved.extra);
  saveRun(ctx.root, next);
  for (const fields of moved.log ?? []) logLine(ctx.root, run, fields);
  const header = `resumed from stop ${run.stops}`;
  const reopened = judged.onward ? `\n\nMerge ${judged.go.gate.merge} came in at ${to}, so the final gate opens again at its first round, on the merged code.` : '';
  return { code: 0, text: `blueprint-foreman ${run.key} · ${header}${reopened}\n\n${committing(next, judged.restore ? run.accepted : undefined)}\n\n${describe(next, ctx)}` };
}

// B moved on while the run was stopped on a need: merged in before the run resumes, where the run can
// judge the merge, at a step no later attempt restores past and with no work beside it the engine had
// not accepted; else B's move waits for a later rest. Null where there is nothing to merge now.
function mergingB(run, ctx, payload) {
  const to = run.stop.from;
  if (ctx.git.isAncestor(tipOf(payload), 'HEAD') || run.stop.kind !== 'need' || IN_FLIGHT.includes(to)) return null;
  const from = { from: run.accepted, ...STEPS[to].bounds?.({ ...run, step: to }, undefined, ctx) }.from;
  const apart = ownPaths(run);
  const merged = new Set(mergesSince(ctx, run, from).flatMap((m) => ctx.git.changedFiles(`${m}^1`, m, apart)));
  if (ctx.git.changedFiles(from, 'HEAD', apart).some((f) => !merged.has(f))) return null;
  const conflicted = ctx.git.mergeConflicts('HEAD', tipOf(payload));
  if (conflicted.length) return conflicting(run.key, payload, conflicted, run.cycle);
  return {
    code: 0,
    text: [
      `blueprint-foreman ${run.key} · merge`,
      `  - ${payload.branch} moved on while the run rested; the run takes it in, and judges it, as it resumes`,
      '',
      'Run each line as printed, in order; the last wakes the run again:',
      `git merge --no-edit --quiet ${quote(`origin/${payload.branch}`)}`,
      wakeCommand(payload.value),
    ].join('\n'),
  };
}

// A run the branch already carries, where B brings no newer scaffold. A working one is described where
// it stands, since a dead session's unpushed work is simply redone, and so is one whose last signal is
// failed; a stopped one goes on only with the answer the fire carries; a settled or rejected one goes
// on only on a newer scaffold. A fire that would go on, but falls short of its schema, fails; its
// options, even valid, are passed over. Every fire is a fresh clone, so a wake that goes on first
// installs the dependencies, on a clean tree the install must leave clean.
function goOn(run, ctx, payload) {
  if (run.step === 'rejected') return ends(run.key, [`the run is rejected (${run.rejection.why}), and only a newer scaffold on ${run.itemBranch} opens another cycle`]);
  if (run.step === 'settled') return ends(run.key, [`the run settled cycle ${run.cycle}, and only a newer scaffold on ${run.itemBranch} opens another`]);
  const answer = typeof payload.answer === 'string' && payload.answer.trim() ? payload.answer : null;
  if (run.step === 'stopped' && !answer) return ends(run.key, [`the run is stopped on stop ${run.stops} (${run.stop.need}), and the fire carries no answer`]);
  if (payload.problems.length) return failing(run.key, malformed(payload), run.cycle, run.signal);
  const apart = ownPaths(run);
  const dirty = ctx.git.dirtyFiles(apart);
  if (dirty.length) return again(run, [`commit or discard every change first; uncommitted: ${dirty.join(', ')}`], payload);
  const merge = run.step === 'stopped' && mergingB(run, ctx, payload);
  if (merge) return merge;
  const setup = installed(ctx, run.adapters.install, apart);
  if (run.step === 'stopped') return resume(run, ctx, setup, { answer, payload });
  return setup.length ? failing(run.key, setup, run.cycle, run.signal) : { code: 0, text: describe(run, ctx) };
}

function wake(text, ctx) {
  const payload = readPayload(text);
  // Without a branch to read there is nowhere to write, so such a fire leaves nothing.
  if (payload.unreadable) {
    const reasons = [...payload.unreadable, `a fire is the JSON ${SCHEMA_FILE} describes, on wake's stdin`];
    return { code: 1, text: `${refusal(undefined, reasons)}\n\nWith no key or branch to read, this fire writes nothing: end the session.` };
  }
  const { key, branch, runBranch: own } = payload;
  const current = ctx.git.currentBranch();
  if (current !== own) return checkingOut(payload, `the checkout is ${current}, not ${own}, the branch the run works on`);
  const tip = ctx.git.treeOf(tipOf(payload));
  if (!tip) return checkingOut(payload, `the checkout holds no origin/${branch}, the tip of Blueprint's branch`);
  if (hasRun(ctx.root, key)) {
    const run = pinned(loadRun(ctx, key), ctx);
    return (!payload.problems.length && redesign(run, ctx, payload)) || goOn(run, ctx, payload);
  }
  // A branch that has carried a run, a swept one among them, carries none to admit or refuse.
  const state = `${runDirectory(located(ctx.root, key))}/run.json`;
  const carried = ctx.git.lastTouching(state);
  if (carried || hasCopy(ctx.root, key)) {
    const where = carried ? `commit ${carried} touched ${state}` : "the checkout's git directory holds the engine's copy of one";
    return ends(key, [`${own} has carried a run for ${key} (${where}), and ${state} is gone; a run is admitted only where none has been`]);
  }
  if (payload.problems.length) return intake(payload, 'failed', malformed(payload));
  // A run is admitted only on the code Blueprint's branch holds: an earlier intake's signal changes
  // none of it, and where B moved on since, it is merged in first.
  if (!ctx.git.isAncestor(tipOf(payload), 'HEAD')) {
    const conflicted = ctx.git.mergeConflicts('HEAD', tipOf(payload));
    if (conflicted.length) return conflicting(key, payload, conflicted, null);
    return { code: 0, text: [`blueprint-foreman ${key} · merge`, `  - ${branch} moved on since ${own} was cut from it`, '', 'Run each line as printed, in order; the last wakes the run again:', `git merge --no-edit --quiet ${quote(`origin/${branch}`)}`, wakeCommand(payload.value)].join('\n') };
  }
  if (tip !== ctx.git.treeOf('HEAD')) {
    return intake(payload, 'failed', [`${own} is not at the tip of ${branch}: its code differs from origin/${branch}'s, and a run is admitted only on the code Blueprint's branch holds`]);
  }
  return admit(payload, ctx);
}

export async function run(argv, options) {
  const ctx = {
    git: createGit(options.root),
    now: () => new Date().toISOString(),
    env: process.env,
    fetch: globalThis.fetch,
    node: process.versions.node,
    ...options,
  };
  // Tests pass their own table; a run's own is pinned (record.mjs).
  ctx.models = options.models ?? createModels(MODEL_TABLE);
  ctx.config = { ...DEFAULTS, ...options.config };
  try {
    return await dispatch(argv, ctx);
  } catch (e) {
    // A run state that will not load fails the wake, by the cycle the branch last signalled, but for
    // one the session restores from the engine's copy.
    if (e.code === 'RUN_CHANGED') return e.restorable ? { code: 1, text: refusal(e.key, [e.message]) } : failing(e.key, [e.message], signalledCycle(ctx.git, e.key), readPayload(ctx.input).signal ?? e.signal);
    throw e;
  }
}

async function dispatch(argv, ctx) {
  const [command, ...rest] = argv;
  if (command === 'wake' && rest.length === 0) return wake(ctx.input, ctx);
  if (command === 'record' && KEY_PATTERN.test(rest[0] ?? '')) return record(rest[0], rest[1], rest.slice(2).join(' ') || undefined, ctx);
  // A candidate model may be probed before the operator names it in the table.
  if (command === 'probe-adversary') {
    return probeAdversary(rest[0] ? { ...ctx, models: createModels({ ...ctx.models.table, adversary: rest[0] }) } : ctx);
  }
  return {
    code: 2,
    text: [
      `usage: ${ENGINE} wake (the fire on stdin)`,
      `       ${ENGINE} record <KEY> <what> [value]`,
      `       ${ENGINE} record <KEY> need "<what>"`,
      `       ${ENGINE} record <KEY> reject "<why>"`,
      `       ${ENGINE} probe-adversary [model]`,
    ].join('\n'),
  };
}
