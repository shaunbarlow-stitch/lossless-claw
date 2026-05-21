import type { LcmDependencies } from "./types.js";

export type LcmLogger = LcmDependencies["log"];

/** Silent logger used when a caller does not provide an explicit sink. */
export const NOOP_LCM_LOGGER: LcmLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Format unknown failures into stable one-line log text. */
export function describeLogError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create an LCM logger from a host-supplied logger object.
 *
 * Historically this preferred OpenClaw's file-backed runtime logger when
 * available. After the pi-port fork, the pi adapter (Phase 1) is responsible
 * for constructing a `LcmLogger` from `ctx.ui` / pi's logging facilities and
 * passing it via `LcmDependencies`. This helper is retained for callers that
 * still need a console-shaped logger.
 */
export function createConsoleLcmLogger(): LcmLogger {
  return {
    info: (message) => console.info(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message),
    debug: (message) => console.debug?.(message),
  };
}
