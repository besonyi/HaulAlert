import type { SqlExecutor } from "@haulalert/notification-service";

import type { PartnerStatus } from "./partner-accounts.js";

export interface PartnerEarningsSummary {
  readonly status: PartnerStatus;
  readonly commissionRateBasisPoints: number;
  readonly holdDays: number;
  readonly pendingCents: number;
  readonly availableCents: number;
  readonly lifetimeEarnedCents: number;
  readonly nextAvailableAt: string | null;
}

/** Reads one partner's own commission totals; it never exposes referral identities. */
export class PostgresPartnerEarningsRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async getForUser(userId: string): Promise<PartnerEarningsSummary | undefined> {
    const result = await this.database.query(
      `SELECT partner_accounts.status, partner_accounts.commission_rate_basis_points, partner_accounts.hold_days,
        COALESCE(sum(partner_commissions.commission_amount_cents) FILTER (WHERE partner_commissions.status = 'pending'), 0) AS pending_cents,
        COALESCE(sum(partner_commissions.commission_amount_cents) FILTER (WHERE partner_commissions.status = 'available'), 0) AS available_cents,
        COALESCE(sum(partner_commissions.commission_amount_cents) FILTER (WHERE partner_commissions.status IN ('pending', 'available', 'reversed')), 0) AS lifetime_earned_cents,
        min(partner_commissions.hold_until) FILTER (WHERE partner_commissions.status = 'pending') AS next_available_at
      FROM partner_accounts
      LEFT JOIN partner_commissions ON partner_commissions.partner_account_id = partner_accounts.id
      WHERE partner_accounts.user_id = $1::uuid
      GROUP BY partner_accounts.status, partner_accounts.commission_rate_basis_points, partner_accounts.hold_days`,
      [userId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : summary(row);
  }
}

function summary(row: Record<string, unknown>): PartnerEarningsSummary {
  return {
    status: partnerStatus(row.status),
    commissionRateBasisPoints: cents(row.commission_rate_basis_points, "commission rate"),
    holdDays: cents(row.hold_days, "hold days"),
    pendingCents: cents(row.pending_cents, "pending commission"),
    availableCents: cents(row.available_cents, "available commission"),
    lifetimeEarnedCents: cents(row.lifetime_earned_cents, "lifetime commission"),
    nextAvailableAt: row.next_available_at === null || row.next_available_at === undefined ? null : timestamp(row.next_available_at)
  };
}

function partnerStatus(value: unknown): PartnerStatus {
  if (value === "not_eligible" || value === "pending_approval" || value === "active" || value === "suspended" || value === "rejected" || value === "closed") return value;
  throw new Error("Expected partner status");
}

function cents(value: unknown, name: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Expected ${name}`);
  return result;
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(typeof value === "string" ? value : "");
  if (Number.isNaN(date.getTime())) throw new Error("Expected commission availability timestamp");
  return date.toISOString();
}
