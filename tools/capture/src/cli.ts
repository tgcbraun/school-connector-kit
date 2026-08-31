/**
 * Local, file-based capture CLI.
 *
 * Privacy contract:
 * - local files only: reads two caller-named JSON files (decoded response,
 *   allowlist) and writes one caller-named output file;
 * - no HTTP, no authentication, no environment access, no platform logic;
 * - failure messages are fixed strings or contain only structural
 *   information (flag names, rule paths, member paths) — values from the
 *   decoded response never appear in a failure message;
 * - URL templates must be deliberately safe relative templates; raw URLs are
 *   rejected, never heuristically cleaned;
 * - captured_at is always caller-supplied; the clock is never read;
 * - an existing output file is never silently overwritten; writing through a
 *   symlink is refused.
 */
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CaptureFile,
  CaptureValidationError,
  HtmlCaptureFile,
} from "./capture-file.js";
import {
  Redactor,
  RedactorError,
  type RedactionResult,
} from "./redactor.js";
import {
  captureHtml,
  HtmlCaptureError,
  type HtmlAllowlist,
  type HtmlCaptureResult,
  validateHtmlAllowlist,
} from "./html-capture.js";

/**
 * All CLI failures. Messages are fixed strings or contain only structural
 * information; they never contain values read from the input files.
 */
export class CliError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

export interface FileStat {
  exists: boolean;
  isSymlink: boolean;
  isFile: boolean;
}

/** Narrow file I/O surface; injectable for tests. */
export interface CliIo {
  readFile(path: string): string;
  writeFile(path: string, data: string): void;
  stat(path: string): FileStat;
}

/**
 * Relative flag paths resolve against the caller's working directory. When
 * this CLI is started through an npm/pnpm package script, the process cwd is
 * forced to the package directory, so the original caller cwd is recovered
 * from INIT_CWD (set by npm/pnpm for script execution) when present.
 * Absolute paths pass through unchanged; without INIT_CWD the process cwd is
 * used, preserving direct-invocation behaviour.
 */
function callerPath(path: string): string {
  if (isAbsolute(path)) {
    return path;
  }
  const base = process.env.INIT_CWD;
  return resolve(base !== undefined && base.length > 0 ? base : process.cwd(), path);
}

export const defaultIo: CliIo = {
  readFile(path) {
    return readFileSync(callerPath(path), "utf8");
  },
  writeFile(path, data) {
    writeFileSync(callerPath(path), data, "utf8");
  },
  stat(path) {
    try {
      const info = lstatSync(callerPath(path));
      return {
        exists: true,
        isSymlink: info.isSymbolicLink(),
        isFile: info.isFile(),
      };
    } catch {
      return { exists: false, isSymlink: false, isFile: false };
    }
  },
};

const FLAG_NAMES = [
  "input",
  "allowlist",
  "platform",
  "captured-at",
  "method",
  "url-template",
  "status",
  "output",
  "force",
] as const;

export interface CliOptions {
  /**
   * `--input` values in command-line order. `--input` is the only repeatable
   * flag; every other flag may only be given once.
   */
  inputs: readonly string[];
  allowlist: string;
  platform: string;
  capturedAt: string;
  method: string;
  urlTemplate: string;
  status: string;
  output: string;
  force: boolean;
}

/**
 * Strict flag parsing: two-token `--flag value` form only, no unknown flags,
 * no duplicates (except `--input`, which repeats in order), no missing
 * values. A bare `--` (end-of-options separator, passed through by
 * npm/pnpm script invocations) is accepted and ignored.
 * Messages name the flag only — never a supplied value.
 */
