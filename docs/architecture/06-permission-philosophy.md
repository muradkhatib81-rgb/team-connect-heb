# Permission Philosophy

Status: Draft

Version: 1.0

Owner: Platform Architecture

Last Updated: 2026-07-15

Depends On: 01-platform-vision.md, 02-system-architecture.md, 03-core-services.md, 05-database-philosophy.md

Related Documents: 04-module-architecture.md, 07-development-standards.md

---

## 1. Purpose of This Document

This document defines the official Permission Philosophy of the Platform: the principles that govern who may act, on what, and at what scope, across every level of the Platform → Company → Branch → Department → Employee hierarchy. It builds directly on the Platform-level permission foundation introduced in 01-platform-vision.md and the Authorization Service described in 03-core-services.md, and it extends that foundation to every hierarchy level.

This document is conceptual. It does not describe how permissions are implemented, stored, or enforced in code or in the database; it describes what permissions *mean* and *why* they are structured the way they are.

---

## 2. Permission-First Architecture

The Platform treats permission as a first-class architectural concern, not an afterthought layered on top of otherwise-open functionality.

- No capability in the Platform is assumed to be accessible by default. Access is always the result of an explicit, evaluated permission — never the absence of a restriction.
- Every business operation described in 03-core-services.md and 04-module-architecture.md is understood to have a permission question attached to it: "who may perform this, and at what scope?" That question is answered before the operation is considered, not after.
- Permission-first thinking means that when a new capability is introduced, defining its permission model is part of defining the capability itself — not a separate step that happens later.

This principle exists because the Platform's trustworthiness (per the Platform Vision) depends on access being deliberate at every point, not incidental.

---

## 3. Roles Are Permission Templates Only

A role is a convenient grouping of permissions — a template — and nothing more. Roles are not identities, job titles, or organizational positions.

- A role exists purely to make it practical to grant a common, coherent set of permissions to a person without enumerating each permission individually every time.
- A role has no meaning or authority of its own outside of the permissions it currently represents. If the permissions attached to a role change, the meaning of holding that role changes accordingly.
- Roles are distinct from job titles and from organizational positions. A person's job title describes what they do in the organization; a person's role describes what permission template has been applied to them. The two may align by convention, but they are never the same concept and must never be conflated.
- Because roles are templates, the Platform may introduce new roles, retire old ones, or adjust what a role grants, without those changes implying any change to a person's employment, job title, or standing in the organization.

Treating roles strictly as permission templates keeps the permission model flexible and prevents permission logic from becoming entangled with unrelated business or HR concerns.

---

## 4. Platform Permissions

Platform permissions govern actions taken at the outermost level of the hierarchy — administering the Platform itself, independent of any single Company.

- Platform permissions are held only by Platform Owners, consistent with the Platform Owner responsibilities described in the Platform Vision.
- Platform permissions govern capabilities such as Company onboarding and offboarding, Platform-wide policy, and Platform Owner identity management (see the Platform Administration Service in 03-core-services.md).
- Platform permissions never grant, by themselves, the ability to act inside a specific Company's operational data. Acting within a Company requires a separate, explicitly scoped permission at the Company level or below.
- Platform permissions are the smallest, most tightly held set of permissions in the Platform, consistent with the least privilege principle described in Section 12.

---

## 5. Company Permissions

Company permissions govern actions scoped to a single Company — the primary tenancy boundary described in the Platform Vision.

- Company permissions apply only within the boundary of the Company they were granted for. A Company permission never extends to any other Company, regardless of who holds it.
- Company permissions govern capabilities such as Company-wide configuration, and oversight of the Branches that belong to the Company.
- Holding a Company permission does not imply holding any Platform permission. Company-level authority and Platform-level authority are distinct, non-overlapping concerns, per the Platform-level permission philosophy in the Platform Vision.
- Company permissions may, by design, grant broad visibility and authority within the Company's own boundary, because that boundary itself is the isolating control — broad authority within one Company can never spill into another.

---

## 6. Branch Permissions

Branch permissions govern actions scoped to a single Branch within a Company.

