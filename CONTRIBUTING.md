# Contributing

Contributions are welcome, particularly connectors for additional school
platforms used by schools in Germany.

## Important privacy rule

Never submit real school data, credentials, session tokens, cookies, pupil
information, or production database contents.

All public test fixtures must use synthetic data.

## Connector contributions

A connector should:

1. implement the public connector contract;
2. isolate platform-specific behaviour from the core package;
3. include automated tests;
4. use synthetic fixtures;
5. pass the shared connector contract tests;
6. document required configuration;
7. avoid exposing authentication secrets in logs or exceptions.

German school-domain terminology such as `Klassenarbeit`, `Hausaufgabe`,
`Vertretungsplan`, or `Elternbrief` may be retained where translating the
concept would reduce precision.

More detailed connector-authoring documentation will be added as the public
contract stabilizes.

## Toolchain

The repository requires Node.js >= 22 (the root `package.json` `engines`
field) and pnpm 11.24.0 (the root `package.json` `packageManager` field is
pinned to `pnpm@11.24.0`).

Install dependencies with:

```
pnpm install
```

Note: on the machine where this repository was developed, the
corepack-managed `pnpm` shim failed to start with
`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`. Invoking the pnpm 11.24.0 bundle
directly (for example `node ~/.cache/node/corepack/pnpm/11.24.0/bin/pnpm.cjs
install`) worked there. This observation is environment-specific and was not
verified beyond that one machine; if `pnpm install` cannot run on your
machine, check the pnpm / corepack setup first.

## Evidence tiers

Three evidence tiers are distinguished, and they must not be conflated:

1. `examples/` - synthetic example data only.
2. `private-fixtures/` - private, local evidence (raw or semi-redacted real
   responses). This directory is Git-ignored (see `.gitignore`) and must
   stay that way.
3. `fixtures/<platform>/variant-XXX/` - the only publishable tier:
   structurally redacted, fully human-reviewed captures. See
   `fixtures/README.md` for the promotion workflow and the mandatory review
   checklist.

## What never belongs in an issue or pull request

Never submit raw upstream responses, credentials, session tokens, cookies,
or anything from `private-fixtures/` in a GitHub issue or a pull request.

## Adding a new platform

Adding support for a new school platform follows the committed architecture
decision records, in this order:

1. `docs/architecture/ADR-001-LOCAL-FIRST-TYPESCRIPT.md` - the runtime is
   TypeScript and execution is local-first.
2. `docs/architecture/ADR-002-HTML-STRUCTURAL-CAPTURE.md` - structural
   capture of a platform's responses, including HTML table capture for
   platforms such as KIKOM.
3. `docs/architecture/ADR-003-CONNECTOR-RUNTIME-CONTRACT.md` - the runtime
   contract a connector must implement.

## Connector runtime rules (ADR-003)

Every connector must hold to the ADR-003 contract:

- all capability is injected: a connector takes `Transport`, `Clock`, and
  `Logger` as arguments and assumes no ambient environment;
- request and response bodies are strings; `Transport` deliberately does
  not use WHATWG `fetch`;
- session cookies are owned by the `Transport`; a connector never reads or
  writes `Cookie` or `Set-Cookie` headers (`assertNoCookieHeaders` rejects
  them);
- `Clock` returns epoch milliseconds (a `number`), not a `Date` object;
- `Logger` fields are restricted to `number` and `boolean`, so a value can
  never be logged.

The no-Node / no-DOM part of the contract is enforced mechanically: a
Vitest scan walks the transitive import closure of the package entry point
(`packages/core/src/index.ts`) and fails on any `node:` import or any
reference to globals such as `window`, `document`, or `process`. It runs on
every test run rather than by review discipline.
