/**
 * WebUntis connector (schema 0.1, capability: `assignment`).
 *
 * Portability discipline (ADR-003): this module runs inside the host's
 * React Native / Flutter bundle, so it carries no Node built-ins and no DOM
 * globals — the tests enforce this over the entry-point closure. The only
 * I/O it performs goes through the injected `Transport`; it never reads or
 * writes session-cookie headers itself (`assertNoCookieHeaders` re-checks
 * every outgoing request, including this connector's own), and it never
 * stores the session id the authenticate call returns: the Transport owns
 * the session.
 *
 * Error hygiene (ADR-003): every `ConnectorError` message is a fixed string
 * chosen by this file. No response value, credential, URL query value, or
 * header value is ever interpolated into one.
 */
import { assertNoCookieHeaders, ConnectorError } from "@school-connector-kit/core";
import type {
  Assignment,
  Connector,
  ConnectorCredentials,
  ConnectorRuntime,
  FetchRequest,
  HttpRequest,
  HttpResponse,
} from "@school-connector-kit/core";

/** Per-connector configuration. None of these values are logged. */
export interface WebUntisConfig {
  /** Base origin of the WebUntis instance (no trailing slash). */
  readonly baseUrl: string;
  /** The WebUntis school selector carried in the authenticate URL. */
  readonly school: string;
  /** Tenant identity recorded in every provenance envelope. */
  readonly sourceInstance: string;
}

/**
 * The lessons request's URL template, byte-identical to the committed
 * fixture (fixtures/webuntis/variant-001): shape only, never private values.
 */
const LESSONS_URL_TEMPLATE =
  "/WebUntis/api/homeworks/lessons?startDate={startDate}&endDate={endDate}";

/** Request window bounds: calendar dates, YYYY-MM-DD, zero-padded. */
const WINDOW_BOUND = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Create the WebUntis connector.
 *
 * `runtime` is the ADR-003 capability trio (transport, clock, logger);
 * `config` pins the instance identity. Both are injected — nothing here is
 * ambient.
 */
export function createWebUntisConnector(
  runtime: ConnectorRuntime,
  config: WebUntisConfig,
): Connector {
  const { baseUrl, school, sourceInstance } = config;

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
      method: "POST",
      url: `${baseUrl}/WebUntis/jsonrpc.do?school=${school}`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "sck",
        method: "authenticate",
        params: { user, password, client: "school-connector-kit" },
        jsonrpc: "2.0",
      }),
    };
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

    let decoded: unknown;
    try {
      decoded = JSON.parse(response.body);
    } catch {
      throw new ConnectorError("auth_failed", "authentication response was not valid JSON");
    }

    if (!isPlainObject(decoded) || !isPlainObject(decoded["result"])) {
      throw new ConnectorError(
        "auth_failed",
        "authentication response did not carry an object result",
      );
    }
    const result = decoded["result"];
    const sessionId = result["sessionId"];
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new ConnectorError(
        "auth_failed",
        "authentication response did not carry a usable session id",
      );
    }
    // Deliberately discarded: the Transport owns the session (ADR-003). This
    // connector neither stores it nor builds cookie headers from it.
  }

  async function fetchAssignments(request: FetchRequest): Promise<readonly Assignment[]> {
    const bounds = request.window;
    if (bounds === undefined) {
      throw new ConnectorError(
        "not_supported",
        "fetching assignments requires an explicit fetch window",
      );
    }
    const fromInclusive = bounds.fromInclusive;
    const toInclusive = bounds.toInclusive;
    if (
      typeof fromInclusive !== "string" || WINDOW_BOUND.test(fromInclusive) === false ||
      typeof toInclusive !== "string" || WINDOW_BOUND.test(toInclusive) === false
    ) {
      throw new ConnectorError(
        "not_supported",
        "fetch window bounds must be zero-padded YYYY-MM-DD calendar dates",
      );
    }

    // The only conversion performed anywhere in this connector: drop the
    // hyphens. No datetime arithmetic, no timezone, no Date construction.
    const startDate = fromInclusive.replace(/-/g, "");
    const endDate = toInclusive.replace(/-/g, "");

    const http: HttpRequest = {
      method: "GET",
      url: `${baseUrl}/WebUntis/api/homeworks/lessons?startDate=${startDate}&endDate=${endDate}`,
      headers: {},
    };
    assertNoCookieHeaders(http);

    let response: HttpResponse;
    try {
      response = await runtime.transport.send(http);
    } catch {
      throw new ConnectorError("transport_failed", "the transport request failed");
    }

    if (response.status !== 200) {
      throw new ConnectorError(
        "unexpected_response",
        "the lessons response was not successful",
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(response.body);
    } catch {
      throw new ConnectorError("unexpected_response", "the lessons response was not valid JSON");
    }

    const data = isPlainObject(decoded) ? decoded["data"] : undefined;
    const homeworks = isPlainObject(data) ? data["homeworks"] : undefined;
    if (!Array.isArray(homeworks)) {
      throw new ConnectorError(
        "unexpected_response",
        "the lessons response did not carry a homeworks array",
      );
    }

    const capturedAt = new Date(runtime.clock.now()).toISOString();
    const rows: Assignment[] = [];
    for (const entry of homeworks) {
      if (!isPlainObject(entry)) {
        throw new ConnectorError(
          "unexpected_response",
          "a homework row did not match the expected shape",
        );
      }
      const id = entry["id"];
      if (id === undefined || id === null) {
        throw new ConnectorError("unexpected_response", "a homework row is missing its id");
      }
      const date = entry["date"];
      if (!isInteger(date)) {
        throw new ConnectorError("unexpected_response", "a homework row carries a non-integer date");
      }
      const dueDate = entry["dueDate"];
      if (!isInteger(dueDate)) {
        throw new ConnectorError(
          "unexpected_response",
          "a homework row carries a non-integer due date",
        );
      }
      const completed = entry["completed"];
      if (typeof completed !== "boolean") {
        throw new ConnectorError(
          "unexpected_response",
          "a homework row carries a non-boolean completion flag",
        );
      }
      const text = entry["text"];
      if (typeof text !== "string") {
        throw new ConnectorError("unexpected_response", "a homework row carries a non-string text");
      }

      const row: Assignment = {
        concept: "assignment",
        reference_date: { kind: "platform_date_int", value: date },
        due_date: { kind: "platform_date_int", value: dueDate },
        completed,
        text,
        provenance: {
          concept: "provenance_envelope",
          source_platform: "webuntis",
          source_instance: sourceInstance,
          source_record_id: String(id),
          captured_at: capturedAt,
          request: {
            method: "GET",
            status: 200,
            url_template: LESSONS_URL_TEMPLATE,
          },
        },
      };
      // `lesson_id` and `remark` are optional in the schema; a row missing
      // them maps to a concept instance without them (values are never
      // invented).
      const lessonId = entry["lessonId"];
      if (lessonId !== undefined && lessonId !== null) {
        row.lesson_id = String(lessonId);
      }
      const remark = entry["remark"];
      if (typeof remark === "string") {
        row.remark = remark;
      }
      rows.push(row);
    }

    // Log fields are restricted to number and boolean (ADR-003), so no value
    // can travel through this channel either.
    runtime.logger.debug("webuntis_assignment_fetch", {
      status: response.status,
      row_count: rows.length,
    });
    return rows;
  }

  return {
    platform: "webuntis",
    fetchers: { assignment: fetchAssignments },
    authenticate,
  };
}
