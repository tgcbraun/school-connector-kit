/**
 * Connector transport contract (ADR-003).
 *
 * String bodies, not WHATWG `fetch`: streams and Response objects do not
 * marshal across the JS-to-Dart bridge, and the same host also embeds the
 * engine under Hermes (React Native), so the interface is the lowest common
 * denominator the hosts actually provide.
 *
 * The Transport is session-scoped and owns cookie persistence. Connectors
 * must never read or write the session-cookie headers themselves — see
 * `assertNoCookieHeaders`.
 */
import { ConnectorError } from "./errors.js";

export type HttpMethod = "GET" | "POST";

export interface HttpRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface Transport {
  send(request: HttpRequest): Promise<HttpResponse>;
}

/**
 * Portability rule (ADR-003): the session's cookies are owned by the
 * Transport. A connector request that carries a session-cookie header would
 * make the connector depend on cookie traffic being visible from JavaScript
 * — a dependence this contract exists to rule out uniformly, regardless of
 * which host runs it.
 *
 * The thrown message is a fixed string. It deliberately contains neither
 * the offending key nor any header value.
 */
export function assertNoCookieHeaders(request: HttpRequest): void {
  for (const key of Object.keys(request.headers)) {
    const folded = key.toLowerCase();
    if (folded === "cookie" || folded === "set-cookie") {
      throw new ConnectorError(
        "unexpected_response",
        "request must not set the transport-owned session state",
      );
    }
  }
}
