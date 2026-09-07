# Changelog

This is the pi-port fork of [`@martian-engineering/lossless-claw`](https://github.com/Martian-Engineering/lossless-claw).
Releases prior to the fork are recorded in [`CHANGELOG.openclaw-history.md`](./CHANGELOG.openclaw-history.md).

## Unreleased — 1.0.0-pi.0 (in development)

### Added (Phase 4 — command surface)

- `/lcm` pi command family: status, timestamped database backup, safe active-session transcript rotation, scoped doctor scan/repair, and global legacy-cleaner scan.
- `/lcm doctor clean apply` requires interactive confirmation before deleting any cleaner candidates and creates a database backup before the mutation.
- Replaced the temporary `/lcm-status` command with `/lcm` argument completion.

### Added (Phase 6 — local install and configuration)

- Local pi-package installation is documented and verified with `pi install .`; no build step is required because pi loads the TypeScript extension through jiti.
- User-editable pi config file at `~/.pi/agent/extensions/lossless-claw/config.json`, with `LCM_CONFIG_PATH` for an alternate path.

### Fixed

- Normalize host-agnostic assembled history back into pi's strict message schema before each model call, preventing intermittent `Cannot read properties of undefined (reading 'length')` failures after tool results.
- Pi config now honors `LCM_DATABASE_PATH` over extension `databasePath`, matching the documented environment-variable precedence.

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

### Added (Phase 3 — LCM tools)

- `src/pi/tools.ts`: wraps the upstream tool factories in pi's
  `ToolDefinition` shape and registers them via `pi.registerTool`.
  Currently registered: `lcm_grep` (FTS5 / regex search across compacted
  history) and `lcm_describe` (fetch a summary or file by id).
- Each pi `execute` call constructs a fresh upstream tool with the active
  pi session's lossless-claw key, so tool scoping reflects the current
  conversation rather than whatever was bound at extension load time.
- `promptSnippet` and `promptGuidelines` populated so the registered tools
  appear in pi's default "Available tools" section and contribute
  tool-specific guidance to the system prompt.

### Not yet registered (Phase 3 scope)

- `lcm_expand` and `lcm_expand_query` remain unregistered. Both rely on
  the OpenClaw gateway subagent protocol (`callGateway`) that was removed
  in Phase 0. `lcm_expand` is additionally gated by the engine to subagent
  sessions, which never exist in the pi build, so even registering it
  would produce a tool that always returned an error. Re-implementing
  these as in-process summarizer calls is a later-phase task.

### Verified at runtime (Phase 3)

Resume run against the conversation built up in Phase 2's tests:

  pi --session <existing.jsonl> -p "Use the lcm_grep tool to find what
   I asked you to reply with in our first turn. Quote the snippet you
   found verbatim."

The model called `lcm_grep` twice (different patterns) and `lcm_describe`
once, with a multi-turn agent loop visible in the assemble traces
(`in=7 → 9 → 11 → 13` as tool-call + tool-result pairs accumulated).
Final answer: `> "Reply only with: phase 2 v2 ok"`, a verbatim quote of
the original user prompt from three runs ago. The full tool round-trip
(LLM → our pi adapter → upstream tool factory → engine → SQLite → LLM)
behaves correctly.

Note: the model passed `msg#1` to `lcm_describe`, which only accepts
`sum_*` or `file_*` ids and returned a clear "Not found" error. This
is a UX gap in the upstream tool's prompting (grep labels matches
`[msg#N]` but describe scopes to summaries/files), not a wiring bug.

### Added (Phase 2 — assemble + persistence)

- `context` event handler in `src/pi/index.ts`. Each LLM call now routes
  through `engine.assemble()`, which substitutes pi's per-turn message list
  with the engine's DAG-aware reconstruction (summaries from the LCM DB +
  recent raw messages). Pi's own sliding-window compaction can still run in
  parallel without correctness impact because every message is also
  persisted via `message_end` ingest.
- `before_agent_start` event handler. Picks up the assembler's optional
  `systemPromptAddition` from the most recent `context` call and appends
  it to pi's chained system prompt for the upcoming turn.
- New `ensureSessionBound()` helper. The lossless-claw `sessionKey` is now
  derived strictly from the file-header id of the pi session file, never
  from pi's transient in-memory session id. Pi's print mode reports
  different values for `ctx.sessionManager.getSessionId()` and the
  eventually-written header id, which previously caused first-run +
  resume to land on two different conversation rows (data was preserved
  but recall didn't bridge across runs). Engine work now defers until the
  session file appears.
- Ephemeral-session detection updated: a session that never produced a
  file is the new definition of "ephemeral" for the prune carve-out,
  replacing the previous prefix-based detection.

### Verified at runtime (Phase 2)

Three-run smoke test against pi 0.75.4:

1. First `pi -p` run: pi flushes the session file only at shutdown in
   print mode, so live binding never happens. No engine work during the
   run; the messages exist only in pi's session JSONL after exit.
2. Resume run (`pi --session <file> -p "..."`): `ensureSessionBound()`
   reads the file header, derives `sessionKey=pi:<headerId>`, and
   `engine.bootstrap()` imports the 2 messages from the first run into
   the LCM DB as `conversation_id=1`. The live turn's user + assistant
   messages are then ingested through `message_end` and the `context`
   event hands the engine's assembled view to the LLM.
3. Second resume run with a recall question across turns: assemble
   returns 5 messages of context; the LLM answers correctly using the
   prior turns. After three runs the DB contains a single conversation
   row and six contiguous messages.

The "lossless" guarantee holds across pi's print-mode shutdown gap
(messages persist in the session file and are picked up on resume).

### Known follow-ups for Phase 3+

- `session_before_compact` is still not wired. Pi can run its own
  sliding-window compaction in parallel without losing data (every
  message is ingested before pi compacts), so this is intentionally
  deferred until the LCM tools (Phase 3) land and we can evaluate
  whether intercepting compaction adds value or just complexity.
- Pi print mode does not flush the session file until shutdown, so the
  first turn of a print-mode invocation is captured by LCM only on the
  subsequent resume via `engine.bootstrap()`. Interactive mode flushes
  continuously and should ingest live; that path has not yet been
  exercised end-to-end.
- Ephemeral-session pruning at `session_shutdown` is still log-only
  pending a public engine entrypoint to drop a single conversation row.
- Engine logs `fts5=undefined` at migration time because the
  `fts5Available` field is computed after the migration log line;
  pre-existing upstream cosmetic bug, scheduled to be revisited later.
- ~698 lines of strict-TS errors remain inherited from upstream
  (`tsc --strict` was never the build path). Tests pass under vitest as
  before. Strict-TS cleanup is not a goal of the early phases.

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
