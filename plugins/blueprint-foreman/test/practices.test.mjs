// Offline tests for the practices a fire's payload may turn off, each a stage the engine skips, and for
// the foundation every run holds whatever they are: `node --test
// plugins/blueprint-foreman/test/practices.test.mjs`; their fixture is fixture.mjs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PRACTICES, practicesOf } from '../lib/payload.mjs';
import { checkApproval, checkPlan } from '../lib/plan.mjs';
import { readLog } from '../lib/review.mjs';
import { DESIGN, FAREWELL, FAREWELL_CODE, FAREWELL_TEST, FILLED, GREEN_CODE, KEY, MUTANTS, NOTES, SCAFFOLD, SLICE, SUITES, TEST_FILE, commitRun, fitted, fixture, mergeDefault, notesFor, ok, refused, restore, settled, walk, answer, fire, GREET_ROW, proposes } from './fixture.mjs';

const OFF = Object.fromEntries(PRACTICES.map((p) => [p, false]));
const BODY = `docs/prs/${KEY}/pull-request.md`;
const NOTES_FILE = `docs/prs/${KEY}/foreman/pr-notes.md`;
const REVIEW = `docs/prs/${KEY}/foreman/review/greet-by-name-1`;
const steps = (run) => run.history.map((h) => h.step);

