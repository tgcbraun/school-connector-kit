# WebUntis connector — first live run

Status: derived facts only. No tenant host, no school identifier, no session
id, no credential, no homework text, no record identifier, and no response
value appears here.

## What was run

The published WebUntis connector (`packages/connectors/webuntis`), built
from source, driven by a private throwaway runner against a live WebUntis
instance. The runner supplied the ADR-003 capability trio: a `Transport`
backed by the host runtime's HTTP client with its own cookie jar, a `Clock`,
and a `Logger`. The runner is private, git-ignored, writes no files, and
prints derived facts only.

`sourceInstance` was set to an opaque local label rather than the school
selector. The connector does not decide whether the normalized stream
carries a real tenant identifier; the caller does.

Requested window: 2026-08-25 .. 2026-09-15, both bounds inclusive as passed.

## Result

```text
authenticate ok      cookies_held=3
rows                 12
schema_valid         12/12
date_int             min=20260820 max=20260907 digit_lengths=8
lesson_id_present    12
remark_present       12
remark_empty         12
completed_true       3
```

## Established

**G9 is bound.** Twelve live rows mapped by the connector validate against
the committed `Assignment` schema without exception. Before this run the
connector's tests validated mapped output against the schema using payloads
hand-written to the fixture's shape — structure real, values invented. This
is the first validation of schema 0.1 against values a platform actually
emitted.

**G6 is resolved.** Every observed `PlatformDateInt` value is eight digits
and consistent with a `YYYYMMDD` calendar encoding.

**The window filters on `dueDate`, confirmed live.** The minimum observed
reference date precedes the requested window's start, while every due date
falls inside it. This reproduces the two-capture finding of
WEBUNTIS_HOMEWORK_DATE_SEMANTICS.md against a live connector rather than
against stored captures.

**The connector's authenticate shape is accepted by a real instance.** It
sends a fixed `client` value and sets no `User-Agent`; authentication
succeeded regardless.

## Not established

- One tenant, one endpoint, one window. Nothing here generalises to another
  WebUntis instance or to any other endpoint.
- `PlatformDateInt` is **not** narrowed to `YYYYMMDD` in the schema. WebUntis
  is the only platform in the corpus emitting this date form, so narrowing a
  shared form on a single platform's encoding would be the collapse the
  four-form date model exists to prevent. The finding is recorded here; the
  schema is unchanged. Revisit if a second platform emits an integer date.
- Every row carried `remark` as the empty string. The connector's rule —
  copy `remark` verbatim when present and a string, including the empty
  string, so the absent case stays distinguishable from the empty one — is
  therefore correct but still unexercised on its absent branch.
- `attachments` remains unobserved in shape and is still not handled.

## A defect in the runner, recorded

The runner reported a `dueDate − date` delta computed by subtracting the two
date integers numerically. Across a month boundary that arithmetic is
meaningless: subtracting two `YYYYMMDD` integers spanning a month change
yields values far larger than the true day count. The deltas it printed are
not day gaps and must not be read as a distribution.

This is the arithmetic the connector itself deliberately refuses to perform —
it converts a window by removing hyphens and does nothing else. The runner
reintroduced it. The gap distribution of
WEBUNTIS_HOMEWORK_DATE_SEMANTICS.md is unaffected: it was derived from
captures by a separate analyser and is not restated or revised here.
