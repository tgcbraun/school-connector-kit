/**
 * Pure builder for the schema document: consumed both by the CLI writer
 * (generate-json-schema.ts) and by the pinning test, so the test always
 * exercises the same code path that produced the committed file.
 */
import { createRequire } from "node:module";
import { z } from "zod";
import {
  Assignment,
  DateValue,
  DayOnly,
  Event,
  Message,
  NormalizedMessage,
  PartialDay,
  PlatformDateInt,
  PlatformInstant,
  ProvenanceEnvelope,
  SCHEMA_VERSION,
  StudentReference,
  TimetableEntry,
  WeekdaySlot,
} from "./schema.js";

export function zodVersion(): string {
  const require = createRequire(import.meta.url);
  return String(
    (require("zod/package.json") as { version?: unknown }).version ?? "unknown",
  );
}

function toJSONSchema(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema, { target: "draft-2020-12" });
}

/** Recursively copy to plain data with object keys sorted: canonical form. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2) + "\n";
}

export function buildDocument(): Record<string, unknown> {
  return canonicalize({
    title: "school-connector-kit normalized schema",
    schema_version: SCHEMA_VERSION,
    source_of_truth:
      "Zod definitions in packages/core/src/schema.ts — this document is generated, never hand-written",
    generator: {
      api: "zod v4 z.toJSONSchema",
      zod_version: zodVersion(),
    },
    json_schema_dialect: "https://json-schema.org/draft/2020-12/schema",
    concepts: {
      timetable_entry: toJSONSchema(TimetableEntry),
      assignment: toJSONSchema(Assignment),
      event: toJSONSchema(Event),
      message: toJSONSchema(Message),
      student_reference: toJSONSchema(StudentReference),
      provenance_envelope: toJSONSchema(ProvenanceEnvelope),
      normalized_message: toJSONSchema(NormalizedMessage),
    },
    date_forms: {
      platform_date_int: toJSONSchema(PlatformDateInt),
      weekday_slot: toJSONSchema(WeekdaySlot),
      partial_day: toJSONSchema(PartialDay),
      day_only: toJSONSchema(DayOnly),
      platform_instant: toJSONSchema(PlatformInstant),
      date_value: toJSONSchema(DateValue),
    },
  }) as Record<string, unknown>;
}
