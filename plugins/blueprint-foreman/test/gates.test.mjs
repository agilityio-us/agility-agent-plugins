// Offline tests for the plan and final gates, the Adversary and convergence: `node --test
// plugins/blueprint-foreman/test/gates.test.mjs`; their fixture is fixture.mjs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { askAdversary } from '../lib/adversary.mjs';
import { run } from '../lib/wake.mjs';
import { MODEL_TABLE, createModels } from '../lib/models.mjs';
import { KEY, BRANCH, EXTRACTOR, TEST_FILE, DESIGN, SLICE, FILLED, SCAFFOLDED, FAREWELL, MUTANTS, GREEN_CODE, fixture, ok, refused, walk, restore, commitRun, REVIEW, exhibit, GREETING, NOTES, allMet, settled, answer, DESIGN_FILE, GREET_ROW, proposes } from './fixture.mjs';

// The first cycle's final gate, round 1.
const FINAL = `docs/prs/${KEY}/foreman/gates/final-c1-r1`;

test('a scaffolded design goes red, green, replayed, reviewed, converged and landed, through both gates to settle', async () => {
  const f = fixture({ scaffold: true });
  const transcript = [];
  const step = async (...argv) => {
    const text = await ok(f, ...argv);
    transcript.push(`$ engine ${argv.join(' ')}\n${text}`);
    return text;
  };
  transcript.push(await walk(f, 'red', { slices: [SCAFFOLDED] }));
  assert.equal(f.runState().scaffold, f.sh('rev-parse', 'HEAD'), 'the scaffold commit is the one carrying this key, not the decoy');
  // The plan gate's package holds the scaffold's change, each part headed by what a finding on it cites.
  const pkg = f.read(`docs/prs/${KEY}/foreman/gates/plan-c1-r1/package.md`);
  assert.match(pkg, /## Design: docs\/prs\/PROJ-1\/blueprint\.md\n[\s\S]*## Plan: docs\/prs\/PROJ-1\/foreman\/plan\.json\n/);
  assert.ok(pkg.includes(`## Scaffold: commit ${f.runState().scaffold}\n\`\`\`diff\n`) && pkg.includes("+  return ''; // TODO(scaffold): the greeting"), pkg);
  f.write('test/greet.test.mjs', TEST_FILE);
  f.commit(`test(${KEY}): red for greet-by-name`, ['test/greet.test.mjs']);
  assert.match(await step('record', KEY, 'red', 'agent-red'), /step: green/);
  f.write('src/greet.mjs', FILLED);
  f.commit(`feat(${KEY}): greet-by-name`, ['src/greet.mjs']);
  assert.match(await step('record', KEY, 'green', 'agent-green'), /step: mutant[\s\S]*fresh Mutant subagent/);
  assert.equal(f.read(GREETING), "greet('Ada') returns: Hello, Ada\n", 'the proof run wrote the exhibit');
  assert.doesNotMatch(f.read(`docs/prs/${KEY}/foreman/briefs/greet-by-name-mutant-1.md`), /greet names the person/, "the Mutant is not shown the tests");
  f.write(`${REVIEW}/mutant.json`, JSON.stringify(MUTANTS['greet-by-name']));
  // The replays run inside the mutant's record, and land inside the contract review's.
  assert.match(await step('record', KEY, 'mutant', 'agent-mutant'), /step: group-review/);
  for (const g of JSON.parse(f.read(`${REVIEW}/groups.json`))) f.write(`${REVIEW}/group-${g.id}.findings.json`, '[]');
  assert.match(await step('record', KEY, 'groups'), /step: contract-review/);
  f.write(`${REVIEW}/contract.json`, JSON.stringify({ verdict: 'pass', reasons: [], findings: [] }));
  assert.match(await step('record', KEY, 'contract', 'agent-reviewer'), /found 0 problem\(s\)[\s\S]*It gives a verdict on every criterion, by\nits key: greets-by-name\.\n[\s\S]*final gate's Adversary/);
  f.write(`${FINAL}/findings.json`, '[]');
  f.write(`${FINAL}/contract.json`, JSON.stringify(allMet(f, f.runState())));
  assert.match(await step('record', KEY, 'gate', 'agent-reviewer'), /step: settle[\s\S]*pr-notes\.md/);
  commitRun(f);
  f.write(`docs/prs/${KEY}/foreman/pr-notes.md`, NOTES);
  assert.match(await step('record', KEY, 'notes'), /--trailer 'Foreman-Cycle: 1' --trailer 'Foreman-Run: PROJ-1 settled' --trailer 'Blueprint-Status: done' -- 'docs\/prs\/PROJ-1\/foreman' 'docs\/prs\/PROJ-1\/pull-request\.md'\n[\s\S]*step: settled[\s\S]*Its run-state commit carries docs\/prs\/PROJ-1\/pull-request\.md, the pull request's description,/);
  const log = f.read(`docs/prs/${KEY}/foreman/calibration.log`);
  assert.match(log, /gate=plan cycle=1 round=1 reviewer=claude-adversary/);
  assert.match(log, /review=slice slice=greet-by-name attempt=1 reviewer=contract .* verdict=pass/);
  assert.match(log, /gate=final .* reviewer=engine model=- provider=- findings=0/);
  assert.deepEqual(f.runState().landed, ['greet-by-name']);
  assert.ok(fs.existsSync(path.join(f.root, 'docs', 'prs', KEY, 'foreman', 'briefs', 'greet-by-name-red-1.md')));
  assert.match(f.read(`docs/prs/${KEY}/foreman/briefs/greet-by-name-green-1.md`), /The scaffold \(commit [0-9a-f]+\) is locked/);
  exhibit('run-scaffolded-design', transcript.join('\n\n'));
});

test('the final gate finds unrealized design and open gaps, and its Contract Reviewer gives a verdict on every criterion and every row ids cannot show', async () => {
  const design = DESIGN.replace(
    GREET_ROW,
    `${GREET_ROW}${proposes('function', 'farewell', 'greet_fn_farewell')}${proposes('ui', 'greeting card', 'greet_ui_greeting-card')}`,
  );
  const f = fixture({ scaffold: true, design });
  // A keyed run, whose final gate's Adversary is asked only once the contract review stands.
  const sent = [];
  f.ctx.env = { OPENROUTER_API_KEY: 'sk-or-test-secret' };
  f.ctx.fetch = async (url, init) => {
    sent.push(init);
    return { ok: true, json: async () => ({ provider: 'P', model: 'vendor/model-x', choices: [{ message: { content: '{"findings":[]}' } }] }) };
  };
  f.ctx.models = createModels({ ...MODEL_TABLE, adversary: 'vendor/model-x' });
  await walk(f, 'red', { slices: [SCAFFOLDED] });
  // The gap's comment survives beside the filled line, so the gap still reads as open.
  const text = await walk(f, 'final', { green: { 'src/greet.mjs': FILLED.replace('`Hello, ${name}`;', '`Hello, ${name}`; // TODO(scaffold): the greeting') } });
  const line = design.split('\n').findIndex((l) => l.includes('greet_fn_farewell')) + 1;
  assert.match(text, /found 2 problem\(s\)/);
  // What the extractor does not emit goes to the Contract Reviewer by name, and is no finding of the engine's.
  assert.match(text, new RegExp(`every event model row the graph cannot show, by the name given here:\\n {2}- greet_ui_greeting-card \\(docs/prs/PROJ-1/blueprint\\.md:${line + 1}\\): the extractor does not emit its type, ui\\n`));
  const { convergence } = f.runState();
  assert.deepEqual(convergence.findings, [
    { file: DESIGN_FILE, line, claim: 'greet_fn_farewell is not in the extracted graph, so the code does not realize this propose' },
    { file: 'src/greet.mjs', line: 3, claim: 'a scaffold gap is still open: return `Hello, ${name}`; // TODO(scaffold): the greeting' },
  ]);
  assert.deepEqual(convergence.handed, [{ row: 'greet_ui_greeting-card', line: line + 1, why: 'the extractor does not emit its type, ui' }]);
  // The run state keeps the convergence; the copy in the round's directory is the session's to read.
  assert.deepEqual(JSON.parse(f.read(`${FINAL}/convergence.json`)), convergence);
  fs.rmSync(path.join(f.root, FINAL, 'convergence.json'));
  sent.length = 0;
  const contract = (body) => {
    f.write(`${FINAL}/contract.json`, JSON.stringify(body));
    return f.engine('record', KEY, 'gate', 'agent-reviewer');
  };
  const met = { met: true, evidence: 'greet names Ada' };
  const both = { 'greets-by-name': met, 'greet_ui_greeting-card': met };
  refused(await f.engine('record', KEY, 'gate', 'agent-reviewer'), /gates\/final-c1-r1\/contract\.json is not readable JSON \(there is no such file\)/);
  // One field out of its form per row, each refused with the run left at the gate.
  const verdictsForm = /contract\.json needs "verdicts", one on each criterion key and row it is given: \{ "verdicts"/;
  for (const [body, pattern] of [
    [{ findings: [] }, verdictsForm],
    [{ verdicts: null, findings: [] }, verdictsForm],
    [{ verdicts: [met], findings: [] }, verdictsForm],
    [{ verdicts: { 'greets-by-name': met }, findings: [] }, /contract\.json gives no verdict on the row "greet_ui_greeting-card"/],
    [{ verdicts: { 'greet_ui_greeting-card': met }, findings: [] }, /contract\.json gives no verdict on criterion "greets-by-name"/],
    [{ verdicts: { ...both, 'greets-by-nam': met }, findings: [] }, /contract\.json gives a verdict on "greets-by-nam", which is neither a criterion key nor a row it is given/],
    [{ verdicts: { ...both, 'greets-by-name': { met: 'yes', evidence: 'x' } }, findings: [] }, /verdict on criterion "greets-by-name" needs "met": true or false, and its "evidence"/],
    [{ verdicts: { ...both, 'greet_ui_greeting-card': { met: true } }, findings: [] }, /verdict on the row "greet_ui_greeting-card" needs "met": true or false, and its "evidence"/],
    [{ verdicts: { ...both, 'greets-by-name': { met: true, evidence: ' ' } }, findings: [] }, /verdict on criterion "greets-by-name" needs "met": true or false, and its "evidence"/],
    [{ verdicts: both }, /the final contract review's findings must be a list, possibly empty/],
    [{ verdicts: both, findings: [{ file: 'src/greet.mjs', claim: 'no line cited' }] }, /the final contract review's findings: finding 1 must cite a file and a line/],
  ]) {
    refused(await contract(body), pattern);
    assert.equal(f.runState().step, 'gate', JSON.stringify(body));
  }
  assert.equal(sent.length, 0, 'a contract review the engine refuses costs no Adversary request');
  // An unmet verdict is a finding on its design row, and the verdicts go into the run state for settle.
  // The Contract Reviewer's own findings join them.
  const verdicts = { 'greets-by-name': { met: false, evidence: 'greet says Hi' }, 'greet_ui_greeting-card': { met: false, evidence: 'no card renders the greeting' } };
  const own = { file: 'src/greet.mjs', line: 2, claim: 'greet ignores an empty name' };
  const out = await contract({ verdicts, findings: [own] });
  assert.equal(out.code, 0, out.text);
  assert.match(out.text, /step: gate-dispositions/);
  assert.equal(sent.length, 1);
  const file = DESIGN_FILE;
  const criterion = design.split('\n').findIndex((l) => l.startsWith('- greets-by-name ')) + 1;
  const found = [
    { ...own, source: 'contract' },
    { file, line: criterion, claim: 'the Contract Reviewer finds criterion "greets-by-name" unmet: greet says Hi', source: 'verdict' },
    { file, line: line + 1, claim: 'the Contract Reviewer finds the row "greet_ui_greeting-card" unmet: no card renders the greeting', source: 'verdict' },
    ...convergence.findings.map((x) => ({ ...x, source: 'convergence' })),
  ];
  assert.deepEqual(JSON.parse(f.read(`${FINAL}/findings.json`)), found);
  assert.deepEqual(f.runState().rounds.at(-1).verdicts, verdicts, 'the round keeps the verdicts it gave');
  // The run state keeps the gate's findings too, so findings.json emptied loses none.
  f.write(`${FINAL}/findings.json`, '[]');
  f.write(`${FINAL}/dispositions.json`, '[]');
  refused(await f.engine('record', KEY, 'dispositions'), /findings 1, 2, 3, 4, 5 have no disposition/);
  // The calibration log credits each finding to who raised it: the Contract Reviewer its own and its
  // unmet verdicts, the engine convergence's.
  f.write(`${FINAL}/dispositions.json`, JSON.stringify(found.map((_, i) => ({ finding: i + 1, disposition: 'handed-off' }))));
  assert.match(await ok(f, 'record', KEY, 'dispositions'), /step: settle/);
  const by = (n, who) => `finding=${n} gate=final cycle=1 round=1 ${who} disposition=handed-off`;
  const contractReviewer = 'reviewer=contract model=claude-opus-5-5';
  const engine = 'reviewer=engine model=-';
  assert.deepEqual(f.read(`docs/prs/${KEY}/foreman/calibration.log`).match(/^finding=\d+ gate=final .*$/gm), [by(1, contractReviewer), by(2, contractReviewer), by(3, contractReviewer), by(4, engine), by(5, engine)]);
  exhibit('final-gate-convergence-findings', JSON.stringify(convergence, null, 2));
});

test("a final-gate finding is fixed by a new slice, which lands into the gate's confirming round, where a refutation may cite a test any landed slice's proof run passed", async () => {
  // Every record's run state is committed, as a session does, and each follows from the one before.
  const f = fixture();
  await walk(f, 'final', { commit: true });
  f.write(`${FINAL}/findings.json`, JSON.stringify([{ file: 'src/greet.mjs', line: 2, claim: 'nothing says goodbye' }]));
  f.write(`${FINAL}/contract.json`, JSON.stringify(allMet(f, f.runState())));
  await ok(f, 'record', KEY, 'gate', 'agent-reviewer');
  commitRun(f);
  f.write(`${FINAL}/dispositions.json`, JSON.stringify([{ finding: 1, disposition: 'fixed' }]));
  refused(await f.engine('record', KEY, 'dispositions'), /a fixed final-gate finding needs a new slice in plan\.json, and none is left to work/);
  f.write(`docs/prs/${KEY}/foreman/plan.json`, JSON.stringify({ slices: [SLICE, FAREWELL] }));
  assert.match(await ok(f, 'record', KEY, 'dispositions'), /step: red/);
  commitRun(f);
  await walk(f, 'final', { commit: true });
  const second = `docs/prs/${KEY}/foreman/gates/final-c1-r2`;
  const { gate } = f.runState();
  assert.deepEqual([gate.name, gate.cycle, gate.round], ['final', 1, 2], 'the fix slice lands into the confirming round');
  assert.match(f.read(`${second}/package.md`), /## Round 1's findings and their dispositions\n```json\n[\s\S]*"disposition": "fixed"/);
  f.write(`${second}/findings.json`, JSON.stringify([{ file: 'src/greet.mjs', line: 2, claim: 'the greeting may not name the person' }]));
  f.write(`${second}/contract.json`, JSON.stringify(allMet(f, f.runState())));
  const brief = await ok(f, 'record', KEY, 'gate', 'agent-reviewer');
  commitRun(f);
  assert.match(brief, /or a test a landed slice's proof run passed, by\nits full name, \{ "test": "<name>", "why": "\.\.\." \}, one of "greet names the person", "farewell names the person"\./);
  f.write(`${second}/dispositions.json`, JSON.stringify([{ finding: 1, disposition: 'refuted', evidence: { test: 'greet names the person', why: 'it asserts the greeting names Ada' } }]));
  assert.match(await ok(f, 'record', KEY, 'dispositions'), /step: settle/);
  commitRun(f);
  await ok(f, 'wake');
  assert.deepEqual(JSON.parse(f.read(`${second}/settled.json`)).map((s) => s.disposition), ['refuted'], 'the first slice landed before the last');
});

test("the final gate's Contract Reviewer is recorded by its agent id, and is none of the Reds, Greens and Mutants the run recorded", async () => {
  const f = fixture();
  await walk(f, 'green');
  // A Green whose attempt was spent is one of the run's authors all the same.
  f.write('src/greet.mjs', GREEN_CODE.replace('Hello, ', 'Hi, '));
  f.commit('a green that fails', ['src/greet.mjs']);
  restore(f, refused(await f.engine('record', KEY, 'green', 'agent-green-spent'), /spends an attempt \(2 left\)/));
  const text = await walk(f, 'final');
  assert.match(text, /none of the run's Red, Green or Mutant subagents, to judge the whole branch[\s\S]*Record the gate with the Contract Reviewer's agent id\.\n[\s\S]*When done, record it: node \S+ record PROJ-1 gate <the Contract Reviewer's agent id>\n/);
  f.write(`${FINAL}/findings.json`, '[]');
  f.write(`${FINAL}/contract.json`, JSON.stringify(allMet(f, f.runState())));
  refused(await f.engine('record', KEY, 'gate'), /refused\n {2}- record the gate with the Contract Reviewer's agent id\n/);
  const mutant = f.runState().authors.find((a) => a.startsWith('agent-mutant'));
  for (const author of ['agent-red', 'agent-green-spent', 'agent-green', mutant]) {
    const out = refused(await f.engine('record', KEY, 'gate', author), /refused\n {2}- the final contract verdict must come from a fresh dispatch, never one the run recorded as a Red, a Green or a Mutant, as it did /);
    assert.ok(out.includes(`as it did ${author}\n`), out);
  }
  assert.match(await ok(f, 'record', KEY, 'gate', 'agent-reviewer'), /step: settle/);
});

test('an extractor that fails is a final-gate finding, not a stall, and what ids cannot show still goes to the Contract Reviewer', async () => {
  // The extractor admits the run, and fails once the greeting is in the code.
  const failing = EXTRACTOR.replace("import fs from 'node:fs';\n", "import fs from 'node:fs';\nif (fs.existsSync('src/greet.mjs') && fs.readFileSync('src/greet.mjs', 'utf8').includes('Hello')) process.exit(3);\n");
  const card = proposes('ui', 'greeting card', 'greet_ui_greeting-card');
  const design = DESIGN.replace(GREET_ROW, `${GREET_ROW}${card}`);
  const f = fixture({ extractor: failing, design });
  await walk(f, 'final');
  const { findings, handed } = f.runState().convergence;
  assert.equal(findings.length, 1);
  assert.match(findings[0].claim, /^convergence is unchecked: the extractor \(node extract\.mjs\) failed: it exited 3/);
  assert.deepEqual(handed, [{ row: 'greet_ui_greeting-card', line: design.split('\n').indexOf(card.trim()) + 1, why: 'the extractor does not emit its type, ui' }]);
});

test('a final gate whose run state holds no convergence refuses, rather than crashing', async () => {
  const f = fixture();
  await walk(f, 'final');
  // Only a run.json changed by hand lacks it, in a fresh clone, where no engine's copy guards it.
  fs.rmSync(path.join(f.root, '.git', 'blueprint-foreman'), { recursive: true });
  const { convergence, ...lost } = f.runState();
  f.write(`docs/prs/${KEY}/foreman/run.json`, JSON.stringify(lost, null, 2));
  assert.match(await ok(f, 'wake'), /The final gate cannot run: the run state holds no convergence for the final gate/);
  f.write(`${FINAL}/findings.json`, '[]');
  f.write(`${FINAL}/contract.json`, JSON.stringify({ verdicts: { 'greets-by-name': { met: true, evidence: 'greet names Ada' } }, findings: [] }));
  refused(await f.engine('record', KEY, 'gate'), /refused\n {2}- the run state holds no convergence for the final gate, which only the engine writes, as the last slice lands\n/);
});

// Keys a fixture's run for vendor/model-x over OpenRouter, recording the package each request sends.
function keyed(f, sent) {
  f.ctx.env = { OPENROUTER_API_KEY: 'sk-or-test-secret' };
  f.ctx.models = createModels({ ...MODEL_TABLE, adversary: 'vendor/model-x' });
  f.ctx.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body).messages[1].content);
    return { ok: true, json: async () => ({ provider: 'P', model: 'vendor/model-x', choices: [{ message: { content: '{"findings":[]}' } }] }) };
  };
}

test('the keyed Adversary is sent the package the engine builds, whatever package.md holds', async () => {
  const f = fixture();
  const sent = [];
  keyed(f, sent);
  await walk(f, 'gate');
  f.write(`docs/prs/${KEY}/foreman/gates/plan-c1-r1/package.md`, 'Nothing to review.\n');
  await ok(f, 'record', KEY, 'gate');
  assert.match(sent.at(-1), /^# plan gate for PROJ-1, cycle 1, round 1\n\n## Design: docs\/prs\/PROJ-1\/blueprint\.md\n---\nkey: PROJ-1[\s\S]*## Plan: docs\/prs\/PROJ-1\/foreman\/plan\.json\n```json\n\{\n {2}"slices": \[/);
});

test("a Claude Adversary reads the engine's package: package.md is written each time the gate is described, and a record whose package.md differs is refused", async () => {
  const f = fixture();
  await walk(f, 'green');
  // A package planted before the final gate opens is written over as it opens.
  f.write(`${FINAL}/package.md`, 'Nothing to review: the change is one comment.\n');
  await walk(f, 'final');
  assert.match(f.read(`${FINAL}/package.md`), /^# final gate for PROJ-1, cycle 1, round 1\n[\s\S]*## Diff of the whole branch\n/);
  // One edited after it was written is refused at the record, which writes it again.
  f.write(`${FINAL}/package.md`, 'Nothing to review.\n');
  f.write(`${FINAL}/findings.json`, '[]');
  f.write(`${FINAL}/contract.json`, JSON.stringify(allMet(f, f.runState())));
  refused(await f.engine('record', KEY, 'gate', 'agent-reviewer'), /docs\/prs\/PROJ-1\/foreman\/gates\/final-c1-r1\/package\.md is not the package the engine builds, which the Adversary subagent must read; the engine writes it again below: dispatch the Adversary again on it/);
  assert.match(f.read(`${FINAL}/package.md`), /^# final gate for PROJ-1/);
  assert.match(await ok(f, 'record', KEY, 'gate', 'agent-reviewer'), /step: settle/);
});

test("the gates' Adversary is pinned at admission: a record whose environment gives another route is refused", async () => {
  const f = fixture();
  const sent = [];
  keyed(f, sent);
  await walk(f, 'gate');
  const env = f.ctx.env;
  f.ctx.env = {};
  refused(await f.engine('record', KEY, 'gate'), /the gates' Adversary is vendor\/model-x over OpenRouter, as the run was admitted, but this record's environment gives a Claude subagent \(no OpenRouter key in the environment\); record the gate in the environment the run was admitted in, or stop the run/);
  assert.equal(sent.length, 0, 'no request is sent');
  f.ctx.env = env;
  assert.match(await ok(f, 'record', KEY, 'gate'), /step: red/);
  assert.deepEqual(f.runState().rounds, [{ at: 'gates/plan-c1-r1', gate: 'plan', cycle: 1, round: 1, adversary: 'vendor/model-x over OpenRouter, through P' }]);
});

test('a keyed gate sends one zero-data-retention request and never logs the key', async () => {
  const f = fixture();
  const sent = [];
  f.ctx.env = { OPENROUTER_API_KEY: 'sk-or-test-secret' };
  f.ctx.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), signal: init.signal });
    return { ok: true, json: async () => ({ provider: 'SomeProvider', model: 'vendor/model-x', choices: [{ message: { content: '{"findings":[]}' } }] }) };
  };
  f.ctx.models = createModels({ ...MODEL_TABLE, adversary: 'vendor/model-x' });
  await walk(f, 'gate');
  const out = await f.engine('record', KEY, 'gate');
  assert.equal(out.code, 0, out.text);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.deepEqual(sent[0].body.provider, { zdr: true, require_parameters: true });
  assert.ok(sent[0].signal instanceof AbortSignal, 'the request carries a timeout');
  assert.match(sent[0].body.messages[1].content, /## Design: docs\/prs\/PROJ-1\/blueprint\.md\n---\nkey: PROJ-1/);
  assert.match(sent[0].body.messages[0].content, /Each finding cites the repository file and line it is about,\nas the package's headings name the files, never a line of the package itself\./);
  const log = f.read(`docs/prs/${KEY}/foreman/calibration.log`);
  assert.match(log, /gate=plan cycle=1 round=1 reviewer=openrouter model=vendor\/model-x provider=SomeProvider findings=0/);
  assert.doesNotMatch(log + out.text, /sk-or-test-secret/);
});

test("the Adversary's model and its zero data retention come from the harness's settings, pinned at admission, defaulting to the strongest GPT model and on", async () => {
  assert.equal(createModels().pick('adversary'), 'openai/gpt-6-astra');
  const f = fixture({ foreman: { adversary: { model: 'cheap/model', zeroDataRetention: false }, models: { reviewer: 'claude-x' } } });
  const bodies = [];
  f.ctx.env = { OPENROUTER_API_KEY: 'sk-or-test-secret' };
  f.ctx.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ provider: 'P', model: 'cheap/model', choices: [{ message: { content: '{"findings":[]}' } }] }) };
  };
  await walk(f, 'gate');
  assert.deepEqual(f.runState().adversary, { keyed: true, model: 'cheap/model', zdr: false });
  assert.equal(f.runState().models.reviewer, 'claude-x');
  // A table the context gives later chooses nothing: the run's is pinned.
  f.ctx.models = createModels({ ...MODEL_TABLE, adversary: 'other/model' });
  assert.equal((await f.engine('record', KEY, 'gate')).code, 0);
  assert.deepEqual(bodies.map((b) => [b.model, b.provider]), [['cheap/model', { require_parameters: true }]]);
});

test('a keyed gate that fails falls back to a Claude adversary', async () => {
  const f = fixture();
  f.ctx.env = { OPENROUTER_API_KEY: 'sk-or-test-secret' };
  f.ctx.fetch = async () => ({ ok: false, status: 503 });
  f.ctx.models = createModels({ ...MODEL_TABLE, adversary: 'vendor/model-x' });
  await walk(f, 'gate');
  const text = refused(await f.engine('record', KEY, 'gate'), /OpenRouter answered 503/);
  assert.match(text, /runs as a Claude subagent[\s\S]*Write its findings, the "findings" list alone, to docs\/prs\/PROJ-1\/foreman\/gates\/plan-c1-r1\/findings\.json as \[ \{ "file"/);
  assert.doesNotMatch(text, /sk-or-test-secret/);
  assert.match(f.read(`docs/prs/${KEY}/foreman/calibration.log`), /^gate=plan cycle=1 round=1 reviewer=openrouter model=vendor\/model-x provider=- findings=- outcome=failed$/m, 'the failed request is logged');
  // The Adversary answers in an object, but the session writes findings in their one form, a list.
  f.write(`docs/prs/${KEY}/foreman/gates/plan-c1-r1/findings.json`, '{ "findings": [] }');
  refused(await f.engine('record', KEY, 'gate'), /the plan gate's findings must be a list, possibly empty/);
  f.write(`docs/prs/${KEY}/foreman/gates/plan-c1-r1/findings.json`, '[]');
  assert.match((await f.engine('record', KEY, 'gate')).text, /step: red/);
});

test('a keyed gate whose findings cite no place falls back to a Claude adversary', async () => {
  const f = fixture();
  f.ctx.env = { OPENROUTER_API_KEY: 'sk-or-test-secret' };
  f.ctx.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"findings":[{"claim":"vague"}]}' } }] }) });
  f.ctx.models = createModels({ ...MODEL_TABLE, adversary: 'vendor/model-x' });
  await walk(f, 'gate');
  const text = refused(await f.engine('record', KEY, 'gate'), /must cite a file and a line .*\); the gate falls back to a Claude subagent/);
  assert.match(text, /runs as a Claude subagent \(the OpenRouter request failed: its answer: finding 1 must cite a file and a line/);
});

test('the keyed probe sends one synthetic request and prints its calibration line', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ provider: 'SomeProvider', model: 'vendor/model-x', choices: [{ message: { content: '{"findings":[{"file":"src/greet.mjs","line":1,"claim":"no test for an empty name"}]}' } }] }) };
  };
  const ctx = { root: os.tmpdir(), env: { OPENROUTER_API_KEY: 'sk-or-test-secret' }, fetch: fetchImpl, git: {} };
  const out = await run(['probe-adversary', 'vendor/model-x'], ctx);
  assert.equal(out.code, 0, out.text);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].provider, { zdr: true, require_parameters: true });
  assert.match(bodies[0].messages[1].content, /synthetic probe/);
  assert.match(out.text, /reviewer=openrouter model=vendor\/model-x provider=SomeProvider findings=1/);
  assert.doesNotMatch(out.text, /sk-or-test-secret/);
  refused(await run(['probe-adversary'], { ...ctx, env: {} }), /no OpenRouter key/);
  const failed = refused(await run(['probe-adversary', 'vendor/model-x'], { ...ctx, fetch: async () => ({ ok: false, status: 503 }) }), /keyed probe failed: OpenRouter answered 503/);
  assert.match(failed, /reviewer=openrouter model=vendor\/model-x provider=- findings=- outcome=failed/);
});

