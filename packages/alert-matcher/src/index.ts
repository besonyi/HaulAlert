import type { CanonicalFilter, LocationConstraint } from "@haulalert/canonical-filter";
import type { LoadLocation, NormalizedLoad } from "@haulalert/load-model";

export type MatchFailure =
  | "provider"
  | "origin"
  | "destination"
  | "trailer"
  | "vehicle-count"
  | "readiness"
  | "minimum-pay"
  | "minimum-rate"
  | "blocked-broker";

export interface AlertMatchResult {
  readonly matches: boolean;
  readonly failures: readonly MatchFailure[];
}

export interface AlertSubscription {
  readonly alertId: string;
  readonly userId: string;
  readonly filter: CanonicalFilter;
}

export interface AlertMatch {
  readonly alertId: string;
  readonly userId: string;
  readonly load: NormalizedLoad;
}

/**
 * Narrows each new load to subscriptions that selected its provider before
 * evaluating the remaining customer-visible predicates.
 */
export class AlertCandidateIndex {
  private readonly subscriptionsByAlertId = new Map<string, AlertSubscription>();
  private readonly alertIdsByProvider = new Map<NormalizedLoad["provider"], Set<string>>();

  public upsert(subscription: AlertSubscription): void {
    this.remove(subscription.alertId);
    this.subscriptionsByAlertId.set(subscription.alertId, subscription);

    for (const provider of subscription.filter.providers) {
      const alertIds = this.alertIdsByProvider.get(provider) ?? new Set<string>();
      alertIds.add(subscription.alertId);
      this.alertIdsByProvider.set(provider, alertIds);
    }
  }

  public remove(alertId: string): void {
    const subscription = this.subscriptionsByAlertId.get(alertId);
    if (subscription === undefined) return;

    this.subscriptionsByAlertId.delete(alertId);
    for (const provider of subscription.filter.providers) {
      const alertIds = this.alertIdsByProvider.get(provider);
      if (alertIds === undefined) continue;

      alertIds.delete(alertId);
      if (alertIds.size === 0) this.alertIdsByProvider.delete(provider);
    }
  }

  public findCandidates(load: NormalizedLoad): readonly AlertSubscription[] {
    const alertIds = this.alertIdsByProvider.get(load.provider);
    if (alertIds === undefined) return [];

    return [...alertIds]
      .sort()
      .flatMap((alertId) => {
        const subscription = this.subscriptionsByAlertId.get(alertId);
        return subscription === undefined ? [] : [subscription];
      });
  }

  public findMatches(load: NormalizedLoad, now: Date = new Date()): readonly AlertMatch[] {
    return findMatchingAlerts(load, this.findCandidates(load), now);
  }
}

/** Applies every customer-visible condition to one normalized load. */
export function matchLoadToFilter(
  load: NormalizedLoad,
  filter: CanonicalFilter,
  now: Date = new Date()
): AlertMatchResult {
  const failures: MatchFailure[] = [];

  if (!filter.providers.includes(load.provider)) failures.push("provider");
  if (!matchesAnyLocation(load.pickup, filter.origins)) failures.push("origin");
  if (!matchesAnyLocation(load.delivery, filter.destinations)) failures.push("destination");
  if (!filter.trailerTypes.includes(load.trailerType as "open" | "enclosed")) failures.push("trailer");
  if (!matchesVehicleCount(load.vehicleCount, filter.vehicles)) failures.push("vehicle-count");
  if (!matchesReadiness(load.readyAt, filter.readiness, now)) failures.push("readiness");
  if (filter.minimumPayUsd !== null && (load.payUsd === null || load.payUsd < filter.minimumPayUsd)) {
    failures.push("minimum-pay");
  }
  if (
    filter.minimumRatePerMile !== null
    && (load.ratePerMile === null || load.ratePerMile < filter.minimumRatePerMile)
  ) {
    failures.push("minimum-rate");
  }
  if (isBlockedBroker(load, filter.blockedBrokerIds)) failures.push("blocked-broker");

  return { matches: failures.length === 0, failures };
}

/** Fans one new-load event out to the users whose active alerts fully match it. */
export function findMatchingAlerts(
  load: NormalizedLoad,
  subscriptions: readonly AlertSubscription[],
  now: Date = new Date()
): readonly AlertMatch[] {
  return subscriptions.flatMap((subscription) => {
    const result = matchLoadToFilter(load, subscription.filter, now);
    return result.matches
      ? [{ alertId: subscription.alertId, userId: subscription.userId, load }]
      : [];
  });
}

function matchesAnyLocation(location: LoadLocation, constraints: readonly LocationConstraint[]): boolean {
  return constraints.some((constraint) => matchesLocation(location, constraint));
}

function matchesLocation(location: LoadLocation, constraint: LocationConstraint): boolean {
  if (constraint.kind === "anywhere") return true;
  if (constraint.kind === "state") return location.state?.toUpperCase() === constraint.state;

  if (location.coordinates !== null) {
    return distanceMiles(location.coordinates, constraint.coordinates) <= constraint.radiusMiles;
  }

  // Without coordinates, only an exact city/state match is safe to treat as a match.
  return location.city?.trim().toLowerCase() === constraint.city.trim().toLowerCase()
    && location.state?.toUpperCase() === constraint.state;
}

function matchesVehicleCount(
  vehicleCount: number,
  bounds: CanonicalFilter["vehicles"]
): boolean {
  return (bounds.minimum === null || vehicleCount >= bounds.minimum)
    && (bounds.maximum === null || vehicleCount <= bounds.maximum);
}

function matchesReadiness(
  readyAt: string | null,
  readiness: CanonicalFilter["readiness"],
  now: Date
): boolean {
  if (readiness.kind === "any") return true;
  if (readyAt === null) return false;

  const readyDate = readyAt.slice(0, 10);
  if (readiness.kind === "date-range") {
    return readyDate >= readiness.availableFrom && readyDate <= readiness.availableUntil;
  }

  const today = isoDate(now);
  const tomorrow = isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)));
  return readiness.kind === "today" ? readyDate === today : readyDate === tomorrow;
}

function isBlockedBroker(load: NormalizedLoad, blockedBrokerIds: readonly string[]): boolean {
  const broker = load.broker;
  if (broker === null) return false;

  const identities = [
    broker.mcNumber === null ? null : `mc:${broker.mcNumber.toLowerCase()}`,
    broker.dotNumber === null ? null : `dot:${broker.dotNumber.toLowerCase()}`,
    `name:${broker.name.trim().toLowerCase()}`
  ].filter((identity): identity is string => identity !== null);

  return identities.some((identity) => blockedBrokerIds.includes(identity));
}

function distanceMiles(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number }
): number {
  const earthRadiusMiles = 3958.7613;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(left.latitude))
      * Math.cos(toRadians(right.latitude))
      * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMiles * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export { AlertIndex } from "./alert-index.js";
