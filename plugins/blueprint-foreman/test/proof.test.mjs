// Offline tests for the proof: `node --test plugins/blueprint-foreman/test/proof.test.mjs`. A suite's command
// is composed and run for real, in a temporary directory, under the supervisor that kills what it
// started; the jest and junit readers are fed reports in the shapes Jest, Vitest, Playwright and
// pytest write, and every judge reads both alike. Nothing here needs git.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { scratchDir } from './fixture.mjs';
import { composeSuite, judgeGreen, judgeKilled, judgeRed, judgeStill, passedNames, readReport, runCommand, runSuite } from '../lib/proof.mjs';

const scratch = () => scratchDir('blueprint-foreman-proof-');

function write(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}

// A run as the judges take it: a report of `format` read from `text`.
const reported = (format, text) => ({ report: readReport(format, text), why: null });

// A Jest report holding one file's tests, each [fullName, status, failureMessages?].
const jest = (...tests) => JSON.stringify({ numRuntimeErrorTestSuites: 0, testResults: [{ name: '/repo/test/a.test.ts', status: 'failed', assertionResults: tests.map(([fullName, status, failureMessages = []]) => ({ fullName, status, failureMessages })) }] });

// A JUnit report around `cases`, the testcase elements, in one suite.
const junit = (cases, suite = 'greet.spec.ts') => `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n<testsuite name="${suite}" tests="3">\n${cases}\n</testsuite>\n</testsuites>\n`;

// Reports the arguments, the directory and the environment it ran with as the names of passing tests,
// in Jest's shape, where $OUT says.
const ECHO = `import fs from 'node:fs';
import path from 'node:path';
const seen = { argv: process.argv.slice(2), cwd: path.basename(process.cwd()), mode: process.env.MODE, exhibits: process.env.BLUEPRINT_FOREMAN_EXHIBITS };
fs.writeFileSync(process.env.OUT, JSON.stringify({ testResults: [{ name: 'echo', status: 'passed', assertionResults: [{ fullName: JSON.stringify(seen), status: 'passed' }] }] }));
`;

test('a suite composes its command: each file relative to its cwd and quoted, the report in one pass', () => {
  const files = ['test/a b.test.ts', "test/it's.test.ts", 'test/$(touch pwned).test.ts'];
  assert.deepEqual(composeSuite({ command: 'jest --json --outputFile {report} --runTestsByPath {files}', report: 'jest' }, files, '/tmp/r 1/report.json'), {
    command: "jest --json --outputFile '/tmp/r 1/report.json' --runTestsByPath 'test/a b.test.ts' 'test/it'\\''s.test.ts' 'test/$(touch pwned).test.ts'",
    env: {},
  });
  const e2e = { command: 'playwright test --reporter=junit {files}', cwd: 'services/e2e', env: { OUT: '{report}', CI: '1' }, report: 'junit' };
  assert.deepEqual(composeSuite(e2e, ['services/e2e/tests/a.spec.ts', 'services/e2e'], '/tmp/report.xml'), { command: "playwright test --reporter=junit 'tests/a.spec.ts' '.'", env: { OUT: '/tmp/report.xml', CI: '1' } });
  // A path holding a placeholder is a path, not a placeholder.
  assert.equal(composeSuite({ command: 'run {files} > {report}', report: 'jest' }, ['test/{report}.ts'], '/r').command, "run 'test/{report}.ts' > '/r'");
});

