// What a run fixes about the repository it delivers into, in one place. The input names come from
// Blueprint: where the design lives, how the scaffold commit is marked and its gaps written, and
// Blueprint's adapter file, which gives the extractor. The harness's own file gives the rest, whose
// shape is checked here: the install, the suites, what the extractor emits and its own paths, the
// lesson homes, and the settings a fire may override. The settings below them a run needs that
// neither file carries; tests override those.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRelativePath, quote, within } from './git.mjs';

// The engine runs from its own clone, beside the repository it delivers into, from whose root every
// command it prints runs: so it names itself by where it is, never by a path in that repository.
export const ENGINE_FILE = fileURLToPath(new URL('../engine.mjs', import.meta.url));
export const ENGINE = `node ${quote(ENGINE_FILE)}`;
// The plugin's own directory, the engine's.
export const PLUGIN_DIR = path.dirname(ENGINE_FILE);

// Where a session and every subagent it dispatches may work, `root` the item's repository clone: that
// clone and this plugin, and nowhere else. Every step and every brief states it.
export const containment = (root) => `Work stays inside two clones: the item's repository, ${root}, and this plugin, ${PLUGIN_DIR}. Read and search nothing outside them, and run every command from ${root}.`;

export const BLUEPRINT_CONFIG = '.blueprint.config.json';
// The harness's own settings, at the root of the repository it delivers into.
export const FOREMAN_CONFIG = '.blueprint-foreman.json';
// Where a lesson may land unless the harness's settings say otherwise: prose a reader weighs. Hooks
// and settings run, so they change only through a slice.
export const DEFAULT_LESSON_HOMES = ['CLAUDE.md', '.claude/rules'];

// The protected paths every repository has: both adapter files and the item's directory, which holds
// the design the fire names, so no step changes the design or what judges it; the repository adds the
// extractor's own paths under protect. The harness itself is in its own clone, which no step's commits
// reach.
const HARNESS = [BLUEPRINT_CONFIG, FOREMAN_CONFIG];
export const protectedPaths = (design, adapters) => [...HARNESS, path.posix.dirname(design), ...(adapters?.protect ?? [])];
// Whether `design` is where the fire may name the design of item `key`: <docsRoot>/<KEY>/blueprint.md.
export const isDesignPath = (design, key) => isRelativePath(design) && design.endsWith(`/${key}/blueprint.md`);
// Whether a path is protected: one of `protect` or under one, or a .gitattributes anywhere, since an
// attribute steers how git reads the files it names.
export const isProtected = (protect) => (file) => within(protect)(file) || file.split('/').at(-1) === '.gitattributes';

export const SCAFFOLD_TRAILER = 'Blueprint-Scaffold';
// The scaffold's report, beside the design, and the statuses it may give.
export const scaffoldReport = (design) => `${path.posix.dirname(design)}/scaffold.json`;
export const SCAFFOLD_STATUSES = ['done', 'blocked', 'skipped'];
// The harness's own trailers on every run-state commit, by which it reads its run back along the
// branch: the run's state, its cycle and the stop it rests on. Steward ignores them; it reads the signal,
// the trailer under the key the fire names, its value one of SIGNALS.
export const RUN_TRAILER = 'Foreman-Run';
export const CYCLE_TRAILER = 'Foreman-Cycle';
export const STOP_TRAILER = 'Foreman-Stop';
export const DEFAULT_SIGNAL = 'Blueprint-Status';
// The signal's value for each state of the run.
export const SIGNALS = { working: 'working', stopped: 'needs-human', settled: 'done', rejected: 'rejected', failed: 'failed' };
export const GAP_MARKER = 'TODO(scaffold)';
export const GRAPH_FILE = '.blueprint/graph.json';
// Set for every suite and exhibit command the engine runs: where the run's exhibits are written.
export const EXHIBITS_VARIABLE = 'BLUEPRINT_FOREMAN_EXHIBITS';

export const DEFAULTS = {
  testTimeoutMs: 20 * 60 * 1000,
  budget: 3,
};

const REPORTS = ['jest', 'junit'];
const text = (v) => typeof v === 'string' && v.trim() !== '';
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// One suite's problems, each naming the field. `all`, when declared, runs the whole suite, which the
// final gate holds to what it passed at the admitted commit.
function suiteProblems(name, s) {
  const at = `suites.${name}`;
  if (!record(s)) return [`${at} must be { command, report, all?, cwd?, env?, timeout? }`];
  const problems = [];
  if (!text(s.command) || !s.command.includes('{files}')) problems.push(`${at}.command must be a shell command holding {files}, where the engine puts the slice's test files`);
  if (s.all !== undefined && !(text(s.all) && !s.all.includes('{files}'))) problems.push(`${at}.all must be a shell command that runs the whole suite, without {files}`);
  if (!REPORTS.includes(s.report)) problems.push(`${at}.report must be "jest" or "junit"`);
  if (s.cwd !== undefined && !isRelativePath(s.cwd)) problems.push(`${at}.cwd must be a repository-relative path`);
  if (s.env !== undefined && !(record(s.env) && Object.values(s.env).every((v) => typeof v === 'string'))) problems.push(`${at}.env must map names to strings`);
  if (s.timeout !== undefined && !(typeof s.timeout === 'number' && Number.isFinite(s.timeout) && s.timeout > 0)) problems.push(`${at}.timeout must be a positive number of seconds`);
  const reported = record(s.env) && Object.values(s.env).some((v) => typeof v === 'string' && v.includes('{report}'));
  for (const [field, command] of [['command', s.command], ['all', s.all]]) {
    if (text(command) && !command.includes('{report}') && !reported) problems.push(`${at} must hold {report}, where the engine reads the report, in its ${field} or an env value`);
  }
  return problems;
}

