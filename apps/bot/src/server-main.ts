import { createServer, type IncomingMessage, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import {
  getDatabaseUrl,
  getTelegramBotToken,
  PgPoolSqlExecutor,
  TelegramBotApiTransport
} from "@haulalert/notification-service";

import { PostgresTelegramIdentityStore, TelegramBotOnboardingService } from "./index.js";
import {
  getTelegramWebhookSecret,
  TelegramWebhookHandler,
  type TelegramWebhookRequest,
  type TelegramWebhookResponse
} from "./webhook.js";

const maximumRequestBodyBytes = 1_000_000;

export interface BotServerConfig {
  readonly databaseUrl: string;
  readonly telegramBotToken: string;
  readonly webhookSecret: string;
  readonly webhookPath: string;
  readonly port: number;
}

export function getBotServerConfig(environment: NodeJS.ProcessEnv = process.env): BotServerConfig {
  return {
    databaseUrl: getDatabaseUrl(environment),
    telegramBotToken: getTelegramBotToken(environment),
    webhookSecret: getTelegramWebhookSecret(environment),
    webhookPath: getWebhookPath(environment.TELEGRAM_WEBHOOK_PATH),
    port: getPort(environment.PORT)
  };
}

/** Creates the small HTTP boundary that passes Telegram requests to the protected webhook handler. */
export function createTelegramWebhookServer(
  handler: Pick<TelegramWebhookHandler, "handle">,
  webhookPath: string
): Server {
  return createServer((request, response) => {
    void handleHttpRequest(request, webhookPath, handler)
      .then((result) => {
        response.statusCode = result.statusCode;
        response.end();
      })
      .catch((error: unknown) => {
        const statusCode = error instanceof RequestBodyTooLargeError ? 413 : 500;
        response.statusCode = statusCode;
        response.end();
      });
  });
}

/** Runs the Telegram Bot webhook server until SIGINT or SIGTERM. */
export async function runBotServer(config: BotServerConfig = getBotServerConfig()): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const onboarding = new TelegramBotOnboardingService(
    new PostgresTelegramIdentityStore(new PgPoolSqlExecutor(pool)),
    new TelegramBotApiTransport(config.telegramBotToken)
  );
  const server = createTelegramWebhookServer(
    new TelegramWebhookHandler(config.webhookSecret, onboarding),
    config.webhookPath
  );

  try {
    await listen(server, config.port);
    console.info(`Telegram Bot webhook server listening on port ${config.port}${config.webhookPath}`);
    await waitForShutdown();
  } finally {
    await closeServer(server);
    await pool.end();
  }
}

async function handleHttpRequest(
  request: IncomingMessage,
  webhookPath: string,
  handler: Pick<TelegramWebhookHandler, "handle">
): Promise<TelegramWebhookResponse | { readonly statusCode: 404 }> {
  if (request.url !== webhookPath) return { statusCode: 404 };

  const webhookRequest: TelegramWebhookRequest = {
    method: request.method ?? "GET",
    headers: normalizeHeaders(request),
    body: await readBody(request)
  };
  return handler.handle(webhookRequest);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maximumRequestBodyBytes) throw new RequestBodyTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function normalizeHeaders(request: IncomingMessage): Readonly<Record<string, string | undefined>> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value[0] : value])
  );
}

function getWebhookPath(value: string | undefined): string {
  const path = value?.trim() || "/telegram/webhook";
  if (!path.startsWith("/")) throw new Error("TELEGRAM_WEBHOOK_PATH must start with a slash");
  return path;
}

function getPort(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) return 3_000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolveListening, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, () => {
      server.off("error", onError);
      resolveListening();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolveClosing, reject) => {
    server.close((error) => error === undefined ? resolveClosing() : reject(error));
  });
}

function waitForShutdown(): Promise<void> {
  return new Promise((resolveShutdown) => {
    const shutdown = (): void => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      resolveShutdown();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

class RequestBodyTooLargeError extends Error {}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  void runBotServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Bot server failed to start";
    console.error(`Bot server failed to start: ${message}`);
    process.exitCode = 1;
  });
}
