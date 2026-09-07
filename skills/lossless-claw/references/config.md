# Lossless Claw pi configuration

The authoritative complete reference is [`docs/configuration.md`](../../../docs/configuration.md). This bundled reference records the pi-specific rules that matter when assisting users.

## Location and precedence

Configuration is a JSON object at:

```text
~/.pi/agent/extensions/lossless-claw/config.json
```

`LCM_CONFIG_PATH` chooses another JSON file. Precedence is:

1. `LCM_*` environment variables (`TZ` for timezone)
2. JSON config file
3. pi defaults in `src/pi/config.ts`, then engine defaults in `src/db/config.ts`

Pi does not pass an OpenClaw-style plugin settings object. Do not recommend `plugins.entries.lossless-claw.config`.

## Storage defaults

| Key | Default | Environment |
| --- | --- | --- |
| `databasePath` (`dbPath` alias) | `~/.pi/agent/extensions/lossless-claw/lcm.db` | `LCM_DATABASE_PATH` |
| `largeFilesDir` | `~/.pi/agent/extensions/lossless-claw/files` | `LCM_LARGE_FILES_DIR` |
| `pruneEphemeralOnShutdown` | `true` | none |

The ephemeral-prune option is currently log-only because the engine lacks a safe single-conversation prune entrypoint.

## High-impact controls

- `contextThreshold` (`LCM_CONTEXT_THRESHOLD`): compaction threshold; default `0.75`.
- `freshTailCount` (`LCM_FRESH_TAIL_COUNT`): newest raw messages; default `64`.
- `leafChunkTokens` (`LCM_LEAF_CHUNK_TOKENS`): leaf summary input size; default `20000`.
- `summaryProvider` / `summaryModel`: summary model override; otherwise the active pi model is used.
- `maxAssemblyTokenBudget`: optional assembly ceiling.
- `customInstructions`: text appended to summarizer prompts.
- `ignoreSessionPatterns` and `statelessSessionPatterns`: session-key glob controls.

All remaining accepted engine keys, aliases, nested objects, defaults, and environment variable names are listed in the complete reference.

## Operational facts

- Persisted session identity is `pi:<session-header-id>`, never a file path.
- `/lcm rotate` is explicit transcript maintenance: it creates a backup and keeps the same LCM conversation and summary DAG.
- `/lcm backup` makes a timestamped backup.
- `/lcm doctor clean` scans only. Its `apply` form requires confirmation and a backup.
- `lcm_expand` and `lcm_expand_query` configuration remains accepted for compatibility but those tools are not available in pi yet.
