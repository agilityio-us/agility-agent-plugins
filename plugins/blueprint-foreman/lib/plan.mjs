// The run's plan: a graph of vertical slices, written by the session as plan.json in the run directory
// at the plan step and checked here before any slice starts. Each slice carries everything the engine needs to
// judge it without asking the author: the suite and the test files it runs, the tests that must fail
// first, the files frozen at red, the product files Red may stub, what the mutant must break, and the
// exhibit its proof run must produce. A practice the run has off reads none of its fields, so the plan
// declares none of them, and with slices off the plan holds one slice. Once a step approves it, the plan
// lives in the run's record, so a later edit to plan.json changes nothing until the plan step, a gate's
// dispositions or a replan approve it again. The plan is the session's own: where a slice does not pan
// out, the session replans what has not landed, within a budget of replans per cycle.

import { ALL_PRACTICES, ENGINE, EXHIBITS_VARIABLE, GAP_MARKER, isProtected } from './config.mjs';
import { criterionKeys, designAt } from './design.mjs';
import { isRelativePath, within } from './git.mjs';
import { readRunJson, runDirectory, same } from './run.mjs';

// The plan's form as the plan step shows it, with none of the fields only a practice the run has off
// reads.
export function planTemplate(on = ALL_PRACTICES) {
  const test = [
    '"suite": "<the name of a suite the adapters declare in .blueprint-foreman.json>"',
    `"files": ["<this slice's test files, repository-relative, under the suite's cwd and in the frozen set>"]`,
    ...(on['red-green'] ? [`"expectFail": ["<full names of the tests that must fail at red, exactly as the suite's report names them>"]`] : []),
  ];
  const fields = [
    '"id": "<slug>"',
    '"outcome": "<the observable behaviour this slice delivers, through every layer it needs>"',
    `"criteria": ["<${on.slices ? 'design criterion keys this slice realizes' : 'every design criterion key'}>"]`,
    on.slices ? '"dependsOn": ["<ids of slices that must land first>"]' : '"dependsOn": []',
    '"complexity": "contained | broad"',
    `"test": {\n${test.map((f) => `        ${f}`).join(',\n')}\n      }`,
    `"frozen": ["<test files, fixtures and runner configuration ${on['red-green'] ? 'frozen at red' : 'locked once the slice lands'}>"]`,
    ...(on['red-green'] ? ['"stubs": ["<product files outside the scaffold that Red may create with signatures only, so the tests fail on an assertion>"]'] : []),
    ...(on.mutant ? ['"mutant": { "breaks": "<the behaviour a small defect should break, which the tests must catch>" }'] : []),
    ...(on.exhibits
      ? ['"exhibit": { "shows": "<what a person who was not in the session sees in it>", "form": "recording | screenshot | output", "command": "<optional: a shell command that writes it>" } | { "none": "<why it shows nothing the diff does not>" }']
      : []),
    ...(on['red-green'] ? ['"substitute": null'] : []),
  ];
  return `{\n  "slices": [\n    {\n${fields.map((f) => `      ${f}`).join(',\n')}\n    }\n  ]\n}`;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Strongest first: the behaviour itself, then a still of it, then the system's own output.
export const EXHIBIT_FORMS = ['recording', 'screenshot', 'output'];

const text = (v) => typeof v === 'string' && v.trim() !== '';
// An edit to one file: the substitute's broken state, or the mutant.
export const isEdit = (e) => e && isRelativePath(e.file) && typeof e.find === 'string' && e.find !== '' && typeof e.replace === 'string' && e.find !== e.replace;
const isExhibit = (e) => (e && text(e.none)) || (e && text(e.shows) && EXHIBIT_FORMS.includes(e.form) && (e.command === undefined || text(e.command)));

// The fields of a slice only one practice reads, each by its name and where a slice holds it: with that
// practice off, a plan declares none of them, so it never declares what nothing holds.
const PRACTICE_FIELDS = {
  'red-green': [['test.expectFail', (s) => s.test?.expectFail], ['stubs', (s) => s.stubs], ['substitute', (s) => s.substitute]],
  mutant: [['mutant', (s) => s.mutant]],
  exhibits: [['exhibit', (s) => s.exhibit]],
};
// Whether a field declares something: anything but null or an empty list.
const declares = (v) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);

