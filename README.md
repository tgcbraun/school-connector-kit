# School Connector Kit

An open-source toolkit for integrating digital services used by schools in Germany into family dashboards, school aggregators, and other applications.

## Status

Early development.

The project is currently defining the connector contract, normalized school-data model, reference implementations, and privacy-safe capture tooling.

## Germany-first

School Connector Kit is intentionally Germany-first.

Its data model and connector APIs are designed around information commonly exposed by German school platforms, including:

- Stundenplan and Vertretungsplan
- Hausaufgaben
- Klassenarbeiten and other assessments
- Termine
- Elternbriefe and school messages
- Abwesenheiten and Krankmeldungen
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

Public tests use synthetic fixtures. Real captures may be used locally for acceptance testing but must remain outside version control.

Capture tooling follows a deny-by-default approach: values may only leave a capture when explicitly permitted.

## Repository structure

- `packages/core/` - shared connector contract and normalized models
- `packages/connectors/` - platform-specific connectors
- `tools/` - developer utilities, including privacy-safe capture tooling
- `schemas/` - public interchange schemas
- `tests/contract/` - connector conformance tests
- `docs/` - architecture and contributor documentation
- `examples/` - synthetic examples only
- `private-fixtures/` - local private acceptance fixtures; Git ignored

## Design principle

Connectors translate platform-specific data into a stable normalized contract.

Consumers should not need to understand which school platform supplied the data.

School platform -> Connector -> Normalized school-data contract -> Consumer application

## License

Apache License 2.0.
