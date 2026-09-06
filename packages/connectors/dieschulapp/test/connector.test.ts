/**
 * Tests for the DieSchulApp connector. The fakes below are not mocks in the
 * "fake behaviour from an interface" sense: they are shaped after the
 * captured evidence in `fixtures/dieschulapp/variant-001/capture.json` —
 * the shape comes from there, the values are fake (this tree stays fake;
 * the fixture trees carry real values). In particular the student blocks
 * fed below carry `forename`, `surname`, `displayname`, `mainCourse`: the
 * live response contains them (the committed allowlist simply keeps none of
 * them), and that is exactly what the tests use to prove the connector
 * never reads them.
 *
 * Validation against the normalized contract is the core package's own Zod
 * schema (`TimetableEntry.parse`), not a reimplementation here.
 */
import { describe, expect, it } from "vitest";
import {
  assertNoCookieHeaders,
  capabilitiesOf,
  ConnectorError,
  TimetableEntry,
} from "@school-connector-kit/core";
import type {
  ConnectorError as CoreConnectorError,
  HttpRequest,
  HttpResponse,
  TimetableEntry as CoreTimetableEntry,
} from "@school-connector-kit/core";
import { createDieSchulAppConnector } from "../src/connector.js";

/* ————————————————————————————————————— fakes ————————————————————————————————————— */

/**
 * Fake transport: a queue of canned responses; `enqueueFailure` makes the
 * next `send` reject. Every request sent is recorded, so tests can pin the
 * exact wire request.
 */
class ScriptedTransport {
  readonly sent: HttpRequest[] = [];
  private readonly queue: { response?: HttpResponse; failure?: Error }[] = [];

  enqueue(status: number, body: string, headers: Record<string, string> = {}): void {
    this.queue.push({ response: { status, headers, body } });
  }

  enqueueFailure(message: string): void {
    this.queue.push({ failure: new Error(message) });
  }

  async send(request: HttpRequest): Promise<HttpResponse> {
    this.sent.push(request);
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error("scripted transport: no response left in the queue");
    }
    if (next.failure !== undefined) {
      throw next.failure;
    }
    if (next.response === undefined) {
      throw new Error("scripted transport: no response left in the queue");
    }
    return next.response;
  }
}

class FixedClock {
  constructor(private readonly nowMs: number) {}

  now(): number {
    return this.nowMs;
  }
}

class RecordingLogger {
  readonly events: { event: string; fields: Record<string, number | boolean> }[] = [];

  debug(event: string, fields: Record<string, number | boolean> = {}): void {
    this.events.push({ event, fields });
  }
}

/* ————————————————————————————— fakes and constants ————————————————————————————— */

/** 2026-08-30T14:10:22.000Z — a Sunday; that week runs 2026-08-24..2026-08-30. */
const FIXED_NOW_MS = Date.UTC(2026, 7, 30, 14, 10, 22);
const FIXED_NOW_ISO = new Date(FIXED_NOW_MS).toISOString();

const CONFIG = {
  baseUrl: "https://dieschulapp.example.invalid",
  sourceInstance: "tenant-instance-placeholder",
};

const CREDENTIALS = {
  user: "placeholder-user",
  password: "placeholder-password",
};

/**
 * Login response: the evidence pins the login to HTTP 200 plus the
 * DSASESSID `Set-Cookie` (the session; the Transport's to keep). The body
 * is a plain JSON object which the connector reads nothing of — a fake
 * `Set-Cookie` header is carried on the canned response so it looks like a
 * real one.
 */
const LOGIN_OK_BODY = "{}";
const LOGIN_OK_HEADERS = {
  "Set-Cookie": "DSASESSID=placeholder-session; HttpOnly; SameSite=Lax",
};

/**
 * One student block, two entries. The identity fields on `student` are
 * deliberately present: they must not survive into any emitted row.
 * Entry 501 carries a subject with an acronym; 502's subject has no
 * `acronym` key at all, exercising the optional-acronym path.
 */
