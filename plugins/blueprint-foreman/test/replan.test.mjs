// Offline tests for the replan: the plan is the session's own, so where a slice does not pan out the
// session rewrites what has not landed and goes on, its code restored first, within the cycle's budget
// of replans: `node --test plugins/blueprint-foreman/test/replan.test.mjs`; their fixture is fixture.mjs.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEY, SLICE, FAREWELL, GREEN_CODE, TEST_FILE, commitRun, exhibit, fixture, ok, refused, restore, walk } from './fixture.mjs';

const PLAN = `docs/prs/${KEY}/foreman/plan.json`;
const plan = (f, slices) => f.write(PLAN, JSON.stringify({ slices }));
const replan = (f) => f.engine('record', KEY, 'replan');
// greet's slice as one whose behaviour already holds: its tests pass as they are and fail on a broken state.
const SUBSTITUTE = { ...SLICE, stubs: [], mutant: null, test: { suite: 'node', files: SLICE.test.files }, substitute: { broken: { file: 'src/greet.mjs', find: 'Hello, ', replace: 'Bye, ' }, reason: 'what it tests already holds' } };

test('a slice whose behaviour already holds is replanned into a substitute, its code restored first, and the run settles', async () => {
  const f = fixture();
  // The behaviour the slice was planned to bring is already in the code, so its tests cannot go red.
  f.write('src/greet.mjs', GREEN_CODE);
  f.commit('existing behaviour', ['src/greet.mjs']);
  await walk(f, 'red', { slices: [{ ...SLICE, stubs: [] }], commit: true });
  const { base } = f.runState().slice;
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit('a faithful test, which passes', ['test/greet.test.mjs']);
  plan(f, [SUBSTITUTE]);
  // The slice's code goes back to where it began before the plan changes.
  const text = refused(await replan(f), new RegExp(`the branch changed since ${base}, outside what this step may change: test/greet\\.test\\.mjs[\\s\\S]*restore the code to ${base}, keeping the run state: git restore `));
  assert.equal(f.runState().step, 'red', 'a refused replan changes nothing');
  restore(f, text);
  const out = await ok(f, 'record', KEY, 'replan');
  exhibit('replan-substitute', `$ engine record ${KEY} replan\n${out}`);
  assert.match(out, /recorded replan[\s\S]*step: red[\s\S]*replan \(2 left this cycle\)/);
  const run = f.runState();
  assert.deepEqual([run.history.at(-1), run.slice.id, run.slice.attempt, run.slice.budget], [{ step: 'red', what: 'replan', at: run.history.at(-1).at }, SLICE.id, 1, 3]);
  assert.deepEqual(run.plan.slices, [SUBSTITUTE]);
  assert.equal(f.sh('diff', '--name-only', base, 'HEAD', '--', '.', `:(exclude)docs/prs/${KEY}/foreman`), '', 'the code is back at the slice base');
  // Every run-state commit since loads: the plan changed with the same slice in flight, across a replan.
  commitRun(f);
  await walk(f, 'settle', { commit: true });
  assert.deepEqual(f.runState().landed, [SLICE.id]);
});

test('a replan from a later slice drops the slice in flight, keeps what landed, and starts the next fresh from where it began', async () => {
  const f = fixture();
  const slices = [SLICE, FAREWELL];
  await walk(f, 'red', { slices, commit: true });
  await walk(f, 'red', { slices, commit: true });
  assert.equal(f.runState().slice.id, FAREWELL.id);
  await walk(f, 'green', { slices, commit: true });
  const { base } = f.runState().slice;
  // The slice's code goes back to where it began first, whatever the plan says.
  plan(f, slices);
  restore(f, refused(await replan(f), new RegExp(`outside what this step may change: src/farewell\\.mjs, test/farewell\\.test\\.mjs\\n {2}- restore the code to ${base}`)));
  // Changing the slice that landed, naming what is no criterion, or changing nothing is refused.
  plan(f, [{ ...SLICE, outcome: 'greet returns "Hi, <name>"' }, FAREWELL]);
  refused(await replan(f), /slice "greet-by-name" has landed, so the plan may not change or drop it/);
  plan(f, [SLICE, { ...FAREWELL, criteria: ['other'] }]);
  refused(await replan(f), /slice "say-farewell" names "other", which is not a design criterion/);
  plan(f, slices);
  refused(await replan(f), /plan\.json is the plan the run already holds: a replan changes the slices that have not landed/);
  const split = { ...FAREWELL, outcome: 'farewell returns "Bye, <name>", once greet lands' };
  plan(f, [SLICE, split]);
  assert.match(await ok(f, 'record', KEY, 'replan'), /step: red/);
  const run = f.runState();
  assert.deepEqual([run.landed, run.slice.id, run.slice.attempt, run.slice.budget, run.slice.redCommit], [[SLICE.id], FAREWELL.id, 1, 3, undefined]);
  assert.equal(f.sh('diff', '--name-only', base, 'HEAD', '--', '.', `:(exclude)docs/prs/${KEY}/foreman`), '', "the slice's code is back where it began");
  commitRun(f);
  await walk(f, 'settle', { slices: [SLICE, split], commit: true });
});

