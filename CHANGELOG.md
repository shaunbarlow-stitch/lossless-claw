# Changelog

This is the pi-port fork of [`@martian-engineering/lossless-claw`](https://github.com/Martian-Engineering/lossless-claw).
Releases prior to the fork are recorded in [`CHANGELOG.openclaw-history.md`](./CHANGELOG.openclaw-history.md).

## Unreleased — 1.0.0-pi.0 (in development)

### Breaking

- Forked from `@martian-engineering/lossless-claw@0.11.2`. Target host changed
  from OpenClaw to pi. The OpenClaw plugin entrypoint, manifest, host bridge,
  and gateway/subagent integrations have been removed. A pi extension adapter
  is being built under `src/pi/`.
- Dropped sub-agent-delegated `lcm_expand` (was implemented via OpenClaw's
  gateway subagent RPC). `lcm_expand` will be re-implemented as an in-process
  summarizer call in a later phase of the port.

### Added (Phase 1 — adapter scaffold)

- `src/pi/config.ts`: pi-side config loader. Layers pi-friendly defaults
  (`~/.pi/agent/extensions/lossless-claw/lcm.db` and a sibling `files/` dir)
  over the inherited LcmConfig resolver. Introduces a small overlay struct
  for pi-specific behaviour, currently `pruneEphemeralOnShutdown`.
- `src/pi/session-keys.ts`: rename-safe session identity. Persisted sessions
  use `pi:<sessionHeaderId>`; ephemeral sessions use `pi:ephemeral:<uuid>`.
  Implements the engine's `parseAgentSessionKey`, `isSubagentSessionKey`,
  `normalizeAgentId`, and `buildSubagentSystemPrompt` hooks (subagent paths
  are stubbed to no-op since they were dropped in Phase 0).
- `src/pi/llm-adapter.ts`: implements the engine's `CompleteFn` over
  `pi-ai.complete()`, resolving the model through pi's `ModelRegistry` and
  threading auth via `getApiKeyAndHeaders`. Provides `ResolveModelFn` too.
- `src/pi/deps.ts`: builds the full `LcmDependencies` struct. `callGateway`
  is a stub that throws because subagent delegation was dropped; all other
  fields are real (or carefully scoped no-ops).
- `src/pi/shared-init.ts`: per-DB-path singleton registry with refcounting,
  so multiple pi sessions sharing the same database file share one engine
  instance and connection.
- `src/pi/index.ts`: extension factory. Registers handlers for
  `resources_discover`, `session_start`, `message_end`, `session_shutdown`,
  plus an `/lcm-status` command. Bootstrap is deferred to the first ingest
  to avoid racing pi's session-header flush.
- `package.json`: registers `./src/pi/index.ts` under the `pi.extensions` key
  so `pi install`-style flows can discover the entry point.

### Verified at runtime (Phase 1)

- `pi -e ./src/pi/index.ts --list-models` loads the factory cleanly.
- `pi -e ./src/pi/index.ts --mode rpc` opens the user-wide DB at
  `~/.pi/agent/extensions/lossless-claw/lcm.db`, runs all 33 LCM migrations
  (including FTS5 indexes), fires `session_start`, derives a session key
  from the pi session header, defers bootstrap until the session file is
  observable, and shuts down cleanly. No ingest or assemble has been driven
  through pi yet because Phase 1 does not require an LLM call.

### Known follow-ups for Phase 2

- `context` event is not yet wired; pi still falls back to its default
  sliding-window compaction.
- `session_before_compact` is not yet wired.
- Ephemeral-session pruning at `session_shutdown` is a no-op pending a
  public engine entrypoint to drop a single conversation row.
- Engine logs `fts5=undefined` at migration time because the
  `fts5Available` field is computed after the migration log line;
  pre-existing upstream cosmetic bug, scheduled to be revisited in Phase 2.
- ~698 lines of strict-TS errors remain inherited from upstream
  (`tsc --strict` was never the build path). Tests pass under vitest as
  before. Strict-TS cleanup is not a Phase 1 goal.

### Internal (Phase 0)

- Engine, stores, assembler, summarizer, retrieval, compaction, tools, and
  doctor logic ported unchanged from the OpenClaw build. 775 engine-shaped
  tests pass.
- `src/plugin/lcm-db-backup.ts` moved to `src/db-backup.ts`.
- `src/plugin/lcm-doctor-{shared,apply,cleaners}.ts` moved to
  `src/doctor/{shared,apply,cleaners}.ts`.
- `src/openclaw-bridge.ts` renamed to `src/host-types.ts`; the
  `openclaw/plugin-sdk` re-export was removed and `AnyAgentTool` is defined
  locally.
- `src/plugin/` removed in full. `openclaw.plugin.json`, `Dockerfile`,
  `doctor-contract-api.{d.ts,js}`, top-level `index.ts`, and the Chinese
  README were also removed.
- OpenClaw-coupled tests removed: plugin registration, prompt-hook, manifest,
  command, runtime-llm-complete, package-metadata, doctor-contract-api, and
  the expand-tool delegation suite. Engine-shaped tests retained intact.
