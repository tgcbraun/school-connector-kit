# DieSchulApp current-timetable structure — private evidence (round 1)

Status: private working evidence. Contains **no real string values** (no
forename, surname, displayname, teacher name, class name, room name,
institution name, or any other text from the payload; no id values either).
Not committed, not shareable as-is. Derived facts only, produced by
`private-fixtures/dieschulapp/analyze_timetable.py` from
`private-fixtures/dieschulapp/raw/timetable-20260824.json`.

## Endpoint / handshake

- Login: `PUT {base}/api/1.0/admin/login/`, JSON body `user`+`password`,
  session cookie (name on record in the shim) establishes the session —
  the cookie **value** is never recorded here.
- Fetch: `GET {base}/api/1.0/current-timetable/`,
  params `date=<YYYY-MM-DD>` (the requested Monday, here
  2026-08-24), `week=true`, `substitutions=false`.
- The requested anchor date (2026-08-24) is a request parameter, not a
  payload value (see "Answers", b).

## Payload shape (field names and JSON types only)

Root: object with two keys — `students` (array, 1 element) and
`vacations` (array, 0 elements — element shape unobserved).

`students[]` (n=1): object `{ student: object, entries: array }`.
`entries[]` is **per student** (1/1 elements carry their own array;
per-student entry counts: [38]).

`students[].student`: `id` (int), `forename` (string), `surname`
(string), `displayname` (string), `mainCourse` (object) with
`id` (int), `externalId` (string), `externalIds` (array of strings,
len 1), `type` (string), `name` (string), `channel` (int),
`isSoftDeleted` (boolean).

`students[].entries[]` (n=38, uniform 38/38 presence):
`id` (int), `courseSubject` (object), `timeTableSlot` (object),
`weekday` (int), `room` (**null in all 38** — shape unknown),
`timetableBlock` (**null in all 38** — shape unknown).

`entries[].courseSubject`: `id` (int), `teachers` (array),
`subject` (object), `course` (object), `type` (string; value class
only, not recorded).
- `subject`: `id` (int), `name` (string), `acronym` (string),
  `hexColor` (string).
- `course`: `id` (int), `name` (string), `externalId` (string),
  `type` (string). Note: structurally the **same course object** as
  `student.mainCourse` (same key set and role).
- `teachers[]`: array in 38/38, **length distribution len=1: 38**
  (single-teacher observed; 0..N must be assumed). Element keys:
  `id` (int), `forename` (string), `surname` (string),
  `displayname` (string), `externalId` (string **or null** — null in
  some entries, string in the rest).

`entries[].timeTableSlot`: `id` (int), `number` (int),
`startTime` (string), `endTime` (string), `type` (string; value class
only), `name` (string). `startTime`/`endTime`: **strings in 38/38,
100% matching a time-of-day pattern** (`^\d{1,2}:\d{2}(:\d{2})?$`) —
i.e. "HH:MM" class values, not ints, not dates. (The pattern and its
match ratio are recorded; the values are not.)

`weekday`: int in 38/38; **distinct values: 0, 1, 2, 3, 4** (no 5 or
6 observed). Encoding (0-based, Monday=0?) is **not established by the
payload alone** — it is a request-anchored week and the anchor is known
to be a Monday, which makes 0=Monday plausible but is inference, not
payload evidence.

Date-shaped / timestamp scan (full key-path sweep): the **only**
date-shaped or timestamp-shaped values anywhere are the two
time-of-day string fields above. A numeric-range probe also flagged
integers within the YYYYMMDD numeric range under `entries[].id` (3) and
`entries[].courseSubject.teachers[].id` (2) — these sit on **id** keys
and are read as identifiers, not dates. No ISO date strings, no epoch
values, no absolute-date field anywhere.

## Answers (from the derived-facts output alone)

a. **Located by weekday + slot, not by an absolute date.** Each entry
   carries a weekday int and a timeTableSlot (number + start/end
   time-of-day strings). No absolute date accompanies an entry.

b. **The payload does not carry the requested week's date.** No field
   in the shape or the date-shaped scan represents a calendar date.
   The week anchor exists only in the request (`date=` param); a
   consumer must track it from the request and attach it to any stored
   entry.

