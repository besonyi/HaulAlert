import { createHmac, timingSafeEqual } from "node:crypto";

export interface AuthenticatedTelegramUser {
  readonly id: string;
  readonly firstName: string;
  readonly lastName?: string;
  readonly username?: string;
  readonly languageCode?: string;
}

export interface TelegramMiniAppAuthOptions {
  /** Rejects old Mini App sessions; defaults to one day. */
  readonly maximumAgeSeconds?: number;
  /** Tolerates small local clock drift without accepting far-future sessions. */
  readonly maximumFutureSkewSeconds?: number;
}

/**
 * Verifies raw Telegram.WebApp.initData before an API trusts the Mini App user.
 * The implementation follows Telegram's HMAC-SHA-256 data-check-string contract.
 */
export function verifyTelegramMiniAppInitData(
  initData: string,
  botToken: string,
  now: Date = new Date(),
  options: TelegramMiniAppAuthOptions = {}
): AuthenticatedTelegramUser {
  if (botToken.trim().length === 0) throw new Error("Telegram bot token must not be empty");
  const maximumAgeSeconds = options.maximumAgeSeconds ?? 86_400;
  const maximumFutureSkewSeconds = options.maximumFutureSkewSeconds ?? 60;
  if (!Number.isInteger(maximumAgeSeconds) || maximumAgeSeconds < 1) {
    throw new Error("maximumAgeSeconds must be a positive integer");
  }
  if (!Number.isInteger(maximumFutureSkewSeconds) || maximumFutureSkewSeconds < 0) {
    throw new Error("maximumFutureSkewSeconds must be a non-negative integer");
  }

  const parameters = new URLSearchParams(initData);
  const receivedHash = exactlyOne(parameters, "hash");
  if (!/^[0-9a-f]{64}$/i.test(receivedHash)) throw new Error("Telegram Mini App hash is invalid");
  const dataCheckString = [...parameters.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const actualHash = Buffer.from(receivedHash, "hex");
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
    throw new Error("Telegram Mini App signature does not match");
  }

  const authDate = parseAuthDate(exactlyOne(parameters, "auth_date"));
  const ageSeconds = (now.getTime() - authDate.getTime()) / 1_000;
  if (ageSeconds > maximumAgeSeconds || ageSeconds < -maximumFutureSkewSeconds) {
    throw new Error("Telegram Mini App authorization has expired");
  }

  return parseTelegramUser(exactlyOne(parameters, "user"));
}

function exactlyOne(parameters: URLSearchParams, name: string): string {
  const values = parameters.getAll(name);
  if (values.length !== 1 || values[0] === undefined || values[0].length === 0) {
    throw new Error(`Telegram Mini App init data requires exactly one ${name}`);
  }
  return values[0];
}

function parseAuthDate(value: string): Date {
  if (!/^\d+$/.test(value)) throw new Error("Telegram Mini App auth_date is invalid");
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp)) throw new Error("Telegram Mini App auth_date is invalid");
  const date = new Date(timestamp * 1_000);
  if (Number.isNaN(date.getTime())) throw new Error("Telegram Mini App auth_date is invalid");
  return date;
}

function parseTelegramUser(value: string): AuthenticatedTelegramUser {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Telegram Mini App user is invalid JSON");
  }
  if (!isRecord(parsed) || typeof parsed.first_name !== "string" || parsed.first_name.trim().length === 0) {
    throw new Error("Telegram Mini App user is invalid");
  }
  const id = normalizeTelegramId(parsed.id);
  return {
    id,
    firstName: parsed.first_name,
    ...(typeof parsed.last_name === "string" ? { lastName: parsed.last_name } : {}),
    ...(typeof parsed.username === "string" ? { username: parsed.username } : {}),
    ...(typeof parsed.language_code === "string" ? { languageCode: parsed.language_code } : {})
  };
}

function normalizeTelegramId(value: unknown): string {
  const id = typeof value === "number" ? String(value) : value;
  if (typeof id !== "string" || !/^\d+$/.test(id)) throw new Error("Telegram Mini App user ID is invalid");
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
