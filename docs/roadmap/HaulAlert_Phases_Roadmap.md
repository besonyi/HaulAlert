# HaulAlert — Phased Development Roadmap

> A Telegram-first service that detects newly posted vehicle loads, matches them to customer alerts, and delivers the relevant load details immediately.

## Product boundary

HaulAlert is a standalone product. Customers manage alerts through a Telegram Mini App and receive notifications through a Telegram Bot; they do not manage LoadBoard sessions themselves.

The MVP is deliberately centered on one event: `NEW_LOAD`. It should not expand into price-change, repost, removal, or full historical-sync features until the new-load path is proven reliable.

```text
LoadBoard search
  → provider adapter
  → new-load detector
  → normalizer + deduplicator
  → alert matcher
  → Telegram notification
```

## Architecture principles

- Keep one canonical HaulAlert filter, independent of any individual LoadBoard.
- Push the part each provider supports into its native search; apply remaining conditions internally.
- Treat persistent browser tabs as delta collectors, not full LoadBoard synchronizers.
- Identify a load globally by `provider:provider_load_id` and make every ingest and delivery idempotent.
- Reuse equivalent provider-side searches through a `source_filter_hash`; do not create one tab per customer by default.
- Keep credentials, browser state, and operational controls on the service side only.
- Make reliability observable: every session, tab, scan, load, match, and delivery must be traceable.

## Phase 1 — Product foundation

**Goal:** establish a maintainable repository and shared engineering baseline before provider-specific work begins.

- [ ] **P1.1** Create the monorepo layout for apps, services, adapters, packages, infrastructure, and documentation.
- [ ] **P1.2** Define supported runtimes, package management, formatting, linting, and test conventions.
- [ ] **P1.3** Add environment templates and a secret-handling policy that never commits credentials or session data.
- [ ] **P1.4** Set up continuous integration for type checks, linting, unit tests, and build verification.
- [ ] **P1.5** Record key architecture decisions, service boundaries, and ownership conventions.
- [ ] **P1.6** Provide a repeatable local-development environment with fixtures and basic health checks.

**Exit criteria:** a new contributor can clone the repository, configure a local environment, run checks, and understand the system boundaries without relying on oral context.

## Phase 2 — Core domain and persistence

**Goal:** make filters, loads, subscriptions, and operational state durable and provider-neutral.

- [ ] **P2.1** Model users, Telegram identities, plans, subscriptions, alerts, and notification preferences.
- [ ] **P2.2** Define the canonical filter schema for route, radius, vehicle, trailer, ready date, payment, RPM, providers, and broker rules.
- [ ] **P2.3** Define the normalized load schema, including provider identity, route, vehicles, pay, miles, RPM, broker, and timestamps.
- [ ] **P2.4** Create versioned database migrations, indexes, retention rules, and seed data.
- [ ] **P2.5** Add Redis-backed cache conventions for seen IDs, locks, queues, and short-lived runtime state.
- [ ] **P2.6** Define idempotent event contracts for load ingestion, matching, and notification delivery.
- [ ] **P2.7** Build a location model that supports city + radius, state, and anywhere while preserving normalized coordinates.
- [ ] **P2.8** Produce realistic filter and load fixtures for adapters, matchers, and end-to-end tests.

**Exit criteria:** all components can exchange typed, validated data without referencing provider UI details.

## Phase 3 — Filter compiler and provider adapters

**Goal:** translate one customer alert into the safest effective search for every supported source.

- [ ] **P3.1** Define a provider-adapter interface and a capability descriptor for each searchable field.
- [ ] **P3.2** Build the filter compiler that separates `source_filter` from `internal_filter` per provider.
- [ ] **P3.3** Canonicalize source filters and calculate a stable `source_filter_hash`.
- [ ] **P3.4** Implement the Central Dispatch adapter, including deterministic autocomplete selection and native sorting setup.
- [ ] **P3.5** Implement the Super Dispatch adapter with newest-first search behavior.
- [ ] **P3.6** Implement the Ship.Cars adapter behind the same contract.
- [ ] **P3.7** Add selector, navigation, and capability tests for every provider adapter.
- [ ] **P3.8** Document unsupported fields and guarantee that they are evaluated by the internal matcher rather than silently discarded.

**Exit criteria:** a saved canonical filter compiles into reproducible native searches and an explicit remainder for every selected provider.

## Phase 4 — Browser runtime, sessions, and tab allocation

**Goal:** operate provider sessions and persistent search tabs safely as service infrastructure.

- [ ] **P4.1** Establish the browser-runtime service boundary and its authenticated control API.
- [ ] **P4.2** Store encrypted session material separately from application data and expose only opaque session references.
- [ ] **P4.3** Implement session lifecycle handling: initialization, health checks, expiry, renewal, and recovery.
- [ ] **P4.4** Allocate, reuse, and retire persistent tabs by provider and `source_filter_hash`.
- [ ] **P4.5** Schedule scans according to bucket activity, priority, and provider constraints.
- [ ] **P4.6** Recover gracefully from navigation failures, stale pages, authentication loss, and tab crashes.
- [ ] **P4.7** Emit structured telemetry for session health, tab state, scan duration, and error causes.

**Exit criteria:** the runtime can keep a controlled pool of healthy provider searches alive without exposing provider credentials to customers.

## Phase 5 — New-load detection and ingestion

**Goal:** turn provider search deltas into a trustworthy stream of normalized `NEW_LOAD` events.

