import { performance } from "node:perf_hooks";

import { AlertCandidateIndex } from "../packages/alert-matcher/dist/index.js";
import { ScanScheduler } from "../packages/browser-runtime-core/dist/scan-scheduler.js";
import {
  InMemoryNotificationDeliveryQueue,
  InMemoryNotificationDeliveryStore,
  NotificationService
} from "../services/notifications/dist/index.js";

const alertCount = getPositiveInteger("HAULALERT_LOAD_TEST_ALERTS", 3_000, 100_000);
const loadCount = getPositiveInteger("HAULALERT_LOAD_TEST_LOADS", 300, 10_000);
const tabCount = getPositiveInteger("HAULALERT_LOAD_TEST_TABS", 2_000, 100_000);
const notificationCount = getPositiveInteger("HAULALERT_LOAD_TEST_NOTIFICATIONS", 3_000, 100_000);
const now = new Date("2026-09-28T12:00:00.000Z");

const index = new AlertCandidateIndex();
const buildStartedAt = performance.now();
for (let indexNumber = 0; indexNumber < alertCount; indexNumber += 1) {
  index.upsert({
    alertId: `alert-${indexNumber}`,
    userId: `user-${indexNumber}`,
    telegramChatId: String(1_000_000 + indexNumber),
    filter: {
      schemaVersion: 1,
      name: `Load test ${indexNumber}`,
      origins: [{ kind: "anywhere" }],
      destinations: [{ kind: "anywhere" }],
      trailerTypes: ["open"],
      vehicles: { minimum: null, maximum: null },
      readiness: { kind: "any" },
      minimumPayUsd: null,
      minimumRatePerMile: null,
      providers: [indexNumber % 3 === 0 ? "central-dispatch" : "shipcars"],
      blockedBrokerIds: []
    }
  });
}
const buildMilliseconds = elapsed(buildStartedAt);

let candidateCount = 0;
let matchCount = 0;
const matchingStartedAt = performance.now();
for (let indexNumber = 0; indexNumber < loadCount; indexNumber += 1) {
  const load = {
    provider: "central-dispatch",
    providerLoadId: `load-${indexNumber}`,
    pickup: { city: "Dallas", state: "TX", postalCode: "75201", coordinates: null },
    delivery: { city: "Miami", state: "FL", postalCode: "33101", coordinates: null },
    vehicleCount: 2,
    trailerType: "open",
    payUsd: 1_500,
    distanceMiles: 1_300,
    ratePerMile: 1.15,
    readyAt: "2026-09-28T12:00:00.000Z",
    postedAt: "2026-09-28T11:00:00.000Z",
    sourceUrl: null,
    broker: null
  };
  candidateCount += index.findCandidates(load).length;
  matchCount += index.findMatches(load, now).length;
}
const matchingMilliseconds = elapsed(matchingStartedAt);

const scheduler = new ScanScheduler();
const tabs = Array.from({ length: tabCount }, (_, indexNumber) => ({
  id: `tab-${indexNumber}`,
  providerSearchId: `search-${indexNumber}`,
  sessionId: "central-dispatch-local",
  provider: "central-dispatch",
  sourceFilterHash: `filter-${indexNumber}`,
  status: "ready",
  createdAt: "2026-09-28T11:00:00.000Z",
  lastScanAt: indexNumber % 10 === 0 ? null : "2026-09-28T11:59:00.000Z",
  recoveryAttemptCount: 0,
  nextRecoveryAt: null
}));
for (const tab of tabs) {
  scheduler.recordOutcome(tab.id, { newLoadCount: tab.id.endsWith("0") ? 1 : 0, overflowRisk: tab.id.endsWith("00") });
}
const schedulingStartedAt = performance.now();
const scheduledCount = scheduler.selectDue(tabs, now, tabCount).length;
const schedulingMilliseconds = elapsed(schedulingStartedAt);

let notificationSendCount = 0;
const notificationQueue = new InMemoryNotificationDeliveryQueue(
  new NotificationService(
    { send: async () => { notificationSendCount += 1; } },
    new InMemoryNotificationDeliveryStore()
  )
);
const notificationStartedAt = performance.now();
for (let indexNumber = 0; indexNumber < notificationCount; indexNumber += 1) {
  notificationQueue.enqueue({
    alertId: `alert-${indexNumber}`,
    userId: `user-${indexNumber}`,
    telegramChatId: String(1_000_000 + indexNumber),
    load: {
      provider: "central-dispatch",
      providerLoadId: "notification-load",
      pickup: { city: "Dallas", state: "TX", postalCode: "75201", coordinates: null },
      delivery: { city: "Miami", state: "FL", postalCode: "33101", coordinates: null },
      vehicleCount: 2,
      trailerType: "open",
      payUsd: 1_500,
      distanceMiles: 1_300,
      ratePerMile: 1.15,
      readyAt: "2026-09-28T12:00:00.000Z",
      postedAt: "2026-09-28T11:00:00.000Z",
      sourceUrl: null,
      broker: null
    }
  }, {}, now);
}
const notificationOutcomes = await notificationQueue.processDue(now);
const notificationMilliseconds = elapsed(notificationStartedAt);
const completedNotifications = notificationOutcomes.filter((outcome) => outcome.status === "completed").length;
if (
  notificationQueue.size !== 0 ||
  notificationSendCount !== notificationCount ||
  completedNotifications !== notificationCount
) {
  throw new Error("Notification smoke workload did not complete every queued delivery");
}

console.log(JSON.stringify({
  workload: { alertCount, loadCount, tabCount, notificationCount },
  results: {
    alertIndexBuildMilliseconds: round(buildMilliseconds),
    matchingMilliseconds: round(matchingMilliseconds),
    candidatesEvaluated: candidateCount,
    matchesFound: matchCount,
    schedulerMilliseconds: round(schedulingMilliseconds),
    scheduledTabs: scheduledCount,
    notificationMilliseconds: round(notificationMilliseconds),
    notificationsSent: notificationSendCount,
    completedNotifications
  }
}, null, 2));

function getPositiveInteger(name, fallback, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function elapsed(startedAt) {
  return performance.now() - startedAt;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
