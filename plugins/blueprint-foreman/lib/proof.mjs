// A slice's proof: running its suite over its test files and reading the report. The engine composes
// the command from the suite the adapters declare, runs it itself and reads the report it wrote, as
// Jest's JSON or as JUnit XML, because a subagent's account of a test run is exactly what the rigor
// rules refuse to trust. Every command the engine runs, suites, installs and extractors alike, runs in
// a POSIX shell under a supervisor that kills everything it started once it ends or its time is up.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { GAP_MARKER } from './config.mjs';
import { quote } from './git.mjs';

// An assertion failure, as opposed to a test that crashed on the way to one: Jest's, Node's and
// Chai's, and supertest's `expected 200 "OK", got 500`, read without the terminal's colour codes. A
// test that fails on a scaffold gap still open fails for want of the code, which is a red too.
const ASSERTION = /(^|\n)\s*(Error: )?(expect\(|AssertionError|[Ee]xpected[: ])/;
const COLOUR = /\x1b\[[0-9;]*m/g;
const onAssertion = (message) => {
  const plain = message.replace(COLOUR, '');
  return ASSERTION.test(plain) || plain.includes(GAP_MARKER);
};
const firstLine = (text) => (text ?? '').replace(COLOUR, '').trim().split('\n')[0];

// The supervisor, a Node process of its own for each command: it starts the command in a POSIX shell,
// in a process group of its own, keeps the end of its output, and kills the group when the command
// exits or its time is up, so nothing the command started (a dev server, a watcher) outlives it or
// holds the run open. Windows has no process groups: there `taskkill /T` kills the command's tree at
// the timeout, and what is left when the supervisor exits dies with the job Node keeps its children
// in. It prints the output, then its verdict as the last line on stderr: { code, signal }, { timedOut }
// or { error }.
const SUPERVISOR = `
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const [ms, command] = process.argv.slice(1);
const windows = process.platform === 'win32';
const child = spawn('sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'], detached: !windows, windowsHide: true });
let tail = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', (d) => { tail = (tail + d).slice(-16384); });
}
const kill = () => {
  try {
    if (windows) spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {}
};
const finish = (verdict) => {
  fs.writeSync(1, tail);
  fs.writeSync(2, JSON.stringify(verdict));
  process.exit(0);
};
const timer = setTimeout(() => { kill(); finish({ timedOut: true }); }, Number(ms));
child.on('error', (e) => finish({ error: e.message }));
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (!windows) kill();
  setTimeout(() => finish({ code, signal }), 2000);
});
child.on('close', (code, signal) => finish({ code, signal }));
`;
// How long past its own timeout the supervisor itself may take before it is killed.
const BACKSTOP_MS = 60 * 1000;

// Runs a shell command with extra environment, keeping the last lines of its output.
export function runCommand({ cwd, command, timeoutMs, env = {} }) {
  const result = spawnSync(process.execPath, ['-e', SUPERVISOR, '--', String(timeoutMs), command], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: timeoutMs + BACKSTOP_MS,
    killSignal: 'SIGKILL',
    windowsHide: true,
  });
  let verdict;
  try {
    verdict = JSON.parse(result.stderr.trim().split('\n').at(-1));
  } catch {
    verdict = { error: result.error?.message ?? result.stderr };
  }
  const tail = `${result.stdout ?? ''}${verdict.error ? `\n${verdict.error}` : ''}`.split('\n').slice(-20).join('\n');
  return { exitCode: verdict.code ?? null, timedOut: Boolean(verdict.timedOut) || result.error?.code === 'ETIMEDOUT', tail };
}

// The suite's command and environment for `files`, repository-relative and under the suite's cwd:
// {files} becomes the files, each relative to the cwd and quoted for a POSIX shell, and {report}
// becomes `report`, quoted in the command and as it is in an env value. One pass replaces both, so a
// path that holds either placeholder stays as it is.
export function composeSuite(suite, files, report) {
  const words = files.map((f) => quote(suite.cwd ? f.slice(suite.cwd.length + 1) || '.' : f)).join(' ');
  return {
    command: suite.command.replace(/\{files\}|\{report\}/g, (m) => (m === '{files}' ? words : quote(report))),
    env: Object.fromEntries(Object.entries(suite.env ?? {}).map(([name, value]) => [name, value.replaceAll('{report}', report)])),
  };
}

// The suite's run over `files` as a brief shows it, {report} left for the reader to choose.
export function shownRun(suite, files) {
  const { command, env } = composeSuite(suite, files, '{report}');
  const vars = Object.entries(env).map(([name, value]) => `, with ${name}=${value}`).join('');
  return `${command} (from ${suite.cwd ?? 'the repository root'}${vars}; {report} is any path)`;
}

// Runs `suite` over `files` in the checkout `root`, from the suite's cwd with its env added under the
// engine's `env`, bounded by the suite's timeout in seconds or `timeoutMs`, and reads the report it
// wrote. `why` says why a run cannot be judged before its report is read.
export function runSuite({ root, suite, files, timeoutMs, env = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-foreman-report-'));
  const report = path.join(dir, suite.report === 'junit' ? 'report.xml' : 'report.json');
  const composed = composeSuite(suite, files, report);
  const limit = suite.timeout ? suite.timeout * 1000 : timeoutMs;
  const result = runCommand({ cwd: path.join(root, suite.cwd ?? ''), command: composed.command, timeoutMs: limit, env: { ...composed.env, ...env } });
  let text = null;
  try {
    text = fs.readFileSync(report, 'utf8');
  } catch {
    text = null;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  const read = text === null ? null : readReport(suite.report, text);
  const why = result.timedOut
    ? `the suite timed out after ${limit / 1000} s`
    : read
      ? null
      : `the suite wrote no readable ${suite.report} report (exit ${result.exitCode}); last output:\n${result.tail}`;
  return { ...result, report: read, why };
}

// A report as the judges read it, whatever its format: every test, { name, status, assertion,
// message }, its status passed, failed or skipped, and for a failure whether it failed on an assertion
// and the first line of why; and `broken`, why a file failed to load or collect. Null when the text is
// no report of its format, whatever a reader trips on.
export function readReport(format, text) {
  try {
    return format === 'junit' ? readJunit(text) : readJest(text);
  } catch {
    return null;
  }
}

// Jest's --json report, which Vitest's json reporter also writes. A test's full name is its fullName:
// the describe titles and its own, joined by spaces, and its file its test file's name. A failed test
// failed on an assertion when one of its failure messages does; any status but passed and failed is a
// skip. A file failed to load or collect when it failed holding no test, or the run counts a runtime
// error outside every test.
function readJest(text) {
  const report = JSON.parse(text);
  const tests = report.testResults.flatMap((file) =>
    (file.assertionResults ?? []).map((a) => {
      const name = a.fullName ?? a.title;
      const at = typeof file.name === 'string' ? { file: file.name } : {};
      if (a.status === 'passed') return { name, status: 'passed', ...at };
      if (a.status !== 'failed') return { name, status: 'skipped', ...at };
      const messages = a.failureMessages ?? [];
      return { name, status: 'failed', assertion: messages.some(onAssertion), message: firstLine(messages[0]), ...at };
    }),
  );
  const broken = report.testResults.filter((f) => f.status === 'failed' && (f.assertionResults ?? []).length === 0).map((f) => `${f.name} failed to load or collect: ${firstLine(f.message)}`);
  if ((report.numRuntimeErrorTestSuites ?? 0) > 0 && broken.length === 0) broken.push('a test suite hit a runtime error outside its tests');
  return { tests, broken };
}

// JUnit XML, as Playwright, pytest and most runners write it: a <testsuites> or <testsuite> root,
// suites within suites, and <testcase> elements within them.
// - A test's full name is its testcase's classname and name, joined by one space, or its name alone
//   where classname is absent or empty; the suites around it are not part of it. Playwright's reads
//   "<file> <describe> › <title>", pytest's "<module>.<Class> <function>". Its file is its `file`
//   attribute, else the nearest suite's around it, where either has one.
// - A testcase holding <error> crashed: it failed, never on an assertion, so it is never red, unless
//   it crashed on a scaffold gap still open, which fails for want of the code as any runner reports
//   it (reporters in Java's style file every exception that is not an assertion as an error). One
//   holding <failure> failed, on an assertion when the assertion test holds of a failure's message
//   and text. One holding <skipped> was skipped. Any other passed.
// - A suite failed to load or collect when it holds an <error> or <failure> of its own, or when it
//   holds no testcase and no suite yet counts errors or failures.
function readJunit(text) {
  const root = parseXml(text);
  if (!root || !['testsuites', 'testsuite'].includes(root.name)) return null;
  const tests = [];
  const broken = [];
  const messageOf = (el) => firstLine(el.attrs.message || el.text);
  const visit = (suite, file) => {
    const held = suite.children.filter((c) => ['testsuites', 'testsuite', 'testcase'].includes(c.name));
    for (const c of held) {
      if (c.name === 'testcase') tests.push(testcase(c, messageOf, c.attrs.file ?? suite.attrs.file ?? file));
      else visit(c, suite.attrs.file ?? file);
    }
    const own = suite.children.find((c) => c.name === 'error' || c.name === 'failure');
    const counts = Number(suite.attrs.errors ?? 0) + Number(suite.attrs.failures ?? 0);
    if (own || (held.length === 0 && counts > 0)) {
      const why = own ? messageOf(own) : firstLine(suite.children.find((c) => c.name === 'system-err')?.text);
      broken.push(`${suite.attrs.name ?? suite.name} failed to load or collect${why ? `: ${why}` : ''}`);
    }
  };
  visit(root);
  return { tests, broken };
}

function testcase(el, messageOf, file) {
  const name = el.attrs.classname ? `${el.attrs.classname} ${el.attrs.name ?? ''}` : (el.attrs.name ?? '');
  const at = file ? { file } : {};
  const error = el.children.find((c) => c.name === 'error');
  if (error) return { name, status: 'failed', assertion: `${error.attrs.message ?? ''}
${error.text}`.includes(GAP_MARKER), message: messageOf(error), ...at };
  const failures = el.children.filter((c) => c.name === 'failure');
  if (failures.length) return { name, status: 'failed', assertion: failures.some((f) => onAssertion(`${f.attrs.message ?? ''}\n${f.text}`)), message: messageOf(failures[0]), ...at };
  return { name, status: el.children.some((c) => c.name === 'skipped') ? 'skipped' : 'passed', ...at };
}

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (e, n) => (n[0] === '#' ? String.fromCodePoint(n[1] === 'x' ? parseInt(n.slice(2), 16) : Number(n.slice(1))) : (ENTITIES[n] ?? e)));
// What XML holds, a report needs: comments, declarations and doctypes, CDATA, closing tags, opening
// tags with quoted attributes, and text.
const XML_TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/y;
const XML_ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

// A document's root element as { name, attrs, children, text }, or null when the text is not
// well-formed as far as a report needs: every element closed, in order.
function parseXml(text) {
  const top = { children: [], text: '' };
  const open = [top];
  XML_TOKEN.lastIndex = 0;
  while (XML_TOKEN.lastIndex < text.length) {
    const m = XML_TOKEN.exec(text);
    if (!m) return null;
    const [, cdata, close, name, attributes, empty, chars] = m;
    const at = open.at(-1);
    if (cdata !== undefined) at.text += cdata;
    else if (chars !== undefined) at.text += decode(chars);
    else if (close !== undefined) {
      if (at.name !== close) return null;
      open.pop();
    } else if (name !== undefined) {
      const attrs = Object.fromEntries([...attributes.matchAll(XML_ATTRIBUTE)].map(([, k, a, b]) => [k, decode(a ?? b)]));
      const el = { name, attrs, children: [], text: '' };
      at.children.push(el);
      if (!empty) open.push(el);
    }
  }
  return open.length === 1 && top.children.length === 1 ? top.children[0] : null;
}

// Reasons the run cannot be judged at all: a failed install or timeout, no report, or a file that
// failed to load.
function unjudgeable(run) {
  if (run.why) return [run.why];
  return [...run.report.broken];
}

// Every test in the report by a name: a name matches each test so named, as a suite run in several
// projects names one test once for each.
const named = (tests, name) => tests.filter((t) => t.name === name);
const unique = (reasons) => [...new Set(reasons)];

// Red: every named test fails on an assertion, and nothing else fails.
export function judgeRed(run, expectFail) {
  const reasons = unjudgeable(run);
  if (reasons.length) return reasons;
  const all = run.report.tests;
  for (const name of expectFail) {
    const found = named(all, name);
    if (!found.length) reasons.push(`the report has no test named "${name}"`);
    for (const t of found) {
      if (t.status !== 'failed') reasons.push(`"${name}" did not fail (${t.status})`);
      else if (!t.assertion) reasons.push(`"${name}" failed, but not on an assertion: ${t.message}`);
    }
  }
  for (const t of all) {
    if (t.status === 'failed' && !expectFail.includes(t.name)) reasons.push(`"${t.name}" also fails, but is not named to fail at red`);
  }
  return unique(reasons);
}

// Green: the report is judgeable, ran some test, and every test in it passed, the named ones among
// them.
export function judgeGreen(run, expectFail = []) {
  const reasons = unjudgeable(run);
  if (reasons.length) return reasons;
  const all = run.report.tests;
  if (!all.some((t) => t.status !== 'skipped')) return ['the suite ran no tests'];
  for (const t of all) if (t.status === 'failed') reasons.push(`"${t.name}" fails`);
  for (const name of expectFail) {
    const found = named(all, name);
    if (!found.length) reasons.push(`the report has no test named "${name}"`);
    for (const t of found) if (t.status !== 'passed') reasons.push(`"${name}" did not pass (${t.status})`);
  }
  return unique(reasons);
}

// The tests a run passed, by name: what a landed slice must go on passing.
export function passedNames(run) {
  return run.report ? unique(run.report.tests.filter((t) => t.status === 'passed').map((t) => t.name)) : [];
}

// Still green: every named test is in the report and passes, whatever else the report holds.
export function judgeStill(run, names) {
  const reasons = unjudgeable(run);
  if (reasons.length) return reasons;
  return unique(
    names.flatMap((name) => {
      const found = named(run.report.tests, name);
      if (!found.length) return [`the report has no test named "${name}"`];
      return found.filter((t) => t.status !== 'passed').map((t) => `"${name}" no longer passes (${t.status})`);
    }),
  );
}

// Killed: some test fails on the mutant. A report that cannot be judged does not count as a kill.
export function judgeKilled(run) {
  const reasons = unjudgeable(run);
  if (reasons.length) return { killed: false, unjudgeable: true, reasons };
  const failed = run.report.tests.filter((t) => t.status === 'failed');
  return failed.length ? { killed: true, reasons: [] } : { killed: false, reasons: ['every test passed with the mutant in place'] };
}
