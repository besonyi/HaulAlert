import type { SqlExecutor } from "@haulalert/notification-service";

import { quotePartnerCashOut, type PartnerCashOutQuote } from "./partner-cashout-quote.js";

export interface CashOutMethod {
  readonly asset: "usdt" | "usdc";
  readonly network: string;
}

export interface CreatePartnerCashOutRequestInput {
  readonly userId: string;
  readonly asset: unknown;
  readonly network: unknown;
  readonly walletAddress: unknown;
  readonly grossAmountCents: unknown;
}

export interface PartnerCashOutRequest {
  readonly id: string;
  readonly asset: "usdt" | "usdc";
  readonly network: string;
  readonly walletDisplay: string;
  readonly grossAmountCents: number;
  readonly totalFeeCents: number;
  readonly netAmountCents: number;
  readonly status: PartnerCashOutRequestStatus;
  readonly manualReviewRequired: boolean;
  readonly requestedAt: string;
}

export type PartnerCashOutRequestStatus = "requested" | "reviewing" | "approved" | "processing" | "completed" | "rejected" | "cancelled" | "failed" | "frozen";

export class InvalidPartnerCashOutRequestError extends Error {}

/** Persists manual-only requests and reserves their gross amount in the immutable ledger. */
export class PostgresPartnerCashOutRequestRepository {
  private readonly methods: ReadonlyMap<string, CashOutMethod>;

  public constructor(private readonly database: SqlExecutor, methods: readonly CashOutMethod[]) {
    this.methods = new Map(methods.map((method) => [methodKey(method), method]));
  }

  public getMethods(): readonly CashOutMethod[] {
    return [...this.methods.values()];
  }