test('a suite runs from its cwd, with its env under the engine\'s and both over what it inherits, and each file reaches it as one word', () => {
  const root = scratch();
  write(root, { 'web/echo.mjs': ECHO });
  const suite = { command: 'node echo.mjs {files}', cwd: 'web', env: { OUT: '{report}', MODE: 'suite', BLUEPRINT_FOREMAN_EXHIBITS: 'the suite\'s' }, report: 'jest' };
  const files = ["web/tests/it's a test.mjs", 'web/{report}.mjs', 'web/$(touch pwned).mjs'];
  const inherited = { MODE: process.env.MODE, BLUEPRINT_FOREMAN_EXHIBITS: process.env.BLUEPRINT_FOREMAN_EXHIBITS };
  Object.assign(process.env, { MODE: 'inherited', BLUEPRINT_FOREMAN_EXHIBITS: 'inherited' });
  let run;
  try {
    run = runSuite({ root, suite, files, timeoutMs: 60_000, env: { BLUEPRINT_FOREMAN_EXHIBITS: "the engine's" } });
  } finally {
    for (const [name, value] of Object.entries(inherited)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.equal(run.why, null, run.tail);
  assert.deepEqual(JSON.parse(passedNames(run)[0]), { argv: ["tests/it's a test.mjs", '{report}.mjs', '$(touch pwned).mjs'], cwd: 'web', mode: 'suite', exhibits: "the engine's" });
  assert.equal(fs.existsSync(path.join(root, 'web', 'pwned')), false);
  const quiet = runSuite({ root, suite: { ...suite, command: 'node -e "process.exit(2)" {files}' }, files, timeoutMs: 60_000 });
  assert.match(judgeGreen(quiet).join('\n'), /^the suite wrote no readable jest report \(exit 2\); last output:/);
});

test("a suite's own timeout, in seconds, bounds its run in place of the default", () => {
  const root = scratch();
  const started = Date.now();
  const run = runSuite({ root, suite: { command: 'node -e "setTimeout(() => {}, 20000)" {files} {report}', timeout: 1, report: 'junit' }, files: ['a'], timeoutMs: 60_000 });
  assert.deepEqual(judgeRed(run, ['x']), ['the suite timed out after 1 s']);
  assert.ok(Date.now() - started < 15_000, `took ${Date.now() - started} ms`);
});

// Whether a process still runs. A zombie, killed but not yet reaped where nothing reaps orphans, does
// not.
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch (e) {
    return e.code === 'EPERM';
  }
  try {
    return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return true;
  }
}

async function gone(pid) {
  for (let i = 0; i < 50 && alive(pid); i += 1) await sleep(100);
  return !alive(pid);
}

// Starts a grandchild that runs for `ms`, its output the command's own, writes its pid, and then waits
// forever, or exits 3 when `leave` is set.
const PARENT = (ms, leave) => `import { spawn } from 'node:child_process';
import fs from 'node:fs';
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${ms})'], { stdio: 'inherit' });
fs.writeFileSync('grandchild.pid', String(child.pid));
${leave ? 'process.exit(3);' : 'setInterval(() => {}, 1000);'}
`;

test('a timeout kills the command with every process it started', async () => {
  const dir = scratch();
  write(dir, { 'parent.mjs': PARENT(120_000, false) });
  const started = Date.now();
  const result = runCommand({ cwd: dir, command: 'node parent.mjs', timeoutMs: 2000 });
  const pid = Number(fs.readFileSync(path.join(dir, 'grandchild.pid'), 'utf8'));
  try {
    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - started < 15_000, `took ${Date.now() - started} ms`);
    assert.ok(await gone(pid), `the grandchild ${pid} outlived the timeout`);
  } finally {
    if (alive(pid)) process.kill(pid);
  }
});

test('a command that ends leaving a process behind neither holds the run open nor leaves it running', async () => {
  const dir = scratch();
  write(dir, { 'parent.mjs': PARENT(30_000, true) });
  const started = Date.now();
  const result = runCommand({ cwd: dir, command: 'node parent.mjs', timeoutMs: 60_000 });
  const pid = Number(fs.readFileSync(path.join(dir, 'grandchild.pid'), 'utf8'));
  try {
    assert.deepEqual([result.exitCode, result.timedOut], [3, false]);
    assert.ok(Date.now() - started < 15_000, `took ${Date.now() - started} ms`);
    assert.ok(await gone(pid), `the grandchild ${pid} outlived the command`);
  } finally {
    if (alive(pid)) process.kill(pid);
  }
});

