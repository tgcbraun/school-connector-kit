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
 * Split a comma-joined `Set-Cookie` string at a comma and optional
 * whitespace that is followed by a cookie name and `=`.
 *
 * The separator is not derivable from a comma alone: an `Expires` attribute
 * contains one by construction. The lookahead is what makes the split
 * decidable — `Expires=Wed, 09 Jun 2027 …` continues with a bare day number,
 * not with a token followed by `=`.
 *
 * The character class is RFC 6265's cookie-name token set restricted to the
 * characters observed in practice. It is deliberately narrower than the full
 * grammar: a name outside it fails to split rather than splitting wrongly.
 */
const SET_COOKIE_SEPARATOR = /,\s*(?=[A-Za-z0-9!#$%&'*+\-.^_`|~]+=)/;

/**
 * Read the response's `Set-Cookie` lines (ADR-011 decision 1, amended
 * 2026-09-07).
 *
 * `Headers.getSetCookie` returns one entry per header line and is the
 * correct accessor. It does not exist under Hermes on iOS or Android,
 * established by `docs/evidence/HERMES_HOST_PROBE.md` and
 * `docs/evidence/HERMES_MULTI_COOKIE_JOIN.md`. Where it is absent,
 * `Headers.get` returns the lines joined with `", "`, observed on both
 * Hermes platforms.
 *
 * The joined string is split on `SET_COOKIE_SEPARATOR`, which
 * round-tripped three real cookies from a live WebUntis authentication
 * exactly — the split array was element-for-element identical to what
 * `getSetCookie` returned on a host that has it.
 *
 * The residual limit: a cookie VALUE containing a comma followed by a
 * token and `=` would still split wrongly. No platform in this project's
 * corpus has been observed emitting one, and that absence is not evidence.
 * See the gap register.
 */
function readSetCookie(headers: Headers): readonly string[] {
  const accessor = (headers as unknown as Record<string, unknown>)[
    "getSetCookie"
  ];
  if (typeof accessor === "function") {
    return (headers as unknown as { getSetCookie: () => string[] }).getSetCookie();
  }
  const joined = headers.get("set-cookie");
  return joined === null ? [] : joined.split(SET_COOKIE_SEPARATOR);
}

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
      // The accessor is chosen per call rather than assumed: ADR-011
      // alternative (b) rejected guarding it, the Hermes probe found the host
      // that lacks it, and the ADR was amended on that evidence.
      for (const raw of readSetCookie(res.headers)) {
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
