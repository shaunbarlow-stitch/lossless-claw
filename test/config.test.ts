import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_AUTO_ROTATE_SESSION_FILE_SIZE_BYTES,
  DEFAULT_CRITICAL_BUDGET_PRESSURE_RATIO,
  resolveLcmConfig,
  resolveLcmConfigWithDiagnostics,
  resolveOpenclawStateDir,
} from "../src/db/config.js";

describe("resolveLcmConfig", () => {
  it("defaults summaryMaxOverageFactor to 3 and maxAssemblyTokenBudget to undefined", () => {
    const config = resolveLcmConfig({}, {});
    expect(config.bootstrapMaxTokens).toBe(6000);
    expect(config.delegationTimeoutMs).toBe(120000);
    expect(config.summaryMaxOverageFactor).toBe(3);
    expect(config.maxAssemblyTokenBudget).toBeUndefined();
  });

  it("derives bootstrapMaxTokens from leafChunkTokens and allows override", () => {
    expect(resolveLcmConfig({}, {
      leafChunkTokens: 80_000,
    }).bootstrapMaxTokens).toBe(24_000);

    expect(resolveLcmConfig({}, {
      leafChunkTokens: 80_000,
      bootstrapMaxTokens: 12_345,
    }).bootstrapMaxTokens).toBe(12_345);
  });

  it("env vars override bootstrapMaxTokens", () => {
    const config = resolveLcmConfig({
      LCM_BOOTSTRAP_MAX_TOKENS: "4321",
    } as NodeJS.ProcessEnv, {
      bootstrapMaxTokens: 12_345,
    });
    expect(config.bootstrapMaxTokens).toBe(4321);
  });

  it("falls back cleanly when numeric env vars are invalid", () => {
    const config = resolveLcmConfig({
      LCM_LEAF_CHUNK_TOKENS: "oops",
      LCM_BOOTSTRAP_MAX_TOKENS: "still-nope",
      LCM_CONTEXT_THRESHOLD: "bad",
      LCM_SUMMARY_MAX_OVERAGE_FACTOR: "nah",
    } as NodeJS.ProcessEnv, {
      leafChunkTokens: 80_000,
      contextThreshold: 0.5,
      summaryMaxOverageFactor: 5,
    });

    expect(config.leafChunkTokens).toBe(80_000);
    expect(config.bootstrapMaxTokens).toBe(24_000);
    expect(config.contextThreshold).toBe(0.5);
    expect(config.summaryMaxOverageFactor).toBe(5);
  });

  it("reads summaryMaxOverageFactor and maxAssemblyTokenBudget from plugin config", () => {
    const config = resolveLcmConfig({}, {
      summaryMaxOverageFactor: 5,
      maxAssemblyTokenBudget: 30000,
    });
    expect(config.summaryMaxOverageFactor).toBe(5);
    expect(config.maxAssemblyTokenBudget).toBe(30000);
  });

  it("env vars override summaryMaxOverageFactor and maxAssemblyTokenBudget", () => {
    const config = resolveLcmConfig({
      LCM_SUMMARY_MAX_OVERAGE_FACTOR: "2.5",
      LCM_MAX_ASSEMBLY_TOKEN_BUDGET: "16000",
    } as NodeJS.ProcessEnv, {
      summaryMaxOverageFactor: 5,
      maxAssemblyTokenBudget: 30000,
    });
    expect(config.summaryMaxOverageFactor).toBe(2.5);
    expect(config.maxAssemblyTokenBudget).toBe(16000);
  });
});

describe("resolveOpenclawStateDir", () => {
  it("falls back to ~/.openclaw when OPENCLAW_STATE_DIR is unset", () => {
    const result = resolveOpenclawStateDir({});
    expect(result).toBe(join(homedir(), ".openclaw"));
  });

  it("returns OPENCLAW_STATE_DIR when set", () => {
    const result = resolveOpenclawStateDir({ OPENCLAW_STATE_DIR: "/custom/state" });
    expect(result).toBe("/custom/state");
  });

  it("trims whitespace from OPENCLAW_STATE_DIR", () => {
    const result = resolveOpenclawStateDir({ OPENCLAW_STATE_DIR: "  /custom/state  " });
    expect(result).toBe("/custom/state");
  });

  it("falls back to ~/.openclaw when OPENCLAW_STATE_DIR is an empty string", () => {
    const result = resolveOpenclawStateDir({ OPENCLAW_STATE_DIR: "" });
    expect(result).toBe(join(homedir(), ".openclaw"));
  });

  it("falls back to ~/.openclaw when OPENCLAW_STATE_DIR is whitespace only", () => {
    const result = resolveOpenclawStateDir({ OPENCLAW_STATE_DIR: "   " });
    expect(result).toBe(join(homedir(), ".openclaw"));
  });
});

describe("resolveLcmConfig largeFilesDir", () => {
  it("defaults largeFilesDir to ~/.openclaw/lcm-files when OPENCLAW_STATE_DIR is unset", () => {
    const config = resolveLcmConfig({}, {});
    expect(config.largeFilesDir).toBe(join(homedir(), ".openclaw", "lcm-files"));
  });

  it("uses OPENCLAW_STATE_DIR for largeFilesDir when set", () => {
    const config = resolveLcmConfig(
      { OPENCLAW_STATE_DIR: "/custom/state" } as NodeJS.ProcessEnv,
      {},
    );
    expect(config.largeFilesDir).toBe("/custom/state/lcm-files");
  });

  it("LCM_LARGE_FILES_DIR env var overrides OPENCLAW_STATE_DIR for largeFilesDir", () => {
    const config = resolveLcmConfig(
      {
        OPENCLAW_STATE_DIR: "/custom/state",
        LCM_LARGE_FILES_DIR: "/explicit/files",
      } as NodeJS.ProcessEnv,
      {},
    );
    expect(config.largeFilesDir).toBe("/explicit/files");
  });

  it("largeFilesDir plugin config overrides OPENCLAW_STATE_DIR", () => {
    const config = resolveLcmConfig(
      { OPENCLAW_STATE_DIR: "/custom/state" } as NodeJS.ProcessEnv,
      { largeFilesDir: "/plugin/files" },
    );
    expect(config.largeFilesDir).toBe("/plugin/files");
  });

  it("LCM_LARGE_FILES_DIR env var overrides largeFilesDir plugin config", () => {
    const config = resolveLcmConfig(
      { LCM_LARGE_FILES_DIR: "/env/files" } as NodeJS.ProcessEnv,
      { largeFilesDir: "/plugin/files" },
    );
    expect(config.largeFilesDir).toBe("/env/files");
  });
});

describe("resolveLcmConfig databasePath uses OPENCLAW_STATE_DIR", () => {
  it("uses OPENCLAW_STATE_DIR for default databasePath", () => {
    const config = resolveLcmConfig(
      { OPENCLAW_STATE_DIR: "/custom/state" } as NodeJS.ProcessEnv,
      {},
    );
    expect(config.databasePath).toBe("/custom/state/lcm.db");
  });

  it("LCM_DATABASE_PATH still overrides OPENCLAW_STATE_DIR", () => {
    const config = resolveLcmConfig(
      {
        OPENCLAW_STATE_DIR: "/custom/state",
        LCM_DATABASE_PATH: "/explicit/db.sqlite",
      } as NodeJS.ProcessEnv,
      {},
    );
    expect(config.databasePath).toBe("/explicit/db.sqlite");
  });
});
