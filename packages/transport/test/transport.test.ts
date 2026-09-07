/**
 * Tests for the fetch-based Transport (ADR-011).
 *
 * The global `fetch` is the host under test and is stubbed per test — the
 * Transport's own contract is what is pinned, not a network. Canned
 * responses are real `Response` objects, so the header surface under test is
 * the real one; their values are placeholders, and the token header names are
 * invented, not a real product's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpRequest } from "@school-connector-kit/core";
import { createFetchTransport } from "../src/transport.js";

const URL_1 = "https://placeholder.example.invalid/one";
const URL_2 = "https://placeholder.example.invalid/two";
const URL_3 = "https://placeholder.example.invalid/three";

/** One canned response: ordinary headers, `Set-Cookie` lines, a body. */
interface Canned {
  code?: number;
  headers?: Record<string, string>;
  setCookies?: readonly string[];
  body?: string;
}

function canned(spec: Canned): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(spec.headers ?? {})) {
    headers.append(name, value);
  }
  for (const line of spec.setCookies ?? []) {
    headers.append("Set-Cookie", line);
  }
  return new Response(spec.body ?? "", {
    status: spec.code ?? 200,
    headers,
  });
}

let queue: Response[] = [];
let calls: { url: string; init: RequestInit | undefined }[] = [];

beforeEach(() => {
  queue = [];
  calls = [];
  vi.stubGlobal(
    "fetch",
    async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (next === undefined) {
        throw new Error("fetch stub: no canned response left in the queue");
      }
      return next;
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The header names the stub received for one call, folded to lowercase. */
function sentNames(callIndex: number): readonly string[] {
  const init = calls[callIndex]?.init;
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return Object.keys(headers).map((name) => name.toLowerCase());
}

/** The header value the stub received for one call, folded per name. */
function sentValue(callIndex: number, name: string): string | undefined {
  const init = calls[callIndex]?.init;
  const headers = (init?.headers ?? {}) as Record<string, string>;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) return value;
  }
  return undefined;
}

function plainRequest(
  url: string,
  extra?: { headers?: Record<string, string>; body?: string },
): HttpRequest {
  return {
    method: "GET",
    url,
    headers: { ...(extra?.headers ?? {}) },
    ...(extra?.body !== undefined ? { body: extra.body } : {}),
  };
}

/* ————————————————————————————————————— the jar ————————————————————————————————————— */

describe("the jar is the Transport's (ADR-011 decision 1)", () => {
  it("sends no Cookie header while the jar is empty", async () => {
    queue.push(canned({ code: 200 }));
    const transport = createFetchTransport();

    await transport.send(plainRequest(URL_1, { headers: { "x-plain": "one" } }));

    expect(sentNames(0)).toContain("x-plain");
    expect(sentNames(0)).not.toContain("cookie");
  });

  it("stores a Set-Cookie on the response and sends it on the next request as a Cookie header", async () => {
    queue.push(
      canned({ setCookies: ["placeholder-cookie-one=one; HttpOnly"] }),
      canned({ code: 200 }),
    );
    const transport = createFetchTransport();

    await transport.send(plainRequest(URL_1));
    await transport.send(plainRequest(URL_2));

    expect(sentNames(0)).not.toContain("cookie");
    expect(sentNames(1)).toContain("cookie");
    expect(sentValue(1, "cookie")).toBe("placeholder-cookie-one=one");
  });

  it("accumulates one cookie per response and joins them with \"; \"", async () => {
    queue.push(
      canned({ setCookies: ["placeholder-cookie-one=one"] }),
      canned({ setCookies: ["placeholder-cookie-two=two"] }),
      canned({ code: 200 }),
    );
    const transport = createFetchTransport();

    await transport.send(plainRequest(URL_1));
    await transport.send(plainRequest(URL_2));
    await transport.send(plainRequest(URL_3));

    expect(sentValue(2, "cookie")).toBe(
      "placeholder-cookie-one=one; placeholder-cookie-two=two",
    );
  });

  it("keeps one jar per factory call — a second transport is not seeded by the first's responses", async () => {
    queue.push(
      canned({ setCookies: ["placeholder-cookie-one=one"] }),
      canned({ code: 200 }),
    );
    const seeded = createFetchTransport();
    const fresh = createFetchTransport();

    await seeded.send(plainRequest(URL_1));
    await fresh.send(plainRequest(URL_2));

    expect(sentNames(1)).not.toContain("cookie");
  });
});

/* ———————————————— the returned headers (ADR-011 decision 3) ———————————————— */

describe("the returned headers (ADR-011 decision 3)", () => {
  it("strips set-cookie from the returned headers, in whatever case the response used it", async () => {
    queue.push(
      canned({
        setCookies: ["placeholder-cookie-one=one; Path=/"],
        headers: { "x-plain": "one" },
      }),
    );
    const transport = createFetchTransport();

    const response = await transport.send(plainRequest(URL_1));

    for (const name of Object.keys(response.headers)) {
      expect(name.toLowerCase()).not.toBe("set-cookie");
    }
    expect(response.headers["x-plain"]).toBe("one");
  });

  it("strips cookie from the returned headers too, and passes everything else by", async () => {
    queue.push(
      canned({
        headers: { cookie: "placeholder-leak", "x-kit-token": "placeholder-rotated" },
      }),
    );
    const transport = createFetchTransport();

    const response = await transport.send(plainRequest(URL_1));

    expect(response.headers["cookie"]).toBeUndefined();
    expect(response.headers["x-kit-token"]).toBe("placeholder-rotated");
  });

  it("passes an unrelated response header through unchanged — the Schulmanager token-rotation case", async () => {
    queue.push(
      canned({
        setCookies: ["placeholder-cookie-one=one"],
        headers: { "x-other-token": "placeholder-new-token" },
      }),
    );
    const transport = createFetchTransport();

    const response = await transport.send(plainRequest(URL_1));

    expect(response.headers["x-other-token"]).toBe("placeholder-new-token");
  });
});

/* ———————————————— the fetch call itself (ADR-011 decision 4) ———————————————— */

describe("the fetch call (ADR-011 decision 4)", () => {
  it("passes redirect manual to fetch — the pin ADR-011 decision 4 records", async () => {
    queue.push(canned({ code: 200 }));
    const transport = createFetchTransport();

    await transport.send(plainRequest(URL_1));

    expect(calls[0]?.url).toBe(URL_1);
    expect(calls[0]?.init?.redirect).toBe("manual");
  });

  it("surfaces a 302 as status 302 rather than following it", async () => {
    queue.push(canned({ code: 302, body: "placeholder-moved" }));
    const transport = createFetchTransport();

    const response = await transport.send(plainRequest(URL_1));

    expect(calls).toHaveLength(1);
    expect(response.status).toBe(302);
    expect(response.body).toBe("placeholder-moved");
  });

  it("does not mutate the caller's headers object, and still sends the jar", async () => {
    queue.push(canned({ setCookies: ["placeholder-cookie-one=one"] }), canned({}));
    const callerHeaders = { "content-type": "application/json" };
    const transport = createFetchTransport();
    const first: HttpRequest = {
      method: "POST",
      url: URL_1,
      headers: callerHeaders,
      body: "placeholder-body",
    };

    await transport.send(first);
    await transport.send(plainRequest(URL_2));

    expect(callerHeaders).toEqual({ "content-type": "application/json" });
    expect("Cookie" in callerHeaders).toBe(false);
    expect(sentValue(1, "cookie")).toBe("placeholder-cookie-one=one");
  });
});
