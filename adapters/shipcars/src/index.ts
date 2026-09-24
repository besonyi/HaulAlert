import type { LocationConstraint } from "@haulalert/canonical-filter";
import type { ProviderFilterCapabilities, SourceFilter } from "@haulalert/filter-compiler";
import {
  calculateRatePerMile,
  type LoadLocation,
  type NormalizedLoad,
  type TrailerType
} from "@haulalert/load-model";

/**
 * HaulFlow's session-backed request builder applies these fields natively.
 * The browser adapter still validates its live selector/endpoint behavior.
 */
export const shipCarsCapabilities: ProviderFilterCapabilities = {
  provider: "shipcars",
  sourceFilterFields: [
    "origins",
    "destinations",
    "trailerTypes",
    "readiness",
    "minimumPayUsd",
    "minimumRatePerMile"
  ],
  vehicleCountSupport: "range",
  newLoadDetectionStrategy: "newest-first"
};

const shipCarsSearchUrl = "https://ship.cars/app/loadboard/postings";
const shipCarsSessionSearchPath = "/api/cube/loadboard/v3/platform-web/postings";
const mutableSearchParameters = [
  "pickup_city",
  "pickup_range",
  "pickup_state",
  "delivery_city",
  "delivery_range",
  "delivery_state",
  "total_carrier_pay",
  "price_per_mile",
  "number_vehicles",
  "max_number_vehicles",
  "operable",
  "enclosed_trailer",
  "ship_within",
  "limit",
  "offset",
  "ordering"
] as const;

export class InvalidShipCarsSearchEndpointError extends Error {
  public constructor() {
    super("Ship.Cars searches must start from the captured authenticated postings endpoint");
    this.name = "InvalidShipCarsSearchEndpointError";
  }
}

export class ShipCarsLiveLocationSelectionRequiredError extends Error {
  public constructor(scope: "pickup" | "delivery") {
    super(`Ship.Cars ${scope} radius needs a matching location selected in the live provider session`);
    this.name = "ShipCarsLiveLocationSelectionRequiredError";
  }
}

/**
 * Applies HaulAlert's source-safe fields to a captured authenticated Ship.Cars
 * endpoint. Provider range tokens are opaque, so they are reused only for a
 * city already selected by the live provider UI.
 */
export function buildShipCarsSearchUrl(capturedUrl: string, filter: SourceFilter): string {
  const url = parseCapturedSearchUrl(capturedUrl);
  const pickupRange = reusableRange(url, "pickup", filter.origins ?? []);
  const deliveryRange = reusableRange(url, "delivery", filter.destinations ?? []);

  for (const name of mutableSearchParameters) url.searchParams.delete(name);

  appendLocations(url, "pickup", filter.origins ?? [], pickupRange);
  appendLocations(url, "delivery", filter.destinations ?? [], deliveryRange);
  setFiniteParameter(url, "total_carrier_pay", filter.minimumPayUsd);
  setFiniteParameter(url, "price_per_mile", filter.minimumRatePerMile);
  setFiniteParameter(url, "number_vehicles", filter.vehicles?.minimum);
  setFiniteParameter(url, "max_number_vehicles", filter.vehicles?.maximum);

  if (filter.trailerTypes?.length === 1) {
    url.searchParams.set("enclosed_trailer", String(filter.trailerTypes[0] === "enclosed"));
  }

  // Ship.Cars exposes only an upper bound (ship_within), so canonical date
  // semantics remain in the internal matcher rather than being guessed here.
  url.searchParams.set("limit", "250");
  url.searchParams.set("offset", "0");
  url.searchParams.set("ordering", "-create_time");
  return url.toString();
}

/** Normalizes Ship.Cars' session-backed GET /postings response. */
export function normalizeShipCarsSearchResponse(payload: unknown): readonly NormalizedLoad[] {
  const root = record(payload);
  const rows = Array.isArray(root?.results) ? root.results : [];
  return rows.flatMap((row) => {
    const load = normalizeShipCarsListing(row);
    return load === undefined ? [] : [load];
  });
}

