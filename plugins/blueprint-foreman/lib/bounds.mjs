// A step's bounds: the commit it counts from, the paths it may change, and whether it must change
// something. Every record is held to its step's bounds before its evidence is weighed, by the one
// check here: at red and green a change out of bounds is a failed try, which spends an attempt; at
// every other step it is refused until the one restore command below puts the code back. The run
// directory is the run's own, and never part of a step's change.

import { ENGINE, isProtected } from './config.mjs';
import { quote } from './git.mjs';
import { lockRefusal, locksAt } from './locks.mjs';
import { ownPaths } from './run.mjs';

// What most steps may change.
export const NOTHING = () => false;

// The merges on the branch's own line since `from`, the latest first, that the branch still carries.
// One it took out again whole came to nothing, whatever the commits that did it: a later commit on
// the line holds, outside the run directory, the tree the merge's first parent held, as a revert of
// it does.
export function mergesSince(ctx, run, from) {
  const apart = ownPaths(run);
  const line = ctx.git.lineSince(from);
  return line.flatMap(({ sha, parents }, i) => {
    if (parents.length < 2) return [];
    const out = line.slice(0, i).reverse().some((later) => ctx.git.changedFiles(parents[0], later.sha, apart).length === 0);
    return out ? [] : [sha];
  });
}

// The command that takes `merges` out, the latest first, each by a revert of its own.
export const takingOut = (merges) => `git revert --no-edit -m 1 ${merges.join(' ')}`;

// Why the branch is out of the bounds { from, may, must }, or null when it is within them. `may` tests
// a path; `restore` marks a committed change, which the restore command undoes.
export function checkBounds(ctx, run, { from, may = NOTHING, must = false }) {
  const apart = ownPaths(run);
  const dirty = ctx.git.dirtyFiles(apart);
  if (dirty.length) return { reasons: [`commit or discard every change first; uncommitted: ${dirty.join(', ')}`] };
  // Restoring merged files would undo someone else's work, so the run stops instead: the wake that
  // resumes it judges the merge as it judges one taken in at rest.
  const merges = mergesSince(ctx, run, from);
  if (merges.length) {
    return {
      reasons: [
        `the branch took in merge ${merges[0]} since ${from}, and a run judges merged work only when it wakes at rest`,
        `stop the run, so the fire that resumes it checks the merged code: ${ENGINE} record ${run.key} need "the branch took in merge ${merges[0]} while the run was working; answer, and the next fire checks the merged code"`,
      ],
    };
  }
  const changed = ctx.git.changedFiles(from, 'HEAD', apart);
  const judges = changed.filter(isProtected(run.protect));
  if (judges.length) return { reasons: [`no step may change a protected path: ${judges.join(', ')}`], restore: true };
  const outside = changed.filter((f) => !may(f));
  if (outside.length) return { reasons: [`the branch changed since ${from}, outside what this step may change: ${outside.join(', ')}`], restore: true };
  if (must && changed.length === 0) return { reasons: [`nothing was committed since ${from}`] };
  const broken = changed.length ? locksAt(ctx, run, 'HEAD') : [];
  return broken.length ? { reasons: lockRefusal(broken), restore: true } : null;
}

// The one restore command: the code, but not the run directory, back to `to` as a new commit, so the
// pushed branch is never rewritten and the failed try stays on record.
export function restoreCommand(run, to) {
  return `git restore --source=${to} --staged --worktree -- . ${ownPaths(run).map((p) => quote(`:(exclude)${p}`)).join(' ')} && git commit --allow-empty --quiet -m "chore(blueprint-foreman): restore ${run.key} to ${to.slice(0, 12)}"`;
}

export function restoring(run, to) {
  return `restore the code to ${to}, keeping the run state: ${restoreCommand(run, to)}`;
}
