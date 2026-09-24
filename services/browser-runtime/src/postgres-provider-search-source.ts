import type { ProviderSearchActivation } from "./index.js";
import type { RuntimeSqlExecutor } from "./postgres-runtime-state-store.js";

export interface ActiveProviderSearch extends ProviderSearchActivation {
  readonly id: string;
}

/** Reads active, credential-free provider searches created by the alert API. */
export class PostgresProviderSearchSource {
  public constructor(private readonly database: RuntimeSqlExecutor) {}

  public async listActiveCentralDispatchSearches(): Promise<readonly ActiveProviderSearch[]> {
    const result = await this.database.query(
      `SELECT searches.id, searches.provider, searches.source_filter_hash, searches.source_filter
       FROM provider_searches AS searches
       WHERE searches.provider = 'central-dispatch' AND searches.status = 'active'
         AND EXISTS (
           SELECT 1
           FROM alert_provider_searches AS links
           INNER JOIN alerts AS alerts ON alerts.id = links.alert_id
           WHERE links.provider_search_id = searches.id AND alerts.status = 'active'
         )
       ORDER BY searches.id ASC`,
      []
    );
    return result.rows.map(toSearch);
  }
}

function toSearch(row: Record<string, unknown>): ActiveProviderSearch {
  if (row.provider !== "central-dispatch") throw new Error("Invalid Central Dispatch provider search");
  return {
    id: requiredString(row.id, "id"),
    provider: "central-dispatch",
    sourceFilterHash: requiredString(row.source_filter_hash, "source_filter_hash"),
    sourceFilter: sourceFilter(row.source_filter)
  };
}

function sourceFilter(value: unknown): ProviderSearchActivation["sourceFilter"] {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Invalid Central Dispatch source_filter");
  }
  return parsed as ProviderSearchActivation["sourceFilter"];
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("Invalid Central Dispatch source_filter JSON");
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${field} from provider search query`);
  return value;
}