  public async createForUser(input: CreatePartnerCashOutRequestInput): Promise<PartnerCashOutRequest | undefined> {
    const method = this.method(input.asset, input.network);
    const walletAddress = wallet(input.walletAddress);
    const quote = quotePartnerCashOut(input.grossAmountCents);
    const result = await this.database.query(
      `WITH account AS (
        SELECT partner_accounts.id
        FROM partner_accounts
        WHERE partner_accounts.user_id = $1::uuid AND partner_accounts.status = 'active'
        FOR UPDATE
      ), eligible_account AS (
        SELECT account.id
        FROM account
        WHERE NOT EXISTS (
          SELECT 1 FROM partner_cashout_holds
          WHERE partner_cashout_holds.partner_account_id = account.id AND partner_cashout_holds.status = 'open'
        )
      ), available_balance AS (
        SELECT COALESCE(sum(partner_ledger_entries.amount_cents), 0) AS available_cents
        FROM partner_ledger_entries
        WHERE partner_ledger_entries.partner_account_id = (SELECT id FROM eligible_account)
      ), created_request AS (
        INSERT INTO partner_cashout_requests (
          partner_account_id, partner_user_id, asset, network, wallet_address,
          gross_amount_cents, fixed_fee_cents, processing_fee_cents, total_fee_cents, net_amount_cents
        )
        SELECT eligible_account.id, $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9
        FROM eligible_account CROSS JOIN available_balance
        WHERE available_balance.available_cents >= $5
        RETURNING id, asset, network, wallet_address, gross_amount_cents, total_fee_cents, net_amount_cents, status, manual_review_required, requested_at
      ), reserved_ledger AS (
        INSERT INTO partner_ledger_entries (
          partner_account_id, partner_user_id, cashout_request_id, entry_type, amount_cents
        )
        SELECT eligible_account.id, $1::uuid, created_request.id, entry.entry_type, entry.amount_cents
        FROM eligible_account CROSS JOIN created_request
        CROSS JOIN LATERAL (VALUES
          ('withdrawal'::text, -created_request.net_amount_cents),
          ('cashout_fee'::text, -created_request.total_fee_cents)
        ) AS entry(entry_type, amount_cents)
        RETURNING id
      )
      SELECT id, asset, network, wallet_address, gross_amount_cents, total_fee_cents, net_amount_cents, status, manual_review_required, requested_at
      FROM created_request`,
      [input.userId, method.asset, method.network, walletAddress, quote.grossAmountCents, quote.fixedFeeCents, quote.processingFeeCents, quote.totalFeeCents, quote.netAmountCents]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : request(row);
  }

  /** Returns the signed-in partner's recent cash-out history with wallets masked. */
  public async listForUser(userId: string, limit: number = 20): Promise<readonly PartnerCashOutRequest[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Cash-out request limit must be an integer between 1 and 100");
    const result = await this.database.query(
      `SELECT id, asset, network, wallet_address, gross_amount_cents, total_fee_cents, net_amount_cents, status, manual_review_required, requested_at
      FROM partner_cashout_requests
      WHERE partner_user_id = $1::uuid
      ORDER BY requested_at DESC, id DESC
      LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(request);
  }

  /** Cancels a not-yet-reviewed request and restores its immutable ledger reservation. */
  public async cancelForUser(userId: string, requestId: string): Promise<boolean> {
    const result = await this.database.query(
      `WITH cancelled_request AS (
        UPDATE partner_cashout_requests
        SET status = 'cancelled'
        WHERE id = $1::uuid AND partner_user_id = $2::uuid AND status = 'requested'
        RETURNING id, partner_account_id, partner_user_id, gross_amount_cents
      ), restored_balance AS (
        INSERT INTO partner_ledger_entries (
          partner_account_id, partner_user_id, cashout_request_id, entry_type, amount_cents
        )
        SELECT partner_account_id, partner_user_id, id, 'cashout_reversal', gross_amount_cents
        FROM cancelled_request
        RETURNING id
      )
      SELECT id FROM cancelled_request`,
      [requestId, userId]
    );
    return result.rows.length === 1;
  }

  private method(assetValue: unknown, networkValue: unknown): CashOutMethod {
    const asset = typeof assetValue === "string" ? assetValue.trim().toLowerCase() : "";
    const network = typeof networkValue === "string" ? networkValue.trim().toLowerCase() : "";
    const method = this.methods.get(`${asset}:${network}`);
    if (method === undefined) throw new InvalidPartnerCashOutRequestError("Cash-out method is not supported");
    return method;
  }
}

export function parseCashOutMethods(value: string | undefined): readonly CashOutMethod[] {
  const configured = value?.trim();
  if (configured === undefined || configured.length === 0) return [];
  const methods = configured.split(",").map((item) => {
    const match = /^(USDT|USDC):([a-z0-9][a-z0-9_-]{1,39})$/i.exec(item.trim());
    if (match === null) throw new InvalidPartnerCashOutRequestError("CASHOUT_SUPPORTED_METHODS must use ASSET:network entries");
    return { asset: (match[1] ?? "").toLowerCase() as CashOutMethod["asset"], network: (match[2] ?? "").toLowerCase() };
  });
  const unique = new Map(methods.map((method) => [methodKey(method), method]));
  if (methods.length > 12 || unique.size !== methods.length) throw new InvalidPartnerCashOutRequestError("CASHOUT_SUPPORTED_METHODS entries must be unique and limited");
  return [...unique.values()];
}

function request(row: Record<string, unknown>): PartnerCashOutRequest {
  const status = requestStatus(row.status);
  return {
    id: uuid(row.id), asset: asset(row.asset), network: network(row.network), walletDisplay: walletDisplay(row.wallet_address),
    grossAmountCents: positiveCents(row.gross_amount_cents), totalFeeCents: positiveCents(row.total_fee_cents), netAmountCents: positiveCents(row.net_amount_cents),
    status, manualReviewRequired: row.manual_review_required === true || row.manual_review_required === "true", requestedAt: timestamp(row.requested_at)
  };
}

function wallet(value: unknown): string {
  if (typeof value !== "string" || !/^\S{12,160}$/.test(value)) throw new InvalidPartnerCashOutRequestError("Expected a wallet address without whitespace");
  return value;
}

function walletDisplay(value: unknown): string {
  const address = wallet(value);
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function methodKey(method: CashOutMethod): string { return `${method.asset}:${method.network}`; }
function requestStatus(value: unknown): PartnerCashOutRequestStatus {
  if (value === "requested" || value === "reviewing" || value === "approved" || value === "processing" || value === "completed" || value === "rejected" || value === "cancelled" || value === "failed" || value === "frozen") return value;
  return invalid("Expected cash-out request status");
}
function asset(value: unknown): "usdt" | "usdc" { return value === "usdt" || value === "usdc" ? value : invalid("Expected cash-out asset"); }
function network(value: unknown): string { return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{1,39}$/.test(value) ? value : invalid("Expected cash-out network"); }
function uuid(value: unknown): string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : invalid("Expected cash-out request ID"); }
function positiveCents(value: unknown): number { const result = typeof value === "number" ? value : Number(value); return Number.isSafeInteger(result) && result > 0 ? result : invalid("Expected positive cash-out cents"); }
function timestamp(value: unknown): string { const date = value instanceof Date ? value : new Date(typeof value === "string" ? value : ""); return Number.isNaN(date.getTime()) ? invalid("Expected cash-out request timestamp") : date.toISOString(); }
function invalid(message: string): never { throw new Error(message); }
