# Configuration

Lossless Claw for pi reads a JSON object from `~/.pi/agent/extensions/lossless-claw/config.json`. Set `LCM_CONFIG_PATH` to use another file. Missing files are valid: runtime defaults are used.

Precedence, highest first:

1. `LCM_*` environment variables (and `TZ` for timezone)
2. JSON config file
3. pi defaults in [`src/pi/config.ts`](../src/pi/config.ts), then engine defaults in [`src/db/config.ts`](../src/db/config.ts)

The pi factory has no host settings payload, so OpenClaw `plugins.entries.*` configuration is not used by this fork.

## Full example

All keys are optional. This is a complete starting point; delete values you do not need.

```json
{
  "databasePath": "/Users/alice/.pi/agent/extensions/lossless-claw/lcm.db",
  "largeFilesDir": "/Users/alice/.pi/agent/extensions/lossless-claw/files",
  "pruneEphemeralOnShutdown": true,
  "enabled": true,
  "ignoreSessionPatterns": [], "statelessSessionPatterns": [], "skipStatelessSessions": true,
  "contextThreshold": 0.75, "freshTailCount": 64, "freshTailMaxTokens": 24000,
  "promptAwareEviction": false, "stubLargeToolPayloads": false, "newSessionRetainDepth": 2,
  "leafMinFanout": 8, "condensedMinFanout": 4, "condensedMinFanoutHard": 2,
  "sweepMaxDepth": 1, "incrementalMaxDepth": 1, "leafChunkTokens": 20000,
  "summaryPrefixTargetTokens": 20000, "maxSweepIterations": 12,
  "sweepDeadlineMs": 120000, "compactUntilUnderDeadlineMs": 300000,
  "bootstrapMaxTokens": 6000, "leafTargetTokens": 2400, "condensedTargetTokens": 2000,
  "maxExpandTokens": 4000, "largeFileThresholdTokens": 25000,
  "summaryProvider": "", "summaryModel": "",
  "largeFileSummaryProvider": "", "largeFileSummaryModel": "",
  "expansionProvider": "", "expansionModel": "", "delegationTimeoutMs": 120000,
  "summaryTimeoutMs": 60000, "timezone": "America/Los_Angeles",
  "pruneHeartbeatOk": false, "transcriptGcEnabled": false,
  "proactiveThresholdCompactionMode": "deferred", "maxAssemblyTokenBudget": 30000,
  "summaryMaxOverageFactor": 3, "customInstructions": "",
  "circuitBreakerThreshold": 5, "circuitBreakerCooldownMs": 1800000,
  "fallbackProviders": [{ "provider": "anthropic", "model": "claude-sonnet-4-5" }],
  "autoRotateSessionFiles": { "enabled": true, "createBackups": false, "sizeBytes": 2097152, "startup": "rotate", "runtime": "rotate" },
  "cacheAwareCompaction": { "enabled": true, "cacheTTLSeconds": 300, "maxColdCacheCatchupPasses": 2, "hotCachePressureFactor": 4, "hotCacheBudgetHeadroomRatio": 0.2, "coldCacheObservationThreshold": 3, "criticalBudgetPressureRatio": 0.9 },
  "dynamicLeafChunkTokens": { "enabled": true, "max": 40000 }
}
```

`largeFileThresholdTokens` is an accepted alias for the runtime key `largeFileTokenThreshold`. `dbPath` is an alias for `databasePath`.

## Storage and pi behavior

| Key | Default | Environment override | Notes |
| --- | --- | --- | --- |
| `databasePath` / `dbPath` | `~/.pi/agent/extensions/lossless-claw/lcm.db` | `LCM_DATABASE_PATH` | User-wide SQLite database. |
| `largeFilesDir` | sibling `files/` directory | `LCM_LARGE_FILES_DIR` | Externalized payload storage. |
| `pruneEphemeralOnShutdown` | `true` | none | Reserved for host sessions pi never persisted. Pruning is currently log-only. |
| `enabled` | `true` | `LCM_ENABLED` | Disables engine behavior without uninstalling. |
| `ignoreSessionPatterns` | `[]` | `LCM_IGNORE_SESSION_PATTERNS` | Session-key globs excluded from LCM. |
| `statelessSessionPatterns` | `[]` | `LCM_STATELESS_SESSION_PATTERNS` | Read-only session-key globs. |
| `skipStatelessSessions` | `true` | `LCM_SKIP_STATELESS_SESSIONS` | Enforces stateless patterns. |
| `timezone` | `TZ` or system zone | `TZ` | IANA zone used in summaries. |

Persisted pi sessions are keyed as `pi:<session-header-id>`. Moving or renaming the JSONL file does not change LCM identity. Different pi sessions always use separate conversation rows.

## Compaction and assembly

