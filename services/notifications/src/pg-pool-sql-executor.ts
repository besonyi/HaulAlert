import type { SqlExecutor, SqlQueryResult } from "./postgres-notification-delivery-repository.js";

/** The parameterized subset of pg.Pool used by the notification service. */
export interface QueryablePgPool {
  query(
    statement: string,
    parameters: unknown[]
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

/** Adapts pg.Pool to HaulAlert's parameterized persistence boundary. */
export class PgPoolSqlExecutor implements SqlExecutor {
  public constructor(private readonly pool: QueryablePgPool) {}

  public async query(statement: string, parameters: readonly unknown[]): Promise<SqlQueryResult> {
    const result = await this.pool.query(statement, [...parameters]);
    return { rows: result.rows as readonly Record<string, unknown>[] };
  }
}

/** Reads a valid PostgreSQL connection URL without leaking its credential. */
export function getDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL must be configured before PostgreSQL persistence can be used");
  }

  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// protocol");
  }

  return databaseUrl;
}
