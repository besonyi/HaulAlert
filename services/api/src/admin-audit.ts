import type { SqlExecutor } from "@haulalert/notification-service";

export interface AdminAuditEventInput {
  readonly actorTelegramUserId: string;
  readonly action: "partner_approval_requested";
  readonly subjectUserId: string;
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
}
