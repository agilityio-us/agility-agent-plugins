// Review: what reviewers raise, and what becomes of it. After the engine's replays pass, it splits the
// slice's diff into groups a Reviewer reads well (review quality falls off sharply past about 150
// changed lines) and a fresh Reviewer reads each; then a Contract Reviewer, never one of the run's
// authors, judges the replays, the findings, the diff, scope and the exhibit against the slice's
// criteria and promise. Only its passing verdict lands the slice; a failing one spends an attempt, and
// what it found is carried into the next attempt's review. Slice review is not a gate: its findings are
// fixed within the slice's budget. Every review, the gates' too, raises findings in one form, which the
// run state keeps, and settles them by one accept of dispositions, where a refutation stands only on
// evidence the engine can find, and never against what the engine raised itself; what is handed off or
// fixed the run state keeps for the pull request, and every review run and finding goes into the
// calibration log. Reviewers only ever propose findings; what happens to each one is recorded here.

import fs from 'node:fs';
import { ENGINE } from './config.mjs';
import { sliceOf } from './plan.mjs';
import { authorRefusal, noAuthor, ownPaths, readRunJson, runDirectory, runFile } from './run.mjs';
import { attemptDir, spend } from './slice.mjs';

const GROUP_LIMIT = 150;
const DISPOSITIONS = ['fixed', 'refuted', 'widens', 'handed-off'];
// What becomes of a finding that asks for more than the design's scenarios.
const WIDENS = "widens the design's scenarios: a question for a person, never a stricter bar";
// The sources of the findings the engine raised itself, which no refutation answers: convergence's,
// the locks' and the gaps' among them, and an unmet verdict. Each is fixed or handed off.
export const ENGINE_RAISED = ['convergence', 'verdict'];

// The bar every judge of the change holds it to, and only it: the design's scenarios. A slice's
// outcome, the plan's wording and every finding only point at them.
export const BAR =
  "The design's scenarios are the bar, their given, when and then: a slice's outcome, the plan's wording and every finding only point at them. A case no scenario describes (an order, a race, an input or a guarantee none of them gives) is never a reason to fail or to fix: it is a finding, and a person decides it.";

// The one form of findings, wherever the session writes them: a list, possibly empty.
export const FINDINGS_FORM = '[ { "file": "<path>", "line": <number>, "claim": "<what is wrong and why>" } ]';

// Findings in that form, each citing a file and line: the problems name every one that does not.
export function checkFindings(findings, label) {
  if (!Array.isArray(findings)) return [`${label} must be a list, possibly empty: ${FINDINGS_FORM}`];
  const problems = [];
  findings.forEach((f, i) => {
    if (typeof f?.file !== 'string' || f.file === '' || !Number.isInteger(f?.line) || f.line < 1) {
      problems.push(`${label}: finding ${i + 1} must cite a file and a line ("file", "line")`);
    }
    if (typeof f?.claim !== 'string' || f.claim.trim() === '') problems.push(`${label}: finding ${i + 1} needs a "claim"`);
  });
  return problems;
}

// A path from a `--- a/` or `+++ b/` line: git ends a path holding a space with a tab, and quotes one
// holding a quote, a backslash or a control character.
function headerPath(line) {
  const p = line.slice(4).replace(/\t$/, '');
  return (p.startsWith('"') ? JSON.parse(p) : p).replace(/^[ab]\//, '');
}

// Hunks of a diff outside `apart`, the run directory, per file in path order: each file keeps its header
// lines, and each hunk its text and the number of lines it changes, so a group's diff holds only its
// own hunks.
export function diffHunks(git, from, to, apart) {
  const text = git.diffText(from, to, ['.', ...[apart].flat().map((p) => `:(exclude)${p}`)]);
  const files = [];
  let file = null;
  let hunk = null;
  for (const line of text.replace(/\n$/, '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = { path: line.split(' b/').pop(), header: [line], hunks: [] };
      files.push(file);
      hunk = null;
    } else if (line.startsWith('@@') && file) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      hunk = { start: Number(m?.[1] ?? 0), length: Number(m?.[2] ?? 1), changed: 0, text: [line] };
      file.hunks.push(hunk);
    } else if (hunk) {
      hunk.text.push(line);
      if (line.startsWith('+') || line.startsWith('-')) hunk.changed += 1;
    } else if (file) {
      file.header.push(line);
      if (/^(---|\+\+\+) /.test(line) && !line.endsWith(' /dev/null')) file.path = headerPath(line);
    }
  }
  return files.filter((f) => f.hunks.length).sort((a, b) => a.path.localeCompare(b.path));
}

