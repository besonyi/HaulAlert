import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { getDatabaseUrl, PgPoolSqlExecutor } from "@haulalert/notification-service";

import { PostgresPartnerCommissionReleaseRepository } from "./partner-commission-release.js";

export interface PartnerCommissionWorkerRuntimeConfig {
  readonly databaseUrl: string;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
}

export function getPartnerCommissionWorkerRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env
): PartnerCommissionWorkerRuntimeConfig {
  return {
    databaseUrl: getDatabaseUrl(environment),
    batchSize: positiveInteger(environment.PARTNER_COMMISSION_WORKER_BATCH_SIZE, 100, "PARTNER_COMMISSION_WORKER_BATCH_SIZE"),
    pollIntervalMs: positiveInteger(environment.PARTNER_COMMISSION_WORKER_POLL_INTERVAL_MS, 3_600_000, "PARTNER_COMMISSION_WORKER_POLL_INTERVAL_MS")
  };
}

/** Runs an idempotent commission-release worker. It never accesses any payout provider. */
export async function runPartnerCommissionWorker(
  config: PartnerCommissionWorkerRuntimeConfig = getPartnerCommissionWorkerRuntimeConfig()
): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const repository = new PostgresPartnerCommissionReleaseRepository(new PgPoolSqlExecutor(pool));
  let activeCycle: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;

  const runCycle = async (): Promise<void> => {
    if (activeCycle !== undefined) return;
    activeCycle = (async () => {
      let released = 0;
      let batch: number;
      do {
        batch = await repository.releaseDue(config.batchSize);
        released += batch;
      } while (batch === config.batchSize);
      if (released > 0) console.info(`Partner commission release completed; released=${released}`);
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown release failure";
      console.error(`Partner commission release failed: ${message}`);
    }).finally(() => { activeCycle = undefined; });
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

function positiveInteger(value: string | undefined, fallback: number, variableName: string): number {
  if (value === undefined || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${variableName} must be a positive integer`);
  return parsed;
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  void runPartnerCommissionWorker().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Partner commission worker failed to start";
    console.error(message);
    process.exitCode = 1;
  });
}
