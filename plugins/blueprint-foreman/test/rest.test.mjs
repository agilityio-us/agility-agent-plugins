// Offline tests for a run at rest: stops, answers, new cycles on a newer scaffold, and what a wake that
// goes on checks first: `node --test plugins/blueprint-foreman/test/rest.test.mjs`; their fixture is
// fixture.mjs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ENGINE } from '../lib/config.mjs';
import { KEY, BRANCH, ITEM_BRANCH, PAYLOAD, moveB, redesign, DESIGN, TEST_FILE, SLICE, SCAFFOLD, SCAFFOLDED, FAREWELL, GREEN_CODE, NOTES, allMet, briefed, fixture, ok, refused, walk, shell, restore, commitRun, mergeDefault, settled, exhibit, answer, fire, GREET_ROW, proposes } from './fixture.mjs';

test('a stopped run resumes at a fire carrying its answer, the answer in every step and brief for the rest of its cycle', async () => {
  const f = fixture();
  await walk(f, 'red', { slices: [SLICE, FAREWELL] });
  const transcript = [];
  const say = async (...argv) => {
    const out = await f.engine(...argv);
    transcript.push(`$ engine ${argv.join(' ')}\n${out.text}`);
    return out;
  };
  refused(await f.engine('record', KEY, 'need'), /say what the run needs: record <KEY> need "<what>"/);
  assert.match((await say('record', KEY, 'need', 'the sandbox database URL')).text, /step: stopped/);
  refused(await f.engine('record', KEY, 'need', 'another URL'), /the run is stopped; there is nothing to stop/);
  refused(await f.engine('record', KEY, 'reject', '`greets-by-name` cannot hold'), /the run is stopped; there is nothing to reject/);
  commitRun(f);
  // Until a fire carries an answer, it ends and writes nothing; an empty answer is none.
  const ends = /PROJ-1 · ends\n {2}- the run is stopped on stop 1 \(the sandbox database URL\), and the fire carries no answer\n\nEnd the session without writing anything\./;
  refused(await say('wake'), ends);
  answer(f, ' \n');
  refused(await f.engine('wake'), ends);
  answer(f, 'Use the fixture database.');
  const back = await say('wake');
  assert.equal(back.code, 0, back.text);
  assert.match(back.text, /resumed from stop 1\n\nCommit the run state[^\n]+\n\n[^\n]+step: red[\s\S]*Stop 1 was answered by a fire[^\n]+\n {2}> Use the fixture database\./);
  f.ctx.input = fire();
  assert.match(await ok(f, 'wake'), /> Use the fixture database\./, 'the step, described again by a fire with no answer, still shows it');
  // Every later step of the cycle shows it too, and every brief carries it, the resumed one among them.
  const answered = /Stop 1 was answered by a fire[^\n]+\n {2}> Use the fixture database\./;
  assert.match(await walk(f, 'green'), answered);
  assert.match(await walk(f, 'red'), answered);
  assert.equal(f.runState().slice.id, 'say-farewell');
  for (const brief of ['greet-by-name-red-1', 'greet-by-name-green-1', 'greet-by-name-mutant-1', 'say-farewell-red-1']) assert.match(f.read(`docs/prs/${KEY}/foreman/briefs/${brief}.md`), answered, brief);
  exhibit('stop-and-resume', transcript.join('\n\n'));
});

test('a run stopped on its budget resumes, once answered, with the restore first and a fresh budget', async () => {
  const f = fixture({ install: 'node install.mjs' });
  f.ctx.config.replans = 0;
  await walk(f, 'red');
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit('red without a stub', ['test/greet.test.mjs']);
  for (let i = 0; i < 3; i += 1) await f.engine('record', KEY, 'red', 'agent-red');
  // The session stopped without restoring, so the failed try is still committed.
  commitRun(f);
  answer(f, 'Stub the greeting first.');
  // An install that fails at this wake fails on the failed try, so the refusal gives the restore too.
  f.write('.blueprint/fail', '');
  const unrestored = refused(await f.engine('wake'), /refused\n {2}- the install \(node install\.mjs\) failed in the working tree \(exit 5\)\n {2}- restore the code to [0-9a-f]+, keeping the run state: git restore [^\n]+\n\nThen wake the run again/);
  assert.equal(f.runState().step, 'stopped', 'the fire writes nothing');
  // Restored, the code is what the run accepted, so an install that still fails there fails the wake.
  restore(f, unrestored);
  refused(await f.engine('wake'), /PROJ-1 · failed\n {2}- the install \(node install\.mjs\) failed in the working tree \(exit 5\)\n\nCommit the signal, then push it, and end the session: git commit /);
  assert.equal(f.runState().step, 'stopped', 'a failed signal changes no run state');
  fs.rmSync(path.join(f.root, '.blueprint', 'fail'));
  const back = await ok(f, 'wake');
  assert.match(back, /resumed from stop 1\n\nFirst, restore the code to [0-9a-f]+, keeping the run state: git restore [^\n]+\n\nThen commit the run state[\s\S]*step: red/);
  assert.equal(f.runState().slice.budget, 3);
  restore(f, back);
  await walk(f, 'green');
});

