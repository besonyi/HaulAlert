import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { getDatabaseUrl, getTelegramBotToken, PgPoolSqlExecutor } from "@haulalert/notification-service";

import { createMiniAppApiServer } from "./http-api.js";
import { getAdminTelegramUserIds, isAdminTelegramUser, PostgresAdminDashboardRepository, PostgresAdminSearchRepository, PostgresAlertRepository, PostgresBrokerDirectoryRepository, PostgresDashboardRepository, PostgresEntitlementRepository, PostgresPartnerAccountRepository, PostgresReferralRepository, PostgresStripeWebhookEventProcessor, PostgresTelegramUserResolver, StripeWebhookHandler, type ReferralSummary } from "./index.js";
import { verifyTelegramMiniAppInitData } from "./telegram-miniapp-auth.js";

export interface ApiServerConfig {
  readonly databaseUrl: string;
  readonly telegramBotToken: string;
  readonly port: number;
  readonly adminTelegramUserIds: readonly string[];
  readonly telegramBotUsername: string;
  readonly stripeWebhookSecret: string | undefined;
}

export function getApiServerConfig(environment: NodeJS.ProcessEnv = process.env): ApiServerConfig {
  return {
    databaseUrl: getDatabaseUrl(environment),
    telegramBotToken: getTelegramBotToken(environment),
    port: getPort(environment.API_PORT),
    adminTelegramUserIds: getAdminTelegramUserIds(environment.ADMIN_TELEGRAM_USER_IDS),
    telegramBotUsername: getTelegramBotUsername(environment.TELEGRAM_BOT_USERNAME),
    stripeWebhookSecret: optionalStripeWebhookSecret(environment.STRIPE_WEBHOOK_SECRET)
  };
}

/** Runs the authenticated Mini App API until SIGINT or SIGTERM. */
export async function runApiServer(config: ApiServerConfig = getApiServerConfig()): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const database = new PgPoolSqlExecutor(pool);
  const telegramUsers = new PostgresTelegramUserResolver(database);
  const partners = new PostgresPartnerAccountRepository(database);
  const referrals = new PostgresReferralRepository(database);
  const server = createMiniAppApiServer({
    alerts: new PostgresAlertRepository(database),
    dashboard: new PostgresDashboardRepository(database),
    adminDashboard: new PostgresAdminDashboardRepository(database),
    adminSearch: new PostgresAdminSearchRepository(database),
    brokerDirectory: new PostgresBrokerDirectoryRepository(database),
    entitlements: new PostgresEntitlementRepository(database),
    referrals: {
      getForUser: async (userId) => withInviteLink(
        await referrals.getForUser(userId),
        config.telegramBotUsername
      )
    },
    partners,
    ...(config.stripeWebhookSecret === undefined ? {} : {
      stripeWebhook: new StripeWebhookHandler(config.stripeWebhookSecret, new PostgresStripeWebhookEventProcessor(database))
    }),
    isAdmin: (telegramUserId) => isAdminTelegramUser(telegramUserId, config.adminTelegramUserIds),
    authenticate: async (initData) => {
      const telegram = verifyTelegramMiniAppInitData(initData, config.telegramBotToken);
      const userId = await telegramUsers.resolve(telegram.id);
      if (userId === undefined) throw new Error("Telegram account has not completed Bot onboarding");
      return { ...telegram, id: userId, telegramUserId: telegram.id };
    }
  });

  try {
    await listen(server, config.port);
    console.info(`HaulAlert Mini App API listening on port ${config.port}`);
    await waitForShutdown();
  } finally {
    await closeServer(server);
    await pool.end();
  }
}

function getPort(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) return 3_001;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }
  return port;
}

export function getTelegramBotUsername(value: string | undefined): string {
  const username = (value?.trim() || "HaulAlertBot").replace(/^@/, "");
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) {
    throw new Error("TELEGRAM_BOT_USERNAME must be a valid Telegram bot username");
  }
  return username;
}

export function optionalStripeWebhookSecret(value: string | undefined): string | undefined {
  const secret = value?.trim();
  if (secret === undefined || secret.length === 0) return undefined;
  if (!secret.startsWith("whsec_") || secret.length < 12) {
    throw new Error("STRIPE_WEBHOOK_SECRET must be a Stripe webhook endpoint secret");
  }
  return secret;
}

export function withInviteLink(referral: ReferralSummary, telegramBotUsername: string): ReferralSummary & { readonly inviteLink: string } {
  return {
    ...referral,
    inviteLink: `https://t.me/${telegramBotUsername}?start=ref_${referral.code}`
  };
}

function listen(server: import("node:http").Server, port: number): Promise<void> {
  return new Promise((resolveListening, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, () => {
      server.off("error", onError);
      resolveListening();
    });
  });
}

function closeServer(server: import("node:http").Server): Promise<void> {
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

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  void runApiServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "API server failed to start";
    console.error(`API server failed to start: ${message}`);
    process.exitCode = 1;
  });
}
