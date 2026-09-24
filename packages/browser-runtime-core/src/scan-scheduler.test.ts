import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PersistentSearchTab } from "./index.js";
import { ScanScheduler } from "./scan-scheduler.js";

const now = new Date("2026-09-23T12:00:30.000Z");

function tab(id: string, lastScanAt: string | null, status: PersistentSearchTab["status"] = "ready"): PersistentSearchTab {
  return {
    id,
    providerSearchId: null,
    sessionId: "session-1",
    provider: "central-dispatch",
    sourceFilterHash: `filter-${id}`,
    status,
    createdAt: "2026-09-23T12:00:00.000Z",
    lastScanAt,
    recoveryAttemptCount: 0,
    nextRecoveryAt: null
  };
}

describe("scan scheduler", () => {
  it("runs unscanned tabs first and ignores tabs that are not ready", () => {
    const scheduler = new ScanScheduler();
    const selected = scheduler.selectDue([
      tab("quiet", "2026-09-23T12:00:00.000Z"),
      tab("first", null),
      tab("degraded", null, "degraded")
    ], now);

    assert.deepEqual(selected.map(({ tab: scheduledTab, reason }) => [scheduledTab.id, reason]), [
      ["first", "initial"],
      ["quiet", "idle"]
    ]);
  });

  it("accelerates overflow-risk searches ahead of active and idle searches", () => {
    const scheduler = new ScanScheduler();
    const overflow = tab("overflow", "2026-09-23T12:00:20.000Z");
    const active = tab("active", "2026-09-23T12:00:15.000Z");
    const idle = tab("idle", "2026-09-23T12:00:00.000Z");
    scheduler.recordOutcome(overflow.id, { newLoadCount: 0, overflowRisk: true });
    scheduler.recordOutcome(active.id, { newLoadCount: 2, overflowRisk: false });

    const selected = scheduler.selectDue([idle, active, overflow], now);

    assert.deepEqual(selected.map(({ tab: scheduledTab, reason }) => [scheduledTab.id, reason]), [
      ["overflow", "overflow-risk"],
      ["active", "active"],
      ["idle", "idle"]
    ]);
  });

  it("waits for the configured interval when a tab is not due", () => {
    const scheduler = new ScanScheduler({ idleIntervalMs: 60_000 });
    assert.deepEqual(scheduler.selectDue([tab("recent", "2026-09-23T12:00:00.000Z")], now), []);
  });
});
