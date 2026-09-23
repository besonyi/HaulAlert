import { timingSafeEqual } from "node:crypto";

import type { TelegramUpdate } from "./index.js";

export interface TelegramWebhookRequest {
  readonly method: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

export interface TelegramWebhookResponse {
  readonly statusCode: 200 | 400 | 401 | 405;
}

export interface TelegramUpdateHandler {
  handle(update: TelegramUpdate): Promise<unknown>;
}

export function getTelegramWebhookSecret(environment: NodeJS.ProcessEnv = process.env): string {
  const secret = environment.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret === undefined || secret.length < 16) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET must contain at least 16 characters");
  }
  return secret;
}

/** Framework-neutral, secret-protected Telegram webhook handler. */
export class TelegramWebhookHandler {
  public constructor(
    private readonly secret: string,
    private readonly updates: TelegramUpdateHandler
  ) {}

  public async handle(request: TelegramWebhookRequest): Promise<TelegramWebhookResponse> {
    if (request.method.toUpperCase() !== "POST") return { statusCode: 405 };
    if (!hasValidSecret(request.headers["x-telegram-bot-api-secret-token"], this.secret)) {
      return { statusCode: 401 };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(request.body);
    } catch {
      return { statusCode: 400 };
    }

    const update = parseTelegramUpdate(parsed);
    if (update === undefined) return { statusCode: 400 };
    await this.updates.handle(update);
    return { statusCode: 200 };
  }
}

function hasValidSecret(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

function parseTelegramUpdate(value: unknown): TelegramUpdate | undefined {
  if (!isRecord(value)) return undefined;
  if (value.message === undefined) return {};
  if (!isRecord(value.message) || !isRecord(value.message.chat)) return undefined;

  const { chat, from, text } = value.message;
  if (!isTelegramId(chat.id) || !isChatType(chat.type)) return undefined;
  if (from !== undefined && (!isRecord(from) || !isTelegramId(from.id))) return undefined;
  if (text !== undefined && typeof text !== "string") return undefined;

  return {
    message: {
      ...(text === undefined ? {} : { text }),
      ...(from === undefined
        ? {}
        : {
            from: {
              id: from.id as string | number,
              ...(typeof from.is_bot === "boolean" ? { isBot: from.is_bot } : {})
            }
          }),
      chat: { id: chat.id as string | number, type: chat.type }
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTelegramId(value: unknown): value is string | number {
  return typeof value === "number" || (typeof value === "string" && /^-?\d+$/.test(value));
}

function isChatType(value: unknown): value is "private" | "group" | "supergroup" | "channel" {
  return value === "private" || value === "group" || value === "supergroup" || value === "channel";
}
