/**
 * Per-DB shared init for the pi adapter.
 *
 * One pi process may host several sessions over its lifetime (`/new`,
 * `/resume`, `/fork`, `/reload`). Each session_start triggers our extension
 * factory again, but we want to share the SQLite connection and engine
 * instance across those reloads when the configured database path has not
 * changed.
 *
 * This module is a refcounted registry: `acquire(dbPath, factory)` returns
 * the existing entry if any, otherwise creates one via `factory`.
 * `release(dbPath)` decrements the refcount; when it reaches zero, the
 * shutdown callback runs and the entry is removed.
 */
import type { DatabaseSync } from "node:sqlite";
import type { LcmContextEngine } from "../engine.js";
import { normalizePath } from "../db/connection.js";

export type SharedLcmEntry = {
  dbPath: string;
  database: DatabaseSync;
  engine: LcmContextEngine;
  /** Cleanup called when the last reference is released. */
  shutdown: () => Promise<void> | void;
};

type RegistryRecord = SharedLcmEntry & { refCount: number };

const registry = new Map<string, RegistryRecord>();

export type AcquireOptions = {
  dbPath: string;
  create: () => Promise<SharedLcmEntry> | SharedLcmEntry;
};

export async function acquireSharedLcm(opts: AcquireOptions): Promise<SharedLcmEntry> {
  const key = normalizePath(opts.dbPath);
  const existing = registry.get(key);
  if (existing) {
    existing.refCount += 1;
    return existing;
  }
  const created = await opts.create();
  const record: RegistryRecord = { ...created, dbPath: key, refCount: 1 };
  registry.set(key, record);
  return record;
}

export async function releaseSharedLcm(dbPath: string): Promise<void> {
  const key = normalizePath(dbPath);
  const entry = registry.get(key);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount > 0) return;
  registry.delete(key);
  try {
    await entry.shutdown();
  } catch {
    // Shutdown errors are non-fatal for the process; the host will log.
  }
}

/** Visible for tests / `/lcm` introspection commands. */
export function getSharedLcm(dbPath: string): SharedLcmEntry | undefined {
  return registry.get(normalizePath(dbPath));
}

/** Visible for tests. */
export function clearAllSharedLcm(): void {
  registry.clear();
}
