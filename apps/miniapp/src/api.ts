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

export class MiniAppApiError extends Error {
  public constructor(readonly statusCode: number, readonly code: string) {
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

  public async cancelSubscription(): Promise<MiniAppEntitlement> {
    const response = await this.send("/v1/account/subscription/cancel", "POST");
    return (await response.json() as { entitlement: MiniAppEntitlement }).entitlement;
  }

  public async getReferralSummary(): Promise<MiniAppReferralSummary> {
    const response = await this.send("/v1/referrals", "GET");
    return (await response.json() as { referral: MiniAppReferralSummary }).referral;
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
      throw new MiniAppApiError(response.status, typeof payload.error === "string" ? payload.error : "request_failed");
    }
    return response;
  }
}
