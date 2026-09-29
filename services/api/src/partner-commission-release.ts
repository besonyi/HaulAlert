import type { SqlExecutor } from "@haulalert/notification-service";

/** Releases held commissions in small, idempotent batches; it never initiates a payout. */
export class PostgresPartnerCommissionReleaseRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async releaseDue(limit: number = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("Partner commission release limit must be an integer between 1 and 1000");
    }
    const result = await this.database.query(
      `WITH due_commissions AS (
        SELECT id
        FROM partner_commissions
        WHERE status = 'pending' AND hold_until <= now()
        ORDER BY hold_until ASC, id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE partner_commissions
      SET status = 'available', available_at = now(), updated_at = now()
      FROM due_commissions
      WHERE partner_commissions.id = due_commissions.id
      RETURNING partner_commissions.id`,
      [limit]
    );
    return result.rows.length;
  }
}