const HAPPY_BODY = JSON.stringify({
  students: [
    {
      student: {
        id: 4242,
        forename: "placeholder-forename",
        surname: "placeholder-surname",
        displayname: "placeholder-displayname",
        mainCourse: {
          id: 9009,
          name: "placeholder-maincourse",
          externalId: "placeholder-maincourse-external",
          type: "standard",
        },
      },
      entries: [
        {
          id: 501,
          weekday: 0,
          room: null,
          timetableBlock: null,
          courseSubject: {
            id: 7001,
            type: "normal",
            teachers: [
              {
                id: 3101,
                forename: "placeholder-teacher-one",
                surname: "placeholder-teacher-one-family",
              },
            ],
            subject: {
              id: 8001,
              name: "placeholder-subject-alpha",
              acronym: "pa",
              hexColor: "#ff00aa",
            },
            course: {
              id: 9101,
              name: "placeholder-course-alpha",
              externalId: "placeholder-course-alpha-external",
              type: "normal",
            },
          },
          timeTableSlot: {
            id: 6101,
            number: 2,
            startTime: "08:00",
            endTime: "08:45",
            type: "lesson",
            name: "placeholder-slot-name",
          },
        },
        {
          id: 502,
          weekday: 2,
          room: null,
          timetableBlock: null,
          courseSubject: {
            id: 7002,
            type: "normal",
            teachers: [
              {
                id: 3102,
                forename: "placeholder-teacher-two",
                surname: "placeholder-teacher-two-family",
              },
            ],
            subject: {
              id: 8002,
              name: "placeholder-subject-beta",
              hexColor: "#0fffbb",
            },
            course: {
              id: 9102,
              name: "placeholder-course-beta",
              externalId: "placeholder-course-beta-external",
              type: "normal",
            },
          },
          timeTableSlot: {
            id: 6102,
            number: 4,
            startTime: "09:00",
            endTime: "09:45",
            type: "lesson",
            name: "placeholder-slot-name",
          },
        },
      ],
    },
  ],
  vacations: [],
});

/** One student block with caller-supplied entries; identity fields present. */
function weekBody(studentId: number, entries: Record<string, unknown>[]): string {
  return JSON.stringify({
    students: [
      {
        student: {
          id: studentId,
          forename: "placeholder-forename",
          surname: "placeholder-surname",
          displayname: "placeholder-displayname",
          mainCourse: {
            id: 9009,
            name: "placeholder-maincourse",
            externalId: "placeholder-maincourse-external",
            type: "standard",
          },
        },
        entries,
      },
    ],
    vacations: [],
  });
}

/** A well-formed entry; the tests override individual fields when probing. */
function entrySpec(
  id: number,
  weekday: number,
  subjectName: string,
  slotNumber: number,
  startTime: string,
  endTime: string,
): Record<string, unknown> {
  return {
    id,
    weekday,
    room: null,
    timetableBlock: null,
    courseSubject: {
      id: 7000 + id,
      type: "normal",
      teachers: [
        {
          id: 3000 + id,
          forename: "placeholder-teacher-one",
          surname: "placeholder-teacher-one-family",
        },
      ],
      subject: {
        id: 8000 + id,
        name: subjectName,
        hexColor: "#ff00aa",
      },
      course: {
        id: 9000 + id,
        name: "placeholder-course",
        externalId: "placeholder-course-external",
        type: "normal",
      },
    },
    timeTableSlot: {
      id: 6000 + id,
      number: slotNumber,
      startTime,
      endTime,
      type: "lesson",
      name: "placeholder-slot-name",
    },
  };
}

/* ————————————————————————————— test plumbing ————————————————————————————— */

function makeConnector(transport: ScriptedTransport, logger = new RecordingLogger()) {
  return {
    connector: createDieSchulAppConnector(
      { transport, clock: new FixedClock(FIXED_NOW_MS), logger },
      CONFIG,
    ),
    logger,
  };
}

type ErrorCode = "auth_failed" | "transport_failed" | "unexpected_response";

