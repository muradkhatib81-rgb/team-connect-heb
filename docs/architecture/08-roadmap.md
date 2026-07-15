# Roadmap

Status: Draft

Version: 1.0

Owner: Platform Architecture

Last Updated: 2026-07-15

Depends On: 01-platform-vision.md, 02-system-architecture.md, 03-core-services.md, 04-module-architecture.md, 05-database-philosophy.md, 06-permission-philosophy.md

Related Documents: 07-development-standards.md

---

## 1. Purpose of This Document

This document defines the official roadmap for evolving the system from its current form — an Employee Management System scoped to a single organization's operations — into the future multi-tenant SaaS Platform described in 01-platform-vision.md. It describes the phases of that migration conceptually: their objectives, expected outcomes, dependencies, success criteria, and risks. It does not describe implementation tasks, code, or database changes; those belong to execution planning that follows from this roadmap, not to the roadmap itself.

The roadmap assumes the Platform → Company → Branch → Department → Employee hierarchy defined in 01-platform-vision.md as its destination structure, and treats today's system — effectively a single implicit Company — as the starting point.

---

## 2. Phase 1 — Architecture Foundation

**Objectives.** Establish the documented architectural foundation — vision, system architecture, core services, module architecture, database philosophy, permission philosophy, and development standards — before any structural migration work begins.

**Expected outcome.** A complete, internally consistent set of architecture documents (as captured in `docs/architecture/`) that every subsequent phase can be measured against.

**Dependencies.** None; this is the starting phase.

**Success criteria.** Every architecture document exists, is internally consistent, and is free of conflicting definitions or duplicated concepts, per the review standard described in Section 13.

**Risks.** Proceeding to later phases without a complete and consistent foundation risks structural rework later; the primary risk of this phase is treating it as complete prematurely.

---

## 3. Phase 2 — Platform Layer

**Objectives.** Introduce the Platform as a distinct, top-level layer above the current single-organization scope, establishing Platform Owner responsibilities and Platform-level governance as described in 01-platform-vision.md and 03-core-services.md.

**Expected outcome.** A clear, functioning separation between "administering the Platform" and "operating within an organization," with Platform-level permissions and administration capabilities in place.

**Dependencies.** Phase 1 (Architecture Foundation) must be complete, since the Platform layer's responsibilities are defined there.

**Success criteria.** Platform-level governance can be exercised independently of any single organization's operational data, consistent with the Platform Administration Service described in 03-core-services.md.

**Risks.** Introducing a Platform layer around an existing single-organization system risks conflating Platform-level and organization-level authority if the separation described in 06-permission-philosophy.md is not enforced from the outset.

---

## 4. Phase 3 — Companies Layer

**Objectives.** Introduce the Company as the primary tenancy boundary, migrating the current implicit single-organization scope into an explicit, isolated Company, and establishing the structure needed to support multiple Companies.

**Expected outcome.** The system recognizes Company as a first-class boundary, with the current organization represented as the first Company, and the isolation principle described in 05-database-philosophy.md established as a governing constraint.

**Dependencies.** Phase 2 (Platform Layer), since Companies exist beneath and are onboarded through the Platform layer.

**Success criteria.** A second Company can be conceptually introduced without any structural change to how the first Company operates, demonstrating that Company isolation holds.

**Risks.** This phase carries the highest structural risk in the roadmap, as it changes the system's fundamental unit of tenancy; incomplete isolation at this stage would undermine every subsequent phase.

---

## 5. Phase 4 — Branch Templates

**Objectives.** Establish reusable Branch templates that allow a Company to stand up new Branches consistently, reflecting the Branch-belongs-to-Company containment described in 01-platform-vision.md and 05-database-philosophy.md.

**Expected outcome.** New Branches can be created within a Company following a consistent, predictable structure, reducing the effort required for a Company to expand across multiple locations.

**Dependencies.** Phase 3 (Companies Layer), since Branch templates are meaningful only once Company is an established boundary.

**Success criteria.** A Company can add a new Branch using the established template with predictable, consistent structure, without bespoke configuration for each new Branch.

**Risks.** Overly rigid templates risk not accommodating legitimate variation between Branches; overly flexible templates risk undermining the consistency this phase is meant to provide.

---

## 6. Phase 5 — Platform Dashboard

**Objectives.** Deliver a dedicated administrative experience for Platform Owners, surfacing Platform-level governance, Company oversight, and Platform-wide policy management as described in the Platform Module (04-module-architecture.md).

**Expected outcome.** Platform Owners have a coherent, dedicated view into Platform-wide state, distinct from any Company's operational dashboards.

**Dependencies.** Phases 2 and 3 (Platform Layer, Companies Layer), since the dashboard surfaces capability introduced in those phases.

**Success criteria.** Platform Owners can perform their responsibilities (per 01-platform-vision.md Section 12) entirely through this dashboard, without needing to operate within any individual Company's context.

**Risks.** Scope creep into Company-level operational detail would blur the Platform/Company separation this dashboard is meant to preserve.

---

## 7. Phase 6 — Company Dashboard

**Objectives.** Deliver a dedicated administrative experience for Company-level stakeholders, surfacing Company-wide configuration, Branch oversight, and Company-scoped reporting.

**Expected outcome.** Company-level stakeholders have a coherent view into their own Company's Branches, Departments, and aggregate operational data, entirely isolated from any other Company.

**Dependencies.** Phases 3 and 4 (Companies Layer, Branch Templates).

