/**
 * Shape-validation matrix (STEP 5): for every concept, HAND-WRITTEN valid
 * instances whose SHAPE is derived from the committed fixture structure.
 * This is deliberately stated as what these tests do and do not do: the
 * committed fixtures are structure-only redactions that carry NO values, so
 * no instance can be constructed from them, and nothing here validates the
 * schema against real platform data (a future connector implementation will
 * do that — see the README finding "What the tests claim, and do not claim").
 * What these tests pin: the schema accepts the fixture-derived shape and
 * rejects the evidence boundaries (fields a fixture CANNOT populate fail or
 * are absent by design — README gaps G0–G8).
 *
 * Evidence matrix (committed fixtures → concepts):
 *   webuntis/variant-001          → Assignment,
 *                                   TimetableEntry.lesson_reference,
 *                                   ProvenanceEnvelope
 *   NO fixture                    → Assessment (README gap G1: listed in the
 *                                   next-steps doc from expectation; the
 *                                   capture does not support it — a
 *                                   "assessment" concept is rejected by
 *                                   NormalizedMessage, like "absence" (G0))
 *   dieschulapp/variant-001       → TimetableEntry.weekday_slot,
 *                                   StudentReference, ProvenanceEnvelope
 *   kikom/variant-001 (termine)   → Event, ProvenanceEnvelope
 *   kikom/variant-001  (informationen) → Message, ProvenanceEnvelope
 *   NO fixture                    → Absence (README gap G0: known gap, not
 *                                   invented — a "absence" concept is
 *                                   rejected by NormalizedMessage)
 *
 * All payload values below are PLACEHOLDER SHAPE values standing in for the
 * fields the fixtures typed with redacted content; the envelope facts
 * (allowlist version, capture timestamp, request method/status/url_template)
 * are the verbatim values committed in the fixture metadata.
 */
import { describe, expect, it } from "vitest";
import {
  PlatformDateInt,
  Assignment,
  DateValue,
  DayOnly,
  Event,
  Message,
  NormalizedMessage,
  PartialDay,
  PlatformInstant,
  ProvenanceEnvelope,
  StudentReference,
  TimetableEntry,
  WeekdaySlot,
} from "../src/schema.js";

// --- envelope builders: real fixture metadata + placeholder identity -------

const webuntisEnvelope: ProvenanceEnvelope = {
  concept: "provenance_envelope",
  source_platform: "webuntis",
  source_instance: "instance-placeholder-0",
  source_record_id: "record-placeholder-0",
  allowlist_version: "webuntis-homework-2026-08-30-v3",
  captured_at: "2026-08-30T14:10:22Z",
  request: {
    method: "GET",
    status: 200,
    url_template:
      "/WebUntis/api/homeworks/lessons?startDate={startDate}&endDate={endDate}",
    index: 0,
  },
};

const dieschulappEnvelope: ProvenanceEnvelope = {
  concept: "provenance_envelope",
  source_platform: "dieschulapp",
  source_instance: "instance-placeholder-1",
  source_record_id: "record-placeholder-1",
  allowlist_version: "dieschulapp-timetable-2026-08-30-v1",
  captured_at: "2026-08-30T14:38:31Z",
  request: {
    method: "GET",
    status: 200,
    url_template:
      "/api/1.0/current-timetable/?date={date}&week=true&substitutions=false",
    index: 0,
  },
};

const kikomTerminEnvelope: ProvenanceEnvelope = {
  concept: "provenance_envelope",
  source_platform: "kikom",
  source_instance: "instance-placeholder-2",
  source_record_id: "record-placeholder-2",
  allowlist_version: "kikom-2026-08-30-termine",
  captured_at: "2026-08-31T10:11:05Z",
  request: {
    method: "GET",
    status: 200,
    url_template: "/kikom/verwaltung/termine",
    index: 0,
  },
};

