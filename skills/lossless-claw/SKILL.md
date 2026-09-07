---
name: lossless-claw
description: Configure, diagnose, and use the lossless-claw pi extension, including durable recall and summary health.
---

# Lossless Claw for pi

Use this skill for operating, tuning, or debugging the `lossless-claw` pi extension.

1. For a health check, use `/lcm` or `/lcm status`.
2. For summary-marker problems, use `/lcm doctor`; `/lcm doctor apply` is the explicit repair action.
3. For cleanup, run `/lcm doctor clean` first. Only recommend `/lcm doctor clean apply` when the user explicitly wants deletion; it asks for confirmation and backs up first.
4. For exact compacted-history evidence, use `lcm_grep`, then `lcm_describe` with a `sum_*` or `file_*` ID.
5. Read the relevant reference before giving configuration or lifecycle advice.

Reference map:

- Complete configuration: `references/config.md`
- Data model and assembly: `references/architecture.md`
- Commands and summary health: `references/diagnostics.md`
- Recall tools: `references/recall-tools.md`
- pi session identity and rotation: `references/session-lifecycle.md`

Do not claim that `lcm_expand` or `lcm_expand_query` is available: the pi port currently registers only `lcm_grep` and `lcm_describe`.
