// End to end: a fire through the engine's command line, as a routine's session runs it: `node --test
// plugins/blueprint-foreman/test/e2e.test.mjs`. Blueprint's branch for the item, shaped as Blueprint
// leaves it (the design commit with its bundle, then the scaffold commit with its report), is on a
// bare origin; the session clones it shallow on a branch of its own, pipes the fire's JSON to `wake`,
// runs every line and commit the engine prints in a shell, pushes after each, and does each step's
// work as a session would, until the run signals done.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ACTS, BRANCH, ITEM_BRANCH, KEY, NOTES, PAYLOAD, SCAFFOLDED, exhibit, fixture, scratchDir } from './fixture.mjs';

const ENGINE = fileURLToPath(new URL('../engine.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test("end to end: from the fire's JSON to the done signal, every command the engine prints run in a shell and pushed", async () => {
  // Blueprint's side: the item's branch on origin, the default branch beside it.
  const blueprint = fixture({ scaffold: true });
  const origin = scratchDir('blueprint-foreman-e2e-origin-');
  git(origin, 'init', '--quiet', '--bare', '-b', 'master');
  blueprint.sh('push', '--quiet', origin, 'master', `${BRANCH}:refs/heads/${ITEM_BRANCH}`);
  // The session's side: a fresh shallow clone on a branch of its own, origin's URL a GitHub one as a
  // routine's proxy gives it, the real origin reached through git's URL rewriting.
  const root = scratchDir('blueprint-foreman-e2e-session-');
  git(os.tmpdir(), 'clone', '--quiet', '--depth', '1', '--no-single-branch', pathToFileURL(origin).href, root);
  git(root, 'config', 'user.email', 'session@example.com');
  git(root, 'config', 'user.name', 'Claude');
  git(root, 'config', `url.${pathToFileURL(origin).href}.insteadOf`, 'https://github.com/example/app.git');
  git(root, 'remote', 'set-url', 'origin', 'https://github.com/example/app.git');
  git(root, 'switch', '--quiet', '-c', 'claude/the-session');

  const transcript = [];
  // The engine as the session runs it: from the repository's root, no OpenRouter key in its
  // environment, so the Adversary is a Claude subagent.
  let input = PAYLOAD;
  const engine = (...argv) => {
    const out = spawnSync(process.execPath, [ENGINE, ...argv], { cwd: root, encoding: 'utf8', input: argv[0] === 'wake' ? input : undefined, env: { ...process.env, OPENROUTER_API_KEY: '' } });
    transcript.push(`$ engine ${argv.join(' ')}\n${out.stdout}`);
    return { code: out.status, text: out.stdout.trimEnd() };
  };
  const shell = (command) => execFileSync('sh', ['-c', command], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const push = () => git(root, 'push', '--quiet', 'origin', 'HEAD');
  // What a step's output says to run: a restore first, then the run-state commit, each pushed.
  const follow = (text) => {
    for (const [, command] of text.matchAll(/^(?:First, restore the code to [0-9a-f]+, keeping the run state|(?:Then c|C)ommit the run state, then push it): (.+)$/gm)) shell(command);
    push();
  };
  const runJson = path.join(root, 'docs', 'prs', KEY, 'foreman', 'run.json');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const session = {
    root,
    engine,
    write,
    commit: (msg, files) => {
      git(root, 'add', ...files);
      git(root, 'commit', '--quiet', '-m', msg);
    },
    read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
    sh: (...args) => git(root, ...args),
    hasRun: () => fs.existsSync(runJson),
    runState: () => JSON.parse(fs.readFileSync(runJson, 'utf8')),
  };

  // The fire: the session checks out the agent's branch as the engine prints it, then wakes again.
  const checkout = engine('wake');
  assert.equal(checkout.code, 0, checkout.text);
  assert.match(checkout.text, /^blueprint-foreman PROJ-1 · checkout\n/);
  const lines = checkout.text.split('\n').slice(4);
  for (const line of lines.slice(0, -1)) shell(line);
  assert.equal(lines.at(-1), `printf '%s\\n' '${PAYLOAD}' | node '${ENGINE}' wake`, 'the same wake again, the fire as it came');
  const admitted = engine('wake');
  assert.equal(admitted.code, 0, admitted.text);
  assert.match(admitted.text, /^blueprint-foreman PROJ-1 · admitted\n/);
  follow(admitted.text);

  // Each step, as the session does it, until the run is delivered.
  for (let steps = 0; steps < 40; steps += 1) {
    const run = session.runState();
    if (run.step === 'settle') break;
    const out = await ACTS[run.step](session, run, { slices: [SCAFFOLDED] });
    assert.equal(out.code, 0, out.text);
    follow(out.text);
  }
  assert.equal(session.runState().step, 'settle');
  write(`docs/prs/${KEY}/foreman/pr-notes.md`, NOTES);
  const settled = engine('record', KEY, 'notes');
  assert.equal(settled.code, 0, settled.text);
  follow(settled.text);

  // What Blueprint reads from origin: the agent's branch, its latest signal done, and the description.
  const tip = git(origin, 'rev-parse', `refs/heads/${BRANCH}`);
  assert.equal(tip, git(root, 'rev-parse', 'HEAD'));
  assert.equal(git(origin, 'log', '-1', '--format=%(trailers:key=Blueprint-Status,valueonly)', tip), 'done');
  const description = git(origin, 'show', `${tip}:docs/prs/${KEY}/pull-request.md`);
  assert.match(description, /^## Decisions\n[\s\S]*## Criteria\n\n- `greets-by-name`: met\. [\s\S]*## Exhibits\n\n- the greeting greet returns for Ada \(output, slice greet-by-name\): \[greeting\.txt\]\(https:\/\/github\.com\/example\/app\/blob\/[0-9a-f]{40}\/docs\/prs\/PROJ-1\/foreman\/exhibits\/greet-by-name\/greeting\.txt\)/);
  // Every signal along the branch, in order, as Blueprint's poll would read them.
  const signals = git(origin, 'log', '--reverse', '--format=%(trailers:key=Blueprint-Status,valueonly,separator=)', tip).split('\n').filter(Boolean);
  assert.deepEqual([signals[0], signals.at(-1)], ['working', 'done']);
  assert.ok(signals.slice(0, -1).every((s) => s === 'working'), signals.join(', '));
  // The run wrote nothing outside its directory, the description and the code change.
  const changed = git(root, 'diff', '--name-only', `origin/${ITEM_BRANCH}`, 'HEAD').split('\n');
  assert.deepEqual(changed.filter((f) => !f.startsWith(`docs/prs/${KEY}/foreman/`) && f !== `docs/prs/${KEY}/pull-request.md`), ['src/greet.mjs', 'test/greet.test.mjs']);
  exhibit('end-to-end', transcript.join('\n'));
});
