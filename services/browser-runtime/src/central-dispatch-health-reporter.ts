import type { CentralDispatchRuntimeCycleResult } from "./central-dispatch-runtime-cycle.js";

export type CentralDispatchHealthLogger = (message: string) => void;

/** Logs a Central Dispatch session transition once, rather than once per poll. */
export class CentralDispatchHealthReporter {
  private previousStatus: CentralDispatchRuntimeCycleResult["health"]["status"] | undefined;

  public constructor(private readonly log: CentralDispatchHealthLogger) {}

  public report(result: CentralDispatchRuntimeCycleResult): void {
    const { health } = result;
    if (this.previousStatus === health.status) return;
    this.previousStatus = health.status;
    if (health.status === "healthy") {
      this.log("Central Dispatch browser session is healthy.");
      return;
    }
    this.log(`Central Dispatch browser session is offline: ${health.error?.message ?? "page unavailable"}`);
  }
}
