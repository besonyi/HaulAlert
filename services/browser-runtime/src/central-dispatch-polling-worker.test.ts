import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CentralDispatchCircuitOpenError,
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
    let completions = 0;
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
    const worker = new CentralDispatchPollingWorker(runner, {
      clock: () => new Date("2026-09-24T12:00:00.000Z"),
      onCycleComplete: () => { completions += 1; }
    });

    const first = worker.processOnce();
    const second = worker.processOnce();

    assert.equal(calls, 1);
    assert.equal(first, second);
    release?.();
    await Promise.all([first, second]);
    assert.equal(completions, 1);

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

  it("pauses provider calls after repeated failures and retries after its cooldown", async () => {
    let calls = 0;
    const openedAt: Date[] = [];
    let now = new Date("2026-09-24T12:00:00.000Z");
    const runner: CentralDispatchRuntimeCycleRunner = {
      processDue: async () => {
        calls += 1;
        throw new Error("Central Dispatch unavailable");
      }
    };
    const worker = new CentralDispatchPollingWorker(runner, {
      circuitBreakerFailureThreshold: 2,
      circuitBreakerCooldownMs: 60_000,
      clock: () => now,
      onCircuitOpen: (retryAt) => { openedAt.push(retryAt); }
    });

    await assert.rejects(worker.processOnce(), /Central Dispatch unavailable/);
    await assert.rejects(worker.processOnce(), /Central Dispatch unavailable/);
    await assert.rejects(worker.processOnce(), (error: unknown) => {
      assert.ok(error instanceof CentralDispatchCircuitOpenError);
      assert.equal(error.retryAt.toISOString(), "2026-09-24T12:01:00.000Z");
      return true;
    });
    assert.equal(calls, 2);
    assert.deepEqual(openedAt.map((retryAt) => retryAt.toISOString()), ["2026-09-24T12:01:00.000Z"]);

    now = new Date("2026-09-24T12:01:00.000Z");
    await assert.rejects(worker.processOnce(), /Central Dispatch unavailable/);
    assert.equal(calls, 3);
  });

  it("rejects invalid scheduling options before making provider calls", () => {
    const runner: CentralDispatchRuntimeCycleRunner = { processDue: async () => healthyResult() };

    assert.throws(() => new CentralDispatchPollingWorker(runner, { batchSize: 0 }), /batchSize must be a positive integer/);
    assert.throws(() => new CentralDispatchPollingWorker(runner, { pollIntervalMs: 0 }), /pollIntervalMs must be a positive integer/);
    assert.throws(() => new CentralDispatchPollingWorker(runner, { circuitBreakerFailureThreshold: 0 }), /circuitBreakerFailureThreshold must be a positive integer/);
    assert.throws(() => new CentralDispatchPollingWorker(runner, { circuitBreakerCooldownMs: 0 }), /circuitBreakerCooldownMs must be a positive integer/);
  });
});
