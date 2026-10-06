# blueprint-foreman's terms

Each term once. Roles are capitalized (Red, Green, Builder); steps and states are not.

## Around the run

| Term | Meaning |
| - | - |
| **Blueprint** | the service that turns a work item into a design and the design into code |
| **Steward** | Blueprint's service beside the repository: it holds the keys, commits the design and the scaffold to B, fires routines, reads F's signal, merges F into B on `done` and posts the description |
| **Specification v1** | the contract between Blueprint and the agent that delivers an item: the fire, the branches, the design, the scaffold, the signal and the description |
| **foreman** | blueprint-foreman, the harness a session follows to deliver one design; it builds nothing itself, but dispatches a subagent for every role and holds their work to the design |
| **item** | the work item a design delivers, known by its **key**, as `PROJ-1` |
| **fire** | Steward starting a routine with the fire's JSON: the key, B, F, the design, the signal's key, an answer and the harness's options |
| **routine** | the saved Claude Code prompt and environment a fire starts |
| **session** | the Claude Code conversation a fire starts, which follows the skill |
| **B** | Blueprint's branch for the item, `<KEY>-<slug>`, which Steward writes |
| **F** | the agent's branch, `claude/<B>`, cut from B's tip at the first fire and continued at every later one, B's moves merged in |
| **docsRoot** | where each item's docs live, `<docsRoot>/<KEY>/`, default `docs/prs` |
| **design** | `<docsRoot>/<KEY>/blueprint.md`, Blueprint's rendering of the item's design |
| **scenario**, **criterion** | a scenario of the design, by its stable id, with Given, When and Then steps; the plan covers each, and the final gate's verdicts name each |
| **artifact**, **event model** | a node or edge the design proposes, modifies, renames or removes, with its id and type; together, the event model the code converges on |
| **scaffold** | the latest commit carrying `Blueprint-Scaffold: <KEY>`, the event model in code before the fire, with its report, `scaffold.json`, beside the design |
| **gap** | a scaffold line marked `TODO(scaffold)`, the only kind an implementer replaces |
| **lock** | every other line the scaffold added, and every line a landed slice added to its frozen files: what must survive |
| **extractor** | the repository's command that writes the **graph**, `.blueprint/graph.json`, from the code |
| **converge** | of the code: its graph bears out every artifact the extractor can show; what ids cannot show goes by name to the final gate's Contract Reviewer, or with review off to the description as unverified |
| **signal** | the trailer under the fire's key, default `Blueprint-Status`, that ends every commit the engine prints: `working`, `done`, `needs-human`, `rejected` or `failed` |
| **description** | `<docsRoot>/<KEY>/pull-request.md`, which settle writes and Steward posts on the item's pull request |
| **protected paths** | both configuration files, the item's directory, the extractor's own paths and every `.gitattributes`: what no step may change |

## A run

| Term | Meaning |
| - | - |
| **wake** | the engine command a fire runs, the fire on stdin: it has F checked out, then admits a run, continues it, resumes it, opens a new cycle, or ends |
| **intake** | a fire on an F that carries no run: admission, or its signal, `rejected` or `failed` |
| **admitted**, **held**, **trusted** | of a demand: checked before any work, during the run, or not at all |
| **run** | one design's delivery on F, from admission on |
| **cycle** | one design's delivery, from the plan to settle; a newer scaffold on B opens the next, on the merged code, the run state and run directory starting again |
| **run directory** | `<docsRoot>/<KEY>/foreman/`: the run state and everything the run writes, the only place it writes outside the code change but the description |
| **run state** | `run.json` in the run directory, which only the engine writes, held at every load to F and to every run-state commit before it; the **engine's copy** lives in the checkout's git directory |
| **run-state commit** | a commit of the run directory alone, at settle with the description, ending in the harness's trailers, `Foreman-Cycle`, `Foreman-Stop` at a stop and `Foreman-Run`, and the signal last |
| **practice** | a stage the fire's options may turn off, each on unless they do and pinned at admission: `slices`, `red-green`, `mutant`, `review`, `adversary`, `exhibits`, `lessons` |
| **foundation** | what every run holds, whatever its practices: admission, every record's bounds and the locks, the replays, the final run, attempts and the budget, stops, answers and cycles, and settle with the description |
| **stop** | the run waiting, signalled `needs-human`, on a **need** the commit's subject asks |
| **answer** | a person's reply to a stop, which the next fire carries; the run quotes it from its run state for the rest of the cycle |
| **reject** | the session's record that only a new design or scaffold puts the run right, citing scenario ids, artifacts or locked scaffold lines, each of which must exist |

## Inside a run

| Term | Meaning |
| - | - |
| **step** | what the run waits on the session for; each takes evidence |
| **brief** | what a step tells a subagent, carrying every answer given in the cycle |
| **record** | the command by which the session hands the engine a step's evidence |
| **bounds** | what a step may change: the commit it counts from, the paths, and whether something must change |
| **accepted** | the commit whose code the engine last accepted, from which a step's bounds count unless it names another |
| **restore** | a new commit putting the code back to an earlier one, as the engine prints it; the branch is never rewritten |
| **plan** | the slices that realize the design's scenarios, together |
| **slice** | one vertical piece of the plan, delivered red to green, or by the Builder |
| **frozen set** | a slice's test files, fixtures and suite configuration, fixed at red, or the Builder's as the slice lands |
| **stub** | a product file Red may create with signatures only, so the tests fail on an assertion |
| **substitute** | for a slice with no red, the **broken state** its tests must fail on instead |
| **exhibit** | what a person who was not in the session looks at to see a slice's work: a recording, else a screenshot, else the system's own output, never a harness's verdict |
| **budget**, **attempt** | a slice has a budget of attempts; each failed try spends one |
| **Red**, **Green** | the subagents that write a slice's failing tests, and then the code that passes them |
| **Builder** | with red-green off, the subagent that writes a slice's code and its tests together |
| **Mutant** | the subagent, told not to read the tests, that names one small edit the tests must fail on; a first that survives brings the **reroll** |
| **Reviewer** | a subagent reviewing one group of the slice's diff |
| **Contract Reviewer** | a subagent, never an author, judging a slice, and at the final gate the whole change, against the design's scenarios and the exhibits |
| **Adversary** | a model of another family, over OpenRouter, attacking the plan and the final change; without a key, or when the request fails, a Claude subagent |
| **proof run** | the engine's own run of a slice's tests that writes its exhibits |
| **replay** | the engine running the slice's candidate, the mutant and red again in one scratch checkout |
| **land** | of a slice: its reviews passed, or with review off its replays, and its tests locked |
| **final run** | the engine's own run of the code at HEAD before the final gate: convergence, the locks and gaps, every landed slice's tests, each suite's `all` |
| **gate** | the plan gate and the final gate, each attacking a **package** the engine builds, in at most two **rounds** |
| **finding** | a claim on a file and line; its **disposition** is fixed, refuted with evidence the engine can find, or handed off to the description |
| **verdict** | the Contract Reviewer's judgment, `met` or not with its evidence, on each scenario and each row convergence hands on |
| **lessons** | what a run taught, in one commit touching only the lesson homes |
| **`pr-notes.md`** | the session's part of the description: decisions, deferrals and, with lessons on, lessons |