test('a newer scaffold on B opens a new cycle: B merged in, the run state started again on it, keeping its counts and what it pinned', async () => {
  const f = fixture({ practices: { mutant: false, exhibits: false } });
  await settled(f);
  refused(await f.engine('record', KEY, 'need', 'a word on it'), /the run is settled; there is nothing to stop/);
  refused(await f.engine('wake'), /ends\n {2}- the run settled cycle 1, and only a newer scaffold on PROJ-1-greet opens another\n/);
  const first = f.runState();
  // Blueprint redesigns: B takes a new design and its scaffold, which F has not merged.
  const design = DESIGN.replace('- **One function**: Only src/greet.mjs changes.', '- **Two functions**: greet, and farewell beside it.');
  const scaffold = redesign(f, { design });
  const merge = await ok(f, 'wake');
  const lines = merge.split('\n');
  assert.deepEqual(lines.slice(0, 6), [
    `blueprint-foreman ${KEY} · new design`,
    `  - ${ITEM_BRANCH} carries the scaffold ${scaffold}, newer than the run's, ${first.scaffold}: a new cycle opens on it`,
    '',
    'Run each line as printed, in order; the last wakes the run again:',
    `git merge --no-edit --quiet 'origin/${ITEM_BRANCH}'`,
    `printf '%s\\n' '${f.ctx.input}' | ${ENGINE} wake`,
  ]);
  assert.equal(lines.length, 6, 'the merge was tried first, and takes no conflict');
  assert.equal(f.runState().step, 'settled', 'nothing is written before the merge');
  shell(f, lines[4]);
  const opened = await ok(f, 'wake');
  assert.match(opened, new RegExp(`^blueprint-foreman PROJ-1 · cycle 2 opens on the newer scaffold ${scaffold}\\n[\\s\\S]*step: plan[\\s\\S]*Cycle 2 opens on a newer design and its scaffold, which PROJ-1-greet brought and the branch merged in`));
  const run = f.runState();
  assert.deepEqual([run.cycle, run.stops, run.scaffold, run.startCommit, run.accepted], [2, first.stops, scaffold, f.sh('rev-parse', 'HEAD'), f.sh('rev-parse', 'HEAD')]);
  assert.deepEqual([run.practices, run.models, run.adversary], [first.practices, first.models, first.adversary], 'what the run pinned at its first admission');
  assert.deepEqual([run.landed, run.handedOff, run.rounds, run.lessons], [undefined, undefined, undefined, undefined], 'the run state starts again');
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'docs', 'prs', KEY, 'foreman')).sort(), ['calibration.log', 'run.json'], 'and so does the run directory, but for its calibration log');
  commitRun(f);
  // The cycle delivers the new design on top of what the first delivered, and every run-state commit
  // since the first still loads: a new cycle on a newer scaffold follows from the one before.
  const farewell = { ...FAREWELL, dependsOn: [] };
  assert.match(briefed(f, await walk(f, 'final', { slices: [farewell], commit: true })), /gates\/final-c2-r1\/package\.md/);
  assert.match(f.read(`docs/prs/${KEY}/foreman/gates/final-c2-r1/package.md`), /- \*\*Two functions\*\*: greet, and farewell beside it\./);
});

