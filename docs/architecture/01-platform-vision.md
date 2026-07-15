# Platform Vision

Status: Draft

Version: 1.0

Owner: Platform Architecture

Last Updated: 2026-07-15

Depends On: None

Related Documents: 02-system-architecture.md, 05-database-philosophy.md, 06-permission-philosophy.md

---

## 1. Purpose of This Document

This document defines the long-term vision of the Platform: what it is, why it exists, and the guiding philosophy behind its structure. It is the foundation that every other architecture document builds upon. It does not describe implementation, database schema, or code — it describes intent, boundaries, and reasoning.

The Platform's structural hierarchy is:

```
Platform
 └── Companies
      └── Branches
           └── Departments
                ├── Employees
                ├── Schedules
                ├── Breaks
                ├── Tasks
                ├── Attendance
                └── Reports
```

---

## 2. What Is the Platform

The Platform is the single, top-level system that hosts and serves every Company that uses it. It is not owned or operated by any one Company — it is the shared foundation upon which all Companies operate.

The Platform is responsible for:

- Providing the infrastructure, structure, and rules that every Company operates within.
- Ensuring consistent behavior, quality, and security across all Companies, regardless of their size or industry.
- Owning the platform-wide capabilities that no individual Company owns: onboarding new Companies, enforcing platform-wide policy, and evolving the product over time.
- Remaining neutral and impartial toward the Companies it serves — the Platform does not favor one Company's data, configuration, or operational needs over another's.

The Platform exists above the level of any single organization. Companies are tenants of the Platform, not owners of it.

---

## 3. What Is a Company

A Company represents a single organization — a distinct business entity — that has adopted the Platform to run its operations. A Company is the primary unit of business identity within the Platform.

Each Company:

- Represents one real-world organization with its own identity, structure, and workforce.
- Operates independently of every other Company on the Platform.
- Owns its own Branches, and through them, its own Departments, Employees, and operational data.
- Is the entity that ultimately consumes and benefits from the Platform's services.

A Company is not a technical construct — it is a business one. It is the boundary at which one organization's operations begin and another's end.

---

## 4. What Is a Branch

A Branch represents a physical or logical place of operation belonging to a Company — a specific location, site, or operational unit through which the Company conducts its business.

Each Branch:

- Belongs to exactly one Company.
- Represents a distinct operational context (for example, a physical location, a regional office, or an operational unit) where work actually happens.
- Contains its own Departments, and through them, the Employees, Schedules, Breaks, Tasks, Attendance records, and Reports that pertain to that specific place of operation.
- Allows a Company to scale across multiple locations while remaining a single organizational identity at the Company level.

Branches are how a Company expresses its physical or operational footprint. A small Company may have a single Branch; a large Company may have many.

---

## 5. Why Companies Are Separated

Companies are kept strictly separate from one another for four fundamental reasons:

1. **Business Independence.** Each Company is a distinct organization with its own management, workforce, policies, and operational needs. Their data, structure, and decisions must never influence or leak into one another.

2. **Trust and Confidentiality.** Organizations adopt the Platform on the understanding that their operational data — employees, schedules, attendance, tasks — is theirs alone. Separation is the foundation of that trust.

3. **Predictability at Scale.** As the Platform grows to serve more Companies, each Company must continue to behave as though it is the only Company on the Platform. Separation is what makes this possible regardless of how many Companies join.

4. **Independent Evolution.** Companies must be able to grow, change, restructure, or eventually leave the Platform without affecting any other Company. Separation ensures that every Company's lifecycle is fully self-contained.

Company-level separation is therefore not an implementation detail — it is a core philosophical commitment of the Platform.

---

## 6. Why Branches Belong to Companies

Branches exist only within the context of a Company because a Branch has no independent identity of its own — it is an extension of the Company that operates it.

- A Branch does not represent a separate organization; it represents *where* an existing organization operates.
- All authority, ownership, and accountability for a Branch traces back to its Company.
- Branches allow a single Company to organize its operations across multiple locations without fragmenting its identity — the Company remains one entity, expressed through many Branches.
- Because Branches belong to Companies, the separation described in Section 5 extends naturally downward: a Branch inherits the same isolation from other Companies' Branches that its parent Company has from other Companies.

This containment relationship — Branch within Company — is what allows the Platform's hierarchy to remain coherent as it deepens into Departments and beyond.

---

## 7. Multi-Tenant Philosophy

The Platform is built as a multi-tenant system, where each Company is a tenant. The multi-tenant philosophy rests on the following principles:

- **One Platform, many Companies.** A single Platform instance serves every Company. Companies do not each require their own separate deployment of the Platform to benefit from it.
- **Tenancy is structural, not incidental.** The Company is not a label attached to data after the fact — it is the organizing principle around which the entire hierarchy (Branches, Departments, Employees, and all operational activity) is structured.
- **Shared foundation, private experience.** Every Company benefits from the same underlying platform capabilities, quality, and improvements, while experiencing the Platform as though it were built exclusively for them.
- **Growth without disruption.** New Companies can be onboarded to the Platform at any time without affecting the experience, performance, or data of Companies already on it.

Multi-tenancy is the mechanism that allows the Platform to serve many organizations efficiently while preserving the independence described in Section 5.

---

## 8. Isolation Between Companies

Isolation is the practical expression of the separation philosophy described in Section 5. It means that, from the perspective of any Company, no other Company on the Platform exists.

The isolation principle guarantees that:

