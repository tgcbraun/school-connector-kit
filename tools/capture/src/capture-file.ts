import type { RedactionResult } from "./redactor.js";
import type {
  HtmlColumnCapture,
  HtmlPaginationCapture,
  HtmlTableCapture,
} from "./html-capture.js";

/**
 * Serialization contract of a CaptureFile. `capture_format` identifies the
 * shape of this document for future readers; it is a constant, not a
 * caller-supplied value.
 */
export const CAPTURE_FORMAT = 1;

/** Format-2 sibling: the HTML structural capture document (ADR-002). */
export const HTML_CAPTURE_FORMAT = 2;

/** A single captured request, already redacted by the Redactor. */
export interface CaptureRequest {
  method: string;
  urlTemplate: string;
  status: number;
  redaction: RedactionResult;
}

/**
 * Caller-supplied input. All fields that the model cannot derive itself
 * (captured_at, url_template, platform, allowlist_version, the redaction
 * result) are the caller's responsibility: this model never calls the clock,
 * inspects URLs, performs I/O, reads the environment, or logs.
 */
export interface CaptureFileInput {
  platform: string;
  allowlistVersion: string;
  /** ISO 8601 UTC timestamp ending in "Z", supplied by the caller. */
  capturedAt: string;
  /** Request order is preserved exactly as supplied. */
  requests: readonly CaptureRequest[];
}

const CAPTURED_AT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Strict structural check for a UTC ISO 8601 timestamp ending in "Z".
 * Deliberately string-based (no Date parsing): values with a timezone
 * offset, a non-"T" separator, lowercase "z", or a calendar-impossible
 * date are rejected, and nothing is ever converted to or from UTC.
 */
export function isValidUtcIso8601(value: string): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const match = CAPTURED_AT_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (month < 1 || month > 12) {
    return false;
  }

  let daysInMonth = DAYS_IN_MONTH[month - 1];
  if (daysInMonth === undefined) {
    return false;
  }
  if (month === 2 && isLeapYear(year)) {
    daysInMonth = 29;
  }
  if (day < 1 || day > daysInMonth) {
    return false;
  }

  return hour <= 23 && minute <= 59 && second <= 59;
}

/**
 * Throws with a field-scoped message; kept separate from `Error`'s
 * built-ins so callers can distinguish validation failures if they want.
 */
export class CaptureValidationError extends Error {
  constructor(field: string, reason: string) {
    super(`${field}: ${reason}`);
    this.name = "CaptureValidationError";
  }
}

function requireNonEmptyString(
  field: string,
  value: unknown,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CaptureValidationError(field, "must be a non-empty string");
  }
}

function requireStatus(field: string, value: unknown): void {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 100 ||
    value > 599
  ) {
    throw new CaptureValidationError(
      field,
      "must be an integer HTTP status code in the range 100..599",
    );
  }
}

function requireDroppedPaths(field: string, value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new CaptureValidationError(
      field,
      "must be an array of strings (RedactionResult.droppedPaths)",
    );
  }
}

function requireArrayLengths(field: string, value: unknown): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new CaptureValidationError(
      field,
      "must be an object (RedactionResult.arrayLengths)",
    );
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw new CaptureValidationError(
        `${field}.${key}`,
        "must be a finite number (RedactionResult.arrayLengths value)",
      );
    }
  }
}

/** Code point order: deterministic on every platform, locale-independent. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A deterministic, serializable model of an already-redacted request
 * capture.
 *
 * Guarantees:
 * - `captured_at` is exactly the caller-supplied string; the model never
 *   reads the clock or converts timestamps.
 * - `url_template` is passed through as supplied; the model never inspects
 *   or derives URLs.
 * - `shape`, `dropped_paths`, and `array_lengths` carry the Redactor's
 *   output verbatim in content; `array_lengths` keys and `dropped_paths`
 *   are re-emitted in code point order so serialization is byte-stable
 *   regardless of the input's key order.
 * - No HTTP, no file I/O, no environment access, no logging.
 */
