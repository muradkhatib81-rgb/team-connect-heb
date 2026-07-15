# Core Services

Status: Draft

Version: 1.0

Owner: Platform Architecture

Last Updated: 2026-07-15

Depends On: 01-platform-vision.md, 02-system-architecture.md

Related Documents: 04-module-architecture.md, 05-database-philosophy.md, 06-permission-philosophy.md

---

## 1. Purpose of This Document

This document describes the Platform's Core Services at a conceptual level. A Core Service is a cohesive area of business capability with a single, well-defined responsibility. Services are the mechanism by which the Services layer described in the System Architecture document is organized into discrete, ownable units.

For each service, this document describes its purpose, its responsibilities, its boundaries, how it interacts with other services, how it interacts with the world outside the Platform, how it is expected to scale, and who owns it. No implementation, code, or SQL is described here — services are described purely as areas of responsibility.

---

## 2. Authentication Service

**Purpose.** Establishes and verifies the identity of a user interacting with the Platform.

**Responsibilities.** Verifying credentials, issuing and validating sessions, and answering the single question "who is this." Nothing beyond identity verification belongs to this service.

**Boundaries.** Does not decide what an identity may do — that is the responsibility of the Authorization Service. Does not know about Companies, Branches, or Departments; identity exists independently of the hierarchy.

**Internal interactions.** Every other service that requires a known identity depends on the Authentication Service to supply one before proceeding. The Authorization Service consumes the identity produced here as its starting input.

**External interactions.** The service is the Platform's boundary with the outside world for the purpose of proving identity — it is the first point of contact for any user, before any business capability is reached.

**Future scalability.** Expected to scale by supporting additional identity verification methods over time without changing how the rest of the Platform consumes an authenticated identity.

**Ownership.** Platform Architecture.

---

## 3. Authorization Service

**Purpose.** Determines what an already-identified user is permitted to do, and at what scope of the hierarchy (Platform, Company, Branch, Department).

**Responsibilities.** Evaluating role- and scope-based rules, and producing a clear allow/deny outcome for a requested action. Maintaining the conceptual model of "who may act where," independent of any single service's business logic.

**Boundaries.** Does not perform business operations itself — it only gates them. Does not verify identity; it trusts the identity handed to it by the Authentication Service.

**Internal interactions.** Consulted by every other service before a sensitive read or write is performed. Works closely with the Audit Log Service so that authorization decisions on sensitive actions are traceable.

**External interactions.** None directly; authorization is an internal gating concern invoked on behalf of external requests, not a capability exposed on its own.

**Future scalability.** Expected to extend cleanly as new hierarchy levels or identity classes are introduced, per the Permission Philosophy document, without requiring every dependent service to change its own logic.

**Ownership.** Platform Architecture.

---

## 4. Company Service

**Purpose.** Owns the concept of a Company as the primary tenancy boundary of the Platform.

**Responsibilities.** Managing the lifecycle of a Company (onboarding, configuration, and eventual offboarding) and serving as the authoritative source for "what Companies exist and what defines them."

**Boundaries.** Does not manage Branches, Departments, or Employees directly — it owns the Company as an entity, and delegates everything beneath it to the services described below. Does not concern itself with any other Company's data.

**Internal interactions.** The Branch Service depends on the Company Service to confirm that a Branch belongs to a valid, active Company. The Platform Administration Service interacts with the Company Service when onboarding or offboarding a Company.

**External interactions.** Represents the organization-level identity that other systems (e.g., billing, external integrations) would eventually reference if the Platform grows to support them.

**Future scalability.** Designed to support a growing number of Companies without structural change, consistent with the multi-tenant philosophy in the Platform Vision.

**Ownership.** Platform Architecture, in coordination with Platform Administration.

---

## 5. Branch Service

**Purpose.** Owns the concept of a Branch as a Company's place of operation.

**Responsibilities.** Managing the lifecycle of Branches within a Company, and serving as the authoritative source for "what Branches exist within this Company."

**Boundaries.** Every Branch it manages must belong to exactly one Company; the service never creates or reasons about a Branch independent of its owning Company. Does not manage Departments directly.

**Internal interactions.** Depends on the Company Service to validate ownership. The Department Service depends on the Branch Service to confirm that a Department belongs to a valid Branch. The Employee Service relies on the Branch Service to establish a user's operating context.

