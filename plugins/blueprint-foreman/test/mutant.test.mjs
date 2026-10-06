// Offline tests for the mutant, the substitute and the replays: `node --test
// plugins/blueprint-foreman/test/mutant.test.mjs`; their fixture is fixture.mjs.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { KEY, TEST_FILE, SLICE, FAREWELL, FAREWELL_CODE, MUTANTS, RED_STUB, GREEN_CODE, fixture, ok, refused, walk, restore, REVIEW, exhibit } from './fixture.mjs';

// A mutant that changes nothing observable survives any test.
const NO_OP = { file: 'src/greet.mjs', find: 'return', replace: 'return /* mutant */' };

// Records a mutant as a Mutant dispatch would, by `agent`.
function recordMutant(f, mutant, agent = 'agent-mutant') {
  f.write(`${REVIEW}/mutant.json`, JSON.stringify(mutant));
  return f.engine('record', KEY, 'mutant', agent);
}

test('the replays and land are no steps: each runs inside the record before it', async () => {
  const f = fixture();
  await walk(f, 'mutant', { slices: [SLICE, FAREWELL] });
  refused(await f.engine('record', KEY, 'replay'), /step mutant records "mutant", not "replay"/);
  await walk(f, 'contract-review');
  assert.ok(fs.existsSync(path.join(f.root, REVIEW, 'replay.json')), "the mutant's record wrote the replay evidence");
  refused(await f.engine('record', KEY, 'land'), /step contract-review records "contract", not "land"/);
  assert.match(await walk(f, 'red'), /recorded contract[\s\S]*step: red/);
  const run = f.runState();
  assert.equal(run.slice.id, 'say-farewell');
  assert.deepEqual(run.landed, ['greet-by-name']);
  assert.deepEqual(run.passing['greet-by-name'], ['greet names the person']);
  const steps = run.history.map((h) => h.step);
  assert.ok(!steps.includes('replay') && !steps.includes('land'), steps.join(', '));
  // A later slice's mutant edits what that slice changed, never what an earlier one did.
  await walk(f, 'mutant');
  f.write(`docs/prs/${KEY}/foreman/review/say-farewell-1/mutant.json`, JSON.stringify(MUTANTS['greet-by-name']));
  refused(await f.engine('record', KEY, 'mutant', 'agent-mutant-farewell'), /must edit a file the slice changed and did not freeze: src\/farewell\.mjs$/m);
});

