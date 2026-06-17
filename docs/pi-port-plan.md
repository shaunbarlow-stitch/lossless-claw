# Lossless-Claw → pi Port Plan

Status tracker for the fork retargeting `@martian-engineering/lossless-claw`
(OpenClaw plugin) to a **pi extension**, hosted at
`git@github.com:shaunbarlow-stitch/lossless-claw.git` on the `pi-port` branch.

Last updated: after Phase 3.

---

## Locked decisions

| Decision | Choice |
|---|---|
| Distribution | Hard fork, local only. No npm publish during the port. |
| Namespace (if/when published) | `@shaunbarlow/lossless-claw` |
| Dual-host? | No. OpenClaw surface removed entirely. |
| Subagent expansion | **Dropped.** `lcm_expand` / `lcm_expand_query` not wired. In-process replacement is later-phase work. |
| Config | Fresh start, OpenClaw-shape-preserving where practical. |
| DB location | **User-wide:** `~/.pi/agent/extensions/lossless-claw/lcm.db` (+ sibling `files/`). |
| Session isolation | One `conversations` row per pi session, keyed on the session-header `id`. |
| Session identity | Opaque + rename-safe: `pi:<sessionHeaderId>`. Never the file path, never pi's transient in-memory id. |
| Ephemeral sessions | Prunable at shutdown, gated on `pruneEphemeralOnShutdown` (default `true`). Currently log-only pending an engine entrypoint. |
| Branch strategy | Work on `pi-port` until parity, then merge to `main`. |
| History | Upstream `CHANGELOG.md` preserved as `CHANGELOG.openclaw-history.md`. Fresh `CHANGELOG.md` from `1.0.0-pi.0`. |

---

## Architecture

The engine, stores, assembler, summarizer, retrieval, compaction, doctor, and
tools are host-agnostic and consume `LcmDependencies` from `src/types.ts`. The
pi-specific glue lives under `src/pi/`.

```
src/
├── engine.ts              host-agnostic (9k LOC, unchanged)
├── assembler.ts           host-agnostic
├── compaction.ts          host-agnostic
├── summarize.ts           host-agnostic
├── retrieval.ts           host-agnostic
├── host-types.ts          local types (was openclaw-bridge.ts)
├── db-backup.ts           moved from src/plugin/
├── doctor/                moved from src/plugin/ (shared, apply, cleaners)
├── store/, db/            host-agnostic
├── tools/                 upstream tool factories (host-agnostic)
└── pi/                    ← pi adapter (the port)
    ├── config.ts          pi config loader, user-wide DB defaults
    ├── session-keys.ts    rename-safe session identity helpers
    ├── llm-adapter.ts     CompleteFn over pi-ai.complete + ModelRegistry
    ├── deps.ts            builds LcmDependencies; callGateway stub
    ├── shared-init.ts     per-DB-path engine/connection refcount
    ├── tools.ts           registers lcm_grep, lcm_describe
    └── index.ts           extension factory + event handlers
```

### Event mapping (pi → engine)

| pi event | Engine call | Status |
|---|---|---|
| `resources_discover` | contribute skill paths | ✅ Phase 1 |
| `session_start` | record session, defer bind/bootstrap | ✅ Phase 1/2 |
| `message_end` | `engine.ingest()` | ✅ Phase 1 |
| `context` | `engine.assemble()` → replace messages | ✅ Phase 2 |
| `before_agent_start` | apply `systemPromptAddition` | ✅ Phase 2 |
| `session_shutdown` | refcount release; prune (log-only) | ✅ Phase 1 (prune deferred) |
| `session_before_compact` | `engine.compact()` | ❌ deferred |
| tool calls | `pi.registerTool` for lcm_grep/lcm_describe | ✅ Phase 3 |
| `/lcm*` commands | `pi.registerCommand` | ❌ Phase 4 |

---

## Phase log

### Phase 0 — Fork hygiene ✅ (`99d268b`)

Stripped the OpenClaw surface, kept the engine + tests green.

- Removed `src/plugin/` (index, lcm-command, shared-init),
  `openclaw.plugin.json`, `Dockerfile`, `doctor-contract-api.{d.ts,js}`,
  top-level `index.ts`, `README_zh.md`.
