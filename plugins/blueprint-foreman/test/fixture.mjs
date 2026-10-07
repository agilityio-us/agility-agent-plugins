// The fixture every slice-loop test shares, and its scenario helper. Each fixture is a real git
// repository in a temporary directory, on the run's branch cut from the tip of Blueprint's branch for
// the item, which carries a committed design and, when asked, a scaffold commit, with two tiny test runners, one writing a Jest report and one JUnit, each a suite
// the adapters declare, and a tiny extractor that writes a graph, so red, green, the lock, scratch
// checkouts, the mutant, convergence and exhibits all run for real. Nothing reaches GitHub. Its name
// keeps it out of `node --test`'s *.test.mjs, so the test files that import it run in parallel.
//
// With BLUEPRINT_FOREMAN_EXHIBITS set to a directory, the engine output these tests promise to show is
// saved there verbatim.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PRACTICES } from '../lib/config.mjs';
import { criterionKeys } from '../lib/design.mjs';
import { createGit } from '../lib/git.mjs';
import { sliceOf } from '../lib/plan.mjs';
import { runStateCommit } from '../lib/run.mjs';
import { run } from '../lib/wake.mjs';

export const KEY = 'PROJ-1';
// Blueprint's branch for the item, B, the agent's, F, the design, and the fire, as Specification v1
// gives it, `over` changing its fields.
export const ITEM_BRANCH = `${KEY}-greet`;
export const BRANCH = `claude/${ITEM_BRANCH}`;
export const DESIGN_FILE = `docs/prs/${KEY}/blueprint.md`;
export const fire = (over = {}) =>
  JSON.stringify({ specification: 1, key: KEY, title: 'Greet a person by name', branch: ITEM_BRANCH, agentBranch: BRANCH, pullRequest: null, design: DESIGN_FILE, signal: 'Blueprint-Status', answer: null, options: {}, ...over });
export const PAYLOAD = fire();

// No test reaches the network: every test file imports this module, which makes the real fetch throw,
// and a fixture's context refuses too, so only a fetch a test provides itself answers.
export function noNetwork() {
  throw new Error('the tests reach no network; a test that needs an answer provides its own fetch');
}
globalThis.fetch = noNetwork;

// A temporary directory a test makes, removed with every other when its test file's process exits.
const made = new Set();
process.on('exit', () => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});
export function scratchDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.add(dir);
  return dir;
}

// Runs the exported tests of each test module it is given, passing over one that is not there, as Jest
// finds no test in it, and writes a report in Jest's JSON shape where its first argument says.
const RUNNER = `import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [report, ...files] = process.argv.slice(2);
const results = [];
for (const f of files.filter((f) => fs.existsSync(f))) {
  const name = path.resolve(f);
  try {
    const { tests } = await import(pathToFileURL(name).href);
    const assertionResults = [];
    for (const t of tests) {
      try { await t.fn(); assertionResults.push({ fullName: t.name, status: 'passed', failureMessages: [] }); }
      catch (e) { assertionResults.push({ fullName: t.name, status: 'failed', failureMessages: [String(e.stack ?? e)] }); }
    }
    results.push({ name, status: assertionResults.some((a) => a.status === 'failed') ? 'failed' : 'passed', assertionResults });
  } catch (e) {
    results.push({ name, status: 'failed', message: String(e), assertionResults: [] });
  }
}
fs.writeFileSync(report, JSON.stringify({ numRuntimeErrorTestSuites: 0, testResults: results }));
`;

