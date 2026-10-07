// Convergence: what the repository's own extractor finds in the code, held to the design's event
// model. The extractor is the one the adapters declare, and runs in a scratch checkout the install has
// prepared, so nothing the session left in its own checkout reaches the graph. Admission extracts
// twice, at the scaffold commit's parent, where what the design modifies or removes must already be,
// and at HEAD, where the scaffold must extract; the final gate extracts at HEAD, in the checkout its
// own run of the landed tests shares (slice.mjs), and holds to the graph
// every row the extractor can show, by the types the adapters say it emits. What ids cannot show goes
// by name to the final gate's Contract Reviewer.

import fs from 'node:fs';
import path from 'node:path';
import { GRAPH_FILE } from './config.mjs';
import { designAt, eventModel } from './design.mjs';
import { itemDirectory, locksAt, openGaps } from './locks.mjs';
import { runCommand } from './proof.mjs';
import { readJson } from './run.mjs';

// The shape the contract gives the graph; other fields are the extractor's own.
const isGraph = (g) =>
  Array.isArray(g?.nodes) &&
  g.nodes.every((n) => typeof n?.id === 'string' && typeof n.type === 'string') &&
  Array.isArray(g.edges) &&
  g.edges.every((e) => ['from', 'kind', 'to'].every((k) => typeof e?.[k] === 'string'));

// The graph the extractor finds in a scratch checkout `dir`, installed first, or why there is none: a
// failed install, a timeout, a nonzero exit, no readable graph, or one of another shape.
export function extractIn(ctx, adapters, dir) {
  const installed = runCommand({ cwd: dir, command: adapters.install, timeoutMs: ctx.config.testTimeoutMs });
  if (installed.exitCode !== 0) return { why: `the install (${adapters.install}) failed (exit ${installed.exitCode}):\n${installed.tail}` };
  fs.rmSync(path.join(dir, GRAPH_FILE), { force: true });
  const result = runCommand({ cwd: dir, command: adapters.extract, timeoutMs: ctx.config.testTimeoutMs });
  if (result.timedOut) return { why: 'it timed out' };
  if (result.exitCode !== 0) return { why: `it exited ${result.exitCode}:\n${result.tail}` };
  let graph;
  try {
    graph = readJson(path.join(dir, GRAPH_FILE));
  } catch {
    return { why: `it wrote no readable ${GRAPH_FILE}:\n${result.tail}` };
  }
  return isGraph(graph) ? { graph } : { why: `${GRAPH_FILE} is not { nodes: [{ id, type }], edges: [{ from, kind, to }] }` };
}

// Whether an id is of a type the extractor does not emit: its type is its design row's, else the
// graph's `nodes`'. An id of no known type is judged from the graph.
function unseenBy(model, nodes, emits) {
  const types = new Map([...nodes.map((n) => [n.id, n.type]), ...model.nodes.flatMap((n) => [[n.id, n.type], ...(n.to ? [[n.to, n.type]] : [])])]);
  return (id) => types.has(id) && !emits.includes(types.get(id));
}

// What the design modifies or removes that the code before the work does not hold, the graph `before`:
// a node a modify or remove row names, an edge a remove row names. What is, or touches, a node of a
// type the extractor does not emit is left to the final gate.
export function missingBefore(model, before, emits, file) {
  const ids = new Set(before.nodes.map((n) => n.id));
  const edges = new Set(before.edges.map((e) => `${e.from} ${e.kind} ${e.to}`));
  const unseen = unseenBy(model, before.nodes, emits);
  const problems = [];
  for (const node of model.nodes) {
    if (['modify', 'remove'].includes(node.verb) && !unseen(node.id) && !ids.has(node.id)) {
      problems.push(`${file}:${node.n} ${node.verb === 'remove' ? 'removes' : 'modifies'} ${node.id}, which the code before the work does not hold`);
    }
  }
  for (const edge of model.edges) {
    if (edge.verb === 'remove' && !unseen(edge.from) && !unseen(edge.to) && !edges.has(`${edge.from} ${edge.kind} ${edge.to}`)) {
      problems.push(`${file}:${edge.n} removes the edge ${rowName(edge)}, which the code before the work does not hold`);
    }
  }
  return problems;
}

// An event model row's name, as the design writes it and a verdict on it is keyed.
const rowName = (row) => (row.kind === undefined ? (row.to ? `${row.id} → ${row.to}` : row.id) : `${row.from} → ${row.to} (${row.kind})`);

// The rows ids cannot show, each { row, line, why }, which go by name to the final gate's Contract
// Reviewer and never pass silently: a modify that does not rename, whose node exists before any work,
// and a row of a type the extractor does not emit, with every edge touching one. `nodes` are the
// graph's, for the type of an edge's end the design has no row for.
function handedRows(model, nodes, emits) {
  const unseen = unseenBy(model, nodes, emits);
  const handed = [];
  for (const node of model.nodes) {
    if (!emits.includes(node.type)) handed.push({ row: rowName(node), line: node.n, why: `the extractor does not emit its type, ${node.type}` });
    else if (node.verb === 'modify' && !node.to) handed.push({ row: rowName(node), line: node.n, why: 'it modifies a node that exists before any work, so its id shows nothing' });
  }
  for (const edge of model.edges) {
    const ends = [edge.from, edge.to].filter(unseen);
    if (ends.length) handed.push({ row: rowName(edge), line: edge.n, why: `it touches ${ends.join(' and ')}, of a type the extractor does not emit` });
  }
  return handed;
}

