import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSourceFilterHash } from "@haulalert/filter-compiler";

import {
  CentralDispatchCdpRequestExecutor,
  createCentralDispatchCdpSessionClient,
  type ChromeDevToolsRuntime,
  type ChromeDevToolsTarget
} from "./central-dispatch-cdp-executor.js";

const target: ChromeDevToolsTarget = {
  id: "central-tab",
  type: "page",
  url: "https://app.centraldispatch.com/search",
  webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/central-tab"
};

describe("Central Dispatch CDP request executor", () => {
  it("executes only the Open Search payload inside the already-authenticated page", async () => {
    let receivedTarget: ChromeDevToolsTarget | undefined;
    let expression = "";
    const runtime: ChromeDevToolsRuntime = {
      findCentralDispatchTarget: async () => target,
      evaluateJson: async (candidate, value) => {
        receivedTarget = candidate;
        expression = value;
        return { items: [{ id: "central-1" }] };
      }
    };
    const executor = new CentralDispatchCdpRequestExecutor(runtime);

    const payload = await executor.execute({
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
        sortFields: [{ name: "POSTDATE", direction: "DESC" }],
        shipperIds: [],
        marketplaceIds: [],
        requestType: "Open",
        locations: []
      }
    });

    assert.deepEqual(receivedTarget, target);
    assert.deepEqual(payload, { items: [{ id: "central-1" }] });
    assert.match(expression, /credentials: 'include'/);
    assert.match(expression, /listing-search\/api\/open-search/);
    assert.doesNotMatch(expression, /cookie/i);
  });

  it("composes the local browser bridge into the shared session client", async () => {
    const client = createCentralDispatchCdpSessionClient({
      findCentralDispatchTarget: async () => target,
      evaluateJson: async () => ({ items: [{ id: "central-1" }], total: 1 })
    });
    const sourceFilter = { trailerTypes: ["open"] as ("open" | "enclosed")[] };

    await client.configureSearch({ sessionId: "central-session", tabId: "central-tab", sourceFilter });
    const page = await client.fetchSearch({
      sessionId: "central-session",
      tabId: "central-tab",
      sourceFilterHash: createSourceFilterHash("central-dispatch", sourceFilter)
    });

    assert.deepEqual(page, { payload: { items: [{ id: "central-1" }], total: 1 }, isTruncated: false });
  });
});
