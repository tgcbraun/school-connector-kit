import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

import {
  HtmlCaptureError,
  captureHtml,
  type HtmlAllowlist,
} from "../src/html-capture.js";

// All markup and values below are entirely fictional / synthetic.
// Canary tokens are chosen to be impossible inside any length token,
// sorted key, or structural name, so asserting their absence from the
// serialized result proves that no text content, attribute value, or
// URL path/parameter value was emitted.

function canaries(): string[] {
  return [
    "PUPIL_CANARY_A1B2",
    "TEACHER_CANARY_C3D4",
    "MEMO_CANARY_E5F6",
    "TOKEN_CANARY_I9J0",
    "STATE_CANARY_X1Y2",
    "HASH_CANARY_Z8Q9",
    "SECRET_PARAM_CANARY_K7L8",
    "PARAM_CANARY_M2N3",
  ];
}

function page(body: string): string {
  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
}

interface Entry {
  kind: "table" | "pagination";
  classes: string[];
  scopes?: string[];
  row_attribute?: string;
}

/** Index access that fails loudly instead of silently returning undefined. */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`expected an element at index ${index}`);
  }
  return value;
}

function expectHtmlError(
  fn: () => unknown,
  code: string,
  forbiddenInMessage = "",
): void {
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  expect(error, "capture must throw").toBeInstanceOf(HtmlCaptureError);
  expect((error as HtmlCaptureError).code).toBe(code);
  if (forbiddenInMessage.length > 0) {
    expect(String((error as Error).message)).not.toContain(forbiddenInMessage);
  }
}

function capture(
  source: string,
  entry: Entry,
  extraEntry?: Entry,
): unknown {
  const allowlist: HtmlAllowlist = {
    version: "t-1",
    selectors: extraEntry === undefined ? [entry] : [entry, extraEntry],
  };
  const result = captureHtml(source, allowlist);
  const table = result.tables[0];
  if (table === undefined) {
    throw new Error("expected a table payload");
  }
  return table;
}

const CANONICAL_ROW = (
  rowUid: string,
  text1: string,
  link2Text: string,
  link2Hash: string,
  link3Text: string,
  link3Hash: string,
  mixedPrefix: string,
  mixedHash: string,
  extraAttributes = "",
): string =>
  `<tr data-uid="${rowUid}"${extraAttributes}>` +
  `<td></td>` +
  `<td>${text1}</td>` +
  `<td><a href="/verwaltung/informationen/information?cHash=${link2Hash}&tx_yfkikom_pi1[client]=1">FAKE_LINK_TEXT_${link2Text}</a></td>` +
  `<td>12.05.26</td>` +
  `<td><a href="/termine/termin?cHash=${link3Hash}&tx_yfkikom_pi1[client]=2">FAKE_LINK_TEXT_${link3Text}</a></td>` +
  `<td>${mixedPrefix} <a href="/termine/termin?cHash=${mixedHash}">14.05.26</a></td>` +
  `</tr>`;

const CANONICAL_TABLE: string =
  `<p>PUPIL_CANARY_A1B2</p>` +
  `<div class="wrap">` +
  `<table class="t c-margin">` +
  CANONICAL_ROW("UID1", "EXAMPLE_TEXT_ONE", "A", "H2", "B", "H3", "FAKE_PREFIX_ONE", "H4") +
  CANONICAL_ROW("UID2", "EXAMPLE_TEXT_TWO_LONGER", "C", "H5", "D", "H6", "FAKE_PREFIX_TWO_LONGER", "H7") +
  CANONICAL_ROW("UID3", "EXAMPLE_TEXT_THREE", "E", "H8", "F", "H9", "FAKE_PREFIX_THREE", "H10", ' data-state="STATE_CANARY_X1Y2"') +
  CANONICAL_ROW("UID4", "PUPIL_CANARY_A1B2 THIS TEXT MUST NOT INFLUENCE ANY RANGE IN COLUMN ONE", "G", "H11", "H", "H12", "FAKE_PREFIX_FOUR_MUCH_LONGER_THAN_ANY_OTHER_CELL_TEXT_IN_THIS_SYNTHETIC_DOCUMENT", "H13") +
  CANONICAL_ROW("UID5", "Z5", "I", "H14", "J", "H15", "FAKE_PREFIX_FIVE", "H16") +
  `</table>` +
  `<nav><div class="c-pagination"><ul class="c-content-pagination"><li class="c-first"><a href="/kommunikation/page.1.html">1</a></li><li class="c-current">2</li><li class="c-next"><a href="/kommunikation/page.3.html?cHash=HASH_CANARY_Z8Q9">3</a></li></ul></div></nav>` +
  `<input type="text" value="STATE_CANARY_X1Y2">` +
  `</div>`;

const CANONICAL_PAGE = page(CANONICAL_TABLE);

