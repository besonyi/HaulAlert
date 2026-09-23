import {
  AlertCandidateIndex,
  type AlertMatch,
  type AlertMatchResult,
  type AlertSubscription,
  type MatchFailure
} from "@haulalert/alert-matcher";
import type { NormalizedLoad } from "@haulalert/load-model";
import {
  NotificationService,
  type DeliveryResult
} from "@haulalert/notification-service";

export { AlertCandidateIndex, findMatchingAlerts, matchLoadToFilter } from "@haulalert/alert-matcher";
export type { AlertMatch, AlertMatchResult, AlertSubscription, MatchFailure } from "@haulalert/alert-matcher";
export {
  PostgresAlertSubscriptionSource,
  RefreshingAlertCandidateIndex,
  type ActiveAlertSubscriptionSource
} from "./postgres-alert-subscription-source.js";

export interface LoadProcessingOptions {
  readonly now?: Date;
  readonly getLoadDetailsUrl?: (match: AlertMatch) => string | undefined;
}

export type DeliveryAttempt =
  | { readonly status: "delivered"; readonly match: AlertMatch; readonly result: DeliveryResult }
  | { readonly status: "failed"; readonly match: AlertMatch; readonly error: Error };

export interface LoadProcessingResult {
  readonly load: NormalizedLoad;
  readonly matches: readonly AlertMatch[];
  readonly deliveries: readonly DeliveryAttempt[];
}

/**
 * Service boundary for the trusted new-load event path. A delivery failure for
 * one customer is retained as an outcome and cannot suppress other matches.
 */
export class LoadMatchProcessor {
  public constructor(
    private readonly alertIndex: AlertCandidateIndex,
    private readonly notifications: NotificationService
  ) {}

  public async process(
    load: NormalizedLoad,
    options: LoadProcessingOptions = {}
  ): Promise<LoadProcessingResult> {
    const matches = this.alertIndex.findMatches(load, options.now);
    const deliveries = await Promise.all(matches.map(async (match): Promise<DeliveryAttempt> => {
      try {
        const loadDetailsUrl = options.getLoadDetailsUrl?.(match);
        const result = await this.notifications.deliverNewLoad(
          match,
          loadDetailsUrl === undefined ? {} : { loadDetailsUrl }
        );
        return { status: "delivered", match, result };
      } catch (error) {
        return {
          status: "failed",
          match,
          error: error instanceof Error ? error : new Error("Unknown notification delivery failure")
        };
      }
    }));

    return { load, matches, deliveries };
  }
}
