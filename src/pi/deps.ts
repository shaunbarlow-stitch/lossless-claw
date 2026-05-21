/**
 * Build LcmDependencies for the pi adapter.
 *
 * Most fields are real (config, complete, session-key helpers, logger).
 * Subagent-related fields are stubs returning empty values because Phase 0 of
 * the pi port dropped sub-agent-delegated `lcm_expand`; the engine never
 * exercises those code paths in the pi build.
 */
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { LcmConfig, LcmConfigDiagnostics } from "../db/config.js";
import type { LcmDependencies } from "../types.js";
import {
  buildSubagentSystemPrompt,
  isSubagentSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
  readSessionIdFromFile,
} from "./session-keys.js";
import { createPiComplete, createPiResolveModel, type PiLlmAdapterOptions } from "./llm-adapter.js";

export type BuildDepsOptions = {
  config: LcmConfig;
  configDiagnostics: LcmConfigDiagnostics;
  modelRegistry: ModelRegistry;
  /** Returns the currently selected pi model, if any. */
  defaultModelRef: () => { provider: string; model: string } | undefined;
  /** The pi agent extensions data directory for lossless-claw. */
  agentDir: string;
  /** Map a sessionKey -> sessionFile path for the engine's transcript-aware paths. */
  resolveSessionFileForKey: (sessionKey: string) => string | undefined;
  /** Logger sink. Pi's `ctx.ui.notify` is async; for engine logging we use a sync wrapper. */
  log: LcmDependencies["log"];
};

/**
 * Stub `callGateway` used for any code path that historically delegated work
 * to an OpenClaw gateway subagent. The pi port has no such surface; if the
 * engine ever takes one of these paths it should be considered a bug.
 */
function makeCallGatewayStub(log: LcmDependencies["log"]): LcmDependencies["callGateway"] {
  return async (params) => {
    const message = `callGateway invoked but subagent delegation is unavailable in the pi build (method=${String(params.method)})`;
    log.warn(`[lcm] ${message}`);
    throw new Error(message);
  };
}

/**
 * Read the most recent assistant text from a message list. Used by the engine
 * when reconciling subagent replies; in the pi port it occasionally runs over
 * in-process transcripts so we keep a real implementation.
 */
function readLatestAssistantReply(messages: unknown[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || typeof m !== "object") continue;
    const mm = m as { role?: unknown; content?: unknown };
    if (mm.role !== "assistant") continue;
    const text = extractText(mm.content);
    if (text) return text;
  }
  return undefined;
}

function extractText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (block && typeof block === "object") {
      const bb = block as { type?: unknown; text?: unknown };
      if (bb.type === "text" && typeof bb.text === "string") {
        parts.push(bb.text);
      }
    }
  }
  const joined = parts.join("");
  return joined.length > 0 ? joined : undefined;
}

export function buildLcmDependencies(opts: BuildDepsOptions): LcmDependencies {
  const adapterOpts: PiLlmAdapterOptions = {
    modelRegistry: opts.modelRegistry,
    defaultModelRef: opts.defaultModelRef,
  };

  const complete = createPiComplete(adapterOpts);
  const resolveModel = createPiResolveModel(adapterOpts);
  const callGateway = makeCallGatewayStub(opts.log);

  return {
    config: opts.config,
    configDiagnostics: opts.configDiagnostics,
    complete,
    callGateway,
    resolveModel,
    parseAgentSessionKey,
    isSubagentSessionKey,
    normalizeAgentId,
    buildSubagentSystemPrompt,
    readLatestAssistantReply,
    resolveAgentDir: () => opts.agentDir,
    resolveSessionIdFromSessionKey: async (sessionKey) => {
      const sessionFile = opts.resolveSessionFileForKey(sessionKey);
      if (!sessionFile) return undefined;
      return readSessionIdFromFile(sessionFile);
    },
    resolveSessionTranscriptFile: async ({ sessionKey }) => {
      if (!sessionKey) return undefined;
      return opts.resolveSessionFileForKey(sessionKey) ?? undefined;
    },
    listStartupSessionFileCandidates: async () => {
      // Pi enumerates session files via SessionManager.listAll() but only on
      // demand; the engine uses this hook for proactive startup recovery
      // which is a no-op in the pi port for now. Returning an empty array
      // prevents the engine from speculatively touching session files we
      // have not bound to a conversation.
      return [];
    },
    agentLaneSubagent: "subagent",
    log: opts.log,
  } satisfies LcmDependencies;
}
