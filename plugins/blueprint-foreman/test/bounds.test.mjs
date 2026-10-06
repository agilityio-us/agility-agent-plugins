// Offline tests for each step's bounds, the restore, and the run state the engine keeps and prints:
// `node --test plugins/blueprint-foreman/test/bounds.test.mjs`; their fixture is fixture.mjs.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { checkBounds } from '../lib/bounds.mjs';
import { KEY, BRANCH, DESIGN, EXTRACTOR, TEST_FILE, SLICE, SCAFFOLDED, FAREWELL, RED_STUB, GREEN_CODE, NOTES, allMet, fixture, ok, refused, walk, shell, restore, commitRun, exhibit, answer, DESIGN_FILE, fire, GREET_ROW, proposes } from './fixture.mjs';

test('every record needs a clean tree outside the run directory and no merge, and red and green must commit', async () => {
  const f = fixture();
  await walk(f, 'gate');
  // The run directory is docs/prs/PROJ-1/foreman/ itself; a directory beside it that shares its prefix is not.
  f.write(`docs/prs/${KEY}0/foreman/note.md`, 'another run');
  refused(await f.engine('record', KEY, 'gate'), /commit or discard every change first; uncommitted: docs\/prs\/PROJ-10\/foreman\/note\.md$/m);
  fs.rmSync(path.join(f.root, `docs/prs/${KEY}0/foreman`), { recursive: true });
  await walk(f, 'red');
  refused(await f.engine('record', KEY, 'red', 'agent-red'), /nothing was committed since [0-9a-f]+$/m);
  f.sh('switch', '--quiet', 'master');
  f.write('VERSION', '2\n');
  f.commit('someone else ships', ['VERSION']);
  f.sh('switch', '--quiet', BRANCH);
  f.sh('merge', '--quiet', '--no-edit', 'master');
  const merged = refused(await f.engine('record', KEY, 'red', 'agent-red'), /took in merge [0-9a-f]+ since [0-9a-f]+, and a run judges merged work only when it wakes at rest/);
  assert.doesNotMatch(merged, /spends an attempt|git restore/, 'a merge is no failed try, and restoring would undo the merged work');
  assert.equal(f.runState().slice.budget, 3);
});

test('uncommitted work is refused without spending an attempt, even with the run state tracked', async () => {
  const f = fixture();
  await walk(f, 'red');
  // With tmp/ tracked and modified, its porcelain line starts with a space, which must still parse.
  f.commit('track the run state', [`docs/prs/${KEY}/foreman`]);
  f.write(`docs/prs/${KEY}/foreman/plan.json`, JSON.stringify({ slices: [SLICE], touched: true }));
  f.write('test/greet.test.mjs', TEST_FILE);
  const text = refused(await f.engine('record', KEY, 'red', 'agent-red'), /uncommitted: test\/greet\.test\.mjs$/m);
  assert.doesNotMatch(text, /spends an attempt/);
  assert.equal(f.runState().slice.budget, 3);
});

test('a red that touches product code outside its stubs is refused', async () => {
  const f = fixture();
  await walk(f, 'red');
  f.write('test/greet.test.mjs', TEST_FILE);
  f.write('src/greet.mjs', RED_STUB);
  f.write('src/other.mjs', 'export const x = 1;\n');
  f.commit('red with extra', ['test/greet.test.mjs', 'src/greet.mjs', 'src/other.mjs']);
  refused(await f.engine('record', KEY, 'red', 'agent-red'), /outside what this step may change: src\/other\.mjs/);
});

test('a green that changed the frozen set is refused and sent back to green', async () => {
  const f = fixture();
  await walk(f, 'green');
  f.write('src/greet.mjs', GREEN_CODE);
  f.write('test/greet.test.mjs', TEST_FILE.replace("'Hello, Ada'", "greet('Ada')"));
  f.commit('green that edits the test', ['src/greet.mjs', 'test/greet.test.mjs']);
  const text = refused(await f.engine('record', KEY, 'green', 'agent-green'), /outside what this step may change: test\/greet\.test\.mjs/);
  assert.match(text, /step: green/);
  exhibit('refusal-green-changed-frozen-set', `$ engine record ${KEY} green agent-green\n${text}`);
  // A rename is seen through its old path too.
  restore(f, text);
  f.sh('mv', 'test/greet.test.mjs', 'test/moved.test.mjs');
  f.write('src/greet.mjs', GREEN_CODE);
  f.sh('add', 'src/greet.mjs');
  f.sh('commit', '--quiet', '-m', 'green that moves the test');
  refused(await f.engine('record', KEY, 'green', 'agent-green'), /outside what this step may change: test\/greet\.test\.mjs/);
});

