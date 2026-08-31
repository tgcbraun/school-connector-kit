/**
 * HTML structural capturer (ADR-002, `capture_format` 2).
 *
 * Reads an HTML page and emits a structural description of the tables and
 * pagination containers named by an allowlist of selectors. It never emits
 * text content, attribute values, URL paths, or query-parameter values:
 * text is reported by code-point length only, and attribute and parameter
 * information is reported by name and count only.
 *
 * Attribute values are kept in the in-memory tree purely as a read source
 * for two things that this module is allowed to inspect: the class tokens
 * used for structural matching, and the `href` names of query parameters on
 * row anchors. No value is ever written to the output or to an error
 * message.
 *
 * Design decisions for this module (v1):
 *
 * - Strict, well-formedness-requiring parser. No implicit-close recovery,
 *   no entity decoding: input is parsed with a small token grammar and any
 *   structural deviation (unmatched or unclosed tag, unterminated comment
 *   or doctype, tag cut off at end of input, nested tags inside an open
 *   tag) fails closed with a fixed PARSE message.
 * - Selectors resolve structurally over the parsed tree: tag + class
 *   containment + ancestor scope classes + optional row attribute name. A
 *   selector with zero or more than one candidate fails closed with a
 *   fixed SELECTOR message that names only the selector's position.
 * - Analysis is confined by construction to the resolved element's
 *   subtree: nothing outside the selected element contributes to any
 *   payload field.
 * - Rows are capped at three (first, document order); `row_count` always
 *   reports the true count.
 * - `unparsed` counts tags outside the whitelist across the whole document
 *   (page chrome — html/head/body/meta/title/link — is whitelisted;
 *   content such as p/span/input/nav is not).
 * - The pagination next-link rule is fixed for v1: a `<li>` inside the
 *   resolved container whose class list contains `c-next` and which holds
 *   a descendant anchor with an `href` attribute.
 * - Date detection is shape-based over a fixed pattern set; only name and
 *   match count are reported, never the matched text.
 *
 * Deterministic: code-point string comparison only, no environment reads,
 * caller-supplied timestamps live in the envelope (not this module).
 */

export type HtmlCaptureErrorCode = "PARSE" | "ALLOWLIST" | "SELECTOR";

export class HtmlCaptureError extends Error {
  readonly code: HtmlCaptureErrorCode;

  constructor(code: HtmlCaptureErrorCode, message: string) {
    super(message);
    this.name = "HtmlCaptureError";
    this.code = code;
  }
}

export type HtmlSelectorKind = "table" | "pagination";

export interface HtmlSelectorEntry {
  readonly kind: HtmlSelectorKind;
  readonly classes: readonly string[];
  readonly scopes?: readonly string[];
  readonly row_attribute?: string;
}

export interface HtmlAllowlist {
  readonly version: string;
  readonly selectors: readonly HtmlSelectorEntry[];
}

export interface HtmlColumnCapture {
  readonly content_class: string;
  readonly text_length: { min: number; max: number } | null;
  readonly date_format?: { pattern: string; matches: number };
  readonly links: { present: number; whole_cell: number; child: number };
}

export interface HtmlTableCapture {
  readonly selector: HtmlSelectorEntry;
  readonly classes: readonly string[];
  readonly row_count: number;
  readonly rows_inspected: number;
  readonly column_count: number;
  readonly uniform: boolean;
  readonly columns: readonly HtmlColumnCapture[];
  readonly row_attributes: Record<string, number>;
  readonly query_parameters: Record<string, number>;
}

export interface HtmlPaginationCapture {
  readonly selector: HtmlSelectorEntry;
  readonly present: true;
  readonly classes: readonly string[];
  readonly next_link_present: boolean;
}

export interface HtmlCaptureResult {
  readonly tables: readonly HtmlTableCapture[];
  readonly pagination: readonly HtmlPaginationCapture[];
  readonly unparsed: number;
}

// ---------------------------------------------------------------------------
// Tree model
// ---------------------------------------------------------------------------