// An OpenRouter answer whose message holds `content`.
const answering = (content) => async () => ({ ok: true, json: async () => ({ provider: 'P', model: 'vendor/model-x', choices: [{ message: { content } }] }) });

test('an Adversary request demands JSON within ten minutes, and whatever goes wrong is an error the gate falls back on, never a throw', async () => {
  const ask = (fetchImpl) => askAdversary({ fetchImpl, env: { OPENROUTER_API_KEY: 'sk-or-test-secret' }, model: 'vendor/model-x', packageText: 'a package' });
  const timeout = AbortSignal.timeout;
  const limits = [];
  let body;
  AbortSignal.timeout = (ms) => (limits.push(ms), timeout.call(AbortSignal, ms));
  try {
    const answered = await ask(async (url, init) => ((body = JSON.parse(init.body)), answering('{"findings":[]}')()));
    assert.deepEqual(answered, { findings: [], provider: 'P', model: 'vendor/model-x' });
  } finally {
    AbortSignal.timeout = timeout;
  }
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(limits, [10 * 60 * 1000]);
  for (const [fetchImpl, error] of [
    [async () => { throw new Error('socket hang up'); }, 'the request failed: socket hang up'],
    [async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } }), 'OpenRouter answered with something other than JSON'],
    [answering('No findings, the change looks right.'), 'the Adversary did not answer with JSON findings'],
    [answering('{"issues":[]}'), 'the Adversary answer has no "findings" list'],
  ]) {
    assert.deepEqual(await ask(fetchImpl), { error }, error);
  }
});

