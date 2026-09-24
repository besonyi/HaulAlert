import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CentralDispatchHealthReporter } from "./central-dispatch-health-reporter.js";
import type { CentralDispatchRuntimeCycleResult } from "./central-dispatch-runtime-cycle.js";

function result(
  status: "healthy" | "offline",
  overflowRisk = false,
  hasScanOutcome = overflowRisk
): CentralDispatchRuntimeCycleResult {
  return {
    health: {
      status,
      session: {
        id: "central-local",
        provider: "central-dispatch",
        status: status === "healthy" ? "healthy" : "offline",
        createdAt: "2026-09-24T12:00:00.000Z",
        lastHeartbeatAt: null
      },
      ...(status === "offline" ? { error: new Error("Chrome unavailable") } : {})
    },
    outcomes: hasScanOutcome ? [{
      status: "processed",
      tab: {
        id: "tab-1",
        providerSearchId: "11111111-1111-4111-8111-111111111111",
        sessionId: "central-local",
        provider: "central-dispatch",
        sourceFilterHash: "source-hash",
        status: "ready",
        createdAt: "2026-09-24T12:00:00.000Z",
        lastScanAt: "2026-09-24T12:00:00.000Z",
        recoveryAttemptCount: 0,
        nextRecoveryAt: null
      },
      result: { newLoads: [], seeded: false, boundaryFound: false, overflowRisk }
    }] : []
  };
}

describe("Central Dispatch health reporter", () => {
  it("logs only when browser-session health changes", () => {
    const messages: string[] = [];
    const reporter = new CentralDispatchHealthReporter((message) => { messages.push(message); });

    reporter.report(result("offline"));
    reporter.report(result("offline"));
    reporter.report(result("healthy"));
    reporter.report(result("healthy", false, true));

    assert.deepEqual(messages, [
      "Central Dispatch browser session is offline: Chrome unavailable",
      "Central Dispatch browser session is healthy."
    ]);
  });

  it("reports a capacity-risk bucket once while accelerated polling is active", () => {
    const messages: string[] = [];
    const reporter = new CentralDispatchHealthReporter((message) => { messages.push(message); });

    reporter.report(result("healthy", true));
    reporter.report(result("healthy", true));
    reporter.report(result("healthy", false, true));
    reporter.report(result("healthy", true));

    assert.deepEqual(messages, [
      "Central Dispatch browser session is healthy.",
      "Central Dispatch tab tab-1 reached the provider result capacity; accelerated polling is active and this bucket needs splitting.",
      "Central Dispatch tab tab-1 reached the provider result capacity; accelerated polling is active and this bucket needs splitting."
    ]);
  });
});
