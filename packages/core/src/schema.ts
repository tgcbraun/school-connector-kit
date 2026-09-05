/**
 * school-connector-kit — normalized schema 0.1
 *
 * Evidence discipline: every field below is backed by a committed fixture in
 * `fixtures/{webuntis,dieschulapp,kikom}/variant-001/`. A concept or field a
 * fixture cannot populate is NOT invented here; it is recorded as a gap in
 * this package's README (including Absence) and reported per the review
 * instructions. Test payload values are placeholders for shapes the fixture
 * typed (e.g. a redacted string), never real data.
 *
 * Date model — five distinct forms, deliberately NOT collapsed into a single
 * timestamp. Collapsing a Berlin local midnight into a UTC instant lands at
 * 22:00 UTC on the PREVIOUS calendar day and shifts the day by one for
 * consumers. Nothing in this schema converts date forms into one another.
 *
 * Zod is the single executable source of this schema. The committed JSON
 * Schema (schema/normalized-schema-0.1.json) is generated from these
 * definitions and byte-pinned by a test — it is never hand-written.
 */
import { z } from "zod";

export const SCHEMA_VERSION = "0.1";

/** The four platforms with committed fixtures. */
export const Platform = z.enum(["webuntis", "dieschulapp", "kikom", "schulmanager"]);
export type Platform = z.infer<typeof Platform>;

// ---------------------------------------------------------------------------
// ProvenanceEnvelope — concept, populated by all three fixtures
// ---------------------------------------------------------------------------
// Identity model: source_platform + source_instance + source_record_id, plus
// an occurrence discriminator.
//
// `source_record_id` alone is never assumed globally unique: the Kikom
// fixture shows a recurring Termin repeating the same row id across
// occurrences, and the platform's own answer for the occurrence is an index
// — the tx_calendarize_calendar[index] parameter name carried in both
// committed Kikom Termin requests. The model therefore carries an optional
// index discriminator beside the identity triple.
//
// The record/tenant id VALUES were redacted from every fixture by design, so
// they travel here as opaque strings. The envelope facts (allowlist version,
// capture timestamp, request shape/status) are the only verbatim values the
// fixtures supply, and they are typed accordingly.

export const ProvenanceEnvelope = z.object({
  concept: z.literal("provenance_envelope"),
  /** Identity component 1: which platform the record came from. */
  source_platform: Platform,
  /**
   * Identity component 2: the tenant/school instance. Every fixture records
   * that a tenant identity exists at the source, but all tenant identity
   * values were dropped by the allowlists — carried as an opaque string
   * (README gap G3).
   */
  source_instance: z.string(),
  /**
   * Identity component 3: the platform's own row id in the captured
   * response. Never globally unique on its own (Kikom recurring rows repeat
   * it; that is exactly what `occurrence` disambiguates).
   */
  source_record_id: z.string(),
  /**
   * Occurrence discriminator — the platform's own index (Kikom:
   * tx_calendarize_calendar[index]). Optional because only the Kikom
   * fixture demonstrates record ids repeating across occurrences; the other
   * fixtures do not exhibit that case.
   */
  occurrence: z.int().nonnegative().optional(),
  /**
   * Verbatim capture envelope facts (typed, not value-pinned).
   * `captured_at` remains required — it is supplied by the record's
   * producer. `allowlist_version` is optional: it describes the redaction
   * that produced a fixture, and a connector reading live data has none.
   * Both remain typed; neither is value-pinned.
   */
  allowlist_version: z.string().optional(),
  captured_at: z.iso.datetime({ offset: true }),
  request: z.object({
    method: z.enum(["GET", "POST"]),
    status: z.literal(200),
    /** The request's URL template: shape only, never private values. */
    url_template: z.string(),
    /**
     * Position of this request inside the capture's `requests[]` array. A
     * connector reading live data has no capture `requests[]` array and
     * therefore does not populate it.
     */
    index: z.int().nonnegative().optional(),
    /**
     * The platform-scoped logical call that established this row's identity:
     * opaque, and never a cross-platform join key (ADR-004 decision 1).
     * Optional, and absence means the URL identifies the call. Unlike
     * `index`, a connector populates this, and its values must match those
     * recorded in the platform's committed fixture.
     */
    logical_call: z.string().min(1).optional(),
  }),
});
export type ProvenanceEnvelope = z.infer<typeof ProvenanceEnvelope>;

// ---------------------------------------------------------------------------
// Date model — five distinct forms, no collapse, no conversions
// ---------------------------------------------------------------------------