export class CaptureFile {
  private readonly input: CaptureFileInput;

  private constructor(input: CaptureFileInput) {
    this.input = input;
  }

  /** Validates the input (throws CaptureValidationError) and builds the model. */
  static create(input: CaptureFileInput): CaptureFile {
    if (input === null || typeof input !== "object") {
      throw new CaptureValidationError("input", "must be an object");
    }

    requireNonEmptyString("platform", input.platform);
    requireNonEmptyString("allowlist_version", input.allowlistVersion);

    if (!isValidUtcIso8601(input.capturedAt)) {
      throw new CaptureValidationError(
        "captured_at",
        'must be a valid UTC ISO 8601 timestamp ending in "Z" ' +
          '(example: "2025-06-15T08:30:00Z"); local or offset timestamps ' +
          "are rejected, never converted",
      );
    }

    if (!Array.isArray(input.requests)) {
      throw new CaptureValidationError("requests", "must be an array");
    }

    input.requests.forEach((request, index) => {
      const prefix = `requests[${index}]`;

      if (request === null || typeof request !== "object") {
        throw new CaptureValidationError(prefix, "must be an object");
      }

      requireNonEmptyString(`${prefix}.method`, request.method);
      requireNonEmptyString(`${prefix}.url_template`, request.urlTemplate);
      requireStatus(`${prefix}.status`, request.status);

      const redaction = request.redaction;
      if (redaction === null || typeof redaction !== "object") {
        throw new CaptureValidationError(
          `${prefix}.redaction`,
          "must be a RedactionResult object produced by the Redactor",
        );
      }

      requireDroppedPaths(
        `${prefix}.redaction.droppedPaths`,
        redaction.droppedPaths,
      );
      requireArrayLengths(
        `${prefix}.redaction.arrayLengths`,
        redaction.arrayLengths,
      );
    });

    return new CaptureFile(input);
  }

  /**
   * Serializes to a deterministic JSON string. Object keys are emitted in a
   * fixed canonical order; request order is preserved exactly as supplied.
   * Compact by default; pass an indent (e.g. 2) for pretty output — key
   * order and content are identical either way.
   */
  toJson(indent?: number): string {
    const { platform, allowlistVersion, capturedAt, requests } = this.input;

    const serializedRequests = requests.map((request) => ({
      method: request.method,
      url_template: request.urlTemplate,
      status: request.status,
      shape: request.redaction.shape,
      dropped_paths: [...request.redaction.droppedPaths].sort(
        compareStrings,
      ),
      array_lengths: Object.fromEntries(
        Object.entries(request.redaction.arrayLengths).sort(
          ([a], [b]) => compareStrings(a, b),
        ),
      ),
    }));

    const document = {
      capture_format: CAPTURE_FORMAT,
      platform,
      allowlist_version: allowlistVersion,
      captured_at: capturedAt,
      requests: serializedRequests,
    };

    return JSON.stringify(document, null, indent);
  }
}

// ---------------------------------------------------------------------------
// capture_format 2 — HTML structural capture (ADR-002)
//
// A sibling of the format-1 document: same caller-supplied envelope, same
// strictness rules, same deterministic serialization helpers — shared here,
// never duplicated. Payload entries are the validated products of
// `html-capture.ts`; this model never traverses HTML itself.
// ---------------------------------------------------------------------------

/** One captured request carrying HTML structural payloads. */
export interface HtmlCaptureRequestInput {
  method: string;
  urlTemplate: string;
  status: number;
  tables: readonly HtmlTableCapture[];
  pagination: readonly HtmlPaginationCapture[];
  /** Non-negative integer; the `unparsed` key is omitted from JSON when 0. */
  unparsed: number;
}

export interface HtmlCaptureFileInput {
  platform: string;
  allowlistVersion: string;
  capturedAt: string;
  requests: readonly HtmlCaptureRequestInput[];
}

