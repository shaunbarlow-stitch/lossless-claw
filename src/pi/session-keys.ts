/**
 * Session-identity helpers for the pi adapter.
 *
 * Replaces the upstream OpenClaw `agent:<id>:<suffix>` session-key scheme with
 * an opaque, rename-safe identity derived from pi's session header `id` field.
 *
 * Session key format: `pi:<sessionHeaderId>` for persisted sessions,
 * `pi:ephemeral:<uuid>` for sessions pi never persisted.
 *
 * The engine only uses session keys as opaque conversation discriminators;
 * the format is internal to this module.
 */
import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type {
  IsSubagentSessionKeyFn,
  ParseAgentSessionKeyFn,
} from "../types.js";

const EPHEMERAL_PREFIX = "pi:ephemeral:";
const PERSISTED_PREFIX = "pi:";

export function sessionKeyForId(sessionHeaderId: string): string {
  return `${PERSISTED_PREFIX}${sessionHeaderId}`;
}

export function newEphemeralSessionKey(): string {
  return `${EPHEMERAL_PREFIX}${randomUUID()}`;
}

export function isEphemeralSessionKey(sessionKey: string): boolean {
  return sessionKey.startsWith(EPHEMERAL_PREFIX);
}

/**
 * Read the pi session header id from a session file on disk. Returns
 * `undefined` if the file is missing or has no header (e.g. mid-write).
 * Pi's SessionManager.open already handles partial reads safely.
 */
export function readSessionIdFromFile(sessionFile: string): string | undefined {
  try {
    const sm = SessionManager.open(sessionFile);
    return sm.getHeader()?.id ?? sm.getSessionId();
  } catch {
    return undefined;
  }
}

/**
 * Engine-compatible parseAgentSessionKey. The engine code only inspects the
 * `agentId` and `suffix` fields for subagent-routing decisions, which the pi
 * port does not exercise. Returning a stable shape keeps callers happy.
 */
export const parseAgentSessionKey: ParseAgentSessionKeyFn = (sessionKey) => {
  if (!sessionKey || typeof sessionKey !== "string") return null;
  if (sessionKey.startsWith(EPHEMERAL_PREFIX)) {
    return { agentId: "main", suffix: sessionKey.slice(EPHEMERAL_PREFIX.length) };
  }
  if (sessionKey.startsWith(PERSISTED_PREFIX)) {
    return { agentId: "main", suffix: sessionKey.slice(PERSISTED_PREFIX.length) };
  }
  return null;
};

/**
 * Subagent sessions do not exist in the pi port. Always false.
 */
export const isSubagentSessionKey: IsSubagentSessionKeyFn = () => false;

export function normalizeAgentId(_id?: string): string {
  // Pi has no agent-lane concept; always normalize to "main".
  return "main";
}

/**
 * Subagent system prompts are not produced in the pi port.
 */
export function buildSubagentSystemPrompt(): string {
  return "";
}