test('the plan the gate approved binds the run, whatever plan.json says later', async () => {
  const f = fixture();
  await walk(f, 'red');
  f.write(`docs/prs/${KEY}/foreman/plan.json`, JSON.stringify({ slices: [SLICE, FAREWELL] }));
  // The plan the gate approved is the one the run keeps; editing plan.json now changes nothing.
  assert.deepEqual(f.runState().plan.slices.map((s) => s.id), ['greet-by-name']);
  f.write(`docs/prs/${KEY}/foreman/plan.json`, JSON.stringify({ slices: [{ ...SLICE, stubs: ['src/greet.mjs', 'src/other.mjs'] }] }));
  f.write('test/greet.test.mjs', TEST_FILE);
  f.write('src/greet.mjs', RED_STUB);
  f.write('src/other.mjs', 'export const x = 1;\n');
  f.commit('red with extra', ['test/greet.test.mjs', 'src/greet.mjs', 'src/other.mjs']);
  assert.match((await f.engine('record', KEY, 'red', 'agent-red')).text, /outside what this step may change: src\/other\.mjs/, 'the approved plan still binds red');
});

test('a commit made between steps is refused until it is returned', async () => {
  const f = fixture();
  await walk(f, 'group-review');
  const green = f.runState().slice.greenCommit;
  f.write('src/greet.mjs', GREEN_CODE.replace('Hello, ', 'Howdy, '));
  f.commit('a change no step asked for', ['src/greet.mjs']);
  const text = refused(await f.engine('record', KEY, 'groups'), new RegExp(`the branch changed since ${green}, outside what this step may change: src/greet\\.mjs`));
  assert.match(text, /step: group-review/);
  restore(f, text);
  assert.equal(f.sh('diff', '--name-only', green, 'HEAD', '--', '.', `:(exclude)docs/prs/${KEY}/foreman`), '', 'the code is back as the engine accepted it');
  await walk(f, 'contract-review');
});

test('a frozen directory freezes every file under it', async () => {
  const f = fixture();
  const slice = { ...SLICE, frozen: ['test', 'run-tests.mjs'] };
  await walk(f, 'green', { slices: [slice] });
  f.write('src/greet.mjs', GREEN_CODE);
  f.write('test/greet.test.mjs', TEST_FILE.replace("'Hello, Ada'", 'said'));
  f.commit('green that edits the test', ['src/greet.mjs', 'test/greet.test.mjs']);
  assert.match((await f.engine('record', KEY, 'green', 'agent-green')).text, /outside what this step may change: test\/greet\.test\.mjs/);
});

test('no step may change what judges it: the adapter file, the paths it protects, or a .gitattributes', async () => {
  const f = fixture();
  await walk(f, 'green');
  f.write('src/greet.mjs', GREEN_CODE);
  f.write('.blueprint.config.json', '{}\n');
  f.commit('green that edits the adapters', ['src/greet.mjs', '.blueprint.config.json']);
  const text = refused(await f.engine('record', KEY, 'green', 'agent-green'), /no step may change a protected path: \.blueprint\.config\.json/);
  assert.match(text, /this spends an attempt \(2 left\)[\s\S]*keeping the run state: git restore/, 'at green a failed try, restored');
  restore(f, text);
  // Green may change anything outside the frozen sets, so the protected paths alone keep the adapters
  // from it, a rename among the changes.
  const run = f.runState();
  const changes = [
    ['.blueprint.config.json', () => f.write('.blueprint.config.json', '{}\n')],
    ['.blueprint.config.json', () => f.sh('mv', '.blueprint.config.json', 'adapters.json')],
    // An attribute steers how git reads a file: `-diff` would hide its lines from the lock and every
    // reviewer, at any depth.
    ['.gitattributes', () => f.write('.gitattributes', 'src/** -diff\n')],
    ['test/.gitattributes', () => f.write('test/.gitattributes', '* -diff\n')],
  ];
  for (const [file, change] of changes) {
    change();
    f.sh('add', '-A', '--', '.', `:(exclude)docs/prs/${KEY}/foreman`);
    f.sh('commit', '--quiet', '-m', `a change to ${file}`);
    assert.deepEqual(checkBounds(f.ctx, run, { from: run.accepted, may: () => true }), { reasons: [`no step may change a protected path: ${file}`], restore: true }, file);
    f.sh('reset', '--quiet', '--hard', 'HEAD~1');
  }
});

