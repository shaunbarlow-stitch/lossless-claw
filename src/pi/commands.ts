import { statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLcmDatabaseBackup } from "../db-backup.js";
import { applyScopedDoctorRepair } from "../doctor/apply.js";
import {
  applyDoctorCleaners,
  getDoctorCleanerFilterIds,
  scanDoctorCleaners,
  type DoctorCleanerId,
} from "../doctor/cleaners.js";
import { getDoctorSummaryStats } from "../doctor/shared.js";
import type { LcmContextEngine } from "../engine.js";
import { describeLogError } from "../lcm-log.js";
import type { LcmConfig } from "../db/config.js";
import type { LcmDependencies } from "../types.js";

export type LcmCommandBinding = {
  sessionKey: string | undefined;
  sessionIdForEngine: string | undefined;
  sessionFile: string | undefined;
  bootstrapped: boolean;
  databasePath: string;
  database: DatabaseSync;
  engine: LcmContextEngine;
  deps: LcmDependencies;
};

export type RegisterLcmCommandsOptions = {
  pi: ExtensionAPI;
  config: LcmConfig;
  ensureReady: () => Promise<void>;
  getBinding: () => LcmCommandBinding | undefined;
};

type Command =
  | { kind: "status" }
  | { kind: "backup" }
  | { kind: "rotate" }
  | { kind: "doctor"; apply: boolean }
  | { kind: "doctor_clean"; apply: boolean; filterId?: DoctorCleanerId; vacuum: boolean }
  | { kind: "help"; error?: string };

const ROTATE_LOCK_TIMEOUT_MS = 30_000;

function parseCommand(rawArgs: string): Command {
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens[0] === "status") {
    return tokens.length <= 1 ? { kind: "status" } : { kind: "help", error: "`/lcm status` takes no arguments." };
  }
  switch (tokens[0].toLowerCase()) {
    case "backup":
      return tokens.length === 1 ? { kind: "backup" } : { kind: "help", error: "`/lcm backup` takes no arguments." };
    case "rotate":
      return tokens.length === 1 ? { kind: "rotate" } : { kind: "help", error: "`/lcm rotate` takes no arguments." };
    case "doctor": {
      if (tokens.length === 1) return { kind: "doctor", apply: false };
      if (tokens.length === 2 && tokens[1]?.toLowerCase() === "apply") return { kind: "doctor", apply: true };
      if (tokens.length === 2 && tokens[1]?.toLowerCase() === "clean") {
        return { kind: "doctor_clean", apply: false, vacuum: false };
      }
      if (tokens[1]?.toLowerCase() !== "clean" || tokens[2]?.toLowerCase() !== "apply") {
        return { kind: "help", error: "Use `/lcm doctor`, `/lcm doctor apply`, `/lcm doctor clean`, or `/lcm doctor clean apply`." };
      }
      const rest = tokens.slice(3);
      let filterId: DoctorCleanerId | undefined;
      let vacuum = false;
      for (const token of rest) {
        if (token.toLowerCase() === "vacuum") {
          vacuum = true;
        } else if (!filterId && getDoctorCleanerFilterIds().includes(token as DoctorCleanerId)) {
          filterId = token as DoctorCleanerId;
        } else {
          return { kind: "help", error: `Unknown doctor-clean argument: \`${token}\`.` };
        }
      }
      return { kind: "doctor_clean", apply: true, filterId, vacuum };
    }
    case "help":
      return { kind: "help" };
    default:
      return { kind: "help", error: `Unknown subcommand: \`${tokens[0]}\`.` };
  }
}

