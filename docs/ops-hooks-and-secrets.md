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
