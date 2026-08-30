# variant-001 — WebUntis homeworks/lessons (structural)

A structurally redacted capture of a WebUntis homeworks-lessons endpoint
response, promoted from a private capture after a **human privacy review
was performed** (2026-08-30) and passed.

## Facts

- **Platform:** WebUntis
- **Endpoint template:** `GET /WebUntis/api/homeworks/lessons?startDate={startDate}&endDate={endDate}`
- **`capture_format`:** 1
- **Allowlist version:** `webuntis-homework-2026-08-30-v3` (see `allowlist.json`,
  committed beside the capture and still matching it)

## Files

```
capture.json    # structure-only redaction of the one observed response
allowlist.json  # the exact allowlist (v3) that produced it
README.md       # this file
```

`capture.json` keeps JSON types (`__t`), string lengths (`__len`), array
lengths, and a `captured_at` timestamp only. It contains **no real values
otherwise**: no homework text, no remarks, no names, no ID values,
no school name, no tenant identity.

## Concepts represented

- **Homework** rows, each carrying:
  - two **independent** integer date fields — an earlier reference date
    (`date`) and a later deadline date (`dueDate`);
  - `lessonId` — a join to `lessons[].id` (lesson/subject join);
  - `id`, `completed`, and string fields kept as type+length only.
- **Lesson** rows: `id`, `subject`, `lessonType` — the target side of the
  homework join.
- **Teacher join via records:** `records[]` rows carry `homeworkId`,
  `teacherId`, and `elementIds[]`; `teachers[]` carries `id`. The join is
  therefore `homeworks[].id → records[].homeworkId → records[].teacherId
  → teachers[].id`, not a direct teacher field on the homework.

## Structural observations useful to a connector author

Derived from two windowed captures of the same endpoint (private evidence;
facts only — no values were recorded here):

1. **The request window selects on `dueDate`.** Extending the window's end
   date added exactly the rows whose later date crossed the old boundary;
   the earlier date field's values did not change, ruling out `date` as
   the selection key. A connector's windowing/validity semantics must be
   keyed on the due-date field.
2. **`date` and `dueDate` are independent per-row values.** The difference
   `dueDate − date` varies from row to row (non-uniform), so no fixed
   offset can be inferred between them and neither date is derivable from
   the other. Both fields must be preserved independently.
3. **Attachments were empty in all observed rows**, so their element shape
   is unknown. The field exists and was dropped by the allowlist; a
   connector must not assume any attachment element schema until one is
   observed non-empty.
4. `lessons[]` is keyed by `id` and covers the full requested window; most
   lessons are not referenced by any homework in the window.
5. In this capture every homework had exactly one `records[]` row; the
   `elementIds` arrays all had length 1 (a capture-specific account scope —
   not asserted as a stable API property).

## Provenance

- Reviewed by a human as part of the school-connector-kit privacy review
  process (Phase 5 passed); the checklist in `fixtures/README.md` applies.
- `private-fixtures/webuntis/` holds the private originals and the private
  evidence notes; this directory stands alone and needs no access to them.
