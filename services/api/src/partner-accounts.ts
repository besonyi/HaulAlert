import type { SqlExecutor } from "@haulalert/notification-service";

export type PartnerStatus = "not_eligible" | "pending_approval" | "active" | "suspended" | "rejected" | "closed";
export type PartnerRewardMode = "referral_credit" | "partner_commission";

export interface PartnerAccount {
  readonly status: PartnerStatus;
  readonly rewardMode: PartnerRewardMode;
  readonly commissionRateBasisPoints: number;
  readonly holdDays: number;
  readonly partnerEligibleAt: string;
  readonly approvedAt: string | null;
}

/** Enforces the partner-approval boundary; the customer cannot activate themselves. */
export class PostgresPartnerAccountRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async getForUser(userId: string): Promise<PartnerAccount | undefined> {
    const result = await this.database.query(
      `SELECT status, reward_mode, commission_rate_basis_points, hold_days, partner_eligible_at, approved_at
      FROM partner_accounts WHERE user_id = $1::uuid`,
      [userId]
    );
    return result.rows[0] === undefined ? undefined : account(result.rows[0]);
  }

  public async approve(userId: string): Promise<PartnerAccount | undefined> {
    const result = await this.database.query(
      `UPDATE partner_accounts
      SET status = 'active', reward_mode = 'partner_commission', approved_at = now(), updated_at = now()
      WHERE user_id = $1::uuid AND status = 'pending_approval'
      RETURNING status, reward_mode, commission_rate_basis_points, hold_days, partner_eligible_at, approved_at`,
      [userId]
    );
    return result.rows[0] === undefined ? undefined : account(result.rows[0]);
  }
}

function account(row: Record<string, unknown>): PartnerAccount {
  const status = row.status;
  if (status !== "not_eligible" && status !== "pending_approval" && status !== "active" && status !== "suspended" && status !== "rejected" && status !== "closed") {
    throw new Error("Expected partner status");
  }
  const rewardMode = row.reward_mode;
  if (rewardMode !== "referral_credit" && rewardMode !== "partner_commission") throw new Error("Expected partner reward mode");
  return {
    status,
    rewardMode,
    commissionRateBasisPoints: number(row.commission_rate_basis_points, "commission rate"),
    holdDays: number(row.hold_days, "hold days"),
    partnerEligibleAt: timestamp(row.partner_eligible_at, "partner eligibility"),
    approvedAt: row.approved_at === null || row.approved_at === undefined ? null : timestamp(row.approved_at, "partner approval")
  };
}

function number(value: unknown, name: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Expected ${name}`);
  return result;
}

function timestamp(value: unknown, name: string): string {
  const date = value instanceof Date ? value : new Date(typeof value === "string" ? value : "");
  if (Number.isNaN(date.getTime())) throw new Error(`Expected ${name}`);
  return date.toISOString();
}
