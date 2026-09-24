/** Parses the explicit Telegram allowlist used before persistent admin roles exist. */
export function getAdminTelegramUserIds(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === "") return [];
  const ids = value.split(",").map((item) => item.trim());
  if (ids.some((id) => !/^\d+$/.test(id))) throw new Error("ADMIN_TELEGRAM_USER_IDS must be a comma-separated list of Telegram numeric IDs");
  return [...new Set(ids)];
}

export function isAdminTelegramUser(telegramUserId: string, allowedIds: readonly string[]): boolean {
  return allowedIds.includes(telegramUserId);
}