| Keys | Environment override(s) | Purpose |
| --- | --- | --- |
| `contextThreshold`, `freshTailCount`, `freshTailMaxTokens` | `LCM_CONTEXT_THRESHOLD`, `LCM_FRESH_TAIL_COUNT`, `LCM_FRESH_TAIL_MAX_TOKENS` | When to compact and how much recent raw history stays. |
| `promptAwareEviction`, `stubLargeToolPayloads` | `LCM_PROMPT_AWARE_EVICTION_ENABLED`, `LCM_STUB_LARGE_TOOL_PAYLOADS` | Optional relevance-based packing and large-output stubbing. |
| `leafChunkTokens`, `leafTargetTokens`, `condensedTargetTokens` | `LCM_LEAF_CHUNK_TOKENS`, `LCM_LEAF_TARGET_TOKENS`, `LCM_CONDENSED_TARGET_TOKENS` | Summary chunk and target sizes. |
| `leafMinFanout`, `condensedMinFanout`, `condensedMinFanoutHard` | `LCM_LEAF_MIN_FANOUT`, `LCM_CONDENSED_MIN_FANOUT`, `LCM_CONDENSED_MIN_FANOUT_HARD` | DAG condensation fanout. |
| `sweepMaxDepth` / `incrementalMaxDepth`, `maxSweepIterations` | `LCM_SWEEP_MAX_DEPTH`, `LCM_INCREMENTAL_MAX_DEPTH`, `LCM_MAX_SWEEP_ITERATIONS` | Full-sweep depth and work cap. |
| `summaryPrefixTargetTokens`, `maxAssemblyTokenBudget` | `LCM_SUMMARY_PREFIX_TARGET_TOKENS`, `LCM_MAX_ASSEMBLY_TOKEN_BUDGET` | Optional assembled-prefix and hard-context caps. |
| `bootstrapMaxTokens`, `newSessionRetainDepth` | `LCM_BOOTSTRAP_MAX_TOKENS`, `LCM_NEW_SESSION_RETAIN_DEPTH` | Bootstrap import and retained summary depth. |
| `sweepDeadlineMs`, `compactUntilUnderDeadlineMs` | `LCM_SWEEP_DEADLINE_MS`, `LCM_COMPACT_UNTIL_UNDER_DEADLINE_MS` | Compaction time budgets. |
| `proactiveThresholdCompactionMode` | `LCM_PROACTIVE_THRESHOLD_COMPACTION_MODE` | `deferred` (default) or legacy `inline`. |
| `summaryMaxOverageFactor` | `LCM_SUMMARY_MAX_OVERAGE_FACTOR` | Largest permitted summary/target ratio. |

Pi does not yet intercept `session_before_compact`; pi's own compaction can still run. LCM persists finalized messages first, so this does not discard LCM history.

## Models, files, and resilience

| Keys | Environment override(s) | Purpose |
| --- | --- | --- |
| `summaryProvider`, `summaryModel` | `LCM_SUMMARY_PROVIDER`, `LCM_SUMMARY_MODEL` | pi provider/model for regular summaries. Empty values use the active pi model. |
| `largeFileSummaryProvider`, `largeFileSummaryModel` | `LCM_LARGE_FILE_SUMMARY_PROVIDER`, `LCM_LARGE_FILE_SUMMARY_MODEL` | Override for large-file summarization. |
| `fallbackProviders` | `LCM_FALLBACK_PROVIDERS` (`provider/model,...`) | Fallback summary models. |
| `summaryTimeoutMs`, `circuitBreakerThreshold`, `circuitBreakerCooldownMs` | `LCM_SUMMARY_TIMEOUT_MS`, `LCM_CIRCUIT_BREAKER_THRESHOLD`, `LCM_CIRCUIT_BREAKER_COOLDOWN_MS` | Summary failure handling. |
| `largeFileTokenThreshold` / `largeFileThresholdTokens` | `LCM_LARGE_FILE_TOKEN_THRESHOLD` | Externalize payloads above this token count. |
| `customInstructions` | `LCM_CUSTOM_INSTRUCTIONS` | Text appended to summary prompts. |
| `pruneHeartbeatOk`, `transcriptGcEnabled` | `LCM_PRUNE_HEARTBEAT_OK`, `LCM_TRANSCRIPT_GC_ENABLED` | Opt-in engine maintenance. |

`expansionProvider`, `expansionModel`, `maxExpandTokens`, and `delegationTimeoutMs` remain accepted for compatibility, but pi does not register gateway/subagent expansion tools yet.

`autoRotateSessionFiles`, `cacheAwareCompaction`, and `dynamicLeafChunkTokens` remain accepted engine configuration. Startup auto-rotation has no pi session-candidate source; use explicit `/lcm rotate` when transcript rotation is needed.

## Commands and safety

- `/lcm backup` creates a timestamped SQLite backup.
- `/lcm rotate` creates a backup, then rewrites only the active persisted transcript tail; the conversation row and summary DAG remain.
- `/lcm doctor` scans the active conversation; `/lcm doctor apply` repairs marked summaries.
- `/lcm doctor clean` only scans. `/lcm doctor clean apply` requires confirmation and creates a backup before deletion.

Never delete `lcm.db` or its `files/` sibling to troubleshoot. Use `/lcm doctor`, `/lcm backup`, and explicit repair/cleanup commands instead.
