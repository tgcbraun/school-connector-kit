/**
 * The committed JSON Schema document declares itself as draft 2020-12. That is
 * a claim about behaviour and nothing in this repository had ever exercised it:
 * json-schema.test.ts pins the document against its own generator, and asserts
 * facts about the document's text. This test hands the committed file to an
 * independent JSON Schema implementation and requires it to compile.
 *
 * What it proves is structural compilation and nothing more. ajv runs here with
 * strict: false and without ajv-formats, so every `format` keyword in the
 * document is ignored rather than asserted - 34 occurrences of "date-time" and
 * 6 of "date" at the time of writing. In draft 2020-12 `format` is an
 * annotation unless a validator opts into assertion, so a consumer validating
 * against the published document gets no date checking, while the Zod runtime
 * enforces z.iso.datetime({ offset: true }). That divergence is recorded, not
 * resolved here.
 *
 * It deliberately reads the committed artifact from disk rather than calling
 * buildDocument(), so that what is under test is the published file. It
 * validates no payload; payload agreement between the document and the Zod
 * definitions needs a normalized corpus that does not exist yet.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { SCHEMA_VERSION } from "../src/schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(
  here,
  "..",
  "schema",
  `normalized-schema-${SCHEMA_VERSION}.json`,
);

function committed(): Record<string, unknown> {
  return JSON.parse(readFileSync(goldenPath, "utf8")) as Record<string, unknown>;
}

describe("committed JSON Schema document, read by an independent implementation", () => {
  it("declares the 2020-12 dialect", () => {
    expect(String(committed().json_schema_dialect)).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
  });

  it("compiles every concept definition under that dialect", () => {
    const doc = committed();
    const concepts = doc.concepts as Record<string, unknown>;
    const names = Object.keys(concepts).sort();
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const ajv = new Ajv2020({ strict: false });
      expect(() => ajv.compile(concepts[name] as object)).not.toThrow();
    }
  });

  it("compiles every date form under that dialect", () => {
    const doc = committed();
    const forms = doc.date_forms as Record<string, unknown>;
    const names = Object.keys(forms).sort();
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const ajv = new Ajv2020({ strict: false });
      expect(() => ajv.compile(forms[name] as object)).not.toThrow();
    }
  });
});
