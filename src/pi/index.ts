/**
 * Pi extension entrypoint for lossless-claw.
 *
 * The adapter loads the shared engine, binds persisted pi sessions by their
 * header id, ingests messages, assembles LCM context, registers retrieval
 * tools, and exposes the `/lcm` command family. Session shutdown releases
 * the shared DB reference; ephemeral pruning remains deferred because the
 * engine does not yet expose a safe single-conversation prune entrypoint.
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
import { defaultLcmDataDir, loadPiLcmConfig, resolvePiLcmConfig } from "./config.js";
import {
  acquireSharedLcm,
  releaseSharedLcm,
  type SharedLcmEntry,
} from "./shared-init.js";
import { registerLcmTools } from "./tools.js";
import { registerLcmCommands } from "./commands.js";
import { normalizeAssembledMessagesForPi } from "./messages.js";
import {
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
  // Pi's ExtensionFactory API does not pass a settings object. Keep the
  // optional input for embedders/tests, but load the normal user config from
  // the documented JSON file beside LCM's user-scoped data directory.
  const pluginConfig = {
    ...loadPiLcmConfig(process.env),
    ...((input?.config ?? {}) as Record<string, unknown>),
  };

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
    /** Recorded at session_start; the session file pi intends to write. */
    sessionFile: string | undefined;
    /**
     * Fallback session id observed in memory at session_start. Pi's in-memory
     * id is NOT the same as the eventual file-header id in print mode, so we
     * never use this for persistent sessions; it is retained for diagnostics
     * and for ephemeral-session detection at shutdown.
     */
    fallbackSessionId: string;
    /**
     * The lossless-claw session key and engine-side session id. Both are
     * derived from the pi session-header `id` field once the session file
     * exists on disk. They stay undefined for the early-startup window
     * between `session_start` and pi's first write of the session header,
     * during which event handlers no-op rather than commit data under a
     * transient identity.
     */
    sessionKey: string | undefined;
    sessionIdForEngine: string | undefined;
    bootstrapped: boolean;
    shared: SharedLcmEntry;
    /**
     * Stash for the engine's optional systemPromptAddition output. The
     * assembler returns this on each `context` call; we apply it on the
     * next `before_agent_start` because pi composes the system prompt at
     * that lifecycle point.
     */
    pendingSystemPromptAddition: string | undefined;
    /** Resolve the currently selected model when context is assembled. */
    getModelIdentity: () => { api?: string; provider?: string; id?: string } | undefined;
  };
  let active: ActiveSession | undefined;

  /**
   * Resolve `active.sessionKey` and `active.sessionIdForEngine` from the
   * session-file header. Pi (at least in print mode) reports a different
   * in-memory session id than the eventually-written file-header id, so the
   * file is the canonical source.
   *
   * Returns true once the session has been bound; false while the session
   * file is still missing. Handlers should bail when this returns false to
   * avoid creating a conversation row under a transient identity.
   */
  function ensureSessionBound(): boolean {
    if (!active) return false;
    if (active.sessionKey && active.sessionIdForEngine) return true;
    if (!active.sessionFile || !existsSync(active.sessionFile)) return false;
    const headerId = readSessionIdFromFile(active.sessionFile);
    if (!headerId) return false;
    active.sessionKey = sessionKeyForId(headerId);
    active.sessionIdForEngine = headerId;
    piLog.info(
      `session bound sessionKey=${active.sessionKey} sessionFile=${active.sessionFile}`,
    );
    return true;
  }

  /**
   * Bootstrap is deferred until the pi session file actually exists on disk
   * AND the session has been bound from its header. Pi fires `session_start`
   * before flushing the session header, so an eager `engine.bootstrap()`
   * racing the file write would ENOENT. Any of `context`, `message_end`, or
   * a follow-up tick triggers this once the file is observable.
   */
  async function ensureBootstrapped(): Promise<void> {
    if (!active || active.bootstrapped) return;
    if (!ensureSessionBound()) return;
    const { sessionFile, sessionKey, sessionIdForEngine, shared } = active;
    if (!sessionFile || !sessionKey || !sessionIdForEngine) return;
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
      piLog.warn(`deferred bootstrap failed (will retry on next event): ${describeLogError(err)}`);
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

      let toolsRegisteredForEngine = false;
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
          // Tools are registered once per engine instance: they read the
          // current active binding on every execute, so we don't need to
          // re-register them across pi session_start cycles that share
          // this engine via shared-init.
          registerLcmTools({
            pi,
            deps,
            engine,
            getActiveBinding: () => ({
              sessionKey: active?.sessionKey,
              sessionIdForEngine: active?.sessionIdForEngine,
            }),
          });
          toolsRegisteredForEngine = true;
          return {
            dbPath,
            database,
            engine,
            deps,
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
      if (toolsRegisteredForEngine) {
        piLog.debug("lcm tools registered (lcm_grep, lcm_describe)");
      }

      active = {
        sessionFile,
        fallbackSessionId: ctx.sessionManager.getSessionId(),
        sessionKey: undefined,
        sessionIdForEngine: undefined,
        bootstrapped: false,
        shared,
        pendingSystemPromptAddition: undefined,
        getModelIdentity: () => {
          const model = ctx.model;
          if (!model) return undefined;
          return { api: model.api, provider: model.provider, id: model.id };
        },
      };

      piLog.info(
        `session_start (reason=${event.reason}) sessionFile=${sessionFile ?? "<ephemeral>"} bind=deferred`,
      );
      // Eager bind+bootstrap attempt in case the header was already flushed
      // (common on /resume).
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
      if (!active.sessionKey || !active.sessionIdForEngine) {
        piLog.debug("message_end skipped: session not yet bound (file pending)");
        return;
      }
      await active.shared.engine.ingest({
        sessionId: active.sessionIdForEngine,
        sessionKey: active.sessionKey,
        message: event.message as unknown as AgentMessage,
      });
    } catch (err) {
      piLog.warn(`message_end ingest failed: ${describeLogError(err)}`);
    }
  });

  /**
   * Replace pi's per-turn message list with the engine's DAG-aware assembled
   * view. The engine reads its DB to splice in summary nodes and trims raw
   * messages that are already represented by those summaries.
   *
   * Pi may still trigger its own sliding-window compaction in parallel based
   * on its own token math; that does not affect correctness because every
   * raw message was already persisted by `message_end` ingest, and the
   * assembler reads from the DB rather than from pi's session tree.
   */
  pi.on("context", async (event) => {
    if (!active) return;
    try {
      await ensureBootstrapped();
      if (!active.sessionKey || !active.sessionIdForEngine) {
        piLog.debug("context skipped: session not yet bound (file pending)");
        return undefined;
      }
      const inputMessages = event.messages as unknown as AgentMessage[];
      const result = await active.shared.engine.assemble({
        sessionId: active.sessionIdForEngine,
        sessionKey: active.sessionKey,
        messages: inputMessages,
      });
      active.pendingSystemPromptAddition = result.systemPromptAddition;
      const piMessages = normalizeAssembledMessagesForPi(
        result.messages,
        active.getModelIdentity(),
      );
      piLog.debug(
        `assemble: in=${inputMessages.length} out=${piMessages.length} tokens=${result.estimatedTokens} systemAddition=${result.systemPromptAddition ? "yes" : "no"}`,
      );
      return { messages: piMessages as unknown as typeof event.messages };
    } catch (err) {
      piLog.warn(`assemble failed (passing through pi's view unchanged): ${describeLogError(err)}`);
      return undefined;
    }
  });

  /**
   * If the most recent assemble produced a systemPromptAddition, append it
   * to pi's chained system prompt for the upcoming agent turn. The engine
   * uses this channel to inject conversation-level guidance (e.g. "these
   * tools are available to expand summarised history") that should live in
   * the system prompt, not the message list.
   */
  pi.on("before_agent_start", async (event) => {
    if (!active) return;
    const addition = active.pendingSystemPromptAddition;
    if (!addition) return;
    active.pendingSystemPromptAddition = undefined;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${addition}`,
    };
  });

  pi.on("session_shutdown", async (event) => {
    if (!active) return;
    const finalActive = active;
    active = undefined;
    try {
      // Ephemeral pruning is intentionally log-only until the engine exposes
      // a safe single-conversation prune entrypoint.
      const wasEphemeral = !finalActive.sessionKey;
      if (wasEphemeral && overlay.pruneEphemeralOnShutdown) {
        piLog.debug(
          `session_shutdown ephemeral: sessionFile=${finalActive.sessionFile ?? "<none>"} reason=${event.reason}`,
        );
      } else {
        piLog.debug(
          `session_shutdown sessionKey=${finalActive.sessionKey ?? "<unbound>"} reason=${event.reason}`,
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

  registerLcmCommands({
    pi,
    config,
    ensureReady: ensureBootstrapped,
    getBinding: () => active
      ? {
          sessionKey: active.sessionKey,
          sessionIdForEngine: active.sessionIdForEngine,
          sessionFile: active.sessionFile,
          bootstrapped: active.bootstrapped,
          databasePath: active.shared.dbPath,
          database: active.shared.database,
          engine: active.shared.engine,
          deps: active.shared.deps,
        }
      : undefined,
  });

  // Touching NOOP_LCM_LOGGER keeps the import alive even if Phase 1 does not
  // exercise it; the symbol is used by helpers we will wire in later phases.
  void NOOP_LCM_LOGGER;
}
