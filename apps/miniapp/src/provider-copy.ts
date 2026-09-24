import type { CanonicalFilter } from "@haulalert/canonical-filter";

type Provider = CanonicalFilter["providers"][number];

const providerNames: Record<Provider, string> = {
  "central-dispatch": "Central Dispatch",
  "super-dispatch": "Super Dispatch",
  shipcars: "Ship.Cars"
};

export function providerListLabel(providers: readonly Provider[]): string {
  return providers.map((provider) => providerNames[provider]).join(", ");
}

/** Customer-safe status copy: it describes monitoring without disclosing provider session details. */
export function providerMonitoringSummary(providers: readonly Provider[]): string {
  if (providers.length === 0) return "Choose at least one load board to start monitoring.";
  return `HaulAlert monitors ${providerListLabel(providers)} and sends qualifying new loads to Telegram.`;
}
