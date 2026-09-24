import type { SqlExecutor } from "@haulalert/notification-service";

export interface ReferralSummary {
  readonly code: string;
  readonly totalInvited: number;
  readonly registered: number;
  readonly activePaid: number;
  readonly inactive: number;
  readonly monthlyCreditCents: number;
  readonly partnerProgressActivePaid: number;
  readonly partnerUnlockAt: number;
}

/** Reads the customer-facing referral state without exposing referred-user identities. */
export class PostgresReferralRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async getForUser(userId: string): Promise<ReferralSummary> {
    const result = await this.database.query(
      `SELECT referral_codes.code,
        count(referrals.id) AS total_invited,
        count(referrals.id) FILTER (WHERE referrals.status = 'registered') AS registered,
        count(referrals.id) FILTER (WHERE referrals.status = 'active_paid') AS active_paid,
        count(referrals.id) FILTER (WHERE referrals.status = 'inactive') AS inactive
      FROM referral_codes
      LEFT JOIN referrals ON referrals.referrer_user_id = referral_codes.user_id
      WHERE referral_codes.user_id = $1::uuid
      GROUP BY referral_codes.code`,
      [userId]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Expected referral code for HaulAlert user");
    const activePaid = count(row.active_paid, "active_paid");
    return {
      code: code(row.code),
      totalInvited: count(row.total_invited, "total_invited"),
      registered: count(row.registered, "registered"),
      activePaid,
      inactive: count(row.inactive, "inactive"),
      monthlyCreditCents: Math.min(activePaid, 4) * 500,
      partnerProgressActivePaid: Math.min(activePaid, 5),
      partnerUnlockAt: 5
    };
  }
}

function code(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9]{8}$/.test(value)) throw new Error("Expected referral code");
  return value;
}

function count(value: unknown, name: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Expected ${name} to be a non-negative count`);
  return result;
}
