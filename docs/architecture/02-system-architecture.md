# System Architecture

Status: Draft

Version: 1.0

Owner: Platform Architecture

Last Updated: 2026-07-15

Depends On: 01-platform-vision.md

Related Documents: 03-core-services.md, 04-module-architecture.md, 05-database-philosophy.md, 06-permission-philosophy.md

---

## 1. High-Level Architecture Overview

The system is a single-page web application backed by a managed Supabase platform (database, authentication, and realtime infrastructure), organized around the Platform → Company → Branch → Department → Employee hierarchy defined in the Platform Vision document.

**Current state.** The application is a client-rendered frontend that communicates directly with Supabase for authentication, data access, and realtime updates. Business logic is split between client-side services and database-side functions and policies. Routing is file-based, and authenticated areas of the application are grouped under a common authenticated layout.

**Target state.** The system evolves toward a clearer three-layer separation: a presentation layer (frontend), a business-logic layer (well-defined services with explicit boundaries per hierarchy level), and a data/authorization layer (Supabase, fronted by consistent access-control primitives). The target architecture reduces direct ad-hoc data access from UI components and increases reliance on named, auditable service functions.

At a conceptual level, every layer described in this document exists to serve the same hierarchy: requests and data flow downward from the Platform level to the Employee level, and are shaped, filtered, and scoped at every boundary they cross.

---

## 2. Frontend Architecture

**Current state.** The frontend is a component-based single-page application using file-based routing, with authenticated routes grouped under a dedicated route segment. Pages compose smaller UI components and consume data through hooks that wrap the React Query layer and Supabase client calls.

**Target state.** The frontend continues to be organized by feature/domain rather than by technical layer, with a consistent pattern for how each screen obtains data (through the React Query layer), performs mutations (through the Services layer), and reflects live changes (through the Realtime layer). UI components remain free of direct business rules; business rules live in the Services layer described in Section 9.

**Principles guiding this layer:**

- Screens are composed from reusable, presentation-focused components.
- Data-fetching and mutation concerns are abstracted behind hooks rather than embedded in components.
- Route boundaries reflect the operational hierarchy (e.g., authenticated vs. unauthenticated areas) rather than arbitrary technical grouping.

---

## 3. Backend Architecture

**Current state.** There is no separate, independently deployed backend server. Backend responsibilities are fulfilled by a combination of: (a) the managed Supabase platform, which provides the database, authentication, and realtime infrastructure, and (b) server-side functions that run business logic close to the client but are isolated from UI code, invoked through a consistent authentication middleware.

**Target state.** The backend responsibility continues to be expressed primarily through Supabase and server-side functions, with an increasing emphasis on funneling all writes and sensitive reads through named, auditable functions rather than direct table access from the client. The backend architecture is expected to remain "thin but disciplined" — favoring strong boundaries and auditability over introducing a separate general-purpose application server, unless a future scalability or compliance need requires one.

---

## 4. Supabase Architecture

**Current state.** Supabase serves as the system's managed data and identity platform. It provides the relational database, row-level access control, database-side functions used for cross-cutting rules (validation, guard rails, audit logging), and the realtime change-notification mechanism consumed by the frontend.

**Target state.** Supabase remains the platform's data and identity backbone. The target evolution focuses on strengthening the consistency of how access control is expressed at the database level, ensuring that every hierarchy level (Company, Branch, Department) has a uniform, predictable way of scoping data, and ensuring that database-side logic and client-side logic never diverge on the same business rule.

This document does not describe schema, tables, or SQL; those are covered in the Database Philosophy document.

---

## 5. Authentication Layer

**Current state.** Authentication is provided by Supabase's identity service. Authenticated routes are grouped behind a dedicated route segment, and server-side functions enforce authentication through a shared middleware before any business logic executes.

**Target state.** Authentication remains centralized in Supabase. The target state emphasizes a single, consistent authentication check applied uniformly across every server-side function and every protected route, so that no code path can bypass identity verification. Authentication answers only "who is this," and is deliberately kept separate from authorization, which answers "what may this identity do."

---

## 6. Authorization Layer

**Current state.** Authorization is expressed through role-based checks that are enforced both in the database (through access-control policies and guard functions) and in server-side business logic (through explicit assertions before sensitive actions are performed). Authorization is scoped to the hierarchy: platform-level authority, company-level authority, branch-level authority, department-level authority, and employee-level authority are treated as distinct concerns.

