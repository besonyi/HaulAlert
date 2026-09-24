import type { SqlExecutor } from "@haulalert/notification-service";

/** Resolves a verified Telegram identity to HaulAlert's internal account UUID. */
export class PostgresTelegramUserResolver {
  public constructor(private readonly database: SqlExecutor) {}

  public async resolve(telegramUserId: string): Promise<string | undefined> {
    if (!/^\d+$/.test(telegramUserId)) throw new Error("Telegram user ID must be numeric");
    const result = await this.database.query("SELECT id FROM users WHERE telegram_user_id = $1::bigint", [telegramUserId]);
    const id = result.rows[0]?.id;
    if (id === undefined) return undefined;
    if (typeof id !== "string" || id.length === 0) throw new Error("Invalid HaulAlert user identity");
    return id;
  }
}
