/**
 * DieSchulApp connector (schema 0.1, capability `timetable_entry`).
 *
 * Portability discipline (ADR-003): this module ships inside the host's
 * React Native / Flutter bundle, so it carries no Node built-ins and no DOM
 * globals — the closure test enforces that across the entry-point closure.
 * Its only I/O goes through the injected `Transport`.
 *
 * Session handling (ADR-003 decision 3): the DieSchulApp session is a
 * cookie (DSASESSID), established by the login response's Set-Cookie. Cookies
 * are the Transport's to own, so — unlike the Schulmanager connector, whose
 * session is an in-body bearer token it must hold — this factory keeps NO
 * session state: it never reads, writes, or inspects a `Cookie` or
 * `Set-Cookie` header, and every request it builds goes through
 * `assertNoCookieHeaders`. Fetching does not depend on any connector-held
 * state: whether the Transport holds a session is the Transport's affair.
 *
 * Window translation (ADR-008): a `FetchWindow` is a coverage obligation,
 * not a truncation allowance (decision 1). The platform is week-granular
 * and normalises any in-week date to its containing week (decision 6) —
 * which is exactly why a request date needs no Monday arithmetic — so a
 * window is covered by one request per in-scope week. The orbit therefore
 * steps in seven-day increments anchored at the Monday of the window
 * start's week: an orbit anchored at the raw window start can miss an
 * in-scope boundary week (a window of Friday..next-Monday intersects two
 * weeks, but a Friday orbit never lands on that Monday), while the
 * Monday-anchored orbit visits every in-scope week exactly once. Records
 * whose resolved civil date falls outside the window are clipped (decision 2);
 * that resolved date is used for the clipping alone and is never composed
 * into any output field (decision 4: no civil date is composed). Weekdays
 * encode ISO Monday-origin, Monday = zero (decision 5).
 *
 * Entry identity (ADR-009): `source_record_id` is the entry's own `id`,
 * stringified (decision 1). `occurrence` is NOT set: a weekly-template
 * platform's occurrence discriminator is `location.week_anchor.date`, and
 * nothing is invented to fill the slot (decision 2).
 *
 * Error hygiene (ADR-003): every `ConnectorError` message below is a fixed
 * literal chosen here; no response value, credential, URL, header, token,
 * or identifier value is ever interpolated into one.
 *
 * No civil-date value reaches the output fields: the rows carry the
 * platform's own values verbatim, and the only composed instant is
 * `captured_at`, the one ADR-002 allows.
 */
import { assertNoCookieHeaders, ConnectorError } from "@school-connector-kit/core";
import type {
  Connector,
  ConnectorConfig,
  ConnectorCredentials,
  ConnectorRuntime,
  FetchRequest,
  HttpRequest,
  HttpResponse,
  ProvenanceEnvelope,
  StudentReference,
  TimetableEntry,
  WeekdaySlot,
} from "@school-connector-kit/core";

/** One UTC day, in milliseconds (internal arithmetic only). */
const MILLIS_PER_DAY = 86_400_000;

/**
 * Configuration for `createDieSchulAppConnector`. `baseUrl` is the instance
 * base origin (no trailing slash); the login and current-timetable paths
 * are fixed by the platform API, so they are not configuration (ADR-005:
 * the base config type carries `sourceInstance` only — what each connector
 * additionally needs stays in the connector).
 */
export interface DieSchulAppConfig extends ConnectorConfig {
  readonly baseUrl: string;
}

/**
 * ADR-005: `runtime` is the first parameter. A factory that takes config
 * first invites `runtime` to slide into config, and that is the re-export
 * the ADR foresees.
 */
