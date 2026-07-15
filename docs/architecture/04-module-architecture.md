# Module Architecture

Status: Draft

Version: 1.0

Owner: Platform Architecture

Last Updated: 2026-07-15

Depends On: 01-platform-vision.md, 02-system-architecture.md, 03-core-services.md

Related Documents: 05-database-philosophy.md, 06-permission-philosophy.md

---

## 1. Purpose of This Document

This document describes every functional module of the Platform from a business and user-facing perspective. Where the Core Services document (03-core-services.md) describes *services* — cohesive areas of backend responsibility — this document describes *modules*: the user-facing groupings of capability that stakeholders actually interact with, request changes to, and reason about as product areas.

A module is typically supported by one or more Core Services, but the two are not the same thing: a module is defined by who uses it and what business purpose it serves, while a service is defined by what it owns and how it is bounded internally. This document does not repeat the internal responsibilities already described in 03-core-services.md; it cross-references them instead.

---

## 2. Platform Module

**Business purpose.** Represents the Platform itself as an administrable entity — the outermost layer that exists above every Company.

**Users.** Platform Owners only.

**Responsibilities.** Platform-wide governance, Company onboarding and offboarding, and Platform-wide policy decisions.

**Inputs.** Platform Owner administrative actions; Platform-wide configuration values.

**Outputs.** Newly onboarded or offboarded Companies; Platform-wide policy state consumed by every other module.

**Dependencies.** Platform Administration Service, Platform Configuration Service, Authorization Service (see 03-core-services.md).

**Future expansion.** Additional Platform-wide governance capabilities as the number of Companies and the scope of Platform Owner responsibilities grow, per the Platform Vision's future expansion goals.

---

## 3. Companies Module

**Business purpose.** Represents an individual organization using the Platform and anchors every module beneath it.

