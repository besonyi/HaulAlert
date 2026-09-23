import type { AlertMatch } from "@haulalert/alert-matcher";
import { getGlobalLoadKey } from "@haulalert/load-model";
import {
  renderNewLoadNotification,
  type NewLoadNotification
} from "@haulalert/telegram-notification";

export interface NotificationDeliveryStore {
  tryReserve(deliveryKey: string): DeliveryReservation;
  confirm(deliveryKey: string): void;
  release(deliveryKey: string): void;
}

export type DeliveryReservation = "reserved" | "duplicate" | "in-flight";

export class InMemoryNotificationDeliveryStore implements NotificationDeliveryStore {
  private readonly deliveredKeys = new Set<string>();
  private readonly reservedKeys = new Set<string>();

  public tryReserve(deliveryKey: string): DeliveryReservation {
    if (this.deliveredKeys.has(deliveryKey)) return "duplicate";
    if (this.reservedKeys.has(deliveryKey)) return "in-flight";

    this.reservedKeys.add(deliveryKey);
    return "reserved";
  }

  public confirm(deliveryKey: string): void {
    this.reservedKeys.delete(deliveryKey);
    this.deliveredKeys.add(deliveryKey);
  }

  public release(deliveryKey: string): void {
    this.reservedKeys.delete(deliveryKey);
  }
}

export interface TelegramTransport {
  send(input: {
    readonly recipientId: string;
    readonly notification: NewLoadNotification;
  }): Promise<void>;
}

export type DeliveryResult =
  | { readonly status: "sent"; readonly deliveryKey: string }
  | { readonly status: "duplicate"; readonly deliveryKey: string }
  | { readonly status: "in-flight"; readonly deliveryKey: string };

export interface NewLoadDeliveryOptions {
  readonly loadDetailsUrl?: string;
}

/** Delivers each matching new load at most once per user and alert. */
export class NotificationService {
  public constructor(
    private readonly transport: TelegramTransport,
    private readonly deliveryStore: NotificationDeliveryStore
  ) {}

  public async deliverNewLoad(
    match: AlertMatch,
    options: NewLoadDeliveryOptions = {}
  ): Promise<DeliveryResult> {
    const deliveryKey = getDeliveryKey(match);
    const reservation = this.deliveryStore.tryReserve(deliveryKey);
    if (reservation !== "reserved") {
      return { status: reservation, deliveryKey };
    }

    try {
      await this.transport.send({
        recipientId: match.telegramChatId,
        notification: renderNewLoadNotification(match, options)
      });
      this.deliveryStore.confirm(deliveryKey);
      return { status: "sent", deliveryKey };
    } catch (error) {
      this.deliveryStore.release(deliveryKey);
      throw error;
    }
  }
}

export function getDeliveryKey(match: AlertMatch): string {
  return `${getGlobalLoadKey(match.load)}:${match.alertId}:${match.userId}`;
}

export {
  getTelegramBotToken,
  TelegramBotApiTransport,
  TelegramRateLimitError
} from "./telegram-bot-api-transport.js";
export {
  InMemoryNotificationDeliveryQueue,
  type DeliveryQueueOutcome,
  type NotificationRetryPolicy
} from "./notification-delivery-queue.js";
export {
  PostgresNotificationDeliveryRepository,
  type ClaimedNotificationDelivery,
  type DurableNotificationDeliveryRepository,
  type SqlExecutor
} from "./postgres-notification-delivery-repository.js";
export {
  PostgresNotificationWorker,
  type DurableWorkerOptions,
  type DurableWorkerOutcome,
  type DurableWorkerRetryPolicy
} from "./postgres-notification-worker.js";
export { getDatabaseUrl, PgPoolSqlExecutor } from "./pg-pool-sql-executor.js";
