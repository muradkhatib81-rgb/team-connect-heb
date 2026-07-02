# Architectural Review Notes

> **Status:** Living document — corrections pending functional review completion.  
> **Last updated:** 2026-07-02

This document captures architectural clarifications, decisions, and pending corrections that span multiple modules. It exists so that every future implementation stage preserves the same conceptual boundaries the platform was designed for.

---

## 1. Job Titles vs. Authorization Roles — Conceptual Independence

### 1.1 The rule (universal)

Job Titles and authorization roles are **independent concepts** and must never be treated as the same entity.

| Dimension | Job Title | Authorization Role |
| ----------|-----------|--------------------|
| **What it describes** | What a person does in the organisation (their operational position). | What a person is allowed to do in the system (their permissions). |
| **Domain** | Employee / HR domain. | Security / access-control domain. |
| **May share a label?** | Yes — a "Branch Manager" job title and a `branch_manager` role can coexist. | Yes — the role may carry the same business name as a job title. |
| **May be linked by default?** | Yes — for convenience, a default role may be suggested when a job title is chosen. | Yes — for convenience, a default job title may be suggested when a role is assigned. |
| **Treated as the same entity?** | **Never.** | **Never.** |

**Consequence:** a change in job title does not automatically imply a change in authorization role, and vice versa. A person can hold the job title "Branch Manager" without holding the `branch_manager` role, and can hold the `branch_manager` role without the job title "Branch Manager".

### 1.2 Platform Owner identities — must NOT appear in Job Titles

Platform Owners (`system_admin`, `main_admin`) are **business identities, not operational positions**. They administer the platform itself and are explicitly excluded from the employee domain.

- **Platform Owner / Primary Platform Owner** (or any ownership identity) **must never appear as a Job Title** in the `job_titles` table or any employee-facing picker.
- The existing entry "מנהל ראשי" (or its legacy / new label after the Platform Owner refactor) in `job_titles` is an **architectural inconsistency** and must be removed as part of the post-review corrections.

### 1.3 Branch Manager / Assistant Manager — legitimate operational positions

The following entries in `job_titles` **are legitimate** and should remain:

- **Branch Manager** (מנהל סניף) — an operational position within the organisation.
- **Assistant Manager** (סגן מנהל) — an operational position within the organisation.

These positions happen to be associated with authorization roles (`branch_manager`, `assistant_manager`), but they are **not** those roles. They describe real organisational roles, and their presence in the Job Titles domain is correct.

### 1.4 What is NOT allowed in Job Titles

| Entry | Why it must be removed | Action |
|-------|------------------------|--------|
| "מנהל ראשי" / "בעל המערכת הראשי" / any Platform Ownership label | Platform Owners are not employees; they do not hold operational positions. | Remove from `job_titles` in all branches. Add a server-side guard rejecting any job title that collides with a Platform Ownership label. |

### 1.5 Enforcement checklist (post-review implementation)

- [ ] Remove Platform Ownership labels from `job_titles` (data cleanup).
- [ ] Add a server-side guard in job-title creation / update that rejects labels matching `ROLE_LABELS` for `system_admin` or `main_admin` (or any future ownership identity).
- [ ] Document the boundary in `docs/employees.md` (or equivalent) when created: "Job Titles = operational positions. Platform Ownership identities MUST NOT appear here."
- [ ] Ensure the Job Titles admin screen visibly documents this rule.

---

## 2. Domain Membership — Employee Domain vs. Non-Employee Identities

### 2.1 The universal rule

**Only users who belong to the Employee domain have operational branch and department membership.**

Any user who exists outside the Employee domain — regardless of their business identity or authorization role — does not have, and must not be required to have, branch membership or department membership.

This rule is defined at the **domain level**, not at the identity level. It applies uniformly to every current and future non-employee identity the platform introduces, including but not limited to:

- Platform Owners (Primary Platform Owner, Platform Owner) — today.
- Future system-level identities (system operators, super-auditors).
- Integration / service accounts (webhooks, external systems, partner APIs).
- AI service identities (agents acting on behalf of the platform).
- External auditors, regulators, compliance observers.
- Any other identity that is authenticated but not employed by the organisation.

**Consequence:** the schema and business logic must never assume that every authenticated user is an employee. Employee-domain fields (`profiles.branch_id`, `profiles.department_id`, job title, headcount inclusion, org-chart placement, etc.) are optional at the platform level and required only for users classified as employees.

### 2.2 Branch semantics — two distinct concepts

The word "branch" is used for two orthogonal concepts. They must remain separate.