function helpText(error?: string): string {
  return [
    ...(error ? [`Lossless Claw: ${error}`, ""] : []),
    "Lossless Claw commands:",
    "  /lcm [status]                       Show database and active-conversation status.",
    "  /lcm backup                         Create a timestamped database backup.",
    "  /lcm rotate                         Back up then rewrite this session's transcript tail.",
    "  /lcm doctor                         Scan this conversation for broken summaries.",
    "  /lcm doctor apply                   Repair detected summaries in this conversation.",
    "  /lcm doctor clean                   Scan global legacy-junk cleanup candidates.",
    "  /lcm doctor clean apply [filter] [vacuum]  Delete scanned candidates after confirmation.",
    `  filters: ${getDoctorCleanerFilterIds().join(", ")}`,
  ].join("\n");
}

function dbSizeLabel(path: string): string {
  try {
    return `${statSync(path).size.toLocaleString("en-US")} bytes`;
  } catch {
    return "unavailable";
  }
}

async function resolveConversation(binding: LcmCommandBinding) {
  if (!binding.sessionKey || !binding.sessionIdForEngine) return null;
  return binding.engine.getConversationStore().getConversationForSession({
    sessionKey: binding.sessionKey,
    sessionId: binding.sessionIdForEngine,
  });
}

function notify(ctx: { ui: { notify(message: string, level: "info" | "warning" | "error"): void } }, text: string, level: "info" | "warning" | "error" = "info"): void {
  ctx.ui.notify(text, level);
}

