// Settle: the pull request's description, the exhibits and the lessons, and the settled rest. The
// session writes its part of the description, pr-notes.md: the decisions the code cannot explain, the
// deferrals, the lessons. The engine joins it with what it alone vouches for, each criterion's verdict,
// every exhibit, the practices the run held and every finding handed off, into pull-request.md beside
// the design, and finds the lessons commit itself. The run opens no pull request: the run-state commit
// that carries the description signals done, and Blueprint posts it on the item's one pull request. A
// section a practice writes is there only where the run holds it: with exhibits off there is no
// Exhibits section, and with lessons off no Lessons section, no lessons commit and no lesson home. A
// settled run goes on only as `wake` opens its next cycle, on a newer scaffold Blueprint commits to its
// branch.

import fs from 'node:fs';
import path from 'node:path';
import { restoring } from './bounds.mjs';
import { ENGINE } from './config.mjs';
import { criteria, designAt } from './design.mjs';
import { within } from './git.mjs';
import { PRACTICES } from './payload.mjs';
import { exhibitsIn } from './slice.mjs';
import { ownPaths, pullRequestFile, runDirectory, runFile } from './run.mjs';

// Where a lesson may land: the lesson homes the adapters name that the admitted commit holds, derived
// from the branch rather than kept in the run state, and nowhere else; none where the run has the
// lessons practice off.
const homesAt = (git, run) => (run.practices.lessons ? run.adapters.lessonHomes.filter((h) => git.filesAt(run.startCommit, h).length > 0) : []);

// The description's sections in order, each with the practice that writes it, if one does; of them the
// session's are pr-notes.md's, which pull-request.md joins with the engine's.
const SECTIONS = [['Decisions'], ['Deferrals'], ['Criteria'], ['Exhibits', 'exhibits'], ['Practices'], ['Gates'], ['Handed-off findings'], ['Lessons', 'lessons']];
const SESSIONS = ['Decisions', 'Deferrals', 'Lessons'];
const bodyOf = (run) => SECTIONS.filter(([, practice]) => !practice || run.practices[practice]).map(([s]) => s);
const notesOf = (run) => bodyOf(run).filter((s) => SESSIONS.includes(s));
const NO_LESSONS = 'No lessons from this run.';

const flat = (text) => String(text).replace(/\s+/g, ' ').trim();
const listed = (names) => names.join(', ') || 'none';

// pr-notes.md's sections, each its lines by heading, and its problems: it holds the session's, `NOTES`,
// each once, and nothing else.
function readNotes(text, NOTES) {
  const sections = new Map();
  const problems = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^## (.+?)\s*$/.exec(line)?.[1];
    if (heading !== undefined) {
      if (!NOTES.includes(heading)) problems.push(`pr-notes.md holds "## ${heading}", but only ${NOTES.map((s) => `"## ${s}"`).join(', ')}: the engine writes the rest of the description`);
      else if (sections.has(heading)) problems.push(`pr-notes.md holds "## ${heading}" twice`);
      current = [];
      sections.set(heading, current);
    } else if (current) {
      current.push(line);
    } else if (line.trim()) {
      problems.push('pr-notes.md holds text before its first section, and holds only its sections');
      current = [];
    }
  }
  for (const s of NOTES) if (!sections.has(s)) problems.push(`pr-notes.md is missing "## ${s}"`);
  return { sections, problems };
}

// Every exhibit is one a proof run wrote, as the run records it: committed at HEAD as its proof run
// wrote it, with nothing else under the exhibits directory, tracked or about to be committed with the
// run state.
function exhibitProblems(run, ctx) {
  const recorded = Object.values(run.exhibits ?? {}).flat();
  const problems = recorded.length || !run.practices.exhibits ? [] : ['the run has no exhibit, and the pull request must show the work'];
  const dir = `${runDirectory(run)}/exhibits`;
  const present = new Set([...ctx.git.filesAt('HEAD', dir), ...exhibitsIn(ctx.root, path.join(ctx.root, dir))]);
  for (const file of [...present].sort()) {
    if (!recorded.some((r) => r.file === file)) problems.push(`${file} is not an exhibit any accepted proof run wrote`);
  }
  for (const { file, blob } of recorded) {
    const committed = ctx.git.blobAt('HEAD', file);
    if (committed === null) problems.push(`the exhibit ${file} is not committed; the run-state commit carries it`);
    else if (committed !== blob) problems.push(`the exhibit ${file} is not what its proof run wrote`);
  }
  return problems;
}

