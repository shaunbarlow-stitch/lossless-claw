/**
 * Pi-side configuration loader for lossless-claw.
 *
 * Reuses the existing `resolveLcmConfigWithDiagnostics` from `src/db/config.ts`
 * but overrides the defaults for `databasePath` and `largeFilesDir` to live
 * under the pi extensions data dir (user-wide, not project-wide). This is the
 * "fresh start" config layer from the Phase 1 plan; the LcmConfig schema is
 * preserved so the engine code is unchanged.
 *
 * Precedence (highest first):
 *   1. Environment variables (LCM_*) — already handled by resolveLcmConfig
 *   2. Pi extension config (passed in via the factory)
 *   3. Defaults declared here
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type LcmConfig,
  type LcmConfigDiagnostics,
  resolveLcmConfigWithDiagnostics,
} from "../db/config.js";

/** Default user-scoped data directory for lossless-claw under pi. */
export function defaultLcmDataDir(): string {
  return join(homedir(), ".pi", "agent", "extensions", "lossless-claw");
}

export function defaultLcmDatabasePath(): string {
  return join(defaultLcmDataDir(), "lcm.db");
}

/** User-editable extension config, separate from pi's host settings. */
export function defaultPiLcmConfigPath(): string {
  return join(defaultLcmDataDir(), "config.json");
}

/**
 * Load the pi extension's JSON configuration. Pi extension factories receive
 * no settings payload, so configuration lives beside the user-scoped LCM DB.
 * `LCM_CONFIG_PATH` selects a different file for automation or testing.
 */
export function loadPiLcmConfig(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const path = env.LCM_CONFIG_PATH?.trim() || defaultPiLcmConfigPath();
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read Lossless Claw config at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Lossless Claw config at ${path} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function defaultLcmLargeFilesDir(): string {
  return join(defaultLcmDataDir(), "files");
}

/**
 * Pi-specific overlay options. These layer on top of LcmConfig so users can
 * tune pi-only behaviour without touching the engine config shape.
 */
export type PiLcmOverlay = {
  /**
   * If true (default), the per-session conversation row created for a pi
   * session that was never persisted to a session file is removed when the
   * session shuts down. This is the only automatic destructive behaviour the
   * extension is permitted to take; per AGENTS.md, it applies only to data
   * pi itself never persisted.
   */
  pruneEphemeralOnShutdown: boolean;
};

export const DEFAULT_PI_OVERLAY: PiLcmOverlay = {
  pruneEphemeralOnShutdown: true,
};

export type ResolvedPiLcmConfig = {
  config: LcmConfig;
  diagnostics: LcmConfigDiagnostics;
  overlay: PiLcmOverlay;
};

/**
 * Resolve LcmConfig for the pi host.
 *
 * `pluginConfig` is the object pi passes via extension settings (for example
 * the `lossless-claw` block in `~/.pi/settings.json`). Unknown keys are
 * ignored by the engine config loader, which is intentional.
 *
 * Pi-specific overlay keys (currently just `pruneEphemeralOnShutdown`) are
 * stripped from the engine-config view to avoid polluting LcmConfig.
 */
export function resolvePiLcmConfig(
  env: NodeJS.ProcessEnv = process.env,
  pluginConfig: Record<string, unknown> = {},
): ResolvedPiLcmConfig {
  const overlay: PiLcmOverlay = { ...DEFAULT_PI_OVERLAY };
  const cleaned: Record<string, unknown> = { ...pluginConfig };

  if (typeof cleaned.pruneEphemeralOnShutdown === "boolean") {
    overlay.pruneEphemeralOnShutdown = cleaned.pruneEphemeralOnShutdown;
  }
  delete cleaned.pruneEphemeralOnShutdown;

  // Inject pi-friendly defaults for databasePath / largeFilesDir only if the
  // caller did not provide an explicit value and no env override exists.
  // resolveLcmConfigWithDiagnostics already checks env, so we add defaults
  // here under pluginConfig precedence rather than via env mutation.
  if (
    cleaned.databasePath === undefined
    && env.LCM_DATABASE_PATH === undefined
  ) {
    cleaned.databasePath = defaultLcmDatabasePath();
  }
  if (
    cleaned.largeFilesDir === undefined
    && env.LCM_LARGE_FILES_DIR === undefined
  ) {
    cleaned.largeFilesDir = defaultLcmLargeFilesDir();
  }

  const resolved = resolveLcmConfigWithDiagnostics(env, cleaned);
  return {
    config: resolved.config,
    diagnostics: resolved.diagnostics,
    overlay,
  };
}
