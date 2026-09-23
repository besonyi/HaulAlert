import type { TelegramTransport } from "./index.js";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

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
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch
  ) {}

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
                url: action.url
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

  private async sendMessage(body: Record<string, unknown>): Promise<void> {
    const response = await this.fetchImplementation(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }
    );

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