test("an extractor the repository protects cannot be taught to see what the code lacks", async () => {
  const f = fixture({ protect: ['extract.mjs'] });
  await walk(f, 'green');
  f.write('src/greet.mjs', GREEN_CODE);
  f.write('extract.mjs', `${EXTRACTOR}\n// and a node nothing implements\n`);
  f.commit('green that teaches the extractor', ['src/greet.mjs', 'extract.mjs']);
  const out = await f.engine('record', KEY, 'green', 'agent-green');
  assert.match(out.text, /no step may change a protected path: extract\.mjs/);
});

test('a spent attempt keeps the tracked run state, and committing it never counts against a step', async () => {
  const f = fixture();
  await walk(f, 'red');
  f.commit('track the run state', [`docs/prs/${KEY}/foreman`]);
  const base = f.runState().slice.base;
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit('red without a stub', ['test/greet.test.mjs']);
  const out = await f.engine('record', KEY, 'red', 'agent-red');
  assert.ok(out.text.includes(`git restore --source=${base} --staged --worktree -- . ':(exclude)docs/prs/${KEY}/foreman' ':(exclude)docs/prs/${KEY}/pull-request.md' && git commit --allow-empty --quiet -m "chore(blueprint-foreman): restore ${KEY} to ${base.slice(0, 12)}"`), out.text);
  const pushed = f.sh('rev-parse', 'HEAD');
  restore(f, out.text);
  assert.equal(f.sh('rev-parse', 'HEAD~1'), pushed, 'the restore adds a commit and rewrites nothing');
  assert.equal(f.runState().slice.budget, 2, 'the restore kept the spent attempt');
  assert.equal(fs.existsSync(path.join(f.root, 'test', 'greet.test.mjs')), false);
  // The retry's commit also carries the run state.
  f.write('test/greet.test.mjs', TEST_FILE);
  f.write('src/greet.mjs', RED_STUB);
  f.commit('red', ['test/greet.test.mjs', 'src/greet.mjs', `docs/prs/${KEY}/foreman`]);
  assert.match(f.sh('show', '--name-only', '--format=', 'HEAD'), /docs\/prs\/PROJ-1\/foreman\//);
  assert.match((await f.engine('record', KEY, 'red', 'agent-red')).text, /step: green/);
});

test("the run's record is the engine's: a changed run.json is refused until it is restored", async () => {
  const f = fixture({ scaffold: true });
  await walk(f, 'red', { slices: [SCAFFOLDED] });
  const honest = f.read(`docs/prs/${KEY}/foreman/run.json`);
  f.write(`docs/prs/${KEY}/foreman/run.json`, JSON.stringify({ ...f.runState(), scaffold: null }, null, 2));
  const text = refused(await f.engine('record', KEY, 'red', 'agent-red'), /run\.json differs from the engine's own record of the run, and only the engine writes it; restore it with: cp "[^"]+" docs\/prs\/PROJ-1\/foreman\/run\.json/);
  assert.match(text, /^blueprint-foreman PROJ-1 · refused\n/, 'the session restores it, so nothing failed');
  assert.doesNotMatch(text, /git commit/);
  exhibit('refusal-changed-run-record', `$ engine record ${KEY} red\n${text}`);
  f.write(`docs/prs/${KEY}/foreman/run.json`, honest);
  assert.match(await ok(f, 'wake'), /step: red/);
});

test('a run state that says of the branch what the branch does not bear out is refused, though no copy guard it', async () => {
  const f = fixture({ scaffold: true });
  await walk(f, 'red', { slices: [SCAFFOLDED] });
  const honest = f.runState();
  // A subagent rewrites the engine's copy as easily as run.json, and a fresh clone has none to compare.
  const copy = path.join(f.root, '.git', 'blueprint-foreman', `${KEY}.json`);
  const forge = (run) => {
    for (const file of [path.join(f.root, 'docs', 'prs', KEY, 'foreman', 'run.json'), copy]) fs.writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
  };
  // The design edited in a commit of its own, where a forged admitted commit could point.
  f.write(DESIGN_FILE, DESIGN.replace('Only src/greet.mjs changes.', 'Anything may change.'));
  f.commit('an edit to the design', [DESIGN_FILE]);
  // And a merge bringing in an older commit that carries the scaffold's trailer too.
  f.sh('switch', '--quiet', 'master');
  const dated = { ...process.env, GIT_AUTHOR_DATE: '2001-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2001-01-01T00:00:00Z' };
  execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'chore: an old scaffold', '-m', `Blueprint-Scaffold: ${KEY}`], { cwd: f.root, env: dated });
  const older = f.sh('rev-parse', 'HEAD');
  f.sh('switch', '--quiet', BRANCH);
  f.sh('merge', '--quiet', '--no-ff', '--no-edit', 'master');
  const suites ={ ...honest.adapters.suites, node: { ...honest.adapters.suites.node, command: 'exit 0 {files} {report}' } };
  const cases = [
    [{ scaffold: null }, `its scaffold is null, but the latest of the commits carrying "Blueprint-Scaffold: PROJ-1" by its admitted commit, ${honest.scaffold}, is ${honest.scaffold}`],
    [{ protect: [] }, "its protected paths are not the harness's and those .blueprint-foreman.json declares at its admitted commit"],
    [{ adapters: { ...honest.adapters, suites } }, 'its adapters are not what .blueprint.config.json and .blueprint-foreman.json declare at its admitted commit'],
    [{ startCommit: '0'.repeat(40) }, `its admitted commit, ${'0'.repeat(40)}, is not on the branch`],
    // An admitted commit is a commit id, never a name or an expression git would resolve.
    [{ startCommit: 'HEAD' }, 'its admitted commit, HEAD, is not on the branch'],
    [{ startCommit: `${honest.startCommit}~1` }, `its admitted commit, ${honest.startCommit}~1, is not on the branch`],
    [{ startCommit: f.sh('rev-parse', `${honest.scaffold}~1`) }, 'by its admitted commit, none, is none'],
    // The scaffold the merge brought lies on a line apart, so none is the latest.
    [{ startCommit: f.sh('rev-parse', 'HEAD') }, [`by its admitted commit, ${honest.scaffold}, ${older}, is none`, 'the design at its admitted commit is not the one the scaffold was made from']],
  ];
  for (const [forged, why] of cases) {
    forge({ ...honest, ...forged });
    for (const out of [await f.engine('record', KEY, 'red', 'agent-red'), await f.engine('wake')]) {
      const text = refused(out, /^blueprint-foreman PROJ-1 · failed\n {2}- docs\/prs\/PROJ-1\/foreman\/run\.json disagrees with the branch, and only the engine writes it: .+\. The run cannot go on from it\n\nCommit the signal, then push it, and end the session: git commit --quiet --allow-empty --only /);
      for (const reason of [why].flat()) assert.ok(text.includes(reason), text);
    }
  }
  forge(honest);
  assert.match(await ok(f, 'wake'), /step: red/);
});

