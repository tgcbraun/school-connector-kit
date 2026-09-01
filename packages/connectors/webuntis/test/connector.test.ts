/**
 * WebUntis connector tests.
 *
 * Fakes, not mocks: a scripted Transport, a fixed Clock, and a recording
 * Logger — the ADR-003 capability trio. Payload values are invented
 * placeholders shaped after the committed fixture (structure copied, values
 * invented — the fixture carries no real values). Every mapped output is
 * validated against `Assignment` imported from @school-connector-kit/core,
 * so the tests pin the mapping against the published schema, not against a
 * local copy of it.
 */
import { describe, expect, it } from "vitest";
import {
  assertNoCookieHeaders,
  Assignment,
  capabilitiesOf,
  ConnectorError,
} from "@school-connector-kit/core";
import type {
  Connector,
  ConnectorRuntime,
  FetchWindow,
  HttpRequest,
  HttpResponse,
  Transport,
} from "@school-connector-kit/core";
import { createWebUntisConnector } from "../src/index.js";
import type { WebUntisConfig } from "../src/index.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface ScriptedResponse {
  /** HTTP status to answer with. Defaults to 200. */
  status?: number;
  /** Raw response body (string; the contract is about string bodies). */
  body?: string;
  /** When true, `send` throws instead of answering. */
  fail?: boolean;
}

class ScriptedTransport implements Transport {
  /** Every request the connector attempted, in order. */
  readonly sent: HttpRequest[] = [];
  private readonly queue: ScriptedResponse[] = [];

  constructor(...responses: ScriptedResponse[]) {
    this.queue.push(...responses);
  }

  async send(request: HttpRequest): Promise<HttpResponse> {
    this.sent.push(request);
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error("scripted transport ran out of responses");
    }
    if (next.fail === true) {
      throw new Error("scripted transport failure");
    }
    return {
      status: next.status ?? 200,
      headers: {},
      body: next.body ?? "{}",
    };
  }
}

class FixedClock {
  constructor(private readonly nowMs: number) {}

  now(): number {
    return this.nowMs;
  }
}

class RecordingLogger {
  readonly calls: { event: string; fields: Record<string, number | boolean> }[] = [];

  debug(event: string, fields?: Readonly<Record<string, number | boolean>>): void {
    this.calls.push({ event, fields: fields ? { ...fields } : {} });
  }
}

/** The fixed instant every `captured_at` must equal (epoch ms, UTC). */
const FIXED_NOW_MS = Date.UTC(2026, 7, 30, 14, 10, 22);
const FIXED_NOW_ISO = new Date(FIXED_NOW_MS).toISOString();

const CONFIG: WebUntisConfig = {
  baseUrl: "https://webuntis.example.invalid",
  school: "webuntis",
  sourceInstance: "tenant-instance-placeholder",
};

const THE_WINDOW: FetchWindow = {
  fromInclusive: "2026-08-17",
  toInclusive: "2026-09-01",
};

function makeRuntime(transport: ScriptedTransport): {
  runtime: ConnectorRuntime;
  logger: RecordingLogger;
} {
  const logger = new RecordingLogger();
  const runtime: ConnectorRuntime = {
    transport,
    clock: new FixedClock(FIXED_NOW_MS),
    logger,
  };
  return { runtime, logger };
}

