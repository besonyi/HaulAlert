# HaulAlert

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

To prepare Telegram delivery locally, copy `.env.example` to `.env` and set `TELEGRAM_BOT_TOKEN`. The token stays server-side; customers are addressed using the Telegram chat ID established during Bot onboarding.

The repository starts with provider-neutral TypeScript packages and services. Applications are introduced only when their API and operational boundary are defined.
