import { renderNewLoadNotification } from "@haulalert/telegram-notification";

import type { NewLoadDeliveryOptions, TelegramTransport } from "./index.js";
import type {
  ClaimedNotificationDelivery,
  DurableNotificationDeliveryRepository
} from "./postgres-notification-delivery-repository.js";
import { TelegramRateLimitError } from "./telegram-bot-api-transport.js";

export interface DurableWorkerRetryPolicy {
  readonly maximumAttempts: number;
  readonly initialRetryDelayMs: number;
  readonly claimLeaseDurationMs: number;
}

export interface DurableWorkerOptions {
  readonly now?: Date;
  readonly getLoadDetailsUrl?: (delivery: ClaimedNotificationDelivery) => string | undefined;
}

export type DurableWorkerOutcome =
  | { readonly status: "sent"; readonly deliveryId: string }
  | { readonly status: "retry-scheduled"; readonly deliveryId: string; readonly nextAttemptAt: Date }
  | { readonly status: "dead-letter"; readonly deliveryId: string }
  | { readonly status: "lost-claim"; readonly deliveryId: string };

const defaultRetryPolicy: DurableWorkerRetryPolicy = {
  maximumAttempts: 3,
  initialRetryDelayMs: 5_000,
  claimLeaseDurationMs: 300_000
};

/** Runs durable PostgreSQL delivery jobs without re-sending a lost claim. */
export class PostgresNotificationWorker {
  private readonly retryPolicy: DurableWorkerRetryPolicy;

  public constructor(
    private readonly repository: DurableNotificationDeliveryRepository,
    private readonly transport: TelegramTransport,
    retryPolicy: Partial<DurableWorkerRetryPolicy> = {}
  ) {
    this.retryPolicy = { ...defaultRetryPolicy, ...retryPolicy };
    if (!Number.isInteger(this.retryPolicy.maximumAttempts) || this.retryPolicy.maximumAttempts < 1) {
      throw new Error("maximumAttempts must be a positive integer");
    }
    if (!Number.isFinite(this.retryPolicy.initialRetryDelayMs) || this.retryPolicy.initialRetryDelayMs < 0) {
      throw new Error("initialRetryDelayMs must be a non-negative number");
    }
    if (!Number.isFinite(this.retryPolicy.claimLeaseDurationMs) || this.retryPolicy.claimLeaseDurationMs < 1) {
      throw new Error("claimLeaseDurationMs must be a positive number");
    }
  }

  public async processBatch(
    limit: number,
    options: DurableWorkerOptions = {}
  ): Promise<readonly DurableWorkerOutcome[]> {
    const now = options.now ?? new Date();
    await this.repository.reclaimExpiredClaims(
      this.retryPolicy.claimLeaseDurationMs,
      this.retryPolicy.maximumAttempts,
      now
    );
    const deliveries = await this.repository.claimDue(limit, now);
    const outcomes: DurableWorkerOutcome[] = [];

    for (const delivery of deliveries) {
      const sent = await this.send(delivery, options);
      if (sent instanceof Error) {
        outcomes.push(await this.handleFailure(delivery, sent, now));
        continue;
      }

      const markedSent = await this.repository.markSent(delivery.deliveryId, null, now);
      outcomes.push(markedSent
        ? { status: "sent", deliveryId: delivery.deliveryId }
        : { status: "lost-claim", deliveryId: delivery.deliveryId });
    }

    return outcomes;
  }

  private async send(
    delivery: ClaimedNotificationDelivery,
    options: DurableWorkerOptions
  ): Promise<void | Error> {
    try {
      const loadDetailsUrl = options.getLoadDetailsUrl?.(delivery);
      const notificationOptions: NewLoadDeliveryOptions = {
        muteAlertCallbackData: `mute:${delivery.match.alertId}`,
        ...(loadDetailsUrl === undefined ? {} : { loadDetailsUrl })
      };
      await this.transport.send({
        recipientId: delivery.match.telegramChatId,
        notification: renderNewLoadNotification(delivery.match, notificationOptions)
      });
    } catch (cause) {
      return cause instanceof Error ? cause : new Error("Unknown Telegram delivery failure");
    }
  }

  private async handleFailure(
    delivery: ClaimedNotificationDelivery,
    error: Error,
    now: Date
  ): Promise<DurableWorkerOutcome> {
    const attempts = delivery.attemptCount + 1;
    if (attempts >= this.retryPolicy.maximumAttempts) {
      const markedDeadLetter = await this.repository.markDeadLetter(delivery.deliveryId, error.message, now);
      return markedDeadLetter
        ? { status: "dead-letter", deliveryId: delivery.deliveryId }
        : { status: "lost-claim", deliveryId: delivery.deliveryId };
    }

    const retryDelay = Math.max(
      this.retryPolicy.initialRetryDelayMs * 2 ** (attempts - 1),
      error instanceof TelegramRateLimitError ? error.retryAfterMs : 0
    );
    const nextAttemptAt = new Date(now.getTime() + retryDelay);
    const scheduled = await this.repository.scheduleRetry(
      delivery.deliveryId,
      error.message,
      nextAttemptAt,
      now
    );
    return scheduled
      ? { status: "retry-scheduled", deliveryId: delivery.deliveryId, nextAttemptAt }
      : { status: "lost-claim", deliveryId: delivery.deliveryId };
  }
}
