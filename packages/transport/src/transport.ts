/**
 * Host-side `Transport` implementation (ADR-011).
 *
 * ADR-003 decision 2 defined the contract and decision 3 fixed who owns the
 * session cookie; ADR-011 settles the three throwaway runners' divergences
 * in one place: the jar is the Transport's (decisions 1 and 2), `Set-Cookie`
 * and `Cookie` never reach the connector (decision 3), and redirects are
 * surfaced, never followed (decision 4).
 *
 * This module deliberately touches the host — it calls the global `fetch` —
 * because it is, per ADR-011 decision 5, the one component whose job is to
 * do so. It therefore lives in its own package and carries no closure
 * constraint, unlike every connector package.
 *
 * Nothing here is logged, printed, or thrown from a value: no credential, no
 * cookie value, and no URL is ever named.
 */
import type {
  HttpRequest,
  HttpResponse,
  Transport,
} from "@school-connector-kit/core";

/**
 * Create the fetch-based `Transport` (ADR-011 decisions 1–4).
 *
 * ADR-011 decision 2: the jar's lifetime is this instance. One factory call,
 * one jar — nothing is written to disk and nothing is shared between calls.
 */
export function createFetchTransport(): Transport {
  const jar = new Map<string, string>();

  return {
    async send(request: HttpRequest): Promise<HttpResponse> {
      // ADR-011 decision 1: the jar is the Transport's, and the connector's
      // request is copied, never mutated — the `Cookie` header is added here,
      // never by the connector.
      const headers: Record<string, string> = { ...request.headers };
      if (jar.size > 0) {
        headers["Cookie"] = [...jar]
          .map(([name, value]) => `${name}=${value}`)
          .join("; ");
      }

      // The `body` member is set only when the request carries one: the
      // contract's `body?` is optional, and absent must stay absent.
      const init: RequestInit = {
        method: request.method,
        headers,
        // ADR-011 decision 4: manual redirects, surfaced never followed.
        redirect: "manual",
      };
      if (request.body !== undefined) {
        init["body"] = request.body;
      }

      const res = await fetch(request.url, init);

      // The session arrives as `Set-Cookie` and is kept here, where the
      // connector cannot reach it (ADR-003 decision 3). Only the first `;`-
      // segment of each line is read, split at the first `=`, and stored
      // trimmed — attributes are deliberately discarded (ADR-011, not
      // decided: the attributes are a known limitation, not a decision).
      // The call is bare on purpose: ADR-011 alternative (b) rejected
      // guarding it against hosts that lack it, and the Hermes probe is the
      // amendment channel if one does.
      for (const raw of res.headers.getSetCookie()) {
        const stop = raw.indexOf(";");
        const pair = stop === -1 ? raw : raw.slice(0, stop);
        const eq = pair.indexOf("=");
        if (eq > 0) {
          jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
        }
      }

      // ADR-011 decision 3: exactly `set-cookie` and `cookie` are excluded,
      // compared case-insensitively, and nothing else. The Schulmanager
      // connector rotates a token via response headers, so a broader strip
      // would break a shipped connector — that is the cost the decision
      // names, and the strip stays this narrow because of it.
      const responseHeaders: Record<string, string> = {};
      for (const [name, value] of res.headers) {
        const folded = name.toLowerCase();
        if (folded === "set-cookie" || folded === "cookie") continue;
        responseHeaders[name] = value;
      }

      return {
        status: res.status,
        headers: responseHeaders,
        body: await res.text(),
      };
    },
  };
}
