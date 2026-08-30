import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { defaultIo, runCli } from "../src/cli.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "../..");
const examplesDir = join(repoRoot, "examples");

// Documented arguments for the public golden example; the same command and
// inputs must always reproduce expected-capture.json byte for byte.
const GOLDEN_ARGS = [
  "--input",
  join(examplesDir, "synthetic-response.json"),
  "--allowlist",
  join(examplesDir, "synthetic-allowlist.json"),
  "--platform",
  "example",
  "--captured-at",
  "2025-06-15T08:30:00Z",
  "--method",
  "GET",
  "--url-template",
  "/api/example?start={start}&end={end}",
  "--status",
  "200",
];

describe("public golden example", () => {
  it("reproduces expected-capture.json exactly from the documented inputs", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-golden-"));
    try {
      const output = join(dir, "out.json");
      const result = runCli([...GOLDEN_ARGS, "--output", output], defaultIo);
      expect(result.code).toBe(0);

      const expected = readFileSync(
        join(examplesDir, "expected-capture.json"),
        "utf8",
      );
      const actual = readFileSync(output, "utf8");
      expect(actual).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("demonstrates keep, type, drop, and 3-element array sampling", () => {
    const expected = readFileSync(
      join(examplesDir, "expected-capture.json"),
      "utf8",
    );
    const parsed = JSON.parse(expected);
    const request = parsed.requests[0];

    // keep
    expect(request.shape.id).toBe("EXAMPLE_ID_009");
    expect(request.shape.items).toHaveLength(3);
    // type
    expect(request.shape.term).toEqual({ __t: "string", __len: 17 });
    // dropped paths
    expect(request.dropped_paths).toEqual([
      "items[].pin",
      "note",
      "pupil",
      "secret",
      "teacher",
      "unlisted",
    ]);
    // array length recorded while only 3 elements are present
    expect(request.array_lengths).toEqual({ items: 5 });
    expect(request.shape.items).toHaveLength(3);

    // no synthetic PIN values survive
    for (let n = 1; n <= 5; n++) {
      expect(expected).not.toContain(`ITEM_EXAMPLE_PIN_${n}`);
    }
    for (const name of [
      "EXAMPLE_PUPIL_ONE",
      "EXAMPLE_TEACHER_ALPHA",
      "EXAMPLE_PRIVATE_NOTE_42",
      "EXAMPLE_NESTED_SECRET_7",
      "EXAMPLE_BEARER_TOKEN_99",
    ]) {
      expect(expected).not.toContain(name);
    }
  });
});
