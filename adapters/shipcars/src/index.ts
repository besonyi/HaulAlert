import type { ProviderFilterCapabilities } from "@haulalert/filter-compiler";

/**
 * HaulFlow's session-backed request builder applies these fields natively.
 * The browser adapter still validates its live selector/endpoint behavior.
 */
export const shipCarsCapabilities: ProviderFilterCapabilities = {
  provider: "shipcars",
  sourceFilterFields: [
    "origins",
    "destinations",
    "trailerTypes",
    "readiness",
    "minimumPayUsd",
    "minimumRatePerMile"
  ],
  vehicleCountSupport: "range",
  newLoadDetectionStrategy: "newest-first"
};
