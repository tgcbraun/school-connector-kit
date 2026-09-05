/**
 * Schulmanager connector (schema 0.1, capability: `message`).
 *
 * Portability discipline (ADR-003): this module runs inside the host's
 * React Native / Flutter bundle, so it carries no Node built-ins and no DOM
 * globals — the tests enforce this over the entry-point closure. The only
 * I/O it performs goes through the injected `Transport`; it never reads or
 * writes session-cookie headers itself (`assertNoCookieHeaders` re-checks
 * every outgoing request, including this connector's own).
 *
 * Where this platform differs from WebUntis, and why the session token is
 * held HERE and not by the Transport: Schulmanager's session is a bearer
 * JWT that arrives in the response BODY of `/api/login`, and a body is not
 * session state the Transport keeps — ADR-003 decision 3 gives the
 * Transport the session's COOKIES, and a bearer token in a body is neither
 * a `Cookie` nor a `Set-Cookie` header, so the cookie rule does not reach
 * it. The token is therefore connector-held: written by `authenticate`,
 * read by the `message` fetcher, in a mutable variable of this factory's
 * closure. It is never logged and never interpolated into a `ConnectorError`
 * message.
 *
 * Error hygiene (ADR-003): every `ConnectorError` message below is a fixed
 * string chosen here. No response value, credential, URL, header, or token
 * value is ever interpolated into one.
 */
import {
  assertNoCookieHeaders,
  ConnectorError,
} from "@school-connector-kit/core";
import type {
  Connector,
  ConnectorConfig,
  ConnectorCredentials,
  ConnectorRuntime,
  FetchRequest,
  HttpRequest,
  HttpResponse,
  Message,
} from "@school-connector-kit/core";

/**
 * Per-connector configuration (ADR-005). None of these values are logged,
 * and none is interpolated into a `ConnectorError` message.
 *
 * `bundleVersion` is addressing/identity only (ADR-005 decision 5): the
 * API is pinned to a frontend build, and the connector just ships it —
 * read back nowhere. If the platform starts validating it, a version bump
 * is the first thing to check.
 *
 * `sourceInstance` is inherited from `ConnectorConfig` and, like
 * WebUntis's, is deliberately distinct from any platform tenant selector:
 * it identifies the instance in the normalized stream.
 */
export interface SchulmanagerConfig extends ConnectorConfig {
  /** Base origin of the Schulmanager instance (no trailing slash). */
  readonly baseUrl: string;
  /** The frontend build identifier the API is pinned to. */
  readonly bundleVersion: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Build the Schulmanager connector.
 *
 * `runtime` is the ADR-003 capability trio (transport, clock, logger);
 * `config` pins the instance identity. Both are injected; nothing here is
 * implied.
 */
export function createSchulmanagerConnector(
  runtime: ConnectorRuntime,
  config: SchulmanagerConfig,
): Connector {
  const { baseUrl, bundleVersion, sourceInstance } = config;

  // The bearer token, connector-held. See the file header for why the
  // ADR-003 cookie rule does not cover this, and for the hygiene rules.
  let token: string | undefined;

  async function authenticate(credentials: ConnectorCredentials): Promise<void> {
    const user = credentials["user"];
    const password = credentials["password"];
    if (typeof user !== "string" || typeof password !== "string") {
      throw new ConnectorError(
        "auth_failed",
        "credentials must carry a string user and a string password",
      );
    }
    // Deliberately NO `/api/salt` request: on the observed tenant that
    // endpoint 404s, and login succeeds without it.
    const request: HttpRequest = {
      method: "POST",
      url: `${baseUrl}/api/login`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emailOrUsername: user,
        password,
        hash: null,
        mobileApp: false,
        institutionId: null,
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
      throw new ConnectorError(
        "auth_failed",
        "the authentication response was not valid JSON",
      );
    }

    // Read EXACTLY ONE field from this body. The response also carries the
    // children's names and tenant identifiers under user.associatedParents;
    // this connector reads nothing of that beyond "jwt" — the
    // highest-sensitivity payload the platform returns.
    const jwt = isPlainObject(decoded) ? decoded["jwt"] : undefined;
    if (typeof jwt !== "string" || jwt.length === 0) {
      throw new ConnectorError(
        "auth_failed",
        "the authentication response did not carry a bearer token",
      );
    }
    token = jwt;
  }

  /**
   * Issue ONE `/api/calls` request and return the single result's `data`.
   *
   * Scope: the only request objects this connector ever builds are the
   * letters `get-letters` list call and the poqa detail call. `poqa` is a
   * GENERIC ORM tunnel — its target model is a client-supplied string — so
   * this connector scopes it to `modules/letters/letter` and NOTHING else.
   * (The letter attachments association is deliberately never requested:
   * binaries are out of scope, gap G10.)
   */
  async function callData(requestObject: Record<string, unknown>): Promise<unknown> {
    if (token === undefined) {
      throw new ConnectorError("auth_failed", "the connector is not authenticated");
    }
    const httpRequest: HttpRequest = {
      method: "POST",
      url: `${baseUrl}/api/calls`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ bundleVersion, requests: [requestObject] }),
    };
    assertNoCookieHeaders(httpRequest);

    let response: HttpResponse;
    try {
      response = await runtime.transport.send(httpRequest);
    } catch {
      throw new ConnectorError("transport_failed", "the transport request failed");
    }

