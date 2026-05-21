/**
 * Local host-facing type definitions used by the LCM engine.
 *
 * Historically these were a compatibility bridge to OpenClaw's plugin-sdk.
 * After the pi-port fork the engine no longer depends on OpenClaw at runtime,
 * so these types are defined inline. Real pi-side bindings live under
 * `src/pi/` (added in Phase 1).
 */

/**
 * Minimal structural type for an agent tool. Kept loose to accommodate both
 * the legacy OpenClaw plugin-sdk shape and the pi tool shape that will be
 * introduced when the pi adapter is wired up.
 */
export type AnyAgentTool = {
  name: string;
  description?: string;
  parameters?: unknown;
  execute: (...args: any[]) => any;
  [key: string]: unknown;
};

export type ContextEngineProjection = {
  mode: "per_turn" | "thread_bootstrap";
  epoch?: string;
  fingerprint?: string;
};

export type AssembleResult = {
  messages: AgentMessage[];
  estimatedTokens: number;
  systemPromptAddition?: string;
  contextProjection?: ContextEngineProjection;
};

export type BootstrapResult = {
  bootstrapped: boolean;
  importedMessages: number;
  reason?: string;
};

export type CompactResult = {
  ok: boolean;
  compacted: boolean;
  reason?: string;
  summaryId?: string;
  error?: string;
  result?: unknown;
};

export type IngestResult = {
  ingested: boolean;
};

export type IngestBatchResult = {
  ingestedCount: number;
};

export type SubagentSpawnPreparation = {
  systemPromptAddition?: string;
  rollback?: () => void;
};

export type SubagentEndReason = string;

export type ContextEngineInfo = {
  id: string;
  name: string;
  version: string;
  ownsCompaction?: boolean;
  turnMaintenanceMode?: "background" | "inline" | string;
};

export type ContextEngineFactory = () => ContextEngine | Promise<ContextEngine>;

export type AgentMessage = {
  role: string;
  content?: any;
  timestamp?: number;
  toolCallId?: string;
  toolUseId?: string;
  toolName?: string;
  details?: any;
  isError?: boolean;
};

export type ContextEngine = {
  info: ContextEngineInfo;
  bootstrap(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile?: string;
    messages?: AgentMessage[];
  }): Promise<BootstrapResult>;
  ingest(params: {
    sessionId: string;
    sessionKey?: string;
    message: AgentMessage;
  }): Promise<IngestResult>;
  ingestBatch?(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    isHeartbeat?: boolean;
  }): Promise<IngestBatchResult>;
  assemble(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    tokenBudget?: number;
    prompt?: string;
  }): Promise<AssembleResult>;
  compact(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile?: string;
    tokenBudget?: number;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
    runtimeContext?: Record<string, unknown>;
    legacyParams?: Record<string, unknown>;
    force?: boolean;
  }): Promise<CompactResult>;
  prepareSubagentSpawn?(params: {
    parentSessionId?: string;
    parentSessionKey?: string;
    childSessionId?: string;
    childSessionKey: string;
  }): Promise<SubagentSpawnPreparation | undefined>;
  onSubagentEnded?(params: {
    childSessionId?: string;
    childSessionKey: string;
    reason?: SubagentEndReason;
  }): Promise<void>;
};