// The same, writing JUnit XML where $JUNIT_REPORT says: a module is a <testsuite> and each of its tests
// a <testcase> classed by the module's file name, a failed assertion a <failure>, anything else thrown
// an <error>, and a module that fails to load a suite holding no testcase that counts an error.
const JUNIT_RUNNER = `import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const x = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const suites = [];
for (const f of process.argv.slice(2).filter((f) => fs.existsSync(f))) {
  const file = path.basename(f);
  try {
    const { tests } = await import(pathToFileURL(path.resolve(f)).href);
    const cases = [];
    for (const t of tests) {
      const named = 'classname="' + x(file) + '" name="' + x(t.name) + '"';
      try { await t.fn(); cases.push('<testcase ' + named + '/>'); }
      catch (e) {
        const kind = e instanceof assert.AssertionError ? 'failure' : 'error';
        cases.push('<testcase ' + named + '><' + kind + ' message="' + x(e.message) + '">' + x(e.stack) + '</' + kind + '></testcase>');
      }
    }
    suites.push('<testsuite name="' + x(file) + '" tests="' + cases.length + '">' + cases.join('') + '</testsuite>');
  } catch (e) {
    suites.push('<testsuite name="' + x(file) + '" tests="0" errors="1"><system-err>' + x(e) + '</system-err></testsuite>');
  }
}
fs.writeFileSync(process.env.JUNIT_REPORT, '<?xml version="1.0" encoding="UTF-8"?>\\n<testsuites>' + suites.join('') + '</testsuites>\\n');
`;

// An install the harness's settings may name, which a merge may change: it counts its runs in the ignored
// .blueprint/installs, and fails while .blueprint/fail is there, as an install does without its
// registry.
const INSTALL = `import fs from 'node:fs';
fs.mkdirSync('.blueprint', { recursive: true });
fs.appendFileSync('.blueprint/installs', 'x');
if (fs.existsSync('.blueprint/fail')) process.exit(5);
`;

// The extractor: one node per exported function under src/.
export const EXTRACTOR = `import fs from 'node:fs';
const nodes = [];
for (const f of fs.existsSync('src') ? fs.readdirSync('src') : []) {
  for (const m of fs.readFileSync('src/' + f, 'utf8').matchAll(/export function (\\w+)/g)) nodes.push({ id: 'greet_fn_' + m[1], type: 'function', label: m[1] });
}
fs.mkdirSync('.blueprint', { recursive: true });
fs.writeFileSync('.blueprint/graph.json', JSON.stringify({ nodes, edges: [] }));
`;

// The test also writes its exhibit, the greeting itself, when the engine names where.
export const TEST_FILE = `import assert from 'node:assert/strict';
import fs from 'node:fs';
import { greet } from '../src/greet.mjs';
export const tests = [{ name: 'greet names the person', fn: () => {
  const said = greet('Ada');
  if (process.env.BLUEPRINT_FOREMAN_EXHIBITS) fs.writeFileSync(process.env.BLUEPRINT_FOREMAN_EXHIBITS + '/greeting.txt', "greet('Ada') returns: " + said + '\\n');
  assert.equal(said, 'Hello, Ada');
} }];
`;

// The em dash Blueprint's renderer writes between a scenario's id and its title, and in its heading.
export const DASH = '\u2014';

// A design in Specification v1's shape: its front matter's key, its scenarios, each a criterion, and its
// artifacts, the event model; the rest is prose for people.
export const DESIGN = `---
key: ${KEY}
---
# ${KEY}: Greet a person by name

## Notes

- **One function**: Only src/greet.mjs changes.

## Scenarios

- greets-by-name ${DASH} greets by name (agreed)
  - Given the name Ada
  - When greet runs
  - Then it returns "Hello, Ada"

## Artifacts

- function greet in greet (\`greet_fn_greet\`), serves d1 "greet returns a greeting"
`;
// An artifact line proposing a node of the fixture's subdomain, as the design writes it.
export const proposes = (type, label, id) => `- ${type} ${label} in greet (\`${id}\`)\n`;
// The fixture design's one artifact line, after which a test adds its own.
export const GREET_ROW = '- function greet in greet (`greet_fn_greet`), serves d1 "greet returns a greeting"\n';

const EXHIBIT = { shows: "the greeting greet returns for Ada", form: 'output' };