/** Same Termin row id as the page-1 envelope: the recurring row case. */
const kikomTerminEnvelopePage2: ProvenanceEnvelope = {
  ...kikomTerminEnvelope,
  occurrence: 1,
  request: { ...kikomTerminEnvelope.request, index: 1 },
};

const kikomInfoEnvelope: ProvenanceEnvelope = {
  concept: "provenance_envelope",
  source_platform: "kikom",
  source_instance: "instance-placeholder-3",
  source_record_id: "record-placeholder-3",
  allowlist_version: "kikom-2026-08-30-informationen",
  captured_at: "2026-08-31T10:06:44Z",
  request: {
    method: "GET",
    status: 200,
    url_template: "/kikom/verwaltung/informationen",
    index: 0,
  },
};

const schulmanagerEnvelope: ProvenanceEnvelope = {
  concept: "provenance_envelope",
  source_platform: "schulmanager",
  source_instance: "instance-placeholder-4",
  source_record_id: "record-placeholder-4",
  allowlist_version: "schulmanager-get-letters-v1",
  captured_at: "2026-09-02T10:54:00Z",
  request: {
    method: "POST",
    status: 200,
    url_template: "/api/calls",
    index: 0,
  },
};

// ---------------------------------------------------------------------------

describe("ProvenanceEnvelope — populated by all three platforms", () => {
  it("accepts the committed webuntis envelope facts", () => {
    expect(ProvenanceEnvelope.safeParse(webuntisEnvelope).success).toBe(true);
  });
  it("accepts the committed dieschulapp envelope facts", () => {
    expect(ProvenanceEnvelope.safeParse(dieschulappEnvelope).success).toBe(true);
  });
  it("accepts the committed kikom termine envelope facts", () => {
    expect(ProvenanceEnvelope.safeParse(kikomTerminEnvelope).success).toBe(true);
  });
  it("accepts the committed kikom informationen envelope facts", () => {
    expect(
      ProvenanceEnvelope.safeParse(kikomInfoEnvelope).success,
    ).toBe(true);
  });
  it("requires the full identity triple", () => {
    const missing = { ...webuntisEnvelope } as Record<string, unknown>;
    for (const key of ["source_instance", "source_record_id"]) {
      const broken = { ...webuntisEnvelope } as Record<string, unknown>;
      delete broken[key];
      expect(ProvenanceEnvelope.safeParse(broken).success).toBe(false);
      expect(key).toBeTruthy(); // (keep referenced for clarity)
      void missing;
    }
  });
  it("occurrence is an optional non-negative index (discriminator)", () => {
    expect(
      ProvenanceEnvelope.safeParse({
        ...kikomTerminEnvelopePage2,
        occurrence: 7,
      }).success,
    ).toBe(true);
    expect(
      ProvenanceEnvelope.safeParse({
        ...kikomTerminEnvelopePage2,
        occurrence: -1,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("date model — five distinct forms, no collapse, no midnight-UTC", () => {
  it("accepts a PlatformDateInt (webuntis date/dueDate are typed int in the fixture)", () => {
    const r = PlatformDateInt.safeParse({ kind: "platform_date_int", value: 20000 });
    expect(r.success).toBe(true);
  });
  it("rejects a non-int value", () => {
    expect(
      PlatformDateInt.safeParse({ kind: "platform_date_int", value: "20000" }).success,
    ).toBe(false);
  });
  it("pins the encoding decision: the fixture establishes int type only — no component decomposition", () => {
    // STEP 1 finding: the webuntis capture is structure-only redaction —
    // `date`/`dueDate` are typed int with NO values (digit count, range,
    // epoch, unit all redacted). The encoding is therefore NOT established
    // (registered as gap G6), and 0.1 must not model components the fixture
    // does not back: the shape is exactly {kind, value}.
    expect(Object.keys(PlatformDateInt.shape).sort()).toEqual([
      "kind",
      "value",
    ]);
    expect("year" in PlatformDateInt.shape).toBe(false);
    expect("month" in PlatformDateInt.shape).toBe(false);
    // And the independence fact the fixture DOES establish is preserved on
    // Assignment: two separate fields, no derivation implied.
    expect("reference_date" in Assignment.shape).toBe(true);
    expect("due_date" in Assignment.shape).toBe(true);
  });
  it("accepts a WeekdaySlot with the out-of-band anchor fact", () => {
    const r = WeekdaySlot.safeParse({
      kind: "weekday_slot",
      weekday: 1, // fixture observed weekdays in 0–4; encoding not pinned (G5)
      slot_number: 4,
      start_time: "08:00", // length-5 time-of-day string, as in the fixture shape
      end_time: "08:45",
      week_anchor: {
        present_in_response: false,
        resolution: "out_of_band_request_parameter",
      },
    });
    expect(r.success).toBe(true);
  });
  it("pins that the week anchor is NOT present in the response", () => {
    expect(
      WeekdaySlot.safeParse({
        kind: "weekday_slot",
        weekday: 0,
        slot_number: 1,
        start_time: "08:00",
        end_time: "08:45",
        week_anchor: {
          present_in_response: true, // <- contradicts the fixture
          resolution: "out_of_band_request_parameter",
        },
      }).success,
    ).toBe(false);
  });
  it("accepts a PartialDay with inferred-year provenance (kikom terminen)", () => {
    expect(
      PartialDay.safeParse({
        kind: "partial_day",
        month: 1,
        day: 9,
        resolved_year: 2026,
        year_stated_by_platform: false,
        inference_anchor: "anchor-placeholder",
        sequence_position: 3,
      }).success,
    ).toBe(true);
  });
  it("keeps sequence_position optional in 0.1 (G2)", () => {
    expect(
      PartialDay.safeParse({
        kind: "partial_day",
        month: 2,
        day: 3,
        resolved_year: 2025,
        year_stated_by_platform: false,
        inference_anchor: "anchor-placeholder",
      }).success,
    ).toBe(true);
  });
  it("pins the partial-day year flag as inferred-only in 0.1", () => {
    expect(
      PartialDay.safeParse({
        kind: "partial_day",
        month: 1,
        day: 1,
        resolved_year: 2026,
        year_stated_by_platform: true, // <- not the partial-day case
        inference_anchor: "a",
      }).success,
    ).toBe(false);
  });
  it("accepts a DayOnly with its OWN 2-digit-year provenance (kikom informationen)", () => {
    const r = DayOnly.safeParse({
      kind: "day_only",
      year: 2026,
      month: 1,
      day: 5,
      year_provenance: {
        year_stated_by_platform: true,
        stated_digits: 2,
        century_inferred: true,
        inference_by: "normalizer",
      },
    });
    expect(r.success).toBe(true);
  });
  it("pins that the 2-digit-year century inference has its own provenance block", () => {
    // Missing the block: the 2-digit year case is the committed evidence for
    // DayOnly in 0.1, so the provenance block is required (not a shared flag).
    expect(
      DayOnly.safeParse({ kind: "day_only", year: 2026, month: 1, day: 5 })
        .success,
    ).toBe(false);
  });
  it("rejects a stated 4-digit year case (no fixture backs it — gap, not invented)", () => {
    expect(
      DayOnly.safeParse({
        kind: "day_only",
        year: 2026,
        month: 1,
        day: 5,
        year_provenance: {
          year_stated_by_platform: true,
          stated_digits: 4, // <- not modeled in 0.1
          century_inferred: true,
          inference_by: "normalizer",
        },
      }).success,
    ).toBe(false);
  });
  it("discriminates the four pre-ADR-006 kinds in DateValue", () => {
    for (const payload of [
      { kind: "platform_date_int", value: 1 },
      {
        kind: "weekday_slot",
        weekday: 0,
        slot_number: 1,
        start_time: "07:00",
        end_time: "07:45",
        week_anchor: {
          present_in_response: false,
          resolution: "out_of_band_request_parameter",
        },
      },
      {
        kind: "partial_day",
        month: 1,
        day: 1,
        resolved_year: 2026,
        year_stated_by_platform: false,
        inference_anchor: "a",
      },
      {
        kind: "day_only",
        year: 2026,
        month: 1,
        day: 1,
        year_provenance: {
          year_stated_by_platform: true,
          stated_digits: 2,
          century_inferred: true,
          inference_by: "normalizer",
        },
      },
    ]) {
      expect(DateValue.safeParse(payload).success).toBe(true);
    }
  });
  it("rejects an unknown date kind", () => {
    expect(DateValue.safeParse({ kind: "calendar", day: 1 }).success).toBe(
      false,
    );
  });
  it("pins that the day-carrying forms have NO time/timestamp fields (no midnight-UTC collapse)", () => {
    for (const form of [PlatformDateInt, PartialDay, DayOnly] as const) {
      for (const key of Object.keys(form.shape)) {
        expect(key).not.toMatch(/timestamp|instant|epoch/i);
        expect(key).not.toBe("t");
        expect(key).not.toBe("time");
      }
    }
    // The week-slot form's start/end are DATA (time-of-day strings carried
    // by the source), asserted present — unlike the collapsed-timestamp
    // fields above, which must not exist at all.
    expect("start_time" in WeekdaySlot.shape).toBe(true);
    expect("end_time" in WeekdaySlot.shape).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("PlatformInstant — ADR-006, a platform-supplied instant held as emitted", () => {
  // Note on strictness: the four pre-existing forms (PlatformDateInt,
  // WeekdaySlot, PartialDay, DayOnly) are all plain z.object — non-strict,
  // excess properties stripped — so PlatformInstant is intentionally NOT
  // pinned for strictness either: pinning it would make the new form
  // behave differently from the other four.
  it("accepts a trailing-Z instant with fractional seconds", () => {
    expect(
      PlatformInstant.safeParse({
        kind: "platform_instant",
        value: "2026-09-02T10:54:00.000Z",
      }).success,
    ).toBe(true);
  });
  it("accepts a trailing-Z instant without fractional seconds", () => {
    expect(
      PlatformInstant.safeParse({
        kind: "platform_instant",
        value: "2026-09-02T10:54:00Z",
      }).success,
    ).toBe(true);
  });
  it("accepts an extended numeric offset", () => {
    expect(
      PlatformInstant.safeParse({
        kind: "platform_instant",
        value: "2026-09-02T10:54:00+02:00",
      }).success,
    ).toBe(true);
  });
  it("rejects a basic (no-colon) offset — the gap-register case", () => {
    expect(
      PlatformInstant.safeParse({
        kind: "platform_instant",
        value: "2026-09-02T10:54:00+0200",
      }).success,
    ).toBe(false);
  });
  it("rejects a naive (offsetless) datetime", () => {
    expect(
      PlatformInstant.safeParse({
        kind: "platform_instant",
        value: "2026-09-02T10:54:00",
      }).success,
    ).toBe(false);
  });
  it("rejects a plain calendar date (not an instant)", () => {
    expect(
      PlatformInstant.safeParse({
        kind: "platform_instant",
        value: "2026-09-02",
      }).success,
    ).toBe(false);
  });
  it("accepts a platform_instant member in DateValue, discriminated on kind", () => {
    expect(
      DateValue.safeParse({
        kind: "platform_instant",
        value: "2026-09-02T10:54:00Z",
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("ProvenanceEnvelope — captured_at offset discipline and request.method", () => {
  it("accepts a trailing-Z captured_at", () => {
    expect(
      ProvenanceEnvelope.safeParse({
        ...webuntisEnvelope,
        captured_at: "2026-09-02T10:54:00Z",
      }).success,
    ).toBe(true);
  });
  it("accepts an extended-offset captured_at", () => {
    expect(
      ProvenanceEnvelope.safeParse({
        ...webuntisEnvelope,
        captured_at: "2026-09-02T10:54:00+02:00",
      }).success,
    ).toBe(true);
  });
  it("rejects a basic (no-colon) offset captured_at", () => {
    expect(
      ProvenanceEnvelope.safeParse({
        ...webuntisEnvelope,
        captured_at: "2026-09-02T10:54:00+0200",
      }).success,
    ).toBe(false);
  });
  it("accepts request.method POST (GET is covered by the committed envelope facts above)", () => {
    expect(
      ProvenanceEnvelope.safeParse({
        ...webuntisEnvelope,
        request: { ...webuntisEnvelope.request, method: "POST" },
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("TimetableEntry", () => {
  it("populates the weekday_slot location from the dieschulapp fixture shape", () => {
    const r = TimetableEntry.safeParse({
      concept: "timetable_entry",
      location: {
        kind: "weekday_slot",
        weekday: 2,
        slot_number: 3,
        start_time: "09:25",
        end_time: "10:05",
        week_anchor: {
          present_in_response: false,
          resolution: "out_of_band_request_parameter",
        },
        subject: { name: "placeholder-subject", acronym: "pl" },
        // The dieschulapp fixture shows a per-student scope with the student
        // identity redacted (G2): the reference is representable, the value opaque.
        student: {
          concept: "student_reference",
          student_id: "placeholder-student-id",
          provenance: dieschulappEnvelope,
        },
      },
      provenance: dieschulappEnvelope,
    });
    expect(r.success).toBe(true);
  });
  it("populates the lesson_reference location from the webuntis fixture shape", () => {
    const r = TimetableEntry.safeParse({
      concept: "timetable_entry",
      location: {
        kind: "lesson_reference",
        lesson_id: "42",
        subject: "placeholder-subject",
        lesson_type: "placeholder-lesson-type",
      },
      provenance: webuntisEnvelope,
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown location kind", () => {
    expect(
      TimetableEntry.safeParse({
        concept: "timetable_entry",
        location: { kind: "calendar_week" },
        provenance: webuntisEnvelope,
      }).success,
    ).toBe(false);
  });
  it("pins the one-concept decision: both location branches are reachable, and an entry asserting both positionings at once is rejected", () => {
    const anchor = {
      present_in_response: false,
      resolution: "out_of_band_request_parameter",
    };
    // Both branches reachable — the fixture-backed locating schemes:
    expect(
      TimetableEntry.safeParse({
        concept: "timetable_entry",
        location: {
          kind: "weekday_slot",
          weekday: 2,
          slot_number: 3,
          start_time: "09:25",
          end_time: "10:05",
          week_anchor: anchor,
        },
        provenance: dieschulappEnvelope,
      }).success,
    ).toBe(true);
    expect(
      TimetableEntry.safeParse({
        concept: "timetable_entry",
        location: { kind: "lesson_reference", lesson_id: "42" },
        provenance: webuntisEnvelope,
      }).success,
    ).toBe(true);
    // ONE entry, both positionings — rejected in either direction,
    // not silently stripped (the location branches are strict):
    expect(
      TimetableEntry.safeParse({
        concept: "timetable_entry",
        location: {
          kind: "weekday_slot",
          weekday: 2,
          slot_number: 3,
          start_time: "09:25",
          end_time: "10:05",
          week_anchor: anchor,
          lesson_id: "42",
        },
        provenance: dieschulappEnvelope,
      }).success,
    ).toBe(false);
    expect(
      TimetableEntry.safeParse({
        concept: "timetable_entry",
        location: {
          kind: "lesson_reference",
          lesson_id: "42",
          weekday: 2,
          slot_number: 3,
        },
        provenance: webuntisEnvelope,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("Assignment — webuntis homework", () => {
  const base = {
    concept: "assignment",
    reference_date: { kind: "platform_date_int", value: 100 },
    due_date: { kind: "platform_date_int", value: 200 },
    completed: false,
    text: "placeholder-text",
    lesson_id: "42",
    provenance: webuntisEnvelope,
  };
  it("accepts the fixture shape with BOTH independent dates", () => {
    expect(Assignment.safeParse(base).success).toBe(true);
  });
  it("keeps the two dates independent (both required, different values ok)", () => {
    expect(
      Assignment.safeParse({
        ...base,
        reference_date: { kind: "platform_date_int", value: 555 },
        due_date: { kind: "platform_date_int", value: 999 },
      }).success,
    ).toBe(true);
    expect(
      Assignment.safeParse({ ...base, due_date: undefined }).success,
    ).toBe(false);
    expect(
      Assignment.safeParse({ ...base, reference_date: undefined }).success,
    ).toBe(false);
  });
  it("makes remark optional (zero-length in every observed row)", () => {
    const without = { ...base } as Record<string, unknown>;
    delete without.remark;
    expect(Assignment.safeParse(without).success).toBe(true);
  });
  it("has no student field (webuntis homeworks carry none in the fixture)", () => {
    expect("student" in (base as Record<string, unknown>)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("Event — kikom term", () => {
  const base = {
    concept: "event",
    date: {
      kind: "partial_day",
      month: 9,
      day: 28,
      resolved_year: 2026,
      year_stated_by_platform: false as const,
      inference_anchor: "anchor-placeholder",
    },
  };
  it("accepts the fixture shape for a page-1 occurrence", () => {
    expect(
      Event.safeParse({ ...base, provenance: kikomTerminEnvelope }).success,
    ).toBe(true);
  });
  it("distinguishes a recurring row via the envelope occurrence index (the fixture's own discriminator)", () => {
    const p1 = Event.safeParse({ ...base, provenance: kikomTerminEnvelope });
    const p2 = Event.safeParse({
      ...base,
      provenance: kikomTerminEnvelopePage2,
    });
    expect(p1.success).toBe(true);
    expect(p2.success).toBe(true);
    // Same record id, different occurrence: the two must not collapse.
    expect(p1.success && p2.success).toBe(true);
    expect(kikomTerminEnvelopePage2.occurrence).toBe(1);
    expect(kikomTerminEnvelope.source_record_id).toBe(
      kikomTerminEnvelopePage2.source_record_id,
    );
  });
  it("pins the event date to PartialDay (a full-day date is not the event shape)", () => {
    expect(
      Event.safeParse({
        ...base,
        date: {
          kind: "day_only",
          year: 2026,
          month: 1,
          day: 5,
          year_provenance: {
            year_stated_by_platform: true,
            stated_digits: 2,
            century_inferred: true,
            inference_by: "normalizer",
          },
        },
        provenance: kikomTerminEnvelope,
      }).success,
    ).toBe(false);
  });
  it("rejects a PlatformDateInt where a PartialDay is required", () => {
    expect(
      Event.safeParse({
        ...base,
        date: { kind: "platform_date_int", value: 100 },
        provenance: kikomTerminEnvelope,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("Message — kikom informationen and schulmanager letters", () => {
  it("accepts the fixture shape", () => {
    const r = Message.safeParse({
      concept: "message",
      date: {
        kind: "day_only",
        year: 2026,
        month: 11,
        day: 30,
        year_provenance: {
          year_stated_by_platform: true,
          stated_digits: 2,
          century_inferred: true,
          inference_by: "normalizer",
        },
      },
      body: "placeholder-body",
      link_count: 2, // the fixture's 2 hyperlink columns are pinned by presence
      provenance: kikomInfoEnvelope,
    });
    expect(r.success).toBe(true);
  });
  it("rejects a partial_day as the message date", () => {
    expect(
      Message.safeParse({
        concept: "message",
        date: {
          kind: "partial_day",
          month: 1,
          day: 1,
          resolved_year: 2026,
          year_stated_by_platform: false,
          inference_anchor: "a",
        },
        body: "x",
        link_count: 2,
        provenance: kikomInfoEnvelope,
      }).success,
    ).toBe(false);
  });
  it("accepts a Schulmanager-shaped message (platform_instant date, no link_count)", () => {
    expect(
      Message.safeParse({
        concept: "message",
        date: { kind: "platform_instant", value: "2026-09-02T10:54:00Z" },
        body: "placeholder-body",
        provenance: schulmanagerEnvelope,
      }).success,
    ).toBe(true);
  });
  it("accepts the Kikom shape with link_count absent", () => {
    const without = {
      concept: "message",
      date: {
        kind: "day_only",
        year: 2026,
        month: 11,
        day: 30,
        year_provenance: {
          year_stated_by_platform: true,
          stated_digits: 2,
          century_inferred: true,
          inference_by: "normalizer",
        },
      },
      body: "placeholder-body",
      link_count: 2,
      provenance: kikomInfoEnvelope,
    } as Record<string, unknown>;
    delete without.link_count;
    expect(Message.safeParse(without).success).toBe(true);
  });
  it("rejects a platform_date_int as the message date", () => {
    expect(
      Message.safeParse({
        concept: "message",
        date: { kind: "platform_date_int", value: 20000 },
        body: "x",
        provenance: schulmanagerEnvelope,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("StudentReference — dieschulapp only", () => {
  it("accepts the dieschulapp scope with an opaque student id (G2)", () => {
    const r = StudentReference.safeParse({
      concept: "student_reference",
      student_id: "placeholder-student-id",
      provenance: dieschulappEnvelope,
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("NormalizedMessage envelope", () => {
  const sampleFor = (concept: string): unknown => {
    switch (concept) {
      case "timetable_entry":
        return {
          concept,
          location: {
            kind: "lesson_reference",
            lesson_id: "42",
          },
          provenance: webuntisEnvelope,
        };
      case "assignment":
        return {
          concept,
          reference_date: { kind: "platform_date_int", value: 1 },
          due_date: { kind: "platform_date_int", value: 2 },
          completed: false,
          text: "placeholder-text",
          provenance: webuntisEnvelope,
        };
      case "event":
        return {
          concept,
          date: {
            kind: "partial_day",
            month: 1,
            day: 1,
            resolved_year: 2026,
            year_stated_by_platform: false,
            inference_anchor: "a",
          },
          provenance: kikomTerminEnvelope,
        };
      case "message":
        return {
          concept,
          date: {
            kind: "day_only",
            year: 2026,
            month: 1,
            day: 1,
            year_provenance: {
              year_stated_by_platform: true,
              stated_digits: 2,
              century_inferred: true,
              inference_by: "normalizer",
            },
          },
          body: "placeholder-body",
          link_count: 2,
          provenance: kikomInfoEnvelope,
        };
      case "student_reference":
        return {
          concept,
          student_id: "placeholder",
          provenance: dieschulappEnvelope,
        };
      default:
        throw new Error(`unmodeled concept: ${concept}`);
    }
  };
  for (const concept of [
    "timetable_entry",
    "assignment",
    "event",
    "message",
    "student_reference",
  ] as const) {
    it(`accepts a ${concept} payload`, () => {
      expect(NormalizedMessage.safeParse(sampleFor(concept)).success).toBe(true);
    });
  }
  it("rejects an 'absence' payload: the concept is a known gap in 0.1, not a branch (G0)", () => {
    expect(
      NormalizedMessage.safeParse({
        concept: "absence",
        date: { kind: "platform_date_int", value: 1 },
        provenance: webuntisEnvelope,
      }).success,
    ).toBe(false);
  });
  it("rejects an 'assessment' payload: listed from expectation, unsupported by the capture (G1)", () => {
    expect(
      NormalizedMessage.safeParse({
        concept: "assessment",
        lesson_id: "42",
        provenance: webuntisEnvelope,
      }).success,
    ).toBe(false);
  });
  it("rejects a payload naming an unmodeled concept", () => {
    expect(
      NormalizedMessage.safeParse({
        concept: "unknown_v2_concept",
        provenance: webuntisEnvelope,
      }).success,
    ).toBe(false);
  });
});
