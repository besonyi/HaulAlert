import type { SupportedProvider } from "@haulalert/shared";

export type SessionStatus = "healthy" | "degraded" | "expired" | "recovering" | "offline";
export type SearchTabStatus = "provisioning" | "ready" | "degraded" | "closed";

export interface BrowserSession {
  readonly id: string;
  readonly provider: SupportedProvider;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly lastHeartbeatAt: string | null;
}

export interface PersistentSearchTab {
  readonly id: string;
  /** Durable provider_searches.id when the tab is backed by PostgreSQL. */
  readonly providerSearchId: string | null;
  readonly sessionId: string;
  readonly provider: SupportedProvider;
  readonly sourceFilterHash: string;
  readonly status: SearchTabStatus;
  readonly createdAt: string;
  readonly lastScanAt: string | null;
}

export interface SearchTabReservation {
  readonly tab: PersistentSearchTab;
  readonly reused: boolean;
}

export class NoHealthySessionError extends Error {
  public constructor(provider: SupportedProvider) {
    super(`No healthy browser session is available for provider: ${provider}`);
    this.name = "NoHealthySessionError";
  }
}

export class UnknownRuntimeResourceError extends Error {
  public constructor(kind: "session" | "tab", id: string) {
    super(`Unknown browser runtime ${kind}: ${id}`);
    this.name = "UnknownRuntimeResourceError";
  }
}

export interface BrowserRuntimeOptions {
  readonly now?: () => Date;
  readonly createTabId?: () => string;
}

/**
 * In-memory coordination model for provider browser sessions and persistent
 * searches. Persistence and distributed locking are added at the service layer
 * later; the allocation invariants live here so they are testable now.
 */
export class BrowserRuntime {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly tabs = new Map<string, PersistentSearchTab>();
  private readonly now: () => Date;
  private readonly createTabId: () => string;

  public constructor(options: BrowserRuntimeOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createTabId = options.createTabId ?? (() => crypto.randomUUID());
  }

  public registerSession(input: { id: string; provider: SupportedProvider }): BrowserSession {
    const session: BrowserSession = {
      id: input.id,
      provider: input.provider,
      status: "healthy",
      createdAt: this.timestamp(),
      lastHeartbeatAt: null
    };

    this.sessions.set(session.id, session);
    return session;
  }

  public setSessionStatus(id: string, status: SessionStatus): BrowserSession {
    const session = this.getSession(id);
    const updated = { ...session, status };
    this.sessions.set(id, updated);
    return updated;
  }

  public recordHeartbeat(id: string): BrowserSession {
    const session = this.getSession(id);
    const updated = { ...session, status: "healthy" as const, lastHeartbeatAt: this.timestamp() };
    this.sessions.set(id, updated);
    return updated;
  }

  public reserveSearchTab(input: {
    provider: SupportedProvider;
    sourceFilterHash: string;
    providerSearchId?: string;
  }): SearchTabReservation {
    const reusableTab = [...this.tabs.values()].find((tab) => {
      const session = this.sessions.get(tab.sessionId);
      return tab.provider === input.provider
        && tab.sourceFilterHash === input.sourceFilterHash
        && tab.status === "ready"
        && session?.status === "healthy";
    });

    if (reusableTab !== undefined) {
      return { tab: reusableTab, reused: true };
    }

    const session = this.pickHealthySession(input.provider);
    const tab: PersistentSearchTab = {
      id: this.createTabId(),
      providerSearchId: input.providerSearchId ?? null,
      sessionId: session.id,
      provider: input.provider,
      sourceFilterHash: input.sourceFilterHash,
      status: "provisioning",
      createdAt: this.timestamp(),
      lastScanAt: null
    };

    this.tabs.set(tab.id, tab);
    return { tab, reused: false };
  }

  public markTabReady(id: string): PersistentSearchTab {
    return this.updateTab(id, { status: "ready" });
  }

  public markTabDegraded(id: string): PersistentSearchTab {
    return this.updateTab(id, { status: "degraded" });
  }

  public recordScan(id: string): PersistentSearchTab {
    const tab = this.getTab(id);
    if (tab.status !== "ready") {
      throw new Error(`Cannot record a scan for a ${tab.status} tab: ${id}`);
    }

    return this.updateTab(id, { lastScanAt: this.timestamp() });
  }

  public closeTab(id: string): PersistentSearchTab {
    return this.updateTab(id, { status: "closed" });
  }

  public listSessions(provider?: SupportedProvider): readonly BrowserSession[] {
    return [...this.sessions.values()].filter((session) => provider === undefined || session.provider === provider);
  }

  public listTabs(provider?: SupportedProvider): readonly PersistentSearchTab[] {
    return [...this.tabs.values()].filter((tab) => provider === undefined || tab.provider === provider);
  }

  /** Tabs that may be scanned now without using a degraded browser session. */
  public listScannableTabs(provider?: SupportedProvider): readonly PersistentSearchTab[] {
    return this.listTabs(provider).filter((tab) => (
      tab.status === "ready" && this.sessions.get(tab.sessionId)?.status === "healthy"
    ));
  }

  private pickHealthySession(provider: SupportedProvider): BrowserSession {
    const candidates = this.listSessions(provider)
      .filter((session) => session.status === "healthy")
      .sort((left, right) => this.activeTabCount(left.id) - this.activeTabCount(right.id) || left.id.localeCompare(right.id));

    const session = candidates[0];
    if (session === undefined) {
      throw new NoHealthySessionError(provider);
    }

    return session;
  }

  private activeTabCount(sessionId: string): number {
    return [...this.tabs.values()].filter(
      (tab) => tab.sessionId === sessionId && tab.status !== "closed"
    ).length;
  }

  private getSession(id: string): BrowserSession {
    const session = this.sessions.get(id);
    if (session === undefined) {
      throw new UnknownRuntimeResourceError("session", id);
    }

    return session;
  }

  private getTab(id: string): PersistentSearchTab {
    const tab = this.tabs.get(id);
    if (tab === undefined) {
      throw new UnknownRuntimeResourceError("tab", id);
    }

    return tab;
  }

  private updateTab(id: string, update: Partial<PersistentSearchTab>): PersistentSearchTab {
    const tab = this.getTab(id);
    const updated = { ...tab, ...update };
    this.tabs.set(id, updated);
    return updated;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export { ScanScheduler, type ScanOutcome, type ScanSchedulePolicy, type ScheduledScan } from "./scan-scheduler.js";
