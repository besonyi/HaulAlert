import type { ProviderFilterCapabilities } from "@haulalert/filter-compiler";
import { calculateRatePerMile, type LoadLocation, type NormalizedLoad, type TrailerType } from "@haulalert/load-model";

export const superDispatchCapabilities: ProviderFilterCapabilities = {
  provider: "super-dispatch",
  sourceFilterFields: ["origins", "destinations"],
  vehicleCountSupport: "minimum-only",
  newLoadDetectionStrategy: "newest-first"
};

const superDispatchSearchUrl = "https://carrier.superdispatch.com/loadboard/loads";

/** Normalizes Super Dispatch's session-search data[].load response shape. */
export function normalizeSuperDispatchSearchResponse(payload: unknown): readonly NormalizedLoad[] {
  const root = record(payload);
  const entries = Array.isArray(root?.data) ? root.data : [];
  return entries.flatMap((entry) => {
    const load = normalizeSuperDispatchListing(entry);
    return load === undefined ? [] : [load];
  });
}

export function normalizeSuperDispatchListing(value: unknown): NormalizedLoad | undefined {
  const load = record(record(value)?.load);
  const providerLoadId = identifier(load?.guid) ?? identifier(load?.posting_guid) ?? identifier(load?.number);
  if (load === undefined || providerLoadId === undefined) return undefined;

  const pickup = record(load.pickup);
  const delivery = record(load.delivery);
  const vehicles = Array.isArray(load.vehicles) ? load.vehicles : [];
  const payUsd = nonNegative(load.price);
  const distanceMiles = metersToMiles(load.distance_meters);
  const requiresEnclosed = vehicles.some((vehicle) => record(vehicle)?.requires_enclosed_trailer === true);
  const shipper = record(load.shipper);

  return {
    provider: "super-dispatch",
    providerLoadId,
    pickup: location(record(pickup?.venue)),
    delivery: location(record(delivery?.venue)),
    vehicleCount: Math.max(vehicles.length, positiveInteger(load.vehicle_count) ?? 1),
    trailerType: requiresEnclosed ? "enclosed" : trailerType(load.transport_type ?? load.trailer_type),
    payUsd,
    distanceMiles,
    ratePerMile: calculateRatePerMile(payUsd, distanceMiles),
    readyAt: isoDate(pickup?.scheduled_at),
    postedAt: isoDate(load.posted_to_loadboard_at ?? load.created_at),
    sourceUrl: superDispatchSearchUrl,
    broker: broker(shipper)
  };
}

function location(venue: Record<string, unknown> | undefined): LoadLocation {
  return {
    city: text(venue?.city),
    state: state(venue?.state),
    postalCode: text(venue?.zip),
    coordinates: null
  };
}

function broker(shipper: Record<string, unknown> | undefined): NormalizedLoad["broker"] {
  const name = text(shipper?.name);
  return name === null ? null : { name, mcNumber: text(shipper?.mc_number), dotNumber: text(shipper?.dot_number) };
}

function trailerType(value: unknown): TrailerType {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  return normalized.includes("enclos") ? "enclosed" : normalized.includes("open") ? "open" : "unknown";
}

function metersToMiles(value: unknown): number | null {
  const meters = positiveNumber(value);
  return meters === null ? null : Math.round((meters / 1_609.344) * 100) / 100;
}

function identifier(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const normalized = text(value);
  return normalized === null ? undefined : normalized;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function state(value: unknown): string | null {
  const normalized = text(value)?.toUpperCase();
  return normalized !== undefined && /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function nonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function positiveNumber(value: unknown): number | null {
  const number = nonNegative(value);
  return number === null || number <= 0 ? null : number;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
