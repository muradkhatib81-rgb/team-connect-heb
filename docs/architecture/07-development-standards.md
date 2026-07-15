# Development Standards

Status: Draft

Version: 1.0

Owner: Platform Architecture

Last Updated: 2026-07-15

Depends On: 02-system-architecture.md, 03-core-services.md, 06-permission-philosophy.md

Related Documents: 04-module-architecture.md, 05-database-philosophy.md, 08-roadmap.md

---

## 1. Purpose of This Document

This document defines the official engineering standards for the Platform. It exists to ensure that every contributor — human or AI — produces work that is consistent with the architecture described in the preceding documents, regardless of who or what performs the work. Standards described here are directional and organizational; they do not contain code samples, and they do not replace the judgment required to apply them to a specific change.

---

## 2. Project Structure

- The codebase is organized so that its structure reflects the architecture described in 02-system-architecture.md: a clear separation between the presentation layer, the services layer, shared utilities, and the Supabase-backed data/authorization layer.
- Structure should make it obvious, from directory layout alone, where a given concern lives — a contributor should rarely need to search broadly to find where a capability is implemented.
- Structural changes (introducing new top-level areas, reorganizing existing ones) are treated as architectural decisions and should be considered in light of the module boundaries described in 04-module-architecture.md, not made incidentally as part of an unrelated change.

---

## 3. Folder Organization

- Folders are organized primarily by business domain and module (per 04-module-architecture.md), with technical layering (components, hooks, services) expressed within a domain rather than domains being scattered across technical-layer folders.
- Shared, domain-agnostic code lives in clearly labeled shared locations, distinct from domain-specific folders, so that "shared" never becomes a place where domain logic accidentally accumulates.
- Every new folder should have a single, describable purpose. If a folder's purpose cannot be described in one sentence, it is a signal that it should be split or reconsidered.

---

## 4. Naming Conventions

- Names throughout the codebase should reflect the business vocabulary established in the architecture documents (Platform, Company, Branch, Department, Employee, and the module/service names in 03-core-services.md and 04-module-architecture.md) rather than inventing parallel terminology.
- Naming should distinguish clearly between similar-but-distinct concepts already separated in the architecture documents — for example, a role (a permission template, per 06-permission-philosophy.md) should never be named or described as though it were a job title or an operational position.
- Names should be descriptive of purpose over implementation detail; a name should tell a reader what something is for, not merely what technology it happens to use.
- Consistency of naming across the frontend, the services layer, and the data layer is treated as a standard in its own right — the same business concept should be recognizable by name wherever it appears.

---

## 5. TypeScript Standards

- Type safety is treated as a first-class correctness tool, not a formality. Business concepts defined in the architecture documents (Company, Branch, Department, Employee, roles, permissions) should be represented with types that make invalid states difficult to express.
- Types should mirror the hierarchy and containment rules described in 05-database-philosophy.md wherever practical — for example, a type representing Department-scoped data should make its Branch and Company context explicit rather than implicit.
- Ambiguous or overly permissive typing that defeats the purpose of type safety (broad catch-all types where a precise type is available) is discouraged, especially at boundaries between layers (frontend, services, data).

---

## 6. React Standards

- Components remain presentation-focused, consistent with the "UI reflects, it does not decide" principle in 02-system-architecture.md. Business rules belong in the Services layer, not in component logic.
- Components should be composed from smaller, reusable pieces where a screen's complexity warrants it, rather than growing large, monolithic components that mix multiple concerns.
- Data-fetching and mutation concerns are handled through the established React Query layer (per 02-system-architecture.md) and are not implemented ad hoc within individual components.
- Route boundaries and component organization should reflect the operational hierarchy and module boundaries described in 04-module-architecture.md.

---

## 7. Supabase Standards

- Supabase remains the Platform's data and identity backbone, per 02-system-architecture.md and 05-database-philosophy.md. New capabilities should extend this foundation rather than introducing parallel data or identity mechanisms.
- Every new capability that touches operational data must respect the Company → Branch → Department → Employee containment and isolation principles described in 05-database-philosophy.md — this is a non-negotiable standard, not a recommendation.
- Access control enforced at the database layer and access control enforced in application logic must never diverge on the same business rule; when both exist, they are expected to agree.
- Direct, unscoped access to data from the client is discouraged in favor of named, auditable access paths, consistent with the target state described in 02-system-architecture.md.

---

## 8. Service Layer Standards

