import assert from "node:assert/strict";
import test from "node:test";

import type { SqlExecutor } from "@haulalert/notification-service";

import { PostgresDashboardRepository } from "./index.js";

test("Postgres dashboard scopes counts and recent deliveries to the current user", async () => {
  const calls: { statement: string; parameters: readonly unknown[] }[] = [];
  const database: SqlExecutor = {
    query: async (statement, parameters) => {
      calls.push({ statement, parameters });
      if (calls.length === 1) return { rows: [{ active_alert_count: "2", loads_found_last_24_hours: "3" }] };
      return { rows: [{
        delivery_id: "11111111-1111-4111-8111-111111111111",
        alert_name: "California to Arizona",
        status: "sent",
        created_at: "2026-09-23T12:00:00.000Z",
        sent_at: "2026-09-23T12:00:02.000Z",
        normalized_load: {
          provider: "central-dispatch",
          providerLoadId: "829181",
          pickup: { city: "Stockton", state: "CA", postalCode: null, coordinates: null },
          delivery: { city: "Phoenix", state: "AZ", postalCode: null, coordinates: null },
          vehicleCount: 3,
          trailerType: "open",
          payUsd: 2100,
          distanceMiles: 730,
          ratePerMile: 2.88,
          readyAt: null,
          postedAt: null,
          sourceUrl: null,
          broker: null
        }
      }] };
    }
  };

  const dashboard = await new PostgresDashboardRepository(database).getForUser(
    "22222222-2222-4222-8222-222222222222"
  );

  assert.equal(dashboard.activeAlertCount, 2);
  assert.equal(dashboard.loadsFoundLast24Hours, 3);
  assert.equal(dashboard.recentNotifications[0]?.load.providerLoadId, "829181");
  assert.match(calls[0]?.statement ?? "", /status = 'active'/);
  assert.deepEqual(calls[0]?.parameters, ["22222222-2222-4222-8222-222222222222"]);
  assert.match(calls[1]?.statement ?? "", /WHERE d\.user_id = \$1::uuid/);
  assert.deepEqual(calls[1]?.parameters, ["22222222-2222-4222-8222-222222222222", 8]);
});