| Concept | Storage | Meaning | Applies to |
|---|---|---|---|
| **Branch Membership** | `profiles.branch_id` | The single operational branch a person is an employee of. Governs employee-scope RLS, headcount, org chart, employee listings, department assignment. | Employee-domain users only. NULL for non-employee identities. |
| **Active Branch Context** | Session state, exposed via `current_active_branch()` | The branch the user is currently operating in for this session. Governs which branch's data is read/edited right now. | Every authenticated user, including non-employee identities. |

The analogous distinction applies to departments: `profiles.department_id` denotes employee membership in a department, not operational context.

### 2.3 Ratified architectural rules

- **AR-DM-1:** The Employee domain is a bounded subset of authenticated users. Not every authenticated user is an employee.
- **AR-DM-2:** Employee-domain membership fields (`profiles.branch_id`, `profiles.department_id`, and any future employee-only fields) apply **only** to users in the Employee domain.
- **AR-DM-3:** Non-employee identities exist without branch or department membership. This is the default, not an exception.
- **AR-DM-4:** Operational context (`current_active_branch()` and any future session-scoped context) is orthogonal to domain membership and is available to every authenticated user.
- **AR-DM-5:** Authorization to enter a domain is determined by the authorization model (`user_roles` and its abstractions such as `is_platform_owner()`). The authorization model remains the **single source of truth** for domain classification. No parallel table shall duplicate this classification.
- **AR-DM-6:** New identity classes introduced in the future MUST be modeled by extending the authorization model, not by adding parallel identity tables, unless a class requires identity-specific metadata that has no natural home on `user_roles` or `profiles`.

### 2.4 Applied to Platform Owners (today)

Platform Owners are the first concrete instance of a non-employee identity class. Under the rules above:

- `profiles.branch_id IS NULL` and `profiles.department_id IS NULL` for every Platform Owner.
- Platform Owners retain a single `profiles` row for identity data (display name, avatar, contact, preferences, language, notifications).
- `user_roles` remains the single source of truth for Platform Ownership via `is_platform_owner()`.
- Platform Owners participate in Active Branch Context through the existing branch switcher, unchanged.

### 2.5 Enforcement checklist (post-review implementation)

- [ ] Make `profiles.department_id` nullable (and confirm `profiles.branch_id` nullable).
- [ ] Add a validation trigger enforcing: **if the user is in the Employee domain, both fields are NOT NULL; if the user is outside the Employee domain, both fields are NULL.** Trigger, not CHECK, because the rule depends on `user_roles` (time-dependent data).
- [ ] Adjust `handle_new_user()` so provisioning a non-employee identity does not resolve a fallback department/branch.
- [ ] One-time data cleanup: set `department_id` and `branch_id` to NULL for existing Platform Owners.
- [ ] Sweep employee-scope UI (Employees list, org chart, department picker, headcount views) to confirm non-employee identities are excluded by construction.

---

## 3. Extension rule for future contributors

Before adding a new concept to a domain, ask:

> "Does this concept belong to the *business identity* domain, the *authorization role* domain, or the *operational position* domain? And does the user this concept applies to belong to the *Employee* domain or to a *non-employee identity* class?"

If the answer is unclear, the concept is not ready to be added. Clarify its domain and its target identity class first, then place it in the correct table, service layer, and UI module.

---

## 4. Pending corrections list (from functional review)

| ID | Item | Priority | Module | Notes |
|----|------|----------|--------|-------|
| JT-1 | Remove Platform Ownership labels from `job_titles` | High | Employees / Job Titles | Data cleanup across all branches. |
| JT-2 | Add server-side guard rejecting ownership labels in job-title CRUD | High | Employees / Job Titles | Prevents re-introduction. |
| JT-3 | Document the Job Title / Role / Ownership boundary | Medium | Documentation | To be added to `docs/employees.md` when created. |
| JT-4 | Update Job Titles admin UI to explain the boundary visibly | Medium | Employees / Job Titles | Help text or inline documentation. |
| DM-1 | Make `profiles.department_id` nullable; keep `branch_id` nullable | High | Schema / Employees | Enables non-employee identities. |
| DM-2 | Validation trigger enforcing employee-vs-non-employee membership invariant | High | Schema / Security | Trigger, not CHECK. |
| DM-3 | Adjust `handle_new_user()` for non-employee provisioning path | High | Auth / Onboarding | Skip department/branch resolution. |
| DM-4 | One-time cleanup: NULL branch/department for existing Platform Owners | High | Data | Single row today. |
| DM-5 | Sweep employee-scope UI to confirm non-employee exclusion | Medium | UI | Post-migration verification. |

*This list will grow during the functional review and be consolidated before the implementation roadmap is defined.*

