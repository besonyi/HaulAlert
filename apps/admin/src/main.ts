import { AdminApiClient, AdminApiError, type OperationalCount, type OperationalRecoveryItem } from "./api.js";

interface TelegramWebApp {
  readonly initData: string;
  readonly initDataUnsafe?: { readonly user?: { readonly first_name?: string } };
  ready(): void;
  expand(): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

const root = getRoot();
const telegram = window.Telegram?.WebApp;
telegram?.ready();
telegram?.expand();

const client = telegram?.initData === undefined ? undefined : new AdminApiClient(telegram.initData);
void refresh();

async function refresh(): Promise<void> {
  if (client === undefined) {
    renderError("Open HaulAlert Admin from Telegram.");
    return;
  }
  root.innerHTML = loadingMarkup();
  try {
    renderOverview(await client.getOverview());
  } catch (error: unknown) {
    renderError(messageFor(error));
  }
}

function renderOverview(overview: Awaited<ReturnType<AdminApiClient["getOverview"]>>): void {
  root.innerHTML = `<main class="shell">
    <header><div><p class="eyebrow">HAULALERT · OPERATIONS</p><h1>System health</h1></div><button class="refresh" type="button" data-refresh>Refresh</button></header>
    <p class="operator">Signed in as ${escapeHtml(telegram?.initDataUnsafe?.user?.first_name ?? "operator")}</p>
    <section class="totals" aria-label="System totals">
      ${total("Users", overview.users)}${total("Active alerts", overview.activeAlerts)}${total("Loads", overview.loads)}
    </section>
    <section class="groups">
      ${group("Provider sessions", overview.sessions, "No provider sessions recorded.")}
      ${group("Search tabs", overview.tabs, "No search tabs recorded.")}
      ${group("Delivery outcomes", overview.deliveries, "No delivery outcomes recorded.")}
    </section>
    ${recoveryMarkup(overview.recovery)}
    <p class="footnote">Operational counts are credential-free and refresh on demand.</p>
  </main>`;
  root.querySelectorAll<HTMLButtonElement>("[data-refresh]").forEach((button) => {
    button.addEventListener("click", () => { void refresh(); });
  });
}

function renderError(message: string): void {
  root.innerHTML = `<main class="shell"><header><div><p class="eyebrow">HAULALERT · OPERATIONS</p><h1>System health</h1></div></header><section class="error" role="alert"><h2>Access unavailable</h2><p>${escapeHtml(message)}</p></section></main>`;
}

function loadingMarkup(): string {
  return `<main class="shell"><header><div><p class="eyebrow">HAULALERT · OPERATIONS</p><h1>System health</h1></div></header><p class="loading" role="status">Loading operational data…</p></main>`;
}

function total(label: string, value: number): string {
  return `<article class="total"><span>${escapeHtml(label)}</span><strong>${value.toLocaleString()}</strong></article>`;
}

function group(title: string, entries: readonly OperationalCount[], empty: string): string {
  return `<section class="group"><h2>${escapeHtml(title)}</h2>${entries.length === 0
    ? `<p class="empty">${escapeHtml(empty)}</p>`
    : `<dl>${entries.map((entry) => `<div><dt>${escapeHtml(entry.key.replaceAll(":", " · "))}</dt><dd>${entry.count.toLocaleString()}</dd></div>`).join("")}</dl>`}</section>`;
}

function recoveryMarkup(items: readonly OperationalRecoveryItem[]): string {
  if (items.length === 0) return `<section class="recovery healthy"><h2>Recovery</h2><p>No active session, tab, or scan recovery is needed.</p></section>`;
  return `<section class="recovery"><div class="recovery-heading"><div><h2>Recovery needed</h2><p>Safe runtime status only — no provider credentials are shown.</p></div><button class="refresh" type="button" data-refresh>Check again</button></div><div class="recovery-list">${items.map(recoveryItemMarkup).join("")}</div></section>`;
}

function recoveryItemMarkup(item: OperationalRecoveryItem): string {
  const nextAttempt = item.nextRecoveryAt === null ? "" : `<span>Automatic retry: ${escapeHtml(formatTime(item.nextRecoveryAt))}</span>`;
  return `<article class="recovery-item"><div><strong>${escapeHtml(item.provider)} · ${escapeHtml(item.kind)}</strong><span>${escapeHtml(item.code.replaceAll("_", " ").replaceAll("-", " "))}</span>${nextAttempt}</div><p>${escapeHtml(recoveryAction(item))}</p></article>`;
}

function recoveryAction(item: OperationalRecoveryItem): string {
  if (item.kind === "tab") {
    return item.nextRecoveryAt === null
      ? "The runtime will reconfigure this search on its next healthy cycle. Check again after the worker runs."
      : "Automatic recovery is queued. If it remains degraded after that time, confirm the provider page is still open on the runtime host.";
  }
  if (item.kind === "session") {
    if (item.code === "expired") return "Open the provider page on the runtime host and sign in again, then use Check again.";
    return "Confirm the runtime host and its authenticated provider page are available, then use Check again.";
  }
  return "The runtime will retry on the next scheduled scan. If this repeats, verify the provider page and its search results on the runtime host.";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function messageFor(error: unknown): string {
  if (error instanceof AdminApiError && error.statusCode === 403) return "Your Telegram account is not authorized for operations.";
  if (error instanceof AdminApiError && error.statusCode === 401) return "Telegram session expired. Close and reopen HaulAlert Admin.";
  return "Operational data could not be loaded. Try again shortly.";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character] ?? character);
}

function getRoot(): HTMLElement {
  const element = document.querySelector<HTMLElement>("#app");
  if (element === null) throw new Error("Missing application root");
  return element;
}
