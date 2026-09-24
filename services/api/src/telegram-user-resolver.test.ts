import assert from "node:assert/strict";
import test from "node:test";

import { PostgresTelegramUserResolver } from "./telegram-user-resolver.js";

test("Telegram resolver converts a verified Telegram identity to the internal account UUID", async () => {
  let parameters: readonly unknown[] | undefined;
  const resolver = new PostgresTelegramUserResolver({ query: async (_statement, values) => {
    parameters = values;
    return { rows: [{ id: "11111111-1111-4111-8111-111111111111" }] };
  } });
  assert.equal(await resolver.resolve("778899"), "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(parameters, ["778899"]);
  await assert.rejects(() => resolver.resolve("not-a-telegram-id"), /numeric/);
});
