# agility-agent-plugins

AgilityIO's public plugins for coding agents. Each plugin lives in `plugins/<name>/`; the root
`.claude-plugin/marketplace.json` lists them for Claude Code, and a root `.claude/skills/` entry
points into a plugin whose skill a cloud routine must load from this repository's clone.

| Plugin | What |
| - | - |
| `probe` | Reports how a cloud session sees this repository. |
| `blueprint-foreman` | The harness a cloud agent follows to deliver one designed work item, as [Specification v1](https://github.com/agilityio-us/blueprint-steward/blob/main/docs/specification.md) sets out. |
