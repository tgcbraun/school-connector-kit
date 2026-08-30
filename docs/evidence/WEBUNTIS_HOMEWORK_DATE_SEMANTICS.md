# WebUntis homework date semantics — private evidence (round 1)

Status: private working evidence. Contains **no real values** (no homework
text, no person or school identifiers, no IDs, no URLs with codes).
Not committed, not shareable as-is; the shareable form is the redacted
capture produced from it (private: `private-fixtures/webuntis/`).

## Endpoint

- Method/path (structural): `GET /WebUntis/api/homeworks/lessons`
- Parameters (structural): `startDate=YYYYMMDD`, `endDate=YYYYMMDD`
- Captured window: 2026-08-10 .. 2026-08-30 (caller-chosen, both bounds inclusive as passed)
- Auth: the established authenticated session (JSON-RPC `authenticate`, then the REST call with the session cookies); no student element is requested upstream for this endpoint.

## Payload shape (field names and JSON types only)

Root has a single key `data`; `data` contains four arrays:

| Array | Elements (this capture) |
|---|---|
| `data.homeworks[]` | 4 |
| `data.records[]` | 4 |
| `data.teachers[]` | 3 |
| `data.lessons[]` | 24 |

`data.homeworks[]` fields (present in 4/4, uniform types):
`id` (int), `date` (int, YYYYMMDD), `dueDate` (int, YYYYMMDD),
`lessonId` (int), `text` (string), `remark` (string),
`attachments` (array — empty in all 4), `completed` (boolean).

`data.records[]` fields: `homeworkId` (int), `teacherId` (int),
`elementIds` (array of ints; every record has exactly 1 element in this capture).

`data.teachers[]` fields: `id` (int), `name` (string).
`data.lessons[]` fields: `id` (int), `subject` (string code), `lessonType` (string).

Relations observed:
- `homeworks[].id`: 4 values, all unique.
- `records[].homeworkId` ⊆ `homeworks[].id`, and every homework has exactly one record (1:1 in this capture).
- All 3 distinct `homeworks[].lessonId` values resolve into `lessons[].id`; `lessons[]` is keyed by `id` (no `lessonId` key), and most lessons in the list are not referenced by any homework (expected: the array covers the full window).

## Date facts (structure + distribution only)

- Every homework has **both** `date` and `dueDate`, both ints, both valid calendar dates inside the requested window.
- `dueDate − date` is **always positive** in this capture (1 to 5 days).
- Gap distribution: **day-gap 1: one, 2: one, 3: one, 5: one** — four distinct gaps, one homework each.
- **No 7-day gap occurs anywhere in this capture.**
- The 2026-08-31..2026-09-02 observation window (post-capture probe) contains no dueDate in this dataset.

## Interpretation — decided vs. not decided

Decided by this payload (from the derived facts alone):
1. Upstream returns **two independent date integers per homework**; neither is derivable from the other by a fixed offset (gap distribution is mixed: 1/2/3/5 days), so a consumer must carry **both** fields and must not apply a stored constant shift to convert one into the other.
2. In every observed record `date` ≤ `dueDate` with a small (1–5 day) positive gap — consistent with "reference/entry date" followed by "due date", but **the label is a naming inference, not something the payload decides**.

Not decided (stated plainly):
- What `date` semantically represents (entry/creation date, lesson day, or announcement date) — the payload does not label it; this capture cannot distinguish these hypotheses.
- What `dueDate` semantically represents beyond "the later date" (submission deadline vs. a derived display field) — likewise not labeled upstream.
- The previously observed uniform 7-day difference in the rendered view is **not reproduced upstream in this window**; the upstream gaps are mixed (1, 2, 3, 5 days). So the 7-day offset cannot be attributed to this payload as stored; its origin (client-side rendering or another field/source) remains **open**.

## Open questions

1. Is `date` the date the homework was entered in WebUntis? (needs a second, later capture of the same homework ID to see whether `date` stays fixed)
2. Is `dueDate` a stable submitted deadline? (same two-capture probe)
3. Where does the rendered 7-day offset in the downstream view originate, given upstream gaps are 1–5 days here?
4. n=4 is a small sample; gap distribution may vary across weeks.

## Implications for the normalized Assignment model

