# Initial Architecture — School Connector Kit

Status: first architecture draft. This document records decisions that are
deliberate about the shape of the project, and explicitly marks decisions that
are still open. It is intentionally pragmatic: it targets a small OSS project,
not an enterprise framework.

Architecture decisions that need a permanent home are recorded here as ADRs; where an ADR differs from this document, the ADR takes precedence. **ADR-001** (`ADR-001-LOCAL-FIRST-TYPESCRIPT.md`) fixes the runtime (TypeScript), the execution model (local-first), the extended Germany-first scope (including Kita), and the initial implementation order.

The one-sentence summary:

> Connectors translate platform-specific school data into a small, stable,
> versioned normalized model with full provenance, so that any consumer can
> read one common contract instead of learning WebUntis, itslearning,
> DieSchulApp, IServ, Schulmanager Online, etc.

```text
School platform --> Connector --> Normalized model --> Consumer application
                      (platform     (shared contract,
                       owns auth,    stable schema,
                       fetch, parse) provenance)
```

---

## 1. Project boundary

### In scope (belongs in school-connector-kit)

- A vendor-neutral **connector contract** (the minimum operations and
  metadata a connector must implement).
- A **normalized domain model** for common German school information,
  including its provenance and identity envelope.
- **Versioned public schemas** that describe the normalized model in a
  language-agnostic form.
- **Platform-specific connectors** for German school platforms
  (WebUntis, DieSchulApp, itslearning, Kikom (Kita), IServ,
  Schulmanager Online, and future platforms). The Germany-first scope
  includes real families with children across both school and Kita
  (ADR-001 §4); the normalized model must not assume that every platform
  is shaped like a school timetable system.
- **Connector contract tests** that every connector must pass, driven by
  synthetic fixtures.
- **Privacy-safe developer tooling** for discovering upstream response
  structures (capture with deny-by-default redaction).
- **Synthetic example data** and contributor documentation.

### Out of scope (may consume this project, but do not belong in it)

- Any specific **consumer application**: family dashboards, backend
  aggregation services, mobile apps. A separate commercial application is
  anticipated, but the kit stays independent and application-agnostic.
- **Storage, persistence, sync, or scheduling**: the kit produces
  normalized records; who stores or polls them and when is the consumer's
  decision.
- **Presentation concerns**: formatting, localization, ordering, icons,
  "important first" rules. Connectors must not encode how a record will look
  in a UI.
- **Account management beyond connecting**: no credential stores, no
  password vaults, no cross-platform identity federation.
- **Platform administration or write-back** as a general goal. (Whether a
  connector may *send* data to a platform, e.g. submitting a Krankmeldung,
  is deliberately not decided yet — see open questions.)
- **Multi-child / household logic**. The kit knows about *a student* in the
  source system; grouping children into a family is a consumer concern.
- **Hosted central connector service.** Connectors run local-first on the
  user's own device/runtime (ADR-001 §2): credentials stay with the user
  and upstream requests originate from the user's environment. A future
  hosted backend is not part of the current architecture and must not be
  required for connectors to work.

### Guiding boundary rule

If a piece of behaviour only makes sense for one school platform, it lives in
that connector package. If it only makes sense for one consuming application,
it lives in that application. Only cross-cutting, platform-neutral behaviour
belongs in the core contract or shared infrastructure.

---

## 2. Proposed repository architecture

The repository layout already exists as skeleton directories; this section
assigns responsibilities.

