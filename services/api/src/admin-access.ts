export type AdminRole = "viewer" | "operator";

export interface AdminAccessConfig {
  readonly viewerTelegramUserIds: readonly string[];
  readonly operatorTelegramUserIds: readonly string[];
}

/** Parses the legacy full-access allowlist. New deployments should use role-specific lists. */
export function getAdminTelegramUserIds(value: string | undefined): readonly string[] {
  return parseTelegramUserIds(value, "ADMIN_TELEGRAM_USER_IDS");
}

export function isAdminTelegramUser(telegramUserId: string, allowedIds: readonly string[]): boolean {
  return allowedIds.includes(telegramUserId);
}

/** Builds least-privilege Telegram roles; legacy admins retain their existing operator access. */
export function getAdminAccessConfig(environment: Partial<Pick<NodeJS.ProcessEnv, "ADMIN_TELEGRAM_USER_IDS" | "ADMIN_VIEWER_TELEGRAM_USER_IDS" | "ADMIN_OPERATOR_TELEGRAM_USER_IDS">>): AdminAccessConfig {
  const legacyOperators = getAdminTelegramUserIds(environment.ADMIN_TELEGRAM_USER_IDS);
  const viewerTelegramUserIds = parseTelegramUserIds(environment.ADMIN_VIEWER_TELEGRAM_USER_IDS, "ADMIN_VIEWER_TELEGRAM_USER_IDS");
  const operatorTelegramUserIds = [...new Set([
    ...legacyOperators,
    ...parseTelegramUserIds(environment.ADMIN_OPERATOR_TELEGRAM_USER_IDS, "ADMIN_OPERATOR_TELEGRAM_USER_IDS")
  ])];
  return { viewerTelegramUserIds, operatorTelegramUserIds };
}

export function getAdminRole(telegramUserId: string, config: AdminAccessConfig): AdminRole | undefined {
  if (config.operatorTelegramUserIds.includes(telegramUserId)) return "operator";
  return config.viewerTelegramUserIds.includes(telegramUserId) ? "viewer" : undefined;
}

function parseTelegramUserIds(value: string | undefined, variableName: string): readonly string[] {
  if (value === undefined || value.trim() === "") return [];
  const ids = value.split(",").map((item) => item.trim());
  if (ids.some((id) => !/^\d+$/.test(id))) throw new Error(`${variableName} must be a comma-separated list of Telegram numeric IDs`);
  return [...new Set(ids)];
}
