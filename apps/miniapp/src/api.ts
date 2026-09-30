import type { CanonicalFilter } from "@haulalert/canonical-filter";
import type { NormalizedLoad } from "@haulalert/load-model";

export type AlertStatus = "active" | "paused";

export interface MiniAppAlert {
  readonly id: string;
  readonly name: string;
  readonly status: AlertStatus;
  readonly filter: CanonicalFilter;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MiniAppRecentNotification {
  readonly deliveryId: string;
  readonly alertId: string;
  readonly alertName: string;
  readonly status: "queued" | "delivering" | "retry_scheduled" | "sent" | "dead_letter" | "cancelled";
  readonly createdAt: string;
  readonly sentAt: string | null;
  readonly load: NormalizedLoad;
}

export interface MiniAppDashboard {
  readonly activeAlertCount: number;
  readonly loadsFoundLast24Hours: number;
  readonly recentNotifications: readonly MiniAppRecentNotification[];
}

export interface MiniAppBrokerProfile {
  readonly name: string;
  readonly mcNumber: string | null;
  readonly dotNumber: string | null;
  readonly matchedLoadCount: number;
}

export interface MiniAppEntitlement {
  readonly planId: string;
  readonly planName: string;
  readonly maxActiveAlerts: number;
  readonly maxSavedAlerts: number;
  readonly monthlyPriceCents: number;
  readonly activeAlertCount: number;
  readonly subscriptionStatus: "active" | "cancelled" | "expired";
  readonly currentPeriodEndsAt: string | null;
  readonly cancelAtPeriodEnd: boolean;
}

export interface MiniAppCheckoutSession {
  readonly url: string;
}

export interface MiniAppReferralSummary {
  readonly code: string;
  readonly inviteLink: string;
  readonly totalInvited: number;
  readonly registered: number;
  readonly activePaid: number;
  readonly inactive: number;
  readonly monthlyCreditCents: number;
  readonly partnerProgressActivePaid: number;
  readonly partnerUnlockAt: number;
  readonly partnerStatus: "not_eligible" | "pending_approval" | "active" | "suspended" | "rejected" | "closed";
}

export interface MiniAppPartnerEarnings {
  readonly status: "not_eligible" | "pending_approval" | "active" | "suspended" | "rejected" | "closed";
  readonly commissionRateBasisPoints: number;
  readonly holdDays: number;
  readonly pendingCents: number;
  readonly availableCents: number;
  readonly lifetimeEarnedCents: number;
  readonly nextAvailableAt: string | null;
  readonly cashOutMinimumCents: number;
  readonly cashOutEligible: boolean;
  readonly cashOutBlockReason: "partner_inactive" | "negative_balance" | "minimum_balance" | null;
}

export interface MiniAppPartnerLedgerEntry {
  readonly id: string;
  readonly entryType: "commission_available" | "refund_reversal" | "chargeback_clawback" | "withdrawal" | "cashout_fee" | "manual_adjustment";
  readonly amountCents: number;
  readonly createdAt: string;
}

export class MiniAppApiError extends Error {
  public constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly requestId: string | undefined
  ) {
    super(code);
  }
}

export class MiniAppApiClient {
  public constructor(
    private readonly initData: string,
    private readonly baseUrl: string = "/api",
    private readonly request: typeof fetch = fetch
  ) {}

  public async listAlerts(): Promise<readonly MiniAppAlert[]> {
    const response = await this.send("/v1/alerts", "GET");
    return (await response.json() as { alerts: MiniAppAlert[] }).alerts;
  }

  public async getDashboard(): Promise<MiniAppDashboard> {
    const response = await this.send("/v1/dashboard", "GET");
    return (await response.json() as { dashboard: MiniAppDashboard }).dashboard;
  }

  public async searchBrokers(query: string): Promise<readonly MiniAppBrokerProfile[]> {
    const response = await this.send(`/v1/brokers?q=${encodeURIComponent(query)}`, "GET");
    return (await response.json() as { brokers: MiniAppBrokerProfile[] }).brokers;
  }

  public async getEntitlement(): Promise<MiniAppEntitlement> {
    const response = await this.send("/v1/account/entitlement", "GET");
    return (await response.json() as { entitlement: MiniAppEntitlement }).entitlement;
  }

  public async createBillingPortal(): Promise<MiniAppCheckoutSession> {
    const response = await this.send("/v1/account/subscription/portal", "POST");
    return (await response.json() as { portal: MiniAppCheckoutSession }).portal;
  }

  public async createEssentialCheckout(): Promise<MiniAppCheckoutSession> {
    const response = await this.send("/v1/account/subscription/checkout", "POST");
    return (await response.json() as { checkout: MiniAppCheckoutSession }).checkout;
  }

  public async getReferralSummary(): Promise<MiniAppReferralSummary> {
    const response = await this.send("/v1/referrals", "GET");
    return (await response.json() as { referral: MiniAppReferralSummary }).referral;
  }

  public async getPartnerEarnings(): Promise<MiniAppPartnerEarnings | null> {
    const response = await this.send("/v1/partner/earnings", "GET");
    return (await response.json() as { earnings: MiniAppPartnerEarnings | null }).earnings;
  }

  public async getPartnerLedger(): Promise<readonly MiniAppPartnerLedgerEntry[]> {
    const response = await this.send("/v1/partner/ledger", "GET");
    return (await response.json() as { entries: MiniAppPartnerLedgerEntry[] }).entries;
  }

  public async submitBetaFeedback(message: string): Promise<void> {
    await this.send("/v1/beta-feedback", "POST", { message });
  }

  public async createAlert(filter: CanonicalFilter): Promise<MiniAppAlert> {
    const response = await this.send("/v1/alerts", "POST", { filter });
    return (await response.json() as { alert: MiniAppAlert }).alert;
  }

  public async updateAlert(alertId: string, filter: CanonicalFilter): Promise<MiniAppAlert> {
    const response = await this.send(`/v1/alerts/${alertId}`, "PUT", { filter });
    return (await response.json() as { alert: MiniAppAlert }).alert;
  }

  public async setStatus(alertId: string, status: AlertStatus): Promise<MiniAppAlert> {
    const response = await this.send(`/v1/alerts/${alertId}/${status === "active" ? "resume" : "pause"}`, "POST");
    return (await response.json() as { alert: MiniAppAlert }).alert;
  }

  public async duplicate(alertId: string, name: string): Promise<MiniAppAlert> {
    const response = await this.send(`/v1/alerts/${alertId}/duplicate`, "POST", { name });
    return (await response.json() as { alert: MiniAppAlert }).alert;
  }

  public async remove(alertId: string): Promise<void> {
    await this.send(`/v1/alerts/${alertId}`, "DELETE");
  }

  private async send(path: string, method: string, body?: unknown): Promise<Response> {
    const response = await this.request(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `tma ${this.initData}`,
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "request_failed" })) as { error?: unknown };
      throw new MiniAppApiError(
        response.status,
        typeof payload.error === "string" ? payload.error : "request_failed",
        requestIdFrom(response)
      );
    }
    return response;
  }
}

function requestIdFrom(response: Response): string | undefined {
  const requestId = response.headers.get("x-request-id");
  return requestId !== null && isRequestId(requestId) ? requestId : undefined;
}

function isRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
