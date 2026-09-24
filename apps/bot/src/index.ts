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

export interface TelegramCallbackTransport {
  answerCallbackQuery(callbackQueryId: string, text: string): Promise<void>;
}

export interface AlertMuteStore {
  pauseForTelegramUser(input: { readonly telegramUserId: string; readonly alertId: string }): Promise<boolean>;
}

export interface TelegramUpdate {
  readonly message?: {
    readonly text?: string;
    readonly from?: { readonly id: string | number; readonly isBot?: boolean };
    readonly chat: { readonly id: string | number; readonly type: "private" | "group" | "supergroup" | "channel" };
  };
  readonly callbackQuery?: {
    readonly id: string;
    readonly data?: string;
    readonly from: { readonly id: string | number; readonly isBot?: boolean };
    readonly chat: { readonly id: string | number; readonly type: "private" | "group" | "supergroup" | "channel" };
  };
}

export type BotUpdateResult =
  | { readonly status: "ignored" }
  | { readonly status: "onboarded"; readonly userId: string; readonly isNew: boolean }
  | { readonly status: "muted" }
  | { readonly status: "mute-unavailable" };

/** Handles private /start messages without assuming a specific HTTP framework. */
export class TelegramBotOnboardingService {
  public constructor(
    private readonly identities: TelegramIdentityStore,
    private readonly transport: TelegramTextTransport & Partial<TelegramCallbackTransport>,
    private readonly alerts?: AlertMuteStore
  ) {}

  public async handle(update: TelegramUpdate): Promise<BotUpdateResult> {
    if (update.callbackQuery !== undefined) return this.handleCallback(update.callbackQuery);
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

  private async handleCallback(callback: NonNullable<TelegramUpdate["callbackQuery"]>): Promise<BotUpdateResult> {
    const alertId = parseMuteCallback(callback.data);
    if (
      alertId === undefined
      || callback.chat.type !== "private"
      || callback.from.isBot === true
      || this.alerts === undefined
      || this.transport.answerCallbackQuery === undefined
    ) return { status: "ignored" };

    const muted = await this.alerts.pauseForTelegramUser({
      telegramUserId: normalizeTelegramId(callback.from.id),
      alertId
    });
    const text = muted ? "Alert paused. You will not receive new load messages for it." : "This alert is already paused or unavailable.";
    await this.transport.answerCallbackQuery(callback.id, muted ? "Alert paused." : "Alert unavailable.");
    await this.transport.sendText(normalizeTelegramId(callback.chat.id), text);
    return muted ? { status: "muted" } : { status: "mute-unavailable" };
  }
}

/** Changes only an alert owned by the Telegram identity that pressed the mute button. */
export class PostgresAlertMuteStore implements AlertMuteStore {
  public constructor(private readonly database: SqlExecutor) {}

  public async pauseForTelegramUser(input: { readonly telegramUserId: string; readonly alertId: string }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE alerts AS alert
      SET status = 'paused', updated_at = now()
      FROM users
      WHERE users.telegram_user_id = $1::bigint
        AND alert.user_id = users.id
        AND alert.id = $2::uuid
        AND alert.status = 'active'
        AND alert.deleted_at IS NULL
      RETURNING alert.id`,
      [input.telegramUserId, input.alertId]
    );
    return getRowId(result.rows[0]) !== undefined;
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

function parseMuteCallback(value: string | undefined): string | undefined {
  const alertId = value?.match(/^mute:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)?.[1];
  return alertId;
}

function welcomeText(isNew: boolean): string {
  return isNew
    ? "Welcome to HaulAlert. You are connected — create an alert and we will message you when a matching load appears."
    : "Welcome back to HaulAlert. Your Telegram notifications are connected.";
}

export { TelegramWebhookHandler, getTelegramWebhookSecret } from "./webhook.js";
export type { TelegramWebhookRequest, TelegramWebhookResponse, TelegramUpdateHandler } from "./webhook.js";
