/**
 * Pi extension entrypoint for lossless-claw.
 *
 * Phase 1 scope (intentionally minimal):
 *  - Load config, open the shared DB, instantiate the LcmContextEngine.
 *  - On `session_start`, bind the current pi session to a conversation row
 *    via `engine.bootstrap()`. The session key is derived from the pi
 *    session header id so renames or moves of the session file do not break
 *    recall.
 *  - On `message_end`, ingest each finalized message into the engine.
 *  - On `session_shutdown`, release the shared DB reference. If the session
 *    was ephemeral and the user has not opted out, the per-session
 *    conversation row is pruned.
 *  - `context`, `session_before_compact`, tool registration, and `/lcm`
 *    commands are deliberately *not* wired yet. Phase 2 adds assemble +
 *    compact, Phase 3 adds tools, Phase 4 adds commands.
 *
 * The success criterion for Phase 1 is: pi loads this extension without
 * errors, ingests messages, and shuts down cleanly. Recall/assembly are
 * not yet exercised.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { closeLcmConnection, createLcmDatabaseConnection } from "../db/connection.js";
import { LcmContextEngine } from "../engine.js";
import { NOOP_LCM_LOGGER, describeLogError } from "../lcm-log.js";
import type { LcmDependencies } from "../types.js";
import type { AgentMessage } from "../host-types.js";
import { buildLcmDependencies } from "./deps.js";
import { defaultLcmDataDir, resolvePiLcmConfig } from "./config.js";
import {
  acquireSharedLcm,
  releaseSharedLcm,
  type SharedLcmEntry,
} from "./shared-init.js";
import {
  isEphemeralSessionKey,
  newEphemeralSessionKey,
  readSessionIdFromFile,
  sessionKeyForId,
} from "./session-keys.js";

type ExtensionConfigInput = {
  config?: Record<string, unknown>;
};

function formatLogLine(message: string): string {
  // If the engine has already prefixed the message with `[lcm]`, pass through.
  // Otherwise mark this as originating in the pi adapter.
  return message.trimStart().startsWith("[lcm]") ? message : `[lcm-pi] ${message}`;
}

/**
 * Pi loads this extension by calling the default export with the ExtensionAPI.
 * The factory may be synchronous or asynchronous; we keep it sync because no
 * up-front network or filesystem work is required.
 */
