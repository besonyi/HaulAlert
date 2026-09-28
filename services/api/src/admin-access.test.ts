import assert from "node:assert/strict";
import test from "node:test";
import { getAdminAccessConfig, getAdminRole, getAdminTelegramUserIds, isAdminTelegramUser } from "./admin-access.js";
test("admin allowlist accepts only configured Telegram numeric IDs", () => {
  assert.deepEqual(getAdminTelegramUserIds(" 1,2,1 "), ["1", "2"]);
  assert.equal(isAdminTelegramUser("2", getAdminTelegramUserIds("1,2")), true);
  assert.throws(() => getAdminTelegramUserIds("admin"), /ADMIN_TELEGRAM_USER_IDS/);
});

test("admin access separates viewer reads from operator actions while keeping legacy admins", () => {
  const access = getAdminAccessConfig({
    ADMIN_TELEGRAM_USER_IDS: "1",
    ADMIN_VIEWER_TELEGRAM_USER_IDS: "2,3",
    ADMIN_OPERATOR_TELEGRAM_USER_IDS: "3,4"
  });
  assert.deepEqual(access, { viewerTelegramUserIds: ["2", "3"], operatorTelegramUserIds: ["1", "3", "4"] });
  assert.equal(getAdminRole("1", access), "operator");
  assert.equal(getAdminRole("2", access), "viewer");
  assert.equal(getAdminRole("3", access), "operator");
  assert.equal(getAdminRole("9", access), undefined);
  assert.throws(() => getAdminAccessConfig({ ADMIN_VIEWER_TELEGRAM_USER_IDS: "viewer" }), /ADMIN_VIEWER_TELEGRAM_USER_IDS/);
});
