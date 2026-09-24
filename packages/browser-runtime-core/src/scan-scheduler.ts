import type { PersistentSearchTab } from "./index.js";

export interface ScanOutcome {
  readonly newLoadCount: number;
  readonly overflowRisk: boolean;
}

export interface ScanSchedulePolicy {
  /** Normal repeat interval for a quiet search. Defaults to 30 seconds. */
  readonly idleIntervalMs: number;
  /** Faster repeat interval after at least one new load. Defaults to 10 seconds. */
  readonly activeIntervalMs: number;
  /** Fastest interval after a capped result window misses its boundary. Defaults to 5 seconds. */
  readonly overflowIntervalMs: number;
}

export interface ScheduledScan {
  readonly tab: PersistentSearchTab;
  readonly dueAt: Date;
  readonly intervalMs: number;
  readonly reason: "initial" | "overflow-risk" | "active" | "idle";
}

const defaultPolicy: ScanSchedulePolicy = {
  idleIntervalMs: 30_000,
  activeIntervalMs: 10_000,
  overflowIntervalMs: 5_000
};

/**
 * Prioritizes persisted search tabs without provider-specific timing rules.
 * Scan outcomes live outside tab state so the scheduler can be replaced by a
 * durable distributed implementation without changing runtime allocation.
 */
export class ScanScheduler {
  private readonly policy: ScanSchedulePolicy;
  private readonly outcomes = new Map<string, ScanOutcome>();

  public constructor(policy: Partial<ScanSchedulePolicy> = {}) {
    this.policy = { ...defaultPolicy, ...policy };
    for (const [name, value] of Object.entries(this.policy)) {
      if (!Number.isFinite(value) || value < 1) throw new Error(`${name} must be a positive number`);
    }
  }

  public recordOutcome(tabId: string, outcome: ScanOutcome): void {
    if (!Number.isInteger(outcome.newLoadCount) || outcome.newLoadCount < 0) {
      throw new Error("newLoadCount must be a non-negative integer");
    }
    this.outcomes.set(tabId, outcome);
  }

  public forget(tabId: string): void {
    this.outcomes.delete(tabId);
  }

  /** Returns the due tabs in urgency order, respecting the caller's batch limit. */
  public selectDue(
    tabs: readonly PersistentSearchTab[],
    now: Date = new Date(),
    limit: number = tabs.length
  ): readonly ScheduledScan[] {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
    return tabs
      .filter((tab) => tab.status === "ready")
      .map((tab) => this.createSchedule(tab))
      .filter((schedule) => schedule.dueAt <= now)
      .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime()
        || priority(left.reason) - priority(right.reason)
        || left.tab.id.localeCompare(right.tab.id))
      .slice(0, limit);
  }

  private createSchedule(tab: PersistentSearchTab): ScheduledScan {
    if (tab.lastScanAt === null) {
      return { tab, dueAt: new Date(0), intervalMs: 0, reason: "initial" };
    }
    const lastScan = new Date(tab.lastScanAt);
    if (Number.isNaN(lastScan.getTime())) {
      return { tab, dueAt: new Date(0), intervalMs: 0, reason: "initial" };
    }
    const outcome = this.outcomes.get(tab.id);
    const reason = outcome?.overflowRisk === true
      ? "overflow-risk"
      : outcome !== undefined && outcome.newLoadCount > 0
        ? "active"
        : "idle";
    const intervalMs = reason === "overflow-risk"
      ? this.policy.overflowIntervalMs
      : reason === "active"
        ? this.policy.activeIntervalMs
        : this.policy.idleIntervalMs;
    return { tab, dueAt: new Date(lastScan.getTime() + intervalMs), intervalMs, reason };
  }
}

function priority(reason: ScheduledScan["reason"]): number {
  return { initial: 0, "overflow-risk": 1, active: 2, idle: 3 }[reason];
}
