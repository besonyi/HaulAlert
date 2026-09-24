import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { getDatabaseUrl, getTelegramBotToken, PgPoolSqlExecutor } from "@haulalert/notification-service";

import { createMiniAppApiServer } from "./http-api.js";
import { getAdminTelegramUserIds, isAdminTelegramUser, PostgresAdminDashboardRepository, PostgresAdminSearchRepository, PostgresAlertRepository, PostgresDashboardRepository } from "./index.js";
import { verifyTelegramMiniAppInitData } from "./telegram-miniapp-auth.js";

export interface ApiServerConfig {
  readonly databaseUrl: string;
  readonly telegramBotToken: string;
  readonly port: number;
  readonly adminTelegramUserIds: readonly string[];
}

export function getApiServerConfig(environment: NodeJS.ProcessEnv = process.env): ApiServerConfig {
  return {
    databaseUrl: getDatabaseUrl(environment),
    telegramBotToken: getTelegramBotToken(environment),
    port: getPort(environment.API_PORT),
    adminTelegramUserIds: getAdminTelegramUserIds(environment.ADMIN_TELEGRAM_USER_IDS)
  };
}

/** Runs the authenticated Mini App API until SIGINT or SIGTERM. */
export async function runApiServer(config: ApiServerConfig = getApiServerConfig()): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const database = new PgPoolSqlExecutor(pool);
  const server = createMiniAppApiServer({
    alerts: new PostgresAlertRepository(database),
    dashboard: new PostgresDashboardRepository(database),
    adminDashboard: new PostgresAdminDashboardRepository(database),
    adminSearch: new PostgresAdminSearchRepository(database),
    isAdmin: (telegramUserId) => isAdminTelegramUser(telegramUserId, config.adminTelegramUserIds),
    authenticate: (initData) => verifyTelegramMiniAppInitData(initData, config.telegramBotToken)
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