async function expectConnectorError(
  input: Promise<unknown>,
  code: ErrorCode,
): Promise<void> {
  let caught: unknown;
  try {
    await input;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConnectorError);
  const error = caught as CoreConnectorError;
  expect(error.code).toBe(code);
  // Error-hygiene pin (ADR-003): the message is a fixed literal chosen in
  // the connector. None of the placeholder values below may ever leak into
  // it, nor may any canned response body.
  for (const forbidden of [
    "placeholder-user",
    "placeholder-password",
    "placeholder-session",
    "tenant-instance-placeholder",
    "placeholder-forename",
    "placeholder-surname",
    "placeholder-displayname",
    "not-json",
    "unauthorized",
    "service-unavailable",
  ]) {
    expect(error.message).not.toContain(forbidden);
  }
}

/** Parse each emitted row against the core schema; the parsed rows are the test's rows. */
async function fetchRows(
  connector: ReturnType<typeof createDieSchulAppConnector>,
  request: Record<string, unknown>,
): Promise<CoreTimetableEntry[]> {
  const fetcher = connector.fetchers["timetable_entry"];
  expect(fetcher).toBeTypeOf("function");
  const raw = await (fetcher as (r: unknown) => Promise<readonly unknown[]>)(request);
  return raw.map((row) => TimetableEntry.parse(row)) as CoreTimetableEntry[];
}

/** The weekday_slot location of a parsed row (kind-checked first). */
function weekdayLocation(row: CoreTimetableEntry) {
  expect(row.location.kind).toBe("weekday_slot");
  if (row.location.kind !== "weekday_slot") {
    throw new Error("weekdayLocation: the row did not carry a weekday_slot location");
  }
  return row.location;
}

/* ————————————————————————————————————— tests ————————————————————————————————————— */

describe("DieSchulApp connector: happy path (no window)", () => {
  it("authenticates, fetches the single clock-now week, and emits one schema-validated row per entry", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(200, LOGIN_OK_BODY, LOGIN_OK_HEADERS);
    transport.enqueue(200, HAPPY_BODY, {});
    const { connector, logger } = makeConnector(transport);

    await connector.authenticate(CREDENTIALS);
    const rows = await fetchRows(connector, {});

    expect(rows).toHaveLength(2);

    // The login request, fully pinned (credentials are the only fields in
    // the body; the response's Set-Cookie is the session and stays with
    // the Transport).
    expect(transport.sent[0]).toEqual({
      method: "PUT",
      url: "https://dieschulapp.example.invalid/api/1.0/admin/login/",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: "placeholder-user",
        password: "placeholder-password",
      }),
    });

    // The week request: the clock's own day (2026-08-30) named verbatim,
    // `week=true`, `substitutions=false`, and no headers at all.
    expect(transport.sent[1]).toEqual({
      method: "GET",
      url: "https://dieschulapp.example.invalid/api/1.0/current-timetable/" +
        "?date=2026-08-30&week=true&substitutions=false",
      headers: {},
    });

    // First row, end to end: the platform's own values verbatim, the
    // subject name/acronym pair, the student reference built from the id
    // alone, the week anchor naming the exact date requested.
    expect(rows[0]).toEqual({
      concept: "timetable_entry",
      location: {
        kind: "weekday_slot",
        weekday: 0,
        slot_number: 2,
        start_time: "08:00",
        end_time: "08:45",
        subject: { name: "placeholder-subject-alpha", acronym: "pa" },
        student: {
          concept: "student_reference",
          student_id: "4242",
          provenance: {
            concept: "provenance_envelope",
            source_platform: "dieschulapp",
            source_instance: "tenant-instance-placeholder",
            source_record_id: "501",
            captured_at: FIXED_NOW_ISO,
            request: {
              method: "GET",
              status: 200,
              url_template: "/api/1.0/current-timetable/",
              logical_call: "current-timetable",
            },
          },
        },
        week_anchor: {
          present_in_response: false,
          resolution: "out_of_band_request_parameter",
          date: "2026-08-30",
        },
      },
      provenance: {
        concept: "provenance_envelope",
        source_platform: "dieschulapp",
        source_instance: "tenant-instance-placeholder",
        source_record_id: "501",
        captured_at: FIXED_NOW_ISO,
        request: {
          method: "GET",
          status: 200,
          url_template: "/api/1.0/current-timetable/",
          logical_call: "current-timetable",
        },
      },
    });

    // Second row: subject without acronym (the acronym key must be absent,
    // not null), the rest as the schema requires.
    const second = rows[1]!;
    expect(weekdayLocation(second).subject).toEqual({
      name: "placeholder-subject-beta",
    });
    expect(second.location).not.toHaveProperty("acronym");
    expect(second.provenance.source_record_id).toBe("502");

    // ADR-009 decision 2 — `occurrence` is not set for this platform; the
    // same goes for `allowlist_version` and the request index.
    for (const row of rows) {
      expect("occurrence" in row.provenance).toBe(false);
      expect("allowlist_version" in row.provenance).toBe(false);
      expect("index" in row.provenance.request).toBe(false);
    }

    // Redaction of the identity block and class identity: none of it may
    // appear anywhere in the serialized rows — while the id IS there.
    const serialized = JSON.stringify(rows);
    for (const forbidden of [
      "placeholder-forename",
      "placeholder-surname",
      "placeholder-displayname",
      "placeholder-maincourse",
      "placeholder-teacher",
      "placeholder-course",
      "9009",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).toContain('"student_id":"4242"');

    // Exactly one debug event, from the fetch; fields numbers only.
    expect(logger.events).toEqual([
      { event: "dieschulapp_timetable_fetch", fields: { status: 200, row_count: 2 } },
    ]);
  });

  it("reports platform name and capabilities derived from the fetcher keys", () => {
    const { connector } = makeConnector(new ScriptedTransport());
    expect(connector.platform).toBe("dieschulapp");
    expect(capabilitiesOf(connector)).toEqual(["timetable_entry"]);
  });
});

