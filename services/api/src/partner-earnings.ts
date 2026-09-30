import type { SqlExecutor } from "@haulalert/notification-service";

import type { PartnerStatus } from "./partner-accounts.js";

export const minimumCashOutCents = 5_000;
export type CashOutBlockReason = "partner_inactive" | "negative_balance" | "minimum_balance" | "account_restricted" | null;

export interface PartnerEarningsSummary {
  readonly status: PartnerStatus;
  readonly commissionRateBasisPoints: number;
  readonly holdDays: number;
  readonly pendingCents: number;
  readonly availableCents: number;
  readonly lifetimeEarnedCents: number;
  readonly nextAvailableAt: string | null;
  readonly cashOutMinimumCents: number;
  readonly cashOutEligible: boolean;
  readonly cashOutBlockReason: CashOutBlockReason;
}

/** Reads one partner's own commission totals; it never exposes referral identities. */
export class PostgresPartnerEarningsRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async getForUser(userId: string): Promise<PartnerEarningsSummary | undefined> {
    const result = await this.database.query(
      `SELECT partner_accounts.status, partner_accounts.commission_rate_basis_points, partner_accounts.hold_days,
        COALESCE((SELECT sum(commission_amount_cents) FROM partner_commissions
          WHERE partner_commissions.partner_account_id = partner_accounts.id AND partner_commissions.status = 'pending'), 0) AS pending_cents,
        COALESCE((SELECT sum(amount_cents) FROM partner_ledger_entries
          WHERE partner_ledger_entries.partner_account_id = partner_accounts.id), 0) AS available_cents,
        COALESCE((SELECT sum(commission_amount_cents) FROM partner_commissions
          WHERE partner_commissions.partner_account_id = partner_accounts.id AND partner_commissions.status IN ('pending', 'available', 'reversed')), 0) AS lifetime_earned_cents,
        (SELECT min(hold_until) FROM partner_commissions
          WHERE partner_commissions.partner_account_id = partner_accounts.id AND partner_commissions.status = 'pending') AS next_available_at,
        EXISTS (SELECT 1 FROM partner_cashout_holds
          WHERE partner_cashout_holds.partner_account_id = partner_accounts.id AND partner_cashout_holds.status = 'open') AS has_cashout_hold
      FROM partner_accounts
      WHERE partner_accounts.user_id = $1::uuid`,
      [userId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : summary(row);
  }
}

function summary(row: Record<string, unknown>): PartnerEarningsSummary {
  const status = partnerStatus(row.status);
  const availableCents = signedCents(row.available_cents, "available commission");
  const blockReason = cashOutBlockReason(status, availableCents, row.has_cashout_hold === true || row.has_cashout_hold === "true");
  return {
    status,
    commissionRateBasisPoints: cents(row.commission_rate_basis_points, "commission rate"),
    holdDays: cents(row.hold_days, "hold days"),
    pendingCents: cents(row.pending_cents, "pending commission"),
    availableCents,
    lifetimeEarnedCents: cents(row.lifetime_earned_cents, "lifetime commission"),
    nextAvailableAt: row.next_available_at === null || row.next_available_at === undefined ? null : timestamp(row.next_available_at),
    cashOutMinimumCents: minimumCashOutCents,
    cashOutEligible: blockReason === null,
    cashOutBlockReason: blockReason
  };
}

function cashOutBlockReason(status: PartnerStatus, availableCents: number, hasCashOutHold: boolean): CashOutBlockReason {
  if (status !== "active") return "partner_inactive";
  if (hasCashOutHold) return "account_restricted";
  if (availableCents < 0) return "negative_balance";
  return availableCents < minimumCashOutCents ? "minimum_balance" : null;
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

function signedCents(value: unknown, name: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`Expected ${name}`);
  return result;
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(typeof value === "string" ? value : "");
  if (Number.isNaN(date.getTime())) throw new Error("Expected commission availability timestamp");
  return date.toISOString();
}