// A group's own diff: each part's file header and only the hunks the group holds.
export function groupText(group) {
  return `${group.parts.flatMap((p) => [...(p.header ?? []), ...p.hunks.flatMap((h) => h.text ?? [])]).join('\n')}\n`;
}

// Groups of at most GROUP_LIMIT changed lines. Files stay whole where they fit, and neighbouring
// paths share a group; a larger file is split by hunks, and a single hunk over the limit is its own
// group, marked oversize.
export function groupDiff(files, limit = GROUP_LIMIT) {
  const groups = [];
  let current = null;
  const open = () => {
    current = { id: groups.length + 1, parts: [], lines: 0, oversize: false };
    groups.push(current);
  };
  const add = (f, hunks, lines) => {
    if (!current || current.lines + lines > limit) open();
    current.parts.push({ path: f.path, header: f.header, hunks });
    current.lines += lines;
  };
  for (const f of files) {
    const total = f.hunks.reduce((n, h) => n + h.changed, 0);
    if (total <= limit) {
      add(f, f.hunks, total);
      continue;
    }
    for (const h of f.hunks) {
      if (h.changed > limit) {
        open();
        current.parts.push({ path: f.path, header: f.header, hunks: [h] });
        current.lines = h.changed;
        current.oversize = true;
        current = null;
      } else {
        add(f, [h], h.changed);
      }
    }
  }
  return groups;
}

// The one form of dispositions, `allowed` those the review takes.
const dispositionsForm = (allowed) =>
  `[ { "finding": <its number, from 1>, "disposition": ${allowed.map((d) => `"${d}"`).join(' | ')}, "evidence": <for a refutation, as below>${allowed.includes('fixed') ? ', "criterion": <for a fix, the key of the criterion whose scenario it serves>' : ''} } ]`;

// The tests a refutation may cite, and the proof run that passed them: in a slice, its green's; at a
// gate, every landed slice's.
function proven(run) {
  if (run.slice) return { tests: run.slice.passing ?? [], by: 'the last proof run' };
  return { tests: (run.landed ?? []).flatMap((id) => run.passing?.[id] ?? []), by: "a landed slice's proof run" };
}

// The brief for settling the findings in `at`, a directory of the run's: the form, `allowed` the
// dispositions it takes, and the evidence a refutation stands on.
export function dispositionsBrief(run, at, allowed) {
  const dir = `${runDirectory(run)}/${at}`;
  const { tests, by } = proven(run);
  return [
    `Settle every finding in ${dir}/findings.json in ${dir}/dispositions.json:`,
    `  ${dispositionsForm(allowed)}`,
    "A refutation's evidence cites what the engine can find, and says why it shows the finding wrong: a line",
    `HEAD holds, { "file": "<path>", "line": <number>, "why": "..." }, or a test ${by} passed, by`,
    `its full name, { "test": "<name>", "why": "..." }${tests.length ? `, one of ${tests.map((t) => `"${t}"`).join(', ')}` : ', of which there are none yet'}.`,
    'A refutation on any other evidence is handed off.',
    BAR,
    `A finding that asks for more than the scenarios is "widens": the engine hands it off, as a question for a person.${allowed.includes('fixed') ? ' A fix serves a scenario, never more: it names the criterion whose scenario it serves.' : ''}`,
  ];
}

// Why a refutation's evidence does not stand, or null when the engine finds what it cites and it says
// why: `lines(file)` counts a file's lines at HEAD, null where HEAD holds no such file, and `tests` are
// those the proof run `by` names passed.
function unfounded(evidence, { lines, tests, by }) {
  if (typeof evidence?.test === 'string') {
    if (!tests.includes(evidence.test)) return `${by} passed no test named "${evidence.test}"`;
  } else if (typeof evidence?.file === 'string' && Number.isInteger(evidence.line)) {
    const count = lines(evidence.file);
    if (count === null) return `HEAD holds no file ${evidence.file}`;
    if (evidence.line < 1 || evidence.line > count) return `${evidence.file} has no line ${evidence.line} at HEAD`;
  } else {
    return 'it cites neither a file and line nor a test';
  }
  return typeof evidence.why === 'string' && evidence.why.trim() !== '' ? null : 'it does not say why the finding is wrong';
}