test('the signal speaks under the key the fire names, which a new cycle takes from its fire', async () => {
  const f = fixture();
  f.ctx.input = fire({ signal: 'Delivery-State' });
  await walk(f, 'red');
  const trailers = () => f.sh('log', '-1', '--format=%(trailers:key=Delivery-State,key=Blueprint-Status,key=Foreman-Run)');
  commitRun(f);
  assert.equal(trailers(), `Foreman-Run: ${KEY} working\nDelivery-State: working`);
  await ok(f, 'record', KEY, 'need', 'a word on the greeting');
  commitRun(f);
  assert.equal(trailers(), `Foreman-Run: ${KEY} stopped\nDelivery-State: needs-human`);
  assert.equal(f.sh('log', '-1', '--format=%s'), `chore(blueprint-foreman): ${KEY} needs a word on the greeting`, "the subject asks the stop's need");
  // A record runs with no fire, under the key the run took at admission.
  answer(f, 'Go on.');
  f.ctx.input = fire({ signal: 'Delivery-State', answer: 'Go on.' });
  await ok(f, 'wake');
  await ok(f, 'record', KEY, 'reject', '`greets-by-name` cannot hold as written.');
  commitRun(f);
  assert.equal(trailers(), `Foreman-Run: ${KEY} rejected\nDelivery-State: rejected`);
  // A new cycle speaks under its own fire's key.
  redesign(f);
  f.ctx.input = PAYLOAD;
  shell(f, (await ok(f, 'wake')).split('\n')[4]);
  await ok(f, 'wake');
  commitRun(f);
  assert.equal(trailers(), `Foreman-Run: ${KEY} working\nBlueprint-Status: working`);
});

test('a merge of B that conflicts with F signals needs-human, naming the files, and writes nothing else', async () => {
  const f = fixture({ scaffold: true });
  await settled(f, { slices: [SCAFFOLDED] });
  const before = f.runState();
  const head = f.sh('rev-parse', 'HEAD');
  // B's newer scaffold rewrites the line F's work filled.
  redesign(f, { files: { 'src/greet.mjs': SCAFFOLD.replace("return '';", "return 'hello';") } });
  const text = refused(await f.engine('wake'), /^blueprint-foreman PROJ-1 · needs-human\n {2}- merging PROJ-1-greet into claude\/PROJ-1-greet conflicts in src\/greet\.mjs, which a person resolves\n\nCommit the signal, then push it, and end the session: (git commit .+)$/);
  assert.equal(f.sh('rev-parse', 'HEAD'), head, 'no merge was left in the checkout');
  assert.equal(f.sh('status', '--porcelain'), '');
  shell(f, /end the session: (.+)$/.exec(text)[1]);
  assert.equal(f.sh('log', '-1', '--format=%s'), `chore(blueprint-foreman): ${KEY} needs a person to merge ${ITEM_BRANCH}: conflicts in src/greet.mjs`);
  assert.equal(f.sh('log', '-1', '--format=%(trailers:key=Foreman-Cycle,key=Blueprint-Status)'), 'Foreman-Cycle: 1\nBlueprint-Status: needs-human');
  assert.equal(f.sh('show', '--name-only', '--format=', 'HEAD'), '', 'the signal is an empty commit');
  assert.deepEqual(f.runState(), before, 'the run state stays as last pushed');
});

