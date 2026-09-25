import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createMiniAppApiServer } from "./http-api.js";
import type { AlertManagementRepository, ManagedAlert } from "./index.js";

const alertId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const alert: ManagedAlert = {
  id: alertId,
  userId,
  name: "Open route",
  status: "active",
  filter: {
    schemaVersion: 1,
    name: "Open route",
    origins: [{ kind: "anywhere" }],
    destinations: [{ kind: "anywhere" }],
    trailerTypes: ["open"],
    vehicles: { minimum: null, maximum: null },
    readiness: { kind: "any" },
    minimumPayUsd: null,
    minimumRatePerMile: null,
    providers: ["central-dispatch"],
    blockedBrokerIds: []
  },
  createdAt: new Date("2026-09-23T12:00:00.000Z"),
  updatedAt: new Date("2026-09-23T12:00:00.000Z")
};

test("Mini App API authenticates identity and scopes alert operations to it", async () => {
  const calls: string[] = [];
  const repository: AlertManagementRepository = {
    create: async (input) => { calls.push(`create:${input.userId}`); return alert; },
    listForUser: async (id) => { calls.push(`list:${id}`); return [alert]; },
    update: async (input) => { calls.push(`update:${input.userId}`); return alert; },
    setStatus: async (_id, id, status) => { calls.push(`${status}:${id}`); return { ...alert, status }; },
    duplicate: async (_id, id, name) => { calls.push(`duplicate:${id}:${name}`); return { ...alert, name }; },
    remove: async (_id, id) => { calls.push(`remove:${id}`); return true; }
  };
  const server = createMiniAppApiServer({
    alerts: repository,
    dashboard: { getForUser: async (id) => ({ activeAlertCount: id === userId ? 1 : 0, loadsFoundLast24Hours: 2, recentNotifications: [] }) },
    brokerDirectory: { search: async (query) => [{ name: "Example", mcNumber: query, dotNumber: null, matchedLoadCount: 1 }] },
    entitlements: {
      getForUser: async () => ({ planId: "starter", maxActiveAlerts: 3, activeAlertCount: 1, subscriptionStatus: "active" }),
      assertCanCreateAlert: async () => {},
      cancelAtPeriodEnd: async () => ({ planId: "starter", cancelAtPeriodEnd: true })
    },
    referrals: { getForUser: async () => ({ code: "A7K92D4F", activePaid: 2 }) },
    authenticate: (initData) => {
      assert.equal(initData, "verified-init-data");
      return { id: userId, firstName: "Alex" };
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a TCP server address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: "tma verified-init-data" };

    const list = await fetch(`${baseUrl}/v1/alerts`, { headers });
    assert.equal(list.status, 200);
    assert.equal((await list.json() as { alerts: ManagedAlert[] }).alerts[0]?.id, alertId);

    const dashboard = await fetch(`${baseUrl}/v1/dashboard`, { headers });
    assert.equal(dashboard.status, 200);
    assert.equal((await dashboard.json() as { dashboard: { activeAlertCount: number } }).dashboard.activeAlertCount, 1);

    const brokers = await fetch(`${baseUrl}/v1/brokers?q=123`, { headers });
    assert.equal(brokers.status, 200);
    assert.equal((await brokers.json() as { brokers: { mcNumber: string }[] }).brokers[0]?.mcNumber, "123");

    const entitlement = await fetch(`${baseUrl}/v1/account/entitlement`, { headers });
    assert.equal(entitlement.status, 200);
    assert.equal((await entitlement.json() as { entitlement: { planId: string } }).entitlement.planId, "starter");
    assert.equal((await fetch(`${baseUrl}/v1/account/subscription/cancel`, { method: "POST", headers })).status, 200);
    const referral = await fetch(`${baseUrl}/v1/referrals`, { headers });
    assert.equal(referral.status, 200);
    assert.equal((await referral.json() as { referral: { code: string } }).referral.code, "A7K92D4F");

    const pause = await fetch(`${baseUrl}/v1/alerts/${alertId}/pause`, { method: "POST", headers });
    assert.equal(pause.status, 200);
    assert.equal((await pause.json() as { alert: ManagedAlert }).alert.status, "paused");

    const duplicate = await fetch(`${baseUrl}/v1/alerts/${alertId}/duplicate`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Evening route" })
    });
    assert.equal(duplicate.status, 201);
    assert.deepEqual(calls, [`list:${userId}`, `paused:${userId}`, `duplicate:${userId}:Evening route`]);
  } finally {
    await new Promise<void>((resolveClosing, reject) => {
      server.close((error) => error === undefined ? resolveClosing() : reject(error));
    });
  }
});

test("Mini App API rejects unsigned callers and malformed requests", async () => {
  const server = createMiniAppApiServer({
    alerts: {} as AlertManagementRepository,
    dashboard: { getForUser: async () => { throw new Error("should not reach dashboard"); } },
    authenticate: () => { throw new Error("bad signature"); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a TCP server address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${baseUrl}/v1/alerts`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/v1/alerts/not-a-uuid`, {
      method: "DELETE",
      headers: { authorization: "tma signed-but-rejected" }
    })).status, 401);
  } finally {
    await new Promise<void>((resolveClosing, reject) => {
      server.close((error) => error === undefined ? resolveClosing() : reject(error));
    });
  }
});

test("admin overview is available only to an allowlisted Telegram identity", async () => {
  const server = createMiniAppApiServer({
    alerts: {} as AlertManagementRepository,
    dashboard: { getForUser: async () => ({ activeAlertCount: 0, loadsFoundLast24Hours: 0, recentNotifications: [] }) },
    adminDashboard: { getOverview: async () => ({ users: 3, activeAlerts: 2, loads: 5, sessions: [], tabs: [], deliveries: [], recovery: [] }) },
    adminSearch: { search: async (query) => ({ users: [{ telegramUserId: query }], alerts: [], loads: [], deliveries: [] }) },
    partners: { approve: async (userId) => ({ userId, status: "active" }) },
    isAdmin: (telegramUserId) => telegramUserId === "admin-telegram-id",
    authenticate: (initData) => ({ id: initData, firstName: "Alex" })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a TCP server address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${baseUrl}/v1/admin/overview`, { headers: { authorization: "tma customer" } })).status, 403);
    const response = await fetch(`${baseUrl}/v1/admin/overview`, { headers: { authorization: "tma admin-telegram-id" } });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { overview: { users: number } }).overview.users, 3);
    assert.equal((await fetch(`${baseUrl}/v1/admin/search?q=al`, { headers: { authorization: "tma customer" } })).status, 403);
    const search = await fetch(`${baseUrl}/v1/admin/search?q=123`, { headers: { authorization: "tma admin-telegram-id" } });
    assert.equal(search.status, 200);
    assert.equal((await search.json() as { results: { users: { telegramUserId: string }[] } }).results.users[0]?.telegramUserId, "123");
    assert.equal((await fetch(`${baseUrl}/v1/admin/search?q=x`, { headers: { authorization: "tma admin-telegram-id" } })).status, 400);
    assert.equal((await fetch(`${baseUrl}/v1/admin/partners/${userId}/approve`, { method: "POST", headers: { authorization: "tma customer" } })).status, 403);
    const approved = await fetch(`${baseUrl}/v1/admin/partners/${userId}/approve`, { method: "POST", headers: { authorization: "tma admin-telegram-id" } });
    assert.equal(approved.status, 200);
    assert.equal((await approved.json() as { partner: { status: string } }).partner.status, "active");
  } finally {
    await new Promise<void>((resolveClosing, reject) => server.close((error) => error === undefined ? resolveClosing() : reject(error)));
  }
});
