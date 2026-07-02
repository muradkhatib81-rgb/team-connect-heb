# Platform Owners — Enterprise Architecture

_Last updated: Stage 5, 2026-07-02_

This document is the canonical reference for the **Platform Ownership**
business layer. It codifies the separation between the platform's owners and
its branch employees, the internal authorization model that backs it, and the
operational rules every future contributor must follow.

If you are about to add a screen, RPC, report, notification, export, or audit
view that touches ownership, read this file first.

---

## 1. Business identities (user-facing)

The application recognises four business identities. These are the ONLY
identities that may appear in the UI, reports, notifications, exports, audit
views, or any other user-visible surface.

| Business identity                   | Hebrew label            | Scope                              |
| ----------------------------------- | ----------------------- | ---------------------------------- |
| Primary Platform Owner              | בעל המערכת הראשי        | Owns the platform (singleton)      |
| Platform Owner                      | בעל המערכת              | Owns and administers the platform  |
| Branch Manager / Assistant / etc.   | מנהל סניף / סגן מנהל / …| Operates a branch                  |
| Employee                            | עובד                    | Performs operational work          |

**Platform Owners are not employees.** They do not appear in shift boards,
department rosters, employee-of-the-month lists, break requests, or task
assignments. They administer the platform itself.

---

## 2. Internal authorization model (implementation detail — do not expose)

Business identities map to internal `public.app_role` values. These names are
**implementation details** and MUST NOT appear in any user-facing surface.

| Business identity        | Internal role        |
| ------------------------ | -------------------- |
| Primary Platform Owner   | `system_admin`       |
| Platform Owner           | `main_admin`         |
| Branch Manager           | `branch_manager`     |
| Assistant Manager        | `assistant_manager`  |
| Department Manager       | `department_manager` |
| Employee                 | `employee`           |

Rules:

- Never rename these internal identifiers. They are load-bearing across
  migrations, RLS policies, triggers, RPCs, and legacy exports.
- Never show them in the UI. Use `ROLE_LABELS` from `src/lib/constants.ts`
  or the DB helper `get_profiles_basic_info(...)` (`role_label` column).
- Never introduce new internal role names to represent business concepts —
  add a business-layer service instead (see §5).

---

## 3. Database foundation (Stage 1)

### 3.1 `public.is_platform_owner(uuid) → boolean`

`SECURITY DEFINER`, `STABLE`, `search_path = public`.
Returns `true` when the user holds `system_admin` OR `main_admin`. This is the
**single source of truth** for "is this user a Platform Owner?" and the only
predicate that employee-facing RPCs may use to exclude Platform Owners.

`EXECUTE` is granted to `authenticated` and `service_role` only.

### 3.2 Protection triggers on `public.user_roles`

- `trg_guard_platform_owner_grant` (`BEFORE INSERT`) — only the Primary
  Platform Owner may grant Platform Owner privileges. Skips when
  `auth.uid()` is `NULL` so `handle_new_user()` and first-user bootstrap
  continue to work.
- `trg_guard_platform_owner_mutation` (`BEFORE UPDATE/DELETE`) — only the
  Primary Platform Owner may modify or remove the Primary Platform Owner's
  own role row.

### 3.3 Audit log

- `public.platform_owner_audit_log` — append-only, RLS-enabled. `SELECT` is
  restricted to Platform Owners. There are **no** `INSERT/UPDATE/DELETE`
  policies; direct writes are impossible.
- `public.log_platform_owner_event(event text, target uuid, payload jsonb)`
  is the sole write path. `SECURITY DEFINER`; `EXECUTE` revoked from
  `PUBLIC` and `anon`, granted to `authenticated` and `service_role`.

---

## 4. Employee-domain isolation (Stage 2)

Platform Owners are excluded from all employee-facing reads and inserts. Do
not add a new employee-facing surface without following the same pattern.

### 4.1 Read RPCs — exclude via `NOT public.is_platform_owner(...)`

All of these have an `AND NOT public.is_platform_owner(<user_id>)` trailing
predicate:

- `get_management_on_shift()`
- `get_department_coworkers()`
- `find_profile_by_id_number(text)`
- `list_profiles_contact()`
- `get_employees_of_month(int, int)`

**Rule:** every new employee-facing read that returns `user_id`/`profile_id`
rows must apply the same predicate.

### 4.2 Write guards — `reject_platform_owner_as_employee(col_name)`

A shared `SECURITY DEFINER` helper (executable only by `service_role`) is
wired via `BEFORE INSERT` triggers on:

| Table                 | Guarded column | Trigger                                      |
| --------------------- | -------------- | -------------------------------------------- |
| `management_on_shift` | `user_id`      | `trg_reject_platform_owner_mos`              |
| `employee_of_month`   | `employee_id`  | `trg_reject_platform_owner_eom`              |
| `schedule_shifts`     | `employee_id`  | `trg_reject_platform_owner_shifts`           |
| `break_requests`      | `user_id`      | `trg_reject_platform_owner_breaks`           |
| `task_assignees`      | `user_id`      | `trg_reject_platform_owner_task_assignees`   |

Attempts to assign a Platform Owner as an employee raise:

> בעלי מערכת אינם נחשבים כעובדים ולא ניתן לשייך אותם לפעולה זו

**Rule:** every new table that stores an "operational employee" reference
must add an equivalent guard.

---

## 5. Platform Owner management (Stage 3)

