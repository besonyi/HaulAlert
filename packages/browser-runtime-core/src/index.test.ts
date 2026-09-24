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

  it("re-provisions a degraded tab instead of allocating another one", () => {
    let now = new Date("2026-09-22T12:00:00.000Z");
    const runtime = new BrowserRuntime({ now: () => now, createTabId: () => "tab-1" });
    runtime.registerSession({ id: "central-1", provider: "central-dispatch" });

    const first = runtime.reserveSearchTab({
      provider: "central-dispatch",
      sourceFilterHash: "hash-a",
      providerSearchId: "11111111-1111-4111-8111-111111111111"
    });
    runtime.markTabReady(first.tab.id);
    const degraded = runtime.markTabDegraded(first.tab.id);
    now = new Date(degraded.nextRecoveryAt ?? now);
    const recovery = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-a" });

    assert.equal(recovery.reused, false);
    assert.equal(recovery.recovered, true);
    assert.equal(recovery.recoveryDeferred, false);
    assert.equal(recovery.tab.id, first.tab.id);
    assert.equal(recovery.tab.providerSearchId, first.tab.providerSearchId);
    assert.equal(recovery.tab.status, "provisioning");
    assert.equal(runtime.listTabs().length, 1);
  });

  it("defers degraded-tab recovery until its exponential backoff expires", () => {
    let now = new Date("2026-09-24T12:00:00.000Z");
    const runtime = new BrowserRuntime({
      now: () => now,
      createTabId: () => "tab-1",
      recoveryBaseDelayMs: 30_000,
      recoveryMaxDelayMs: 120_000
    });
    runtime.registerSession({ id: "central-1", provider: "central-dispatch" });
    const initial = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-a" });
    runtime.markTabReady(initial.tab.id);
    const degraded = runtime.markTabDegraded(initial.tab.id);

    const deferred = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-a" });
    now = new Date("2026-09-24T12:00:30.000Z");
    const recovered = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-a" });

    assert.equal(degraded.recoveryAttemptCount, 1);
    assert.equal(degraded.nextRecoveryAt, "2026-09-24T12:00:30.000Z");
    assert.equal(deferred.reused, true);
    assert.equal(deferred.recoveryDeferred, true);
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.tab.status, "provisioning");
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

  it("restores a credential-free snapshot and preserves tab allocation", () => {
    const original = createRuntime();
    original.registerSession({ id: "central-1", provider: "central-dispatch" });
    const reservation = original.reserveSearchTab({
      provider: "central-dispatch",
      sourceFilterHash: "hash-a",
      providerSearchId: "11111111-1111-4111-8111-111111111111"
    });
    original.markTabReady(reservation.tab.id);

    const restored = createRuntime();
    restored.restore(original.snapshot());
    const reused = restored.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "hash-a" });

    assert.equal(reused.reused, true);
    assert.equal(reused.tab.id, reservation.tab.id);
    assert.deepEqual(restored.snapshot(), original.snapshot());
  });

  it("rejects a restored tab that points at a foreign provider session", () => {
    const runtime = createRuntime();
    assert.throws(() => runtime.restore({
      sessions: [{ id: "central-1", provider: "central-dispatch", status: "healthy", createdAt: "2026-09-24T00:00:00.000Z", lastHeartbeatAt: null }],
      tabs: [{ id: "tab-1", providerSearchId: null, sessionId: "central-1", provider: "shipcars", sourceFilterHash: "hash", status: "ready", createdAt: "2026-09-24T00:00:00.000Z", lastScanAt: null, recoveryAttemptCount: 0, nextRecoveryAt: null }]
    }), /does not belong/);
  });
});