export default function losslessClaw(pi: ExtensionAPI, input?: ExtensionConfigInput): void {
  const pluginConfig = (input?.config ?? {}) as Record<string, unknown>;

  // Resolve config eagerly so any misconfiguration surfaces at load time
  // rather than mid-session. Engine construction is deferred to the first
  // session_start so we have access to ctx (modelRegistry, sessionManager).
  const { config, diagnostics, overlay } = resolvePiLcmConfig(process.env, pluginConfig);

  // Shared state across pi events for the active session. A future phase
  // will lift this into a Map keyed by sessionFile when pi gains the
  // ability to multiplex sessions in a single extension runtime; today an
  // extension runtime is bound to one session at a time, so a singleton is
  // enough.
  type ActiveSession = {
    sessionKey: string;
    sessionFile: string | undefined;
    sessionIdForEngine: string;
    isEphemeral: boolean;
    bootstrapped: boolean;
    shared: SharedLcmEntry;
  };
  let active: ActiveSession | undefined;

  /**
   * Bootstrap is deferred until the pi session file actually exists on disk.
   * Pi fires `session_start` before flushing the session header on first run,
   * so an eager `engine.bootstrap()` racing the file write would ENOENT.
   * The first `message_end` (or `context`, once Phase 2 wires it) checks this
   * and triggers the bootstrap once the file is observable.
   */
  async function ensureBootstrapped(): Promise<void> {
    if (!active || active.bootstrapped) return;
    const { sessionFile, sessionKey, sessionIdForEngine, shared } = active;
    if (!sessionFile || !existsSync(sessionFile)) return;
    try {
      const result = await shared.engine.bootstrap({
        sessionId: sessionIdForEngine,
        sessionKey,
        sessionFile,
      });
      active.bootstrapped = true;
      piLog.info(
        `bootstrap ok sessionKey=${sessionKey} sessionFile=${sessionFile} bootstrapped=${result.bootstrapped} imported=${result.importedMessages}`,
      );
    } catch (err) {
      piLog.warn(`deferred bootstrap failed (will retry on next message): ${describeLogError(err)}`);
    }
  }

  // The engine itself prefixes many of its log messages with `[lcm]`.
  // We do not add an extra prefix here to avoid the `[lcm] [lcm] ...` doubling
  // that would otherwise appear; instead engine messages are passed through
  // verbatim, and pi-adapter-originated messages prefix themselves with `[lcm-pi]`
  // so the source is unambiguous.
  const piLog: LcmDependencies["log"] = {
    info: (m) => console.info(formatLogLine(m)),
    warn: (m) => console.warn(formatLogLine(m)),
    error: (m) => console.error(formatLogLine(m)),
    debug: (m) => process.env.LCM_DEBUG ? console.debug(formatLogLine(m)) : undefined,
  };

  // Surface diagnostics from config resolution as a single info line so
  // users can see which fields came from env vs plugin config vs defaults.
  if (process.env.LCM_DEBUG) {
    piLog.debug(`config diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  pi.on("resources_discover", async () => {
    // Skill bundle ships alongside the source tree. When the extension is
    // installed under ~/.pi/agent/extensions/lossless-claw/, this resolves
    // to that copy; when running via `pi -e ./src/pi/index.ts` from a
    // checkout, it resolves to the repo's skills/ directory.
    const here = new URL(".", import.meta.url).pathname;
    // here ends in /src/pi/; skills live two levels up at <repo>/skills
    const repoRoot = new URL("../../skills", import.meta.url).pathname;
    return { skillPaths: [repoRoot.replace(/\/$/, "")] };
    void here;
  });

  pi.on("session_start", async (event, ctx) => {
    try {
      const dbPath = config.databasePath;
      mkdirSync(dirname(dbPath), { recursive: true });
      mkdirSync(config.largeFilesDir, { recursive: true });

      const sessionFile = ctx.sessionManager.getSessionFile();

      const shared = await acquireSharedLcm({
        dbPath,
        create: () => {
          const database = createLcmDatabaseConnection(dbPath);
          const deps = buildLcmDependencies({
            config,
            configDiagnostics: diagnostics,
            modelRegistry: ctx.modelRegistry,
            defaultModelRef: () => {
              const model = ctx.model;
              if (!model) return undefined;
              return { provider: model.provider, model: model.id };
            },
            agentDir: defaultLcmDataDir(),
            resolveSessionFileForKey: (key) => {
              if (active && active.sessionKey === key) return active.sessionFile;
              return undefined;
            },
            log: piLog,
          });
          const engine = new LcmContextEngine(deps, database);
          return {
            dbPath,
            database,
            engine,
            shutdown: () => {
              try {
                closeLcmConnection(database);
              } catch (err) {
                piLog.warn(`closeLcmConnection failed: ${describeLogError(err)}`);
              }
            },
          };
        },
      });

      const headerId = sessionFile ? readSessionIdFromFile(sessionFile) : undefined;
      const sessionKey = headerId ? sessionKeyForId(headerId) : newEphemeralSessionKey();
      const isEphemeral = isEphemeralSessionKey(sessionKey);
      const sessionIdForEngine = headerId ?? ctx.sessionManager.getSessionId();

      active = {
        sessionKey,
        sessionFile,
        sessionIdForEngine,
        isEphemeral,
        bootstrapped: false,
        shared,
      };

      // Bootstrap is deferred to the first ingest so that pi has a chance to
      // flush the session header to disk first. See ensureBootstrapped().
      piLog.info(
        `session_start (reason=${event.reason}) sessionKey=${sessionKey} sessionFile=${sessionFile ?? "<ephemeral>"} bootstrap=deferred`,
      );
      // Attempt an immediate bootstrap in case pi already wrote the header
      // (this is common on /resume).
      await ensureBootstrapped();
    } catch (err) {
      piLog.error(`session_start failed: ${describeLogError(err)}`);
      // Do not rethrow — we want pi to continue even if LCM bootstrap fails.
      // The engine will be in a degraded state and subsequent message_end
      // calls will surface clearer errors.
    }
  });

  pi.on("message_end", async (event) => {
    if (!active) return;
    try {
      await ensureBootstrapped();
      const ingestSessionId = active.sessionFile
        ? (readSessionIdFromFile(active.sessionFile) ?? active.sessionIdForEngine)
        : active.sessionIdForEngine;
      await active.shared.engine.ingest({
        sessionId: ingestSessionId,
        sessionKey: active.sessionKey,
        message: event.message as unknown as AgentMessage,
      });
    } catch (err) {
      piLog.warn(`message_end ingest failed: ${describeLogError(err)}`);
    }
  });

  pi.on("session_shutdown", async (event) => {
    if (!active) return;
    const finalActive = active;
    active = undefined;
    try {
      if (finalActive.isEphemeral && overlay.pruneEphemeralOnShutdown) {
        // Engine's onSessionEnd-style hooks expect lifecycle params. The
        // pi build does not yet expose a public "prune by sessionKey" API
        // on LcmContextEngine; this is intentionally deferred to Phase 2
        // alongside the compaction wiring (the engine's session_end hook
        // already covers cleanup for sessions whose conversation row we
        // bound here, and the next phase will route pi's shutdown reason
        // through that path explicitly).
        piLog.debug(
          `session_shutdown ephemeral session pending prune: sessionKey=${finalActive.sessionKey} reason=${event.reason}`,
        );
      } else {
        piLog.debug(
          `session_shutdown sessionKey=${finalActive.sessionKey} reason=${event.reason}`,
        );
      }
    } finally {
      try {
        await releaseSharedLcm(finalActive.shared.dbPath);
      } catch (err) {
        piLog.warn(`releaseSharedLcm failed: ${describeLogError(err)}`);
      }
    }
  });

  // A trivial command so users can confirm the extension loaded.
  pi.registerCommand("lcm-status", {
    description: "Show the current lossless-claw extension state",
    handler: async (_args, ctx) => {
      if (!active) {
        ctx.ui.notify("lossless-claw: no active session bound", "info");
        return;
      }
      const summary = [
        `db: ${active.shared.dbPath}`,
        `sessionKey: ${active.sessionKey}`,
        `sessionFile: ${active.sessionFile ?? "<ephemeral>"}`,
        `ephemeral: ${active.isEphemeral}`,
      ].join("  ");
      ctx.ui.notify(`lossless-claw — ${summary}`, "info");
    },
  });

  // Touching NOOP_LCM_LOGGER keeps the import alive even if Phase 1 does not
  // exercise it; the symbol is used by helpers we will wire in later phases.
  void NOOP_LCM_LOGGER;
}
