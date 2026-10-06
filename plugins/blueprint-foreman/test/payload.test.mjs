// Offline tests for the fire: the schema the engine validates it against, the engine's own reading of
// it, and the wake the engine prints: `node --test plugins/blueprint-foreman/test/payload.test.mjs`.
// How a wake checks out the agent's branch is in engine.test.mjs.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../lib/config.mjs';
import { KEYWORDS, PRACTICES, SCHEMA, checkSchema, readPayload, validate, wakeCommand } from '../lib/payload.mjs';
import { scratchDir } from './fixture.mjs';

const FILE = JSON.parse(fs.readFileSync(new URL('../payload.schema.json', import.meta.url), 'utf8'));

// A fire as Specification v1 gives it, `over` changing its fields.
const FIRE = { specification: 1, key: 'PROJ-1', title: 'Greet', branch: 'PROJ-1-greet', agentBranch: 'claude/PROJ-1-greet', pullRequest: null, design: 'docs/prs/PROJ-1/blueprint.md', signal: 'Blueprint-Status', answer: null, options: {} };
const fire = (over = {}) => ({ ...FIRE, ...over });
const without = (...names) => Object.fromEntries(Object.entries(FIRE).filter(([k]) => !names.includes(k)));

// Every keyword a schema uses: its own, and each subschema's under its properties.
const keywords = (schema) => [...Object.keys(schema), ...Object.values(schema.properties ?? {}).flatMap(keywords)];

