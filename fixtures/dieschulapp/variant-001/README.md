# variant-001 — DieSchulApp current-timetable (structural)

A structurally redacted capture of a DieSchulApp current-timetable endpoint
response, promoted from a private capture after a **human privacy review
was performed** (2026-08-30) and passed.

## Facts

- **Platform:** DieSchulApp
- **Endpoint template:** `GET /api/1.0/current-timetable/?date={date}&week=true&substitutions=false`
- **`capture_format`:** 1
- **Allowlist version:** `dieschulapp-timetable-2026-08-30-v1` (see
  `allowlist.json`, committed beside the capture and still matching it)

## Files

```
capture.json    # structure-only redaction of the one observed response
allowlist.json  # the exact allowlist (v1) that produced it
README.md       # this file
```

`capture.json` keeps JSON types (`__t`), string lengths (`__len`), array
lengths, and a `captured_at` timestamp only. It contains **no real values
otherwise**: no names, no room, no class or course name, no ID values,
no school name, no tenant identity.

## Concepts represented

- **Student** rows: the response is per-student, and each entry lives
  **nested under its student** rather than in a top-level rows array
  (`students[]` → `entries[]`; one student, 38 entries observed).
- **Entry** rows, each carrying:
  - a `weekday` integer (0–4 observed; the encoding of that integer, e.g.
    which weekday it numbers, is not established by this capture) plus a
    nested `timeTableSlot` object (`number`, `startTime`, `endTime` as
    time-of-day strings) — **entries carry no absolute date at all**;
  - nested `courseSubject` details: subject, course, and teachers
    **inside the entry itself**, not as id-keyed join side arrays like
    WebUntis's `lessons`/`records`/`teachers`.

## Structural observations useful to a connector author

Derived from the private structural analysis of this one capture
(evidence notes in `docs/evidence/`; facts only — no values were
recorded here):

1. **Entries are located by weekday + slot, not by a date.** The full
   key-path sweep of the capture finds no ISO date strings, no epoch
   values, and no date field anywhere; the only time-shaped values are
   the two time-of-day strings under `timeTableSlot`. The requested
   week's anchor date travels only in the request's `date` parameter,
   so a connector must carry the week anchor out-of-band — it is not
   reconstructable from the response.
2. **Subject, course, and teachers are nested per entry**, rather than
   joined through id-keyed side arrays as in WebUntis. Normalization
   denormalizes nested objects instead of resolving joins; the same
   class-shaped object appears both under `student` and as
   `courseSubject.course` in each entry, and `teachers[]` is a per-entry
   array (observed at length 1, 0..N possible).
3. **`room`, `timetableBlock`, and `vacations` were null or empty in all
   observed rows**, so their element/field shapes are unknown. They
   exist and were dropped by the allowlist (`vacations`) or survive as
   null/dropped tokens; a connector must not assume any shape for them
   until a non-null/non-empty occurrence is observed.
4. **Person and institution identity is dropped wholesale:** the student
   name/id block, the teacher name/id/staff-code fields, the class
   identity triplet (`course.id`/`name`/`externalId` and the student's
   `mainCourse`), and `room` survive only as dropped paths; what each
   entry keeps is weekday, slot, time-of-day shape, and subject-level
   type/length tokens.

## Provenance

- Reviewed by a human as part of the school-connector-kit privacy review
  process (Phase 6 passed); the checklist in `fixtures/README.md`
  applies.
- `private-fixtures/dieschulapp/` holds the private originals and the
  private fetch/analysis tooling; this directory stands alone and needs
  no access to them.
