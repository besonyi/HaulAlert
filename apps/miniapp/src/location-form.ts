import type { LocationConstraint } from "@haulalert/canonical-filter";

export type LocationFormPrefix = "origin" | "destination";

type FormValues = Pick<FormData, "get">;

/** Converts one Mini App location section into the canonical, provider-safe location model. */
export function locationFromForm(data: FormValues, prefix: LocationFormPrefix): LocationConstraint {
  const label = prefix === "origin" ? "Origin" : "Destination";
  const kind = read(data, `${prefix}Kind`);
  if (kind === "anywhere") return { kind: "anywhere" };

  const state = requiredState(data, `${prefix}State`, `${label} state`);
  if (kind === "state") return { kind: "state", state };
  if (kind !== "city") throw new Error(`Choose a valid ${label.toLowerCase()} location type.`);

  return {
    kind: "city",
    city: requiredText(data, `${prefix}City`, `${label} city`),
    state,
    coordinates: {
      latitude: coordinate(data, `${prefix}Latitude`, `${label} latitude`, -90, 90),
      longitude: coordinate(data, `${prefix}Longitude`, `${label} longitude`, -180, 180)
    },
    radiusMiles: wholeNumber(data, `${prefix}Radius`, `${label} radius`, 1, 500)
  };
}

function read(data: FormValues, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function requiredText(data: FormValues, name: string, label: string): string {
  const value = read(data, name);
  if (value.length === 0) throw new Error(`${label} is required.`);
  return value;
}

function requiredState(data: FormValues, name: string, label: string): string {
  const state = requiredText(data, name, label).toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new Error(`${label} must be a two-letter state code, such as CA.`);
  return state;
}

function coordinate(data: FormValues, name: string, label: string, minimum: number, maximum: number): number {
  const value = Number(requiredText(data, name, label));
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function wholeNumber(data: FormValues, name: string, label: string, minimum: number, maximum: number): number {
  const value = Number(requiredText(data, name, label));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a whole number from ${minimum} to ${maximum}.`);
  }
  return value;
}
