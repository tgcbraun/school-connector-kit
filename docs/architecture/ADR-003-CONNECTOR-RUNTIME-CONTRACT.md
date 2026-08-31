# ADR-003 — Connector Runtime Contract

**Date:** 2026-08-31
**Status:** Accepted
**Supersedes:** nothing
**Related:** ADR-001 (local-first TypeScript), ADR-002 (HTML structural capture), `packages/core` (the fixture corpus this contract consumes), `packages/core/README.md` (gaps G6, G9–G14)

---

## Context

`packages/core` now carries schema `0.1` — the normalized concepts the capture corpus established across WebUntis, DieSchulApp, and Kikom — but nothing that runs a platform. The next step is the first connector implementation, and the platform it targets (WebUntis, per the fixture corpus's strongest structural evidence) will be consumed in two places this repository does not control: a React Native application under Hermes, and an embedded JavaScript engine hosted by a Flutter application.

Those are the host environments, and they are the constraint. Neither provides Node, neither provides the browser, and both sit behind a bridge with another language (C++/Dart) that must receive and send values. A contract written against whichever ambient runtime the author of the day has at hand will be the contract that breaks on the first host that lacks it.

This ADR defines the runtime contract a connector implements against: the capability interface (`Connector`), the runtime trio it receives by injection (transport, clock, logger), the error model, and the request shape. It is deliberately a contract of *received* capability, not *ambient* environment.

---

## Decision

### 1. Connectors receive all capability by injection; no Node built-ins, no DOM

A connector is code that takes `Transport`, `Clock`, and `Logger` as arguments. It may not import `node:` modules, may not reference `window`, `document`, `localStorage`, `navigator`, `Buffer`, `process`, `__dirname`, or `__filename`, and may not assume `fetch`.

**Reason:** the same connector artifact must run under Hermes inside a React Native application and inside an embedded JS engine hosted by a Flutter application. Hermes does not provide Node built-ins and does not provide the browser; the Flutter-embedded engine provides neither. The only environment every host guarantees is the engine itself plus whatever it injects.

**Consequence:** this is a hard portability rule, not a style preference. A Vitest scan enforces it on every test run rather than by review discipline; its scope is the transitive import closure of the package entry point (decision 9), so nothing that ships into a host bundle can slip through.

### 2. `Transport` uses string bodies, not WHATWG `fetch`

The request and response types carry `method`, `url`, string-keyed headers, and a string `body`. There is no `Request`/`Response` object, no `ReadableStream`, no `Body` mixin.

**Reason:** streams and Response objects do not marshal across a JS-to-Dart bridge. The Flutter host speaks in primitives and UTF-8 strings, and any contract built on `fetch`'s object model cannot be implemented by that host without a lossy adapter. A string body is the lowest common denominator the hosts actually provide; the size ceiling that implies is a host concern, not a contract concern at this stage.

**Consequence:** binary response bodies are out of scope at this stage (gap G10). A connector that needs binary content cannot express it in this contract; that is a deliberate deferred capability, not an oversight.

### 3. The `Transport` is session-scoped and owns cookie persistence; connectors never touch the `Cookie` / `Set-Cookie` headers

**State explicitly:** this is a portability rule adopted so that no connector depends on `Set-Cookie` being readable from JavaScript, and the underlying platform behaviour has NOT been verified in this repository. What is certain is that the two hosts are different enough in how their networking layers surface session traffic that assuming one behaviour is unsafe in the other; what is not established is what either one actually does. The rule removes the dependence rather than betting on the unverified answer.

The contract makes the rule executable: `assertNoCookieHeaders` throws a `ConnectorError` with a fixed message if a connector-built request carries a key that folds to `cookie` or `set-cookie`, and the thrown message contains neither the key nor any value.

**Consequence:** session state is the transport host's responsibility, end to end. A connector cannot read its own session back from the response headers, because the contract exists to guarantee it never has to.

### 4. `Clock` returns epoch milliseconds, not `Date`

`Clock.now(): number` — epoch milliseconds, UTC.

**Reason:** a `Date` object is another object that must cross the bridge, and it carries more state than the contract needs. A number is the marshalling-trivial form, and it makes tests deterministic: a test supplies a fixed number and every code path that reads the clock observes exactly that number, with no timezone-dependent object construction anywhere in between.

### 5. `Logger` fields are restricted to `number` and `boolean`

`debug(event: string, fields?: LogFields)` with `LogFields = Readonly<Record<string, number | boolean>>`. The event name is a string the connector chose; the fields are not.

**Reason:** a logger that accepts arbitrary values is a logger that logs values — identifiers, row contents, session material — whatever the caller passes. Restricting the value domain so that *no value can be logged* is the strong form of the same rule the capture corpus applies: names and counts are structural, values are the thing this project declines to publish.

**Recorded cost:** no string context is available. A connector author debugging will find the field set thin; an enumerated channel can be added later if evidence requires it. That deferral is stated now so the absence is read as a decision and not a draft.

### 6. Capabilities are derived from the fetcher keys, not declared

`Connector` declares `platform` and `fetchers`; a `capabilitiesOf(connector)` helper returns exactly the fetcher keys that hold a function, in deterministic code-point order. There is no separate `capabilities` list on the interface.

**Reason:** a declared list cannot desync from the implemented fetchers when it is computed from them. Every other design shape for this — a self-declared array, a constant map, a generated list — creates a second source of truth with a drift mode, and drift in "which capabilities does this connector have" is exactly the kind of silent misstatement a normalized stream must not carry.

**Consequence:** a partial connector is a legal connector; a fetcher map with a non-function value under a key is also legal input, and the derivation simply excludes it.

### 7. `FetchWindow` is `YYYY-MM-DD` and is a request parameter only

`FetchRequest` carries an optional `window` with `fromInclusive` / `toInclusive` day strings. Both are day-resolution calendar dates chosen by the caller, and the contract says what they are *for*: asking a platform for the records it holds in a range.

**State explicitly:** these must not be confused with the four record date forms of schema `0.1` — `PlatformDateInt`, `WeekdaySlot`, `PartialDay`, `DayOnly`. They are not one of them, they carry none of their provenance (`PartialDay`'s inferred-year anchor, `DayOnly`'s two-digit-year provenance, `WeekdaySlot`'s out-of-band week anchor), and nothing in the contract converts one way or the other. Translating a requested window into the platform's own encoding is the connector's responsibility, against the platform's own evidence (e.g. the WebUntis date-integer fields' encoding remains gap G6).

**Evidence that a window is needed at all:** the WebUntis finding that the homework request filters on the due-date field. The capture shows the platform's own request being scoped by a due-date range; a normalized contract with no way to ask for a range would have no way to express what the platform demonstrably supports.

### 8. Binary response bodies are out of scope at this stage

String bodies only, in both directions. This is listed as a decision and not merely a note because it closes a question that will otherwise be asked per-connector.

**Recorded gap:** G10.

### 9. The no-Node/no-DOM rule is enforced over the entry point's import closure, not a source directory

The enforcing scan starts at `packages/core/src/index.ts` and walks the transitive import closure: relative import/export-from specifiers are followed (a `./x.js` specifier resolves to the sibling `./x.ts` source), bare specifiers are not, `node_modules` is never descended, and each file is visited once. The rule then fails if **any file in the closure** imports a specifier beginning `node:` or references one of the enumerated globals. There is no directory list and no exclusion list.

**State explicitly:** build-time modules (`document.ts`, `generate-json-schema.ts`) are out of scope **by being unreachable from the entry point, not by being named.** Nothing reachable from the package entry point may use Node built-ins or DOM globals, because that closure is what a React Native or Flutter-hosted bundle loads; an exclusion list that is maintained by hand can drift, a closure derived from the barrel cannot.

**Consequence:** "is this module shippable?" is answered by construction, per commit, instead of by convention. A future refactor that makes a build-time module reachable from the entry point immediately fails the scan at exactly the moment it becomes a portability defect — and the same mechanism would catch a newly added runtime module that touches the DOM, with no list to remember to update.

### 10. The entry point does not export the schema-document builder

`src/index.ts` re-exports the schema and the connector contract, and nothing else. It does not export `document.ts` (`buildDocument`, `canonicalJson`, `zodVersion`), and it does not export `generate-json-schema.ts`.

**Reason:** `document.ts` reads the Zod version through `node:module` at import time; re-exporting it from the entry point places `node:module` into the import graph of every mobile consumer of this package, on exactly the hosts whose absence of Node is what this contract exists to respect (decision 1).

**Consequence:** consumers that need the document builder or the JSON-Schema writer (the pin test, the `generate-schema` script) import those build-time modules directly, where Node is expected; the public entry stays shippable by construction. The mixing of shippable and build-time modules in one source tree is recorded as gap G13 and is not papered over.

---

## Consequences

**Positive.** The first connector can be written against a contract that says what it receives rather than what it may assume, and the assumption set is enforceable by a test rather than by review. The two host platforms become implementation details of the `Transport`, not defects of the connector.

**Negative.** String bodies are the size of a bridge message; a large response is a host-side problem the contract no longer hides behind an object model. The logger cannot carry string context at all.

**What a contributor must now write** (a working connector against this contract, in `packages/` when it arrives):

- a `Transport` for the host it targets, owning the session and the cookies, returning string bodies;
- a `Clock` and a `Logger` the host provides;
- a `Connector` object: `platform`, `authenticate` (fixed-message `ConnectorError`s for the failure codes the platform actually produces), and one `fetchers` entry per capability it implements, each returning `Promise<readonly unknown[]>` at this stage (binding to the schema concepts is gap G9, and needs this real connector to justify it);
- a use of `assertNoCookieHeaders` at the boundary where connector-built requests enter the transport, so the session rule is checked at the door.

**Deferred.** Fetcher return types bound to schema `0.1` concepts (G9). Binary response bodies (G10). Additional `FetchRequest` parameters — `window` is the only one with capture evidence (G11).

---

## What the evidence could not settle

- **The two hosts' actual session-cookie behaviour.** Whether `Set-Cookie` is readable from JavaScript in either host is not established in this repository. Decision 3 is written so that the answer does not matter; it is recorded here so that a future reader does not mistake the rule's safety for a verified fact about either host.
- **The WebUntis date-integer encoding.** The window decision cites the due-date range as *evidence that a window is needed*; it does not cite it as evidence of any integer encoding, which remains gap G6 in `packages/core`.