export const SLICE = {
  id: 'greet-by-name',
  outcome: 'greet returns "Hello, <name>"',
  criteria: ['greets-by-name'],
  dependsOn: [],
  complexity: 'contained',
  test: { suite: 'node', files: ['test/greet.test.mjs'], expectFail: ['greet names the person'] },
  frozen: ['test/greet.test.mjs', 'run-tests.mjs'],
  stubs: ['src/greet.mjs'],
  mutant: { breaks: 'the greeting names the person' },
  exhibit: EXHIBIT,
  substitute: null,
};

// What else Blueprint commits beside blueprint.md, which the engine never reads: its bundle.
const ITEM = `docs/prs/${KEY}`;
const BUNDLE = { [`${ITEM}/blueprint/bundle.json`]: '{}\n' };

// The scaffold's report, beside the design: its status.
export const SCAFFOLD_REPORT = `docs/prs/${KEY}/scaffold.json`;
export const scaffoldReport = (status) => `${JSON.stringify({ status })}\n`;

// The scaffold Blueprint commits: its structure is locked, and its one gap is the greeting.
export const SCAFFOLD = "// greet, as the scaffold placed it.\nexport function greet(name) {\n  return ''; // TODO(scaffold): the greeting\n}\n";
export const FILLED = "// greet, as the scaffold placed it.\nexport function greet(name) {\n  return `Hello, ${name}`;\n}\n";
export const SCAFFOLDED = { ...SLICE, stubs: [] };

// A second slice with its own test and code, beside greet.
export const FAREWELL_TEST = `import assert from 'node:assert/strict';
import { farewell } from '../src/farewell.mjs';
export const tests = [{ name: 'farewell names the person', fn: () => assert.equal(farewell('Ada'), 'Bye, Ada') }];
`;
export const FAREWELL = {
  ...SLICE,
  id: 'say-farewell',
  dependsOn: ['greet-by-name'],
  test: { suite: 'node', files: ['test/farewell.test.mjs'], expectFail: ['farewell names the person'] },
  frozen: ['test/farewell.test.mjs'],
  stubs: ['src/farewell.mjs'],
  mutant: { breaks: 'the farewell names the person' },
  exhibit: { none: "the farewell is the test's own text" },
};
export const FAREWELL_STUB = "export function farewell(name) {\n  return '';\n}\n";
export const FAREWELL_CODE = "export function farewell(name) {\n  return `Bye, ${name}`;\n}\n";

// What a fresh Mutant dispatch names after green, for each fixture slice.
export const MUTANTS = {
  'greet-by-name': { file: 'src/greet.mjs', find: 'Hello, ', replace: 'Hi, ' },
  'say-farewell': { file: 'src/farewell.mjs', find: 'Bye, ', replace: 'Hi, ' },
};

export const RED_STUB = "export function greet(name) {\n  return '';\n}\n";
export const GREEN_CODE = "export function greet(name) {\n  return `Hello, ${name}`;\n}\n";

// What Red and Green write for a fixture slice, and the mutant named after green: farewell's for a
// slice that runs its test, else greet's, filling the scaffold's gap when the slice stubs nothing. A
// Builder writes both.
function work(slice) {
  if (slice.test.files.includes('test/farewell.test.mjs')) {
    return { red: { 'test/farewell.test.mjs': FAREWELL_TEST, 'src/farewell.mjs': FAREWELL_STUB }, green: { 'src/farewell.mjs': FAREWELL_CODE }, mutant: MUTANTS['say-farewell'] };
  }
  const stubbed = (slice.stubs ?? []).includes('src/greet.mjs');
  return {
    red: { 'test/greet.test.mjs': TEST_FILE, ...(stubbed ? { 'src/greet.mjs': RED_STUB } : {}) },
    green: { 'src/greet.mjs': stubbed ? GREEN_CODE : FILLED },
    mutant: MUTANTS['greet-by-name'],
  };
}

