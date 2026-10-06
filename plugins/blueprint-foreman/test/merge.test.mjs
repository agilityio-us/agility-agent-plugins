// Offline tests for merges of the default branch, mid-run and at rest: `node --test
// plugins/blueprint-foreman/test/merge.test.mjs`; their fixture is fixture.mjs.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEY, BRANCH, TEST_FILE, SCAFFOLD, FILLED, SCAFFOLDED, FAREWELL, FAREWELL_CODE, GREEN_CODE, adapters, allMet, fixture, ok, refused, walk, restore, shell, commitRun, mergeDefault, settled, REVIEW, answer, fire } from './fixture.mjs';

// A contract verdict that passes the slice with one finding, which the slice's dispositions settle.
const PASSED_WITH_FINDING = { verdict: 'pass', reasons: [], findings: [{ file: 'src/greet.mjs', line: 1, claim: 'unused parameter' }] };

test('work merged into the branch mid-run stops the run, and the fire that resumes it takes the merge in', async () => {
  const f = fixture();
  await walk(f, 'slice-dispositions', { contract: PASSED_WITH_FINDING });
  commitRun(f);
  mergeDefault(f);
  f.write(`${REVIEW}/dispositions.json`, JSON.stringify([{ finding: 1, disposition: 'handed-off' }]));
  const text = refused(await f.engine('record', KEY, 'dispositions'), /took in merge [0-9a-f]+ since [0-9a-f]+, and a run judges merged work only when it wakes at rest/);
  assert.doesNotMatch(text, /git restore/, 'no command that would undo the merged work');
  // The advice can be followed: the stop, its answer, and the wake that judges the merge.
  const need = /stop the run, so the fire that resumes it checks the merged code: node \S+ record PROJ-1 need "([^"]+)"$/m.exec(text)?.[1];
  assert.match(need ?? text, /^the branch took in merge [0-9a-f]+ while the run was working; answer, and the next fire checks the merged code$/, 'the need says what an answer does');
  await ok(f, 'record', KEY, 'need', need);
  commitRun(f);
  answer(f, 'Go on.');
  assert.match(await ok(f, 'wake'), /resumed from stop 1[\s\S]*step: slice-dispositions/);
  assert.equal(f.runState().accepted, f.sh('rev-parse', 'HEAD'), 'the run counts from the merged code');
  assert.match(await ok(f, 'record', KEY, 'dispositions'), /step: gate/);
});

test('a merge taken in at rest is accepted once the merged code holds, and stops the run until it does', async () => {
  const f = fixture({ scaffold: true });
  await walk(f, 'settle', { slices: [SCAFFOLDED, FAREWELL], commit: true });
  await ok(f, 'record', KEY, 'need', 'a word on it');
  commitRun(f);
  // A merge that breaks what landed stops the run again, with the failure as its need. Both slices
  // landed in one suite, which runs once over the files of both.
  mergeDefault(f, { VERSION: '2\n' }, { 'src/farewell.mjs': FAREWELL_CODE.replace('Bye, ', 'Yo, ') });
  answer(f, 'Go on.');
  const text = refused(await f.engine('wake'), /the branch took in merge [0-9a-f]+, and the merged code does not hold: what landed \(greet-by-name, say-farewell\) no longer passes: "farewell names the person" no longer passes \(failed\); merge a fix and answer, or take it out \(git revert --no-edit -m 1 [0-9a-f]+\) and answer\n/);
  assert.match(text, /--trailer 'Foreman-Cycle: 1' --trailer 'Foreman-Stop: 2' --trailer 'Foreman-Run: PROJ-1 stopped' --trailer 'Blueprint-Status: needs-human'/);
  commitRun(f);
  // A merge that puts it right is taken in with the one before it, and the run counts from it: taken
  // at settle, it opens the final gate again.
  mergeDefault(f, { VERSION: '3\n' }, { 'src/farewell.mjs': FAREWELL_CODE });
  answer(f, 'The default branch is fixed.');
  const back = await ok(f, 'wake');
  assert.match(back, /resumed from stop 2\n\nMerge [0-9a-f]+ came in at settle, so the final gate opens again at its first round, on the merged code\.[\s\S]*step: gate/);
  assert.equal(f.runState().accepted, f.sh('rev-parse', 'HEAD'));
});

