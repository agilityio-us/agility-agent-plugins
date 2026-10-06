// The design: blueprint.md, where the fire names it, the run's commitment, which Blueprint renders and
// commits to the item's branch before the run. The run delivers it as written and never restates it.
// The engine reads the parts Specification v1 makes normative: the front matter's key; the scenarios,
// each a criterion the plan must cover, by its id; and the artifacts, the event model the code must
// extract back to before the final gate (convergence.mjs). The rest is prose for the subagents and the
// reviewers. The engine reads the design as the admitted commit holds it, and no step may change it.
//
//   ---
//   key: <KEY>
//   ---
//   ## Scenarios
//   - <id> <U+2014> <title> (<note>)     a scenario: an id with no space or backtick, an em dash
//     - Given <text>                     its steps, Given, When and Then in that order, each followed
//     - And <text>                       by any number of And
//     - When <text>
//     - Then <text>
//   ## Artifacts
//   - <type> <label> in <subdomain> (`<id>`)[, serves ...]          a node proposed
//   - edge `<from>` → `<to>` (<kind>[; handlers ...])               an edge proposed
//   - modifies <type> `<id>`[ → `<new id>`][, serves ...]           a node modified, or renamed
//   - removes <type> `<id>`                                         a node removed
//   - removes edge `<from>` → `<to>` (<kind>)                       an edge removed
//     <Field>: <value>                                              a detail, for people
//
// Either section may say `_None._`; the design needs at least one scenario.

const DASH = '\u2014';
const ARROW = '\u2192';
// An id: no space and no backtick.
const ID = '[^\\s`]+';
// A node's type: lowercase letters, digits and hyphens; never `node` or `edge`, which the grammar's own words take.
const TYPE = '(?!(?:node|edge) )[a-z][a-z0-9-]*';
const SCENARIO = new RegExp(`^- (${ID}) ${DASH} (.+)$`);
const STEP = /^ {2,}- (Given|When|Then|And) (.+)$/;
const ARTIFACTS = [
  ['edge', new RegExp(`^- edge \`(${ID})\` ${ARROW} \`(${ID})\` \\(([^;)]+)(?:;[^)]*)?\\)$`)],
  ['remove-edge', new RegExp(`^- removes edge \`(${ID})\` ${ARROW} \`(${ID})\` \\(([^;)]+)\\)$`)],
  ['modify', new RegExp(`^- modifies (${TYPE}) \`(${ID})\`(?: ${ARROW} \`(${ID})\`)?(?:, serves .*)?$`)],
  ['remove', new RegExp(`^- removes (${TYPE}) \`(${ID})\`$`)],
  ['propose', new RegExp(`^- (${TYPE}) (.+) in (\\S+) \\(\`(${ID})\`\\)(?:, serves .*)?$`)],
];
// The steps of a scenario, by keyword: Given, When and Then once each in that order, each followed by
// any number of And.
const STEPS = /^Given(?: And)* When(?: And)* Then(?: And)*$/;

// The design as the run's admitted commit holds it.
export function designAt(git, run) {
  return git.fileAt(run.startCommit, run.design) ?? '';
}

// The front matter's fields, as `name: value` lines between the opening and closing `---`.
function frontMatter(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text)?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/^([A-Za-z_][\w-]*):[ \t]*(.*?)\s*$/gm)].map((m) => [m[1], m[2]]));
}

// Sections by `## ` heading, each with its heading's line and its lines, numbered from 1.
function sections(text) {
  const out = new Map();
  let current = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) {
      current = { line: i + 1, lines: [] };
      out.set(heading[1], current);
    } else if (current) {
      current.lines.push({ n: i + 1, text: line.replace(/\s+$/, '') });
    }
  });
  return out;
}

// A section's items: each line at the margin opening one, `- `, with the lines indented under it.
function items(section) {
  const out = [];
  for (const { n, text } of section?.lines ?? []) {
    if (text.startsWith('- ')) out.push({ n, text, under: [] });
    else if (/^\s/.test(text) && text.trim() && out.length) out.at(-1).under.push({ n, text });
    else if (text.trim() && text.trim() !== '_None._') out.push({ n, text, stray: true, under: [] });
  }
  return out;
}

