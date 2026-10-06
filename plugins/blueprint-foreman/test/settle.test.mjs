// Offline tests for settle: the pull request body, the exhibits and the lessons: `node --test
// plugins/blueprint-foreman/test/settle.test.mjs`; their fixture is fixture.mjs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { githubRepository } from '../lib/settle.mjs';
import { KEY, BRANCH, ITEM_BRANCH, SLICE, FAREWELL, TEST_FILE, allMet, fixture, ok, refused, walk, restore, commitRun, exhibit, settled, GREETING, NOTES, fire } from './fixture.mjs';

const NOTES_FILE = `docs/prs/${KEY}/foreman/pr-notes.md`;
const FINAL = `docs/prs/${KEY}/foreman/gates/final-c1-r1`;

test("settle joins pr-notes.md with the verdicts, the exhibits and the handed-off findings, and states the pull request's goal", async () => {
  const f = fixture();
  // The exhibit's name holds brackets, which its link text escapes; farewell promises none, and is no exhibit.
  const shown = `docs/prs/${KEY}/foreman/exhibits/greet-by-name/greeting [Ada].txt`;
  const red = { 'test/greet.test.mjs': TEST_FILE.replace("'/greeting.txt'", "'/greeting [Ada].txt'") };
  await walk(f, 'settle', { slices: [SLICE, FAREWELL], red, contract: { verdict: 'pass', reasons: [], findings: [{ file: 'src/greet.mjs', line: 1, claim: 'unused parameter' }] } });
  const sha = commitRun(f);
  const settle = () => f.engine('record', KEY, 'notes');
  assert.match(refused(await f.engine('record', KEY, 'lessons', 'none'), /step settle records "notes", not "lessons"/), /pr-notes\.md[\s\S]*## Decisions[\s\S]*the engine finds it/);
  refused(await settle(), /docs\/prs\/PROJ-1\/foreman\/pr-notes\.md does not exist/);
  // The session writes its own sections only; the engine writes the rest.
  f.write(NOTES_FILE, 'A summary.\n\n## Decisions\n\nNone.\n\n## Exhibits\n\n[a better exhibit](https://example.com)\n\n## Decisions\n\nAgain.\n');
  const notes = refused(await settle(), /pr-notes\.md holds text before its first section, and holds only its sections/);
  assert.match(notes, /pr-notes\.md holds "## Exhibits", but only "## Decisions", "## Deferrals", "## Lessons": the engine writes the rest of the description/);
  assert.match(notes, /pr-notes\.md holds "## Decisions" twice/);
  assert.match(notes, /pr-notes\.md is missing "## Deferrals"\n {2}- pr-notes\.md is missing "## Lessons"/);
  f.write(NOTES_FILE, NOTES);
  const out = await ok(f, 'record', KEY, 'notes');
  const link = `https://github.com/example/app/blob/${sha}/docs/prs/${KEY}/foreman/exhibits/greet-by-name/greeting%20%5BAda%5D.txt`;
  const body = `## Decisions

None beyond the plan.

## Deferrals

None.

## Criteria

- \`greets-by-name\`: met. the tests pin greets-by-name

## Exhibits

- the greeting greet returns for Ada (output, slice greet-by-name): [greeting \\[Ada\\].txt](${link})

## Practices

Ran: slices, red-green, mutant, review, adversary, exhibits, lessons. Turned off: none.

## Gates

- plan gate, cycle 1, round 1: its Adversary was a Claude subagent, claude-opus-5-5 (no OpenRouter key in the environment)
- final gate, cycle 1, round 1: its Adversary was a Claude subagent, claude-opus-5-5 (no OpenRouter key in the environment)

## Handed-off findings

- review/greet-by-name-1 #1, src/greet.mjs:1: unused parameter

## Lessons

No lessons from this run.
`;
  assert.equal(f.read(`docs/prs/${KEY}/pull-request.md`), body);
  assert.equal(f.sh('rev-parse', `${sha}:${shown}`), f.runState().exhibits['greet-by-name'][0].blob, 'the link names a commit that carries the exhibit as its proof run wrote it');
  // The run opens no pull request: the run-state commit carries the description beside the design and
  // signals done, and Blueprint posts it.
  assert.match(out, /step: settled/);
  const said = `The run delivered cycle 1. Its run-state commit carries docs/prs/PROJ-1/pull-request.md, the pull request's description,\nand signals done, on which Blueprint merges this branch and posts the description: push it, and end the session.\nOpen no pull request and write no description anywhere else.\n`;
  assert.ok(out.includes(said), out);
  assert.doesNotMatch(out, /\bgh\b|open a draft/);
  assert.match(out, /A next cycle opens only on a newer scaffold on PROJ-1-greet\./);
  commitRun(f);
  assert.equal(f.sh('show', `HEAD:docs/prs/${KEY}/pull-request.md`), body.trim(), 'the settled run-state commit carries it');
  assert.equal(f.sh('log', '-1', '--format=%(trailers:key=Blueprint-Status,valueonly)'), 'done');
  exhibit('settle-pull-request', `$ engine record ${KEY} notes\n${out}\n\npull-request.md:\n${body}`);
});

test("the pull request's description names the practices the run was admitted with, whatever a later fire names", async () => {
  const f = fixture();
  f.ctx.input = fire({ options: { practices: { mutant: false, lessons: false } } });
  await walk(f, 'red', { commit: true });
  assert.match((await f.wake(fire())).text, /step: red/, 'a later fire names every practice on, in vain');
  await settled(f);
  assert.match(f.read(`docs/prs/${KEY}/pull-request.md`), /\n## Practices\n\nRan: slices, red-green, review, adversary, exhibits\. Turned off: mutant, lessons\.\n\n## Gates\n/);
});

test('settle checks the exhibits from the record: each committed as its proof run wrote it, and nothing else', async () => {
  const f = fixture();
  await walk(f, 'settle');
  f.write(NOTES_FILE, NOTES);
  const settle = () => f.engine('record', KEY, 'notes');
  refused(await settle(), new RegExp(`the exhibit ${GREETING} is not committed; the run-state commit carries it`));
  const sha = commitRun(f);
  // Nothing may sit beside the exhibits, whether it would be committed with the run state or already is.
  f.write(`docs/prs/${KEY}/foreman/exhibits/greet-by-name/late.txt`, 'written after the proof run');
  refused(await settle(), /docs\/prs\/PROJ-1\/foreman\/exhibits\/greet-by-name\/late\.txt is not an exhibit any accepted proof run wrote/);
  f.commit('an exhibit no proof run wrote', [`docs/prs/${KEY}/foreman/exhibits/greet-by-name/late.txt`]);
  fs.rmSync(path.join(f.root, `docs/prs/${KEY}/foreman/exhibits/greet-by-name/late.txt`));
  refused(await settle(), /docs\/prs\/PROJ-1\/foreman\/exhibits\/greet-by-name\/late\.txt is not an exhibit any accepted proof run wrote/);
  f.sh('rm', '--quiet', '--cached', `docs/prs/${KEY}/foreman/exhibits/greet-by-name/late.txt`);
  f.sh('commit', '--quiet', '-m', 'take it out');
  f.write(GREETING, 'FABRICATED');
  f.commit('a better-looking exhibit', [GREETING]);
  const faked = refused(await settle(), new RegExp(`the exhibit ${GREETING} is not what its proof run wrote`));
  exhibit('refusal-fabricated-exhibit', `$ engine record ${KEY} notes\n${faked}`);
  f.sh('restore', `--source=${sha}`, '--staged', '--worktree', '--', GREETING);
  f.sh('commit', '--quiet', '-m', 'return the exhibit');
  // The links name the repository origin does, and never print its URL, which may carry a credential.
  f.sh('remote', 'set-url', 'origin', 'https://x-access-token:sk-secret@example.com/nowhere');
  assert.doesNotMatch(refused(await settle(), /origin names no GitHub repository in its https or ssh form, so the exhibits cannot be linked/), /sk-secret|example\.com/);
  f.sh('remote', 'remove', 'origin');
  refused(await settle(), /origin names no GitHub repository/);
  f.sh('remote', 'add', 'origin', 'git@github.com:example/app.git');
  assert.match(await ok(f, 'record', KEY, 'notes'), /step: settled/);
  assert.match(f.read(`docs/prs/${KEY}/pull-request.md`), new RegExp(`\\(https://github\\.com/example/app/blob/${f.sh('rev-parse', 'HEAD')}/${GREETING}\\)`));
});

test('an exhibit the final run cannot write again is a finding of the engine\'s, and a run left with no exhibit does not settle', async () => {
  const f = fixture();
  // The command writes the card from what only the session's checkout holds, so it fails at HEAD.
  f.write('.blueprint/card', 'Hello, Ada\n');
  const command = `node -e "const fs = require('fs'); if (!fs.existsSync('.blueprint/card')) process.exit(4); fs.copyFileSync('.blueprint/card', process.env.BLUEPRINT_FOREMAN_EXHIBITS + '/card.txt')"`;
  const slice = { ...SLICE, exhibit: { shows: 'the card greet renders', form: 'output', command } };
  const quiet = TEST_FILE.replace(/ {2}if \(process\.env\.BLUEPRINT_FOREMAN_EXHIBITS\)[^\n]*\n/, '');
  assert.notEqual(quiet, TEST_FILE);
  await walk(f, 'mutant', { slices: [slice], red: { 'test/greet.test.mjs': quiet } });
  assert.deepEqual(f.runState().slice.exhibits.map((e) => e.file), [`docs/prs/${KEY}/foreman/exhibits/greet-by-name/card.txt`], 'at green the command wrote it');
  await walk(f, 'final');
  assert.deepEqual(f.runState().convergence.findings, [
    { file: 'test/greet.test.mjs', line: 1, claim: 'slice "greet-by-name"\'s exhibit command failed at HEAD (exit 4)' },
    { file: 'test/greet.test.mjs', line: 1, claim: 'slice "greet-by-name" promises an exhibit (the card greet renders), and its tests at HEAD wrote none' },
  ]);
  assert.deepEqual(f.runState().exhibits['greet-by-name'], [], "green's card is gone with the rest");
  f.write(`${FINAL}/findings.json`, '[]');
  f.write(`${FINAL}/contract.json`, JSON.stringify(allMet(f, f.runState())));
  await ok(f, 'record', KEY, 'gate', 'agent-reviewer');
  f.write(`${FINAL}/dispositions.json`, JSON.stringify([1, 2].map((finding) => ({ finding, disposition: 'handed-off' }))));
  await ok(f, 'record', KEY, 'dispositions');
  commitRun(f);
  f.write(NOTES_FILE, NOTES);
  refused(await f.engine('record', KEY, 'notes'), /the run has no exhibit, and the pull request must show the work/);
});

test("origin's owner and repository are read from its https or ssh form, and nothing else", () => {
  for (const url of ['https://github.com/example/app.git', 'https://github.com/example/app', 'https://x-access-token:abc@github.com/example/app.git', 'git@github.com:example/app.git', 'ssh://git@github.com/example/app.git', 'http://proxy@127.0.0.1:8080/git/example/app']) {
    assert.equal(githubRepository(url), 'example/app', url);
  }
  for (const url of [null, '', '/tmp/app.git', 'C:/Users/me/app', 'file:///tmp/example/app', 'https://github.com/app']) assert.equal(githubRepository(url), null, String(url));
});

test('the lessons commit is found: after the final gate, one commit in the lesson homes that makes the whole change', async () => {
  const f = fixture();
  await walk(f, 'settle');
  commitRun(f);
  const lessons = NOTES.replace('No lessons from this run.', 'One convention, in CLAUDE.md.');
  f.write(NOTES_FILE, lessons.replace('One convention', 'None'));
  const settle = () => f.engine('record', KEY, 'notes');
  // The homes are those the admitted commit holds, whatever a run state rewritten with its copy says.
  const forged = `${JSON.stringify({ ...f.runState(), homesAtStart: ['src'] }, null, 2)}\n`;
  for (const file of [`docs/prs/${KEY}/foreman/run.json`, `.git/blueprint-foreman/${KEY}.json`]) f.write(file, forged);
  // A lesson home the admitted commit does not hold is none.
  f.write('src/lesson.md', 'not a lesson home');
  f.write('docs/gotchas.md', '# gotchas\n');
  f.commit('lessons in the wrong place', ['src/lesson.md', 'docs/gotchas.md']);
  refused(await settle(), /the branch changed since [0-9a-f]+, outside what this step may change: docs\/gotchas\.md, src\/lesson\.md\n/);
  f.sh('rm', '--quiet', 'src/lesson.md', 'docs/gotchas.md');
  f.sh('commit', '--quiet', '-m', 'take it out');
  // With no lessons committed, what came and went is no lesson, and the notes must say there is none.
  refused(await settle(), /with no lessons commit, pr-notes\.md's "## Lessons" says "No lessons from this run\."/);
  f.write(NOTES_FILE, lessons);
  f.write('.claude/rules/testing.md', '# testing\n\nName every test by what it shows.\n');
  f.commit('an earlier lesson', ['.claude/rules/testing.md']);
  f.write('CLAUDE.md', '# conventions\n\nRun the tests before committing.\n');
  f.commit('docs: what the run taught', ['CLAUDE.md']);
  const text = refused(await settle(), new RegExp(`the lessons are not one commit: before ${f.sh('rev-parse', 'HEAD')}, the last commit that changed them, the branch had already changed \\.claude/rules/testing\\.md since the final gate`));
  // The restore it prints lets the lessons be committed again, as one.
  assert.match(text, /\n {2}- restore the code to [0-9a-f]+, keeping the run state: git restore [^\n]+\n {2}- then commit the lessons again, in one commit\n/);
  restore(f, text);
  f.write('.claude/rules/testing.md', '# testing\n\nName every test by what it shows.\n');
  f.write('CLAUDE.md', '# conventions\n\nRun the tests before committing.\n');
  f.commit('docs: what the run taught', ['.claude/rules/testing.md', 'CLAUDE.md']);
  const commit = f.sh('rev-parse', 'HEAD');
  assert.match(await ok(f, 'record', KEY, 'notes'), /step: settled/);
  assert.deepEqual(f.runState().lessons, [{ cycle: 1, commit }]);
  assert.ok(f.read(`docs/prs/${KEY}/pull-request.md`).endsWith(`## Lessons\n\nOne convention, in CLAUDE.md.\n\nLessons commits: [${commit.slice(0, 12)}](https://github.com/example/app/commit/${commit}) (cycle 1).\n`));
});
