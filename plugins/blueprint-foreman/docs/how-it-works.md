# How blueprint-foreman works

The [skill](../skills/blueprint-foreman/SKILL.md) is what a session does, and the engine,
`engine.mjs`, carries every rule it can check from what it observes; this page is the map. The engine
names each step, writes each subagent's brief, runs every suite, replay, lock check and extraction
itself, and refuses evidence that does not support the step. The session dispatches the subagents,
writes what a step asks for, and makes and pushes the commits the engine prints. Neither moves a
tracker item, opens a pull request or messages anyone. What crosses to Blueprint is [Specification
v1](https://github.com/agilityio-us/blueprint-steward/blob/main/docs/specification.md); this page
names it only where the engine holds it.

The engine runs from this plugin's clone, always from the root of the item's repository, and prints
every command with its own path:

| Command | Does |
| - | - |
| `wake` | what a fire runs, the fire's JSON on stdin: has F checked out, then admits a run, continues it, resumes it, opens a new cycle, or ends |
| `record <KEY> <what> [value]` | records the evidence the current step asks for |
| `record <KEY> replan` | approves `plan.json` over the slices that have not landed, from any step of a slice in flight |
| `record <KEY> need "<what>"` | stops the run, from any active step |
| `record <KEY> reject "<why>"` | ends the cycle rejected, from any active step, citing what shows the design or the scaffold wrong |
| `probe-adversary [model]` | one keyed Adversary request over a synthetic package, to try a key and a model |

A command exits 0 when its step was accepted or printed, 1 on a refusal or an end, and 2 on a usage
error. The design is the run's commitment and is never restated.

## A fire

The fire names the key, B, F, the design, the signal's key and, after a stop, the answer. The wake
first has the session check out F as it prints: the clone unshallowed, B fetched, F fetched where
origin has it, else cut from B's tip. Then it reads what F carries:

| F carries | The fire |
| - | - |
| no run | merges B in where B moved on, then admits a run on B's code, or signals `rejected` or `failed` |
| any run, where B carries a newer scaffold than the run's | puts back what the run had not accepted, merges B in, and opens a new cycle on the merged code |
| a working run | continues it from the state last pushed, redoing what was never pushed |
| a stopped run, and an answer in the fire | merges B in where B moved and the run can judge it, then resumes |
| a stopped run and no answer, a settled run, a rejected run | ends without writing |

Admission checks every admitted demand before any work and reports each that fails, but one whose
check needs another that failed: the routine (Node 18, git 2.32, the whole history, a clean tree),
both configuration files, the design where docsRoot puts it, the scaffold in force (the latest commit
carrying the item's trailer, made from this design, touching no protected path but its report, its
report done or skipped, its locked lines holding), the install, and the extractor at the scaffold's
parent, where every node or edge the design modifies or removes must be, and at HEAD. Where any
reason is the design's or the scaffold's the fire signals `rejected`, else `failed`, in one empty
commit. Every fire is a fresh clone, so admission and every wake that goes on run the install in the
working tree first, on a clean tree it must leave clean.

A new cycle is admitted by the same checks on the merged code. Its run state starts again, keeping
the cycle and stop counts and what the run pinned at its first admission (practices, models, the
Adversary's route), and so does the run directory, but for the calibration log; what earlier cycles
did is F's history. A newer design the checks refuse signals `rejected` and leaves the run as it was.
Before it prints any merge of B, the engine tries it in a scratch checkout: one that conflicts is a
person's to resolve, so the fire signals `needs-human`, its subject naming the conflicting files, in
one empty commit that leaves the run state as last pushed.

Of two racing sessions, the one whose push is rejected ends without writing.

## The signal

Every commit the engine prints ends in one trailer block:

    Foreman-Cycle: <n>
    Foreman-Stop: <n>
    Foreman-Run: <KEY> <state>
    <signal key>: <value>

`Foreman-*` are the harness's own, which Steward ignores and the engine reads its run back by;
`Foreman-Stop` is on a stop only, and an intake's signal carries no cycle. The signal is last, under
the key the fire named at admission, its value by the run's state: `working` while it works,
`needs-human` at a stop, whose subject asks what it needs, `done` at settle, `rejected` when only a
new design or scaffold puts it right, and `failed` when anything else stopped the fire (the install,
a tool, the configuration, a fire short of its schema, a run state that will not load), which leaves
the run state as last pushed so the next fire goes on from there. The subject names the state, a
stop's the need, cut at 100 columns; the body is prose for a person, wrapped at 100.

## Practices

Every run holds the [foundation](glossary.md), whatever its practices; on it run seven practices,
each a stage the engine runs only where the routine's environment turns it on
([`BLUEPRINT_FOREMAN_PRACTICES`](config.md#the-routines-environment)). Each is off unless turned on,
and the set is pinned at admission, held along every run-state commit, named in the description, and
a later fire's environment ignored. So a routine that sets nothing runs the foundation alone: one
Builder slice, held by the engine's bounds, locks, replays and final run, then settle. Each practice,
on and off:

| Practice | On | Off |
| - | - | - |
| `slices` | the plan is a graph of slices, each realizing some scenarios | the plan adds one slice beyond those that landed, depending on none |
| `red-green` | Red writes failing tests, then a separate Green makes them pass | one Builder per slice writes the code and its tests together, and every test must pass; no red, stubs, substitute or red replay, and the frozen set is locked as the slice lands |
| `mutant` | a fresh Mutant names a defect the slice's tests must catch | no mutant: the replays run inside the candidate's record |
| `review` | Reviewers on the slice's diff, a Contract Reviewer on each slice and at the final gate | a slice lands once its replays pass, its findings handed off unreviewed, and the rows convergence hands on are handed off unverified |
| `adversary` | another model family attacks the plan and the final change | no Adversary; the final gate holds the other findings |
| `exhibits` | each slice promises an exhibit its proof run writes | no promise, no exhibit kept or required, and no Exhibits section |
| `lessons` | settle takes one lessons commit | no lesson home or lessons commit, and no Lessons section |

A plan declares none of the fields only a practice the run has off reads.

### How practices depend on one another

The engine admits every combination; none is refused, and none turns another on. Where one practice's
stage needs another's, it runs only with both, and otherwise falls back to the foundation:

| Where | Needs | Without it |
| - | - | - |
| the plan gate | `slices` and `adversary` | no plan gate: with one slice there is no slicing to attack, and with no Adversary no one attacks it |
| a substitute slice | `red-green` | no substitute: a Builder's tests must pass anyway, so a slice with no red needs none |
| the final gate as a step | `review` or `adversary` | its round closes inside the record that reached it, on the final run's findings alone |
| judging an exhibit | `exhibits` and `review` | with review off, exhibits are still written, kept and linked, but no Contract Reviewer judges them against their promise |
| the rows ids cannot show | `review` | handed off to the description as unverified |
| an equivalent mutant's finding | `mutant` and `review` | with review off, handed off to the description unreviewed |

Combinations worth knowing:

- **Nothing on**, the default: one Builder slice; the engine's bounds, locks, replays, final run and
  convergence are the only judges, and what they find reaches the final gate's findings, fixed by a
  slice or handed off.
- **`adversary` without `slices`**: no plan gate, but the final gate's Adversary attacks the change.
- **`exhibits` without `review`**: the description links exhibits no one judged.
- **`mutant` without `red-green`**: the Mutant judges the Builder's tests, and may not be the
  Builder.
- **`review` without `red-green`**: the Contract Reviewer judges the Builder's tests and code
  together, with no red replay among its evidence.

## The lock

Every line the scaffold commit adds, but its gaps and its report, is locked, and so is every line a
landed slice added to its frozen files. In a script (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`,
`.mts`, `.cts`), a locked line's tokens must all still be there, in order, as code: anything may be
inserted between them, even within a line, and formatting is ignored, but a token removed, changed,
commented out or swallowed by a string breaks the line. In any other file, a locked line must still
appear, trimmed and in order, and so must a landed test's line in a script too, since code inserted
within it can disarm it. Blank lines are never locked, nor are a script's comments. The engine reads
tokens itself, since loading the repository's TypeScript would run code an implementer could plant,
and reads every diff as text, whatever an attribute or a driver says of a file. Every brief states
this rule in the engine's words, and the slice's Contract Reviewer is handed the scaffold's locked
lines at its green, so no reviewer holds a lock of its own: the locks are the engine's to judge.

## Bounds

Every record is held to its step's bounds before its evidence is weighed: the commit it counts from,
the paths it may change, and whether something must change. In order: the working tree is clean
outside the run's own paths; no merge came in since that commit, or each was taken out again; no
protected path changed; every changed path is one the step may change; something changed, where it
must; and wherever the code changed, the locks hold at HEAD. A committed change out of bounds, or a
lock broken, is at red, green and builder a failed try, which spends an attempt, and at any other
step refused with the one restore command, which puts the code back in a new commit and keeps the run
directory, so the pushed branch is never rewritten. A merge is never restored: the record is refused
with the need to stop on, so the wake that resumes the run judges the merge.

## The run state

The run directory, `<docsRoot>/<KEY>/foreman/`, rides F:

| Path | Holds |
| - | - |
| `run.json` | the run state, which only the engine writes |
| `plan.json` | the plan as the session writes it; the approved plan is the run state's |
| `briefs/` | Red's, Green's, the Builder's and the Mutant's briefs, written for each attempt |
| `review/<slice>-<attempt>/` | the mutant, the replay evidence, the groups and their findings, the contract verdict, the dispositions |
| `gates/<gate>-c<cycle>-r<round>/` | a gate round's package, findings, contract verdict, convergence and dispositions |
| `exhibits/<slice>/` | what each accepted proof run wrote, written again by the final run |
| `calibration.log` | a key=value line per reviewer, contract review and finding, across every cycle |
| `pr-notes.md` | the session's part of the description |

The **engine's copy** of `run.json` sits in the checkout's git directory, where no commit reaches; a
record or a wake while `run.json` differs from it is refused, with the `cp` that restores it. A fresh
clone has none, and a subagent can rewrite it, so every load also holds the run state to F: its
admitted commit on F; its scaffold the latest carrying the item's trailer there, the design there the
one the scaffold was made from, where docsRoot puts it; its adapters and protected paths what the
configuration declares there. And it follows from what came before, held to each run-state commit
along F's first-parent line: within a cycle it keeps the practices, models and Adversary it was
admitted with and every entry of the records that accumulate (its history, the landed slices, their
locked tests and what each passed as it landed, the authors, the handed-off and fixed findings, the
gate rounds with their verdicts, the lessons commits, the answers), its counts never fall, and its
accepted commit moves only forward, but back to where a spent attempt restores the code; its plan
changes only across a plan record or a gate's dispositions, never while a slice is in flight; and
within one gate round its findings and its convergence never change. A run state admitted on another
commit than the one before it opens the next cycle, only on a newer scaffold, keeping its counts and
what it pinned. A run state that fails any of this signals `failed`, and the run cannot go on from
it. After every record that changes the run, the engine prints the run-state commit for the session
to make and push, so F never lags the run.

## Steps

A step waits on evidence only the session can produce; what takes none, the engine runs inside the
record before it, in brackets here. A step's bounds count from the commit last accepted unless the
table names another. Next is the first stage the run's practices hold.

| Step | Records | May change | Next |
| - | - | - | - |
| plan | `plan`, from `plan.json` | nothing | the plan gate; with no slice left to work, [the final run], then the final gate |
| gate | `gate`: the Adversary's `findings.json` when it runs as a subagent; at the final gate with review on `gate <agent id>`, with the Contract Reviewer's `contract.json` | nothing | gate dispositions; with no finding, the first slice (plan gate) or settle (final gate) |
| gate-dispositions | `dispositions`, and `plan.json` when a finding is fixed | nothing | the plan gate's round 2, or a fix slice (final gate); with none fixed, on as from the gate |
| red | `red <agent id>`, its commits | the frozen set and stubs, from the slice's base; something must | green |
| green | `green <agent id>`, its commits | anything outside every frozen set, from red; something must, but for a substitute | mutant; a substitute's [replays], then group review |
| builder | `builder <agent id>`, its commits | anything outside every landed slice's frozen set, from the slice's base; something must | mutant |
| mutant | `mutant <agent id>`, from `mutant.json` | nothing | [replays], then group review; a first survivor, mutant again |
| group-review | `groups`, from each group's findings | nothing | contract review |
| contract-review | `contract <agent id>`, from `contract.json` | nothing | slice dispositions; with no finding, [land]; failing, green or the builder |
| slice-dispositions | `dispositions` | nothing | [land] |
| [land] | | | the next slice, or [the final run], then the final gate |
| settle | `notes`, from `pr-notes.md` | the lesson homes, in at most one commit | settled, with the description written |
| replan | `replan`, from `plan.json` | nothing since the slice's base, its code restored first | the next slice, from the slice's base; with none left, [the final run], then the final gate |
| any step of a slice in flight | `replan`, as at the replan step | as at the replan step | as from the replan step |
| any active step | `need "<what>"` | | stopped |
| any active step | `reject "<why>"` | | rejected |

`stopped`, `settled` and `rejected` are rest states, which only a wake leaves: a stop on its answer, any
of them on a newer scaffold.

## A slice

- **Red** writes the tests and any stubs the slice names. Red is accepted when every test it names
  fails on an assertion and nothing else fails; an import, syntax or collection error, a crash, a skip
  or a timeout is not red, but a failure on a scaffold gap still open, whose message carries
  `TODO(scaffold)`, is.
- **Green**, a separate dispatch, fills the gaps and makes the tests pass, every frozen set read only.
  The engine's own run of the suite is the slice's proof run, which writes its exhibit. At every red,
  green and builder, each landed slice's passing tests must still pass.
- **Builder**, with red-green off, one dispatch in place of both, every landed slice's frozen set
  read only; its tests must all pass.
- **Mutant.** A fresh dispatch, none of the run's authors and told not to read the tests, names one
  small defect, `{ file, find, replace }`, in a file the slice changed, outside every frozen set and
  the protected paths. Any test of the slice failing kills it. A first survivor brings the reroll, a
  second mutant from a fresh dispatch: killed, the first is likely equivalent to the code, a finding
  for the review; surviving too, the tests' author's attempt is spent.
- **Replays**, in one scratch checkout, installed: green on the candidate with every landed slice's
  tests beside it, the mutant, then red on Red's commit.
- **Review.** The slice's diff splits into groups of at most 150 changed lines, one Reviewer each.
  The Contract Reviewer then judges the replay evidence, the group findings, the diff and the exhibit
  against the slice's scenarios. A failing verdict spends the attempt of Green or the Builder; a
  passing one sends the slice's findings to its dispositions.
- **Land**: the slice's test lines are locked, its passing tests and exhibits kept.
- **Substitute.** A slice with no red (a refactor, configuration, UI, docs) declares the broken state
  its tests must fail on instead, and why.
- **Budget.** Three attempts per slice. Each failed try prints the restore to where the retry starts,
  and the next brief says why the attempt was spent. An empty budget goes to the replan, the slice's
  code restored to its base; with no replan left in the cycle, it stops the run.

## The replan

The plan is the session's, so a plan that does not pan out is the session's to change. From any step
of a slice in flight, or at the replan step an empty budget leads to, the session rewrites `plan.json`
and records `replan`. The engine first holds the code to the slice's base, refusing with the restore
while it differs, then approves the plan as the plan step does: every landed slice unchanged, every
criterion realized, only the fields the run's practices read, and something changed. The slice in
flight is dropped, its evidence left in the run directory, and the next slice starts fresh. A replan
may rewrite the slice in flight under the same id, split it, fold it into another, or make it a
substitute where what it tests already holds. No gate attacks a replan; the final gate attacks the
whole change. Each cycle has three replans, every step of a slice shows what is left, and once they
are spent a replan is refused and an empty budget stops the run.

So a person is called in only for what no plan reaches: a need, information the run cannot get or an
effect it may not perform, or a rejection, a design or scaffold only a new one puts right.

## Roles

| Role | Does | Model |
| - | - | - |
| Red, Green, Builder | write a slice's tests and its code | the strongest Claude model for a `broad` slice, the faster for a `contained` one |
| Mutant, Reviewer, Contract Reviewer | name the mutant, review a group, judge a slice or the whole change | the strongest Claude model |
| Adversary | attacks the plan and the final change | another family, over OpenRouter; else a Claude subagent |

The routine's environment may name another model for any role. Every subagent's prompt is one line
naming its brief, which the engine writes to the run directory's `briefs/` with the containment rule
and every answer given, so the session passes on whole what each was told. The engine refuses a
green from the slice's Red, and a mutant or a contract verdict from any of the run's authors. Every
reviewer only proposes findings, and none edits or approves.

With `OPENROUTER_API_KEY` set, the engine sends a gate's request itself, to the Adversary's model, for
at most ten minutes, routed with `require_parameters` and, unless the environment turns it off, `zdr`, so
only zero-data-retention endpoints see the package. Without a key, or when the request fails or its
findings are out of form, a Claude subagent is the Adversary, with the same prompt and package. The
route is pinned at admission, and a gate recorded in an environment that gives another is refused.
The key is never printed or logged.

## Findings

Every review raises findings in one form, `[ { file, line, claim } ]`. Every finding gets a
disposition: **fixed**, **refuted**, **widens** or **handed off**. A refutation stands only on evidence
the engine can find, a line HEAD holds or a test a proof run passed; any other is handed off, and so is
every refutation of a finding the engine raised itself. What is handed off or fixed goes into the
description, and every finding into the calibration log.

The design's scenarios are the bar, and every judge holds the change to them alone: a slice's outcome,
the plan's wording and every finding only point at them. A finding that asks for a case no scenario
describes widens the design: it is handed off as a question for a person, never fixed into a stricter
bar. So a gate's fix names the criterion whose scenario it serves, and the engine refuses one that
names none; a Contract Reviewer fails a slice only for a scenario it does not meet or a defect it
brings.

## Gates

The plan gate attacks the plan before any slice, and the final gate the whole change once the last
slice lands. Each attacks a package the engine builds and the author does not choose: the design, the
plan, at the plan gate the scaffold's diff, at the final gate the cycle's diff since its admission,
and in round 2 what round 1 found and what became of each. A gate has at most two rounds. In round 1 a
finding may be fixed: a plan finding by amending `plan.json`, a final-gate finding by a new slice,
which lands before round 2. A merge taken in at the final gate opens it again at its first round,
carrying in what the interrupted round left unsettled. At the final gate the Contract Reviewer writes a
verdict on every scenario and on every row convergence hands on; an unmet verdict is a finding.

## The final run

The engine's own run of the code at HEAD, in one scratch checkout, before the final gate opens. It
extracts the graph there and holds to it each artifact the extractor can show: a proposed node or edge
and a rename's new id must be there (a proposed node by its own id, or by its code id under the
repository's type words, see [the configuration](config.md#blueprintconfigjson)), a removed one and a rename's old id gone, and the node a
non-renaming modify names still there. It holds the locks, finds the gaps still open, runs every
landed slice's tests again, writing every promised exhibit again, and runs each suite's `all` against
what it passed at the admitted commit. Each thing that does not hold is a finding of the engine's,
citing its line. What ids cannot show goes by name to the Contract Reviewer, or with review off to the
description as unverified, and never passes silently.

## Exhibits

An exhibit is what a person who was not in the session looks at to see the work, written by the
slice's own proof run: a recording, else a screenshot, else the system's own output, never a
harness's verdict. The engine sets `BLUEPRINT_FOREMAN_EXHIBITS` for every suite and exhibit command it
runs; a promised exhibit not written sends the slice back. Settle requires every recorded exhibit
committed at HEAD as it was written.

## Settle

The session writes `pr-notes.md` with exactly `## Decisions`, `## Deferrals` and, with lessons on,
`## Lessons`, and records it. A lesson lands in one commit, the last since the final gate, touching
only the lesson homes present when the run started. The engine then joins the description,
`<docsRoot>/<KEY>/pull-request.md`: the session's sections, each scenario's verdict, every exhibit
linked by commit on GitHub (`origin` must name the repository), the practices, every gate round, the
handed-off findings and the lessons. The settled run-state commit carries it and signals `done`, on
which Steward merges F into B and posts the description on the item's one pull request. The run opens
no pull request.

## What the engine cannot check

What stays trusted, each a way a session, a subagent or Blueprint could pass the engine something
false:

- The session runs the engine as it is told, and makes the commits it prints; one that makes them
  without the engine is caught by nothing here. The harness's own clone is out of the item's
  repository, so no commit on F changes it.
- The run state's records F holds no source for: records made since the last run-state commit,
  history rewritten and force-pushed, and what the run state appends (its history, its answers).
- The accepted commit may move forward along F, so a forged one can pass unaccepted work as accepted.
- A line inserted between a landed test's lines, as an early `return`, passes both locks; the
  scaffold's token lock admits code inserted within a locked line, by design.
- A rejection is checked for form, each citation existing, never for truth.
- The description as committed is what Steward posts; the engine writes it at settle and checks it no
  further.
- The session can make the keyed Adversary's request fail and write the fallback findings itself; the
  description shows each round's Adversary.
- Every subagent's work reaches the engine through the session, checked for form, evidence and
  distinct agent ids, never for who wrote it.
- Code under test sees `BLUEPRINT_FOREMAN_EXHIBITS` and can write its own exhibit; only the Contract
  Reviewer judges what one shows.
- A suite's `all` holds a test in its admitted form only where its report names the test's file.
- A merge's resolution is taken on trust and judged only as merged code; a newer scaffold on B is
  Blueprint's word that the design changed.
- The scaffold compiles and each gap fails at run time with `TODO(scaffold)` in its message;
  otherwise Red's tests fail to load, which is not red, and the run spends its attempts and stops.
