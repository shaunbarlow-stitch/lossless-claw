# pi architecture

Lossless Claw is a pi extension layered over a host-agnostic engine.

```text
pi session JSONL → session header ID → pi:<header-id> session key
                                 ↓
                         SQLite conversations row
                                 ↓
message_end ingest → LCM stores raw messages and summary DAG
context event     → LCM assembles replacement model messages
```

The database is user-wide at `~/.pi/agent/extensions/lossless-claw/lcm.db`; one database holds many conversation rows. The conversation row, not project path or session-file path, is the isolation boundary.

`src/pi/index.ts` owns lifecycle glue. `src/pi/llm-adapter.ts` uses pi's active model registry/auth path for summary calls. The engine, stores, retrieval, and summarization modules under `src/` remain host-agnostic.

Every finalized pi message is ingested. If pi compacts its own session context, LCM can still reconstruct from its persisted raw messages and summaries. The active pi compaction hook is not yet customized by LCM.

For exact historical recall, `lcm_grep` searches the active conversation and `lcm_describe` reads known summaries or stored files.
