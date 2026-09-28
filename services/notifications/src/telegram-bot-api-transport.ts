import type { TelegramTransport } from "./index.js";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const defaultRequestTimeoutMs = 10_000;

interface TelegramApiResponse {
  readonly ok: boolean;
  readonly description?: string;
  readonly parameters?: {
    readonly retry_after?: number;
  };
}

/** A Telegram 429 response with the server-directed wait duration. */
export class TelegramRateLimitError extends Error {
  public constructor(readonly retryAfterMs: number, description?: string) {
    super(`Telegram rate limit exceeded; retry after ${retryAfterMs}ms${description === undefined ? "" : `: ${description}`}`);
    this.name = "TelegramRateLimitError";
  }
}

/** A Telegram API call exceeded HaulAlert's bounded request window. */
export class TelegramRequestTimeoutError extends Error {
  public constructor(readonly timeoutMs: number) {
    super(`Telegram API request timed out after ${timeoutMs}ms`);
    this.name = "TelegramRequestTimeoutError";
  }
}

/** Reads the Bot API credential without ever embedding it in source code. */
export function getTelegramBotToken(environment: NodeJS.ProcessEnv = process.env): string {
  const token = environment.TELEGRAM_BOT_TOKEN?.trim();
  if (token === undefined || token.length === 0) {
    throw new Error("TELEGRAM_BOT_TOKEN must be configured before Telegram notifications can be sent");
  }

  return token;
}

/** Sends rendered HaulAlert notifications through the official Telegram Bot API. */
export class TelegramBotApiTransport implements TelegramTransport {
  public constructor(
    private readonly botToken: string,
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch,
    private readonly requestTimeoutMs: number = defaultRequestTimeoutMs
  ) {
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
      throw new Error("Telegram API request timeout must be a positive integer");
    }
  }

  public async send(input: Parameters<TelegramTransport["send"]>[0]): Promise<void> {
    const body = {
      chat_id: input.recipientId,
      text: input.notification.text,
      disable_web_page_preview: true,
      ...(input.notification.actions.length === 0
        ? {}
        : {
            reply_markup: {
              inline_keyboard: [input.notification.actions.map((action) => ({
                text: action.label,
                ...("url" in action ? { url: action.url } : { callback_data: action.callbackData })
              }))]
            }
          })
    };
    await this.sendMessage(body);
  }

  /** Sends a Bot command response without creating a load notification payload. */
  public async sendText(recipientId: string, text: string): Promise<void> {
    await this.sendMessage({
      chat_id: recipientId,
      text,
      disable_web_page_preview: true
    });
  }

  /** Sends a private-chat launch control for the customer-facing Telegram Mini App. */
  public async sendMiniAppLaunch(recipientId: string, text: string, miniAppUrl: string): Promise<void> {
    await this.sendMessage({
      chat_id: recipientId,
      text,
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "OPEN HAULALERT", web_app: { url: miniAppUrl } }]]
      }
    });
  }

  /** Acknowledges a pressed inline control so Telegram stops showing its loading indicator. */
  public async answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
    await this.callTelegram("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
  }

  private async sendMessage(body: Record<string, unknown>): Promise<void> {
    await this.callTelegram("sendMessage", body);
  }

  private async callTelegram(method: "sendMessage" | "answerCallbackQuery", body: Record<string, unknown>): Promise<void> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchImplementation(
        `https://api.telegram.org/bot${this.botToken}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: abortController.signal
        }
      );
    } catch (error: unknown) {
      if (abortController.signal.aborted) throw new TelegramRequestTimeoutError(this.requestTimeoutMs);
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const payload = await readTelegramApiResponse(response);
    if (response.status === 429 && payload?.parameters?.retry_after !== undefined) {
      throw new TelegramRateLimitError(payload.parameters.retry_after * 1_000, payload.description);
    }
    if (!response.ok) {
      const description = payload?.description === undefined ? "" : `: ${payload.description}`;
      throw new Error(`Telegram sendMessage failed with HTTP ${response.status}${description}`);
    }
    if (payload === undefined || !payload.ok) {
      const description = payload?.description === undefined ? "" : `: ${payload.description}`;
      throw new Error(`Telegram sendMessage was rejected${description}`);
    }
  }
}

async function readTelegramApiResponse(response: Response): Promise<TelegramApiResponse | undefined> {
  try {
    const payload: unknown = await response.json();
    return isTelegramApiResponse(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function isTelegramApiResponse(value: unknown): value is TelegramApiResponse {
  return typeof value === "object"
    && value !== null
    && "ok" in value
    && typeof value.ok === "boolean";
}
