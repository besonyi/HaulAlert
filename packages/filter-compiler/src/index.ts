import { createHash } from "node:crypto";

import type { CanonicalFilter } from "@haulalert/canonical-filter";
import type { SupportedProvider } from "@haulalert/shared";

export const sourceFilterFields = [
  "origins",
  "destinations",
  "trailerTypes",
  "readiness",
  "minimumPayUsd",
  "minimumRatePerMile"
] as const;

export type SourceFilterField = (typeof sourceFilterFields)[number];
export type VehicleCountSupport = "unsupported" | "minimum-only" | "range";
export type NewLoadDetectionStrategy = "tagged-top" | "newest-first" | "unverified";

export interface ProviderFilterCapabilities {
  readonly provider: SupportedProvider;
  readonly sourceFilterFields: readonly SourceFilterField[];
  readonly vehicleCountSupport: VehicleCountSupport;
  readonly newLoadDetectionStrategy: NewLoadDetectionStrategy;
}

export type SourceFilter = Partial<Pick<CanonicalFilter, SourceFilterField>> & {
  readonly vehicles?: CanonicalFilter["vehicles"];
};

export interface InternalFilter {
  readonly vehicles?: CanonicalFilter["vehicles"];
  readonly minimumPayUsd?: CanonicalFilter["minimumPayUsd"];
  readonly minimumRatePerMile?: CanonicalFilter["minimumRatePerMile"];
  readonly blockedBrokerIds: CanonicalFilter["blockedBrokerIds"];
}

export interface CompiledProviderFilter {
  readonly provider: SupportedProvider;
  readonly sourceFilter: SourceFilter;
  readonly internalFilter: InternalFilter;
  readonly sourceFilterHash: string;
}

/** Raised when a caller tries to compile a provider that the alert did not select. */
export class ProviderNotEnabledError extends Error {
  public constructor(provider: SupportedProvider) {
    super(`The alert does not enable provider: ${provider}`);
    this.name = "ProviderNotEnabledError";
  }
}

/**
 * Splits a customer alert into provider-native fields and the fields that must
 * remain part of HaulAlert's internal exact-match evaluation.
 */
export function compileFilterForProvider(
  filter: CanonicalFilter,
  capabilities: ProviderFilterCapabilities
): CompiledProviderFilter {
  if (!filter.providers.includes(capabilities.provider)) {
    throw new ProviderNotEnabledError(capabilities.provider);
  }

  const supportedFields = new Set(capabilities.sourceFilterFields);
  const sourceFilter = {
    ...Object.fromEntries(
    sourceFilterFields
      .filter((field) => supportedFields.has(field))
      .map((field) => [field, filter[field]])
    ),
    ...nativeVehicleFilter(filter, capabilities.vehicleCountSupport)
  } as SourceFilter;

  const internalFilter: InternalFilter = {
    blockedBrokerIds: [...filter.blockedBrokerIds],
    ...internalVehicleFilter(filter, capabilities.vehicleCountSupport),
    ...(supportedFields.has("minimumPayUsd") ? {} : { minimumPayUsd: filter.minimumPayUsd }),
    ...(supportedFields.has("minimumRatePerMile")
      ? {}
      : { minimumRatePerMile: filter.minimumRatePerMile })
  };

  return {
    provider: capabilities.provider,
    sourceFilter,
    internalFilter,
    sourceFilterHash: createSourceFilterHash(capabilities.provider, sourceFilter)
  };
}

function nativeVehicleFilter(
  filter: CanonicalFilter,
  support: VehicleCountSupport
): Pick<SourceFilter, "vehicles"> {
  if (support === "unsupported") return {};
  if (support === "minimum-only") {
    return { vehicles: { minimum: filter.vehicles.minimum, maximum: null } };
  }

  return { vehicles: filter.vehicles };
}

function internalVehicleFilter(
  filter: CanonicalFilter,
  support: VehicleCountSupport
): Pick<InternalFilter, "vehicles"> {
  if (support === "range") return {};
  if (support === "minimum-only") {
    return { vehicles: { minimum: null, maximum: filter.vehicles.maximum } };
  }

  return { vehicles: filter.vehicles };
}

/**
 * Produces an order-independent hash for an equivalent provider-native search.
 * Customer-only fields, including alert name and blocked brokers, never affect it.
 */
export function createSourceFilterHash(provider: SupportedProvider, sourceFilter: SourceFilter): string {
  const canonicalPayload = stableSerialize({ provider, sourceFilter: normalizeValue(sourceFilter) });
  return createHash("sha256").update(canonicalPayload).digest("hex");
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue).sort((left, right) => stableSerialize(left).localeCompare(stableSerialize(right)));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, normalizeValue(nestedValue)])
    );
  }

  return value;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(value);
}
