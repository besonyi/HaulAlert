import type { Broker } from "@haulalert/load-model";

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
