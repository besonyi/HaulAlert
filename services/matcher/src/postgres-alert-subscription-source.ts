import { AlertCandidateIndex, type AlertMatch, type AlertSubscription } from "@haulalert/alert-matcher";
import { parseCanonicalFilter } from "@haulalert/canonical-filter";
import type { NormalizedLoad } from "@haulalert/load-model";
import type { SqlExecutor } from "@haulalert/notification-service";

export interface ActiveAlertSubscriptionSource {
  listActive(): Promise<readonly AlertSubscription[]>;
}

/** Reads only alerts that have both an active status and a private Telegram destination. */
export class PostgresAlertSubscriptionSource implements ActiveAlertSubscriptionSource {
  public constructor(private readonly database: SqlExecutor) {}

  public async listActive(): Promise<readonly AlertSubscription[]> {
    const result = await this.database.query(
      `SELECT a.id AS alert_id, a.user_id, u.telegram_chat_id, a.canonical_filter
      FROM alerts AS a
      INNER JOIN users AS u ON u.id = a.user_id
      WHERE a.status = 'active' AND u.telegram_chat_id IS NOT NULL
      ORDER BY a.id ASC`,
      []
    );
    return result.rows.map(parseSubscription);
  }
}

/**
 * Caches durable active subscriptions in the existing provider candidate index.
 * A refresh atomically swaps the full index, so a paused/deleted alert cannot
 * leave stale partial state behind.
 */
export class RefreshingAlertCandidateIndex {
  private index = new AlertCandidateIndex();
  private refreshedAt: Date | undefined;
  private refreshInFlight: Promise<void> | undefined;

  public constructor(
    private readonly source: ActiveAlertSubscriptionSource,
    private readonly refreshIntervalMs: number = 5_000
  ) {
    if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs < 0) {
      throw new Error("refreshIntervalMs must be a non-negative number");
    }
  }

  public async findMatches(load: NormalizedLoad, now: Date = new Date()): Promise<readonly AlertMatch[]> {
    if (this.isStale(now)) await this.refresh(now);
    return this.index.findMatches(load, now);
  }

  public async refresh(now: Date = new Date()): Promise<void> {
    if (this.refreshInFlight !== undefined) return this.refreshInFlight;
    this.refreshInFlight = this.source.listActive()
      .then((subscriptions) => {
        const replacement = new AlertCandidateIndex();
        for (const subscription of subscriptions) replacement.upsert(subscription);
        this.index = replacement;
        this.refreshedAt = now;
      })
      .finally(() => {
        this.refreshInFlight = undefined;
      });
    return this.refreshInFlight;
  }

  private isStale(now: Date): boolean {
    return this.refreshedAt === undefined || now.getTime() - this.refreshedAt.getTime() >= this.refreshIntervalMs;
  }
}

function parseSubscription(row: Record<string, unknown>): AlertSubscription {
  return {
    alertId: requiredString(row.alert_id, "alert_id"),
    userId: requiredString(row.user_id, "user_id"),
    telegramChatId: String(requiredTelegramChatId(row.telegram_chat_id)),
    filter: parseCanonicalFilter(parseJson(row.canonical_filter))
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${field} from active alert query`);
  return value;
}

function requiredTelegramChatId(value: unknown): string | number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("Expected telegram_chat_id from active alert query");
  }
  return value;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("Expected canonical_filter from active alert query to be JSON");
  }
}
