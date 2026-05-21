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

### Added

- Nothing user-facing yet; the pi adapter is not wired up.

### Internal

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