// Where Blueprint keeps its items' docs, each item's in <docsRoot>/<KEY>/, unless its adapter file says
// otherwise.
export const DEFAULT_DOCS_ROOT = 'docs/prs';

// The docs root Blueprint's adapter file in the checkout at `root` names, or the default, for finding
// an item's run before its run state is read.
export function docsRootAt(root) {
  try {
    const docsRoot = JSON.parse(fs.readFileSync(path.join(root, BLUEPRINT_CONFIG), 'utf8'))?.docsRoot;
    return isRelativePath(docsRoot) ? docsRoot : DEFAULT_DOCS_ROOT;
  } catch {
    return DEFAULT_DOCS_ROOT;
  }
}

// The roles whose model the settings may name, and the Adversary's own fields.
export const MODEL_ROLES = ['broad', 'contained', 'reviewer', 'adversary-fallback'];
const ADVERSARY_FIELDS = ['model', 'zeroDataRetention'];

// The problems with the settings a fire may override, as `at` names where they are: `models`, a model
// per role, and `adversary`, its model and whether its requests may reach only zero-data-retention
// endpoints.
export function settingsProblems({ models, adversary } = {}, at = '') {
  const problems = [];
  if (models !== undefined && !(record(models) && Object.entries(models).every(([role, model]) => MODEL_ROLES.includes(role) && text(model)))) {
    problems.push(`${at}models must map roles (${MODEL_ROLES.join(', ')}) to model ids`);
  }
  if (adversary !== undefined) {
    const shaped = record(adversary) && Object.keys(adversary).every((k) => ADVERSARY_FIELDS.includes(k));
    if (!shaped || (adversary.model !== undefined && !text(adversary.model)) || (adversary.zeroDataRetention !== undefined && typeof adversary.zeroDataRetention !== 'boolean')) {
      problems.push(`${at}adversary must be { model?, zeroDataRetention? }: a model id, and true or false`);
    }
  }
  return problems;
}

// A file's text as a JSON object, or the problem: none committed, or not one.
function parsed(source, file, what) {
  if (source === null || source === undefined) return { problems: [`the branch has no committed ${file} declaring ${what}`] };
  try {
    const value = JSON.parse(source);
    return record(value) ? { value } : { problems: [`${file} is not a JSON object`] };
  } catch (e) {
    return { problems: [`${file} is not readable JSON (${e.message})`] };
  }
}

// The adapters as a commit holds them, `blueprint` the text of Blueprint's file and `foreman` the
// harness's, each null where there is none: the fields a run reads, in their shape, and the settings a
// fire may override, or the problems with them. Fields not named here are another tool's, and ignored.
export function checkAdapters(blueprint, foreman) {
  const b = parsed(blueprint, BLUEPRINT_CONFIG, 'the extractor');
  const h = parsed(foreman, FOREMAN_CONFIG, "the harness's settings");
  const problems = [...(b.problems ?? []), ...(h.problems ?? [])];
  const design = record(b.value?.designTooling) ? b.value.designTooling : {};
  const own = h.value ?? {};
  if (b.value && !text(design.extract)) problems.push(`${BLUEPRINT_CONFIG}: designTooling.extract must be the shell command that writes the graph`);
  if (b.value && b.value.docsRoot !== undefined && !isRelativePath(b.value.docsRoot)) problems.push(`${BLUEPRINT_CONFIG}: docsRoot must be a repository-relative path`);
  if (h.value) {
    const at = `${FOREMAN_CONFIG}: `;
    if (!Array.isArray(own.emits) || own.emits.length === 0 || !own.emits.every(text)) problems.push(`${at}emits must list the node types the extractor emits, at least one`);
    if (!Array.isArray(own.protect) || !own.protect.every(isRelativePath)) problems.push(`${at}protect must list the extractor's own paths, repository-relative (it may be empty)`);
    if (!text(own.install)) problems.push(`${at}install must be the shell command that installs every dependency the extractor and the suites need`);
    if (own.lessonHomes !== undefined && !(Array.isArray(own.lessonHomes) && own.lessonHomes.every(isRelativePath))) problems.push(`${at}lessonHomes must list repository-relative paths`);
    const suites = record(own.suites) ? Object.entries(own.suites) : [];
    if (suites.length === 0) problems.push(`${at}suites must declare at least one suite, keyed by name`);
    for (const [name, s] of suites) problems.push(...suiteProblems(name, s).map((p) => `${at}${p}`));
    problems.push(...settingsProblems(own, at));
  }
  if (problems.length) return { problems };
  const pick = (s) => Object.fromEntries(['command', 'all', 'report', 'cwd', 'env', 'timeout'].filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
  return {
    adapters: {
      docsRoot: b.value.docsRoot ?? DEFAULT_DOCS_ROOT,
      extract: design.extract,
      emits: own.emits,
      protect: own.protect,
      install: own.install,
      suites: Object.fromEntries(Object.entries(own.suites).map(([name, s]) => [name, pick(s)])),
      lessonHomes: own.lessonHomes ?? DEFAULT_LESSON_HOMES,
    },
    settings: { models: own.models ?? {}, adversary: own.adversary ?? {} },
    problems: [],
  };
}
