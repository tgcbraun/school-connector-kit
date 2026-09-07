# WebUntis live run — the Transport's first production caller

Status: derived facts only. The run targeted a live school platform; no
credential, no cookie value, no session id, and no platform message text
appear here.

## Question

`packages/transport` shipped with fourteen tests and no production
caller. The project's own record has carried the argument across three
revisions that the first consumer is what proves a package consumable: a
package can be green for its entire life while emitting a surface no
consumer could use, and only a second package finds it. The three throwaway runners each
rolled their own transport inline. This run is the package's first
production caller.

## Method

A second runner, `private-fixtures/webuntis/run_live_transport.mjs`,
git-ignored, identical to the existing `run_live.mjs` except that it
obtains its Transport from the published package rather than rolling one
inline. The existing runner was left unmodified so the two could be
compared on the same window. The runner cannot observe the cookie jar:
ADR-011 decision 1 makes it private to the Transport, and the runner
records that inaccessibility rather than reaching around it.

## A resolution finding, before any credential was used

The package's exports map resolves to `./dist/index.js`, so
`packages/core`, `packages/transport` and `packages/connectors/webuntis`
must all be built before a consumer can import it. An import check with no
credentials confirmed the entry point resolves and exports exactly
`createFetchTransport`. That is half the consumability question answered
without a login.

## A diagnostic finding, recorded because it cost two runs

The first two live attempts failed with the connector's `auth_failed`
code. The connector raises that same code for five distinct conditions —
non-string credentials, a non-200 status, an unparseable body, a body
without an object result, and a result without a session id — so its
output could not distinguish a wrong credential from a wrong configuration
value. A probe issuing one authentication request and reporting the
response's SHAPE (`private-fixtures/webuntis/probe_auth_shape.mjs`)
established the cause immediately: HTTP 404 with JSON-RPC error code
-8500, invalid school name. The credentials were never at fault and were
never tested by those two attempts. Recorded as G29 in the gap register.

## Result

With the school parameter corrected, run against a one-month window:

```text
authenticate ok transport=package jar=private
session_survived_fetch=true
rows=11
schema_valid=11/11
date_int digit_lengths=8
date_int_consistent_with_YYYYMMDD=true
lesson_id_present=11 remark_present=11 remark_empty=11 completed_true=3
```

## What it establishes

**The published Transport authenticates and holds a session across a second request against a real platform.** The server sets three cookies in one step, and the connector, which may not touch them under ADR-003 decision 3, never saw them.

**The package is consumable from outside itself.** Import resolution, factory call, and contract satisfaction all hold. The first-consumer argument is discharged.

**G9 binds a third time.** Eleven rows, all schema-valid against the committed contract.

**G6 holds.** Eight-digit values consistent with YYYYMMDD.

## Limits

- **Node supplies `Headers.getSetCookie`.** This run exercised the correct accessor and NOT the Hermes fallback; the fallback's behaviour against a real platform remains untested on a device.
- **One tenant, one window, one platform.**
- **The due-minus-reference delta must not be read as a distribution.** The runner reports it computed by subtracting YYYYMMDD integers; those values are not day gaps across a month boundary. That is a known defect inherited from `run_live.mjs`, and the figure is omitted from this document for that reason.