test('a newer scaffold puts back first what the run had not accepted, and one the checks refuse is signalled rejected, the run left as it was', async () => {
  const f = fixture();
  await walk(f, 'green', { commit: true });
  // Green's work, committed but not yet recorded, is not merged with the new design: the code goes back
  // to what the run accepted first.
  f.write('src/greet.mjs', GREEN_CODE);
  f.commit('green, unrecorded', ['src/greet.mjs']);
  const accepted = f.runState().accepted;
  const scaffold = redesign(f, { design: DESIGN.replace(`key: ${KEY}`, 'key: PROJ-9') });
  const lines = (await ok(f, 'wake')).split('\n');
  assert.ok(lines[4].startsWith(`git restore --source=${accepted} --staged --worktree -- 'src/greet.mjs' && git commit `), lines[4]);
  assert.equal(lines[5], `git merge --no-edit --quiet 'origin/${ITEM_BRANCH}'`);
  shell(f, lines[4]);
  shell(f, lines[5]);
  // A design the checks refuse leaves the run as it was, and says so.
  const before = f.runState();
  const text = refused(await f.engine('wake'), /^blueprint-foreman PROJ-1 · rejected\n {2}- docs\/prs\/PROJ-1\/blueprint\.md is for key "PROJ-9" in its front matter, not PROJ-1\n\nCommit the signal, then push it, and end the session: (git commit --quiet --allow-empty --only .+ --trailer 'Foreman-Cycle: 1' --trailer 'Foreman-Run: PROJ-1 rejected' --trailer 'Blueprint-Status: rejected')$/);
  assert.deepEqual(f.runState(), before);
  shell(f, /end the session: (.+)$/.exec(text)[1]);
  // The design put right on B, the next fire opens the cycle on it.
  const fixed = redesign(f);
  shell(f, (await ok(f, 'wake')).split('\n')[4]);
  assert.match(await ok(f, 'wake'), new RegExp(`· cycle 2 opens on the newer scaffold ${fixed}`));
  assert.notEqual(fixed, scaffold);
  commitRun(f);
  // A run state started again without a newer scaffold does not follow from the one before it.
  const forged = { ...f.runState(), cycle: 3, startCommit: f.sh('rev-parse', 'HEAD') };
  for (const file of [`docs/prs/${KEY}/foreman/run.json`, `.git/blueprint-foreman/${KEY}.json`]) f.write(file, `${JSON.stringify(forged, null, 2)}\n`);
  refused(await f.engine('wake'), /does not follow from the one in the run-state commit [0-9a-f]+: it opens a new cycle on the scaffold [0-9a-f]+, and a new cycle opens only on a scaffold newer than [0-9a-f]+/);
});

test('B moving on while the run is stopped is merged in as it resumes, where the run can judge it, and waits while a slice is in flight', async () => {
  const f = fixture();
  await walk(f, 'gate', { commit: true });
  await ok(f, 'record', KEY, 'need', 'a word on the plan');
  commitRun(f);
  const moved = moveB(f, { VERSION: '2\n' });
  answer(f, 'Go on.');
  const merge = (await ok(f, 'wake')).split('\n');
  assert.deepEqual(merge.slice(0, 5), [`blueprint-foreman ${KEY} · merge`, `  - ${ITEM_BRANCH} moved on while the run rested; the run takes it in, and judges it, as it resumes`, '', 'Run each line as printed, in order; the last wakes the run again:', `git merge --no-edit --quiet 'origin/${ITEM_BRANCH}'`]);
  assert.equal(f.runState().step, 'stopped', 'nothing is written before the merge');
  shell(f, merge[4]);
  assert.match(await ok(f, 'wake'), /resumed from stop 1[\s\S]*step: gate/);
  assert.ok(f.sh('merge-base', '--is-ancestor', moved, 'HEAD') === '', 'B is merged');
  assert.equal(f.runState().accepted, f.sh('rev-parse', 'HEAD'), 'and the run counts from the merged code');
  commitRun(f);
  // At green, a later attempt would restore the code to before a merge, so B's move waits.
  await walk(f, 'green', { commit: true });
  await ok(f, 'record', KEY, 'need', 'a word on the greeting');
  commitRun(f);
  moveB(f, { VERSION: '3\n' });
  answer(f, 'Go on again.');
  assert.match(await ok(f, 'wake'), /resumed from stop 2[\s\S]*step: green/);
  assert.equal(f.read('VERSION').trim(), '2');
});

test('an answer is quoted as the fire that resumed the run gave it, and a later fire answers nothing', async () => {
  const f = fixture();
  await walk(f, 'red', { commit: true });
  await ok(f, 'record', KEY, 'need', 'the greeting to test');
  commitRun(f);
  answer(f, 'Greet Ada.');
  const resumed = await ok(f, 'wake');
  assert.match(resumed, /\n {2}> Greet Ada\.\n/);
  // A later fire's answer, while the run works, answers nothing and changes no quote.
  answer(f, 'Any test counts.');
  const quoted = await ok(f, 'wake');
  assert.match(quoted, /\n {2}> Greet Ada\.\n/);
  assert.doesNotMatch(quoted, /counts/);
  assert.deepEqual(f.runState().answers, [{ cycle: 1, stop: 1, text: 'Greet Ada.' }]);
});

