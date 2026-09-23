# HaulAlert

[![Verify](https://github.com/besonyi/HaulAlert/actions/workflows/ci.yml/badge.svg)](https://github.com/besonyi/HaulAlert/actions/workflows/ci.yml)

Telegram-first load alert service for vehicle transport. Customers create saved alerts in a Telegram Mini App and receive a message when a matching load appears.

## Repository layout

```text
apps/       Customer-facing applications: Mini App, Telegram Bot, and Admin UI
services/   Runtime services: API, browser runtime, matcher, notifications
adapters/   Provider-specific search and load-normalization integrations
packages/   Shared, provider-neutral domain packages
infra/      Deployment and operational configuration
docs/       Product, architecture, and delivery documentation
```

The phase-level development plan is in [the roadmap](docs/roadmap/HaulAlert_Phases_Roadmap.md).

## Development

Requires Node.js 22+ and pnpm 12+.

```bash
pnpm install
pnpm check
```

To prepare Telegram delivery locally, copy `.env.example` to `.env` and set `TELEGRAM_BOT_TOKEN`. The token stays server-side; customers are addressed using the Telegram chat ID established during Bot onboarding. The PostgreSQL migration and transactional delivery rules are in [infra/database](infra/database/README.md).

Once PostgreSQL has been migrated and `.env` contains both `DATABASE_URL` and `TELEGRAM_BOT_TOKEN`, start the durable delivery worker with:

```bash
pnpm --filter @haulalert/notification-service start
```

To receive Telegram updates, set the same `TELEGRAM_WEBHOOK_SECRET` in Telegram's `setWebhook` request, expose `TELEGRAM_WEBHOOK_PATH` publicly, then run the Bot server:

```bash
pnpm --filter @haulalert/bot start
```

The Mini App calls the authenticated alert API using its signed Telegram `initData`; start it with:

```bash
pnpm --filter @haulalert/api-service start
```

For the mobile Mini App shell and its same-origin `/api` proxy, run:

```bash
pnpm --filter @haulalert/miniapp start
```

The repository starts with provider-neutral TypeScript packages and services. Applications are introduced only when their API and operational boundary are defined.