function requireNonNegativeInt(field: string, value: unknown): void {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new CaptureValidationError(field, "must be a non-negative integer");
  }
}

function requireFiniteNumber(field: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CaptureValidationError(field, "must be a finite number");
  }
}

function requireBoolean(field: string, value: unknown): void {
  if (typeof value !== "boolean") {
    throw new CaptureValidationError(field, "must be a boolean");
  }
}

function requireStringArray(
  field: string,
  value: unknown,
  nonEmpty: boolean,
): void {
  const ok =
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "string" &&
        (nonEmpty ? entry.length > 0 : true),
    );
  if (!ok) {
    throw new CaptureValidationError(
      field,
      nonEmpty
        ? "must be a non-empty array of non-empty strings"
        : "must be an array of strings",
    );
  }
  if (nonEmpty && (value as readonly unknown[]).length === 0) {
    throw new CaptureValidationError(
      field,
      "must be a non-empty array of non-empty strings",
    );
  }
}

function requirePlainObject(field: string, value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CaptureValidationError(field, "must be an object");
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  field: string,
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): void {
  const seen = new Set<string>(Object.keys(value));
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new CaptureValidationError(
        `${field}.${key}`,
        "is not a recognized key",
      );
    }
  }
  for (const key of required) {
    if (!seen.has(key)) {
      throw new CaptureValidationError(`${field}.${key}`, "is required");
    }
  }
}

function assertSelector(
  field: string,
  value: unknown,
  kind: "table" | "pagination",
): void {
  const record = requirePlainObject(field, value);
  requireExactKeys(field, record, ["kind", "classes"], [
    "scopes",
    "row_attribute",
  ]);
  if (record.kind !== kind) {
    throw new CaptureValidationError(`${field}.kind`, `must be "${kind}"`);
  }
  requireStringArray(`${field}.classes`, record.classes, true);
  if ("scopes" in record) {
    requireStringArray(`${field}.scopes`, record.scopes, true);
  }
  if ("row_attribute" in record) {
    requireNonEmptyString(`${field}.row_attribute`, record.row_attribute);
  }
  if (
    kind === "pagination" &&
    "row_attribute" in record
  ) {
    throw new CaptureValidationError(
      `${field}.row_attribute`,
      "is not allowed on a pagination selector",
    );
  }
}

function assertCountMap(
  field: string,
  value: unknown,
): void {
  const record = requirePlainObject(field, value);
  for (const [key, entry] of Object.entries(record)) {
    if (typeof key !== "string" || key.length === 0) {
      throw new CaptureValidationError(field, "keys must be non-empty strings");
    }
    requireNonNegativeInt(`${field}.${key}`, entry);
  }
}

function assertLinks(
  field: string,
  value: unknown,
): void {
  const record = requirePlainObject(field, value);
  requireExactKeys(field, record, ["present", "whole_cell", "child"], []);
  requireNonNegativeInt(`${field}.present`, record.present);
  requireNonNegativeInt(`${field}.whole_cell`, record.whole_cell);
  requireNonNegativeInt(`${field}.child`, record.child);
}

function assertTextField(
  field: string,
  value: unknown,
): void {
  if (value === null) {
    return;
  }
  const record = requirePlainObject(field, value);
  requireExactKeys(field, record, ["min", "max"], []);
  requireFiniteNumber(`${field}.min`, record.min);
  requireFiniteNumber(`${field}.max`, record.max);
  if ((record.min as number) > (record.max as number)) {
    throw new CaptureValidationError(
      `${field}.min`,
      "must not exceed max",
    );
  }
}

