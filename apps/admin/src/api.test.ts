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

test("admin client reads the protected operator audit trail", async () => {
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const client = new AdminApiClient("signed-init-data", "/api", async (input, init) => {
    captured = { input, ...(init === undefined ? {} : { init }) };
    return new Response(JSON.stringify({ events: [{ id: "audit-1", action: "partner_approval_requested" }] }));
  });
  const events = await client.getAuditEvents();
  assert.equal(captured?.input, "/api/v1/admin/audit-events");
  assert.equal((captured?.init?.headers as Record<string, string>).authorization, "tma signed-init-data");
  assert.equal(events[0]?.id, "audit-1");
});

test("admin client reads protected beta feedback", async () => {
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const client = new AdminApiClient("signed-init-data", "/api", async (input, init) => {
    captured = { input, ...(init === undefined ? {} : { init }) };
    return new Response(JSON.stringify({ feedback: [{ id: "feedback-1", message: "Helpful", userId: "user-1", createdAt: "2026-09-29T00:00:00.000Z", reviewedAt: null }] }));
  });
  const feedback = await client.getBetaFeedback();
  assert.equal(captured?.input, "/api/v1/admin/beta-feedback");
  assert.equal((captured?.init?.headers as Record<string, string>).authorization, "tma signed-init-data");
  assert.equal(feedback[0]?.message, "Helpful");
});

test("admin client marks beta feedback reviewed with Telegram authorization", async () => {
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const client = new AdminApiClient("signed-init-data", "/api", async (input, init) => {
    captured = { input, ...(init === undefined ? {} : { init }) };
    return new Response(JSON.stringify({ feedback: { id: "feedback-1" } }));
  });
  await client.markBetaFeedbackReviewed("feedback-1");
  assert.equal(captured?.input, "/api/v1/admin/beta-feedback/feedback-1/review");
  assert.equal(captured?.init?.method, "POST");
  assert.equal((captured?.init?.headers as Record<string, string>).authorization, "tma signed-init-data");
});

test("admin client reads its role and sends protected partner controls", async () => {
  const requests: Array<{ input: string; method: string | undefined }> = [];
  const client = new AdminApiClient("signed-init-data", "/api", async (input, init) => {
    requests.push({ input: String(input), method: init?.method });
    return new Response(JSON.stringify(String(input).endsWith("/access") ? { role: "operator" } : { partner: { status: "active" } }));
  });
  assert.equal(await client.getAccess(), "operator");
  await client.approvePartner("11111111-1111-4111-8111-111111111111");
  await client.setPartnerRisk("11111111-1111-4111-8111-111111111111", "high-risk");
  await client.setPartnerCashOutHold("11111111-1111-4111-8111-111111111111", "freeze");
  await client.setPartnerCashOutHold("11111111-1111-4111-8111-111111111111", "unfreeze");
  await client.getCashOutRequests();
  await client.reviewCashOutRequest("11111111-1111-4111-8111-111111111111", "approve");
  await client.reviewCashOutRequest("11111111-1111-4111-8111-111111111111", "reject");
  assert.deepEqual(requests, [
    { input: "/api/v1/admin/access", method: undefined },
    { input: "/api/v1/admin/partners/11111111-1111-4111-8111-111111111111/approve", method: "POST" },
    { input: "/api/v1/admin/partners/11111111-1111-4111-8111-111111111111/risk/high-risk", method: "POST" },
    { input: "/api/v1/admin/partners/11111111-1111-4111-8111-111111111111/cash-out/freeze", method: "POST" },
    { input: "/api/v1/admin/partners/11111111-1111-4111-8111-111111111111/cash-out/unfreeze", method: "POST" },
    { input: "/api/v1/admin/cash-out/requests", method: undefined },
    { input: "/api/v1/admin/cash-out/requests/11111111-1111-4111-8111-111111111111/approve", method: "POST" },
    { input: "/api/v1/admin/cash-out/requests/11111111-1111-4111-8111-111111111111/reject", method: "POST" }
  ]);
});
