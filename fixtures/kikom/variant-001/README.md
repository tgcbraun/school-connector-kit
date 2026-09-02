# Kikom — reviewed HTML structure capture (v1, first real page)

Two reviewed structural captures of the Kikom platform and the format-2
allowlists that produced them.

## Facts

- **Platform:** Kikom
- **Pages:** two structurally distinct tables — Informações and Termine
- **`capture_format`:** 2 (HTML structural capture, ADR-002)
- **Allowlists:** one per capture, committed beside it and still matching
  it. A single allowlist version does not apply to this fixture; see
  "Why this layout is two pairs" below.

## Files

```
capture-informationen.json    # structure-only redaction of the Informações page
allowlist-informationen.json  # the exact allowlist that produced it
capture-termine.json          # structure-only redaction of the Termine page
allowlist-termine.json        # the exact allowlist that produced it
README.md                     # this file
```

Both capture files keep element structure, JSON types, string lengths,
array and row counts, and sampled column profiles only. They contain **no
real values otherwise**: no message or event text, no names, no ID values,
no school name, no tenant identity.

## Why this layout is two pairs

The other fixtures in this directory carry a single
`capture.json` / `allowlist.json` pair. This one deliberately carries **two**:
Kikom serves two structurally different data tables (see point 3 below), and
an allowlist binds to exactly one capture file. Two captures, two allowlists,
one review unit — that is the honest shape.

## What the JSON cannot say about itself

1. **Column profiles are sampled, not complete.** Each column profile
   (length ranges, content class, date shape, link counts) derives from
   **at most three data rows**; `row_count` separately records the true
   data-row count. Header rows are excluded from both. This caveat is
   spelled out in writing because the WebUntis allowlist v3 error was
   exactly a contributor reading a sampled profile as a complete one.
2. **The sampled ranges understate the population.** For example, the
   third Informações column samples a range of 10–29, while the full
   15-row analysis found 9–71. Sizing a field off a sampled range will
   get it wrong.
3. **Informações and Termine are two shapes, not one.** They do not share a
   table structure. A connector must treat them as two distinct tables, not
   one parameterised shape.
4. **The private connector reads a subset of the columns.** It ignores
   two columns: Informações is read at positions 0–5 of 7, Termine at 0–2 of
   4 — and in every row the two unread columns hold links. This fixture
   records the platform, not one connector's subset; treat the unread
   columns as intentional platform data until proven otherwise.
5. **The date forms are not symmetric.** The Termin date form carries **no
   year**; the occurrence index travels in
   `tx_calendarize_calendar[index]` instead. The Informação date form
   carries a **two-digit year**, so the century is inferred by the parser,
   not stated by the platform.
6. **Row ids are not unique.** A recurring Termin repeats its data-uid
   across occurrences; the row id does not identify a row even within one
   page. Key on row + date + index, not on the row id.
7. **Query parameter names are in wire form.** HTML character references
   inside an `href` are decoded before URL parsing, but percent-encoding is
   left exactly as written. A parameter name such as
   `tx_yfkikom_pi1%5Bclient%5D` is what the wire carries; it is not the
   decoded `tx_yfkikom_pi1[client]`.
8. **Three open gaps — absence here is not confirmation:**
   - the day-range date form was never observed; all Termin rows parsed as a
     single `DD.MM.` shape, so the private connector's range branch is
     unexercised by this data
   - the Informação `updated` column was a placeholder in every row (length
     sample of 1); its real date form has never been observed
   - the purpose of the two unread columns (point 4) is unknown

## Provenance

- Reviewed by a human as part of the school-connector-kit privacy review
  process on 2026-08-31, against Kikom pages captured 2026-08-30; the
  review passed and the checklist in `fixtures/README.md` applies.
- Reproducible from the raw pages via `tools/capture` (`html` path) with
  the allowlists in this directory.
- `private-fixtures/kikom/` holds the private originals and the private
  fetch/analysis tooling; this directory stands alone and needs no access
  to them.
