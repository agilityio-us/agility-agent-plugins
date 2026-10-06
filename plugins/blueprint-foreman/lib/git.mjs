// The engine's view of git. It reads the session's checkout and never changes it: commits and pushes
// are the session's acts, done on the engine's instruction. The one thing it creates is a scratch
// checkout for a replay, a mutant, an extraction or the final gate's run, which it discards. Injected
// in tests.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BUFFER = 64 * 1024 * 1024;

// How the engine reads every diff: as text, whatever an attribute says of a file, committed or in the
// checkout's git directory where no commit shows it, and never through a driver git's configuration
// names, so neither hides a line from the lock or a reviewer.
const AS_TEXT = ['--no-color', '--text', '--no-ext-diff', '--no-textconv'];

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: BUFFER }).trim();
}

// Paths as git names them, NUL-separated so no path is quoted or split.
function paths(cwd, [command, ...args]) {
  return execFileSync('git', [command, '-z', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: BUFFER }).split('\0').filter(Boolean);
}

// A path is within a set when it is one of them or lies under one that names a directory, as a
// pathspec reads them.
export const within = (set) => (file) => set.some((p) => file === p || file.startsWith(p.endsWith('/') ? p : `${p}/`));

// A path as git names it: relative, forward slashes, no empty, `.` or `..` segment.
export const isRelativePath = (p) => typeof p === 'string' && !p.includes('\\') && !/^[a-zA-Z]:/.test(p) && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');

