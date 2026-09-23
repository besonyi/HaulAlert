import { supportedProviders } from "@haulalert/shared";
import { z } from "zod";

const usStateCodeSchema = z.string().regex(/^[A-Z]{2}$/, "Use a two-letter uppercase state code.");

export const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

export const locationConstraintSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("city"),
    city: z.string().trim().min(1),
    state: usStateCodeSchema,
    coordinates: geoPointSchema,
    radiusMiles: z.number().int().min(1).max(500)
  }),
  z.object({
    kind: z.literal("state"),
    state: usStateCodeSchema
  }),
  z.object({
    kind: z.literal("anywhere")
  })
]);

export const readinessSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("any") }),
  z.object({ kind: z.literal("today") }),
  z.object({ kind: z.literal("tomorrow") }),
  z.object({
    kind: z.literal("date-range"),
    availableFrom: z.string().date(),
    availableUntil: z.string().date()
  })
]).superRefine((value, context) => {
  if (value.kind === "date-range" && value.availableFrom > value.availableUntil) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["availableUntil"],
      message: "The end date must be on or after the start date."
    });
  }
});

export const canonicalFilterSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(80),
  origins: z.array(locationConstraintSchema).min(1),
  destinations: z.array(locationConstraintSchema).min(1),
  trailerTypes: z.array(z.enum(["open", "enclosed"])).min(1),
  vehicles: z.object({
    minimum: z.number().int().positive().nullable(),
    maximum: z.number().int().positive().nullable()
  }).superRefine((value, context) => {
    if (value.minimum !== null && value.maximum !== null && value.minimum > value.maximum) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maximum"],
        message: "The maximum vehicle count must be at least the minimum."
      });
    }
  }),
  readiness: readinessSchema,
  minimumPayUsd: z.number().finite().nonnegative().nullable(),
  minimumRatePerMile: z.number().finite().nonnegative().nullable(),
  providers: z.array(z.enum(supportedProviders)).min(1),
  blockedBrokerIds: z.array(z.string().trim().min(1)).default([])
});

export type GeoPoint = z.infer<typeof geoPointSchema>;
export type LocationConstraint = z.infer<typeof locationConstraintSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
export type CanonicalFilter = z.infer<typeof canonicalFilterSchema>;

/** Validates untrusted API input before a filter reaches the compiler or matcher. */
export function parseCanonicalFilter(input: unknown): CanonicalFilter {
  return canonicalFilterSchema.parse(input);
}