test('a merge at rest stops the run on a protected path, a locked line, the install, or the tests of the slice about to land', async () => {
  const cases = [
    ['gate', { '.blueprint.config.json': adapters({ extract: 'node extract.mjs --lenient' }) }, /the merged code does not hold: it changes a protected path: \.blueprint\.config\.json/],
    ['gate', { 'src/greet.mjs': SCAFFOLD.replace('greet(name)', 'greet(person)') }, /the merged code does not hold: src\/greet\.mjs:2: the scaffold line "export function greet\(name\) \{" \(line 2 at the scaffold\) was changed/],
    ['gate', { 'install.mjs': 'process.exit(5);\n' }, /the merged code does not hold: the install \(node install\.mjs\) failed in the working tree \(exit 5\)/],
    ['gate', { 'install.mjs': "import fs from 'node:fs';\nfs.writeFileSync('stray.txt', 'x');\n" }, /the merged code does not hold: the install left the working tree changed, and it must install without changing it: stray\.txt/],
    ['slice-dispositions', { 'src/greet.mjs': FILLED.replace('Hello, ', 'Yo, ') }, /the merged code does not hold: what landed \(greet-by-name\) no longer passes: "greet names the person" no longer passes \(failed\)/],
  ];
  for (const [to, resolve, pattern] of cases) {
    const f = fixture({ scaffold: true, install: 'node install.mjs' });
    await walk(f, to, { slices: [SCAFFOLDED], contract: PASSED_WITH_FINDING });
    await ok(f, 'record', KEY, 'need', 'a word on it');
    commitRun(f);
    mergeDefault(f, { VERSION: '2\n' }, resolve);
    answer(f, 'Go on.');
    refused(await f.engine('wake'), pattern);
    assert.equal(f.runState().stops, 2);
  }
});

test("what landed runs again on the merged code in a scratch checkout, which nothing left in the session's checkout reaches", async () => {
  const f = fixture();
  await walk(f, 'final');
  // The final gate finds something, so the run rests at its dispositions.
  const dir = `docs/prs/${KEY}/foreman/gates/final-c1-r1`;
  f.write(`${dir}/findings.json`, JSON.stringify([{ file: 'src/greet.mjs', line: 1, claim: 'unused parameter' }]));
  f.write(`${dir}/contract.json`, JSON.stringify(allMet(f, f.runState())));
  await ok(f, 'record', KEY, 'gate', 'agent-reviewer');
  await ok(f, 'record', KEY, 'need', 'a word first');
  commitRun(f);
  // A file the repository ignores keeps what landed passing in the session's checkout, and only there.
  f.write('.blueprint/keep', 'x');
  const greet = "import fs from 'node:fs';\nexport function greet(name) {\n  return fs.existsSync('.blueprint/keep') ? `Hello, ${name}` : 'broken';\n}\n";
  mergeDefault(f, { VERSION: '2\n' }, { 'src/greet.mjs': greet });
  answer(f, 'Go on.');
  refused(await f.engine('wake'), /the merged code does not hold: what landed \(greet-by-name\) no longer passes: "greet names the person" no longer passes \(failed\)/);
  // Merged code that holds, taken in at the final gate's dispositions, opens the final gate again, which
  // carries in the finding its first round left unsettled.
  commitRun(f);
  const fix = mergeDefault(f, { VERSION: '3\n' }, { 'src/greet.mjs': GREEN_CODE });
  answer(f, 'Fixed on the default branch.');
  assert.match(await ok(f, 'wake'), /came in at gate-dispositions, so the final gate opens again at its first round[\s\S]*step: gate/);
  const carried = [{ file: 'src/greet.mjs', line: 1, claim: 'unused parameter', source: 'adversary', carried: 'gates/final-c1-r1' }];
  assert.deepEqual(f.runState().gate, { name: 'final', cycle: 1, round: 1, merge: fix, carried });
});

test('a merge at rest at red is taken in, and the slice counts from the merged code', async () => {
  const f = fixture();
  await walk(f, 'red');
  await ok(f, 'record', KEY, 'need', 'the greeting to test');
  commitRun(f);
  // The default branch took in a branch of its own: that merge is on its line, not on the run's.
  f.sh('switch', '--quiet', '-c', 'side', 'master');
  f.write('SIDE.md', 'side\n');
  f.commit('side work', ['SIDE.md']);
  f.sh('switch', '--quiet', 'master');
  f.write('CHANGELOG.md', '# changes\n');
  f.commit('a changelog', ['CHANGELOG.md']);
  f.sh('merge', '--quiet', '--no-ff', '-m', 'take in the side branch', 'side');
  f.sh('switch', '--quiet', BRANCH);
  mergeDefault(f);
  answer(f, 'Hello, Ada.');
  assert.match(await ok(f, 'wake'), /resumed from stop 1[\s\S]*step: red/);
  assert.equal(f.runState().slice.base, f.sh('rev-parse', 'HEAD'));
  await walk(f, 'green');
});

test("a merge at rest at red after a spent attempt is taken in, the spent green's tests gone with it", async () => {
  const f = fixture();
  await walk(f, 'mutant');
  // Both mutants survive, so Red's attempt is spent and the code goes back to the slice's base.
  f.write(`${REVIEW}/mutant.json`, JSON.stringify({ file: 'src/greet.mjs', find: 'return', replace: 'return /* mutant */' }));
  await ok(f, 'record', KEY, 'mutant', 'agent-mutant');
  f.write(`${REVIEW}/mutant.json`, JSON.stringify({ file: 'src/greet.mjs', find: '(name) {', replace: '(name)  {' }));
  restore(f, refused(await f.engine('record', KEY, 'mutant', 'agent-mutant-2'), /spends an attempt \(2 left\)[\s\S]*step: red/));
  await ok(f, 'record', KEY, 'need', 'the greeting to test');
  commitRun(f);
  mergeDefault(f);
  answer(f, 'Hello, Ada.');
  assert.match(await ok(f, 'wake'), /resumed from stop 1[\s\S]*step: red/);
  assert.equal(f.runState().slice.base, f.sh('rev-parse', 'HEAD'));
  await walk(f, 'green');
});