c. **Person/group-identifying fields to deny on publication:**
   `students[].student.{forename, surname, displayname, id}`;
   `entries[].courseSubject.teachers[].{forename, surname, displayname,
   id, externalId}`; `students[].student.mainCourse.{id, name,
   externalId, externalIds, channel}` and
   `entries[].courseSubject.course.{id, name, externalId}` (class/group
   identity, same object shape in both places); `room` (null in this
   capture, but a room name is identifying). Curriculum-level fields
   (`subject.{name, acronym, hexColor}`) are not personal.

d. **Structural differences vs. the WebUntis homework payload that a
   normalized model must accommodate:**
   1. **Join model:** WebUntis = flat rows + separate ID-keyed join
      arrays (`lessons`, `records`, `teachers`); DieSchulApp =
      **nesting-by-containment** (subject/course/teachers embedded in
      each entry). A mapper must normalize nested objects, not resolve
      id joins.
   2. **Time model:** WebUntis homework rows carry two absolute int
      dates (preserved independently per Phase 5); DieSchulApp carries
      **no absolute dates** — a recurring week model keyed on weekday
      + slot with time strings. The normalized Assignment/Entry model
      needs an "undated recurring" representation **plus** an
      out-of-band week anchor, and must not pretend dates exist.
   3. **Student scoping:** WebUntis homework payload had no student
      object at all; the DieSchulApp timetable **is** the student's
      data (1 student here; `n` students means `n` independent
      `entries[]` sets). Student identity must be dropped, but the
      multi-student container shape must be handled.
   4. **Teacher cardinality:** `teachers[]` is an array (1 observed) —
      a substitution/second-teacher entry is a different entry, and 0..N
      is the safe model (cf. WebUntis `elementIds` len-1 capture-specific
      caveat).
   5. **Null-but-present fields** (`room`, `timetableBlock`) and the
      empty `vacations[]` — element shapes unknown; same trap as
      WebUntis `attachments[]`. Do not assume schemas.

## Open questions

1. **weekday encoding** — is 0 Monday? (Corroborate by anchoring the
   next capture on a known-date Monday and checking entry day alignment,
   or by a second capture in a week with entries on a 6th day, if any.)
2. **`room` / `timetableBlock` element shapes** — need a capture where
   at least one is non-null before any schema assumption.
3. **`vacations[]` element shape** — same; empty in this capture.
4. **`teachers[].externalId` = null for some teachers** — is null
   "no staff code assigned" or "not a subject teacher"? (Both teacher
   classes appear to otherwise carry the same keys.)
5. **Account scope** — n=1 student; does the same endpoint return all
   students for the account, or only the requested one? (Affects
   promotion: a multi-student capture would add no new *shape* but would
   confirm the container semantics.)
6. **`courseSubject.type` / `course.type` / `timeTableSlot.type`** —
   string-typed discriminators; their distinct values are deliberately
   unrecorded (value class only). A redacted capture would keep type +
   length, as the WebUntis v3 capture did.
7. **Substitution semantics** — with `substitutions=false`, a slot
   appearing under two entries with different courseSubject/teacher in
   this capture (structural ID relation, no values involved) suggests
   the *same slot* can hold multiple entries in a week; how
   `substitutions=true` changes the shape (extra fields? duplicate
   entries?) is unobserved.

## Implications for normalization (from this payload)

- Store the entry as `student-scope (dropped) + weekday int + slot
  (number + start/end time-of-day) + subject (acronym class) + course
  (dropped) + teachers (dropped)` — i.e., keep the **time structure**
  and **subject-level** metadata, drop all personal/group identifiers.
- Record the **request's `date` param** alongside any persisted entry as
  the week anchor (the payload cannot self-date).
- Do **not** derive or synthesize calendar dates from weekday+slot
  without the anchor; keep the two (anchor, recurring entry) separate
  in the normalized model.
- Treat `room`, `timetableBlock`, `vacations[]` as **unknown shapes**;
  deny-by-default in any allowlist.