export function parseArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  const inputs: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (typeof token === "string" && token === "--") {
      // End-of-options marker: accepted, ignored, parsing continues.
      continue;
    }
    if (typeof token !== "string" || !token.startsWith("--") || token.length <= 2) {
      throw new CliError("ARGUMENTS", "every argument must be a --flag");
    }

    const name = token.slice(2);
    if (!(FLAG_NAMES as readonly string[]).includes(name)) {
      throw new CliError("ARGUMENTS", `unknown option --${name}`);
    }
    if (name !== "input" && seen.has(name)) {
      throw new CliError("ARGUMENTS", `duplicate option --${name}`);
    }
    seen.add(name);

    if (name === "force") {
      continue;
    }

    const value = argv[i + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      throw new CliError("ARGUMENTS", `option --${name} requires a value`);
    }
    i++;
    if (value.length === 0) {
      throw new CliError("ARGUMENTS", `option --${name} requires a value`);
    }
    if (name === "input") {
      inputs.push(value);
    } else {
      values.set(name, value);
    }
  }

  const required = [
    ["allowlist", "allowlist"],
    ["platform", "platform"],
    ["captured-at", "capturedAt"],
    ["method", "method"],
    ["url-template", "urlTemplate"],
    ["status", "status"],
    ["output", "output"],
  ] as const;

  const options: CliOptions = {
    inputs,
    allowlist: "",
    platform: "",
    capturedAt: "",
    method: "",
    urlTemplate: "",
    status: "",
    output: "",
    force: seen.has("force"),
  };

  if (inputs.length === 0) {
    throw new CliError("ARGUMENTS", "missing required option --input");
  }

  for (const [flag, field] of required) {
    const value = values.get(flag);
    if (value === undefined) {
      throw new CliError("ARGUMENTS", `missing required option --${flag}`);
    }
    options[field] = value;
  }

  return options;
}

const HTTP_METHODS = ["DELETE", "GET", "PATCH", "POST", "PUT"];

/** Accepts the small method vocabulary case-insensitively; fixed message. */
export function normalizeMethod(raw: string): string {
  const value = raw.toUpperCase();
  if (!HTTP_METHODS.includes(value)) {
    throw new CliError(
      "METHOD",
      "must be one of GET, POST, PUT, PATCH, DELETE",
    );
  }
  return value;
}

/** Strict integer HTTP status in 100..599; fixed message, no echoing. */
export function parseStatus(raw: string): number {
  if (!/^[1-5]\d{2}$/.test(raw)) {
    throw new CliError(
      "STATUS",
      "must be an integer HTTP status between 100 and 599",
    );
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 100 || value > 599) {
    throw new CliError(
      "STATUS",
      "must be an integer HTTP status between 100 and 599",
    );
  }
  return value;
}

/**
 * Safe URL template grammar (deliberately small — not a URL parser):
 *
 *   /seg(/seg)*[?param(=value)?(&param(=value)?)*]
 *
 * - relative only: a leading "/", no scheme, no "//host", no whitespace;
 * - every path segment is a letter-led identifier, a {placeholder}, or a
 *   version segment of digits and dots (`1.0`, `2`, `10.4`); other
 *   pure-literal segments (IDs, accounts) are rejected;
 * - query values are either a letter-led identifier or a {placeholder};
 *   raw query values are rejected;
 * - at most one trailing "/" may terminate the path (before "?" or at
 *   end of template); empty interior segments ("//") are not permitted;
 * - userinfo ("@"), fragments ("#"), percent-encoding and any other
 *   character are rejected by the allowlist.
 *
 * No message below echoes the supplied template.
 */
const TEMPLATE_SEGMENT =
  "(?:[A-Za-z][A-Za-z0-9_-]*|\\{[A-Za-z0-9_-]+\\}|\\d+(?:\\.\\d+)*)";
const TEMPLATE_PARAM_NAME = "[A-Za-z0-9_-]+";
const TEMPLATE_PARAM_VALUE =
  "(?:[A-Za-z][A-Za-z0-9_-]*|\\{[A-Za-z0-9_-]+\\})";