test('a run state only grows along the branch: one that holds less than a run-state commit before it is refused, though no copy guard it', async () => {
  const f = fixture();
  // A run whose every record is committed, as a session commits it: its spent attempts move the
  // accepted commit back to where each restores the code, and every load compares the whole line.
  await walk(f, 'red', { slices: [SLICE, FAREWELL], commit: true });
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit('red without a stub', ['test/greet.test.mjs']);
  restore(f, refused(await f.engine('record', KEY, 'red', 'agent-red'), /spends an attempt/));
  commitRun(f);
  await walk(f, 'mutant', { commit: true });
  // Both mutants survive, so Red's attempt is spent and the code goes back to the slice's base.
  const mutant = (find, replace, agent) => {
    f.write(`docs/prs/${KEY}/foreman/review/greet-by-name-2/mutant.json`, JSON.stringify({ file: 'src/greet.mjs', find, replace }));
    return f.engine('record', KEY, 'mutant', agent);
  };
  assert.match((await mutant('return', 'return /* mutant */', 'agent-mutant-a')).text, /A second mutant of the same behaviour/);
  commitRun(f);
  restore(f, refused(await mutant('(name) {', '(name)  {', 'agent-mutant-b'), /survived, as the first did[\s\S]*spends an attempt/));
  commitRun(f);
  await walk(f, 'red', { commit: true });
  assert.equal(f.runState().slice.id, 'say-farewell');
  const honest = f.runState();
  const copy = path.join(f.root, '.git', 'blueprint-foreman', `${KEY}.json`);
  const forge = (run) => {
    for (const file of [path.join(f.root, 'docs', 'prs', KEY, 'foreman', 'run.json'), copy]) fs.writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
  };
  const cases = [
    [{ landedTests: [] }, 'its landedTests lost or changed an entry'],
    [{ landed: [], passing: {} }, `its landed lost or changed an entry; its record of the tests slice "greet-by-name" passed when it landed changed`],
    [{ authors: honest.authors.slice(1) }, 'its authors lost or changed an entry'],
    [{ rounds: [] }, 'its rounds lost or changed an entry'],
    [{ cycle: 0 }, 'its cycle went from 1 to 0'],
    [{ accepted: honest.startCommit }, `its accepted commit, ${honest.startCommit}, does not follow ${honest.accepted} on the branch`],
  ];
  const shrunk = /docs\/prs\/PROJ-1\/foreman\/run\.json does not follow from the one in the run-state commit [0-9a-f]+: (.+)\. The run cannot go on from it\n\nCommit the signal, then push it, and end the session: .+ --trailer 'Foreman-Cycle: 1' --trailer 'Foreman-Run: PROJ-1 failed' --trailer 'Blueprint-Status: failed'$/;
  for (const [forged, why] of cases) {
    forge({ ...honest, ...forged });
    for (const out of [await f.engine('record', KEY, 'red', 'agent-red'), await f.engine('wake')]) assert.equal(shrunk.exec(refused(out, shrunk))[1], why);
  }
  // Committed as a run-state commit of its own, a forged state is still held to the one before it.
  forge({ ...honest, landedTests: [] });
  commitRun(f);
  refused(await f.engine('wake'), /the run state in the run-state commit [0-9a-f]+ does not follow from the one in the run-state commit [0-9a-f]+: its landedTests lost/);
  f.sh('reset', '--quiet', '--hard', 'HEAD~1');
  // What reviews, stops and settles add grows too, and an entry never changes in place; a restore moves
  // the accepted commit back along the line, never off it, even to a slice base forged off it.
  const master = f.sh('rev-parse', 'master');
  const finding = { at: 'gates/final-c1-r1', cycle: 1, finding: 1, file: 'src/greet.mjs', line: 1, claim: 'greet names no one' };
  const grown = { ...honest, handedOff: [finding], fixed: [finding], lessons: [{ cycle: 1, commit: null }], stops: 1, slice: { ...honest.slice, base: master } };
  forge(grown);
  commitRun(f);
  const more = [
    [{ handedOff: [] }, 'its handedOff lost or changed an entry'],
    [{ fixed: [{ ...finding, claim: 'greet names everyone' }] }, 'its fixed lost or changed an entry'],
    [{ lessons: [] }, 'its lessons lost or changed an entry'],
    [{ stops: 0 }, 'its stops went from 1 to 0'],
    [{ accepted: master }, `its accepted commit, ${master}, does not follow ${honest.accepted} on the branch`],
  ];
  for (const [forged, why] of more) {
    forge({ ...grown, ...forged });
    assert.equal(shrunk.exec(refused(await f.engine('record', KEY, 'red', 'agent-red'), shrunk))[1], why);
  }
  f.sh('reset', '--quiet', '--hard', 'HEAD~1');
  forge(honest);
  assert.match(await ok(f, 'wake'), /step: red/);
});