- Branch permissions apply only within the Branch they were granted for, and only within the Company that owns that Branch, consistent with the containment principle that Branch belongs to Company (05-database-philosophy.md).
- Branch permissions govern capabilities such as Branch-level configuration and oversight of the Departments within that Branch.
- Holding a Branch permission for one Branch never implies any permission, of any kind, for a different Branch — even within the same Company — unless that permission is granted separately and explicitly.
- Branch permissions are the level at which most day-to-day operational management authority is expected to be exercised, reflecting the Branch's role as a Company's place of operation.

---

## 7. Department Permissions

Department permissions govern actions scoped to a single Department within a Branch.

- Department permissions apply only within the Department they were granted for, and only within the Branch that owns that Department, consistent with the containment principle that Departments belong to Branch (05-database-philosophy.md).
- Department permissions govern the operational capabilities that take place at this level: managing Employees, Scheduling, Attendance, Breaks, Tasks, and Reports scoped to the Department.
- Department permissions are the most granular management-level permissions in the hierarchy; below them exist only Employee permissions, which describe what an individual may do for themselves rather than for others.

---

## 8. Employee Permissions

Employee permissions govern what an individual employee may do, primarily with respect to their own operational activity.

- Employee permissions are scoped to the individual: an employee's permissions govern their own schedule, attendance, breaks, and assigned tasks, not those of other employees, unless a separate management-level permission is also granted.
- Employee permissions exist independently of Department, Branch, Company, or Platform permissions — an individual may simultaneously hold Employee permissions for their own activity and, separately, Department- or Branch-level permissions if their responsibilities warrant it.
- Non-employee identities, such as Platform Owners, do not hold Employee permissions, consistent with the Employee-domain boundary described in the Platform Vision and 05-database-philosophy.md.

---

## 9. Permission Inheritance

Permission inheritance describes how authority at one level of the hierarchy relates to the levels beneath it.

- Inheritance flows downward and only downward. A permission granted at the Company level may extend to every Branch and Department within that Company; a permission granted at the Branch level may extend to every Department within that Branch. A permission never flows upward — Department-level authority never implies Branch-, Company-, or Platform-level authority.
- Inheritance is scoped, not universal. Inheriting authority over everything beneath a level does not mean inheriting authority over anything outside that level's boundary — a Company-level permission still stops at the Company's own boundary and never crosses into another Company.
- Inheritance exists to avoid the impracticality of re-granting the same authority at every level individually, while preserving the strict containment described in the Platform Vision and Database Philosophy documents.
- Where an operation requires authority that has not been inherited and has not been explicitly granted, the default outcome is denial, consistent with the permission-first principle in Section 2.

---

## 10. Permission Overrides

A permission override is an explicit, narrower or additional grant that takes precedence over what would otherwise be inherited or assumed.

- Overrides exist to handle legitimate exceptions — for example, granting a specific individual authority over a single Department without granting them authority over the entire Branch that Department belongs to.
- An override is always scoped at least as narrowly as, or exactly matching, the specific case it is intended to address. Overrides are not a mechanism for broadening authority beyond what the permission model otherwise allows; they exist to make exceptions precise, not to bypass the model.
- Every override is expected to be explicit and traceable to a deliberate decision — never an implicit side effect of some other configuration change.
- Overrides do not alter the underlying inheritance rules described in Section 9; they coexist with those rules as a additional, explicitly scoped grant or restriction.

---

## 11. Ownership Rules

Ownership rules describe who is ultimately accountable for permission decisions at each level of the hierarchy.

- Every level of the hierarchy has an accountable owner: the Platform Owner at the Platform level, Company-level management at the Company level, and so on down through Branch, Department, and Employee.
- Ownership of a level implies the authority to grant and revoke permissions within that level's scope, but never the authority to grant or revoke permissions belonging to a level above it.
- Ownership is singular in effect even when held by multiple individuals: at any given level, the set of permissions in force is always well-defined and never ambiguous, regardless of how many people hold ownership-level authority at that level.
- Ownership rules exist to ensure that every permission granted in the Platform can always be traced back to an accountable party at the appropriate level, consistent with the accountability principle in the Platform Vision.

