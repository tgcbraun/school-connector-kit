# @school-connector-kit/core — normalized schema 0.1

Vendor-neutral normalized schema shared by connectors and consumers.
**Zod is the single executable source.** The JSON Schema
(`schema/normalized-schema-0.1.json`) is generated from the Zod definitions
— never hand-written — and pinned byte-for-byte by `test/json-schema.test.ts`.

## Layout

| Path | Role |
|---|---|
| `src/schema.ts` | The 0.1 schema: 6 concepts, 4 date forms, identity model (Zod v4) |
| `src/document.ts` | Pure builder for the JSON Schema document (shared by writer and pinning test) |
| `src/generate-json-schema.ts` | The only writer of `schema/normalized-schema-0.1.json` |
| `test/schema.test.ts` | Hand-written instances whose SHAPE is derived from the committed fixture structure (the fixtures carry no values — see "What the tests claim, and do not claim"), plus evidence-boundary pins |
| `test/json-schema.test.ts` | Golden-file pin: committed file ≡ fresh Zod generation; structural pins |
| `schema/normalized-schema-0.1.json` | Generated JSON Schema (draft 2020-12); regenerable byte-identically via `generate-schema` |

## Concepts (0.1) and the committed evidence for each

| Concept | Populated by (committed fixtures) | Notes |
|---|---|---|
| TimetableEntry | dieschulapp variant-001 (weekday+slot location); webuntis variant-001 (lesson_reference location) | ONE concept with a location union — a deliberate decision, not a gap (see Decisions) |
| Assignment | webuntis variant-001 (homeworks) | `date` and `dueDate` kept as two independent `PlatformDateInt` values; the fixture's non-uniform row offset proves no fixed relationship |
| Event | kikom variant-001 (termine) | Date is a `PartialDay`; the recurring-row case carries the platform's own occurrence index |
| Message | kikom variant-001 (informationen) | Date is a `DayOnly` with its distinct 2-digit-year century-inference provenance; link presence is pinned, targets are not |
| StudentReference | dieschulapp variant-001 (per-student scope) | WebUntis homeworks carry no student: the absence IS its WebUntis evidence; the id shape was redacted (G2) |
| ProvenanceEnvelope | all three platforms | Attached to every concept; identity triple + occurrence discriminator + verbatim capture envelope facts |

**Absence and Assessment are deliberately not concepts in 0.1.** No
committed fixture populates either. Both are documented as known gaps (G0,
G1), and `NormalizedMessage` rejects both concept names (pinned by test).
Assessment was listed in the next-steps document from expectation; the
capture — which contains no assessment-shaped array — does not support it
(listing a concept a fixture cannot populate is the failure this project
already avoided with Absence; a thin, flagged variant is not an exception).

## Date model — four distinct forms, no collapse, no conversions

| Form | Evidenced by | Shape facts |
|---|---|---|
| `PlatformDateInt` | webuntis `date` / `dueDate` | Integer value on a date field. **The fixture establishes the int type only** — the capture contains no values for these fields (digit count, range, epoch, unit all redacted), so the encoding is NOT established (G6). 0.1 therefore models no year/month/day components and no unit; the name states only what the fixture shows. The independence of the two fields is the structural fact it DOES establish (non-uniform row offset), and Assignment preserves both. |
| WeekdaySlot | dieschulapp | Weekday int (0–4 observed; encoding not pinned — G5) + slot number + time-of-day strings; the week anchor is recorded as **out-of-band** (request parameter only, never in the response) |
| PartialDay | kikom termine | Day + month, year absent on the page → `resolved_year` + `year_stated_by_platform: false` + `inference_anchor` (+ optional `sequence_position`; per-row values redacted — G4) |
| DayOnly | kikom informationen | Full calendar day, NO time component; `year_provenance` records the 2-digit-year century inference |

Rules pinned by tests:

- **No midnight-UTC conversion:** nothing carries a timestamp/instant/epoch
  field; the day-carrying forms are closed objects
  (`additionalProperties: false`). Storing a Berlin local midnight as a UTC
  midnight would land at 22:00 UTC on the PREVIOUS day — the model forbids
  the shape that invites that bug.
- **Undetermined encoding is not encoded:** `PlatformDateInt` is
  `{kind, value}` exactly (shape test) — no component fields a fixture does
  not back, and no unit implied by the name (gap G6).
- The two year statements are distinct: `PartialDay` pins
  `year_stated_by_platform: false` (year absent), while `DayOnly`
  pins a `year_provenance` block with `stated_digits: 2` (year stated
  partially, century inferred). They do not share a flag, and a
  stated-4-digit-year case is not modeled in 0.1 (no fixture backs it).

## Identity model

`source_platform` + `source_instance` + `source_record_id`, plus the
`occurrence` discriminator. `source_record_id` alone is never globally
unique — the Kikom fixture shows a recurring Termin repeating the same row id
across occurrences, and the platform's own answer is the indexed parameter
`tx_calendarize_calendar[index]`. Values travel as opaque strings (redacted
by design); the envelope facts (allowlist version, capture timestamp,
request method/status/url-template shape, request array index) are the
verbatim metadata the fixtures supply. Tenant identity values are dropped in
all captures (G3).

## Gap register (not backed by committed fixtures — reported, not invented)