| Location | Responsibility |
|---|---|
| `packages/core/` | The shared, vendor-neutral layer: the connector contract (what a connector *is* and what operations it must expose) and the normalized domain model (the types consumers read). Core must not import any connector. It owns only cross-cutting building blocks that every connector needs identically (e.g. the provenance envelope, error taxonomy, concept enumeration). No platform knowledge here, by construction. |
| `packages/connectors/` | One sub-package per platform (e.g. `webuntis/`, `die-schulapp/`). Each connector owns its authentication, API access, parsing, and mapping into normalized types. A connector imports core, never another connector. Adding a new platform creates a new directory here and touches **no other package**. |
| `schemas/` | The versioned, language-agnostic description of the normalized model (the public interchange contract) plus the connector manifest format. Schemas are the stable surface on which consumers and third-party connectors can agree. They are derived from / kept in sync with `packages/core`. |
| `tests/contract/` | The connector conformance suite: behavioural tests every connector must pass against synthetic upstream data, plus golden "connector → normalized model" fixtures. This suite is the definition of "a working connector". |
| `tools/` | Developer utilities that are **not** part of the connector runtime: privacy-safe capture tooling, redaction tooling, and later helpers for regenerating or validating schemas. Tools may depend on core, but core never depends on tools. |
| `examples/` | Synthetic example payloads and usage examples. Only synthetic data is allowed here (see §9). |
| `fixtures/` | Reviewed, safe **structural** response fixtures (commit-allowed), organized by platform and anonymous structural variant — never by school name (ADR-001 §6, §9). |
| `docs/` | Architecture, connector-authoring, privacy, and schema documentation. This file is the first architecture document. |
| `private-fixtures/` | Local, Git-ignored acceptance fixtures (real or real-shaped data) used only on a maintainer's machine, never committed (see §9). Distinct from the committed `fixtures/` structural corpus. |

Dependency direction is strictly one-way:

```text
connectors  -->  core  -->  (nothing)
consumers   -->  schemas  (and connectors, via their normalized output)
tools       -->  core
tests/contract --> core
```

There is no central registry file, no plugin list, no "add your connector
here" table in source. That is a deliberate contrast with the private Family
Dashboard, where a new source currently has to be registered in more than one
central place (§7).

---

## 3. Connector lifecycle

Conceptually, each of these steps has exactly one owner.

1. **Discovery / registration.** The consumer (or tooling) finds which
   connectors are installed. A connector is self-describing: its manifest
   states which platform it speaks, which concepts it provides, and which
   configuration it needs. No code outside the connector changes when a new
   one is added (§7).

2. **Configuration.** The consumer supplies the connector-specific
   configuration the connector declared (e.g. an institution identifier and
   credentials for its platform). The core contract only needs to know *that*
   configuration exists and whether it is sufficient; it never knows its shape
   in a platform-specific way.

3. **Authentication.** The connector authenticates with its upstream
   platform and keeps the session valid. All platform quirks — token refresh,
   login flows, session expiry — stay inside the connector. The core contract
   only requires the connector to be able to answer "am I usable right now?"
   and to surface authentication problems through the shared error model.
   Secrets must never leak into logs, exceptions, or normalized output
   (already a rule in CONTRIBUTING.md / SECURITY.md).

4. **Fetching upstream.** The connector pulls the raw data (timetable,
   homework, exams, messages, absences, …) from its platform. This includes
   all platform-specific shapes, pagination, and endpoint choices.

5. **Parsing.** The connector turns raw platform payloads into an internal,
   platform-local view. This layer is allowed to be unpretty and is never
   exposed.

6. **Normalization.** The connector maps its internal view into the
   normalized model: choosing the right concept type, populating the
   provenance envelope, and resolving date semantics (§5, §6). Ambiguities
   that cannot be resolved from the source must surface as an explicit,
   typed "unknown / not provided" value — never as a silently guessed one
   (unless the connector documents the guess, e.g. a platform's
   reference date is *by definition* the due date for that platform).

7. **Delivery to consumers.** The consumer reads normalized records —
   never raw payload, never the connector's internal types. The consumer
   treats the connector as a black box that knows its platform.

Cross-cutting behaviour that is useful to *every* connector is placed in the
core shared layer where practical (error taxonomy, the provenance envelope,
clock/timezone handling conventions, concept enumeration). Anything that is
only occasionally shared is left local to the connector: early duplication
between two connectors is acceptable; premature abstraction is not.

---

## 4. Connector interface (conceptual, no code yet)

The minimum responsibilities a connector must fulfil, expressed as
capabilities rather than method signatures:

**Identification and self-description**
- A stable, machine-readable connector id (naming the *platform it connects
  to*, not the project).
- A human-readable name and description.
- The schema version (or range of versions) of the normalized model it
  emits.