test('the validator interprets every keyword the schema file uses, and the engine refuses a schema using one it does not', () => {
  assert.deepEqual(SCHEMA, FILE, 'the engine reads the file itself');
  assert.deepEqual([...new Set(keywords(FILE))].filter((k) => !KEYWORDS.includes(k)), []);
  const branch = (over) => ({ ...FILE, properties: { ...FILE.properties, branch: { ...FILE.properties.branch, ...over } } });
  for (const [schema, pattern] of [
    [{ ...FILE, minProperties: 1 }, /uses the keyword "minProperties" at #, which the engine does not interpret/],
    [branch({ maxLength: 200 }), /uses the keyword "maxLength" at #\/properties\/branch/],
    [{ ...FILE, properties: { ...FILE.properties, depth: { type: 'number' } } }, /names the type "number" at #\/properties\/depth/],
    [branch({ type: ['string', 'array'] }), /names the type \["string","array"\] at #\/properties\/branch/],
    [branch({ type: [] }), /names the type \[\] at #\/properties\/branch/],
    [branch({ const: { a: 1 } }), /sets const other than to a string, a number or a boolean at #\/properties\/branch/],
    [{ ...FILE, additionalProperties: true }, /sets additionalProperties other than to false at #/],
    [{ ...FILE, additionalProperties: { type: 'boolean' } }, /sets additionalProperties other than to false at #/],
    [{ ...FILE, required: 'branch' }, /sets required other than to a list of names at #/],
    [branch({ pattern: '(' }), /sets a pattern that is no regular expression at #\/properties\/branch/],
    [{ ...FILE, properties: [] }, /sets properties other than to an object at #/],
    [{ ...FILE, properties: { ...FILE.properties, branch: 'string' } }, /holds a schema that is not an object at #\/properties\/branch/],
  ]) {
    assert.throws(() => checkSchema(schema), pattern);
  }
  assert.equal(checkSchema(FILE), FILE);
});

test('the engine will not load beside a schema using a keyword it does not interpret', async () => {
  const dir = scratchDir('blueprint-foreman-schema-');
  fs.mkdirSync(path.join(dir, 'lib'));
  for (const file of ['payload.mjs', 'config.mjs', 'git.mjs']) fs.copyFileSync(new URL(`../lib/${file}`, import.meta.url), path.join(dir, 'lib', file));
  const drifted = { ...FILE, properties: { ...FILE.properties, branch: { ...FILE.properties.branch, maxLength: 200 } } };
  fs.writeFileSync(path.join(dir, 'payload.schema.json'), JSON.stringify(drifted));
  await assert.rejects(import(pathToFileURL(path.join(dir, 'lib', 'payload.mjs')).href), /uses the keyword "maxLength" at #\/properties\/branch/);
});

test('a fire names the key, B, F, the design and the signal, and its options may turn practices off: each it does not name is on', () => {
  assert.deepEqual(PRACTICES, ['slices', 'red-green', 'mutant', 'review', 'adversary', 'exhibits', 'lessons']);
  const every = (on) => Object.fromEntries(PRACTICES.map((p) => [p, on]));
  for (const [value, practices, settings] of [
    [fire(), every(true), {}],
    [without('title', 'pullRequest', 'answer', 'options'), every(true), {}],
    [fire({ options: { practices: {} } }), every(true), {}],
    [fire({ options: { practices: { mutant: false, lessons: true } } }), { ...every(true), mutant: false }, {}],
    [fire({ options: { practices: every(false), models: { broad: 'm' }, adversary: { zeroDataRetention: false } } }), every(false), { models: { broad: 'm' }, adversary: { zeroDataRetention: false } }],
  ]) {
    assert.deepEqual(readPayload(` ${JSON.stringify(value)}\n`), {
      value,
      key: 'PROJ-1',
      branch: 'PROJ-1-greet',
      runBranch: 'claude/PROJ-1-greet',
      design: 'docs/prs/PROJ-1/blueprint.md',
      signal: 'Blueprint-Status',
      answer: null,
      practices,
      settings,
      problems: [],
    });
  }
  assert.equal(readPayload(JSON.stringify(fire({ answer: 'Use the fixture.' }))).answer, 'Use the fixture.');
});

test('a fire whose key or branches do not read is unreadable; one whose do but that fails the schema otherwise names each problem', () => {
  for (const [text, said] of [
    ['', /^no fire came on stdin$/],
    [' \n', /^no fire came on stdin$/],
    ['PROJ-1-greet', /^the fire is not JSON \(/],
    ['{"branch": "PROJ-1-greet"', /^the fire is not JSON \(/],
    ...['[]', 'null', '"PROJ-1-greet"', '7', 'true'].map((t) => [t, /^fire must be an object$/]),
    [JSON.stringify(without('key')), /^fire\.key is missing$/],
    [JSON.stringify(fire({ key: 'proj-1' })), /^fire\.key is "proj-1", which does not match its pattern$/],
    [JSON.stringify(without('branch')), /^fire\.branch is missing$/],
    [JSON.stringify(fire({ branch: null })), /^fire\.branch must be a string$/],
    [JSON.stringify(fire({ branch: 'claude/PROJ-1-greet', agentBranch: 'claude/claude/PROJ-1-greet' })), /^fire\.branch is "claude\/PROJ-1-greet", which does not match its pattern$/],
    [JSON.stringify(fire({ agentBranch: 'PROJ-1-greet' })), /^fire\.agentBranch is "PROJ-1-greet", which does not match its pattern$/],
    [JSON.stringify(fire({ agentBranch: 'claude/other' })), /^fire\.agentBranch is "claude\/other", not claude\/ and fire\.branch$/],
    // Whatever else the fire holds.
    [JSON.stringify(fire({ key: 7, extra: 1, options: { practices: { mutant: 'no' } } })), /^fire\.key must be a string$/],
  ]) {
    const read = readPayload(text);
    assert.equal(read.unreadable?.length, 1, `${text}: ${JSON.stringify(read)}`);
    assert.match(read.unreadable[0], said, text);
  }
  for (const [value, problems] of [
    [fire({ specification: 2 }), ['fire.specification must be 1']],
    [without('design'), ['fire.design is missing']],
    [without('signal'), ['fire.signal is missing']],
    [fire({ signal: 'Blueprint Status' }), ['fire.signal is "Blueprint Status", which does not match its pattern']],
    [fire({ answer: 3 }), ['fire.answer must be a string or null']],
    ...['/docs/prs/PROJ-1/blueprint.md', 'docs/prs/PROJ-1/design.md', 'docs/../PROJ-1/blueprint.md'].map((design) => [fire({ design }), [`fire.design is ${JSON.stringify(design)}, which does not match its pattern`]]),
    [fire({ design: 'docs/prs/PROJ-2/blueprint.md' }), ['fire.design is "docs/prs/PROJ-2/blueprint.md", not <docsRoot>/PROJ-1/blueprint.md']],
    ...[[], null, 'none'].map((options) => [fire({ options }), ['fire.options must be an object']]),
    [fire({ options: { practices: { mutant: 'no' } } }), ['fire.options.practices.mutant must be a boolean']],
    [fire({ options: { practices: { mutant: 0, review: null } } }), ['fire.options.practices.mutant must be a boolean', 'fire.options.practices.review must be a boolean']],
    [fire({ options: { practices: { speed: false } } }), ['fire.options.practices.speed is not allowed']],
    [fire({ options: { practices: { 'red green': false } } }), ['fire.options.practices["red green"] is not allowed']],
    [fire({ options: { models: { author: 'm' } } }), ['fire.options.models.author is not allowed']],
    [fire({ options: { models: { broad: ' ' } } }), ['fire.options.models must map roles (broad, contained, reviewer, adversary-fallback) to model ids']],
    [fire({ options: { adversary: { zeroDataRetention: 'yes' } } }), ['fire.options.adversary.zeroDataRetention must be a boolean']],
    [fire({ extra: 1, options: { Practices: {} } }), ['fire.options.Practices is not allowed', 'fire.extra is not allowed']],
  ]) {
    const read = readPayload(JSON.stringify(value));
    assert.deepEqual([read.unreadable, read.key, read.runBranch, read.problems, read.practices], [undefined, 'PROJ-1', 'claude/PROJ-1-greet', problems, undefined], JSON.stringify(value));
  }
});

test("B's pattern takes only a name git takes for a branch, as F's too, and none under claude/", () => {
  const fits = (name) => validate(SCHEMA.properties.branch, name).length === 0;
  const cwd = scratchDir('blueprint-foreman-refs-');
  const git = (name) => spawnSync('git', ['check-ref-format', '--branch', name], { cwd, stdio: 'ignore' }).status === 0;
  const taken = (name) => assert.ok(git(name) && git(`claude/${name}`), `git takes ${name} and claude/${name}`);
  const named = ['PROJ-1-greet', 'PROJ-42', 'feature/proj-42', 'greet', 'release/1.2/PROJ-7_fix', 'user.name/PROJ-7', 'PROJ-7-v1.2', '_x/PROJ-7', 'claudex/PROJ-7', 'Claude/PROJ-7', 'x/claude/PROJ-7'];
  for (const name of named) {
    assert.ok(fits(name), name);
    taken(name);
  }
  const refused = ['claude/PROJ-7', 'claude/PROJ-7-x', '-PROJ-7', '.PROJ-7', 'x/.PROJ-7', 'x/-PROJ-7', 'PROJ-7.', 'PROJ-7./x', 'PROJ-7/', '/PROJ-7', 'x//PROJ-7', 'PROJ-7..x', 'PROJ-7.lock', 'x.lock/PROJ-7', 'PROJ-7 x', 'PROJ-7~1', 'PROJ-7^', 'PROJ-7:x', 'PROJ-7?', 'PROJ-7*', 'PROJ-7[x', 'PROJ-7\\x', 'PROJ-7@{1}', 'PROJ-7\n', 'PROJ-7-é', ''];
  for (const name of refused) assert.ok(!fits(name), JSON.stringify(name));
  // Names drawn at random from an alphabet holding every character the pattern weighs: each it takes,
  // git takes too.
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
  const alphabet = 'aZ9-._/xK3-';
  let fitting = 0;
  for (let i = 0; i < 400 && fitting < 80; i += 1) {
    const name = Array.from({ length: 1 + (next() % 12) }, () => alphabet[next() % alphabet.length]).join('');
    if (!fits(name)) continue;
    fitting += 1;
    taken(name);
  }
  assert.ok(fitting >= 40, `only ${fitting} names fit`);
});

test('the wake the engine prints hands wake the fire on stdin exactly, whatever it holds', () => {
  for (const value of [fire(), fire({ title: "it's", options: { practices: { mutant: false } } }), fire({ answer: 'a\\b "c" $HOME `x` %s\n' })]) {
    const command = wakeCommand(value);
    assert.ok(command.endsWith(` | ${ENGINE} wake`), command);
    // The shell reads the command on stdin, since Windows quotes an argument's backslashes away.
    assert.equal(execFileSync('sh', [], { input: command.replace(` | ${ENGINE} wake`, ''), encoding: 'utf8' }), `${JSON.stringify(value)}\n`);
  }
});