export function registerLcmCommands(options: RegisterLcmCommandsOptions): void {
  options.pi.registerCommand("lcm", {
    description: "Lossless Claw status, backups, transcript rotation, and doctor tools",
    getArgumentCompletions: (prefix) => {
      const values = ["status", "backup", "rotate", "doctor", "doctor apply", "doctor clean", "doctor clean apply", "help"];
      const matches = values.filter((value) => value.startsWith(prefix.toLowerCase()));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (rawArgs, ctx) => {
      const command = parseCommand(rawArgs);
      if (command.kind === "help") {
        notify(ctx, helpText(command.error));
        return;
      }

      await options.ensureReady();
      const binding = options.getBinding();
      if (!binding) {
        notify(ctx, "Lossless Claw is not bound to an active session yet.", "warning");
        return;
      }

      if (command.kind === "status") {
        const global = binding.database.prepare(
          `SELECT COUNT(*) AS conversations, (SELECT COUNT(*) FROM summaries) AS summaries FROM conversations`,
        ).get() as { conversations: number; summaries: number };
        const current = await resolveConversation(binding);
        const doctor = current ? getDoctorSummaryStats(binding.database, current.conversationId) : undefined;
        const debt = current
          ? await binding.engine.getCompactionMaintenanceStore().getConversationCompactionMaintenance(current.conversationId)
          : null;
        const messageCount = current
          ? await binding.engine.getConversationStore().getMessageCount(current.conversationId)
          : 0;
        notify(ctx, [
          "Lossless Claw",
          `DB: ${binding.databasePath} (${dbSizeLabel(binding.databasePath)})`,
          `Global: ${global.conversations} conversations, ${global.summaries} summaries`,
          current
            ? `Current: #${current.conversationId}, ${messageCount} messages, ${doctor?.total ?? 0} doctor issue(s)`
            : "Current: not stored yet (waiting for the pi session file)",
          debt?.pending || debt?.running
            ? `Deferred compaction: ${debt.running ? "running" : "pending"}${debt.reason ? ` (${debt.reason})` : ""}`
            : "Deferred compaction: none",
        ].join("\n"));
        return;
      }

      if (command.kind === "backup") {
        try {
          const backupPath = createLcmDatabaseBackup(binding.database, {
            databasePath: binding.databasePath,
            label: "backup",
          });
          notify(ctx, backupPath ? `Lossless Claw backup created:\n${backupPath}` : "Backups require a file-backed LCM database.", backupPath ? "info" : "warning");
        } catch (error) {
          notify(ctx, `Lossless Claw backup failed: ${describeLogError(error)}`, "error");
        }
        return;
      }

      if (command.kind === "rotate") {
        if (!binding.sessionFile || !binding.sessionKey || !binding.sessionIdForEngine) {
          notify(ctx, "Rotate requires a persisted, bound pi session.", "warning");
          return;
        }
        await ctx.waitForIdle();
        try {
          const result = await binding.engine.rotateSessionStorageWithBackup({
            sessionId: binding.sessionIdForEngine,
            sessionKey: binding.sessionKey,
            sessionFile: binding.sessionFile,
            lockTimeoutMs: ROTATE_LOCK_TIMEOUT_MS,
          });
          notify(ctx, result.kind === "rotated"
            ? `Rotated conversation #${result.currentConversationId}; preserved ${result.preservedTailMessageCount} tail messages; removed ${result.bytesRemoved.toLocaleString("en-US")} bytes.\nBackup: ${result.backupPath}`
            : `Rotate unavailable: ${result.reason}`, result.kind === "rotated" ? "info" : "warning");
        } catch (error) {
          notify(ctx, `Rotate failed: ${describeLogError(error)}`, "error");
        }
        return;
      }

      if (command.kind === "doctor") {
        const current = await resolveConversation(binding);
        if (!current) {
          notify(ctx, "Doctor requires a stored active conversation.", "warning");
          return;
        }
        if (!command.apply) {
          const stats = getDoctorSummaryStats(binding.database, current.conversationId);
          notify(ctx, stats.total
            ? `Doctor found ${stats.total} issue(s): ${stats.old} old fallback, ${stats.truncated} truncated, ${stats.fallback} fallback. Run /lcm doctor apply to repair.`
            : "Doctor: no broken-summary markers found in this conversation.");
          return;
        }
        try {
          const result = await applyScopedDoctorRepair({
            db: binding.database,
            config: options.config,
            conversationId: current.conversationId,
            deps: binding.deps,
          });
          notify(ctx, result.kind === "applied"
            ? `Doctor repair: ${result.repaired}/${result.detected} repaired, ${result.unchanged} unchanged, ${result.skipped.length} skipped.`
            : `Doctor repair unavailable: ${result.reason}`, result.kind === "applied" ? "info" : "warning");
        } catch (error) {
          notify(ctx, `Doctor repair failed: ${describeLogError(error)}`, "error");
        }
        return;
      }

      const scan = scanDoctorCleaners(binding.database, command.filterId ? [command.filterId] : undefined);
      if (!command.apply) {
        notify(ctx, scan.totalDistinctConversations
          ? `Doctor clean scan: ${scan.totalDistinctConversations} conversation(s), ${scan.totalDistinctMessages} message(s).\n${scan.filters.map((filter) => `${filter.id}: ${filter.conversationCount} conversations`).join("\n")}\nNo data was deleted.`
          : "Doctor clean scan: no legacy-junk candidates found. No data was deleted.");
        return;
      }
      if (scan.totalDistinctConversations === 0) {
        notify(ctx, "Doctor clean: no candidates to delete.");
        return;
      }
      if (!ctx.hasUI) {
        notify(ctx, "Doctor clean apply requires interactive confirmation; no data was deleted.", "warning");
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "Lossless Claw doctor clean",
        `Delete ${scan.totalDistinctConversations} conversation(s) / ${scan.totalDistinctMessages} message(s)? A database backup will be created first.`,
      );
      if (!confirmed) {
        notify(ctx, "Doctor clean cancelled; no data was deleted.");
        return;
      }
      try {
        const result = applyDoctorCleaners(binding.database, {
          databasePath: binding.databasePath,
          filterIds: command.filterId ? [command.filterId] : undefined,
          vacuum: command.vacuum,
        });
        notify(ctx, result.kind === "applied"
          ? `Doctor clean removed ${result.deletedConversations} conversation(s) and ${result.deletedMessages} message(s).\nBackup: ${result.backupPath}`
          : `Doctor clean unavailable: ${result.reason}`, result.kind === "applied" ? "info" : "warning");
      } catch (error) {
        notify(ctx, `Doctor clean failed: ${describeLogError(error)}`, "error");
      }
    },
  });
}