interface HtmlText {
  readonly type: "text";
  readonly text: string;
}

interface HtmlElement {
  readonly type: "element";
  readonly tag: string;
  readonly classes: readonly string[];
  readonly attributes: readonly string[];
  readonly values: Record<string, string>;
  readonly children: Array<HtmlText | HtmlElement>;
  parent: HtmlElement | null;
}

const VOID_TAGS: ReadonlySet<string> = new Set([
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
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Tags the captured page may legitimately contain anywhere. Any other tag
 * increments the per-request `unparsed` count.
 */
const WHITELISTED_TAGS: ReadonlySet<string> = new Set([
  "a",
  "body",
  "caption",
  "col",
  "colgroup",
  "div",
  "head",
  "html",
  "li",
  "link",
  "meta",
  "ol",
  "tfoot",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "title",
  "tr",
  "ul",
]);

/** Elements that may serve as the resolved pagination container. */
const PAGINATION_CONTAINER_TAGS: ReadonlySet<string> = new Set([
  "li",
  "div",
  "ol",
  "ul",
]);

const NEXT_LINK_CLASS = "c-next";
const ROW_INSPECTION_CAP = 3;

// ---------------------------------------------------------------------------
// Strict parser
// ---------------------------------------------------------------------------

function failParse(message: string): never {
  throw new HtmlCaptureError("PARSE", `html markup is not parseable: ${message}`);
}

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

function isNameChar(ch: string): boolean {
  return (
    isAlpha(ch) ||
    (ch >= "0" && ch <= "9") ||
    ch === ":" ||
    ch === "_" ||
    ch === "-"
  );
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

class Parser {
  private pos: number;

  constructor(
    private readonly source: string,
    start = 0,
  ) {
    this.pos = start;
  }

  parseRoot(): HtmlElement {
    const root: HtmlElement = {
      type: "element",
      tag: "#document",
      classes: [],
      attributes: [],
      values: {},
      children: [],
      parent: null,
    };
    const stack: HtmlElement[] = [root];
    const top = (): HtmlElement => {
      const element = stack[stack.length - 1];
      if (element === undefined) {
        failParse("internal: empty stack");
      }
      return element;
    };
    while (this.pos < this.source.length) {
      if (this.source.charAt(this.pos) !== "<") {
        const next = this.source.indexOf("<", this.pos);
        const end = next === -1 ? this.source.length : next;
        top().children.push({
          type: "text",
          text: this.source.slice(this.pos, end),
        });
        this.pos = end;
        continue;
      }
      if (this.source.startsWith("<!--", this.pos)) {
        const close = this.source.indexOf("-->", this.pos + 4);
        if (close === -1) {
          failParse("unterminated comment");
        }
        this.pos = close + 3;
        continue;
      }
      if (
        this.pos + 2 < this.source.length &&
        this.source.charAt(this.pos + 1) === "!" &&
        isAlpha(this.source.charAt(this.pos + 2))
      ) {
        // Doctype or processing-instruction-like token: skip to its close.
        const close = this.source.indexOf(">", this.pos + 1);
        if (close === -1) {
          failParse("unterminated doctype");
        }
        this.pos = close + 1;
        continue;
      }
      if (this.source.startsWith("</", this.pos)) {
        const name = this.parseCloseTag();
        const current = top();
        if (current.tag !== name) {
          failParse("unmatched closing tag");
        }
        stack.pop();
        continue;
      }
      const parent = top();
      const element = this.parseOpenTag(parent);
      parent.children.push(element);
      if (!VOID_TAGS.has(element.tag)) {
        stack.push(element);
      }
    }
    if (stack.length > 1) {
      failParse("unclosed elements at end of input");
    }
    return root;
  }

  private parseCloseTag(): string {
    let i = this.pos + 2;
    if (i >= this.source.length || !isAlpha(this.source.charAt(i))) {
      failParse("malformed closing tag");
    }
    const start = i;
    while (i < this.source.length && isNameChar(this.source.charAt(i))) {
      i += 1;
    }
    while (i < this.source.length && isSpace(this.source.charAt(i))) {
      i += 1;
    }
    if (i >= this.source.length || this.source.charAt(i) !== ">") {
      failParse("malformed closing tag");
    }
    const name = this.source.slice(start, i).toLowerCase();
    this.pos = i + 1;
    return name;
  }

  private parseOpenTag(parent: HtmlElement): HtmlElement {
    let i = this.pos + 1;
    if (i >= this.source.length || !isAlpha(this.source.charAt(i))) {
      failParse("malformed opening tag");
    }
    const nameStart = i;
    while (i < this.source.length && isNameChar(this.source.charAt(i))) {
      i += 1;
    }
    if (i === nameStart) {
      failParse("malformed opening tag");
    }
    const tag = this.source.slice(nameStart, i).toLowerCase();
    const attributes: string[] = [];
    const values: Record<string, string> = {};
    for (;;) {
      while (i < this.source.length && isSpace(this.source.charAt(i))) {
        i += 1;
      }
      if (i >= this.source.length) {
        failParse("unclosed opening tag");
      }
      const ch = this.source.charAt(i);
      if (ch === ">") {
        i += 1;
        break;
      }
      if (ch === "<") {
        failParse("nested tag inside an open tag");
      }
      if (ch === "/") {
        failParse("self-closing slash is not part of the v1 grammar");
      }
      if (!isAlpha(ch)) {
        failParse("malformed attribute name");
      }
      const attrStart = i;
      while (i < this.source.length && isNameChar(this.source.charAt(i))) {
        i += 1;
      }
      if (i === attrStart) {
        failParse("malformed attribute name");
      }
      const attrName = this.source.slice(attrStart, i).toLowerCase();
      if (attributes.indexOf(attrName) === -1) {
        attributes.push(attrName);
      }
      while (i < this.source.length && isSpace(this.source.charAt(i))) {
        i += 1;
      }
      if (i >= this.source.length) {
        failParse("unclosed opening tag");
      }
      if (this.source.charAt(i) !== "=") {
        continue; // boolean attribute
      }
      i += 1;
      while (i < this.source.length && isSpace(this.source.charAt(i))) {
        i += 1;
      }
      if (i >= this.source.length) {
        failParse("unclosed opening tag");
      }
      const quote = this.source.charAt(i);
      if (quote === "\"" || quote === "'") {
        const close = this.source.indexOf(quote, i + 1);
        if (close === -1) {
          failParse("unterminated attribute value");
        }
        values[attrName] = this.source.slice(i + 1, close);
        i = close + 1;
      } else {
        const bareStart = i;
        while (
          i < this.source.length &&
          !isSpace(this.source.charAt(i)) &&
          this.source.charAt(i) !== ">"
        ) {
          i += 1;
        }
        if (i === bareStart) {
          failParse("malformed attribute value");
        }
        values[attrName] = this.source.slice(bareStart, i);
      }
    }
    const classes: string[] = [];
    const classValue = values["class"];
    if (classValue !== undefined) {
      for (const token of classValue.split(/[\s\u00a0]+/)) {
        if (token.length > 0 && classes.indexOf(token) === -1) {
          classes.push(token);
        }
      }
    }
    this.pos = i;
    return {
      type: "element",
      tag,
      classes,
      attributes,
      values,
      children: [],
      parent,
    };
  }
}

export function parseHtml(source: string): HtmlElement {
  if (typeof source !== "string") {
    failParse("source must be a string");
  }
  return new Parser(source).parseRoot();
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

function* descendants(el: HtmlElement): Generator<HtmlElement> {
  for (const child of el.children) {
    if (child.type !== "element") {
      continue;
    }
    yield child;
    yield* descendants(child);
  }
}

function textOf(el: HtmlElement): string {
  let out = "";
  for (const child of el.children) {
    if (child.type === "text") {
      out += child.text;
    } else {
      out += textOf(child);
    }
  }
  return out;
}

function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) {
    count += 1;
  }
  return count;
}

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function sortedKeyMap(record: Record<string, number>): Record<string, number> {
  const keys = Object.keys(record).sort(compareStrings);
  const out: Record<string, number> = {};
  for (const key of keys) {
    out[key] = record[key] ?? 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Date shape patterns (fixed v1 set; name + count only, never the text)
// ---------------------------------------------------------------------------

interface DatePattern {
  readonly pattern: string;
  readonly full: RegExp;
  readonly fragment: RegExp;
}

const DATE_PATTERNS: readonly DatePattern[] = [
  {
    pattern: "DD.MM.YY (two-digit year)",
    full: /^\d{1,2}\.\d{1,2}\.\d{2}$/,
    fragment: /\d{1,2}\.\d{1,2}\.\d{2}/,
  },
  {
    pattern: "DD.MM.YYYY (four-digit year)",
    full: /^\d{1,2}\.\d{1,2}\.\d{4}$/,
    fragment: /\d{1,2}\.\d{1,2}\.\d{4}/,
  },
  {
    pattern: "DD.MM. (no year)",
    full: /^\d{1,2}\.\d{1,2}\.?$/,
    fragment: /\d{1,2}\.\d{1,2}\.?(?!\d)/,
  },
  {
    pattern: "YYYY-MM-DD (ISO)",
    full: /^\d{4}-\d{2}-\d{2}$/,
    fragment: /\d{4}-\d{2}-\d{2}/,
  },
  {
    pattern: "DD/MM/Y or YYYY",
    full: /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
    fragment: /\d{1,2}\/\d{1,2}\/\d{2,4}/,
  },
];

function fullDatePattern(text: string): string | undefined {
  for (const candidate of DATE_PATTERNS) {
    if (candidate.full.test(text)) {
      return candidate.pattern;
    }
  }
  return undefined;
}

function hasDateFragment(text: string): boolean {
  return DATE_PATTERNS.some((candidate) => candidate.fragment.test(text));
}

// ---------------------------------------------------------------------------
// Allowlist validation (strict; no keep mode; unknown keys refused)
// ---------------------------------------------------------------------------

function failAllowlist(message: string): never {
  throw new HtmlCaptureError("ALLOWLIST", `html allowlist is invalid: ${message}`);
}

function requireNonEmptyString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    failAllowlist(`${what} must be a non-empty string`);
  }
  return value;
}

function requireNonEmptyStringArray(value: unknown, what: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    failAllowlist(`${what} must be a non-empty array of non-empty strings`);
  }
  return value as readonly string[];
}

function checkExactKeys(
  keys: readonly string[],
  required: readonly string[],
  optional: readonly string[],
  missingMessage: string,
  unknownMessage: string,
): void {
  const seen = new Set<string>(keys);
  for (const key of keys) {
    if (!required.includes(key) && !optional.includes(key)) {
      failAllowlist(unknownMessage);
    }
  }
  for (const key of required) {
    if (!seen.has(key)) {
      failAllowlist(missingMessage);
    }
  }
}

function validateSelector(raw: unknown, index: number): HtmlSelectorEntry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    failAllowlist(`selector [${index}] must be an object`);
  }
  const record = raw as Record<string, unknown>;
  checkExactKeys(
    Object.keys(record),
    ["kind", "classes"],
    ["scopes", "row_attribute"],
    `selector [${index}] is missing a required key`,
    `selector [${index}] has an unknown key`,
  );
  const kind = record.kind;
  if (kind !== "table" && kind !== "pagination") {
    failAllowlist(`selector [${index}] has an unknown kind`);
  }
  const classes = requireNonEmptyStringArray(
    record.classes,
    `selector [${index}] classes`,
  );
  let scopes: readonly string[] | undefined;
  if ("scopes" in record) {
    scopes = requireNonEmptyStringArray(
      record.scopes,
      `selector [${index}] scopes`,
    );
  }
  let rowAttribute: string | undefined;
  if ("row_attribute" in record) {
    rowAttribute = requireNonEmptyString(
      record.row_attribute,
      `selector [${index}] row_attribute`,
    );
    if (kind !== "table") {
      failAllowlist(
        `selector [${index}] row_attribute is not allowed on a pagination selector`,
      );
    }
  }
  const entry: Record<string, unknown> = { kind, classes };
  if (scopes !== undefined) {
    entry.scopes = scopes;
  }
  if (rowAttribute !== undefined) {
    entry.row_attribute = rowAttribute;
  }
  return entry as unknown as HtmlSelectorEntry;
}

