import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PI_OVERLAY,
  defaultLcmDatabasePath,
  defaultLcmLargeFilesDir,
  loadPiLcmConfig,
  resolvePiLcmConfig,
} from "../src/pi/config.js";
import {
  buildSubagentSystemPrompt,
  isEphemeralSessionKey,
  isSubagentSessionKey,
  newEphemeralSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
  readSessionIdFromFile,
  sessionKeyForId,
} from "../src/pi/session-keys.js";

describe("pi config", () => {
  it("uses user-scoped pi paths and the ephemeral-prune default", () => {
    const resolved = resolvePiLcmConfig({}, {});
    expect(resolved.config.databasePath).toBe(defaultLcmDatabasePath());
    expect(resolved.config.largeFilesDir).toBe(defaultLcmLargeFilesDir());
    expect(resolved.overlay).toEqual(DEFAULT_PI_OVERLAY);
  });

  it("loads an explicit JSON config file for normal pi extension installs", () => {
    const dir = mkdtempSync(join(tmpdir(), "lcm-pi-config-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ contextThreshold: 0.5, pruneEphemeralOnShutdown: false }));
    expect(loadPiLcmConfig({ LCM_CONFIG_PATH: path })).toEqual({
      contextThreshold: 0.5,
      pruneEphemeralOnShutdown: false,
    });
  });

  it("fails loudly for malformed config JSON instead of silently changing settings", () => {
    const dir = mkdtempSync(join(tmpdir(), "lcm-pi-config-"));
    const path = join(dir, "config.json");
    writeFileSync(path, "not json");
    expect(() => loadPiLcmConfig({ LCM_CONFIG_PATH: path })).toThrow("Unable to read Lossless Claw config");
  });

  it("honors environment config over the extension config while retaining pi overlay", () => {
    const resolved = resolvePiLcmConfig({
      LCM_DATABASE_PATH: "/env/lcm.db",
      LCM_LARGE_FILES_DIR: "/env/files",
    }, {
      databasePath: "/extension/lcm.db",
      largeFilesDir: "/extension/files",
      pruneEphemeralOnShutdown: false,
    });
    expect(resolved.config.databasePath).toBe("/env/lcm.db");
    expect(resolved.config.largeFilesDir).toBe("/env/files");
    expect(resolved.overlay.pruneEphemeralOnShutdown).toBe(false);
  });
});

describe("pi session keys", () => {
  it("uses opaque persisted and unique ephemeral keys", () => {
    expect(sessionKeyForId("header-id")).toBe("pi:header-id");
    const ephemeral = newEphemeralSessionKey();
    expect(isEphemeralSessionKey(ephemeral)).toBe(true);
    expect(ephemeral).not.toBe(newEphemeralSessionKey());
  });

  it("reads the canonical session-header id rather than a path-derived id", () => {
    const dir = mkdtempSync(join(tmpdir(), "lcm-pi-session-"));
    const sessionFile = join(dir, "renamed-session.jsonl");
    writeFileSync(sessionFile, `${JSON.stringify({
      type: "session",
      version: 3,
      id: "canonical-header-id",
      timestamp: new Date().toISOString(),
      cwd: dir,
    })}\n`, "utf8");
    expect(readSessionIdFromFile(sessionFile)).toBe("canonical-header-id");
  });

  it("keeps subagent hooks inert in the pi host", () => {
    expect(parseAgentSessionKey("pi:header-id")).toEqual({ agentId: "main", suffix: "header-id" });
    expect(parseAgentSessionKey("pi:ephemeral:abc")).toEqual({ agentId: "main", suffix: "abc" });
    expect(isSubagentSessionKey("pi:header-id")).toBe(false);
    expect(normalizeAgentId("anything")).toBe("main");
    expect(buildSubagentSystemPrompt()).toBe("");
  });
});