- Removed 8 OpenClaw-coupled test suites (plugin registration, prompt-hook,
  manifest, command, runtime-llm-complete, package-metadata,
  doctor-contract-api, expand-tool delegation).
- Moved `src/plugin/lcm-db-backup.ts` → `src/db-backup.ts`;
  `src/plugin/lcm-doctor-*.ts` → `src/doctor/*.ts`.
- Renamed `src/openclaw-bridge.ts` → `src/host-types.ts`; dropped the
  `openclaw/plugin-sdk` re-export, defined `AnyAgentTool` locally.
- `src/lcm-log.ts`: replaced `createLcmLogger(api)` with
  `createConsoleLcmLogger()`.
- `package.json`: renamed `@shaunbarlow/lossless-claw`, `1.0.0-pi.0`,
  `private: true`, removed openclaw block/peerDeps, dropped esbuild/goreleaser
  scripts.
- Rewrote `AGENTS.md` (pi-targeted), `README.md` (fork banner + roadmap;
  old README → `README.openclaw.md`), `RELEASING.md` (local-install only).
- Started fresh `CHANGELOG.md`; preserved upstream history in
  `CHANGELOG.openclaw-history.md`.
- **Result:** 775/775 tests pass.

### Phase 1 — Adapter scaffold ✅ (`89bccd8`)

Extension loads, DB opens, lifecycle wired (no assemble/compact yet).

- `src/pi/config.ts`, `session-keys.ts`, `llm-adapter.ts`, `deps.ts`,
  `shared-init.ts`, `index.ts`.
- `package.json` `pi.extensions` entry → `./src/pi/index.ts`.
- Handlers: `resources_discover`, `session_start`, `message_end`,
  `session_shutdown`, plus a placeholder `/lcm-status` command.
- Bootstrap deferred to first ingest (pi flushes the session header late).
- **Runtime-verified:** `pi --mode rpc` opens the user-wide DB, runs all 33
  migrations (FTS5 included), fires lifecycle, shuts down cleanly.

### Phase 2 — Assemble + persistence ✅ (`caf39a1`)

- `context` → `engine.assemble()` swaps pi's per-turn message list for the
  DAG-aware reconstruction.
- `before_agent_start` applies the assembler's `systemPromptAddition`.
- **Fixed:** sessionKey now derived strictly from the session-file header id
  (pi's print-mode in-memory id differs and was causing first-run + resume to
  land on two conversation rows). `ensureSessionBound()` defers engine work
  until the file appears.
- **Runtime-verified** with a 3-run smoke test: one `conversation_id`, six
  contiguous messages, correct cross-turn recall. Lossless guarantee survives
  pi's print-mode shutdown gap (messages persist in pi's JSONL, imported on
  resume via `engine.bootstrap()`).

### Phase 3 — LCM tools ✅ (`c32be0d`)

- `src/pi/tools.ts` registers `lcm_grep` and `lcm_describe` via
  `pi.registerTool`, with `promptSnippet` + `promptGuidelines`.
- Each `execute` rebuilds the upstream tool with the live session binding.
- `lcm_expand` / `lcm_expand_query` intentionally unregistered (subagent /
  gateway dependent).
- **Runtime-verified:** model called `lcm_grep` twice + `lcm_describe` once,
  recovered a verbatim prompt from three runs earlier. Full
  LLM → adapter → factory → engine → SQLite → LLM round-trip works.

---

## Outstanding work

### Phase 4 — Command surface (next, largest remaining phase)

Port the `/lcm` command family to `pi.registerCommand`. The upstream
`src/plugin/lcm-command.ts` (2.3k LOC) was deleted in Phase 0, so the
subcommand dispatch must be re-implemented, but the underlying helpers
survive (`src/doctor/*.ts`, `src/db-backup.ts`, engine methods).

- [ ] `/lcm` (or `/lcm status`): version, DB path + size, active conversation
      row, summary counts, doctor health, deferred compaction debt.
- [ ] `/lcm backup`: timestamped DB backup (reuse `db-backup.ts`).
- [ ] `/lcm rotate`: rewrite the active session transcript tail (reuse
      `engine.rewriteTranscriptForRotate`).