test('a surviving mutant brings a second from a fresh dispatch, and a killed second makes the first a finding, spending nothing', async () => {
  const f = fixture();
  await walk(f, 'mutant');
  const first = await recordMutant(f, NO_OP);
  assert.equal(first.code, 0, first.text);
  assert.match(first.text, /step: mutant[\s\S]*The mutant "return" became "return \/\* mutant \*\/" in src\/greet\.mjs survived the tests[\s\S]*fresh Mutant subagent[^\n]*none of the run's Red, Green or Mutant subagents, the one that named the first mutant among them[\s\S]*Tell it another dispatch named "return" became "return \/\* mutant \*\/" in src\/greet\.mjs: it must name another edit/);
  assert.equal(f.runState().slice.budget, 3);
  exhibit('mutant-reroll', `$ engine record ${KEY} mutant agent-mutant\n${first.text}`);
  // The second comes from none of the run's authors, the first Mutant among them, and is another edit.
  for (const author of ['agent-red', 'agent-green', 'agent-mutant']) {
    refused(await recordMutant(f, MUTANTS['greet-by-name'], author), new RegExp(`the mutant must come from a fresh dispatch, never one the run recorded as a Red, a Green or a Mutant, as it did ${author}$`, 'm'));
  }
  refused(await recordMutant(f, NO_OP, 'agent-mutant-2'), /the second mutant must be another edit than the first, "return" became "return \/\* mutant \*\/" in src\/greet\.mjs/);
  // A second that cannot be judged sends the Mutant back, as a first does.
  const broke = refused(await recordMutant(f, { file: 'src/greet.mjs', find: 'return', replace: 'return return' }, 'agent-mutant-2'), /broke the build rather than the behaviour/);
  assert.match(broke, /step: mutant[\s\S]*survived the tests[\s\S]*did not count: it must compile/);
  const killed = await recordMutant(f, MUTANTS['greet-by-name'], 'agent-mutant-3');
  assert.equal(killed.code, 0, killed.text);
  assert.match(killed.text, /step: group-review/);
  assert.equal(f.runState().slice.budget, 3, 'nothing is spent');
  const finding = { file: 'src/greet.mjs', line: 2, claim: 'the mutant "return" became "return /* mutant */" in src/greet.mjs survived the tests and another of the same behaviour did not, so it is likely equivalent to the code; if it is not, the tests do not pin what it changes', source: 'mutant' };
  assert.deepEqual(JSON.parse(f.read(`${REVIEW}/replay.json`)).findings, [finding]);
  // The finding joins the slice's review, so even a verdict that finds nothing leaves it to settle.
  await walk(f, 'slice-dispositions');
  assert.deepEqual(JSON.parse(f.read(`${REVIEW}/findings.json`)), [finding]);
});

test('when both mutants survive, Red spends its attempt', async () => {
  const f = fixture();
  await walk(f, 'mutant');
  assert.equal((await recordMutant(f, NO_OP)).code, 0);
  const text = refused(await recordMutant(f, { file: 'src/greet.mjs', find: '(name) {', replace: '(name)  {' }, 'agent-mutant-2'), /the second mutant \("\(name\) \{" became "\(name\) {2}\{" in src\/greet\.mjs\) survived, as the first did \("return" became "return \/\* mutant \*\/" in src\/greet\.mjs\): every test passed with the mutant in place/);
  assert.match(text, /spends an attempt \(2 left\)[\s\S]*step: red/);
  exhibit('refusal-surviving-mutants', `$ engine record ${KEY} mutant agent-mutant-2\n${text}`);
  // The next green is a new candidate, whose first mutant is a first again.
  restore(f, text);
  assert.doesNotMatch(await walk(f, 'mutant'), /survived the tests/);
});

test('a mutant that breaks the build is named again without spending an attempt', async () => {
  const f = fixture();
  await walk(f, 'mutant');
  const text = refused(await recordMutant(f, { file: 'src/greet.mjs', find: 'return', replace: 'return return' }), /the mutant \("return" became "return return" in src\/greet\.mjs\) broke the build rather than the behaviour/);
  assert.match(text, /step: mutant[\s\S]*did not count: it must compile/);
  assert.doesNotMatch(text, /survived the tests/, 'a mutant that broke the build is no survivor');
  assert.equal(f.runState().slice.budget, 3);
  await walk(f, 'group-review');
});

test('the mutant is named after green by another dispatch, in what the slice changed, and found once', async () => {
  const f = fixture();
  // The run state committed as a session commits it, so the run directory changed within the slice too.
  await walk(f, 'mutant', { commit: true });
  const at = `${REVIEW}/mutant.json`;
  f.write(at, JSON.stringify(MUTANTS['greet-by-name']));
  refused(await f.engine('record', KEY, 'mutant'), /record the Mutant dispatch's agent id/);
  // Neither Red, who wrote the tests, nor Green, who wrote the code, names what the tests must catch.
  for (const author of ['agent-red', 'agent-green']) refused(await f.engine('record', KEY, 'mutant', author), /the mutant must come from a fresh dispatch, never one the run recorded as a Red, a Green or a Mutant/);
  f.write(at, JSON.stringify({ file: 'src/greet.mjs', find: 'Hello, ' }));
  refused(await f.engine('record', KEY, 'mutant', 'agent-mutant'), /mutant\.json must be \{ "file", "find", "replace" \}, with a replacement that differs/);
  for (const file of ['test/greet.test.mjs', `docs/prs/${KEY}/foreman/briefs/greet-by-name-red-1.md`]) {
    f.write(at, JSON.stringify({ file, find: file.startsWith('test/') ? 'Ada' : '# Red: ', replace: 'Bob' }));
    refused(await f.engine('record', KEY, 'mutant', 'agent-mutant'), /must edit a file the slice changed and did not freeze: src\/greet\.mjs$/m);
  }
  f.write(at, JSON.stringify({ file: 'src/greet.mjs', find: 'name', replace: 'nom' }));
  assert.match((await f.engine('record', KEY, 'mutant', 'agent-mutant')).text, /must occur exactly once in src\/greet\.mjs; it occurs 2 times/);
  f.write(at, JSON.stringify({ file: 'src/greet.mjs', find: 'Howdy, ', replace: 'Hi, ' }));
  refused(await f.engine('record', KEY, 'mutant', 'agent-mutant'), /must occur exactly once in src\/greet\.mjs; it occurs 0 times/);
  f.write(at, JSON.stringify({ ...MUTANTS['greet-by-name'], why: 'kept out of the record' }));
  assert.match(await ok(f, 'record', KEY, 'mutant', 'agent-mutant'), /step: group-review/);
  assert.deepEqual(f.runState().slice.mutant, MUTANTS['greet-by-name']);
});

test("the Mutant reads the slice's change without its tests or the run state, and may edit only a file its green holds", async () => {
  const f = fixture();
  await walk(f, 'green');
  // Green also deletes a file the slice's base held.
  f.write('src/greet.mjs', GREEN_CODE);
  f.sh('rm', '--quiet', 'README.md');
  f.commit(`feat(${KEY}): greet-by-name`, ['src/greet.mjs']);
  await ok(f, 'record', KEY, 'green', 'agent-green');
  const { base, greenCommit } = f.runState().slice;
  const brief = f.read(`docs/prs/${KEY}/foreman/briefs/greet-by-name-mutant-1.md`);
  const diff = `git diff ${base} ${greenCommit} -- . ':(exclude)docs/prs/PROJ-1/foreman' ':(exclude)docs/prs/PROJ-1/pull-request.md' ':(exclude)test/greet.test.mjs' ':(exclude)run-tests.mjs'`;
  assert.ok(brief.includes(`Read the slice's change to its product code, ${diff}, and name`), brief);
  const shown = execFileSync('sh', ['-c', diff], { cwd: f.root, encoding: 'utf8' });
  assert.match(shown, /src\/greet\.mjs/);
  assert.doesNotMatch(shown, /greet\.test\.mjs|docs\/prs\/PROJ-1\/foreman/);
  assert.match(brief, /in a file the slice changed and did not freeze: src\/greet\.mjs\.\n/, 'never the file it deleted');
});

test("a substitute's green may commit nothing, since its tests pass at red already", async () => {
  const f = fixture();
  f.write('src/greet.mjs', GREEN_CODE);
  f.commit('existing behaviour', ['src/greet.mjs']);
  const substitute = { broken: { file: 'src/greet.mjs', find: 'Hello, ', replace: 'Bye, ' }, reason: 'pins behaviour that already exists' };
  await walk(f, 'red', { slices: [{ ...SLICE, stubs: [], mutant: null, test: { suite: 'node', files: SLICE.test.files }, substitute }] });
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit('characterization test', ['test/greet.test.mjs']);
  assert.match(await ok(f, 'record', KEY, 'red', 'agent-red'), /commit its changes as "feat\(PROJ-1\): greet-by-name", if it made any/);
  assert.match(await ok(f, 'record', KEY, 'green', 'agent-green'), /step: group-review/);
});

test('the mutant never edits a protected path, even one the slice seems to have changed', async () => {
  const f = fixture({ protect: ['extract.mjs'] });
  await walk(f, 'mutant');
  // No step's bounds let a slice change a protected path; the mutant's target is checked apart, so a
  // git that reports one in the slice's change must still not make it a target.
  const git = f.ctx.git;
  f.ctx.git = { ...git, changedFiles: (from, to, apart) => [...git.changedFiles(from, to, apart), ...(to === 'HEAD' ? [] : ['extract.mjs'])] };
  f.write(`${REVIEW}/mutant.json`, JSON.stringify({ file: 'extract.mjs', find: "fs.mkdirSync('.blueprint'", replace: "fs.mkdirSync('.elsewhere'" }));
  refused(await f.engine('record', KEY, 'mutant', 'agent-mutant'), /must edit a file the slice changed and did not freeze: src\/greet\.mjs$/m);
});

test('a substitute slice passes as it is and must fail on its named broken state, and its green replays with no mutant', async () => {
  const f = fixture();
  f.write('src/greet.mjs', GREEN_CODE);
  f.commit('existing behaviour', ['src/greet.mjs']);
  const substitute = { broken: { file: 'src/greet.mjs', find: 'Hello, ', replace: 'Bye, ' }, reason: 'pins behaviour that already exists' };
  await walk(f, 'red', { slices: [{ ...SLICE, stubs: [], mutant: null, test: { suite: 'node', files: SLICE.test.files }, substitute }] });
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit('characterization test', ['test/greet.test.mjs']);
  assert.match((await f.engine('record', KEY, 'red', 'agent-red')).text, /step: green/);
  assert.match(f.read(`docs/prs/${KEY}/foreman/briefs/greet-by-name-red-1.md`), /would fail on this broken state: in src\/greet\.mjs, "Hello, " becomes "Bye, "\./);
  // The refactor Green makes is replayed inside its own record, and the slice goes to review.
  f.write('src/greet.mjs', `// Greets a person.\n${GREEN_CODE}`);
  f.commit('refactor', ['src/greet.mjs']);
  assert.match(await ok(f, 'record', KEY, 'green', 'agent-green'), /step: group-review/);
  assert.equal(JSON.parse(f.read(`${REVIEW}/replay.json`)).mutant, 'n/a');
});

test('a characterization test that the broken state does not break is refused', async () => {
  const f = fixture();
  f.write('src/greet.mjs', GREEN_CODE);
  f.commit('existing behaviour', ['src/greet.mjs']);
  const substitute = { broken: { file: 'src/greet.mjs', find: 'return', replace: 'return /* no-op */' }, reason: 'refactor' };
  await walk(f, 'red', { slices: [{ ...SLICE, stubs: [], mutant: null, test: { suite: 'node', files: SLICE.test.files }, substitute }] });
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit('characterization test', ['test/greet.test.mjs']);
  refused(await f.engine('record', KEY, 'red', 'agent-red'), /on the broken state: every test passed/);
});

test("a substitute's tests must pass as they are, and its broken state must edit a file the code holds", async () => {
  const f = fixture();
  f.write('src/greet.mjs', GREEN_CODE);
  f.commit('existing behaviour', ['src/greet.mjs']);
  const substitute = { broken: { file: 'src/gone.mjs', find: 'Hello, ', replace: 'Bye, ' }, reason: 'pins behaviour that already exists' };
  await walk(f, 'red', { slices: [{ ...SLICE, stubs: [], mutant: null, test: { suite: 'node', files: SLICE.test.files }, substitute }] });
  f.write('test/greet.test.mjs', TEST_FILE.replace("assert.equal(said, 'Hello, Ada')", "assert.equal(said, 'Howdy, Ada')"));
  f.commit('a characterization test that fails as it is', ['test/greet.test.mjs']);
  const text = refused(await f.engine('record', KEY, 'red', 'agent-red'), /"greet names the person" fails[\s\S]*spends an attempt \(2 left\)/);
  restore(f, text);
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit('characterization test', ['test/greet.test.mjs']);
  refused(await f.engine('record', KEY, 'red', 'agent-red'), /src\/gone\.mjs does not exist at this commit[\s\S]*spends an attempt \(1 left\)/);
});

test('the replays install in their scratch checkout, for green and again for red', async () => {
  // The install stamps a copy of the product code where the repository ignores it, and fails on a
  // marker in it; the test throws, never on an assertion, while a stamp is stale. The session's
  // checkout, installed only before the product code exists, never has one.
  const install = `node -e "const fs = require('fs'); fs.mkdirSync('.blueprint', { recursive: true }); const src = fs.existsSync('src/greet.mjs') ? fs.readFileSync('src/greet.mjs', 'utf8') : null; if (src && src.includes('install-breaker')) process.exit(4); if (src === null) fs.rmSync('.blueprint/stamp', { force: true }); else fs.writeFileSync('.blueprint/stamp', src);"`;
  const stamped = TEST_FILE.replace('fn: () => {\n', "fn: () => {\n  if (fs.existsSync('.blueprint/stamp') && fs.readFileSync('.blueprint/stamp', 'utf8') !== fs.readFileSync('src/greet.mjs', 'utf8')) throw new TypeError('the install is stale');\n");
  const f = fixture({ install });
  await walk(f, 'mutant', { red: { 'test/greet.test.mjs': stamped }, green: { 'src/greet.mjs': `${GREEN_CODE}// install-breaker\n` } });
  const text = refused(await recordMutant(f, MUTANTS['greet-by-name']), /green replay: the install \(.+\) failed in the scratch checkout \(exit 4\)[\s\S]*spends an attempt \(2 left\)[\s\S]*step: green/);
  restore(f, text);
  await walk(f, 'mutant');
  // Green's install stamps green's code, and red's again red's, so the red replay fails on its assertion.
  f.write(`docs/prs/${KEY}/foreman/review/greet-by-name-2/mutant.json`, JSON.stringify(MUTANTS['greet-by-name']));
  assert.match(await ok(f, 'record', KEY, 'mutant', 'agent-mutant-2'), /step: group-review/);
});

test('a green replay that cannot find the named tests is refused', async () => {
  const f = fixture();
  // The named test exists only in this checkout, never on the branch.
  f.write('.gitignore', '.blueprint/\ntest/local.test.mjs\n');
  f.commit('ignore a local test', ['.gitignore']);
  const slice = { ...SLICE, test: { ...SLICE.test, files: ['test/local.test.mjs'] }, frozen: ['test/local.test.mjs', 'run-tests.mjs'] };
  await walk(f, 'red', { slices: [slice] });
  f.write('test/local.test.mjs', TEST_FILE);
  f.write('src/greet.mjs', RED_STUB);
  f.commit('red', ['src/greet.mjs']);
  assert.match((await f.engine('record', KEY, 'red', 'agent-red')).text, /step: green/);
  await walk(f, 'mutant');
  refused(await recordMutant(f, MUTANTS['greet-by-name']), /green replay: the suite ran no tests/);
});

test("what landed runs again in the green replay's scratch checkout, which nothing left in the session's checkout reaches", async () => {
  const f = fixture();
  await walk(f, 'red', { slices: [SLICE, FAREWELL] });
  await walk(f, 'red');
  assert.equal(f.runState().slice.id, 'say-farewell');
  // A file the repository ignores keeps what landed passing in the session's checkout, and only there.
  f.write('.blueprint/keep', 'x');
  const greet = "import fs from 'node:fs';\nexport function greet(name) {\n  return fs.existsSync('.blueprint/keep') ? `Hello, ${name}` : 'broken';\n}\n";
  await walk(f, 'mutant', { green: { 'src/farewell.mjs': FAREWELL_CODE, 'src/greet.mjs': greet } });
  f.write(`docs/prs/${KEY}/foreman/review/say-farewell-1/mutant.json`, JSON.stringify(MUTANTS['say-farewell']));
  const text = refused(await f.engine('record', KEY, 'mutant', 'agent-mutant-farewell'), /green replay: what landed \(greet-by-name\) no longer passes: "greet names the person" no longer passes \(failed\)/);
  assert.match(text, /spends an attempt \(2 left\)[\s\S]*step: green/);
});

test('a red that does not fail again when replayed sends the slice back to red', async () => {
  const f = fixture();
  await walk(f, 'mutant');
  // A scratch checkout that gets green's code where red's was asked for stands in for a red that only
  // failed in the session's checkout.
  const git = f.ctx.git;
  const { redCommit, greenCommit } = f.runState().slice;
  f.ctx.git = { ...git, checkoutIn: (dir, commit, file) => git.checkoutIn(dir, !file && commit === redCommit ? greenCommit : commit, file) };
  const text = refused(await recordMutant(f, MUTANTS['greet-by-name']), /red replay: "greet names the person" did not fail \(passed\)/);
  assert.match(text, /spends an attempt \(2 left\)[\s\S]*step: red/);
});
