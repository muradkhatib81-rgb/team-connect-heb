# Database Philosophy

Status: Draft

Version: 1.0

Owner: Platform Architecture

Last Updated: 2026-07-15

Depends On: 01-platform-vision.md, 02-system-architecture.md

Related Documents: 03-core-services.md, 04-module-architecture.md, 06-permission-philosophy.md

---

## 1. Purpose of This Document

This document describes the philosophy that governs how the Platform's data is owned, contained, and protected. It exists to explain *why* the database behaves the way it does — not how it is built. It contains no table definitions, no schema, and no SQL; those belong to implementation, not architecture. Every principle in this document exists in service of the hierarchy and isolation guarantees established in the Platform Vision.

---

## 2. Why the Database Is Tenant-First

The database is designed around tenancy as its first organizing principle, not as an attribute added after the fact.

- Every piece of operational data is understood, from the outset, to belong to a specific Company. Tenancy is not a filter applied to an otherwise tenant-agnostic dataset — it is the lens through which all data is defined.
- Designing tenant-first means that "which Company does this belong to" is always answerable, for any piece of data, without exception or ambiguity.
- This approach exists because the Platform serves many unrelated organizations simultaneously (per the multi-tenant philosophy in the Platform Vision), and a database that treated tenancy as secondary would risk that separation eroding as the system grows.

---

## 3. Why Company Isolation Is Absolute

Company isolation is treated as an unconditional guarantee of the database, not a configurable or best-effort behavior.

- No Company's data may ever be visible to, inferable by, or affected by another Company, regardless of the scale, complexity, or nature of the operation being performed.
- Isolation is absolute because trust is the foundation of the Platform's relationship with every Company it serves (as established in the Platform Vision) — a partial or conditional guarantee would undermine that trust entirely.
- Absoluteness also simplifies reasoning about the system at scale: because no exception exists, every new capability added to the Platform can be verified against a single, unambiguous rule rather than a list of special cases.

---

## 4. Why Branch Belongs to Company

A Branch has no independent existence apart from the Company that operates it, and the database reflects this containment directly.

- Every Branch is owned by exactly one Company, and that ownership is permanent for the life of the Branch — a Branch cannot exist without a Company, nor can it move between Companies.
- This containment exists because a Branch is not itself an organization; it is a place where an existing organization (the Company) conducts its operations, as described in the Platform Vision.
- Because Branch belongs to Company, every isolation guarantee that applies at the Company level extends automatically to the Branch level — there is no separate isolation rule to define or maintain for Branches.

---

## 5. Why Departments Belong to Branch

Departments exist only within the context of a Branch, mirroring the same containment logic that governs Branch-within-Company.

- Every Department is owned by exactly one Branch, and a Department's data and activity are always understood relative to that Branch.
- This containment reflects operational reality: a Department is a way of organizing work *within* a specific place of operation, not an independent entity.
- As with Branches, this containment means Department-level isolation is inherited automatically from the Branch and Company levels above it, rather than requiring independent enforcement.

---

## 6. Why Employees Belong to Department

Employees are the most granular level of the hierarchy addressed by this document, and their containment within a Department is treated as a foundational, not incidental, property.

- Every employee has membership in exactly one Branch and one Department, established at onboarding and maintained throughout their employment.
- This containment exists because operational accountability — who is scheduled, who attended, who took a break, who completed a task — only makes sense in the context of a specific Department's activity.
- Non-employee identities (such as Platform Owners) are explicitly modeled as existing outside this containment, because they are not part of the Employee domain, consistent with the Platform Vision.

---

## 7. Data Ownership Philosophy

The database philosophy treats every piece of data as having exactly one owning context at every level of the hierarchy it belongs to.

- Data ownership is transitive down the hierarchy: an Employee's data is owned within a Department, which is owned within a Branch, which is owned within a Company, which is owned within the Platform.
- No data is considered "ownerless" or "global by default" — anything that is genuinely Platform-wide (such as Platform Configuration) is deliberately and explicitly modeled as such, rather than emerging by omission.
- Ownership determines both who may act on data and who is accountable for it; the two are treated as inseparable.

---

## 8. Referential Integrity Philosophy

Referential integrity is treated as a direct expression of the hierarchy's containment rules, not merely a technical safeguard.

- Every reference from a lower level to a higher level (Department to Branch, Branch to Company, Employee to Department) is expected to always resolve to a valid, existing parent — the hierarchy is never allowed to have a "dangling" level.
- Referential integrity exists to make the hierarchy provably consistent: if the database enforces that every child has a valid parent, then the containment principles described in Sections 4 through 6 are guaranteed, not merely assumed.
- This philosophy favors making invalid states structurally impossible over relying on application code to prevent them, wherever the two approaches are both available.