export function validateHtmlAllowlist(raw: unknown): HtmlAllowlist {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    failAllowlist("allowlist must be an object");
  }
  const record = raw as Record<string, unknown>;
  checkExactKeys(
    Object.keys(record),
    ["version", "selectors"],
    [],
    "allowlist is missing a required key",
    "allowlist has an unknown key",
  );
  const version = requireNonEmptyString(record.version, "allowlist version");
  if (!Array.isArray(record.selectors) || record.selectors.length === 0) {
    failAllowlist("selectors must be a non-empty array");
  }
  const selectors = (record.selectors as unknown[]).map((entry, index) =>
    validateSelector(entry, index),
  );
  return { version, selectors };
}

// ---------------------------------------------------------------------------
// Structural selector resolution
// ---------------------------------------------------------------------------

function scopesSatisfied(el: HtmlElement, scopes: readonly string[] | undefined): boolean {
  if (scopes === undefined || scopes.length === 0) {
    return true;
  }
  let ancestor = el.parent;
  while (ancestor !== null) {
    const current = ancestor;
    if (scopes.every((scope) => current.classes.includes(scope))) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
}

function resolveExactlyOne(
  root: HtmlElement,
  index: number,
  entry: HtmlSelectorEntry,
): HtmlElement {
  const candidates: HtmlElement[] = [];
  for (const el of descendants(root)) {
    if (entry.kind === "table") {
      if (el.tag !== "table") {
        continue;
      }
    } else if (!PAGINATION_CONTAINER_TAGS.has(el.tag)) {
      continue;
    }
    if (!entry.classes.every((cls) => el.classes.includes(cls))) {
      continue;
    }
    if (!scopesSatisfied(el, entry.scopes)) {
      continue;
    }
    if (entry.kind === "table" && entry.row_attribute !== undefined) {
      const wanted = entry.row_attribute;
      const hasRow = [...descendants(el)].some(
        (d) => d.tag === "tr" && d.attributes.includes(wanted),
      );
      if (!hasRow) {
        continue;
      }
    }
    candidates.push(el);
  }
  if (candidates.length === 0) {
    throw new HtmlCaptureError(
      "SELECTOR",
      `selector [${index}] resolves to zero elements (allowlist names a selector the page does not contain)`,
    );
  }
  if (candidates.length > 1) {
    throw new HtmlCaptureError(
      "SELECTOR",
      `selector [${index}] resolves to ${candidates.length} elements (expected exactly one)`,
    );
  }
  const resolved = candidates[0];
  if (resolved === undefined) {
    throw new HtmlCaptureError("SELECTOR", "internal: no candidate");
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Table analysis (confined to the resolved element's subtree)
// ---------------------------------------------------------------------------

function cellElements(row: HtmlElement): readonly HtmlElement[] {
  const cells: HtmlElement[] = [];
  for (const child of row.children) {
    if (child.type === "element" && (child.tag === "td" || child.tag === "th")) {
      cells.push(child);
    }
  }
  return cells;
}

function collectAnchors(el: HtmlElement): HtmlElement[] {
  const anchors: HtmlElement[] = [];
  const stack: HtmlElement[] = [el];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    if (current.tag === "a" && current.attributes.includes("href")) {
      anchors.push(current);
    }
    for (const child of current.children) {
      if (child.type === "element") {
        stack.push(child);
      }
    }
  }
  return anchors;
}

interface CellFeatures {
  readonly text: string;
  readonly hasLink: boolean;
  readonly whole: boolean;
}

function cellFeatures(cell: HtmlElement): CellFeatures {
  const text = textOf(cell).trim();
  const anchors = collectAnchors(cell);
  const hasLink = anchors.length > 0;
  let whole = false;
  if (hasLink) {
    const elementChildren: HtmlElement[] = [];
    let outsideText = false;
    for (const child of cell.children) {
      if (child.type === "element") {
        elementChildren.push(child);
      } else if (child.text.trim().length > 0) {
        outsideText = true;
      }
    }
    const first = elementChildren[0];
    if (
      elementChildren.length === 1 &&
      first !== undefined &&
      !outsideText &&
      first.tag === "a" &&
      first.attributes.includes("href")
    ) {
      whole = true;
    }
  }
  return { text, hasLink, whole };
}

function classifyCell(text: string, hasLink: boolean): string {
  if (text.length === 0 && !hasLink) {
    return "empty";
  }
  if (hasLink) {
    // A link cell whose text is a pure date shape stays "link" (the date
    // shape is separately recorded via date_format); a link cell mixing a
    // date shape with other text is "mixed".
    if (hasDateFragment(text) && fullDatePattern(text) === undefined) {
      return "mixed";
    }
    return "link";
  }
  if (hasDateFragment(text)) {
    return "date";
  }
  return "text";
}

function queryParameterNames(href: string): string[] {
  const question = href.indexOf("?");
  if (question === -1) {
    return [];
  }
  let query = href.slice(question + 1);
  const fragment = query.indexOf("#");
  if (fragment !== -1) {
    query = query.slice(0, fragment);
  }
  const names: string[] = [];
  for (const pair of query.split("&")) {
    if (pair.length === 0) {
      continue;
    }
    const equals = pair.indexOf("=");
    const name = equals === -1 ? pair : pair.slice(0, equals);
    if (name.length > 0 && names.indexOf(name) === -1) {
      names.push(name);
    }
  }
  return names;
}

function analyzeColumn(cells: readonly HtmlElement[]): HtmlColumnCapture {
  const features = cells.map((cell) => cellFeatures(cell));
  const classList = features.map((feature) =>
    classifyCell(feature.text, feature.hasLink),
  );
  const first = classList[0];
  const unanimous = first !== undefined && classList.every((cls) => cls === first);
  const contentClass = unanimous ? (first as string) : "mixed";

  const lengths = features
    .map((feature) => codePointLength(feature.text))
    .filter((len) => len > 0);
  const textLength =
    lengths.length === 0
      ? null
      : { min: Math.min(...lengths), max: Math.max(...lengths) };

  const datePatterns: string[] = [];
  for (const feature of features) {
    const pattern = fullDatePattern(feature.text);
    if (pattern !== undefined) {
      datePatterns.push(pattern);
    }
  }

  const present = features.filter((feature) => feature.hasLink).length;
  const whole = features.filter((feature) => feature.hasLink && feature.whole).length;
  const child = features.filter((feature) => feature.hasLink && !feature.whole).length;

  const base: HtmlColumnCapture = {
    content_class: contentClass,
    text_length: textLength,
    links: { present, whole_cell: whole, child },
  };

  const firstPattern = datePatterns[0];
  if (
    datePatterns.length > 0 &&
    firstPattern !== undefined &&
    datePatterns.every((p) => p === firstPattern)
  ) {
    return {
      ...base,
      date_format: { pattern: firstPattern, matches: datePatterns.length },
    };
  }
  return base;
}

function echoSelector(entry: HtmlSelectorEntry): HtmlSelectorEntry {
  const echo: Record<string, unknown> = {
    kind: entry.kind,
    classes: [...entry.classes].sort(compareStrings),
  };
  if (entry.scopes !== undefined) {
    echo.scopes = [...entry.scopes].sort(compareStrings);
  }
  if (entry.row_attribute !== undefined) {
    echo.row_attribute = entry.row_attribute;
  }
  return echo as unknown as HtmlSelectorEntry;
}

function analyzeTable(el: HtmlElement, entry: HtmlSelectorEntry): HtmlTableCapture {
  const rows = [...descendants(el)].filter((d) => d.tag === "tr");
  const rowCount = rows.length;
  const inspected = rows.slice(0, ROW_INSPECTION_CAP);

  const widths = rows.map((row) => cellElements(row).length);
  const columnCount = widths.length === 0 ? 0 : Math.max(...widths);
  const uniform = widths.every((width) => width === columnCount);

  const inspectedWidths = inspected.map((row) => cellElements(row).length);
  const maxInspected =
    inspectedWidths.length === 0 ? 0 : Math.max(...inspectedWidths);

  const columns: HtmlColumnCapture[] = [];
  for (let i = 0; i < maxInspected; i++) {
    const cells: HtmlElement[] = [];
    for (const row of inspected) {
      const cell = cellElements(row)[i];
      if (cell !== undefined) {
        cells.push(cell);
      }
    }
    if (cells.length > 0) {
      columns.push(analyzeColumn(cells));
    }
  }

  const rowAttributes: Record<string, number> = {};
  for (const row of inspected) {
    for (const attr of row.attributes) {
      rowAttributes[attr] = (rowAttributes[attr] ?? 0) + 1;
    }
  }

  const parameterCounts: Record<string, number> = {};
  for (const row of inspected) {
    for (const cell of cellElements(row)) {
      for (const anchor of collectAnchors(cell)) {
        const href = anchor.values["href"];
        if (href === undefined) {
          continue;
        }
        for (const name of queryParameterNames(href)) {
          parameterCounts[name] = (parameterCounts[name] ?? 0) + 1;
        }
      }
    }
  }

  return {
    selector: echoSelector(entry),
    classes: [...el.classes].sort(compareStrings),
    row_count: rowCount,
    rows_inspected: inspected.length,
    column_count: columnCount,
    uniform,
    columns,
    row_attributes: sortedKeyMap(rowAttributes),
    query_parameters: sortedKeyMap(parameterCounts),
  };
}

// ---------------------------------------------------------------------------
// Pagination analysis (confined to the resolved container's subtree)
// ---------------------------------------------------------------------------

function anchorInside(el: HtmlElement): boolean {
  const stack: HtmlElement[] = [el];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    for (const child of current.children) {
      if (child.type !== "element") {
        continue;
      }
      if (child.tag === "a" && child.attributes.includes("href")) {
        return true;
      }
      stack.push(child);
    }
  }
  return false;
}

function analyzePagination(el: HtmlElement, entry: HtmlSelectorEntry): HtmlPaginationCapture {
  let nextLinkPresent = false;
  for (const d of descendants(el)) {
    if (d.tag !== "li" || !d.classes.includes(NEXT_LINK_CLASS)) {
      continue;
    }
    if (anchorInside(d)) {
      nextLinkPresent = true;
      break;
    }
  }
  return {
    selector: echoSelector(entry),
    present: true,
    classes: [...el.classes].sort(compareStrings),
    next_link_present: nextLinkPresent,
  };
}

// ---------------------------------------------------------------------------
// Unparsed tag count (whole document; tag names only)
// ---------------------------------------------------------------------------

function countUnparsed(root: HtmlElement): number {
  let count = 0;
  for (const d of descendants(root)) {
    if (!WHITELISTED_TAGS.has(d.tag)) {
      count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function captureHtml(source: string, allowlist: unknown): HtmlCaptureResult {
  if (typeof source !== "string") {
    failParse("source must be a string");
  }
  const validated = validateHtmlAllowlist(allowlist);
  const root = parseHtml(source);
  const tables: HtmlTableCapture[] = [];
  const pagination: HtmlPaginationCapture[] = [];
  for (let i = 0; i < validated.selectors.length; i++) {
    const entry = validated.selectors[i];
    if (entry === undefined) {
      continue;
    }
    const el = resolveExactlyOne(root, i, entry);
    if (entry.kind === "table") {
      tables.push(analyzeTable(el, entry));
    } else {
      pagination.push(analyzePagination(el, entry));
    }
  }
  return {
    tables,
    pagination,
    unparsed: countUnparsed(root),
  };
}