// Settles recorded dispositions against the findings they answer, `found` what the engine finds for
// `unfounded`. A finding that widens the design, a refutation of a finding the engine raised itself, or
// one on evidence that does not stand, becomes a hand-off, noting why; anything left without a
// disposition is reported open.
export function settleDispositions(findings, recorded, found) {
  const settled = [];
  const open = [];
  findings.forEach((finding, i) => {
    const d = recorded.find((r) => r?.finding === i + 1);
    if (!d || !DISPOSITIONS.includes(d.disposition)) {
      open.push(i + 1);
      return;
    }
    const own = d.disposition === 'refuted' && ENGINE_RAISED.includes(finding.source);
    const why = d.disposition === 'refuted' && !own ? unfounded(d.evidence, found) : null;
    const note = d.disposition === 'widens' ? WIDENS : own ? 'refuted, but the engine raised it itself, so handed off' : why ? `refuted on evidence the engine cannot find (${why}), so handed off` : undefined;
    settled.push({ finding: i + 1, disposition: note ? 'handed-off' : d.disposition, evidence: d.evidence, ...(d.disposition === 'fixed' ? { criterion: d.criterion } : {}), note });
  });
  return { settled, open };
}

const lineCount = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

// The one accept of dispositions, a slice's and both gates': every one of `findings`, the review's as
// the run state keeps them (findings.json in `at` is the session's copy), settled by the
// dispositions.json beside it, none fixed where `unfixable` says why none may be, and none naming a
// finding there is not. Each fix of a finding the engine did not raise names the criterion of
// `criteria`, the design's keys, whose scenario it serves, so no fix stands on a finding that asks for
// more than the scenarios. The settled list is written beside them, and each finding gets a calibration
// line with `raised(finding)`, the fields that name who raised it. Returns { settled, handedOff, fixed,
// log }, the run's handed-off and fixed findings with this review's added, each with its cycle and its
// source, and the lines, or { refused }.
export function acceptDispositions(ctx, run, at, findings, { unfixable, raised, criteria = [] }) {
  const file = `${runDirectory(run)}/${at}/dispositions.json`;
  const recorded = readRunJson(ctx.root, run, `${at}/dispositions.json`);
  if (!Array.isArray(recorded)) return { refused: [`${file} must be a list of dispositions, ${dispositionsForm(DISPOSITIONS)}`] };
  const strays = recorded.filter((d) => !(Number.isInteger(d?.finding) && d.finding >= 1 && d.finding <= findings.length));
  if (strays.length) return { refused: [`${file} names no finding by ${strays.map((d) => `"finding": ${JSON.stringify(d?.finding ?? null)}`).join(', ')}; the findings are numbered 1 to ${findings.length}`] };
  const lines = (name) => {
    const text = ctx.git.fileAt('HEAD', name);
    return text === null ? null : lineCount(text);
  };
  const { settled, open } = settleDispositions(findings, recorded, { lines, ...proven(run) });
  if (open.length) return { refused: [`findings ${open.join(', ')} have no disposition`] };
  if (unfixable && settled.some((s) => s.disposition === 'fixed')) return { refused: [unfixable] };
  const unserved = settled.filter((s) => s.disposition === 'fixed' && !ENGINE_RAISED.includes(findings[s.finding - 1].source) && !criteria.includes(s.criterion));
  if (unserved.length) {
    return {
      refused: [
        `findings ${unserved.map((s) => s.finding).join(', ')} are marked fixed but name no criterion whose scenario the fix serves, "criterion": one of ${criteria.map((k) => `"${k}"`).join(', ')}`,
        `a fix realizes the design's scenarios, never more: a finding that asks for more than they describe is "widens", which the engine hands off as a question for a person`,
      ],
    };
  }
  fs.writeFileSync(runFile(ctx.root, run, `${at}/settled.json`), `${JSON.stringify(settled, null, 2)}\n`);
  const log = settled.map((s) => ({ finding: s.finding, ...raised(findings[s.finding - 1]), disposition: s.disposition }));
  const kept = (disposition) =>
    settled.filter((s) => s.disposition === disposition).map(({ finding, note }) => {
      const { file: cited, line, claim, source } = findings[finding - 1];
      return { at, cycle: run.cycle, finding, file: cited, line, claim, ...(source ? { source } : {}), ...(note ? { note } : {}) };
    });
  return { settled, handedOff: [...(run.handedOff ?? []), ...kept('handed-off')], fixed: [...(run.fixed ?? []), ...kept('fixed')], log };
}

