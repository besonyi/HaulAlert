import type { Readiness } from "@haulalert/canonical-filter";

/** Converts the alert-form readiness controls into the canonical, provider-neutral filter value. */
export function readinessFromForm(data: FormData): Readiness {
  const kind = data.get("readiness");
  if (kind === "any" || kind === "today" || kind === "tomorrow") return { kind };
  if (kind !== "date-range") throw new Error("Choose when the vehicle should be ready.");
  const availableFrom = date(data.get("availableFrom"), "Start date");
  const availableUntil = date(data.get("availableUntil"), "End date");
  if (availableFrom > availableUntil) throw new Error("End date must be on or after the start date.");
  return { kind, availableFrom, availableUntil };
}

function date(value: FormDataEntryValue | null, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} is required.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} must be a valid date.`);
  return value;
}