- Preserve **both** upstream dates as separate fields (e.g., source entry date + source due date); **do not** normalize by subtracting/adding a constant.
- Keep field names semantically neutral until questions 1–2 are answered (the payload does not decide the labels).
- Safe to normalize from this payload: 1:1 homework↔record relation, `lessonId → lessons[].id` join, teacher join via `records[].teacherId → teachers[].id`, `completed` boolean, attachments as an array (empty observed; element shape unobserved — do not assume fields yet).
- Do not treat `elementIds` size as a stable fact (1 observed; capture-specific to the account scope).

## Amendment (post-dry-run)

- The observed gap distribution is **non-uniform** (1, 2, 3, and 5 days in
  this capture), therefore a **uniform fixed offset cannot originate in this
  payload** as stored; any constant day-shift between reference and due date
  must be attributed to a consumer-side transform or another source, not to
  the upstream field pair.
- Which of the two dates is the requested window's filtered field
  (i.e., the field that represents an "assignment date" in a normalized
  Assignment) is **not established by this capture alone**: this single
  window cannot decide whether the earlier date is an entry/creation stamp or
  a lesson day, nor whether the later date is a stable deadline. The test
  that would settle it is a **second capture, taken later, of the same
  homework IDs** — if the earlier date stays fixed while only membership of
  the window changes, it is an entry/creation stamp; if either field's value
  moves, that field is derived, not stored.

## Wider-window capture (second request: same start, extended end)

A second capture was taken with the **same start date and an extended end
date** (end moved past the first window's boundary; exact dates omitted by
policy). Derived facts only, from the private analyzer:

- Payload structure is identical to the first capture (same four arrays,
  same fields, same types; 1:1 homework↔record; `lessonId → lessons[].id`
  fully resolvable; `elementIds` arrays of length 1; IDs unique).
- Homework count grew from 4 to 8 with the wider window.
- Gap distribution over the wider set: **day-gaps 1, 2, 3, 5 (one each) and
  7 (four of the eight)** — the 7-day difference is therefore **realized as
  a stored per-row value for a subset** of homeworks, but the distribution
  remains **non-uniform**, so a *uniform* fixed offset is still ruled out as
  a payload property; it is data, not a constant transform.
- The first capture's four homeworks are retained in the wider one, and the
  four **new** rows are exactly those whose **dueDate** lies just beyond the
  first window's old end date. The maximum of the **dueDate** field crossed
  the old end-date boundary between the two captures, while the maximum of
  the **date** field stayed at the same value in both.
- **Conclusion on the filtered field:** the request window selects on
  **dueDate** — membership of the wider set is fully explained by dueDate
  crossing the widened end date. The alternative, a window applied to
  `date`, is **ruled out**: the new rows' `date` values were already inside
  the original window (their `date` maximum is unchanged across captures),
  yet they were absent originally and present only after the end date moved.
- This resolves the asymmetry between the two fields: **dueDate is
  selection-relevant (behaves as the effective deadline the API filters
  on)**; `date` is a non-selection reference date (its precise label —
  entry/creation vs. lesson day — remains open; the value set in the wider
  capture does not distinguish those hypotheses).
- Implication for the normalized Assignment (in addition to the earlier
  "preserve both dates independently"): any **windowing/validity semantics**
  in a normalized model should be keyed on the **due-date field**, since
  that is the field upstream membership demonstrably tracks; and the
  previously observed rendered 7-day difference is consistent with the
  stored per-row `dueDate − date` of those rows — whether a consumer view
  renders the stored dueDate directly or adds 7 days to the reference date
  is not decidable from the stored pair alone (both produce the same
  rendered value on the affected rows).

## Close-out

Established from the two captures (supersedes the earlier "label remains
open" status):

1. The 7-day gap is an **upstream per-row property realised on a subset** of
   homeworks (part of the stored `dueDate − date` value distribution), **not
   a fixed offset** applied to the payload or to all rows.
2. **`date` is the earlier reference date; `dueDate` is the later deadline**
   and is **the field the request window filters on** (a window request must
   be understood as selecting on `dueDate`; `date` is not the selection key).
3. **Both dates must be preserved independently** in a normalized
   Assignment — neither is derivable from the other, and the window
   semantics belong to the due-date field alone.