// The repository's owner and name on GitHub, `owner/repo`, from origin's URL in its https or ssh form,
// or null. The URL may carry a credential, so only what it names is kept, and nothing prints it.
export function githubRepository(url) {
  const m = /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?[^/]+\/|[^@/:\s]+@[^/:\s]+:\/?)(?:[^?#\s]*\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url ?? '');
  return m ? `${m[1]}/${m[2]}` : null;
}


// A link to a file as the commit `sha` holds it, which outlives the branch.
const blobLink = (repository, sha, file) => `https://github.com/${repository}/blob/${sha}/${file.split('/').map(encodeURIComponent).join('/')}`;
const linkText = (text) => text.replace(/[[\]\\]/g, '\\$&');

// The description: the session's sections from pr-notes.md, and the engine's own: each criterion's
// verdict as the cycle's last final round gave it, every exhibit captioned with what its slice promised
// and linked by `sha`, which carries each as its proof run wrote it, the practices the run was admitted
// with, those on and those the fire turned off, each gate round with its Adversary and the findings
// fixed there, every finding this cycle hands off, those it settled again from the cycle before among
// them, and after the session's lessons every cycle's lessons commit. With review off no criterion is
// judged, and with adversary off no round has an Adversary.
function joinBody(run, ctx, notes, repository, sha) {
  const exhibits = Object.entries(run.exhibits ?? {})
    .filter(([, files]) => files.length)
    .map(([id, files]) => {
      const { exhibit } = run.plan.slices.find((s) => s.id === id);
      const links = files.map(({ file }) => `[${linkText(path.posix.relative(`${runDirectory(run)}/exhibits/${id}`, file))}](${blobLink(repository, sha, file)})`);
      return `- ${flat(exhibit.shows)} (${exhibit.form}, slice ${id}): ${links.join(', ')}`;
    });
  const handed = new Map();
  for (const h of (run.handedOff ?? []).filter((f) => f.cycle === run.cycle)) {
    const claim = `${h.file}:${h.line}: ${flat(h.claim)}`;
    if (!handed.has(claim)) handed.set(claim, `- ${h.at}${h.row ? '' : ` #${h.finding}`}, ${claim}${h.note ? ` (${h.note})` : ''}`);
  }
  const gates = (run.rounds ?? []).flatMap((r) => [
    `- ${r.gate} gate, cycle ${r.cycle}, round ${r.round}${r.merge ? `, after merge ${r.merge}` : ''}: ${r.adversary ? `its Adversary was ${r.adversary}` : 'no Adversary, the adversary practice being off'}`,
    ...(run.fixed ?? []).filter((f) => f.at === r.at).map((f) => `  - fixed #${f.finding}, ${f.file}:${f.line}: ${flat(f.claim)}`),
  ]);
  const { verdicts } = (run.rounds ?? []).filter((r) => r.cycle === run.cycle && r.verdicts).at(-1) ?? {};
  const committed = (run.lessons ?? []).filter((l) => l.commit).map((l) => `[${l.commit.slice(0, 12)}](https://github.com/${repository}/commit/${l.commit}) (cycle ${l.cycle})`);
  const own = {
    Criteria: criteria(designAt(ctx.git, run)).map((c) => {
      const v = verdicts?.[c.key];
      if (!run.practices.review) return `- \`${c.key}\`: not reviewed, the review practice being off`;
      return `- \`${c.key}\`: ${v ? `${v.met ? 'met' : 'not met'}. ${flat(v.evidence)}` : 'no verdict'}`;
    }),
    Exhibits: exhibits,
    Practices: [`Ran: ${listed(PRACTICES.filter((p) => run.practices[p]))}. Turned off: ${listed(PRACTICES.filter((p) => !run.practices[p]))}.`],
    Gates: gates,
    'Handed-off findings': handed.size ? [...handed.values()] : ['None.'],
  };
  const lessons = () => [notes.get('Lessons').join('\n').trim(), ...(committed.length ? ['', `Lessons commits: ${committed.join(', ')}.`] : [])];
  return bodyOf(run).map((s) => `## ${s}\n\n${(s === 'Lessons' ? lessons() : (notes.get(s) ?? own[s])).join('\n').trim()}\n`).join('\n');
}

// The lessons commit, found: the last commit since the final gate that changed anything outside the
// run directory, whose change must be the whole change since then, so a reviewer can keep or drop it
// whole; the step's bounds hold that change to the lesson homes. Returns { commit }, null where
// nothing changed, or { refused } with the restore that lets the lessons be committed again as one.
function lessonsCommit(run, ctx) {
  const apart = ownPaths(run);
  if (ctx.git.changedFiles(run.accepted, 'HEAD', apart).length === 0) return { commit: null };
  const last = ctx.git.lastChange(run.accepted, apart);
  const before = ctx.git.changedFiles(run.accepted, `${last}~1`, apart);
  if (before.length) {
    return {
      refused: [
        `the lessons are not one commit: before ${last}, the last commit that changed them, the branch had already changed ${before.join(', ')} since the final gate`,
        restoring(run, run.accepted),
        'then commit the lessons again, in one commit',
      ],
    };
  }
  return { commit: last };
}

function settle(run, ctx) {
  const file = runFile(ctx.root, run, 'pr-notes.md');
  if (!fs.existsSync(file)) return { refused: [`${runDirectory(run)}/pr-notes.md does not exist`] };
  const notes = readNotes(fs.readFileSync(file, 'utf8'), notesOf(run));
  const repository = githubRepository(ctx.git.originUrl());
  const problems = [
    ...notes.problems,
    ...exhibitProblems(run, ctx),
    ...(repository ? [] : ["origin names no GitHub repository in its https or ssh form, so the exhibits cannot be linked (the engine never prints origin's URL)"]),
  ];
  if (problems.length) return { refused: problems };
  const lessons = lessonsCommit(run, ctx);
  if (lessons.refused) return lessons;
  if (!lessons.commit && run.practices.lessons && !/no lessons/i.test(notes.sections.get('Lessons').join('\n'))) {
    return { refused: [`with no lessons commit, pr-notes.md's "## Lessons" says "${NO_LESSONS}"`] };
  }
  const head = ctx.git.head();
  const kept = { lessons: [...(run.lessons ?? []), { cycle: run.cycle, commit: lessons.commit }] };
  fs.writeFileSync(path.join(ctx.root, pullRequestFile(run)), joinBody({ ...run, ...kept }, ctx, notes.sections, repository, head));
  return { next: 'settled', extra: { ...kept, accepted: head } };
}

export const SETTLE_STEPS = {
  settle: {
    title: 'settle the run',
    records: 'notes',
    instruct(run, ctx) {
      const says = { Decisions: 'the choices the code cannot explain', Deferrals: 'what is left, each with who picks it up', Lessons: `what the run taught, or "${NO_LESSONS}"` };
      const own = bodyOf(run).filter((s) => !SESSIONS.includes(s)).map((s) => `## ${s}`);
      return [
        `Settle as the skill says. Write ${runDirectory(run)}/pr-notes.md, the session's part of the pull request's description,`,
        'holding these sections (## headings) and nothing else:',
        ...notesOf(run).map((s) => `  ## ${s}: ${says[s]}`),
        `The engine joins them with its own, ${own.slice(0, -1).join(', ')} and ${own.at(-1)}, into ${pullRequestFile(run)}.`,
        run.practices.lessons
          ? `A lesson lands in one commit touching only the lesson homes present at run start (${homesAt(ctx.git, run).join(', ') || 'none'}); the engine finds it.`
          : 'The lessons practice is off, so the branch takes no lessons commit: nothing changes from here.',
      ];
    },
    record: (run) => `${ENGINE} record ${run.key} notes`,
    // After the final gate the branch may change only by the lessons commit, in the lesson homes.
    bounds: (run, value, ctx) => ({ from: run.accepted, may: within(homesAt(ctx.git, run)) }),
    accept: settle,
  },

  settled: {
    title: 'settled',
    records: null,
    // The run opens no pull request and writes no description but the file: Blueprint, which holds the
    // keys, posts the file on the item's pull request when it reads done.
    instruct(run) {
      return [
        `The run delivered cycle ${run.cycle}. Its run-state commit carries ${pullRequestFile(run)}, the pull request's description,`,
        'and signals done, on which Blueprint merges this branch and posts the description: push it, and end the session.',
        'Open no pull request and write no description anywhere else.',
        `A next cycle opens only on a newer scaffold on ${run.itemBranch}.`,
      ];
    },
    record: () => null,
    accept: () => ({ refused: ['the run is settled; only a newer scaffold, at the next fire, opens another cycle'] }),
  },
};
