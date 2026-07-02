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

## 2. Extension rule for future contributors

Before adding a new concept to a domain, ask:

> "Does this concept belong to the *business identity* domain, the *authorization role* domain, or the *operational position* domain?"

If the answer is unclear, the concept is not ready to be added. Clarify its domain first, then place it in the correct table, service layer, and UI module.

---

## 3. Pending corrections list (from functional review)

| ID | Item | Priority | Module | Notes |
|----|------|----------|--------|-------|
| JT-1 | Remove Platform Ownership labels from `job_titles` | High | Employees / Job Titles | Data cleanup across all branches. |
| JT-2 | Add server-side guard rejecting ownership labels in job-title CRUD | High | Employees / Job Titles | Prevents re-introduction. |
| JT-3 | Document the Job Title / Role / Ownership boundary | Medium | Documentation | To be added to `docs/employees.md` when created. |
| JT-4 | Update Job Titles admin UI to explain the boundary visibly | Medium | Employees / Job Titles | Help text or inline documentation. |

*This list will grow during the functional review and be consolidated before the implementation roadmap is defined.*