- [ ] **P5.1** Define a collector contract for scanning the top of a provider result set.
- [ ] **P5.2** Implement delta detection that stops at a known load boundary instead of repeatedly processing entire result lists.
- [ ] **P5.3** Add global deduplication keyed by `provider:provider_load_id` with durable first-seen state.
- [ ] **P5.4** Normalize raw provider rows into the shared load model and retain provenance for diagnostics.
- [ ] **P5.5** Detect result-capacity risk and split or accelerate overloaded search buckets before boundaries are lost.
- [ ] **P5.6** Support safe replay of failed ingestion jobs without producing duplicate user notifications.
- [ ] **P5.7** Persist scan and ingest history so operators can reconstruct what happened to a particular load.

**Exit criteria:** a newly visible provider load produces exactly one durable event even across retries or overlapping scans.

## Phase 6 — Matching and notification delivery

**Goal:** decide which alerts match a new load and deliver fast, non-duplicated Telegram notifications.

- [ ] **P6.1** Build an alert index that narrows the candidate set before detailed predicate evaluation.
- [ ] **P6.2** Implement route, radius, vehicle, trailer, ready-date, payment, RPM, provider, and broker predicates.
- [ ] **P6.3** Make matching and delivery decisions idempotent per load, user, and alert.
- [ ] **P6.4** Create Telegram notification templates with normalized load details, source attribution, and safe action links.
- [ ] **P6.5** Queue deliveries with retries, rate-limit handling, dead-letter visibility, and delivery status tracking.
- [ ] **P6.6** Support alert pause/resume, muted filters, blocked brokers, and user notification preferences.
- [ ] **P6.7** Benchmark the end-to-end path from a discovered load to a sent alert under realistic fan-out.

**Exit criteria:** matching customers receive one understandable Telegram message for each qualifying new load, while non-matches receive nothing.

## Phase 7 — Telegram Bot and Mini App

**Goal:** ship the customer-facing control surface for onboarding and alert management.

- [ ] **P7.1** Implement Telegram Bot onboarding and verified Telegram-based account creation.
- [ ] **P7.2** Build the Mini App shell with a mobile-first navigation model.
- [ ] **P7.3** Deliver alert creation, editing, toggling, duplication, and deletion flows.
- [ ] **P7.4** Build location selection and radius controls with clear validation and multiple-origin/destination support.
- [ ] **P7.5** Present provider choices and communicate how an alert is monitored without exposing internal sessions.
- [ ] **P7.6** Build the dashboard for monitoring state, active alerts, loads found, and recent notifications.
- [ ] **P7.7** Add notification deep links and Bot actions for opening a load, viewing broker details, or muting an alert.
- [ ] **P7.8** Test the complete customer journey on supported Telegram mobile and desktop clients.

**Exit criteria:** a customer can start the Bot, create an alert, leave the Mini App, and receive a useful notification when a matching load appears.

## Phase 8 — Operations and commercial features

**Goal:** provide the internal controls and customer account capabilities needed to operate the service.

- [x] **P8.1** Build the admin dashboard for system health, active sessions, tabs, loads, alerts, and delivery outcomes.
- [x] **P8.2** Provide operator views for session and tab errors with actionable recovery controls.
- [ ] **P8.3** Add searchable administration for users, filters, normalized loads, and alert history.
- [ ] **P8.4** Build broker profiles, broker search, and customer-managed blocked-broker lists.
- [ ] **P8.5** Implement plan entitlement checks and subscription lifecycle management.
- [ ] **P8.6** Implement the referral model, attribution rules, balances, and payout-review workflow.
- [ ] **P8.7** Add role-based access, audit logging, and support tooling for customer operations.

**Exit criteria:** operators can diagnose the live system and support a paying customer without direct database access.

## Phase 9 — Reliability, scale, and launch

**Goal:** validate the service under realistic volume and prepare a controlled production rollout.

- [ ] **P9.1** Add circuit breakers, backoff, queue protection, and provider-specific failure isolation.
- [ ] **P9.2** Load-test matching, tab scheduling, notifications, and database capacity at expected customer growth levels.
- [ ] **P9.3** Test backup, restore, retention, and disaster-recovery procedures for application and operational data.
- [ ] **P9.4** Configure production observability, alerting thresholds, dashboards, and incident runbooks.
- [ ] **P9.5** Complete security and privacy review of credentials, session material, user data, and administrator access.
- [ ] **P9.6** Run a controlled beta, capture product feedback, and close the highest-impact reliability gaps.
- [ ] **P9.7** Publish go-live criteria, operational ownership, success metrics, and a release rollback plan.

**Exit criteria:** HaulAlert can run predictably in production, operators can respond to failures, and the customer promise is measurable.

## Delivery order and release gates

| Gate | Required phases | Customer outcome |
| --- | --- | --- |
| Technical foundation | 1–3 | Typed domain model and reproducible provider search plans. |
| Internal collector | 4–5 | Persistent searches emit trustworthy new-load events. |
| MVP alert service | 6–7 | Customers create alerts and receive Telegram notifications. |
| Operable business | 8 | Operators support customers, plans, and account workflows. |
| Production launch | 9 | The service is measured, resilient, and ready to scale. |

## MVP success measures

- A matching load is normally delivered within the agreed monitoring interval plus notification latency.
- No duplicate notification is sent for the same load, alert, and user.
- Every alert can be traced from its canonical filter through its source search to its delivery record.
- Provider failures are visible to operators before they become silent customer-facing gaps.
- The system can reuse one source search for equivalent provider-side filters while preserving each customer's exact conditions.

## Scope control

The following remain explicitly outside the first new-load MVP unless separately prioritized:

- price-change and repost alerts;
- full historical LoadBoard synchronization;
- customer-managed LoadBoard credentials;
- broad analytics unrelated to new-load detection;
- provider-specific features that cannot be represented safely in the canonical filter model.

This roadmap is phase-level planning. The issue tracker remains the source of truth for task ownership, sequencing, and status.