async function expectConnectorError(
  input: Promise<unknown>,
  code: "auth_failed" | "transport_failed" | "unexpected_response" | "not_supported",
): Promise<void> {
  let caught: unknown;
  try {
    await input;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the operation to reject").toBeInstanceOf(ConnectorError);
  expect((caught as ConnectorError).code).toBe(code);
  const message = (caught as ConnectorError).message;
  expect(typeof message).toBe("string");
  expect(message.length).toBeGreaterThan(0);
  // Error-hygiene pin: the fixed message must not leak a credential or any
  // invented payload / instance value this suite uses.
  expect(message).not.toContain("secret-user");
  expect(message).not.toContain("password-placeholder");
  expect(message).not.toContain("tenant-instance-placeholder");
  expect(message).not.toContain("Vokabeln");
}

// ---------------------------------------------------------------------------
// Fixtures (shape only — values invented, structure after the capture)
// ---------------------------------------------------------------------------

const AUTH_OK_BODY = JSON.stringify({
  id: "sck",
  jsonrpc: "2.0",
  result: { sessionId: "js-00000000-0000-0000-0000-000000000000", clientId: 1 },
});

const HOMEWORKS_OK_BODY = JSON.stringify({
  data: {
    homeworks: [
      {
        completed: false,
        date: 20260817,
        dueDate: 20260824,
        id: 11223,
        lessonId: 445,
        remark: "",
        text: "Vokabeln Kapitel 3 lernen",
      },
      {
        completed: true,
        date: 20260818,
        dueDate: 20260901,
        id: 11224,
        lessonId: 446,
        remark: "bis Freitag",
        text: "Klassenarbeit Vorbereitung",
      },
    ],
    lessons: [
      { id: 445, lessonType: "Regelstunde", subject: "" },
      { id: 446, lessonType: "Regelstunde", subject: "" },
    ],
    records: [{ elementIds: [7], homeworkId: 11223, teacherId: 9 }],
    teachers: [{ id: 9 }],
  },
});

const URL_TEMPLATE =
  "/WebUntis/api/homeworks/lessons?startDate={startDate}&endDate={endDate}";

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("happy path", () => {
  it("authenticates and maps both homework rows to valid Assignment records", async () => {
    const transport = new ScriptedTransport(
      { body: AUTH_OK_BODY },
      { body: HOMEWORKS_OK_BODY },
    );
    const { runtime, logger } = makeRuntime(transport);
    const connector = createWebUntisConnector(runtime, CONFIG);

    expect(connector.platform).toBe("webuntis");
    await connector.authenticate({ user: "u1", password: "p1" });

    const fetcher = connector.fetchers.assignment;
    expect(typeof fetcher).toBe("function");
    const rows = await fetcher!({ window: THE_WINDOW });

    // Every mapped output must validate against the published concept.
    const parsed = rows.map((row) => Assignment.parse(row));
    expect(parsed).toHaveLength(2);

    expect(rows[0]).toEqual({
      concept: "assignment",
      reference_date: { kind: "platform_date_int", value: 20260817 },
      due_date: { kind: "platform_date_int", value: 20260824 },
      completed: false,
      text: "Vokabeln Kapitel 3 lernen",
      remark: "",
      lesson_id: "445",
      provenance: {
        concept: "provenance_envelope",
        source_platform: "webuntis",
        source_instance: CONFIG.sourceInstance,
        source_record_id: "11223",
        captured_at: FIXED_NOW_ISO,
        request: { method: "GET", status: 200, url_template: URL_TEMPLATE },
      },
    });

    expect(rows[1]).toEqual({
      concept: "assignment",
      reference_date: { kind: "platform_date_int", value: 20260818 },
      due_date: { kind: "platform_date_int", value: 20260901 },
      completed: true,
      text: "Klassenarbeit Vorbereitung",
      remark: "bis Freitag",
      lesson_id: "446",
      provenance: {
        concept: "provenance_envelope",
        source_platform: "webuntis",
        source_instance: CONFIG.sourceInstance,
        source_record_id: "11224",
        captured_at: FIXED_NOW_ISO,
        request: { method: "GET", status: 200, url_template: URL_TEMPLATE },
      },
    });

    // Neither occurrence nor allowlist_version is invented or carried.
    for (const record of parsed) {
      expect(record.provenance.occurrence).toBeUndefined();
      expect(record.provenance.allowlist_version).toBeUndefined();
    }

    // The logger saw exactly one numeric/boolean event.
    expect(logger.calls).toEqual([
      { event: "webuntis_assignment_fetch", fields: { status: 200, row_count: 2 } },
    ]);
  });

  it("sends exactly the specified requests, with no cookie headers", async () => {
    const transport = new ScriptedTransport(
      { body: AUTH_OK_BODY },
      { body: HOMEWORKS_OK_BODY },
    );
    const { runtime } = makeRuntime(transport);
    const connector = createWebUntisConnector(runtime, CONFIG);

    await connector.authenticate({ user: "secret-user", password: "password-placeholder" });
    await connector.fetchers.assignment!({ window: THE_WINDOW });

    expect(transport.sent).toHaveLength(2);

    const auth = transport.sent[0]!;
    expect(auth.method).toBe("POST");
    expect(auth.url).toBe(
      "https://webuntis.example.invalid/WebUntis/jsonrpc.do?school=webuntis",
    );
    expect(auth.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(auth.body ?? "")).toEqual({
      id: "sck",
      method: "authenticate",
      params: {
        user: "secret-user",
        password: "password-placeholder",
        client: "school-connector-kit",
      },
      jsonrpc: "2.0",
    });

    const lessons = transport.sent[1]!;
    expect(lessons.method).toBe("GET");
    expect(lessons.url).toBe(
      "https://webuntis.example.invalid/WebUntis/api/homeworks/lessons" +
        "?startDate=20260817&endDate=20260901",
    );

    // No session state is ever attached by the connector itself.
    for (const sent of transport.sent) {
      for (const key of Object.keys(sent.headers)) {
        expect(key.toLowerCase()).not.toBe("cookie");
        expect(key.toLowerCase()).not.toBe("set-cookie");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Not supported
// ---------------------------------------------------------------------------

describe("window handling", () => {
  it("rejects a missing fetch window without touching the transport", async () => {
    const transport = new ScriptedTransport();
    const { runtime } = makeRuntime(transport);
    const connector = createWebUntisConnector(runtime, CONFIG);

    await expectConnectorError(
      connector.fetchers.assignment!({}),
      "not_supported",
    );
    expect(transport.sent).toHaveLength(0);
  });
});

describe("malformed window", () => {
  const cases: { label: string; value: string }[] = [
    { label: "non-zero-padded month", value: "2026-8-17" },
    { label: "ISO datetime", value: "2026-08-17T00:00:00Z" },
    { label: "dotted form", value: "17.08.2026" },
    { label: "empty string", value: "" },
  ];

  it.each(cases)("$label", ({ value }) => {
    const transport = new ScriptedTransport();
    const { runtime } = makeRuntime(transport);
    const connector = createWebUntisConnector(runtime, CONFIG);

    return expectConnectorError(
      connector.fetchers.assignment!({
        window: { fromInclusive: value, toInclusive: "2026-09-01" },
      }),
      "not_supported",
    ).then(() => {
      expect(transport.sent).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Authentication failures
// ---------------------------------------------------------------------------

describe("authentication failures", () => {
  it("maps a non-200 authentication response to auth_failed", async () => {
    const transport = new ScriptedTransport({
      status: 401,
      body: JSON.stringify({ error: { message: "invalid credentials" } }),
    });
    const { runtime } = makeRuntime(transport);
    const connector = createWebUntisConnector(runtime, CONFIG);

    await expectConnectorError(
      connector.authenticate({ user: "secret-user", password: "password-placeholder" }),
      "auth_failed",
    );
  });

  it("maps an authentication body without JSON to auth_failed", async () => {
    const transport = new ScriptedTransport({ body: "not-json" });
    const { runtime } = makeRuntime(transport);
    const connector = createWebUntisConnector(runtime, CONFIG);

    await expectConnectorError(
      connector.authenticate({ user: "u1", password: "p1" }),
      "auth_failed",
    );
  });

  it("maps a missing or empty session id to auth_failed", async () => {
    for (const body of [
      JSON.stringify({ result: { clientId: 1 } }),
      JSON.stringify({ result: { sessionId: "" } }),
      JSON.stringify({ result: { sessionId: null } }),
      JSON.stringify({}),
    ]) {
      const transport = new ScriptedTransport({ body });
      const { runtime } = makeRuntime(transport);
      const connector = createWebUntisConnector(runtime, CONFIG);
      await expectConnectorError(
        connector.authenticate({ user: "u1", password: "p1" }),
        "auth_failed",
      );
    }
  });

  it("maps a transport failure to transport_failed", async () => {
    const transport = new ScriptedTransport({ fail: true });
    const { runtime } = makeRuntime(transport);
    const connector = createWebUntisConnector(runtime, CONFIG);

    await expectConnectorError(
      connector.authenticate({ user: "u1", password: "p1" }),
      "transport_failed",
    );
  });

  it("rejects credentials missing a string user or password", async () => {
    const transport = new ScriptedTransport();
    const { runtime } = makeRuntime(transport);
    const connector = createWebUntisConnector(runtime, CONFIG);

    for (const credentials of [{ user: "u1" }, { password: "p1" }, {}]) {
      await expectConnectorError(
        connector.authenticate(credentials),
        "auth_failed",
      );
    }
    expect(transport.sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lessons failures
// ---------------------------------------------------------------------------

describe("lessons failures", () => {
  it("maps a non-200 lessons response to unexpected_response", async () => {
    const transport = new ScriptedTransport(
      { body: AUTH_OK_BODY },
      { status: 503, body: "service unavailable" },
    );
    const { runtime } = makeRuntime(transport);
    const connector = createWebUntisConnector(runtime, CONFIG);
    await connector.authenticate({ user: "u1", password: "p1" });

    await expectConnectorError(
      connector.fetchers.assignment!({ window: THE_WINDOW }),
      "unexpected_response",
    );
  });

  it("maps a non-JSON lessons body to unexpected_response", async () => {
    const transport = new ScriptedTransport(
      { body: AUTH_OK_BODY },
      { body: "<html>gateway error</html>" },
    );
    const { runtime } = makeRuntime(transport);
    const connector = createWebUntisConnector(runtime, CONFIG);
    await connector.authenticate({ user: "u1", password: "p1" });

    await expectConnectorError(
      connector.fetchers.assignment!({ window: THE_WINDOW }),
      "unexpected_response",
    );
  });

  it("maps an absent homeworks array to unexpected_response", async () => {
    for (const body of [
      JSON.stringify({ data: {} }),
      JSON.stringify({ data: { lessons: [] } }),
      JSON.stringify({}),
      JSON.stringify([]),
      JSON.stringify({ data: { homeworks: {} } }),
    ]) {
      const transport = new ScriptedTransport({ body: AUTH_OK_BODY }, { body });
      const { runtime } = makeRuntime(transport);
      const connector = createWebUntisConnector(runtime, CONFIG);
      await connector.authenticate({ user: "u1", password: "p1" });
      await expectConnectorError(
        connector.fetchers.assignment!({ window: THE_WINDOW }),
        "unexpected_response",
      );
    }
  });

  it("maps a row with a non-integer date to unexpected_response", async () => {
    const body = JSON.stringify({
      data: {
        homeworks: [
          {
            completed: false,
            date: "2026-08-17",
            dueDate: 20260824,
            id: 11223,
            lessonId: 445,
            text: "Vokabeln",
          },
        ],
      },
    });
    const transport = new ScriptedTransport({ body: AUTH_OK_BODY }, { body });
    const { runtime } = makeRuntime(transport);
    const connector = createWebUntisConnector(runtime, CONFIG);
    await connector.authenticate({ user: "u1", password: "p1" });

    await expectConnectorError(
      connector.fetchers.assignment!({ window: THE_WINDOW }),
      "unexpected_response",
    );
  });

  it("maps rows missing id, or with non-integer dueDate / non-boolean completed / non-string text, to unexpected_response", async () => {
    const badRows: Record<string, unknown>[] = [
      { date: 20260817, dueDate: 20260824, completed: false, text: "Vokabeln" },
      { id: 11223, date: 20260817, dueDate: "2026", completed: false, text: "Vokabeln" },
      { id: 11223, date: 20260817, dueDate: 20260824, completed: "done", text: "Vokabeln" },
      { id: 11223, date: 20260817, dueDate: 20260824, completed: false, text: 42 },
    ];
    for (const row of badRows) {
      const body = JSON.stringify({ data: { homeworks: [row] } });
      const transport = new ScriptedTransport({ body: AUTH_OK_BODY }, { body });
      const { runtime } = makeRuntime(transport);
      const connector = createWebUntisConnector(runtime, CONFIG);
      await connector.authenticate({ user: "u1", password: "p1" });
      await expectConnectorError(
        connector.fetchers.assignment!({ window: THE_WINDOW }),
        "unexpected_response",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Contract invariants
// ---------------------------------------------------------------------------

describe("contract invariants", () => {
  it("capabilitiesOf reports exactly the implemented capability", () => {
    const transport = new ScriptedTransport();
    const { runtime } = makeRuntime(transport);
    const connector: Connector = createWebUntisConnector(runtime, CONFIG);
    expect(capabilitiesOf(connector)).toEqual(["assignment"]);
  });

  it("the cookie-header guard rejects session state on any request", () => {
    for (const key of ["Cookie", "cookie", "Set-Cookie", "SET-COOKIE"]) {
      const request: HttpRequest = {
        method: "GET",
        url: "https://webuntis.example.invalid/",
        headers: { [key]: "session-token-placeholder" },
      };
      let caught: unknown;
      try {
        assertNoCookieHeaders(request);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConnectorError);
      expect((caught as ConnectorError).code).toBe("unexpected_response");
      const message = (caught as ConnectorError).message;
      expect(message).not.toContain("session-token-placeholder");
    }
  });
});