- The set of concepts it can provide (e.g. lessons, homework, assessments,
  events, messages, absences) — connectors may honestly provide only a
  subset, and must report which concepts they do not support instead of
  failing.
- The configuration it requires, described generically (name, purpose,
  secret-or-not), so consumers can prompt for it without understanding the
  platform.
- A capability to check whether it is configured and authenticated enough to
  be used.

**Retrieval operations** — one declared operation per concept the
connector serves, each:
- accepting a small set of platform-neutral parameters (a student/record
  association, a period or date range where the platform needs one) and
- returning a list of normalized records of the matching concept type.

Concretely, the initial concept set a connector may expose is:
- `timetable` (Stundenplan; Vertretungsplan information is carried on
  `timetable` records as substitution/change/cancellation state, not as a
  separate concept — see §5)
- `homework` (Hausaufgaben)
- `assessments` (Klassenarbeiten and similar)
- `events` (Termine)
- `messages` (Elternbriefe / notifications)
- `absences` (pupil-side: Abwesenheiten / Krankmeldungen / Beurlaubung /
  Verspätung — see §5)

**Error and limitation reporting**
- Distinguish "authentication problem", "not configured", "upstream error",
  "connector internal error", and "not provided by this platform for this
  concept", using the shared taxonomy and never leaking platform internals
  or secrets into error text.
- Where a platform reports partial data (e.g. a homework entry without a
  due date), state that explicitly rather than filling it with guesses.

Deliberately **not** in the initial contract:
- push/streaming (polling by the consumer is fine at this stage),
- write operations to the platform (open question),
- generic "fetch everything" bulk endpoints (consumers can call the
  per-concept operations),
- pagination primitives (a connector either fits a reasonable window or
  paginates internally and returns a coherent set).

---

## 5. Normalized domain model

### Decision: separate first-class concept types, with a shared envelope

The model is built from **one small set of distinct record types** — not a
single generic "school record" type with a polymorphic payload. Reasons:

- **Date semantics differ by concept and must stay separate types anyway.**
  A homework record may carry an assignment/reference date and a due date; an
  absence has a from/to span; a timetable entry repeats over terms; a
  message has a publish date and possibly an expiry. A generic model would
  either collapse these (losing meaning) or grow a bag of optional date
  fields (losing precision) — exactly the failure mode observed in the
  private dashboard, where a homework reference date was easily confused
  with the due date.
- **Consumers are concept-specific.** A dashboard renders a homework list
  and an absence list differently; the type system should reflect that.
- **Honest reporting of missing support is cleaner.** "This connector does
  not provide `assessments`" is unambiguous when `assessments` is a named
  concept with its own type.

### Proposed initial types (minimum)

Each type below appears as its own normalized concept. Field lists are
intentionally minimal and will grow as the first connectors are written.

- **Person / Student reference.** A lightweight, stable reference to a
  student (or class) as known by the platform. Not a full person model —
  the kit does not build a global identity database. Consumers may correlate
  students across platforms themselves (§6).
- **TimetableEntry** (Stundenplan): subject, room, time, teacher/group,
  repetition (weekly vs. term), valid period, and an explicit
  substitution/change/cancellation state that carries **Vertretungsplan**
  information. A substitution is a *state of a scheduled lesson* (moved,
  changed, cancelled, teacher/room swapped), not a separate concept type —
  so there is no `replacements` retrieval concept in the initial contract.
  This keeps the two closely related platform shapes (WebUntis timetable vs.
  replacement feeds) expressible without inventing a generic "plan" type,
  and also carries the consumer-relevant consequence of a teacher absence
  that affects a scheduled lesson (see the Absence bullet below).
- **Assignment** (Hausaufgabe / homework): subject, description,
  **assigned** date, **due** date as *two distinct optional fields*,
  student/class scope. The two dates are never a single "date".
  **Gate (ADR-001 §7):** these date fields are **not stable** until the
  WebUntis upstream date semantics are verified against an actual upstream
  response; no assumption about them may be encoded into the public
  contract before that is resolved.
- **Assessment** (Klassenarbeit / examination / similar graded work):
  subject, type, scheduled date (or period), announced/preparation state
  where the platform has one.
