import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getServiceProbeConfig, probeServices } from "./service-probe.mjs";

describe("service probes", () => {
  it("checks API liveness and readiness plus Bot liveness", async () => {
    const paths = [];
    const probes = await probeServices({
      apiBaseUrl: "https://api.example.test",
      botBaseUrl: "https://bot.example.test",
      timeoutMilliseconds: 500,
      fetchImpl: async (url) => {
        const parsed = new URL(url);
        paths.push(`${parsed.hostname}${parsed.pathname}`);
        return new Response(JSON.stringify({ status: parsed.hostname === "api.example.test" && parsed.pathname === "/readyz" ? "ready" : "ok" }), { status: 200 });
      }
    });

    assert.deepEqual(paths.sort(), ["api.example.test/healthz", "api.example.test/readyz", "bot.example.test/healthz"]);
    assert.deepEqual(probes.map((probe) => [probe.name, probe.status]), [
      ["api_liveness", "ok"],
      ["api_readiness", "ok"],
      ["bot_liveness", "ok"]
    ]);
  });

  it("does not expose failed endpoint details", async () => {
    await assert.rejects(
      probeServices({
        apiBaseUrl: "https://api.example.test",
        botBaseUrl: "https://bot.example.test",
        fetchImpl: async () => new Response("unexpected", { status: 503 })
      }),
      (error) => error instanceof Error && error.message === "Service probe failed: api_liveness"
    );
  });

  it("accepts only public credential-free HTTP(S) configuration", () => {
    assert.deepEqual(getServiceProbeConfig({
      HAULALERT_API_BASE_URL: "https://api.example.test",
      HAULALERT_BOT_BASE_URL: "http://bot.example.test",
      HAULALERT_PROBE_TIMEOUT_MS: "900"
    }), {
      apiBaseUrl: "https://api.example.test/",
      botBaseUrl: "http://bot.example.test/",
      timeoutMilliseconds: 900
    });
    assert.throws(
      () => getServiceProbeConfig({ HAULALERT_API_BASE_URL: "https://user:pass@example.test", HAULALERT_BOT_BASE_URL: "https://bot.example.test" }),
      /without credentials/
    );
    assert.throws(
      () => getServiceProbeConfig({ HAULALERT_API_BASE_URL: "https://api.example.test", HAULALERT_BOT_BASE_URL: "https://bot.example.test", HAULALERT_PROBE_TIMEOUT_MS: "1" }),
      /between 100 and 60000/
    );
  });
});
