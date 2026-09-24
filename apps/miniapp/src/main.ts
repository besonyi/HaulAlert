import type { CanonicalFilter } from "@haulalert/canonical-filter";

import {
  MiniAppApiClient,
  MiniAppApiError,
  type MiniAppAlert,
  type MiniAppDashboard
} from "./api.js";

interface TelegramWebApp {
  readonly initData: string;
  readonly initDataUnsafe?: { readonly user?: { readonly first_name?: string } };
  readonly themeParams?: Record<string, string | undefined>;
  ready(): void;
  expand(): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

const app = getApplicationRoot();

const telegram = window.Telegram?.WebApp;
telegram?.ready();
telegram?.expand();
applyTelegramTheme(telegram);

let alerts: readonly MiniAppAlert[] = [];
let dashboard: MiniAppDashboard | undefined;
let screen: "dashboard" | "create" = "dashboard";
let message = telegram?.initData ? "" : "Open HaulAlert from Telegram to manage alerts.";
const client = telegram?.initData ? new MiniAppApiClient(telegram.initData) : undefined;

void refresh();

async function refresh(): Promise<void> {
  if (client === undefined) return render();
  try {
    [alerts, dashboard] = await Promise.all([client.listAlerts(), client.getDashboard()]);
    message = "";
  } catch (error: unknown) {
    message = readableError(error);
  }
  render();
}

function render(): void {
  app.innerHTML = `
    <section class="shell">
      <header class="topbar">
        <div><p class="eyebrow">HAULALERT</p><h1>${screen === "dashboard" ? "Your alerts" : "New alert"}</h1></div>
        <div class="avatar">${escapeHtml(telegram?.initDataUnsafe?.user?.first_name?.slice(0, 1) ?? "H")}</div>
      </header>
      ${message ? `<p class="notice" role="status">${escapeHtml(message)}</p>` : ""}
      ${screen === "dashboard" ? dashboardMarkup() : createMarkup()}
      <nav class="bottom-nav" aria-label="Main navigation">
        <button class="nav-button ${screen === "dashboard" ? "selected" : ""}" data-screen="dashboard">⌂<span>Alerts</span></button>
        <button class="nav-button ${screen === "create" ? "selected" : ""}" data-screen="create">＋<span>New alert</span></button>
      </nav>
    </section>`;
  bindInteractions();
}

function dashboardMarkup(): string {
  return `<section class="content">
    <div class="summary-grid"><div class="summary"><span class="summary-count">${dashboard?.activeAlertCount ?? alerts.filter((alert) => alert.status === "active").length}</span><span>active alerts</span></div><div class="summary"><span class="summary-count">${dashboard?.loadsFoundLast24Hours ?? 0}</span><span>loads found today</span></div></div>
    ${alerts.length === 0
      ? `<div class="empty"><span class="empty-icon">⌁</span><h2>No alerts yet</h2><p>Create your first route and we’ll notify you when a matching load appears.</p><button class="primary" data-screen="create">Create alert</button></div>`
      : `<div class="cards">${alerts.map(alertMarkup).join("")}</div>`}
    ${recentNotificationsMarkup()}
  </section>`;
}

function recentNotificationsMarkup(): string {
  const notifications = dashboard?.recentNotifications ?? [];
  if (notifications.length === 0) return "";
  return `<section class="recent"><h2>Recent load alerts</h2>${notifications.map((notification) => {
    const route = `${shortLocation(notification.load.pickup)} → ${shortLocation(notification.load.delivery)}`;
    const status = notification.status === "sent" ? "Sent" : notification.status.replaceAll("_", " ");
    return `<article class="recent-item"><div><strong>${escapeHtml(route)}</strong><span>${escapeHtml(notification.alertName)} · ${escapeHtml(status)}</span></div><span class="recent-pay">${notification.load.payUsd === null ? "—" : `$${notification.load.payUsd.toLocaleString()}`}</span></article>`;
  }).join("")}</section>`;
}

function alertMarkup(alert: MiniAppAlert): string {
  const route = `${locationLabel(alert.filter.origins)} → ${locationLabel(alert.filter.destinations)}`;
  const detail = [
    alert.filter.trailerTypes.join(" / "),
    alert.filter.minimumPayUsd === null ? "Any pay" : `$${alert.filter.minimumPayUsd.toLocaleString()}+`,
    alert.filter.providers.length === 3 ? "All boards" : alert.filter.providers.join(", ")
  ].join(" · ");
  const pauseLabel = alert.status === "active" ? "Pause" : "Resume";
  return `<article class="alert-card ${alert.status === "paused" ? "paused" : ""}">
    <div class="card-heading"><div><h2>${escapeHtml(alert.name)}</h2><p>${escapeHtml(route)}</p></div><span class="status ${alert.status}">${alert.status === "active" ? "Active" : "Paused"}</span></div>
    <p class="details">${escapeHtml(detail)}</p>
    <div class="card-actions"><button data-action="toggle" data-id="${alert.id}" data-status="${alert.status}">${pauseLabel}</button><button data-action="duplicate" data-id="${alert.id}">Copy</button><button class="danger" data-action="delete" data-id="${alert.id}">Delete</button></div>
  </article>`;
}

function createMarkup(): string {
  return `<form class="content form" id="alert-form">
    <p class="form-intro">Tell us which loads to watch. You can refine locations and preferences later.</p>
    <label>Alert name<input name="name" maxlength="80" placeholder="e.g. CA → AZ open loads" required /></label>
    <div class="form-grid"><label>Origin state <input name="origin" maxlength="2" placeholder="Any" /></label><label>Destination state <input name="destination" maxlength="2" placeholder="Any" /></label></div>
    <div class="form-grid"><label>Trailer<select name="trailer"><option value="open">Open</option><option value="enclosed">Enclosed</option></select></label><label>Minimum pay<input name="minimumPay" type="number" min="0" step="50" placeholder="Any" /></label></div>
    <div class="form-grid"><label>Min vehicles<input name="minimumVehicles" type="number" min="1" step="1" placeholder="Any" /></label><label>Max vehicles<input name="maximumVehicles" type="number" min="1" step="1" placeholder="Any" /></label></div>
    <fieldset><legend>Load boards</legend><label class="check"><input type="checkbox" name="provider" value="central-dispatch" checked />Central Dispatch</label><label class="check"><input type="checkbox" name="provider" value="super-dispatch" checked />Super Dispatch</label><label class="check"><input type="checkbox" name="provider" value="shipcars" checked />Ship.Cars</label></fieldset>
    <button class="primary submit" type="submit">Start monitoring</button>
  </form>`;
}

function bindInteractions(): void {
  app.querySelectorAll<HTMLElement>("[data-screen]").forEach((element) => {
    element.addEventListener("click", () => { screen = element.dataset.screen === "create" ? "create" : "dashboard"; message = ""; render(); });
  });
  app.querySelector<HTMLFormElement>("#alert-form")?.addEventListener("submit", (event) => { void createAlert(event); });
  app.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => { void manageAlert(button); });
  });
}

