import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LocalChromeDevToolsRuntime } from "./central-dispatch-cdp-executor.js";
import { checkCentralDispatchReadiness } from "./central-dispatch-readiness.js";
import { getCentralDispatchWorkerRuntimeConfig } from "./central-dispatch-worker-main.js";

/** Runs a safe local preflight before starting the Central Dispatch worker. */
export async function runCentralDispatchReadinessCheck(): Promise<void> {
  const config = getCentralDispatchWorkerRuntimeConfig();
  const result = await checkCentralDispatchReadiness(
    new LocalChromeDevToolsRuntime(config.chromeDevToolsEndpoint)
  );
  if (result.status === "ready") {
    console.info("Central Dispatch readiness check passed: authenticated page detected through local Chrome.");
    return;
  }
  throw new Error(`Central Dispatch readiness check failed: ${result.error.message}`);
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  void runCentralDispatchReadinessCheck().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Central Dispatch readiness check failed";
    console.error(message);
    process.exitCode = 1;
  });
}