- **Event** (Termin / appointment / holiday notice): subject/title,
  date or period, audience (class/whole school — coarse only), description.
- **Message** (Elternbrief / school notice): sender (role only, not a
  personal identity where avoidable), subject, body (or a reference to a
  body attachment where the body is a document), published date, optional
  expiry/pinned marker.
- **Absence** (Abwesenheit / Krankmeldung / Beurlaubung / Verspätung):
  **pupil-side only.** Absence kind (e.g. illness, authorised leave,
  tardiness) as an enum that can carry a platform-specific other-kind,
  from/to, optional reason only where the platform provides one. Teacher
  absence is deliberately **not** modeled as an `Absence` record: where a
  teacher absence affects a scheduled lesson, its consumer-relevant
  consequence is expressed through the timetable entry's
  substitution/change/cancellation state above.

Each of these shares the **ProvenanceEnvelope** (§6).

### What is deliberately not a type (yet)

- **Subjects / courses as entity types.** Subjects appear as *fields* on
  records to start. A standalone subject/course type (with its own identity,
  term, room, schedule) is the next likely candidate for extraction — but
  only after two or three real connectors show what shape it needs.
- **Files / documents** as a general asset concept: a `message` may carry a
  body reference, but there is no generic file-store abstraction yet.
- **Attendance / grade / notes data**: not in the initial set; platforms
  expose these very differently and the German landscape is not standardized
  enough to normalize credibly before seeing more feeds.
- **Kita-specific concept types.** The Germany-first scope includes Kita,
  and Kikom is a first-class architecture input (ADR-001 §4): the model is
  validated against it as a materially different source, but no
  Kita-specific abstractions are created before evidence exists.

---

## 6. Identity and provenance

Every normalized record carries a common envelope. This is how a consumer
tells records apart, deduplicates, joins across sources, and displays
"where did this come from?" — while never seeing a platform-specific
structure.

- **source_platform.** A stable, well-known platform identifier
  (`webuntis`, `itslearning`, `die_schulapp`, …). A namespace, not a URL
  and not a free-text string.
- **source_instance.** An **opaque** identifier of the configured upstream
  scope the connector operates against (tenant, institution, or account
  scope). Consumers use it only to group records coming from the same
  configured source. Its platform-specific meaning is *not* part of the
  contract: consumers must not interpret it as a school name, URL, username,
  or credential, and the contract must not require any other semantics of it.
- **connector_id / connector_version.** Which connector produced the record
  and which version of it. A record from `webuntis@1.2.0` is reproducible.
- **source_record_id.** The platform's own identifier for this record. A
  string; opaque to the consumer; preserved verbatim. No uniqueness is
  claimed for it on its own — a platform may reuse record ids across
  instances. The **stable unique key** for a source record is therefore the
  tuple `source_platform` + `source_instance` + `source_record_id`; that
  tuple is the basis for deduplication and updates.
- **schema_version.** The version of the normalized contract used to
  encode this record (§8).
- **student / group association.** The student or class the record is about,
  expressed as the *platform's own* student reference (id + display name)
  within the scope of the record's `source_instance`, plus a free-form
  scope hint ("class", "whole school") where the record clearly applies to
  more than one pupil. The kit does **not** invent a
  cross-platform global person id: consumers (e.g. a family dashboard) own
  the mapping "platform A's pupil X = platform B's pupil Y = my child".