function assertColumn(field: string, value: unknown): void {
  const record = requirePlainObject(field, value);
  requireExactKeys(field, record, [
    "content_class",
    "text_length",
    "links",
  ], ["date_format"]);
  requireNonEmptyString(`${field}.content_class`, record.content_class);
  assertTextField(`${field}.text_length`, record.text_length);
  if ("date_format" in record) {
    const fmt = requirePlainObject(`${field}.date_format`, record.date_format);
    requireExactKeys(`${field}.date_format`, fmt, ["pattern", "matches"], []);
    requireNonEmptyString(`${field}.date_format.pattern`, fmt.pattern);
    requireNonNegativeInt(`${field}.date_format.matches`, fmt.matches);
  }
  assertLinks(`${field}.links`, record.links);
}

function assertTable(field: string, value: unknown): void {
  const record = requirePlainObject(field, value);
  requireExactKeys(field, record, [
    "selector",
    "classes",
    "row_count",
    "rows_inspected",
    "column_count",
    "uniform",
    "columns",
    "row_attributes",
    "query_parameters",
  ], []);
  assertSelector(`${field}.selector`, record.selector, "table");
  requireStringArray(`${field}.classes`, record.classes, false);
  requireNonNegativeInt(`${field}.row_count`, record.row_count);
  requireNonNegativeInt(`${field}.rows_inspected`, record.rows_inspected);
  requireNonNegativeInt(`${field}.column_count`, record.column_count);
  requireBoolean(`${field}.uniform`, record.uniform);
  if (!Array.isArray(record.columns)) {
    throw new CaptureValidationError(`${field}.columns`, "must be an array");
  }
  (record.columns as unknown[]).forEach((column, index) =>
    assertColumn(`${field}.columns[${index}]`, column),
  );
  assertCountMap(`${field}.row_attributes`, record.row_attributes);
  assertCountMap(`${field}.query_parameters`, record.query_parameters);
}

function assertPagination(field: string, value: unknown): void {
  const record = requirePlainObject(field, value);
  requireExactKeys(field, record, [
    "selector",
    "present",
    "classes",
    "next_link_present",
  ], []);
  assertSelector(`${field}.selector`, record.selector, "pagination");
  if (record.present !== true) {
    throw new CaptureValidationError(`${field}.present`, "must be true");
  }
  requireStringArray(`${field}.classes`, record.classes, false);
  requireBoolean(`${field}.next_link_present`, record.next_link_present);
}

/** Re-emit a string-key count map in code point order. */
function canonicalCountMap(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort(compareStrings)) {
    out[key] = record[key];
  }
  return out;
}

function canonicalClasses(classes: readonly string[]): string[] {
  return [...classes].sort(compareStrings);
}

function canonicalSelector(value: unknown): Record<string, unknown> {
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {
    kind: record.kind,
    classes: canonicalClasses(record.classes as readonly string[]),
  };
  if ("scopes" in record) {
    out.scopes = canonicalClasses(record.scopes as readonly string[]);
  }
  if ("row_attribute" in record) {
    out.row_attribute = record.row_attribute;
  }
  return out;
}

function canonicalColumn(value: unknown): Record<string, unknown> {
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {
    content_class: record.content_class,
    text_length: record.text_length,
  };
  if ("date_format" in record) {
    out.date_format = record.date_format;
  }
  out.links = record.links;
  return out;
}

function canonicalTable(value: unknown): Record<string, unknown> {
  const record = value as Record<string, unknown>;
  return {
    selector: canonicalSelector(record.selector),
    classes: canonicalClasses(record.classes as readonly string[]),
    row_count: record.row_count,
    rows_inspected: record.rows_inspected,
    column_count: record.column_count,
    uniform: record.uniform,
    columns: (record.columns as readonly unknown[]).map(canonicalColumn),
    row_attributes: canonicalCountMap(
      record.row_attributes as Record<string, unknown>,
    ),
    query_parameters: canonicalCountMap(
      record.query_parameters as Record<string, unknown>,
    ),
  };
}

function canonicalPagination(value: unknown): Record<string, unknown> {
  const record = value as Record<string, unknown>;
  return {
    selector: canonicalSelector(record.selector),
    present: record.present,
    classes: canonicalClasses(record.classes as readonly string[]),
    next_link_present: record.next_link_present,
  };
}

