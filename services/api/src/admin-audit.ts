import type { SqlExecutor } from "@haulalert/notification-service";

export interface AdminAuditEventInput {
  readonly actorTelegramUserId: string;
  readonly action: "partner_approval_requested" | "partner_risk_updated" | "partner_cashout_frozen" | "partner_cashout_unfrozen" | "partner_cashout_approved" | "partner_cashout_rejected" | "beta_feedback_reviewed";
  readonly subjectUserId: string;
}

export interface AdminAuditEvent extends AdminAuditEventInput {
  readonly id: string;
  readonly createdAt: string;
}

/** Writes a durable, credential-free trail for privileged customer-operation requests. */
export class PostgresAdminAuditRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async record(input: AdminAuditEventInput): Promise<void> {
    if (!/^-?\d+$/.test(input.actorTelegramUserId)) throw new Error("Expected an integer Telegram operator ID");
    await this.database.query(
      `INSERT INTO admin_audit_events (actor_telegram_user_id, action, subject_user_id)
      VALUES ($1, $2, $3::uuid)`,
      [input.actorTelegramUserId, input.action, input.subjectUserId]
    );
  }

  /** Returns a bounded, newest-first operator trail for the protected Admin UI. */
  public async getRecent(limit: number = 20): Promise<readonly AdminAuditEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Audit limit must be an integer between 1 and 100");
    const result = await this.database.query(
      `SELECT id, actor_telegram_user_id, action, subject_user_id, created_at
      FROM admin_audit_events
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
      [limit]
    );
    return result.rows.map(event);
  }
}

function event(row: Record<string, unknown>): AdminAuditEvent {
  const action = row.action;
  if (action !== "partner_approval_requested" && action !== "partner_risk_updated" && action !== "partner_cashout_frozen" && action !== "partner_cashout_unfrozen" && action !== "partner_cashout_approved" && action !== "partner_cashout_rejected" && action !== "beta_feedback_reviewed") throw new Error("Unexpected audit action");
  return {
    id: uuid(row.id, "audit event ID"),
    actorTelegramUserId: telegramId(row.actor_telegram_user_id),
    action,
    subjectUserId: uuid(row.subject_user_id, "subject user ID"),
    createdAt: timestamp(row.created_at)
  };
}

function uuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error(`Expected ${name}`);
  return value;
}

function telegramId(value: unknown): string {
  const id = typeof value === "string" ? value : String(value);
  if (!/^-?\d+$/.test(id)) throw new Error("Expected an integer Telegram operator ID");
  return id;
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(typeof value === "string" ? value : "");
  if (Number.isNaN(date.getTime())) throw new Error("Expected audit timestamp");
  return date.toISOString();
}
