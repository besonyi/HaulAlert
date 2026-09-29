import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const defaultTimeoutMilliseconds = 5_000;
const minimumTimeoutMilliseconds = 100;
const maximumTimeoutMilliseconds = 60_000;

/** Reads only public service addresses; credentials in probe URLs are never accepted. */
export function getServiceProbeConfig(environment = process.env) {
  return {
    apiBaseUrl: publicBaseUrl(environment.HAULALERT_API_BASE_URL, "HAULALERT_API_BASE_URL"),
    botBaseUrl: publicBaseUrl(environment.HAULALERT_BOT_BASE_URL, "HAULALERT_BOT_BASE_URL"),
    centralDispatchBaseUrl: optionalLoopbackBaseUrl(
      environment.HAULALERT_CENTRAL_DISPATCH_HEALTH_BASE_URL,
      "HAULALERT_CENTRAL_DISPATCH_HEALTH_BASE_URL"
    ),
    timeoutMilliseconds: timeoutMilliseconds(environment.HAULALERT_PROBE_TIMEOUT_MS)
  };
}

/** Probes public API and Bot liveness/readiness endpoints without emitting endpoint or response contents. */
export async function probeServices({
  apiBaseUrl,
  botBaseUrl,
  centralDispatchBaseUrl,
  timeoutMilliseconds = defaultTimeoutMilliseconds,
  fetchImpl = fetch
}) {
  const probes = [
    { name: "api_liveness", url: endpoint(apiBaseUrl, "/healthz"), expectedStatus: "ok" },
    { name: "api_readiness", url: endpoint(apiBaseUrl, "/readyz"), expectedStatus: "ready" },
    { name: "bot_liveness", url: endpoint(botBaseUrl, "/healthz"), expectedStatus: "ok" },
    ...(centralDispatchBaseUrl === undefined ? [] : [
      { name: "central_dispatch_liveness", url: endpoint(centralDispatchBaseUrl, "/healthz"), expectedStatus: "ok" },
      { name: "central_dispatch_readiness", url: endpoint(centralDispatchBaseUrl, "/readyz"), expectedStatus: "ready" }
    ])
  ];
  return Promise.all(probes.map((probe) => runProbe(probe, timeoutMilliseconds, fetchImpl)));
}

async function runProbe(probe, timeoutMilliseconds, fetchImpl) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    const response = await fetchImpl(probe.url, { method: "GET", signal: controller.signal });
    if (!response.ok) throw new Error("unexpected_status");
    const body = await response.json();
    if (!isStatus(body, probe.expectedStatus)) throw new Error("unexpected_body");
    return { name: probe.name, status: "ok", durationMilliseconds: Math.round(performance.now() - startedAt) };
  } catch {
    throw new Error(`Service probe failed: ${probe.name}`);
  } finally {
    clearTimeout(timeout);
  }
}

function publicBaseUrl(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be configured`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL without credentials`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "") {
    throw new Error(`${name} must be an absolute HTTP(S) URL without credentials`);
  }
  return url.href;
}

function optionalLoopbackBaseUrl(value, name) {
  if (value === undefined || value.trim().length === 0) return undefined;
  const baseUrl = publicBaseUrl(value, name);
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error(`${name} must use credential-free http://127.0.0.1`);
  }
  return url.href;
}

function timeoutMilliseconds(value) {
  if (value === undefined || value.trim().length === 0) return defaultTimeoutMilliseconds;
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < minimumTimeoutMilliseconds || timeout > maximumTimeoutMilliseconds) {
    throw new Error(`HAULALERT_PROBE_TIMEOUT_MS must be an integer between ${minimumTimeoutMilliseconds} and ${maximumTimeoutMilliseconds}`);
  }
  return timeout;
}

function endpoint(baseUrl, path) {
  return new URL(path, baseUrl).href;
}

function isStatus(body, expectedStatus) {
  return typeof body === "object" && body !== null && body.status === expectedStatus;
}

function isMainModule() {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: HAULALERT_API_BASE_URL=<url> HAULALERT_BOT_BASE_URL=<url> [HAULALERT_CENTRAL_DISPATCH_HEALTH_BASE_URL=http://127.0.0.1:<port>] pnpm ops:probes");
  } else {
    probeServices(getServiceProbeConfig())
      .then((probes) => console.log(JSON.stringify({ status: "ok", probes }, null, 2)))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : "Service probes failed");
        process.exitCode = 1;
      });
  }
}
