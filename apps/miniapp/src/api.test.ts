import assert from "node:assert/strict";
import test from "node:test";

import { MiniAppApiClient, MiniAppApiError } from "./api.js";

test("Mini App API client carries Telegram initData and serializes alert creation", async () => {
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const client = new MiniAppApiClient("signed-init-data", "/api", async (input, init) => {
    captured = { input, ...(init === undefined ? {} : { init }) };
    return new Response(JSON.stringify({ alert: { id: "alert-1" } }), { status: 201 });
  });
  await client.createAlert({
    schemaVersion: 1,
    name: "Open loads",
    origins: [{ kind: "anywhere" }],
    destinations: [{ kind: "anywhere" }],
    trailerTypes: ["open"],
    vehicles: { minimum: null, maximum: null },
    readiness: { kind: "any" },
    minimumPayUsd: null,
    minimumRatePerMile: null,
    providers: ["central-dispatch"],
    blockedBrokerIds: []
  });

  assert.equal(captured?.input, "/api/v1/alerts");
  assert.equal(captured?.init?.headers && (captured.init.headers as Record<string, string>).authorization, "tma signed-init-data");
  assert.match(String(captured?.init?.body), /Open loads/);
});

test("Mini App API client updates only the selected alert", async () => {
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const client = new MiniAppApiClient("signed-init-data", "/api", async (input, init) => {
    captured = { input, ...(init === undefined ? {} : { init }) };
    return new Response(JSON.stringify({ alert: { id: "alert-1" } }), { status: 200 });
  });
  await client.updateAlert("alert-1", {
    schemaVersion: 1,
    name: "Updated route",
    origins: [{ kind: "state", state: "CA" }],
    destinations: [{ kind: "state", state: "AZ" }],
    trailerTypes: ["open"],
    vehicles: { minimum: null, maximum: null },
    readiness: { kind: "any" },
    minimumPayUsd: null,
    minimumRatePerMile: null,
    providers: ["central-dispatch"],
    blockedBrokerIds: []
  });

  assert.equal(captured?.input, "/api/v1/alerts/alert-1");
  assert.equal(captured?.init?.method, "PUT");
  assert.match(String(captured?.init?.body), /Updated route/);
});

test("Mini App API client surfaces a safe API failure", async () => {
  const client = new MiniAppApiClient("signed-init-data", "/api", async () => {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  });
  await assert.rejects(() => client.listAlerts(), (error: unknown) => {
    assert.ok(error instanceof MiniAppApiError);
    assert.equal(error.statusCode, 401);
    return true;
  });
});

test("Mini App API client searches broker profiles with Telegram authorization", async () => {
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const client = new MiniAppApiClient("signed-init-data", "/api", async (input, init) => {
    captured = { input, ...(init === undefined ? {} : { init }) };
    return new Response(JSON.stringify({ brokers: [] }));
  });
  await client.searchBrokers("MC 123");
  assert.equal(captured?.input, "/api/v1/brokers?q=MC%20123");
  assert.equal((captured?.init?.headers as Record<string, string>).authorization, "tma signed-init-data");
});

test("Mini App API client reads the signed-in user's referral summary", async () => {
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const client = new MiniAppApiClient("signed-init-data", "/api", async (input, init) => {
    captured = { input, ...(init === undefined ? {} : { init }) };
    return new Response(JSON.stringify({ referral: { code: "A7K92D4F", inviteLink: "https://t.me/HaulAlertBot?start=ref_A7K92D4F" } }));
  });
  const referral = await client.getReferralSummary();
  assert.equal(captured?.input, "/api/v1/referrals");
  assert.equal((captured?.init?.headers as Record<string, string>).authorization, "tma signed-init-data");
  assert.equal(referral.code, "A7K92D4F");
});

test("Mini App API client starts Essential checkout with the Telegram authorization", async () => {
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const client = new MiniAppApiClient("signed-init-data", "/api", async (input, init) => {
    captured = { input, ...(init === undefined ? {} : { init }) };
    return new Response(JSON.stringify({ checkout: { url: "https://checkout.stripe.com/c/pay/test" } }), { status: 201 });
  });
  assert.equal((await client.createEssentialCheckout()).url, "https://checkout.stripe.com/c/pay/test");
  assert.equal(captured?.input, "/api/v1/account/subscription/checkout");
  assert.equal(captured?.init?.method, "POST");
  assert.equal((captured?.init?.headers as Record<string, string>).authorization, "tma signed-init-data");
});

test("Mini App API client opens the Stripe billing portal with the Telegram authorization", async () => {
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const client = new MiniAppApiClient("signed-init-data", "/api", async (input, init) => {
    captured = { input, ...(init === undefined ? {} : { init }) };
    return new Response(JSON.stringify({ portal: { url: "https://billing.stripe.com/p/session/test" } }), { status: 201 });
  });
  assert.equal((await client.createBillingPortal()).url, "https://billing.stripe.com/p/session/test");
  assert.equal(captured?.input, "/api/v1/account/subscription/portal");
  assert.equal(captured?.init?.method, "POST");
});
