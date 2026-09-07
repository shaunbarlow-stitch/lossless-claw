# Diagnostics

## `/lcm` and `/lcm status`

Shows the user-wide DB path and size, global conversation/summary counts, the active conversation, doctor-marker count, and deferred compaction state. A newly created pi session can briefly show as pending until pi writes its session header.

## Summary health

- `/lcm doctor` scans the active conversation for fallback or truncation markers.
- `/lcm doctor apply` explicitly repairs those marked summaries using the normal pi model/auth path.
- `/lcm doctor clean` scans global legacy OpenClaw-era cleaner candidates and does **not** delete anything.
- `/lcm doctor clean apply [filter] [vacuum]` is destructive, asks for interactive confirmation, and creates a DB backup first.

## Common states

**No summaries yet:** the conversation may simply be below the compaction threshold.

**DB is not growing:** confirm `/lcm` reports the expected DB path and that the session does not match ignore/stateless patterns.

**Exact historical fact required:** use `lcm_grep` and then `lcm_describe`; do not infer verbatim facts from summaries.

Pi status/compaction UI measures host context. `/lcm` measures LCM's persisted storage and active conversation, so values can differ.
