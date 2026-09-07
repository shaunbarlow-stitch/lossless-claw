import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import losslessClaw from "../src/pi/index.js";
import { clearAllSharedLcm } from "../src/pi/shared-init.js";

type Handler = (event: any, ctx: any) => Promise<any> | any;

function makeSessionFile(dir: string, id: string): string {
  const file = join(dir, `${id}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: dir })}\n`, "utf8");
  return file;
}

function makePi(sessionFile: string, sessionId: string) {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, any>();
  const pi = {
    on: vi.fn((name: string, handler: Handler) => handlers.set(name, handler)),
    registerTool: vi.fn(),
    registerCommand: vi.fn((name: string, command: any) => commands.set(name, command)),
  };
  const ctx = {
    sessionManager: {
      getSessionFile: () => sessionFile,
      getSessionId: () => sessionId,
    },
    modelRegistry: {
      find: vi.fn(),
      getApiKeyAndHeaders: vi.fn(),
    },
    model: undefined,
    hasUI: false,
    ui: { notify: vi.fn(), confirm: vi.fn() },
    waitForIdle: vi.fn(async () => {}),
  };
  return { pi, ctx, handlers, commands };
}

afterEach(() => clearAllSharedLcm());

describe("pi adapter lifecycle", () => {
  it("binds each persisted header id to an isolated conversation and assembles from its own data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lcm-pi-lifecycle-"));
    const dbPath = join(dir, "lcm.db");
    const first = makePi(makeSessionFile(dir, "first-header"), "transient-first");
    const second = makePi(makeSessionFile(dir, "second-header"), "transient-second");

    losslessClaw(first.pi as any, { config: { databasePath: dbPath, largeFilesDir: join(dir, "files") } });
    losslessClaw(second.pi as any, { config: { databasePath: dbPath, largeFilesDir: join(dir, "files") } });
    await first.handlers.get("session_start")!({ reason: "startup" }, first.ctx);
    await second.handlers.get("session_start")!({ reason: "startup" }, second.ctx);

    await first.handlers.get("message_end")!({ message: { role: "user", content: "first-only", timestamp: Date.now() } }, first.ctx);
    await second.handlers.get("message_end")!({ message: { role: "user", content: "second-only", timestamp: Date.now() } }, second.ctx);

    expect(first.commands.has("lcm")).toBe(true);
    expect(first.commands.has("lcm-status")).toBe(false);
    await first.commands.get("lcm").handler("status", first.ctx);
    expect(first.ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Current: #1, 1 messages"),
      "info",
    );

    const firstContext = await first.handlers.get("context")!({
      messages: [{ role: "user", content: "first-only", timestamp: Date.now() }],
    }, first.ctx);
    expect(JSON.stringify(firstContext.messages)).toContain("first-only");
    expect(JSON.stringify(firstContext.messages)).not.toContain("second-only");

    const db = new DatabaseSync(dbPath);
    const conversations = db.prepare("SELECT session_key FROM conversations ORDER BY session_key").all() as Array<{ session_key: string }>;
    expect(conversations.map((row) => row.session_key)).toEqual(["pi:first-header", "pi:second-header"]);
    db.close();

    await first.handlers.get("session_shutdown")!({ reason: "quit" }, first.ctx);
    await second.handlers.get("session_shutdown")!({ reason: "quit" }, second.ctx);
  });
});
