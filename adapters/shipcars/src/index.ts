import type { ProviderFilterCapabilities } from "@haulalert/filter-compiler";

/**
 * Ship.Cars begins conservatively: no native field is marked supported until
 * the browser adapter verifies it. The matcher therefore preserves all rules.
 */
export const shipCarsCapabilities: ProviderFilterCapabilities = {
  provider: "shipcars",
  sourceFilterFields: [],
  newLoadDetectionStrategy: "unverified"
};