// The scenarios, in order: each its id, its line, its steps' keywords and its text, Given to Then.
function scenarios(text) {
  return items(sections(text).get('Scenarios')).map(({ n, text: head, under, stray }) => {
    const m = stray ? null : SCENARIO.exec(head);
    const steps = under.map((u) => STEP.exec(u.text));
    return {
      n,
      key: m?.[1] ?? '',
      title: m?.[2] ?? '',
      keywords: steps.map((s) => s?.[1] ?? '?').join(' '),
      scenario: steps.filter(Boolean).map((s) => `${s[1]} ${s[2]}`).join(' '),
    };
  });
}

// The criteria the plan must cover, in order: the design's scenarios, each by its id.
export function criteria(text) {
  return scenarios(text).map(({ n, key, scenario }) => ({ n, key, scenario }));
}

export function criterionKeys(text) {
  return criteria(text).map((c) => c.key);
}

// One artifact line read, or null where it is no artifact the grammar names.
function artifact(text) {
  for (const [kind, pattern] of ARTIFACTS) {
    const m = pattern.exec(text);
    if (!m) continue;
    if (kind === 'edge') return { edge: { from: m[1], to: m[2], kind: m[3].trim(), verb: 'propose' } };
    if (kind === 'remove-edge') return { edge: { from: m[1], to: m[2], kind: m[3].trim(), verb: 'remove' } };
    if (kind === 'modify') return { node: { type: m[1], id: m[2], to: m[3] ?? null, verb: 'modify' } };
    if (kind === 'remove') return { node: { type: m[1], id: m[2], to: null, verb: 'remove' } };
    if (m[1] === 'edge' || m[1] === 'modifies' || m[1] === 'removes') return null;
    return { node: { type: m[1], id: m[4], to: null, verb: 'propose' } };
  }
  return null;
}

// The event model: the artifacts' nodes and edges, each with its line, and the line of its heading. A
// rename is a modify naming its new id.
export function eventModel(text) {
  const section = sections(text).get('Artifacts');
  const nodes = [];
  const edges = [];
  for (const { n, text: line } of items(section)) {
    const read = artifact(line);
    if (read?.node) nodes.push({ n, ...read.node });
    if (read?.edge) edges.push({ n, ...read.edge });
  }
  return { line: section?.line ?? 1, nodes, edges };
}

// Returns the problems found, each citing `file` and its line; an empty list means the run can plan
// against the design.
export function checkDesign(text, key, file) {
  const problems = [];
  const said = frontMatter(text).key;
  if (said !== key) problems.push(`${file} is for key "${said ?? '?'}" in its front matter, not ${key}`);
  const found = sections(text);
  for (const name of ['Scenarios', 'Artifacts']) {
    if (!found.has(name)) problems.push(`${file} is missing "## ${name}"`);
  }
  if (problems.length) return problems;

  const listed = scenarios(text);
  if (listed.length === 0) problems.push(`${file} has no scenarios`);
  const seen = new Set();
  for (const s of listed) {
    const at = `${file}:${s.n}`;
    if (!s.key) {
      problems.push(`${at} must open a scenario as "- <id> ${DASH} <title>", its id with no space or backtick`);
      continue;
    }
    if (seen.has(s.key)) problems.push(`${at} scenario "${s.key}" is keyed twice`);
    seen.add(s.key);
    if (!STEPS.test(s.keywords)) problems.push(`${at} scenario "${s.key}" needs its steps Given, When and Then in that order, each line "  - <Given|When|Then|And> <text>"`);
  }
  for (const { n, text: line } of items(found.get('Artifacts'))) {
    if (!artifact(line)) problems.push(`${file}:${n} is no artifact: a node "- <type> <label> in <subdomain> (\`<id>\`)", "- modifies <type> \`<id>\`", "- removes <type> \`<id>\`", or an edge "- edge \`<from>\` ${ARROW} \`<to>\` (<kind>)" or "- removes edge ..."`);
  }
  return problems;
}
