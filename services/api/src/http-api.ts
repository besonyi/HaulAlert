import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import type {
  AlertManagementRepository,
  AuthenticatedTelegramUser,
  DashboardRepository,
  ManagedAlert
} from "./index.js";
import { InactiveSubscriptionError, PlanLimitExceededError } from "./entitlements.js";
import { InvalidPartnerCashOutQuoteAmountError } from "./partner-cashout-quote.js";
import { InvalidPartnerCashOutRequestError, type CashOutReviewAction, type CashOutReviewResult, type CreatePartnerCashOutRequestInput } from "./partner-cashout-requests.js";
import { StripeCheckoutUnavailableError, SubscriptionAlreadyEssentialError } from "./stripe-billing.js";
import { InvalidStripeWebhookPayloadError, InvalidStripeWebhookSignatureError } from "./stripe-webhook.js";

type AuthenticatedApiUser = AuthenticatedTelegramUser & { readonly telegramUserId?: string };

const maximumRequestBodyBytes = 1_000_000;

export interface MiniAppApiDependencies {
  readonly alerts: AlertManagementRepository;
  readonly dashboard: DashboardRepository;
  readonly feedback?: {
    create(input: { readonly userId: string; readonly message: unknown }): Promise<unknown>;
    getRecent?(limit?: number): Promise<unknown>;
    markReviewed?(feedbackId: string): Promise<unknown | undefined>;
  };
  /** Verifies dependencies needed to serve customer requests, without authenticating a customer. */
  readonly readiness?: { check(): Promise<void> };
  readonly adminDashboard?: { getOverview(): Promise<unknown> };
  readonly adminSearch?: { search(query: string): Promise<unknown> };
  readonly brokerDirectory?: { search(query: string): Promise<unknown> };
  readonly entitlements?: {
    getForUser(userId: string): Promise<unknown>;
    assertCanCreateAlert(userId: string): Promise<void>;
    cancelAtPeriodEnd(userId: string): Promise<unknown | undefined>;
  };
  readonly referrals?: {
    getForUser(userId: string): Promise<unknown>;
  };
  readonly partners?: {
    approve(userId: string): Promise<unknown | undefined>;
    setRiskLevel?(userId: string, riskLevel: "new" | "trusted" | "high_risk"): Promise<unknown | undefined>;
    freezeCashOut?(userId: string): Promise<boolean>;
    unfreezeCashOut?(userId: string): Promise<boolean>;
    getEarnings?(userId: string): Promise<unknown | undefined>;
    getCashOutQuote?(userId: string, grossAmountCents: unknown): Promise<unknown | undefined>;
    getCashOutMethods?(): readonly unknown[];
    createCashOutRequest?(input: CreatePartnerCashOutRequestInput): Promise<unknown | undefined>;
    getCashOutRequests?(userId: string): Promise<readonly unknown[]>;
    cancelCashOutRequest?(userId: string, requestId: string): Promise<boolean>;
    getCashOutRequestsForReview?(): Promise<readonly unknown[]>;
    reviewCashOutRequest?(requestId: string, action: CashOutReviewAction, reviewerTelegramUserId: string): Promise<CashOutReviewResult | undefined>;
    getLedger?(userId: string): Promise<unknown>;
  };
  readonly audit?: {
    record(event: { readonly actorTelegramUserId: string; readonly action: "partner_approval_requested" | "partner_risk_updated" | "partner_cashout_frozen" | "partner_cashout_unfrozen" | "partner_cashout_approved" | "partner_cashout_rejected" | "beta_feedback_reviewed"; readonly subjectUserId: string }): Promise<void>;
    getRecent?(): Promise<unknown>;
  };
  readonly billing?: {
    createEssentialCheckout(userId: string): Promise<{ readonly url: string }>;
    createPortal(userId: string): Promise<{ readonly url: string }>;
  };
  readonly stripeWebhook?: {
    handle(payload: Buffer, signatureHeader: string | undefined): Promise<unknown>;
  };
  readonly adminRole?: (telegramUserId: string) => "viewer" | "operator" | undefined;
  readonly isAdmin?: (telegramUserId: string) => boolean;
  readonly authenticate: (initData: string) => AuthenticatedApiUser | Promise<AuthenticatedApiUser>;
}

