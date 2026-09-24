import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type {
  AlertManagementRepository,
  AuthenticatedTelegramUser,
  DashboardRepository,
  ManagedAlert
} from "./index.js";
import { InactiveSubscriptionError, PlanLimitExceededError } from "./entitlements.js";

type AuthenticatedApiUser = AuthenticatedTelegramUser & { readonly telegramUserId?: string };

const maximumRequestBodyBytes = 1_000_000;

export interface MiniAppApiDependencies {
  readonly alerts: AlertManagementRepository;
  readonly dashboard: DashboardRepository;
  readonly adminDashboard?: { getOverview(): Promise<unknown> };
  readonly adminSearch?: { search(query: string): Promise<unknown> };
  readonly brokerDirectory?: { search(query: string): Promise<unknown> };
  readonly entitlements?: {
    getForUser(userId: string): Promise<unknown>;
    assertCanCreateAlert(userId: string): Promise<void>;
    cancelAtPeriodEnd(userId: string): Promise<unknown | undefined>;
  };
  readonly isAdmin?: (telegramUserId: string) => boolean;
  readonly authenticate: (initData: string) => AuthenticatedApiUser | Promise<AuthenticatedApiUser>;
}

/** Creates the authenticated, customer-facing API used by the Telegram Mini App. */
export function createMiniAppApiServer(dependencies: MiniAppApiDependencies): Server {
  return createServer((request, response) => {
    void handleRequest(request, dependencies)
      .then((result) => writeJson(response, result.statusCode, result.body))
      .catch(() => writeJson(response, 500, { error: "internal_error" }));
  });
}

interface ApiResult {
  readonly statusCode: number;
  readonly body: unknown;
}

