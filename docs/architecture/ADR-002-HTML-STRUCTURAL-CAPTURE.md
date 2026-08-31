# ADR-002 — HTML Structural Capture

**Date:** 2026-08-30
**Status:** Accepted
**Supersedes:** nothing
**Related:** ADR-001 (local-first TypeScript), `docs/evidence/KIKOM_STRUCTURE.md`

---

## Context

The capture toolchain built for the first milestone is JSON-only. Its contract is a path grammar over a typed object tree (`data.homeworks[].date`), with deny-by-default enforced structurally: a scalar leaf with no matching allowlist rule is dropped and recorded as a dropped path.

Kikom serves HTML. There is no path grammar, no typed scalar leaves, and no natural analogue to `keep` / `type`. A Kita communication page is also dense with other families' content — announcement titles, event names, group labels — in a way neither JSON platform was. Deny-by-default over a document tree is harder to be confident about than over a typed object tree.

Three options were considered and recorded in the status document at Revision B §27. Option A (capturing the existing connector's parsed `list[dict]`) was rejected: it observes a prior design decision rather than the platform. Option C (defer Kikom) was superseded when option B proved cheap enough to do first.

This ADR is written **after** real evidence rather than before it. Three pages were captured privately and analysed with a derived-facts script; the results are in `docs/evidence/KIKOM_STRUCTURE.md`. Four of the five open design questions the plan listed are answered by that evidence rather than by argument, and the decisions below are stated with the observation that settles each one.

---

## Decision

### 1. Scope: tables and pagination containers, not general DOM

v1 captures a table element and a pagination container. It does not model arbitrary document structure.

**Evidence:** all three captured pages carry exactly one `<table>`, and the unscoped first-table selector resolves to the data table on every one. Pagination, where present, sits in a single known container.

A general DOM capture model is deferred until a platform needs it. Building one now would be designing against a theory of HTML rather than against an observed platform, which is the error this whole sequence exists to avoid.

**Consequence:** IServ or another scraped platform may force this open. That is acceptable — the envelope is versioned and `0.x` permits breaking changes.

### 2. Selectors must resolve uniquely, and this is now known to be satisfiable

The capturer fails closed when a selector does not resolve to exactly one element.

**Evidence:** one table per page on all three captures. The rule was drafted before this was known and could have been unsatisfiable on the very first platform it was written for; it is not.

**Consequence:** a page carrying two tables fails the capture rather than silently taking the first. The existing private connector takes the first without complaint. That difference is deliberate — a capture that publishes evidence has a higher bar than a connector that reads its own known page.

### 3. Text nodes are never emitted. No exception.

Only a type-and-length token, matching the JSON redactor's `{"__t":"string","__len":N}`.

**Evidence:** Informationen column 2 holds text of length 9–71 across 15 rows. Those are announcement titles for real families. Column 5 holds group labels of length 9–18. There is no formulation under which emitting this text is defensible, and no `keep` mode exists in v1 to request it.

Length ranges are emitted. This carries forward the judgement recorded at Revision B §29 for WebUntis `__len` tokens: a length is not recoverable to content, and it tells a connector author the field's real range.

### 4. Attribute values are never emitted, with exactly one evidenced exception: URL query parameter names

Denied: every attribute value, every URL path, and every query parameter *value*.
Permitted: the *names* of query parameters appearing in `href` values, with occurrence counts.

**Evidence:** the Termine occurrence index travels under the parameter name `tx_calendarize_calendar[index]`. A recurring event repeats its `data-uid`, so the href is what disambiguates occurrences — it is the single most load-bearing structural fact on the page. Under a blanket attribute-value denial, a promoted fixture could record that an `href` exists but never that it carries an occurrence index, and a connector author working from the fixture would be unable to build a correct Termine connector.

The same evidence shows the denial side is exactly right: alongside that parameter name sit `cHash` and `tx_yfkikom_pi1[client]`. The `cHash` is signed with the site key; the client parameter is the institution scope identifier that the private connector asserts on every page. **Their names are structural facts; their values are precisely what must never be published.** The name/value split is not a compromise — it is the line the evidence draws.

**Consequence:** parameter names must be reviewed like any other emitted content. A platform that encodes an identifier into a parameter *name* rather than its value would defeat this. No observed platform does, but the human privacy review must look.

### 5. No `keep` mode in v1

Both committed JSON fixtures ended with zero `keep` rules, after three allowlist revisions on WebUntis progressively removed every one. The HTML tool starts where the JSON tool finished.

Adding `keep` later is a compatible change. Removing it would not be.

### 6. The allowlist inverts

The JSON allowlist says what may survive from everything present. The HTML allowlist says **what to look at in the first place** — a list of selectors to capture. Nothing outside a listed selector is examined, so nothing outside it can be emitted.

This inversion is the crux of the design. On a typed object tree, deny-by-default is enough, because every leaf is enumerable and a leaf without a rule is dropped. On a document tree, enumerable-and-dropped is not a comfortable guarantee when the document is full of other families' text. Scoping the tool's attention is a stronger property than scoping its output: **site chrome, navigation, and surrounding markup are never read, so they cannot leak through a defect.**

### 7. Output shape

`capture_format: 2`, as a sibling of format 1 rather than an overload of `shape`.

The CaptureFile envelope is unchanged — `platform`, `allowlist_version`, `captured_at`, `requests[]` with method, URL template, and status all carry over, along with their validation and the caller-supplied-timestamp rule. Only the per-request payload is format-specific.

Per captured table:

```text
selector            the selector used to reach it
classes             class names on the element
row_count           true count of data rows: every <tr> under the table
                    except the rows inside a <thead>
rows_inspected      capped at 3, mirroring the JSON array cap; the cap
                    applies to data rows, and header rows are never profiled
has_header          whether rows inside a <thead> were present
column_count        and whether uniform across data rows
columns[]           per column index:
                      content_class   empty | text | link | date-shaped
                                      | time-shaped | mixed
                      text_length     min/max range, text columns only
                      date_format     pattern description + match count
                      link_present    count, and whether the anchor is the
                                      whole cell or a child element
row_attributes      attribute names present on data rows, with counts
query_parameters    parameter names found in row hrefs, with counts
```

Per pagination container: presence, container classes, and whether a next-link is present.

The Phase 6 analyzer already emits this structure. It becomes the reference implementation rather than a throwaway diagnostic.

### 8. Row inspection is capped at 3, with the true count recorded separately

Identical contract to `array_lengths` in the JSON path.

**Consequence, and it is a real one:** content classes and length ranges are derived from at most three rows and must be labelled as such. The WebUntis allowlist v3 error is the precedent — a `keep` rule was justified by a claim about subject codes that the first three of twenty-four lessons did not support. A three-row profile is a sample, and the fixture must say so.

### 9. Determinism and fail-closed, unchanged from the JSON path

Sorted keys, code-point comparator, caller-supplied timestamps, no environment-derived content. Fail closed on unparseable markup, on a selector that does not uniquely resolve, and on any element the allowlist names but the page does not contain.

### 10. Packaging

Shared package, separate module. The envelope, URL template policy, and CLI argument handling are not duplicated. `tools/capture` gains an HTML module rather than spawning `tools/capture-html`.

---

## Consequences

**Positive.** Kikom becomes publishable evidence rather than a blocked platform. The corpus reaches three materially different platforms, and specifically three different ways of locating something in time — which is what schema `0.1` was waiting for. The scoped-attention model is a stronger privacy property than the JSON tool's deny-by-default, on a source that needs it more.

**Negative.** A second tool and a second privacy-review model to maintain. The three-row cap means column profiles are samples. The query-parameter-name exception is a real hole in an otherwise absolute rule, and it will need re-examining on every new platform rather than being assumed safe.

**Deferred.** General DOM capture. Any `keep` mode. Nested or multi-table pages. Non-table structures such as card or list layouts, which some platform will eventually serve.

---

## What the evidence could not settle

Recorded so the next reader does not mistake absence for confirmation.

- **The day-range date form was never observed.** All 11 Termine rows parsed as a single `DD.MM.`. The private connector has a day-range branch with year-rollover handling that this evidence does not exercise. Termine column 0 text lengths run 10–13, and a bare `DD.MM.` does not explain that spread, so something in that cell is unaccounted for.
- **The Informationen `updated` column has no observed date.** Length 1 in 15 of 15 rows — every row is the placeholder. Its date format is unknown. Treat it as the `room` and `attachments` cases were treated: deny, and assume nothing about a shape that has never been seen.
- **Two columns are ignored by the private connector.** Informationen is 7 columns wide and the connector reads 0–5; Termine is 4 wide and it reads 0–2. Both unread columns hold links in every row. Their purpose is unknown. They belong in the fixture regardless — recording what the platform serves, not what one connector happens to consume, is the entire point.