export function normalizeShipCarsListing(value: unknown): NormalizedLoad | undefined {
  const listing = record(value);
  const providerLoadId = identifier(listing?.id) ?? identifier(listing?.shipper_load_id);
  if (listing === undefined || providerLoadId === undefined) return undefined;

  const vehicles = Array.isArray(listing.vehicles) ? listing.vehicles : [];
  const payUsd = nonNegativeNumber(listing.total_payment_to_carrier);
  const distanceMiles = positiveNumber(listing.distance_imperial);

  return {
    provider: "shipcars",
    providerLoadId,
    pickup: location(listing, "pickup"),
    delivery: location(listing, "delivery"),
    vehicleCount: Math.max(vehicles.length, 1),
    trailerType: trailerType(listing.enclosed_trailer),
    payUsd,
    distanceMiles,
    ratePerMile: calculateRatePerMile(payUsd, distanceMiles),
    readyAt: isoDate(listing.pickup_requested_date_start ?? listing.first_available_date),
    postedAt: isoDate(listing.create_time),
    sourceUrl: shipCarsSearchUrl,
    broker: null
  };
}

function location(listing: Record<string, unknown>, prefix: "pickup" | "delivery"): LoadLocation {
  const coordinates = record(listing[`${prefix}_address_location`]);
  return {
    city: text(listing[`${prefix}_city`]),
    state: state(listing[`${prefix}_state`]),
    postalCode: text(listing[`${prefix}_zip`]),
    coordinates: coordinatePair(coordinates)
  };
}

function coordinatePair(value: Record<string, unknown> | undefined): LoadLocation["coordinates"] {
  const latitude = finiteNumber(value?.lat);
  const longitude = finiteNumber(value?.lon);
  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude };
}

function trailerType(value: unknown): TrailerType {
  return value === true ? "enclosed" : value === false ? "open" : "unknown";
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

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number === null || number < 0 ? null : number;
}

function positiveNumber(value: unknown): number | null {
  const number = nonNegativeNumber(value);
  return number === null || number <= 0 ? null : number;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseCapturedSearchUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidShipCarsSearchEndpointError();
  }
  if (url.protocol !== "https:" || url.hostname !== "ship.cars" || url.pathname !== shipCarsSessionSearchPath) {
    throw new InvalidShipCarsSearchEndpointError();
  }
  return url;
}

function reusableRange(
  url: URL,
  scope: "pickup" | "delivery",
  constraints: readonly LocationConstraint[]
): string | undefined {
  const citiesWithRadius = constraints.filter(isCityConstraint);
  if (citiesWithRadius.length === 0) return undefined;
  if (citiesWithRadius.length > 1) throw new ShipCarsLiveLocationSelectionRequiredError(scope);

  const requested = citiesWithRadius[0];
  if (requested === undefined) return undefined;
  const requestedCity = cityLabel(requested);
  const capturedCities = url.searchParams.getAll(`${scope}_city`).map((city) => city.toLowerCase());
  const range = url.searchParams.get(`${scope}_range`);
  if (range === null || !capturedCities.includes(requestedCity.toLowerCase())) {
    throw new ShipCarsLiveLocationSelectionRequiredError(scope);
  }
  return range;
}

function appendLocations(
  url: URL,
  scope: "pickup" | "delivery",
  constraints: readonly LocationConstraint[],
  range: string | undefined
): void {
  const states = new Set<string>();
  let requestedRadius: number | undefined;
  for (const constraint of constraints) {
    if (constraint.kind === "city") {
      url.searchParams.append(`${scope}_city`, cityLabel(constraint));
      states.add(constraint.state);
      requestedRadius = constraint.radiusMiles;
    } else if (constraint.kind === "state") {
      states.add(constraint.state);
    }
  }
  for (const stateCode of states) url.searchParams.append(`${scope}_state`, stateCode);
  if (range !== undefined && requestedRadius !== undefined) {
    const separator = range.lastIndexOf("|");
    const base = separator >= 0 ? range.slice(0, separator) : range;
    url.searchParams.set(`${scope}_range`, `${base}|${requestedRadius}`);
  }
}

function cityLabel(constraint: Extract<LocationConstraint, { readonly kind: "city" }>): string {
  return `${constraint.city}, ${constraint.state}`;
}

function isCityConstraint(
  constraint: LocationConstraint
): constraint is Extract<LocationConstraint, { readonly kind: "city" }> {
  return constraint.kind === "city" && constraint.radiusMiles > 0;
}

function setFiniteParameter(url: URL, name: string, value: number | null | undefined): void {
  if (typeof value === "number" && Number.isFinite(value)) url.searchParams.set(name, String(value));
}
