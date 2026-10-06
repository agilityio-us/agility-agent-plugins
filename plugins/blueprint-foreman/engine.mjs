#!/usr/bin/env node
// blueprint-foreman engine: the delivery engine a blueprint-foreman session follows to deliver one work
// item's committed design and scaffold on the agent's branch, as Specification v1 sets out. The engine
// speaks through the commits it prints for the session to make and push, each ending in the signal
// Steward reads, and moves no tracker item and opens no pull request. It carries what it verifies
// from facts it observes: admission, the design and plan checks, red, green, the locks, the replays,
// review, convergence, the gates, the exhibits and the calibration log. For those it names the step,
// writes each subagent's brief, runs what must be deterministic itself, and refuses evidence that does
// not support the step. Why: docs/how-it-works.md.
//
// Node built-ins only. It runs from its own clone, always from the root of the repository it delivers
// into. The run state lives in the run directory, <docsRoot>/<KEY>/foreman/, on the agent's branch.
//
//   wake                         what a fire runs, the fire's JSON on stdin as payload.schema.json says:
//                                check out the agent's branch, then admit a run, continue it, resume
//                                it, open its next cycle on a newer scaffold, or end
//   record <KEY> <what> [value]  record the evidence the current step asked for
//   record <KEY> need "<what>"   stop the run for what it cannot get or must not do itself
//   record <KEY> reject "<why>"  end the run rejected, citing what in the design or the scaffold is wrong
//   probe-adversary [model]      one real keyed Adversary request over a synthetic package
//
// Exit codes: 0 when the step was accepted or printed, 1 on a refusal or an end, 2 on a usage error.

import fs from 'node:fs';
import process from 'node:process';
import { run } from './lib/wake.mjs';

const argv = process.argv.slice(2);
// The fire comes on stdin, which only wake reads.
const input = argv[0] === 'wake' && !process.stdin.isTTY ? fs.readFileSync(0, 'utf8') : '';
const { code, text } = await run(argv, { root: process.cwd(), input });
process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
process.exitCode = code;