test('a merge at rest is not taken where the slice may still spend an attempt, or beside work the engine has not accepted', async () => {
  const mutant = fixture();
  await walk(mutant, 'green');
  await resumedWithout(mutant, refused(await mergedAtRest(mutant, 'green'), /while slice "greet-by-name" was at green, where a later attempt would restore the code to before the merge/), 'green');
  await walk(mutant, 'mutant');
  await ok(mutant, 'record', KEY, 'need', 'which defect to name');
  commitRun(mutant);
  mergeDefault(mutant);
  answer(mutant, 'Any.');
  const stopped = refused(await mutant.engine('wake'), /the branch took in merge [0-9a-f]+ while slice "greet-by-name" was at mutant, where a later attempt would restore the code to before the merge/);
  assert.match(stopped, /-m "\$\(printf '%s\\n' 'The run is stopped at mutant\. It needs: the branch took in merge' /, 'the body names the step, so the runner can tell when a merge would be taken');
  const red = fixture();
  await walk(red, 'red');
  red.write('test/greet.test.mjs', TEST_FILE);
  red.commit('red, half done', ['test/greet.test.mjs']);
  await ok(red, 'record', KEY, 'need', 'the greeting to test');
  commitRun(red);
  mergeDefault(red);
  answer(red, 'Hello, Ada.');
  refused(await red.engine('wake'), /while red held work the engine had not accepted \(test\/greet\.test\.mjs\), and the run cannot judge the two apart/);
});

// The command a stop on a merge names to take it out, run as the runner would.
function takeOut(f, text) {
  const command = /take it out \((git revert --no-edit -m 1 [0-9a-f]+)\) and answer/.exec(text)?.[1];
  assert.ok(command, text);
  shell(f, command);
}

// Stops the run on a need, takes in a merge of the default branch while it rests, a merge that adds
// `file`, answers, and wakes the run.
async function mergedAtRest(f, file) {
  await ok(f, 'record', KEY, 'need', 'a word on it');
  commitRun(f);
  mergeDefault(f, { [`${file}.txt`]: 'x\n' });
  answer(f, 'Go on.');
  return f.engine('wake');
}

// Takes out the merge a stop names and answers it, and the wake resumes at `step`.
async function resumedWithout(f, stopped, step) {
  commitRun(f);
  takeOut(f, stopped);
  answer(f, 'The merge is reverted.');
  assert.match(await ok(f, 'wake'), new RegExp(`resumed from stop \\d+[\\s\\S]*step: ${step}`));
}

test('a stop on a merge the run will not take says how to take it out, and once it is reverted an answer clears it', async () => {
  const f = fixture();
  await walk(f, 'mutant');
  await ok(f, 'record', KEY, 'need', 'which defect to name');
  commitRun(f);
  const merge = mergeDefault(f);
  answer(f, 'Any.');
  const stopped = refused(await f.engine('wake'), new RegExp(`take it out \\(git revert --no-edit -m 1 ${merge}\\) and answer, and once the slice has landed, a revert of that revert brings it back`));
  commitRun(f);
  // An answer alone leaves the merge in, and the run stops again on it.
  answer(f, 'Understood; go on.');
  refused(await f.engine('wake'), /while slice "greet-by-name" was at mutant/);
  assert.equal(f.runState().stops, 3);
  commitRun(f);
  // Reverted, the merge came to nothing, whatever the commits: the answer clears the stop, and no later
  // record counts the merge.
  takeOut(f, stopped);
  answer(f, 'The merge is reverted.');
  assert.match(await ok(f, 'wake'), /resumed from stop 3[\s\S]*step: mutant/);
  // Each step of the slice's review may still spend Green's attempt, so a merge is not taken there either.
  for (const step of ['group-review', 'contract-review']) {
    await walk(f, step);
    await resumedWithout(f, refused(await mergedAtRest(f, step), new RegExp(`while slice "greet-by-name" was at ${step}, where a later attempt`)), step);
  }
  // Beside unaccepted work at red, the same.
  const red = fixture();
  await walk(red, 'red');
  red.write('test/greet.test.mjs', TEST_FILE);
  red.commit('red, half done', ['test/greet.test.mjs']);
  await ok(red, 'record', KEY, 'need', 'the greeting to test');
  commitRun(red);
  mergeDefault(red);
  answer(red, 'Hello, Ada.');
  takeOut(red, refused(await red.engine('wake'), /held work the engine had not accepted \(test\/greet\.test\.mjs\), and the run cannot judge the two apart; take it out/));
  commitRun(red);
  answer(red, 'The merge is reverted.');
  assert.match(await ok(red, 'wake'), /resumed from stop 2[\s\S]*step: red/);
  await walk(red, 'green');
});
