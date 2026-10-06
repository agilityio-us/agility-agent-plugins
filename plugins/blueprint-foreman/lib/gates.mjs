// The two gates. The plan gate attacks the plan against the design, and every slice's test plan,
// before any slice starts; the final gate attacks the whole branch after every slice has landed,
// beside the engine's own convergence findings, and its Contract Reviewer gives a verdict on every
// criterion and on every event model row the graph cannot show. In each cycle a gate runs once and
// resumes once to confirm its fixes; whatever is still open on that second round is handed off, never
// fixed in another loop. A plan finding is fixed by amending the plan, a final-gate finding by a new
// slice with its own budget. The design is the commitment, so a finding against the design itself is
// handed off. What a gate finds, the verdicts, and who each round's Adversary was, the run state keeps.
// The Adversary's route and model are the run's, pinned at admission. The plan gate runs only with the
// slices and adversary practices (stages.mjs); the final gate always, asking the Adversary only with
// adversary and the Contract Reviewer only with review, and with neither its round closes at once on the
// engine's own findings.

import fs from 'node:fs';
import path from 'node:path';
import { adversaryRoute, askAdversary, routeName, ADVERSARY_PROMPT } from './adversary.mjs';
import { ENGINE } from './config.mjs';
import { criteria, criterionKeys, designAt } from './design.mjs';
import { checkApproval, nextSlice, readPlan } from './plan.mjs';
import { ENGINE_RAISED, FINDINGS_FORM, acceptDispositions, checkFindings, dispositionsBrief } from './review.mjs';
import { authorRefusal, noAuthor, openGate, ownPaths, readRunJson, runDirectory, runFile, same } from './run.mjs';

// A round's directory; the final gate opened again after a merge has its own.
function gateDir(run) {
  const { name, cycle, round, merge } = run.gate;
  return `gates/${name}-c${cycle}${merge ? `-merge-${merge.slice(0, 12)}` : ''}-r${round}`;
}

function gatePath(root, run, file) {
  return runFile(root, run, path.join(gateDir(run), file));
}