test("a run state changes only by the records that change it: its history, the plan and a round's findings and convergence are held along the branch", async () => {
  // A design the code does not realize, so the final gate's convergence finds something to take out.
  const design = DESIGN.replace(GREET_ROW, `${GREET_ROW}${proposes('function', 'farewell', 'greet_fn_farewell')}`);
  const f = fixture({ design });
  const copy = path.join(f.root, '.git', 'blueprint-foreman', `${KEY}.json`);
  const forge = (run) => {
    for (const file of [path.join(f.root, 'docs', 'prs', KEY, 'foreman', 'run.json'), copy]) fs.writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
  };
  const unfollowed = /docs\/prs\/PROJ-1\/foreman\/run\.json does not follow from the one in the run-state commit [0-9a-f]+: (.+)\. The run cannot go on from it\n\nCommit the signal/;
  // Each state forged in run.json and the engine's copy alike, as a subagent can, is refused at the next
  // load; the honest one loads again.
  const held = async (honest, cases) => {
    for (const [forged, why] of cases) {
      forge({ ...honest, ...forged });
      assert.equal(unfollowed.exec(refused(await f.engine('wake'), unfollowed))[1], why);
    }
    forge(honest);
    await ok(f, 'wake');
  };
  await walk(f, 'gate', { commit: true });
  let honest = f.runState();
  const frozenOff = { slices: honest.plan.slices.map((s) => ({ ...s, frozen: ['run-tests.mjs'] })) };
  await held(honest, [
    [{ history: honest.history.slice(1) }, 'its history lost or changed an entry'],
    [{ plan: frozenOff }, "its plan changed, which only a plan record or a gate's dispositions change"],
  ]);
  await walk(f, 'green', { commit: true });
  honest = f.runState();
  // A slice's frozen set, stubs and test hold while it is in flight, whatever record its history claims.
  const replanned = [...honest.history, { step: 'plan', what: 'plan', at: honest.history.at(-1).at }];
  await held(honest, [[{ plan: frozenOff, history: replanned }, 'its plan changed while slice "greet-by-name" was in flight']]);
  await walk(f, 'final', { commit: true });
  honest = f.runState();
  assert.equal(honest.convergence.findings.length, 1);
  await held(honest, [[{ convergence: { ...honest.convergence, findings: [] } }, 'its convergence changed within round 1 of the final gate']]);
  const dir = `docs/prs/${KEY}/foreman/gates/final-c1-r1`;
  f.write(`${dir}/findings.json`, JSON.stringify([{ file: 'src/greet.mjs', line: 2, claim: 'greet crashes on an empty name' }]));
  f.write(`${dir}/contract.json`, JSON.stringify(allMet(f, honest)));
  await ok(f, 'record', KEY, 'gate', 'agent-reviewer');
  commitRun(f);
  honest = f.runState();
  const carried = [{ file: 'src/greet.mjs', line: 1, claim: 'planted', carried: 'gates/final-c1-r1' }];
  await held(honest, [
    [{ gate: { ...honest.gate, findings: [] } }, 'its findings changed within round 1 of the final gate'],
    [{ gate: { ...honest.gate, carried } }, 'the findings round 1 of the final gate carries in changed within it'],
  ]);
  // Committed as a run-state commit of its own, a forged state is held to the one before it.
  forge({ ...honest, gate: { ...honest.gate, findings: [] } });
  commitRun(f);
  refused(await f.engine('wake'), /the run state in the run-state commit [0-9a-f]+ does not follow from the one in the run-state commit [0-9a-f]+: its findings changed within round 1 of the final gate/);
});