- A Company can never observe, access, or infer the existence of another Company's Branches, Departments, Employees, Schedules, Breaks, Tasks, Attendance, or Reports.
- Actions taken within one Company — configuration changes, operational decisions, data entry — never affect any other Company.
- The scale, complexity, or behavior of one Company's operations never degrades or influences the experience of another Company.
- Isolation applies at every level of the hierarchy: what is isolated at the Company level remains isolated at the Branch level, the Department level, and every level beneath it.

Isolation is treated as an absolute guarantee of the Platform, not a best-effort goal. It is foundational to the trust described in Section 5 and is a governing constraint for every future capability the Platform introduces.

---

## 9. Permission Philosophy at the Platform Level

At the Platform level, permissions exist to answer one question: *who is allowed to act, and at what scope?* The Platform-level permission philosophy establishes the outermost layer of that answer, before any Company-, Branch-, or Department-specific permissions are considered.

Guiding principles:

- **Platform-level authority is distinct from Company-level authority.** Those who administer the Platform itself operate above and outside the operational structure of any individual Company. Administering the Platform is not the same activity as operating within a Company.
- **Scope is always explicit.** Every permission granted within the Platform is understood to apply at a specific level of the hierarchy — Platform, Company, Branch, or Department — and never bleeds upward or sideways beyond that scope.
- **Least necessary authority.** Individuals and roles are granted only the authority required for their responsibilities at their level, whether that is platform-wide administration or a single Department's operations.
- **Accountability follows authority.** Wherever the Platform grants the ability to act, it also expects that action to be traceable to the identity that performed it.

A full treatment of the permission model is provided in the dedicated Permission Philosophy document; this section establishes only the Platform-level foundation that the rest of the model builds upon.

---

## 10. Scalability Goals

The Platform is designed to scale along several independent dimensions simultaneously:

- **Company scale.** The number of Companies operating on the Platform can grow substantially without requiring structural change to how the Platform serves each one.
- **Branch scale.** Any single Company can expand from one Branch to many, and the Platform must support that growth as a natural extension of the Company, not as a special case.
- **Organizational depth.** Departments, and the operational activity beneath them (Employees, Schedules, Breaks, Tasks, Attendance, Reports), must scale in volume and complexity within a Branch without straining the structure above them.
- **Consistent experience under growth.** As any dimension grows — more Companies, more Branches, more Departments, more Employees — every existing Company continues to experience the Platform with the same reliability and clarity it had before that growth occurred.

Scalability is treated as a property of the hierarchy itself: because Companies, Branches, and Departments are cleanly separated and independently contained, growth in one part of the hierarchy does not create pressure on unrelated parts.

---

## 11. Future Expansion Goals

The Platform's hierarchy is intentionally designed to accommodate growth that has not yet been fully defined. Future expansion goals include:

- **Deepening the operational hierarchy.** The Department-level capabilities listed today — Employees, Schedules, Breaks, Tasks, Attendance, and Reports — represent the current scope, not a final boundary. New operational capabilities can be introduced beneath Departments as the Platform's needs evolve.
- **Broadening Company-level capabilities.** As Companies mature on the Platform, new Company-wide capabilities may be introduced that sit above individual Branches but still within the Company boundary.
- **Extending Platform-level services.** New platform-wide services may be introduced above the Company level — always respecting the isolation and separation principles already established.
- **Supporting new organizational shapes.** While the current hierarchy is Company → Branch → Department, the philosophy behind it — clear containment, strict isolation, and scoped permissions — is intended to remain valid even as new organizational patterns emerge.

Future expansion is expected to extend the hierarchy, not compromise the principles that define it.

---

## 12. Platform Owner Responsibilities

The Platform Owner operates at the Platform level, above and outside the operational structure of any individual Company. The Platform Owner's responsibilities are distinct from those of anyone operating within a Company, Branch, or Department.

The Platform Owner is responsible for:

- **Stewarding the Platform as a whole.** Ensuring the Platform continues to serve every Company reliably, fairly, and consistently.
- **Onboarding and lifecycle of Companies.** Overseeing how Companies join the Platform and how their lifecycle on the Platform is managed.
- **Upholding isolation and separation.** Acting as the guarantor that the isolation principles described in Section 8 are preserved as the Platform evolves.
- **Governing Platform-wide policy.** Setting and maintaining the rules, standards, and constraints that apply uniformly across all Companies.
- **Guiding the Platform's evolution.** Making the decisions that shape how the Platform grows — new capabilities, new scale, new organizational patterns — in a way that remains consistent with this vision.

The Platform Owner does not operate within any single Company's day-to-day activities. Their responsibility is to the Platform as a whole, and through it, to every Company it serves.

---

## 13. Why the Architecture Is Designed This Way

The Company → Branch → Department hierarchy, and the principles of separation, isolation, multi-tenancy, and scoped permissions that surround it, exist for one unifying reason: **the Platform must be trustworthy and coherent at any scale.**

- The hierarchy mirrors how real organizations are structured — a Company operating across Branches, each organized into Departments — so the Platform's shape matches the reality it serves rather than imposing an artificial structure on it.
- Strict containment at every level (Department within Branch, Branch within Company, Company within Platform) means that complexity introduced at one level never has to be understood or managed by levels that do not need it.
- Isolation between Companies is what allows the Platform to serve many unrelated organizations simultaneously without any of them needing to know, or care, that the others exist.
- Scoped, level-appropriate permissions ensure that authority is always exercised at the right altitude — Platform-wide decisions are never confused with Company-level decisions, and Company-level decisions are never confused with Branch- or Department-level ones.
- This design allows the Platform to grow — more Companies, more Branches, deeper organizational structures, new future capabilities — without ever having to renegotiate the fundamental guarantees it makes to the Companies already relying on it.

This is the vision the rest of the Platform's architecture is built to serve.
