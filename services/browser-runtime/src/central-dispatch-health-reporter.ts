import type { CentralDispatchRuntimeCycleResult } from "./central-dispatch-runtime-cycle.js";

export type CentralDispatchHealthLogger = (message: string) => void;

/** Logs a Central Dispatch session transition once, rather than once per poll. */
export class CentralDispatchHealthReporter {
  private previousStatus: CentralDispatchRuntimeCycleResult["health"]["status"] | undefined;
  private readonly overflowRiskTabs = new Set<string>();

  public constructor(private readonly log: CentralDispatchHealthLogger) {}

  public report(result: CentralDispatchRuntimeCycleResult): void {
    const { health } = result;
    if (this.previousStatus !== health.status) {
      this.previousStatus = health.status;
      if (health.status === "healthy") {
        this.log("Central Dispatch browser session is healthy.");
      } else {
        this.log(`Central Dispatch browser session is offline: ${health.error?.message ?? "page unavailable"}`);
      }
    }
    this.reportOverflowRisk(result);
  }

  private reportOverflowRisk(result: CentralDispatchRuntimeCycleResult): void {
    for (const outcome of result.outcomes) {
      if (outcome.status !== "processed") continue;
      if (!outcome.result.overflowRisk) {
        this.overflowRiskTabs.delete(outcome.tab.id);
        continue;
      }
      if (this.overflowRiskTabs.has(outcome.tab.id)) continue;
      this.overflowRiskTabs.add(outcome.tab.id);
      this.log(`Central Dispatch tab ${outcome.tab.id} reached the provider result capacity; accelerated polling is active and this bucket needs splitting.`);
    }
  }
}
