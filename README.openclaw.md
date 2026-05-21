# lossless-claw (pi-port fork)

> **Status: work in progress.** This is a personal fork of
> [`@martian-engineering/lossless-claw`](https://github.com/Martian-Engineering/lossless-claw),
> being retargeted from [OpenClaw](https://github.com/openclaw/openclaw) to
> [pi](https://github.com/earendil-works/pi). The extension is **not yet
> runnable as a pi extension**; only the host-agnostic engine and tests are
> currently green.

Lossless Context Management is a DAG-based conversation summarization system based on the [LCM paper](https://papers.voltropy.com/LCM) from [Voltropy](https://x.com/Voltropy). Instead of truncating older messages when a conversation grows past the model's context window, LCM summarizes them into a hierarchy of summary nodes while keeping every original message in a SQLite database. Agents can recall and expand any summary via dedicated tools.

For the full design rationale, paper reference, the animated explainer at [losslesscontext.ai](https://losslesscontext.ai), and the OpenClaw-targeted documentation, see [`README.openclaw.md`](./README.openclaw.md).

## What's in this fork

- The host-agnostic core (engine, stores, assembler, summarizer, retrieval, compaction, tools, doctor) is preserved from the upstream and passes 775 tests.
- The OpenClaw plugin entrypoint, manifest, host bridge, gateway/subagent integrations, and Dockerfile have been removed.
- A pi extension adapter is being built under `src/pi/` in phased work tracked on the `pi-port` branch.
- Sub-agent-delegated `lcm_expand` was dropped. `lcm_expand` will be re-implemented as an in-process summarizer call.

## Roadmap

The port is being delivered in phases. See [`CHANGELOG.md`](./CHANGELOG.md) for current state.

| Phase | Scope | Status |
|---|---|---|
| 0 | Fork hygiene: strip OpenClaw surface, keep engine + tests green | ✅ done |
| 1 | `src/pi/` scaffold: config, session-keys, LLM adapter, DB lifecycle, smoke event handler | next |
| 2 | Assemble + compact wiring (`context`, `session_before_compact`) | |
| 3 | Port the four `lcm_*` tools to pi `registerTool` shape | |
| 4 | `/lcm`, `/lcm status`, `/lcm backup`, `/lcm rotate`, `/lcm doctor` commands | |
| 5 | Restore pi-shaped tests for the adapter surface | |
| 6 | Build, packaging, local install instructions, docs sync | |

## Architecture overview

- One **user-wide** SQLite database (default location to be finalized in Phase 1: `~/.pi/agent/extensions/lossless-claw/lcm.db`).
- One **conversation row per pi session**, keyed on the session header's `sessionId` so renames or moves do not break recall.
- Two pi sessions in the same project are isolated by `conversation_id`.

See [`docs/`](./docs/) for the inherited configuration and architecture references. These still describe the OpenClaw build in several places and will be revised in Phase 6.

## License

MIT, inherited from the upstream. See [`LICENSE`](./LICENSE).