describe("DieSchulApp connector: window translation (ADR-008)", () => {
  it("covers a multi-week window with one request per in-scope week and clips out-of-window records", async () => {
    const transport = new ScriptedTransport();
    // Week of 2026-08-31: 601 resolves to 2026-09-04 (in window, at the
    // start bound); 602 resolves to 2026-08-31 (before the window — clip).
    transport.enqueue(
      200,
      weekBody(4243, [
        entrySpec(601, 4, "placeholder-subject-p", 1, "08:00", "08:45"),
        entrySpec(602, 0, "placeholder-subject-q", 2, "08:00", "08:45"),
      ]),
      {},
    );
    // Week of 2026-09-07: 603 (2026-09-09), 604 (2026-09-11), and 605
    // (2026-09-13, the to-inclusive bound — kept).
    transport.enqueue(
      200,
      weekBody(4244, [
        entrySpec(603, 2, "placeholder-subject-r", 3, "09:00", "09:45"),
        entrySpec(604, 4, "placeholder-subject-s", 5, "11:00", "11:45"),
        entrySpec(605, 6, "placeholder-subject-t", 7, "13:00", "13:45"),
      ]),
      {},
    );
    const { connector, logger } = makeConnector(transport);

    const rows = await fetchRows(connector, {
      window: { fromInclusive: "2026-09-04", toInclusive: "2026-09-13" },
    });

    expect(rows.map((row) => row.provenance.source_record_id)).toEqual([
      "601",
      "603",
      "604",
      "605",
    ]);

    // One request per in-scope week, seven-day orbit, Monday-anchored —
    // and no third request for the week of 2026-09-14.
    expect(transport.sent.map((request) => request.url)).toEqual([
      "https://dieschulapp.example.invalid/api/1.0/current-timetable/" +
        "?date=2026-08-31&week=true&substitutions=false",
      "https://dieschulapp.example.invalid/api/1.0/current-timetable/" +
        "?date=2026-09-07&week=true&substitutions=false",
    ]);

    // Each row's anchor is the date ITS request named.
    expect(weekdayLocation(rows[0]!).week_anchor.date).toBe("2026-08-31");
    for (const row of rows.slice(1)) {
      expect(weekdayLocation(row).week_anchor.date).toBe("2026-09-07");
    }

    // The clipped record (602, 2026-08-31) is not merely out-of-order: it
    // is absent from the serialized output.
    expect(JSON.stringify(rows)).not.toContain("602");
    expect(logger.events).toEqual([
      { event: "dieschulapp_timetable_fetch", fields: { status: 200, row_count: 4 } },
    ]);
  });

  it("covers a window that straddles a week boundary at the end (Friday..Monday)", async () => {
    // The window 2026-09-04..2026-09-07 intersects two weeks. A raw-start
    // orbit (Friday dates) would request only the first week's Friday and
    // stop at 2026-09-11, never fetching the Monday 2026-09-07 — dropping
    // an in-scope record, the failure ADR-008 decision 1 forbids. The
    // Monday-anchored orbit requests both weeks.
    const transport = new ScriptedTransport();
    transport.enqueue(
      200,
      weekBody(4243, [entrySpec(701, 5, "placeholder-subject-u", 1, "08:00", "08:45")]),
      {},
    );
    transport.enqueue(
      200,
      weekBody(4243, [entrySpec(702, 0, "placeholder-subject-v", 2, "08:00", "08:45")]),
      {},
    );
    const { connector } = makeConnector(transport);

    const rows = await fetchRows(connector, {
      window: { fromInclusive: "2026-09-04", toInclusive: "2026-09-07" },
    });

    expect(rows.map((row) => row.provenance.source_record_id)).toEqual(["701", "702"]);
    expect(weekdayLocation(rows[1]!).week_anchor.date).toBe("2026-09-07");
  });

  it("needs exactly one request for a whole-week window and keeps both bounds", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(
      200,
      weekBody(4242, [
        entrySpec(801, 0, "placeholder-subject-w", 1, "08:00", "08:45"),
        entrySpec(802, 6, "placeholder-subject-x", 8, "12:00", "12:45"),
      ]),
      {},
    );
    const { connector } = makeConnector(transport);

    const rows = await fetchRows(connector, {
      window: { fromInclusive: "2026-08-31", toInclusive: "2026-09-06" },
    });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.url).toContain("date=2026-08-31");
    // 801 -> 2026-08-31 (from bound, kept); 802 -> 2026-09-06 (to bound, kept).
    expect(rows.map((row) => row.provenance.source_record_id)).toEqual(["801", "802"]);
  });

  it("rejects a window whose start is after its end without sending anything", async () => {
    const transport = new ScriptedTransport();
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      fetchRows(connector, {
        window: { fromInclusive: "2026-09-07", toInclusive: "2026-09-01" },
      }),
      "unexpected_response",
    );
    expect(transport.sent).toHaveLength(0);
  });

  it("rejects a non-date window bound without sending anything", async () => {
    const transport = new ScriptedTransport();
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      fetchRows(connector, {
        window: { fromInclusive: "30-08-2026", toInclusive: "2026-09-06" },
      }),
      "unexpected_response",
    );
    expect(transport.sent).toHaveLength(0);
  });
});

