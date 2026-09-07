import { describe, expect, it } from "vitest";
import { normalizeAssembledMessagesForPi } from "../src/pi/messages.js";

describe("pi assembled-message normalization", () => {
  it("restores strict pi assistant and tool-result message shapes", () => {
    const toolCallId = "call_abc|fc_def";
    const messages = normalizeAssembledMessagesForPi([
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", id: "rs_abc", content: [], encrypted_content: "opaque" },
          { type: "toolCall", id: toolCallId, name: undefined, arguments: undefined },
        ],
        usage: { output: 12 },
      } as any,
      {
        role: "toolResult",
        toolCallId,
        toolName: "read",
        content: [{ type: "text", text: "done" }],
      },
    ], {
      api: "openai-codex-responses",
      provider: "openai-codex",
      id: "gpt-test",
    });

    expect(messages[0]).toMatchObject({ role: "user", timestamp: expect.any(Number) });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-test",
      stopReason: "toolUse",
      timestamp: expect.any(Number),
      usage: {
        input: 0,
        output: 12,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    expect(messages[1]?.content).toEqual([
      expect.objectContaining({ type: "thinking", thinking: "", thinkingSignature: expect.any(String) }),
      expect.objectContaining({ type: "toolCall", id: toolCallId, name: "unknown", arguments: {} }),
    ]);
    expect(messages[2]).toMatchObject({
      role: "toolResult",
      toolCallId,
      toolName: "read",
      isError: false,
      timestamp: expect.any(Number),
    });
  });

  it("drops empty and unpairable reconstructed messages", () => {
    expect(normalizeAssembledMessagesForPi([
      { role: "assistant", content: [] },
      { role: "toolResult", content: [{ type: "text", text: "orphan" }] },
    ], undefined)).toEqual([]);
  });
});