test('a commit at rest other than a merge is out of bounds until the code is restored', async () => {
  const f = fixture();
  await walk(f, 'group-review');
  await ok(f, 'record', KEY, 'need', 'a sandbox to try it in');
  commitRun(f);
  answer(f, 'Use the fixture.');
  f.write('src/greet.mjs', GREEN_CODE.replace('Hello, ', 'Pwned, '));
  refused(await f.engine('wake'), /commit or discard every change first; uncommitted: src\/greet\.mjs/);
  f.commit('a change while stopped', ['src/greet.mjs']);
  const text = refused(await f.engine('wake'), /the branch changed at rest other than by a merge: src\/greet\.mjs\n {2}- restore the code to [0-9a-f]+, keeping the run state: git restore /);
  assert.ok(text.endsWith(`Then wake the run again: printf '%s\\n' '${fire({ answer: 'Use the fixture.' })}' | ${ENGINE} wake`), text);
  assert.equal(f.runState().step, 'stopped', 'the refusal writes nothing');
  restore(f, text);
  assert.match(await ok(f, 'wake'), /resumed from stop 1[\s\S]*step: group-review/);
  // A merge excuses only what it brought itself, never a commit before it.
  await ok(f, 'record', KEY, 'need', 'another word');
  commitRun(f);
  f.write('src/greet.mjs', GREEN_CODE.replace('Hello, ', 'Hi, '));
  f.commit('another change while stopped', ['src/greet.mjs']);
  mergeDefault(f);
  answer(f, 'Go on.');
  refused(await f.engine('wake'), /other than by a merge: src\/greet\.mjs\n {2}- restore the code to [0-9a-f]+, keeping the run state: git restore [^\n]+; this takes out the merges too/);
});

test('a branch that has carried a run never admits another, even with run.json removed, and writes nothing', async () => {
  const f = fixture();
  await walk(f, 'red');
  commitRun(f);
  f.sh('rm', '--quiet', `docs/prs/${KEY}/foreman/run.json`);
  f.sh('commit', '--quiet', '-m', 'forget the run');
  const text = refused(await f.engine('wake'), /PROJ-1 · ends\n {2}- claude\/PROJ-1-greet has carried a run for PROJ-1 \(commit [0-9a-f]+ touched docs\/prs\/PROJ-1\/foreman\/run\.json\), and docs\/prs\/PROJ-1\/foreman\/run\.json is gone/);
  assert.doesNotMatch(text, /Foreman-Run/, 'a branch that has carried a run has no run to refuse');
});

test('a wake that resumes a run or opens a new cycle installs first, and without a merge a failed install fails the wake', async () => {
  const f = fixture({ install: 'node install.mjs' });
  const installs = () => f.read('.blueprint/installs').length;
  await walk(f, 'red');
  await ok(f, 'record', KEY, 'need', 'a word on it');
  commitRun(f);
  answer(f, 'Go on.');
  const stopped = installs();
  f.write('.blueprint/fail', '');
  const failed = refused(await f.engine('wake'), /PROJ-1 · failed\n {2}- the install \(node install\.mjs\) failed in the working tree \(exit 5\)\n\nCommit the signal, then push it, and end the session: (git commit .+ --trailer 'Foreman-Cycle: 1' --trailer 'Foreman-Run: PROJ-1 failed' --trailer 'Blueprint-Status: failed')$/);
  assert.equal(f.runState().step, 'stopped', 'a failed signal changes no run state');
  shell(f, /end the session: (.+)$/.exec(failed)[1]);
  // The next fire goes on from the run state last pushed, its answer still the one committed since it stopped.
  fs.rmSync(path.join(f.root, '.blueprint', 'fail'));
  assert.match(await ok(f, 'wake'), /resumed from stop 1[\s\S]*> Go on\./);
  assert.equal(installs(), stopped + 2, 'each wake that went on installed');
  await settled(f);
  redesign(f);
  shell(f, (await ok(f, 'wake')).split('\n')[4]);
  const rested = installs();
  const opened = await ok(f, 'wake');
  assert.match(opened, /cycle 2 opens/);
  assert.doesNotMatch(opened, /Go on/, "cycle 1's answer is not carried into cycle 2");
  assert.equal(installs(), rested + 1);
});

