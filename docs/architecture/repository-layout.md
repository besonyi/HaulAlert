# Repository layout and boundaries

HaulAlert is organized as a TypeScript workspace. The folder layout is intentionally explicit so provider automation, customer applications, and domain logic do not become coupled.

| Area | Responsibility | Must not contain |
| --- | --- | --- |
| `apps/miniapp` | Telegram Mini App customer interface | Provider session material or browser automation |
| `apps/bot` | Telegram Bot commands, callbacks, and notification presentation | Business-rule duplication |
| `apps/admin` | Internal operational controls | Customer-facing application state |
| `services/api` | Authentication, alert management, and public application API | Provider UI selectors |
| `services/browser-runtime` | Persistent provider sessions and search tabs | Telegram presentation logic |
| `services/matcher` | Candidate selection and exact alert matching | Browser navigation code |
| `services/notifications` | Queued notification delivery and delivery state | Provider-specific load parsing |
| `adapters/*` | Provider capabilities, native filter setup, and raw-load normalization | Customer-specific rules |
| `packages/*` | Canonical, reusable domain types and utilities | Runtime credentials and provider UI selectors |
| `infra/` | Deployment, monitoring, and environment configuration | Application business logic |

The implemented workspace now includes provider-neutral domain models, filter compilation, browser-runtime orchestration, new-load detection, matching, and Telegram delivery. Each layer remains independently testable so persistent adapters can replace in-memory runtime state without duplicating business rules.
