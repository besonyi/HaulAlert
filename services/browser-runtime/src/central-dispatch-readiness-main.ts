import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LocalChromeDevToolsRuntime } from "./central-dispatch-cdp-executor.js";
import { checkCentralDispatchReadiness } from "./central-dispatch-readiness.js";
import { getCentralDispatchWorkerRuntimeConfig } from "./central-dispatch-worker-main.js";

/** Runs a safe local preflight before starting the Central Dispatch worker. */
export async function runCentralDispatchReadinessCheck(): Promise<void> {
  const config = getCentralDispatchWorkerRuntimeConfig();
  const result = await checkCentralDispatchReadiness(
    new LocalChromeDevToolsRuntime(config.chromeDevToolsEndpoint, config.requestTimeoutMs)
  );
  if (result.status === "ready") {
    console.info("Central Dispatch readiness check passed: authenticated page detected through local Chrome.");
    return;
  }
  throw new Error("Central Dispatch readiness check failed; authenticated page is not reachable.");
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  void runCentralDispatchReadinessCheck().catch(() => {
    console.error("Central Dispatch readiness check failed; inspect local Chrome availability and worker configuration.");
    process.exitCode = 1;
  });
}
