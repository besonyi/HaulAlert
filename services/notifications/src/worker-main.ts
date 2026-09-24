import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { Pool } from "pg";

import { PgPoolSqlExecutor, getDatabaseUrl } from "./pg-pool-sql-executor.js";
import { PostgresNotificationDeliveryRepository } from "./postgres-notification-delivery-repository.js";
import { PostgresNotificationWorker } from "./postgres-notification-worker.js";
import { TelegramBotApiTransport, getTelegramBotToken } from "./telegram-bot-api-transport.js";

export interface NotificationWorkerRuntimeConfig {
  readonly databaseUrl: string;
  readonly telegramBotToken: string;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly maximumAttempts: number;
  readonly initialRetryDelayMs: number;
  readonly claimLeaseDurationMs: number;
}

export function getNotificationWorkerRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env
): NotificationWorkerRuntimeConfig {
  return {
    databaseUrl: getDatabaseUrl(environment),
    telegramBotToken: getTelegramBotToken(environment),
    batchSize: getPositiveInteger(environment.NOTIFICATION_WORKER_BATCH_SIZE, 25, "NOTIFICATION_WORKER_BATCH_SIZE"),
    pollIntervalMs: getPositiveInteger(
      environment.NOTIFICATION_WORKER_POLL_INTERVAL_MS,
      1_000,
      "NOTIFICATION_WORKER_POLL_INTERVAL_MS"
    ),
    maximumAttempts: getPositiveInteger(
      environment.NOTIFICATION_WORKER_MAXIMUM_ATTEMPTS,
      3,
      "NOTIFICATION_WORKER_MAXIMUM_ATTEMPTS"
    ),
    initialRetryDelayMs: getPositiveInteger(
      environment.NOTIFICATION_WORKER_INITIAL_RETRY_DELAY_MS,
      5_000,
      "NOTIFICATION_WORKER_INITIAL_RETRY_DELAY_MS"
    ),
    claimLeaseDurationMs: getPositiveInteger(
      environment.NOTIFICATION_WORKER_CLAIM_LEASE_DURATION_MS,
      300_000,
      "NOTIFICATION_WORKER_CLAIM_LEASE_DURATION_MS"
    )
  };
}

/** Runs one durable worker process until SIGINT or SIGTERM. */
export async function runNotificationWorker(
  config: NotificationWorkerRuntimeConfig = getNotificationWorkerRuntimeConfig()
): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const repository = new PostgresNotificationDeliveryRepository(new PgPoolSqlExecutor(pool));
  const worker = new PostgresNotificationWorker(
    repository,
    new TelegramBotApiTransport(config.telegramBotToken),
    {
      maximumAttempts: config.maximumAttempts,
      initialRetryDelayMs: config.initialRetryDelayMs,
      claimLeaseDurationMs: config.claimLeaseDurationMs
    }
  );
  let activeCycle: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;

  const runCycle = async (): Promise<void> => {
    if (activeCycle !== undefined) return;

    activeCycle = worker.processBatch(config.batchSize)
      .then(() => undefined)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown notification worker failure";
        console.error(`Notification worker cycle failed: ${message}`);
      })
      .finally(() => {
        activeCycle = undefined;
      });
    await activeCycle;
  };

  try {
    await runCycle();
    await new Promise<void>((resolveWorker) => {
      const shutdown = (): void => {
        if (timer !== undefined) clearInterval(timer);
        process.off("SIGINT", shutdown);
        process.off("SIGTERM", shutdown);
        resolveWorker();
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      timer = setInterval(() => { void runCycle(); }, config.pollIntervalMs);
    });
    await activeCycle;
  } finally {
    if (timer !== undefined) clearInterval(timer);
    await pool.end();
  }
}

function getPositiveInteger(value: string | undefined, fallback: number, variableName: string): number {
  if (value === undefined || value.trim().length === 0) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${variableName} must be a positive integer`);
  }
  return parsed;
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  void runNotificationWorker().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Notification worker failed to start";
    console.error(`Notification worker failed to start: ${message}`);
    process.exitCode = 1;
  });
}