function sh(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// The suites a fixture declares: its Jest runner from the root, the report named in the command, and
// its JUnit runner from test/, the report named in the environment.
export const SUITES = {
  node: { command: 'node run-tests.mjs {report} {files}', report: 'jest' },
  junit: { command: 'node ../run-junit.mjs {files}', cwd: 'test', env: { JUNIT_REPORT: '{report}' }, report: 'junit', timeout: 120 },
};

// Blueprint's adapter file a fixture declares, and the harness's own.
export const adapters = ({ extract = 'node extract.mjs' } = {}) => JSON.stringify({ designTooling: { extract } });
export const settings = ({ protect = [], install = 'exit 0', suites = SUITES, ...more } = {}) => JSON.stringify({ install, suites, emits: ['function'], protect, ...more });

// An item's branch as Blueprint leaves it, the design committed, then the scaffold, empty unless asked
// for, and the run's branch cut from its tip, which origin/<item branch> marks. Until a run is admitted
// a commit on the run's branch is Blueprint's, so that tip follows it. Every fire's payload names the
// item branch; the routine's environment turns on every practice but those `practices` turns off;
// `wake(payload)` wakes with another fire.
// The routine's environment that turns on every practice but those `off` names false.
export const environment = (off = {}) => ({ BLUEPRINT_FOREMAN_PRACTICES: PRACTICES.filter((p) => off[p] !== false).join(',') });

export function fixture({ scaffold = false, design = DESIGN, extractor = EXTRACTOR, protect, install, suites, foreman = {}, practices } = {}) {
  const root = scratchDir('blueprint-foreman-slice-');
  const runJson = path.join(root, 'docs', 'prs', KEY, 'foreman', 'run.json');
  const tip = () => sh(root, 'update-ref', `refs/remotes/origin/${ITEM_BRANCH}`, 'HEAD');
  sh(root, 'init', '--quiet', '-b', 'master');
  sh(root, 'config', 'user.email', 'fixture@example.com');
  sh(root, 'config', 'user.name', 'Fixture');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const commit = (msg, files, ...more) => {
    sh(root, 'add', ...files);
    sh(root, 'commit', '--quiet', '-m', msg, ...more.flatMap((m) => ['-m', m]));
    if (!fs.existsSync(runJson) && sh(root, 'rev-parse', '--abbrev-ref', 'HEAD') === BRANCH) tip();
  };
  write('run-tests.mjs', RUNNER);
  write('run-junit.mjs', JUNIT_RUNNER);
  write('extract.mjs', extractor);
  write('install.mjs', INSTALL);
  write('.blueprint.config.json', adapters());
  write('.blueprint-foreman.json', settings({ protect, install, suites, ...foreman }));
  write('.gitignore', '.blueprint/\n');
  write('test/.keep', '');
  write('README.md', '# fixture\n');
  write('CLAUDE.md', '# conventions\n');
  write('.claude/rules/testing.md', '# testing\n');
  commit('init', ['.']);
  // Where the pull request lives; nothing here reaches it.
  sh(root, 'remote', 'add', 'origin', 'https://github.com/example/app.git');
  // Another item's scaffold, which this run must not mistake for its own.
  sh(root, 'commit', '--quiet', '--allow-empty', '-m', 'chore: another item', '-m', `Blueprint-Scaffold: ${KEY}0`);
  sh(root, 'switch', '--quiet', '-c', BRANCH);
  // Blueprint's design commit: blueprint.md and its bundle.
  const bundle = { ...BUNDLE, [DESIGN_FILE]: design };
  for (const [file, text] of Object.entries(bundle)) write(file, text);
  commit(`docs(${KEY}): the agreed design`, Object.keys(bundle));
  // The scaffold commit, with its report beside the design: the greeting's gap, or nothing to scaffold.
  write(SCAFFOLD_REPORT, scaffoldReport(scaffold ? 'done' : 'skipped'));
  if (scaffold) write('src/greet.mjs', SCAFFOLD);
  commit(`chore(${KEY}): scaffold the agreed design`, [SCAFFOLD_REPORT, ...(scaffold ? ['src/greet.mjs'] : [])], `Blueprint-Scaffold: ${KEY}`);
  tip();
  const git = createGit(root);
  const ctx = { root, git, now: () => '2026-09-26T00:00:00.000Z', config: { testTimeoutMs: 60_000 }, env: environment(practices), fetch: noNetwork, input: PAYLOAD };
  const engine = (...argv) => run(argv, ctx);
  const wake = (payload) => run(['wake'], { ...ctx, input: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  const runState = () => JSON.parse(fs.readFileSync(runJson, 'utf8'));
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  return { root, ctx, engine, wake, write, commit, runState, hasRun: () => fs.existsSync(runJson), read, sh: (...a) => sh(root, ...a) };
}

// A step's text followed by each brief its dispatches name, as the subagents read them.
export const briefed = (f, text) => [text, ...[...text.matchAll(/whose whole prompt is "Follow the brief in ([^"]+)\."/g)].map(([, brief]) => f.read(brief))].join('\n');

export async function ok(f, ...argv) {
  const out = await f.engine(...argv);
  assert.equal(out.code, 0, out.text);
  return out.text;
}

// A refusal whose text matches `pattern`; returns the text.
export function refused(out, pattern) {
  assert.equal(out.code, 1, out.text);
  assert.match(out.text, pattern);
  return out.text;
}

// A slice as a plan declares it under the practices `on`: none of the fields only a practice that is off
// reads.
export function fitted(slice, on) {
  const { stubs, substitute, mutant, exhibit, ...rest } = slice;
  const { expectFail, ...test } = slice.test;
  return {
    ...rest,
    test: on['red-green'] ? slice.test : test,
    ...(on['red-green'] ? { stubs, substitute } : {}),
    ...(on.mutant && mutant ? { mutant } : {}),
    ...(on.exhibits ? { exhibit } : {}),
  };
}

// Each step as a session that does what it is told does it, for `walk`: `run` is the run state, `o`
// the walk's overrides. The plan's slices are fitted to the run's practices, and a gate's reviewers are
// those the practices hold.
export const ACTS = {
  wake: (f) => f.engine('wake'),
  plan(f, run, o) {
    f.write(`docs/prs/${KEY}/foreman/plan.json`, JSON.stringify({ slices: (o.slices ?? [SLICE]).map((s) => fitted(s, run.practices)) }));
    return f.engine('record', KEY, 'plan');
  },
  gate(f, run) {
    const dir = `docs/prs/${KEY}/foreman/gates/${run.gate.name}-c${run.gate.cycle}-r${run.gate.round}`;
    if (run.practices.adversary) f.write(`${dir}/findings.json`, '[]');
    if (run.gate.name !== 'final' || !run.practices.review) return f.engine('record', KEY, 'gate');
    f.write(`${dir}/contract.json`, JSON.stringify(allMet(f, run)));
    return f.engine('record', KEY, 'gate', 'agent-reviewer');
  },
  red(f, run, o) {
    const slice = sliceOf(run);
    const files = { ...work(slice).red, ...o.red };
    for (const [file, text] of Object.entries(files)) f.write(file, text);
    f.commit(`test(${KEY}): red for ${slice.id}`, Object.keys(files));
    return f.engine('record', KEY, 'red', 'agent-red');
  },
  green(f, run, o) {
    const slice = sliceOf(run);
    const files = { ...work(slice).green, ...o.green };
    for (const [file, text] of Object.entries(files)) f.write(file, text);
    f.commit(`feat(${KEY}): ${slice.id}`, Object.keys(files));
    return f.engine('record', KEY, 'green', 'agent-green');
  },
  // The Builder writes what Red and Green would, the tests and the code together, and no stub.
  builder(f, run, o) {
    const slice = sliceOf(run);
    const { red, green } = work(slice);
    const files = { ...red, ...green, ...o.build };
    for (const [file, text] of Object.entries(files)) f.write(file, text);
    f.commit(`feat(${KEY}): ${slice.id}`, Object.keys(files));
    return f.engine('record', KEY, 'builder', 'agent-builder');
  },
  mutant(f, run, o) {
    f.write(`docs/prs/${KEY}/foreman/review/${run.slice.id}-${run.slice.attempt}/mutant.json`, JSON.stringify(o.mutant ?? work(sliceOf(run)).mutant));
    // Every Mutant is a fresh dispatch, with an id of its own.
    return f.engine('record', KEY, 'mutant', `agent-mutant-${run.history.length}`);
  },
  'group-review'(f, run) {
    const at = `docs/prs/${KEY}/foreman/review/${run.slice.id}-${run.slice.attempt}`;
    for (const g of JSON.parse(f.read(`${at}/groups.json`))) f.write(`${at}/group-${g.id}.findings.json`, '[]');
    return f.engine('record', KEY, 'groups');
  },
  'contract-review'(f, run, o) {
    f.write(`docs/prs/${KEY}/foreman/review/${run.slice.id}-${run.slice.attempt}/contract.json`, JSON.stringify(o.contract ?? { verdict: 'pass', reasons: [], findings: [] }));
    return f.engine('record', KEY, 'contract', 'agent-reviewer');
  },
  'slice-dispositions'(f, run) {
    const at = `docs/prs/${KEY}/foreman/review/${run.slice.id}-${run.slice.attempt}`;
    f.write(`${at}/dispositions.json`, JSON.stringify(JSON.parse(f.read(`${at}/findings.json`)).map((_, i) => ({ finding: i + 1, disposition: 'handed-off' }))));
    return f.engine('record', KEY, 'dispositions');
  },
};

// Walks a fixture's run on to the next step named `to` ('final' for the final gate), every record
// accepted. `o` overrides what the steps use: the plan's `slices`, the files Red, Green and the Builder
// write (`red`, `green`, `build`, over each slice's own), the `mutant` and the `contract` verdict; with
// `commit`, the
// run state is committed after every record, as a session does. Returns the last record's output. A
// walk that goes round without arriving fails rather than hangs.
export async function walk(f, to, o = {}) {
  for (let records = 0; records < 40; records += 1) {
    const run = f.hasRun() ? f.runState() : null;
    const act = ACTS[run?.step ?? 'wake'];
    assert.ok(act, `the walk has no act for step ${run?.step}`);
    const out = await act(f, run, o);
    assert.equal(out.code, 0, out.text);
    if (o.commit) commitRun(f);
    const now = f.runState();
    if (to === 'final' ? now.step === 'gate' && now.gate.name === 'final' : now.step === to) return out.text;
  }
  return assert.fail(`the walk never reached ${to}; the run is at ${f.runState().step}`);
}

// Runs a command the engine prints for the session, in the session's shell.
export function shell(f, command) {
  execFileSync('sh', ['-c', command], { cwd: f.root, stdio: 'ignore' });
}

// Runs the restore command a refusal prints, as the session does.
export function restore(f, text) {
  const command = /keeping the run state: (git restore .+)$/m.exec(text)?.[1];
  assert.ok(command, text);
  shell(f, command);
}

// Makes the run-state commit the engine prints, and returns the commit.
export function commitRun(f) {
  shell(f, runStateCommit(f.runState()));
  return f.sh('rev-parse', 'HEAD');
}


// B moves on without a new design, as when the default branch is merged into it: `files` committed on
// its tip, which F has not merged. Returns the commit.
export function moveB(f, files) {
  f.sh('switch', '--quiet', '--detach', `refs/remotes/origin/${ITEM_BRANCH}`);
  for (const [file, text] of Object.entries(files)) f.write(file, text);
  f.sh('add', ...Object.keys(files));
  f.sh('commit', '--quiet', '-m', 'chore: B moves on');
  const moved = f.sh('rev-parse', 'HEAD');
  f.sh('update-ref', `refs/remotes/origin/${ITEM_BRANCH}`, moved);
  f.sh('switch', '--quiet', BRANCH);
  return moved;
}

// Blueprint redesigns the item: B takes `design` and its scaffold, `files` and the report, on top of
// its tip, which F has not merged. Returns the scaffold commit.
export function redesign(f, { design = DESIGN, files = {}, status = 'done' } = {}) {
  f.sh('switch', '--quiet', '--detach', `refs/remotes/origin/${ITEM_BRANCH}`);
  f.write(DESIGN_FILE, design);
  f.sh('add', DESIGN_FILE);
  f.sh('commit', '--quiet', '--allow-empty', '-m', `docs(${KEY}): the design, again`);
  for (const [file, text] of Object.entries(files)) f.write(file, text);
  f.write(SCAFFOLD_REPORT, scaffoldReport(status));
  f.sh('add', SCAFFOLD_REPORT, ...Object.keys(files));
  f.sh('commit', '--quiet', '--allow-empty', '-m', `chore(${KEY}): scaffold the agreed design`, '-m', `Blueprint-Scaffold: ${KEY}`);
  const scaffold = f.sh('rev-parse', 'HEAD');
  f.sh('update-ref', `refs/remotes/origin/${ITEM_BRANCH}`, scaffold);
  f.sh('switch', '--quiet', BRANCH);
  return scaffold;
}

// The next fire carries `text`, a person's answer to the run's last stop.
export function answer(f, text) {
  f.ctx.input = fire({ answer: text });
}

// Merges the default branch once it has taken `master` in a commit of its own; `resolve` is what the
// merge commit itself changes, as the runner resolving its conflicts. Returns the merge.
export function mergeDefault(f, master = { VERSION: '2\n' }, resolve = {}) {
  f.sh('switch', '--quiet', 'master');
  for (const [file, text] of Object.entries(master)) f.write(file, text);
  f.commit('someone else ships', Object.keys(master));
  f.sh('switch', '--quiet', BRANCH);
  f.sh('merge', '--quiet', '--no-ff', '--no-commit', 'master');
  for (const [file, text] of Object.entries(resolve)) f.write(file, text);
  if (Object.keys(resolve).length) f.sh('add', ...Object.keys(resolve));
  f.sh('commit', '--quiet', '--no-edit');
  return f.sh('rev-parse', 'HEAD');
}

// Walks a run through its first cycle to settled, its run state committed.
export async function settled(f, o = {}) {
  await walk(f, 'settle', o);
  commitRun(f);
  f.write(`docs/prs/${KEY}/foreman/pr-notes.md`, notesFor(f.runState().practices));
  await ok(f, 'record', KEY, 'notes');
  commitRun(f);
}

// The first slice's review directory.
export const REVIEW = `docs/prs/${KEY}/foreman/review/greet-by-name-1`;

export function exhibit(name, text) {
  const dir = process.env.BLUEPRINT_FOREMAN_EXHIBITS;
  if (dir) fs.writeFileSync(path.join(dir, `${name}.txt`), `${text}\n`);
}

export const GREETING = `docs/prs/${KEY}/foreman/exhibits/greet-by-name/greeting.txt`;

// The session's part of the pull request's description.
export const NOTES = `## Decisions

None beyond the plan.

## Deferrals

None.

## Lessons

No lessons from this run.
`;

// The session's part under the practices `on`: with lessons off, no Lessons section.
export const notesFor = (on) => (on.lessons ? NOTES : `${NOTES.slice(0, NOTES.indexOf('## Lessons')).trimEnd()}\n`);

// A final contract review that finds met every criterion of the design and every row it is given.
export function allMet(f, run) {
  const names = [...criterionKeys(f.sh('show', `${run.startCommit}:${DESIGN_FILE}`)), ...run.convergence.handed.map((h) => h.row)];
  return { verdicts: Object.fromEntries(names.map((n) => [n, { met: true, evidence: `the tests pin ${n}` }])), findings: [] };
}
