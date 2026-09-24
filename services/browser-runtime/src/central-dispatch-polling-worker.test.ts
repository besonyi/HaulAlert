import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CentralDispatchPollingWorker,
  type CentralDispatchRuntimeCycleResult,
  type CentralDispatchRuntimeCycleRunner
} from "./index.js";

function healthyResult(): CentralDispatchRuntimeCycleResult {
  return {
    health: {
      status: "healthy",
      session: {
        id: "central-local",
        provider: "central-dispatch",
        status: "healthy",
        createdAt: "2026-09-24T12:00:00.000Z",
        lastHeartbeatAt: "2026-09-24T12:00:00.000Z"
      }
    },
    outcomes: []
  };
}

describe("CentralDispatchPollingWorker", () => {
  it("shares one in-flight provider cycle across overlapping polls", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const pending = new Promise<CentralDispatchRuntimeCycleResult>((resolve) => {
      release = () => resolve(healthyResult());
    });
    const runner: CentralDispatchRuntimeCycleRunner = {
      processDue: async () => {
        calls += 1;
        return pending;
      }
    };
    const worker = new CentralDispatchPollingWorker(runner, { clock: () => new Date("2026-09-24T12:00:00.000Z") });

    const first = worker.processOnce();
    const second = worker.processOnce();

    assert.equal(calls, 1);
    assert.equal(first, second);
    release?.();
    await Promise.all([first, second]);

    await worker.processOnce();
    assert.equal(calls, 2);
  });

  it("releases the single-flight guard after a failed cycle", async () => {
    let calls = 0;
    const runner: CentralDispatchRuntimeCycleRunner = {
      processDue: async () => {
        calls += 1;
        if (calls === 1) throw new Error("Central Dispatch unavailable");
        return healthyResult();
      }
    };
    const worker = new CentralDispatchPollingWorker(runner);

    await assert.rejects(worker.processOnce(), /Central Dispatch unavailable/);
    await worker.processOnce();

    assert.equal(calls, 2);
  });

  it("rejects invalid scheduling options before making provider calls", () => {
    const runner: CentralDispatchRuntimeCycleRunner = { processDue: async () => healthyResult() };

    assert.throws(() => new CentralDispatchPollingWorker(runner, { batchSize: 0 }), /batchSize must be a positive integer/);
    assert.throws(() => new CentralDispatchPollingWorker(runner, { pollIntervalMs: 0 }), /pollIntervalMs must be a positive integer/);
  });
});
