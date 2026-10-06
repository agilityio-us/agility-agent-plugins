// The locks: code a run may add to but never change. The scaffold in force is the latest commit whose
// message carries `Blueprint-Scaffold: <KEY>`, in which Blueprint realized the design's event model in
// code before the run; its gaps are the lines that carry TODO(scaffold), and every other line it added
// is locked, but in the item's directory, which no step changes. A landed slice's tests are locked too, every line the slice added to its frozen files, so a
// later slice may add tests beside them but not weaken them.
//
// In a script, a locked line's tokens must all still be there, in order, as code: anything may be
// inserted between them, even within a line, and formatting is ignored, but a token removed, changed,
// commented out or swallowed by a string is a break. Comments are not code, and strings, templates
// and regular expressions are single tokens. The engine reads tokens itself rather than loading the
// repository's TypeScript, which would run code the implementers could plant inside the engine. In any
// other file, a locked line must still appear, trimmed and in order. A landed test's line must hold
// both ways, since code inserted within it, as `0 && ` before an assertion, disarms it. Blank lines
// are not locked.

import path from 'node:path';
import { GAP_MARKER, RUN_TRAILER, SCAFFOLD_TRAILER } from './config.mjs';
import { within } from './git.mjs';

// A line that names the scaffold trailer, in whatever form, for git's grep and for ours.
const SCAFFOLD_WORD = 'blueprint[-_ ]?scaffold';

// The commits reachable from `commit` carrying this item's scaffold trailer as git reads trailers, and
// those with a line that names the scaffold and the key in any other form, which admission refuses
// rather than missing. The foreman's own run-state commits are neither, though a refusal's reasons may
// quote the trailer.
export function scaffoldCommits(git, key, commit = 'HEAD') {
  const word = new RegExp(SCAFFOLD_WORD, 'i');
  const names = new RegExp(`(^|[^A-Za-z0-9])${key}([^A-Za-z0-9]|$)`, 'i');
  const exact = [];
  const misspelt = [];
  for (const m of git.messagesMatching(SCAFFOLD_WORD, commit)) {
    if (m.trailers.some((t) => t.startsWith(`${RUN_TRAILER}: `))) continue;
    if (m.trailers.some((t) => t.trim() === `${SCAFFOLD_TRAILER}: ${key}`)) exact.push(m.sha);
    else if (m.lines.some((l) => word.test(l) && names.test(l))) misspelt.push(m.sha);
  }
  return { exact, misspelt };
}

// The scaffold in force among `exact`, the commits carrying the item's trailer: the one every other
// precedes, so a redesign's scaffold supersedes the one before it; null where there is none, or where
// two lie on lines apart and neither is the latest.
export function latestScaffold(git, exact) {
  const latest = exact.filter((c) => exact.every((o) => o === c || git.isAncestor(o, c)));
  return latest.length === 1 ? latest[0] : null;
}

const SCRIPT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
// Keywords before which a `/` opens a regular expression rather than divides.
const EXPRESSION_KEYWORDS = ['return', 'typeof', 'case', 'do', 'else', 'in', 'instanceof', 'new', 'void', 'delete', 'throw', 'yield', 'await'];
// What may come before a `/` that opens a regular expression, to the heuristic.
const BEFORE_REGEX = new Set([...'(,=:[!&|?{};+-*%<>~^', ...EXPRESSION_KEYWORDS]);

// A script's code tokens, each with the line it starts on.
function tokens(text) {
  const out = [];
  let i = 0;
  let line = 1;
  const skip = (to) => {
    for (; i < to; i += 1) if (text[i] === '\n') line += 1;
  };
  while (i < text.length) {
    const c = text[i];
    const start = i;
    const at = line;
    if (/\s/.test(c)) {
      skip(i + 1);
    } else if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      skip(end === -1 ? text.length : end);
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      skip(end === -1 ? text.length : end + 2);
    } else if (c === '"' || c === "'" || c === '`' || (c === '/' && (out.length === 0 || BEFORE_REGEX.has(out.at(-1).t)))) {
      // A quote closes on its line; a template may span lines; a regular expression ignores a slash
      // inside a character class.
      let j = i + 1;
      let inClass = false;
      for (; j < text.length; j += 1) {
        const d = text[j];
        if (d === '\\') j += 1;
        else if (d === '\n' && c !== '`') break;
        else if (c === '/' && d === '[') inClass = true;
        else if (c === '/' && d === ']') inClass = false;
        else if (d === c && !inClass) break;
      }
      skip(Math.min(j + 1, text.length));
      out.push({ t: text.slice(start, i), line: at });
    } else if (/[\w$]/.test(c)) {
      let j = i;
      while (j < text.length && /[\w$]/.test(text[j])) j += 1;
      skip(j);
      out.push({ t: text.slice(start, j), line: at });
    } else {
      skip(i + 1);
      out.push({ t: c, line: at });
    }
  }
  return out;
}

// The line numbers a diff added to its file, and the text of each.
function addedLines(diff, after) {
  const text = (after ?? '').split(/\r?\n/);
  const lines = [];
  let n = 0;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
      n = Number(/\+(\d+)/.exec(line)?.[1] ?? 0);
    } else if (inHunk && line.startsWith('+')) {
      lines.push({ n, text: (text[n - 1] ?? line.slice(1)).trim() });
      n += 1;
    }
  }
  return lines.filter((l) => l.text);
}