function canonicalEntry(): Entry {
  return {
    kind: "table",
    classes: ["c-margin"],
    scopes: ["wrap"],
    row_attribute: "data-uid",
  };
}

it("resolves the canonical table through classes + scope + row attribute and reports the true counts", () => {
  const table = capture(CANONICAL_PAGE, canonicalEntry()) as Record<string, unknown>;
  expect(table.row_count).toBe(5);
  expect(table.rows_inspected).toBe(3);
  expect(table.column_count).toBe(6);
  expect(table.uniform).toBe(true);
  expect(table.classes).toEqual(["c-margin", "t"]);
});

it("classifies each of the five content classes on the canonical table", () => {
  const table = capture(CANONICAL_PAGE, canonicalEntry()) as {
    columns: Array<Record<string, unknown>>;
  };
  const classes = table.columns.map((column) => column.content_class);
  expect(classes).toEqual(["empty", "text", "link", "date", "link", "mixed"]);
});

it("derives text length ranges from the first three rows only", () => {
  const table = capture(CANONICAL_PAGE, canonicalEntry()) as {
    columns: Array<Record<string, unknown>>;
  };
  expect(table.columns[1]).toMatchObject({
    text_length: { min: 16, max: 23 },
  });
  expect(table.columns[2]).toMatchObject({
    text_length: { min: 16, max: 16 },
  });
  expect(table.columns[3]).toMatchObject({
    text_length: { min: 8, max: 8 },
  });
  expect(table.columns[4]).toMatchObject({
    text_length: { min: 16, max: 16 },
  });
  expect(table.columns[5]).toMatchObject({
    text_length: { min: 24, max: 31 },
  });
  expect(table.columns[0]).toMatchObject({ text_length: null });
});

it("reports date format with match count where shared, and omits it where absent", () => {
  const table = capture(CANONICAL_PAGE, canonicalEntry()) as {
    columns: Array<Record<string, unknown>>;
  };
  expect(at(table.columns, 3)).toMatchObject({
    date_format: { pattern: "DD.MM.YY (two-digit year)", matches: 3 },
  });
  expect("date_format" in at(table.columns, 5)).toBe(false);
  for (const index of [0, 1, 2, 4]) {
    expect("date_format" in at(table.columns, index)).toBe(false);
  }
});

it("counts whole-cell versus child anchors per column", () => {
  const table = capture(CANONICAL_PAGE, canonicalEntry()) as {
    columns: Array<Record<string, unknown>>;
  };
  expect(table.columns[2]).toMatchObject({
    links: { present: 3, whole_cell: 3, child: 0 },
  });
  expect(table.columns[4]).toMatchObject({
    links: { present: 3, whole_cell: 3, child: 0 },
  });
  expect(table.columns[5]).toMatchObject({
    links: { present: 3, whole_cell: 0, child: 3 },
  });
});

it("records row attribute names with counts, never values", () => {
  const table = capture(CANONICAL_PAGE, canonicalEntry()) as {
    row_attributes: Record<string, unknown>;
  };
  expect(table.row_attributes).toEqual({ "data-state": 1, "data-uid": 3 });
});

it("records query parameter names with counts only", () => {
  const table = capture(CANONICAL_PAGE, canonicalEntry()) as {
    query_parameters: Record<string, unknown>;
  };
  expect(table.query_parameters).toEqual({
    "tx_yfkikom_pi1[client]": 6,
    cHash: 9,
  });
});

it("emits no text content, attribute values, URL paths, or parameter values in the canonical output", () => {
  const result = captureHtml(CANONICAL_PAGE, {
    version: "t-1",
    selectors: [canonicalEntry()],
  });
  const output = JSON.stringify(result);
  for (const canary of canaries()) {
    expect(output).not.toContain(canary);
  }
  expect(output).not.toContain("/verwaltung");
  expect(output).not.toContain("/termine");
  expect(output).not.toContain("/kommunikation");
});

it("leaves rows after the third row out of every derived range and count", () => {
  const table = capture(CANONICAL_PAGE, canonicalEntry()) as {
    row_attributes: Record<string, unknown>;
  };
  // data-state exists only on row 3 of the canonical fixture (within the cap);
  // a row beyond the cap must not add any attribute or parameter.
  expect(table.row_attributes["data-state"]).toBe(1);
});

it("fails closed on a stray closing tag", () => {
  const source = page(`<table class="t"><tr><td>OK</td></tr></table></p>`);
  expectHtmlError(
    () => capture(source, { kind: "table", classes: ["t"] }),
    "PARSE",
  );
});

it("fails closed on an element left open at end of input", () => {
  const source = page(`<table class="t"><tr><td>OPEN_CELL_TEXT</td></tr>`);
  expectHtmlError(
    () => capture(source, { kind: "table", classes: ["t"] }),
    "PARSE",
  );
});