async function handleRequest(request: IncomingMessage, dependencies: MiniAppApiDependencies): Promise<ApiResult> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!pathname.startsWith("/v1/")) return { statusCode: 404, body: { error: "not_found" } };

  let user: AuthenticatedApiUser;
  try {
    user = await dependencies.authenticate(getInitData(request));
  } catch {
    return { statusCode: 401, body: { error: "unauthorized" } };
  }

  try {
    if (pathname === "/v1/admin/overview" && request.method === "GET") {
      if (dependencies.adminDashboard === undefined || dependencies.isAdmin === undefined) return { statusCode: 404, body: { error: "not_found" } };
      return dependencies.isAdmin(user.telegramUserId ?? user.id)
        ? { statusCode: 200, body: { overview: await dependencies.adminDashboard.getOverview() } }
        : { statusCode: 403, body: { error: "forbidden" } };
    }
    if (pathname === "/v1/admin/search" && request.method === "GET") {
      if (dependencies.adminSearch === undefined || dependencies.isAdmin === undefined) return { statusCode: 404, body: { error: "not_found" } };
      if (!dependencies.isAdmin(user.telegramUserId ?? user.id)) return { statusCode: 403, body: { error: "forbidden" } };
      const query = url.searchParams.get("q")?.trim() ?? "";
      if (query.length < 2 || query.length > 80) return { statusCode: 400, body: { error: "invalid_search_query" } };
      return { statusCode: 200, body: { results: await dependencies.adminSearch.search(query) } };
    }
    if (pathname === "/v1/brokers" && request.method === "GET") {
      if (dependencies.brokerDirectory === undefined) return { statusCode: 404, body: { error: "not_found" } };
      const query = url.searchParams.get("q")?.trim() ?? "";
      if (query.length < 2 || query.length > 80) return { statusCode: 400, body: { error: "invalid_broker_query" } };
      return { statusCode: 200, body: { brokers: await dependencies.brokerDirectory.search(query) } };
    }
    if (pathname === "/v1/account/entitlement" && request.method === "GET") {
      if (dependencies.entitlements === undefined) return { statusCode: 404, body: { error: "not_found" } };
      return { statusCode: 200, body: { entitlement: await dependencies.entitlements.getForUser(user.id) } };
    }
    if (pathname === "/v1/account/subscription/cancel" && request.method === "POST") {
      if (dependencies.entitlements === undefined) return { statusCode: 404, body: { error: "not_found" } };
      const entitlement = await dependencies.entitlements.cancelAtPeriodEnd(user.id);
      return entitlement === undefined ? { statusCode: 409, body: { error: "subscription_unavailable" } } : { statusCode: 200, body: { entitlement } };
    }
    if (pathname === "/v1/dashboard" && request.method === "GET") {
      return { statusCode: 200, body: { dashboard: await dependencies.dashboard.getForUser(user.id) } };
    }
    if (pathname === "/v1/alerts" && request.method === "GET") {
      return { statusCode: 200, body: { alerts: await dependencies.alerts.listForUser(user.id) } };
    }
    if (pathname === "/v1/alerts" && request.method === "POST") {
      const body = await parseBody(request);
      await dependencies.entitlements?.assertCanCreateAlert(user.id);
      return { statusCode: 201, body: { alert: await dependencies.alerts.create({ userId: user.id, filter: body.filter }) } };
    }

    const route = parseAlertRoute(pathname);
    if (route === undefined) return { statusCode: 404, body: { error: "not_found" } };
    if (!isUuid(route.alertId)) return { statusCode: 400, body: { error: "invalid_alert_id" } };

    if (route.action === "root" && request.method === "PUT") {
      const body = await parseBody(request);
      const alert = await dependencies.alerts.update({ alertId: route.alertId, userId: user.id, filter: body.filter });
      return alert === undefined
        ? { statusCode: 404, body: { error: "not_found" } }
        : { statusCode: 200, body: { alert } };
    }
    if (route.action === "root" && request.method === "DELETE") {
      const removed = await dependencies.alerts.remove(route.alertId, user.id);
      return removed
        ? { statusCode: 204, body: undefined }
        : { statusCode: 404, body: { error: "not_found" } };
    }
    if ((route.action === "pause" || route.action === "resume") && request.method === "POST") {
      const alert = await dependencies.alerts.setStatus(route.alertId, user.id, route.action === "pause" ? "paused" : "active");
      return alert === undefined
        ? { statusCode: 404, body: { error: "not_found" } }
        : { statusCode: 200, body: { alert } };
    }
    if (route.action === "duplicate" && request.method === "POST") {
      const body = await parseBody(request);
      if (typeof body.name !== "string") return { statusCode: 400, body: { error: "invalid_body" } };
      const alert = await dependencies.alerts.duplicate(route.alertId, user.id, body.name);
      return alert === undefined
        ? { statusCode: 404, body: { error: "not_found" } }
        : { statusCode: 201, body: { alert } };
    }
    return { statusCode: 405, body: { error: "method_not_allowed" } };
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError) return { statusCode: 413, body: { error: "body_too_large" } };
    if (error instanceof PlanLimitExceededError) return { statusCode: 403, body: { error: "plan_limit_reached" } };
    if (error instanceof InactiveSubscriptionError) return { statusCode: 403, body: { error: "subscription_inactive" } };
    if (error instanceof InvalidBodyError || isInputValidationError(error)) {
      return { statusCode: 400, body: { error: "invalid_body" } };
    }
    throw error;
  }
}

function getInitData(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  if (authorization === undefined || !authorization.startsWith("tma ")) {
    throw new Error("Missing Telegram Mini App authorization");
  }
  return authorization.slice(4);
}

async function parseBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maximumRequestBodyBytes) throw new RequestBodyTooLargeError();
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!isRecord(parsed)) throw new InvalidBodyError();
    return parsed;
  } catch (error: unknown) {
    if (error instanceof InvalidBodyError) throw error;
    throw new InvalidBodyError();
  }
}

function parseAlertRoute(pathname: string): { readonly alertId: string; readonly action: "root" | "pause" | "resume" | "duplicate" } | undefined {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments[0] !== "v1" || segments[1] !== "alerts" || segments[2] === undefined || segments.length > 4) return undefined;
  const action = segments[3] ?? "root";
  if (action !== "root" && action !== "pause" && action !== "resume" && action !== "duplicate") return undefined;
  return { alertId: segments[2], action };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  if (statusCode === 204) {
    response.end();
    return;
  }
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInputValidationError(error: unknown): boolean {
  return isRecord(error) && Array.isArray(error.issues);
}

class RequestBodyTooLargeError extends Error {}
class InvalidBodyError extends Error {}
