import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CentralDispatchOpenSearchTransport,
  type AuthenticatedCentralDispatchRequestExecutor
} from "./central-dispatch-open-search-transport.js";
import type { ProviderSearchConfiguration } from "./index.js";

const configuration: Omit<ProviderSearchConfiguration, "provider"> = {
  sessionId: "central-session",
  tabId: "central-tab",
  sourceFilter: { trailerTypes: ["open"] }
};

describe("Central Dispatch open-search transport", () => {
  it("executes the provider request through the authenticated browser boundary", async () => {
    const requests: unknown[] = [];
    const executor: AuthenticatedCentralDispatchRequestExecutor = {
      execute: async (request) => {
        requests.push(request);
        return { items: [{ id: "central-1" }], total: 1 };
      }
    };
    const transport = new CentralDispatchOpenSearchTransport(executor);

    await transport.configureSearch(configuration);
    const page = await transport.fetchSearch({
      sessionId: configuration.sessionId,
      tabId: configuration.tabId,
      sourceFilterHash: "filter-hash"
    });

    assert.deepEqual(requests, [{
      method: "POST",
      url: "https://bff.centraldispatch.com/listing-search/api/open-search",
      body: {
        vehicleCount: { min: 1, max: null },
        trailerTypes: ["OPEN"],
        readyToShipWithinDays: null,
        minimumPaymentTotal: null,
        minimumPricePerMile: null,
        offset: 0,
        limit: 250,
        sortFields: [
          { name: "POSTDATE", direction: "DESC" },
          { name: "PRICE", direction: "DESC" }
        ],
        shipperIds: [],
        marketplaceIds: [],
        requestType: "Open",
        locations: []
      }
    }]);
    assert.deepEqual(page, { payload: { items: [{ id: "central-1" }], total: 1 }, isTruncated: false });
  });

  it("marks an incomplete provider page as truncated", async () => {
    const transport = new CentralDispatchOpenSearchTransport({
      execute: async () => ({ items: [{ id: "central-1" }], totalCount: 2 })
    });
    await transport.configureSearch(configuration);

    const page = await transport.fetchSearch({
      sessionId: configuration.sessionId,
      tabId: configuration.tabId,
      sourceFilterHash: "filter-hash"
    });

    assert.equal(page.isTruncated, true);
  });

  it("does not execute a request for an unconfigured tab", async () => {
    let executions = 0;
    const transport = new CentralDispatchOpenSearchTransport({
      execute: async () => {
        executions += 1;
        return { items: [] };
      }
    });

    await assert.rejects(
      () => transport.fetchSearch({ sessionId: "central-session", tabId: "missing-tab", sourceFilterHash: "filter-hash" }),
      /not configured/
    );
    assert.equal(executions, 0);
  });
});
