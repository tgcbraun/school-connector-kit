# ADR-004 — Capture request identity

**Date:** 2026-08-31
**Status:** Accepted
**Supersedes:** nothing
**Related:** ADR-002 (HTML structural capture — §9 fail-closed), ADR-003 (connector runtime contract), `tools/capture` (`capture-file.ts`, `redactor.ts`, `cli.ts`), private evidence, not published (the Schulmanager request-identity reads this ADR is drawn from; the facts it relies on are restated in Context below)

---

## Context

Three platforms have been captured — WebUntis, DieSchulApp, Kikom — and in all
three a request is identified by where it goes: `url_template` + `method` +
`status` is enough to say which call a fixture records.

Schulmanager is not shaped that way. Reading the private connector established
that `POST /api/calls` is an RPC tunnel: each element of the request body's
`requests[]` carries a module name and an endpoint name, and `endpointName:
"poqa"` takes a model name, an action and an ORM include-tree as parameters.
The URL is constant across every logical call. Fetching letters, fetching one
letter's detail, and reading a mailing setting all serialize as `POST
/api/calls` with status 200, differing only in the request body.

Two further facts matter. Results correlate to requests **by position only** —
nothing in a result echoes the request that produced it — so a captured
response is not self-describing. And the distinguishing information is not
merely mis-keyed: `CaptureRequest` carries `method`, `urlTemplate`, `status`
and `redaction`, with **no request-body field at all**.

This ADR decides how a capture says which logical call it records.

## Decision

### 1. `CaptureRequest` gains an optional platform-scoped `logical_call`

An opaque caller-supplied identifier, meaningful only within its platform.
Schulmanager captures pass `get-letters`, `letter-detail`, and so on. The
identity key becomes `url_template` + `method` + `status` + `logical_call`.

**Reason:** the alternative was a structural field pair mirroring the RPC shape
(`module` + `endpoint`). That encodes one platform's vocabulary into a format
shared by four. The next tunnel-shaped platform will not carry `moduleName` and
`endpointName`; it will carry something else, and the fields become misnamed or
unused. An opaque identifier costs one grammar rule and survives that.

**Consequence:** the field is not comparable across platforms and must not be
used as a cross-platform join key. It names a call within one platform's
vocabulary and nothing more.

### 2. The field is optional; absent means the URL identifies the call

WebUntis, DieSchulApp and Kikom have no logical call beyond their URL. Absence
is a true statement about those platforms, not a missing value.

**Reason:** requiring the field would force a value to be invented for three
committed fixtures, and an invented identifier is exactly the kind of
plausible-but-unevidenced content §48.4 struck from ADR-003.

**Consequence:** the three committed fixtures are unaffected — no rewrite, no
migration, no `capture_format` bump. A reader encountering a capture without
the field learns that the platform identifies calls by URL.

### 3. The value is caller-supplied and never derived from the payload

`logical_call` is a CLI flag, on the same footing as `--url-template` and
`--method`. Nothing reads it out of the decoded response.

**Reason:** deriving it would mean promoting body values — module and endpoint
names — through the Redactor as structural metadata, which requires an
exemption in a deny-by-default component whose entire posture is that values do
not survive. The flag makes the exemption unnecessary rather than arguing for
it.

**Consequence:** the value's correctness is the operator's responsibility, as
`--url-template`'s already is. A capture can be mislabelled; it cannot be
mislabelled *by the payload*.

### 4. Grammar in the CLI, non-empty-string in the model

`cli.ts` validates the identifier against a safe grammar alongside
`validateUrlTemplate`. `capture-file.ts` checks only that it is a non-empty
string when present, and passes it through.

**Reason:** this is the division the components already have. `CaptureFile`
documents that it never inspects or derives URLs; the CLI owns the template
grammar. The test fixtures' absolute URLs exercise that pass-through
deliberately. A new field validated differently would be a second pattern for
no gain.

**Consequence:** the model accepts identifiers its own CLI would reject, by
design. The grammar is pinned by CLI tests, not by model tests.

### 5. One capture per logical call

An operator saves each logical call's decoded response to its own file and runs
one capture per file. The envelope arrays `requests[]` / `results[]` are never
traversed by the capture tooling.

**Reason:** the format-1 CLI already works this way — it rejects a repeated
`--input` and writes a single-element `requests` array, so a multi-entry
format-1 envelope has never been produced. Two properties of the tooling make
traversing an envelope actively wrong: the Redactor samples arrays at three
elements, which would silently truncate sub-requests four and up; and allowlist
rules are path-keyed, so every element of `requests[]` normalizes to one path
and heterogeneous elements collapse to a single deny-by-default decision.

**Consequence:** this is ADR-002 §9's fail-closed rule gaining a format-1
analogue — one capture per logical call, as one capture per selector profile in
format 2. The same gate, now stated for both formats.

### 6. The recorded status remains the HTTP status; the per-result axis is open

`status` continues to mean the envelope's HTTP status.

**Reason:** no source read so far carries evidence of a mixed-status envelope.
The private connector raises on any non-200 result, which is a fact about that
code rather than about the wire, and no Schulmanager capture exists. Specifying
a representation now would be specifying against an imagined wire format.

**Consequence:** recorded as an open consequence, not a prerequisite. Under
decision 5 no envelope is represented whole, so the model has no per-result
status axis to specify and this ADR is not blocked on one. When a mixed-status
envelope is observed, this decision is the one to revisit.

## Consequences

- Three committed fixtures are unchanged; no format bump.
- `tools/capture` changes in four files: the model, the CLI, and both test
  suites. The change is additive — no existing field moves.
- Schulmanager capture is unblocked once this is accepted and implemented.
  §54.5's gate closes.
- Gap register: this does not bind G9. Only a connector running against real
  data does that (§42).
- The privacy note at §54.4 is untouched. The login response carrying
  children's first names remains the highest-sensitivity response in the
  corpus, and its allowlist still needs care beyond the other three.

## Not decided by this ADR

- Which platform the first OSS connector targets.
- Whether ADR-003's fetcher signature accommodates the N+1 letters fetch —
  evidence exists, the decision does not.
- Whether `poqa` include-trees vary in shape across calls to the same model.
- Whether token rotation occurs on the auth endpoints; only the data endpoint
  was read for it.