- **Timestamps and date semantics, kept separate by meaning.**
  - `fetched_at` — when the connector fetched this record (the kit's clock).
  - Concept-specific semantic dates (e.g. assignment date vs. due date;
    event date; absence from/to) are **distinct fields with distinct
    semantics**, typed per concept (§5). A field that is "a date the
    platform reported" is not a valid reason to reuse one date field for
    two different meanings.
  - Where the platform only provides one of two semantically distinct
    dates, the other is explicitly absent — a consumer must be able to tell
    "not provided" from "provided as the due date".
  - A convention is defined for whether platform-supplied *day spans* (no
    time) and *point-in-time* values are distinguishable, so a consumer that
    wants to show "due 12.03." is not forced to render a time it does not
  have. (Exact encoding: to be finalized with the first schema, §8.)
- **Redacted or normalized display names.** Person names are included only
  to the extent needed to identify a student in context; the model never
  requires raw identity fields.

Consumers never receive the raw platform payload, the connector's internal
representations, or anything that cannot be expressed in the schema.

---

## 7. Extensibility: how a new connector appears

The private dashboard's main friction — "adding a new source means editing
several central files" — is designed out here. The rules:

1. **A connector is self-describing.** The connector's own package carries a
   manifest (machine-readable: connector id, platform id, schema version,
   concepts provided, required configuration). The manifest is the single
   source of truth for *that* connector.
2. **Discovery happens by convention, not by central file.** A consumer
   (or a tool that lists connectors) discovers which connectors are present
   by looking at installed packages that declare a core-contract manifest,
   not by matching against a hardcoded list. There is no registry source file
   that says "the connectors are webuntis, itslearning, …".
3. **Adding a contributor's connector touches exactly one place: the new
   connector package.** No edit to core, no edit to a shared registry, no
   edit to another connector. Contract tests are run *against* the connector,
   they are not edited *for* it.
4. **Schemas are the stability boundary for third-party connectors.** A
   third-party consumer or third-party connector can implement against the
   published schema + core contract without needing the connector packages.
   This keeps "open ecosystem" and "independent OSS project" compatible:
   the kit's public surface is the contract, not the repo internals.
5. **In-repo vs. external connector packages** (in-repo under
   `packages/connectors/`, or a separate package/repository publishing the
   same contract) is an open packaging question (§10), but the *principles*
   above hold either way.

---

## 8. Versioning

Pragmatic, minimal, decided up-front, no machinery invented early:

- The normalized model (the schema) is **versioned explicitly** and
  carries a `schema_version` in every record's envelope. This is the only
  version consumers and connectors need to agree on at runtime.
- The version uses a simple `major.minor` scheme:
  - **minor**: additive — new optional fields, new optional concepts, new
    enum values that a reader may safely ignore. Older consumers keep
    working.
  - **major**: breaking — removing/renaming fields, changing the meaning of
    a field, adding a previously-absent required field. Older contracts
    remain available so consumers can migrate deliberately.
- **Pre-1.0 schemas evolve freely.** The first published schema is **not**
  1.0: it starts in a `0.x` line (e.g. `0.1`). The `0.x` line is explicitly
  unstable — breaking changes are allowed even between two 0.x versions,
  and consumers built against 0.x must pin the exact version they read and
  expect to re-pin as connectors learn from real platforms. `1.0` is never
  declared in advance; it is cut only once the contract has demonstrated
  reasonable stability across at least two materially different real
  connectors (WebUntis and a second, different platform such as DieSchulApp),
  and only from `1.0` onward do the major/minor rules above apply without
  ambiguity.
- **Connectors declare the schema version(s) they emit** in their manifest.
  A consumer declares which version(s) it reads. Mismatch is a reported,
  typed error — never a silent best-effort decode.
- Connectors that do not (yet) provide every concept are valid: "not
  provided" is a value in the contract, so a connector for a platform with
  a smaller feature set is not "an older version" of the schema.
- **Core and schemas move together** in the repo; they are published as one
  versioned unit. (The exact publishing story — package registry vs. git tag
  — is open until the first real release.)
- Deliberately **not** doing: per-field feature flags, parallel schema
  lineages per platform, or runtime automatic migration between major
  versions. A small project can afford that simplicity, and it will last
  longer than the machinery would.

---

## 9. Privacy and fixture strategy

Three tiers, each with a strict location and a strict rule about what it may
contain. This maps directly onto SECURITY.md and CONTRIBUTING.md and onto the
existing (Git-ignored) `private-fixtures/` directory.

### a) Synthetic public fixtures (committed)

- **Location:** with their tests, under `tests/contract/` fixtures, `examples/`,
  and connector-specific test fixtures inside `packages/connectors/`. The
  reviewed structural-capture corpus is a separate top-level `fixtures/`
  asset (see c).
- **Contents:** fully invented names, schools, accounts, and IDs that do not
  correspond to any real pupil, parent, or school. Realistic *shape*, no
  real *values*.
- **Rule:** the only fixtures that may be committed are (1) synthetic
  fixtures like these and (2) reviewed/approved structural fixtures in the
  top-level `fixtures/` corpus (see c). Private/real acceptance fixtures in
  `private-fixtures/` (b) must **never** be committed. A PR that introduces
  a fixture that looks like real data must be rejected.
- These fixtures drive the shared contract tests and the golden
  "connector → normalized model" examples.

### b) Local private acceptance fixtures (per-maintainer, never committed)

- **Location:** `private-fixtures/` and other paths already Git-ignored
  (`captures/`, `real-data/`, `local-data/`).
- **Contents:** real or real-shaped captures from the maintainer's own
  accounts, used to *accept* a connector on real data before release.
- **Rule:** no Git, no upload to CI, no inclusion in any PR. A local tool
  may run contract tests against them; the committed suite must not require
  them.
- This is also where a family dashboard maintainer validates a new connector
  against their own school before publishing.

### c) Reviewed structural fixture corpus (committed, top-level `fixtures/`)

This is a first-class project asset (ADR-001 §6), not a future idea:

- **Location:** `fixtures/<platform>/variant-XXX/` — organized by platform
  and anonymous structural variant; a variant is a materially different
  observed response/API shape. Never organized by real school name.
- **Contents:** the *shape* of a platform's responses (field names,
  nesting, types, enums, sizes) with all values redacted. Values may only
  survive if explicitly allowed by the capture policy (deny-by-default,
  per SECURITY.md and ADR-001 §5).