- [ ] `/lcm doctor` and `/lcm doctor clean`: scan/clean (reuse `src/doctor/*`).
- [ ] Replace the placeholder `/lcm-status` command from Phase 1.
- [ ] Argument autocompletion for subcommands (optional).

### Phase 3.5 / later — in-process expansion (optional)

- [ ] Re-implement `lcm_expand` as an in-process summarizer call (read source
      messages from the DB, run one `complete()` with an expansion prompt).
- [ ] Decide whether `lcm_expand_query` is worth reviving without a subagent.
- [ ] Remove the now-unused `src/tools/lcm-expand-tool.delegation.ts` and the
      `callGateway` stub if expansion no longer needs them.

### Phase 5 — Tests for the adapter surface

Engine-shaped tests already pass (775). The adapter needs its own coverage.

- [ ] `src/pi/config.ts`: defaults, env precedence, overlay parsing.
- [ ] `src/pi/session-keys.ts`: persisted vs ephemeral, header-id derivation.
- [ ] `src/pi/llm-adapter.ts`: message coercion, model resolution, auth/error
      paths (mock ModelRegistry + pi-ai).
- [ ] `src/pi/shared-init.ts`: refcount acquire/release, shutdown-on-last.
- [ ] Event-ordering: ingest → assemble → shutdown lifecycle.
- [ ] Session isolation: two sessions in one project stay on separate
      conversation rows.
- [ ] Reload DB lifecycle; ephemeral cleanup once implemented.

### Phase 6 — Packaging, docs, install

- [ ] Build/bundling decision (jiti loads `.ts` directly today; decide if a
      `dist/` build is needed for distribution).
- [ ] Local-install instructions verified end-to-end (symlink into
      `~/.pi/agent/extensions/lossless-claw/` or `pi install git:...`).
- [ ] Rewrite `docs/` (still OpenClaw-shaped in places) for pi.
- [ ] `docs/configuration.md` + `skills/lossless-claw/references/config.md`
      synced with `src/pi/config.ts` and `src/db/config.ts` per AGENTS.md.
- [ ] Confirm the bundled skill loads via `resources_discover`.

### Cross-cutting / deferred items

- [ ] **Ephemeral prune** is log-only. Needs a public engine entrypoint to
      drop a single conversation row by sessionKey, then wire into
      `session_shutdown`.
- [ ] **`session_before_compact`** not intercepted. Pi runs its own
      sliding-window compaction in parallel; LCM stays lossless because every
      message is ingested first. Revisit whether intercepting adds value.
- [ ] **Interactive-mode live ingest** unverified. Print mode flushes the
      session file only at shutdown, so the first turn is captured on resume
      rather than live. Interactive mode should flush continuously — needs an
      end-to-end check.
- [ ] **`lcm_describe` id-format UX:** grep labels matches `[msg#N]` but
      describe wants `sum_*` / `file_*`. Upstream prompt nit; tune later.
- [ ] **`fts5=undefined` log line** at migration time: cosmetic upstream bug
      (`fts5Available` computed after the log line).
- [ ] **~698 strict-TS errors** inherited from upstream. `tsc --strict` was
      never the build path; vitest passes. Strict-TS cleanup is not an early
      goal but should be scheduled before any published release.

---

## Verification commands

```bash
# Tests
npm test

# Type-check just the pi adapter (ignore inherited upstream strict errors)
npx tsc --noEmit -p tsconfig.json 2>&1 | rg "src/pi/"

# Load smoke test (no LLM call)
{ echo '{"jsonrpc":"2.0","id":1,"method":"shutdown","params":{}}'; sleep 1; } \
  | LCM_DEBUG=1 pi -e ./src/pi/index.ts --mode rpc

# End-to-end (uses a real model; ~cents of tokens)
pi -e ./src/pi/index.ts -p "..."          # first run
pi -e ./src/pi/index.ts --session <file> -p "..."   # resume

# Inspect the DB
node --experimental-sqlite -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.env.HOME + '/.pi/agent/extensions/lossless-claw/lcm.db');
  console.log(db.prepare('SELECT conversation_id, session_id, session_key, active FROM conversations').all());
  console.log(db.prepare('SELECT seq, role, substr(content,1,80) FROM messages ORDER BY seq').all());
  db.close();
"
```
