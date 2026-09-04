# ADR-006 — Platform-supplied instants

**Date:** 2026-09-02
**Status:** Accepted
**Supersedes:** nothing
**Related:** ADR-003 (connector runtime contract), ADR-004 (capture request identity), `packages/core/src/schema.ts`

---

## Context

`packages/core/src/schema.ts` (schema 0.1) defines four date forms —
`PlatformDateInt`, `WeekdaySlot`, `PartialDay`, `DayOnly`. They exist to
prevent timestamps being invented where platforms do not supply them: the
forms are a shared vocabulary, deliberately separate from the concepts, and
nothing in the schema converts one form into another.

Schulmanager was captured and committed on 2026-09-02, deliberately held
back as a platform the schema was NOT shaped by. Its letters carry five
date-bearing fields — `createdAt`, `sentDate`, `updatedAt`,
`readTimestamp`, `sentTimestamp` — each a 24-character string. No existing
date form accepts an instant. This blocks a Message connector.

The corpus cannot narrow the form further. The fixtures are structure-only:
capture format 1 records only a type token and a string length. It has no
facility for recording a pattern, so the exact serialization of those 24
characters is NOT established by the corpus and no future capture can
establish it.

Three further narrowings in `packages/core/src/schema.ts` were true when
written and became false when the fourth fixture landed:

- `Platform` is the three-platform enum
  `["webuntis", "dieschulapp", "kikom"]`. Schulmanager is absent.
- `ProvenanceEnvelope.request.method` is `z.literal("GET")`. All four
  Schulmanager captures are POST. This blocks ANY Schulmanager connector,
  not only a Message one.
- `ProvenanceEnvelope` already carries `captured_at: z.iso.datetime()`, so
  the schema accepts instants on the envelope. The rule in force is that
  record dates are platform-supplied civil forms while envelope facts are
  instants — a fifth form extends that pattern rather than breaching it.

This ADR decides what the fifth form is, and how far the three narrowings
are widened.

## Decision

### 1. A fifth date form, `PlatformInstant`, in the shared date vocabulary

Not scoped to the Message concept: the form enters `DateValue`, and
nothing in this ADR attaches it to any one concept.

**Reason:** the date forms are a shared vocabulary deliberately separate
from the concepts. Scoping a form to one concept pushes a discrimination
problem onto every consumer — the same reason `TimetableEntry` was kept as
one concept with fixture-backed branches rather than split into concepts.

**Consequence:** any concept may carry it.

### 2. The form holds the platform's string as emitted and derives no civil day

It assumes no timezone either. The form is `kind` plus a value; it has no
day field and no zone field.

**Reason:** a Berlin-local midnight is 22:00 UTC the previous day, so a day
derived inside the schema is wrong for any consumer that formats it without
converting back. A consumer needing a day must supply the zone.

**Consequence:** the rule is enforced by the absence of a day field rather
than by comment.

### 3. Validation is `z.iso.datetime({ offset: true })`

**Reason:** this was tested directly against Zod. The default
`z.iso.datetime()` accepts only the trailing-Z form. `{ offset: true }`
additionally accepts an extended numeric offset (`+02:00`) but still
REJECTS a basic offset (`+0200`). Both `+02:00` and `+0200` are 24
characters when paired with second precision, so the corpus cannot
discriminate; the trailing-Z form at 24 characters is what
`Date.prototype.toISOString()` emits and is the likeliest shape.

**Consequence:** if a live Schulmanager connector rejects real rows, the
platform emits a basic offset and the form widens then, with evidence. The
risk is recorded rather than designed around, on the same discipline that
left `PlatformDateInt` un-narrowed.

### 4. `ProvenanceEnvelope.captured_at` widens to `z.iso.datetime({ offset: true })`

**Reason:** the current default rejects an offset-bearing instant, so a
live producer stamping `captured_at` with a local offset cannot build a
valid envelope — the schema is wrong for a live producer, which is the
test that justified the allowlist_version change and did not justify
narrowing `PlatformDateInt`.

**Consequence:** the envelope and the new form share one validator.

### 5. `ProvenanceEnvelope.request.method` becomes `z.enum(["GET", "POST"])`

**Reason:** the literal existed to keep envelope facts evidenced; widening
to a plain string invites invention. An enum widens exactly as far as the
corpus reaches.

**Consequence:** it grows by amendment as `Platform` does.

### 6. `Platform` gains `"schulmanager"`

**Reason:** four fixtures are committed and the enum names three.

**Consequence:** bookkeeping, no behavioural change.

## Consequences

- The date vocabulary grows from four forms to five; no concept is
  touched.
- Every widening is a superset of the field it replaces: a trailing-Z
  `captured_at` and a `"GET"` method remain valid, so every previously
  valid envelope remains valid.
- `packages/core/src/schema.ts` changes. The generated
  `packages/core/schema/normalized-schema-0.1.json` is regenerated from
  the Zod source and its byte-pinning test is re-run; the generated
  document is never hand-edited.

## Not decided by this ADR

- Whether `request.status`'s `z.literal(200)` widens. Every capture is 200;
  absence of a non-200 is not evidence. Gap register entry, not a widening.
- Whether `DayOnly.year_provenance` generalises. Its three required
  literals (`year_stated_by_platform: true`, `stated_digits: 2`,
  `century_inferred: true`) pin Kikom Informationen's exact shape, so a
  platform stating a four-digit year cannot use DayOnly. Nothing in the
  corpus demands it yet.
- Whether Message carries the new form. That is a connector decision.
- Whether ADR-003's fetcher signature accommodates Schulmanager's N+1
  detail fetch. Unchanged from ADR-004.
- Whether `readTimestamp` is nullable. It sits on `studentStatuses`, which
  no concept models.