**External interactions.** None directly beyond what is already mediated through the Company Service.

**Future scalability.** Designed to allow a single Company to grow from one Branch to many without any change to how the service behaves.

**Ownership.** Platform Architecture.

---

## 6. Department Service

**Purpose.** Owns the concept of a Department as the operational unit within a Branch where day-to-day activity takes place.

**Responsibilities.** Managing the lifecycle of Departments within a Branch, and serving as the authoritative source for "what Departments exist within this Branch."

**Boundaries.** Every Department it manages must belong to exactly one Branch. Does not manage Employees, Schedules, or any operational activity directly — it defines the container those services operate within.

**Internal interactions.** Depends on the Branch Service for containment validation. The Employee Service, Scheduling Service, Attendance Service, Break Management Service, Tasks Service, and Reporting Service all reference the Department Service to scope their own operations correctly.

**External interactions.** None directly.

**Future scalability.** Designed to support increasing organizational depth within a Branch, consistent with the Platform Vision's future expansion goals.

**Ownership.** Platform Architecture.

---

## 7. Employee Service

**Purpose.** Owns the concept of an Employee — an individual with membership in exactly one Branch and one Department — and distinguishes the Employee domain from non-employee identities such as Platform Owners.

**Responsibilities.** Managing employee lifecycle (onboarding, role and job-title association, transfers, offboarding) and serving as the authoritative source for "who is an employee, and where do they belong."

**Boundaries.** Does not manage operational activity performed by employees (schedules, breaks, tasks, attendance) — it owns the identity and membership record, and other services own the activity. Does not manage non-employee identities.

**Internal interactions.** Depends on the Department Service and Branch Service for membership validation. Every operational service (Scheduling, Attendance, Break Management, Tasks) depends on the Employee Service to confirm that a subject of their activity is a valid employee.

**External interactions.** None directly beyond identity data already mediated through the Authentication Service.

**Future scalability.** Designed to scale to a large employee population per Department without change in behavior.

**Ownership.** Platform Architecture, in coordination with HR/Operations stakeholders.

---

## 8. Scheduling Service

**Purpose.** Owns the creation and management of employee work schedules within a Department.

**Responsibilities.** Defining and maintaining planned working time for employees, and serving as the authoritative source for "who is scheduled to work, when, and where."

**Boundaries.** Does not record what actually happened during a shift — that is the responsibility of the Attendance Service. Does not manage breaks or tasks directly, though it provides the planned-time context those services may reference.

**Internal interactions.** Depends on the Employee Service and Department Service to scope schedules correctly. The Attendance Service references scheduling data as the baseline against which actual attendance is compared. The Realtime Service propagates schedule changes to affected employees.

**External interactions.** None directly.

**Future scalability.** Designed to support increasingly complex scheduling patterns and larger workforces without changing its conceptual boundary.

**Ownership.** Platform Architecture, in coordination with Operations stakeholders.

---

## 9. Attendance Service

**Purpose.** Owns the recording and verification of actual employee presence and working time.

**Responsibilities.** Capturing when employees start and end work, reconciling actual attendance against planned schedules, and serving as the authoritative source for "who actually worked, when."

**Boundaries.** Does not define planned schedules — it consumes them from the Scheduling Service as context. Does not manage breaks directly, though attendance and break records are related and both feed the Reporting Service.

**Internal interactions.** Depends on the Scheduling Service for planned-time context and the Employee Service for identity. Supplies data to the Reporting Service and the Audit Log Service.

**External interactions.** None directly.

**Future scalability.** Designed to handle growing volumes of attendance events across many Departments and Branches without degradation.

**Ownership.** Platform Architecture, in coordination with Operations stakeholders.

---

## 10. Break Management Service

**Purpose.** Owns the request, approval, and tracking of employee breaks during working time.

**Responsibilities.** Managing the lifecycle of a break — request, approval or denial, and completion — and serving as the authoritative source for "who is on break, and under what approval."

**Boundaries.** Does not manage schedules or attendance directly, though it operates within the context both provide. Does not decide who may approve a break — that determination is delegated to the Authorization Service based on hierarchy scope.

**Internal interactions.** Depends on the Employee Service, Department Service, and Authorization Service. Interacts with the Realtime Service so that break requests and approvals are reflected live. Supplies data to the Reporting Service and Audit Log Service.

**External interactions.** None directly.