- Every meaningful business operation is reachable through exactly one service function, consistent with the Services layer principle in 02-system-architecture.md — logic is not duplicated across multiple call sites.
- Services respect the boundaries described for each Core Service in 03-core-services.md; a service should not silently absorb responsibility that belongs to a different service.
- Every service that performs a sensitive or privileged action is expected to pass through the Authorization Service and be recorded by the Audit Log Service, consistent with 03-core-services.md and 06-permission-philosophy.md.
- Services are the layer responsible for ensuring a business operation completes fully, including any auxiliary steps (audit logging, notification, cache invalidation) that must always accompany it.

---

## 9. React Query Standards

- The React Query layer remains the single mechanism through which UI components read server state, per 02-system-architecture.md.
- Query-key conventions and invalidation patterns should be applied consistently across every domain, so that caching behavior is predictable regardless of which module a screen belongs to.
- Mutations are expected to result in predictable, correct invalidation of the data they affect, so that the UI never presents stale state as though it were current.

---

## 10. Realtime Standards

- Realtime delivery never bypasses the authorization layer, consistent with 02-system-architecture.md and 03-core-services.md — a client must never receive a live update for data it is not otherwise permitted to read.
- New operational domains that adopt realtime updates should follow the same delivery and scoping pattern already established for existing domains, rather than introducing a bespoke mechanism.

---

## 11. Error Handling

- Errors are surfaced in a way that is meaningful to the user and safe with respect to sensitive information — internal details are not exposed unnecessarily, but the user is given enough context to understand what happened.
- Errors originating from permission or authorization failures are treated distinctly from errors originating from unexpected system failures; the former reflects an intentional boundary, the latter reflects a defect.
- Error handling is applied consistently at every layer boundary described in 02-system-architecture.md — a failure at the data layer should not surface to the user as an unexplained frontend failure.

---

## 12. Logging

- Logging exists to make the system's behavior observable and diagnosable, distinct from the Audit Log Service, which exists to make sensitive actions accountable (per 03-core-services.md).
- Logs should never substitute for the Audit Log Service when recording a sensitive, permission-gated action — the two serve different purposes and are not interchangeable.
- Logging should avoid recording sensitive personal or business data beyond what is necessary for diagnosis.

---

## 13. Audit

- Every sensitive action, regardless of which module or service performs it, is expected to be recorded through the Audit Log Service described in 03-core-services.md, consistent with the accountability principle in 06-permission-philosophy.md.
- New capabilities that introduce a new kind of sensitive action are expected to extend the audit model rather than bypass it.
- Audit records are treated as append-only and immutable; no engineering standard permits editing or deleting an existing audit record as part of normal operation.

---

## 14. Performance

- Performance work follows the philosophy described in 05-database-philosophy.md: it is pursued primarily through correct containment and scoping, not through solutions that bypass the hierarchy.
- New features should be designed with their expected scale in mind from the outset — per-Company, per-Branch, and per-Department data volumes should inform design decisions rather than being an afterthought.
- Performance issues are addressed by aligning access patterns with the hierarchy's natural scoping wherever possible, before considering more invasive optimization.

---

## 15. Security

- Security standards follow directly from 06-permission-philosophy.md: permission-first thinking, least privilege, and defense-in-depth apply to every new capability without exception.
- New code paths that touch operational data are expected to be evaluated against the Company isolation guarantee described in 05-database-philosophy.md before being considered complete.
- Ambiguity about whether an action should be permitted is resolved in favor of denial, consistent with the security philosophy in 06-permission-philosophy.md.

---

## 16. Testing Philosophy

- Testing exists to provide confidence that the architectural guarantees described in these documents — hierarchy containment, isolation, permission correctness — continue to hold as the system changes, not merely that individual functions behave as expected in isolation.
- Priority is given to testing the boundaries described in this document and in 02-system-architecture.md: authorization decisions, hierarchy scoping, and service boundaries are the areas where a defect has the most significant consequence.
- Testing philosophy favors confidence proportional to risk: capabilities that touch permissions, isolation, or financial/operational accountability warrant more thorough testing than purely cosmetic changes.

---

## 17. Documentation Standards

- Every architecture document in `docs/architecture/` follows the same template: Status, Version, Owner, Last Updated, Depends On, and Related Documents, followed by numbered sections.
- Documentation is kept conceptual at the architecture level (this folder) and does not embed implementation code, SQL, or schema — those belong to the codebase itself, not to the architecture documentation.
- When a document's content materially changes, its `Last Updated` field is updated accordingly, and any newly relevant cross-references are added to `Related Documents`.
- New architecture documents are added deliberately and referenced from `docs/README.md`; documentation structure is treated with the same care as code structure.

---

## 18. Git Workflow

- Work proceeds on the current branch unless a task explicitly calls for a new one; branch and commit history are kept meaningful and traceable to the work they represent.
- Changes are staged deliberately — only the files relevant to the task at hand are included in a given commit, and unrelated changes are excluded.
- History belonging to the shared branch is treated as append-only in practice: rewriting already-published history (force-push, rebase, or amend of pushed commits) is avoided unless explicitly required and explicitly requested.

