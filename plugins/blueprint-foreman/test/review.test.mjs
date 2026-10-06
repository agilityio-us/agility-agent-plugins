// Offline tests for group and contract review, findings and dispositions: `node --test
// plugins/blueprint-foreman/test/review.test.mjs`; their fixture is fixture.mjs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { LOCK_RULE } from '../lib/locks.mjs';
import { acceptDispositions, checkFindings, diffHunks, groupDiff, groupText, logLine, readLog, settleDispositions } from '../lib/review.mjs';
import { KEY, BRANCH, DESIGN, FILLED, GREEN_CODE, SCAFFOLDED, fixture, ok, refused, walk, restore, scratchDir, REVIEW, exhibit, GREETING, GREET_ROW, proposes } from './fixture.mjs';

// The first cycle's final gate, round 1.
const FINAL = `docs/prs/${KEY}/foreman/gates/final-c1-r1`;

test('groups hold at most 150 changed lines, keep small files whole and isolate an oversize hunk', () => {
  const files = [
    { path: 'a.ts', hunks: [{ start: 1, length: 90, changed: 90 }] },
    { path: 'b.ts', hunks: [{ start: 1, length: 80, changed: 80 }] },
    { path: 'c.ts', hunks: [{ start: 1, length: 200, changed: 200 }, { start: 300, length: 10, changed: 10 }] },
  ];
  const groups = groupDiff(files);
  assert.deepEqual(groups.map((g) => [g.lines, g.oversize]), [[90, false], [80, false], [200, true], [10, false]]);
  assert.deepEqual(groups.map((g) => g.parts.map((p) => [p.path, p.hunks.map((h) => h.start)])), [[['a.ts', [1]]], [['b.ts', [1]]], [['c.ts', [1]]], [['c.ts', [300]]]], 'the oversize hunk holds only itself');
});