**Future scalability.** Designed to support configurable break policies per Department or Branch as the Platform evolves, without changing its core lifecycle model.

**Ownership.** Platform Architecture, in coordination with Operations stakeholders.

---

## 11. Tasks Service

**Purpose.** Owns the assignment, tracking, and completion of operational tasks within a Department.

**Responsibilities.** Managing task lifecycle — creation, assignment, progress, and completion — and serving as the authoritative source for "what work has been assigned, to whom, and its current state."

**Boundaries.** Does not manage scheduling, attendance, or breaks; tasks are a distinct operational concern that may reference those domains for context but does not own them.

**Internal interactions.** Depends on the Employee Service and Department Service for assignment validity. Interacts with the Realtime Service and Notifications Service so that task assignment and status changes reach the relevant employees.

**External interactions.** None directly.

**Future scalability.** Designed to support growing task volume and more sophisticated assignment patterns without changing its conceptual boundary.

**Ownership.** Platform Architecture, in coordination with Operations stakeholders.

---

## 12. Announcements Service

**Purpose.** Owns the creation and distribution of informational announcements to relevant audiences within the hierarchy.

**Responsibilities.** Managing announcement lifecycle (creation, targeting, expiry) and serving as the authoritative source for "what has been announced, to whom, and when."

**Boundaries.** Does not manage individual, targeted notifications tied to a specific action — that is the responsibility of the Notifications Service. Announcements are broad and informational; notifications are typically specific and actionable.

**Internal interactions.** Depends on the Company, Branch, and Department Services to determine valid targeting scope. Interacts with the Realtime Service and Notifications Service for delivery.

**External interactions.** None directly.

**Future scalability.** Designed to support targeting at any level of the hierarchy as the Platform's audience grows.

**Ownership.** Platform Architecture, in coordination with Operations/Communications stakeholders.

---

## 13. Notifications Service

**Purpose.** Owns the delivery of individual, actionable notifications to specific users as a result of events elsewhere in the Platform.

**Responsibilities.** Determining when a notification should be generated in response to an event (a task assignment, a break approval, a schedule change) and ensuring it reaches the intended recipient.

**Boundaries.** Does not generate the underlying business event — it reacts to events raised by other services. Does not manage broad, non-targeted communication — that belongs to the Announcements Service.

**Internal interactions.** Consumed by nearly every operational service (Scheduling, Attendance, Break Management, Tasks, Announcements) as the shared mechanism for informing users of relevant events. Works with the Realtime Service for immediate delivery.

**External interactions.** May, in the future, bridge to external delivery channels (e.g., push notifications, email) without changing how internal services request a notification be sent.

**Future scalability.** Designed to handle growing notification volume across a growing user base without requiring every producing service to manage delivery itself.

**Ownership.** Platform Architecture.

---

## 14. Realtime Service

**Purpose.** Owns the live propagation of state changes to connected clients, so that users see relevant updates without manual refresh.

**Responsibilities.** Delivering change notifications for operational data (schedules, breaks, tasks, attendance, announcements) to the clients authorized to see them, and only those clients.

**Boundaries.** Does not decide what changed or why — it propagates changes produced by other services. Never bypasses the Authorization Service; a client only receives realtime updates for data it is already permitted to read.

**Internal interactions.** Consumed by every operational service that requires live delivery. Depends on the Authorization Service to ensure delivery scope matches read permissions.

**External interactions.** Is the mechanism through which the frontend's Realtime Layer (per the System Architecture document) receives live updates.

**Future scalability.** Designed to extend to additional operational domains over time without changing its delivery guarantees.

**Ownership.** Platform Architecture.

---

## 15. Reporting Service

**Purpose.** Owns the aggregation and presentation of operational data into reports consumable by Company, Branch, and Department stakeholders.

**Responsibilities.** Compiling data from Scheduling, Attendance, Break Management, Tasks, and other operational services into coherent, scoped reports, and serving as the authoritative source for "what has happened, summarized."

**Boundaries.** Does not own the underlying operational data — it reads and summarizes it. Does not perform operational actions; it is read-only by nature.

**Internal interactions.** Depends on every operational service as a data source, and on the Authorization Service to ensure a report never surfaces data outside the requester's permitted scope.

**External interactions.** May, in the future, support export to external analytics or compliance systems without changing its internal responsibilities.