/**
 * A deterministic, serializable model of a format-2 HTML structural
 * capture, sharing the format-1 validation and ordering helpers.
 *
 * Guarantees:
 * - `captured_at` is exactly the caller-supplied validated string.
 * - `unparsed` is omitted from the serialized request when it is 0 and
 *   carried as a non-negative integer when greater than 0 — per request,
 *   never defaulted, never emitted as an empty list.
 * - String-key maps (row_attributes, query_parameters) and class arrays are
 *   re-emitted in code point order so serialization is byte-stable.
 * - No HTTP, no file I/O, no environment access, no logging.
 */
export class HtmlCaptureFile {
  private readonly input: HtmlCaptureFileInput;

  private constructor(input: HtmlCaptureFileInput) {
    this.input = input;
  }

  /** Validates the input (throws CaptureValidationError) and builds the model. */
  static create(input: HtmlCaptureFileInput): HtmlCaptureFile {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new CaptureValidationError("input", "must be an object");
    }
    const record = input as unknown as Record<string, unknown>;
    requireExactKeys(
      "input",
      record,
      ["platform", "allowlistVersion", "capturedAt", "requests"],
      [],
    );

    requireNonEmptyString("platform", input.platform);
    requireNonEmptyString("allowlist_version", input.allowlistVersion);
    if (!isValidUtcIso8601(input.capturedAt)) {
      throw new CaptureValidationError(
        "captured_at",
        'must be a valid UTC ISO 8601 timestamp ending in "Z"',
      );
    }
    if (!Array.isArray(input.requests)) {
      throw new CaptureValidationError("requests", "must be an array");
    }

    input.requests.forEach((request, index) => {
      const prefix = `requests[${index}]`;
      const requestRecord = requirePlainObject(prefix, request);
      requireExactKeys(prefix, requestRecord, [
        "method",
        "urlTemplate",
        "status",
        "tables",
        "pagination",
        "unparsed",
      ], []);
      requireNonEmptyString(`${prefix}.method`, request.method);
      requireNonEmptyString(`${prefix}.url_template`, request.urlTemplate);
      requireStatus(`${prefix}.status`, request.status);
      if (!Array.isArray(request.tables)) {
        throw new CaptureValidationError(`${prefix}.tables`, "must be an array");
      }
      (request.tables as unknown[]).forEach((table, tIndex) =>
        assertTable(`${prefix}.tables[${tIndex}]`, table),
      );
      if (!Array.isArray(request.pagination)) {
        throw new CaptureValidationError(
          `${prefix}.pagination`,
          "must be an array",
        );
      }
      (request.pagination as unknown[]).forEach((entry, pIndex) =>
        assertPagination(`${prefix}.pagination[${pIndex}]`, entry),
      );
      requireNonNegativeInt(`${prefix}.unparsed`, request.unparsed);
    });

    return new HtmlCaptureFile(input);
  }

  /**
   * Serializes to a deterministic JSON string. Canonical key order:
   * capture_format, platform, allowlist_version, captured_at, requests;
   * each request: method, url_template, status, tables, pagination, and
   * unparsed (only when greater than 0). Compact by default.
   */
  toJson(indent?: number): string {
    const { platform, allowlistVersion, capturedAt, requests } = this.input;

    const serializedRequests = requests.map((request) => {
      const serialized: Record<string, unknown> = {
        method: request.method,
        url_template: request.urlTemplate,
        status: request.status,
        tables: request.tables.map(canonicalTable),
        pagination: request.pagination.map(canonicalPagination),
      };
      if (request.unparsed > 0) {
        serialized.unparsed = request.unparsed;
      }
      return serialized;
    });

    const document = {
      capture_format: HTML_CAPTURE_FORMAT,
      platform,
      allowlist_version: allowlistVersion,
      captured_at: capturedAt,
      requests: serializedRequests,
    };

    return JSON.stringify(document, null, indent);
  }
}
