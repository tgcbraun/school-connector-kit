# ADR-011 — The published Transport

**Date:** 2026-09-07
**Status:** Proposed
**Supersedes:** nothing
**Related:** ADR-001 (local-first TypeScript — the language bet the
host question belongs to), ADR-003 (connector runtime contract — decision 2
defines the Transport, decision 3 forbids connectors from inspecting
cookies), `packages/core/src/connector/transport.ts`

---

## Context

ADR-003 decision 2 defines the `Transport` interface, and nothing in the
repository implements it. Three connectors now ship — WebUntis, Schulmanager,
DieSchulApp — and three private throwaway runners,
`private-fixtures/webuntis/run_live.mjs`,
`private-fixtures/schulmanager/run_live.mjs`, and
`private-fixtures/dieschulapp/run_live.mjs`, each rolled their own transport.
That is the third data point, and the three disagree with each other in ways
that are decisions rather than style:

- two keep a cookie jar and one does not
- two spell the outgoing header `Cookie` and one `cookie`
- one strips `set-cookie` and `cookie` from the response headers before the
  connector sees them; the other two pass everything through

Each divergence was a local choice; each is something a published Transport
must settle once.

What changed the question is worth stating plainly: the DieSchulApp session
IS a cookie, and ADR-003 decision 3 forbids that connector from inspecting
`Set-Cookie`. Without a jar in the Transport, that connector cannot
authenticate at all. A jar stopped being a convenience and became a
requirement of the contract.

## Decision

### 1. The Transport owns the cookie jar — not the connector, not the caller

**Reason:** ADR-003 decision 3 already forbids connectors from touching
cookies; this makes the corresponding capability exist somewhere. A connector
that needs a session gets one by making requests, not by holding state.

**Consequence:** the jar stops being a per-runner local choice — the two
runners that keep one and the one that does not converge on the same owner —
and the DieSchulApp connector, whose session is the cookie itself, can
authenticate against its platform at all only under this decision.

### 2. The jar's lifetime is the Transport instance

One Transport, one jar. No sharing between instances, no persistence to disk.
Two tenants means two Transports.

**Reason:** no connector asks for a shared or persisted jar; none of the
three runners keeps anything but name and value in memory, and none writes
to disk. Deciding for sharing or persistence would be a decision with no
producer, which is the invention the project's method exists to prevent.

**Consequence:** persistence is a host concern and is not decided here.

### 3. The Transport strips `Set-Cookie` and `Cookie` from the response headers it returns to the connector

**Reason:** ADR-003 decision 3 is at present enforced by connector discipline
alone — the DieSchulApp connector carries a paragraph of module-header prose
explaining that it touches no cookie. A boundary that enforces the rule is
worth more than a rule authors must remember.

**Consequence:** a real cost, and named: the Schulmanager connector rotates
a token via response headers, so the strip must be exactly these two header
names and nothing else. A Transport that stripped broadly would break a
shipped connector.

### 4. Redirects are not followed, recorded as UNEVIDENCED rather than chosen

All three runners set the fetch to manual redirects, and none of them has
ever observed a redirect. The Transport does not follow one and surfaces the
status it was given.

**Reason:** no capture, no runner run, and no other ADR records a redirect
from any of the three platforms, so a rule for following one would be a
decision with no producer — the same invention the project's method exists
to prevent.

**Consequence:** the first platform actually to redirect is the evidence this
decision waits for, at which point it is revisited. The contract widens on
evidence and never ahead of it, which is the same rule ADR-010 records.

## Alternatives considered

- (a) Pass all response headers through and keep ADR-003 decision 3 enforced
  in review rather than at the boundary. Rejected: see decision 3. This is
  the arguable one, and the choice is a deliberate shift from discipline to
  structure.
- (b) Guard the `getSetCookie` call against hosts that lack it. Rejected —
  and the reason is the interesting one: it writes code against a platform
  nobody has run. The method exists and works on the workstation today. If a
  host lacks it, the Hermes probe finds that out and this ADR is amended.
  Guarding now would set the precedent that anticipation is allowed when it
  is cheap, which is the error the project's method exists to prevent.
- (c) Let each connector hold its own session. Rejected: ADR-003 decision 3,
  and it would put the DieSchulApp connector in contradiction with itself.

## Not decided by this ADR

- Host targeting. The Hermes probe's question, and it sits behind this ADR
  because a host has nothing to call without a Transport.
- Cookie attributes — Domain, Path, Secure, expiry. All three runners store
  name and value only and ignore the rest. That is wrong in general and
  adequate for single-origin connectors, which is all three that exist.
  Recorded as a known limitation, not a decision.
- Retries, timeouts, connection reuse. No evidence for any of them.
- Where the implementation lives — `packages/core` or its own package. A
  packaging question, not an architecture one.
- The outgoing header's capitalisation. HTTP header names are
  case-insensitive, so the runners' disagreement is cosmetic; the
  implementation picks one.
