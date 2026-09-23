import type { NormalizedLoad } from "@haulalert/load-model";

export function load(overrides: Partial<NormalizedLoad> = {}): NormalizedLoad {
  return {
    provider: "central-dispatch",
    providerLoadId: "829181",
    pickup: {
      city: "Stockton",
      state: "CA",
      postalCode: null,
      coordinates: { latitude: 37.9577, longitude: -121.2908 }
    },
    delivery: {
      city: "Phoenix",
      state: "AZ",
      postalCode: null,
      coordinates: { latitude: 33.4484, longitude: -112.074 }
    },
    vehicleCount: 3,
    trailerType: "open",
    payUsd: 2100,
    distanceMiles: 730,
    ratePerMile: 2.88,
    readyAt: "2026-09-22T12:00:00.000Z",
    postedAt: "2026-09-22T12:00:00.000Z",
    sourceUrl: null,
    broker: { name: "ABC Auto Transport", mcNumber: "123456", dotNumber: null },
    ...overrides
  };
}
