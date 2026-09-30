import type { SqlExecutor } from "@haulalert/notification-service";

/** Creates and resolves an operator-only cash-out safety hold without storing a mutable balance. */
export class PostgresPartnerCashOutHoldRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async freeze(userId: string): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO partner_cashout_holds (partner_account_id)
      SELECT id FROM partner_accounts
      WHERE user_id = $1::uuid AND status IN ('active', 'suspended')
      ON CONFLICT DO NOTHING
      RETURNING id`,
      [userId]
    );
    return result.rows.length === 1;
  }

  public async unfreeze(userId: string): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE partner_cashout_holds
      SET status = 'resolved', resolved_at = now()
      FROM partner_accounts
      WHERE partner_cashout_holds.partner_account_id = partner_accounts.id
        AND partner_accounts.user_id = $1::uuid
        AND partner_cashout_holds.status = 'open'
      RETURNING partner_cashout_holds.id`,
      [userId]
    );
    return result.rows.length === 1;
  }
}
