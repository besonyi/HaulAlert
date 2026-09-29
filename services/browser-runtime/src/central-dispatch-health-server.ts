import { createServer, type Server, type ServerResponse } from "node:http";

/** Holds only the readiness state required to monitor a local browser runtime. */
export class CentralDispatchRuntimeHealth {
  private ready = false;

  public reportSession(status: "healthy" | "offline"): void {
    this.ready = status === "healthy";
  }

  public reportCycleFailure(): void {
    this.ready = false;
  }

  public isReady(): boolean {
    return this.ready;
  }
}

/** Creates a loopback-only-safe HTTP handler with no session or provider data. */
export function createCentralDispatchHealthServer(health: CentralDispatchRuntimeHealth): Server {
  return createServer((request, response) => {
    setSecurityHeaders(response);
    if (request.url === "/healthz") {
      writeJson(response, request.method === "GET" ? 200 : 405, request.method === "GET"
        ? { status: "ok" }
        : { error: "method_not_allowed" });
      return;
    }
    if (request.url === "/readyz") {
      if (request.method !== "GET") {
        writeJson(response, 405, { error: "method_not_allowed" });
        return;
      }
      writeJson(response, health.isReady() ? 200 : 503, { status: health.isReady() ? "ready" : "unavailable" });
      return;
    }
    writeJson(response, 404, { error: "not_found" });
  });
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
