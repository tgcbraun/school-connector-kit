# Kikom Structure

**Date:** 2026-08-30
**Method:** derived-facts analysis of three privately captured pages. No page
value appears below — element and attribute names, class names, counts, length
ranges, and pattern descriptions only.
**Captures:** informationen, termine p1, termine p2 (2026-08-30)

## What was delivered

**`private-fixtures/kikom/analyze_pages.py`** — a stdlib-only (`html.parser`, `re`, `urllib.parse`) Phase-6 analyzer matching the discipline of `webuntis/analyze_dates.py` and `dieschulapp/analyze_timetable.py`: sectioned `==` report, derived facts only (element/class/attribute **names**, counts, length **ranges**, booleans, pattern **descriptions** + match counts), stop-and-report error handling, `derived-facts report complete` footer. It never prints a page string value — not dates, hrefs, titles, or attribute values; hrefs contribute only query-parameter **names**; date cells contribute only a FORMAT label + row count.

**Verification (all green):**
- `python3 analyze_pages.py` → exit 0, full report below
- public capture tests: **78/78 passed**; `typecheck` clean
- `git status --short` → empty; the only new file is inside git-ignored `private-fixtures/`
- the three real captures in `raw/` remain intact

**Deliberate deviation, reported per your rule:** I did **not** re-run the 43-test `test_dryrun.py`. I verified in `test_dryrun.py` itself that it uses the live `RAW = HERE / "raw"` directory and calls `clean_raw()` before every scenario — re-running it would delete/overwrite your three real 18:36 captures with simulator content. It was 43/43 green last round against the current, unchanged `fetch_pages.py`, so re-running buys nothing and destroys the Phase-6 evidence. Say the word if you still want it run (I'd back the captures up first).

## Phase 6 evidence — full verbatim output

```
== KIKOM structure — derived facts only (never payload values)
   inputs: ['informationen-20260830.html', 'termine-20260830.html', 'termine-p2-20260830.html']

== page: informationen-20260830.html
  <table> elements: 1
  first <table> in document order (unscoped find) holds the data-uid rows: yes
  tables carrying data-uid rows (index): [0]

  -- table 0 --
  classes: ['table', 'c-margin-t-20', 'table-hover']
  rows: 16 total; data-uid rows: 15
  columns per row, ALL rows: {7: 16}; uniform: yes
  columns per row, data-uid rows: {7: 15}; uniform: yes
  per column index (data-uid rows):
    column 0: empty (15/15 rows; derived from 15 rows)
    column 1: link (15/15 rows; derived from 15 rows)
      text length: min=3 max=3  (3 non-empty cells)
      link: <a href> in 15/15 rows; anchor IS the whole cell: 15/15; anchor with other content (child case): 0/15
    column 2: link (15/15 rows; derived from 15 rows)
      text length: min=9 max=71  (15 non-empty cells)
      link: <a href> in 15/15 rows; anchor IS the whole cell: 15/15; anchor with other content (child case): 0/15
    column 3: date-shaped (15/15 rows; derived from 15 rows)
      date format: "DD.MM.YY (two-digit year)", 15/15 rows
      text length: min=8 max=8  (15 non-empty cells)
    column 4: text (15/15 rows; derived from 15 rows)
      text length: min=1 max=1  (15 non-empty cells)
    column 5: text (15/15 rows; derived from 15 rows)
      text length: min=9 max=18  (15 non-empty cells)
    column 6: link (15/15 rows; derived from 15 rows)
      link: <a href> in 15/15 rows; anchor IS the whole cell: 15/15; anchor with other content (child case): 0/15

  link cells — URL query PARAMETER NAMES only (never values):
    cHash=45, tx_yfkikom_pi1[client]=45, tx_yfkikominformation_information[action]=45, tx_yfkikominformation_information[controller]=45, tx_yfkikominformation_information[information]=45

  pagination structure:
    div.c-pagination > ul.c-content-pagination present: no
    li.c-next present inside that ul: no
    li.c-next occurrences anywhere in document: 0

  input id="yfkec-filter-by-date" present: no (occurrences: 0)

  four-digit year-shaped tokens (year OR 4-digit id — indistinguishable;
  the "yfkec-filter-by-date" input's own attributes excluded; <script>/<style> text excluded;
  counts and booleans only, never values):
    in text nodes: 3  present: True
    in attribute names/values (other elements): 28  present: True
    TOTAL on page: 31  present: True

== page: termine-20260830.html
  <table> elements: 1
  first <table> in document order (unscoped find) holds the data-uid rows: yes
  tables carrying data-uid rows (index): [0]

  -- table 0 --
  classes: ['table', 'c-margin-t-20', 'table-hover', 'table-paginated']
  rows: 11 total; data-uid rows: 10
  columns per row, ALL rows: {4: 11}; uniform: yes
  columns per row, data-uid rows: {4: 10}; uniform: yes
  per column index (data-uid rows):
    column 0: link (10/10 rows; derived from 10 rows)
      date format: "DD.MM. with no year", 10/10 rows
      text length: min=10 max=13  (10 non-empty cells)
      link: <a href> in 10/10 rows; anchor IS the whole cell: 0/10; anchor with other content (child case): 10/10
    column 1: link (10/10 rows; derived from 10 rows)
      text length: min=10 max=78  (10 non-empty cells)
      link: <a href> in 10/10 rows; anchor IS the whole cell: 0/10; anchor with other content (child case): 10/10
    column 2: text (10/10 rows; derived from 10 rows)
      text length: min=9 max=30  (10 non-empty cells)
    column 3: link (10/10 rows; derived from 10 rows)
      link: <a href> in 10/10 rows; anchor IS the whole cell: 10/10; anchor with other content (child case): 0/10

  link cells — URL query PARAMETER NAMES only (never values):
    cHash=30, tx_calendarize_calendar[index]=30, tx_yfkikom_pi1[client]=30

  pagination structure:
    div.c-pagination > ul.c-content-pagination present: yes
    li.c-next present inside that ul: yes
    li.c-next occurrences anywhere in document: 1

  input id="yfkec-filter-by-date" present: yes (occurrences: 1)

  four-digit year-shaped tokens (year OR 4-digit id — indistinguishable;
  the "yfkec-filter-by-date" input's own attributes excluded; <script>/<style> text excluded;
  counts and booleans only, never values):
    in text nodes: 0  present: False
    in attribute names/values (other elements): 46  present: True
    TOTAL on page: 46  present: True

== page: termine-p2-20260830.html
  <table> elements: 1
  first <table> in document order (unscoped find) holds the data-uid rows: yes
  tables carrying data-uid rows (index): [0]

  -- table 0 --
  classes: ['table', 'c-margin-t-20', 'table-hover', 'table-paginated']
  rows: 2 total; data-uid rows: 1
  columns per row, ALL rows: {4: 2}; uniform: yes
  columns per row, data-uid rows: {4: 1}; uniform: yes (single data row: n/a)
  per column index (data-uid rows):
    column 0: link (1/1 rows; derived from 1 rows)
      date format: "DD.MM. with no year", 1/1 rows
      text length: min=13 max=13  (1 non-empty cells)
      link: <a href> in 1/1 rows; anchor IS the whole cell: 0/1; anchor with other content (child case): 1/1
    column 1: link (1/1 rows; derived from 1 rows)
      text length: min=14 max=14  (1 non-empty cells)
      link: <a href> in 1/1 rows; anchor IS the whole cell: 0/1; anchor with other content (child case): 1/1
    column 2: text (1/1 rows; derived from 1 rows)
      text length: min=12 max=12  (1 non-empty cells)
    column 3: link (1/1 rows; derived from 1 rows)
      link: <a href> in 1/1 rows; anchor IS the whole cell: 1/1; anchor with other content (child case): 0/1

  link cells — URL query PARAMETER NAMES only (never values):
    cHash=3, tx_calendarize_calendar[@widget_0][lastPage]=3, tx_calendarize_calendar[index]=3, tx_yfkikom_pi1[client]=3

  pagination structure:
    div.c-pagination > ul.c-content-pagination present: yes
    li.c-next present inside that ul: no
    li.c-next occurrences anywhere in document: 0

  input id="yfkec-filter-by-date" present: yes (occurrences: 1)

  four-digit year-shaped tokens (year OR 4-digit id — indistinguishable;
  the "yfkec-filter-by-date" input's own attributes excluded; <script>/<style> text excluded;
  counts and booleans only, never values):
    in text nodes: 0  present: False
    in attribute names/values (other elements): 33  present: True
    TOTAL on page: 33  present: True

== cross-page comparison (structure only)

  informationen vs termine (p1)
    same number of data-uid tables: yes
    same total table count: yes
    first (unscoped) table is the data table — same: yes
    data-table class names identical: NO
    column count set identical (rows may differ in NUMBER of rows): NO
    data-row attribute NAME sets identical: NO
    per-column content-kind profile identical: NO
    => shared table structure: NO

  termine (p1) vs termine (p2)
    same number of data-uid tables: yes
    same total table count: yes
    first (unscoped) table is the data table — same: yes
    data-table class names identical: yes
    column count set identical (rows may differ in NUMBER of rows): yes
    data-row attribute NAME sets identical: yes
    per-column content-kind profile identical: yes
    => structurally identical: yes

== cross-page: four-digit year-shaped token census
  (EXCLUDING the "yfkec-filter-by-date" element's own attributes;
  tokens may be years OR 4-digit ids/cHash fragments —
  indistinguishable from their shape alone; boolean + count only)
    termine-20260830.html:
      in visible text: present=False  count=0
      in other elements' attribute names/values: present=True  count=46
    termine-p2-20260830.html:
      in visible text: present=False  count=0
      in other elements' attribute names/values: present=True  count=33
  input#yfkec-filter-by-date presence per page:
    informationen-20260830.html: present=False  occurrences=0
    termine-20260830.html: present=True  occurrences=1
    termine-p2-20260830.html: present=True  occurrences=1

== derived-facts report complete
```

**Reading of the evidence (for Phase 6, not part of the evidence):** termine p1 and p2 are structurally identical (same 4-column shape, classes, row attributes) with `li.c-next` only on p1 — so pagination terminates after p2; the occurrence index travels under the parameter name **`tx_calendarize_calendar[index]`** (plus `cHash` and `tx_yfkikom_pi1[client]`), and the final page additionally carries `tx_calendarize_calendar[@widget_0][lastPage]`. Termine dates render as "DD.MM. with no year" (linked columns, anchor not the whole cell), while informationen uses "DD.MM.YY (two-digit year)". No four-digit year appears in visible text on either termine page outside `input#yfkec-filter-by-date` (which is present on both termine pages, absent on informationen); the 4-digit tokens that do exist sit in attribute values on other elements and could equally be cHash fragments or ids. Informationen and termine are structurally different tables (7 vs 4 columns, different classes and row attributes).

Per the scope guard I created no `docs/evidence/KIKOM_STRUCTURE.md` — the output above is the publishable text for that file; nothing outside `private-fixtures/` was modified.
