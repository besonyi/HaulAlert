import type { NewLoadScanResult, OrderedLoadScan } from "@haulalert/new-load-detector";
import type { SqlExecutor } from "@haulalert/notification-service";

export interface CompletedProviderScan {
  readonly providerSearchId: string;
  readonly scan: OrderedLoadScan;
  readonly startedAt: Date;
  readonly completedAt: Date;
}

export interface ScanHistoryRecorder {
  record(input: CompletedProviderScan, result: NewLoadScanResult): Promise<void>;
}

/** Stores enough scan telemetry to reconstruct a new-load detection decision. */
export class PostgresScanHistoryRecorder implements ScanHistoryRecorder {
  public constructor(private readonly database: SqlExecutor) {}

  public async record(input: CompletedProviderScan, result: NewLoadScanResult): Promise<void> {
    if (input.completedAt < input.startedAt) throw new Error("Scan completion cannot precede its start");
    await this.database.query(
      `INSERT INTO provider_scans (
        provider_search_id, started_at, completed_at, result_count, new_load_count, boundary_found, overflow_risk
      ) VALUES ($1::uuid, $2::timestamptz, $3::timestamptz, $4, $5, $6, $7)`,
      [
        input.providerSearchId,
        input.startedAt.toISOString(),
        input.completedAt.toISOString(),
        input.scan.loads.length,
        result.newLoads.length,
        result.boundaryFound,
        result.overflowRisk
      ]
    );
  }
}