test('a group diff holds only its own hunks and never the run state, and a file git would call binary is read as text', () => {
  const f = fixture();
  const lines = Array.from({ length: 400 }, (_, i) => `line ${i}`);
  f.write('src/big.mjs', `${lines.join('\n')}\n`);
  f.commit('big', ['src/big.mjs']);
  const base = f.sh('rev-parse', 'HEAD');
  f.write('src/big.mjs', `${lines.map((l, i) => (i < 40 || (i >= 300 && i < 340) ? `${l} changed` : l)).join('\n')}\n`);
  f.write(`docs/prs/${KEY}/foreman/run.json`, '{}');
  fs.writeFileSync(path.join(f.root, 'src', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  f.commit('change both ends', ['src/big.mjs', `docs/prs/${KEY}/foreman/run.json`, 'src/logo.png']);
  // The diff comes through the engine's view of git, as tests inject it.
  const read = [];
  const git = { ...f.ctx.git, diffText: (...args) => (read.push(args), f.ctx.git.diffText(...args)) };
  const groups = groupDiff(diffHunks(git, base, f.sh('rev-parse', 'HEAD'), `docs/prs/${KEY}/foreman`));
  assert.equal(read.length, 1);
  assert.deepEqual(groups.map((g) => g.lines), [80, 81]);
  // A NUL byte makes git call a file binary and hide its lines, and a script could hold one in a comment.
  assert.deepEqual(groups.flatMap((g) => g.parts.map((p) => p.path)), ['src/big.mjs', 'src/big.mjs', 'src/logo.png'], "a binary file's change is reviewed as text");
  const [first, second] = groups.map(groupText);
  assert.match(first, /^diff --git a\/src\/big\.mjs/);
  assert.match(first, /line 0 changed/);
  assert.doesNotMatch(first, /line 300 changed/);
  assert.match(second, /^diff --git a\/src\/big\.mjs[\s\S]*line 300 changed/);
  assert.doesNotMatch(first + second, /foreman\//);
});

test('a refutation stands only on a line HEAD holds or a test the last proof run passed, and says why', () => {
  // HEAD holds a.ts, of 3 lines, and the last proof run passed the test "t".
  const found = { lines: (file) => (file === 'a.ts' ? 3 : null), tests: ['t'], by: 'the last proof run' };
  const cases = [
    [{ file: 'a.ts', line: 3, why: 'the guard is here' }, null],
    [{ test: 't', why: 't pins it' }, null],
    ['test t covers it', /it cites neither a file and line nor a test/],
    [undefined, /it cites neither a file and line nor a test/],
    [{ file: 'a.ts', line: '3', why: 'x' }, /it cites neither a file and line nor a test/],
    [{ file: 'a.ts', line: 4, why: 'x' }, /a\.ts has no line 4 at HEAD/],
    [{ file: 'a.ts', line: 0, why: 'x' }, /a\.ts has no line 0 at HEAD/],
    [{ file: 'b.ts', line: 1, why: 'x' }, /HEAD holds no file b\.ts/],
    [{ test: 'u', why: 'x' }, /the last proof run passed no test named "u"/],
    [{ file: 'a.ts', line: 1 }, /it does not say why the finding is wrong/],
    [{ test: 't', why: ' ' }, /it does not say why the finding is wrong/],
  ];
  const findings = cases.map((_, i) => ({ file: 'a.ts', line: 1, claim: `claim ${i}` }));
  const { settled, open } = settleDispositions(findings, cases.map(([evidence], i) => ({ finding: i + 1, disposition: 'refuted', evidence })), found);
  assert.deepEqual(open, []);
  cases.forEach(([evidence, why], i) => {
    const s = settled[i];
    if (!why) assert.equal(s.disposition, 'refuted', JSON.stringify(evidence));
    else {
      assert.equal(s.disposition, 'handed-off', JSON.stringify(evidence));
      assert.match(s.note, /^refuted on evidence the engine cannot find \(/);
      assert.match(s.note, why);
    }
  });
});

test('a finding cites a file by its path and a line from 1, and makes a claim', () => {
  const cite = 'r: finding 1 must cite a file and a line ("file", "line")';
  const claim = 'r: finding 1 needs a "claim"';
  assert.deepEqual(checkFindings([], 'r'), []);
  assert.deepEqual(checkFindings([{ file: 'a.ts', line: 1, claim: 'wrong' }], 'r'), []);
  for (const [finding, problems] of [
    [{ line: 1, claim: 'x' }, [cite]],
    [{ file: 3, line: 1, claim: 'x' }, [cite]],
    [{ file: '', line: 1, claim: 'x' }, [cite]],
    [{ file: 'a.ts', claim: 'x' }, [cite]],
    [{ file: 'a.ts', line: 0, claim: 'x' }, [cite]],
    [{ file: 'a.ts', line: 1.5, claim: 'x' }, [cite]],
    [{ file: 'a.ts', line: '1', claim: 'x' }, [cite]],
    [{ file: 'a.ts', line: 1 }, [claim]],
    [{ file: 'a.ts', line: 1, claim: 3 }, [claim]],
    [{ file: 'a.ts', line: 1, claim: ' ' }, [claim]],
    [null, [cite, claim]],
  ]) {
    assert.deepEqual(checkFindings([finding], 'r'), problems, JSON.stringify(finding));
  }
  assert.deepEqual(checkFindings({ findings: [] }, 'r'), ['r must be a list, possibly empty: [ { "file": "<path>", "line": <number>, "claim": "<what is wrong and why>" } ]']);
});

test('a disposition names a finding by its number, and a refutation cites a line HEAD holds, a final newline ending none', () => {
  const root = scratchDir('blueprint-foreman-review-');
  const at = 'review/greet-by-name-1';
  fs.mkdirSync(path.join(root, 'docs', 'prs', KEY, 'foreman', at), { recursive: true });
  // HEAD holds a.ts, two lines ending in a newline, and b.ts, two lines without one.
  const ctx = { root, git: { fileAt: (commit, file) => ({ 'a.ts': 'one\ntwo\n', 'b.ts': 'one\ntwo' })[file] ?? null } };
  const run = { key: KEY, design: `docs/prs/${KEY}/blueprint.md`, cycle: 1, slice: { passing: [] } };
  const findings = [1, 2, 3, 4].map((n) => ({ file: 'c.ts', line: n, claim: `claim ${n}` }));
  const settle = (dispositions) => {
    fs.writeFileSync(path.join(root, 'docs', 'prs', KEY, 'foreman', at, 'dispositions.json'), JSON.stringify(dispositions));
    return acceptDispositions(ctx, run, at, findings, { unfixable: null, raised: () => ({}) });
  };
  const each = findings.map((_, i) => ({ finding: i + 1, disposition: 'handed-off' }));
  for (const stray of [0, 1.5, 5, '1']) {
    assert.deepEqual(settle([...each, { finding: stray, disposition: 'handed-off' }]).refused, [`docs/prs/${KEY}/foreman/${at}/dispositions.json names no finding by "finding": ${JSON.stringify(stray)}; the findings are numbered 1 to 4`], String(stray));
  }
  const refute = (finding, file, line) => ({ finding, disposition: 'refuted', evidence: { file, line, why: 'it holds' } });
  const { settled } = settle([refute(1, 'a.ts', 2), refute(2, 'a.ts', 3), refute(3, 'b.ts', 2), refute(4, 'b.ts', 3)]);
  assert.deepEqual(settled.map((s) => s.disposition), ['refuted', 'handed-off', 'refuted', 'handed-off']);
  assert.match(settled[1].note, /a\.ts has no line 3 at HEAD/);
});

test('a calibration line is key=value, each value one word however it was written', () => {
  const root = scratchDir('blueprint-foreman-log-');
  fs.mkdirSync(path.join(root, 'docs', 'prs', KEY, 'foreman'), { recursive: true });
  const run = { key: KEY, design: `docs/prs/${KEY}/blueprint.md` };
  logLine(root, run, { reviewer: 'a reviewer\tof note', model: 'k=v', findings: 0, provider: undefined });
  assert.equal(readLog(root, run), 'reviewer=a_reviewer_of_note model=k_v findings=0 provider=-\n');
});

test("the groups are the engine's, and their findings are kept as the groups are recorded, whatever the files say after", async () => {
  const f = fixture();
  // Each Reviewer is told the slice's criteria and where the admitted design is.
  const brief = await walk(f, 'group-review');
  assert.ok(brief.includes(`the slice's criteria, greets-by-name, in the design as the run\nadmitted it (git show ${f.runState().startCommit}:docs/prs/PROJ-1/blueprint.md)`), brief);
  // Emptying the session's copy of the groups skips no Reviewer.
  f.write(`${REVIEW}/groups.json`, '[]');
  refused(await f.engine('record', KEY, 'groups'), /group-1\.findings\.json is not readable JSON \(there is no such file\)/);
  const found = { file: 'src/greet.mjs', line: 2, claim: 'no comma' };
  f.write(`${REVIEW}/group-1.findings.json`, JSON.stringify([found]));
  await ok(f, 'record', KEY, 'groups');
  // A group's findings emptied once recorded lose none.
  f.write(`${REVIEW}/group-1.findings.json`, '[]');
  f.write(`${REVIEW}/contract.json`, JSON.stringify({ verdict: 'pass', reasons: [], findings: [] }));
  assert.match(await ok(f, 'record', KEY, 'contract', 'agent-reviewer'), /step: slice-dispositions/);
  assert.deepEqual(f.runState().slice.findings, [{ ...found, source: 'group 1' }]);
});

test('a failing contract verdict spends an attempt, and what it found is carried into the next review to be judged again', async () => {
  const f = fixture();
  await walk(f, 'contract-review');
  const found = { file: 'src/greet.mjs', line: 2, claim: 'no comma' };
  f.write(`${REVIEW}/contract.json`, JSON.stringify({ verdict: 'fail', reasons: ['greets with the wrong punctuation'], findings: [found] }));
  const text = refused(await f.engine('record', KEY, 'contract', 'agent-reviewer'), /the Contract Reviewer failed the slice: greets with the wrong punctuation/);
  assert.match(text, /step: green/);
  assert.equal(f.runState().slice.budget, 2);
  assert.match(f.read(`docs/prs/${KEY}/foreman/calibration.log`), /^review=slice slice=greet-by-name attempt=1 reviewer=contract model=\S+ provider=anthropic findings=1 verdict=fail$/m);
  restore(f, text);
  // What it found stays with the slice through every attempt spent after it.
  f.write('src/greet.mjs', GREEN_CODE.replace('Hello, ', 'Yo, '));
  f.commit('green that fails', ['src/greet.mjs']);
  restore(f, refused(await f.engine('record', KEY, 'green', 'agent-green'), /"greet names the person" fails/));
  assert.match(await walk(f, 'contract-review'), /What the slice's failed reviews found is carried into this one[\s\S]*\n {2}- src\/greet\.mjs:2: no comma \(attempt 1, contract\)\n/);
  // A verdict that passes leaves it among the slice's findings, refuted with evidence or handed off.
  await walk(f, 'slice-dispositions');
  const passed = `docs/prs/${KEY}/foreman/review/greet-by-name-3`;
  assert.deepEqual(JSON.parse(f.read(`${passed}/findings.json`)), [{ ...found, source: 'contract', attempt: 1 }]);
  await walk(f, 'final');
  assert.deepEqual(JSON.parse(f.read(`${passed}/settled.json`)).map((s) => s.disposition), ['handed-off']);
});

test("the contract review judges the exhibit, and a verdict from one of the run's authors is refused", async () => {
  const f = fixture();
  await walk(f, 'contract-review');
  assert.match(await ok(f, 'wake'), new RegExp(`its exhibit \\(${GREETING}\\) against the promise that it shows the greeting greet returns for Ada \\(output\\)`));
  f.write(`${REVIEW}/contract.json`, JSON.stringify({ verdict: 'pass', reasons: [], findings: [] }));
  refused(await f.engine('record', KEY, 'contract'), /record the Contract Reviewer's agent id/);
  const mutant = f.runState().authors.find((a) => a.startsWith('agent-mutant'));
  for (const author of ['agent-red', 'agent-green', mutant]) {
    refused(await f.engine('record', KEY, 'contract', author), /the contract verdict must come from a fresh dispatch, never one the run recorded as a Red, a Green or a Mutant/);
  }
});

test('a passed slice with findings lands only once each is refuted with evidence or handed off, the run state keeping both', async () => {
  const f = fixture();
  await walk(f, 'contract-review');
  f.write(`${REVIEW}/contract.json`, JSON.stringify({ verdict: 'pass', reasons: [], findings: [{ file: 'src/greet.mjs', line: 1, claim: 'unused parameter' }] }));
  assert.match((await f.engine('record', KEY, 'contract', 'agent-reviewer')).text, /step: slice-dispositions/);
  // The run state keeps the review's findings, so findings.json deleted or emptied loses none.
  fs.rmSync(path.join(f.root, REVIEW, 'findings.json'));
  f.write(`${REVIEW}/dispositions.json`, '[]');
  refused(await f.engine('record', KEY, 'dispositions'), /findings 1 have no disposition/);
  f.write(`${REVIEW}/findings.json`, '[]');
  refused(await f.engine('record', KEY, 'dispositions'), /findings 1 have no disposition/);
  f.write(`${REVIEW}/dispositions.json`, JSON.stringify([{ finding: 1, disposition: 'refuted' }]));
  const out = await f.engine('record', KEY, 'dispositions');
  assert.equal(out.code, 0, out.text);
  const settled = JSON.parse(f.read(`${REVIEW}/settled.json`));
  assert.equal(settled[0].disposition, 'handed-off');
  // Land runs inside the record that settles the slice.
  assert.match(out.text, /step: gate/);
  assert.deepEqual(f.runState().landed, ['greet-by-name']);
  // What is handed off, the run state keeps for the pull request.
  const note = 'refuted on evidence the engine cannot find (it cites neither a file and line nor a test), so handed off';
  assert.deepEqual(f.runState().handedOff, [{ at: 'review/greet-by-name-1', cycle: 1, finding: 1, file: 'src/greet.mjs', line: 1, claim: 'unused parameter', source: 'contract', note }]);
  // And every finding settled goes into the calibration log.
  assert.match(f.read(`docs/prs/${KEY}/foreman/calibration.log`), /^finding=1 review=slice slice=greet-by-name source=contract disposition=handed-off$/m);
  exhibit('refutation-without-evidence', `$ engine record ${KEY} dispositions\n${out.text}\n\nsettled.json:\n${JSON.stringify(settled, null, 2)}`);
});

test('a refuted finding cites a line HEAD holds or a test the last proof run passed, or it is handed off', async () => {
  const f = fixture();
  const claims = ['unused parameter', 'no empty name', 'no comma', 'wrong greeting', 'no farewell', 'no module'];
  await walk(f, 'slice-dispositions', { contract: { verdict: 'pass', reasons: [], findings: claims.map((claim) => ({ file: 'src/greet.mjs', line: 1, claim })) } });
  const brief = await ok(f, 'wake');
  assert.match(brief, /a line\nHEAD holds, \{ "file": "<path>", "line": <number>, "why": "\.\.\." \}, or a test the last proof run passed, by\nits full name, \{ "test": "<name>", "why": "\.\.\." \}, one of "greet names the person"\.\nA refutation on any other evidence is handed off\./);
  f.write(`${REVIEW}/dispositions.json`, JSON.stringify([
    { finding: 1, disposition: 'refuted', evidence: { file: 'src/greet.mjs', line: 2, why: 'the parameter is used here' } },
    { finding: 2, disposition: 'refuted', evidence: { file: 'src/greet.mjs', line: 9, why: 'past the end' } },
    { finding: 3, disposition: 'refuted', evidence: { file: 'src/gone.mjs', line: 1, why: 'no such file' } },
    { finding: 4, disposition: 'refuted', evidence: { test: 'greet names the person', why: 'it asserts the greeting' } },
    { finding: 5, disposition: 'refuted', evidence: { test: 'farewell names the person', why: 'not in the proof run' } },
    { finding: 6, disposition: 'refuted', evidence: { file: 'src', line: 1, why: 'a directory is no file' } },
  ]));
  await ok(f, 'record', KEY, 'dispositions');
  const settled = JSON.parse(f.read(`${REVIEW}/settled.json`));
  assert.deepEqual(settled.map((s) => s.disposition), ['refuted', 'handed-off', 'handed-off', 'refuted', 'handed-off', 'handed-off']);
  assert.match(settled[1].note, /src\/greet\.mjs has no line 9 at HEAD/);
  assert.match(settled[2].note, /HEAD holds no file src\/gone\.mjs/);
  assert.match(settled[4].note, /the last proof run passed no test named "farewell names the person"/);
  assert.match(settled[5].note, /HEAD holds no file src\b/);
});

test('findings and dispositions not in their one form are refused', async () => {
  const f = fixture();
  await walk(f, 'group-review');
  const group = `${REVIEW}/group-1.findings.json`;
  const groups = async () => f.engine('record', KEY, 'groups');
  refused(await groups(), new RegExp(`docs/prs/${KEY}/foreman/review/greet-by-name-1/group-1\\.findings\\.json is not readable JSON \\(there is no such file\\)`));
  f.write(group, '[{');
  refused(await groups(), /group-1\.findings\.json is not readable JSON \(/);
  f.write(group, JSON.stringify({ findings: [] }));
  refused(await groups(), /group 1's findings must be a list, possibly empty: \[ \{ "file": "<path>", "line": <number>, "claim": "<what is wrong and why>" \} \]/);
  f.write(group, JSON.stringify([{ file: 'src/greet.mjs', claim: 'no line' }, { file: 'src/greet.mjs', line: 1 }]));
  const text = refused(await groups(), /group 1's findings: finding 1 must cite a file and a line/);
  assert.match(text, /group 1's findings: finding 2 needs a "claim"/);
  f.write(group, '[]');
  await ok(f, 'record', KEY, 'groups');
  const contract = (verdict) => {
    f.write(`${REVIEW}/contract.json`, JSON.stringify(verdict));
    return f.engine('record', KEY, 'contract', 'agent-reviewer');
  };
  refused(await contract({ findings: [] }), /contract\.json needs "verdict": "pass" or "fail"/);
  refused(await contract({ verdict: 'pass', reasons: [] }), /contract\.json's findings must be a list, possibly empty/);
  refused(await contract({ verdict: 'pass', reasons: [], findings: [{ claim: 'nowhere' }] }), /contract\.json's findings: finding 1 must cite a file and a line/);
  assert.equal(f.runState().step, 'contract-review', 'no refusal moved the run');
  assert.equal((await contract({ verdict: 'pass', reasons: [], findings: [{ file: 'src/greet.mjs', line: 1, claim: 'unused parameter' }] })).code, 0);
  const dispositions = (text) => {
    f.write(`${REVIEW}/dispositions.json`, text);
    return f.engine('record', KEY, 'dispositions');
  };
  refused(await dispositions('{'), /dispositions\.json is not readable JSON/);
  refused(await dispositions(JSON.stringify({ finding: 1, disposition: 'handed-off' })), /dispositions\.json must be a list of dispositions, \[ \{ "finding"/);
  refused(await dispositions(JSON.stringify([{ finding: 1, disposition: 'ignored' }])), /findings 1 have no disposition/);
  // A disposition naming no finding is refused, not passed over.
  const strays = [{ finding: 1, disposition: 'handed-off' }, { finding: 2, disposition: 'refuted' }, { disposition: 'handed-off' }];
  refused(await dispositions(JSON.stringify(strays)), /dispositions\.json names no finding by "finding": 2, "finding": null; the findings are numbered 1 to 1/);
  refused(await dispositions(JSON.stringify([{ finding: 1, disposition: 'fixed' }])), /a passed slice fixes nothing more; refute with evidence or hand off/);
  assert.equal(f.runState().step, 'slice-dispositions', 'no refusal moved the run');
  assert.equal((await dispositions(JSON.stringify([{ finding: 1, disposition: 'handed-off' }]))).code, 0);
});

test("the engine's own findings stand: a refutation of convergence's, or of an unmet verdict, is handed off", async () => {
  const design = DESIGN.replace(GREET_ROW, `${GREET_ROW}${proposes('function', 'farewell', 'greet_fn_farewell')}`);
  const f = fixture({ scaffold: true, design });
  await walk(f, 'red', { slices: [SCAFFOLDED] });
  await walk(f, 'final', { green: { 'src/greet.mjs': FILLED.replace('`Hello, ${name}`;', '`Hello, ${name}`; // TODO(scaffold): the greeting') } });
  const { convergence } = f.runState();
  assert.equal(convergence.findings.length, 2, 'a row unrealized and a gap still open');
  f.write(`${FINAL}/findings.json`, JSON.stringify([{ file: 'src/greet.mjs', line: 2, claim: 'the greeting may not name the person' }]));
  f.write(`${FINAL}/contract.json`, JSON.stringify({ verdicts: { 'greets-by-name': { met: false, evidence: 'the gap is open' } }, findings: [] }));
  assert.match(await ok(f, 'record', KEY, 'gate', 'agent-reviewer'), /A finding the engine raised itself, its "source" "convergence" or "verdict", is fixed or handed off: a refutation of it is handed off\./);
  // One refutation, on a line HEAD holds, answers the Adversary's finding and none of the engine's.
  const evidence = { file: 'README.md', line: 1, why: 'not so' };
  f.write(`${FINAL}/dispositions.json`, JSON.stringify([1, 2, 3, 4].map((finding) => ({ finding, disposition: 'refuted', evidence }))));
  assert.match(await ok(f, 'record', KEY, 'dispositions'), /step: settle/);
  const own = 'refuted, but the engine raised it itself, so handed off';
  assert.deepEqual(JSON.parse(f.read(`${FINAL}/settled.json`)).map((s) => [s.disposition, s.note]), [['refuted', undefined], ['handed-off', own], ['handed-off', own], ['handed-off', own]]);
  assert.deepEqual(f.runState().handedOff.map((h) => h.claim), ['the Contract Reviewer finds criterion "greets-by-name" unmet: the gap is open', ...convergence.findings.map((x) => x.claim)]);
});

test("the slice's Contract Reviewer is handed the engine's lock, rule and lines, so it cannot hold a comment the engine does not", async () => {
  const f = fixture({ scaffold: true });
  // Green fills the gap and rewords the scaffold's comment, which in a script is not locked.
  const brief = await walk(f, 'contract-review', { slices: [SCAFFOLDED], green: { 'src/greet.mjs': FILLED.replace('as the scaffold placed it', 'reworded by Green') } });
  assert.ok(brief.includes(`The locks are the engine's, which held this change to them before review: ${LOCK_RULE}`), brief);
  assert.ok(brief.includes(`${REVIEW}/locked.json, and a line not there is not locked. It raises no lock break of its own.`), brief);
  // The scaffold's code lines are locked; its comment and its gap are not.
  assert.deepEqual(JSON.parse(f.read(`${REVIEW}/locked.json`)), { rule: LOCK_RULE, scaffold: ['src/greet.mjs:2', 'src/greet.mjs:4'] });
  assert.match(LOCK_RULE, /In a script a comment is never locked\./);
  // Red and Green are told the same rule.
  assert.ok(f.read(`docs/prs/${KEY}/foreman/briefs/greet-by-name-green-1.md`).includes(LOCK_RULE));
});
