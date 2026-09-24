import type { SqlExecutor } from "@haulalert/notification-service";

export type SubscriptionStatus = "active" | "cancelled" | "expired";

export interface AccountEntitlement {
  readonly planId: string;
  readonly planName: string;
  readonly maxActiveAlerts: number;
  readonly maxSavedAlerts: number;
  readonly monthlyPriceCents: number;
  readonly activeAlertCount: number;
  readonly subscriptionStatus: SubscriptionStatus;
  readonly currentPeriodEndsAt: string | null;
  readonly cancelAtPeriodEnd: boolean;
}

export class PlanLimitExceededError extends Error {}
export class InactiveSubscriptionError extends Error {}

export class PostgresEntitlementRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async getForUser(userId: string): Promise<AccountEntitlement> {
    const result = await this.database.query(`SELECT plans.id AS plan_id, plans.name AS plan_name, plans.max_active_alerts, plans.max_saved_alerts, plans.monthly_price_cents,
        subscriptions.status, subscriptions.current_period_ends_at, subscriptions.cancel_at_period_end,
        (SELECT count(*) FROM alerts WHERE user_id = users.id AND status = 'active') AS active_alert_count
      FROM users JOIN subscriptions ON subscriptions.user_id = users.id JOIN plans ON plans.id = subscriptions.plan_id
      WHERE users.id = $1::uuid`, [userId]);
    return entitlement(result.rows[0]);
  }

  public async assertCanCreateAlert(userId: string): Promise<void> {
    const account = await this.getForUser(userId);
    if (account.subscriptionStatus !== "active" || periodEnded(account.currentPeriodEndsAt)) throw new InactiveSubscriptionError();
    if (account.activeAlertCount >= account.maxActiveAlerts) throw new PlanLimitExceededError();
  }

  public async cancelAtPeriodEnd(userId: string): Promise<AccountEntitlement | undefined> {
    const result = await this.database.query(`UPDATE subscriptions SET cancel_at_period_end = true, updated_at = now()
      WHERE user_id = $1::uuid AND status = 'active'
      RETURNING plan_id, status, current_period_ends_at, cancel_at_period_end`, [userId]);
    if (result.rows[0] === undefined) return undefined;
    return this.getForUser(userId);
  }
}

function entitlement(row: Record<string, unknown> | undefined): AccountEntitlement {
  if (row === undefined) throw new Error("Expected account entitlement");
  const status = text(row.status, "subscription status");
  if (status !== "active" && status !== "cancelled" && status !== "expired") throw new Error("Invalid subscription status");
  return {
    planId: text(row.plan_id, "plan ID"),
    planName: text(row.plan_name, "plan name"),
    maxActiveAlerts: count(row.max_active_alerts, "plan alert limit"),
    maxSavedAlerts: count(row.max_saved_alerts, "plan saved-alert limit"),
    monthlyPriceCents: count(row.monthly_price_cents, "plan price", true),
    activeAlertCount: count(row.active_alert_count, "active alert count", true),
    subscriptionStatus: status,
    currentPeriodEndsAt: row.current_period_ends_at === null || row.current_period_ends_at === undefined ? null : timestamp(row.current_period_ends_at),
    cancelAtPeriodEnd: row.cancel_at_period_end === true
  };
}

function periodEnded(value: string | null): boolean { return value !== null && Date.parse(value) <= Date.now(); }
function text(value: unknown, name: string): string { if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${name}`); return value; }
function count(value: unknown, name: string, zero = false): number { const result = typeof value === "number" ? value : Number(value); if (!Number.isSafeInteger(result) || result < (zero ? 0 : 1)) throw new Error(`Expected ${name}`); return result; }
function timestamp(value: unknown): string { const date = value instanceof Date ? value : new Date(text(value, "period end")); if (Number.isNaN(date.getTime())) throw new Error("Expected period end"); return date.toISOString(); }