- **Prohibited:** school names identifying the source institution,
  usernames, real pupil/parent/teacher identities, tenant IDs,
  credentials, tokens, cookies.
- **Rule:** reviewed before commit; a capture that is not safe by review
  stays local in `private-fixtures/` (b).
- **Purpose:** enables contributors without account access to work
  against realistic observed shapes (a stated project goal) without
  exposing real data to the maintainer.

### Cross-cutting rule

Secrets (passwords, tokens, cookies) never appear in fixtures of any tier,
and connector logging / error surfacing must not print them — this is
already required for connectors in CONTRIBUTING.md and should be enforced
by a shared logging convention in core, not by each connector's good
intent.

---

## 10. Open architecture questions (deliberately not decided yet)

These are flagged for *after* at least two connectors exist, so that the
answers come from real platform shapes rather than guesswork:

1. **Language / runtime binding.** *Decided in ADR-001* (no longer open):
   strict TypeScript, ESM, pnpm workspaces, Zod for runtime validation and
   type inference, JSON Schema generated from the model as the
   language-neutral format, Vitest for tests. No Python or Dart in the OSS
   repo. The `schemas/` JSON Schema remains the language-neutral anchor.
   (The empty `tools/capture_dart/` remnant is superseded by the
   TypeScript capture tool, ADR-001 §5.)
2. **Read-only vs. write operations.** Submitting a Krankmeldung or an
  absence, answering a message — should connectors ever *write* to the
  platform? The initial contract is read-only; a write path needs a
  separate capability + confirmation model and should be added only after
  a clear need (and a platform that supports it safely) exists.
3. **Subject / course as a standalone entity type.** Promoted or not:
  whether a `Subject` / `Course` type (with its own identity and term-aware
  schedule) is earned after seeing how WebUntis vs. itslearning vs.
  DieSchulApp each model the same concept.
4. **Absence-kind vocabulary.** The initial `Absence` type is limited to
  pupil-side absence semantics (Abwesenheit, Krankmeldung, Beurlaubung,
  Verspätung). Open: how the kind enum should be shaped once more
  platforms report richer or different kind sets, and how far
  platform-specific "other" kinds may be preserved without breaking
  consumer assumptions.
5. **Message body as inline text vs. document reference, and attachments.**
  Until we've seen two or three platforms' Elternbriefe, a single
  "body = string" field is a guess. The likely eventual split (short inline
  vs. referenced document) is on hold.