/**
 * 1) Platform date int — WebUntis `date` / `dueDate`.
 *
 * STEP 1 finding, established by re-reading the fixture: the committed
 * capture is structure-only redaction. Both fields are typed `int`; the
 * fixture carries NO values for them (digit count, range, epoch, and unit
 * are all redacted — the fixture README states the capture contains no real
 * values). The one structural fact the fixture does establish: the two
 * fields are independent per row (their offset is not uniform, so neither
 * is derivable from the other — both must be preserved, as Assignment does).
 *
 * CONSEQUENCE: the integer's encoding is NOT established by the committed
 * fixture — it is a gap register entry (G6), not a modeling decision we get
 * to make. 0.1 therefore does NOT decompose the value into
 * year/month/day components (a component decomposition would be an
 * unestablished assumption) and does NOT claim a granularity either. The
 * name states only what the fixture shows: a date field the platform
 * supplies as an integer. A consumer comparing or ordering `reference_date`
 * vs `due_date` does so on the platform's own integer values, which is
 * exactly what the fixture's independence fact supports.
 */
export const PlatformDateInt = z.object({
  kind: z.literal("platform_date_int"),
  value: z.int(),
});
export type PlatformDateInt = z.infer<typeof PlatformDateInt>;

/**
 * 2) Weekday + slot — DieSchulApp.
 *
 * Weekday is an int (0–4 observed; the fixture does not establish which
 * weekday the values encode — README gap G5). The slot number plus
 * start/end are time-of-day strings (length 5 in the fixture; the exact
 * grammar is not pinned, the raw string is what is preserved).
 *
 * The week ANCHOR is out-of-band: the committed fixture carries it only as
 * the request's `date` query parameter, never in the response.
 * `week_anchor` records that fact instead of pretending the entry holds an
 * absolute date.
 */
export const WeekdaySlot = z.object({
  kind: z.literal("weekday_slot"),
  weekday: z.int().min(0).max(6),
  slot_number: z.int().positive(),
  start_time: z.string(),
  end_time: z.string(),
  /**
   * The response proves the anchor is NOT here. A consumer that needs the
   * week must supply it out-of-band, exactly as the capture did.
   */
  week_anchor: z.object({
    present_in_response: z.literal(false),
    resolution: z.literal("out_of_band_request_parameter"),
  }),
});
export type WeekdaySlot = z.infer<typeof WeekdaySlot>;

/**
 * 3) Partial day — Kikom Termin date.
 *
 * The page shows day + month and NO year (every captured Termin row parses
 * as a single DD.MM. value — a range branch has never been exercised; see
 * the Kikom fixture README). The normalizer must therefore infer the year,
 * and that inference is not self-evident to a downstream consumer, so this
 * form carries BOTH:
 *
 *   - a flag distinguishing an inferred year from a stated one
 *     (`year_stated_by_platform`), and
 *   - the anchor the inference was resolved against (`inference_anchor`;
 *     Kikom resolves against a server-supplied anchor AND the row position
 *     in an ordered sequence — a non-decreasing floor that detects a
 *     mid-list New Year rollover).
 *
 * The fixture supports the sequence position too: the
 * tx_calendarize_calendar[index] parameter present in both committed Termin
 * requests shows the platform's own answer is an indexed ordered sequence.
 * `sequence_position` is therefore modeled — optional in 0.1 because the
 * fixtures redact per-row values (README gap G4).
 *
 * What this form is NOT: the Kikom Informationen two-digit-year case. That
 * page STATES a two-digit year and its century inference is a DISTINCT
 * inference — it travels with its own provenance block on DayOnly and must
 * not be read through the `year_stated_by_platform` flag defined here.
 */
export const PartialDay = z.object({
  kind: z.literal("partial_day"),
  month: z.int().min(1).max(12),
  day: z.int().min(1).max(31),
  /** The year the normalizer assigned, always recorded next to its inference. */
  resolved_year: z.int().min(1900),
  /** False on every 0.1 Termin date: the platform never stated a year. */
  year_stated_by_platform: z.literal(false),
  /**
   * Where the inference was resolved against; opaque — Kikom's anchor value
   * was redacted from the fixtures.
   */
  inference_anchor: z.string(),
  /**
   * Position of the row in the platform's ordered sequence (optional:
   * present because the fixture backs the mechanism, absent because 0.1
   * has no per-row pinned value to echo).
   */
  sequence_position: z.int().nonnegative().optional(),
});
export type PartialDay = z.infer<typeof PartialDay>;

/**
 * 4) Day-only — a calendar day (year + month + day) with NO time component.
 *
 * Distinct from PlatformDateInt (platform date int) and distinct from any timestamp:
 * modeling a day as "midnight UTC" mis-dates it for any source whose local
 * day boundary is not UTC (Berlin midnight = 22:00 UTC on the previous
 * day). This type cannot carry a time component; it is the type-level
 * expression of that rule.
 *
 * 0.1's committed evidence for a stated year is Kikom Informationen, whose
 * date column states a TWO-digit year. The platform stated a year (partially)
 * and the normalizer inferred the century — a distinct inference from the
 * partial-day one, recorded by its own `year_provenance` block rather than
 * through `PartialDay.year_stated_by_platform`.
 */
