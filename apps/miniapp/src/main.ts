import type { CanonicalFilter, LocationConstraint } from "@haulalert/canonical-filter";

import {
  MiniAppApiClient,
  MiniAppApiError,
  type MiniAppAlert,
  type MiniAppDashboard
} from "./api.js";
import { locationsFromForm } from "./location-form.js";

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
let editingAlert: MiniAppAlert | undefined;
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
        <div><p class="eyebrow">HAULALERT</p><h1>${screen === "dashboard" ? "Your alerts" : editingAlert === undefined ? "New alert" : "Edit alert"}</h1></div>
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
    <div class="card-actions"><button data-action="toggle" data-id="${alert.id}" data-status="${alert.status}">${pauseLabel}</button><button data-action="edit" data-id="${alert.id}">Edit</button><button data-action="duplicate" data-id="${alert.id}">Copy</button><button class="danger" data-action="delete" data-id="${alert.id}">Delete</button></div>
  </article>`;
}

function createMarkup(): string {
  const filter = editingAlert?.filter;
  const editing = editingAlert !== undefined;
  return `<form class="content form" id="alert-form">
    <p class="form-intro">${editing ? "Update the route and monitoring choices for this alert." : "Tell us which loads to watch. You can refine locations and preferences later."}</p>
    <label>Alert name<input name="name" maxlength="80" placeholder="e.g. CA → AZ open loads" value="${formValue(filter?.name)}" required /></label>
    ${locationList("origin", "Origin", filter?.origins)}
    ${locationList("destination", "Destination", filter?.destinations)}
    <div class="form-grid"><label>Trailer<select name="trailer"><option value="open"${selected(filter?.trailerTypes.includes("open") ?? true)}>Open</option><option value="enclosed"${selected(filter?.trailerTypes.includes("enclosed") ?? false)}>Enclosed</option></select></label><label>Minimum pay<input name="minimumPay" type="number" min="0" step="50" placeholder="Any" value="${formValue(filter?.minimumPayUsd)}" /></label></div>
    <div class="form-grid"><label>Min vehicles<input name="minimumVehicles" type="number" min="1" step="1" placeholder="Any" value="${formValue(filter?.vehicles.minimum)}" /></label><label>Max vehicles<input name="maximumVehicles" type="number" min="1" step="1" placeholder="Any" value="${formValue(filter?.vehicles.maximum)}" /></label></div>
    <fieldset><legend>Load boards</legend><label class="check"><input type="checkbox" name="provider" value="central-dispatch"${checked(filter, "central-dispatch")} />Central Dispatch</label><label class="check"><input type="checkbox" name="provider" value="super-dispatch"${checked(filter, "super-dispatch")} />Super Dispatch</label><label class="check"><input type="checkbox" name="provider" value="shipcars"${checked(filter, "shipcars")} />Ship.Cars</label></fieldset>
    <button class="primary submit" type="submit">${editing ? "Save changes" : "Start monitoring"}</button>
    ${editing ? `<button class="secondary cancel" type="button" data-screen="dashboard">Cancel</button>` : ""}
  </form>`;
}

function locationList(role: "origin" | "destination", label: string, initialLocations: CanonicalFilter["origins"] | undefined): string {
  const locations = initialLocations === undefined || initialLocations.length === 0 ? [undefined] : initialLocations;
  return `<div class="location-list" data-location-list="${role}">
    ${locations.map((location, index) => locationFields(`${role}${index + 1}`, index === 0 ? label : `${label} ${index + 1}`, role, index > 0, location)).join("")}
    <button class="secondary" type="button" data-add-location="${role}">＋ Add another ${role}</button>
  </div>`;
}

function locationFields(prefix: string, label: string, role: "origin" | "destination", removable = false, initial?: LocationConstraint): string {
  const kind = initial?.kind ?? "state";
  const state = initial?.kind === "anywhere" || initial === undefined ? "" : initial.state;
  const city = initial?.kind === "city" ? initial.city : "";
  const latitude = initial?.kind === "city" ? initial.coordinates.latitude : "";
  const longitude = initial?.kind === "city" ? initial.coordinates.longitude : "";
  const radius = initial?.kind === "city" ? initial.radiusMiles : "";
  return `<fieldset class="location-group" data-location-group="${prefix}">
    <input type="hidden" name="${role}LocationPrefix" value="${prefix}" />
    <legend>${label}</legend>
    ${removable ? `<button class="remove-location" type="button" data-remove-location="${prefix}" aria-label="Remove ${label}">Remove</button>` : ""}
    <label>Match location<select name="${prefix}Kind" data-location-kind="${prefix}"><option value="state"${selected(kind === "state")}>State</option><option value="city"${selected(kind === "city")}>City + radius</option><option value="anywhere"${selected(kind === "anywhere")}>Anywhere</option></select></label>
    <div class="location-state-fields" data-location-required><label>${label} state <input name="${prefix}State" maxlength="2" placeholder="CA" autocapitalize="characters" value="${formValue(state)}" /></label></div>
    <div class="location-city-fields" data-city-fields hidden>
      <label>${label} city <input name="${prefix}City" maxlength="80" placeholder="Los Angeles" value="${formValue(city)}" /></label>
      <div class="form-grid"><label>Radius (miles)<input name="${prefix}Radius" type="number" min="1" max="500" step="1" placeholder="75" value="${formValue(radius)}" /></label><label>${label} latitude<input name="${prefix}Latitude" type="number" min="-90" max="90" step="0.0001" placeholder="34.0522" value="${formValue(latitude)}" /></label></div>
      <label>${label} longitude<input name="${prefix}Longitude" type="number" min="-180" max="180" step="0.0001" placeholder="-118.2437" value="${formValue(longitude)}" /></label>
      <p class="location-help">For a city radius, use the coordinates from your map app. This keeps the match exact.</p>
    </div>
  </fieldset>`;
}

function bindInteractions(): void {
  app.querySelectorAll<HTMLElement>("[data-screen]").forEach((element) => {
    element.addEventListener("click", () => { screen = element.dataset.screen === "create" ? "create" : "dashboard"; editingAlert = undefined; message = ""; render(); });
  });
  app.querySelector<HTMLFormElement>("#alert-form")?.addEventListener("submit", (event) => { void createAlert(event); });
  app.querySelectorAll<HTMLSelectElement>("[data-location-kind]").forEach((select) => {
    select.addEventListener("change", () => updateLocationFields(select));
    updateLocationFields(select);
  });
  app.querySelectorAll<HTMLButtonElement>("[data-add-location]").forEach((button) => {
    button.addEventListener("click", () => addLocation(button.dataset.addLocation));
  });
  app.querySelectorAll<HTMLButtonElement>("[data-remove-location]").forEach((button) => {
    button.addEventListener("click", () => button.closest("[data-location-group]")?.remove());
  });
  app.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => { void manageAlert(button); });
  });
}

function addLocation(role: string | undefined): void {
  if (role !== "origin" && role !== "destination") return;
  const list = app.querySelector<HTMLElement>(`[data-location-list="${role}"]`);
  if (list === null) return;
  let index = 2;
  while (list.querySelector(`[data-location-group="${role}${index}"]`) !== null) index += 1;
  const label = `${role === "origin" ? "Origin" : "Destination"} ${index}`;
  const addButton = list.querySelector<HTMLElement>("[data-add-location]");
  if (addButton === null) return;
  addButton.insertAdjacentHTML("beforebegin", locationFields(`${role}${index}`, label, role, true));
  const group = list.querySelector<HTMLElement>(`[data-location-group="${role}${index}"]`);
  const select = group?.querySelector<HTMLSelectElement>("[data-location-kind]");
  if (select !== undefined && select !== null) {
    select.addEventListener("change", () => updateLocationFields(select));
    updateLocationFields(select);
  }
  group?.querySelector<HTMLButtonElement>("[data-remove-location]")?.addEventListener("click", () => group.remove());
}

function updateLocationFields(select: HTMLSelectElement): void {
  const group = select.closest<HTMLElement>("[data-location-group]");
  if (group === null) return;
  group.querySelectorAll<HTMLElement>("[data-location-required]").forEach((element) => { element.hidden = select.value === "anywhere"; });
  group.querySelectorAll<HTMLElement>("[data-city-fields]").forEach((element) => { element.hidden = select.value !== "city"; });
}

async function createAlert(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (client === undefined) return;
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  try {
    const filter = filterFromForm(form);
    if (editingAlert === undefined) {
      const alert = await client.createAlert(filter);
      alerts = [alert, ...alerts];
      message = "Alert is active — we’ll message you when a matching load appears.";
    } else {
      const alert = await client.updateAlert(editingAlert.id, filter);
      alerts = alerts.map((existing) => existing.id === alert.id ? alert : existing);
      message = "Alert updated.";
    }
    editingAlert = undefined;
    screen = "dashboard";
  } catch (error: unknown) {
    message = readableError(error);
  }
  render();
}

async function manageAlert(button: HTMLButtonElement): Promise<void> {
  if (client === undefined || button.dataset.id === undefined || button.dataset.action === undefined) return;
  const alertId = button.dataset.id;
  try {
    if (button.dataset.action === "edit") {
      const original = alerts.find((alert) => alert.id === alertId);
      if (original === undefined) return;
      editingAlert = original;
      screen = "create";
      message = "";
    }
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

function selected(value: boolean): string {
  return value ? " selected" : "";
}

function checked(filter: CanonicalFilter | undefined, provider: CanonicalFilter["providers"][number]): string {
  return filter === undefined || filter.providers.includes(provider) ? " checked" : "";
}

function formValue(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : escapeHtml(String(value));
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
    origins: locationsFromForm(data, "origin"),
    destinations: locationsFromForm(data, "destination"),
    trailerTypes: [data.get("trailer") === "enclosed" ? "enclosed" : "open"],
    vehicles: { minimum, maximum },
    readiness: { kind: "any" },
    minimumPayUsd: numberOrNull(data.get("minimumPay")),
    minimumRatePerMile: null,
    providers,
    blockedBrokerIds: []
  };
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
  return locations.map((location) => {
    if (location.kind === "anywhere") return "Anywhere";
    return location.kind === "state" ? location.state : `${location.city}, ${location.state}`;
  }).join(" / ");
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
