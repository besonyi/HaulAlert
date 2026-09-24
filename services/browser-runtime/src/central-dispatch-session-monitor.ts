import { BrowserRuntime, type BrowserSession } from "@haulalert/browser-runtime-core";

import type { ChromeDevToolsRuntime } from "./central-dispatch-cdp-executor.js";

export interface CentralDispatchSessionProbeResult {
  readonly session: BrowserSession;
  readonly status: "healthy" | "offline";
  readonly error?: Error;
}

/**
 * Keeps runtime session availability in step with the local browser. It checks
 * only whether the Central Dispatch page is reachable; credentials remain in
 * Chrome and are never inspected by HaulAlert.
 */
export class CentralDispatchSessionMonitor {
  public constructor(
    private readonly browserRuntime: BrowserRuntime,
    private readonly chromeRuntime: ChromeDevToolsRuntime,
    private readonly sessionId: string
  ) {}

  public async probe(): Promise<CentralDispatchSessionProbeResult> {
    try {
      await this.chromeRuntime.findCentralDispatchTarget();
      return { session: this.heartbeat(), status: "healthy" };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Central Dispatch browser session is unavailable");
      return { session: this.markOffline(), status: "offline", error };
    }
  }

  private heartbeat(): BrowserSession {
    this.ensureSession();
    return this.browserRuntime.recordHeartbeat(this.sessionId);
  }

  private markOffline(): BrowserSession {
    this.ensureSession();
    return this.browserRuntime.setSessionStatus(this.sessionId, "offline");
  }

  private ensureSession(): void {
    if (this.browserRuntime.listSessions("central-dispatch").some((session) => session.id === this.sessionId)) {
      return;
    }
    this.browserRuntime.registerSession({ id: this.sessionId, provider: "central-dispatch" });
  }
}
