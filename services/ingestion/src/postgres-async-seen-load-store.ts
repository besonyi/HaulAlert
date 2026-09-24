import type { AsyncSeenLoadStore } from "@haulalert/new-load-detector";
import type { SqlExecutor } from "@haulalert/notification-service";

/** PostgreSQL-backed boundary state for resilient provider result scanning. */
export class PostgresAsyncSeenLoadStore implements AsyncSeenLoadStore {
  public constructor(private readonly database: SqlExecutor) {}

  public async has(searchId: string, loadKey: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1 FROM search_seen_loads WHERE load_key = $1 LIMIT 1`,
      [loadKey]
    );
    return result.rows.length > 0;
  }

  public async add(searchId: string, loadKey: string): Promise<void> {
    await this.database.query(
      `INSERT INTO search_seen_loads (search_id, load_key)
      VALUES ($1, $2)
      ON CONFLICT (load_key) DO NOTHING`,
      [searchId, loadKey]
    );
  }

  public async isSearchInitialized(searchId: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1 FROM search_initializations WHERE search_id = $1 LIMIT 1`,
      [searchId]
    );
    return result.rows.length > 0;
  }

  public async markSearchInitialized(searchId: string): Promise<void> {
    await this.database.query(
      `INSERT INTO search_initializations (search_id)
      VALUES ($1)
      ON CONFLICT (search_id) DO NOTHING`,
      [searchId]
    );
  }
}