// A slice's test: a suite the adapters declare, and its test files, each under the suite's cwd and in
// the slice's frozen set. The engine composes the command; the plan never writes one.
function testProblems(s, label, suites) {
  const name = s.test?.suite;
  if (typeof name !== 'string' || !Object.hasOwn(suites, name)) return [`${label} needs "test": { "suite" }, naming a suite the adapters declare: ${Object.keys(suites).join(', ')}`];
  const problems = s.test.command === undefined ? [] : [`${label} names a suite and its test files, and never writes a test command`];
  const { files } = s.test;
  if (!Array.isArray(files) || files.length === 0 || !files.every(isRelativePath)) return [...problems, `${label} needs "test": { "files" }, a non-empty list of repository-relative test files`];
  const { cwd } = suites[name];
  const frozen = within(Array.isArray(s.frozen) ? s.frozen : []);
  for (const f of files) {
    if (cwd && !within([cwd])(f)) problems.push(`${label} runs ${f} in suite "${name}", but it is not under the suite's cwd, ${cwd}`);
    if (!frozen(f)) problems.push(`${label} runs ${f}, which is not in its frozen set`);
  }
  return problems;
}

// Returns the problems found; an empty list means the plan can be worked slice by slice. `suites` are
// the suites the adapters declare, `protect` the protected paths, and `on` the run's practices.
export function checkPlan(plan, criterionKeys, suites, protect = [], on = ALL_PRACTICES) {
  const problems = [];
  const slices = Array.isArray(plan?.slices) ? plan.slices : null;
  if (!slices || slices.length === 0) return ['plan.json needs a non-empty "slices" list'];
  // What a substitute's broken state may not edit, as a mutant may not: a test, or what judges one.
  const frozen = within(slices.flatMap((s) => (Array.isArray(s?.frozen) ? s.frozen.filter(isRelativePath) : [])));
  const judged = (file) => frozen(file) || isProtected(protect)(file);

  const ids = new Set();
  for (const s of slices) {
    const label = `slice "${s?.id ?? '?'}"`;
    if (!SLUG.test(s?.id ?? '')) problems.push(`${label} needs a lowercase slug id`);
    if (ids.has(s.id)) problems.push(`${label} appears twice`);
    ids.add(s.id);
    if (!text(s.outcome)) problems.push(`${label} needs an outcome`);
    if (!Array.isArray(s.criteria) || s.criteria.length === 0) problems.push(`${label} must realize at least one criterion`);
    for (const c of s.criteria ?? []) if (!criterionKeys.includes(c)) problems.push(`${label} names "${c}", which is not a design criterion`);
    if (!Array.isArray(s.dependsOn)) problems.push(`${label} needs "dependsOn" as a list`);
    if (!['contained', 'broad'].includes(s.complexity)) problems.push(`${label} needs complexity "contained" or "broad"`);
    problems.push(...testProblems(s, label, suites));
    if (!Array.isArray(s.frozen) || s.frozen.length === 0 || !s.frozen.every(isRelativePath)) {
      problems.push(`${label} needs a non-empty frozen set of repository-relative paths`);
    }
    if (on['red-green']) {
      if (!Array.isArray(s.stubs ?? []) || !(s.stubs ?? []).every(isRelativePath)) {
        problems.push(`${label} needs "stubs" as a list of repository-relative paths`);
      }
      for (const p of s.stubs ?? []) if ((s.frozen ?? []).includes(p)) problems.push(`${label} cannot both freeze and stub ${p}`);
    }
    if (on.exhibits && !isExhibit(s.exhibit)) {
      problems.push(`${label} needs "exhibit": { "shows", "form": "${EXHIBIT_FORMS.join('" | "')}" }, or { "none": "<why it shows nothing the diff does not>" }`);
    }

    if (on['red-green'] && s.substitute) {
      if (!isEdit(s.substitute.broken)) problems.push(`${label} substitute needs "broken": { file, find, replace }, the broken state its tests must fail on`);
      else if (judged(s.substitute.broken.file)) problems.push(`${label} substitute's broken state edits ${s.substitute.broken.file}, which is in a frozen set or protected; it breaks the product code its tests pin`);
      if (!text(s.substitute.reason)) problems.push(`${label} substitute needs the reason no red exists`);
      // Its tests pin code that exists, and its green may commit nothing, so a stub would let one dispatch
      // write both the tests and the code, with no mutant after.
      if ((s.stubs ?? []).length) problems.push(`${label} substitute declares no stubs: its tests pin code that already exists`);
      // A substitute is judged by its broken state alone, so a kind or anything else it declares is refused.
      const more = Object.keys(s.substitute).filter((k) => !['broken', 'reason'].includes(k));
      if (more.length) problems.push(`${label} substitute declares only "broken" and "reason", not ${more.map((k) => `"${k}"`).join(', ')}`);
    } else {
      if (on['red-green'] && (!Array.isArray(s.test?.expectFail) || s.test.expectFail.length === 0)) problems.push(`${label} must name the tests that fail at red`);
      if (on.mutant && !text(s.mutant?.breaks)) problems.push(`${label} needs "mutant": { "breaks": "<the behaviour its tests must catch breaking>" }`);
    }
    for (const [practice, fields] of Object.entries(PRACTICE_FIELDS)) {
      if (on[practice]) continue;
      for (const [name, at] of fields) if (declares(at(s))) problems.push(`${label} declares "${name}", which only the ${practice} practice reads, and the run has it off`);
    }
  }

  for (const s of slices) {
    for (const d of s.dependsOn ?? []) if (!ids.has(d)) problems.push(`slice "${s.id}" depends on unknown slice "${d}"`);
  }
  if (problems.length === 0 && hasCycle(slices)) problems.push('the slice graph has a cycle');

  const covered = new Set(slices.flatMap((s) => s.criteria ?? []));
  for (const k of criterionKeys) if (!covered.has(k)) problems.push(`no slice realizes criterion "${k}"`);
  if (on.exhibits && !slices.some((s) => text(s.exhibit?.shows))) problems.push('no slice promises an exhibit, and the pull request must show the work');
  return problems;
}