test("a plan that leaves a criterion unrealized is no replan, and a cycle's replans are spent at its budget", async () => {
  const f = fixture();
  f.ctx.config.replans = 1;
  await walk(f, 'red', { commit: true });
  plan(f, [{ ...SLICE, criteria: ['other'] }]);
  refused(await replan(f), /no slice realizes criterion "greets-by-name"/);
  plan(f, [{ ...SLICE, outcome: 'greet greets the person by name' }]);
  assert.match(await ok(f, 'record', KEY, 'replan'), /step: red[\s\S]*replan \(0 left this cycle\)/);
  commitRun(f);
  plan(f, [{ ...SLICE, outcome: 'greet greets by name' }]);
  refused(await replan(f), /the cycle has used its 1 replans; stop instead: node \S+ record PROJ-1 need "<what>"/);
});

test('a replan is taken only while a slice is in flight', async () => {
  const f = fixture();
  await ok(f, 'wake');
  commitRun(f);
  const at = refused(await replan(f), /step plan records "plan", not "replan"/);
  assert.doesNotMatch(at, /record PROJ-1 replan/, 'the plan step offers no replan');
  // Every step of a slice in flight offers it, with the count the cycle has left.
  for (const step of ['red', 'green', 'mutant', 'group-review', 'contract-review']) {
    const text = await walk(f, step, { commit: true });
    assert.match(text, /If the plan does not pan out, it is yours to change: rewrite plan\.json for the slices that have not landed and replan \(3 left this cycle\), which drops the slice in flight: node \S+ record PROJ-1 replan\n/, step);
  }
});

test("a slice that spends its budget goes to the replan step, restored to its base, and a replan goes on; with no replan left it stops", async () => {
  const f = fixture();
  await walk(f, 'red', { commit: true });
  const { base } = f.runState().slice;
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit('red without a stub', ['test/greet.test.mjs']);
  await f.engine('record', KEY, 'red', 'agent-red');
  await f.engine('record', KEY, 'red', 'agent-red');
  const text = refused(await f.engine('record', KEY, 'red', 'agent-red'), new RegExp(`slice "greet-by-name" has used all its attempts: replan it\\n\\nFirst, restore the code to ${base}, keeping the run state: git restore [^\\n]+\\n\\nThen commit the run state, then push it: git add `));
  exhibit('refusal-budget-replan', `$ engine record ${KEY} red\n${text}`);
  assert.match(text, /step: replan \(replan the slices that have not landed\)\n\nSlice "greet-by-name" used all its attempts, and its code is restored to where it began \([0-9a-f]+\)\. The last attempt was spent because:\n {2}- [^\n]*greet/);
  assert.match(text, /make it a substitute,\nwhose tests pass as they are and fail on its broken state/);
  assert.match(text, /When done, record it: node \S+ record PROJ-1 replan\n/);
  assert.doesNotMatch(text, /If the plan does not pan out/, 'the replan step is the replan');
  assert.match(text, /record PROJ-1 need "<what>"/, 'a need stays open');
  assert.match(text, /--trailer 'Foreman-Run: PROJ-1 working' --trailer 'Blueprint-Status: working'/, 'the run goes on working');
  const run = f.runState();
  assert.deepEqual([run.step, run.accepted, run.slice.budget], ['replan', base, 0]);
  restore(f, text);
  commitRun(f);
  plan(f, [{ ...SLICE, outcome: 'greet returns "Hello, <name>", its stub written first' }]);
  assert.match(await ok(f, 'record', KEY, 'replan'), /step: red/);
  assert.deepEqual([f.runState().slice.budget, f.runState().slice.attempt], [3, 1]);
  commitRun(f);
  // Spent again with the cycle's replans used, the run stops on its budget as before.
  f.ctx.config.replans = 1;
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit('red without a stub again', ['test/greet.test.mjs']);
  await f.engine('record', KEY, 'red', 'agent-red');
  await f.engine('record', KEY, 'red', 'agent-red');
  const stopped = refused(await f.engine('record', KEY, 'red', 'agent-red'), /has used all its attempts, and the run stops[\s\S]*step: stopped/);
  assert.match(stopped, /--trailer 'Blueprint-Status: needs-human'/);
  assert.equal(f.runState().stop.kind, 'budget');
});