All Platform Owner administration lives in **`src/lib/platform-owners.functions.ts`**
and nowhere else. Employee-facing RPCs must never manage Platform Owners, and
Platform Owner services must never manage employees.

Server functions (all use `.middleware([requireSupabaseAuth])`):

| Function                    | Access                     | Notes                                                                 |
| --------------------------- | -------------------------- | --------------------------------------------------------------------- |
| `listPlatformOwners`        | Any Platform Owner         | Business-layer projection (email, phone, level).                      |
| `createPlatformOwner`       | Primary Platform Owner     | Creates auth user, grants `main_admin`, removes default `employee`.   |
| `suspendPlatformOwner`      | Primary Platform Owner     | Toggles `profiles.is_active = false`.                                 |
| `restorePlatformOwner`      | Primary Platform Owner     | Toggles `profiles.is_active = true`.                                  |
| `deletePlatformOwner`       | Primary Platform Owner     | Removes auth user + role rows.                                        |
| `transferPrimaryOwnership`  | Primary Platform Owner     | Atomic swap; rolls back if the new insert fails.                      |
| `listPlatformOwnerAuditLog` | Any Platform Owner         | Reads `platform_owner_audit_log`.                                     |

Enforcement helpers `assertCallerIsPlatformOwner` / `assertCallerIsPrimary`
verify roles directly against the DB via `supabaseAdmin`, bypassing any
client-provided claims. Every mutation calls `log_platform_owner_event`.

**Rule:** any future Platform Owner screen, report, or admin action must go
through this service. Do not extend employee RPCs to cover Platform Owners.

---

## 6. UI presentation (Stage 4)

Central label source: `ROLE_LABELS` in `src/lib/constants.ts`.

```ts
system_admin: "בעל המערכת הראשי",
main_admin:   "בעל המערכת",
```

DB-side label source: `get_profiles_basic_info(...)` `role_label` column.

Rules:

- Never hard-code role labels in components. Consume `ROLE_LABELS` or the
  RPC's `role_label` field.
- Access-denied text, toast messages, `RAISE EXCEPTION` messages, exports,
  notifications, and audit views must reference business identities
  ("בעל המערכת" / "בעל המערכת הראשי") — never internal identifiers or the
  legacy labels ("מנהל ראשי", "מנהל מערכת ראשי").
- The first-user bootstrap flow (`src/routes/auth.tsx`) is presented as
  **"הקמת בעל המערכת הראשי"**.

---

## 7. Operational playbook

### 7.1 Adding a new Platform Owner

1. Sign in as the Primary Platform Owner.
2. Call `createPlatformOwner({ email, password, full_name, phone? })`.
3. The service creates the auth user, grants `main_admin`, strips the
   default `employee` role, and writes a `platform_owner_created` audit
   event.

### 7.2 Transferring primary ownership

1. Sign in as the Primary Platform Owner.
2. Call `transferPrimaryOwnership({ user_id: <target Platform Owner> })`.
3. The service removes `system_admin` from the caller, grants it to the
   target, and re-adds `main_admin` to the previous primary (they remain a
   Platform Owner). Failure triggers a full rollback so the system always
   retains exactly one Primary Platform Owner.

### 7.3 Suspending / restoring / deleting

- Suspend: `suspendPlatformOwner({ user_id })` — reversible via `restore…`.
- Delete: `deletePlatformOwner({ user_id })` — removes the auth user and
  role rows. The Primary Platform Owner cannot be deleted; transfer first.

### 7.4 Auditing

- Every mutation writes to `platform_owner_audit_log`.
- Read via `listPlatformOwnerAuditLog()`.
- Direct writes to the table are blocked by RLS; use
  `log_platform_owner_event(...)`.

---

## 8. Extension checklist (future contributors)

Before merging a change that touches ownership, verify:

- [ ] No user-visible surface (UI copy, RPC error, notification, export,
      audit view) uses `main_admin` / `system_admin` or the legacy labels
      "מנהל ראשי" / "מנהל מערכת ראשי".
- [ ] New employee-facing reads exclude Platform Owners via
      `NOT public.is_platform_owner(<user_id>)`.
- [ ] New tables storing an "operational employee" reference add a
      `reject_platform_owner_as_employee(...)` `BEFORE INSERT` trigger.
- [ ] New Platform Owner management logic lives in
      `src/lib/platform-owners.functions.ts` and calls
      `assertCallerIsPlatformOwner` / `assertCallerIsPrimary`.
- [ ] Every mutation writes to `platform_owner_audit_log` via
      `log_platform_owner_event(...)`.
- [ ] Internal role identifiers (`main_admin`, `system_admin`) are not
      renamed, re-scoped, or leaked.

---

## 9. Rollback matrix

Every stage is independently reversible.

| Stage | Reversal                                                              |
| ----- | --------------------------------------------------------------------- |
| 1     | `DROP FUNCTION is_platform_owner`, drop guard triggers, drop audit log. |
| 2     | Drop the 5 insert-guard triggers; remove the `AND NOT is_platform_owner(...)` predicates from the 5 read RPCs. |
| 3     | Delete `src/lib/platform-owners.functions.ts`.                        |
| 4     | Revert the label strings in `src/lib/constants.ts`, `src/routes/auth.tsx`, and the leaf files listed in the Stage 4 report; revert the Stage 4 tail-cleanup migration to restore DB messages. |
| 5     | Delete `docs/platform-owners.md`.                                     |

No stage depends on later stages being present; earlier stages continue to
function on their own.
