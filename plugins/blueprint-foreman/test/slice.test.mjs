// Offline tests for a slice's red and green, its budget, the locks, its exhibits and its suite, and
// the plan check: `node --test plugins/blueprint-foreman/test/slice.test.mjs`; their fixture is
// fixture.mjs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ALL_PRACTICES, PLUGIN_DIR, containment } from '../lib/config.mjs';
import { createGit } from '../lib/git.mjs';
import { checkApproval, checkPlan, nextSlice } from '../lib/plan.mjs';
import { checkLock } from '../lib/locks.mjs';
import { exhibitsIn } from '../lib/slice.mjs';
import { KEY, TEST_FILE, SLICE, SCAFFOLD, FILLED, SCAFFOLDED, FAREWELL_TEST, FAREWELL, FAREWELL_STUB, FAREWELL_CODE, MUTANTS, RED_STUB, GREEN_CODE, SUITES, ACTS, fixture, ok, refused, walk, restore, exhibit, scratchDir, GREETING, answer, fire } from './fixture.mjs';

test('the plan check refuses each gap, one field at a time, before any slice starts', () => {
  const keys = ['greets-by-name'];
  const suites = { ...SUITES, e2e: { command: 'pw {files}', cwd: 'web', env: { OUT: '{report}' }, report: 'junit' } };
  const problems = (plan, protect) => checkPlan(plan, keys, suites, protect).join('\n');
  const test = (over) => ({ test: { ...SLICE.test, ...over } });
  // A substitute declares its broken state, an edit in the form a mutant takes, and its reason, and no stub.
  const sub = { ...SLICE, stubs: [], mutant: null, test: { suite: 'node', files: SLICE.test.files }, substitute: { broken: MUTANTS['greet-by-name'], reason: 'a refactor' } };
  const broken = (edit) => ({ ...sub, substitute: { ...sub.substitute, broken: { ...MUTANTS['greet-by-name'], ...edit } } });
  assert.deepEqual(checkPlan({ slices: [SLICE] }, keys, suites), []);
  assert.deepEqual(checkPlan({ slices: [sub] }, keys, suites), []);
  assert.deepEqual(checkPlan({ slices: [{ ...SLICE, test: { suite: 'e2e', files: ['web/e2e/greet.spec.ts'], expectFail: ['x'] }, frozen: ['web/e2e'] }] }, keys, suites), []);
  const cycle = [{ ...SLICE, id: 'a', dependsOn: ['b'] }, { ...SLICE, id: 'b', dependsOn: ['a'] }];
  for (const [plan, pattern] of [
    [{ slices: [] }, /plan\.json needs a non-empty "slices" list/],
    [{ slices: { a: SLICE } }, /plan\.json needs a non-empty "slices" list/],
    [null, /plan\.json needs a non-empty "slices" list/],
    [{ slices: [SLICE, SLICE] }, /slice "greet-by-name" appears twice/],
    [{ slices: cycle }, /the slice graph has a cycle/],
  ]) {
    assert.match(problems(plan), pattern, JSON.stringify(plan));
  }
  // Each row changes one field of the slice, and names its refusal.
  const rows = [
    [{ id: 'Greet By Name' }, /slice "Greet By Name" needs a lowercase slug id/],
    [{ id: undefined }, /slice "\?" needs a lowercase slug id/],
    [{ outcome: undefined }, /slice "greet-by-name" needs an outcome/],
    [{ outcome: ' ' }, /slice "greet-by-name" needs an outcome/],
    // A slice realizes at least one criterion, and only the design's, and every criterion is realized.
    [{ criteria: ['other'] }, /no slice realizes criterion "greets-by-name"/],
    [{ criteria: ['greets-by-name', 'other'] }, /slice "greet-by-name" names "other", which is not a design criterion/],
    [{ criteria: [] }, /slice "greet-by-name" must realize at least one criterion/],
    [{ criteria: undefined }, /slice "greet-by-name" must realize at least one criterion/],
    [{ dependsOn: undefined }, /slice "greet-by-name" needs "dependsOn" as a list/],
    [{ dependsOn: ['nope'] }, /slice "greet-by-name" depends on unknown slice "nope"/],
    [{ complexity: 'huge' }, /slice "greet-by-name" needs complexity "contained" or "broad"/],
    // A slice names a declared suite by name and test files in its frozen set, under the suite's cwd;
    // the plan never writes a command.
    ...[undefined, 'unit', '__proto__', ['node']].map((suite) => [test({ suite }), /needs "test": \{ "suite" \}, naming a suite the adapters declare: node, junit, e2e/]),
    [test({ command: 'node run-tests.mjs {report}' }), /names a suite and its test files, and never writes a test command/],
    ...[undefined, [], ['../x.test.mjs'], 'test/greet.test.mjs'].map((files) => [test({ files }), /needs "test": \{ "files" \}, a non-empty list of repository-relative test files/]),
    [test({ files: ['test/greet.test.mjs', 'test/other.test.mjs'] }), /slice "greet-by-name" runs test\/other\.test\.mjs, which is not in its frozen set/],
    [test({ suite: 'e2e' }), /runs test\/greet\.test\.mjs in suite "e2e", but it is not under the suite's cwd, web/],
    ...[undefined, [], 'greet names the person'].map((expectFail) => [test({ expectFail }), /slice "greet-by-name" must name the tests that fail at red/]),
    [{ mutant: null }, /needs "mutant": \{ "breaks"/],
    [{ mutant: { breaks: ' ' } }, /needs "mutant": \{ "breaks"/],
    ...[[], 'test/greet.test.mjs', ...['../outside', './test/greet.test.mjs', 'test\\greet.test.mjs', '/abs.mjs', 'test/'].map((p) => [p])].map((frozen) => [{ frozen }, /slice "greet-by-name" needs a non-empty frozen set of repository-relative paths/]),
    ...['src/greet.mjs', ['../greet.mjs']].map((stubs) => [{ stubs }, /slice "greet-by-name" needs "stubs" as a list of repository-relative paths/]),
    [{ stubs: ['test/greet.test.mjs'] }, /slice "greet-by-name" cannot both freeze and stub test\/greet\.test\.mjs/],
    [{ exhibit: { none: 'the diff is the change' } }, /no slice promises an exhibit/],
    ...[undefined, { shows: 'x', form: 'gif' }, { form: 'output' }, { shows: ' ', form: 'output' }, { none: '' }, { shows: 'x', form: 'output', command: '' }].map((exhibit) => [{ exhibit }, /slice "greet-by-name" needs "exhibit"/]),
    [{ ...sub, substitute: { reason: 'a refactor' } }, /substitute needs "broken"/],
    ...[{ file: '../src/greet.mjs' }, { file: undefined }, { find: '' }, { find: 3 }, { replace: 3 }, { replace: MUTANTS['greet-by-name'].find }].map((edit) => [broken(edit), /substitute needs "broken": \{ file, find, replace \}, the broken state its tests must fail on/]),
    [{ ...sub, substitute: { broken: MUTANTS['greet-by-name'] } }, /substitute needs the reason no red exists/],
    [{ ...sub, substitute: { ...sub.substitute, reason: ' ' } }, /substitute needs the reason no red exists/],
    [{ ...sub, substitute: { kind: 'probe', ...sub.substitute } }, /substitute declares only "broken" and "reason", not "kind"/],
    // Its tests pin code that exists, so one dispatch never writes both the tests and a stub's code.
    [{ ...sub, stubs: ['src/greet.mjs'] }, /slice "greet-by-name" substitute declares no stubs: its tests pin code that already exists/],
    // Its broken state breaks the product code its tests pin, as a mutant does: never a test or what judges one.
    [broken({ file: 'test/greet.test.mjs' }), /substitute's broken state edits test\/greet\.test\.mjs, which is in a frozen set or protected/],
  ];
  for (const [over, pattern] of rows) assert.match(problems({ slices: [{ ...SLICE, ...over }] }), pattern, JSON.stringify(over));
  assert.match(problems({ slices: [broken({ file: 'tools/extract.mjs' })] }, ['tools']), /substitute's broken state edits tools\/extract\.mjs, which is in a frozen set or protected/);
});

test('the next slice is the first whose dependencies landed, and an amended plan keeps every landed slice as it was', () => {
  const farewellFirst = { slices: [FAREWELL, SLICE] };
  assert.equal(nextSlice(farewellFirst, []).id, 'greet-by-name');
  assert.equal(nextSlice(farewellFirst, ['greet-by-name']).id, 'say-farewell');
  assert.equal(nextSlice(farewellFirst, ['greet-by-name', 'say-farewell']), null);
  const run = { practices: ALL_PRACTICES, adapters: { suites: SUITES }, protect: [], landed: ['greet-by-name'], plan: farewellFirst };
  assert.deepEqual(checkApproval(farewellFirst, run, ['greets-by-name']), []);
  for (const plan of [{ slices: [{ ...FAREWELL, dependsOn: [] }] }, { slices: [{ ...SLICE, outcome: 'greet says hello' }, FAREWELL] }]) {
    assert.match(checkApproval(plan, run, ['greets-by-name']).join('\n'), /slice "greet-by-name" has landed, so the plan may not change or drop it/, JSON.stringify(plan));
  }
});

test('the plan step points at the admitted design and shows every form an exhibit takes', async () => {
  const f = fixture();
  const text = await walk(f, 'plan');
  assert.ok(text.includes(`Plan the delivery of the design as the run admitted it (git show ${f.runState().startCommit}:docs/prs/PROJ-1/blueprint.md) as a`), text);
  assert.match(text, /"exhibit": \{ "shows": [^\n]+ \} \| \{ "none": "<why it shows nothing the diff does not>" \},\n/);
});

test("a plan whose substitute's broken state edits a test or a protected path is refused, since its red would prove nothing", async () => {
  const f = fixture();
  await walk(f, 'plan');
  const sub = (file, find, replace) => ({ ...SLICE, stubs: [], mutant: undefined, test: { suite: 'node', files: SLICE.test.files }, substitute: { broken: { file, find, replace }, reason: 'a refactor' } });
  for (const [broken, pattern] of [[['test/greet.test.mjs', 'assert.ok(true)', 'assert.ok(false)'], /edits test\/greet\.test\.mjs, which is in a frozen set or protected/], [['.blueprint.config.json', 'node', 'true'], /edits \.blueprint\.config\.json, which is in a frozen set or protected/]]) {
    f.write(`docs/prs/${KEY}/foreman/plan.json`, JSON.stringify({ slices: [sub(...broken)] }));
    refused(await f.engine('record', KEY, 'plan'), pattern);
  }
});

test("Red records its agent id, and Green is another dispatch", async () => {
  const f = fixture();
  await walk(f, 'red');
  f.write('test/greet.test.mjs', TEST_FILE);
  f.write('src/greet.mjs', RED_STUB);
  f.commit('red', ['test/greet.test.mjs', 'src/greet.mjs']);
  assert.match(refused(await f.engine('record', KEY, 'red'), /record the Red dispatch's agent id/), /When done, record it: node \S+ record PROJ-1 red <the Red dispatch's agent id>/);
  await ok(f, 'record', KEY, 'red', 'agent-red');
  f.write('src/greet.mjs', GREEN_CODE);
  f.commit('green', ['src/greet.mjs']);
  refused(await f.engine('record', KEY, 'green', 'agent-red'), /the green must come from a different dispatch than the Red that wrote the tests/);
  assert.equal(f.runState().slice.budget, 3, 'nothing is spent');
  assert.match(await ok(f, 'record', KEY, 'green', 'agent-green'), /step: mutant/);
  assert.deepEqual(f.runState().authors, ['agent-red', 'agent-green']);
});

test('a red out of bounds spends an attempt, a green that commits nothing or names no Green is refused, and a failing exhibit command sends the slice back to red', async () => {
  const f = fixture();
  const commanded = { ...SLICE, exhibit: { ...SLICE.exhibit, command: `node -e "process.exit(require('fs').existsSync('docs/prs/${KEY}/foreman/no-exhibit') ? 3 : 0)"` } };
  await walk(f, 'red', { slices: [commanded] });
  f.write('test/greet.test.mjs', TEST_FILE);
  f.write('src/greet.mjs', RED_STUB);
  f.write('README.md', '# strayed\n');
  f.commit('red that strays', ['test/greet.test.mjs', 'src/greet.mjs', 'README.md']);
  const strayed = refused(await f.engine('record', KEY, 'red', 'agent-red'), /outside what this step may change: README\.md\n {2}- this spends an attempt \(2 left\)\n\nFirst, restore the code to /);
  assert.deepEqual([f.runState().slice.attempt, f.runState().slice.budget], [2, 2]);
  restore(f, strayed);
  // Every run but the accepted green's writes its exhibits where they are discarded, whatever the
  // environment the engine runs in names.
  const elsewhere = scratchDir('blueprint-foreman-elsewhere-');
  const inherited = process.env.BLUEPRINT_FOREMAN_EXHIBITS;
  process.env.BLUEPRINT_FOREMAN_EXHIBITS = elsewhere;
  try {
    await walk(f, 'green');
  } finally {
    if (inherited === undefined) delete process.env.BLUEPRINT_FOREMAN_EXHIBITS;
    else process.env.BLUEPRINT_FOREMAN_EXHIBITS = inherited;
  }
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  refused(await f.engine('record', KEY, 'green', 'agent-green'), /nothing was committed since [0-9a-f]{40}/);
  f.write('src/greet.mjs', GREEN_CODE);
  f.commit('green', ['src/greet.mjs']);
  refused(await f.engine('record', KEY, 'green'), /record the Green dispatch's agent id/);
  assert.equal(f.runState().slice.budget, 2, 'neither spends an attempt');
  f.write(`docs/prs/${KEY}/foreman/no-exhibit`, '');
  const failed = refused(await f.engine('record', KEY, 'green', 'agent-green'), /the exhibit command failed \(exit 3\)/);
  assert.match(failed, /step: red/);
  restore(f, failed);
  fs.rmSync(path.join(f.root, `docs/prs/${KEY}/foreman/no-exhibit`));
  // The proof run clears what an earlier run left among the slice's exhibits before it writes them.
  await walk(f, 'green');
  f.write(`docs/prs/${KEY}/foreman/exhibits/greet-by-name/stale.txt`, 'left over\n');
  await walk(f, 'mutant');
  assert.deepEqual(f.runState().slice.exhibits.map((e) => e.file), [GREETING]);
});

test('a red that fails on an import error is refused and spends an attempt', async () => {
  const f = fixture();
  await walk(f, 'red');
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit('red without a stub', ['test/greet.test.mjs']);
  const text = refused(await f.engine('record', KEY, 'red', 'agent-red'), /failed to load or collect/);
  assert.match(text, /spends an attempt \(2 left\)\n\nFirst, restore the code to [0-9a-f]+, keeping the run state: git restore [^\n]+\n\nThen commit the run state/);
  exhibit('refusal-red-import-error', `$ engine record ${KEY} red\n${text}`);
  assert.match(text, /step: red/);
  assert.equal(f.runState().slice.budget, 2);
  // The next Red is told why the last attempt was spent.
  assert.match(f.read(`docs/prs/${KEY}/foreman/briefs/greet-by-name-red-2.md`), /\nAttempt 1 was spent, and the code restored, because:\n {2}-[^\n]*test[\\/]greet\.test\.mjs failed to load or collect: /);
  assert.doesNotMatch(f.read(`docs/prs/${KEY}/foreman/briefs/greet-by-name-red-1.md`), /was spent/);
});

test('a red that fails on a runtime error rather than an assertion is refused', async () => {
  const f = fixture();
  await walk(f, 'red');
  f.write('test/greet.test.mjs', TEST_FILE);
  f.write('src/greet.mjs', "export function greet(name) {\n  return name.nope.length;\n}\n");
  f.commit('red that crashes', ['test/greet.test.mjs', 'src/greet.mjs']);
  refused(await f.engine('record', KEY, 'red', 'agent-red'), /failed, but not on an assertion: TypeError/);
});

test('a green that changes a locked scaffold line is refused, naming the line', async () => {
  const f = fixture({ scaffold: true });
  await walk(f, 'green', { slices: [SCAFFOLDED] });
  f.write('src/greet.mjs', FILLED.replace('greet(name)', 'greet(person)').replace('${name}', '${person}'));
  f.commit(`feat(${KEY}): greet-by-name`, ['src/greet.mjs']);
  const text = refused(await f.engine('record', KEY, 'green', 'agent-green'), /src\/greet\.mjs:2: the scaffold line "export function greet\(name\) \{" \(line 2 at the scaffold\) was changed, removed, commented out or quoted/);
  assert.match(text, /of the scaffold, only its TODO\(scaffold\) lines may change/);
  assert.match(text, /step: green/);
  assert.equal(f.runState().slice.budget, 2);
  // The next Green is told why.
  assert.match(f.read(`docs/prs/${KEY}/foreman/briefs/greet-by-name-green-2.md`), /Attempt 1 was spent[^\n]+\n {2}- src\/greet\.mjs:2: the scaffold line "export function greet\(name\) \{"/);
  exhibit('refusal-green-changes-locked-line', `$ engine record ${KEY} green agent-green\n${text}`);
});

test('an attribute hides no line from the lock or a reviewer: a step may not commit one, and one no commit shows is read past', async () => {
  const f = fixture({ scaffold: true });
  await walk(f, 'green', { slices: [SCAFFOLDED] });
  // `-diff` makes git call the file binary, so a diff of it holds no line for the lock to take.
  const renamed = FILLED.replace('greet(name)', 'greet(person)').replace('${name}', '${person}');
  f.write('.gitattributes', 'src/** -diff\n');
  f.write('src/greet.mjs', renamed);
  f.commit(`feat(${KEY}): greet-by-name`, ['.gitattributes', 'src/greet.mjs']);
  restore(f, refused(await f.engine('record', KEY, 'green', 'agent-green'), /no step may change a protected path: \.gitattributes[\s\S]*spends an attempt/));
  // The same attribute in the checkout's git directory, where no commit shows it.
  fs.writeFileSync(path.join(f.root, '.git', 'info', 'attributes'), '* -diff\n');
  f.write('src/greet.mjs', renamed);
  f.commit(`feat(${KEY}): greet-by-name`, ['src/greet.mjs']);
  restore(f, refused(await f.engine('record', KEY, 'green', 'agent-green'), /src\/greet\.mjs:2: the scaffold line "export function greet\(name\) \{" \(line 2 at the scaffold\) was changed/));
  await walk(f, 'group-review');
  assert.match(f.read(`docs/prs/${KEY}/foreman/review/greet-by-name-${f.runState().slice.attempt}/group-1.diff`), /^\+ {2}return `Hello, \$\{name\}`;$/m, 'the Reviewers read the change as text');
});

test('every diff the engine reads is text, whatever an attribute or a driver says of the file', () => {
  const f = fixture();
  f.write('src/x.mjs', 'a\nb\n');
  f.commit('x', ['src/x.mjs']);
  f.write('src/x.mjs', 'a\nB\nc\n');
  f.commit('x again', ['src/x.mjs']);
  // Drivers only the checkout's configuration defines, which no commit shows: one that converts the
  // file to nothing, and an external diff that prints nothing.
  f.sh('config', 'diff.hide.textconv', 'true');
  f.sh('config', 'diff.none.command', 'true');
  const { git } = f.ctx;
  for (const attribute of ['-diff', 'diff=hide', 'diff=none']) {
    fs.writeFileSync(path.join(f.root, '.git', 'info', 'attributes'), `* ${attribute}\n`);
    const read = { diffText: git.diffText('HEAD~1', 'HEAD'), rangeFileDiff: git.rangeFileDiff('HEAD~1', 'HEAD', 'src/x.mjs'), commitFileDiff: git.commitFileDiff('HEAD', 'src/x.mjs') };
    for (const [how, text] of Object.entries(read)) assert.match(text, /^\+B\n\+c$/m, `${how}, with ${attribute}`);
  }
});

test('a green whose run lacks a test the slice names is refused, and one whose proof run writes no promised exhibit is sent back to red', async () => {
  const f = fixture();
  // Red's tests write no exhibit, and lose the named test once the product exports `hidden`.
  const hiding = TEST_FILE.replace(/ {2}if \(process\.env[^\n]+\n/, '')
    .replace("import { greet } from '../src/greet.mjs';", "import * as greeting from '../src/greet.mjs';\nconst { greet } = greeting;")
    .replace('export const tests = [', "export const tests = greeting.hidden ? [{ name: 'greet hides', fn: () => {} }] : [");
  await walk(f, 'green', { red: { 'test/greet.test.mjs': hiding } });
  f.write('src/greet.mjs', `${GREEN_CODE}export const hidden = true;\n`);
  f.commit('green that hides the named test', ['src/greet.mjs']);
  restore(f, refused(await f.engine('record', KEY, 'green', 'agent-green'), /the report has no test named "greet names the person"/));
  f.write('src/greet.mjs', GREEN_CODE);
  f.commit('green', ['src/greet.mjs']);
  const text = refused(await f.engine('record', KEY, 'green', 'agent-green'), /promises an exhibit \(the greeting greet returns for Ada\), but its proof run wrote nothing to \$BLUEPRINT_FOREMAN_EXHIBITS/);
  assert.match(text, /step: red/);
});

test('a slice that promises no exhibit keeps none, whatever its tests write', async () => {
  const f = fixture();
  const quiet = { ...SLICE, id: 'greet-quietly', exhibit: { none: 'the greeting is the test text' } };
  await walk(f, 'mutant', { slices: [quiet, { ...SLICE, dependsOn: ['greet-quietly'] }] });
  assert.deepEqual(f.runState().slice.exhibits, []);
  assert.equal(fs.existsSync(path.join(f.root, `docs/prs/${KEY}/foreman/exhibits/greet-quietly`)), false);
});

test('an exhibit is a regular file with something in it, and a directory not there holds none', () => {
  const root = scratchDir('blueprint-foreman-exhibits-');
  const dir = path.join(root, 'docs', 'prs', KEY, 'foreman', 'exhibits', 'a');
  assert.deepEqual(exhibitsIn(root, dir), []);
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'said.txt'), 'hi\n');
  fs.writeFileSync(path.join(dir, 'empty.txt'), '');
  fs.writeFileSync(path.join(dir, 'shots', 'one.png'), 'png');
  // A link is no regular file, whatever it points at, where the platform lets a test make one.
  try {
    fs.symlinkSync(path.join(dir, 'said.txt'), path.join(dir, 'link.txt'), 'file');
  } catch {}
  assert.deepEqual(exhibitsIn(root, dir), [`docs/prs/${KEY}/foreman/exhibits/a/said.txt`, `docs/prs/${KEY}/foreman/exhibits/a/shots/one.png`]);
});

test('an exhausted budget, with no replan left in the cycle, stops the run', async () => {
  const f = fixture();
  f.ctx.config.replans = 0;
  await walk(f, 'red');
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit('red without a stub', ['test/greet.test.mjs']);
  await f.engine('record', KEY, 'red', 'agent-red');
  await f.engine('record', KEY, 'red', 'agent-red');
  // The code is restored first, then the run state committed, so it comes to rest on the restored code.
  const text = refused(await f.engine('record', KEY, 'red', 'agent-red'), /has used all its attempts, and the run stops\n\nFirst, restore the code to [0-9a-f]+, keeping the run state: git restore [^\n]+\n\nThen commit the run state, then push it: git add /);
  assert.match(text, /step: stopped/);
  assert.match(text, /--trailer 'Foreman-Cycle: 1' --trailer 'Foreman-Stop: 1' --trailer 'Foreman-Run: PROJ-1 stopped' --trailer 'Blueprint-Status: needs-human' -- 'docs\/prs\/PROJ-1\/foreman'$/m);
  exhibit('refusal-exhausted-budget', `$ engine record ${KEY} red\n${text}`);
  assert.match(text, /The run goes on at a fire that carries the answer\./);
  assert.equal(f.runState().step, 'stopped');
});

test('what landed must go on passing: a later red or green that breaks it, or a green that edits its tests, is refused', async () => {
  const f = fixture();
  // The second red is the second slice's, once the first landed; it may stub greet's module too.
  await walk(f, 'red', { slices: [SLICE, { ...FAREWELL, stubs: [...FAREWELL.stubs, 'src/greet.mjs'] }] });
  await walk(f, 'red');
  assert.equal(f.runState().slice.id, 'say-farewell');
  assert.match(f.read(`docs/prs/${KEY}/foreman/briefs/say-farewell-red-1.md`), /The tests of the slices that landed \(greet-by-name\) must go on passing/);
  f.write('test/farewell.test.mjs', FAREWELL_TEST);
  f.write('src/farewell.mjs', FAREWELL_STUB);
  f.write('src/greet.mjs', RED_STUB);
  f.commit('red that breaks what landed', ['test/farewell.test.mjs', 'src/farewell.mjs', 'src/greet.mjs']);
  restore(f, refused(await f.engine('record', KEY, 'red', 'agent-red'), /what landed \(greet-by-name\) no longer passes: "greet names the person" no longer passes \(failed\)\n {2}- this spends an attempt \(2 left\)/));
  await walk(f, 'green');
  f.write('src/farewell.mjs', FAREWELL_CODE);
  f.write('src/greet.mjs', GREEN_CODE.replace('Hello, ', 'Yo, '));
  f.commit('green for say-farewell', ['src/farewell.mjs', 'src/greet.mjs']);
  const broke = refused(await f.engine('record', KEY, 'green', 'agent-green'), /what landed \(greet-by-name\) no longer passes: "greet names the person" no longer passes \(failed\)/);
  assert.match(broke, /step: green/);
  exhibit('refusal-green-breaks-what-landed', `$ engine record ${KEY} green agent-green\n${broke}`);
  f.sh('restore', `--source=${f.runState().slice.redCommit}`, '--staged', '--worktree', '--', '.', `:(exclude)docs/prs/${KEY}/foreman`);
  f.sh('commit', '--quiet', '-m', 'return');
  f.write('src/farewell.mjs', FAREWELL_CODE);
  f.write('test/greet.test.mjs', TEST_FILE.replace("'Hello, Ada'", 'said'));
  f.commit('green that edits a landed test', ['src/farewell.mjs', 'test/greet.test.mjs']);
  assert.match((await f.engine('record', KEY, 'green', 'agent-green')).text, /outside what this step may change: test\/greet\.test\.mjs/);
});

test("a later red may add tests beside what landed but not weaken them, and may turn a test it names red", async () => {
  const f = fixture();
  // A test from before the run, which the second slice changes on purpose.
  f.write('test/shout.test.mjs', "import assert from 'node:assert/strict';\nexport const tests = [{ name: 'shout uppercases', fn: () => assert.equal('a'.toUpperCase(), 'A') }];\n");
  f.commit('an existing test', ['test/shout.test.mjs']);
  const greet = { ...SLICE, test: { ...SLICE.test, files: ['test/greet.test.mjs', 'test/shout.test.mjs'] }, frozen: [...SLICE.frozen, 'test/shout.test.mjs'] };
  const turn = { ...FAREWELL, test: { suite: 'node', files: ['test/farewell.test.mjs', 'test/shout.test.mjs'], expectFail: ['farewell names the person', 'shout uppercases'] }, frozen: ['test/farewell.test.mjs', 'test/shout.test.mjs', 'test/greet.test.mjs'] };
  await walk(f, 'red', { slices: [greet, turn] });
  await walk(f, 'red');
  assert.ok(f.runState().passing['greet-by-name'].includes('shout uppercases'));
  // Weakening greet-by-name's test, keeping its name, trips the lock on what landed.
  f.write('test/greet.test.mjs', TEST_FILE.replace("assert.equal(said, 'Hello, Ada');", 'assert.ok(true);'));
  f.write('test/farewell.test.mjs', FAREWELL_TEST);
  f.write('src/farewell.mjs', FAREWELL_STUB);
  f.commit('red that weakens a landed test', ['test/greet.test.mjs', 'test/farewell.test.mjs', 'src/farewell.mjs']);
  const weak = await f.engine('record', KEY, 'red', 'agent-red');
  assert.match(weak.text, /test\/greet\.test\.mjs:\d+: the line "assert\.equal\(said, 'Hello, Ada'\);" of greet-by-name's tests \(line \d+ when it landed\) was changed or removed/);
  f.sh('restore', `--source=${f.runState().slice.base}`, '--staged', '--worktree', '--', '.', `:(exclude)docs/prs/${KEY}/foreman`);
  f.sh('commit', '--quiet', '-m', 'return');
  // Code inserted within a landed line disarms it as surely, though every token of it stays.
  f.write('test/greet.test.mjs', TEST_FILE.replace("assert.equal(said, 'Hello, Ada');", "0 && assert.equal(said, 'Hello, Ada');"));
  f.write('test/farewell.test.mjs', FAREWELL_TEST);
  f.write('src/farewell.mjs', FAREWELL_STUB);
  f.commit('red that disarms a landed test', ['test/greet.test.mjs', 'test/farewell.test.mjs', 'src/farewell.mjs']);
  const disarmed = await f.engine('record', KEY, 'red', 'agent-red');
  assert.match(disarmed.text, /test\/greet\.test\.mjs:\d+: the line "assert\.equal\(said, 'Hello, Ada'\);" of greet-by-name's tests \(line \d+ when it landed\) was changed or removed/);
  f.sh('restore', `--source=${f.runState().slice.base}`, '--staged', '--worktree', '--', '.', `:(exclude)docs/prs/${KEY}/foreman`);
  f.sh('commit', '--quiet', '-m', 'return');
  // Turning the older test red, as the slice names, is a red and no regression.
  f.write('test/shout.test.mjs', "import assert from 'node:assert/strict';\nexport const tests = [{ name: 'shout uppercases', fn: () => assert.equal('a'.toUpperCase(), 'A!') }];\n");
  f.write('test/farewell.test.mjs', FAREWELL_TEST);
  f.write('src/farewell.mjs', FAREWELL_STUB);
  f.commit('red', ['test/shout.test.mjs', 'test/farewell.test.mjs', 'src/farewell.mjs']);
  assert.match(await ok(f, 'record', KEY, 'red', 'agent-red'), /step: green/);
});

test('the lock reads scaffold paths with spaces and accents, and sees a line commented out or quoted', () => {
  const f = fixture();
  const file = 'src/grüße mit space.mjs';
  f.write(file, SCAFFOLD);
  f.commit('scaffold', [file], `Blueprint-Scaffold: ${KEY}`);
  const sha = f.sh('rev-parse', 'HEAD');
  const git = createGit(f.root);
  assert.deepEqual(checkLock(git, sha, 'HEAD'), []);
  f.write(file, FILLED);
  f.commit('fill the gap', [file]);
  assert.deepEqual(checkLock(git, sha, 'HEAD'), [], 'filling the gap keeps every locked line');
  f.write(file, `/*\n${FILLED}*/\n`);
  f.commit('comment the scaffold out', [file]);
  const findings = checkLock(git, sha, 'HEAD');
  assert.deepEqual(findings.map((x) => [x.file, x.line]), [[file, 2], [file, 4]], 'a comment is not code, so the scaffold is gone');
  assert.match(findings[0].claim, /changed, removed, commented out or quoted/);
  f.write(file, `const dead = \`\n${FILLED.replaceAll('`', "'")}\`;\n`);
  f.commit('quote the scaffold away', [file]);
  assert.deepEqual(checkLock(git, sha, 'HEAD').map((x) => x.line), [2, 4], 'a quoted scaffold is not the scaffold');
  // What the scaffold wrote survives formatting and anything added within its lines.
  f.write(file, "// greet, as the scaffold placed it.\nexport function greet(\n  name,\n  { polite } = {},\n) {\n  return polite ? `Good day, ${name}` : `Hello, ${name}`;\n}\n");
  f.commit('reformat and extend', [file]);
  assert.deepEqual(checkLock(git, sha, 'HEAD'), []);
});

test('a string holding a comment opener does not make the lock misread the lines after it', () => {
  const f = fixture();
  const file = 'src/upload.tsx';
  // Read as code, the glob's `/*` would open a comment nothing in the scaffold closes, and Green's
  // JSDoc would then close it, as if every later line had moved out of a comment.
  const scaffold = "// the picker, as the scaffold placed it.\nexport const glob = '**/*.ts';\nexport const Picker = () => <input accept=\"image/*\" />;\nexport function pick() {\n  return null; // TODO(scaffold): what is picked\n}\n";
  f.write(file, scaffold);
  f.commit('scaffold', [file], `Blueprint-Scaffold: ${KEY}`);
  const sha = f.sh('rev-parse', 'HEAD');
  f.write(file, scaffold.replace('  return null; // TODO(scaffold): what is picked', '  /** The first file. */\n  return files[0];'));
  f.commit('fill the gap', [file]);
  assert.deepEqual(checkLock(createGit(f.root), sha, 'HEAD'), []);
});

test('a slice in a JUnit suite runs from its cwd with its env, and a module that fails to load or a crash is no red', async () => {
  const f = fixture();
  const slice = { ...SLICE, test: { suite: 'junit', files: ['test/greet.test.mjs'], expectFail: ['greet.test.mjs greet names the person'] }, frozen: ['test/greet.test.mjs', 'run-junit.mjs'] };
  await walk(f, 'red', { slices: [slice] });
  assert.match(f.read(`docs/prs/${KEY}/foreman/briefs/greet-by-name-red-1.md`), /Run the suite as the engine does, to see the failure you expect: node \.\.\/run-junit\.mjs 'greet\.test\.mjs' \(from test, with JUNIT_REPORT=\{report\}; \{report\} is any path\)\./);
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit('red without a stub', ['test/greet.test.mjs']);
  restore(f, refused(await f.engine('record', KEY, 'red', 'agent-red'), /greet\.test\.mjs failed to load or collect: Error \[ERR_MODULE_NOT_FOUND\]/));
  f.write('test/greet.test.mjs', TEST_FILE);
  f.write('src/greet.mjs', 'export function greet(name) {\n  return name.nope.length;\n}\n');
  f.commit('red that crashes', ['test/greet.test.mjs', 'src/greet.mjs']);
  restore(f, refused(await f.engine('record', KEY, 'red', 'agent-red'), /"greet\.test\.mjs greet names the person" failed, but not on an assertion: Cannot read properties of undefined/));
  // Red, green, the mutant and the replays in their scratch checkout all read the JUnit report.
  await walk(f, 'group-review');
  assert.deepEqual(f.runState().slice.passing, ['greet.test.mjs greet names the person']);
  assert.equal(f.read(GREETING), "greet('Ada') returns: Hello, Ada\n", 'the proof run wrote the exhibit');
});

test('the skill, every step and every brief the engine writes keep the work inside the two clones', async () => {
  const f = fixture({ scaffold: true });
  const rule = containment(f.root);
  assert.ok(rule.includes(f.root) && rule.includes(PLUGIN_DIR), rule);
  // Every step a session reads, each dispatch among them, carries the rule.
  const steps = [];
  for (let records = 0; records < 40 && !(f.hasRun() && f.runState().step === 'settle'); records += 1) {
    const run = f.hasRun() ? f.runState() : null;
    const out = await ACTS[run?.step ?? 'wake'](f, run, { slices: [SCAFFOLDED] });
    assert.equal(out.code, 0, out.text);
    if (/· step: /.test(out.text)) steps.push(out.text);
  }
  assert.equal(f.runState().step, 'settle');
  assert.ok(steps.filter((t) => t.includes('Dispatch a fresh')).length >= 5, 'the steps dispatch subagents');
  for (const text of steps) assert.ok(text.includes(`For the session, and for every subagent it dispatches in its dispatch: ${rule}`), text);
  // Every brief the engine wrote carries it too.
  const dir = path.join(f.root, 'docs', 'prs', KEY, 'foreman', 'briefs');
  const briefs = fs.readdirSync(dir);
  // Every role's, each reviewer's and gate's among them, so the session passes each on whole.
  assert.deepEqual(briefs.sort(), ['final-c1-r1-adversary.md', 'final-c1-r1-contract.md', 'greet-by-name-contract-1.md', 'greet-by-name-green-1.md', 'greet-by-name-mutant-1.md', 'greet-by-name-red-1.md', 'greet-by-name-reviewer-1-1.md', 'plan-c1-r1-adversary.md']);
  // Each dispatch names its brief as the whole prompt, and the brief it names is there.
  for (const text of steps) {
    for (const [, brief] of text.matchAll(/whose whole prompt is "Follow the brief in ([^"]+)\."/g)) assert.ok(fs.existsSync(path.join(f.root, brief)), brief);
  }
  assert.equal(steps.flatMap((t) => [...t.matchAll(/Dispatch a fresh /g)]).length, steps.flatMap((t) => [...t.matchAll(/whose whole prompt is "Follow the brief in /g)]).length, 'every dispatch names a brief');
  for (const b of briefs) assert.ok(fs.readFileSync(path.join(dir, b), 'utf8').trimEnd().endsWith(rule), b);
  // And the skill states it for the session.
  assert.match(fs.readFileSync(new URL('../skills/blueprint-foreman/SKILL.md', import.meta.url), 'utf8'), /Work stays inside those two clones: read and search nothing outside them, and run every command from\nthe repository's root\./);
});