6. **Consumer-side identity joining.** Who owns the "pupil X on WebUntis =
   pupil Y on DieSchulApp = my child" map, and what is the minimum the kit
   needs to expose to make that possible (student id + name + a free-form
   association hint is currently the assumption).
7. **Connector packaging.** *Partially decided in ADR-001 §8*: the
   monorepo keeps internal package boundaries, and separate npm publication
   per connector is not required yet; reconsider at roughly three
   meaningful connectors or concrete external need. Open remnant: the
   exact in-monorepo package-boundary layout.
8. **Polling / freshness semantics.** Whether the contract should express
   "this data is as of time T" in a uniform way (ETag / last-modified /
   fetched_at) or stay connector-local. Current assumption: `fetched_at` in
   the envelope is enough for v1.
9. **Timezone discipline.** German schools are CET/CEST; cross-platform
   day-span vs. point-in-time date representations need one shared rule.
   The model needs to encode it; the exact choice (UTC + offset per record
   vs. local date + timezone hint) will follow the first real schema.
10. **How contract tests are driven.** Whether `tests/contract/` is
    core-driven (TypeScript tests importing core) or schema-driven (tests
    generated from `schemas/`). The golden "connector → model" fixtures
    are JSON against the generated schema (ADR-001 §1).

---

## 11. Recommended implementation sequence

Capture-first, evidence-before-schema, per ADR-001 (which supersedes the
earlier 9-step sequence in this section):

1. **Record the TypeScript/local-first architecture** (ADR-001) in this
   document set.
2. **Build and prove the TypeScript capture/redaction tool** (`tools/`,
   deny-by-default; ADR-001 §5) — the first implementation deliverable.
3. **Establish the reviewed structural-fixture format and corpus** at
   top-level `fixtures/` (ADR-001 §6).
4. **Capture/verify WebUntis upstream structures** and resolve the homework
   date semantics (gate, ADR-001 §7) against actual upstream responses.
5. **Add evidence from Kikom and at least one materially different school
   platform** (Kikom by construction, ADR-001 §4).
6. **Draft the normalized model / schema `0.1`** from that evidence, with
   the §8 versioning rules (the 0.x line) applied from the start.
7. **Implement the WebUntis reference connector** end-to-end, passing
   `tests/contract/` against synthetic and structural-fixture evidence.
8. **Implement/validate a materially different connector**, with Kikom and
   DieSchulApp as available real-world validation sources.
9. **Iterate the `0.x` normalized contract** (breaking changes permitted
   within 0.x, §8) as the evidence base grows.
10. **Consider `1.0`** only after the contract has survived multiple
    materially different platforms (§8).

Explicitly **not** in this sequence: a UI, a backend service, or any
consumer application — those are separate OSS or commercial projects that
consume this one (ADR-001 §8 defers the listed product-architecture
questions).

---

### Decisions vs. open — at a glance

- **Decided in this document:** one-way dependency graph (connectors → core;
  no central registry); separate first-class concept types with a shared
  provenance envelope; date semantics preserved as distinct fields;
  self-describing connector manifest; schema versioning with a version in
  every record (`0.x` until stability is demonstrated, `1.0` earned
  across at least two materially different platforms); fixture privacy
  policy (synthetic committed / private local / structural reviewed);
  read-only initial connector contract; pupil-side absence scope.
- **Decided in ADR-001 (recorded alongside this document):** TypeScript /
  strict / ESM / pnpm workspaces / Zod / generated JSON Schema / Vitest;
  local-first execution (no hosted central service required); mobile
  future is React Native/Expo (a future consumer, not now); Germany-first
  scope includes Kita (Kikom is a first-class input); the capture/redaction
  tool is the first implementation milestone; top-level `fixtures/`
  structural corpus; WebUntis homework-date gate; product architecture
  deferred; Apache-2.0 unchanged; the capture-first 10-step implementation
  order.
- **Explicitly still open** (see §10): write operations, subject/course
  entity, absence-kind vocabulary, message body shape, cross-platform
  identity joining, exact in-monorepo package boundaries (publication
  itself deferred, ADR-001 §8), freshness semantics, timezone encoding, and
  how the contract test suite is driven (language is settled: TypeScript
  + JSON, ADR-001 §1).