const TEMPLATE_QUERY =
  `${TEMPLATE_PARAM_NAME}(?:=${TEMPLATE_PARAM_VALUE})?` +
  `(?:&${TEMPLATE_PARAM_NAME}(?:=${TEMPLATE_PARAM_VALUE})?)*`;

export const URL_TEMPLATE_PATTERN = new RegExp(
  `^/${TEMPLATE_SEGMENT}(?:/${TEMPLATE_SEGMENT})*(?:/)?` +
    `(?:\\?${TEMPLATE_QUERY})?$`,
);

export function validateUrlTemplate(raw: string): void {
  if (raw.length === 0 || raw !== raw.trim()) {
    throw new CliError(
      "URL_TEMPLATE",
      "must be a non-empty safe relative URL template with no whitespace",
    );
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) {
    throw new CliError(
      "URL_TEMPLATE",
      "absolute URLs with a scheme or host are not accepted; " +
        "provide a relative path template",
    );
  }
  if (raw.startsWith("//")) {
    throw new CliError(
      "URL_TEMPLATE",
      "protocol-relative or host-carrying URLs are not accepted; " +
        "provide a relative path template",
    );
  }
  if (raw.includes(" ")) {
    throw new CliError(
      "URL_TEMPLATE",
      "raw URLs or values containing whitespace are not accepted; " +
        "provide a relative path template",
    );
  }
  if (raw.includes("@")) {
    throw new CliError(
      "URL_TEMPLATE",
      "URL userinfo is not accepted; provide a safe relative path template",
    );
  }
  if (raw.includes("#")) {
    throw new CliError(
      "URL_TEMPLATE",
      "URL fragments are not accepted; provide a safe relative path template",
    );
  }
  if (!URL_TEMPLATE_PATTERN.test(raw)) {
    if (raw.includes("?")) {
      throw new CliError(
        "URL_TEMPLATE",
        "query parameter values must be explicit template placeholders " +
          "like {start} or static identifiers; raw query values are " +
          "not accepted",
      );
    }
    throw new CliError(
      "URL_TEMPLATE",
      "must be a relative path template; literal values (IDs, accounts, " +
        "raw segments) are not accepted — use {placeholder} for dynamic " +
        "segments",
    );
  }
}

export interface AllowlistDocument {
  version: string;
  rules: Array<{ path: string; mode: "keep" | "type" }>;
}

/**
 * Strict, non-coercing validation of the allowlist file's parsed JSON.
 * Unknown modes, malformed rules, unknown keys, empty versions and malformed
 * rule paths are all rejected; nothing is silently normalized.
 */
export function parseAllowlist(raw: unknown): AllowlistDocument {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CliError("ALLOWLIST", "must be a JSON object");
  }

  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "rules" ||
    keys[1] !== "version" ||
    typeof record.version !== "string"
  ) {
    throw new CliError(
      "ALLOWLIST",
      'must contain exactly the keys "version" and "rules"',
    );
  }

  const version = record.version;
  if (version.length === 0) {
    throw new CliError("ALLOWLIST", '"version" must be a non-empty string');
  }

  if (!Array.isArray(record.rules)) {
    throw new CliError("ALLOWLIST", '"rules" must be an array');
  }

  const rules: Array<{ path: string; mode: "keep" | "type" }> = (
    record.rules as unknown[]
  ).map((rule, index) => {
    if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
      throw new CliError("ALLOWLIST", `rules[${index}] must be an object`);
    }

    const entry = rule as Record<string, unknown>;
    const entryKeys = Object.keys(entry).sort();
    if (
      entryKeys.length !== 2 ||
      entryKeys[0] !== "mode" ||
      entryKeys[1] !== "path"
    ) {
      throw new CliError(
        "ALLOWLIST",
        'rules must contain exactly the keys "mode" and "path"',
      );
    }

    const path = entry.path;
    const mode = entry.mode;
    if (typeof path !== "string" || path.length === 0) {
      throw new CliError(
        "ALLOWLIST",
        'rules[].path must be a non-empty string',
      );
    }
    if (mode !== "keep" && mode !== "type") {
      throw new CliError(
        "ALLOWLIST",
        'rules[].mode must be exactly "keep" or "type"',
      );
    }

    return { path, mode };
  });

  return { version, rules };
}