function hasCycle(slices) {
  const deps = new Map(slices.map((s) => [s.id, s.dependsOn]));
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 'open') return true;
    if (state.get(id) === 'done') return false;
    state.set(id, 'open');
    const cyclic = deps.get(id).some(visit);
    state.set(id, 'done');
    return cyclic;
  };
  return slices.some((s) => visit(s.id));
}

// The next slice to work: the first, in plan order, whose dependencies have all landed.
export function nextSlice(plan, landed) {
  return plan.slices.find((s) => !landed.includes(s.id) && s.dependsOn.every((d) => landed.includes(d))) ?? null;
}

export function readPlan(root, run) {
  return readRunJson(root, run, 'plan.json');
}

// Problems with approving `plan` as the run's plan: its own, any change to a slice that landed, and with
// the slices practice off any slicing: the plan adds one slice to those that landed, which in a first
// plan therefore realizes every criterion, and no slice depends on another.
export function checkApproval(plan, run, criterionKeys) {
  const problems = checkPlan(plan, criterionKeys, run.adapters.suites, run.protect, run.practices);
  const landed = run.landed ?? [];
  for (const id of landed) {
    const before = run.plan?.slices.find((s) => s.id === id);
    const after = plan?.slices?.find?.((s) => s.id === id);
    if (before && !same(before, after)) problems.push(`slice "${id}" has landed, so the plan may not change or drop it`);
  }
  if (!run.practices.slices && Array.isArray(plan?.slices)) {
    const added = plan.slices.filter((s) => !landed.includes(s?.id));
    if (added.length > 1) problems.push(`the slices practice is off, so the plan adds one slice to those that landed, not ${added.length}: ${added.map((s) => `"${s?.id}"`).join(', ')}`);
    for (const s of plan.slices) if (s?.dependsOn?.length) problems.push(`slice "${s.id}" depends on another, and with the slices practice off no slice does`);
  }
  return problems;
}

