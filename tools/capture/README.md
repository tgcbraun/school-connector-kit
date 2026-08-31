# Capture Tool

Privacy-safe, local-only structural capture and redaction for upstream
school/Kita platform responses.

## Purpose

Before any real response may be used as evidence for a connector, it must be
reduced to a **structural capture**: the shape of the JSON, which paths we
chose to keep, which we dropped, and array lengths — with every other value
removed. This tool performs that reduction on a developer's local machine,
offline, from a decoded JSON file.

It is intentionally **not** a connector, and it contains no
WebUntis/Kikom/DieSchulApp/itslearning/IServ/Schulmanager logic. Platform
specificity starts at the allowlist, which a human authors.

## Privacy model

- **Deny by default.** Nothing from the input is copied into the output
  unless a rule names its exact path with mode `keep`; `type` rules replace
  the value with a type token. Everything else is dropped.
- **Local only.** The CLI reads exactly two local files (input, allowlist)
  and writes exactly one local file (the capture). It never authenticates,
  makes HTTP requests, reads credentials from the environment, contacts any
  service, or logs input content.
- **Deterministic.** The same inputs always produce byte-identical output:
  fixed key order, code point (locale-independent) sorting, no clock reads.
  `captured_at` is always caller-supplied.
- **Fail closed.** Ambiguities (reserved key syntax, malformed rules,
  unsafe URL templates) are rejected with a deterministic error; the tool
  never guesses between "keep" and "drop".
- **No value echo.** Error messages contain fixed text or structural
  information (paths, flag names) — never values read from the input files.

## keep vs type

- `keep` — the value is copied verbatim into the capture's `shape`. Use it
  only for values safe to publish as structural evidence (codes, booleans,
  small enums reviewed by a human). `keep` is a publication decision, not a
  convenience feature.
- `type` — the value is replaced by a token:
  `{"__t": "string"}` for strings (plus `__len`), `{"__t": "number"}`,
  `{"__t": "boolean"}`, `{"__t": "null"}`, `{"__t": "object"}` /
  `{"__t": "array"}` (the container is still traversed if lower rules exist).

## Path notation

Paths are normalized: object keys joined with `.`, array elements as a `[]`
token appended directly, root as the empty path.

```
id
data.student.name
items[].code
matrix[].rows[].value
```

Rules target scalar leaves only; containers are traversed while their
prefix matches a rule.

**Reserved-key behavior.** Object keys containing `.` or `[]` are
structurally indistinguishable from the path grammar itself. Redacting such
data throws `RedactorError` (`RESERVED_OBJECT_KEY`) instead of guessing —
the capture is refused. Allowlist rule paths are validated against the same
grammar at construction; malformed rule paths are rejected
(`RedactorError`, `INVALID_RULE_PATH`). There is deliberately no escaping
grammar.

## Array sampling

For each array, at most the **first 3 elements** are inspected. The full
length is recorded in `array_lengths` (and a `__len` token appears for
type-tokenized array values). Elements 4 and beyond are **never inspected
and contribute nothing** — not to the shape, not to `dropped_paths`, not to
`array_lengths`.

## dropped_paths

Sorted, de-duplicated list of normalized paths whose values were dropped
(the deny-by-default case). Names of dropped fields are structural
information and are expected in the output; their values are not.

## URL-template safety

`--url-template` must be a **safe relative template**, deliberately
provided — it is never inferred or cleaned from a raw request URL.

Accepted grammar (small on purpose):

```
/seg(/seg)*[?param(=value)?(&param(=value)?)*]
```

- relative only — no scheme, no host, no `//`, no whitespace;
- each path segment is a letter-led identifier or a `{placeholder}`;
- query values are letter-led identifiers or `{placeholder}`;
- userinfo (`@`), fragments (`#`), percent-encoding, and any other
  characters are rejected;
- raw query values such as `?student=123456` are rejected — write
  `?student={pupilId}` instead.

**Limitation:** this is allowlist validation, not URL semantics. A template
passing this check may still describe a route that identifies an
institution in combination with other context; reviewers must read
`url_template` as part of the privacy review.

## HTML structural capture (`html` subcommand, `capture_format` 2)

A second capture mode for captured HTML pages (ADR-002), implemented as a
sibling of the JSON redaction path in the same package: it shares the flag
vocabulary, the URL-template policy, the envelope helpers, and the
output-write rules (symlink refusal, explicit `--force`), and reuses the
same canonical, deterministic serialization.

- The first CLI token, when it is the literal word `html`, switches to this
  path (ADR-002 §9, option 1): `input` is an HTML file, `allowlist` is a
  format-2 allowlist (`version` + `selectors` of
  `{kind: table | pagination, classes, scopes?, row_attribute?}`).
- **No text content** is ever emitted: text is reported by code-point
  length only. **No attribute values** appear in the output except
  query-parameter *names* read from row anchor `href`s; URL paths and
  parameter values stay out.
- Selectors resolve structurally (tag + class containment + scope classes +
  optional row-attribute name) and must resolve to **exactly one** element;
  zero or multiple candidates fail closed. Analysis is confined to the
  resolved subtree by construction.
- Tables report true `row_count` with at most 3 rows inspected
  (`rows_inspected`); columns report a content class, a length range, a
  shared date-shape pattern (pattern name + match count, never the text),
  and whole-cell versus child anchor counts.
- Pagination containers report presence, classes, and whether the fixed
  v1 next-link rule (a `c-next` list item holding an anchor) matches.
- `unparsed` counts tags outside a fixed whitelist per request; the key is
  **omitted** from the serialized request when the count is 0.
- A strict, well-formedness-requiring parser is used: ambiguous or broken
  markup fails closed instead of being guessed at.

```sh
pnpm --filter @school-connector-kit/capture capture -- html \
  --input my-synthetic-page.html \
  --allowlist my-html-allowlist.json \
  --platform example \
  --captured-at 2025-06-15T08:30:00Z \
  --method GET \
  --url-template '/api/example?start={start}' \
  --status 200 \
  --output my-html-capture.json
```

A golden example lives in [`examples/`](../../examples/) with a test that
reproduces `expected-html-capture.json` byte for byte.

## Running

From the repository root:

```sh
pnpm --filter @school-connector-kit/capture test
pnpm --filter @school-connector-kit/capture typecheck
```

Capture a local (synthetic or already-decoded) JSON file:

```sh
pnpm --filter @school-connector-kit/capture capture -- \
  --input my-synthetic-response.json \
  --allowlist my-allowlist.json \
  --platform example \
  --captured-at 2025-06-15T08:30:00Z \
  --method GET \
  --url-template '/api/example?start={start}&end={end}' \
  --status 200 \
  --output my-capture.json
```

The output is UTF-8, two-space pretty JSON with a trailing newline. If
`--output` already exists the run fails; `--force` overwrites **explicitly**
only. Symlinked output paths are always refused.

A complete golden example lives in [`examples/`](../../examples/) with a
test that reproduces `expected-capture.json` byte for byte.

## ⚠ Real captures

**Real captures MUST remain PRIVATE until reviewed.** They live in
`private-fixtures/` (git-ignored), are reviewed by a human against the
checklist in [`fixtures/README.md`](../../fixtures/README.md), and only
surviving, explicitly justified structural captures may be promoted to
`fixtures/<platform>/variant-XXX/`. Automated redaction is a gate, not a
guarantee: human review is mandatory.
