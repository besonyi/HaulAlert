import type {
  CentralDispatchRuntimeCycleResult,
  CentralDispatchRuntimeCycleRunner
} from "./central-dispatch-runtime-cycle.js";

export interface CentralDispatchPollingWorkerOptions {
  /** Maximum number of due searches to handle during one provider cycle. */
  readonly batchSize?: number;
  /** Delay between scheduled cycles. Must be a positive integer. */
  readonly pollIntervalMs?: number;
  readonly clock?: () => Date;
  readonly onCycleError?: (error: Error) => void;
}

/**
 * Schedules Central Dispatch scans without overlapping provider requests.
 * Concurrent callers share the in-flight cycle, preserving a single active
 * request even when a response takes longer than the polling interval.
 */
export class CentralDispatchPollingWorker {
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly clock: () => Date;
  private readonly onCycleError: (error: Error) => void;
  private activeCycle: Promise<CentralDispatchRuntimeCycleResult> | undefined;

  public constructor(
    private readonly cycle: CentralDispatchRuntimeCycleRunner,
    options: CentralDispatchPollingWorkerOptions = {}
  ) {
    this.batchSize = getPositiveInteger(options.batchSize, 1, "batchSize");
    this.pollIntervalMs = getPositiveInteger(options.pollIntervalMs, 30_000, "pollIntervalMs");
    this.clock = options.clock ?? (() => new Date());
    this.onCycleError = options.onCycleError ?? (() => undefined);
  }

  /** Executes one cycle, or joins an already-running cycle. */
  public processOnce(now: Date = this.clock()): Promise<CentralDispatchRuntimeCycleResult> {
    if (this.activeCycle !== undefined) return this.activeCycle;

    const cycle = this.cycle.processDue(this.batchSize, now);
    this.activeCycle = cycle.finally(() => {
      this.activeCycle = undefined;
    });
    return this.activeCycle;
  }

  /** Runs scheduled cycles until the process receives SIGINT or SIGTERM. */
  public async run(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const runCycle = async (): Promise<void> => {
      try {
        await this.processOnce();
      } catch (cause) {
        this.onCycleError(toError(cause));
      }
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
        timer = setInterval(() => { void runCycle(); }, this.pollIntervalMs);
      });
      await this.activeCycle;
    } finally {
      if (timer !== undefined) clearInterval(timer);
    }
  }
}

function getPositiveInteger(value: number | undefined, fallback: number, optionName: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return value;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error("Unknown Central Dispatch polling failure");
}