test('every record that changes the run prints the run-state commit, carrying its state in trailers', async () => {
  const f = fixture();
  // The repository ignores logs, but the run directory is committed whole, the calibration log with it.
  f.write('.gitignore', '.blueprint/\n*.log\n');
  f.commit('ignore logs', ['.gitignore']);
  const printed = (text) => /^Commit the run state, then push it: (.+)$/m.exec(text)?.[1];
  const trailers = () => f.sh('log', '-1', '--format=%(trailers:key=Foreman-Run,key=Foreman-Cycle,key=Foreman-Stop)');
  const text = await walk(f, 'red');
  shell(f, printed(text));
  assert.equal(trailers(), 'Foreman-Cycle: 1\nForeman-Run: PROJ-1 working');
  assert.match(f.sh('log', '-1', '--format=%B'), /^chore\(blueprint-foreman\): PROJ-1 working\n\nThe run reached red\./);
  assert.match(f.sh('ls-files', `docs/prs/${KEY}/foreman`), /docs\/prs\/PROJ-1\/foreman\/calibration\.log/);
  assert.equal(printed(refused(await f.engine('record', KEY, 'plan'), /step red records "red"/)), undefined, 'a refusal that changes nothing prints no commit');
  // Whatever else is staged stays out of it: the commit touches only the run directory.
  f.write('src/greet.mjs', RED_STUB);
  f.sh('add', 'src/greet.mjs');
  const stopped = await ok(f, 'record', KEY, 'need', "the sandbox's database URL,\n\nForeman-Run: PROJ-1 settled");
  shell(f, printed(stopped));
  assert.equal(trailers(), 'Foreman-Cycle: 1\nForeman-Stop: 1\nForeman-Run: PROJ-1 stopped', 'a need cannot write a trailer of its own');
  assert.match(f.sh('log', '-1', '--format=%b'), /^The run is stopped at red\. It needs: the sandbox's database URL, Foreman-Run: PROJ-1 settled/);
  assert.deepEqual(f.sh('show', '--name-only', '--format=', 'HEAD').split('\n').filter((l) => !l.startsWith(`docs/prs/${KEY}/foreman/`)), []);
  assert.equal(f.sh('diff', '--cached', '--name-only'), 'src/greet.mjs');
});

test('every signal ends in one trailer block, the signal last, and no line of its message runs past 100 columns', async () => {
  const shown = [];
  const values = { working: 'working', stopped: 'needs-human', settled: 'done', rejected: 'rejected', failed: 'failed' };
  // Makes the commit the engine printed, as the session does, and holds it to the signal: git parses
  // the trailers named, Foreman-Run naming the state, then last the signal under the fire's key, under
  // the subject that names the state or asks what a stop needs, every line within 100 columns. Each
  // message and its parse is kept for the exhibit.
  const signals = (f, text, state, trailers, subject = `chore(blueprint-foreman): ${KEY} ${state}`) => {
    shell(f, /(?:[Cc]ommit the run state, then push it|Commit the signal, then push it, and end the session): (.+)$/m.exec(text)[1]);
    const message = f.sh('log', '-1', '--format=%B');
    const parsed = execFileSync('git', ['interpret-trailers', '--parse'], { cwd: f.root, input: `${message}\n`, encoding: 'utf8' }).trim();
    assert.deepEqual(parsed.split('\n'), [...trailers, `Foreman-Run: ${KEY} ${state}`, `Blueprint-Status: ${values[state]}`], message);
    assert.equal(message.split('\n')[0], subject);
    for (const line of message.split('\n')) assert.ok(line.length <= 100, `${line.length} columns: ${line}`);
    shown.push(`${state}: git log -1 --format=%B\n\n${message}\n\n${state}: git log -1 --format=%B | git interpret-trailers --parse\n\n${parsed}`);
    return message;
  };
  // An intake the design falls short of is rejected; one the routine falls short of, failed.
  const misdesigned = fixture({ design: DESIGN.replace(`key: ${KEY}`, "key: PROJ-9") });
  signals(misdesigned, refused(await misdesigned.engine('wake'), /PROJ-1 · rejected\n/), 'rejected', []);
  const uninstalled = fixture({ install: 'exit 3' });
  signals(uninstalled, refused(await uninstalled.engine('wake'), /PROJ-1 · failed\n/), 'failed', []);
  // A run working, stopped on a need too long for a line, failing at a wake, and rejected.
  const f = fixture({ install: 'node install.mjs' });
  signals(f, await walk(f, 'red'), 'working', ['Foreman-Cycle: 1']);
  const token = 'x'.repeat(150);
  const need = `the sandbox database URL for ${token}, which the routine's network cannot reach, and which a person must give before the run can go on`;
  const stopped = signals(f, await ok(f, 'record', KEY, 'need', need), 'stopped', ['Foreman-Cycle: 1', 'Foreman-Stop: 1'], `chore(blueprint-foreman): ${KEY} needs the sandbox database URL for...`);
  assert.match(stopped, new RegExp(`\\nThe run is stopped at red\\. It needs: the sandbox database URL for\\n${'x'.repeat(100)}\\n${'x'.repeat(50)}, which `), 'wrapped between words, the word longer than a line broken within it');
  answer(f, 'Use the fixture database.');
  f.write('.blueprint/fail', '');
  signals(f, refused(await f.engine('wake'), /PROJ-1 · failed\n/), 'failed', ['Foreman-Cycle: 1']);
  fs.rmSync(path.join(f.root, '.blueprint', 'fail'));
  await ok(f, 'wake');
  commitRun(f);
  signals(f, await ok(f, 'record', KEY, 'reject', '`greets-by-name` cannot hold as written: `greet_fn_greet` names the person, and the answer to stop 1 says no person reaches it.'), 'rejected', ['Foreman-Cycle: 1']);
  // A run settled.
  const done = fixture();
  await walk(done, 'settle');
  commitRun(done);
  done.write(`docs/prs/${KEY}/foreman/pr-notes.md`, NOTES);
  signals(done, await ok(done, 'record', KEY, 'notes'), 'settled', ['Foreman-Cycle: 1']);
  exhibit('signals', shown.join('\n\n----\n\n'));
});

test("no step changes the design: Blueprint's bundle is protected for the run", async () => {
  const f = fixture();
  await walk(f, 'gate');
  f.write(DESIGN_FILE, DESIGN.replace('Only src/greet.mjs changes.', 'Anything may change.'));
  f.commit('an edit to the design', [DESIGN_FILE]);
  restore(f, refused(await f.engine('record', KEY, 'gate'), /no step may change a protected path: docs\/prs\/PROJ-1\/blueprint\.md\n {2}- restore the code to [0-9a-f]+, keeping the run state: git restore /));
  assert.equal(f.sh('show', `HEAD:${DESIGN_FILE}`), DESIGN.trim());
  await walk(f, 'red');
});

test('a run state that will not load fails the wake by the cycle last signalled, and the next fire goes on from the state last pushed', async () => {
  const f = fixture();
  await walk(f, 'red', { commit: true });
  const pushed = f.read(`docs/prs/${KEY}/foreman/run.json`);
  const unreadable = (cycle) => new RegExp(`^blueprint-foreman PROJ-1 · failed\\n {2}- docs/prs/PROJ-1/foreman/run\\.json is not readable JSON \\([^\\n]+\\), and only the engine writes it\\. The run cannot go on from it\\n\\nCommit the signal, then push it, and end the session: (git commit --quiet --allow-empty --only .+ --trailer 'Foreman-Cycle: ${cycle}' --trailer 'Foreman-Run: PROJ-1 failed' --trailer 'Blueprint-Status: failed')$`);
  f.write(`docs/prs/${KEY}/foreman/run.json`, '{ "key": ');
  refused(await f.engine('record', KEY, 'red', 'agent-red'), unreadable(1));
  shell(f, unreadable(1).exec(refused(await f.engine('wake'), unreadable(1)))[1]);
  assert.equal(f.sh('show', '--name-only', '--format=', 'HEAD'), '', 'the signal is an empty commit');
  // The cycle is the latest signal's.
  f.sh('commit', '--quiet', '--allow-empty', '-m', 'chore: a later signal', '--trailer', 'Foreman-Cycle: 3', '--trailer', `Foreman-Run: ${KEY} working`);
  refused(await f.engine('wake'), unreadable(3));
  // A fresh clone holds the run state last pushed, and goes on from it.
  f.sh('checkout', '--', `docs/prs/${KEY}/foreman/run.json`);
  assert.deepEqual(f.runState(), JSON.parse(pushed));
  assert.match(await ok(f, 'wake'), /step: red/);
  // A failed signal carries no run state, so its load passes over what its commit holds: here a forged
  // state another commit brought in, which the signal names and a later commit puts right.
  const copy = path.join(f.root, '.git', 'blueprint-foreman', `${KEY}.json`);
  const forge = (run) => {
    for (const file of [path.join(f.root, 'docs', 'prs', KEY, 'foreman', 'run.json'), copy]) fs.writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
    f.commit('a run state brought in', [`docs/prs/${KEY}/foreman/run.json`]);
  };
  const honest = f.runState();
  forge({ ...honest, cycle: 0 });
  const failed = refused(await f.engine('wake'), /PROJ-1 · failed\n {2}- [^\n]+: its cycle went from 1 to 0\. The run cannot go on from it\n\nCommit the signal, then push it, and end the session: (.+)$/);
  shell(f, /end the session: (.+)$/.exec(failed)[1]);
  forge(honest);
  assert.match(await ok(f, 'wake'), /step: red/);
  await walk(f, 'green', { commit: true });
});
