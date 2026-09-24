import type { SqlExecutor } from "@haulalert/notification-service";

export interface BrokerProfile {
  readonly name: string;
  readonly mcNumber: string | null;
  readonly dotNumber: string | null;
  readonly matchedLoadCount: number;
}

/** Customer-safe broker directory, derived from normalized historical loads. */
export class PostgresBrokerDirectoryRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async search(query: string): Promise<readonly BrokerProfile[]> {
    const term = normalizeBrokerQuery(query);
    const result = await this.database.query(`SELECT
        normalized_load->'broker'->>'name' AS name,
        normalized_load->'broker'->>'mcNumber' AS mc_number,
        normalized_load->'broker'->>'dotNumber' AS dot_number,
        count(*) AS matched_load_count
      FROM loads
      WHERE normalized_load->'broker' IS NOT NULL
        AND (normalized_load->'broker'->>'name' ILIKE '%' || $1 || '%'
          OR normalized_load->'broker'->>'mcNumber' ILIKE '%' || $1 || '%'
          OR normalized_load->'broker'->>'dotNumber' ILIKE '%' || $1 || '%')
      GROUP BY normalized_load->'broker'->>'name', normalized_load->'broker'->>'mcNumber', normalized_load->'broker'->>'dotNumber'
      ORDER BY count(*) DESC, lower(normalized_load->'broker'->>'name') ASC
      LIMIT 20`, [term]);
    return result.rows.map(profile);
  }
}

export function normalizeBrokerQuery(value: string): string {
  const query = value.trim();
  if (query.length < 2 || query.length > 80) throw new Error("Broker search query must contain between 2 and 80 characters");
  return query;
}

function profile(row: Record<string, unknown>): BrokerProfile {
  return {
    name: text(row.name, "broker name"),
    mcNumber: nullableText(row.mc_number, "MC number"),
    dotNumber: nullableText(row.dot_number, "DOT number"),
    matchedLoadCount: count(row.matched_load_count)
  };
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Expected ${name}`);
  return value;
}

function nullableText(value: unknown, name: string): string | null {
  return value === null || value === undefined ? null : text(value, name);
}

function count(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error("Expected broker load count");
  return result;
}