---

## 12. Separation of Responsibilities

The Platform separates distinct kinds of authority so that no single permission accidentally grants unrelated capability.

- Administering the Platform (Platform permissions) is separated from operating within a Company (Company, Branch, Department, and Employee permissions). Holding one never implies the other, per Section 4.
- Managing people (who belongs to a Department, who holds what role) is separated from managing operational activity (schedules, breaks, tasks). A permission to manage membership does not, by itself, grant permission to manage every operational activity within that membership's scope, and vice versa, unless explicitly granted.
- Granting permissions is separated from performing the actions those permissions unlock, in the sense that the ability to define or adjust a permission is itself a distinct, higher-accountability capability, not a side effect of simply holding the permission being defined.
- This separation exists to prevent concentration of unrelated authority in a single grant, and to keep each permission's effect predictable and narrow.

---

## 13. Least Privilege Principle

Every individual and every role is granted only the permissions required for their responsibilities — no more.

- The default state for any capability is "not permitted." Permission is added deliberately for a specific responsibility, never granted broadly "to be safe" or for convenience.
- Least privilege applies uniformly across every level of the hierarchy: a Platform Owner is granted only Platform-level authority relevant to their responsibilities; a Department-level manager is granted only Department-level authority relevant to theirs.
- When responsibilities change or end, the corresponding permissions are expected to be revoked promptly rather than left in place. Unused or stale permissions are treated as a standing risk, not a harmless convenience.
- Least privilege and permission inheritance (Section 9) work together: inheritance exists to avoid re-granting the same necessary authority repeatedly, not to justify granting more authority than is needed at any given level.

---

## 14. Security Philosophy

Permission enforcement is treated as a security-critical concern at every level of the hierarchy, not merely a business convenience.

- Every permission decision is treated as consequential: an incorrect "allow" is a security failure, not a minor inconvenience, and is treated with the same seriousness regardless of which level of the hierarchy it occurs at.
- Permission checks are expected to be enforced redundantly, consistent with the defense-in-depth principle in 02-system-architecture.md — the correctness of a permission decision should never depend on a single point of enforcement behaving correctly.
- Accountability and permission are inseparable: wherever a permission allows an action, the Audit Log Service (03-core-services.md) is expected to make that action traceable, so that permission and accountability are always exercised together.
- Security philosophy at the permission level treats ambiguity as a defect. Where it is unclear whether a permission applies, the resolution favors denial over allowance, consistent with the permission-first principle in Section 2.

---

## 15. Future Extensibility

The permission model is designed to extend cleanly as the Platform grows, without requiring its foundational principles to be revisited.

- New hierarchy levels or new identity classes (per the Platform Vision's future expansion goals) are expected to fit into this model by extending the same pattern — a new level with its own scoped permissions, its own inheritance behavior, and its own accountable owner — rather than by introducing a parallel or competing permission concept.
- New roles can be introduced, and existing roles adjusted, at any time without disruption, because roles are permission templates only (Section 3) and hold no independent meaning beyond the permissions they currently represent.
- New Core Services and modules (per 03-core-services.md and 04-module-architecture.md) are expected to define their permission requirements using the same Platform, Company, Branch, Department, and Employee scopes described in this document, rather than inventing new scoping concepts.
- The permission model's extensibility is a direct consequence of its principles being scope-based and hierarchy-aligned rather than tied to any specific current capability — as the Platform's capabilities grow, the same permission philosophy continues to apply without modification.

---

## 16. Summary

The Permission Philosophy exists to ensure that authority within the Platform is always explicit, always scoped to the correct level of the Platform → Company → Branch → Department → Employee hierarchy, and always accountable to a clear owner. Roles serve this model as templates, never as identities. Inheritance and overrides make the model practical without weakening its guarantees. Least privilege and defense-in-depth keep it secure. And because every principle in this document is expressed in terms of scope and hierarchy rather than any specific current capability, the model is built to extend cleanly as the Platform evolves.

See 03-core-services.md for the Authorization Service that operationalizes this philosophy, and 07-development-standards.md for the engineering standards that apply it consistently across the codebase.
