import type { TelegramTransport } from "./index.js";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface TelegramApiResponse {
  readonly ok: boolean;
  readonly description?: string;
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
    const response = await this.fetchImplementation(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }
    );

    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed with HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!isTelegramApiResponse(payload) || !payload.ok) {
      const description = isTelegramApiResponse(payload) && payload.description !== undefined
        ? `: ${payload.description}`
        : "";
      throw new Error(`Telegram sendMessage was rejected${description}`);
    }
  }
}

function isTelegramApiResponse(value: unknown): value is TelegramApiResponse {
  return typeof value === "object" && value !== null && "ok" in value && typeof value.ok === "boolean";
}