test('a red may fail on an open scaffold gap, and assertions are read in their common forms, in both formats', () => {
  const messages = [
    "Error: TODO(scaffold): decide PauseCampaign\n    at Object.pause (src/campaign.ts:12:11)",
    'Error: expected 200 "OK", got 500 "Internal Server Error"',
    '\x1b[2mexpect(\x1b[22m\x1b[31mreceived\x1b[39m\x1b[2m).\x1b[22mtoEqual\x1b[2m(\x1b[22m\x1b[32mexpected\x1b[39m\x1b[2m)\x1b[22m',
    "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
  ];
  const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;').replaceAll('\x1b', '&#27;');
  for (const message of messages) {
    assert.deepEqual(judgeRed(reported('jest', jest(['x', 'failed', [message]])), ['x']), [], message);
    // Playwright puts the place in the message and the error in the text; pytest the error in both.
    assert.deepEqual(judgeRed(reported('junit', junit(`<testcase name="x"><failure message="a.spec.ts:3:5 x">${escape(message)}</failure></testcase>`)), ['x']), [], message);
  }
  // An assertion's words count only where a line of the message opens with them.
  for (const crash of ["TypeError: Cannot read properties of undefined (reading 'id')", "SyntaxError: Unexpected token '<'"]) {
    const why = new RegExp(`"x" failed, but not on an assertion: ${crash.split(':')[0]}`);
    assert.match(judgeRed(reported('jest', jest(['x', 'failed', [crash]])), ['x']).join('\n'), why);
    assert.match(judgeRed(reported('junit', junit(`<testcase name="x"><failure message="${escape(crash)}"/></testcase>`)), ['x']).join('\n'), why);
  }
});

test("a jest test's full name is its fullName, its title only where it has none", () => {
  const titled = JSON.stringify({ testResults: [{ name: '/repo/test/a.test.ts', status: 'passed', assertionResults: [{ fullName: 'Greeting names the person', title: 'names the person', status: 'passed' }, { title: 'waves', status: 'passed' }] }] });
  assert.deepEqual(passedNames(reported('jest', titled)), ['Greeting names the person', 'waves']);
});

test("a test's file is its jest test file, or its junit testcase's file, else its nearest suite's", () => {
  const jestFiled = JSON.stringify({ testResults: [{ name: '/repo/test/a.test.ts', status: 'failed', assertionResults: [{ fullName: 'x', status: 'passed' }, { fullName: 'y', status: 'failed', failureMessages: ['Error: expect(received)'] }] }] });
  assert.deepEqual(readReport('jest', jestFiled).tests.map((t) => t.file), ['/repo/test/a.test.ts', '/repo/test/a.test.ts']);
  const filed = '<testsuites><testsuite name="s" file="e2e/a.spec.ts"><testsuite name="inner"><testcase name="x"/><testcase name="y" file="e2e/b.spec.ts"><failure message="m"/></testcase></testsuite></testsuite><testsuite name="t"><testcase name="z"/></testsuite></testsuites>';
  assert.deepEqual(readReport('junit', filed).tests.map((t) => t.file), ['e2e/a.spec.ts', 'e2e/b.spec.ts', undefined]);
});

test('each judge names what it finds wanting: a test it names missing, another failing, or a run it cannot judge', () => {
  const failing = ['Error: expect(received).toBe(expected)'];
  assert.deepEqual(judgeRed(reported('jest', jest(['x', 'failed', failing], ['y', 'failed', failing])), ['x']), ['"y" also fails, but is not named to fail at red']);
  const other = reported('jest', jest(['y', 'passed']));
  assert.deepEqual(judgeGreen(other, ['x']), ['the report has no test named "x"']);
  assert.deepEqual(judgeStill(other, ['x']), ['the report has no test named "x"']);
  const timedOut = { report: null, why: 'the suite timed out after 1 s' };
  for (const judge of [(r) => judgeRed(r, ['x']), (r) => judgeGreen(r, ['x']), (r) => judgeStill(r, ['x']), (r) => judgeKilled(r).reasons]) {
    assert.deepEqual(judge(timedOut), ['the suite timed out after 1 s']);
  }
});

