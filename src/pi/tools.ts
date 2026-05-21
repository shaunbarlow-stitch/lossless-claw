/**
 * pi-side tool registration for lossless-claw.
 *
 * The four upstream tools (`lcm_grep`, `lcm_describe`, `lcm_expand`,
 * `lcm_expand_query`) ship factory functions in `src/tools/`. This module
 * wraps the two that work without subagent delegation (grep, describe) into
 * pi's `ToolDefinition` shape and registers them.
 *
 * `lcm_expand` and `lcm_expand_query` are intentionally *not* registered.
 * Both rely on OpenClaw gateway subagents (`callGateway`) which were removed
 * in Phase 0. `lcm_expand` is additionally gated by the engine to subagent
 * sessions only, so even if registered it would always return an error.
 * Re-introducing these tools in-process is a later-phase task.
 *
 * Per-call adapter:
 *  - Each pi `execute(toolCallId, params, signal, onUpdate, ctx)` invocation
 *    constructs a fresh upstream tool with the current sessionKey, then
 *    delegates to its 2-arg `execute(toolCallId, params)`. Constructing the
 *    upstream tool is a cheap closure; we do this per call so that the
 *    sessionKey reflects whichever pi session is currently active rather
 *    than whatever was active at extension load time.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LcmContextEngine } from "../engine.js";
import { createLcmDescribeTool } from "../tools/lcm-describe-tool.js";
import { createLcmGrepTool } from "../tools/lcm-grep-tool.js";
import type { LcmDependencies } from "../types.js";

export type ActiveSessionBinding = {
  /** Current pi session's lossless-claw key, or undefined while unbound. */
  sessionKey: string | undefined;
  /** Engine-side session id matching `sessionKey`. */
  sessionIdForEngine: string | undefined;
};

export type RegisterLcmToolsOptions = {
  pi: ExtensionAPI;
  deps: LcmDependencies;
  engine: LcmContextEngine;
  /**
   * Live accessor for the currently bound session. Returns undefined-ish
   * fields when no pi session has been bound yet (e.g. during pi's startup
   * window before the session file is flushed). Tools surface a clear
   * error message instead of executing against an empty scope.
   */
  getActiveBinding: () => ActiveSessionBinding;
};

function unboundResult(toolName: string): {
  content: Array<{ type: "text"; text: string }>;
  details: { error: string };
} {
  const error = `${toolName} is unavailable: no pi session is bound yet. Send a user message first so the session file is created and lossless-claw can attach to it.`;
  return {
    content: [{ type: "text", text: JSON.stringify({ error }, null, 2) }],
    details: { error },
  };
}

export function registerLcmTools(opts: RegisterLcmToolsOptions): void {
  const { pi, deps, engine, getActiveBinding } = opts;

  // ── lcm_grep ─────────────────────────────────────────────────────────────
  // Pure DB read: searches messages and summaries via FTS5 or regex.
  // Underlying tool factory captures sessionKey for scoping, so we
  // re-construct per call to pick up the active binding.
  const grepProbe = createLcmGrepTool({ deps, lcm: engine });
  pi.registerTool({
    name: grepProbe.name,
    label: (grepProbe.label as string) ?? "LCM Grep",
    description: grepProbe.description as string,
    parameters: grepProbe.parameters as never,
    promptSnippet:
      "lcm_grep: search compacted conversation history (regex or full-text) for content that fell out of the active context window.",
    promptGuidelines: [
      "Use lcm_grep when the user references something said earlier that you cannot see in the current message list; full-text mode (`mode: \"full_text\"`) is preferred for natural-language queries.",
    ],
    async execute(toolCallId, params) {
      const binding = getActiveBinding();
      if (!binding.sessionKey) return unboundResult("lcm_grep");
      const tool = createLcmGrepTool({
        deps,
        lcm: engine,
        sessionId: binding.sessionIdForEngine,
        sessionKey: binding.sessionKey,
      });
      const result = await tool.execute(toolCallId, params);
      return result as Awaited<ReturnType<typeof tool.execute>> & {
        content: Array<{ type: "text"; text: string }>;
        details: unknown;
      };
    },
  });

  // ── lcm_describe ─────────────────────────────────────────────────────────
  // Pure DB read: fetch a single summary or message by ID. Natural follow-up
  // tool after lcm_grep returns candidate IDs.
  const describeProbe = createLcmDescribeTool({ deps, lcm: engine });
  pi.registerTool({
    name: describeProbe.name,
    label: (describeProbe.label as string) ?? "LCM Describe",
    description: describeProbe.description as string,
    parameters: describeProbe.parameters as never,
    promptSnippet:
      "lcm_describe: fetch the full content of a specific summary or message by its LCM id, typically after lcm_grep returns candidate ids.",
    promptGuidelines: [
      "Use lcm_describe to retrieve the full text of a summary or message after lcm_grep returns a matching id; pass the id verbatim.",
    ],
    async execute(toolCallId, params) {
      const binding = getActiveBinding();
      if (!binding.sessionKey) return unboundResult("lcm_describe");
      const tool = createLcmDescribeTool({
        deps,
        lcm: engine,
        sessionId: binding.sessionIdForEngine,
        sessionKey: binding.sessionKey,
      });
      const result = await tool.execute(toolCallId, params);
      return result as Awaited<ReturnType<typeof tool.execute>> & {
        content: Array<{ type: "text"; text: string }>;
        details: unknown;
      };
    },
  });
}