    // Token rotation (gap G20): unobserved behaviour carried over from the
    // platform's own client — the name is folded, so ANY casing the
    // response uses is found. `HttpResponse.headers` is a plain record with
    // no case-folding guarantee, so the keys are folded here rather than
    // indexed by one spelling.
    for (const key of Object.keys(response.headers)) {
      if (key.toLowerCase() === "x-new-bearer-token") {
        const replacement = response.headers[key];
        if (typeof replacement === "string" && replacement.length > 0) {
          token = replacement;
        }
        break;
      }
    }

    if (response.status !== 200) {
      throw new ConnectorError(
        "unexpected_response",
        "the calls response was not successful",
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(response.body);
    } catch {
      throw new ConnectorError(
        "unexpected_response",
        "the calls response was not valid JSON",
      );
    }

    const results = isPlainObject(decoded) ? decoded["results"] : undefined;
    const single =
      Array.isArray(results) && results.length === 1 ? results[0] : undefined;
    if (!isPlainObject(single)) {
      throw new ConnectorError(
        "unexpected_response",
        "the calls response did not carry a single result",
      );
    }

    // The per-result `status` axis is independent of the HTTP status.
    // ADR-007 decision 3 DECLINES to represent partial failure: one failed
    // detail request fails the whole fetch — the first connector to meet a
    // real partial failure is the one that decides otherwise.
    if (single["status"] !== 200) {
      throw new ConnectorError(
        "unexpected_response",
        "the call result was not successful",
      );
    }

    return single["data"];
  }

  async function fetchMessages(request: FetchRequest): Promise<readonly Message[]> {
    // The platform supplies no window parameter on this fetch, so
    // `request.window` is not translated and not sent — if present it is
    // ignored: no throw, no row filtering. Client-side filtering is a
    // consumer concern, not a normalisation one.
    const listData = await callData({
      moduleName: "letters",
      endpointName: "get-letters",
    });
    if (!Array.isArray(listData)) {
      throw new ConnectorError(
        "unexpected_response",
        "the letters list did not carry an array of letters",
      );
    }

    // ONE capture instant for the WHOLE fetch, computed once before the
    // detail loop and shared by every row this run emits. This is the only
    // Date construction in this connector: it turns the clock's epoch ms
    // into a UTC ISO string. The platform instant strings themselves are
    // carried through verbatim — no date arithmetic on them anywhere.
    const capturedAt = new Date(runtime.clock.now()).toISOString();

    const rows: Message[] = [];
    for (const entry of listData) {
      if (!isPlainObject(entry)) {
        throw new ConnectorError(
          "unexpected_response",
          "a letter row in the list did not match the expected shape",
        );
      }
      const id = entry["id"];
      if (id === undefined || id === null) {
        throw new ConnectorError(
          "unexpected_response",
          "a letter row in the list is missing its id",
        );
      }
      // `title` is read and checked for the wire shape, but NOT emitted:
      // the `Message` concept has no title field in schema 0.1, and the
      // list row's title is not invented into one.
      const title = entry["title"];
      if (typeof title !== "string") {
        throw new ConnectorError(
          "unexpected_response",
          "a letter row in the list does not carry a string title",
        );
      }
      // Date: prefer `sentDate`, else `createdAt` — the platform instant
      // string, carried through unchanged.
      const instant = entry["sentDate"] ?? entry["createdAt"];
      if (typeof instant !== "string") {
        throw new ConnectorError(
          "unexpected_response",
          "a letter row in the list does not carry an instant string",
        );
      }

      // One detail call per letter — the N+1 fetch: expressible under
      // ADR-003, and bounded by THIS connector (ADR-007 decision 2).
      const detailData = await callData({
        moduleName: "letters",
        endpointName: "poqa",
        parameters: {
          action: {
            // scoped to the letters model — poqa is a generic tunnel, see
            // `callData`
            model: "modules/letters/letter",
            action: "findByPk",
            parameters: [id, {}],
          },
        },
      });
      if (!isPlainObject(detailData)) {
        throw new ConnectorError(
          "unexpected_response",
          "the letter detail did not carry an object body",
        );
      }
      const text = detailData["text"];
      if (typeof text !== "string") {
        throw new ConnectorError(
          "unexpected_response",
          "the letter detail does not carry a string body",
        );
      }

      const row: Message = {
        concept: "message",
        date: { kind: "platform_instant", value: instant },
        // The platform string is held as emitted: no tag stripping, no
        // entity decoding — presentation is a consumer concern.
        body: text,
        // `link_count` is deliberately OMITTED: no Schulmanager evidence
        // backs a link-count column here, and absence is a true statement
        // where a 0 would be a false one.
        provenance: {
          concept: "provenance_envelope",
          source_platform: "schulmanager",
          source_instance: sourceInstance,
          source_record_id: String(id),
          captured_at: capturedAt,
          request: {
            method: "POST",
            status: 200,
            url_template: "/api/calls",
            // ADR-007 decision 5: the envelope names the call that
            // ESTABLISHED this row's identity — the `get-letters` list
            // call — so the detail call that supplied the body is named
            // nowhere; that limit is recorded in the ADR. The value matches
            // the capture committed under fixtures/schulmanager/variant-001/
            // (ADR-007 decision 4).
            logical_call: "get-letters",
          },
        },
      };
      rows.push(row);
    }

    // Log ONCE, with number/boolean fields only (ADR-003 decision 5); no
    // string fields. `status` is the fixed 200 because every non-200 calls
    // response has already thrown; `row_count` is the only thing that
    // varies.
    runtime.logger.debug("schulmanager_message_fetch", {
      status: 200,
      row_count: rows.length,
    });
    return rows;
  }

  return {
    platform: "schulmanager",
    fetchers: { message: fetchMessages },
    authenticate,
  };
}
