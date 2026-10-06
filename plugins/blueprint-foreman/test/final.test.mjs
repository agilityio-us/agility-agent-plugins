// Offline tests for the final gate's own run, in one scratch checkout of HEAD as the last slice lands
// and again after a merge taken in at the final gate or settle: every landed slice's tests again, the
// exhibits written again, the locks, and the whole suites held to what they passed at the admitted
// commit; and the engine's temporary directories: `node --test plugins/blueprint-foreman/test/final.test.mjs`;
// their fixture is fixture.mjs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { convergeIn } from '../lib/convergence.mjs';
import { run } from '../lib/wake.mjs';
import { KEY, BRANCH, TEST_FILE, SLICE, FAREWELL, FAREWELL_CODE, GREEN_CODE, NOTES, SCAFFOLD, SCAFFOLDED, SUITES, allMet, commitRun, fixture, mergeDefault, ok, scratchDir, walk, GREETING, answer } from './fixture.mjs';

test('the final gate runs every landed test again at HEAD and writes the exhibits again, so none shows what a later slice changed', async () => {
  const f = fixture();
  // greet's test shows how greet greets Bob too, which it does not pin, and farewell's green changes it.
  const shows = TEST_FILE.replace(`"greet('Ada') returns: " + said`, `"greet('Ada') returns: " + said + "; greet('Bob') returns: " + greet('Bob')`);
  await walk(f, 'red', { slices: [SLICE, FAREWELL], red: { 'test/greet.test.mjs': shows } });
  await walk(f, 'red', { red: { 'test/greet.test.mjs': shows } });
  assert.equal(f.read(GREETING), "greet('Ada') returns: Hello, Ada; greet('Bob') returns: Hello, Bob\n", "greet's green wrote its exhibit");
  const bob = "export function greet(name) {\n  return name === 'Bob' ? 'Yo, Bob' : `Hello, ${name}`;\n}\n";
  // What an earlier run left beside the exhibit is cleared before it is written again.
  const stale = `docs/prs/${KEY}/foreman/exhibits/greet-by-name/stale.txt`;
  f.write(stale, 'left by an earlier run');
  await walk(f, 'final', { green: { 'src/farewell.mjs': FAREWELL_CODE, 'src/greet.mjs': bob } });
  assert.equal(f.read(GREETING), "greet('Ada') returns: Hello, Ada; greet('Bob') returns: Yo, Bob\n", 'the exhibit shows the code at HEAD');
  assert.equal(fs.existsSync(`${f.root}/${stale}`), false);
  const run = f.runState();
  assert.deepEqual(run.exhibits['greet-by-name'], [{ file: GREETING, blob: f.sh('hash-object', GREETING) }]);
  assert.deepEqual(run.convergence.findings, []);
});

test("what landed that does not pass in the final gate's scratch checkout of HEAD is a finding of the engine's, and its exhibit command does not run", async () => {
  const f = fixture();
  // An exhibit command that always writes, beside what the tests write.
  const command = `node -e "require('fs').writeFileSync(process.env.BLUEPRINT_FOREMAN_EXHIBITS + '/shown.txt', 'shown')"`;
  await walk(f, 'contract-review', { slices: [{ ...SLICE, exhibit: { ...SLICE.exhibit, command } }] });
  assert.equal(f.runState().slice.exhibits.length, 2, "green's proof run and its command wrote both");
  // A scratch checkout of HEAD that gets red's code stands in for code that passes only in the session's.
  const git = f.ctx.git;
  const { redCommit } = f.runState().slice;
  const head = f.sh('rev-parse', 'HEAD');
  f.ctx.git = { ...git, withCheckout: (commit, fn) => git.withCheckout(commit === head ? redCommit : commit, fn) };
  await walk(f, 'final');
  assert.deepEqual(f.runState().convergence.findings, [{ file: 'test/greet.test.mjs', line: 1, claim: 'what landed (greet-by-name) no longer passes at HEAD: "greet names the person" no longer passes (failed)' }]);
  assert.deepEqual(f.runState().exhibits['greet-by-name'].map((e) => e.file), [GREETING], 'only what the failing tests wrote');
});

test("a suite's whole run at HEAD must pass every test it passed at the admitted commit, those no slice names among them", async () => {
  // A second suite's whole run writes no report at the admitted commit, so what it passed there is unknown.
  const all = 'node run-tests.mjs {report} test/*.test.mjs';
  const f = fixture({ suites: { ...SUITES, node: { ...SUITES.node, all }, later: { ...SUITES.node, all: `test -f src/greet.mjs && ${all}` } } });
  f.write('src/shout.mjs', 'export const shout = (s) => s.toUpperCase();\n');
  f.write('test/shout.test.mjs', "import assert from 'node:assert/strict';\nimport { shout } from '../src/shout.mjs';\nexport const tests = [{ name: 'shout uppercases', fn: () => assert.equal(shout('a'), 'A') }];\n");
  f.commit('an existing test no slice names', ['src/shout.mjs', 'test/shout.test.mjs']);
  await walk(f, 'final', { green: { 'src/greet.mjs': GREEN_CODE, 'src/shout.mjs': 'export const shout = (s) => s;\n' } });
  const [shout, later, ...more] = f.runState().convergence.findings;
  assert.deepEqual(shout, { file: '.blueprint-foreman.json', line: 1, claim: 'the whole of suite "node" passed a test at the admitted commit that it does not at HEAD: "shout uppercases" no longer passes (failed)' });
  assert.match(later.claim, /^the whole of suite "later" could not be judged at the admitted commit, so what it passed there is unchecked: the suite wrote no readable jest report \(exit 1\)/);
  assert.deepEqual([later.file, later.line, more], ['.blueprint-foreman.json', 1, []]);
});