test('a rejection citing only what the design and the locked scaffold hold ends the run, and no fire goes on from it', async () => {
  const design = DESIGN.replace(GREET_ROW, `${GREET_ROW}- edge \`greet_fn_greet\` → \`greet_fn_format\` (calls)\n`);
  const f = fixture({ scaffold: true, design });
  await walk(f, 'red', { slices: [SCAFFOLDED], commit: true });
  const reject = (why) => f.engine('record', KEY, 'reject', why);
  // A claim must cite something: the form is the refusal.
  const form = /a rejection must cite what shows it: a criterion key or an event model row as the design writes it in backticks, or a locked scaffold line as path:line at HEAD/;
  refused(await f.engine('record', KEY, 'reject'), form);
  refused(await reject('the design is wrong'), form);
  // Every citation must name what the run holds, and each that does not is named: an edge of another
  // kind, a key misspelt, a line past the scaffold's, its gap, and its comment, which holds nothing.
  const wrong = '`greets-by-name` fails on `greet_fn_greet` → `greet_fn_format` (uses), `greets-by-nam`, `src/greet.mjs:9`, src/greet.mjs:3 and src/greet.mjs:1.';
  refused(await reject(wrong), /refused\n {2}- `greet_fn_greet` → `greet_fn_format` \(uses\) is no event model edge of the design\n {2}- `greets-by-nam` is neither a criterion key nor an event model node of the design\n {2}- src\/greet\.mjs:9 is no line of the scaffold the lock holds at HEAD\n {2}- src\/greet\.mjs:3 is no line of the scaffold the lock holds at HEAD\n {2}- src\/greet\.mjs:1 is no line of the scaffold the lock holds at HEAD\n {2}- a rejection must cite/);
  assert.equal(f.runState().step, 'red', 'a refused claim changes nothing');
  // A locked line commented out is no line the lock holds, though its text is still there.
  f.write('src/greet.mjs', SCAFFOLD.replace('export function greet(name) {', '/*\nexport function greet(name) {\n*/'));
  f.commit('the signature commented out', ['src/greet.mjs']);
  refused(await reject('`greets-by-name` fails at src/greet.mjs:3.'), /refused\n {2}- src\/greet\.mjs:3 is no line of the scaffold the lock holds at HEAD\n/);
  f.sh('reset', '--quiet', '--hard', 'HEAD~1');
  // Each form resolves: a criterion key, a node, an edge as the design writes it, and a locked line as
  // path:line, bare or in backticks.
  const why = '`greets-by-name` cannot hold: `greet_fn_greet` → `greet_fn_format` (calls) needs a formatter `greet_fn_greet` never takes, as src/greet.mjs:2 and `src/greet.mjs:4` fix it.';
  const out = await ok(f, 'record', KEY, 'reject', why);
  assert.match(out, /^blueprint-foreman PROJ-1 · rejecting\n\nCommit the run state, then push it: git add [^\n]+ --trailer 'Foreman-Cycle: 1' --trailer 'Foreman-Run: PROJ-1 rejected' --trailer 'Blueprint-Status: rejected' -- 'docs\/prs\/PROJ-1\/foreman'\n\nblueprint-foreman PROJ-1 · step: rejected \(rejected\)\n\nThe run is rejected at red: `greets-by-name` cannot hold/);
  assert.doesNotMatch(out, /record PROJ-1 (need|reject)/, 'a rejected run offers no record');
  commitRun(f);
  assert.equal(f.sh('log', '-1', '--format=%(trailers:key=Foreman-Run)'), 'Foreman-Run: PROJ-1 rejected');
  assert.match(f.sh('log', '-1', '--format=%b'), /^The run is rejected at red: `greets-by-name` cannot hold: [\s\S]*\n\nThe run goes on only on a newer scaffold, once the design or the scaffold is put right\.\n/);
  // Nothing goes on from it: every fire ends without writing, an answer committed at rest among them,
  // and no record takes.
  answer(f, 'Go on anyway.');
  const ended = refused(await f.engine('wake'), /PROJ-1 · ends\n {2}- the run is rejected \(`greets-by-name` cannot hold: [^\n]+\), and only a newer scaffold on PROJ-1-greet opens another cycle\n\nEnd the session without writing anything\.$/);
  assert.doesNotMatch(ended, /git commit/);
  refused(await f.engine('record', KEY, 'need', 'a word'), /the run is rejected; there is nothing to stop/);
  refused(await reject('`greets-by-name`'), /the run is rejected; there is nothing to reject/);
  refused(await f.engine('record', KEY, 'red', 'agent-red'), /step rejected records "nothing yet", not "red"/);
  assert.equal(f.runState().step, 'rejected');
});
