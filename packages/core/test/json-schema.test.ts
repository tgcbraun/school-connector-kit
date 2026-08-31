/**
 * JSON Schema pinning (STEP 5): the committed JSON Schema document must be
 * byte-identical (canonicalized) to what the Zod definitions generate RIGHT
 * NOW — i.e. the document is generated from Zod, not hand-written. This test
 * also pins the structural facts of the 0.1 surface: the dialect, the set of
 * concepts, the four distinct date forms, and that "absence" is NOT modeled.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDocument, canonicalJson } from "../src/document.js";
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

describe("committed JSON Schema document", () => {
  it("is byte-identical to a fresh generation from the Zod definitions", () => {
    expect(readFileSync(goldenPath, "utf8")).toBe(canonicalJson(buildDocument()));
  });
  it("declares itself as generated-from-Zod with the dialect", () => {
    const d = committed();
    expect(d.schema_version).toBe(SCHEMA_VERSION);
    expect(String(d.json_schema_dialect)).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(
      String(d.source_of_truth).toLowerCase().includes("zod"),
    ).toBe(true);
  });
  it("models exactly the 0.1 concept set (Absence AND Assessment absent — gaps G0, G1)", () => {
    const keys = Object.keys(
      committed().concepts as Record<string, unknown>,
    ).sort();
    expect(keys).toEqual([
      "assignment",
      "event",
      "message",
      "normalized_message",
      "provenance_envelope",
      "student_reference",
      "timetable_entry",
    ]);
    expect(String(JSON.stringify(committed().concepts))).not.toContain(
      '"absence"',
    );
    expect(String(JSON.stringify(committed().concepts))).not.toContain(
      '"assessment"',
    );
  });
  it("models exactly the four distinct date forms plus the union", () => {
    const keys = Object.keys(committed().date_forms as Record<string, unknown>)
      .sort();
    expect(keys).toEqual([
      "date_value",
      "day_only",
      "partial_day",
      "platform_date_int",
      "weekday_slot",
    ]);
  });
  it("gives each date form a distinct kind constant", () => {
    const forms = committed().date_forms as Record<
      string,
      { properties?: Record<string, { const?: unknown }> }
    >;
    const kinds = [
      forms.platform_date_int?.properties?.kind?.const,
      forms.weekday_slot?.properties?.kind?.const,
      forms.partial_day?.properties?.kind?.const,
      forms.day_only?.properties?.kind?.const,
    ];
    expect(kinds).toEqual([
      "platform_date_int",
      "weekday_slot",
      "partial_day",
      "day_only",
    ]);
    expect(new Set(kinds).size).toBe(4);
  });
  it("pins additionalProperties:false on the day-carrying forms (no time slot to add)", () => {
    const forms = committed().date_forms as Record<string, { additionalProperties?: boolean }>;
    for (const name of ["platform_date_int", "partial_day", "day_only"]) {
      expect(forms[name]?.additionalProperties).toBe(false);
    }
  });
  it("pinned the weekday_slot anchor facts into the schema", () => {
    const js = JSON.stringify(
      (committed().date_forms as Record<string, unknown>).weekday_slot,
    );
    expect(js).toContain("out_of_band_request_parameter");
    expect(js).toContain('"weekday_slot"');
  });
  it("pinned the 2-digit-year provenance block for day_only but not a 4-digit variant", () => {
    const js = JSON.stringify(
      (committed().date_forms as Record<string, unknown>).day_only,
    );
    expect(js).toContain('"stated_digits"');
    const stated = JSON.parse(js) as {
      properties: { year_provenance: { properties: { stated_digits: { const: number } } } };
    };
    expect(stated.properties.year_provenance.properties.stated_digits.const).toBe(2);
  });
  it("pins the partial-day provenance trio (flag, anchor, optional sequence position)", () => {
    const props = (
      (committed().date_forms as Record<string, unknown>).partial_day as {
        properties: Record<string, unknown>;
      }
    ).properties;
    expect("year_stated_by_platform" in props).toBe(true);
    expect("inference_anchor" in props).toBe(true);
    expect("sequence_position" in props).toBe(true);
    expect(
      (props.year_stated_by_platform as { const?: unknown }).const,
    ).toBe(false);
  });
  it("pins the identity trio + optional occurrence on the envelope", () => {
    const props = (
      (committed().concepts as Record<string, unknown>).provenance_envelope as {
        properties: Record<string, unknown>;
      }
    ).properties;
    for (const key of [
      "source_platform",
      "source_instance",
      "source_record_id",
      "occurrence",
      "allowlist_version",
      "captured_at",
      "request",
    ]) {
      expect(key in props).toBe(true);
    }
  });
});
