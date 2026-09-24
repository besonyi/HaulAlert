import assert from "node:assert/strict";
import test from "node:test";
import { getAdminTelegramUserIds, isAdminTelegramUser } from "./admin-access.js";
test("admin allowlist accepts only configured Telegram numeric IDs", () => {
  assert.deepEqual(getAdminTelegramUserIds(" 1,2,1 "), ["1", "2"]);
  assert.equal(isAdminTelegramUser("2", getAdminTelegramUserIds("1,2")), true);
  assert.throws(() => getAdminTelegramUserIds("admin"), /ADMIN_TELEGRAM_USER_IDS/);
});
