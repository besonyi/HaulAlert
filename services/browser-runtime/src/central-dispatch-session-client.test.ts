import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSourceFilterHash } from "@haulalert/filter-compiler";

import {
  CentralDispatchSearchNotConfiguredError,
  CentralDispatchSessionClient,
  CentralDispatchStaleSearchError,
  type CentralDispatchSessionTransport
} from "./central-dispatch-session-client.js";
import type { ProviderSearchConfiguration } from "./index.js";

const configuration: Omit<ProviderSearchConfiguration, "provider"> = {
  sessionId: "central-session",
  tabId: "central-tab",
  sourceFilter: { trailerTypes: ["open"] }
};

describe("Central Dispatch session client", () => {
  it("passes a configured session search through its opaque browser transport", async () => {
    const calls: unknown[] = [];
    const transport: CentralDispatchSessionTransport = {
      configureSearch: async (input) => { calls.push(["configure", input]); },
      fetchSearch: async (input) => {
        calls.push(["fetch", input]);
        return { payload: { items: [] }, isTruncated: false };
      }
    };
    const client = new CentralDispatchSessionClient(transport);

    await client.configureSearch(configuration);
    const page = await client.fetchSearch({
      sessionId: configuration.sessionId,
      tabId: configuration.tabId,
      sourceFilterHash: createSourceFilterHash("central-dispatch", configuration.sourceFilter)
    });

    assert.deepEqual(calls, [
      ["configure", configuration],
      ["fetch", {
        sessionId: configuration.sessionId,
        tabId: configuration.tabId,
        sourceFilterHash: createSourceFilterHash("central-dispatch", configuration.sourceFilter)
      }]
    ]);
    assert.deepEqual(page, { payload: { items: [] }, isTruncated: false });
  });

  it("refuses a scan before the tab has been configured", async () => {
    const client = new CentralDispatchSessionClient({
      configureSearch: async () => undefined,
      fetchSearch: async () => ({ payload: { items: [] }, isTruncated: false })
    });

    await assert.rejects(
      () => client.fetchSearch({ sessionId: "central-session", tabId: "central-tab", sourceFilterHash: "filter" }),
      CentralDispatchSearchNotConfiguredError
    );
  });

  it("refuses a scan after its expected filter no longer matches the tab", async () => {
    let fetchCalls = 0;
    const client = new CentralDispatchSessionClient({
      configureSearch: async () => undefined,
      fetchSearch: async () => {
        fetchCalls += 1;
        return { payload: { items: [] }, isTruncated: false };
      }
    });

    await client.configureSearch(configuration);
    await assert.rejects(
      () => client.fetchSearch({
        sessionId: configuration.sessionId,
        tabId: configuration.tabId,
        sourceFilterHash: "a-different-filter"
      }),
      CentralDispatchStaleSearchError
    );
    assert.equal(fetchCalls, 0);
  });

  it("invalidates the remembered filter when the browser cannot configure the search", async () => {
    let shouldFail = false;
    const client = new CentralDispatchSessionClient({
      configureSearch: async () => {
        if (shouldFail) throw new Error("Central Dispatch search did not apply");
      },
      fetchSearch: async () => ({ payload: { items: [] }, isTruncated: false })
    });

    await client.configureSearch(configuration);
    shouldFail = true;
    await assert.rejects(() => client.configureSearch(configuration), /search did not apply/);
    await assert.rejects(
      () => client.fetchSearch({
        sessionId: configuration.sessionId,
        tabId: configuration.tabId,
        sourceFilterHash: createSourceFilterHash("central-dispatch", configuration.sourceFilter)
      }),
      CentralDispatchSearchNotConfiguredError
    );
  });
});
