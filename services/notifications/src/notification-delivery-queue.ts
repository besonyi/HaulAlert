import type { AlertMatch } from "@haulalert/alert-matcher";

import {
  getDeliveryKey,
  type DeliveryResult,
  type NewLoadDeliveryOptions,
  NotificationService
} from "./index.js";
import { TelegramRateLimitError } from "./telegram-bot-api-transport.js";

export interface NotificationRetryPolicy {
  /** Includes the first failed delivery attempt before a job becomes dead letter. */
  readonly maximumAttempts: number;
  readonly initialRetryDelayMs: number;
}

export type DeliveryQueueOutcome =
  | { readonly status: "completed"; readonly deliveryKey: string; readonly result: DeliveryResult }
  | { readonly status: "deferred"; readonly deliveryKey: string; readonly nextAttemptAt: Date }
  | {
      readonly status: "retry-scheduled";
      readonly deliveryKey: string;
      readonly attempt: number;
      readonly nextAttemptAt: Date;
      readonly error: Error;
    }
  | { readonly status: "dead-letter"; readonly deliveryKey: string; readonly attempts: number; readonly error: Error };

interface QueuedDelivery {
  readonly deliveryKey: string;
  readonly match: AlertMatch;
  readonly options: NewLoadDeliveryOptions;
  readonly attempts: number;
  readonly nextAttemptAt: Date;
}

const defaultRetryPolicy: NotificationRetryPolicy = {
  maximumAttempts: 3,
  initialRetryDelayMs: 5_000
};

/**
 * Deterministic in-memory queue used by the service runtime and tests. Its
 * interface keeps retry and dead-letter behavior explicit for a future durable
 * queue implementation.
 */
export class InMemoryNotificationDeliveryQueue {
  private readonly jobsByKey = new Map<string, QueuedDelivery>();
  private readonly deadLettersByKey = new Map<string, DeliveryQueueOutcome>();
  private readonly retryPolicy: NotificationRetryPolicy;

  public constructor(
    private readonly notifications: NotificationService,
    retryPolicy: Partial<NotificationRetryPolicy> = {}
  ) {
    this.retryPolicy = { ...defaultRetryPolicy, ...retryPolicy };
    if (!Number.isInteger(this.retryPolicy.maximumAttempts) || this.retryPolicy.maximumAttempts < 1) {
      throw new Error("maximumAttempts must be a positive integer");
    }
    if (!Number.isFinite(this.retryPolicy.initialRetryDelayMs) || this.retryPolicy.initialRetryDelayMs < 0) {
      throw new Error("initialRetryDelayMs must be a non-negative number");
    }
  }

  public enqueue(match: AlertMatch, options: NewLoadDeliveryOptions = {}, now: Date = new Date()): boolean {
    const deliveryKey = getDeliveryKey(match);
    if (this.jobsByKey.has(deliveryKey) || this.deadLettersByKey.has(deliveryKey)) return false;

    this.jobsByKey.set(deliveryKey, {
      deliveryKey,
      match,
      options,
      attempts: 0,
      nextAttemptAt: new Date(now)
    });
    return true;
  }

  public get size(): number {
    return this.jobsByKey.size;
  }

  public get deadLetters(): readonly DeliveryQueueOutcome[] {
    return [...this.deadLettersByKey.values()];
  }

  public async processDue(now: Date = new Date()): Promise<readonly DeliveryQueueOutcome[]> {
    const dueJobs = [...this.jobsByKey.values()]
      .filter((job) => job.nextAttemptAt <= now)
      .sort((left, right) => left.deliveryKey.localeCompare(right.deliveryKey));
    const outcomes: DeliveryQueueOutcome[] = [];

    for (const job of dueJobs) {
      try {
        const result = await this.notifications.deliverNewLoad(job.match, job.options);
        if (result.status === "in-flight") {
          const nextAttemptAt = new Date(now.getTime() + this.retryPolicy.initialRetryDelayMs);
          this.jobsByKey.set(job.deliveryKey, { ...job, nextAttemptAt });
          outcomes.push({ status: "deferred", deliveryKey: job.deliveryKey, nextAttemptAt });
          continue;
        }

        this.jobsByKey.delete(job.deliveryKey);
        outcomes.push({ status: "completed", deliveryKey: job.deliveryKey, result });
      } catch (cause) {
        const attempts = job.attempts + 1;
        const error = cause instanceof Error ? cause : new Error("Unknown notification delivery failure");
        if (attempts >= this.retryPolicy.maximumAttempts) {
          this.jobsByKey.delete(job.deliveryKey);
          const outcome: DeliveryQueueOutcome = {
            status: "dead-letter",
            deliveryKey: job.deliveryKey,
            attempts,
            error
          };
          this.deadLettersByKey.set(job.deliveryKey, outcome);
          outcomes.push(outcome);
          continue;
        }

        const nextAttemptAt = new Date(now.getTime() + Math.max(
          retryDelayMs(attempts, this.retryPolicy),
          error instanceof TelegramRateLimitError ? error.retryAfterMs : 0
        ));
        this.jobsByKey.set(job.deliveryKey, { ...job, attempts, nextAttemptAt });
        outcomes.push({ status: "retry-scheduled", deliveryKey: job.deliveryKey, attempt: attempts, nextAttemptAt, error });
      }
    }

    return outcomes;
  }
}

function retryDelayMs(attempt: number, retryPolicy: NotificationRetryPolicy): number {
  return retryPolicy.initialRetryDelayMs * 2 ** (attempt - 1);
}