// The calibration log, calibration.log in the run directory: one line per review run and one per finding, so
// that over many runs it shows which reviewers' findings held up. Lines are key=value, never prose
// from the item or the code, and never a credential. A step's accept gives its lines as the outcome's
// `log`, which `record` writes once the record takes effect.
const clean = (v) => String(v ?? '-').replace(/[\s=]+/g, '_');

export function logLine(root, run, fields) {
  const line = Object.entries(fields)
    .map(([k, v]) => `${k}=${clean(v)}`)
    .join(' ');
  fs.appendFileSync(runFile(root, run, 'calibration.log'), `${line}\n`);
}

export function readLog(root, run) {
  const file = runFile(root, run, 'calibration.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

// A file of the slice's current attempt.
const attemptFile = (root, run, name) => runFile(root, run, `${attemptDir(run)}/${name}`);

// The groups of the slice's change, as the engine splits it; groups.json is the session's copy.
const groupsOf = (ctx, run) => groupDiff(diffHunks(ctx.git, run.slice.base, run.slice.greenCommit, ownPaths(run)));

export const REVIEW_STEPS = {
  'group-review': {
    title: 'review the diff in groups',
    records: 'groups',
    instruct(run, ctx) {
      const groups = groupsOf(ctx, run);
      fs.mkdirSync(attemptFile(ctx.root, run, ''), { recursive: true });
      const index = groups.map((g) => ({ ...g, parts: g.parts.map((p) => ({ path: p.path, hunks: p.hunks.map(({ start, length, changed }) => ({ start, length, changed })) })) }));
      fs.writeFileSync(attemptFile(ctx.root, run, 'groups.json'), `${JSON.stringify(index, null, 2)}\n`);
      for (const g of groups) fs.writeFileSync(attemptFile(ctx.root, run, `group-${g.id}.diff`), groupText(g));
      const at = `${runDirectory(run)}/${attemptDir(run)}`;
      return [
        `The slice's change splits into ${groups.length} group(s) of at most 150 changed lines (${at}/groups.json).`,
        `${ctx.models.dispatch('reviewer')} for each group n, which reads ${at}/group-n.diff and reports only`,
        `findings that affect correctness or the slice's criteria, ${sliceOf(run).criteria.join(', ')}, in the design as the run`,
        `admitted it (git show ${run.startCommit}:${run.design}), never style, citing file and line.`,
        'Reviewers propose findings only: they edit nothing but their findings file, and never approve.',
        `Write each group's findings, possibly empty, to ${at}/group-n.findings.json as ${FINDINGS_FORM}.`,
        ...groups.filter((g) => g.oversize).map((g) => `Group ${g.id} is one hunk over the limit (oversize); review it all the same.`),
      ];
    },
    record: (run) => `${ENGINE} record ${run.key} groups`,
    // Every group the engine splits the change into has its findings, which the run state keeps, each
    // with the group that raised it, for the contract review to join.
    accept(run, ctx) {
      const found = groupsOf(ctx, run).map((g) => ({ id: g.id, findings: readRunJson(ctx.root, run, `${attemptDir(run)}/group-${g.id}.findings.json`) }));
      const problems = found.flatMap((g) => checkFindings(g.findings, `group ${g.id}'s findings`));
      if (problems.length) return { refused: problems };
      const groupFindings = found.flatMap((g) => g.findings.map((f) => ({ ...f, source: `group ${g.id}` })));
      return { next: 'contract-review', extra: { slice: { ...run.slice, groupFindings } } };
    },
  },

  'contract-review': {
    title: 'judge the slice against its contract',
    records: 'contract',
    instruct(run, ctx) {
      const slice = sliceOf(run);
      const at = `${runDirectory(run)}/${attemptDir(run)}`;
      // A plan declares an exhibit only where the run holds the exhibits practice.
      const exhibit = !slice.exhibit
        ? '.'
        : slice.exhibit.shows
          ? `, and its exhibit (${(run.slice.exhibits ?? []).map((e) => e.file).join(', ')}) against the promise that it shows ${slice.exhibit.shows} (${slice.exhibit.form}), in what the system itself does or says, never a harness's verdict about it.`
          : `, and that its exhibit is rightly none (${slice.exhibit.none}).`;
      const carried = run.slice.carried ?? [];
      return [
        `${ctx.models.dispatch('contract')}, ${noAuthor(run)}, to judge slice`,
        `"${slice.id}" against criteria ${slice.criteria.join(', ')} in the design as the run admitted it (git show ${run.startCommit}:${run.design})${exhibit}`,
        `It reads the engine's replay evidence (${at}/replay.json, whose findings join the slice's), the group findings`,
        `(${at}/group-*.findings.json), the diff (${run.slice.base}..${run.slice.greenCommit}) and the slice's scope, and never runs the replays itself.`,
        BAR,
        "It fails the slice only for a scenario of its criteria the change does not meet, or a defect the change brings into what it touches; for anything else it passes, with the finding.",
        ...(carried.length
          ? [
              "What the slice's failed reviews found is carried into this one: it joins the slice's findings, so the Contract",
              'Reviewer weighs each again in its verdict, and does not raise it again:',
              ...carried.map((f) => `  - ${f.file}:${f.line}: ${f.claim} (attempt ${f.attempt}, ${f.source})`),
            ]
          : []),
        `It writes ${at}/contract.json:`,
        `  { "verdict": "pass" | "fail", "reasons": ["..."], "findings": ${FINDINGS_FORM} }`,
        "It edits nothing but contract.json. Record its verdict with the Contract Reviewer's agent id.",
      ];
    },
    record: (run) => `${ENGINE} record ${run.key} contract <the Contract Reviewer's agent id>`,
    accept(run, ctx, agentId) {
      if (!agentId) return { refused: ["record the Contract Reviewer's agent id"] };
      const author = authorRefusal(run, agentId, 'the contract verdict');
      if (author) return author;
      const contract = readRunJson(ctx.root, run, `${attemptDir(run)}/contract.json`);
      if (!['pass', 'fail'].includes(contract?.verdict)) return { refused: ['contract.json needs "verdict": "pass" or "fail"'] };
      const problems = checkFindings(contract.findings, "contract.json's findings");
      if (problems.length) return { refused: problems };
      const findings = [
        ...(run.slice.groupFindings ?? []),
        ...contract.findings.map((f) => ({ ...f, source: 'contract' })),
        ...(run.slice.findings ?? []),
        ...(run.slice.carried ?? []),
      ];
      fs.writeFileSync(attemptFile(ctx.root, run, 'findings.json'), `${JSON.stringify(findings, null, 2)}\n`);
      const log = [{ review: 'slice', slice: run.slice.id, attempt: run.slice.attempt, reviewer: 'contract', model: ctx.models.pick('reviewer'), provider: 'anthropic', findings: findings.length, verdict: contract.verdict }];
      if (contract.verdict === 'fail') {
        // What the failed review found is judged again by the next attempt's, never dropped unhanded.
        const carried = findings.map((f) => ({ attempt: run.slice.attempt, ...f }));
        return { ...spend(run, [`the Contract Reviewer failed the slice: ${(contract.reasons ?? []).join('; ') || 'no reason given'}`], 'green', { carried }), log };
      }
      // The run state keeps the findings its dispositions settle; findings.json is the session's copy.
      return { ...(findings.length ? { next: 'slice-dispositions', extra: { slice: { ...run.slice, findings } } } : { onward: 'land' }), log };
    },
  },

  'slice-dispositions': {
    title: "settle the slice's findings",
    records: 'dispositions',
    instruct: (run) => [
      'The slice passed its contract review.',
      ...dispositionsBrief(run, attemptDir(run), ['refuted', 'handed-off']),
      'A finding worth fixing should have failed the review; here each is refuted with evidence or handed off.',
    ],
    record: (run) => `${ENGINE} record ${run.key} dispositions`,
    accept(run, ctx) {
      const done = acceptDispositions(ctx, run, attemptDir(run), run.slice.findings, {
        unfixable: 'a passed slice fixes nothing more; refute with evidence or hand off',
        raised: (f) => ({ review: 'slice', slice: run.slice.id, source: f.source }),
      });
      if (done.refused) return done;
      return { onward: 'land', extra: { handedOff: done.handedOff }, log: done.log };
    },
  },
};
