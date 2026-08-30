export type AllowlistMode = "keep" | "type";

export interface AllowlistRule {
  path: string;
  mode: AllowlistMode;
}

export interface Allowlist {
  version: string;
  rules: AllowlistRule[];
}

export interface RedactionResult {
  shape: unknown;
  droppedPaths: string[];
  arrayLengths: Record<string, number>;
}

/**
 * Normalized path grammar for allowlist rules: identifiers joined with ".",
 * array-element tokens "[]" appended directly. An identifier must not
 * contain reserved syntax (".", "[", "]") — otherwise rule paths and
 * object keys with reserved characters become indistinguishable, and this
 * is a deny-by-default redactor, so ambiguity must fail closed.
 */
const RULE_PATH_PATTERN =
  /^((?:[^.[\]]+|\[\])(?:\.[^.[\]]+|\[\])*)?$/;

/** Deterministic, message-free-of-values failure for ambiguous paths. */
export class RedactorError extends Error {
  readonly code: "RESERVED_OBJECT_KEY" | "INVALID_RULE_PATH";

  constructor(
    code: "RESERVED_OBJECT_KEY" | "INVALID_RULE_PATH",
    message: string,
  ) {
    super(message);
    this.name = "RedactorError";
    this.code = code;
  }
}

function hasReservedPathSyntax(key: string): boolean {
  return key.includes(".") || key.includes("[]");
}

const DROP = Symbol("drop");

type RedactedValue = unknown | typeof DROP;

export class Redactor {
  private readonly rules: Map<string, AllowlistMode>;
  private readonly rulePaths: string[];

  constructor(allowlist: Allowlist) {
    if (allowlist === null || typeof allowlist !== "object") {
      throw new RedactorError("INVALID_RULE_PATH", "allowlist must be an object");
    }

    const rules = allowlist.rules;
    if (!Array.isArray(rules)) {
      throw new RedactorError(
        "INVALID_RULE_PATH",
        "allowlist.rules must be an array",
      );
    }

    // Fail closed on malformed or ambiguous rule paths: such paths cannot be
    // distinguished from other paths under the normalized grammar and could
    // silently authorize values the allowlist author never intended.
    for (const rule of rules) {
      if (
        rule === null ||
        typeof rule !== "object" ||
        typeof rule.path !== "string" ||
        !RULE_PATH_PATTERN.test(rule.path)
      ) {
        const shown =
          rule === null || typeof rule !== "object" ? "<missing>" : rule.path;
        throw new RedactorError(
          "INVALID_RULE_PATH",
          `allowlist rule path "${shown}" is not a valid normalized path`,
        );
      }
    }

    this.rules = new Map(rules.map((rule) => [rule.path, rule.mode]));

    this.rulePaths = [...this.rules.keys()].sort();
  }

  redact(decodedJson: unknown): RedactionResult {
    const dropped = new Set<string>();
    const arrayLengths: Record<string, number> = {};

    const redacted = this.redactValue(
      decodedJson,
      "",
      dropped,
      arrayLengths,
    );

    return {
      shape: redacted === DROP ? this.emptyRoot(decodedJson) : redacted,
      droppedPaths: [...dropped].sort(),
      arrayLengths: Object.fromEntries(
        Object.entries(arrayLengths).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      ),
    };
  }

  private redactValue(
    value: unknown,
    path: string,
    dropped: Set<string>,
    arrayLengths: Record<string, number>,
  ): RedactedValue {
    // undefined is not JSON-representable: deny it explicitly (fail closed)
    // instead of falling through to object handling, where it would throw.
    if (value === undefined) {
      if (path !== "") {
        dropped.add(path);
      }
      return DROP;
    }

    const exactMode = this.rules.get(path);

    if (this.isScalar(value)) {
      if (exactMode === undefined) {
        if (path !== "") {
          dropped.add(path);
        }
        return DROP;
      }

      if (exactMode === "keep") {
        return value;
      }

      return this.typeToken(value);
    }

    if (!this.hasAllowedDescendant(path)) {
      if (path !== "") {
        dropped.add(path);
      }
      return DROP;
    }

    if (Array.isArray(value)) {
      const arrayPath = path;
      arrayLengths[arrayPath] = value.length;

      const result: unknown[] = [];

      for (const element of value.slice(0, 3)) {
        const childPath = `${arrayPath}[]`;

        const redacted = this.redactValue(
          element,
          childPath,
          dropped,
          arrayLengths,
        );

        if (redacted !== DROP) {
          result.push(redacted);
        }
      }

      return result;
    }

    const object = value as Record<string, unknown>;

    // Fail closed on reserved key syntax. A key containing "." or "[]"
    // joins to a path string that this grammar cannot distinguish from a
    // different structure, so the capture is refused instead of guessing
    // which structure the allowlist meant. Only structure (never values)
    // may appear in the error.
    for (const key of Object.keys(object)) {
      if (hasReservedPathSyntax(key)) {
        const memberPath = path === "" ? key : `${path}.${key}`;
        throw new RedactorError(
          "RESERVED_OBJECT_KEY",
          `object member at path "${memberPath}" contains a key with ` +
            `reserved path syntax ("." or "[]"); redaction failed closed`,
        );
      }
    }

    const result: Record<string, unknown> = {};

    for (const key of Object.keys(object).sort()) {
      const childPath = path === "" ? key : `${path}.${key}`;

      const redacted = this.redactValue(
        object[key],
        childPath,
        dropped,
        arrayLengths,
      );

      if (redacted !== DROP) {
        result[key] = redacted;
      }
    }

    return result;
  }

  private hasAllowedDescendant(path: string): boolean {
    if (path === "") {
      return this.rulePaths.length > 0;
    }

    const objectPrefix = `${path}.`;
    const arrayPrefix = `${path}[]`;

    return this.rulePaths.some(
      (rulePath) =>
        rulePath.startsWith(objectPrefix) ||
        rulePath === arrayPrefix ||
        rulePath.startsWith(`${arrayPrefix}.`) ||
        rulePath.startsWith(`${arrayPrefix}[]`),
    );
  }

  private isScalar(
    value: unknown,
  ): value is string | number | boolean | null {
    return (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    );
  }

  private typeToken(value: string | number | boolean | null): object {
    if (value === null) {
      return { __t: "null" };
    }

    if (typeof value === "string") {
      return {
        __t: "string",
        __len: value.length,
      };
    }

    if (typeof value === "boolean") {
      return { __t: "bool" };
    }

    return {
      __t: Number.isInteger(value) ? "int" : "double",
    };
  }

  private emptyRoot(value: unknown): unknown {
    if (Array.isArray(value)) {
      return [];
    }

    if (value !== null && typeof value === "object") {
      return {};
    }

    return null;
  }
}
