# Ops: public hooks and secrets

Status: operational note (does not change app roles or RLS).

## Secrets (Vercel)

| Variable | Used by | Header / auth |
| --- | --- | --- |
| `PUSH_DISPATCH_SECRET` | `/api/public/hooks/dispatch-push` | `x-push-secret` |
| `PLATFORM_HEALTH_SECRET` | `/api/public/hooks/platform-health-scan` | `x-platform-health-secret` |
| `RECURRING_TASKS_SECRET` | `/api/public/hooks/generate-recurring-tasks` | `x-recurring-tasks-secret` |
| `CRON_SECRET` | Vercel Cron GET on health + recurring | `Authorization: Bearer <CRON_SECRET>` |

Do **not** reuse `PUSH_DISPATCH_SECRET` for health/recurring.

Keep local `.env` out of OneDrive/Dropbox sync folders. Prefer host env in production.

## Crons (Vercel Hobby)

Hobby allows at most one run per day per cron expression.

| Path | Schedule (UTC) |
| --- | --- |
| `/api/public/hooks/platform-health-scan` | `0 2 * * *` |
| `/api/public/hooks/generate-recurring-tasks` | `0 3 * * *` |

Pro plan is required for hourly crons.

## Rate limits

Public hooks apply a best-effort per-IP in-memory throttle in addition to shared secrets.

## Stripe billing

| Variable | Used by | Notes |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Checkout, Portal, webhook verify | Server-only (`sk_test_…` / `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | `/api/public/hooks/stripe-webhook` | `whsec_…` from Stripe endpoint or CLI |
| `STRIPE_PRICE_STANDARD` | Checkout line item | Recurring Price ID |
| `STRIPE_PRICE_ENTERPRISE` | Checkout line item | Recurring Price ID |
| `APP_PUBLIC_URL` | Checkout success/cancel + Portal return | e.g. `https://team-connect-app.com` |

Webhook URL (production): `https://team-connect-app.com/api/public/hooks/stripe-webhook`

Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.

Platform Owner `/platform/billing` keeps working for **manual** plan / AI minutes / storage without these secrets. Checkout and Customer Portal appear enabled automatically once `STRIPE_SECRET_KEY` + at least one price ID are present on the host (Vercel env).

