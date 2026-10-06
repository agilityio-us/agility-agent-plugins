// The stages of a run, and the one place it moves between them. A practice is a stage the engine skips:
// a step's accept goes on by naming the stage that follows it, `{ onward: <stage> }`, and `onward` enters
// it where the run's practices hold it, else the stage after it, running on the way what takes no
// evidence (the replays, a slice's landing, the final run) inside the record that reached it. Which
// stages run is decided here alone; a step tests a practice only where its own content differs: a plan's
// fields, a brief, settle's sections. No stage a practice skips holds the foundation: every record's
// bounds, the replays, the final run, the budget, the stops and settle hold whatever the practices.
//
//   plan, the plan gate (slices and adversary), then for each slice: red and green (red-green), or the
//   Builder; the mutant (mutant); the replays; review (review); the landing. Then the final run and the
//   final gate, which asks the Contract Reviewer (review) and the Adversary (adversary), and with both
//   off holds the final run's findings alone; then settle.

import { closeRound } from './gates.mjs';
import { freshSlice, nextSlice } from './plan.mjs';
import { maker, openGate } from './run.mjs';
import { attemptDir, land, openFinal, replayed } from './slice.mjs';

// A slice's findings that no review settles, handed off, so the description shows each.
const unreviewed = (run) =>
  (run.slice.findings ?? []).map(({ file, line, claim, source }, i) => ({ at: attemptDir(run), cycle: run.cycle, finding: i + 1, file, line, claim, ...(source ? { source } : {}), note: 'unreviewed: the review practice is off' }));

const STAGES = {
  // The plan gate is the Adversary's attack on how the work is sliced, so it needs both practices; a
  // replan that adds no slice has nothing for it.
  'plan-gate': (ctx, run) =>
    run.practices.slices && run.practices.adversary && nextSlice(run.plan, run.landed ?? [])
      ? { next: 'gate', extra: { slice: null, gate: openGate('plan', run.cycle) } }
      : { onward: 'slice' },
  // The next slice whose dependencies landed, at its first step; with none left, the final gate.
  slice(ctx, run) {
    const next = nextSlice(run.plan, run.landed ?? []);
    if (!next) return { onward: 'final' };
    return { next: maker(run, 'red'), extra: { slice: freshSlice(next, ctx.git.head(), ctx.config.budget) } };
  },
  // After the candidate, green's or the Builder's: the Mutant, whose record runs the replays, or the
  // replays at once.
  mutant: (ctx, run) => (run.practices.mutant ? { next: 'mutant' } : replayed(run, ctx)),
  review: (ctx, run) => (run.practices.review ? { next: 'group-review' } : { onward: 'land', extra: { handedOff: [...(run.handedOff ?? []), ...unreviewed(run)] } }),
  land: (ctx, run) => land(run),
  // The final run, then the final gate: a step where a reviewer judges it, else its round closed at once
  // on the final run's findings.
  final(ctx, run) {
    const opened = openFinal(ctx, run, run.gate?.name === 'final' ? run.gate : openGate('final', run.cycle));
    if (run.practices.review || run.practices.adversary) return { next: 'gate', extra: opened };
    const closed = closeRound({ ...run, ...opened }, ctx);
    return { ...closed, extra: { ...opened, ...closed.extra } };
  },
};

// Where `outcome` goes from `run`, the run state before the record: on through each stage it names to a
// step, each stage's changes over those before it and its calibration lines after theirs.
export function onward(ctx, run, outcome) {
  let out = outcome;
  while (out.onward) {
    const { onward: stage, ...before } = out;
    const more = STAGES[stage](ctx, { ...run, ...before.extra });
    out = { ...before, ...more, extra: { ...before.extra, ...more.extra }, log: [...(before.log ?? []), ...(more.log ?? [])] };
  }
  return out;
}