// A file of the gate's round, written by the engine each time the step is described, whatever the
// round's directory held, so what its reviewers read is the engine's and on record.
function writeRound(ctx, run, name, text) {
  const file = gatePath(ctx.root, run, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return `${runDirectory(run)}/${gateDir(run)}/${name}`;
}

// The curated package: the design and the plan, and what else the gate weighs: at the plan gate the
// scaffold's diff, at the final gate the branch's since the cycle's admitted commit; in round 2 what
// round 1 found and what became of each. The author does not choose what the adversary
// sees: the engine builds it again for its own request, and the round's package.md is the copy for a
// subagent to read. Each heading names the repository file, or the commit, a finding on it cites.
function packageText(ctx, run) {
  const { name, cycle, round, merge, previous } = run.gate;

  // The run's own state is not part of the change under review.
  const diff = (from, to) => ['```diff', ctx.git.diffText(from, to, ['.', ...ownPaths(run).map((p) => `:(exclude)${p}`)]), '```'];
  const parts = [
    `# ${name} gate for ${run.key}, cycle ${cycle}, round ${round}${merge ? `, after merge ${merge}` : ''}`,
    '',
    `## Design: ${run.design}`,
    designAt(ctx.git, run),

    `## Plan: ${runDirectory(run)}/plan.json`,
    '```json',
    JSON.stringify(run.plan, null, 2),
    '```',
    ...(name === 'plan' && run.scaffold ? [`## Scaffold: commit ${run.scaffold}`, ...diff(`${run.scaffold}~1`, run.scaffold)] : []),
    ...(name === 'final' ? ['## Diff of the whole branch', ...diff(run.startCommit, ctx.git.head())] : []),
    ...(previous ? ["## Round 1's findings and their dispositions", '```json', JSON.stringify(previous, null, 2), '```'] : []),
  ];
  return `${parts.join('\n')}\n`;
}

// The findings a final-gate round carries in, each once, keeping its source and naming where it came
// from, so the engine's own stay its own: in a round a merge opened, those the round it interrupted
// left unsettled.
function carriedFindings(run) {
  const carried = new Map();
  const carry = ({ file, line, claim, source }, from) => carried.set(`${file}:${line}: ${claim}`, { file, line, claim, ...(source ? { source } : {}), carried: from });
  for (const f of run.gate.carried ?? []) carry(f, f.carried);
  return [...carried.values()];
}

// The final gate opened again at its first round after `merge`, taken in at rest, holding the findings
// of the round it interrupts that no dispositions settled, so none is dropped.
export function reopenFinal(run, merge) {
  const open = run.gate?.findings ?? run.gate?.carried ?? [];
  const carried = open.map((f) => ({ file: f.file, line: f.line, claim: f.claim, ...(f.source ? { source: f.source } : {}), carried: f.carried ?? gateDir(run) }));
  return { ...openGate('final', run.cycle, merge), ...(carried.length ? { carried } : {}) };
}

const writeJson = (ctx, run, name, value) => writeRound(ctx, run, name, `${JSON.stringify(value, null, 2)}\n`);

// The final gate's convergence is the run state's, which land writes as the last slice lands.
const NO_CONVERGENCE = 'the run state holds no convergence for the final gate, which only the engine writes, as the last slice lands';

// The one form of the final Contract Reviewer's file.
const CONTRACT_FORM = `{ "verdicts": { "<criterion key or row>": { "met": true | false, "evidence": "<what shows it>" } }, "findings": ${FINDINGS_FORM} }`;

// What the final Contract Reviewer owes a verdict on: every criterion of the design, and every row
// convergence handed on, each with the design line an unmet verdict is a finding on.
function verdictsOwed(ctx, run) {
  return [
    ...criteria(designAt(ctx.git, run)).map((c) => ({ name: c.key, label: `criterion "${c.key}"`, line: c.n })),
    ...run.convergence.handed.map((h) => ({ name: h.row, label: `the row "${h.row}"`, line: h.line })),
  ];
}

// The final Contract Reviewer's contract.json: a verdict { met, evidence } on each it owes and on
// nothing else, and findings in their one form. Returns the verdicts, and its findings with one more
// for each unmet verdict, which the engine raises itself, or { refused }.
function judgeContract(ctx, run) {
  const contract = readRunJson(ctx.root, run, `${gateDir(run)}/contract.json`);
  const verdicts = contract?.verdicts;
  if (verdicts === null || typeof verdicts !== 'object' || Array.isArray(verdicts)) return { refused: [`contract.json needs "verdicts", one on each criterion key and row it is given: ${CONTRACT_FORM}`] };
  const owed = verdictsOwed(ctx, run);
  const problems = checkFindings(contract.findings, "the final contract review's findings");
  for (const name of Object.keys(verdicts)) {
    if (!owed.some((o) => o.name === name)) problems.push(`contract.json gives a verdict on "${name}", which is neither a criterion key nor a row it is given`);
  }
  const unmet = [];
  for (const o of owed) {
    const v = verdicts[o.name];
    if (!Object.hasOwn(verdicts, o.name)) problems.push(`contract.json gives no verdict on ${o.label}`);
    else if (typeof v?.met !== 'boolean' || typeof v.evidence !== 'string' || v.evidence.trim() === '') problems.push(`contract.json's verdict on ${o.label} needs "met": true or false, and its "evidence"`);
    else if (!v.met) unmet.push({ file: run.design, line: o.line, claim: `the Contract Reviewer finds ${o.label} unmet: ${v.evidence}`, source: 'verdict' });
  }
  if (problems.length) return { refused: problems };
  return {
    verdicts: Object.fromEntries(owed.map((o) => [o.name, { met: verdicts[o.name].met, evidence: verdicts[o.name].evidence }])),
    findings: [...contract.findings.map((f) => ({ ...f, source: 'contract' })), ...unmet],
  };
}

// The final gate's brief beside the engine's convergence, which it writes to the round's directory for
// the record: for its Contract Reviewer, or with the review practice off, the rows convergence hands on,
// which no reviewer judges.
function finalBrief(ctx, run, pkg) {
  if (!run.convergence) return [`The final gate cannot run: ${NO_CONVERGENCE}. Stop the run, with that as its need.`];
  const convergence = writeJson(ctx, run, 'convergence.json', run.convergence);
  const { handed } = run.convergence;
  const rows = handed.map((h) => `  - ${h.row} (${run.design}:${h.line}): ${h.why}`);
  const found = `The engine's convergence check found ${run.convergence.findings.length} problem(s) (${convergence}); they join the gate's findings.`;
  if (!run.practices.review) {
    return [found, ...(handed.length ? ["With the review practice off, no Contract Reviewer judges the event model rows the graph cannot show: the pull request's description hands each on as unverified.", ...rows] : [])];
  }
  return [
    found,
    `${ctx.models.dispatch('contract')}, ${noAuthor(run)}, to judge the whole branch (${run.startCommit}..HEAD) against the design in`,
    `${pkg}${run.practices.exhibits ? ", and each slice's exhibits against its promise in the plan there" : ''}. It gives a verdict on every criterion, by`,
    `its key: ${criterionKeys(designAt(ctx.git, run)).join(', ')}${handed.length ? '; and on every event model row the graph cannot show, by the name given here:' : '.'}`,
    ...rows,
    `It writes ${runDirectory(run)}/${gateDir(run)}/contract.json, proposing findings only, and edits nothing else:`,
    `  ${CONTRACT_FORM}`,
    "An unmet verdict is a finding; the verdicts on the criteria go into the pull request's description.",
    "Record the gate with the Contract Reviewer's agent id.",
  ];
}

// An outcome with `more` in the run state it moves to.
const also = (outcome, more) => ({ ...outcome, extra: { ...outcome.extra, ...more } });

// Where the run goes once a gate is through: after the plan gate the first slice, after the final gate
// settle.
const afterGate = (run) => (run.gate.name === 'plan' ? { onward: 'slice', extra: { gate: null } } : { next: 'settle', extra: { gate: null } });

// The rows convergence hands on by name, handed off to the description as unverified where no Contract
// Reviewer judges them, so none passes silently.
const unverified = (run) =>
  run.convergence.handed.map((h) => ({ at: gateDir(run), cycle: run.cycle, row: h.row, file: run.design, line: h.line, claim: `convergence hands on the row "${h.row}" by name: ${h.why}`, source: 'convergence', note: 'unverified: the review practice is off' }));

// A gate's round closed on what its reviewers raised, `findings`, at the final gate joined by the
// engine's own, the final run's, and those the round carries in: the round kept with its Adversary,
// null where it had none, and its verdicts, and with no Contract Reviewer the rows convergence hands on
// handed off as unverified. With no finding the gate is through; else its findings go to their
// dispositions, `reviewer` and `model` the Adversary's for the calibration log.
export function closeRound(run, ctx, { findings = [], adversary = null, verdicts, reviewer, model, log = [] } = {}) {
  const kept = ranRound(run, adversary, verdicts);
  let all = findings;
  let lines = log;
  if (run.gate.name === 'final') {
    const converged = run.convergence.findings;
    lines = [...log, { gate: 'final', cycle: run.gate.cycle, round: run.gate.round, reviewer: 'engine', model: '-', provider: '-', findings: converged.length }];
    all = [...findings, ...converged.map((f) => ({ ...f, source: 'convergence' })), ...carriedFindings(run)];
    if (!run.practices.review) kept.handedOff = [...(run.handedOff ?? []), ...unverified(run)];
    writeJson(ctx, run, 'convergence.json', run.convergence);
  }
  writeJson(ctx, run, 'findings.json', all);
  if (all.length === 0) return { ...also(afterGate(run), kept), log: lines };
  // The run state keeps the findings its dispositions settle; findings.json is the session's copy.
  return { next: 'gate-dispositions', extra: { ...kept, gate: { ...run.gate, reviewer, model, findings: all } }, log: lines };
}

// Who raised a finding, for the calibration log: an unmet verdict is the Contract Reviewer's judgment.
function raisedBy(run, ctx, finding) {
  if (finding?.carried) return { reviewer: 'carried', model: '-' };
  if (['contract', 'verdict'].includes(finding?.source)) return { reviewer: 'contract', model: ctx.models.pick('reviewer') };
  if (finding?.source === 'convergence') return { reviewer: 'engine', model: '-' };
  return { reviewer: run.gate.reviewer, model: run.gate.model };
}

// The Adversary's route as the record's environment gives it, keyed or not, where it is not the one the
// run pinned at admission: the refusal, or null. Its model and settings are the run's own.
function routeRefusal(run, ctx) {
  const pinned = run.adversary;
  const route = adversaryRoute(ctx.env, pinned.model, pinned.zdr);
  if (route.keyed === pinned.keyed) return null;
  return { refused: [`the gates' Adversary is ${routeName(pinned)}, as the run was admitted, but this record's environment gives ${routeName(route)}; record the gate in the environment the run was admitted in, or stop the run`] };
}

// The run state's record of the round that just ran, `adversary` its Adversary as the description
// names it, and at the final gate the verdicts it gave, which the run state then keeps as they were.
function ranRound(run, adversary, verdicts) {
  const { name: gate, cycle, round, merge } = run.gate;
  return { rounds: [...(run.rounds ?? []), { at: gateDir(run), gate, cycle, round, ...(merge ? { merge } : {}), adversary, ...(verdicts ? { verdicts } : {}) }] };
}

export const GATE_STEPS = {
  gate: {
    title: 'run the gate',
    records: 'gate',
    instruct(run, ctx) {
      const pkg = writeRound(ctx, run, 'package.md', packageText(ctx, run));
      const route = run.adversary;
      const dir = `${runDirectory(run)}/${gateDir(run)}`;
      // The final gate also holds the engine's convergence, and has the Contract Reviewer judge the whole
      // branch against the design; the gate is a step only where the Adversary or that reviewer runs.
      const final = run.gate.name === 'final' ? finalBrief(ctx, run, pkg) : [];
      if (!run.practices.adversary) return final;
      const before = final.length ? [...final, ''] : [];
      if (route.keyed && !run.gate.fallback) {
        return [...before, `The ${run.gate.name} gate's Adversary is ${route.model} through OpenRouter; the engine sends the request itself.`];
      }
      return [
        ...before,
        `The ${run.gate.name} gate's Adversary runs as a Claude subagent (${run.gate.fallback ?? route.why}).`,
        `${ctx.models.dispatch('adversary-fallback')} with these instructions, then the package in ${pkg}:`,
        '',
        ...ADVERSARY_PROMPT.split('\n').map((l) => `  ${l}`),
        '',
        `Write its findings, the "findings" list alone, to ${dir}/findings.json as ${FINDINGS_FORM}.`,
      ];
    },
    record: (run) => `${ENGINE} record ${run.key} gate${run.gate.name === 'final' && run.practices.review ? " <the Contract Reviewer's agent id>" : ''}`,
    async accept(run, ctx, agentId) {
      // The final contract review is judged first, so one the engine refuses costs no Adversary request.
      // Its Contract Reviewer is none of the run's authors, each Red, Green, Builder and Mutant it recorded.
      let contract = null;
      if (run.gate.name === 'final') {
        if (!run.convergence) return { refused: [NO_CONVERGENCE] };
        if (run.practices.review) {
          if (!agentId) return { refused: ["record the gate with the Contract Reviewer's agent id"] };
          const author = authorRefusal(run, agentId, 'the final contract verdict');
          if (author) return author;
          contract = judgeContract(ctx, run);
          if (contract.refused) return contract;
        }
      }
      const reviewed = contract
        ? [{ gate: 'final', cycle: run.gate.cycle, round: run.gate.round, reviewer: 'contract', model: ctx.models.pick('reviewer'), provider: 'anthropic', findings: contract.findings.length }]
        : [];
      if (!run.practices.adversary) return closeRound(run, ctx, { findings: contract?.findings, verdicts: contract?.verdicts, log: reviewed });
      const moved = routeRefusal(run, ctx);
      if (moved) return moved;
      const route = run.adversary;
      let findings;
      let reviewer = 'claude-adversary';
      let model = ctx.models.pick('adversary-fallback');
      let provider = 'anthropic';
      let adversary = `a Claude subagent, ${model} (${run.gate.fallback ?? route.why})`;
      if (route.keyed && !run.gate.fallback) {
        const answer = await askAdversary({ fetchImpl: ctx.fetch, env: ctx.env, model: route.model, zdr: route.zdr, packageText: packageText(ctx, run) });
        const malformed = answer.error ? [] : checkFindings(answer.findings, 'its answer');
        if (answer.error || malformed.length) {
          const why = answer.error ?? malformed[0];
          return {
            refused: [`the OpenRouter Adversary failed (${why}); the gate falls back to a Claude subagent`],
            next: 'gate',
            extra: { gate: { ...run.gate, fallback: `the OpenRouter request failed: ${why}` } },
            log: [{ gate: run.gate.name, cycle: run.gate.cycle, round: run.gate.round, reviewer: 'openrouter', model: route.model, provider: '-', findings: '-', outcome: 'failed' }],
          };
        }
        findings = answer.findings;
        reviewer = 'openrouter';
        model = answer.model;
        provider = answer.provider;
        adversary = `${model} over OpenRouter, through ${provider}`;
      } else {
        // A Claude Adversary reads the round's package.md, which must be the package the engine builds.
        const pkg = gatePath(ctx.root, run, 'package.md');
        if (!fs.existsSync(pkg) || fs.readFileSync(pkg, 'utf8') !== packageText(ctx, run)) {
          return { refused: [`${runDirectory(run)}/${gateDir(run)}/package.md is not the package the engine builds, which the Adversary subagent must read; the engine writes it again below: dispatch the Adversary again on it`] };
        }
        findings = readRunJson(ctx.root, run, `${gateDir(run)}/findings.json`);
      }
      const problems = checkFindings(findings, `the ${run.gate.name} gate's findings`);
      if (problems.length) return { refused: problems };
      findings = findings.map((f) => ({ ...f, source: 'adversary' }));
      const log = [{ gate: run.gate.name, cycle: run.gate.cycle, round: run.gate.round, reviewer, model, provider, findings: findings.length }, ...reviewed];
      return closeRound(run, ctx, { findings: [...findings, ...(contract?.findings ?? [])], adversary, verdicts: contract?.verdicts, reviewer, model, log });
    },
  },

  'gate-dispositions': {
    title: "settle the gate's findings",
    records: 'dispositions',
    instruct(run) {
      const fixing = run.gate.round === 1;
      const fix = run.gate.name === 'plan' ? 'amend plan.json to fix it' : 'add a new slice to plan.json that fixes it';
      const own = run.gate.findings.some((f) => ENGINE_RAISED.includes(f.source));
      const carried = run.gate.findings.some((f) => f.carried);
      return [
        ...dispositionsBrief(run, gateDir(run), fixing ? ['fixed', 'refuted', 'handed-off'] : ['refuted', 'handed-off']),
        ...(own ? [`A finding the engine raised itself, its "source" ${ENGINE_RAISED.map((s) => `"${s}"`).join(' or ')}, is fixed or handed off: a refutation of it is handed off.`] : []),
        ...(carried ? ['A finding that names where it was "carried" from was left unsettled by a round a merge interrupted; settle it again.'] : []),
        fixing
          ? `To fix one, ${fix}. The design is fixed input: hand off a finding against the design itself.`
          : 'This is the confirming round: nothing more is fixed here. Refute with evidence or hand off.',
      ];
    },
    record: (run) => `${ENGINE} record ${run.key} dispositions`,
    accept(run, ctx) {
      const done = acceptDispositions(ctx, run, gateDir(run), run.gate.findings, {
        unfixable: run.gate.round === 2 ? 'the confirming round fixes nothing; refute with evidence or hand off' : null,
        raised: (f) => ({ gate: run.gate.name, cycle: run.gate.cycle, round: run.gate.round, ...raisedBy(run, ctx, f) }),
      });
      if (done.refused) return done;
      const kept = { handedOff: done.handedOff, fixed: done.fixed };
      const { log } = done;
      if (!done.settled.some((s) => s.disposition === 'fixed')) return { ...also(afterGate(run), kept), log };
      // A fix changes the plan, so it must still cover the design, and keep what landed, before the gate
      // resumes; the amended plan is then the approved one. A fixed plan finding is fixed in the plan, so
      // the plan must differ from the one the gate attacked.
      const plan = readPlan(ctx.root, run);
      if (run.gate.name === 'plan' && same(plan, run.plan)) {
        return { refused: [`a plan finding marked fixed is fixed in ${runDirectory(run)}/plan.json, and it is the plan the gate attacked, unchanged`] };
      }
      const problems = checkApproval(plan, run, criterionKeys(designAt(ctx.git, run)));
      if (problems.length) return { refused: problems };
      // The confirming round's package carries what this round found and what became of each.
      const previous = done.settled.map(({ finding, disposition, evidence, note }) => {
        const { file, line, claim, source } = run.gate.findings[finding - 1];
        return { file, line, claim, source, disposition, ...(evidence === undefined ? {} : { evidence }), ...(note ? { note } : {}) };
      });
      const confirm = { ...run.gate, round: 2, fallback: undefined, findings: undefined, carried: undefined, previous };
      if (run.gate.name === 'final') {
        if (!nextSlice(plan, run.landed)) return { refused: ['a fixed final-gate finding needs a new slice in plan.json, and none is left to work'] };
        return { onward: 'slice', extra: { ...kept, plan, gate: confirm }, log };
      }
      return { next: 'gate', extra: { ...kept, plan, gate: confirm }, log };
    },
  },
};
