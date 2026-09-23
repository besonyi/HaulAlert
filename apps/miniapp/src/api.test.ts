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
