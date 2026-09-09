# School Connector Kit

An open-source toolkit for integrating digital services used by schools in Germany into family dashboards, school aggregators, and other applications.

## Status

Early development.

The privacy-safe capture tooling is complete, and four structurally redacted, fully human-reviewed fixtures are committed, one per platform: WebUntis, Schulmanager Online, DieSchulApp, and KIKOM. The normalized data model is schema 0.1, which is pre-1.0 and breaking changes are still expected. The connector runtime contract is committed and recorded in ADR-003 (`docs/architecture/ADR-003-CONNECTOR-RUNTIME-CONTRACT.md`). Three connectors are implemented and published: WebUntis, Schulmanager Online, and DieSchulApp. Each has been run against live platform data. The host-side Transport that connectors receive is published as `packages/transport` and is recorded in ADR-011 (`docs/architecture/ADR-011-THE-PUBLISHED-TRANSPORT.md`).

## Getting started

Node.js >= 22 is required, and the repository pins `packageManager` to `pnpm@11.24.0`.

```
pnpm install
pnpm verify
```

`pnpm verify` builds the core package, typechecks every package, then runs the test suite: 398 tests across six packages. The build must come first, because `packages/core` publishes its types from `dist/`, which is not committed.

## Germany-first

School Connector Kit is intentionally Germany-first.

Its data model and connector APIs are designed around information commonly exposed by German school platforms, including:

- Stundenplan and Vertretungsplan
- Hausaufgaben
- Klassenarbeiten and other assessments (not modeled in schema 0.1)
- Termine
- Elternbriefe and school messages
- Abwesenheiten and Krankmeldungen (not modeled in schema 0.1)
- school-specific notifications

German domain terminology may be retained where translating it would reduce precision.

The architecture should remain extensible, but support for other education systems must not make the German-school use case unnecessarily complex.

## Why this project exists

German schools use many different digital platforms and there is no common interface that parents or independent applications can rely on.

This project aims to provide a common connector layer between those platforms and applications that aggregate school information.

## Goals

- Provide a vendor-neutral connector contract for German school services.
- Make adding support for additional school platforms straightforward.
- Keep platform-specific behaviour isolated inside connectors.
- Define a stable normalized data model for common German school concepts.
- Provide contract tests that every connector must pass.
- Provide privacy-safe tooling for discovering API response structures.
- Allow contributors to develop connectors without needing access to the maintainer's school accounts.
- Support family dashboards, backend services, and future mobile applications.

## Potential platforms

The architecture is intended to support connectors for platforms used by German schools, for example:

- WebUntis
- itslearning
- DieSchulApp
- IServ
- Schulmanager Online
- other regional or school-specific services

Listing a platform here does not mean that a connector already exists.

## Privacy

Real school data must never be required for public tests.

Public tests consume only synthetic data: the `examples/` directory contains synthetic example data only, and inputs defined inside the test files use clearly synthetic values.

Real captures may be used locally for acceptance testing, but they must remain outside version control; `private-fixtures/` is Git-ignored.

The fixtures committed under `fixtures/` are structure-only, human-reviewed captures; see `fixtures/README.md` for the promotion workflow and the mandatory review checklist.

Capture tooling follows a deny-by-default approach: values may only leave a capture when explicitly permitted.

## Repository structure

- `packages/core/` - shared connector contract and normalized models
- `packages/connectors/` - platform-specific connectors: WebUntis, Schulmanager Online, DieSchulApp
- `packages/transport/` - the host-side Transport connectors receive (ADR-011)
- `tools/` - developer utilities, including privacy-safe capture tooling
- `schemas/` - placeholder (README only); the generated JSON Schema for schema 0.1 lives in `packages/core/schema/`
- `tests/contract/` - placeholder (README only); shared conformance tests are not written yet
- `docs/` - architecture and contributor documentation
- `examples/` - synthetic examples only

## Design principle

Connectors translate platform-specific data into a stable normalized contract.

Consumers should not need to understand which school platform supplied the data.

School platform -> Connector -> Normalized school-data contract -> Consumer application

## License

Apache License 2.0.