/** Creates the authenticated, customer-facing API used by the Telegram Mini App. */
export function createMiniAppApiServer(dependencies: MiniAppApiDependencies): Server {
  return createServer((request, response) => {
    const requestId = randomUUID();
    void handleRequest(request, dependencies)
      .then((result) => writeJson(response, result.statusCode, result.body, requestId))
      .catch(() => {
        console.error(`Mini App API request failed; request_id=${requestId}`);
        writeJson(response, 500, { error: "internal_error" }, requestId);
      });
  });
}

interface ApiResult {
  readonly statusCode: number;
  readonly body: unknown;
}

async function handleRequest(request: IncomingMessage, dependencies: MiniAppApiDependencies): Promise<ApiResult> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (pathname === "/healthz") {
    return request.method === "GET"
      ? { statusCode: 200, body: { status: "ok" } }
      : { statusCode: 405, body: { error: "method_not_allowed" } };
  }
  if (pathname === "/readyz") {
    if (request.method !== "GET") return { statusCode: 405, body: { error: "method_not_allowed" } };
    if (dependencies.readiness === undefined) return { statusCode: 503, body: { status: "unavailable" } };
    try {
      await dependencies.readiness.check();
      return { statusCode: 200, body: { status: "ready" } };
    } catch {
      return { statusCode: 503, body: { status: "unavailable" } };
    }
  }
  if (!pathname.startsWith("/v1/")) return { statusCode: 404, body: { error: "not_found" } };

  if (pathname === "/v1/stripe/webhook" && request.method === "POST") {
    if (dependencies.stripeWebhook === undefined) return { statusCode: 404, body: { error: "not_found" } };
    try {
      const signature = request.headers["stripe-signature"];
      const disposition = await dependencies.stripeWebhook.handle(await readRawBody(request), typeof signature === "string" ? signature : undefined);
      return { statusCode: 200, body: { received: true, disposition } };
    } catch (error: unknown) {
      if (error instanceof RequestBodyTooLargeError) return { statusCode: 413, body: { error: "body_too_large" } };
      if (isStripeSignatureError(error)) return { statusCode: 400, body: { error: "invalid_stripe_signature" } };
      if (isStripePayloadError(error)) return { statusCode: 400, body: { error: "invalid_stripe_payload" } };
      throw error;
    }
  }

  let user: AuthenticatedApiUser;
  try {
    user = await dependencies.authenticate(getInitData(request));
  } catch {
    return { statusCode: 401, body: { error: "unauthorized" } };
  }

  try {
    if (pathname === "/v1/admin/overview" && request.method === "GET") {
      if (dependencies.adminDashboard === undefined || !hasAdminAccess(dependencies)) return { statusCode: 404, body: { error: "not_found" } };
      return roleFor(dependencies, user) !== undefined
        ? { statusCode: 200, body: { overview: await dependencies.adminDashboard.getOverview() } }
        : { statusCode: 403, body: { error: "forbidden" } };
    }
    if (pathname === "/v1/admin/search" && request.method === "GET") {
      if (dependencies.adminSearch === undefined || !hasAdminAccess(dependencies)) return { statusCode: 404, body: { error: "not_found" } };
      if (roleFor(dependencies, user) === undefined) return { statusCode: 403, body: { error: "forbidden" } };
      const query = url.searchParams.get("q")?.trim() ?? "";
      if (query.length < 2 || query.length > 80) return { statusCode: 400, body: { error: "invalid_search_query" } };
      return { statusCode: 200, body: { results: await dependencies.adminSearch.search(query) } };
    }
    if (pathname === "/v1/admin/audit-events" && request.method === "GET") {
      if (dependencies.audit?.getRecent === undefined || !hasAdminAccess(dependencies)) return { statusCode: 404, body: { error: "not_found" } };
      return roleFor(dependencies, user) !== undefined
        ? { statusCode: 200, body: { events: await dependencies.audit.getRecent() } }
        : { statusCode: 403, body: { error: "forbidden" } };
    }
    if (pathname === "/v1/admin/beta-feedback" && request.method === "GET") {
      if (dependencies.feedback?.getRecent === undefined || !hasAdminAccess(dependencies)) return { statusCode: 404, body: { error: "not_found" } };
      return roleFor(dependencies, user) !== undefined
        ? { statusCode: 200, body: { feedback: await dependencies.feedback.getRecent() } }
        : { statusCode: 403, body: { error: "forbidden" } };
    }
    if (pathname === "/v1/admin/cash-out/requests" && request.method === "GET") {
      if (dependencies.partners?.getCashOutRequestsForReview === undefined || !hasAdminAccess(dependencies)) return { statusCode: 404, body: { error: "not_found" } };
      return roleFor(dependencies, user) !== undefined
        ? { statusCode: 200, body: { requests: await dependencies.partners.getCashOutRequestsForReview() } }
        : { statusCode: 403, body: { error: "forbidden" } };
    }
    const cashOutReviewRoute = parseAdminCashOutReviewRoute(pathname);
    if (cashOutReviewRoute !== undefined && request.method === "POST") {
      if (dependencies.partners?.reviewCashOutRequest === undefined || !hasAdminAccess(dependencies)) return { statusCode: 404, body: { error: "not_found" } };
      if (roleFor(dependencies, user) !== "operator") return { statusCode: 403, body: { error: "forbidden" } };
      if (!isUuid(cashOutReviewRoute.requestId)) return { statusCode: 400, body: { error: "invalid_cashout_request_id" } };
      const reviewerTelegramUserId = user.telegramUserId ?? user.id;
      const reviewed = await dependencies.partners.reviewCashOutRequest(cashOutReviewRoute.requestId, cashOutReviewRoute.action, reviewerTelegramUserId);
      if (reviewed === undefined) return { statusCode: 409, body: { error: "cashout_request_unavailable" } };
      await dependencies.audit?.record({
        actorTelegramUserId: reviewerTelegramUserId,
        action: cashOutReviewRoute.action === "approve" ? "partner_cashout_approved" : "partner_cashout_rejected",
        subjectUserId: reviewed.partnerUserId
      });
      return { statusCode: 200, body: { request: reviewed } };
    }
    const feedbackReviewRoute = parseAdminFeedbackReviewRoute(pathname);
    if (feedbackReviewRoute !== undefined && request.method === "POST") {
      if (dependencies.feedback?.markReviewed === undefined || !hasAdminAccess(dependencies)) return { statusCode: 404, body: { error: "not_found" } };
      if (roleFor(dependencies, user) !== "operator") return { statusCode: 403, body: { error: "forbidden" } };
      if (!isUuid(feedbackReviewRoute.feedbackId)) return { statusCode: 400, body: { error: "invalid_feedback_id" } };
      const feedback = await dependencies.feedback.markReviewed(feedbackReviewRoute.feedbackId);
      if (feedback === undefined) return { statusCode: 409, body: { error: "feedback_not_open" } };
      await dependencies.audit?.record({
        actorTelegramUserId: user.telegramUserId ?? user.id,
        action: "beta_feedback_reviewed",
        subjectUserId: feedbackReviewRoute.feedbackId
      });
      return { statusCode: 200, body: { feedback } };
    }
    if (pathname === "/v1/admin/access" && request.method === "GET") {
      if (!hasAdminAccess(dependencies)) return { statusCode: 404, body: { error: "not_found" } };
      const role = roleFor(dependencies, user);
      return role === undefined ? { statusCode: 403, body: { error: "forbidden" } } : { statusCode: 200, body: { role } };
    }
    const partnerRoute = parseAdminPartnerRoute(pathname);
    if (partnerRoute !== undefined && request.method === "POST") {
      if (dependencies.partners === undefined || !hasAdminAccess(dependencies)) return { statusCode: 404, body: { error: "not_found" } };
      if (roleFor(dependencies, user) !== "operator") return { statusCode: 403, body: { error: "forbidden" } };
      if (!isUuid(partnerRoute.userId)) return { statusCode: 400, body: { error: "invalid_user_id" } };
      await dependencies.audit?.record({
        actorTelegramUserId: user.telegramUserId ?? user.id,
        action: "partner_approval_requested",
        subjectUserId: partnerRoute.userId
      });
      const partner = await dependencies.partners.approve(partnerRoute.userId);
      return partner === undefined ? { statusCode: 409, body: { error: "partner_unavailable" } } : { statusCode: 200, body: { partner } };
    }
    const partnerRiskRoute = parseAdminPartnerRiskRoute(pathname);
    if (partnerRiskRoute !== undefined && request.method === "POST") {
      if (dependencies.partners?.setRiskLevel === undefined || !hasAdminAccess(dependencies)) return { statusCode: 404, body: { error: "not_found" } };
      if (roleFor(dependencies, user) !== "operator") return { statusCode: 403, body: { error: "forbidden" } };
      if (!isUuid(partnerRiskRoute.userId)) return { statusCode: 400, body: { error: "invalid_user_id" } };
      const riskLevel = partnerRiskLevel(partnerRiskRoute.riskLevel);
      if (riskLevel === undefined) return { statusCode: 400, body: { error: "invalid_partner_risk" } };
      const partner = await dependencies.partners.setRiskLevel(partnerRiskRoute.userId, riskLevel);
      if (partner === undefined) return { statusCode: 409, body: { error: "partner_unavailable" } };
      await dependencies.audit?.record({
        actorTelegramUserId: user.telegramUserId ?? user.id,
        action: "partner_risk_updated",
        subjectUserId: partnerRiskRoute.userId
      });
      return { statusCode: 200, body: { partner } };
    }
    const partnerCashOutHoldRoute = parseAdminPartnerCashOutHoldRoute(pathname);
    if (partnerCashOutHoldRoute !== undefined && request.method === "POST") {
      const operation = partnerCashOutHoldRoute.action === "freeze" ? dependencies.partners?.freezeCashOut : dependencies.partners?.unfreezeCashOut;
      if (operation === undefined || !hasAdminAccess(dependencies)) return { statusCode: 404, body: { error: "not_found" } };
      if (roleFor(dependencies, user) !== "operator") return { statusCode: 403, body: { error: "forbidden" } };
      if (!isUuid(partnerCashOutHoldRoute.userId)) return { statusCode: 400, body: { error: "invalid_user_id" } };
      if (!await operation(partnerCashOutHoldRoute.userId)) return { statusCode: 409, body: { error: "cashout_hold_unavailable" } };
      await dependencies.audit?.record({
        actorTelegramUserId: user.telegramUserId ?? user.id,
        action: partnerCashOutHoldRoute.action === "freeze" ? "partner_cashout_frozen" : "partner_cashout_unfrozen",
        subjectUserId: partnerCashOutHoldRoute.userId
      });
      return { statusCode: 200, body: { status: partnerCashOutHoldRoute.action === "freeze" ? "frozen" : "unfrozen" } };
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
      return { statusCode: 410, body: { error: "billing_portal_required" } };
    }
    if (pathname === "/v1/account/subscription/checkout" && request.method === "POST") {
      if (dependencies.billing === undefined) return { statusCode: 404, body: { error: "not_found" } };
      return { statusCode: 201, body: { checkout: await dependencies.billing.createEssentialCheckout(user.id) } };
    }
    if (pathname === "/v1/account/subscription/portal" && request.method === "POST") {
      if (dependencies.billing === undefined) return { statusCode: 404, body: { error: "not_found" } };
      return { statusCode: 201, body: { portal: await dependencies.billing.createPortal(user.id) } };
    }
    if (pathname === "/v1/referrals" && request.method === "GET") {
      if (dependencies.referrals === undefined) return { statusCode: 404, body: { error: "not_found" } };
      return { statusCode: 200, body: { referral: await dependencies.referrals.getForUser(user.id) } };
    }
    if (pathname === "/v1/partner/earnings" && request.method === "GET") {
      if (dependencies.partners?.getEarnings === undefined) return { statusCode: 404, body: { error: "not_found" } };
      return { statusCode: 200, body: { earnings: await dependencies.partners.getEarnings(user.id) } };
    }
    if (pathname === "/v1/partner/cash-out/quote" && request.method === "POST") {
      if (dependencies.partners?.getCashOutQuote === undefined) return { statusCode: 404, body: { error: "not_found" } };
      const body = await parseBody(request);
      const quote = await dependencies.partners.getCashOutQuote(user.id, body.grossAmountCents);
      return quote === undefined
        ? { statusCode: 409, body: { error: "cashout_unavailable" } }
        : { statusCode: 200, body: { quote } };
    }
    if (pathname === "/v1/partner/cash-out/methods" && request.method === "GET") {
      if (dependencies.partners?.getCashOutMethods === undefined) return { statusCode: 404, body: { error: "not_found" } };
      return { statusCode: 200, body: { methods: dependencies.partners.getCashOutMethods() } };
    }
    if (pathname === "/v1/partner/cash-out/requests" && request.method === "POST") {
      if (dependencies.partners?.createCashOutRequest === undefined) return { statusCode: 404, body: { error: "not_found" } };
      const body = await parseBody(request);
      const requestItem = await dependencies.partners.createCashOutRequest({
        userId: user.id, asset: body.asset, network: body.network, walletAddress: body.walletAddress, grossAmountCents: body.grossAmountCents
      });
      return requestItem === undefined
        ? { statusCode: 409, body: { error: "cashout_unavailable" } }
         : { statusCode: 201, body: { request: requestItem } };
    }
    if (pathname === "/v1/partner/cash-out/requests" && request.method === "GET") {
      if (dependencies.partners?.getCashOutRequests === undefined) return { statusCode: 404, body: { error: "not_found" } };
      return { statusCode: 200, body: { requests: await dependencies.partners.getCashOutRequests(user.id) } };
    }
    const cashOutRequestCancelRoute = parsePartnerCashOutRequestCancelRoute(pathname);
    if (cashOutRequestCancelRoute !== undefined && request.method === "POST") {
      if (dependencies.partners?.cancelCashOutRequest === undefined) return { statusCode: 404, body: { error: "not_found" } };
      if (!isUuid(cashOutRequestCancelRoute.requestId)) return { statusCode: 400, body: { error: "invalid_cashout_request_id" } };
      const cancelled = await dependencies.partners.cancelCashOutRequest(user.id, cashOutRequestCancelRoute.requestId);
      return cancelled
        ? { statusCode: 200, body: { status: "cancelled" } }
        : { statusCode: 409, body: { error: "cashout_request_unavailable" } };
    }
    if (pathname === "/v1/partner/ledger" && request.method === "GET") {
      if (dependencies.partners?.getLedger === undefined) return { statusCode: 404, body: { error: "not_found" } };
      return { statusCode: 200, body: { entries: await dependencies.partners.getLedger(user.id) } };
    }
    if (pathname === "/v1/dashboard" && request.method === "GET") {
      return { statusCode: 200, body: { dashboard: await dependencies.dashboard.getForUser(user.id) } };
    }
    if (pathname === "/v1/beta-feedback" && request.method === "POST") {
      if (dependencies.feedback === undefined) return { statusCode: 404, body: { error: "not_found" } };
      const body = await parseBody(request);
      return { statusCode: 201, body: { feedback: await dependencies.feedback.create({ userId: user.id, message: body.message }) } };
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
    if (error instanceof SubscriptionAlreadyEssentialError) return { statusCode: 409, body: { error: "already_essential" } };
    if (error instanceof StripeCheckoutUnavailableError) return { statusCode: 503, body: { error: "billing_unavailable" } };
    if (error instanceof InvalidBodyError || error instanceof InvalidPartnerCashOutQuoteAmountError || error instanceof InvalidPartnerCashOutRequestError || isInputValidationError(error)) {
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
  const rawBody = await readRawBody(request);
  try {
    const parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
    if (!isRecord(parsed)) throw new InvalidBodyError();
    return parsed;
  } catch (error: unknown) {
    if (error instanceof InvalidBodyError) throw error;
    throw new InvalidBodyError();
  }
}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maximumRequestBodyBytes) throw new RequestBodyTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parsePartnerCashOutRequestCancelRoute(pathname: string): { readonly requestId: string } | undefined {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  return segments[0] === "v1" && segments[1] === "partner" && segments[2] === "cash-out" && segments[3] === "requests" && segments[5] === "cancel" && segments.length === 6 && segments[4] !== undefined
    ? { requestId: segments[4] }
    : undefined;
}

function parseAdminCashOutReviewRoute(pathname: string): { readonly requestId: string; readonly action: CashOutReviewAction } | undefined {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const action = segments[5];
  return segments[0] === "v1" && segments[1] === "admin" && segments[2] === "cash-out" && segments[3] === "requests" && segments.length === 6 && segments[4] !== undefined && (action === "approve" || action === "reject")
    ? { requestId: segments[4], action }
    : undefined;
}

function parseAlertRoute(pathname: string): { readonly alertId: string; readonly action: "root" | "pause" | "resume" | "duplicate" } | undefined {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments[0] !== "v1" || segments[1] !== "alerts" || segments[2] === undefined || segments.length > 4) return undefined;
  const action = segments[3] ?? "root";
  if (action !== "root" && action !== "pause" && action !== "resume" && action !== "duplicate") return undefined;
  return { alertId: segments[2], action };
}