---

## 9. Scalability Philosophy

The database's scalability philosophy is a direct extension of the Platform Vision's scalability goals, expressed at the data layer.

- Growth in the number of Companies should place no additional structural burden on the database beyond proportional data volume — the same tenant-first design that serves one Company serves many.
- Growth within a single Company (more Branches, more Departments, more Employees) is expected to scale predictably because every level of the hierarchy is bounded by, and scoped to, the level above it.
- Scalability is pursued primarily through consistent containment and scoping rather than through ad hoc, case-by-case optimization — a well-contained hierarchy remains tractable to scale even as it grows large.

---

## 10. Security Philosophy

Security at the database layer is treated as a first-class, always-on property of the data itself, not a layer bolted on afterward.

- Access to data is always evaluated in the context of the requester's identity and their position in the hierarchy (Platform, Company, Branch, Department), consistent with the Authorization Service described in 03-core-services.md.
- The database is expected to enforce access rules independently of, and in addition to, any checks performed elsewhere in the system, so that security does not depend on every calling layer behaving correctly.
- Security and isolation are treated as the same underlying concern viewed from two angles: isolation prevents cross-Company visibility, while security prevents any unauthorized access, cross-Company or otherwise.

---

## 11. Auditing Philosophy

Auditing exists to make the history of sensitive actions permanent, trustworthy, and independent of the actors it records.

- Every sensitive action is expected to leave a record that cannot later be altered or removed by the actor who performed it, consistent with the Audit Log Service described in 03-core-services.md.
- Audit records are treated as a parallel, append-only history alongside the operational data they describe — they exist to answer "what happened" even if the operational data itself later changes.
- The auditing philosophy favors recording too much sensitive activity over too little; visibility into what happened is treated as a safeguard, not an afterthought.

---

## 12. Soft Delete Philosophy

Deletion within the Platform is treated as a business event to be recorded, not merely a technical removal of data.

- Where data represents something that once existed and mattered (an employee's history, a completed task, a past schedule), removal is expressed as a change of state rather than a physical erasure, preserving the ability to reconstruct history when needed.
- This philosophy exists because operational and audit needs frequently require looking back at data that is no longer "active" — a physically deleted record cannot support that need.
- Soft deletion is applied deliberately and only where historical continuity has genuine business value; it is not treated as a universal default for every kind of data.

---

## 13. Future Migration Philosophy

Changes to the database over time are expected to preserve the hierarchy and isolation guarantees this document describes, regardless of what new capability is being introduced.

- Every future change is evaluated first against the question: "does this preserve Company isolation and hierarchy containment?" A change that would compromise either is not acceptable, regardless of its other merits.
- Migrations are expected to be additive and backward-compatible wherever possible, so that existing Companies are never disrupted by changes introduced to serve new capability.
- New hierarchy levels or new operational domains (per the Platform Vision's future expansion goals) are expected to be introduced by extending the existing containment model, not by creating parallel or competing structures.

---

## 14. Performance Philosophy

Performance is treated as a consequence of good containment and scoping, not a separate concern to be solved independently of the hierarchy.

- Because every query is naturally scoped to a Company, Branch, or Department, the database's performance characteristics are expected to remain predictable regardless of how many other Companies exist on the Platform.
- Performance work is expected to focus on making common, correctly scoped access patterns fast, rather than compensating for access patterns that ignore the hierarchy.
- As data volume grows within a single Company, performance philosophy favors solutions that respect existing containment boundaries over solutions that would require flattening or bypassing them.

---

## 15. Multi-Company Growth Strategy

The database's strategy for supporting growth in the number of Companies follows directly from the tenant-first and isolation principles described above.

- Onboarding a new Company is expected to be a routine, low-risk operation precisely because Company isolation means a new Company cannot affect, or be affected by, any existing Company.
- The growth strategy relies on the uniformity of the hierarchy: every Company is structured the same way (Company → Branch → Department → Employee), so the database does not need Company-specific structural variation to support new tenants.
- As the number of Companies grows, the database's design goal is that no individual Company should be able to perceive, through performance or behavior, how many other Companies exist on the Platform.

---

## 16. Summary

The database philosophy exists to ensure that the hierarchy and isolation guarantees defined in the Platform Vision are not merely conventions followed by application code, but properties the data itself is structured to uphold. Every principle described in this document — tenant-first design, absolute isolation, strict containment, ownership, referential integrity, security, auditing, soft deletion, migration discipline, performance, and multi-company growth — serves that same underlying commitment: the Platform must remain trustworthy and coherent at any scale.

See 03-core-services.md for the services that operate on top of this philosophy, and 06-permission-philosophy.md for how access to this data is governed.
