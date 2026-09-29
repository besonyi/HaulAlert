import type {
  CentralDispatchRuntimeCycleResult,
  CentralDispatchRuntimeCycleRunner
} from "./central-dispatch-runtime-cycle.js";

export interface CentralDispatchPollingWorkerOptions {
  /** Maximum number of due searches to handle during one provider cycle. */
  readonly batchSize?: number;
  /** Delay between scheduled cycles. Must be a positive integer. */
  readonly pollIntervalMs?: number;
  /** Consecutive failed cycles allowed before provider calls are paused. */
  readonly circuitBreakerFailureThreshold?: number;
  /** Duration to pause provider calls after the circuit opens. */
  readonly circuitBreakerCooldownMs?: number;
  readonly clock?: () => Date;
  readonly onCycleError?: (error: Error) => void;
  readonly onCircuitOpen?: (retryAt: Date) => void;
  readonly onCycleComplete?: (result: CentralDispatchRuntimeCycleResult) => void;
}

export class CentralDispatchCircuitOpenError extends Error {
  public constructor(readonly retryAt: Date) {
    super("Central Dispatch circuit is open");
  }
}

/**
 * Schedules Central Dispatch scans without overlapping provider requests.
 * Concurrent callers share the in-flight cycle, preserving a single active
 * request even when a response takes longer than the polling interval.
 */
export class CentralDispatchPollingWorker {
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly circuitBreakerFailureThreshold: number;
  private readonly circuitBreakerCooldownMs: number;
  private readonly clock: () => Date;
  private readonly onCycleError: (error: Error) => void;
  private readonly onCircuitOpen: (retryAt: Date) => void;
  private readonly onCycleComplete: (result: CentralDispatchRuntimeCycleResult) => void;
  private activeCycle: Promise<CentralDispatchRuntimeCycleResult> | undefined;
  private consecutiveFailures = 0;
  private circuitOpenUntil: Date | undefined;

  public constructor(
    private readonly cycle: CentralDispatchRuntimeCycleRunner,
    options: CentralDispatchPollingWorkerOptions = {}
  ) {
    this.batchSize = getPositiveInteger(options.batchSize, 1, "batchSize");
    this.pollIntervalMs = getPositiveInteger(options.pollIntervalMs, 30_000, "pollIntervalMs");
    this.circuitBreakerFailureThreshold = getPositiveInteger(
      options.circuitBreakerFailureThreshold,
      3,
      "circuitBreakerFailureThreshold"
    );
    this.circuitBreakerCooldownMs = getPositiveInteger(
      options.circuitBreakerCooldownMs,
      60_000,
      "circuitBreakerCooldownMs"
    );
    this.clock = options.clock ?? (() => new Date());
    this.onCycleError = options.onCycleError ?? (() => undefined);
    this.onCircuitOpen = options.onCircuitOpen ?? (() => undefined);
    this.onCycleComplete = options.onCycleComplete ?? (() => undefined);
  }

  /** Executes one cycle, or joins an already-running cycle. */
  public processOnce(now: Date = this.clock()): Promise<CentralDispatchRuntimeCycleResult> {
    if (this.activeCycle !== undefined) return this.activeCycle;
    if (this.circuitOpenUntil !== undefined && now < this.circuitOpenUntil) {
      return Promise.reject(new CentralDispatchCircuitOpenError(this.circuitOpenUntil));
    }

    const cycle = this.cycle.processDue(this.batchSize, now)
      .then((result) => {
        this.consecutiveFailures = 0;
        this.circuitOpenUntil = undefined;
        try {
          this.onCycleComplete(result);
        } catch (cause) {
          this.onCycleError(toError(cause));
        }
        return result;
      })
      .catch((cause: unknown) => {
        this.recordFailure(now);
        throw cause;
      });
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
        if (cause instanceof CentralDispatchCircuitOpenError) return;
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

  private recordFailure(now: Date): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures < this.circuitBreakerFailureThreshold) return;
    const retryAt = new Date(now.getTime() + this.circuitBreakerCooldownMs);
    this.circuitOpenUntil = retryAt;
    this.onCircuitOpen(retryAt);
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
