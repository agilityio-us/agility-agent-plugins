# blueprint-foreman

The harness a cloud agent follows to deliver one designed work item unattended. Like a foreman, it
builds nothing itself: it dispatches a subagent for each role (Red, Green or the Builder, the Mutant,
the Reviewers, the Adversary) and holds their work to the design. Blueprint commits the item's design
and scaffold to the item's branch, B; when the item moves into implementation, Steward fires the
assignee's Claude Code routine with the fire's JSON. The foreman delivers on its own branch, F,
`claude/<B>`, and speaks only through commits there: each ends in the signal Steward reads, and the
last carries the pull request's description and signals `done`.

What crosses between Blueprint and the agent, the fire, the branches, `blueprint.md`, the scaffold,
the signal and the description, is [Specification
v1](https://github.com/agilityio-us/blueprint-steward/blob/main/docs/specification.md). This plugin
is one agent that meets it.

## A routine that runs it

- **Repositories**: the repository the item belongs to, and this one,
  `agilityio-us/agility-agent-plugins`. A routine clones each fresh from its default branch, side by
  side; only this repository's root `.claude/skills/` loads from the second clone, and its
  `blueprint-foreman` skill points into `plugins/blueprint-foreman/`.
- **Saved prompt**, one line:

      Run the blueprint-foreman skill with the fire's text, from the root of the item's repository.

- **Environment**: Node 18 or later and git 2.32 or later on the path, and `sh`; network to the
  package registries the install uses, and to `openrouter.ai` for the Adversary; no permission
  prompts, since no one is there to answer them. Every variable that steers the agent is set here:
  `BLUEPRINT_FOREMAN_PRACTICES` turns practices on, every one off unless named (`all` for every
  one); others name the models and the Adversary, and `OPENROUTER_API_KEY` sends the gates'
  Adversary to another model family, a Claude subagent standing in without it. See [the
  configuration](docs/config.md#the-routines-environment). Set whatever turns off the repository's own
  commit hooks for CI, if it has any, since every commit the engine prints must go through as printed.
- **The item's repository** holds Blueprint's `.blueprint.config.json` (the extractor, and where the
  items' docs live) and the harness's own `.blueprint-foreman.json` (the install, the suites, what
  the extractor sees); see [the configuration](docs/config.md).

## Docs

- [How it works](docs/how-it-works.md): the practices, the steps, the roles, what the skill does and
  what the engine enforces, and what it cannot check.
- [Configuration](docs/config.md): `.blueprint-foreman.json`, the fields it reads of
  `.blueprint.config.json`, and the routine's environment.
- [Terms](docs/glossary.md): every term, once.

The engine's tests are its executable specification, Node's runner and nothing else:

    node --test plugins/blueprint-foreman/test/*.test.mjs