function parseAdminPartnerRoute(pathname: string): { readonly userId: string } | undefined {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  return segments[0] === "v1" && segments[1] === "admin" && segments[2] === "partners" && segments[4] === "approve" && segments.length === 5 && segments[3] !== undefined
    ? { userId: segments[3] }
    : undefined;
}

function parseAdminPartnerRiskRoute(pathname: string): { readonly userId: string; readonly riskLevel: string } | undefined {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  return segments[0] === "v1" && segments[1] === "admin" && segments[2] === "partners" && segments[4] === "risk" && segments.length === 6 && segments[3] !== undefined && segments[5] !== undefined
    ? { userId: segments[3], riskLevel: segments[5] }
    : undefined;
}

function parseAdminPartnerCashOutHoldRoute(pathname: string): { readonly userId: string; readonly action: "freeze" | "unfreeze" } | undefined {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const action = segments[5];
  return segments[0] === "v1" && segments[1] === "admin" && segments[2] === "partners" && segments[4] === "cash-out" && segments.length === 6 && segments[3] !== undefined && (action === "freeze" || action === "unfreeze")
    ? { userId: segments[3], action }
    : undefined;
}

function partnerRiskLevel(value: string): "new" | "trusted" | "high_risk" | undefined {
  return value === "new" || value === "trusted" ? value : value === "high-risk" ? "high_risk" : undefined;
}

