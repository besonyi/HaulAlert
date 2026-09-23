import type { AlertMatch } from "@haulalert/alert-matcher";

export interface TelegramAction {
  readonly label: string;
  readonly url: string;
}

export interface NewLoadNotification {
  readonly text: string;
  readonly actions: readonly TelegramAction[];
}

/** Renders the customer-facing Telegram payload without exposing provider sessions. */
export function renderNewLoadNotification(
  match: AlertMatch,
  options: { readonly loadDetailsUrl?: string } = {}
): NewLoadNotification {
  const { load } = match;
  const lines = [
    "🚨 NEW LOAD",
    "",
    `${formatLocation(load.pickup.city, load.pickup.state)} → ${formatLocation(load.delivery.city, load.delivery.state)}`,
    `🚗 ${load.vehicleCount} ${load.vehicleCount === 1 ? "vehicle" : "vehicles"}`
  ];

  if (load.payUsd !== null) lines.push(`💰 ${formatUsd(load.payUsd)}`);
  if (load.distanceMiles !== null) lines.push(`📏 ${formatNumber(load.distanceMiles)} mi`);
  if (load.ratePerMile !== null) lines.push(`💵 ${formatUsd(load.ratePerMile)}/mi`);
  if (load.readyAt !== null) lines.push(`📅 Pickup: ${formatPickupDate(load.readyAt)}`);
  if (load.broker !== null) lines.push(`🏢 Broker: ${load.broker.name}`);

  lines.push(`📡 Source: ${providerDisplayName(load.provider)}`);

  return {
    text: lines.join("\n"),
    actions: options.loadDetailsUrl === undefined ? [] : [{ label: "OPEN LOAD", url: options.loadDetailsUrl }]
  };
}

function formatLocation(city: string | null, state: string | null): string {
  return [city, state].filter((part): part is string => part !== null && part.length > 0).join(", ") || "Location unavailable";
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPickupDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value.slice(0, 10)
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function providerDisplayName(provider: AlertMatch["load"]["provider"]): string {
  return {
    "central-dispatch": "Central Dispatch",
    "super-dispatch": "Super Dispatch",
    shipcars: "Ship.Cars"
  }[provider];
}
