import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { verifyTelegramMiniAppInitData } from "./telegram-miniapp-auth.js";

const botToken = "123456:mini-app-test-token";
const now = new Date("2026-09-23T12:00:00.000Z");

describe("Telegram Mini App authentication", () => {
  it("accepts a current, correctly signed initData payload", () => {
    const initData = signInitData({
      auth_date: "1790164800",
      query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
      user: JSON.stringify({ id: 1234567890123, first_name: "Alex", username: "alex" })
    });

    assert.deepEqual(verifyTelegramMiniAppInitData(initData, botToken, now), {
      id: "1234567890123",
      firstName: "Alex",
      username: "alex"
    });
  });

  it("rejects tampered data before trusting the embedded user", () => {
    const initData = signInitData({
      auth_date: "1790164800",
      user: JSON.stringify({ id: 1, first_name: "Alex" })
    }).replace("Alex", "Mallory");

    assert.throws(() => verifyTelegramMiniAppInitData(initData, botToken, now), /signature does not match/);
  });

  it("rejects an otherwise valid authorization that is too old", () => {
    const initData = signInitData({
      auth_date: "1790074800",
      user: JSON.stringify({ id: 1, first_name: "Alex" })
    });

    assert.throws(
      () => verifyTelegramMiniAppInitData(initData, botToken, now, { maximumAgeSeconds: 60 }),
      /authorization has expired/
    );
  });
});

function signInitData(fields: Record<string, string>): string {
  const dataCheckString = Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
