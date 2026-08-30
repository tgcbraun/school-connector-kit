# Kikom Page Inventory

**Date:** 2026-08-30
**Phase:** 1 of the Kikom next-steps plan
**Method:** read-only inspection of the private Family Dashboard connector over SSH. No page was fetched. No value from any real page appears here.
**Scope of this document:** structure only. No institution name, no host, no URL containing a `cHash`, no client identifier, no row content.

This is a map of what the existing private connector *selects*, not of what the platform *contains*. It is the input to the HTML structural capture design (ADR-002) and to the fetch shim, and it is explicitly not a substitute for real page evidence. Several entries below are marked **unknown** precisely because the connector cannot answer them.

---

## 1. Page sequence

```text
landing
   |  _find_nav(landing, "/kommunikation")
   v
hub
   |
   +-- _find_nav(hub, "/kikom/verwaltung/informationen")   one page only
   |
   +-- _find_nav(hub, "/kikom/verwaltung/termine")         paginated
```

Four page classes are fetched: landing, hub, Informationen, Termine. Termine may additionally fetch N subsequent pages through pagination.

`_assert_client` runs on the landing page, the hub, the Informationen page, the first Termine page, and every subsequent Termine page.

No URL is ever constructed. Every navigation target is an `href` read from an already-fetched page. Pagination targets are likewise hrefs, made absolute against the base.

---

## 2. Row discovery

Both data pages use the same mechanism:

```text
table  = first <table> element in the document   (soup.find("table"), unscoped)
rows   = descendant <tr> elements carrying a data-uid attribute
```

Absence of a table is a hard error.

**Open — this is the most important unknown in the inventory.** The selector is not scoped to a class, id, or container. If a page carries more than one table, the connector reads whichever appears first and no error is raised. The planned capturer is specified to fail closed on any selector that does not uniquely resolve, so the two are in direct conflict until the real table count is known. Phase 6 must report table count per page before ADR-002 settles the selector model.

---

## 3. Column structure

### 3.1 Informationen

Guard: at least 6 `<td>` cells per row; fewer is a hard error. The true column count is **unknown** — the guard is a floor, not an equality.

| Index | Read as | Source |
|---|---|---|
| 0 | not read | — |
| 1 | attachment extension | text of a child `span` with an information-file-link-extension class; absent means no attachment |
| 2 | title, and the row link | cell text; `a[href]` within the cell |
| 3 | publication date | cell text, `DD.MM.YY` |
| 4 | updated date | cell text, `DD.MM.YY`; may be empty or a single-character placeholder; unparseable is tolerated as absent |
| 5 | group label | cell text; a rendered display summary with no underlying list, explicitly not usable for filtering |

Row-level attributes read: `data-uid`.

### 3.2 Termine

Guard: at least 3 `<td>` cells per row; fewer is a hard error. True column count **unknown**.

| Index | Read as | Source |
|---|---|---|
| 0 | day label | cell text; matched against two regexes, a day range and a single day; neither carries a year |
| 1 | title, row link, and occurrence index | cell text; `a[href]` within the cell; the occurrence index is parsed out of the href value |
| 2 | group label | cell text |

Row-level attributes read: `data-uid`, and a data attribute flagging whether the event has a recurrence frequency (compared against the string `"1"`).

### 3.3 Do the two pages share a table structure?

**No.** They share only the row-discovery mechanism. They differ in column count guard, link column position, date model, row attributes read, pagination, and presence of a server-date input. Any capture model that assumes one table shape per platform is wrong for this platform.

---

## 4. Pagination

```text
container   div.c-pagination ul.c-content-pagination
next link   li.c-next a[href]   within that container
absolute    urljoin against the base
terminate   container absent, or no li.c-next
cap         a maximum page count in the connector, logged as a warning if reached
```

The container scoping is deliberate and load-bearing: a language switcher elsewhere on the page carries the same page-number parameter in its href, so an unscoped match would follow the wrong link.

Used on Termine only. **Open:** the connector never checks for a pagination container on the Informationen page. Whether the platform paginates it is unknown, and the single-page fetch may be an untested assumption rather than an observed property.

---

## 5. Guards

### 5.1 Client-scope assertion

A regex collects every client identifier appearing in the page's links and compares the resulting set against one expected value. Two failure modes, both hard errors: no identifier found at all, and more than one distinct identifier found. The second guards against an account that covers more than one institution — the connector refuses to store anything rather than risk cross-institution scope.

Implication for the shim and the capturer: client identifiers appear inside link URLs throughout the markup. Attribute values must never be emitted, and the raw HTML must never be printed.

### 5.2 Server date

Read from an `input` element with a fixed id used by the Termine date filter, taking its `value` attribute, parsed as `YYYY-MM-DD`. Absent or unparseable on the Termine page is a hard error, because year resolution depends on it.

Present on the Termine page only. Preferred over the container clock deliberately: the anchor must be the platform's notion of today, not the runtime's.

---

## 6. Text-derived versus href-derived fields

| Field | Origin |
|---|---|
| title (both pages) | cell text |
| publication date, updated date | cell text |
| day label | cell text |
| group label (both pages) | cell text |
| attachment extension | text of a child element within a cell |
| row url (both pages) | `href` attribute value |
| occurrence index | parsed from inside the `href` value |
| uid | `data-uid` attribute value on the `<tr>` |
| recurrence flag | data attribute value on the `<tr>`, compared to a literal |

Three of these come from attribute values, and one of those three is parsed from a substring of an attribute value.

**Consequence for ADR-002.** The proposed model emits attribute names and never attribute values. Under that rule a promoted Termine fixture would record that an `href` exists but could not record that it carries an occurrence index — and since a recurring event repeats its `uid`, that index is what disambiguates occurrences. It is arguably the most load-bearing structural fact on the page.

The distinction to design against: URL **query parameter names** are structural facts, while parameter **values** are where the signed hash and record identifiers live. Emitting parameter names without values may be the resolution. It is not obviously safe and it is not obviously unsafe. ADR-002 must decide it explicitly rather than inherit the blanket rule by default.

The same question applies to the two `<tr>` data attributes, though less sharply: their names alone are probably sufficient, since a connector author needs to know the row carries a uid, not what any uid is.

---

## 7. Date models observed

Four distinct forms across two pages of one platform:

```text
Informationen  publication date   DD.MM.YY   two-digit year; century inferred by the parser
Informationen  updated date       DD.MM.YY   optional; placeholder and unparseable both mean absent
Termine        single day         DD.MM.     no year; inferred against the server date
Termine        day range          DD.MM.-DD.MM.  one cell, two days, no year on either;
                                               the range may cross a year boundary
```

Year inference for Termine resolves against the server date across a three-year candidate window with a backward tolerance, then holds a non-decreasing floor across the row sequence so that a mid-list rollover is detected. The anchor is passed explicitly into the parser so that page 2 continues page 1's sequence rather than restarting it.

For the normalized model this means a partial date is not merely a date with a missing field. It is a value whose resolution depends on an out-of-band anchor **and** on its position in an ordered sequence. A provenance flag distinguishing an inferred year from a stated one is necessary but may not be sufficient; the anchor itself may need to be recorded.

---

## 8. What this inventory cannot answer

Carried forward to Phase 6 analysis of real pages:

1. table count per page, and whether the unscoped first-table selector resolves uniquely;
2. true column count on both pages, beyond the connector's minimum guards;
3. whether Informationen paginates;
4. content class and length range per column, including columns the connector ignores;
5. whether the link sits on the whole cell or a child element;
6. observed row counts and whether the day-range form appears at all in practice;
7. whether any year appears anywhere on the Termine page outside the filter input.
