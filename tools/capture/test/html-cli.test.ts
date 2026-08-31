import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";

// All synthetic data below is deliberately fictional.

const SYNTHETIC_PAGE = `<!DOCTYPE html>
<html>
<head><title>SYNTHETIC_PAGE_TITLE</title></head>
<body>
<table class="c-table">
<tr data-uid="u1"><td>ROW_ONE_TEXT_13</td></tr>
<tr data-uid="u2"><td>ROW_TWO_TEXT_13</td></tr>
<tr data-uid="u3"><td>ROW_THREE_TEXT_1</td></tr>
</table>
<p>FOOTER_NOTE_TEXT</p>
</body>
</html>
`;

const SYNTHETIC_HTML_ALLOWLIST = {
  version: "synthetic-2025-06-15",
  selectors: [
    { kind: "table", classes: ["c-table"], row_attribute: "data-uid" },
  ],
};

const FORMAT1_ALLOWLIST = {
  version: "fmt1-1",
  rules: [{ path: "pupil.displayName", mode: "keep" }],
};

let dir: string;

function write(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

function htmlArgs(overrides: Record<string, string> = {}): string[] {
  const flag = (key: string, fallback: string): string =>
    overrides[key] ?? fallback;

  const args = [
    "html",
    "--input",
    flag("input", join(dir, "page.html")),
    "--allowlist",
    flag("allowlist", join(dir, "allowlist.json")),
    "--platform",
    flag("platform", "kikom"),
    "--captured-at",
    flag("captured-at", "2025-06-15T08:30:00Z"),
    "--method",
    flag("method", "GET"),
    "--url-template",
    flag("url-template", "/api/v1/school/{schoolCode}"),
    "--status",
    flag("status", "200"),
    "--output",
    flag("output", join(dir, "out.json")),
  ];
  if ("force" in overrides) {
    args.push("--force");
  }
  return args;
}

function stripSubcommand(args: readonly string[]): string[] {
  return args.filter((token) => token !== "html");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "capture-html-cli-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("capture CLI html subcommand (capture_format 2)", () => {
  it("captures the synthetic page and writes a format-2 envelope", () => {
    write("page.html", SYNTHETIC_PAGE);
    write("allowlist.json", JSON.stringify(SYNTHETIC_HTML_ALLOWLIST));

    const result = runCli(htmlArgs());

    expect(result.code).toBe(0);
    const text = readFileSync(join(dir, "out.json"), "utf8");
    expect(text).toBe(`${text.trimEnd()}\n`);
    const parsed = JSON.parse(text);
    expect(parsed.capture_format).toBe(2);
    expect(parsed.platform).toBe("kikom");
    expect(parsed.allowlist_version).toBe("synthetic-2025-06-15");
    expect(parsed.captured_at).toBe("2025-06-15T08:30:00Z");
    expect(parsed.requests).toHaveLength(1);
    const request = parsed.requests[0];
    expect(request.method).toBe("GET");
    expect(request.url_template).toBe("/api/v1/school/{schoolCode}");
    expect(request.status).toBe(200);
    expect(request.unparsed).toBe(1);

    const table = request.tables[0];
    expect(table.row_count).toBe(3);
    expect(table.rows_inspected).toBe(3);
    expect(table.column_count).toBe(1);
    expect(table.uniform).toBe(true);
    expect(table.row_attributes).toEqual({ "data-uid": 3 });
    expect(table.query_parameters).toEqual({});
    const column = table.columns[0];
    expect(column.content_class).toBe("text");
    expect(column.text_length).toEqual({ min: 15, max: 16 });
    expect(column.links).toEqual({ present: 0, whole_cell: 0, child: 0 });

    // Canonical key order first.
    expect(text.startsWith('{\n  "capture_format": 2')).toBe(true);
  });

  it("refuses the subcommand token at any position other than first", () => {
    write("page.html", SYNTHETIC_PAGE);
    write("allowlist.json", JSON.stringify(SYNTHETIC_HTML_ALLOWLIST));

    const args = stripSubcommand(htmlArgs());
    args.push("html");
    const result = runCli(args);

    expect(result.code).toBe(1);
    expect(result.message).toBe("every argument must be a --flag");
  });

  it("refuses a format-1 allowlist for the html subcommand without echoing values", () => {
    write("page.html", SYNTHETIC_PAGE);
    write(
      "allowlist.json",
      JSON.stringify({ ...FORMAT1_ALLOWLIST, version: "SECRET_AL_VERSION" }),
    );

    const result = runCli(htmlArgs());

    expect(result.code).toBe(1);
    expect(result.message).not.toContain("SECRET_AL_VERSION");
    expect(result.message).not.toContain("pupil.displayName");
  });

  it("refuses a format-2 allowlist on the format-1 path", () => {
    write("page.html", SYNTHETIC_PAGE);
    write(
      "in.json",
      JSON.stringify({ pupil: { displayName: "PUPIL_CANARY_X1" } }),
    );
    write("allowlist.json", JSON.stringify(SYNTHETIC_HTML_ALLOWLIST));

    const result = runCli(
      [
        "--input",
        join(dir, "in.json"),
        "--allowlist",
        join(dir, "allowlist.json"),
        "--platform",
        "kikom",
        "--captured-at",
        "2025-06-15T08:30:00Z",
        "--method",
        "GET",
        "--url-template",
        "/api/v1/school/{schoolCode}",
        "--status",
        "200",
        "--output",
        join(dir, "out.json"),
      ],
    );

    expect(result.code).toBe(1);
    expect(result.message).not.toContain("c-table");
    expect(result.message).not.toContain("synthetic-2025-06-15");
  });

  it("surfaces a PARSE failure as a fixed message without leaking page content", () => {
    write("page.html", `<html><body><p class="CANARY_P_X1">BROKEN</p`);
    write("allowlist.json", JSON.stringify(SYNTHETIC_HTML_ALLOWLIST));

    const result = runCli(htmlArgs());

    expect(result.code).toBe(1);
    expect(result.message).toBe(
      "html markup is not parseable: malformed closing tag",
    );
    expect(result.message).not.toContain("CANARY_P_X1");
  });

  it("surfaces a SELECTOR failure as a fixed structural message", () => {
    write("page.html", `<html><body><table class="CANARY_TBL_X1"><tr><td>x</td></tr></table></body></html>`);
    write("allowlist.json", JSON.stringify(SYNTHETIC_HTML_ALLOWLIST));

    const result = runCli(htmlArgs());

    expect(result.code).toBe(1);
    expect(result.message).toBe(
      "selector [0] resolves to zero elements (allowlist names a selector the page does not contain)",
    );
    expect(result.message).not.toContain("CANARY_TBL_X1");
  });

  it("refuses to overwrite an existing output without --force, honors it with --force", () => {
    write("page.html", SYNTHETIC_PAGE);
    write("allowlist.json", JSON.stringify(SYNTHETIC_HTML_ALLOWLIST));
    write(join("out.json"), "STALE_PREVIOUS_CAPTURE");

    const denied = runCli(htmlArgs());
    expect(denied.code).toBe(1);
    expect(denied.message).toContain("already exists");
    expect(readFileSync(join(dir, "out.json"), "utf8")).toBe(
      "STALE_PREVIOUS_CAPTURE",
    );

    const allowed = runCli(htmlArgs({ force: "" }));
    expect(allowed.code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
    expect(parsed.capture_format).toBe(2);
  });

  it("refuses to write through a symlink, even with --force", () => {
    write("page.html", SYNTHETIC_PAGE);
    write("allowlist.json", JSON.stringify(SYNTHETIC_HTML_ALLOWLIST));
    const target = join(dir, "real-target.json");
    writeFileSync(target, "TARGET_DATA", "utf8");
    symlinkSync(target, join(dir, "out.json"));

    const result = runCli(htmlArgs({ force: "" }));

    expect(result.code).toBe(1);
    expect(result.message).toContain("symlink");
    expect(lstatSync(join(dir, "out.json")).isSymbolicLink()).toBe(true);
  });

  it("rejects an invalid captured_at with the field-scoped validation error", () => {
    write("page.html", SYNTHETIC_PAGE);
    write("allowlist.json", JSON.stringify(SYNTHETIC_HTML_ALLOWLIST));

    const result = runCli(
      htmlArgs({ "captured-at": "2025-06-15T08:30:00+02:00" }),
    );

    expect(result.code).toBe(1);
    expect(result.message).toContain("captured_at");
  });

  it("rejects a missing flag in the html subcommand with the fixed ARGUMENTS message", () => {
    write("allowlist.json", JSON.stringify(SYNTHETIC_HTML_ALLOWLIST));

    const result = runCli(
      [
        "html",
        "--allowlist",
        join(dir, "allowlist.json"),
        "--platform",
        "kikom",
        "--captured-at",
        "2025-06-15T08:30:00Z",
        "--method",
        "GET",
        "--url-template",
        "/api/v1/school/{schoolCode}",
        "--status",
        "200",
        "--output",
        join(dir, "out.json"),
      ],
    );

    expect(result.code).toBe(1);
    expect(result.message).toBe("missing required option --input");
  });

  it("normalizes the method and status on the html path", () => {
    write("page.html", SYNTHETIC_PAGE);
    write("allowlist.json", JSON.stringify(SYNTHETIC_HTML_ALLOWLIST));

    const badMethod = runCli(htmlArgs({ method: "FETCH" }));
    expect(badMethod.code).toBe(1);
    expect(badMethod.message).toContain("GET, POST, PUT, PATCH, DELETE");

    const badStatus = runCli(htmlArgs({ status: "99" }));
    expect(badStatus.code).toBe(1);
    expect(badStatus.message).toContain("between 100 and 599");

    const ok = runCli(htmlArgs({ method: "post" }));
    expect(ok.code).toBe(0);
    const request = JSON.parse(
      readFileSync(join(dir, "out.json"), "utf8"),
    ).requests[0];
    expect(request.method).toBe("POST");
  });
});
