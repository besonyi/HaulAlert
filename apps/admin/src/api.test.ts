import assert from "node:assert/strict";
import test from "node:test";

import { AdminApiClient, AdminApiError } from "./api.js";

test("admin client sends Telegram authorization and returns the operational overview", async () => {
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const client = new AdminApiClient("signed-init-data", "/api", async (input, init) => {
    captured = { input, ...(init === undefined ? {} : { init }) };
    return new Response(JSON.stringify({ overview: { users: 3, activeAlerts: 2, loads: 5, sessions: [], tabs: [], deliveries: [], recovery: [] } }));
  });

  const overview = await client.getOverview();
  assert.equal(captured?.input, "/api/v1/admin/overview");
  assert.equal((captured?.init?.headers as Record<string, string>).authorization, "tma signed-init-data");
  assert.equal(overview.loads, 5);
});

test("admin client reports a rejected operator session", async () => {
  const client = new AdminApiClient("signed-init-data", "/api", async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));
  await assert.rejects(() => client.getOverview(), (error: unknown) => {
    assert.ok(error instanceof AdminApiError);
    assert.equal(error.statusCode, 403);
    return true;
  });
});

test("admin client encodes a bounded operations search", async () => {
  let path = "";
  const client = new AdminApiClient("signed-init-data", "/api", async (input) => {
    path = String(input);
    return new Response(JSON.stringify({ results: { users: [], alerts: [], loads: [], deliveries: [] } }));
  });
  await client.search("CA AZ");
  assert.equal(path, "/api/v1/admin/search?q=CA%20AZ");
});
