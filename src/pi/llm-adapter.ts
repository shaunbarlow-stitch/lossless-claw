/**
 * LLM completion adapter: bridges LcmDependencies.complete to pi's modelRegistry
 * plus pi-ai's `complete()` helper.
 *
 * The engine's `CompleteFn` signature is provider-agnostic and expects a result
 * shaped as `{ content: [{ type, text? }, ...] }`. Pi-ai's `AssistantMessage`
 * carries a richer content array (text, thinking, tool_call); we filter to text
 * blocks because the summarizer only consumes text.
 */
import { complete as piAiComplete, type Context, type Message, type Model, type Api } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type {
  CompleteFn,
  CompletionContentBlock,
  CompletionResult,
  ResolveModelFn,
} from "../types.js";

export type PiLlmAdapterOptions = {
  modelRegistry: ModelRegistry;
  /**
   * Default provider/model pair to use when the engine does not supply one.
   * Usually the model currently selected in the pi session.
   */
  defaultModelRef: () => { provider: string; model: string } | undefined;
};

export function createPiResolveModel(opts: PiLlmAdapterOptions): ResolveModelFn {
  return (modelRef?: string, providerHint?: string) => {
    // The engine passes either a "provider/model" string, a bare model id, or
    // nothing. We do not currently parse alias tables — pi's modelRegistry is
    // queried only via explicit provider+id lookups.
    if (modelRef && providerHint) {
      return { provider: providerHint, model: modelRef };
    }
    if (modelRef && modelRef.includes("/")) {
      const [provider, ...rest] = modelRef.split("/");
      return { provider, model: rest.join("/") };
    }
    const fallback = opts.defaultModelRef();
    if (fallback) {
      if (modelRef) return { provider: providerHint ?? fallback.provider, model: modelRef };
      return fallback;
    }
    // Last resort: return what we have. Callers will get a clearer error when
    // modelRegistry.find() returns undefined.
    return { provider: providerHint ?? "", model: modelRef ?? "" };
  };
}

export function createPiComplete(opts: PiLlmAdapterOptions): CompleteFn {
  const resolveModel = createPiResolveModel(opts);
  return async (params) => {
    const { provider, model } = resolveModel(params.model, params.provider);
    const pickedModel = opts.modelRegistry.find(provider, model);
    if (!pickedModel) {
      return errorResult(`Model ${provider}/${model} is not registered with pi`);
    }

    const auth = await opts.modelRegistry.getApiKeyAndHeaders(pickedModel);
    if (!auth.ok) {
      return errorResult(`Auth unavailable for ${provider}/${model}: ${auth.error}`, "auth");
    }

    const context: Context = {
      systemPrompt: params.system,
      messages: coerceEngineMessages(params.messages),
    };

    try {
      const assistantMessage = await piAiComplete(pickedModel as Model<Api>, context, {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: params.maxTokens,
        temperature: params.temperature,
      });

      const content: CompletionContentBlock[] = [];
      for (const block of assistantMessage.content) {
        if (block.type === "text" && typeof (block as { text?: unknown }).text === "string") {
          content.push({ type: "text", text: (block as { text: string }).text });
        }
      }

      return {
        content,
        usage: assistantMessage.usage as unknown as Record<string, unknown>,
        stopReason: assistantMessage.stopReason,
        model: assistantMessage.model,
        provider: assistantMessage.provider,
      } satisfies CompletionResult;
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  };
}

function errorResult(message: string, kind: string = "complete-error"): CompletionResult {
  return {
    content: [],
    error: { kind, message },
  };
}

/**
 * The engine passes messages typed as `{ role: string; content: unknown }`.
 * Pi-ai expects `Message` (a discriminated union of UserMessage,
 * AssistantMessage, ToolResultMessage). The engine never feeds us tool-call
 * messages directly into the summarizer — `convertToLlm` upstream of this call
 * has already collapsed them into role-tagged text — so we just coerce the
 * structural shape.
 */
function coerceEngineMessages(messages: Array<{ role: string; content: unknown }>): Message[] {
  return messages.map((m) => coerceOneMessage(m));
}

function coerceOneMessage(m: { role: string; content: unknown }): Message {
  const role = m.role;
  const content = m.content;
  if (role === "assistant") {
    return {
      role: "assistant",
      content: coerceAssistantContent(content),
      api: "openai-completions",
      provider: "unknown",
      model: "unknown",
      usage: emptyUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    } as unknown as Message;
  }
  if (role === "toolResult") {
    return {
      role: "toolResult",
      toolCallId: "",
      toolName: "",
      content: coerceUserContent(content),
      isError: false,
      timestamp: Date.now(),
    } as unknown as Message;
  }
  // Default: treat as user message.
  return {
    role: "user",
    content: coerceUserContent(content),
  } as unknown as Message;
}

function coerceUserContent(content: unknown): Array<{ type: "text"; text: string }> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) {
    const out: Array<{ type: "text"; text: string }> = [];
    for (const block of content) {
      if (typeof block === "string") {
        out.push({ type: "text", text: block });
        continue;
      }
      if (block && typeof block === "object") {
        const bb = block as Record<string, unknown>;
        if (bb.type === "text" && typeof bb.text === "string") {
          out.push({ type: "text", text: bb.text });
        }
      }
    }
    return out;
  }
  return [{ type: "text", text: "" }];
}

function coerceAssistantContent(content: unknown): Array<{ type: "text"; text: string }> {
  return coerceUserContent(content);
}

function emptyUsage(): Record<string, unknown> {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
