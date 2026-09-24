import {
  calculateRatePerMile,
  type LoadLocation,
  type NormalizedLoad,
  type TrailerType
} from "@haulalert/load-model";
import type { ProviderFilterCapabilities } from "@haulalert/filter-compiler";

/** Native-search capabilities verified against the session-backed Central flow. */
export const centralDispatchCapabilities: ProviderFilterCapabilities = {
  provider: "central-dispatch",
  sourceFilterFields: [
    "origins",
    "destinations",
    "trailerTypes",
    "readiness",
    "minimumPayUsd",
    "minimumRatePerMile"
  ],
  vehicleCountSupport: "range",
  newLoadDetectionStrategy: "tagged-top"
};

const centralDispatchSearchUrl = "https://app.centraldispatch.com/search";

/**
 * Converts a Central Dispatch session-search response into HaulAlert's
 * provider-neutral model. Invalid rows are ignored rather than poisoning a
 * complete scan; their raw payload stays inside the provider adapter.
 */
export function normalizeCentralDispatchSearchResponse(payload: unknown): readonly NormalizedLoad[] {
  const root = asRecord(payload);
  const items = Array.isArray(root?.items) ? root.items : [];
  return items.flatMap((item) => {
    const load = normalizeCentralDispatchListing(item);
    return load === undefined ? [] : [load];
  });
}

export function normalizeCentralDispatchListing(value: unknown): NormalizedLoad | undefined {
  const listing = asRecord(value);
  const providerLoadId = toIdentifier(listing?.id);
  if (listing === undefined || providerLoadId === undefined) return undefined;

  const origin = asRecord(listing.origin);
  const destination = asRecord(listing.destination);
  const price = asRecord(listing.price);
  const shipper = asRecord(listing.shipper);
  const payUsd = finiteNumber(price?.total);
  const distanceMiles = finitePositiveNumber(listing.distance);

  return {
    provider: "central-dispatch",
    providerLoadId,
    pickup: toLocation(origin),
    delivery: toLocation(destination),
    vehicleCount: getVehicleCount(listing),
    trailerType: toTrailerType(listing.trailerType ?? listing.trailer_type),
    payUsd,
    distanceMiles,
    ratePerMile: calculateRatePerMile(payUsd, distanceMiles),
    readyAt: toIsoDate(listing.availableDate),
    postedAt: toIsoDate(listing.createdDate),
    sourceUrl: centralDispatchSearchUrl,
    broker: toBroker(shipper)
  };
}

function toLocation(value: Record<string, unknown> | undefined): LoadLocation {
  const geoCode = asRecord(value?.geoCode);
  return {
    city: nonEmptyString(value?.city),
    state: toState(value?.state),
    postalCode: nonEmptyString(value?.zip),
    coordinates: toCoordinates(geoCode)
  };
}

function toCoordinates(value: Record<string, unknown> | undefined): LoadLocation["coordinates"] {
  const latitude = finiteScalar(value?.latitude);
  const longitude = finiteScalar(value?.longitude);
  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude };
}

function getVehicleCount(listing: Record<string, unknown>): number {
  const declared = finitePositiveInteger(listing.vehicleCount);
  if (declared !== null) return declared;

  const vehicles = Array.isArray(listing.vehicles) ? listing.vehicles : [];
  const count = vehicles.reduce((total, vehicle) => {
    const quantity = finitePositiveInteger(asRecord(vehicle)?.qty);
    return total + (quantity ?? 1);
  }, 0);
  return Math.max(count, 1);
}

function toTrailerType(value: unknown): TrailerType {
  if (typeof value !== "string") return "unknown";
  const normalized = value.toLowerCase();
  if (normalized.includes("enclos")) return "enclosed";
  if (normalized.includes("open")) return "open";
  return "unknown";
}

function toBroker(shipper: Record<string, unknown> | undefined): NormalizedLoad["broker"] {
  const name = nonEmptyString(shipper?.companyName);
  if (name === null) return null;
  return {
    name,
    mcNumber: nonEmptyString(shipper?.mcNumber),
    dotNumber: nonEmptyString(shipper?.dotNumber)
  };
}

function toIdentifier(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const normalized = nonEmptyString(value);
  return normalized === null ? undefined : normalized;
}

function toState(value: unknown): string | null {
  const state = nonEmptyString(value)?.toUpperCase();
  return state !== undefined && /^[A-Z]{2}$/.test(state) ? state : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  const number = finiteScalar(value);
  return number === null || number < 0 ? null : number;
}

function finiteScalar(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finitePositiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number === null || number <= 0 ? null : number;
}

function finitePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
