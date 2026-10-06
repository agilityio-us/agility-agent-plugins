// The step table every step joins, what the engine prints for a step, and `record`, by which the
// session hands the engine a step's evidence, stops the run on a need, or rejects the design. Every
// record is held to its step's bounds (bounds.mjs) before its evidence is weighed, and goes on through
// the stages its practices hold (stages.mjs). The plan step is in plan.mjs, a slice's steps in
// slice.mjs, its review in review.mjs, the gates in gates.mjs and settle in settle.mjs; the stopped
// rest and the rejected end are here, beside the need and the claim that lead to them; `wake` is the
// way in.

import { checkBounds, restoring } from './bounds.mjs';
import { ENGINE } from './config.mjs';
import { criterionKeys, designAt, eventModel } from './design.mjs';
import { GATE_STEPS } from './gates.mjs';
import { heldLines, itemDirectory } from './locks.mjs';
import { PLAN_STEPS } from './plan.mjs';
import { REVIEW_STEPS, logLine } from './review.mjs';
import { SETTLE_STEPS } from './settle.mjs';
import { SLICE_STEPS, spend } from './slice.mjs';
import { onward } from './stages.mjs';
import { createModels } from './models.mjs';
import { advance, answersGiven, hasRun, loadRun, runStateCommit, saveRun, stop } from './run.mjs';

const STOPPED = {
  stopped: {
    title: 'stopped',
    records: null,
    instruct: (run) => [
      `The run is stopped (stop ${run.stops}): ${run.stop.need}`,
      'Push the run state, then end the session.',
      'The run goes on at a fire that carries the answer.',
    ],
    record: () => null,
    accept: () => ({ refused: ['the run is stopped'] }),
  },
  rejected: {
    title: 'rejected',
    records: null,
    instruct: (run) => [
      `The run is rejected at ${run.rejection.from}: ${run.rejection.why}`,
      'Push the run state, then end the session.',
      'No fire goes on from a rejected run: Blueprint deletes this branch and fires again once the design or the scaffold is put right.',
    ],
    record: () => null,
    accept: () => ({ refused: ['the run is rejected'] }),
  },
};

export const STEPS = { ...PLAN_STEPS, ...SLICE_STEPS, ...REVIEW_STEPS, ...GATE_STEPS, ...SETTLE_STEPS, ...STOPPED };
// The steps a run rests at, left only by a fire.
export const AT_REST = ['stopped', 'settled'];
// Whether the run is at a step that takes records: neither at rest nor rejected, which nothing leaves.
const active = (run) => ![...AT_REST, 'rejected'].includes(run.step);

export function describe(run, ctx) {
  const step = STEPS[run.step];
  const lines = [`blueprint-foreman ${run.key} · step: ${run.step} (${step.title})`, '', ...step.instruct(run, ctx)];
  // Every answer given in the cycle stays with every step for the rest of it.
  if (active(run)) lines.push(...answersGiven(ctx.git, run));
  const record = step.record(run);
  if (record) lines.push('', `When done, record it: ${record}`);
  if (active(run)) {
    lines.push(`If this step needs information or an effect the run may not perform, stop instead: ${ENGINE} record ${run.key} need "<what>"`);
    lines.push(`If the design or the scaffold is wrong and only a new one puts it right, reject it, citing what shows it: ${ENGINE} record ${run.key} reject "<why>"`);
  }
  return lines.join('\n');
}

// What the engine prints when it takes no record, or, as `state`, a signal of its own.
export function refusal(key, reasons, state = 'refused') {
  return [`blueprint-foreman ${key ? `${key} ` : ''}· ${state}`, ...reasons.map((r) => `  - ${r}`)].join('\n');
}

