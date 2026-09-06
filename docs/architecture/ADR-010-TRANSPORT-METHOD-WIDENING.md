# ADR-010 — Transport method widening

**Date:** 2026-09-06
**Status:** Proposed
**Supersedes:** nothing
**Related:** ADR-003 (connector runtime contract — decision 2 defines the
Transport and its string bodies), `packages/core/src/connector/transport.ts`,
`packages/connectors/dieschulapp/`

---

## Context

ADR-003 decision 2 defines the `Transport` as one that takes string bodies,
and its `HttpRequest` carries a `method`. That `HttpMethod` has been
`"GET" | "POST"` since it was written, which covered the two connectors that
existed.

DieSchulApp's login is `PUT /api/1.0/admin/login/` with a JSON body —
evidenced in the committed capture at `fixtures/dieschulapp/variant-001/`,
in the private connector, and in the probe runs recorded in
`docs/evidence/DIESCHULAPP_TIMETABLE_STRUCTURE.md`. The connector was written
against that evidence and it therefore does not typecheck against the
contract: its request literally names a method the union does not contain.

The way this surfaced is worth recording plainly: the package's tests passed
while the typecheck failed. Vitest transpiles without type-checking, so the
union's silence about `PUT` cost nothing at test time; the failure surfaced
only when `pnpm typecheck` was run against the package.

## Decision

### 1. `HttpMethod` widens to `"GET" | "POST" | "PUT"`

The `HttpMethod` in `packages/core/src/connector/transport.ts` gains `"PUT"`
as a member of the union.

**Reason:** the platform's login method is a fact, not a preference. A
connector cannot express it under the current type, and the alternatives are
all worse — see the Alternatives section below. The widening is a superset.

**Consequence:** one line in `transport.ts`. Every existing connector and
every existing `HttpRequest` stays valid. No test changes, no schema change,
no regenerated artifact.

### 2. `ProvenanceEnvelope`'s `request.method` enum does NOT widen

The envelope's `request.method` in `packages/core/src/schema.ts` stays
`["GET", "POST"]`.

**Reason:** the envelope records the call that established a row's identity,
and for this connector that is the `GET` current-timetable call, not the
login. No envelope in the corpus records a `PUT`. Widening a pinned field
with no producer is inventing, which is the error the project's own method
exists to prevent.

**Consequence:** the two surfaces now differ deliberately — a connector may
SEND a `PUT` and no envelope may RECORD one. That asymmetry is the cost,
stated plainly, and it becomes a question the first time a connector needs to
record a PUT-established row.

This is the third core widening a real connector has forced.
`ProvenanceEnvelope.allowlist_version` became optional because a live
connector has no allowlist; `request.method` went from a `GET` literal to the
`GET`/`POST` enum because Schulmanager's calls are `POST`; and now
`HttpMethod` gains `PUT`. Each was a superset, each was forced by a platform
rather than anticipated, and each is evidence for the project's rule that the
contract widens on evidence and never ahead of it.

## Alternatives considered

- (a) Use `POST` for the login. Rejected: it asserts a method the evidence
  does not record, and would probably fail against the platform.
- (b) Give the connector an escape hatch — an untyped method field or a cast.
  Rejected: it makes the contract decorative at exactly the point it is meant
  to constrain, and hides the finding from the next connector author.
- (c) Widen both surfaces at once. Rejected: see decision 2.

## Consequences

- The only code change is the `HttpMethod` union and its comment in
  `packages/core/src/connector/transport.ts`; nothing else in that file
  moves, `packages/core/src/schema.ts` is untouched, and
  `packages/core/schema/normalized-schema-0.1.json` is not regenerated — the
  pin does not move, because the pin is over the schema definitions, which
  this ADR does not touch.
- Every previously valid `HttpRequest` stays valid; the widening is a
  superset, and the connectors that existed are unchanged by it.
- The DieSchulApp connector in `packages/connectors/dieschulapp/` now
  typechecks against the contract: its login names a method the union
  contains, and its envelope — which records the `GET` call, per decision 2 —
  was always valid.
- The tests did not change and are not the evidence for this widening. They
  passed before the change and pass after it; it is the typecheck that
  records the widening, which is the ordering of the two gates that this
  ADR's context exists to explain.

## Not decided by this ADR

- Whether other methods (`PATCH`, `DELETE`) belong. No platform in the
  corpus evidences one; they are added when one does.
- Whether the envelope's `method` enum should eventually track `HttpMethod`.
  Decision 2 records the present position only.
- Whether a gap register entry records the send/record asymmetry.
  Deliberately left to the maintainer rather than assumed.
