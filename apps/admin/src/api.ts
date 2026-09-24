export interface OperationalCount {
  readonly key: string;
  readonly count: number;
}

export interface OperationalRecoveryItem {
  readonly kind: "session" | "tab" | "scan";
  readonly provider: string;
  readonly code: string;
  readonly observedAt: string;
  readonly nextRecoveryAt: string | null;
}

export interface AdminSystemOverview {
  readonly users: number;
  readonly activeAlerts: number;
  readonly loads: number;
  readonly sessions: readonly OperationalCount[];
  readonly tabs: readonly OperationalCount[];
  readonly deliveries: readonly OperationalCount[];
  readonly recovery: readonly OperationalRecoveryItem[];
}

export interface AdminSearchResults {
  readonly users: readonly { readonly id: string; readonly telegramUserId: string; readonly createdAt: string }[];
  readonly alerts: readonly { readonly id: string; readonly name: string; readonly status: string; readonly telegramUserId: string; readonly updatedAt: string }[];
  readonly loads: readonly { readonly provider: string; readonly providerLoadId: string; readonly pickup: string; readonly delivery: string; readonly firstSeenAt: string }[];
  readonly deliveries: readonly { readonly id: string; readonly status: string; readonly alertName: string; readonly telegramUserId: string; readonly loadKey: string; readonly createdAt: string }[];
}

export class AdminApiError extends Error {
  public constructor(readonly statusCode: number, readonly code: string) {
    super(code);
  }
}

export class AdminApiClient {
  public constructor(
    private readonly initData: string,
    private readonly baseUrl: string = "/api",
    private readonly request: typeof fetch = fetch
  ) {}

  public async getOverview(): Promise<AdminSystemOverview> {
    const response = await this.request(`${this.baseUrl}/v1/admin/overview`, {
      headers: { authorization: `tma ${this.initData}` }
    });
    if (!response.ok) throw await errorFrom(response);
    return (await response.json() as { overview: AdminSystemOverview }).overview;
  }

  public async search(query: string): Promise<AdminSearchResults> {
    const response = await this.request(`${this.baseUrl}/v1/admin/search?q=${encodeURIComponent(query)}`, {
      headers: { authorization: `tma ${this.initData}` }
    });
    if (!response.ok) throw await errorFrom(response);
    return (await response.json() as { results: AdminSearchResults }).results;
  }
}

async function errorFrom(response: Response): Promise<AdminApiError> {
  const payload = await response.json().catch(() => ({ error: "request_failed" })) as { error?: unknown };
  return new AdminApiError(response.status, typeof payload.error === "string" ? payload.error : "request_failed");
}
