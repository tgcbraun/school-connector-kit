# DieSchulApp connector — first live run

Status: derived facts only. No tenant host, no account name, no pupil name,
no student id, no subject name or acronym, no room, no teacher, no session
cookie value, no record identifier, and no response value appears here. Field
names and JSON types are published deliberately, on the same line ADR-002
draws for query parameter names. The runner was private, git-ignored, mode
0600, wrote no files, and printed derived facts only.

## Login shape

Before either run below, a separate throwaway probe issued the login call
twice: two runs separated by several minutes, each run making one attempt
without a User-Agent header and one with. Both runs reproduced identically:

```text
without User-Agent:  status 200, content-type application/json,
                     body 0 characters, 1 Set-Cookie, DSASESSID present
with User-Agent:     status 403, content-type application/json;charset=utf-8,
                     body 19 characters, JSON-parseable, 1 Set-Cookie,
                     DSASESSID present
```

What this established: `PUT /api/1.0/admin/login/` returns HTTP 200 with an
EMPTY body and establishes the session solely through the DSASESSID
Set-Cookie. The connector had asserted the body was JSON and threw
`auth_failed` against the real platform. That guard was removed; status 200
is now the whole post-condition, because ADR-003 decision 3 forbids the
connector from inspecting Set-Cookie. The test suite had pinned the wrong
behaviour because its login fixture body was invented as `{}`; the fixture is
now the empty string and one test was replaced by its opposite, so the suite
pins the platform fact. Test count unchanged at 38.

The 403 is recorded as **OBSERVED AND UNEXPLAINED**. Both candidate causes
are named, and neither is endorsed: the User-Agent string itself, or the fact
that the second attempt followed the first within milliseconds. The probe's
fixed attempt order cannot separate them, and it was not worth further login
attempts against an account whose lockout behaviour is unknown. The connector
sends no User-Agent, so it never takes the 403 path.

## What was run

The DieSchulApp connector (`packages/connectors/dieschulapp/`), against one
live tenant on 2026-09-07. Two runs in one session: run 1 with no
`FetchWindow`, which fetches the clock's own week in one request; run 2 with
the window 2026-09-25..2026-10-06, a Friday-to-Tuesday span crossing a month
boundary. This was the first live run producing real values for the
`TimetableEntry`, `WeekdaySlot` and `StudentReference` concepts, and the
first exercise of ADR-008's covering-and-clipping fetch against a platform
rather than a scripted fake.

## Result

**Run 1, no window:**

```text
authenticate          ok
session_cookies       1
window                none (clock week)
rows                  41
schema_valid          41/41
distinct_ids          41/41
week_anchors          1
anchor_present_true   0
max_id_repeat_in_week 1
weekdays_observed     0,1,2,3,4
slot_numbers          1,2,3,4,5,7
distinct_students     1
time_str_lengths      5
occurrence_set        0
subject_present       41
acronym_present       41
captured_at_distinct  1
```

**Run 2, window 2026-09-25..2026-10-06:**

```text
authenticate          ok
session_cookies       1
window                2026-09-25..2026-10-06
rows                  67
schema_valid          67/67
distinct_ids          41/67
week_anchors          3
anchor_present_true   0
max_id_repeat_in_week 1
weekdays_observed     0,1,2,3,4
slot_numbers          1,2,3,4,5,7
distinct_students     1
time_str_lengths      5
occurrence_set        0
subject_present       67
acronym_present       67
captured_at_distinct  1
```

## Established

**All rows validated against the `TimetableEntry` concept imported from
`packages/core`, not a local copy.** 41/41 in run 1 and 67/67 in run 2.

**ADR-009's open question is answered for this tenant.** No id repeated within
any single week anchor, across one week and then across three. The entry id
identifies a template row uniquely inside a week, so `week_anchor.date` is a
sufficient occurrence discriminator. This is stronger evidence than the count
ADR-009 rested on, because it reads the platform directly rather than a
private store whose deduplication could have hidden a collision.

**The weekly template repeats across weeks.** 41 distinct ids across 67 rows
in run 2, and 41 is exactly run 1's single-week count.

**The Monday-anchored orbit visited three weeks for a Friday-to-Tuesday
window.** Anchors 2026-09-21, 09-28 and 10-05. An orbit anchored at the raw
window start would have stepped 09-25 then 10-02 and missed the week
containing 10-05. ADR-008 decision 1's boundary case, observed rather than
argued.

**Clipping happened.** Run 2 returned 67 rows across three week anchors,
while a single whole week measured 41, so the two boundary weeks were clipped
and the middle week was kept whole.

**One distinct `captured_at` across a three-request fetch.** A fetch is one
observation, and that holds across a multi-request fetch.

**`occurrence` set on zero rows, per ADR-009 decision 2, and
`week_anchor.present_in_response` false on every row, per ADR-008 decision
4.**

**Weekdays 0..4 observed, ISO Monday-origin, Monday = zero.** That confirms
ADR-008 decision 5 against live values, where before it rested on a probe.

**Slot numbers 1, 2, 3, 4, 5, 7 — not contiguous.** 6 is absent, which is a
free period and not a defect, but slot numbers must not be assumed dense.

**Start and end times were uniformly 5 characters: `HH:MM`, no seconds and
no offset.**

**`subject` and its optional `acronym` were present on every row.** Optional
in the schema, universal for this producer — the same pattern Schulmanager
showed.

## Not established

- One tenant, one student. `distinct_students` was 1 in both runs, so the
  multi-student case is untouched and this tenant cannot evidence it.
- Whether two entries can share an id within one week is answered for this
  tenant and this template only, not for the platform.
- No partial failure or non-200 fetch occurred, so those paths ran
  unexercised.
- The 403, as above: observed and unexplained, both candidate causes named,
  neither endorsed.
- Provenance, plainly: the runner wrote nothing, so no committed artifact in
  this repository holds its raw output. These are the derived facts as
  printed, which is weaker provenance than a capture.
