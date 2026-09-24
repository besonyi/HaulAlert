import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BrowserRuntime, NoHealthySessionError } from "./index.js";

function createRuntime(): BrowserRuntime {
  let tabNumber = 0;
  return new BrowserRuntime({
    now: () => new Date("2026-09-22T12:00:00.000Z"),
    createTabId: () => `tab-${++tabNumber}`
  });
}

describe("browser runtime", () => {
  it("reuses a ready tab for the same provider-native filter", () => {
    const runtime = createRuntime();
    runtime.registerSession({ id: "central-1", provider: "central-dispatch" });

    const first = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-a" });
    runtime.markTabReady(first.tab.id);
    const second = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-a" });

    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.tab.id, first.tab.id);
  });

  it("balances new tabs across healthy sessions", () => {
    const runtime = createRuntime();
    runtime.registerSession({ id: "central-1", provider: "central-dispatch" });
    runtime.registerSession({ id: "central-2", provider: "central-dispatch" });

    const first = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-a" });
    runtime.markTabReady(first.tab.id);
    const second = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-b" });

    assert.equal(first.tab.sessionId, "central-1");
    assert.equal(second.tab.sessionId, "central-2");
  });

  it("does not reuse a tab whose session is unhealthy", () => {
    const runtime = createRuntime();
    runtime.registerSession({ id: "central-1", provider: "central-dispatch" });
    runtime.registerSession({ id: "central-2", provider: "central-dispatch" });

    const first = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-a" });
    runtime.markTabReady(first.tab.id);
    runtime.setSessionStatus("central-1", "expired");
    const replacement = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-a" });

    assert.equal(replacement.reused, false);
    assert.equal(replacement.tab.sessionId, "central-2");
  });

  it("refuses allocation when no healthy provider session exists", () => {
    const runtime = createRuntime();

    assert.throws(
      () => runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-a" }),
      NoHealthySessionError
    );
  });

  it("returns only ready tabs belonging to healthy sessions for scanning", () => {
    const runtime = createRuntime();
    runtime.registerSession({ id: "central-1", provider: "central-dispatch" });
    runtime.registerSession({ id: "central-2", provider: "central-dispatch" });
    const healthy = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-a" });
    const unhealthy = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-b" });
    runtime.markTabReady(healthy.tab.id);
    runtime.markTabReady(unhealthy.tab.id);
    runtime.setSessionStatus(unhealthy.tab.sessionId, "expired");

    assert.deepEqual(runtime.listScannableTabs().map(({ id }) => id), [healthy.tab.id]);
  });
});
