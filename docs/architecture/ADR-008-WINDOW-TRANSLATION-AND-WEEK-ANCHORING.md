# ADR-008 — Window translation and week anchoring

**Date:** 2026-09-05
**Status:** Proposed
**Supersedes:** nothing
**Related:** ADR-003 (connector runtime contract — decision 7 defines FetchWindow's
encoding and side, not its semantics), ADR-006 (platform-supplied instants),
ADR-007 (fan-out is the connector's, decision 2), `packages/core/src/schema.ts`,
`packages/core/src/connector/connector.ts`, `fixtures/dieschulapp/variant-001/`

---

## Context

`FetchWindow` is `YYYY-MM-DD` on both bounds and may span many weeks.
DieSchulApp's `/api/1.0/current-timetable/` takes a single `date` with
`week=true` and returns one week of entries. A window wider than one week
therefore has no single request, and ADR-003 decision 7 does not say what a
connector owes the caller when the platform's granularity and the window's
disagree. ADR-007 freed a connector to issue N requests; it did not decide
whether it should.

A DieSchulApp entry also cannot be dated from its own response. An entry
carries `weekday` (int) and a nested `timeTableSlot` with `startTime`/`endTime`
as times of day. The committed capture's `shape` and `dropped_paths` contain no
date-bearing path, so the week anchor exists only in the request. `WeekdaySlot`
records this by pinning the anchor as absent.

Two constraints previously attributed to the platform are properties of the
private evidence shim, not of the server. `private-fixtures/dieschulapp/
fetch_timetable.py` rejects a non-Monday `--date` before issuing any request,
and hardcodes `week=true` inside the fetch. `private-fixtures/dieschulapp/raw/`
holds one response, one week, one student. The corpus therefore evidences
neither that the platform requires a Monday nor that `week=false` is
unavailable, and this ADR must not assume either.

The private Family Dashboard connector is a running precedent rather than an
authority: it snaps both window bounds back to Monday, loops in seven-day
steps, and discards records falling outside the original bounds. It composes
each record's date as anchor plus `weekday`, which presumes an encoding the
corpus has not established (G5).

## Decision

### 1. `FetchWindow` is a coverage obligation, not a truncation allowance

A connector returns every record its platform exposes within the window, and
returns no record outside it. Where the platform cannot express the window, the
connector issues as many requests as coverage requires.

**Reason:** the alternative — returning the first platform-granular slice and
stopping — makes the window's meaning depend on the platform behind it, and
silently. A consumer cannot distinguish a truncated result from a genuinely
empty stretch, because nothing in the returned array says which it got. The
running private connector against this exact platform already implements
coverage rather than truncation, which is weak evidence of correctness but
strong evidence of practicability.

**Consequence:** no file changes. This decision constrains connectors, not the
contract. A platform with coarse granularity is more expensive to fetch than
one with fine granularity, and the contract does not surface that difference to
the caller.

### 2. Granularity mismatch is met by covering, then clipping

The connector computes the smallest set of platform-granular requests covering
the window, issues them, and drops records whose own resolved date falls
outside the window bounds.

**Reason:** it is the only construction satisfying decision 1 on a platform
that cannot take the window. Clipping is on the record's resolved date rather
than on the request that produced it, because a covering request is wider than
the window by construction at both edges.

**Consequence:** records fetched and discarded at the window edges are wasted
upstream work, bounded by two partial periods per fetch regardless of window
width. Clipping requires resolving a record's civil date — see decision 5.

### 3. The number of covering requests is the connector's, under ADR-007 decision 2

No request-side budget field is added to `FetchRequest`.

**Reason:** ADR-007 decision 2 already placed fan-out with the connector, and
the reason transfers unchanged: a budget field generalises one platform's fetch
shape into a contract shared by four. Coverage fan-out is derived from the
window rather than from the data, so it is bounded before the first request in
a way an N+1 detail fan-out is not, but that makes it more predictable, not
contract-level.

**Consequence:** a wide window against a week-granular platform is a large
request count with no ceiling the caller can set. The cancellation gap ADR-007
decision 2 recorded applies here with more force, because coverage fan-out is
issued eagerly.

### 4. The requested week anchor is recorded inside the existing `week_anchor` block, and no civil day is composed

`WeekdaySlot.week_anchor` is today a required object carrying
`present_in_response: false` and `resolution: "out_of_band_request_parameter"`.
It gains one optional field, `date` (`YYYY-MM-DD`): the value the request
parameter named by `resolution` actually had. The connector records the anchor
it requested. It does not add the weekday to the anchor and does not emit a
date.

**Reason:** ADR-006 decision 2's rule is that a date form holds what the
platform supplied and derives no civil day from it. Recording the anchor beside
the weekday composes nothing — both are true statements about how the record
was obtained, and the anchor is the caller's own request echoed back rather
than a platform assertion. The existing two literals already state that the
anchor was absent from the response and that it came from an out-of-band
request parameter; `date` completes that statement with the parameter's value
instead of restating its provenance in a second field. `PartialDay` is the
precedent in shape — it carries the inference flag, the anchor, and an optional
sequence position rather than a resolved date alone.

**Consequence:** a consumer wanting a date composes it and needs the weekday
encoding to do so. The schema does not supply that encoding, and this ADR does
not assert one. `date` is optional and the two literals are untouched, so every
existing `WeekdaySlot` instance stays valid and the widening is a superset.
`TimetableEntryLocationWeekdaySlot` extends `WeekdaySlot` and is `.strict()`;
nesting inside `week_anchor` leaves that strictness unaffected, since
`week_anchor` remains one known key at the extended object's top level.

### 5. The DieSchulApp connector is blocked on G5, and this ADR states the dependency rather than working around it

`weekday` is observed as 0–4 across 38 entries in one capture and its identity
is unestablished. Decision 2's clip and decision 4's consumer-side composition
both require it. The connector is not implemented until G5 is bound by
evidence.

**Reason:** 0–4 across a five-day school week is consistent with Monday-origin
and with other origins whose absent days happen to be the weekend. Plausibility
is not evidence, and the private connector's Monday-origin arithmetic is that
connector's belief. Binding it costs one probe request: if `week=false` is
honoured, a single non-Monday date returns only entries carrying that day's
`weekday` value, which binds the encoding directly.

**Consequence:** the probe precedes the connector. If `week=false` is not
honoured, the encoding needs a different falsifier and this ADR's decision 2 is
unimplementable for DieSchulApp until one is found.

## Consequences

- `packages/core/src/schema.ts` changes in exactly one place: an optional
  `date` field inside the existing `WeekdaySlot.week_anchor` object.
  `packages/core/schema/normalized-schema-0.1.json` is regenerated from the
  Zod source, never hand-edited. No test changes: the existing `week_anchor`
  pins assert `present_in_response` and `resolution`, both unchanged.
- No change to `connector.ts`, `transport.ts`, the capture tooling, or any
  fixture. `capture_format` is not bumped.
- Decisions 1, 2 and 3 change no file; they constrain every connector written
  after them, including the two already published, neither of which violates
  them — WebUntis takes a server-side window and Schulmanager accepts none.
- G5 is rewritten as a connector blocker rather than a descriptive gap.

## Not decided by this ADR

- Whether DieSchulApp accepts a non-Monday `date` or honours `week=false`. Both
  are unobserved; decision 5 makes finding out a prerequisite.
- `TimetableEntry` identity on this platform. The private connector deduplicates
  on course plus weekday plus slot rather than on the entry's own `id`, with a
  comment that parallel entries share a class slot. That bears on
  `source_record_id` and `occurrence` and is a separate read.
- Whether `week_anchor` generalises to a platform whose coarse granularity is
  not a week.
- Whether a connector may expose its coverage request count to the caller.
- The `/api/1.0/calendarEvents/` range filter observed in the private connector,
  which suggests this API does range filtering on another endpoint. Dead code
  there, uncalled, and no capture exists.
