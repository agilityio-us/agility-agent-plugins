---
name: probe
description: Report how this session sees the agility-agent-plugins repository. Use only when asked to run the probe.
---

Report, as a short table, then stop:

1. Which of these skills appear in your skill list: `probe` (plugin layout) and `probe-root`
   (repository `.claude/skills/`).
2. Your working directory, and the absolute path of the agility-agent-plugins clone.
3. The output of `node <clone>/plugins/probe/bin/probe.mjs`, run as is. If it is blocked or
   refused, quote the refusal word for word.

Change nothing and push nothing.
