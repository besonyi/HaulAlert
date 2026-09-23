import type { NormalizedLoad } from "@haulalert/load-model";

import {
  findMatchingAlerts,
  type AlertMatch,
  type AlertSubscription
} from "./index.js";

type MatchableTrailerType = "open" | "enclosed";

/**
 * A lossless coarse index for active alerts. It only excludes subscriptions
 * that cannot match a load's provider or trailer type; all other predicates
 * remain in the exact matcher.
 */
export class AlertIndex {
  private readonly subscriptions = new Map<string, AlertSubscription>();
  private readonly subscriptionBuckets = new Map<string, readonly string[]>();
  private readonly bucketAlertIds = new Map<string, Set<string>>();

  public upsert(subscription: AlertSubscription): void {
    this.remove(subscription.alertId);

    const buckets = getBuckets(subscription);
    this.subscriptions.set(subscription.alertId, subscription);
    this.subscriptionBuckets.set(subscription.alertId, buckets);
    for (const bucket of buckets) {
      const alertIds = this.bucketAlertIds.get(bucket) ?? new Set<string>();
      alertIds.add(subscription.alertId);
      this.bucketAlertIds.set(bucket, alertIds);
    }
  }

  public remove(alertId: string): boolean {
    const buckets = this.subscriptionBuckets.get(alertId);
    if (buckets === undefined) return false;

    for (const bucket of buckets) {
      const alertIds = this.bucketAlertIds.get(bucket);
      if (alertIds === undefined) continue;

      alertIds.delete(alertId);
      if (alertIds.size === 0) this.bucketAlertIds.delete(bucket);
    }

    this.subscriptionBuckets.delete(alertId);
    return this.subscriptions.delete(alertId);
  }

  public candidatesFor(load: NormalizedLoad): readonly AlertSubscription[] {
    if (!isMatchableTrailerType(load.trailerType)) return [];

    const alertIds = this.bucketAlertIds.get(bucketKey(load.provider, load.trailerType));
    if (alertIds === undefined) return [];

    return [...alertIds].flatMap((alertId) => {
      const subscription = this.subscriptions.get(alertId);
      return subscription === undefined ? [] : [subscription];
    });
  }

  public findMatches(load: NormalizedLoad, now: Date = new Date()): readonly AlertMatch[] {
    return findMatchingAlerts(load, this.candidatesFor(load), now);
  }

  public get size(): number {
    return this.subscriptions.size;
  }
}

function getBuckets(subscription: AlertSubscription): readonly string[] {
  return subscription.filter.providers.flatMap((provider) => (
    subscription.filter.trailerTypes.map((trailerType) => bucketKey(provider, trailerType))
  ));
}

function bucketKey(provider: NormalizedLoad["provider"], trailerType: MatchableTrailerType): string {
  return `${provider}:${trailerType}`;
}

function isMatchableTrailerType(value: NormalizedLoad["trailerType"]): value is MatchableTrailerType {
  return value === "open" || value === "enclosed";
}