test("a junit test's full name is its classname and name, and every test so named is judged", () => {
  const playwright = junit(
    [
      '<testcase name="Greeting › names the person" classname="greet.spec.ts" time="0.2">',
      '<failure message="greet.spec.ts:4:7 names the person" type="FAILURE"><![CDATA[  1) [chromium] › greet.spec.ts:4:7 › Greeting › names the person\n\n    Error: expect(received).toHaveText(expected)\n]]></failure>',
      '</testcase>',
      '<testcase name="Greeting › waves" classname="greet.spec.ts" time="0.1"></testcase>',
    ].join('\n'),
  );
  assert.deepEqual(judgeRed(reported('junit', playwright), ['greet.spec.ts Greeting › names the person']), []);
  assert.match(judgeRed(reported('junit', playwright), ['Greeting › names the person']).join('\n'), /the report has no test named "Greeting › names the person"/, 'the classname is part of the name');
  assert.deepEqual(passedNames(reported('junit', playwright)), ['greet.spec.ts Greeting › waves']);
  const pytest = '<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest" errors="0" failures="1" skipped="0" tests="1"><testcase classname="tests.test_greet.TestGreet" name="test_names_the_person" time="0.001"><failure message="AssertionError: assert &apos;&apos; == &apos;Hello, Ada&apos;">def test_names_the_person(self):\n&gt;       assert greet("Ada") == "Hello, Ada"</failure></testcase></testsuite></testsuites>';
  assert.deepEqual(judgeRed(reported('junit', pytest), ['tests.test_greet.TestGreet test_names_the_person']), []);
  assert.deepEqual(passedNames(reported('junit', junit('<testcase classname="" name="bare"/><testcase name="nameless"/>'))), ['bare', 'nameless'], 'no classname, the name alone');
  // The same test run in two projects is one name twice, and each run of it is judged.
  const projects = `<testsuites><testsuite name="a.spec.ts" hostname="chromium"><testcase classname="a.spec.ts" name="t"><failure message="m">Error: expect(received).toBe(expected)</failure></testcase></testsuite><testsuite name="a.spec.ts" hostname="firefox"><testcase classname="a.spec.ts" name="t"/></testsuite></testsuites>`;
  assert.deepEqual(judgeRed(reported('junit', projects), ['a.spec.ts t']), ['"a.spec.ts t" did not fail (passed)']);
  assert.deepEqual(judgeGreen(reported('junit', projects), ['a.spec.ts t']), ['"a.spec.ts t" fails', '"a.spec.ts t" did not pass (failed)']);
  assert.deepEqual(judgeStill(reported('junit', projects), ['a.spec.ts t']), ['"a.spec.ts t" no longer passes (failed)']);
});

test('an <error> on a scaffold gap still open is red, as a failure on it is', () => {
  const gap = reported('junit', junit('<testcase classname="t" name="x"><error message="java.lang.UnsupportedOperationException: TODO(scaffold): the greeting"/></testcase>'));
  assert.deepEqual(judgeRed(gap, ['t x']), []);
});

test('an <error> is a crash, never red, though it fails green and kills a mutant', () => {
  const errored = reported('junit', junit('<testcase classname="t" name="x"><error message="failed on setup with &quot;KeyError: \'db\'&quot;">AssertionError in a fixture</error></testcase>'));
  assert.deepEqual(judgeRed(errored, ['t x']), [`"t x" failed, but not on an assertion: failed on setup with "KeyError: 'db'"`]);
  assert.deepEqual(judgeGreen(errored), ['"t x" fails']);
  assert.equal(judgeKilled(errored).killed, true);
});

test('a skipped test neither fails nor passes, in either format', () => {
  for (const run of [reported('jest', jest(['x', 'pending'], ['y', 'passed'])), reported('junit', junit('<testcase name="x"><skipped/></testcase><testcase name="y"/>'))]) {
    assert.deepEqual(judgeRed(run, ['x']), ['"x" did not fail (skipped)']);
    assert.deepEqual(judgeGreen(run, ['x']), ['"x" did not pass (skipped)']);
    assert.deepEqual(judgeStill(run, ['x']), ['"x" no longer passes (skipped)']);
    assert.deepEqual(judgeKilled(run), { killed: false, reasons: ['every test passed with the mutant in place'] });
  }
  assert.deepEqual(judgeGreen(reported('jest', jest(['x', 'todo']))), ['the suite ran no tests']);
  assert.deepEqual(judgeGreen(reported('junit', junit('<testcase name="x"><skipped message="later"/></testcase>'))), ['the suite ran no tests']);
});

