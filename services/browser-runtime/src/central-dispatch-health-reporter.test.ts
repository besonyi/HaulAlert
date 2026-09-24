import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CentralDispatchHealthReporter } from "./central-dispatch-health-reporter.js";
import type { CentralDispatchRuntimeCycleResult } from "./central-dispatch-runtime-cycle.js";

function result(status: "healthy" | "offline"): CentralDispatchRuntimeCycleResult {
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
    outcomes: []
  };
}

describe("Central Dispatch health reporter", () => {
  it("logs only when browser-session health changes", () => {
    const messages: string[] = [];
    const reporter = new CentralDispatchHealthReporter((message) => { messages.push(message); });

    reporter.report(result("offline"));
    reporter.report(result("offline"));
    reporter.report(result("healthy"));
    reporter.report(result("healthy"));

    assert.deepEqual(messages, [
      "Central Dispatch browser session is offline: Chrome unavailable",
      "Central Dispatch browser session is healthy."
    ]);
  });
});