**Future scalability.** Designed to scale as data volume grows across Companies, Branches, and Departments, through appropriately scoped and efficient aggregation.

**Ownership.** Platform Architecture, in coordination with Operations stakeholders.

---

## 16. Audit Log Service

**Purpose.** Owns the permanent, trustworthy record of sensitive actions taken across the Platform.

**Responsibilities.** Recording who did what, when, and in what scope, for actions that require accountability (per the Platform-level permission philosophy), and serving as the authoritative source for "what happened, provably."

**Boundaries.** Does not decide what is permitted — that is the Authorization Service's responsibility. Does not allow modification or deletion of its own records; it is append-only by design.

**Internal interactions.** Consulted by every service that performs a sensitive or privileged action, particularly Platform Administration, Company Service, and Authorization Service outcomes on sensitive operations.

**External interactions.** May, in the future, support export to external compliance or audit systems without changing its internal write model.

**Future scalability.** Designed to retain a growing volume of audit records indefinitely and reliably, independent of the volume of operational activity that generates them.

**Ownership.** Platform Architecture.

---

## 17. File Storage Service

**Purpose.** Owns the storage and retrieval of files and documents associated with entities across the hierarchy (e.g., employee documents, task attachments, reports).

**Responsibilities.** Managing file lifecycle (upload, retrieval, deletion) and ensuring files are always associated with, and scoped by, the entity and hierarchy level they belong to.

**Boundaries.** Does not interpret the content or business meaning of a file — that is the responsibility of the service that owns the associated entity (e.g., Tasks Service for a task attachment). Does not bypass authorization when serving a file.

**Internal interactions.** Depends on the Authorization Service to ensure a file is only accessible to users permitted to see the entity it belongs to. Referenced by Tasks Service, Reporting Service, and Employee Service, among others.

**External interactions.** Interfaces with the underlying managed storage infrastructure described in the System Architecture document.

**Future scalability.** Designed to scale storage volume and access patterns independently of the services that reference files.

**Ownership.** Platform Architecture.

---

## 18. Platform Configuration Service

**Purpose.** Owns Platform-wide configuration values and policies that apply uniformly across all Companies.

**Responsibilities.** Managing settings that are not specific to any single Company, Branch, or Department, and serving as the authoritative source for "how does the Platform behave by default."

**Boundaries.** Does not manage Company-specific configuration — that responsibility belongs conceptually to the Company Service. Does not perform business operations; it only supplies configuration values that other services read.

**Internal interactions.** Read by any service that needs to know a Platform-wide default or policy value, including Authorization, Notifications, and Reporting.

**External interactions.** None directly.

**Future scalability.** Designed to accommodate new Platform-wide settings as the Platform evolves, without requiring changes to the services that consume them.

**Ownership.** Platform Architecture.

---

## 19. Platform Administration Service

**Purpose.** Owns the administration of the Platform itself, independent of any single Company's operations, exercised by the Platform Owner role described in the Platform Vision.

**Responsibilities.** Managing Company onboarding and offboarding, Platform-wide governance actions, and Platform Owner identity management, and serving as the authoritative source for "how is the Platform itself governed."

**Boundaries.** Never manages employee-facing operational activity; it is deliberately excluded from the Employee domain, consistent with the Platform Vision. Never bypasses the Audit Log Service — every administrative action it performs is recorded.

**Internal interactions.** Depends on the Authentication Service and Authorization Service to ensure only Platform Owners can invoke it. Depends on the Company Service to execute onboarding/offboarding, and on the Audit Log Service to record its actions.

**External interactions.** Is the Platform's primary interface for platform-level governance activities that may, in the future, connect to external business systems (billing, compliance).

**Future scalability.** Designed to remain a thin, tightly controlled layer even as the number of Companies and administrative concerns grows.

**Ownership.** Platform Architecture.

---

## 20. Cross-Service Principles

- Every service maps to exactly one area of responsibility; no two services are expected to own the same concern.
- Every service that touches operational data respects the Company → Branch → Department → Employee containment described in the Platform Vision and Database Philosophy documents.
- Every sensitive action, regardless of which service performs it, is expected to pass through the Authorization Service and be recorded by the Audit Log Service.
- Services interact with one another through clear, named dependencies (as described per service above) rather than through incidental coupling.

See 04-module-architecture.md for how these services are surfaced as user-facing modules, and 05-database-philosophy.md for the data-ownership principles that underpin them.
