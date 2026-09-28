import assert from "node:assert/strict";
import test from "node:test";

import { telegramReferralShareUrl } from "./referral-share.js";

test("Mini App builds a Telegram share URL from its public invite link", () => {
  const share = new URL(telegramReferralShareUrl("https://t.me/HaulAlertBot?start=ref_A7K92D4F"));
  assert.equal(share.origin, "https://t.me");
  assert.equal(share.pathname, "/share/url");
  assert.equal(share.searchParams.get("url"), "https://t.me/HaulAlertBot?start=ref_A7K92D4F");
  assert.match(share.searchParams.get("text") ?? "", /HaulAlert/);
});

test("Mini App refuses non-Telegram referral links", () => {
  assert.throws(() => telegramReferralShareUrl("https://example.test/invite"), /secure Telegram/);
  assert.throws(() => telegramReferralShareUrl("javascript:alert(1)"), /secure Telegram/);
});
