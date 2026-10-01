import type { SqlExecutor } from "@haulalert/notification-service";

export type PartnerLedgerEntryType = "commission_available" | "refund_reversal" | "chargeback_clawback" | "withdrawal" | "cashout_fee" | "cashout_reversal" | "manual_adjustment";

export interface PartnerLedgerEntry {
  readonly id: string;
  readonly entryType: PartnerLedgerEntryType;
  readonly amountCents: number;
  readonly createdAt: string;
}

/** Lists a bounded partner-owned financial history without referral or payment identifiers. */
export class PostgresPartnerLedgerRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async listForUser(userId: string, limit: number = 20): Promise<readonly PartnerLedgerEntry[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Partner ledger limit must be an integer between 1 and 100");
    const result = await this.database.query(
      `SELECT partner_ledger_entries.id, partner_ledger_entries.entry_type,
        partner_ledger_entries.amount_cents, partner_ledger_entries.created_at
      FROM partner_ledger_entries
      JOIN partner_accounts ON partner_accounts.id = partner_ledger_entries.partner_account_id
      WHERE partner_accounts.user_id = $1::uuid
      ORDER BY partner_ledger_entries.created_at DESC, partner_ledger_entries.id DESC
      LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(entry);
  }
}

function entry(row: Record<string, unknown>): PartnerLedgerEntry {
  return {
    id: uuid(row.id),
    entryType: entryType(row.entry_type),
    amountCents: signedCents(row.amount_cents),
    createdAt: timestamp(row.created_at)
  };
}

function entryType(value: unknown): PartnerLedgerEntryType {
  if (value === "commission_available" || value === "refund_reversal" || value === "chargeback_clawback" || value === "withdrawal" || value === "cashout_fee" || value === "cashout_reversal" || value === "manual_adjustment") return value;
  throw new Error("Expected partner ledger entry type");
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Expected partner ledger entry ID");
  return value;
}

function signedCents(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result === 0) throw new Error("Expected non-zero ledger cents");
  return result;
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(typeof value === "string" ? value : "");
  if (Number.isNaN(date.getTime())) throw new Error("Expected ledger timestamp");
  return date.toISOString();
}