// The approved plan's entry for the run's current slice.
export function sliceOf(run) {
  return run.plan.slices.find((s) => s.id === run.slice.id);
}

// The run's record of a slice it is about to start: where it began and what it may still spend.
export function freshSlice(slice, base, budget) {
  return { id: slice.id, base, budget, attempt: 1 };
}

// The steps of a slice in flight, from which the session may replan, and the step a slice whose
// attempts are spent goes to while replans are left.
export const REPLANNABLE = ['red', 'green', 'builder', 'mutant', 'group-review', 'contract-review', 'slice-dispositions', 'replan'];

// The replans the cycle has left: its budget, less those its history holds.
export const replansLeft = (ctx, run) => ctx.config.replans - (run.history ?? []).filter((h) => h.what === 'replan').length;

// A replan: plan.json approved over the run's plan, its landed slices unchanged and every criterion
// still realized, with the slice in flight dropped and its code, restored to the slice's base first,
// left behind, and the next slice started fresh from there. No gate attacks a replan: the final gate
// attacks the whole change.
export function replan(run, ctx) {
  const left = replansLeft(ctx, run);
  if (left <= 0) return { refused: [`the cycle has used its ${ctx.config.replans} replans; stop instead: ${ENGINE} record ${run.key} need "<what>"`] };
  const plan = readPlan(ctx.root, run);
  const problems = checkApproval(plan, run, criterionKeys(designAt(ctx.git, run)));
  if (same(plan, run.plan)) problems.push('plan.json is the plan the run already holds: a replan changes the slices that have not landed');
  if (problems.length) return { refused: problems };
  return { onward: 'slice', extra: { plan, landed: run.landed ?? [], slice: null, accepted: run.slice.base } };
}

// The lines every step of a slice in flight prints, beside the stop and the rejection.
export const replanLine = (run, ctx) =>
  `If the plan does not pan out, it is yours to change: rewrite plan.json for the slices that have not landed and replan (${replansLeft(ctx, run)} left this cycle), which drops the slice in flight: ${ENGINE} record ${run.key} replan`;