test("the final gate's own run finds each locked line out of place and each gap still open at HEAD", async () => {
  const f = fixture({ scaffold: true });
  await walk(f, 'final', { slices: [SCAFFOLDED] });
  // Code no step's bounds would pass, to show the final run holds the locks itself.
  f.write('src/greet.mjs', SCAFFOLD.replace('greet(name)', 'greet(person)'));
  f.write('test/greet.test.mjs', TEST_FILE.replace("  assert.equal(said, 'Hello, Ada');\n", ''));
  f.commit('out of bounds', ['src/greet.mjs', 'test/greet.test.mjs']);
  const run = f.runState();
  const { findings } = f.ctx.git.withCheckout(f.sh('rev-parse', 'HEAD'), (dir) => convergeIn(f.ctx, run, dir));
  assert.deepEqual(findings.map((c) => `${c.file}:${c.line}: ${c.claim}`), [
    'src/greet.mjs:2: the scaffold line "export function greet(name) {" (line 2 at the scaffold) was changed, removed, commented out or quoted',
    `test/greet.test.mjs:7: the line "assert.equal(said, 'Hello, Ada');" of greet-by-name's tests (line 7 when it landed) was changed or removed; add tests beside it instead`,
    "src/greet.mjs:3: a scaffold gap is still open: return ''; // TODO(scaffold): the greeting",
  ]);
});

test('the engine removes every temporary directory it makes', async () => {
  const f = fixture();
  // The engine's temporary directories go where the environment names, here a directory of the test's own.
  const own = scratchDir('blueprint-foreman-temp-');
  const names = ['TMPDIR', 'TMP', 'TEMP'];
  const saved = names.map((n) => process.env[n]);
  for (const n of names) process.env[n] = own;
  try {
    await walk(f, 'final');
    const fetchImpl = async () => ({ ok: true, json: async () => ({ provider: 'P', model: 'vendor/model-x', choices: [{ message: { content: '{"findings":[]}' } }] }) });
    assert.equal((await run(['probe-adversary', 'vendor/model-x'], { root: f.root, env: { OPENROUTER_API_KEY: 'sk-or-test' }, fetch: fetchImpl, git: {} })).code, 0);
  } finally {
    names.forEach((n, i) => (saved[i] === undefined ? delete process.env[n] : (process.env[n] = saved[i])));
  }
  assert.deepEqual(fs.readdirSync(own), []);
});

