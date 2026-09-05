/**
 * Schulmanager connector tests.
 *
 * Fakes, not mocks: a scripted Transport, a fixed Clock, and a recording
 * Logger — the ADR-003 capability trio. Payload values are invented
 * placeholders shaped after the committed fixture (structure copied, values
 * invented — the fixture carries no real values). Every mapped output is
 * validated against `Message` imported from @school-connector-kit/core, so
 * the tests pin the mapping against the published schema, not against a
 * local copy of it.
 */
import { describe, expect, it } from "vitest";
import {
  assertNoCookieHeaders,
  Message,
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
import { createSchulmanagerConnector } from "../src/index.js";
import type { SchulmanagerConfig } from "../src/index.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface ScriptedResponse {
  /** HTTP status to answer with. Defaults to 200. */
  status?: number;
  /** Response headers to answer with. Defaults to none. */
  headers?: Record<string, string>;
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
      headers: next.headers ?? {},
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

const CONFIG: SchulmanagerConfig = {
  baseUrl: "https://schulmanager.example.invalid",
  bundleVersion: "2026.08.30.1",
  sourceInstance: "tenant-instance-placeholder",
};

const THE_WINDOW: FetchWindow = {
  fromInclusive: "2026-08-01",
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

// ---------------------------------------------------------------------------
// Error assertion helper
// ---------------------------------------------------------------------------

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
  // Error-hygiene pin: the fixed message must not leak a credential, token,
  // or any invented payload / instance value this suite uses.
  expect(message).not.toContain("placeholder-user");
  expect(message).not.toContain("placeholder-password");
  expect(message).not.toContain(TOKEN_ONE);
  expect(message).not.toContain("tenant-instance-placeholder");
  expect(message).not.toContain("Vaterin");
  expect(message).not.toContain("Guten Tag");
}

// ---------------------------------------------------------------------------
// Fixtures (shape only — values invented, structure after the capture)
// ---------------------------------------------------------------------------

const TOKEN_ONE = "bearer-token-placeholder-0001";
const TOKEN_TWO = "bearer-token-placeholder-0002";

const LOGIN_OK_BODY = JSON.stringify({
  jwt: TOKEN_ONE,
  // The connector must read exactly "jwt" out of this body; the rest —
  // including the children's names — goes unread.
  user: {
    id: 7,
    email: "eltern@example.invalid",
    firstname: "Mutter",
    lastname: "Vaterin",
    associatedParents: [
      {
        id: 3,
        firstname: "Kind",
        lastname: "Vaterin",
        student: { id: 4, firstname: "Schueler", lastname: "Vaterin" },
      },
    ],
  },
});

const LIST_OK_BODY = JSON.stringify({
  results: [
    {
      status: 200,
      data: [
        {
          id: 101,
          title: "Hausaufgaben",
          sentDate: "2026-08-30T14:10:22.123Z",
          createdAt: "2026-08-29T08:00:00.000Z",
        },
        {
          id: 102,
          title: "Zeugnisse",
          createdAt: "2026-08-29T09:00:00.456Z",
        },
      ],
    },
  ],
  // Present on real responses; the connector must ignore it.
  systemStatusMessages: [{ id: 1, level: "info", text: "ok" }],
});

const DETAIL_101_BODY = JSON.stringify({
  results: [
    {
      status: 200,
      data: {
        id: 101,
        text: "<p>Guten Tag,</p><p>die &Uuml;bungen bleiben bis Freitag.</p>",
        attachments: [
          { id: 5, letterId: 101, inline: true, contentType: "application/pdf" },
        ],
        sentDate: "2026-08-30T14:10:22.123Z",
        createdAt: "2026-08-29T08:00:00.000Z",
      },
    },
  ],
});

const DETAIL_102_BODY = JSON.stringify({
  results: [
    {
      status: 200,
      data: {
        id: 102,
        text: "<b>Hinweis</b><br/>die Zeugniskonferenz findet statt.",
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("happy path", () => {
  it("authenticates and maps both letters to valid Message records", async () => {
    const transport = new ScriptedTransport(
      { body: LOGIN_OK_BODY },
      { body: LIST_OK_BODY },
      { body: DETAIL_101_BODY },
      { body: DETAIL_102_BODY },
    );
    const { runtime, logger } = makeRuntime(transport);
    const connector = createSchulmanagerConnector(runtime, CONFIG);

    expect(connector.platform).toBe("schulmanager");
    await connector.authenticate({ user: "u1", password: "p1" });

    const fetcher = connector.fetchers.message;
    expect(typeof fetcher).toBe("function");
    const rows = await fetcher!({});

    // Every mapped output must validate against the published concept.
    const parsed = rows.map((row) => Message.parse(row));
    expect(parsed).toHaveLength(2);

    expect(rows[0]).toEqual({
      concept: "message",
      date: { kind: "platform_instant", value: "2026-08-30T14:10:22.123Z" },
      body: "<p>Guten Tag,</p><p>die &Uuml;bungen bleiben bis Freitag.</p>",
      provenance: {
        concept: "provenance_envelope",
        source_platform: "schulmanager",
        source_instance: CONFIG.sourceInstance,
        source_record_id: "101",
        captured_at: FIXED_NOW_ISO,
        request: {
          method: "POST",
          status: 200,
          url_template: "/api/calls",
          logical_call: "get-letters",
        },
      },
    });

    expect(rows[1]).toEqual({
      concept: "message",
      date: { kind: "platform_instant", value: "2026-08-29T09:00:00.456Z" },
      body: "<b>Hinweis</b><br/>die Zeugniskonferenz findet statt.",
      provenance: {
        concept: "provenance_envelope",
        source_platform: "schulmanager",
        source_instance: CONFIG.sourceInstance,
        source_record_id: "102",
        captured_at: FIXED_NOW_ISO,
        request: {
          method: "POST",
          status: 200,
          url_template: "/api/calls",
          logical_call: "get-letters",
        },
      },
    });

    // The pin above covers: the body is the detail "text" VERBATIM (markup
    // and entities intact); `sentDate` is preferred over `createdAt` when
    // both are present (row 0) and `createdAt` is the fallback (row 1);
    // BOTH rows of this one fetch share the single captured_at instant.

    // No title field is invented (Message has none in 0.1); neither
    // occurrence, allowlist_version, link_count, nor index is carried.
    for (const record of parsed) {
      expect(
        (record as { title?: unknown }).title,
        "no title field may be emitted",
      ).toBeUndefined();
      expect(record.link_count).toBeUndefined();
      expect(record.provenance.occurrence).toBeUndefined();
      expect(record.provenance.allowlist_version).toBeUndefined();
      expect(record.provenance.request.index).toBeUndefined();
    }

    // The logger saw exactly one numeric/boolean event.
    expect(logger.calls).toEqual([
      { event: "schulmanager_message_fetch", fields: { status: 200, row_count: 2 } },
    ]);
  });

  it("sends login, list, then one detail per letter — token from the login body, no cookie headers", async () => {
    const transport = new ScriptedTransport(
      { body: LOGIN_OK_BODY },
      { body: LIST_OK_BODY },
      { body: DETAIL_101_BODY },
      { body: DETAIL_102_BODY },
    );
    const { runtime } = makeRuntime(transport);
    const connector = createSchulmanagerConnector(runtime, CONFIG);

    await connector.authenticate({ user: "placeholder-user", password: "placeholder-password" });
    await connector.fetchers.message!({});

    // exactly one login + (1 list + 2 details) = 4 sends.
    expect(transport.sent).toHaveLength(4);

    const login = transport.sent[0]!;
    expect(login.method).toBe("POST");
    expect(login.url).toBe("https://schulmanager.example.invalid/api/login");
    expect(login.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(login.body ?? "")).toEqual({
      emailOrUsername: "placeholder-user",
      password: "placeholder-password",
      hash: null,
      mobileApp: false,
      institutionId: null,
    });

    const callsUrl = "https://schulmanager.example.invalid/api/calls";
    for (const sent of transport.sent.slice(1)) {
      expect(sent.method).toBe("POST");
      expect(sent.url).toBe(callsUrl);
    }

    const list = transport.sent[1]!;
    expect(list.headers["Authorization"]).toBe(`Bearer ${TOKEN_ONE}`);
    expect(JSON.parse(list.body ?? "")).toEqual({
      bundleVersion: CONFIG.bundleVersion,
      requests: [{ moduleName: "letters", endpointName: "get-letters" }],
    });

    const detail101 = transport.sent[2]!;
    expect(detail101.headers["Authorization"]).toBe(`Bearer ${TOKEN_ONE}`);
    expect(JSON.parse(detail101.body ?? "")).toEqual({
      bundleVersion: CONFIG.bundleVersion,
      requests: [
        {
          moduleName: "letters",
          endpointName: "poqa",
          parameters: {
            action: {
              model: "modules/letters/letter",
              action: "findByPk",
              parameters: [101, {}],
            },
          },
        },
      ],
    });

    const detail102 = transport.sent[3]!;
    expect(detail102.headers["Authorization"]).toBe(`Bearer ${TOKEN_ONE}`);
    expect(JSON.parse(detail102.body ?? "")).toEqual({
      bundleVersion: CONFIG.bundleVersion,
      requests: [
        {
          moduleName: "letters",
          endpointName: "poqa",
          parameters: {
            action: {
              model: "modules/letters/letter",
              action: "findByPk",
              parameters: [102, {}],
            },
          },
        },
      ],
    });

    // No session state is ever attached by the connector itself.
    for (const sent of transport.sent) {
      for (const key of Object.keys(sent.headers)) {
        expect(key.toLowerCase()).not.toBe("cookie");
        expect(key.toLowerCase()).not.toBe("set-cookie");
      }
    }
  });

  it("maps an empty letters list to zero rows, sending exactly one call", async () => {
    const transport = new ScriptedTransport(
      { body: LOGIN_OK_BODY },
      { body: JSON.stringify({ results: [{ status: 200, data: [] }] }) },
    );
    const { runtime, logger } = makeRuntime(transport);
    const connector = createSchulmanagerConnector(runtime, CONFIG);
    await connector.authenticate({ user: "u1", password: "p1" });

    const rows = await connector.fetchers.message!({});
    expect(rows).toHaveLength(0);
    // login + list — NO detail calls for an empty list
    expect(transport.sent).toHaveLength(2);
    expect(logger.calls).toEqual([
      { event: "schulmanager_message_fetch", fields: { status: 200, row_count: 0 } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Window handling
// ---------------------------------------------------------------------------

describe("window handling", () => {
  it("fetches with OR without a fetch window — the window changes nothing", async () => {
    const withoutWindow = new ScriptedTransport(
      { body: LOGIN_OK_BODY },
      { body: LIST_OK_BODY },
      { body: DETAIL_101_BODY },
      { body: DETAIL_102_BODY },
    );
    const withWindow = new ScriptedTransport(
      { body: LOGIN_OK_BODY },
      { body: LIST_OK_BODY },
      { body: DETAIL_101_BODY },
      { body: DETAIL_102_BODY },
    );
    const plainRuntime = makeRuntime(withoutWindow);
    const windowRuntime = makeRuntime(withWindow);

    const plainConnector = createSchulmanagerConnector(plainRuntime.runtime, CONFIG);
    const windowConnector = createSchulmanagerConnector(windowRuntime.runtime, CONFIG);

    await plainConnector.authenticate({ user: "u1", password: "p1" });
    await windowConnector.authenticate({ user: "u1", password: "p1" });

    const plainRows = await plainConnector.fetchers.message!({});
    const windowRows = await windowConnector.fetchers.message!({ window: THE_WINDOW });

    // Same sends (same order, headers, and bodies) and same rows.
    expect(withWindow.sent).toHaveLength(4);
    expect(withWindow.sent.map((r) => r.method)).toEqual(
      withoutWindow.sent.map((r) => r.method),
    );
    expect(withWindow.sent.map((r) => r.url)).toEqual(
      withoutWindow.sent.map((r) => r.url),
    );
    expect(withWindow.sent.map((r) => r.headers)).toEqual(
      withoutWindow.sent.map((r) => r.headers),
    );
    expect(withWindow.sent.map((r) => r.body)).toEqual(
      withoutWindow.sent.map((r) => r.body),
    );
    expect(windowRows).toEqual(plainRows);

    // The window values may not have leaked into any sent payload.
    for (const sent of withWindow.sent) {
      expect(sent.body ?? "").not.toContain(THE_WINDOW.fromInclusive);
      expect(sent.body ?? "").not.toContain(THE_WINDOW.toInclusive);
    }
  });
});

// ---------------------------------------------------------------------------
// Authentication failures
// ---------------------------------------------------------------------------

describe("authentication failures", () => {
  it("maps a non-200 authentication response to auth_failed", async () => {
    const transport = new ScriptedTransport({
      status: 401,
      body: JSON.stringify({ message: "invalid credentials" }),
    });
    const { runtime } = makeRuntime(transport);
    const connector = createSchulmanagerConnector(runtime, CONFIG);

    await expectConnectorError(
      connector.authenticate({ user: "placeholder-user", password: "placeholder-password" }),
      "auth_failed",
    );
  });

  it("maps an authentication body without JSON to auth_failed", async () => {
    const transport = new ScriptedTransport({ body: "not-json" });
    const { runtime } = makeRuntime(transport);
    const connector = createSchulmanagerConnector(runtime, CONFIG);

    await expectConnectorError(
      connector.authenticate({ user: "u1", password: "p1" }),
      "auth_failed",
    );
  });

  it("maps a login body without a usable jwt to auth_failed", async () => {
    for (const body of [
      JSON.stringify({ user: { id: 7 } }),
      JSON.stringify({ jwt: "" }),
      JSON.stringify({ jwt: null }),
      JSON.stringify([]),
    ]) {
      const transport = new ScriptedTransport({ body });
      const { runtime } = makeRuntime(transport);
      const connector = createSchulmanagerConnector(runtime, CONFIG);
      await expectConnectorError(
        connector.authenticate({ user: "u1", password: "p1" }),
        "auth_failed",
      );
    }
  });

  it("maps a transport failure to transport_failed", async () => {
    const transport = new ScriptedTransport({ fail: true });
    const { runtime } = makeRuntime(transport);
    const connector = createSchulmanagerConnector(runtime, CONFIG);

    await expectConnectorError(
      connector.authenticate({ user: "u1", password: "p1" }),
      "transport_failed",
    );
  });

  it("rejects credentials missing a string user or password", async () => {
    const transport = new ScriptedTransport();
    const { runtime } = makeRuntime(transport);
    const connector = createSchulmanagerConnector(runtime, CONFIG);

    for (const credentials of [{ user: "u1" }, { password: "p1" }, {}]) {
      await expectConnectorError(
        connector.authenticate(credentials),
        "auth_failed",
      );
    }
    expect(transport.sent).toHaveLength(0);
  });

  it("rejects a fetch attempted before authenticate, without touching the transport", async () => {
    const transport = new ScriptedTransport();
    const { runtime } = makeRuntime(transport);
    const connector = createSchulmanagerConnector(runtime, CONFIG);

    await expectConnectorError(connector.fetchers.message!({}), "auth_failed");
    expect(transport.sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Calls failures
// ---------------------------------------------------------------------------

describe("calls failures", () => {
  it("maps a non-200 calls response to unexpected_response", async () => {
    const transport = new ScriptedTransport(
      { body: LOGIN_OK_BODY },
      { status: 503, body: "service unavailable" },
    );
    const { runtime } = makeRuntime(transport);
    const connector = createSchulmanagerConnector(runtime, CONFIG);
    await connector.authenticate({ user: "u1", password: "p1" });

    await expectConnectorError(
      connector.fetchers.message!({}),
      "unexpected_response",
    );
  });

  it("maps a non-JSON calls body to unexpected_response", async () => {
    const transport = new ScriptedTransport(
      { body: LOGIN_OK_BODY },
      { body: "<html>gateway error</html>" },
    );
    const { runtime } = makeRuntime(transport);
    const connector = createSchulmanagerConnector(runtime, CONFIG);
    await connector.authenticate({ user: "u1", password: "p1" });

    await expectConnectorError(
      connector.fetchers.message!({}),
      "unexpected_response",
    );
  });

  it("maps a malformed envelope (not exactly one result object) to unexpected_response", async () => {
    for (const body of [
      JSON.stringify({ results: [] }),
      JSON.stringify({ results: [{ status: 200, data: [] }, { status: 200, data: [] }] }),
      JSON.stringify({ results: "no" }),
      JSON.stringify({}),
      JSON.stringify([]),
    ]) {
      const transport = new ScriptedTransport({ body: LOGIN_OK_BODY }, { body });
      const { runtime } = makeRuntime(transport);
      const connector = createSchulmanagerConnector(runtime, CONFIG);
      await connector.authenticate({ user: "u1", password: "p1" });
      await expectConnectorError(
        connector.fetchers.message!({}),
        "unexpected_response",
      );
    }
  });

  it("maps a per-result status other than 200 (under HTTP 200) to unexpected_response", async () => {
    // The per-result status axis is independent of the HTTP status: the
    // SAME check must fire on the list call and on a detail call.
    const listBodies = [
      JSON.stringify({ results: [{ status: 500, data: [{ id: 101, title: "x" }] }] }),
    ];
    const detailBodies = [
      JSON.stringify({ results: [{ status: 500, data: { id: 101, text: "x" } }] }),
    ];
    for (const listBody of listBodies) {
      const transport = new ScriptedTransport(
        { body: LOGIN_OK_BODY },
        { body: listBody },
      );
      const { runtime } = makeRuntime(transport);
      const connector = createSchulmanagerConnector(runtime, CONFIG);
      await connector.authenticate({ user: "u1", password: "p1" });
      await expectConnectorError(
        connector.fetchers.message!({}),
        "unexpected_response",
      );
    }
    for (const detailBody of detailBodies) {
      const transport = new ScriptedTransport(
        { body: LOGIN_OK_BODY },
        { body: LIST_OK_BODY },
        { body: detailBody },
        { body: DETAIL_102_BODY },
      );
      const { runtime } = makeRuntime(transport);
      const connector = createSchulmanagerConnector(runtime, CONFIG);
      await connector.authenticate({ user: "u1", password: "p1" });
      await expectConnectorError(
        connector.fetchers.message!({}),
        "unexpected_response",
      );
    }
  });

  it("maps a letters list whose data is not an array to unexpected_response", async () => {
    // NOTE: `[]` (an empty array) is NOT a failure — an empty letters list
    // is valid and maps to zero rows (pinned below in the happy path).
    for (const data of [{}, { x: 1 }, "letters"] as unknown[]) {
      const body = JSON.stringify({ results: [{ status: 200, data }] });
      const transport = new ScriptedTransport({ body: LOGIN_OK_BODY }, { body });
      const { runtime } = makeRuntime(transport);
      const connector = createSchulmanagerConnector(runtime, CONFIG);
      await connector.authenticate({ user: "u1", password: "p1" });
      await expectConnectorError(
        connector.fetchers.message!({}),
        "unexpected_response",
      );
    }
  });

  it("maps a list row missing id, or with a non-string title / no instant string, to unexpected_response", async () => {
    const badRows: Record<string, unknown>[] = [
      { title: "x", sentDate: "2026-08-30T14:10:22.123Z" },
      { id: 101, sentDate: "2026-08-30T14:10:22.123Z" },
      { id: 101, title: 42, sentDate: "2026-08-30T14:10:22.123Z" },
      { id: 101, title: "x" },
      { id: 101, title: "x", sentDate: 20260830 },
    ];
    for (const row of badRows) {
      const body = JSON.stringify({ results: [{ status: 200, data: [row] }] });
      const transport = new ScriptedTransport({ body: LOGIN_OK_BODY }, { body });
      const { runtime } = makeRuntime(transport);
      const connector = createSchulmanagerConnector(runtime, CONFIG);
      await connector.authenticate({ user: "u1", password: "p1" });
      await expectConnectorError(
        connector.fetchers.message!({}),
        "unexpected_response",
      );
    }
  });

  it("maps a letter detail that is not an object, or with no string text, to unexpected_response", async () => {
    const badDetails: unknown[] = [
      [],
      { id: 101 },
      { id: 101, text: null },
      { id: 101, text: 42 },
    ];
    for (const data of badDetails) {
      const body = JSON.stringify({ results: [{ status: 200, data }] });
      const transport = new ScriptedTransport(
        { body: LOGIN_OK_BODY },
        { body: LIST_OK_BODY },
        { body },
        { body: DETAIL_102_BODY },
      );
      const { runtime } = makeRuntime(transport);
      const connector = createSchulmanagerConnector(runtime, CONFIG);
      await connector.authenticate({ user: "u1", password: "p1" });
      await expectConnectorError(
        connector.fetchers.message!({}),
        "unexpected_response",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Token rotation (gap G20)
// ---------------------------------------------------------------------------

describe("token rotation (gap G20)", () => {
  it("adopts the replacement when the response carries it under ANY casing", async () => {
    for (const key of [
      "X-New-Bearer-Token",
      "x-new-bearer-token",
      "X-NEW-BEARER-TOKEN",
      "x-NeW-bEARer-tOkEn",
    ]) {
      const transport = new ScriptedTransport(
        { body: LOGIN_OK_BODY },
        { body: LIST_OK_BODY, headers: { [key]: TOKEN_TWO } },
        { body: DETAIL_101_BODY },
        { body: DETAIL_102_BODY },
      );
      const { runtime } = makeRuntime(transport);
      const connector = createSchulmanagerConnector(runtime, CONFIG);
      await connector.authenticate({ user: "u1", password: "p1" });
      await connector.fetchers.message!({});

      // The list call still ran under the LOGIN token (rotation is adopted
      // from its response); every later request carries the replacement.
      expect(transport.sent[1]!.headers["Authorization"]).toBe(`Bearer ${TOKEN_ONE}`);
      expect(transport.sent[2]!.headers["Authorization"]).toBe(`Bearer ${TOKEN_TWO}`);
      expect(transport.sent[3]!.headers["Authorization"]).toBe(`Bearer ${TOKEN_TWO}`);
    }
  });

  it("does NOT adopt an empty replacement value", async () => {
    const transport = new ScriptedTransport(
      { body: LOGIN_OK_BODY },
      { body: LIST_OK_BODY, headers: { "X-New-Bearer-Token": "" } },
      { body: DETAIL_101_BODY },
      { body: DETAIL_102_BODY },
    );
    const { runtime } = makeRuntime(transport);
    const connector = createSchulmanagerConnector(runtime, CONFIG);
    await connector.authenticate({ user: "u1", password: "p1" });
    await connector.fetchers.message!({});

    expect(transport.sent[2]!.headers["Authorization"]).toBe(`Bearer ${TOKEN_ONE}`);
    expect(transport.sent[3]!.headers["Authorization"]).toBe(`Bearer ${TOKEN_ONE}`);
  });
});

// ---------------------------------------------------------------------------
// Contract invariants
// ---------------------------------------------------------------------------

describe("contract invariants", () => {
  it("capabilitiesOf reports exactly the implemented capability", () => {
    const transport = new ScriptedTransport();
    const { runtime } = makeRuntime(transport);
    const connector: Connector = createSchulmanagerConnector(runtime, CONFIG);
    expect(capabilitiesOf(connector)).toEqual(["message"]);
  });

  it("the cookie-header guard rejects session state on any request", () => {
    for (const key of ["Cookie", "cookie", "Set-Cookie", "SET-COOKIE"]) {
      const request: HttpRequest = {
        method: "GET",
        url: "https://schulmanager.example.invalid/",
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