export interface RunResult {
  code: number;
  /** Fixed or structural-only text; safe to print or log. */
  message: string;
}

/**
 * Shared output-write rules for both capture formats: an existing output is
 * never silently overwritten, writing through a symlink is refused even with
 * --force, and a non-regular file is refused.
 */
function writeOutput(
  output: string,
  outputPath: string,
  force: boolean,
  io: CliIo,
): RunResult {
  const stat = io.stat(outputPath);
  if (stat.exists && stat.isSymlink) {
    throw new CliError(
      "OUTPUT",
      "output path is a symlink; refusing to write through it",
    );
  }
  if (stat.exists) {
    if (!stat.isFile) {
      throw new CliError("OUTPUT", "output path is not a regular file");
    }
    if (!force) {
      throw new CliError(
        "OUTPUT",
        "output file already exists; pass --force to overwrite it explicitly",
      );
    }
  }

  io.writeFile(outputPath, output);
  return { code: 0, message: "capture written" };
}

/**
 * Runs one format-2 HTML structural capture command (ADR-002): reads the
 * caller-named HTML page and allowlist, captures the allowlisted tables and
 * pagination, and writes the format-2 envelope. Reuses the flag vocabulary,
 * method/status/template validation, and the shared output-write rules of
 * the format-1 path.
 */
function runHtmlCli(argv: readonly string[], io: CliIo): RunResult {
  try {
    const options = parseArgs(argv);

    let allowlistText: string;
    try {
      allowlistText = io.readFile(options.allowlist);
    } catch {
      throw new CliError("FILE", "cannot read the --allowlist file");
    }

    let allowlistRaw: unknown;
    try {
      allowlistRaw = JSON.parse(allowlistText);
    } catch {
      throw new CliError("ALLOWLIST", "the --allowlist file is not valid JSON");
    }

    let allowlist: HtmlAllowlist;
    try {
      allowlist = validateHtmlAllowlist(allowlistRaw);
    } catch (error) {
      if (error instanceof HtmlCaptureError) {
        throw error;
      }
      throw new CliError("ALLOWLIST", "the html allowlist is invalid");
    }

    validateUrlTemplate(options.urlTemplate);
    const method = normalizeMethod(options.method);
    const status = parseStatus(options.status);

    if (options.platform.length === 0) {
      throw new CliError("PLATFORM", "must be a non-empty string");
    }

    // One request per --input, in command-line order, all under the same
    // capture-level allowlist identity. Any input that fails to resolve
    // uniquely fails the whole run (ADR-002 §9 fail-closed).
    const requests = options.inputs.map((inputPath) => {
      let source: string;
      try {
        source = io.readFile(inputPath);
      } catch {
        throw new CliError("FILE", "cannot read the --input file");
      }
      let result: HtmlCaptureResult;
      try {
        result = captureHtml(source, allowlist);
      } catch (error) {
        if (error instanceof HtmlCaptureError) {
          throw error;
        }
        throw new CliError("CAPTURE", "html capture failed");
      }
      return {
        method,
        urlTemplate: options.urlTemplate,
        status,
        tables: result.tables,
        pagination: result.pagination,
        unparsed: result.unparsed,
      };
    });

    let capture: HtmlCaptureFile;
    try {
      capture = HtmlCaptureFile.create({
        platform: options.platform,
        allowlistVersion: allowlist.version,
        capturedAt: options.capturedAt,
        requests,
      });
    } catch (error) {
      if (error instanceof CaptureValidationError) {
        throw error;
      }
      throw new CliError("CAPTURE", "capture validation failed");
    }

    const output = `${capture.toJson(2)}\n`;
    return writeOutput(output, options.output, options.force, io);
  } catch (error) {
    if (
      error instanceof CliError ||
      error instanceof HtmlCaptureError ||
      error instanceof CaptureValidationError
    ) {
      return { code: 1, message: error.message };
    }
    return { code: 1, message: "internal error (details omitted)" };
  }
}