**Success criteria.** A Company-level stakeholder can manage their Company and oversee its Branches entirely within this dashboard, with no visibility into any other Company's data.

**Risks.** Any leakage of cross-Company data or configuration into this dashboard would be a direct violation of the isolation principle in 05-database-philosophy.md and must be treated as a critical defect, not a minor issue.

---

## 8. Phase 7 — Branch Dashboard

**Objectives.** Deliver a dedicated operational experience for Branch- and Department-level management, covering the existing Employee, Scheduling, Attendance, Breaks, Tasks, and Reports capabilities within the new hierarchy.

**Expected outcome.** Branch- and Department-level stakeholders continue to perform the operational work the current Employee Management System already supports, now correctly scoped within the Company → Branch → Department hierarchy.

**Dependencies.** Phases 3 and 4 (Companies Layer, Branch Templates), since Branch-level operations must be correctly contained before this dashboard is finalized.

**Success criteria.** Every operational capability available in the current system remains available and correctly scoped at the Branch and Department level, with no loss of existing functionality.

**Risks.** This phase carries continuity risk: because it migrates existing, actively used functionality, any regression is directly visible to current users of the Employee Management System.

---

## 9. Phase 8 — Platform Services

**Objectives.** Complete and harden the full set of Core Services described in 03-core-services.md — Authentication, Authorization, Notifications, Realtime, Reporting, Audit Log, File Storage, and the remaining services — so that every module described in 04-module-architecture.md is backed by a properly bounded service.

**Expected outcome.** Every Core Service operates within the boundaries described in 03-core-services.md, with clear ownership and no residual overlap between services.

**Dependencies.** Phases 2 through 7, since Platform Services are consumed by every layer and dashboard introduced in those phases.

**Success criteria.** Each Core Service's responsibilities match its description in 03-core-services.md, with no business rule duplicated across two services and no service silently absorbing another's responsibility.

**Risks.** Service boundaries drifting from their documented responsibilities over time is the primary risk of this phase; periodic review against 03-core-services.md is expected to mitigate it.

---

## 10. Phase 9 — Optimization

**Objectives.** Optimize performance and scalability across the hierarchy, applying the performance and scalability philosophies described in 02-system-architecture.md and 05-database-philosophy.md, once the full structural migration is functionally complete.

**Expected outcome.** The system performs predictably as the number of Companies, Branches, Departments, and Employees grows, consistent with the scalability goals in 01-platform-vision.md.

**Dependencies.** Phases 2 through 8, since optimization is meaningful only once the target structure and services are in place.

**Success criteria.** Performance remains predictable and consistent as data volume grows within a Company, and as the number of Companies on the Platform grows, without requiring structural change.

**Risks.** Optimization performed before the structure has stabilized risks solving the wrong problem, or risks optimizations that later conflict with structural changes still in progress.

---

## 11. Phase 10 — Testing

**Objectives.** Establish and execute a comprehensive testing effort focused on the architectural guarantees described in this documentation set — hierarchy containment, Company isolation, permission correctness, and service boundaries — consistent with the testing philosophy in 07-development-standards.md.

**Expected outcome.** Confidence that the migrated system upholds every guarantee described in 01-platform-vision.md, 05-database-philosophy.md, and 06-permission-philosophy.md, verified rather than assumed.

**Dependencies.** Phases 2 through 9, since testing validates the cumulative result of the structural migration and optimization work.

**Success criteria.** Isolation, containment, and permission boundaries are verified across representative scenarios, including multi-Company scenarios, with no identified gap left unresolved.

**Risks.** Testing focused only on individual features, without attention to cross-cutting guarantees like isolation, risks missing the defects that matter most at this stage of the migration.

---

## 12. Phase 11 — Production Readiness

**Objectives.** Confirm that the migrated Platform is ready to operate in production at multi-tenant scale, including operational readiness, documentation completeness, and confirmation that the Definition of Done (07-development-standards.md) has been met across the migration.

**Expected outcome.** The Platform operates in production as a multi-tenant SaaS system, serving multiple Companies through the Platform → Company → Branch → Department → Employee hierarchy, with all architectural guarantees intact.

**Dependencies.** Phases 1 through 10.

**Success criteria.** The Platform is onboarding and serving real Companies in production, with monitoring, auditing, and support processes in place, and no outstanding critical risk carried over from earlier phases.

**Risks.** Declaring production readiness before earlier-phase risks are fully resolved is the primary risk of this phase; production readiness is treated as a genuine gate, not a formality.

---

## 13. Cross-Phase Principles

- Every phase preserves, and never compromises, the Company isolation guarantee described in 05-database-philosophy.md — no phase is considered successful if it weakens isolation, even temporarily.
- Every phase is expected to leave the existing Employee Management System's users with continuous, uninterrupted operational capability; migration is additive and structural, not disruptive to day-to-day operations.
- Later phases depend on earlier phases being genuinely complete, not merely started; dependencies listed per phase are treated as hard prerequisites.
- Each phase's success criteria are evaluated against the architecture documents referenced throughout this roadmap, not against ad hoc judgment.

---

## 14. Summary

This roadmap describes an eleven-phase migration from the current Employee Management System into the future multi-tenant SaaS Platform envisioned in 01-platform-vision.md. It begins with the architectural foundation itself, proceeds through the introduction of the Platform and Company layers, builds the dashboards and services that make the new structure usable, and closes with optimization, testing, and production readiness. Every phase is anchored to the architecture, services, module, database, and permission documents that precede it in this documentation set, ensuring that the migration is guided by consistent, deliberate principles rather than ad hoc decisions.