test('a merge taken in at the final gate or at settle opens the final gate again at its first round, on the merged code', async () => {
  // The merged code keeps greet working, but the extractor no longer sees greet_fn_greet.
  const hidden = { 'src/greet.mjs': "export const greet = function greet(name) {\n  return `Hello, ${name}`;\n};\n" };
  for (const at of ['final', 'settle']) {
    const f = fixture();
    await walk(f, at);
    await ok(f, 'record', KEY, 'need', 'a word first');
    commitRun(f);
    const merge = mergeDefault(f, { VERSION: '2\n' }, hidden);
    answer(f, 'Go on.');
    const text = await ok(f, 'wake');
    assert.match(text, new RegExp(`resumed from stop 1\\n\\nMerge ${merge} came in at ${at === 'final' ? 'gate' : 'settle'}, so the final gate opens again at its first round, on the merged code\\.[\\s\\S]*step: gate`));
    const run = f.runState();
    assert.deepEqual([run.gate, run.accepted], [{ name: 'final', cycle: 1, round: 1, merge }, f.sh('rev-parse', 'HEAD')]);
    assert.deepEqual(run.convergence.findings.map((c) => c.claim), ['greet_fn_greet is not in the extracted graph, so the code does not realize this propose'], 'converged again, on the merged code');
    const dir = `docs/prs/${KEY}/foreman/gates/final-c1-merge-${merge.slice(0, 12)}-r1`;
    const pkg = f.read(`${dir}/package.md`);
    assert.match(pkg, /^# final gate for PROJ-1, cycle 1, round 1, after merge [0-9a-f]+\n[\s\S]*export const greet = function greet/, 'a package of its own, holding the merged code');
    assert.doesNotMatch(pkg, /^diff --git a\/docs\/prs\/PROJ-1\/foreman\//m, 'and none of the run state the branch carries');
    f.write(`${dir}/findings.json`, '[]');
    f.write(`${dir}/contract.json`, JSON.stringify(allMet(f, run)));
    assert.match(await ok(f, 'record', KEY, 'gate', 'agent-reviewer'), /step: gate-dispositions/);
    assert.equal(f.runState().rounds.at(-1).merge, merge);
  }
});

test("a merge taken in at the final gate's dispositions carries what the round found, unsettled, into the round it opens, each finding with its source", async () => {
  // Every record's run state is committed, as a session does, and each follows from the one before.
  const f = fixture();
  const first = `docs/prs/${KEY}/foreman/gates/final-c1-r1`;
  await walk(f, 'final', { commit: true });
  f.write(`${first}/findings.json`, JSON.stringify([{ file: 'src/greet.mjs', line: 2, claim: 'greet crashes on an empty name' }]));
  f.write(`${first}/contract.json`, JSON.stringify(allMet(f, f.runState())));
  await ok(f, 'record', KEY, 'gate', 'agent-reviewer');
  commitRun(f);
  await ok(f, 'record', KEY, 'need', 'fix the empty-name finding, or hand it off?');
  commitRun(f);
  const merge = mergeDefault(f);
  answer(f, 'Hand it off.');
  await ok(f, 'wake');
  commitRun(f);
  const reopened = `docs/prs/${KEY}/foreman/gates/final-c1-merge-${merge.slice(0, 12)}-r1`;
  f.write(`${reopened}/findings.json`, '[]');
  f.write(`${reopened}/contract.json`, JSON.stringify(allMet(f, f.runState())));
  assert.match(await ok(f, 'record', KEY, 'gate', 'agent-reviewer'), /step: gate-dispositions[\s\S]*A finding that names where it was "carried" from/);
  commitRun(f);
  assert.deepEqual(f.runState().gate.findings, [{ file: 'src/greet.mjs', line: 2, claim: 'greet crashes on an empty name', source: 'adversary', carried: 'gates/final-c1-r1' }]);
  f.write(`${reopened}/dispositions.json`, JSON.stringify([{ finding: 1, disposition: 'handed-off' }]));
  assert.match(await ok(f, 'record', KEY, 'dispositions'), /step: settle/);
  commitRun(f);
  f.write(`docs/prs/${KEY}/foreman/pr-notes.md`, NOTES);
  await ok(f, 'record', KEY, 'notes');
  assert.match(f.read(`docs/prs/${KEY}/pull-request.md`), /## Handed-off findings\n\n- gates\/final-c1-merge-[0-9a-f]{12}-r1 #1, src\/greet\.mjs:2: greet crashes on an empty name\n/);
});

test("a suite's whole run holds each test as the admitted commit wrote it, so a test rewritten since stands in for none, but for one a slice names to change", async () => {
  const f = fixture({ suites: { ...SUITES, node: { ...SUITES.node, all: 'node run-tests.mjs {report} test/*.test.mjs' } } });
  const tested = (name, fn, body) => `import assert from 'node:assert/strict';\nimport { ${fn} } from '../src/words.mjs';\nexport const tests = [{ name: '${name}', fn: () => ${body} }];\n`;
  f.write('src/words.mjs', 'export const shout = (s) => s.toUpperCase();\nexport const whisper = (s) => s.toLowerCase();\n');
  f.write('test/shout.test.mjs', tested('shout uppercases', 'shout', "assert.equal(shout('a'), 'A')"));
  f.write('test/whisper.test.mjs', tested('whisper lowercases', 'whisper', "assert.equal(whisper('A'), 'a')"));
  f.commit('tests no slice wrote', ['src/words.mjs', 'test/shout.test.mjs', 'test/whisper.test.mjs']);
  // The slice changes what whisper does, naming its test to change at red; its Green also breaks shout,
  // and rewrites shout's test, which no slice names, to pass.
  const slice = { ...SLICE, test: { ...SLICE.test, files: [...SLICE.test.files, 'test/whisper.test.mjs'], expectFail: [...SLICE.test.expectFail, 'whisper lowercases'] }, frozen: [...SLICE.frozen, 'test/whisper.test.mjs'] };
  await walk(f, 'final', {
    slices: [slice],
    red: { 'test/whisper.test.mjs': tested('whisper lowercases', 'whisper', "assert.equal(whisper('A'), 'a...')") },
    green: { 'src/greet.mjs': GREEN_CODE, 'src/words.mjs': 'export const shout = (s) => s;\nexport const whisper = (s) => `${s.toLowerCase()}...`;\n', 'test/shout.test.mjs': tested('shout uppercases', 'shout', "assert.ok(shout('a'))") },
  });
  assert.deepEqual(f.runState().convergence.findings, [{ file: '.blueprint-foreman.json', line: 1, claim: 'the whole of suite "node" passed a test at the admitted commit that it does not at HEAD: "shout uppercases" no longer passes (failed)' }]);
});