**Target state.** Authorization continues to be enforced redundantly at the database layer and the service layer, treating the database as the ultimate source of truth for "is this allowed" and the service layer as an additional, defense-in-depth check. The target state extends this model uniformly as new hierarchy levels or identity classes are introduced, per the Permission Philosophy document.

---

## 7. Realtime Layer

**Current state.** The system uses Supabase's realtime change-notification capability to reflect operational changes (such as schedule, break, task, and attendance updates) to connected clients without requiring a manual refresh.

**Target state.** The realtime layer is expected to grow in scope as more operational domains beneath the Department level (Schedules, Breaks, Tasks, Attendance, Reports) adopt live updates, always scoped so that a client only receives realtime updates for data it is authorized to see — realtime delivery never bypasses the authorization layer described in Section 6.

---

## 8. React Query Layer

**Current state.** Data fetching, caching, and synchronization between the frontend and Supabase are mediated through a query-caching layer. This layer is responsible for deduplicating requests, caching results, and invalidating cached data after mutations, so that UI components do not manage server-state manually.

**Target state.** The query-caching layer remains the single mechanism through which UI components read server state. The target state standardizes query-key conventions and invalidation patterns across every domain (Employees, Schedules, Breaks, Tasks, Attendance, Reports), so that caching behavior is predictable and consistent regardless of which part of the hierarchy a screen belongs to.

---

## 9. Services Layer

**Current state.** Business logic that spans multiple concerns — creating identities, validating cross-entity rules, writing audit records — is organized into dedicated service modules rather than being embedded in UI components. Services are the layer responsible for enforcing that a business operation is performed completely and consistently, including any auxiliary steps (such as audit logging) that must always accompany it.

**Target state.** Every meaningful business operation in the system is expected to be reachable through exactly one service function, never duplicated across multiple call sites. The target state treats the Services layer as the single place where "what does it mean to perform this business operation" is answered, so that UI code, automation, and future integrations all share the same behavior.

---

## 10. Shared Utilities

**Current state.** Cross-cutting concerns that do not belong to a single domain — such as centralized label definitions, formatting helpers, and constants — are kept in shared utility modules referenced by multiple parts of the frontend, rather than being duplicated per feature.

**Target state.** Shared utilities remain intentionally small and generic. The target state avoids letting shared utilities accumulate domain-specific business logic; anything that encodes a business rule belongs in the Services layer, not in shared utilities.

---

## 11. Module Boundaries

**Current state.** The application is organized so that each operational domain (Employees, Schedules, Breaks, Tasks, Attendance, Reports, Platform Ownership) has its own recognizable area of the codebase, with its own services and its own UI surfaces.

**Target state.** Module boundaries are expected to align increasingly closely with the Platform → Company → Branch → Department hierarchy, so that a module's boundary answers both "what business capability does this provide" and "at what level of the hierarchy does this capability operate." Cross-module reads are permitted; cross-module business logic (one module silently implementing another module's rules) is not.

---

## 12. Platform Layer

**Current state.** Platform-level concerns — administration of the Platform itself, independent of any single Company's operations — are handled by dedicated, clearly separated logic and are never mixed with Company- or Branch-level operational code paths.

**Target state.** The Platform layer remains the outermost layer of the system, responsible only for platform-wide administration and governance. It continues to be deliberately excluded from operational (employee-facing) domains, consistent with the Platform Vision.

---

## 13. Company Layer

**Current state.** Company-level identity is the primary tenancy boundary in the system. Every piece of operational data can be traced back to exactly one Company, and access is scoped so that no operation belonging to one Company is visible to another.

**Target state.** The Company layer continues to be the anchor of multi-tenancy. As the system evolves, any new Company-wide capability is expected to be scoped explicitly to the Company layer, preserving the isolation guarantees described in the Platform Vision.

---

## 14. Branch Layer

**Current state.** Branches represent a Company's places of operation and are the level at which a user's "active operating context" is generally established. Branch-scoped data and permissions are derived from, and always contained within, the owning Company.

**Target state.** The Branch layer continues to provide the operational context for day-to-day activity, while remaining strictly subordinate to its Company. Future capabilities introduced at the Branch level are expected to respect this containment without exception.

---

## 15. Department Layer

**Current state.** Departments are the operational unit within a Branch where the concrete activities of the system take place: employee assignment, scheduling, breaks, tasks, attendance, and reporting.