// Each stage a practice runs: the practices it runs under, and whether a settled run shows it ran.
const STAGES = [
  ['the plan gate', (on) => on.slices && on.adversary, (run) => run.rounds.some((r) => r.gate === 'plan')],
  ['red and green', (on) => on['red-green'], (run) => steps(run).includes('red') && steps(run).includes('green')],
  ['the Builder', (on) => !on['red-green'], (run) => steps(run).includes('builder')],
  ['the mutant', (on) => on.mutant, (run) => steps(run).includes('mutant')],
  ['review', (on) => on.review, (run, body) => steps(run).includes('group-review') && steps(run).includes('contract-review') && run.rounds.some((r) => r.verdicts) && !/not reviewed/.test(body)],
  ['the Adversary', (on) => on.adversary, (run) => run.rounds.length > 0 && run.rounds.every((r) => r.adversary)],
  ['the exhibits', (on) => on.exhibits, (run, body, f) => Object.values(run.exhibits).flat().length > 0 && /\n## Exhibits\n/.test(body) && fs.existsSync(path.join(f.root, `docs/prs/${KEY}/foreman/exhibits`, SLICE.id))],
  ['the lessons', (on) => on.lessons, (run, body) => /\n## Lessons\n/.test(body)],
];

// Each stage ran in the settled run in `f` exactly where its practices hold it.
function stagesHeld(f) {
  const run = f.runState();
  assert.equal(run.step, 'settled');
  const body = f.read(BODY);
  for (const [stage, runs, shown] of STAGES) assert.equal(shown(run, body, f), runs(run.practices), `${stage}: ${steps(run).join(', ')}`);
  return { run, body };
}

test('a payload naming the branch alone runs every practice', async () => {
  const f = fixture();
  await settled(f);
  const { run } = stagesHeld(f);
  assert.deepEqual(run.practices, practicesOf());
  assert.deepEqual(steps(run), ['plan', 'gate', 'red', 'green', 'mutant', 'group-review', 'contract-review', 'gate', 'settle']);
});

for (const practice of PRACTICES) {
  test(`with ${practice} off, its stage never runs and the run settles`, async () => {
    const f = fixture({ practices: { [practice]: false } });
    await settled(f);
    const { body } = stagesHeld(f);
    assert.ok(body.includes(`Turned off: ${practice}.`), body);
  });
}

test('with every practice off, one Builder fills the gaps, the engine holds the foundation, and the run settles', async () => {
  const f = fixture({ scaffold: true, practices: OFF });
  const admitted = await ok(f, 'wake');
  assert.match(admitted, /single vertical slice, delivering every acceptance criterion/);
  assert.doesNotMatch(admitted, /expectFail|"stubs"|"mutant"|"exhibit"|"substitute"/);
  const built = await walk(f, 'builder', { commit: true });
  assert.match(built, /Dispatch a fresh Builder subagent \(model claude-sonnet-5-5\)/);
  const brief = f.read(`docs/prs/${KEY}/foreman/briefs/greet-by-name-builder-1.md`);
  assert.match(brief, /change only lines carrying TODO\(scaffold\)[\s\S]*Write the slice's code and its tests together/);
  assert.doesNotMatch(brief, /Exhibit:/);
  const out = await walk(f, 'settle', { commit: true });
  // The replays, the landing, the final run and the final gate's round all ran inside the Builder's record.
  assert.match(out, /recorded builder[\s\S]*step: settle/);
  const run = f.runState();
  assert.deepEqual(steps(run), ['plan', 'builder']);
  assert.deepEqual(run.landed, ['greet-by-name']);
  assert.deepEqual(run.convergence.findings, []);
  assert.equal(JSON.parse(f.read(`${REVIEW}/replay.json`)).greenReplay, 'passed');
  assert.deepEqual(run.rounds, [{ at: 'gates/final-c1-r1', gate: 'final', cycle: 1, round: 1, adversary: null }]);
  assert.match(readLog(f.root, f.runState()), /^gate=final cycle=1 round=1 reviewer=engine model=- provider=- findings=0$/m);
  assert.match(out, /holding these sections \(## headings\) and nothing else:\n {2}## Decisions: [^\n]+\n {2}## Deferrals: [^\n]+\nThe engine joins them with its own, ## Criteria, ## Practices, ## Gates and ## Handed-off findings/);
  f.write(NOTES_FILE, notesFor(OFF));
  await ok(f, 'record', KEY, 'notes');
  assert.equal(
    f.read(BODY),
    `## Decisions

None beyond the plan.

## Deferrals

None.

## Criteria

- \`greets-by-name\`: not reviewed, the review practice being off

## Practices

Ran: none. Turned off: slices, red-green, mutant, review, adversary, exhibits, lessons.

## Gates

- final gate, cycle 1, round 1: no Adversary, the adversary practice being off

## Handed-off findings

None.
`,
  );
});

// A Builder's try with every practice off: greet's test and `files`, committed and recorded.
async function build(f, files, agent = 'agent-builder') {
  const all = { 'test/greet.test.mjs': TEST_FILE, ...files };
  for (const [file, text] of Object.entries(all)) f.write(file, text);
  f.commit('a build', Object.keys(all));
  return f.engine('record', KEY, 'builder', agent);
}

test('with every practice off, a Builder that breaks the lock, touches a protected path or leaves a test failing spends an attempt, and an empty budget stops the run', async () => {
  const f = fixture({ scaffold: true, practices: OFF });
  await walk(f, 'builder');
  const { base } = f.runState().slice;
  // The Builder must change something, and be named; neither refusal is a try.
  refused(await f.engine('record', KEY, 'builder', 'agent-builder'), /nothing was committed since/);
  refused(await build(f, { 'src/greet.mjs': FILLED }, ''), /record the Builder dispatch's agent id/);
  assert.equal(f.runState().slice.budget, 3);
  const renamed = FILLED.replace('greet(name)', 'greet(person)').replace('${name}', '${person}');
  restore(f, refused(await build(f, { 'src/greet.mjs': renamed }), /the scaffold line "export function greet\(name\) \{" \(line 2 at the scaffold\) was changed, removed, commented out or quoted[\s\S]*this spends an attempt \(2 left\)[\s\S]*step: builder/));
  assert.equal(f.sh('rev-parse', 'HEAD^{tree}'), f.sh('rev-parse', `${base}^{tree}`), 'the code is back at the slice base');
  restore(f, refused(await build(f, { 'src/greet.mjs': FILLED, '.gitattributes': '* -diff\n' }), /no step may change a protected path: \.gitattributes[\s\S]*this spends an attempt \(1 left\)/));
  const stopped = refused(await build(f, { 'src/greet.mjs': FILLED.replace('Hello, ', 'Hi, ') }), /"greet names the person" fails[\s\S]*slice "greet-by-name" has used all its attempts, and the run stops[\s\S]*step: stopped/);
  restore(f, stopped);
  const run = f.runState();
  assert.deepEqual([run.step, run.stop.kind, run.stop.from, run.slice.budget], ['stopped', 'budget', 'builder', 0]);
  assert.deepEqual(run.authors, ['agent-builder']);
  assert.match(f.read(`docs/prs/${KEY}/foreman/briefs/greet-by-name-builder-3.md`), /Attempt 2 was spent, and the code restored, because:\n {2}- no step may change a protected path/);
});

test("with every practice off, a later slice may not touch or break what landed, which spends the Builder's attempt, and a fix adds one slice at a time", async () => {
  // The design proposes a farewell the first slice leaves out, so the final run finds it missing, and a
  // slice fixes it.
  const f = fixture({ design: DESIGN.replace(GREET_ROW, `${GREET_ROW}${proposes('function', 'farewell', 'greet_fn_farewell')}`), practices: OFF });
  await walk(f, 'gate-dispositions', { commit: true });
  const [landed] = f.runState().plan.slices;
  const farewell = { ...fitted(FAREWELL, OFF), dependsOn: [] };
  const plan = (slices) => {
    f.write(`docs/prs/${KEY}/foreman/plan.json`, JSON.stringify({ slices }));
    f.write(`docs/prs/${KEY}/foreman/gates/final-c1-r1/dispositions.json`, JSON.stringify([{ finding: 1, disposition: 'fixed', criterion: 'greets-by-name' }]));
    return f.engine('record', KEY, 'dispositions');
  };
  refused(await plan([landed, farewell, { ...farewell, id: 'wave' }]), /the slices practice is off, so the plan adds one slice to those that landed, not 2: "say-farewell", "wave"/);
  refused(await plan([landed, { ...farewell, dependsOn: ['greet-by-name'] }]), /slice "say-farewell" depends on another, and with the slices practice off no slice does/);
  const planned = await plan([landed, farewell]);
  assert.equal(planned.code, 0, planned.text);
  assert.match(planned.text, /step: builder/);
  commitRun(f);
  const farewells = { 'test/farewell.test.mjs': FAREWELL_TEST, 'src/farewell.mjs': FAREWELL_CODE };
  const tryBuild = async (files, pattern) => {
    for (const [file, text] of Object.entries({ ...farewells, ...files })) f.write(file, text);
    f.commit('a farewell build', Object.keys({ ...farewells, ...files }));
    restore(f, refused(await f.engine('record', KEY, 'builder', 'agent-builder-2'), pattern));
  };
  await tryBuild({ 'test/greet.test.mjs': TEST_FILE.replace("'Hello, Ada'", "said") }, /outside what this step may change: test\/greet\.test\.mjs[\s\S]*this spends an attempt \(2 left\)/);
  await tryBuild({ 'src/greet.mjs': FILLED.replace('Hello, ', 'Hi, ') }, /refused\n {2}- what landed \(greet-by-name\) no longer passes: "greet names the person" no longer passes \(failed\)[\s\S]*this spends an attempt \(1 left\)/);
  await walk(f, 'settle');
  assert.deepEqual(f.runState().landed, ['greet-by-name', 'say-farewell']);
});

test("with every practice off, a gap left open, a convergence miss and a regressed whole suite reach the final gate as the engine's findings, fixed by a slice or handed off, never refuted", async () => {
  const wave = proposes('function', 'wave', 'greet_fn_wave');
  const design = DESIGN.replace(GREET_ROW, `${GREET_ROW}${wave}`);
  const all = 'node run-tests.mjs {report} test/*.test.mjs';
  const f = fixture({ scaffold: true, design, practices: OFF, suites: { ...SUITES, node: { ...SUITES.node, all } } });
  f.write('src/shout.mjs', 'export const shout = (s) => s.toUpperCase();\n');
  f.write('test/shout.test.mjs', "import assert from 'node:assert/strict';\nimport { shout } from '../src/shout.mjs';\nexport const tests = [{ name: 'shout uppercases', fn: () => assert.equal(shout('a'), 'A') }];\n");
  f.commit('an existing test no slice names', ['src/shout.mjs', 'test/shout.test.mjs']);
  await walk(f, 'builder', { commit: true });
  // A proof run with no test in it is not accepted, nor a build whose tests pass only in the session's
  // checkout, by a file the repository ignores, which the replay's scratch checkout lacks.
  restore(f, refused(await build(f, { 'test/greet.test.mjs': 'export const tests = [];\n', 'src/greet.mjs': FILLED }), /refused\n {2}- the suite ran no tests[\s\S]*this spends an attempt \(2 left\)/));
  f.write('.blueprint/keep', 'x');
  const kept = "import fs from 'node:fs';\n// greet, as the scaffold placed it.\nexport function greet(name) {\n  if (fs.existsSync('.blueprint/keep')) return `Hello, ${name}`;\n  return ''; // TODO(scaffold): the greeting\n}\n";
  restore(f, refused(await build(f, { 'src/greet.mjs': kept }), /green replay: "greet names the person" fails[\s\S]*this spends an attempt \(1 left\)[\s\S]*step: builder/));
  // The Builder passes its tests around the gap, and breaks a test no slice names.
  const around = SCAFFOLD.replace("  return '';", '  if (name) return `Hello, ${name}`;\n  return \'\';');
  const out = await build(f, { 'src/greet.mjs': around, 'src/shout.mjs': 'export const shout = (s) => s;\n' });
  assert.equal(out.code, 0, out.text);
  assert.match(out.text, /step: gate-dispositions/);
  commitRun(f);
  const round = `docs/prs/${KEY}/foreman/gates/final-c1-r1`;
  const findings = JSON.parse(f.read(`${round}/findings.json`));
  const claims = findings.map((x) => `${x.file}:${x.line}: ${x.claim} (${x.source})`);
  const missed = `docs/prs/${KEY}/blueprint.md:${design.split('\n').indexOf(wave.trim()) + 1}: greet_fn_wave is not in the extracted graph, so the code does not realize this propose (convergence)`;
  const gap = "src/greet.mjs:4: a scaffold gap is still open: return ''; // TODO(scaffold): the greeting (convergence)";
  const regressed = '.blueprint-foreman.json:1: the whole of suite "node" passed a test at the admitted commit that it does not at HEAD: "shout uppercases" no longer passes (failed) (convergence)';
  assert.deepEqual(claims, [missed, gap, regressed]);
  assert.match(out.text, /A finding the engine raised itself, its "source" "convergence" or "verdict", is fixed or handed off/);
  // Round 1 fixes the gap by a new slice, and refutes the rest, which the engine hands off.
  const refute = (finding) => ({ finding, disposition: 'refuted', evidence: { file: 'src/greet.mjs', line: 1, why: 'it is fine' } });
  f.write(`${round}/dispositions.json`, JSON.stringify([refute(1), { finding: 2, disposition: 'fixed' }, refute(3)]));
  const nobody = { id: 'greet-nobody', outcome: 'greet greets nobody', criteria: ['greets-by-name'], dependsOn: [], complexity: 'contained', test: { suite: 'node', files: ['test/nobody.test.mjs'] }, frozen: ['test/nobody.test.mjs'] };
  f.write(`docs/prs/${KEY}/foreman/plan.json`, JSON.stringify({ slices: [...f.runState().plan.slices, nobody] }));
  assert.match(await ok(f, 'record', KEY, 'dispositions'), /step: builder/);
  commitRun(f);
  const settledRound = JSON.parse(f.read(`${round}/settled.json`));
  assert.deepEqual(settledRound.map((s) => [s.disposition, s.note]), [['handed-off', 'refuted, but the engine raised it itself, so handed off'], ['fixed', undefined], ['handed-off', 'refuted, but the engine raised it itself, so handed off']]);
  const filled = SCAFFOLD.replace("  return ''; // TODO(scaffold): the greeting", "  if (name) return `Hello, ${name}`;\n  return 'Hello, nobody';");
  f.write('test/nobody.test.mjs', "import assert from 'node:assert/strict';\nimport { greet } from '../src/greet.mjs';\nexport const tests = [{ name: 'greet greets nobody', fn: () => assert.equal(greet(''), 'Hello, nobody') }];\n");
  f.write('src/greet.mjs', filled);
  f.commit('fill the gap', ['test/nobody.test.mjs', 'src/greet.mjs']);
  // The fix slice lands before the confirming round, which confirms and fixes nothing.
  assert.match(await ok(f, 'record', KEY, 'builder', 'agent-builder-2'), /step: gate-dispositions/);
  commitRun(f);
  const second = `docs/prs/${KEY}/foreman/gates/final-c1-r2`;
  assert.deepEqual(JSON.parse(f.read(`${second}/findings.json`)).map((x) => `${x.file}:${x.line}: ${x.claim} (${x.source})`), [missed, regressed]);
  f.write(`${second}/dispositions.json`, JSON.stringify([{ finding: 1, disposition: 'fixed' }, refute(2)]));
  refused(await f.engine('record', KEY, 'dispositions'), /the confirming round fixes nothing; refute with evidence or hand off/);
  f.write(`${second}/dispositions.json`, JSON.stringify([refute(1), refute(2)]));
  assert.match(await ok(f, 'record', KEY, 'dispositions'), /step: settle/);
  commitRun(f);
  f.write(NOTES_FILE, notesFor(OFF));
  await ok(f, 'record', KEY, 'notes');
  const body = f.read(BODY);
  assert.match(body, /## Gates\n\n- final gate, cycle 1, round 1: no Adversary, the adversary practice being off\n {2}- fixed #2, src\/greet\.mjs:4: a scaffold gap is still open: [^\n]+\n- final gate, cycle 1, round 2: no Adversary, the adversary practice being off\n/);
  assert.match(body, /## Handed-off findings\n\n- gates\/final-c1-r1 #1, [^\n]+greet_fn_wave is not in the extracted graph[^\n]+\(refuted, but the engine raised it itself, so handed off\)\n- gates\/final-c1-r1 #3, [^\n]+"shout uppercases" no longer passes[^\n]+\n$/);
});

test("with red-green off and mutant on, the Mutant judges the Builder's tests, may not be the Builder, and two survivors spend the Builder's attempt", async () => {
  const f = fixture({ practices: { 'red-green': false } });
  await walk(f, 'builder');
  const { base } = f.runState().slice;
  // The exhibit the slice promises is the Builder's tests' to write.
  const silent = TEST_FILE.replace(/ {2}if \(process\.env\.BLUEPRINT_FOREMAN_EXHIBITS\)[^\n]*\n/, '');
  restore(f, refused(await build(f, { 'test/greet.test.mjs': silent, 'src/greet.mjs': FILLED }), /promises an exhibit \(the greeting greet returns for Ada\), but its proof run wrote nothing to \$BLUEPRINT_FOREMAN_EXHIBITS; its tests must produce it[\s\S]*this spends an attempt \(2 left\)[\s\S]*step: builder/));
  const text = await walk(f, 'mutant');
  assert.match(text, /fresh Mutant subagent[^\n]*none of the run's Builder or Mutant subagents/);
  const at = `docs/prs/${KEY}/foreman/review/greet-by-name-2`;
  const mutant = (edit, agent) => {
    f.write(`${at}/mutant.json`, JSON.stringify(edit));
    return f.engine('record', KEY, 'mutant', agent);
  };
  const noOp = { file: 'src/greet.mjs', find: 'return', replace: 'return /* mutant */' };
  refused(await mutant(noOp, 'agent-builder'), /the mutant must come from a fresh dispatch, never one the run recorded as a Builder or a Mutant, as it did agent-builder/);
  const first = await mutant(noOp, 'agent-mutant-a');
  assert.equal(first.code, 0, first.text);
  assert.match(first.text, /survived the tests[\s\S]*if it survives too, the slice goes back to the Builder\./);
  const spent = refused(await mutant({ file: 'src/greet.mjs', find: '(name) {', replace: '(name)  {' }, 'agent-mutant-b'), /the second mutant [^\n]+ survived, as the first did[\s\S]*this spends an attempt \(1 left\)[\s\S]*step: builder/);
  restore(f, spent);
  const run = f.runState();
  assert.deepEqual([run.slice.spent.to, run.accepted], ['builder', base]);
  await walk(f, 'group-review');
  const replay = JSON.parse(f.read(`docs/prs/${KEY}/foreman/review/greet-by-name-3/replay.json`));
  assert.deepEqual([replay.redCommit, replay.redReplay, replay.mutant.outcome], [undefined, 'n/a: the Builder wrote the tests with the code', 'killed']);
});

test('with review off, a slice lands once its replays pass, its findings and the rows convergence hands on going to the description unreviewed', async () => {
  const card = proposes('ui', 'greeting card', 'greet_ui_greeting-card');
  const design = DESIGN.replace(GREET_ROW, `${GREET_ROW}${card}`);
  const f = fixture({ design, practices: { review: false } });
  await walk(f, 'mutant');
  f.write(`${REVIEW}/mutant.json`, JSON.stringify({ file: 'src/greet.mjs', find: 'return', replace: 'return /* mutant */' }));
  await ok(f, 'record', KEY, 'mutant', 'agent-mutant-a');
  f.write(`${REVIEW}/mutant.json`, JSON.stringify(MUTANTS['greet-by-name']));
  const landed = await ok(f, 'record', KEY, 'mutant', 'agent-mutant-b');
  // The killed second lands the slice in the same record, with the first a finding no review settles.
  assert.match(landed, /step: gate[\s\S]*With the review practice off, no Contract Reviewer judges the event model rows the graph cannot show: the pull request's description hands each on as unverified\.\n {2}- greet_ui_greeting-card \(docs\/prs\/PROJ-1\/blueprint\.md:\d+\): the extractor does not emit its type, ui\n/);
  assert.match(landed, /When done, record it: node \S+ record PROJ-1 gate\n/);
  assert.deepEqual(f.runState().landed, ['greet-by-name']);
  await settled(f);
  const body = f.read(BODY);
  const row = design.split('\n').indexOf(card.trim()) + 1;
  assert.match(body, /## Criteria\n\n- `greets-by-name`: not reviewed, the review practice being off\n/);
  assert.ok(body.includes(`- review/greet-by-name-1 #1, src/greet.mjs:2: the mutant "return" became "return /* mutant */" in src/greet.mjs survived the tests and another of the same behaviour did not, so it is likely equivalent to the code; if it is not, the tests do not pin what it changes (unreviewed: the review practice is off)\n`), body);
  assert.ok(body.includes(`- gates/final-c1-r1, docs/prs/${KEY}/blueprint.md:${row}: convergence hands on the row "greet_ui_greeting-card" by name: the extractor does not emit its type, ui (unverified: the review practice is off)\n`), body);
});

test("with mutant off, the replays run inside green's record, the red replay among them", async () => {
  const f = fixture({ practices: { mutant: false } });
  await walk(f, 'green');
  const { git } = f.ctx;
  const { redCommit } = f.runState().slice;
  f.write('src/greet.mjs', GREEN_CODE);
  f.commit('green', ['src/greet.mjs']);
  const greenCommit = f.sh('rev-parse', 'HEAD');
  // A scratch checkout that gets green's code where red's was asked for stands in for a red that only
  // failed in the session's checkout.
  f.ctx.git = { ...git, checkoutIn: (dir, commit, file) => git.checkoutIn(dir, !file && commit === redCommit ? greenCommit : commit, file) };
  restore(f, refused(await f.engine('record', KEY, 'green', 'agent-green'), /red replay: "greet names the person" did not fail \(passed\)[\s\S]*this spends an attempt \(2 left\)[\s\S]*step: red/));
  f.ctx.git = git;
  assert.match(await walk(f, 'group-review'), /recorded green[\s\S]*step: group-review/);
  assert.equal(JSON.parse(f.read(`docs/prs/${KEY}/foreman/review/greet-by-name-2/replay.json`)).redReplay, 'failed on the named assertions');
});

test('with exhibits off, no plan promises an exhibit, no proof run keeps one, settle requires none, and the description has no Exhibits section', async () => {
  const f = fixture({ practices: { exhibits: false } });
  const planning = await walk(f, 'plan');
  assert.doesNotMatch(planning, /promises an exhibit|"exhibit"/);
  f.write(`docs/prs/${KEY}/foreman/plan.json`, JSON.stringify({ slices: [SLICE] }));
  refused(await f.engine('record', KEY, 'plan'), /slice "greet-by-name" declares "exhibit", which only the exhibits practice reads, and the run has it off/);
  const final = await walk(f, 'final');
  assert.doesNotMatch(final, /each slice's exhibits/);
  await walk(f, 'settle');
  commitRun(f);
  assert.equal(fs.existsSync(path.join(f.root, `docs/prs/${KEY}/foreman/exhibits/greet-by-name`)), false);
  // What no proof run wrote has no place under exhibits/, whatever the practices.
  f.write(`docs/prs/${KEY}/foreman/exhibits/greet-by-name/late.txt`, 'written by hand');
  f.write(NOTES_FILE, NOTES);
  refused(await f.engine('record', KEY, 'notes'), /docs\/prs\/PROJ-1\/foreman\/exhibits\/greet-by-name\/late\.txt is not an exhibit any accepted proof run wrote/);
  fs.rmSync(path.join(f.root, `docs/prs/${KEY}/foreman/exhibits`), { recursive: true });
  await ok(f, 'record', KEY, 'notes');
  assert.doesNotMatch(f.read(BODY), /## Exhibits/);
});

test('with lessons off, settle names no lesson home and takes no lessons commit, and pr-notes.md holds no Lessons', async () => {
  const f = fixture({ practices: { lessons: false } });
  const settle = await walk(f, 'settle');
  assert.match(settle, /The lessons practice is off, so the branch takes no lessons commit: nothing changes from here\./);
  assert.doesNotMatch(settle, /lesson homes|## Lessons/);
  commitRun(f);
  f.write('CLAUDE.md', '# conventions\n\nA lesson.\n');
  f.commit('a lesson', ['CLAUDE.md']);
  f.write(NOTES_FILE, notesFor({ lessons: false }));
  restore(f, refused(await f.engine('record', KEY, 'notes'), /outside what this step may change: CLAUDE\.md/));
  f.write(NOTES_FILE, NOTES);
  refused(await f.engine('record', KEY, 'notes'), /pr-notes\.md holds "## Lessons", but only "## Decisions", "## Deferrals": the engine writes the rest of the description/);
  f.write(NOTES_FILE, notesFor({ lessons: false }));
  await ok(f, 'record', KEY, 'notes');
  assert.doesNotMatch(f.read(BODY), /## Lessons/);
  assert.match(f.read(BODY), /\n## Handed-off findings\n\nNone\.\n$/);
});

test("a plan declares none of the fields only a practice the run has off reads, and with slices off one slice beyond those that landed", () => {
  const keys = ['greets-by-name'];
  const suites = SUITES;
  const problems = (plan, on) => checkPlan(plan, keys, suites, [], { ...practicesOf(), ...on }).join('\n');
  const builder = fitted(SLICE, { 'red-green': false, mutant: true, exhibits: true });
  assert.equal(problems({ slices: [builder] }, { 'red-green': false }), '');
  const declared = problems({ slices: [{ ...SLICE, substitute: { broken: { file: 'src/greet.mjs', find: 'a', replace: 'b' }, reason: 'r' } }] }, { 'red-green': false, mutant: false, exhibits: false });
  for (const field of ['test.expectFail', 'stubs', 'substitute']) assert.match(declared, new RegExp(`declares "${field.replace('.', '\\.')}", which only the red-green practice reads`));
  assert.match(declared, /declares "mutant", which only the mutant practice reads[\s\S]*declares "exhibit", which only the exhibits practice reads/);
  assert.doesNotMatch(declared, /must name the tests that fail at red|substitute needs|cannot both freeze/);
  // A practice on still asks for its fields, whatever else is off.
  assert.match(problems({ slices: [{ ...builder, mutant: undefined }] }, { 'red-green': false }), /needs "mutant": \{ "breaks"/);
  assert.match(problems({ slices: [{ ...SLICE, exhibit: { none: 'nothing' } }] }, {}), /no slice promises an exhibit/);
  assert.equal(problems({ slices: [fitted(SLICE, { ...practicesOf(), exhibits: false })] }, { exhibits: false }), '');
  // With slices off, the plan adds one slice to those that landed, and none depends on another.
  const run = { practices: { ...practicesOf(), slices: false }, adapters: { suites }, protect: [], landed: [] };
  assert.deepEqual(checkApproval({ slices: [SLICE] }, run, keys), []);
  assert.match(checkApproval({ slices: [SLICE, FAREWELL] }, run, keys).join('\n'), /the slices practice is off, so the plan adds one slice to those that landed, not 2: "greet-by-name", "say-farewell"[\s\S]*slice "say-farewell" depends on another/);
  assert.deepEqual(checkApproval({ slices: [SLICE, { ...FAREWELL, dependsOn: [] }] }, { ...run, landed: ['greet-by-name'], plan: { slices: [SLICE] } }, keys), []);
});

test('with every practice off, a merge taken in at rest moves the Builder\'s base, and one at settle closes the final gate again on the merged code', async () => {
  const f = fixture({ practices: OFF });
  await walk(f, 'builder');
  await ok(f, 'record', KEY, 'need', 'the greeting to build');
  commitRun(f);
  mergeDefault(f);
  answer(f, 'Hello, Ada.');
  assert.match(await ok(f, 'wake'), /resumed from stop 1[\s\S]*step: builder/);
  assert.equal(f.runState().slice.base, f.sh('rev-parse', 'HEAD'));
  commitRun(f);
  await walk(f, 'settle', { commit: true });
  await ok(f, 'record', KEY, 'need', 'a word with the team');
  commitRun(f);
  const merge = mergeDefault(f, { VERSION: '3\n' });
  answer(f, 'Go on.');
  assert.match(await ok(f, 'wake'), /Merge [0-9a-f]+ came in at settle, so the final gate opens again at its first round, on the merged code\.[\s\S]*step: settle/);
  const run = f.runState();
  assert.deepEqual(run.rounds.at(-1), { at: `gates/final-c1-merge-${merge.slice(0, 12)}-r1`, gate: 'final', cycle: 1, round: 1, merge, adversary: null });
  assert.equal(run.accepted, f.sh('rev-parse', 'HEAD'));
  assert.match(readLog(f.root, f.runState()), new RegExp(`gate=final cycle=1 round=1 reviewer=engine model=- provider=- findings=0\\n$`));
});