// A label's slug, as a row's id ends in it: camel-case humps and every run of other characters
// become one hyphen, lowercased. `Order Placed` and `OrderPlaced` are both `order-placed`.
const slug = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

// The name the code of a node labelled `label` carries when its type's word is `word`: the label
// without the word it may end in, in PascalCase, then the word once. `Greeter` and `Greeter Aggregate`
// are both `GreeterAggregate`. The label ends in the word when its last letters and digits spell it,
// case and anything between them aside; a label that is nothing but the word keeps it.
export function codeName(label, word) {
  const tail = new RegExp(`[^a-zA-Z0-9]*${[...word].join('[^a-zA-Z0-9]*')}$`, 'i');
  const stripped = label.replace(tail, '');
  const bare = slug(stripped) === '' ? label : stripped;
  const pascal = slug(bare).split('-').filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
  return `${pascal}${word}`;
}

// The id a proposed row's code extracts to under the repository's type words (designTooling.typeWords):
// the row's id with its label's slug replaced by its code name's. None where the repository declares no
// word for the row's type, or the row's id does not end in its label's slug.
export function codeId(row, typeWords) {
  const word = typeWords?.[row.type];
  const own = row.label === undefined ? '' : slug(row.label);
  if (!word || own === '' || !row.id.endsWith(own)) return undefined;
  return `${row.id.slice(0, -own.length)}${slug(codeName(row.label, word))}`;
}

// Convergence: what the extracted graph says of each event model row the extractor can show; the
// rows it cannot are handed on (handedRows). Each finding cites the design row it is about. A proposed
// node is realized by its own id, or, where the graph lacks that id, by its code id under the
// repository's type words (codeId), which every edge row naming it then names too.
export function converge(model, graph, emits, file, typeWords) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const edges = new Set(graph.edges.map((e) => `${e.from} ${e.kind} ${e.to}`));
  const built = new Map();
  for (const node of model.nodes.filter((n) => n.verb === 'propose' && !ids.has(n.id))) {
    const code = codeId(node, typeWords);
    if (code !== undefined && ids.has(code)) built.set(node.id, code);
  }
  const real = (id) => built.get(id) ?? id;
  const handed = handedRows(model, graph.nodes, emits);
  const apart = new Set(handed.map((h) => h.line));
  const findings = [];
  const find = (line, claim) => findings.push({ file, line, claim });
  // A modify that does not rename is handed on for what it changes, but its node must still be there.
  for (const node of model.nodes.filter((n) => n.verb === 'modify' && !n.to && emits.includes(n.type))) {
    if (!ids.has(node.id)) find(node.n, `${node.id} is not in the extracted graph, but the design modifies it, not removes it`);
  }
  for (const node of model.nodes.filter((n) => !apart.has(n.n))) {
    if (node.verb === 'remove') {
      if (ids.has(node.id)) find(node.n, `${node.id} is still in the extracted graph, but the design removes it`);
      continue;
    }
    const id = node.to ?? node.id;
    if (!ids.has(real(id))) find(node.n, `${id} is not in the extracted graph, so the code does not realize this ${node.verb}`);
    if (node.to && ids.has(node.id)) find(node.n, `${node.id} is still in the extracted graph, but the design renames it to ${node.to}`);
  }
  for (const edge of model.edges.filter((e) => !apart.has(e.n))) {
    const present = edges.has(`${real(edge.from)} ${edge.kind} ${real(edge.to)}`);
    if (edge.verb === 'propose' && !present) find(edge.n, `the edge ${rowName(edge)} is not in the extracted graph`);
    if (edge.verb === 'remove' && present) find(edge.n, `the edge ${rowName(edge)} is still in the extracted graph, but the design removes it`);
  }
  return { findings, handed };
}

// The final gate's convergence, which land keeps in the run state, where the session cannot change it:
// the engine's own findings (every row the graph at HEAD does not bear out, every locked line no longer
// in place, every gap still open) and the rows handed to the Contract Reviewer. The graph is extracted
// in `dir`, a scratch checkout of HEAD, installed here. An extraction that fails is a finding too, so
// an extractor's blind spot reaches the pull request.
export function convergeIn(ctx, run, dir) {
  const file = run.design;
  const model = eventModel(designAt(ctx.git, run));
  const { extract: extractor, emits, typeWords } = run.adapters;
  const extraction = extractIn(ctx, run.adapters, dir);
  const result = extraction.graph
    ? converge(model, extraction.graph, emits, file, typeWords)
    : { findings: [{ file, line: model.line, claim: `convergence is unchecked: the extractor (${extractor}) failed: ${extraction.why}` }], handed: handedRows(model, [], emits) };
  result.findings.push(...locksAt(ctx, run, 'HEAD'), ...(run.scaffold ? openGaps(ctx.git, run.scaffold, 'HEAD', [itemDirectory(run)]) : []));
  return { extractor, ...result };
}
