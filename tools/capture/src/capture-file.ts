import type { RedactionResult } from "./redactor.js";

/**
 * Serialization contract of a CaptureFile. `capture_format` identifies the
 * shape of this document for future readers; it is a constant, not a
 * caller-supplied value.
 */
export const CAPTURE_FORMAT = 1;

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
   */
  toJson(): string {
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

    return JSON.stringify({
      capture_format: CAPTURE_FORMAT,
      platform,
      allowlist_version: allowlistVersion,
      captured_at: capturedAt,
      requests: serializedRequests,
    });
  }
}
