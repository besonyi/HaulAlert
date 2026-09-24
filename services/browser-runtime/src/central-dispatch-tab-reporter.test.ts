import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BrowserRuntime } from "@haulalert/browser-runtime-core";

import { CentralDispatchTabReporter } from "./central-dispatch-tab-reporter.js";

describe("Central Dispatch tab reporter", () => {
  it("logs each safe tab-state transition once", () => {
    const runtime = new BrowserRuntime({
      now: () => new Date("2026-09-24T12:00:00.000Z"),
      createTabId: () => "tab-1"
    });
    runtime.registerSession({ id: "central-local", provider: "central-dispatch" });
    const tab = runtime.reserveSearchTab({ provider: "central-dispatch", sourceFilterHash: "source-hash" });
    runtime.markTabReady(tab.tab.id);
    const messages: string[] = [];
    const reporter = new CentralDispatchTabReporter(runtime, (message) => { messages.push(message); });

    reporter.report();
    reporter.report();
    runtime.markTabDegraded(tab.tab.id);
    reporter.report();
    reporter.report();

    assert.deepEqual(messages, [
      "Central Dispatch tab tab-1 is ready.",
      "Central Dispatch tab tab-1 is degraded; recovery attempt 1, next recovery 2026-09-24T12:00:30.000Z."
    ]);
  });
});