- **G0 Absence** — no committed fixture populates an absence; known gap, not a concept.
- **G1 Assessment** — no committed fixture shapes an assessment: the WebUntis capture has no assessment-shaped array (homeworks/lessons/records/teachers only). Listed in the next-steps document from expectation; 0.1 declines to model it.
- **G2 StudentReference id shape** — dieschulapp shows a student scope; the identity block was dropped wholesale.
- **G3 ProvenanceEnvelope `source_instance`** — tenant identity present at source, values dropped from every capture.
- **G4 PartialDay `sequence_position` per-row values** — the ordering mechanism is evidenced; no per-row value is pinned (redacted).
- **G5 WeekdaySlot weekday encoding** — int range 0–4 observed; which weekday each value means is not established by the fixture.
- **G6 WebUntis date-int encoding** — `date`/`dueDate` are typed int with redacted values: digit count, range, epoch, and unit are not established; 0.1 models no components.
- **G7 Message link targets** — hyperlink columns are present (count pinned); targets were never captured.
- **G8 Message `updated`** — placeholder column (length 1) with format never pinned; deliberately not modeled.
- **G9 connector fetcher return types unbound to schema concepts** — `ConnectorFetchers` return `readonly unknown[]` at this stage; binding them to the 0.1 concepts is the next step and needs a real connector to justify the binding (ADR-003).
- **G10 binary response bodies unsupported by Transport** — `HttpRequest.body` / `HttpResponse.body` are strings; binary payloads are out of scope at this stage (ADR-003).
- **G11 FetchRequest carries only a window; no evidence yet for other parameters** — the WebUntis capture evidences the request window (it selects on the due-date field); nothing in the captures evidences any further request parameter (ADR-003).
- **G12 packages/core had no declared entry point until ADR-003; no consumer had ever imported it by package name** — tests imported `src` files directly; the barrel and the `exports` record were added with ADR-003.
- **G13 `packages/core/src/` mixes shippable and build-time modules; they are separated only by reachability from the entry point, not by directory** — `document.ts` and `generate-json-schema.ts` sit in the same tree as the shippable surface; ADR-003's rule and scan follow the entry point's import closure, and no directory or exclusion list performs the separation. Closing G15 (Node globals well-typed across the compilation by `"types": ["node"]`) requires exactly this separation.
- **G14 packages/core sets no `"lib"`; the target default includes DOM typings — now closed** — packages/core now sets `"lib": ["ES2022"]` explicitly in its own `tsconfig.json`, so DOM typings are no longer pulled in by the target default, and DOM globals no longer typecheck under the package's tsconfig chain. The change produced zero typecheck diagnostics because the package uses no DOM symbol (ADR-003).
- **G15 packages/core/tsconfig.json sets `"types": ["node"]`** — so Node globals (process, Buffer, console) are well-typed inside the shippable surface and are prevented only by the entry-closure scan, not by the compiler (ADR-003). `"types"` cannot simply be dropped: `generate-json-schema.ts` uses `console` and `document.ts` imports `node:module` in the same compilation, so closing this gap requires the separation of shippable and build-time modules recorded as G13.

G0–G8 keep these identifiers; earlier cross-references remain valid.

## Decisions (recorded, not gaps)

- **TimetableEntry is one concept with a location union — not two
  concepts.** A timetable entry is the same concept regardless of how the
  platform addresses its position (weekday+slot in the DieSchulApp fixture,
  lesson reference in the WebUntis homeworks fixture); splitting it on the
  addressing scheme would push a merge problem onto every consumer of the
  normalized stream. The two fixture-backed schemes are modeled as
  alternatives; no committed fixture emits both in one entry, so no combined
  branch is modeled (nothing to back one) — this is a decision, not an
  unresolved gap. The location branches are strict: an entry asserting both
  positionings at once is rejected, and that rejection is pinned by test.

## Tooling note

- Dependencies: `zod ^4.4.3` only (`typescript`/`vitest` come from the
  workspace root).
- Scripts: `build`, `generate-schema` (writes the committed JSON Schema),
  `test`, `typecheck`.
- Regenerating the JSON Schema: `npm run generate-schema && npm test` —
  the pinning test fails on any hand-edit or definition drift.

## What the tests claim, and do not claim (finding)

Stated as a finding, precisely:

- **What the tests do:** validate **hand-written instances whose SHAPE was
  derived from the committed fixture structure**. The test payloads use
  placeholder shape values where the fixtures type a field with redacted
  content, and the verbatim envelope metadata committed in the fixture
  files. They pin that the schema accepts that shape and rejects the
  evidence boundaries (the README gap register, G0–G8).
- **What the tests do NOT do:** the committed fixtures are structure-only
  and **carry no values**, so no instance can be constructed from them.
  Nothing in this suite is a schema-conformance validation of 0.1 against
  real platform data, and no passing test count from it should be read as
  such.
- **Why that is the right bar today, and who closes it:** capture-first
  evidence establishes *which fields exist and how they are typed*; a
  value-free fixture cannot serve as a schema conformance test. A future
  connector implementation — running 0.1 against live platform data — is
  what will validate it. This is a statement of where the evidence ends,
  not a deficiency; the gap register (G0–G8) records the rest.
