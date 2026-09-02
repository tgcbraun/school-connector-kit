# ADR-005 — Connector Construction Seam

**Date:** 2026-09-02
**Status:** Accepted
**Supersedes:** nothing
**Related:** ADR-003 (connector runtime contract), ADR-004 (capture request identity), `packages/connectors/webuntis` (the first connector, which invented this seam), `docs/evidence/WEBUNTIS_LIVE_CONNECTOR_RUN.md` (the run that proved it)

---

## Context

ADR-003 defines what a connector *receives at runtime* — the transport, clock and logger trio — and what it *implements*: `platform`, `fetchers`, and `authenticate(credentials)`. It defines no way to construct one.

That gap is not theoretical. A connector needs a base URL, a platform-specific tenant selector, and a tenant identity to stamp into every provenance envelope. None of the three is a credential, so none belongs in `authenticate`. None is runtime capability, so none belongs in `ConnectorRuntime`.

The first connector resolved this by inventing a factory — `createWebUntisConnector(runtime, config)` with `WebUntisConfig { baseUrl, school, sourceInstance }` — and then ran successfully against a live platform in that shape. ADR-003 does not forbid it, so it is not an amendment; it is an unspecified seam that one connector filled and every connector after it will copy. This ADR records the shape before it is copied by imitation rather than by decision.

---

## Decision

### 1. A connector is constructed by a named exported factory

`create<Platform>Connector(runtime, config)`, runtime first, returning `Connector`. Not a class, not a bare object literal, not a default export.

**Reason:** the factory closes over both the runtime and the configuration, so every request the connector builds has them without either becoming ambient or being threaded through each fetcher's parameters. A class adds an instance surface the contract has no use for; a default export loses the platform name at the call site, where a host wiring several connectors most needs it.

**Consequence:** `Connector` remains the only type a host has to know. The factory's return type is `Connector` itself, not a platform-specific subtype, so a host holding a heterogeneous set of connectors is holding one type.

### 2. Configuration and credentials are separate seams

Configuration is passed once, at construction. Credentials are passed only to `authenticate`, and are never held in configuration.

**Reason:** they have different lifetimes and different disclosure risk. Configuration addresses an instance; credentials authorise against it. A host may reasonably hold configuration in plain application state and must not hold credentials the same way. Collapsing them into one object would make the safe handling of the second the caller's problem to infer.

**Evidence:** the first live run passed `{ user, password }` to `authenticate` and `{ baseUrl, school, sourceInstance }` at construction, and authenticated successfully. The split is not a projection.

### 3. `packages/core` exports a `ConnectorConfig` base carrying `sourceInstance` alone

```ts
export interface ConnectorConfig {
  readonly sourceInstance: string;
}
```

A platform's configuration interface extends it and adds whatever addressing that platform requires.

**Reason:** `ProvenanceEnvelope.source_instance` is a required `string` in schema 0.1, and the envelope is inlined into every concept and every branch of the normalized message. Every record any connector ever emits must carry it. That makes the field universal by the schema's construction, not by generalisation from one connector — which is precisely why it, and nothing else, is in the base.

**What is deliberately not in the base:** `baseUrl` and a platform tenant selector look universal and are not evidenced as such. One connector exists. A base type that guessed at the addressing shape of DieSchulApp, Schulmanager or Kikom would be the same error as narrowing a shared date form to one platform's encoding.

**Recorded limitation:** this is weakly enforcing. No test compels a connector's configuration interface to extend `ConnectorConfig`; a connector that declares `sourceInstance` independently typechecks identically. The base type buys discoverability and a compile-time check for those who opt in, and it is stated here as that rather than as a guarantee.

### 4. `sourceInstance` is distinct from any platform-native tenant selector

WebUntis carries `school` in its authentication URL. `sourceInstance` is a separate field and is never derived from it.

**Reason:** gap G3 exists because tenant identity was dropped from every fixture by the allowlists, so schema 0.1 carries it as an opaque string. A live connector *has* the real identity. Whether the normalized stream should carry the platform's own school identifier or an opaque local label is a disclosure decision belonging to the caller, and a connector that derived one from the other would take that decision away silently.

**Evidence:** the first live run set `sourceInstance` to an opaque local label while `school` carried the platform's real selector. Both reached the places they were meant to reach, and the tenant identifier appeared in no output.

### 5. Configuration carries addressing and identity only

No credentials, no capability flags, no behavioural switches. Configuration values are never passed to the logger and never interpolated into a `ConnectorError` message.

**Reason:** capability is derived from the fetcher keys (ADR-003 decision 6) and a configuration flag that turned a fetcher on or off would reintroduce exactly the second source of truth that decision removes. The logging and error rules follow ADR-003 decisions 5 and the error contract: a base URL and a tenant selector identify a real school, and the reasons those channels carry no values apply to configuration for the same reason they apply to responses.

---

## Consequences

**Positive.** A second connector has a shape to copy that was argued rather than imitated. A host wiring several connectors writes the same call shape for each and holds one type.

**Negative.** The base type is thin enough that its value is mostly documentary, and a connector may ignore it without failing anything. Configuration is fixed at construction, so a host that must address two instances of the same platform constructs two connectors.

**Deferred.** Whether an addressing field beyond `sourceInstance` is universal enough to enter the base — reconsider when a second connector exists. Whether any connector needs configuration it cannot receive at construction time.

---

## What the evidence could not settle

- **Whether this shape suits a platform whose addressing is not a base URL plus a selector.** One connector has been built and run. Kikom's signed-URL requirement and Schulmanager's request identity are both known to differ in ways this ADR has not been tested against.
- **Whether constructing one connector per instance is the right granularity.** No host in this repository yet wires more than one.
