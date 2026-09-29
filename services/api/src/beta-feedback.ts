import type { SqlExecutor } from "@haulalert/notification-service";

export interface BetaFeedbackInput {
  readonly userId: string;
  readonly message: unknown;
}

export interface BetaFeedback {
  readonly id: string;
  readonly createdAt: string;
}

export interface BetaFeedbackReviewItem extends BetaFeedback {
  readonly userId: string;
  readonly message: string;
}

/** Signals a customer-correctable feedback payload without exposing it in an API error. */
export class BetaFeedbackValidationError extends Error {
  public readonly issues = [];
}

/** Persists a small, authenticated controlled-beta feedback item. */
export class PostgresBetaFeedbackRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async create(input: BetaFeedbackInput): Promise<BetaFeedback> {
    const message = normalizeMessage(input.message);
    const result = await this.database.query(
      `INSERT INTO beta_feedback (user_id, message)
      VALUES ($1::uuid, $2)
      RETURNING id, created_at`,
      [input.userId, message]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Expected beta feedback result");
    return { id: uuid(row.id), createdAt: timestamp(row.created_at) };
  }

  /** Returns a bounded, newest-first list only for the protected Admin workflow. */
  public async getRecent(limit: number = 20): Promise<readonly BetaFeedbackReviewItem[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Beta feedback limit must be an integer between 1 and 100");
    const result = await this.database.query(
      `SELECT id, user_id, message, created_at
      FROM beta_feedback
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
      [limit]
    );
    return result.rows.map(reviewItem);
  }
}

export function normalizeBetaFeedbackMessage(value: unknown): string {
  return normalizeMessage(value);
}

function normalizeMessage(value: unknown): string {
  if (typeof value !== "string") throw new BetaFeedbackValidationError();
  const message = value.trim();
  if (message.length < 1 || message.length > 1200) throw new BetaFeedbackValidationError();
  return message;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Expected beta feedback ID");
  }
  return value;
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(typeof value === "string" ? value : "");
  if (Number.isNaN(date.getTime())) throw new Error("Expected beta feedback timestamp");
  return date.toISOString();
}

function reviewItem(row: Record<string, unknown>): BetaFeedbackReviewItem {
  const message = typeof row.message === "string" ? row.message : "";
  if (message.length < 1 || message.length > 1200) throw new Error("Expected beta feedback message");
  return { id: uuid(row.id), userId: uuid(row.user_id), message, createdAt: timestamp(row.created_at) };
}
