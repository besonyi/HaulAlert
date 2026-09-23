import type { SqlExecutor } from "@haulalert/notification-service";

export interface TelegramIdentityStore {
  upsert(input: { readonly telegramUserId: string; readonly telegramChatId: string }): Promise<{
    readonly userId: string;
    readonly isNew: boolean;
  }>;
}

/** Persists the customer account and most recent private Telegram chat. */
export class PostgresTelegramIdentityStore implements TelegramIdentityStore {
  public constructor(private readonly database: SqlExecutor) {}

  public async upsert(input: {
    readonly telegramUserId: string;
    readonly telegramChatId: string;
  }): Promise<{ readonly userId: string; readonly isNew: boolean }> {
    const inserted = await this.database.query(
      `INSERT INTO users (telegram_user_id, telegram_chat_id)
      VALUES ($1::bigint, $2::bigint)
      ON CONFLICT (telegram_user_id) DO NOTHING
      RETURNING id`,
      [input.telegramUserId, input.telegramChatId]
    );
    const insertedId = getRowId(inserted.rows[0]);
    if (insertedId !== undefined) return { userId: insertedId, isNew: true };

    const updated = await this.database.query(
      `UPDATE users
      SET telegram_chat_id = $2::bigint, updated_at = now()
      WHERE telegram_user_id = $1::bigint
      RETURNING id`,
      [input.telegramUserId, input.telegramChatId]
    );
    const userId = getRowId(updated.rows[0]);
    if (userId === undefined) throw new Error("Telegram user account disappeared during onboarding");
    return { userId, isNew: false };
  }
}

export interface TelegramTextTransport {
  sendText(recipientId: string, text: string): Promise<void>;
}

export interface TelegramUpdate {
  readonly message?: {
    readonly text?: string;
    readonly from?: { readonly id: string | number; readonly isBot?: boolean };
    readonly chat: { readonly id: string | number; readonly type: "private" | "group" | "supergroup" | "channel" };
  };
}

export type BotUpdateResult =
  | { readonly status: "ignored" }
  | { readonly status: "onboarded"; readonly userId: string; readonly isNew: boolean };

/** Handles private /start messages without assuming a specific HTTP framework. */
export class TelegramBotOnboardingService {
  public constructor(
    private readonly identities: TelegramIdentityStore,
    private readonly transport: TelegramTextTransport
  ) {}

  public async handle(update: TelegramUpdate): Promise<BotUpdateResult> {
    const message = update.message;
    if (
      message === undefined
      || message.chat.type !== "private"
      || message.from === undefined
      || message.from.isBot === true
      || !isStartCommand(message.text)
    ) {
      return { status: "ignored" };
    }

    const telegramUserId = normalizeTelegramId(message.from.id);
    const telegramChatId = normalizeTelegramId(message.chat.id);
    const account = await this.identities.upsert({ telegramUserId, telegramChatId });
    await this.transport.sendText(telegramChatId, welcomeText(account.isNew));
    return { status: "onboarded", ...account };
  }
}

function getRowId(row: Record<string, unknown> | undefined): string | undefined {
  return typeof row?.id === "string" ? row.id : undefined;
}

function isStartCommand(text: string | undefined): boolean {
  return text !== undefined && /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text.trim());
}

function normalizeTelegramId(value: string | number): string {
  const normalized = String(value).trim();
  if (!/^-?\d+$/.test(normalized)) throw new Error("Telegram IDs must be integer values");
  return normalized;
}

function welcomeText(isNew: boolean): string {
  return isNew
    ? "Welcome to HaulAlert. You are connected — create an alert and we will message you when a matching load appears."
    : "Welcome back to HaulAlert. Your Telegram notifications are connected.";
}
