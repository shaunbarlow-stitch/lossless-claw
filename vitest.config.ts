import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Isolate per-test home so user-wide LCM data paths point at a tmp dir.
// The legacy `.openclaw` subdirectory is preserved here only because some
// engine defaults still resolve under it; Phase 1 will retarget defaults to
// `~/.pi/agent/extensions/lossless-claw/` and this stub can be removed.
const testHome = mkdtempSync(join(tmpdir(), "lossless-claw-vitest-home-"));
mkdirSync(join(testHome, ".openclaw"), { recursive: true });

export default defineConfig({
  test: {
    dir: "test",
    include: ["**/*.test.ts"],
    exclude: ["**/.worktrees/**"],
    env: {
      HOME: testHome,
    },
  },
});
