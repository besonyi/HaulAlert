import assert from "node:assert/strict";
import test from "node:test";

import { operationalStatus } from "./operational-status.js";

const baseline = {
  users: 1,
  activeAlerts: 1,
  loads: 1,
  sessions: [],
  tabs: [],
  deliveries: [],
  notificationBacklog: { queued: 0, retryScheduled: 0, dueNow: 0, oldestCreatedAt: null },
  recovery: []
} as const;

test("admin operational status is healthy when no recovery or dead letters are recorded", () => {
  assert.deepEqual(operationalStatus(baseline), {
    tone: "healthy",
    title: "No active recovery needed",
    detail: "No runtime recovery items or dead-letter deliveries are currently recorded."
  });
});

test("admin operational status prioritizes runtime recovery", () => {
  const status = operationalStatus({
    ...baseline,
    recovery: [{ kind: "session", provider: "central-dispatch", code: "offline", observedAt: "2026-01-01T00:00:00.000Z", nextRecoveryAt: null }]
  });

  assert.deepEqual(status, {
    tone: "attention",
    title: "Recovery needed",
    detail: "1 runtime recovery item needs review."
  });
});

test("admin operational status highlights dead-letter deliveries", () => {
  const status = operationalStatus({
    ...baseline,
    deliveries: [{ key: "dead_letter", count: 2 }]
  });

  assert.deepEqual(status, {
    tone: "attention",
    title: "Delivery attention needed",
    detail: "2 notifications reached dead letter status."
  });
});