function parseAdminFeedbackReviewRoute(pathname: string): { readonly feedbackId: string } | undefined {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  return segments[0] === "v1" && segments[1] === "admin" && segments[2] === "beta-feedback" && segments[4] === "review" && segments.length === 5 && segments[3] !== undefined
    ? { feedbackId: segments[3] }
    : undefined;
}

function hasAdminAccess(dependencies: MiniAppApiDependencies): boolean {
  return dependencies.adminRole !== undefined || dependencies.isAdmin !== undefined;
}

function roleFor(dependencies: MiniAppApiDependencies, user: AuthenticatedApiUser): "viewer" | "operator" | undefined {
  const telegramUserId = user.telegramUserId ?? user.id;
  return dependencies.adminRole?.(telegramUserId) ?? (dependencies.isAdmin?.(telegramUserId) === true ? "operator" : undefined);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown, requestId: string): void {
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-request-id", requestId);
  setHttpSecurityHeaders(response);
  if (statusCode === 204) {
    response.end();
    return;
  }
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function setHttpSecurityHeaders(response: ServerResponse): void {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInputValidationError(error: unknown): boolean {
  return isRecord(error) && Array.isArray(error.issues);
}

function isStripeSignatureError(error: unknown): boolean {
  return error instanceof InvalidStripeWebhookSignatureError;
}

function isStripePayloadError(error: unknown): boolean {
  return error instanceof InvalidStripeWebhookPayloadError;
}

class RequestBodyTooLargeError extends Error {}
class InvalidBodyError extends Error {}
