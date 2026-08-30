# ADR-001 — TypeScript Runtime and Local-First Execution

Status: **Accepted.**

This is an architecture decision record. It records decisions, not code.
Where it conflicts with `INITIAL_ARCHITECTURE.md`, this ADR takes precedence;
the initial architecture document was amended where directly required.

---

## 1. Runtime and language: TypeScript

The primary implementation language of the school-connector-kit ecosystem is
**TypeScript**. Initial tooling decisions:

- strict TypeScript;
- ESM;
- pnpm workspaces (monorepo);
- **Zod** for runtime model validation and TypeScript type inference;
- **JSON Schema generated from the normalized model** serves as the
  language-neutral interoperability format (the public contract of
  `schemas/`);
- **Vitest** for tests.

Explicitly **not** decided: this new OSS project contains **no Python or
Dart implementations** for compatibility with the existing private Family
Dashboard. The Family Dashboard remains a separate Python application and
may continue unchanged. Interoperability is carried by the language-neutral
JSON Schema (and by consumers implementing it in their own language); a
second-language binding would only be justified by concrete need.

## 2. Execution model: local-first

The initial architecture is **local-first**: connectors execute on the
user's own device/runtime and do not require a hosted central connector
service.

Reasons:

- school-platform credentials should not need to be stored centrally;
- the project should not require the maintainer to operate infrastructure;
- upstream requests should originate from the user's own environment;
- the OSS connector layer should remain independently usable.

A future hosted backend is **not prohibited**, but it is not part of the
current architecture and must not be required for any connector to work.

## 3. Future mobile direction (informational — not built now)

The anticipated future mobile consumer is a **React Native + Expo**
application: TypeScript, iOS and Android from one codebase. It is a future
consumer of this kit, not something to build now.

Consequences for the kit:

- connector TypeScript logic should be environment-friendly so it can
  eventually be reused in a React Native/Expo runtime (avoid baking
  Node-only assumptions into normalized logic where they are avoidable);
- **OTA JavaScript updates** may later repair compatible connector logic,
  but the architecture must not assume that arbitrary new functionality can
  always be delivered — some changes will require a normal app release.

## 4. Germany-first scope includes Kita

The project remains Germany-first. The scope explicitly covers the real
family situation where parents have children across **both school and
Kita**. Initial known platforms:

- WebUntis
- DieSchulApp
- itslearning
- **Kikom** — a deliberate architecture input, not an incidental exception
- later: IServ, Schulmanager Online, and others

Consequences:

- the normalized model must **not** assume that every education platform is
  shaped like a school timetable system;
- Kita-specific abstractions are **not** created prematurely;
- Kikom must be used as a materially different source when validating the
  normalized model (revised implementation order, step 5).

## 5. First implementation milestone: privacy-safe capture/redaction tool

The implementation sequence changes: the **first implementation deliverable
is the privacy-safe TypeScript capture/redaction tool** (in `tools/`), not
the stabilized normalized domain schemas.

Purpose: to obtain structural evidence from platforms for which the
maintainer has no account, so that schema/model decisions are grounded in
observed shapes.

Design constraint (unchanged from SECURITY.md): **deny-by-default**. No
upstream value may survive the capture/redaction pipeline unless explicitly
allowed by the capture policy.

## 6. Top-level `fixtures/` corpus is a first-class project asset

A new top-level `fixtures/` directory holds **reviewed, safe structural
fixtures** that are suitable for the public repository.

Organization: by platform, then by **anonymous structural variant**, for
example:

```text
fixtures/
  webuntis/
    variant-001/
  kikom/
    variant-001/
  die-schulapp/
    variant-001/
```

A **variant** is a materially different observed response/API shape.
Organization is by platform and anonymous variant — **never** by real
school name.

Prohibited content in `fixtures/`:

- school names identifying the source institution;
- usernames;
- real pupil/parent/teacher identities;
- tenant IDs;
- credentials;
- tokens;
- cookies.

Relationship to the existing distinction (INITIAL_ARCHITECTURE.md §9 is
amended accordingly):

- `fixtures/` — reviewed, safe structural evidence; **may be committed**;
- `private-fixtures/` — real/local acceptance data; **never committed**
  (Git-ignored, unchanged).

Synthetic fixtures remain appropriate for deterministic unit/contract tests.

## 7. WebUntis homework date semantics — explicit architecture gate

> The public Assignment/Homework date model is **not stable** until the
> WebUntis homework date ambiguity has been resolved against an actual
> upstream response.

Known issue (observed in the private Family Dashboard):

- the dashboard stores a homework **reference/start date**;
- the due date rendered to the user differs by exactly **seven days** in
  observed examples;
- the source of the actual due-date value has **not** yet been established;
- the stored `raw_json` is **insufficient** to resolve this.

Rule: **do not encode an assumption about these dates into the public
normalized contract** before the upstream semantics are established.

## 8. Defer premature product architecture

Explicitly deferred — do not design or implement these now:

- commercial backend architecture;
- hosted account system;
- subscription infrastructure;
- push-notification infrastructure;
- microservices;
- API gateway;
- separate npm publication for every connector;
- final mobile application architecture.

The monorepo may have internal package boundaries, but **independent
publication of each connector is not required yet**. Reconsider package
publication once there are approximately **three meaningful connectors**, or
when an external consumer/contributor creates a concrete need.

## 9. License

The project remains under the **Apache License 2.0**. This ADR does not
recommend a change to MPL, AGPL, or any other license.

---

## Revised implementation order

This replaces the 9-step sequence in INITIAL_ARCHITECTURE.md §11:

1. Record the TypeScript/local-first architecture (this ADR).
2. Build and prove the TypeScript capture/redaction tool.
3. Establish the reviewed structural-fixture format and corpus
   (top-level `fixtures/`).
4. Capture/verify WebUntis upstream structures and resolve the homework
   date semantics (gate of §7).
5. Add evidence from Kikom and at least one materially different school
   platform.
6. Draft the normalized model / schema **0.1** from that evidence.
7. Implement the WebUntis reference connector.
8. Implement/validate a materially different connector, with Kikom and
   DieSchulApp as available real-world validation sources.
9. Iterate the **0.x** normalized contract (breaking changes permitted
   within 0.x, per INITIAL_ARCHITECTURE.md §8).
10. Consider **1.0** only after the contract has survived multiple
    materially different platforms.

## Impact on INITIAL_ARCHITECTURE.md

- Language/runtime binding: **decided** (it was open question 1 in
  INITIAL_ARCHITECTURE.md). The empty `tools/capture_dart/` remnant is
  superseded by the TypeScript capture tool of §5.
- Package publication: in-repo vs. external narrows to "not required yet;
  reconsider at ~3 connectors or concrete external need" (§8).
- The `fixtures/` corpus adds a committed structural-evidence asset tier on
  top of the existing fixture privacy policy (§9 of the initial
  architecture, amended).
- The implementation sequence (§11 of the initial architecture) is
  superseded by the order above.
- Everything else that does not conflict with this ADR remains in effect.