export const DayOnly = z.object({
  kind: z.literal("day_only"),
  year: z.int().min(1900),
  month: z.int().min(1).max(12),
  day: z.int().min(1).max(31),
  /**
   * The year's provenance, for the case the platform stated fewer than four
   * digits. Kept structurally separate from the partial-day flag on purpose:
   * two different inferences must not share one flag.
   */
  year_provenance: z.object({
    year_stated_by_platform: z.literal(true),
    stated_digits: z.literal(2),
    century_inferred: z.literal(true),
    /** Name of the party that applied the inference. */
    inference_by: z.literal("normalizer"),
  }),
});
export type DayOnly = z.infer<typeof DayOnly>;

/**
 * 5) Platform instant — an instant the platform supplies as a string.
 *
 * Schulmanager: letter `createdAt`, `sentDate`, `updatedAt`, `readTimestamp`
 * and `sentTimestamp` — each a 24-character string in the committed capture.
 * The platform supplies the instant, and this form holds the platform's
 * string as emitted: it derives no civil day, assumes no timezone, and
 * records nothing on top of that.
 *
 * The serialization is NOT established by the corpus: capture format 1
 * records only a type token and a string length for these fields, and has
 * no facility for recording a pattern, so it cannot be established by any
 * future capture. The validator therefore accepts exactly as narrow a shape
 * as the evidence warrants — the trailing-Z form and an extended numeric
 * offset, not a basic offset — and the basic-offset risk is a gap register
 * entry, not a narrowing.
 */
export const PlatformInstant = z.object({
  kind: z.literal("platform_instant"),
  /** Held as emitted; a consumer needing a civil day must supply the zone. */
  value: z.iso.datetime({ offset: true }),
});
export type PlatformInstant = z.infer<typeof PlatformInstant>;

/** The five forms, discriminated by `kind`; no cross-conversion provided. */
export const DateValue = z.discriminatedUnion("kind", [
  PlatformDateInt,
  WeekdaySlot,
  PartialDay,
  DayOnly,
  PlatformInstant,
]);
export type DateValue = z.infer<typeof DateValue>;

// ---------------------------------------------------------------------------
// Concepts — each carries a ProvenanceEnvelope
// ---------------------------------------------------------------------------

/**
 * StudentReference — DieSchulApp has one; WebUntis homeworks do not.
 *
 * Evidence: the DieSchulApp capture is per-student (a students array of one,
 * timetable entries nested under it) — that is what backs the existence of a
 * student reference on that platform. The student's identity block itself
 * was dropped wholesale (students[].student is a dropped path in the
 * fixture), so `student_id` is pinned as an opaque string and nothing else
 * (README gap G2).
 *
 * WebUntis evidence is the ABSENCE of the field on homework rows: the
 * concept may be omitted there, but no committed fixture supplies one.
 */
export const StudentReference = z.object({
  concept: z.literal("student_reference"),
  student_id: z.string(),
  provenance: ProvenanceEnvelope,
});
export type StudentReference = z.infer<typeof StudentReference>;

/**
 * TimetableEntry — DieSchulApp (weekday + slot) AND WebUntis.
 *
 * The `location` union keeps the two fixture-backed locate forms distinct
 * rather than one bag of optional fields:
 *
 *  - `weekday_slot` — DieSchulApp: the WeekdaySlot date form extended with
 *    the per-entry subject (name/acronym block typed in the fixture, values
 *    redacted) and the student reference (its scope is shown, its identity
 *    redacted — G2).
 *  - `lesson_reference` — WebUntis: lesson identity. Homework rows reach
 *    lessons via `lessonId`, and `lessons[]` is keyed by id with
 *    subject/lessonType typed (values redacted).
 *
 * DECISION (recorded, not a gap): a timetable entry is ONE concept
 * regardless of how the platform addresses its position; the two
 * fixture-backed locating schemes are modeled as alternatives of that one
 * concept. No committed fixture emits both schemes in one entry, so no
 * combined branch is modeled (nothing to back one) — and no gap is recorded:
 * splitting this into two concepts would push a merge problem onto every
 * consumer of the normalized stream instead. The branches are strict: an
 * entry asserting both positionings at once is rejected, not silently
 * stripped (pinned by test).
 */
const TimetableEntryLocationWeekdaySlot = WeekdaySlot.extend({
  subject: z
    .object({
      name: z.string(),
      acronym: z.string().optional(),
    })
    .optional(),
  student: StudentReference.optional(),
}).strict();

