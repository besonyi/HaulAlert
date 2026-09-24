import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkCentralDispatchReadiness } from "./central-dispatch-readiness.js";

describe("Central Dispatch readiness check", () => {
  it("accepts a locally reachable Central Dispatch page without evaluating its content", async () => {
    let evaluations = 0;
    const result = await checkCentralDispatchReadiness({
      findCentralDispatchTarget: async () => ({
        id: "central-tab",
        type: "page",
        url: "https://app.centraldispatch.com/search",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/central-tab"
      }),
      evaluateJson: async () => {
        evaluations += 1;
        return undefined;
      }
    });

    assert.deepEqual(result, { status: "ready" });
    assert.equal(evaluations, 0);
  });

  it("reports an unavailable local session without throwing", async () => {
    const result = await checkCentralDispatchReadiness({
      findCentralDispatchTarget: async () => { throw new Error("No Central Dispatch page"); },
      evaluateJson: async () => undefined
    });

    assert.equal(result.status, "offline");
    assert.match(result.status === "offline" ? result.error.message : "", /No Central Dispatch page/);
  });
});