**Users.** Platform Owners (for onboarding/administration); Company-level stakeholders (for managing their own Company's configuration).

**Responsibilities.** Company identity and configuration, and serving as the tenancy boundary that every other business module operates within.

**Inputs.** Company onboarding actions from the Platform module; Company-level configuration changes.

**Outputs.** A validated Company context that the Branches module, and everything beneath it, depends on.

**Dependencies.** Company Service, Platform Administration Service (see 03-core-services.md).

**Future expansion.** Company-wide capabilities that sit above individual Branches, as anticipated in the Platform Vision.

---

## 4. Branches Module

**Business purpose.** Represents a Company's places of operation.

**Users.** Company- and Branch-level management.

**Responsibilities.** Branch identity, configuration, and the operating context users select when working within a Company.

**Inputs.** Branch creation and configuration actions from Company-level stakeholders.

**Outputs.** A validated Branch context consumed by the Departments module and every operational module beneath it.

**Dependencies.** Branch Service, Company Service (see 03-core-services.md).

**Future expansion.** Support for additional Branch-level operational context as Companies grow across more locations.

---

## 5. Departments Module

**Business purpose.** Represents the operational unit within a Branch where day-to-day work is organized.

**Users.** Branch- and Department-level management.

**Responsibilities.** Department identity and configuration, and serving as the immediate container for Employees and all operational activity.

**Inputs.** Department creation and configuration actions from Branch-level management.

**Outputs.** A validated Department context consumed by the Employees, Scheduling, Attendance, Breaks, Tasks, and Reports modules.

**Dependencies.** Department Service, Branch Service (see 03-core-services.md).

**Future expansion.** Deeper organizational structuring within a Branch, should future operational needs require it.

---

## 6. Employees Module

**Business purpose.** Represents the individuals who perform operational work within a Department, distinct from non-employee identities such as Platform Owners.

**Users.** Department- and Branch-level management (administering employees); employees themselves (viewing and managing their own profile and activity).

**Responsibilities.** Employee identity, membership, and lifecycle (onboarding, transfer, offboarding).

**Inputs.** Employee onboarding, transfer, and offboarding actions; job-title and role association.

**Outputs.** A validated Employee identity consumed by the Scheduling, Attendance, Breaks, Tasks, Notifications, and Reports modules.

**Dependencies.** Employee Service, Department Service, Authentication Service, Authorization Service (see 03-core-services.md).

**Future expansion.** Richer employee profile and lifecycle capabilities as HR and operational needs evolve.

---

## 7. Scheduling Module

**Business purpose.** Represents the planning of employee working time within a Department.

**Users.** Department- and Branch-level management (creating schedules); employees (viewing their own schedule).

**Responsibilities.** Creating, adjusting, and communicating planned working time.

**Inputs.** Scheduling decisions made by management; employee and Department context.

**Outputs.** Planned-time records consumed by the Attendance module as a comparison baseline, and by the Notifications module to inform employees of changes.

**Dependencies.** Scheduling Service, Employee Service, Department Service, Realtime Service (see 03-core-services.md).

**Future expansion.** More sophisticated scheduling patterns as operational complexity grows.

---

## 8. Attendance Module

**Business purpose.** Represents the record of actual employee presence and working time.

**Users.** Employees (recording attendance); Department- and Branch-level management (reviewing attendance).

**Responsibilities.** Capturing actual working time and reconciling it against planned schedules.

**Inputs.** Employee attendance events; scheduling data as comparison context.

**Outputs.** Attendance records consumed by the Reports module and, where relevant, the Audit module.

**Dependencies.** Attendance Service, Scheduling Service, Employee Service (see 03-core-services.md).

**Future expansion.** Additional attendance-related insights as reporting needs mature.

---

## 9. Breaks Module

**Business purpose.** Represents the request, approval, and tracking of employee breaks.

**Users.** Employees (requesting breaks); Department- and Branch-level management (approving breaks).

**Responsibilities.** Managing the full lifecycle of a break request from submission to completion.

**Inputs.** Break requests from employees; approval or denial decisions from management.

**Outputs.** Break state consumed live by the Realtime module and summarized by the Reports module.

**Dependencies.** Break Management Service, Employee Service, Department Service, Authorization Service, Realtime Service (see 03-core-services.md).

**Future expansion.** Configurable break policies per Department or Branch.

---

## 10. Tasks Module

**Business purpose.** Represents the assignment and tracking of operational work items within a Department.

**Users.** Department- and Branch-level management (assigning tasks); employees (completing assigned tasks).

**Responsibilities.** Managing task creation, assignment, progress tracking, and completion.

**Inputs.** Task creation and assignment decisions from management; progress updates from employees.

**Outputs.** Task state consumed by the Notifications module (to inform assignees) and the Reports module (to summarize completion).

**Dependencies.** Tasks Service, Employee Service, Department Service, Realtime Service, Notifications Service (see 03-core-services.md).

**Future expansion.** More sophisticated task assignment and tracking patterns as operational needs grow.

---

## 11. Notifications Module

**Business purpose.** Represents the delivery of individual, actionable alerts to specific users in response to events elsewhere in the Platform.

**Users.** Every authenticated user, as recipients.

**Responsibilities.** Ensuring relevant events (task assignment, break approval, schedule change) reach the right user promptly.

**Inputs.** Events raised by the Scheduling, Attendance, Breaks, and Tasks modules.

**Outputs.** Delivered notifications visible to the recipient.

**Dependencies.** Notifications Service, Realtime Service (see 03-core-services.md).

**Future expansion.** Additional delivery channels beyond in-platform notification.

---

## 12. Announcements Module

**Business purpose.** Represents broad, informational communication distributed to an audience within the hierarchy, as distinct from targeted, actionable notifications.

**Users.** Company-, Branch-, or Department-level management (publishing announcements); employees (receiving announcements).

**Responsibilities.** Creating, targeting, and expiring informational announcements.

**Inputs.** Announcement creation and targeting decisions from management.

**Outputs.** Delivered announcements visible to the targeted audience.

**Dependencies.** Announcements Service, Notifications Service, Realtime Service (see 03-core-services.md).

**Future expansion.** Targeting refinements as the Platform's audience and hierarchy grow.

---

## 13. Reports Module

**Business purpose.** Represents the aggregation and presentation of operational data for review by stakeholders at every level of the hierarchy.

**Users.** Company-, Branch-, and Department-level management; Platform Owners for platform-wide insight.

**Responsibilities.** Compiling and presenting summaries of Scheduling, Attendance, Breaks, Tasks, and other operational data.

**Inputs.** Data produced by every operational module.

**Outputs.** Scoped reports visible only within the requester's permitted hierarchy scope.

**Dependencies.** Reporting Service, and every operational service it summarizes (see 03-core-services.md).

**Future expansion.** New report types as operational domains expand, and potential export to external analytics systems.

---

## 14. Settings Module

**Business purpose.** Represents configuration surfaces at each level of the hierarchy — Company, Branch, and Department — as distinct from Platform-wide configuration.

**Users.** Management at the corresponding hierarchy level.

**Responsibilities.** Managing configuration values scoped to a specific Company, Branch, or Department.

**Inputs.** Configuration changes made by scoped management.

**Outputs.** Configuration state consumed by the modules operating within that scope.

**Dependencies.** Company Service, Branch Service, Department Service, Platform Configuration Service (see 03-core-services.md).

**Future expansion.** Additional configurable behavior as modules mature and require scoped customization.

---

## 15. Administration Module

**Business purpose.** Represents Platform-level administrative capability distinct from any single Company's operations — the user-facing surface of the Platform Administration Service.

**Users.** Platform Owners only.

**Responsibilities.** Company onboarding/offboarding, Platform Owner identity management, and Platform-wide governance actions.

**Inputs.** Platform Owner administrative decisions.

**Outputs.** Company lifecycle changes, Platform Owner identity changes, and corresponding audit records.

**Dependencies.** Platform Administration Service, Authorization Service, Audit Log Service (see 03-core-services.md).

**Future expansion.** Additional governance capability as the Platform grows in scale and complexity.

---

## 16. Realtime Module

**Business purpose.** Represents the live-update experience that lets users see relevant changes as they happen, without manual refresh.

**Users.** Every authenticated user, implicitly, wherever a module supports live updates.

**Responsibilities.** Propagating authorized state changes to connected clients across Scheduling, Breaks, Tasks, Attendance, Announcements, and Notifications.

**Inputs.** State changes produced by every operational module.

**Outputs.** Live updates delivered to the frontend, scoped by the recipient's authorization.

**Dependencies.** Realtime Service, Authorization Service (see 03-core-services.md).

**Future expansion.** Extension to additional operational domains that do not yet have live updates.

---

## 17. Audit Module

**Business purpose.** Represents the permanent, trustworthy record of sensitive actions across the Platform, providing accountability for every hierarchy level.

**Users.** Platform Owners and appropriately scoped management, as readers; every module, indirectly, as a source of recorded events.

**Responsibilities.** Recording and surfacing a reliable history of who did what, when, and in what scope.

**Inputs.** Sensitive actions performed across every module.

**Outputs.** An immutable, queryable audit trail.

**Dependencies.** Audit Log Service, Authorization Service (see 03-core-services.md).

**Future expansion.** Export to external compliance systems as regulatory or business needs require.

---

## 18. Files Module

**Business purpose.** Represents the storage and retrieval of documents and attachments associated with entities across the hierarchy.

**Users.** Any user permitted to view or manage the entity a file is attached to (e.g., an employee document, a task attachment).

**Responsibilities.** Managing file lifecycle and ensuring files remain scoped to the entity and hierarchy level they belong to.

**Inputs.** File uploads associated with a specific entity.

**Outputs.** Retrievable files, access-controlled by the same rules that govern the entity they are attached to.

**Dependencies.** File Storage Service, Authorization Service (see 03-core-services.md).

**Future expansion.** Broader adoption across additional modules as document-handling needs grow.

---

## 19. How Modules Communicate While Remaining Isolated

Modules are designed to collaborate without merging into one another's responsibilities. The following principles govern inter-module communication:

- **Communication through defined outputs, not shared internals.** A module exposes its outputs (e.g., a validated Department context, a task assignment event) for other modules to consume; it never allows another module to directly manipulate its internal state.
- **Hierarchy context flows downward.** Platform, Company, Branch, and Department context is established once and passed down to the modules that operate within it (Employees, Scheduling, Attendance, Breaks, Tasks, Reports), rather than each module independently re-deriving that context.
- **Cross-cutting modules serve, rather than absorb.** Notifications, Announcements, Realtime, Audit, and Files exist to serve every other module with a shared capability; they never take on the business responsibility of the modules they serve.
- **Isolation between Companies is preserved at every hop.** No module-to-module interaction is permitted to cross Company boundaries; every communication path, however indirect, respects the isolation principle established in the Platform Vision.
- **Authorization is checked at every boundary crossing.** Whenever one module's output becomes another module's input, the Authorization Service is the shared gate that ensures the receiving module only acts on data it is entitled to see or use.

This communication model allows the Platform's modules to remain independently understandable and independently evolvable, while still functioning as a single coherent system.
