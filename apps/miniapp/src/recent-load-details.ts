import type { Broker, NormalizedLoad } from "@haulalert/load-model";

/** Returns only browser-safe external load-board links from provider-normalized data. */
export function safeLoadBoardUrl(value: string | null): string | undefined {
  if (value === null) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Preserves the broker identity details that are available, without inventing missing identifiers. */
export function brokerDetailsLabel(broker: Broker | null): string | undefined {
  if (broker === null) return undefined;
  const identifiers = [
    broker.mcNumber === null ? undefined : `MC ${broker.mcNumber}`,
    broker.dotNumber === null ? undefined : `DOT ${broker.dotNumber}`
  ].filter((value): value is string => value !== undefined);
  return identifiers.length === 0 ? broker.name : `${broker.name} · ${identifiers.join(" · ")}`;
}

/** The operational load details worth showing before a customer opens a board link. */
export function loadFacts(load: Pick<NormalizedLoad, "vehicleCount" | "trailerType" | "distanceMiles" | "ratePerMile" | "readyAt">): readonly string[] {
  return [
    `${load.vehicleCount} ${load.vehicleCount === 1 ? "vehicle" : "vehicles"}`,
    load.trailerType === "unknown" ? "Trailer not specified" : `${capitalize(load.trailerType)} trailer`,
    load.distanceMiles === null ? undefined : `${load.distanceMiles.toLocaleString()} mi`,
    load.ratePerMile === null ? undefined : `$${load.ratePerMile.toFixed(2)}/mi`,
    readyDateLabel(load.readyAt)
  ].filter((value): value is string => value !== undefined);
}

function readyDateLabel(value: string | null): string | undefined {
  if (value === null) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `Ready ${value.slice(0, 10)}`;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
