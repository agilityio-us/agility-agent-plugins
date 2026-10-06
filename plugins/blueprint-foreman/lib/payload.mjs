// The fire: the JSON object Specification v1 gives a routine's fire, naming the item's key, Blueprint's
// branch for it, B, the agent's own, F, the design to read, the trailer key to signal under, an answer
// to the last stop, and the harness's own options. The engine validates it against
// payload.schema.json by reading that file itself, so the two cannot drift: the validator interprets
// every keyword the schema uses and refuses a schema using any other.

import fs from 'node:fs';
import { ENGINE, settingsProblems } from './config.mjs';
import { isRelativePath, quote } from './git.mjs';

export const SCHEMA_FILE = 'payload.schema.json';

const TYPES = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  string: (v) => typeof v === 'string',
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
};
// The keywords the validator interprets: the annotations, which hold nothing to check, and the rest.
export const KEYWORDS = ['$schema', 'title', 'description', 'type', 'required', 'properties', 'additionalProperties', 'pattern', 'const'];

// A schema's types, one or a list.
const typesOf = (schema) => [schema.type].flat();

// A schema the validator can read whole, or the error naming what it cannot: a keyword it does not
// interpret, or one it does in a form it does not. Every subschema under `properties` is held alike.
export function checkSchema(schema, at = '#') {
  const wrong = (what) => {
    throw new Error(`${SCHEMA_FILE} ${what} at ${at}, which the engine does not interpret`);
  };
  if (!TYPES.object(schema)) wrong('holds a schema that is not an object');
  for (const k of Object.keys(schema)) if (!KEYWORDS.includes(k)) wrong(`uses the keyword "${k}"`);
  if (schema.type !== undefined && !(typesOf(schema).length > 0 && typesOf(schema).every((t) => Object.hasOwn(TYPES, t)))) wrong(`names the type ${JSON.stringify(schema.type)}`);
  if (schema.const !== undefined && !['string', 'number', 'boolean'].includes(typeof schema.const)) wrong('sets const other than to a string, a number or a boolean');
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) wrong('sets additionalProperties other than to false');
  if (schema.required !== undefined && !(Array.isArray(schema.required) && schema.required.every(TYPES.string))) wrong('sets required other than to a list of names');
  if (schema.pattern !== undefined) {
    try {
      new RegExp(schema.pattern, 'u');
    } catch {
      wrong('sets a pattern that is no regular expression');
    }
  }
  if (schema.properties !== undefined) {
    if (!TYPES.object(schema.properties)) wrong('sets properties other than to an object');
    for (const [name, sub] of Object.entries(schema.properties)) checkSchema(sub, `${at}/properties/${name}`);
  }
  return schema;
}

export const SCHEMA = checkSchema(JSON.parse(fs.readFileSync(new URL('../payload.schema.json', import.meta.url), 'utf8')));

// An item's key, as the schema takes it: what `record` reads as one.
export const KEY_PATTERN = new RegExp(SCHEMA.properties.key.pattern, 'u');

// The practices a fire may turn off, as the schema names them.
export const PRACTICES = Object.keys(SCHEMA.properties.options.properties.practices.properties);

// Every practice, each as `named` gives it or on where it names none.
export const practicesOf = (named = {}) => Object.fromEntries(PRACTICES.map((p) => [p, named[p] ?? true]));

const named = (at, name) => (/^[A-Za-z0-9_-]+$/.test(name) ? `${at}.${name}` : `${at}[${JSON.stringify(name)}]`);
const article = (type) => (['object', 'integer'].includes(type) ? 'an' : 'a');

// Where `value` falls short of `schema`, each as { at, says }, `at` the path of what falls short. As
// JSON Schema reads them, `pattern` holds only a string, and `required`, `properties` and
// `additionalProperties` only an object.
export function validate(schema, value, at = 'fire') {
  if (schema.type !== undefined && !typesOf(schema).some((t) => TYPES[t](value))) return [{ at, says: `must be ${typesOf(schema).map((t) => (t === 'null' ? 'null' : `${article(t)} ${t}`)).join(' or ')}` }];
  if (schema.const !== undefined && value !== schema.const) return [{ at, says: `must be ${JSON.stringify(schema.const)}` }];
  const problems = [];
  if (schema.pattern !== undefined && TYPES.string(value) && !new RegExp(schema.pattern, 'u').test(value)) problems.push({ at, says: `is ${JSON.stringify(value)}, which does not match its pattern` });
  if (TYPES.object(value)) {
    for (const name of schema.required ?? []) if (!Object.hasOwn(value, name)) problems.push({ at: named(at, name), says: 'is missing' });
    for (const [name, v] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties ?? {}, name)) problems.push(...validate(schema.properties[name], v, named(at, name)));
      else if (schema.additionalProperties === false) problems.push({ at: named(at, name), says: 'is not allowed' });
    }
  }
  return problems;
}

// What the fire's text says: { unreadable }, its reasons, where it names no key or branches the
// engine can read, so the fire has nowhere to write; else the fire, its key, B, F, the design, the
// signal's key and the answer, and either the practices, each the fire's or on where it names none,
// and the settings its options override, or the problems, where it falls short of the schema
// otherwise, which the fire signals failed.
export function readPayload(text) {
  if (!text?.trim()) return { unreadable: ['no fire came on stdin'] };
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { unreadable: [`the fire is not JSON (${e.message})`] };
  }
  const problems = validate(SCHEMA, value);
  const said = (list) => list.map((p) => `${p.at} ${p.says}`);
  const where = ['fire', 'fire.key', 'fire.branch', 'fire.agentBranch'];
  const nowhere = problems.filter((p) => where.includes(p.at));
  if (nowhere.length) return { unreadable: said(nowhere) };
  if (value.agentBranch !== `claude/${value.branch}`) return { unreadable: [`fire.agentBranch is ${JSON.stringify(value.agentBranch)}, not claude/ and fire.branch`] };
  const found = { value, key: value.key, branch: value.branch, runBranch: value.agentBranch, design: value.design, signal: value.signal, answer: value.answer ?? null };
  const own = [...said(problems)];
  if (!own.length && !(isRelativePath(value.design) && value.design.endsWith(`/${value.key}/blueprint.md`))) own.push(`fire.design is ${JSON.stringify(value.design)}, not <docsRoot>/${value.key}/blueprint.md`);
  if (!own.length) own.push(...settingsProblems(value.options, 'fire.options.'));
  if (own.length) return { ...found, problems: own };
  const { practices, ...settings } = value.options ?? {};
  return { ...found, practices: practicesOf(practices), settings, problems: [] };
}

// The wake a session runs, `fire` on stdin.
export const wakeCommand = (fire) => `printf '%s\\n' ${quote(JSON.stringify(fire))} | ${ENGINE} wake`;

// The commands that check out F for B, with the whole history admission reads, in order: the clone
// unshallowed, B fetched, and F fetched where origin has it, else cut from B's tip and tracking
// nothing, so a push names where.
export function checkout(branch, run) {
  const fetch = (b) => `git fetch --quiet origin ${quote(`+refs/heads/${b}:refs/remotes/origin/${b}`)}`;
  return [
    'if [ "$(git rev-parse --is-shallow-repository)" = true ]; then git fetch --quiet --unshallow origin; fi',
    fetch(branch),
    `if git ls-remote --exit-code --heads origin ${quote(`refs/heads/${run}`)} >/dev/null; then ${fetch(run)} && git checkout --quiet -B ${quote(run)} ${quote(`origin/${run}`)}; else git checkout --quiet --no-track -B ${quote(run)} ${quote(`origin/${branch}`)}; fi`,
  ];
}