**Target state.** The Department layer remains the primary home for operational business capabilities. As new operational capabilities are introduced (per the Platform Vision's future expansion goals), they are expected to be modeled as Department-level concerns unless a stronger case exists for placing them at the Branch or Company level.

---

## 16. Employee Layer

**Current state.** Employees are individuals with membership in exactly one Branch and one Department, and are the subjects of the system's core operational activities (Schedules, Breaks, Tasks, Attendance). Non-employee identities (such as Platform Owners) are explicitly modeled as being outside this layer.

**Target state.** The Employee layer remains the most granular level of the hierarchy addressed by this document. The target state continues to enforce a clear boundary between employee-domain identities and non-employee identities, ensuring that operational logic never assumes every authenticated user is an employee.

---

## 17. Data Flow Between Layers

**Current state.** A typical read flows from a UI component, through the React Query layer, to Supabase (directly or through a server-side function), scoped by the authenticated user's Company, Branch, and Department context, and filtered by the authorization layer before results are returned. A typical write flows from a UI component, through the Services layer, into Supabase, where database-side rules provide a final layer of validation and access control regardless of what the client requested.

**Target state.** The target data flow is deliberately linear and predictable in both directions:

```
UI Component → React Query Layer → Services Layer → Supabase → Authorization Layer → Data
Data → Authorization Layer → Supabase → Services / Realtime Layer → React Query Layer → UI Component
```

Every hop in this flow is expected to respect the hierarchy scoping established at the Company, Branch, and Department levels, and no layer is expected to bypass the layer beneath it.

---

## 18. Scalability Strategy

The scalability strategy at the system-architecture level mirrors the scalability goals defined in the Platform Vision:

- **Horizontal growth of tenants.** Because Company-level isolation is structural rather than incidental, adding Companies does not require architectural change — it requires only more instances of the same well-defined pattern.
- **Vertical growth within a tenant.** A single Company can grow from one Branch to many, and from a few Departments to many, without the system's architecture needing to change shape — only its data volume changes.
- **Layered caching and query discipline.** The React Query layer absorbs much of the read-side scaling pressure by avoiding redundant requests, while the Services layer ensures that write-side operations remain consistent regardless of load.
- **Database-enforced guarantees.** Because authorization and key business rules are enforced at the database layer in addition to the application layer, the system's core guarantees hold even as the number of access paths into the data grows over time.

---

## 19. Architectural Principles

The following principles govern decisions across every layer described in this document:

1. **Hierarchy is structural, not incidental.** Platform, Company, Branch, and Department boundaries are expressed consistently across the frontend, services, and data layers — not just enforced in one place.
2. **Defense in depth for authorization.** Access control is never trusted from a single layer alone; the database and the service layer independently enforce the same rules.
3. **Single source of truth per concern.** Each business rule, label, or piece of derived state has exactly one authoritative place it is defined, and every other layer consumes it from there rather than redefining it.
4. **Separation of identity concepts.** Authentication (who), authorization (what they may do), and business classification (e.g., job titles, organizational role) are treated as independent concerns that may relate to one another but are never conflated.
5. **UI reflects, it does not decide.** Presentation components consume state and trigger operations; they do not independently encode business rules that belong in the Services layer.
6. **Isolation is non-negotiable.** No architectural convenience is permitted to compromise Company-level isolation, as established in the Platform Vision.

---

## 20. Future Architecture Evolution

The system architecture is expected to evolve along the following lines, consistent with the Platform Vision's future expansion goals:

- **Deeper standardization of the Services layer**, so that every business operation across every Department-level domain (Employees, Schedules, Breaks, Tasks, Attendance, Reports) follows an identical shape: authenticate, authorize, execute, audit.
- **Broader adoption of the Realtime layer** across operational domains that do not yet have live updates, always subject to the same authorization boundaries as non-realtime reads.
- **Tighter alignment between module boundaries and the hierarchy**, reducing any remaining cases where a module's responsibility does not map cleanly to a single hierarchy level.
- **Continued reliance on Supabase as the platform's data and identity backbone**, with architectural attention focused on discipline (consistent access patterns, consistent auditing) rather than on replacing or duplicating its core capabilities.
- **Extension of the hierarchy itself**, should the Platform Vision's future organizational patterns require it, without weakening the isolation or authorization guarantees already established.

This document will be revisited as the system architecture materially changes, and its "current state" sections are expected to be updated over time to remain accurate.
