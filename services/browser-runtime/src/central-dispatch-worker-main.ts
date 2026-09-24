import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserRuntime, ScanScheduler } from "@haulalert/browser-runtime-core";
import {
  PostgresAsyncSeenLoadStore,
  PostgresLoadDeliveryOutbox,
  PostgresScanHistoryRecorder,
  ScanIngestionProcessor,
  TransactionalLoadIngestionService
} from "@haulalert/ingestion-service";
import { PostgresAlertSubscriptionSource, RefreshingAlertCandidateIndex } from "@haulalert/matcher-service";
import { getDatabaseUrl, PgPoolSqlExecutor } from "@haulalert/notification-service";
import { AsyncNewLoadDetector } from "@haulalert/new-load-detector";
import { Pool } from "pg";

import {
  BrowserRuntimeOrchestrator,
  BrowserScanCoordinator,
  CentralDispatchPollingWorker,
  CentralDispatchRuntimeCycle,
  CentralDispatchHealthReporter,
  CentralDispatchSearchSynchronizer,
  CentralDispatchSessionMonitor,
  createLocalCentralDispatchCdpSearchGateway,
  DurableBrowserRuntimeController,
  LocalChromeDevToolsRuntime,
  PostgresBrowserRuntimeStateStore,
  PostgresProviderSearchSource
} from "./index.js";

export interface CentralDispatchWorkerRuntimeConfig {
  readonly databaseUrl: string;
  readonly sessionId: string;
  readonly chromeDevToolsEndpoint: string;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly alertRefreshIntervalMs: number;
}

/** Reads the non-secret configuration for the Central Dispatch runtime process. */
export function getCentralDispatchWorkerRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env
): CentralDispatchWorkerRuntimeConfig {
  return {
    databaseUrl: getDatabaseUrl(environment),
    sessionId: getRequiredText(environment.CENTRAL_DISPATCH_SESSION_ID, "central-dispatch-local", "CENTRAL_DISPATCH_SESSION_ID"),
    chromeDevToolsEndpoint: getRequiredText(
      environment.CENTRAL_DISPATCH_DEVTOOLS_ENDPOINT,
      "http://127.0.0.1:9222",
      "CENTRAL_DISPATCH_DEVTOOLS_ENDPOINT"
    ),
    batchSize: getPositiveInteger(environment.CENTRAL_DISPATCH_BATCH_SIZE, 10, "CENTRAL_DISPATCH_BATCH_SIZE"),
    pollIntervalMs: getPositiveInteger(
      environment.CENTRAL_DISPATCH_POLL_INTERVAL_MS,
      30_000,
      "CENTRAL_DISPATCH_POLL_INTERVAL_MS"
    ),
    alertRefreshIntervalMs: getPositiveInteger(
      environment.CENTRAL_DISPATCH_ALERT_REFRESH_INTERVAL_MS,
      5_000,
      "CENTRAL_DISPATCH_ALERT_REFRESH_INTERVAL_MS"
    )
  };
}

/** Runs one Central Dispatch-only process until SIGINT or SIGTERM. */
export async function runCentralDispatchWorker(
  config: CentralDispatchWorkerRuntimeConfig = getCentralDispatchWorkerRuntimeConfig()
): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const database = new PgPoolSqlExecutor(pool);
    const runtime = new BrowserRuntime();
    const stateStore = new PostgresBrowserRuntimeStateStore(database);
    const durableRuntime = new DurableBrowserRuntimeController(runtime, stateStore);
    await durableRuntime.restore();

    const chromeRuntime = new LocalChromeDevToolsRuntime(config.chromeDevToolsEndpoint);
    const gateway = createLocalCentralDispatchCdpSearchGateway(config.chromeDevToolsEndpoint);
    const orchestrator = new BrowserRuntimeOrchestrator(runtime, gateway);
    const synchronizer = new CentralDispatchSearchSynchronizer(
      new PostgresProviderSearchSource(database),
      durableRuntime,
      orchestrator
    );
    const processor = new ScanIngestionProcessor(
      new AsyncNewLoadDetector(new PostgresAsyncSeenLoadStore(database)),
      new TransactionalLoadIngestionService(
        new PostgresLoadDeliveryOutbox(database),
        new RefreshingAlertCandidateIndex(
          new PostgresAlertSubscriptionSource(database),
          config.alertRefreshIntervalMs
        )
      )
    );
    const coordinator = new BrowserScanCoordinator(
      runtime,
      new ScanScheduler(),
      gateway,
      processor,
      { history: new PostgresScanHistoryRecorder(database) }
    );
    const cycle = new CentralDispatchRuntimeCycle(
      new CentralDispatchSessionMonitor(runtime, chromeRuntime, config.sessionId, stateStore),
      durableRuntime,
      coordinator,
      { beforeScan: () => synchronizer.synchronize() }
    );
    const healthReporter = new CentralDispatchHealthReporter((message) => console.info(message));

    await new CentralDispatchPollingWorker(cycle, {
      batchSize: config.batchSize,
      pollIntervalMs: config.pollIntervalMs,
      onCycleComplete: (result) => healthReporter.report(result),
      onCycleError: (error) => console.error(`Central Dispatch worker cycle failed: ${error.message}`)
    }).run();
  } finally {
    await pool.end();
  }
}

function getRequiredText(value: string | undefined, fallback: string, variableName: string): string {
  const result = value?.trim() || fallback;
  if (result.length === 0) throw new Error(`${variableName} must not be empty`);
  return result;
}

function getPositiveInteger(value: string | undefined, fallback: number, variableName: string): number {
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
  void runCentralDispatchWorker().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Central Dispatch worker failed to start";
    console.error(`Central Dispatch worker failed to start: ${message}`);
    process.exitCode = 1;
  });
}