const TimetableEntryLocationLesson = z
  .object({
    kind: z.literal("lesson_reference"),
    lesson_id: z.string(),
    subject: z.string().optional(),
    lesson_type: z.string().optional(),
  })
  .strict();

export const TimetableEntry = z.object({
  concept: z.literal("timetable_entry"),
  location: z.discriminatedUnion("kind", [
    TimetableEntryLocationWeekdaySlot,
    TimetableEntryLocationLesson,
  ]),
  provenance: ProvenanceEnvelope,
});
export type TimetableEntry = z.infer<typeof TimetableEntry>;

/**
 * Assignment — WebUntis homework.
 *
 * The fixture's strongest structural fact: `date` and `dueDate` are
 * independent integers (per-row offset is not uniform, so neither is
 * derivable from the other), and the request window selects on the due-date
 * field — so semantics should key on it: it is modeled as `due_date`; the
 * other is `reference_date`. Both required, two distinct PlatformDateInt
 * values, no offset relationship implied, and no component decomposition
 * (the fixture does not establish the integer's encoding — gap G6).
 *
 * `completed`, `text`, `lesson_id` are typed in the capture (values
 * redacted); `text` is non-zero-length in every observed row (kept required
 * without a length promise — lengths observed, values redacted); `remark`
 * was zero-length in every observed row, hence optional. No student field:
 * not present on WebUntis homeworks in the fixture.
 */
export const Assignment = z.object({
  concept: z.literal("assignment"),
  reference_date: PlatformDateInt,
  due_date: PlatformDateInt,
  completed: z.boolean(),
  text: z.string(),
  remark: z.string().optional(),
  lesson_id: z.string().optional(),
  provenance: ProvenanceEnvelope,
});
export type Assignment = z.infer<typeof Assignment>;

/**
 * Event — Kikom Termin.
 *
 * Date: a PartialDay (year absent on the page, inference + anchor recorded
 * per PartialDay). Identity: this is the concept whose fixture
 * demonstrably repeats record ids across occurrences, so its disambiguation
 * is REQUIRED in practice and lives on the ProvenanceEnvelope beside the
 * identity triple (`occurrence` — the platform's own index), not on two
 * places at once. `title` is the Termin row's text column (present in the
 * capture's column profile; values redacted).
 */
export const Event = z.object({
  concept: z.literal("event"),
  date: PartialDay,
  title: z.string().optional(),
  provenance: ProvenanceEnvelope,
});
export type Event = z.infer<typeof Event>;

/**
 * Message — Kikom Informationen and Schulmanager letters, one concept.
 *
 * Date: Kikom Informationen supplies a DayOnly whose two-digit year
 * carries its DISTINCT century-inference provenance (per
 * DayOnly.year_provenance); Schulmanager letters supply a
 * PlatformInstant. The two forms are alternatives on this one concept —
 * the schema provides no conversion between them. Body: required on the
 * concept; the committed evidence is the Kikom column, non-zero length in
 * the capture, values redacted.
 *
 * `link_count` is OPTIONAL because it pins the PRESENCE of Kikom's two
 * hyperlink columns the connector does not read (their targets were never
 * captured — README gap G7). No other platform in the corpus evidences a
 * link column, so on a Schulmanager letter its absence is a true statement
 * where 0 would be a false one.
 *
 * The Kikom fixture's `updated` column is a placeholder (length 1) with the
 * format never pinned, so 0.1 deliberately does NOT model an `updated`
 * field — README gap G8.
 */
export const Message = z.object({
  concept: z.literal("message"),
  date: z.discriminatedUnion("kind", [DayOnly, PlatformInstant]),
  body: z.string(),
  link_count: z.int().nonnegative().optional(),
  provenance: ProvenanceEnvelope,
});
export type Message = z.infer<typeof Message>;

/**
 * The normalized message envelope: exactly the five concept-bearing
 * messages, discriminated by `concept`. ProvenanceEnvelope itself is not
 * a payload message here — it is the identity layer attached to every
 * message above (and one of the six concepts of 0.1, populated by all
 * three fixtures).
 *
 * Absence and Assessment are intentionally not branches: no committed
 * fixture populates either. The package README records both as the known
 * gaps (G0, G1). A payload naming an unmodeled concept fails every branch
 * — the union enforces that.
 */
export const NormalizedMessage = z.discriminatedUnion("concept", [
  TimetableEntry,
  Assignment,
  Event,
  Message,
  StudentReference,
]);
export type NormalizedMessage = z.infer<typeof NormalizedMessage>;

/** The six concepts of schema 0.1. Absence and Assessment are deliberately absent. */
export const CONCEPTS = [
  "timetable_entry",
  "assignment",
  "event",
  "message",
  "student_reference",
  "provenance_envelope",
] as const;
export type Concept = (typeof CONCEPTS)[number];
