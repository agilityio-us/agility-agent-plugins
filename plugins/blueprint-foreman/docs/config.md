# Configuration

The foreman reads two files at the root of the item's repository, as the commit it admits a run on
holds them, and the routine's environment. The files say what the repository is: its install, suites
and extractor. The environment says what the agent does: its practices, models and Adversary. Both
files are protected: no step of a run may change them, so the code cannot teach its judge. A run pins
what it read at admission and holds every later load to it.

## `.blueprint-foreman.json`

The harness's own settings.

| Field | Required | Declares |
| - | - | - |
| `install` | yes | a shell command, run from the root, that installs every dependency the extractor and the suites need, from the lockfile, leaving the working tree clean but for what the repository ignores. It runs in the working tree at admission and at every wake that goes on, since every fire is a fresh clone, and in every scratch checkout. |
| `suites` | yes, at least one | the test suites, keyed by name, below |
| `emits` | yes | the node types the extractor can produce, as the design's artifacts name them. A design row of another type, and every edge touching one, goes by name to the final gate's Contract Reviewer instead of convergence. |
| `protect` | yes, may be empty | the extractor's own paths, relative to the root, a directory covering everything under it; no step may change them |
| `lessonHomes` | no | where a lesson may land at settle, the paths that exist when the run starts; default `["CLAUDE.md", ".claude/rules"]`. Prose a reader weighs: hooks and settings run, so they change only through a slice. |

Any other field is ignored, `models` and `adversary` among them: those are the environment's now.

A suite is `{ command, report, all?, cwd?, env?, timeout? }`:

- `command` runs in `sh` from `cwd` (relative to the root, the root when absent), with `{files}`
  replaced by the slice's test files, each quoted and relative to `cwd`, and `{report}` by an absolute
  path the engine reads afterwards. It holds `{files}`; it, or an `env` value, holds `{report}`.
- `report` is `jest` (Jest's `--json`, Vitest's `json` reporter) or `junit` (JUnit XML, which
  Playwright, pytest and most runners write). A test's full name is a Jest report's `fullName`, or a
  JUnit testcase's `classname` and `name` joined by a space. A JUnit `<error>` is a crash, never red,
  unless it carries `TODO(scaffold)`.
- `all`, when declared, runs the whole suite. At the final gate every test it passes at the admitted
  commit must pass at HEAD in its admitted form.
- `env` is added to the environment, under the engine's own `BLUEPRINT_FOREMAN_EXHIBITS`, which wins.
- `timeout` is in seconds, 20 minutes when absent. Every command the engine runs, a suite, the
  install, the extractor or an exhibit command, runs under a supervisor that kills what it started
  once it exits or its time is up.

Two traps a suite can set:

- A runner that takes its files as patterns pulls in someone else's tests, and red requires that
  nothing but the named tests fails: pass `{files}` as exact paths, as Jest's `--runTestsByPath` does.
- Node's JUnit reporter gives every test the classname `test`, so same-named tests in two files are
  one name: keep the file in each full name through a reporter that writes it, or keep test names
  unique across the suite.

An example:

```json
{
  "install": "npm ci --silent",
  "suites": {
    "unit": { "command": "npx jest --json --outputFile {report} --runTestsByPath {files}", "report": "jest" },
    "e2e": {
      "cwd": "e2e",
      "command": "npx playwright test --reporter=junit {files}",
      "env": { "PLAYWRIGHT_JUNIT_OUTPUT_NAME": "{report}" },
      "report": "junit"
    }
  },
  "emits": ["aggregate", "command", "event", "read-model", "policy"],
  "protect": ["tools/extractor"]
}
```

## `.blueprint.config.json`

Blueprint's adapter file. The foreman reads these fields, and ignores the rest:

| Field | Required | Declares |
| - | - | - |
| `designTooling.extract` | yes | a shell command, run from the root, that writes `.blueprint/graph.json` holding at least `{ nodes: [{ id, type }], edges: [{ from, kind, to }] }`. A nonzero exit, no file or a file of another shape is a failed extraction. |
| `designTooling.typeWords` | no | the word the code names of a node type end in, by type, each letters and digits: `{ "aggregate": "Aggregate", "policy": "Policy" }`. A design labels a node without it, so convergence also takes a proposed node, and every edge naming it, as realized by its code id, below. Without it, or for a type it does not name, only the row's own id realizes it. |
| `docsRoot` | no | where each item's docs live, `<docsRoot>/<KEY>/`, default `docs/prs`. The fire's `design` must be `<docsRoot>/<KEY>/blueprint.md`. |

A proposed node's code id, where the graph lacks its own id and the repository declares a type word
for its type: its code is named for its label without the word it may end in (its last letters and
digits spelling the word, case and anything between them aside), in PascalCase, with the word appended
once, and the code id is the row's id with its label's slug replaced by that name's. A slug is the
label with camel-case humps and every run of other characters turned into one hyphen, lowercased. So
``- aggregate Greeter in greeting (`greeting_agg_greeter`)`` is realized by
`greeting_agg_greeter-aggregate`, `Orders View Model` with the word `Viewmodel` by `...orders-viewmodel`,
and `Greeter Aggregate` by its own id alone. A row whose id does not end in its label's slug has no code
id.

## The routine's environment

Every variable that steers the agent is set on the routine's environment, read at admission and
pinned with the run: a later fire's environment changes nothing, and a gate recorded where the
Adversary's route differs from the pinned one is refused. A value the engine cannot read fails the
fire, naming the variable.

| Variable | Sets | Unset |
| - | - | - |
| `BLUEPRINT_FOREMAN_PRACTICES` | the practices the run holds, named and separated by commas or spaces, or `all`: `slices`, `red-green`, `mutant`, `review`, `adversary`, `exhibits`, `lessons`. See [how it works](how-it-works.md#practices) and how they [depend on one another](how-it-works.md#how-practices-depend-on-one-another). | none: the foundation alone |
| `BLUEPRINT_FOREMAN_MODEL_BROAD` | Red, Green and the Builder on a broad slice | the strongest Claude model |
| `BLUEPRINT_FOREMAN_MODEL_CONTAINED` | Red, Green and the Builder on a contained slice | the faster Claude model |
| `BLUEPRINT_FOREMAN_MODEL_REVIEWER` | the Mutant, the Reviewers, the Contract Reviewer | the strongest Claude model |
| `BLUEPRINT_FOREMAN_MODEL_ADVERSARY_FALLBACK` | the Claude subagent standing in for the Adversary | the strongest Claude model |
| `BLUEPRINT_FOREMAN_ADVERSARY_MODEL` | the Adversary's OpenRouter model | the strongest GPT model |
| `BLUEPRINT_FOREMAN_ADVERSARY_ZDR` | `true` or `false`: whether the Adversary's requests may reach only zero-data-retention endpoints | `true` |
| `OPENROUTER_API_KEY` | sends the Adversary to OpenRouter; never printed or logged | a Claude subagent stands in |

Every practice on, for a routine that runs them all:

    BLUEPRINT_FOREMAN_PRACTICES=all

A first run with a little more than the foundation:

    BLUEPRINT_FOREMAN_PRACTICES=slices,review

## The fire

The fire is Specification v1's JSON. Its `options` Blueprint passes through untouched, and this
harness ignores them, whatever they hold. `payload.schema.json` describes the whole fire; the engine
validates every fire against it with its own code.
