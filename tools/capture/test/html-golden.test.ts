import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { defaultIo, runCli } from "../src/cli.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "../..");
const examplesDir = join(repoRoot, "examples");

// Documented arguments for the public format-2 golden example; the same
// command and inputs must always reproduce expected-html-capture.json byte
// for byte.
const GOLDEN_HTML_ARGS = [
  "html",
  "--input",
  join(examplesDir, "synthetic-html-page.html"),
  "--allowlist",
  join(examplesDir, "synthetic-html-allowlist.json"),
  "--platform",
  "kikom",
  "--captured-at",
  "2025-06-15T08:30:00Z",
  "--method",
  "GET",
  "--url-template",
  "/api/v1/schedule/{term}",
  "--status",
  "200",
];

describe("public HTML golden example (capture_format 2)", () => {
  it("reproduces expected-html-capture.json exactly, twice, from the documented inputs", () => {
    const expected = readFileSync(
      join(examplesDir, "expected-html-capture.json"),
      "utf8",
    );

    const dir = mkdtempSync(join(tmpdir(), "capture-html-golden-"));
    try {
      const first = join(dir, "first.json");
      const second = join(dir, "second.json");

      const run1 = runCli([...GOLDEN_HTML_ARGS, "--output", first], defaultIo);
      expect(run1.code).toBe(0);
      expect(readFileSync(first, "utf8")).toBe(expected);

      const run2 = runCli([...GOLDEN_HTML_ARGS, "--output", second], defaultIo);
      expect(run2.code).toBe(0);
      expect(readFileSync(second, "utf8")).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaks no cell text, attribute values, URL paths, or parameter values", () => {
    const expected = readFileSync(
      join(examplesDir, "expected-html-capture.json"),
      "utf8",
    );
    const page = readFileSync(
      join(examplesDir, "synthetic-html-page.html"),
      "utf8",
    );

    // Decoy outside the selected elements.
    expect(expected).not.toContain("DECOY_TEXT_X1");
    // Cell text (lengths only, never content).
    for (const text of [
      "ALPHA_ONE_12",
      "ALPHA_TWO_12",
      "ALPHA_THREE_1",
      "ALPHA_FOUR_LONGTEXT",
      "ALPHA_FIVE_LONG_TXT",
      "LINK_ALPHA_ONE",
      "LINK_BETA_TWO",
      "LINK_GAMMA_THREE",
      "PFX_ALPHA_ONE",
      "PFX_BETA_TWO",
      "PFX_GAMMA_THREE",
      "LEAD_ALPHA",
      "PORTAL_CHROME_NAV_TEXT",
    ]) {
      expect(expected).not.toContain(text);
    }
    // Date shape is reported as a pattern name, never as the matched text.
    for (const date of ["01.02.25", "12.03.25", "04.05.25", "99.99.25"]) {
      expect(expected).not.toContain(date);
    }
    // Attribute values and URL paths stay out of the document.
    expect(expected).not.toContain("alpha-123");
    expect(expected).not.toContain("synthetic-query-value");
    expect(expected).not.toContain("/x?cHash");
    expect(expected).not.toContain("/y?cHash");
    expect(expected).not.toContain("/z?cHash");
    expect(expected).not.toContain("cHash=9");
    expect(expected).not.toContain("tx_pi[client]=6");
    // The page contains the values; the golden answer does not.
    expect(page).toContain("cHash=9");
    expect(page).toContain("DECOY_TEXT_X1");

    // Only names survive.
    const parsed = JSON.parse(expected);
    expect(parsed.requests).toHaveLength(1);
    const table = parsed.requests[0].tables[0];
    expect(table.query_parameters).toEqual({ "cHash": 9, "tx_pi[client]": 3 });
    expect(table.row_attributes).toEqual({ "data-state": 1, "data-uid": 3 });
  });
});
