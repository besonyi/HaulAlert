import type { RuntimeScanOutcome, BrowserScanCoordinator } from "./index.js";
import type { DurableBrowserRuntimeController } from "./durable-runtime-controller.js";
import {
  CentralDispatchSessionMonitor,
  type CentralDispatchSessionProbeResult
} from "./central-dispatch-session-monitor.js";

export interface CentralDispatchRuntimeCycleResult {
  readonly health: CentralDispatchSessionProbeResult;
  readonly outcomes: readonly RuntimeScanOutcome[];
}

/** The small runtime boundary used by the scheduled Central Dispatch worker. */
export interface CentralDispatchRuntimeCycleRunner {
  processDue(limit: number, now?: Date): Promise<CentralDispatchRuntimeCycleResult>;
}

export interface CentralDispatchRuntimeCycleOptions {
  /** Refreshes durable provider searches after a healthy session check, before scanning. */
  readonly beforeScan?: () => Promise<void>;
}

/**
 * Runs one Central Dispatch health-and-scan cycle. A missing browser tab never
 * falls through to a scan, avoiding stale or unauthenticated provider calls.
 */
export class CentralDispatchRuntimeCycle implements CentralDispatchRuntimeCycleRunner {
  public constructor(
    private readonly sessionMonitor: CentralDispatchSessionMonitor,
    private readonly durableRuntime: DurableBrowserRuntimeController,
    private readonly scanCoordinator: BrowserScanCoordinator,
    private readonly options: CentralDispatchRuntimeCycleOptions = {}
  ) {}

  public async processDue(limit: number, now?: Date): Promise<CentralDispatchRuntimeCycleResult> {
    const health = await this.sessionMonitor.probe();
    if (health.status === "offline") return { health, outcomes: [] };
    await this.options.beforeScan?.();
    return {
      health,
      outcomes: await this.durableRuntime.processDue(this.scanCoordinator, limit, now)
    };
  }
}