it("fails closed on a tag cut off mid-attribute", () => {
  const source = page(`<table class="t"><tr><td data-x=`);
  expectHtmlError(
    () => capture(source, { kind: "table", classes: ["t"] }),
    "PARSE",
  );
});

it("fails closed on a comment that never terminates", () => {
  const source = page(`<!-- CANARY_COMMENT_START <table class="t">`);
  expectHtmlError(
    () => capture(source, { kind: "table", classes: ["t"] }),
    "PARSE",
    "CANARY_COMMENT_START",
  );
});

it("accepts case-insensitive tags and attribute names, and unquoted boolean attributes", () => {
  const source = page(
    `<TABLE class="T" cellPadding=0><TR DATA-UID="CASE_UID"><TD>CASE_INSENSITIVE_CELL_TEXT</TD></TR></TABLE>`,
  );
  const table = capture(source, { kind: "table", classes: ["T"] }) as {
    row_attributes: Record<string, unknown>;
  };
  expect(table.row_attributes).toEqual({ "data-uid": 1 });
});

it("refuses a selector that resolves zero elements (allowlist names a selector the page does not contain)", () => {
  const decoy = page(
    `<table class="CANARY_CLASS_X1"><tr><td>DECOY_CELL_TEXT</td></tr></table>`,
  );
  expectHtmlError(
    () => capture(decoy, { kind: "table", classes: ["t"] }),
    "SELECTOR",
    "CANARY_CLASS_X1",
  );
});

it("refuses a selector that resolves more than one element", () => {
  const source = page(
    `<table class="t"><tr><td>CELL_A_TEXT</td></tr></table>` +
      `<table class="t"><tr><td>CELL_B_TEXT</td></tr></table>`,
  );
  expectHtmlError(
    () => capture(source, { kind: "table", classes: ["t"] }),
    "SELECTOR",
  );
});

