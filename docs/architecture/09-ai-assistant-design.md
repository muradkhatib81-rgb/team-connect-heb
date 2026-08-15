# AI Assistant — Architecture Design

> Status: **Phase 0 — schema + module foundation** (no chat UI yet).
> Default provider at launch: **Gemini**. Architecture is provider-agnostic from day one.

## Goals

1. **Employee assistant** — personal questions (leave balance, schedule, breaks) within existing RLS scope.
2. **Manager / deputy assistant** — summaries and operational reports within branch/dept scope.
3. **Platform owner assistant** — platform-wide ops view for `system_admin` / `main_admin`.
4. **Grants controlled only by platform owner** — plus delegated admins granted explicitly by the owner (future developers).
5. **Billing-linked quotas** — owner can grant fully free, or tie hours to a paid plan.
6. **Provider per grant** — Gemini, OpenAI, Anthropic, … without code rewrites.

## Non-goals (v1)

- AI does **not** approve leaves, edit schedules, or mutate permissions.
- API keys never exposed to the browser.
- No payment provider (Stripe) yet — integrates with existing `BillingPlan` stub and DB entitlements.

## Hierarchy & grant scopes

```
Platform
  └── Company          ← ai_grants.scope_type = 'company'
        └── Branch     ← ai_grants.scope_type = 'branch' (company_branch_assignments.id)
              └── User ← ai_grants.scope_type = 'user' (optional override)
```

**Resolution order (most specific wins):** `user` → `branch` → `company` → no access.

A user sees the assistant only when a resolved grant exists, is active, and quota remains.

## Access control

| Actor | Can manage AI grants/providers | Can use assistant |
|-------|-------------------------------|-------------------|
| Primary platform owner (`system_admin`) | Yes | Yes (platform assistant) |
| Platform owner (`main_admin`) | Yes | Yes (platform assistant) |
| Delegated AI admin (`ai_admin_delegates`) | Yes (subset flags) | No (unless also operational role) |
| Branch manager / assistant / dept manager / employee | No | Yes **if** grant resolves |

Delegated admins are **not** branch permission grants — separate table, owner-only assignment.

## Provider abstraction

```
Client → createServerFn(aiChat) → AiRouter → GeminiProvider | OpenAiProvider | …
```

- `ai_providers` — platform registry (code, display name, default model, enabled).
- Secrets live in server env (`GEMINI_API_KEY`, `OPENAI_API_KEY`, …) — referenced by code, never stored in DB.
- Each `ai_grants.provider_code` overrides the platform default for that scope.

## Billing integration

| `grant_source` | Meaning |
|----------------|---------|
| `manual_free` | Owner granted N minutes, no payment required |
| `manual_paid` | Owner granted N minutes on top of a plan |
| `billing_plan` | Auto-provisioned from `ai_plan_entitlements` when company plan changes |

`ai_plan_entitlements` maps `BillingPlan` (`free` | `standard` | `enterprise`) → monthly minutes, default provider, optional provider choice flag.

Flow when billing matures:

1. Company upgrades to `standard` → upsert company grant from entitlements row.
2. Owner can still add `manual_free` bonus minutes or switch provider per company.
3. Usage decrements from grant period bucket; at zero → assistant hidden / quota message.

## Quota model

- Stored as **`quota_minutes`** per grant with **`quota_period`**: `monthly` | `lifetime`.
- **`used_minutes`** rolled up per grant + period start (or derived from `ai_usage_events`).
- Usage event records: user, provider, model, tokens, wall duration, assistant kind.

Platform owner usage tracked against platform-level settings row (not a company grant).

## Database tables

See migration `supabase/migrations/20260816003000_ai_assistant_foundation.sql`:

| Table | Purpose |
|-------|---------|
| `ai_providers` | Provider registry |
| `ai_plan_entitlements` | Plan → minutes + default provider |
| `ai_grants` | Company / branch / user grants |
| `ai_admin_delegates` | Owner-delegated AI admin users |
| `ai_usage_events` | Immutable usage log |
| `ai_platform_settings` | Platform default provider + owner quota |

## Module layout

```
src/modules/ai/
  ai.model.ts       — types mirroring DB + assistant kinds
  ai.router.ts      — provider dispatch (stub)
  index.ts

src/lib/ai.functions.ts           — server endpoints (future)
src/routes/_authenticated/platform/ai.tsx  — owner grant UI (future)
src/components/ai-assistant/      — chat UI (future)
```

## Rollout phases

| Phase | Deliverable |
|-------|-------------|
| **0** (now) | Schema, types, provider router stub, design doc |
| **1** | Owner UI: grants + usage dashboard; Gemini provider; employee chat |
| **2** | Manager reports assistant; billing plan auto-grants |
| **3** | OpenAI / Claude providers; delegated admin UI; paid tiers |

## Security notes

- All grant CRUD: `is_platform_owner()` OR delegate with `can_manage_grants`.
- Chat RPC: authenticated user + resolved grant + role-scoped context injection (no cross-branch leakage).
- RLS on usage: owners see all; users see own events only.
