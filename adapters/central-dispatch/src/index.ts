import type { ProviderFilterCapabilities } from "@haulalert/filter-compiler";

/**
 * Initial native-search contract. Browser selectors and real-session handling
 * are intentionally deferred to the browser-runtime phase.
 */
export const centralDispatchCapabilities: ProviderFilterCapabilities = {
  provider: "central-dispatch",
  sourceFilterFields: ["origins", "destinations", "trailerTypes", "readiness"],
  newLoadDetectionStrategy: "tagged-top"
};