// A word for the session's POSIX shell, quoted whatever it holds.
export const quote = (word) => `'${String(word).replaceAll("'", `'\\''`)}'`;

// The checkout's git directory, where no commit reaches, or null outside a repository.
export function gitDirectory(root) {
  try {
    return git(root, ['rev-parse', '--absolute-git-dir']);
  } catch {
    return null;
  }
}

export function createGit(root) {
  return {
    currentBranch: () => git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    head: () => git(root, ['rev-parse', 'HEAD']),
    version: () => git(root, ['--version']).replace(/^git version /, ''),
    isShallow: () => git(root, ['rev-parse', '--is-shallow-repository']) === 'true',
    // Tracked changes, staged or not, plus untracked files, outside `apart`, the run's own paths, when
    // given.
    dirtyFiles: (apart) => paths(root, ['status', '--porcelain', '--untracked-files=all', '--no-renames']).map((l) => l.slice(3)).filter((f) => !apart || !within([apart].flat())(f)),
    // A range's diff, a path holding a character outside ASCII named as it is rather than escaped.
    diffText: (from, to, pathspec = []) => execFileSync('git', ['-c', 'core.quotePath=false', 'diff', ...AS_TEXT, from, to, '--', ...pathspec], { cwd: root, encoding: 'utf8', maxBuffer: BUFFER }),
    // Files a range changed, outside `apart` when given: the run directory is never part of a step's
    // change.
    changedFiles: (from, to, apart) => paths(root, ['diff', '--name-only', '--no-renames', from, to, '--', '.', ...[apart ?? []].flat().map((p) => `:(exclude)${p}`)]),
    isAncestor(a, b) {
      try {
        git(root, ['merge-base', '--is-ancestor', a, b]);
        return true;
      } catch {
        return false;
      }
    },
    // Moves a scratch checkout to another commit, or restores a file there, or a list of them, as that
    // commit holds it; untracked files such as node_modules stay.
    checkoutIn(dir, commit, file) {
      git(dir, file ? ['checkout', commit, '--', ...[file].flat()] : ['checkout', '--quiet', '--detach', '--force', commit]);
    },
    // The files a merge of `other` into `commit` leaves in conflict, tried in a throwaway checkout, after
    // `files` there are put back as `source` holds them, where given; none where it merges cleanly.
    mergeConflicts(commit, other, { source, files = [] } = {}) {
      return this.withCheckout(commit, (dir) => {
        const quiet = ['-c', 'user.name=blueprint-foreman', '-c', 'user.email=blueprint-foreman@localhost'];
        if (files.length) {
          git(dir, ['restore', `--source=${source}`, '--staged', '--worktree', '--', ...files]);
          git(dir, [...quiet, 'commit', '--quiet', '--allow-empty', '-m', 'put back']);
        }
        try {
          git(dir, [...quiet, 'merge', '--no-commit', '--no-ff', '--quiet', other]);
          return [];
        } catch {
          return paths(dir, ['diff', '--name-only', '--diff-filter=U']);
        }
      });
    },
    // Runs fn(dir) in a throwaway checkout of commit: a detached worktree, else a local clone. The
    // checkout goes by fs.rmSync, which removes a link without following it, before git forgets the
    // worktree: `git worktree remove` on a checkout still there follows, on Windows, a junction an
    // install made, and empties what it points to.
    withCheckout(commit, fn) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-foreman-scratch-'));
      let kind = 'worktree';
      try {
        git(root, ['worktree', 'add', '--detach', '--quiet', dir, commit]);
      } catch {
        kind = 'clone';
        fs.rmSync(dir, { recursive: true, force: true });
        git(os.tmpdir(), ['clone', '--quiet', '--local', '--no-checkout', root, dir]);
        git(dir, ['checkout', '--quiet', '--detach', commit]);
      }
      try {
        return fn(dir, kind);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        if (kind === 'worktree') {
          try {
            git(root, ['worktree', 'remove', '--force', dir]);
          } catch {
            git(root, ['worktree', 'prune']);
          }
        }
      }
    },
    // The commits reachable from `commit` with a message line matching the extended regular expression
    // in any case, each with its trailers as git reads them, `Key: value`, and its message's lines.
    messagesMatching(pattern, commit = 'HEAD') {
      const out = git(root, ['log', '--format=%H%x00%(trailers:only,unfold)%x00%B%x1e', '--extended-regexp', '--regexp-ignore-case', `--grep=${pattern}`, commit, '--']);
      return out.split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
        const [sha, trailers, body] = r.split('\0');
        return { sha, trailers: trailers.split('\n').filter(Boolean), lines: (body ?? '').split('\n') };
      });
    },
    // The last commit reachable from HEAD that touched a path, or '' when none did.
    lastTouching: (file) => git(root, ['log', '-1', '--format=%H', 'HEAD', '--', file]),
    // The last commit since `from` that touched anything outside `apart`, the run's own paths, or ''.
    lastChange: (from, apart) => git(root, ['log', '-1', '--format=%H', `${from}..HEAD`, '--', '.', ...[apart].flat().map((p) => `:(exclude)${p}`)]),
    // The tree a commit holds, by any name git resolves, or null where it resolves to none.
    treeOf(name) {
      try {
        return git(root, ['rev-parse', '--verify', '--quiet', `${name}^{tree}`]);
      } catch {
        return null;
      }
    },
    // The files a commit holds under a directory.
    filesAt: (commit, dir) => paths(root, ['ls-tree', '-r', '--name-only', commit, '--', dir]),
    // The URL of the origin remote as configured, before any rewriting git applies to reach it, or null
    // where there is none. It may carry a credential, so no caller prints it.
    originUrl() {
      try {
        return git(root, ['config', '--get', 'remote.origin.url']);
      } catch {
        return null;
      }
    },
    // The commits on the branch's own line since a commit, or all of them without one, the latest first,
    // each with its parents and its trailers as git reads them.
    lineSince: (from) =>
      git(root, ['log', '--first-parent', '--format=%H%x00%P%x00%(trailers:only,unfold)%x1e', from ? `${from}..HEAD` : 'HEAD', '--']).split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
        const [sha, parents, trailers] = r.split('\0');
        return { sha, parents: parents.split(' ').filter(Boolean), trailers: (trailers ?? '').split('\n').filter(Boolean) };
      }),
    // One file's text at each of many commits, in one call, null where a commit has none.
    filesAtEach(commits, file) {
      if (!commits.length) return [];
      const out = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: commits.map((c) => `${c}:${file}\n`).join(''), maxBuffer: BUFFER });
      const texts = [];
      let at = 0;
      for (let i = 0; i < commits.length; i += 1) {
        const end = out.indexOf(10, at);
        // `<oid> <type> <size>` and the object, or `<name> missing`.
        const [, type, size] = out.subarray(at, end).toString('utf8').split(' ');
        at = end + 1;
        if (size === undefined) {
          texts.push(null);
          continue;
        }
        texts.push(type === 'blob' ? out.subarray(at, at + Number(size)).toString('utf8') : null);
        at += Number(size) + 1;
      }
      return texts;
    },
    // Every path a commit touched, however it touched it.
    touchedBy: (sha) => paths(root, ['diff-tree', '--root', '--no-commit-id', '-r', '--name-only', '--no-renames', sha]),
    // The files a commit added or modified, outside the paths `apart`.
    commitFiles: (sha, apart = []) => paths(root, ['diff-tree', '--root', '--no-commit-id', '-r', '--name-only', '--no-renames', '--diff-filter=AM', sha, '--', '.', ...apart.map((p) => `:(exclude)${p}`)]),
    // The blob id git would store for a file in the checkout, and the one a commit holds.
    hashFile: (file) => git(root, ['hash-object', '--', file]),
    blobAt(commit, file) {
      try {
        return git(root, ['rev-parse', `${commit}:${file}`]);
      } catch {
        return null;
      }
    },
    // One file's change across a range, with no context lines.
    rangeFileDiff: (from, to, file) => execFileSync('git', ['diff', '--unified=0', ...AS_TEXT, '--no-renames', from, to, '--', file], { cwd: root, encoding: 'utf8', maxBuffer: BUFFER }),
    // One file's change in one commit, with no context lines.
    commitFileDiff: (sha, file) => execFileSync('git', ['show', '--format=', '--unified=0', ...AS_TEXT, '--no-renames', sha, '--', file], { cwd: root, encoding: 'utf8', maxBuffer: BUFFER }),
    // A blob's text by its id, or null where the id names no blob.
    blobText(id) {
      if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(id ?? '')) return null;
      try {
        return execFileSync('git', ['cat-file', 'blob', id], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: BUFFER });
      } catch {
        return null;
      }
    },
    // A file's text at a commit, or null where the commit has no such file; a directory is none.
    fileAt(commit, file) {
      try {
        return execFileSync('git', ['cat-file', 'blob', `${commit}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: BUFFER });
      } catch {
        return null;
      }
    },
  };
}
