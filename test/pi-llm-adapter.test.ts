import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));
vi.mock("@earendil-works/pi-ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-ai")>()),
  complete: completeMock,
}));

import { createPiComplete, createPiResolveModel } from "../src/pi/llm-adapter.js";

function registry(overrides: Record<string, unknown> = {}) {
  return {
    find: vi.fn(() => ({ provider: "test", id: "model" })),
    getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "key", headers: { "x-test": "yes" } })),
    ...overrides,
  } as any;
}

beforeEach(() => completeMock.mockReset());

describe("pi LLM adapter", () => {
  it("resolves explicit, qualified, and fallback model references", () => {
    const resolve = createPiResolveModel({
      modelRegistry: registry(),
      defaultModelRef: () => ({ provider: "fallback", model: "default" }),
    });
    expect(resolve("model", "provider")).toEqual({ provider: "provider", model: "model" });
    expect(resolve("provider/model")).toEqual({ provider: "provider", model: "model" });
    expect(resolve("other")).toEqual({ provider: "fallback", model: "other" });
    expect(resolve()).toEqual({ provider: "fallback", model: "default" });
  });

  it("returns a useful error instead of calling pi-ai for an unknown model", async () => {
    const modelRegistry = registry({ find: vi.fn(() => undefined) });
    const complete = createPiComplete({ modelRegistry, defaultModelRef: () => undefined });
    await expect(complete({ provider: "missing", model: "model", system: "", messages: [] })).resolves.toMatchObject({
      error: { kind: "complete-error", message: "Model missing/model is not registered with pi" },
    });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("returns an auth error without attempting completion", async () => {
    const modelRegistry = registry({
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: false, error: "not logged in" })),
    });
    const complete = createPiComplete({ modelRegistry, defaultModelRef: () => undefined });
    await expect(complete({ provider: "test", model: "model", system: "", messages: [] })).resolves.toMatchObject({
      error: { kind: "auth", message: "Auth unavailable for test/model: not logged in" },
    });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("coerces engine messages, passes resolved auth, and keeps text output only", async () => {
    completeMock.mockResolvedValue({
      content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "summary" }],
      usage: { input: 3 }, stopReason: "stop", model: "model", provider: "test",
    });
    const modelRegistry = registry();
    const complete = createPiComplete({ modelRegistry, defaultModelRef: () => undefined });
    const result = await complete({
      provider: "test", model: "model", system: "system",
      messages: [{ role: "user", content: "question" }, { role: "assistant", content: [{ type: "text", text: "answer" }] }],
      maxTokens: 42, temperature: 0.1,
    });

    expect(result).toMatchObject({ content: [{ type: "text", text: "summary" }], provider: "test", model: "model" });
    expect(completeMock).toHaveBeenCalledWith(expect.anything(), {
      systemPrompt: "system",
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "user", content: [{ type: "text", text: "question" }] }),
        expect.objectContaining({ role: "assistant", content: [{ type: "text", text: "answer" }] }),
      ]),
    }, expect.objectContaining({ apiKey: "key", headers: { "x-test": "yes" }, maxTokens: 42, temperature: 0.1 }));
  });
});
