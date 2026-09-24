import type { BrowserRuntime, PersistentSearchTab } from "@haulalert/browser-runtime-core";

export type CentralDispatchTabLogger = (message: string) => void;

/**
 * Emits tab-state transitions for operators without exposing provider filters,
 * browser credentials, or raw browser errors.
 */
export class CentralDispatchTabReporter {
  private readonly previousState = new Map<string, string>();

  public constructor(
    private readonly runtime: BrowserRuntime,
    private readonly log: CentralDispatchTabLogger
  ) {}

  public report(): void {
    for (const tab of this.runtime.listTabs("central-dispatch")) {
      const state = `${tab.status}:${tab.recoveryAttemptCount}:${tab.nextRecoveryAt ?? ""}`;
      if (this.previousState.get(tab.id) === state) continue;
      this.previousState.set(tab.id, state);
      this.log(tabMessage(tab));
    }
  }
}

function tabMessage(tab: PersistentSearchTab): string {
  if (tab.status !== "degraded") return `Central Dispatch tab ${tab.id} is ${tab.status}.`;
  const nextRecovery = tab.nextRecoveryAt ?? "not scheduled";
  return `Central Dispatch tab ${tab.id} is degraded; recovery attempt ${tab.recoveryAttemptCount}, next recovery ${nextRecovery}.`;
}
