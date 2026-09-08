# ADR-012 — The input-direction schema document

**Date:** 2026-09-08
**Status:** Accepted
**Supersedes:** nothing
**Related:** `packages/core/src/schema.ts` (the Zod definitions the
document is generated from), `packages/core/src/document.ts` (the builder
this ADR changes), `packages/core/schema/normalized-schema-0.1.json` (the
generated document), `packages/core/test/json-schema.test.ts` (the byte
pin that keeps the two in agreement)

---

## Context

The generated document and the Zod source disagreed on excess properties.
`packages/core/schema/normalized-schema-0.1.json` emitted
`"additionalProperties": false` for every concept — 72 occurrences by
count. The Zod objects it is generated from are plain `z.object`, which
accept a payload and strip unknown keys rather than reject them. A
consumer validating an outgoing payload against the published document
was therefore rejected where the executable source would have accepted:
the document described what a payload looks like AFTER parsing, and it
described it as if unknown keys had been refused.

The cause was that `document.ts` called `z.toJSONSchema` without an `io`
option and so rendered the output direction. Rendered in the input
direction instead, the same definitions emit 4 occurrences of
`"additionalProperties": false` — the two `.strict()` members of
`schema.ts`, each in the two unions that carry it — and no others.
The measured before/after is 72 to 4.

## Decision

The published JSON Schema document is generated in the input direction:
`z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" })` in
`document.ts`, so the document describes payloads a consumer may send,
not the stripped result of parsing one. The Zod definitions are
unchanged; no schema becomes stricter or looser at runtime. The document
also carries an explicit `direction: "input"` field in its `generator`
block so the view it represents is stated rather than implied.

**Reason:** the document's readers are payload producers validating what
they intend to send. That is the input side of the parser. A document
describing the stripped result was answering a question nobody here asked
and refusing payloads the runtime would have accepted, which is exactly
the disagreement measured above.

**Consequence:** members declared `.strict()` continue to emit
`"additionalProperties": false` — `TimetableEntryLocationWeekdaySlot`
and `TimetableEntryLocationLesson`, the two strict branches of the
timetable entry's location union, each appearing where the union
appears — and they remain the only places the key is emitted. A payload
that asserts both location schemes at once is rejected by the document
as it is rejected by the runtime.

**Consequence:** unknown keys sent by a consumer validate against the
document and are stripped by the runtime. The two surfaces now say the
same thing about excess properties.

**Consequence:** rejecting this ADR means reverting to the output
direction, which leaves the document and the Zod definitions in
disagreement about excess properties.

## Alternatives considered

- (a) Make every Zod object `.strict()` so the existing document becomes
  true. Rejected: the defect is in the document, not the schema. Stripping
  unknown keys is the behaviour every runtime in this repository relies on,
  and a breaking runtime change is not the shape a documentation defect
  calls for. It would also turn any payload carrying a key the
  schema does not declare — accepted and stripped today — into a rejection.