// The locked lines of one file that are no longer in place at `commit`, as findings. `before` is the
// file as the lock was taken, and `locked` the lines of it that are locked; `whole` holds each line
// with code on it as a whole trimmed line too, in a script as in any other file.
function holds(git, file, before, locked, commit, claim, whole = false) {
  if (!locked.length) return [];
  const text = git.fileAt(commit, file);
  if (text === null) return [{ file, line: locked[0].n, claim: `${file}, which is locked, is gone` }];
  const broken = new Set();
  let trimmed = locked;
  if (SCRIPT.test(file)) {
    const lines = new Set(locked.map((l) => l.n));
    const byLine = new Map();
    for (const t of tokens(before)) if (lines.has(t.line)) byLine.set(t.line, [...(byLine.get(t.line) ?? []), t.t]);
    trimmed = whole ? locked.filter((l) => byLine.has(l.n)) : [];
    const current = tokens(text).map((t) => t.t);
    // Each locked line's tokens are found in order after the last line found; a line that breaks
    // consumes nothing, so it cannot take tokens a later line needs.
    let j = 0;
    for (const [n, wanted] of byLine) {
      let k = j;
      const found = wanted.every((t) => {
        while (k < current.length && current[k] !== t) k += 1;
        k += 1;
        return k <= current.length;
      });
      if (found) j = k;
      else broken.add(n);
    }
  }
  const current = text.split(/\r?\n/).map((l) => l.trim());
  let at = 0;
  for (const l of trimmed) {
    const found = current.indexOf(l.text, at);
    if (found === -1) broken.add(l.n);
    else at = found + 1;
  }
  return locked.filter((l) => broken.has(l.n)).map((l) => ({ file, line: l.n, claim: claim(l) }));
}

// The lines the scaffold commit `sha` added to `file`, which it holds as `before`, but its gaps.
const scaffoldLocked = (git, sha, file, before) => addedLines(git.commitFileDiff(sha, file), before).filter((l) => !l.text.includes(GAP_MARKER));

// The scaffold's locked lines no longer in place at `commit`, the paths `apart` left out.
export function checkLock(git, sha, commit, apart = []) {
  return git.commitFiles(sha, apart).flatMap((file) => {
    const before = git.fileAt(sha, file) ?? '';
    return holds(git, file, before, scaffoldLocked(git, sha, file, before), commit, (l) => `the scaffold line "${l.text}" (line ${l.n} at the scaffold) was changed, removed, commented out or quoted`);
  });
}

// The scaffold's locked lines the lock holds at `commit`, each as `path:line` where it stands there,
// found in order as a whole trimmed line: what a rejection may cite of the scaffold. A script's line
// with no code on it, a comment, holds nothing.
export function heldLines(git, sha, commit, apart = []) {
  const broken = new Set(checkLock(git, sha, commit, apart).map((f) => `${f.file}:${f.line}`));
  return git.commitFiles(sha, apart).flatMap((file) => {
    const before = git.fileAt(sha, file) ?? '';
    const coded = SCRIPT.test(file) ? new Set(tokens(before).map((t) => t.line)) : null;
    const current = (git.fileAt(commit, file) ?? '').split(/\r?\n/).map((l) => l.trim());
    let at = 0;
    return scaffoldLocked(git, sha, file, before).filter((l) => !coded || coded.has(l.n)).flatMap((l) => {
      const found = current.indexOf(l.text, at);
      if (found === -1) return [];
      at = found + 1;
      return broken.has(`${file}:${l.n}`) ? [] : [`${file}:${found + 1}`];
    });
  });
}

// The landed slices' test lines no longer in place at `commit`. Each landed entry is { id, base,
// commit, paths }: the lines its commits added under its frozen paths.
export function checkLanded(git, landed, commit) {
  return (landed ?? []).flatMap((entry) =>
    git.changedFiles(entry.base, entry.commit).filter(within(entry.paths)).flatMap((file) => {
      const before = git.fileAt(entry.commit, file) ?? '';
      const locked = addedLines(git.rangeFileDiff(entry.base, entry.commit, file), before);
      return holds(git, file, before, locked, commit, (l) => `the line "${l.text}" of ${entry.id}'s tests (line ${l.n} when it landed) was changed or removed; add tests beside it instead`, true);
    }),
  );
}

// The item's directory, where the design and the scaffold's report lie, which the lock leaves to the
// protected paths.
export const itemDirectory = (run) => path.posix.dirname(run.design);

// The locked lines no longer in place at `commit`: the scaffold's, and every landed slice's tests'.
export function locksAt(ctx, run, commit) {
  return [...(run.scaffold ? checkLock(ctx.git, run.scaffold, commit, [itemDirectory(run)]) : []), ...checkLanded(ctx.git, run.landedTests, commit)];
}

// Every gap the scaffold opened that is still open at `commit`: a line carrying the marker in a file the
// scaffold touched, other than those the file already had before it, the paths `apart` left out.
export function openGaps(git, sha, commit, apart = []) {
  const marked = (text) => (text ?? '').split(/\r?\n/).map((l) => l.trim());
  return git.commitFiles(sha, apart).flatMap((file) => {
    const before = new Set(marked(git.fileAt(`${sha}~1`, file)).filter((l) => l.includes(GAP_MARKER)));
    return marked(git.fileAt(commit, file)).flatMap((l, i) => (l.includes(GAP_MARKER) && !before.has(l) ? [{ file, line: i + 1, claim: `a scaffold gap is still open: ${l}` }] : []));
  });
}

// A lock refusal: the failed try's reasons, with what the next try may do.
export function lockRefusal(findings) {
  return [
    ...findings.map((f) => `${f.file}:${f.line}: ${f.claim}`),
    `locked code stays: add code or tests anywhere around it, even within its lines; of the scaffold, only its ${GAP_MARKER} lines may change`,
  ];
}
