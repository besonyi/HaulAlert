import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBetaFeedbackMessage, PostgresBetaFeedbackRepository } from "./beta-feedback.js";

test("beta feedback trims and bounds customer feedback", () => {
  assert.equal(normalizeBetaFeedbackMessage("  Helpful alerts  "), "Helpful alerts");
  assert.throws(() => normalizeBetaFeedbackMessage(" "));
  assert.throws(() => normalizeBetaFeedbackMessage("x".repeat(1201)));
});

test("beta feedback persists only the authenticated user ID and normalized message", async () => {
  const values: unknown[][] = [];
  const repository = new PostgresBetaFeedbackRepository({
    query: async (_sql, parameters) => {
      values.push([...parameters]);
      return { rows: [{ id: "11111111-1111-4111-8111-111111111111", created_at: "2026-09-29T00:00:00.000Z" }] };
    }
  });

  assert.deepEqual(await repository.create({ userId: "22222222-2222-4222-8222-222222222222", message: "  More pickup filters  " }), {
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-09-29T00:00:00.000Z"
  });
  assert.deepEqual(values, [["22222222-2222-4222-8222-222222222222", "More pickup filters"]]);
});

test("beta feedback review is bounded and returns only persisted fields", async () => {
  const repository = new PostgresBetaFeedbackRepository({
    query: async () => ({ rows: [{
      id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      message: "More pickup filters",
      created_at: "2026-09-29T00:00:00.000Z",
      reviewed_at: null
    }] })
  });
  assert.deepEqual(await repository.getRecent(), [{
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    message: "More pickup filters",
    createdAt: "2026-09-29T00:00:00.000Z",
    reviewedAt: null
  }]);
  await assert.rejects(() => repository.getRecent(101));
});

test("beta feedback review updates only an open item and returns its persisted review time", async () => {
  let parameters: readonly unknown[] | undefined;
  const repository = new PostgresBetaFeedbackRepository({
    query: async (_sql, values) => {
      parameters = values;
      return { rows: [{
        id: "11111111-1111-4111-8111-111111111111",
        user_id: "22222222-2222-4222-8222-222222222222",
        message: "More pickup filters",
        created_at: "2026-09-29T00:00:00.000Z",
        reviewed_at: "2026-09-29T01:00:00.000Z"
      }] };
    }
  });

  assert.deepEqual(await repository.markReviewed("11111111-1111-4111-8111-111111111111"), {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    message: "More pickup filters",
    createdAt: "2026-09-29T00:00:00.000Z",
    reviewedAt: "2026-09-29T01:00:00.000Z"
  });
  assert.deepEqual(parameters, ["11111111-1111-4111-8111-111111111111"]);
});