describe("DieSchulApp connector: authentication", () => {
  it("accepts a 200 JSON login and sends nothing else on its own", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(200, LOGIN_OK_BODY, LOGIN_OK_HEADERS);
    const { connector } = makeConnector(transport);

    await connector.authenticate(CREDENTIALS);

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.method).toBe("PUT");
  });

  it("fails with auth_failed on a non-200 login response", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(401, "unauthorized", {});
    const { connector } = makeConnector(transport);
    await expectConnectorError(connector.authenticate(CREDENTIALS), "auth_failed");
  });

  it("fails with auth_failed when the login body is not valid JSON", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(200, "not-json", {});
    const { connector } = makeConnector(transport);
    await expectConnectorError(connector.authenticate(CREDENTIALS), "auth_failed");
  });

  it("fails with auth_failed when the credentials are not both strings, without sending anything", async () => {
    const transport = new ScriptedTransport();
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      connector.authenticate({ user: "placeholder-user" }),
      "auth_failed",
    );
    expect(transport.sent).toHaveLength(0);
  });

  it("fails with transport_failed when the login transport rejects", async () => {
    const transport = new ScriptedTransport();
    transport.enqueueFailure("placeholder-transport-failure");
    const { connector } = makeConnector(transport);
    await expectConnectorError(connector.authenticate(CREDENTIALS), "transport_failed");
  });
});