// The plan with its one slice's outcome amended, as a fix to a plan finding amends it.
const AMENDED = { slices: [{ ...SLICE, outcome: `${SLICE.outcome}, an empty name included` }] };

test('a fixed plan finding is fixed in the plan, sends the gate to its confirming round, which fixes nothing more, and reaches the description', async () => {
  const f = fixture();
  await walk(f, 'gate');
  const first = `docs/prs/${KEY}/foreman/gates/plan-c1-r1`;
  f.write(`${first}/findings.json`, JSON.stringify([{ file: 'plan.json', line: 1, claim: 'no edge case' }]));
  assert.match((await f.engine('record', KEY, 'gate')).text, /step: gate-dispositions[\s\S]*hand off a finding against the design itself/);
  commitRun(f);
  f.write(`${first}/dispositions.json`, JSON.stringify([{ finding: 1, disposition: 'fixed' }]));
  // Marked fixed with the plan as the gate attacked it, nothing was fixed, whatever order its keys take.
  refused(await f.engine('record', KEY, 'dispositions'), /a plan finding marked fixed is fixed in docs\/prs\/PROJ-1\/foreman\/plan\.json, and it is the plan the gate attacked, unchanged/);
  f.write(`docs/prs/${KEY}/foreman/plan.json`, JSON.stringify({ slices: [Object.fromEntries(Object.entries(SLICE).reverse())] }));
  refused(await f.engine('record', KEY, 'dispositions'), /it is the plan the gate attacked, unchanged/);
  f.write(`docs/prs/${KEY}/foreman/plan.json`, JSON.stringify(AMENDED));
  assert.match((await f.engine('record', KEY, 'dispositions')).text, /plan-c1-r2/);
  commitRun(f);
  assert.equal(f.runState().plan.slices[0].outcome, AMENDED.slices[0].outcome);
  const second = `docs/prs/${KEY}/foreman/gates/plan-c1-r2`;
  // The confirming round's package holds what round 1 found and what became of each.
  const previous = [{ file: 'plan.json', line: 1, claim: 'no edge case', source: 'adversary', disposition: 'fixed' }];
  assert.ok(f.read(`${second}/package.md`).endsWith(`## Round 1's findings and their dispositions\n\`\`\`json\n${JSON.stringify(previous, null, 2)}\n\`\`\`\n`), f.read(`${second}/package.md`));
  f.write(`${second}/findings.json`, JSON.stringify([{ file: 'plan.json', line: 1, claim: 'still no edge case' }]));
  await f.engine('record', KEY, 'gate');
  commitRun(f);
  f.write(`${second}/dispositions.json`, JSON.stringify([{ finding: 1, disposition: 'fixed' }]));
  refused(await f.engine('record', KEY, 'dispositions'), /the confirming round fixes nothing/);
  f.write(`${second}/dispositions.json`, JSON.stringify([{ finding: 1, disposition: 'handed-off' }]));
  assert.match((await f.engine('record', KEY, 'dispositions')).text, /step: red/);
  commitRun(f);
  assert.deepEqual(f.runState().handedOff, [{ at: 'gates/plan-c1-r2', cycle: 1, finding: 1, file: 'plan.json', line: 1, claim: 'still no edge case', source: 'adversary' }], 'the run state keeps it for the pull request');
  assert.deepEqual(f.runState().fixed, [{ at: 'gates/plan-c1-r1', cycle: 1, finding: 1, file: 'plan.json', line: 1, claim: 'no edge case', source: 'adversary' }], 'and what was fixed, for a reviewer to check');
  await settled(f, { slices: AMENDED.slices });
  assert.match(f.read(`docs/prs/${KEY}/pull-request.md`), /## Gates\n\n- plan gate, cycle 1, round 1: its Adversary was a Claude subagent, claude-opus-5-5 \(no OpenRouter key in the environment\)\n {2}- fixed #1, plan\.json:1: no edge case\n- plan gate, cycle 1, round 2: [^\n]+\n- final gate, cycle 1, round 1: [^\n]+\n\n## Handed-off findings\n\n- gates\/plan-c1-r2 #1, plan\.json:1: still no edge case\n/);
});

test('a record refused after its dispositions are settled logs nothing, so the one accepted logs each finding once', async () => {
  const f = fixture();
  await walk(f, 'gate');
  const at = `docs/prs/${KEY}/foreman/gates/plan-c1-r1`;
  f.write(`${at}/findings.json`, JSON.stringify([{ file: 'plan.json', line: 1, claim: 'no edge case' }]));
  await ok(f, 'record', KEY, 'gate');
  f.write(`${at}/dispositions.json`, JSON.stringify([{ finding: 1, disposition: 'fixed' }]));
  // A fix that empties the plan is refused by the plan's own check, which comes after the settling.
  const plan = f.read(`docs/prs/${KEY}/foreman/plan.json`);
  f.write(`docs/prs/${KEY}/foreman/plan.json`, JSON.stringify({ slices: [] }));
  refused(await f.engine('record', KEY, 'dispositions'), /plan\.json needs a non-empty "slices" list/);
  f.write(`docs/prs/${KEY}/foreman/plan.json`, plan);
  refused(await f.engine('record', KEY, 'dispositions'), /it is the plan the gate attacked, unchanged/);
  f.write(`docs/prs/${KEY}/foreman/plan.json`, JSON.stringify(AMENDED));
  assert.match(await ok(f, 'record', KEY, 'dispositions'), /plan-c1-r2/);
  assert.equal(f.read(`docs/prs/${KEY}/foreman/calibration.log`).match(/^finding=1 gate=plan cycle=1 round=1 .* disposition=fixed$/gm)?.length, 1);
});
