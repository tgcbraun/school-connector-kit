# ADR-009 — Timetable entry identity on a weekly template

**Date:** 2026-09-06
**Status:** Accepted
**Supersedes:** nothing
**Related:** ADR-004 (capture request identity), ADR-008 (window translation and
week anchoring — this ADR decides what ADR-008's "Not decided" list defers),
`packages/core/src/schema.ts`, `fixtures/dieschulapp/variant-001/`

---

## Context

ADR-008 defers `TimetableEntry` identity on DieSchulApp explicitly. Its
"Not decided by this ADR" list names the question, notes that the private
connector deduplicates on course plus weekday plus slot rather than on the
entry's own `id`, and calls it a separate read. This ADR takes it up.

The committed fixture at `fixtures/dieschulapp/variant-001/capture.json`
types an `id` (int) at the top level of each entry, alongside separate ids
on `courseSubject`, `courseSubject.subject` and `timeTableSlot`. The fixture
is capture format 1 and carries no values, so it establishes that the field
exists and cannot establish whether it is unique.

Evidence on uniqueness came from a read-only query against the private Family
Dashboard's SQLite store on 2026-09-06, which retains whole entries as stored
JSON across many weekly fetches. Over 194 stored timetable rows there were
27 distinct entry ids and 36 distinct dates, and every distinct id appeared
on between 7 and 8 distinct dates. These figures are reported as counts
only; no values were read and none are recorded here.

The conclusion: DieSchulApp's entry `id` identifies a weekly timetable
template row, not a dated occurrence of it. The same id returns unchanged
week after week.

This evidence lives in a private store, and no committed artifact in this
repository backs it. That is the same provenance weakness ADR-008 decision 5
carries, whose weekday encoding rests on a private probe rather than on the
corpus.

The private connector's deduplication on course plus weekday plus slot is
NOT evidence for this conclusion: it drops parallel entries by design, for
display, and never inspects the entry's own id. A constraint attributed to a
platform may be a property of the client that observed it.

## Decision

### 1. `source_record_id` is the entry's own `id`, stringified

For a DieSchulApp `TimetableEntry`, the envelope's `source_record_id` holds
the entry's own `id` from its response, stringified.

**Reason:** it is platform-supplied, stable, and requires no composition.
ADR-004 decision 3's principle — an identifier is caller- or
platform-supplied, never derived from the payload — is preserved.

**Consequence:** it is not unique on its own, which is the ordinary case the
schema already anticipates for `source_record_id`: the file header of
`packages/core/src/schema.ts` states that `source_record_id` alone is never
assumed globally unique, and the field is pinned as an opaque string on that
basis.

### 2. The occurrence discriminator for a weekly-template platform is `location.week_anchor.date`, and `ProvenanceEnvelope.occurrence` is NOT used

For a `weekday_slot` record, the field that disambiguates the record across
weeks is `location.week_anchor.date`. `ProvenanceEnvelope.occurrence` is
left unset.

**Reason:** `occurrence` is typed `z.int().nonnegative()`, and both the
schema's file header and the field's own comment describe it as the
platform's own index, naming Kikom's tx_calendarize_calendar[index] as the
case it was drawn from. DieSchulApp supplies no index. A connector counting
weeks into an integer would invent a platform fact, which is precisely what
ADR-004 decision 3 forbids. The anchor is already recorded under ADR-008
decision 4, is already the value the connector requested, and already names
the week the record belongs to.

**Consequence:** identity for a weekday_slot record is the envelope triple
plus one field that lives on `location` rather than on `provenance`. That is
the real cost, stated plainly: identity is split across two branches of the
record for this one location form, and a consumer computing identity
generically must special-case it. No schema field changes and no test
changes; this ADR is a statement about how existing fields compose.

## Alternatives considered

- (a) Widen `occurrence` to accept a string or a date. Rejected: it changes
  a pinned field's type, breaks the JSON Schema pin, and redefines a field
  whose comments in `packages/core/src/schema.ts` tie it to a
  platform-supplied index.
- (b) Add a new discriminator field to `ProvenanceEnvelope`. Rejected: it
  restates what `week_anchor.date` already says, and the envelope is inlined
  into every concept, so a field meaningful to one location form of one
  concept would appear on all of them.

## Consequences

- No file changes: `packages/core/src/schema.ts` is untouched,
  `packages/core/schema/normalized-schema-0.1.json` is not regenerated, and
  no test file is added or modified. Both decisions compose existing fields.
- Decisions 1 and 2 change no file; they constrain the DieSchulApp connector,
  which is the only one whose committed evidence supports
  weekly-template identity. The other published connectors (WebUntis,
  Schulmanager) are unaffected.
- Whether `packages/core/README.md`'s gap register gains an entry for the
  split-identity cost is on the Not-decided list, not assumed here.

## Not decided by this ADR

- Whether two entries within a single week can share an id. The 194-row
  figure cannot distinguish that from the private connector's deduplication
  having dropped one before storage. Unresolved, and it does not affect
  either decision above.
- How identity composes for a platform whose coarse granularity is neither a
  week nor an indexed occurrence.
- The student dimension: the response is per-student and the committed
  capture holds one student, so a household with two children in one
  institution is unevidenced.
- Whether the gap register gains an entry for the split-identity cost.
  Deliberately left to the maintainer rather than assumed.
