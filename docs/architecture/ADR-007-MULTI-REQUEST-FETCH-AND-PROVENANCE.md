# ADR-007 — Multi-request fetch and provenance

**Date:** 2026-09-05
**Status:** Accepted
**Supersedes:** nothing
**Related:** ADR-003 (connector runtime contract), ADR-004 (capture request identity — this ADR closes its open item "whether ADR-003's fetcher signature accommodates the N+1 letters fetch"), ADR-006 (platform-supplied instants), `packages/core/src/connector/connector.ts`, `packages/core/src/schema.ts`

---

## Context

Schulmanager's letters path fetches a list, then issues one detail request
per letter. The letter body is the field `text` and appears only in the
detail response — the list response carries no letter body — so a Message
cannot be built from the list call alone.

ADR-004 and ADR-006 both list the fetcher-signature question as not decided,
phrased as whether the signature accommodates the N+1 fetch. That framing is
wrong. `ConnectorFetchers` declares
`(request: FetchRequest) => Promise<readonly unknown[]>`: it constrains what
a fetcher returns, not how many requests it issues. `Transport` declares a
single method `send(request)` and is session-scoped, held in the connector's
closure under ADR-005's factory. Nothing in the contract limits a fetcher to
one `send`, and the WebUntis connector already issues two in one session —
authenticate, then the lessons fetch. The signature already accommodates the
N+1 letters fetch.

What is actually unresolved is fan-out control, partial failure, and
provenance. `FetchWindow` is the only request-side parameter of
`FetchRequest`, and Schulmanager accepts no server-side window, so there is
no contract-level lever on the number of detail requests. A fetcher returns
a bare array with no per-row error slot, and ADR-003's log fields are
restricted to `number | boolean`, so a failed detail request has no channel
to name which row failed. And `ProvenanceEnvelope.request` names exactly one
request — method, status, `url_template`, and an optional index — while an
N+1 row derives from two.

Every Schulmanager call is `POST /api/calls`; the URL does not distinguish
logical calls. ADR-004 solved this for captures with `logical_call` on
`CaptureRequest`, but that field exists only in the capture model. The
normalized envelope has no counterpart, so a Schulmanager row's provenance
reads `POST /api/calls` and cannot say which logical call produced it.

This ADR decides what the contract does and does not do about each of these,
and what the normalized envelope gains.

## Decision

### 1. The fetcher signature accommodates multiple requests; ADR-004's and ADR-006's open item is closed as mis-framed

Nothing in `packages/core/src/connector/` is asked to forbid or to permit
multi-request fetches: it already does neither, and both ADRs' question
presupposes a signature limitation that is not there.

**Reason:** the contract constrains what a fetcher returns, not how many
requests it issues; the transport is session-scoped and closure-held, and an
existing connector already sends twice in one session.

**Consequence:** no change to `connector.ts` or `transport.ts`. The register
entry G21 stops describing a signature limitation.

### 2. Fan-out is bounded by the connector, not by the contract

`FetchWindow` is the only request-side parameter, and Schulmanager accepts
no server-side window, so no contract-level lever exists or is added. The
connector decides its own bound and documents it.

**Reason:** adding a request-side budget field to `FetchRequest` would
generalise one platform's fetch shape into a contract shared by four — the
error ADR-005 decision 3 avoided by giving `ConnectorConfig` exactly one
field. ADR-004 decision 5 is the nearer precedent: the capture tooling
refused to traverse an envelope and took one call per file instead.

**Consequence:** two connectors may bound differently, and the contract
cannot compare them. Recorded as a cost. The contract also supplies no
cancellation seam: `HttpRequest` carries `method`, `url`, `headers` and
an optional `body`, and `Transport` declares a single `send(request)`
returning a promise, so a fetch that has fanned out cannot be
interrupted by its host. This matters most for the mobile hosts ADR-003
is written for, and adding cancellation later is a change to the
contract's request type rather than to any connector.

### 3. Partial failure is not representable, and this ADR does not invent a representation

