import type { ProviderFilterCapabilities } from "@haulalert/filter-compiler";

/** Initial native-search contract for a newest-first Super Dispatch search. */
export const superDispatchCapabilities: ProviderFilterCapabilities = {
  provider: "super-dispatch",
  sourceFilterFields: ["origins", "destinations"],
  vehicleCountSupport: "minimum-only",
  newLoadDetectionStrategy: "newest-first"
};