/**
 * Runs one capture command. The first token, when it is the literal word
 * `html`, switches to the format-2 HTML structural capture path; anything
 * else is parsed by the format-1 redaction path. Returns { code, message }
 * instead of throwing so tests and callers can inspect the outcome;
 * messages only ever contain fixed text or structural information, never
 * input values.
 */
export function runCli(
  argv: readonly string[],
  io: CliIo = defaultIo,
): RunResult {
  const first = argv[0];
  if (first === "html") {
    return runHtmlCli(argv.slice(1), io);
  }
  try {
    const options = parseArgs(argv);
    if (options.inputs.length > 1) {
      throw new CliError("ARGUMENTS", "duplicate option --input");
    }
    const inputPath = options.inputs[0];
    if (inputPath === undefined) {
      throw new CliError("ARGUMENTS", "missing required option --input");
    }

    let allowlistText: string;
    try {
      allowlistText = io.readFile(options.allowlist);
    } catch {
      throw new CliError("FILE", "cannot read the --allowlist file");
    }

    let allowlistRaw: unknown;
    try {
      allowlistRaw = JSON.parse(allowlistText);
    } catch {
      throw new CliError("ALLOWLIST", "the --allowlist file is not valid JSON");
    }

    const allowlist = parseAllowlist(allowlistRaw);

    let inputText: string;
    try {
      inputText = io.readFile(inputPath);
    } catch {
      throw new CliError("FILE", "cannot read the --input file");
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(inputText);
    } catch {
      throw new CliError("INPUT", "the --input file is not valid JSON");
    }

    validateUrlTemplate(options.urlTemplate);
    const method = normalizeMethod(options.method);
    const status = parseStatus(options.status);

    if (options.platform.length === 0) {
      throw new CliError("PLATFORM", "must be a non-empty string");
    }

    let redaction: RedactionResult;
    try {
      redaction = new Redactor({
        version: allowlist.version,
        rules: allowlist.rules,
      }).redact(decoded);
    } catch (error) {
      if (error instanceof RedactorError) {
        throw error;
      }
      throw new CliError("REDACTION", "redaction failed");
    }

    let capture: CaptureFile;
    try {
      capture = CaptureFile.create({
        platform: options.platform,
        allowlistVersion: allowlist.version,
        capturedAt: options.capturedAt,
        requests: [
          {
            method,
            urlTemplate: options.urlTemplate,
            status,
            redaction,
          },
        ],
      });
    } catch (error) {
      if (error instanceof CaptureValidationError) {
        throw error;
      }
      throw new CliError("CAPTURE", "capture validation failed");
    }

    const output = `${capture.toJson(2)}\n`;
    return writeOutput(output, options.output, options.force, io);
  } catch (error) {
    if (
      error instanceof CliError ||
      error instanceof RedactorError ||
      error instanceof CaptureValidationError
    ) {
      return { code: 1, message: error.message };
    }
    return { code: 1, message: "internal error (details omitted)" };
  }
}

/** Process entry point; returns the exit code. */
export function main(
  argv: readonly string[],
  io: CliIo = defaultIo,
): number {
  const result = runCli(argv, io);
  if (result.code === 0) {
    console.log(result.message);
  } else {
    console.error(result.message);
  }
  return result.code;
}

// Run as a script (node dist/cli.js); inert under test/vitest imports.
const argv1 = process.argv[1];
if (argv1 !== undefined && import.meta.url === pathToFileURL(argv1).href) {
  process.exitCode = main(process.argv.slice(2));
}