test('a file that failed to load or collect makes a run unjudgeable, in either format', () => {
  const jestBroken = JSON.stringify({ testResults: [{ name: '/repo/test/a.test.ts', status: 'failed', message: '  ● Test suite failed to run\n\n    Cannot find module', assertionResults: [] }] });
  assert.deepEqual(judgeRed(reported('jest', jestBroken), ['x']), ['/repo/test/a.test.ts failed to load or collect: ● Test suite failed to run']);
  // A suite that counts an error and holds no test; one holding an error of its own; and the root, when
  // nothing was collected at all.
  const counted = '<testsuites><testsuite name="a.test.ts" tests="0" errors="1"><system-err>SyntaxError: Unexpected token\n  at a.test.ts:3</system-err></testsuite><testsuite name="b.test.ts"><testcase name="y"/></testsuite></testsuites>';
  assert.deepEqual(judgeGreen(reported('junit', counted)), ['a.test.ts failed to load or collect: SyntaxError: Unexpected token']);
  assert.deepEqual(judgeKilled(reported('junit', '<testsuite name="b.test.ts"><error message="Cannot find module \'./b\'"/><testcase name="y"/></testsuite>')), { killed: false, unjudgeable: true, reasons: ["b.test.ts failed to load or collect: Cannot find module './b'"] });
  assert.deepEqual(judgeGreen(reported('junit', '<testsuites name="vitest" tests="0" failures="0" errors="1"></testsuites>')), ['vitest failed to load or collect']);
  // A suite holding a failure of its own, as a hook's, and one that counts a failure and holds no test.
  assert.deepEqual(judgeGreen(reported('junit', '<testsuite name="c.test.ts"><failure message="afterAll hook failed"/><testcase name="z"/></testsuite>')), ['c.test.ts failed to load or collect: afterAll hook failed']);
  assert.deepEqual(judgeGreen(reported('junit', '<testsuites><testsuite name="d.test.ts" tests="0" failures="1"></testsuite></testsuites>')), ['d.test.ts failed to load or collect']);
  // Jest's count of runtime errors outside every test.
  const runtime = JSON.stringify({ numRuntimeErrorTestSuites: 1, testResults: [{ name: '/repo/test/b.test.ts', status: 'passed', assertionResults: [{ fullName: 'y', status: 'passed' }] }] });
  assert.deepEqual(judgeGreen(reported('jest', runtime)), ['a test suite hit a runtime error outside its tests']);
  // An empty suite that counts nothing ran nothing, and failed nothing.
  assert.deepEqual(judgeGreen(reported('junit', '<testsuites><testsuite name="c" tests="0" errors="0"/></testsuites>')), ['the suite ran no tests']);
});

test('a report of another shape, or XML not well-formed, is no report', () => {
  for (const [format, text] of [['jest', '{'], ['jest', '{"numTotalTests":0}'], ['junit', '<testsuites><testsuite></testsuites>'], ['junit', '<testsuites><testsuite></testcase></testsuites>'],['junit', '<html><body/></html>'], ['junit', '<testsuite name="a"/><testsuite name="b"/>'], ['junit', 'not xml'], ['junit', '<testsuites><testsuite name="a"><testcase name="x"/></testsuite>'], ['junit', '<testsuite name="a"><testcase name="x"/></testsuite>\n< stray']]) {
    assert.equal(readReport(format, text), null, `${format}: ${text}`);
  }
  const decoded = readReport('junit', '<?xml version="1.0"?>\n<!-- written by a runner -->\n<testsuite name=\'s\'><testcase classname="a&amp;b" name="&lt;x&gt; &#8250; &#x2192;"/></testsuite>');
  assert.deepEqual(decoded.tests, [{ name: 'a&b <x> › →', status: 'passed' }]);
});
