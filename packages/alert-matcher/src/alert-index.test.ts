import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCanonicalFilter } from "@haulalert/canonical-filter";
import type { AlertSubscription } from "./index.js";

import { AlertIndex } from "./alert-index.js";
import { load } from "./test-fixtures.js";

const baseFilter = parseCanonicalFilter({
  schemaVersion: 1,
  name: "Open trailer route",
  origins: [{ kind: "anywhere" }],
  destinations: [{ kind: "anywhere" }],
  trailerTypes: ["open"],
  vehicles: { minimum: null, maximum: null },
  readiness: { kind: "any" },
  minimumPayUsd: null,
  minimumRatePerMile: null,
  providers: ["central-dispatch"],
  blockedBrokerIds: []
});

function subscription(alertId: string, filter = baseFilter): AlertSubscription {
  return { alertId, userId: `user-${alertId}`, telegramChatId: `chat-${alertId}`, filter };
}

describe("alert index", () => {
  it("narrows candidates by provider and trailer before exact matching", () => {
    const index = new AlertIndex();
    index.upsert(subscription("open-central"));
    index.upsert(subscription("enclosed-central", parseCanonicalFilter({
      ...baseFilter,
      trailerTypes: ["enclosed"]
    })));
    index.upsert(subscription("open-super", parseCanonicalFilter({
      ...baseFilter,
      providers: ["super-dispatch"]
    })));

    assert.deepEqual(index.candidatesFor(load()).map((item) => item.alertId), ["open-central"]);
    assert.deepEqual(index.findMatches(load()).map((match) => match.alertId), ["open-central"]);
  });

  it("replaces an existing alert and removes it from obsolete buckets", () => {
    const index = new AlertIndex();
    index.upsert(subscription("alert-1"));
    index.upsert(subscription("alert-1", parseCanonicalFilter({
      ...baseFilter,
      providers: ["shipcars"]
    })));

    assert.equal(index.size, 1);
    assert.deepEqual(index.candidatesFor(load()), []);
    assert.equal(index.remove("alert-1"), true);
    assert.equal(index.size, 0);
  });

  it("does not offer candidate alerts for an unknown trailer type", () => {
    const index = new AlertIndex();
    index.upsert(subscription("alert-1"));

    assert.deepEqual(index.candidatesFor(load({ trailerType: "unknown" })), []);
  });
});