describe("DieSchulApp connector: fetch guards", () => {
  it("fails with transport_failed when the week transport rejects", async () => {
    const transport = new ScriptedTransport();
    transport.enqueueFailure("placeholder-transport-failure");
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      fetchRows(connector, { window: { fromInclusive: "2026-09-01", toInclusive: "2026-09-06" } }),
      "transport_failed",
    );
  });

  it("fails with unexpected_response on a non-200 week response", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(503, "service-unavailable", {});
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      fetchRows(connector, { window: { fromInclusive: "2026-09-01", toInclusive: "2026-09-06" } }),
      "unexpected_response",
    );
  });

  it("fails with unexpected_response when the week body is not valid JSON", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(200, "not-json", {});
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      fetchRows(connector, { window: { fromInclusive: "2026-09-01", toInclusive: "2026-09-06" } }),
      "unexpected_response",
    );
  });

  it("fails with unexpected_response when the body has no students array", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(200, JSON.stringify({ vacations: [] }), {});
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      fetchRows(connector, { window: { fromInclusive: "2026-09-01", toInclusive: "2026-09-06" } }),
      "unexpected_response",
    );
  });

  it("fails with unexpected_response when a student block has no entries array", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(200, JSON.stringify({ students: [{}] }), {});
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      fetchRows(connector, { window: { fromInclusive: "2026-09-01", toInclusive: "2026-09-06" } }),
      "unexpected_response",
    );
  });

  it("fails with unexpected_response when a student block is missing its student object", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(
      200,
      JSON.stringify({
        students: [
          { entries: [entrySpec(901, 1, "placeholder-subject-y", 1, "08:00", "08:45")] },
        ],
      }),
      {},
    );
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      fetchRows(connector, { window: { fromInclusive: "2026-09-01", toInclusive: "2026-09-06" } }),
      "unexpected_response",
    );
  });

  it("fails with unexpected_response when the student id is not an integer", async () => {
    const transport = new ScriptedTransport();
    // A student block whose `id` is a string — the identity fields are
    // present but the one field this connector reads is the wrong type.
    transport.enqueue(
      200,
      JSON.stringify({
        students: [
          {
            student: {
              id: "4242",
              forename: "placeholder-forename",
              surname: "placeholder-surname",
              displayname: "placeholder-displayname",
              mainCourse: { id: 9009, name: "placeholder-maincourse", type: "standard" },
            },
            entries: [entrySpec(901, 1, "placeholder-subject-y", 1, "08:00", "08:45")],
          },
        ],
        vacations: [],
      }),
      {},
    );
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      fetchRows(connector, { window: { fromInclusive: "2026-09-01", toInclusive: "2026-09-06" } }),
      "unexpected_response",
    );
  });

  it("fails with unexpected_response when an entry id is not an integer", async () => {
    const transport = new ScriptedTransport();
    const entry = entrySpec(901, 1, "placeholder-subject-z", 1, "08:00", "08:45");
    entry["id"] = "901";
    transport.enqueue(200, weekBody(4243, [entry]), {});
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      fetchRows(connector, { window: { fromInclusive: "2026-09-01", toInclusive: "2026-09-06" } }),
      "unexpected_response",
    );
  });

  it("fails with unexpected_response when a weekday is outside 0..6", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(200, weekBody(4243, [entrySpec(901, 7, "placeholder-subject", 1, "08:00", "08:45")]), {});
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      fetchRows(connector, { window: { fromInclusive: "2026-09-01", toInclusive: "2026-09-06" } }),
      "unexpected_response",
    );
  });

  it("fails with unexpected_response when a slot number is not positive", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(200, weekBody(4243, [entrySpec(901, 1, "placeholder-subject", 0, "08:00", "08:45")]), {});
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      fetchRows(connector, { window: { fromInclusive: "2026-09-01", toInclusive: "2026-09-06" } }),
      "unexpected_response",
    );
  });

  it("fails with unexpected_response when a start time is not a string", async () => {
    const transport = new ScriptedTransport();
    const entry = entrySpec(901, 1, "placeholder-subject", 1, "08:00", "08:45");
    entry["timeTableSlot"] = {
      id: 6901,
      number: 1,
      startTime: 800,
      endTime: "08:45",
      type: "lesson",
      name: "placeholder-slot-name",
    };
    transport.enqueue(200, weekBody(4243, [entry]), {});
    const { connector } = makeConnector(transport);
    await expectConnectorError(
      fetchRows(connector, { window: { fromInclusive: "2026-09-01", toInclusive: "2026-09-06" } }),
      "unexpected_response",
    );
  });

  it("omits the subject entirely when the subject name is not a string", async () => {
    const transport = new ScriptedTransport();
    const entry = entrySpec(901, 1, "placeholder-subject", 1, "08:00", "08:45");
    (entry["courseSubject"] as Record<string, unknown>)["subject"] = {
      id: 8901,
      name: 505,
      hexColor: "#ff00aa",
    };
    transport.enqueue(200, weekBody(4243, [entry]), {});
    const { connector } = makeConnector(transport);

    const rows = await fetchRows(connector, {
      window: { fromInclusive: "2026-09-01", toInclusive: "2026-09-06" },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.location).not.toHaveProperty("subject");
    // Everything else about the row is intact.
    expect(row.provenance.source_record_id).toBe("901");
    expect(weekdayLocation(row).weekday).toBe(1);
  });
});

