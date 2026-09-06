# Schulmanager connector — first live run

Status: derived facts only. No tenant host, no school identifier, no account
email, no pupil name, no session token, no letter text, no record identifier,
and no response value appears here. The runner was private, git-ignored,
wrote no files, and printed derived facts only.

## What was run

The Schulmanager connector (`packages/connectors/schulmanager/`), against one
live tenant on 2026-09-05, with no `FetchWindow`. Eleven requests in one
session — one login, one get-letters list call, and ten poqa detail calls,
one per letter. The N+1 detail fan-out is the connector's under ADR-007
decision 2, and this run is the first time that unbounded fan-out was
exercised against a live platform rather than argued about.

## Result

```text
authenticate          ok
rows                  10
schema_valid          10/10
date_kinds            platform_instant
instant_lengths       24
instant_ends_z        10
logical_calls         get-letters
captured_at_distinct  1
link_count_present    0
body_len              min=326 max=2915
```

## Established

**All ten rows validated against the `Message` concept imported from
`packages/core`, not against a local copy.**

**Every emitted date was a `PlatformInstant`.** All ten instants were
24 characters and all ten ended in Z, which is the form ADR-006 bet on.
This is what resolved gap G22 for the observed producer.

**`link_count` was present on zero rows.** The connector omits it
deliberately: no Schulmanager evidence backs a link column, and absence is a
true statement where 0 would be a false one.

**One distinct `captured_at` for the whole fetch rather than one per detail
call.**

**`logical_call` was `get-letters` on every row, per ADR-007 decision 5.**

**Body lengths ranged from 326 to 2915 characters.** The body is the detail
response's text held verbatim, with HTML and entities intact — presentation
is a consumer concern.

## Not established

- `DayOnly`, the other branch of `Message.date`, was not exercised. No
  connector emits it.
- Ten letters from one institution are one tenant's evidence. Nothing here
  generalises to another Schulmanager instance.
- A basic-offset instant was not observed rather than disproved. G22 is
  resolved for the observed producer only.
- No partial failure occurred, so ADR-007 decision 3's rule — that one
  failed detail request costs the whole batch — ran unexercised.
- Provenance, plainly: the runner wrote nothing, so no committed artifact in
  this repository holds its raw output. These are the derived facts as
  printed, which is weaker provenance than a capture.