---

## 19. Commit Message Conventions

- Commit messages are concise and describe the *why* of a change, not merely the *what* — the underlying motivation or purpose of the change should be understandable from the message alone.
- Commit messages use a short, conventional prefix describing the nature of the change (for example, a documentation change, a fix, or a feature) followed by a clear, specific summary.
- A commit message should allow a future reader, unfamiliar with the change, to understand its intent without needing to open the diff first.

---

## 20. Pull Request Conventions

- A pull request describes the change's purpose, its scope, and how it was verified, so that a reviewer can evaluate it without needing to reconstruct context from scratch.
- Pull requests are scoped to a single coherent change wherever practical; unrelated changes are not bundled together, consistent with the Git workflow standard above.
- A pull request that touches permissions, isolation, or hierarchy boundaries is expected to call that out explicitly, given the architectural significance described in 05-database-philosophy.md and 06-permission-philosophy.md.

---

## 21. AI Development Workflow

- AI-assisted development is expected to follow the same architectural principles as human-authored development; being AI-generated is never a reason for a change to bypass the standards in this document.
- Every AI-assisted change is expected to be reviewed against the same criteria as any other change: does it respect hierarchy containment, isolation, permission boundaries, and the module/service boundaries described in 03-core-services.md and 04-module-architecture.md.
- AI agents are expected to work within the explicit boundaries given to them for a task (which files may be touched, what may or may not be modified) and to treat those boundaries as firm constraints, not suggestions.

---

## 22. Rules for Cursor

- When operating in this codebase, Cursor is expected to respect the explicit scope of any given task — touching only the files or areas it has been authorized to change, and never expanding scope unilaterally.
- Cursor is expected to read relevant architecture documentation before making structural or cross-cutting changes, so that its changes remain consistent with the hierarchy, services, and permission philosophy already established.
- Cursor is expected to flag, rather than silently resolve, any situation where a requested change appears to conflict with an established architectural principle in this documentation set.

---

## 23. Rules for Lovable

- Changes synced through Lovable are expected to remain consistent with the same architectural principles described in this documentation set, even though they may originate from a different workflow.
- Published history synced through Lovable is treated as shared, append-only history, consistent with the Git workflow standard in Section 18 — it is not rewritten or force-pushed over.
- Where a Lovable-originated change and the documented architecture appear to diverge, the divergence is expected to be reconciled explicitly rather than left unresolved.

---

## 24. Rules for Future AI Agents

- Any future AI agent operating on this codebase is expected to treat the documents in `docs/architecture/` as the authoritative description of intended structure, and to reconcile its own actions against them.
- Future AI agents are expected to honor explicit constraints given in a task (files that may not be touched, systems that may not be modified) as absolute, not as defaults that may be relaxed if convenient.
- Future AI agents are expected to prefer raising ambiguity or asking for clarification over guessing when a task's intent could plausibly conflict with an established architectural principle.

---

## 25. Definition of Done

A change is considered done only when all of the following are true:

- It fulfills the specific task or requirement it was intended to address.
- It respects the hierarchy, isolation, and permission principles described in 01-platform-vision.md, 05-database-philosophy.md, and 06-permission-philosophy.md.
- It does not introduce inconsistency with the service or module boundaries described in 03-core-services.md and 04-module-architecture.md.
- It has been reviewed against the Code Review Checklist in Section 26.
- Any documentation that describes the changed behavior has been updated to remain accurate.

---

## 26. Code Review Checklist

Before approving a change, a reviewer should confirm:

- [ ] The change respects Company isolation and hierarchy containment (Platform → Company → Branch → Department → Employee).
- [ ] Permission and authorization checks are present wherever the change touches a sensitive action, consistent with 06-permission-philosophy.md.
- [ ] Sensitive actions introduced or affected by the change are recorded through the Audit Log Service.
- [ ] The change does not duplicate a business rule that already has a single source of truth elsewhere in the system.
- [ ] Naming and structure are consistent with the conventions described in Sections 3–4.
- [ ] The change is scoped to what the task required, without unrelated modifications bundled in.
- [ ] Relevant documentation has been updated if the change affects architecture, services, modules, or permissions.

---

## 27. Summary

These standards exist to ensure that every change to the Platform — whether authored by a human, by Cursor, by Lovable, or by a future AI agent — remains consistent with the architecture, services, module boundaries, database philosophy, and permission philosophy already established in this documentation set. Standards are directional guidance grounded in the preceding documents; they are applied through judgment, not treated as a mechanical checklist alone.

See 08-roadmap.md for how these standards apply across the Platform's planned evolution.
