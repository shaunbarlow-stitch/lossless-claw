import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireSharedLcm,
  clearAllSharedLcm,
  getSharedLcm,
  releaseSharedLcm,
  type SharedLcmEntry,
} from "../src/pi/shared-init.js";

function entry(dbPath: string, shutdown = vi.fn()): SharedLcmEntry {
  return {
    dbPath,
    database: {} as SharedLcmEntry["database"],
    engine: {} as SharedLcmEntry["engine"],
    deps: {} as SharedLcmEntry["deps"],
    shutdown,
  };
}

afterEach(() => clearAllSharedLcm());

describe("pi shared LCM initialization", () => {
  it("shares a normalized database path and only shuts down after the last release", async () => {
    const shutdown = vi.fn();
    const create = vi.fn(() => entry("./tmp/lcm.db", shutdown));
    const first = await acquireSharedLcm({ dbPath: "./tmp/lcm.db", create });
    const second = await acquireSharedLcm({ dbPath: "./tmp/lcm.db", create });

    expect(second).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(getSharedLcm("./tmp/lcm.db")).toBe(first);

    await releaseSharedLcm("./tmp/lcm.db");
    expect(shutdown).not.toHaveBeenCalled();
    expect(getSharedLcm("./tmp/lcm.db")).toBe(first);

    await releaseSharedLcm("./tmp/lcm.db");
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(getSharedLcm("./tmp/lcm.db")).toBeUndefined();
  });

  it("does not let a failed shutdown poison future acquires", async () => {
    const first = await acquireSharedLcm({
      dbPath: ":memory:",
      create: () => entry(":memory:", () => { throw new Error("close failed"); }),
    });
    await releaseSharedLcm(first.dbPath);

    const create = vi.fn(() => entry(":memory:"));
    await acquireSharedLcm({ dbPath: ":memory:", create });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