async function createAlert(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (client === undefined) return;
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  try {
    const alert = await client.createAlert(filterFromForm(form));
    alerts = [alert, ...alerts];
    screen = "dashboard";
    message = "Alert is active — we’ll message you when a matching load appears.";
  } catch (error: unknown) {
    message = readableError(error);
  }
  render();
}

async function manageAlert(button: HTMLButtonElement): Promise<void> {
  if (client === undefined || button.dataset.id === undefined || button.dataset.action === undefined) return;
  const alertId = button.dataset.id;
  try {
    if (button.dataset.action === "toggle") {
      const status = button.dataset.status === "active" ? "paused" : "active";
      const updated = await client.setStatus(alertId, status);
      alerts = alerts.map((alert) => alert.id === updated.id ? updated : alert);
      message = updated.status === "active" ? "Alert resumed." : "Alert paused.";
    }
    if (button.dataset.action === "duplicate") {
      const original = alerts.find((alert) => alert.id === alertId);
      if (original === undefined) return;
      const duplicate = await client.duplicate(alertId, `${original.name} copy`);
      alerts = [duplicate, ...alerts];
      message = "Alert copied.";
    }
    if (button.dataset.action === "delete") {
      if (!window.confirm("Delete this alert?")) return;
      await client.remove(alertId);
      alerts = alerts.filter((alert) => alert.id !== alertId);
      message = "Alert deleted.";
    }
  } catch (error: unknown) {
    message = readableError(error);
  }
  render();
}

function filterFromForm(form: HTMLFormElement): CanonicalFilter {
  const data = new FormData(form);
  const providers = data.getAll("provider").filter((value): value is "central-dispatch" | "super-dispatch" | "shipcars" =>
    value === "central-dispatch" || value === "super-dispatch" || value === "shipcars"
  );
  if (providers.length === 0) throw new Error("Choose at least one load board.");
  const minimum = numberOrNull(data.get("minimumVehicles"));
  const maximum = numberOrNull(data.get("maximumVehicles"));
  if (minimum !== null && maximum !== null && minimum > maximum) throw new Error("Maximum vehicles must be at least the minimum.");
  return {
    schemaVersion: 1,
    name: requiredText(data.get("name"), "Name"),
    origins: [stateOrAnywhere(data.get("origin"))],
    destinations: [stateOrAnywhere(data.get("destination"))],
    trailerTypes: [data.get("trailer") === "enclosed" ? "enclosed" : "open"],
    vehicles: { minimum, maximum },
    readiness: { kind: "any" },
    minimumPayUsd: numberOrNull(data.get("minimumPay")),
    minimumRatePerMile: null,
    providers,
    blockedBrokerIds: []
  };
}

function stateOrAnywhere(value: FormDataEntryValue | null): CanonicalFilter["origins"][number] {
  const state = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (state === "") return { kind: "anywhere" };
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("Use a two-letter state code, such as CA.");
  return { kind: "state", state };
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("Enter a valid non-negative number.");
  return number;
}

function requiredText(value: FormDataEntryValue | null, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) throw new Error(`${label} is required.`);
  return text;
}

function locationLabel(locations: CanonicalFilter["origins"]): string {
  const location = locations[0];
  if (location === undefined || location.kind === "anywhere") return "Anywhere";
  return location.kind === "state" ? location.state : `${location.city}, ${location.state}`;
}

function shortLocation(location: { readonly city: string | null; readonly state: string | null }): string {
  return [location.city, location.state].filter((part): part is string => part !== null).join(", ") || "Unknown";
}

function readableError(error: unknown): string {
  if (error instanceof MiniAppApiError && error.statusCode === 401) return "Telegram session expired. Close and reopen HaulAlert.";
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character] ?? character);
}

function applyTelegramTheme(webApp: TelegramWebApp | undefined): void {
  const background = webApp?.themeParams?.bg_color;
  const text = webApp?.themeParams?.text_color;
  if (background !== undefined) document.documentElement.style.setProperty("--tg-background", background);
  if (text !== undefined) document.documentElement.style.setProperty("--tg-text", text);
}

function getApplicationRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>("#app");
  if (root === null) throw new Error("Missing application root");
  return root;
}