export function createDieSchulAppConnector(
  runtime: ConnectorRuntime,
  config: DieSchulAppConfig,
): Connector {
  const { baseUrl, sourceInstance } = config;

  async function authenticate(credentials: ConnectorCredentials): Promise<void> {
    const user = credentials["user"];
    const password = credentials["password"];
    if (typeof user !== "string" || typeof password !== "string") {
      throw new ConnectorError(
        "auth_failed",
        "credentials must carry a string user and a string password",
      );
    }
    const request: HttpRequest = {
      method: "PUT",
      url: `${baseUrl}/api/1.0/admin/login/`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, password }),
    };
    // ADR-003 decision 2: the only place a connector may touch a cookie is a
    // `Set-Cookie` it writes on login. This connector writes none itself —
    // the DieSchulApp login response carries it and the Transport keeps it —
    // and the guard pins the invariant that nothing this module builds ever
    // carries one.
    assertNoCookieHeaders(request);
    let response: HttpResponse;
    try {
      response = await runtime.transport.send(request);
    } catch {
      throw new ConnectorError("transport_failed", "the transport request failed");
    }
    if (response.status !== 200) {
      throw new ConnectorError("auth_failed", "authentication failed");
    }
    // The login response carries HTTP 200 and an empty body — observed
    // live, twice — and the session is the DSASESSID cookie the response
    // sets, which lives with the Transport (ADR-003 decision 3). Status 200
    // is therefore the whole post-condition: this connector may not inspect
    // Set-Cookie, so it verifies nothing further; the session's existence is
    // proven by the next call succeeding, not by this one.
  }

  /** One current-timetable request for a single in-scope week; raw body out. */
  async function fetchRawWeek(date: string): Promise<unknown> {
    const request: HttpRequest = {
      method: "GET",
      url: `${baseUrl}/api/1.0/current-timetable/?date=${date}&week=true&substitutions=false`,
      headers: {},
    };
    assertNoCookieHeaders(request);
    let response: HttpResponse;
    try {
      response = await runtime.transport.send(request);
    } catch {
      throw new ConnectorError("transport_failed", "the transport request failed");
    }
    if (response.status !== 200) {
      throw new ConnectorError(
        "unexpected_response",
        "the current-timetable response was not successful",
      );
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(response.body);
    } catch {
      throw new ConnectorError(
        "unexpected_response",
        "the current-timetable response was not valid JSON",
      );
    }
    return decoded;
  }

  async function fetchTimetableEntries(
    request: FetchRequest,
  ): Promise<readonly TimetableEntry[]> {
    // One captured instant for the whole fetch — a fetch is one
    // observation (ADR-002: `captured_at` is the one composition it allows);
    // the rows keep the platform's own fields verbatim.
    const capturedAt = new Date(runtime.clock.now()).toISOString();

    // Covering dates, one per in-scope week (module header: Monday-anchored
    // seven-day orbit). Without a window this is "now", not "everything":
    // the clock's own day selects the containing week — ADR-008 decision 6
    // normalises any in-week date to that week — so exactly one request.
    let orbitDates: string[];
    let windowStartMs: number | undefined;
    let windowEndMs: number | undefined;
    const requestedWindow = request.window;
    if (requestedWindow === undefined) {
      orbitDates = [msToIsoDate(runtime.clock.now())];
    } else {
      if (
        !isIsoCalendarDate(requestedWindow.fromInclusive) ||
        !isIsoCalendarDate(requestedWindow.toInclusive)
      ) {
        throw new ConnectorError(
          "unexpected_response",
          "the fetch window bounds are not calendar dates",
        );
      }
      const fromMs = isoMidnightMs(requestedWindow.fromInclusive);
      const toMs = isoMidnightMs(requestedWindow.toInclusive);
      if (fromMs > toMs) {
        throw new ConnectorError(
          "unexpected_response",
          "the fetch window start is after its end",
        );
      }
      windowStartMs = fromMs;
      windowEndMs = toMs;
      orbitDates = [];
      for (
        let orbitMs = mondayOfUtcMs(fromMs);
        orbitMs <= toMs;
        orbitMs += 7 * MILLIS_PER_DAY
      ) {
        orbitDates.push(msToIsoDate(orbitMs));
      }
    }

    const rows: TimetableEntry[] = [];

    for (const orbitDate of orbitDates) {
      const body = await fetchRawWeek(orbitDate);

      if (!isPlainObject(body)) {
        throw new ConnectorError(
          "unexpected_response",
          "the current-timetable response was not an object",
        );
      }
      const students = body["students"];
      if (!Array.isArray(students)) {
        throw new ConnectorError(
          "unexpected_response",
          "the current-timetable response did not carry a students array",
        );
      }

      // Monday (UTC ms) of the week this request fetched: the weekday
      // resolve base for the clipping below (internal arithmetic only).
      const weekMondayMs = mondayOfUtcMs(isoMidnightMs(orbitDate));

      for (const block of students) {
        if (!isPlainObject(block)) {
          throw new ConnectorError(
            "unexpected_response",
            "a students entry was not an object",
          );
        }
        const entries = block["entries"];
        if (!Array.isArray(entries)) {
          throw new ConnectorError(
            "unexpected_response",
            "a student block did not carry an entries array",
          );
        }
        if (entries.length === 0) {
          continue;
        }

        // `students[].student` carries forename, surname, displayname,
        // mainCourse — pupil and class identity that the fixture allowlist
        // drops wholesale (it drops the whole `students[].student` path).
        // This connector reads exactly one field from that block: `id`.
        const studentBlock = block["student"];
        if (!isPlainObject(studentBlock)) {
          throw new ConnectorError(
            "unexpected_response",
            "a student block did not carry a student object",
          );
        }
        const studentId = studentBlock["id"];
        if (typeof studentId !== "number" || !Number.isInteger(studentId)) {
          throw new ConnectorError(
            "unexpected_response",
            "the student block did not carry an integer id",
          );
        }

        for (const entry of entries) {
          if (!isPlainObject(entry)) {
            throw new ConnectorError(
              "unexpected_response",
              "a timetable entry was not an object",
            );
          }
          const id = entry["id"];
          if (typeof id !== "number" || !Number.isInteger(id)) {
            throw new ConnectorError(
              "unexpected_response",
              "a timetable entry did not carry an integer id",
            );
          }
          // ADR-008 decision 5: weekdays are ISO Monday-origin, Monday =
          // zero; the platform encodes them that way (evidence gap G5,
          // resolved by ADR-008 and re-confirmed against the fixture).
          const weekday = entry["weekday"];
          if (
            typeof weekday !== "number" ||
            !Number.isInteger(weekday) ||
            weekday < 0 ||
            weekday > 6
          ) {
            throw new ConnectorError(
              "unexpected_response",
              "a timetable entry did not carry an in-range weekday",
            );
          }
          const slot = entry["timeTableSlot"];
          if (!isPlainObject(slot)) {
            throw new ConnectorError(
              "unexpected_response",
              "a timetable entry did not carry a timeTableSlot object",
            );
          }
          const slotNumber = slot["number"];
          if (
            typeof slotNumber !== "number" ||
            !Number.isInteger(slotNumber) ||
            slotNumber <= 0
          ) {
            throw new ConnectorError(
              "unexpected_response",
              "a timetable entry did not carry a positive slot number",
            );
          }
          const startTime = slot["startTime"];
          if (typeof startTime !== "string") {
            throw new ConnectorError(
              "unexpected_response",
              "a timetable entry did not carry a start time string",
            );
          }
          const endTime = slot["endTime"];
          if (typeof endTime !== "string") {
            throw new ConnectorError(
              "unexpected_response",
              "a timetable entry did not carry an end time string",
            );
          }

          // ADR-008 decision 2: clip on the resolved civil date — the week's
          // Monday plus the (Monday-origin) weekday. That resolved date is
          // used for this clipping alone; it is never composed into any
          // output field (decision 4 composes no civil date, and the rows
          // below carry the platform's own time values verbatim).
          const resolvedMs = weekMondayMs + weekday * MILLIS_PER_DAY;
          if (
            windowStartMs !== undefined &&
            windowEndMs !== undefined &&
            (resolvedMs < windowStartMs || resolvedMs > windowEndMs)
          ) {
            continue; // out of the window — decision 1: cover, then clip.
          }

          // `subject` is the name/acronym pair only — the fixture allowlist
          // keeps exactly those two string fields on
          // `courseSubject.subject` — and it is omitted entirely when the
          // name is not a string. The `teachers` array and the course
          // identity triplet on the same `courseSubject` are class identity,
          // excluded from the allowlist and never read here.
          let subject: { name: string; acronym?: string } | undefined;
          const courseSubject = entry["courseSubject"];
          if (isPlainObject(courseSubject)) {
            const subjectBlock = courseSubject["subject"];
            if (isPlainObject(subjectBlock)) {
              const name = subjectBlock["name"];
              if (typeof name === "string") {
                const acronym = subjectBlock["acronym"];
                if (typeof acronym === "string") {
                  subject = { name, acronym };
                } else {
                  subject = { name };
                }
              }
            }
          }

          // Provenance for this row: ADR-009 decision 1 —
          // `source_record_id` is the entry's own id, stringified. There is
          // deliberately NO `occurrence` key here: on a weekly-template
          // platform the occurrence discriminator is `week_anchor.date`, and
          // nothing is invented to fill the slot (ADR-009 decision 2).
          const provenance: ProvenanceEnvelope = {
            concept: "provenance_envelope",
            source_platform: "dieschulapp",
            source_instance: sourceInstance,
            source_record_id: String(id),
            captured_at: capturedAt,
            request: {
              method: "GET",
              status: 200,
              url_template: "/api/1.0/current-timetable/",
              logical_call: "current-timetable",
            },
          };

          // The student reference carries its own copy of the envelope (the
          // same values). Only the id was read off the identity block;
          // forename, surname, displayname, mainCourse are not read by any
          // code in this connector.
          const student: StudentReference = {
            concept: "student_reference",
            student_id: String(studentId),
            provenance,
          };

          const location: WeekdaySlot = {
            kind: "weekday_slot",
            weekday,
            slot_number: slotNumber,
            start_time: startTime,
            end_time: endTime,
            // The date the request actually named: `present_in_response` is
            // false because no such value exists anywhere in the response
            // body. Together with the weekday it pins the row to its week —
            // the platform normalises any in-week date to that week, so the
            // pair is complete (ADR-008 decision 4).
            week_anchor: {
              present_in_response: false,
              resolution: "out_of_band_request_parameter",
              date: orbitDate,
            },
          };

          rows.push({
            concept: "timetable_entry",
            location:
              subject === undefined
                ? { ...location, student }
                : { ...location, student, subject },
            provenance,
          });
        }
      }
    }

    // Exactly one debug event per fetch: `Logger` fields restricted to
    // numbers/booleans, and no row content ever enters the event.
    runtime.logger.debug("dieschulapp_timetable_fetch", {
      status: 200,
      row_count: rows.length,
    });
    return rows;
  }

  return {
    platform: "dieschulapp",
    // The capability list grows, not rewires (ADR-002): this platform
    // contributes exactly one fetcher, and `capabilitiesOf` is read off the
    // fetcher keys — `["timetable_entry"]`.
    fetchers: { timetable_entry: fetchTimetableEntries },
    authenticate,
  };
}

/** Plain object test: `null`, arrays, and non-objects all fail it. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Internal calendar helpers. Their arithmetic is UTC-based and is used for
 * the orbit and the clipping alone; none of it touches a field on an
 * emitted row (ADR-008 decision 4: no civil date is composed into output;
 * `captured_at` is the one allowed composition).
 */

/** Strict-ish `YYYY-MM-DD` shape: two-digit month 01..12, day 01..31. */
function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** UTC noon of the date (internal ms value; noon sidesteps any offset edge). */
function isoMidnightMs(value: string): number {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return Date.UTC(year, month - 1, day, 12);
}

/** ISO calendar day of a UTC ms value. */
function msToIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Monday (UTC ms) of the ISO week containing `ms`; Monday-origin (ADR-008 decision 5). */
function mondayOfUtcMs(ms: number): number {
  const isoWeekday = (new Date(ms).getUTCDay() + 6) % 7; // 0 = Monday .. 6 = Sunday
  return ms - isoWeekday * MILLIS_PER_DAY;
}
