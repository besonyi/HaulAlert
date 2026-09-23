import type { AlertMatch } from "@haulalert/alert-matcher";
import { getGlobalLoadKey } from "@haulalert/load-model";
import {
  renderNewLoadNotification,
  type NewLoadNotification
} from "@haulalert/telegram-notification";

export interface NotificationDeliveryStore {
  has(deliveryKey: string): boolean;
  record(deliveryKey: string): void;
}

export class InMemoryNotificationDeliveryStore implements NotificationDeliveryStore {
  private readonly deliveryKeys = new Set<string>();

  public has(deliveryKey: string): boolean {
    return this.deliveryKeys.has(deliveryKey);
  }

  public record(deliveryKey: string): void {
    this.deliveryKeys.add(deliveryKey);
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
  | { readonly status: "duplicate"; readonly deliveryKey: string };

/** Delivers each matching new load at most once per user and alert. */
export class NotificationService {
  public constructor(
    private readonly transport: TelegramTransport,
    private readonly deliveryStore: NotificationDeliveryStore
  ) {}

  public async deliverNewLoad(
    match: AlertMatch,
    options: { readonly loadDetailsUrl?: string } = {}
  ): Promise<DeliveryResult> {
    const deliveryKey = getDeliveryKey(match);
    if (this.deliveryStore.has(deliveryKey)) {
      return { status: "duplicate", deliveryKey };
    }

    await this.transport.send({
      recipientId: match.userId,
      notification: renderNewLoadNotification(match, options)
    });
    this.deliveryStore.record(deliveryKey);
    return { status: "sent", deliveryKey };
  }
}

export function getDeliveryKey(match: AlertMatch): string {
  return `${getGlobalLoadKey(match.load)}:${match.alertId}:${match.userId}`;
}