it("discriminates candidates by scope class", () => {
  const source = page(
    `<table class="t"><tr><td>OUT_OF_SCOPE_CELL_TEXT</td></tr></table>` +
      `<div class="scope-s">` +
      `<table class="t"><tr><td>IN_SCOPE_CELL_TEXT</td></tr></table>` +
      `</div>`,
  );
  let thrown: unknown;
  try {
    capture(source, { kind: "table", classes: ["t"] });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(HtmlCaptureError);
  const table = capture(source, {
    kind: "table",
    classes: ["t"],
    scopes: ["scope-s"],
  }) as { row_count: number };
  expect(table.row_count).toBe(1);
});

it("discriminates candidates by a row attribute name", () => {
  const source = page(
    `<table class="t"><tr><td>NO_UID_CELL_TEXT</td></tr></table>` +
      `<table class="t"><tr data-uid="UID_ROW"><td>UID_CELL_TEXT</td></tr></table>`,
  );
  let thrown: unknown;
  try {
    capture(source, { kind: "table", classes: ["t"] });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(HtmlCaptureError);
  const table = capture(source, {
    kind: "table",
    classes: ["t"],
    row_attribute: "data-uid",
  }) as { row_attributes: Record<string, unknown> };
  expect(table.row_attributes).toEqual({ "data-uid": 1 });
});

it("refuses a kind mismatch: a table selector never resolves a pagination container", () => {
  const source = page(
    `<div class="c-pagination"><ul><li class="c-next"><a href="/x">3</a></li></ul></div>`,
  );
  expectHtmlError(
    () => capture(source, { kind: "table", classes: ["c-pagination"] }),
    "SELECTOR",
  );
});

it("resolves a zero-class (unscoped) table selector to the sole bare table", () => {
  const source = page(
    `<div>CHROME_TEXT_CANARY_X1</div>` +
      `<table><tr data-uid="R1"><td>CELL_ONE_7</td></tr></table>` +
      `<ul>LIST_TEXT_CANARY_X2</ul>`,
  );
  const table = capture(source, { kind: "table", classes: [] }) as {
    classes: string[];
    row_count: number;
    selector: { classes: string[] };
  };
  expect(table.row_count).toBe(1);
  expect(table.classes).toEqual([]);
  expect(table.selector.classes).toEqual([]);
});

it("fails closed when a zero-class table selector matches more than one table", () => {
  const source = page(
    `<table><tr><td>TABLE_A_CELL_6</td></tr></table>` +
      `<table><tr><td>TABLE_B_CELL_6</td></tr></table>`,
  );
  expectHtmlError(
    () => capture(source, { kind: "table", classes: [] }),
    "SELECTOR",
  );
});

it("accepts a trailing slash on void elements, with or without preceding whitespace", () => {
  const withWhitespace = page(
    `<div><br /></div><div><img /></div>` +
      `<table class="t"><tr><td>VOID_ONE_19</td></tr></table>`,
  );
  const noWhitespace = page(
    `<div><br/></div><div><img/></div>` +
      `<table class="t"><tr><td>VOID_ONE_19</td></tr></table>`,
  );
  for (const source of [withWhitespace, noWhitespace]) {
    const table = capture(source, { kind: "table", classes: ["t"] }) as {
      row_count: number;
    };
    expect(table.row_count).toBe(1);
  }
});

it("accepts the slash no-op form for every void tag name in the HTML5 spec set", () => {
  const voidTags = [
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "source",
    "track",
    "wbr",
  ];
  for (const tag of voidTags) {
    for (const whitespace of [" ", ""]) {
      const source = page(
        `<${tag}${whitespace}/>` +
          `<table class="t"><tr><td>VOID_SET_12</td></tr></table>`,
      );
      const table = capture(source, { kind: "table", classes: ["t"] }) as {
        row_count: number;
      };
      expect(table.row_count).toBe(1);
    }
  }
});

it("fails closed on a trailing slash of a non-void element, and on a non-trailing slash", () => {
  const entry: Entry = { kind: "table", classes: ["t"] };
  const body = `<table class="t"><tr><td>SLASH_FAIL_8</td></tr></table>`;
  for (const tag of ["div", "table", "td", "a", "li", "script"]) {
    expectHtmlError(
      () => capture(page(`<${tag} />` + body), entry),
      "PARSE",
      "SLASH_FAIL_8",
    );
  }
  for (const form of ["<br / >", "<br//>", "<br/ >", "<a href=\"/x\"/>", "<x-1 />"]) {
    expectHtmlError(
      () => capture(page(form + body), entry),
      "PARSE",
    );
  }
});

it("refuses allowlists with a keep mode, unknown keys, or empty selector lists", () => {
  for (const allowlist of [
    { version: "v", selectors: [{ kind: "table", classes: ["t"], mode: "keep" }] },
    { version: "v", selectors: [{ kind: "table", classes: ["t"], extra: 1 }] },
    { version: "v", selectors: [{ kind: "table" }] },
    { version: "v", selectors: [] },
  ]) {
    expectHtmlError(
      () => captureHtml(page(``), allowlist),
      "ALLOWLIST",
    );
  }
});

it("requires a non-empty allowlist version", () => {
  expectHtmlError(
    () => captureHtml(CANONICAL_PAGE, { version: "", selectors: [canonicalEntry()] }),
    "ALLOWLIST",
  );
});

it("reports the true row count while capping inspected rows at three", () => {
  const source = page(
    `<table class="t">` +
      `<tr data-uid="R1"><td>TEXT_A</td></tr>` +
      `<tr data-uid="R2"><td>TEXT_BB</td></tr>` +
      `<tr data-uid="R3"><td>TEXT_CCC</td></tr>` +
      `<tr data-uid="R4"><td>TEXT_BEYOND_CAP_THIS_IS_QUITE_LONG_INDEED</td></tr>` +
      `<tr data-uid="R5"><td>Z5</td></tr>` +
      `</table>`,
  );
  const table = capture(source, { kind: "table", classes: ["t"] }) as {
    row_count: number;
    rows_inspected: number;
    columns: Array<Record<string, unknown>>;
  };
  expect(table.row_count).toBe(5);
  expect(table.rows_inspected).toBe(3);
  expect(at(table.columns, 0).text_length).toEqual({ min: 6, max: 8 });
});

it("derives query parameters from rows inside the cap only", () => {
  const source = page(
    `<table class="t">` +
      `<tr><td><a href="/x?cHash=CAP_A">LINK</a></td></tr>` +
      `<tr><td><a href="/x?cHash=CAP_B">LINK</a></td></tr>` +
      `<tr><td><a href="/x?cHash=CAP_C">LINK</a></td></tr>` +
      `<tr><td><a href="/x?SECRET_PARAM_CANARY_K7L8=OUT_OF_CAP">LINK</a></td></tr>` +
      `</table>`,
  );
  const table = capture(source, { kind: "table", classes: ["t"] }) as {
    query_parameters: Record<string, unknown>;
  };
  expect(table.query_parameters).toEqual({ cHash: 3 });
});

it("omits the date format key when inspected rows disagree on the pattern", () => {
  const source = page(
    `<table class="t">` +
      `<tr><td>12.05.26</td></tr>` +
      `<tr><td>2026-05-12</td></tr>` +
      `</table>`,
  );
  const table = capture(source, { kind: "table", classes: ["t"] }) as {
    columns: Array<Record<string, unknown>>;
  };
  expect("date_format" in at(table.columns, 0)).toBe(false);
});

it("records a whole-cell anchor for a non-link column only when it is the cell's single content", () => {
  const source = page(
    `<table class="t">` +
      `<tr><td><a href="/x">WHOLE_ANCHOR_TEXT</a></td></tr>` +
      `<tr><td>LEAD_TEXT <a href="/x">CHILD_ANCHOR_TEXT</a></td></tr>` +
      `</table>`,
  );
  const table = capture(source, { kind: "table", classes: ["t"] }) as {
    columns: Array<Record<string, unknown>>;
  };
  expect(table.columns[0]).toMatchObject({
    content_class: "link",
    links: { present: 2, whole_cell: 1, child: 1 },
  });
});

it("reads nothing outside the selected element", () => {
  const source = page(
    `<div class="outside">` +
      `<table class="other">` +
      `<tr><td><a href="/decoy?SECRET_PARAM_CANARY_K7L8=V">DECOY_LINK_TEXT</a></td></tr>` +
      `</table>` +
    `</div>` +
      `<table class="t"><tr data-uid="SELECTED"><td>SELECTED_CELL_TEXT</td></tr></table>`,
  );
  const table = capture(source, { kind: "table", classes: ["t"] }) as {
    query_parameters: Record<string, unknown>;
  };
  const output = JSON.stringify(table);
  expect(output).not.toContain("SECRET_PARAM_CANARY_K7L8");
  expect(output).not.toContain("DECOY_LINK_TEXT");
  expect(table.query_parameters).toEqual({});
});

it("counts non-whitelisted tags as unparsed and reports zero when none are present", () => {
  const withUnparsed = page(CANONICAL_TABLE);
  const result = captureHtml(withUnparsed, {
    version: "t-1",
    selectors: [canonicalEntry()],
  });
  // The page chrome (html/head/meta/body) is whitelisted; p, nav, input are not.
  expect(result.unparsed).toBe(3);

  const cleanSource = `<table class="t"><tr><td>CLEAN_CELL_TEXT</td></tr></table>`;
  const cleanResult = captureHtml(cleanSource, {
    version: "t-1",
    selectors: [{ kind: "table", classes: ["t"] }],
  });
  expect(cleanResult.unparsed).toBe(0);
});

it("detects the scoped next link only inside the resolved container", () => {
  const entry: Entry = { kind: "pagination", classes: ["c-pagination"] };
  const source = page(
    `<div class="c-pagination"><ul class="c-content-pagination">` +
      `<li class="c-current">2</li>` +
      `<li class="c-next"><a href="/seite?page=3">3</a></li>` +
      `</ul></div>`,
  );
  const result = captureHtml(source, { version: "t-1", selectors: [entry] });
  expect(result.pagination[0]).toEqual({
    selector: { classes: ["c-pagination"], kind: "pagination" },
    present: true,
    classes: ["c-pagination"],
    next_link_present: true,
  });

  const lastPage = page(
    `<div class="c-pagination"><ul class="c-content-pagination">` +
      `<li class="c-last"><a href="/seite?page=2">2</a></li>` +
      `</ul></div>`,
  );
  const lastResult = captureHtml(lastPage, {
    version: "t-1",
    selectors: [entry],
  });
  expect(lastResult.pagination[0]?.next_link_present).toBe(false);
});

it("rejects a next link that is not a c-next list item or carries no anchor", () => {
  const entry: Entry = { kind: "pagination", classes: ["p"] };
  for (const body of [
    `<div class="p"><a href="/seite?next=3">3</a></div>`,
    `<div class="p"><li class="c-next">3 (no anchor)</li></div>`,
    `<div class="p"><span class="c-next"><a href="/seite?next=3">3</a></span></div>`,
    `<div class="p"><li class="c-next"><a name="n">not a link</a></li></div>`,
  ]) {
    const result = captureHtml(page(body), {
      version: "t-1",
      selectors: [entry],
    });
    expect(result.pagination[0]?.next_link_present).toBe(false);
  }
});

it("treats a c-next list item outside the resolved container as irrelevant", () => {
  const source = page(
    `<li class="c-next"><a href="/seite?next=3">OUTSIDE_LINK_TEXT</a></li>` +
    `<div class="p"><ul><li>2</li></ul></div>`,
  );
  const result = captureHtml(source, {
    version: "t-1",
    selectors: [{ kind: "pagination", classes: ["p"] }],
  });
  expect(result.pagination[0]?.next_link_present).toBe(false);
});

it("produces byte-identical results across repeated captures", () => {
  const once = captureHtml(CANONICAL_PAGE, {
    version: "t-1",
    selectors: [canonicalEntry()],
  });
  const twice = captureHtml(CANONICAL_PAGE, {
    version: "t-1",
    selectors: [canonicalEntry()],
  });
  expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
});

it("refuses attribute values on the selected element itself and records its attribute names", () => {
  const source = page(
    `<table class="t" id="CANARY_ID_VALUE_X9" data-table="STATE_CANARY_X1Y2">` +
      `<tr><td>ID_CELL_TEXT</td></tr>` +
      `</table>`,
  );
  const table = capture(source, { kind: "table", classes: ["t"] }) as {
    classes: string[];
  };
  const output = JSON.stringify(table);
  expect(output).not.toContain("CANARY_ID_VALUE_X9");
  expect(output).not.toContain("STATE_CANARY_X1Y2");
  expect(table.classes).toEqual(["t"]);
});

it("exercises a date column with a whole-cell anchor and reports the shared pattern", () => {
  const source = page(
    `<table class="t">` +
      `<tr><td><a href="/termine/termin?cHash=WHOLE_A">12.05.26</a></td></tr>` +
      `<tr><td><a href="/termine/termin?cHash=WHOLE_B">13.05.26</a></td></tr>` +
      `</table>`,
  );
  const table = capture(source, { kind: "table", classes: ["t"] }) as {
    columns: Array<Record<string, unknown>>;
    query_parameters: Record<string, number>;
  };
  expect(at(table.columns, 0)).toMatchObject({
    content_class: "link",
    links: { present: 2, whole_cell: 2, child: 0 },
    date_format: { pattern: "DD.MM.YY (two-digit year)", matches: 2 },
  });
  expect(table.query_parameters).toEqual({ cHash: 2 });
});

it("resolves a pagination selector when a table shares the class name", () => {
  // Both a table and a div carry class "shared"; a kind-scoped selector
  // must resolve the div, not fail for ambiguity.
  const source = page(
    `<table class="shared"><tr><td>SHARED_CELL_TEXT</td></tr></table>` +
      `<div class="shared"><ul><li class="c-next"><a href="/s?n=3">3</a></li></ul></div>`,
  );
  const result = captureHtml(source, {
    version: "t-1",
    selectors: [{ kind: "pagination", classes: ["shared"] }],
  });
  expect(result.tables).toEqual([]);
  expect(result.pagination[0]?.next_link_present).toBe(true);

  const tableResult = captureHtml(source, {
    version: "t-1",
    selectors: [{ kind: "table", classes: ["shared"] }],
  });
  expect(tableResult.pagination).toEqual([]);
  expect(tableResult.tables[0]).toBeDefined();
});

it("loads the synthetic canonical fixture from disk for the golden path", () => {
  const file = readFileSync(
    join(packageDir, "test", "fixtures", "html-canonical.html"),
    "utf8",
  );
  const result = captureHtml(file, {
    version: "t-1",
    selectors: [canonicalEntry()],
  });
  expect(result.tables[0]).toBeDefined();
});

describe("raw text elements (HTML5 raw text + escapable raw text)", () => {
  const entry: Entry = { kind: "table", classes: ["t"] };
  const realTable =
    `<table class="t" data-grid="raw-1">` +
    `<tr data-uid="r-01"><td>CELL_A</td><td><a href="/x?cHash=1">LK</a></td></tr>` +
    `<tr data-uid="r-02"><td>CELL_B</td><td><a href="/x?cHash=2&other=4">LK</a></td></tr>` +
    `</table>`;

  it("a < inside style and script content does not open a tag", () => {
    const source = page(
      `<style>a { content: "<div class=decoy>" }</style>` +
        `<script>if (a < b) { x("<td>RAW_NO_TAG</td>"); }</script>` +
        realTable
    );
    expect(capture(source, entry)).toBeDefined();
  });

  it("the legacy CDATA wrapper form inside style parses inert", () => {
    const source = page(
      `<style>/*<![CDATA[` +
        `body { margin: 0; color: "#888" }` +
        `/*]]>*/</style>` +
        realTable
    );
    expect(capture(source, entry)).toBeDefined();
  });

  it("end-tag matching is case-insensitive and accepts whitespace and slash terminators", () => {
    expect(capture(page(`<STYLE>RAW_CONTENT_ONE</STYLE>` + realTable), entry)).toBeDefined();
    expect(capture(page(`<style>RAW_CONTENT_TWO</style >` + realTable), entry)).toBeDefined();
    expect(capture(page(`<script>RAW_CONTENT_THREE</Script/>` + realTable), entry)).toBeDefined();
  });

  it("consumes content for all four raw-text elements, so inner markup stays inert", () => {
    const source = page(
      `<textarea>INERT <table class="t"><tr data-uid="z"></tr></table></textarea>` +
        `<style>.t { inner: "<td>" }</style>` +
        realTable
    );
    expect(capture(source, entry)).toBeDefined();
  });

  it("an unterminated raw-text element fails closed, without its content in the message", () => {
    for (const [tag, canary] of [
      ["style", "STYLE_UNTERM_CANARY"],
      ["script", "SCRIPT_UNTERM_CANARY"],
      ["textarea", "TEXTAREA_UNTERM_CANARY"],
    ] as const) {
      expectHtmlError(
        () => capture(page(`<${tag}>${canary}`), entry),
        "PARSE",
        canary,
      );
    }
    expectHtmlError(
      () =>
        captureHtml(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TITLE_UNTERM_CANARY`,
          { version: "t-1", selectors: [entry] },
        ),
      "PARSE",
      "TITLE_UNTERM_CANARY",
    );
  });

  it("raw-text content never reaches capture output", () => {
    const source =
      `<!DOCTYPE html><html><head><meta charset="utf-8">` +
      `<title>RW_CANARY_TITLE_TEXT</title></head><body>` +
      `<style>RW_CANARY_STYLE_TEXT a { content: "<td>" }</style>` +
      `<script>RW_CANARY_SCRIPT_TEXT x("<b>");</script>` +
      `<textarea>RW_CANARY_TEXTAREA_TEXT</textarea>` +
      realTable +
      `</body></html>`;
    const result = captureHtml(source, { version: "t-1", selectors: [entry] });
    expect(result.tables.length).toBe(1);
    const serialized = JSON.stringify(result);
    for (const canary of [
      "RW_CANARY_TITLE_TEXT",
      "RW_CANARY_STYLE_TEXT",
      "RW_CANARY_SCRIPT_TEXT",
      "RW_CANARY_TEXTAREA_TEXT",
    ]) {
      expect(serialized).not.toContain(canary);
    }
  });
});

describe("capture review defect pins", () => {
  const entry: Entry = { kind: "table", classes: ["t"] };

  it("entity-encoded query separators decode to clean parameter names", () => {
    const source = page(
      `<table class="t">` +
        `<tr data-uid="1"><td><a href="/p?&amp;a=1&amp;b=2">L</a></td></tr>` +
        `</table>`
    );
    const table = capture(source, entry) as { query_parameters: Record<string, number> };
    expect(table.query_parameters).toEqual({ a: 1, b: 1 });
  });

  it("numeric character references decode in URL hrefs, decimal and hex", () => {
    const hex = page(
      `<table class="t">` +
        `<tr data-uid="1"><td><a href="/p?a=1&#x26;cHash=3">L</a></td></tr>` +
        `</table>`
    );
    const hexTable = capture(hex, entry) as { query_parameters: Record<string, number> };
    expect(hexTable.query_parameters).toEqual({ a: 1, cHash: 1 });

    const dec = page(
      `<table class="t">` +
        `<tr data-uid="1"><td><a href="/p?a=1&#38;d4=2">L</a></td></tr>` +
        `</table>`
    );
    const decTable = capture(dec, entry) as { query_parameters: Record<string, number> };
    expect(decTable.query_parameters).toEqual({ a: 1, d4: 1 });
  });

  it("references outside the bounded surface are left untouched", () => {
    // `ampfoo` is not a predefined entity and has no `;`-terminated decode:
    // the name stays literal; a bare `&...` without `;` is untouched too.
    const source = page(
      `<table class="t">` +
        `<tr data-uid="1"><td><a href="/p?ampfoo;1=1&bare2=2">L</a></td></tr>` +
        `</table>`
    );
    const table = capture(source, entry) as { query_parameters: Record<string, number> };
    expect(table.query_parameters).toEqual({ "ampfoo;1": 1, bare2: 1 });
  });

  it("text length stays computed on the raw undecoded form", () => {
    const source = page(
      `<table class="t"><tr data-uid="1"><td>A&amp;B</td></tr></table>`
    );
    const table = capture(source, entry) as {
      columns: Array<{ text_length: { min: number; max: number } | null }>;
    };
    // "A&amp;B" is 7 code points raw; decoded it would be 5.
    expect(table.columns[0]?.text_length).toEqual({ min: 7, max: 7 });
  });

  it("pins the count semantics: per-anchor presence over inspected rows, deduped per href", () => {
    // Rows 1-3 are inspected (cap 3); row 4 is not.
    // anchor1 carries `a` twice in one href -> counts once for that anchor.
    // anchors 2 and 3 carry the name in two distinct anchors -> counts twice.
    // row 4's unique name must be absent entirely.
    const source = page(
      `<table class="t">` +
        `<tr data-uid="1">` +
        `<td><a href="/p?a=1&a=9&c=7">L</a></td>` +
        `<td><a href="/p?a=2">L</a><a href="/q?b=3">L</a></td>` +
        `</tr>` +
        `<tr data-uid="2"><td><a href="/p?d4=4">L</a></td></tr>` +
        `<tr data-uid="3"><td><a href="/x">L</a></td></tr>` +
        `<tr data-uid="4"><td><a href="/p?only_row4=5">L</a></td></tr>` +
        `</table>`
    );
    const table = capture(source, entry) as { query_parameters: Record<string, number> };
    expect(table.query_parameters).toEqual({ a: 2, b: 1, c: 1, d4: 1 });
  });

  it("pins the wire-form percent-encoding rule (names as written, no percent-decoding)", () => {
    const source = page(
      `<table class="t">` +
        `<tr data-uid="1">` +
        `<td><a href="/p?tx_pi%5Bclient%5D=1">L</a></td>` +
        `<td><a href="/p?x%5By%5D=2">L</a></td>` +
        `</tr>` +
        `</table>`
    );
    const table = capture(source, entry) as { query_parameters: Record<string, number> };
    expect(table.query_parameters).toEqual({ "tx_pi%5Bclient%5D": 1, "x%5By%5D": 1 });
  });

  it("row_count excludes thead rows and has_header reports the header", () => {
    const withHeader = page(
      `<table class="t">` +
        `<thead><tr><th>H1</th><th>H2</th><th>H3</th></tr></thead>` +
        `<tr data-uid="1"><td>1</td><td>2</td></tr>` +
        `<tr data-uid="2"><td>3</td><td>4</td></tr>` +
        `<tr data-uid="3"><td>5</td><td>6</td></tr>` +
        `</table>`
    );
    const headered = capture(withHeader, entry) as {
      row_count: number;
      has_header: boolean;
      column_count: number;
      uniform: boolean;
    };
    expect(headered.has_header).toBe(true);
    expect(headered.row_count).toBe(3);
    // Header rows are never profiled: column_count derives from the data
    // rows (2 cells each), not from the 3 header cells.
    expect(headered.column_count).toBe(2);
    expect(headered.uniform).toBe(true);

    const withoutHeader = page(
      `<table class="t">` +
        `<tr data-uid="1"><td>1</td><td>2</td></tr>` +
        `<tr data-uid="2"><td>3</td><td>4</td></tr>` +
        `</table>`
    );
    const headerless = capture(withoutHeader, entry) as {
      row_count: number;
      rows_inspected: number;
      has_header: boolean;
    };
    expect(headerless.has_header).toBe(false);
    expect(headerless.row_count).toBe(2);
    expect(headerless.rows_inspected).toBe(2);
  });

  it("thead + 4 data rows: profiles exactly data rows 1-3, never the header", () => {
    // Header two cells of 2 chars each; data cells of 3/4/5/99 chars.
    // If the header were profiled the min would drop to 2; if the 4th data
    // row slipped past the cap the max would jump to 99.
    const source = page(
      `<table class="t">` +
        `<thead><tr><th>HX</th><th>HY</th></tr></thead>` +
        `<tr data-uid="1"><td>abc</td></tr>` +
        `<tr data-uid="2"><td>abcd</td></tr>` +
        `<tr data-uid="3"><td>abcde</td></tr>` +
        `<tr data-uid="4"><td>${"A".repeat(99)}</td></tr>` +
        `</table>`
    );
    const table = capture(source, entry) as {
      row_count: number;
      rows_inspected: number;
      has_header: boolean;
      column_count: number;
      uniform: boolean;
      columns: Array<{ text_length: { min: number; max: number } | null }>;
    };
    expect(table.has_header).toBe(true);
    expect(table.row_count).toBe(4);
    expect(table.rows_inspected).toBe(3);
    expect(table.column_count).toBe(1);
    expect(table.uniform).toBe(true);
    expect(table.columns[0]?.text_length).toEqual({ min: 3, max: 5 });
  });

  it("thead + 1 data row: rows_inspected is 1, not 2", () => {
    const source = page(
      `<table class="t">` +
        `<thead><tr><th>H</th></tr></thead>` +
        `<tr data-uid="1"><td>abc</td></tr>` +
        `</table>`
    );
    const table = capture(source, entry) as {
      rows_inspected: number;
      row_count: number;
      has_header: boolean;
    };
    expect(table.has_header).toBe(true);
    expect(table.row_count).toBe(1);
    expect(table.rows_inspected).toBe(1);
  });

  it("a word header over a date-shaped column still detects the shared date pattern", () => {
    const source = page(
      `<table class="t">` +
        `<thead><tr><th>Hword</th></tr></thead>` +
        `<tr data-uid="1"><td>01.02.26</td></tr>` +
        `<tr data-uid="2"><td>15.03.27</td></tr>` +
        `<tr data-uid="3"><td>29.12.99</td></tr>` +
        `</table>`
    );
    const table = capture(source, entry) as {
      columns: Array<{
        text_length: { min: number; max: number } | null;
        date_format?: { pattern: string; matches: number };
      }>;
    };
    const col = table.columns[0];
    expect(col?.date_format).toEqual({
      pattern: "DD.MM.YY (two-digit year)",
      matches: 3,
    });
    // Header ("Hword", 5 code points) is excluded: all data cells are 8.
    expect(col?.text_length).toEqual({ min: 8, max: 8 });
  });
});