A fetcher returns a bare array with no per-row error slot, so one failed
detail request costs either the whole batch or a silent drop, and ADR-003's
`number | boolean` log fields cannot name which row failed. This ADR adds
neither a per-row error slot nor a logging channel.

**Reason:** the platform supplies a per-result status slot — a `status`
field on every element of the `/api/calls` response's `results[]`,
present in all four committed Schulmanager captures — and that slot is
observed, but no capture exhibits a failure value in it, so the failure's
shape and the connector's correct response to it are both unevidenced.
Specifying a representation now would be specifying against an imagined
failure rather than an imagined wire format. This is ADR-004 decision 6's
reasoning applied to a second axis.

**Consequence:** the first connector to meet a partial failure decides, and
that decision is the evidence this question needs.

### 4. `ProvenanceEnvelope.request` gains an optional `logical_call`

An optional, non-empty string: platform-scoped, opaque, caller-supplied, and
explicitly NOT a cross-platform join key — inheriting ADR-004 decision 1's
consequence unchanged. Optional, so absence means the URL identifies the
call, and every existing envelope stays valid.

**Reason:** without it a Schulmanager row's provenance reads POST
`/api/calls` and says nothing more. The alternative — a second request slot
on the envelope for the detail call — generalises one platform's fetch
shape into a field every concept carries, which is the error ADR-005
decision 3 avoided.

Unlike `request.index`, which records a request's position inside the
capture's `requests[]` array and which a connector reading live data
therefore cannot populate, `logical_call` is populated by the connector:
a connector that omits it leaves the row's provenance reading `POST
/api/calls`, which is the condition this decision exists to remove.
Absence continues to mean the URL identifies the call, as it does on the
capture side.

A connector's `logical_call` values must match those recorded in the
platform's committed fixture rather than being retyped from the
platform's documentation or invented at the call site, on the precedent
of the WebUntis connector reading its `url_template` from the committed
fixture. For Schulmanager the committed values are `get-letters`,
`letter-mailing-setting` and `letter-detail`.

**Consequence:** the capture model and the normalized envelope now carry the
same field name with different validation owners. On the capture side
ADR-004 decision 4 splits it — grammar in the CLI, non-emptiness in the
model. The normalized side has no CLI, so the Zod schema is the only
validator and pins non-emptiness only. This asymmetry is stated as a cost,
not resolved here.

### 5. An N+1 row's envelope names the request that established the row's identity

For Schulmanager letters that is the list call, not the detail call: the
envelope's `logical_call` names the call whose response supplied the row's
identity fields.

**Reason:** `logical_call` names the logical call that established the
row's identity, not every call that contributed a field to it: the
envelope's identity triple — `source_platform`, `source_instance`,
`source_record_id` — is what provenance is provenance of, and for a
Schulmanager letter that identity comes from the list call. Naming the
detail call would name a call that did not supply the row's identity. This
does not distinguish two rows fetched from one list, and nothing in
`logical_call` is intended to: `source_record_id` does that.

**Consequence:** the envelope under-describes an N+1 row: the body's own
request is not named anywhere. Recorded as a known limit of the singular
envelope, not designed around.

## Consequences

- `packages/core/src/schema.ts` changes in exactly one place: an optional
  non-empty string on `ProvenanceEnvelope.request`. The generated
  `packages/core/schema/normalized-schema-0.1.json` is regenerated from the
  Zod source, never hand-edited.
- The widening is a superset: every previously valid envelope stays valid.
- No connector, capture-tooling, or fixture file changes. `capture_format`
  is a constant in the capture model and is not bumped; the capture
  document and the normalized schema version independently.
- G21 in `packages/core/README.md` is rewritten against this ADR once it is
  accepted.

## Not decided by this ADR

- Whether a connector may issue requests during authenticate beyond the one
  WebUntis issues.
- Whether the per-result status axis of ADR-004 decision 6 is represented.
  Still open, still unevidenced.
- What bound the Schulmanager connector places on its fan-out. A connector
  decision under decision 2.
- Whether `logical_call` values are stable across platform versions.
- Whether the normalized envelope should eventually describe more than one
  request. Decision 5 records the limit; it does not propose a fix.
