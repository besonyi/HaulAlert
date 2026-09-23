import { supportedProviders } from "@haulalert/shared";
import { z } from "zod";

const usStateCodeSchema = z.string().regex(/^[A-Z]{2}$/, "Use a two-letter uppercase state code.");

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

export const loadLocationSchema = z.object({
  city: z.string().trim().min(1).nullable(),
  state: usStateCodeSchema.nullable(),
  postalCode: z.string().trim().min(1).nullable(),
  coordinates: coordinatesSchema.nullable()
});

export const brokerSchema = z.object({
  name: z.string().trim().min(1),
  mcNumber: z.string().trim().min(1).nullable(),
  dotNumber: z.string().trim().min(1).nullable()
});

export const trailerTypeSchema = z.enum(["open", "enclosed", "unknown"]);

export const normalizedLoadSchema = z.object({
  provider: z.enum(supportedProviders),
  providerLoadId: z.string().trim().min(1),
  pickup: loadLocationSchema,
  delivery: loadLocationSchema,
  vehicleCount: z.number().int().positive(),
  trailerType: trailerTypeSchema,
  payUsd: z.number().finite().nonnegative().nullable(),
  distanceMiles: z.number().finite().positive().nullable(),
  ratePerMile: z.number().finite().nonnegative().nullable(),
  readyAt: z.string().datetime().nullable(),
  postedAt: z.string().datetime().nullable(),
  sourceUrl: z.string().url().nullable(),
  broker: brokerSchema.nullable()
});

export type Coordinates = z.infer<typeof coordinatesSchema>;
export type LoadLocation = z.infer<typeof loadLocationSchema>;
export type Broker = z.infer<typeof brokerSchema>;
export type TrailerType = z.infer<typeof trailerTypeSchema>;
export type NormalizedLoad = z.infer<typeof normalizedLoadSchema>;

/** A stable cross-provider key used for deduplication and delivery idempotency. */
export function getGlobalLoadKey(load: Pick<NormalizedLoad, "provider" | "providerLoadId">): string {
  return `${load.provider}:${load.providerLoadId}`;
}

/** Returns a rounded USD-per-mile value when both required values are known. */
export function calculateRatePerMile(
  payUsd: number | null,
  distanceMiles: number | null
): number | null {
  if (payUsd === null || distanceMiles === null || distanceMiles <= 0) {
    return null;
  }

  return Math.round((payUsd / distanceMiles) * 100) / 100;
}