// What a rejection may cite, and how: a criterion key or an event model node's id in backticks, an
// edge as the design writes it, or a locked scaffold line as path:line where HEAD holds it.
const CITING = 'cite what shows it: a criterion key or an event model row as the design writes it in backticks, or a locked scaffold line as path:line at HEAD';
const EDGE_CITED = /`([^`]+)`\s*→\s*`([^`]+)`\s*\(([^)]+)\)/g;
const SPAN = /`([^`]*)`/g;
const LINE_CITED = /^([\w./-]*[./][\w./-]*):(\d+)$/;
const LINES_CITED = /(?<![\w./-])([\w./-]*[./][\w./-]*):(\d+)(?!\w)/g;

// Every citation in `why` that names nothing the run holds, or null where `why` cites nothing. Edges
// are read first, then the other spans in backticks, then path:line outside them. The engine checks
// that each exists, never that the claim is true.
function unresolved(ctx, run, why) {
  const design = designAt(ctx.git, run);
  const model = eventModel(design);
  const ids = new Set([...criterionKeys(design), ...model.nodes.flatMap((n) => [n.id, n.to].filter(Boolean))]);
  const held = new Set(heldLines(ctx.git, run.scaffold, 'HEAD', [itemDirectory(run)]));
  const missing = [];
  let cited = 0;
  const line = (file, n) => {
    cited += 1;
    if (!held.has(`${file}:${n}`)) missing.push(`${file}:${n} is no line of the scaffold the lock holds at HEAD`);
  };
  const rest = why
    .replace(EDGE_CITED, (whole, from, to, kind) => {
      cited += 1;
      if (!model.edges.some((e) => e.from === from && e.kind === kind.trim() && e.to === to)) missing.push(`${whole} is no event model edge of the design`);
      return ' ';
    })
    .replace(SPAN, (whole, span) => {
      const at = LINE_CITED.exec(span);
      if (at) line(at[1], Number(at[2]));
      else {
        cited += 1;
        if (!ids.has(span)) missing.push(`${whole} is neither a criterion key nor an event model node of the design`);
      }
      return ' ';
    });
  for (const [, file, n] of rest.matchAll(LINES_CITED)) line(file, Number(n));
  return cited ? missing : null;
}

// What follows every change to the run, so the branch never lags it: the run-state commit, after the
// restore to `restore` where the code must go back first, so the run state comes to rest on it.
export function committing(run, restore) {
  const commit = `the run state, then push it: ${runStateCommit(run)}`;
  return restore ? `First, ${restoring(run, restore)}\n\nThen commit ${commit}` : `Commit ${commit}`;
}

// A step's accept, gone on through the stages it names (stages.mjs), with evidence it cannot read as
// JSON refused as the one refusal for it (run.mjs).
async function accepting(step, run, ctx, value) {
  try {
    return onward(ctx, run, await step.accept(run, ctx, value));
  } catch (e) {
    if (e.code === 'UNREADABLE') return { refused: [e.message] };
    throw e;
  }
}

// A loaded run, with `ctx` choosing models from the table the run pinned at admission.
export function pinned(run, ctx) {
  if (run.models) ctx.models = createModels(run.models);
  return run;
}

export async function record(key, what, value, ctx) {
  if (!hasRun(ctx.root, key)) return { code: 1, text: refusal(key, [`no run for ${key} here; a fire wakes one: ${ENGINE} wake, the fire on stdin`]) };
  const run = pinned(loadRun(ctx, key), ctx);
  // Any active step may stop the run for what it cannot get or must not do itself. It rests on the
  // commit it stopped at.
  if (what === 'need') {
    if (!active(run)) return { code: 1, text: refusal(key, [`the run is ${run.step}; there is nothing to stop`]) };
    if (!value) return { code: 1, text: refusal(key, ['say what the run needs: record <KEY> need "<what>"']) };
    const next = advance(run, 'need', 'stopped', ctx.now(), stop(run, { kind: 'need', need: value, from: run.step, at: ctx.git.head() }));
    saveRun(ctx.root, next);
    return { code: 0, text: `blueprint-foreman ${key} · stopping\n\n${committing(next)}\n\n${describe(next, ctx)}` };
  }
  // Any active step may reject the design or the scaffold, where only a new one puts it right, citing
  // what shows it. The run ends there, and no fire goes on from it.
  if (what === 'reject') {
    if (!active(run)) return { code: 1, text: refusal(key, [`the run is ${run.step}; there is nothing to reject`]) };
    const missing = value ? unresolved(ctx, run, value) : null;
    if (!missing) return { code: 1, text: refusal(key, [`a rejection must ${CITING}: record <KEY> reject "<why>"`]) };
    if (missing.length) return { code: 1, text: refusal(key, [...missing, `a rejection must ${CITING}`]) };
    const next = advance(run, 'reject', 'rejected', ctx.now(), { rejection: { from: run.step, why: value } });
    saveRun(ctx.root, next);
    return { code: 0, text: `blueprint-foreman ${key} · rejecting\n\n${committing(next)}\n\n${describe(next, ctx)}` };
  }
  const step = STEPS[run.step];
  if (what !== step.records) {
    return { code: 1, text: `${refusal(key, [`step ${run.step} records "${step.records ?? 'nothing yet'}", not "${what}"`])}\n\n${describe(run, ctx)}` };
  }
  // Each step is held to its bounds, by default that it changes nothing since the engine last
  // accepted the code. Out of them, red and green spend an attempt; any other step waits for the
  // code to be restored.
  const bounds = { from: run.accepted, ...step.bounds?.(run, value, ctx) };
  const breach = checkBounds(ctx, run, bounds);
  const outcome = !breach
    ? await accepting(step, run, ctx, value)
    : breach.restore && step.spends
      ? spend(run, breach.reasons, run.step)
      : { refused: breach.restore ? [...breach.reasons, restoring(run, bounds.from)] : breach.reasons };
  if (outcome.refused && !outcome.next) return { code: 1, text: `${refusal(key, outcome.refused)}\n\n${describe(run, ctx)}` };
  // The record takes effect and the run moves; a spent attempt is both, its try refused as the run
  // moves on to the retry or the stop. The agent id of each Red, Green, Builder and Mutant it takes
  // joins the run's authors, whom no Mutant and no Contract Reviewer may be. Only now are the calibration lines
  // the accept gave logged, so a record refused and tried again logs once. A spent attempt's code is
  // restored before its run state is committed.
  const authors = step.authors && value ? { authors: [...new Set([...(run.authors ?? []), value])] } : {};
  const next = advance(run, outcome.refused ? `${what} refused` : what, outcome.next, ctx.now(), { ...outcome.extra, ...authors });
  saveRun(ctx.root, next);
  for (const fields of outcome.log ?? []) logLine(ctx.root, run, fields);
  const head = outcome.refused ? refusal(key, outcome.refused) : `blueprint-foreman ${key} · recorded ${what}`;
  return { code: outcome.refused ? 1 : 0, text: `${head}\n\n${committing(next, outcome.restore)}\n\n${describe(next, ctx)}` };
}