describe("DieSchulApp connector: contract invariants", () => {
  it("sends no cookie-family header itself, and the core guard rejects a request that carries one", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(200, LOGIN_OK_BODY, LOGIN_OK_HEADERS);
    transport.enqueue(200, HAPPY_BODY, {});
    const { connector } = makeConnector(transport);
    await connector.authenticate(CREDENTIALS);
    await fetchRows(connector, {});

    // Every request the connector built is clean of cookie traffic, which
    // the Transport owns (ADR-003 decision 3).
    for (const request of transport.sent) {
      for (const key of Object.keys(request.headers)) {
        const folded = key.toLowerCase();
        expect(folded).not.toBe("cookie");
        expect(folded).not.toBe("set-cookie");
      }
    }

    // The core guard's own pin: it rejects cookie headers on ANY request,
    // and its message carries neither key nor value.
    let caught: unknown;
    try {
      assertNoCookieHeaders({
        method: "GET",
        url: "https://dieschulapp.example.invalid/",
        headers: { "Set-Cookie": "DSASESSID=placeholder-session; HttpOnly" },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConnectorError);
    const guardError = caught as CoreConnectorError;
    expect(guardError.code).toBe("unexpected_response");
    expect(guardError.message).not.toContain("placeholder-session");
    expect(guardError.message).not.toContain("set-cookie");
  });

  it("does not require a connector-held session: fetch before authenticate is legal, because the session is the Transport's", async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(200, HAPPY_BODY, {});
    const { connector } = makeConnector(transport);

    // Unlike the Schulmanager connector (whose bearer token lives in the
    // connector), there is no state here that would gate this call.
    const rows = await fetchRows(connector, {});
    expect(rows).toHaveLength(2);
    expect(transport.sent).toHaveLength(1);
  });
});
