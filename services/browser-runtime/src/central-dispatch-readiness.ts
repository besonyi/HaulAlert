import type { ChromeDevToolsRuntime } from "./central-dispatch-cdp-executor.js";

export type CentralDispatchReadiness =
  | { readonly status: "ready" }
  | { readonly status: "offline"; readonly error: Error };

/**
 * Verifies that a local, already-authenticated Central Dispatch page can be
 * reached. It deliberately does not inspect browser cookies or page content.
 */
export async function checkCentralDispatchReadiness(
  runtime: ChromeDevToolsRuntime
): Promise<CentralDispatchReadiness> {
  try {
    await runtime.findCentralDispatchTarget();
    return { status: "ready" };
  } catch (cause) {
    return {
      status: "offline",
      error: cause instanceof Error ? cause : new Error("Central Dispatch browser session is unavailable")
    };
  }
}
