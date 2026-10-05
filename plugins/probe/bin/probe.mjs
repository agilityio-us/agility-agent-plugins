#!/usr/bin/env node
// Prints what a session can observe of this clone. Reads no secret values.
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROBE_VERSION = 2
const here = dirname(fileURLToPath(import.meta.url))
const git = (...args) => {
  try { return execFileSync('git', ['-C', here, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  catch (error) { return `unavailable: ${error.message.split('\n')[0]}` }
}

console.log(JSON.stringify({
  probeVersion: PROBE_VERSION,
  script: fileURLToPath(import.meta.url),
  cwd: process.cwd(),
  node: process.version,
  cloneRoot: git('rev-parse', '--show-toplevel'),
  head: git('rev-parse', 'HEAD'),
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  shallow: git('rev-parse', '--is-shallow-repository'),
}, null, 2))