export const PLAN_STEPS = {
  replan: {
    title: 'replan the slices that have not landed',
    records: 'replan',
    instruct: (run) => [
      `Slice "${run.slice.id}" used all its attempts, and its code is restored to where it began (${run.slice.base}). The last attempt was spent because:`,
      ...(run.slice.spent?.reasons ?? []).map((r) => `  - ${r.replace(/\n/g, '\n    ')}`),
      '',
      `The plan is yours: rewrite ${runDirectory(run)}/plan.json for the slices that have not landed, so the work goes on. Rewrite`,
      'this slice, split it, fold it into another, or, where what it tests already holds, make it a substitute,',
      'whose tests pass as they are and fail on its broken state. Slices that landed stay unchanged, and every',
      "criterion stays realized. Stop with a need only for what no plan reaches: information or an effect the",
      'run may not perform.',
    ],
    record: (run) => `${ENGINE} record ${run.key} replan`,
    // The slice's code goes back to where it began before the plan changes.
    bounds: (run) => ({ from: run.slice.base }),
    accept: (run, ctx) => replan(run, ctx),
  },

  plan: {
    title: 'plan the slices',
    records: 'plan',
    instruct: (run, ctx) => {
      const on = run.practices;
      return [
        // A later cycle opens on a newer design, merged into what the cycles before delivered.
        ...(run.cycle > 1
          ? [
              `Cycle ${run.cycle} opens on a newer design and its scaffold, which ${run.itemBranch} brought and the branch merged in: the code`,
              'already holds what the cycles before delivered, and the plan delivers this design on top of it.',
              '',
            ]
          : []),
        `Plan the delivery of the design as the run admitted it (git show ${run.startCommit}:${run.design}) as a`,
        on.slices
          ? 'graph of vertical slices, each delivering observable behaviour through every layer it needs, and write it'
          : 'single vertical slice, delivering every acceptance criterion through every layer it needs, and write it',
        `to ${runDirectory(run)}/plan.json in this form:`,
        '',
        ...planTemplate(on).split('\n').map((l) => `  ${l}`),
        '',
        'The design is the commitment: the slices realize every one of its acceptance criteria and nothing',
        run.scaffold
          ? `else. Its event model is already in code as the scaffold (commit ${run.scaffold}), whose ${GAP_MARKER} lines are the gaps to fill.`
          : 'else.',
        ...(run.landed?.length ? [`Slices that landed (${run.landed.join(', ')}) stay in the plan unchanged; a plan that adds none goes straight to the final gate.`] : []),
        ...(on.slices ? [] : ['The slices practice is off, so the plan adds one slice to those that landed, depending on none.']),
        'A slice is "broad" when it changes a contract other code depends on, a data schema, or more than one',
        'package; otherwise "contained". A slice names a suite the adapters declare and its test files, and the',
        'engine runs the suite itself over them; a plan never writes a test command. The suites:',
        ...Object.entries(run.adapters.suites).map(([name, s]) => `  ${name}: test files under ${s.cwd ?? 'the repository root'}, its report read as ${s.report}`),
        ...(on['red-green']
          ? [
              "Each test file is in the slice's frozen set. A test's full name, as \"expectFail\" gives it, is in a jest",
              "report its fullName, the describe titles and its own joined by spaces; in a junit report its testcase's",
              'classname and name joined by a space, or its name alone where it has no classname. A path in',
              '"frozen" or "stubs" may name a directory. A slice that cannot have a red (a refactor,',
              'configuration, UI or docs) sets "substitute": { "broken": { file, find, replace }, "reason" } instead of',
              `${on.mutant ? '"expectFail", "mutant" and "stubs"' : '"expectFail" and "stubs"'}: its tests must pass as they are and fail on the broken state.`,
            ]
          : [
              "Each test file is in the slice's frozen set, beside the fixtures and runner configuration its tests need;",
              'a path in "frozen" may name a directory. One Builder writes the slice\'s code and its tests together,',
              'every test must pass, and the frozen set is locked once the slice lands.',
            ]),
        ...(on.mutant ? [`The mutant says what behaviour a defect should break; after ${on['red-green'] ? 'green' : 'the build'}, a fresh dispatch names the exact edit.`] : []),
        ...(on.exhibits
          ? [
              `Each slice promises an exhibit, the strongest form first (${EXHIBIT_FORMS.join(', then ')}), for a person who was not`,
              'in the session, or says "none" with why a reader sees nothing more than the diff shows; at least one',
              `slice promises one. Its proof run writes it: the engine sets $${EXHIBITS_VARIABLE} to a directory for`,
              `the suite, and the tests ${on['red-green'] ? 'Red writes' : 'the Builder writes'} save the exhibit there, or the slice's "command" does,`,
              'run after the tests pass (a script that records or screenshots the running feature). The engine keeps',
              `what the accepted ${on['red-green'] ? "green's" : "build's"} run writes, in ${runDirectory(run)}/exhibits/<slice id>/.`,
            ]
          : []),
      ];
    },
    record: (run) => `${ENGINE} record ${run.key} plan`,
    accept(run, ctx) {
      const plan = readPlan(ctx.root, run);
      const problems = checkApproval(plan, run, criterionKeys(designAt(ctx.git, run)));
      if (problems.length) return { refused: problems };
      // The stages decide whether the plan gate attacks it, and a plan that adds no slice to what landed
      // goes straight to the final gate.
      return { onward: 'plan-gate', extra: { plan, landed: run.landed ?? [], slice: null } };
    },
  },
};
