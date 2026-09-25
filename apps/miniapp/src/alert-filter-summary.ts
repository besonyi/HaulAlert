import type { CanonicalFilter, Readiness } from "@haulalert/canonical-filter";

/** Customer-facing labels for the conditions saved on an alert card. */
export function readinessLabel(readiness: Readiness): string {
  if (readiness.kind === "any") return "Any ready date";
  if (readiness.kind === "today") return "Ready today";
  if (readiness.kind === "tomorrow") return "Ready tomorrow";
  return `Ready ${readiness.availableFrom} to ${readiness.availableUntil}`;
}

/** Describes the optional vehicle-count range without exposing empty bounds. */
export function vehicleCountLabel(vehicles: CanonicalFilter["vehicles"]): string {
  const { minimum, maximum } = vehicles;
  if (minimum !== null && maximum !== null) {
    return minimum === maximum ? `${minimum} ${vehicleWord(minimum)}` : `${minimum}–${maximum} vehicles`;
  }
  if (minimum !== null) return `${minimum}+ vehicles`;
  if (maximum !== null) return `Up to ${maximum} vehicles`;
  return "Any vehicle count";
}

function vehicleWord(value: number): string {
  return value === 1 ? "vehicle" : "vehicles";
}
