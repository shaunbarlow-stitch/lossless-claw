# Repository Instructions

This repo is a **fork** of [`@martian-engineering/lossless-claw`](https://github.com/Martian-Engineering/lossless-claw), retargeted from OpenClaw to **pi** (the Earendil coding-agent host). Active work happens on the `pi-port` branch until parity with the original feature set is reached.

## Principles

- Lossless means lossless. Do not delete, purge, truncate, or otherwise discard persisted user data unless the user has explicitly invoked a command or approved an action whose purpose is to remove that data.
- Automatic maintenance, bootstrap, repair, migration, compaction, cleanup, or rotation code must preserve user data. If continuity is uncertain, prefer degraded coverage, stale markers, warnings, or follow-up repair work over destructive recovery.
- Backups are not a substitute for this rule. The live system must not rely on being able to restore user data after an automatic delete.
- **Ephemeral pi sessions** (sessions pi itself never persisted to a session file) may be pruned at `session_shutdown` when the user has not opted out. This is a narrow exception: the data was never persisted by the host, and the prune behavior is gated on the `pruneEphemeralOnShutdown` config flag (default `true`). Any other automatic eviction or compaction-side delete remains forbidden.

## Scope Of The Fork

- The pi adapter lives under `src/pi/` (added in Phase 1 of the port; not yet present).
- The engine, stores, assembler, summarizer, retrieval, compaction, doctor, and tools are intentionally host-agnostic and consume `LcmDependencies` from `src/types.ts`. Avoid introducing OpenClaw-specific symbols, manifests, or runtime imports back into these modules.
- Sub-agent-delegated `lcm_expand` was removed during the fork. If you need expansion-style summarization for `lcm_expand`, implement it in-process via the existing summarizer entrypoints.

## Pi Host Compatibility

- The supported pi version is declared in `package.json` `dependencies` for `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-agent-core`. When a change depends on a newer pi event, extension API method, or capability, raise those minimum versions in the same change and update `package-lock.json` with `npm install --package-lock-only`.
- Document the minimum pi version in user-facing docs whenever raising it, and explain the fallback path for users who cannot upgrade yet.
- Add or update a regression test when adding a new pi capability dependency so that drift is caught before release.

## PR Review And Merge

- Before merging a PR, check whether it changes user-facing behavior or should appear in release notes.
- If yes, a maintainer adds a `.changeset/*.md` file (or appends an `Unreleased` entry to `CHANGELOG.md`) before merge or immediately after in a follow-up PR.
- Use the smallest appropriate bump:
  - `patch`: fixes, compatibility work, docs-visible behavior changes
  - `minor`: new features or notable new behavior
  - `major`: breaking changes
- Treat a PR as not release-ready until the changelog question has been answered.

## Release Notes Source Of Truth

- Follow [RELEASING.md](./RELEASING.md) for the repo's current workflow. Note that the npm publish flow inherited from the upstream is currently disabled in this fork — see RELEASING.md for the local-install workflow used during the pi port.
- Pre-fork releases (OpenClaw line) are recorded in [`CHANGELOG.openclaw-history.md`](./CHANGELOG.openclaw-history.md) for provenance only.

## Config Schema Sync

- Whenever you add, rename, or remove a config option in [`src/db/config.ts`](./src/db/config.ts) or in the pi-side config loader (`src/pi/config.ts`, added in Phase 1), update [`docs/configuration.md`](./docs/configuration.md) in the same change.
- Keep [`docs/configuration.md`](./docs/configuration.md) exhaustive and current. When config keys, aliases, defaults, or precedence rules change, update the reference tables and the full example config block in the same change.
- Keep [`skills/lossless-claw/references/config.md`](./skills/lossless-claw/references/config.md) consistent with [`docs/configuration.md`](./docs/configuration.md) and the runtime defaults in [`src/db/config.ts`](./src/db/config.ts). When config keys, aliases, defaults, or precedence rules change, update that bundled skill reference in the same change.
- Add or update a regression test when changing config options so schema drift is caught before release.

## Data Model Reminders

- The LCM database lives at a **user-scoped** path (default to be set in Phase 1 under `~/.pi/agent/extensions/lossless-claw/lcm.db`). One database can hold many `conversations` rows; each pi session maps to exactly one conversation row.
- Session identity uses pi's session-header `sessionId`, not the on-disk file path. Renaming or moving a session file must not break recall.
- Two pi sessions in the same project must be isolated. The engine's `conversation_id` is the isolation boundary; do not bypass it.
