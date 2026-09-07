import type { AgentMessage } from "../host-types.js";

type PiModelIdentity = {
  api?: string;
  provider?: string;
  id?: string;
};

type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeUsage(value: unknown): Usage {
  const usage = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const cost = usage.cost && typeof usage.cost === "object"
    ? usage.cost as Record<string, unknown>
    : {};
  return {
    input: finiteNumber(usage.input),
    output: finiteNumber(usage.output),
    cacheRead: finiteNumber(usage.cacheRead),
    cacheWrite: finiteNumber(usage.cacheWrite),
    totalTokens: finiteNumber(usage.totalTokens),
    cost: {
      input: finiteNumber(cost.input),
      output: finiteNumber(cost.output),
      cacheRead: finiteNumber(cost.cacheRead),
      cacheWrite: finiteNumber(cost.cacheWrite),
      total: finiteNumber(cost.total),
    },
  };
}

function normalizeAssistantContent(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) return [];
  const normalized: Array<Record<string, unknown>> = [];
  for (const value of content) {
    if (!value || typeof value !== "object") continue;
    const block = value as Record<string, unknown>;
    if (block.type === "text") {
      normalized.push({
        ...block,
        type: "text",
        text: typeof block.text === "string" ? block.text : "",
      });
      continue;
    }
    if (block.type === "thinking") {
      normalized.push({
        ...block,
        type: "thinking",
        thinking: typeof block.thinking === "string" ? block.thinking : "",
      });
      continue;
    }
    if (block.type === "reasoning") {
      const summary = Array.isArray(block.summary)
        ? block.summary
            .map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
              ? (part as { text: string }).text
              : "")
            .join("")
        : "";
      normalized.push({
        type: "thinking",
        thinking: summary,
        thinkingSignature: JSON.stringify(block),
      });
      continue;
    }
    if (block.type === "toolCall") {
      const id = typeof block.id === "string" && block.id ? block.id : undefined;
      if (!id) continue;
      normalized.push({
        ...block,
        type: "toolCall",
        id,
        name: typeof block.name === "string" && block.name ? block.name : "unknown",
        arguments: block.arguments && typeof block.arguments === "object" && !Array.isArray(block.arguments)
          ? block.arguments
          : {},
      });
    }
  }
  return normalized;
}

/** Convert host-agnostic assembler output back into pi's strict AgentMessage shapes. */
export function normalizeAssembledMessagesForPi(
  messages: AgentMessage[],
  model: PiModelIdentity | undefined,
): AgentMessage[] {
  const now = Date.now();
  return messages.flatMap((message, index) => {
    const timestamp = finiteNumber(message.timestamp, now + index);
    if (message.role === "user") {
      return [{ ...message, role: "user", content: message.content ?? "", timestamp }];
    }
    if (message.role === "toolResult") {
      if (typeof message.toolCallId !== "string" || !message.toolCallId) return [];
      const content = Array.isArray(message.content)
        ? message.content.filter((block: unknown) => block && typeof block === "object")
        : [{ type: "text", text: typeof message.content === "string" ? message.content : "" }];
      return [{
        ...message,
        role: "toolResult",
        toolCallId: message.toolCallId,
        toolName: typeof message.toolName === "string" && message.toolName ? message.toolName : "unknown",
        content,
        isError: message.isError === true,
        timestamp,
      }];
    }
    if (message.role === "assistant") {
      const content = normalizeAssistantContent(message.content);
      if (content.length === 0) return [];
      const hasToolCall = content.some((block) => block.type === "toolCall");
      return [{
        ...message,
        role: "assistant",
        content,
        api: typeof (message as Record<string, unknown>).api === "string"
          ? (message as Record<string, unknown>).api
          : model?.api ?? "unknown",
        provider: typeof (message as Record<string, unknown>).provider === "string"
          ? (message as Record<string, unknown>).provider
          : model?.provider ?? "unknown",
        model: typeof (message as Record<string, unknown>).model === "string"
          ? (message as Record<string, unknown>).model
          : model?.id ?? "unknown",
        usage: normalizeUsage((message as Record<string, unknown>).usage ?? EMPTY_USAGE),
        stopReason: typeof (message as Record<string, unknown>).stopReason === "string"
          ? (message as Record<string, unknown>).stopReason
          : hasToolCall ? "toolUse" : "stop",
        timestamp,
      }];
    }
    return [];
  });
}
