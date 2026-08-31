import { describe, expect, it } from "vitest";

import {
  CaptureFile,
  CaptureValidationError,
  type CaptureFileInput,
  type CaptureRequest,
} from "../src/capture-file.js";
import { Redactor, type Allowlist } from "../src/redactor.js";

function makeRedaction(overrides: {
  shape?: unknown;
  droppedPaths?: string[];
  arrayLengths?: Record<string, number>;
} = {}) {
  return {
    shape: overrides.shape ?? { ok: true },
    droppedPaths: overrides.droppedPaths ?? [],
    arrayLengths: overrides.arrayLengths ?? {},
  };
}

function makeInput(overrides: Partial<CaptureFileInput> = {}): CaptureFileInput {
  return {
    platform: "webuntis",
    allowlistVersion: "webuntis-1",
    capturedAt: "2025-06-15T08:30:00Z",
    requests: [
      {
        method: "GET",
        urlTemplate: "https://school.example/api/termine/{id}",
        status: 200,
        redaction: makeRedaction(),
      },
    ],
    ...overrides,
  };
}

describe("CaptureFile", () => {
  it("serializes the exact expected JSON contract", () => {
    const input = makeInput({
      capturedAt: "2025-06-15T08:30:00.123Z",
      requests: [
        {
          method: "GET",
          urlTemplate: "https://school.example/api/termine/{id}",
          status: 200,
          redaction: makeRedaction({
            shape: {
              data: {
                id: 5,
                name: { __t: "string", __len: 4 },
              },
            },
            droppedPaths: ["data.secret"],
            arrayLengths: { "data.periods": 3 },
          }),
        },
      ],
    });

    const expected = JSON.stringify({
      capture_format: 1,
      platform: "webuntis",
      allowlist_version: "webuntis-1",
      captured_at: "2025-06-15T08:30:00.123Z",
      requests: [
        {
          method: "GET",
          url_template: "https://school.example/api/termine/{id}",
          status: 200,
          shape: {
            data: {
              id: 5,
              name: { __t: "string", __len: 4 },
            },
          },
          dropped_paths: ["data.secret"],
          array_lengths: { "data.periods": 3 },
        },
      ],
    });

    expect(CaptureFile.create(input).toJson()).toBe(expected);
  });

  it("preserves the caller-supplied captured_at exactly, never converted", () => {
    const supplied = "2025-01-02T03:04:05.500Z";

    const file = CaptureFile.create(makeInput({ capturedAt: supplied }));

    const parsed = JSON.parse(file.toJson()) as { captured_at: string };
    expect(parsed.captured_at).toBe(supplied);
  });

  it("is byte-identical across repeated serializations of equivalent input", () => {
    const base = makeInput({
      requests: [
        {
          method: "GET",
          urlTemplate: "https://school.example/api/termine/{id}",
          status: 200,
          redaction: makeRedaction({
            shape: { b: 2, a: 1 },
            droppedPaths: ["q.secret", "a.secret"],
            // Deliberately not in code point order: the serialized output
            // must still be canonical and therefore deterministic.
            arrayLengths: { "z.path": 3, "a.path": 1 },
          }),
        },
      ],
    });

    const again: CaptureFileInput = {
      ...base,
      requests: base.requests.map((request) => ({
        ...request,
        redaction: {
          shape: { b: 2, a: 1 },
          // Same content as the base input: the inputs are equivalent
          // (array_lengths key order differs, content does not).
          droppedPaths: ["q.secret", "a.secret"],
          arrayLengths: { "z.path": 3, "a.path": 1 },
        },
      })),
    };

    const first = CaptureFile.create(base).toJson();
    const second = CaptureFile.create(base).toJson();
    const third = CaptureFile.create(again).toJson();

    expect(second).toBe(first);
    expect(third).toBe(first);

    const parsed = JSON.parse(first) as {
      requests: Array<{
        dropped_paths: string[];
        array_lengths: Record<string, number>;
      }>;
    };
    expect(parsed.requests[0]!.dropped_paths).toEqual(["a.secret", "q.secret"]);
    expect(Object.keys(parsed.requests[0]!.array_lengths)).toEqual([
      "a.path",
      "z.path",
    ]);
  });

  it("rejects captured_at values that are not valid UTC ISO 8601 ending in Z", () => {
    const invalidTimestamps = [
      "2025-06-15T08:30:00+02:00", // offset instead of Z
      "2025-06-15T08:30:00z", // lowercase z
      "2025-06-15 08:30:00Z", // no T separator
      "2025-06-15T08:30:00", // missing Z
      "2025-13-01T00:00:00Z", // invalid month
      "2025-02-30T08:30:00Z", // impossible day
      "2025-06-15T24:00:00Z", // invalid hour
      "08:30:00Z", // truncated
      "not-a-timestamp",
      "",
    ];

    for (const capturedAt of invalidTimestamps) {
      expect(
        () => CaptureFile.create(makeInput({ capturedAt })),
        `captured_at=${JSON.stringify(capturedAt)}`,
      ).toThrow(/captured_at/);
    }
  });

  it("accepts leap-day and fractional-second UTC timestamps", () => {
    for (const capturedAt of [
      "2024-02-29T23:59:59Z",
      "2025-06-15T08:30:00.123456Z",
    ]) {
      expect(CaptureFile.create(makeInput({ capturedAt }))).toBeInstanceOf(
        CaptureFile,
      );
    }

    // 2025 is not a leap year: 2025-02-29 must stay rejected.
    expect(() =>
      CaptureFile.create(makeInput({ capturedAt: "2025-02-29T00:00:00Z" })),
    ).toThrow(/captured_at/);
  });

  it("rejects invalid HTTP status codes", () => {
    const invalidStatuses = [99, 600, 200.5, -5, NaN, Number.POSITIVE_INFINITY];

    for (const status of invalidStatuses) {
      expect(
        () =>
          CaptureFile.create(
            makeInput({
              requests: [
                {
                  method: "GET",
                  urlTemplate: "https://school.example/api/x",
                  status,
                  redaction: makeRedaction(),
                },
              ],
            }),
          ),
        `status=${JSON.stringify(status)}`,
      ).toThrow(/status/);
    }
  });

  it("rejects empty required strings, including per-request fields", () => {
    const cases: Array<[string, (input: CaptureFileInput) => CaptureFileInput]> =
      [
        ["platform", (input) => ({ ...input, platform: "" })],
        [
          "allowlistVersion",
          (input) => ({ ...input, allowlistVersion: "" }),
        ],
        [
          "method",
          (input) => ({
            ...input,
            requests: input.requests.map((request) => ({
              ...request,
              method: "",
            })),
          }),
        ],
        [
          "urlTemplate",
          (input) => ({
            ...input,
            requests: input.requests.map((request) => ({
              ...request,
              urlTemplate: "",
            })),
          }),
        ],
      ];

    for (const [field, mutate] of cases) {
      expect(
        () => CaptureFile.create(mutate(makeInput())),
        field,
      ).toThrowError();
    }
  });

  it("preserves request order exactly as supplied", () => {
    const requests = [3, 1, 2].map((n) => ({
      method: "GET",
      urlTemplate: `https://school.example/api/request-${n}`,
      status: n === 1 ? 204 : 200,
      redaction: makeRedaction({ shape: { n } }),
    }));

    const file = CaptureFile.create(makeInput({ requests }));

    const parsed = JSON.parse(file.toJson()) as {
      requests: Array<{ url_template: string }>;
    };

    expect(
      parsed.requests.map((request) => request.url_template),
    ).toEqual([
      "https://school.example/api/request-3",
      "https://school.example/api/request-1",
      "https://school.example/api/request-2",
    ]);
  });

  it("places RedactionResult metadata exactly under dropped_paths and array_lengths", () => {
    const redaction = makeRedaction({
      shape: { kept: 1 },
      droppedPaths: ["data.secretList[].pin"],
      arrayLengths: { "data.secretList": 7 },
    });

    const file = CaptureFile.create(
      makeInput({
        requests: [
          {
            method: "POST",
            urlTemplate: "https://school.example/api/submit",
            status: 201,
            redaction,
          },
        ],
      }),
    );

    const parsed = JSON.parse(file.toJson()) as {
      requests: Array<Record<string, unknown>>;
    };
    const request = parsed.requests[0]!;

    expect(Object.keys(request)).toEqual([
      "method",
      "url_template",
      "status",
      "shape",
      "dropped_paths",
      "array_lengths",
    ]);
    expect(request.shape).toEqual({ kept: 1 });
    expect(request.dropped_paths).toEqual(["data.secretList[].pin"]);
    expect(request.array_lengths).toEqual({ "data.secretList": 7 });
    // No camelCase or duplicated metadata fields may leak into the contract.
    expect(request).not.toHaveProperty("droppedPaths");
    expect(request).not.toHaveProperty("arrayLengths");
    expect(request).not.toHaveProperty("redaction");
  });
});

describe("capture pipeline security regression", () => {
  it("keeps every non-allowlisted canary out of the fully serialized capture", () => {
    // Fully synthetic upstream response with several kinds of secrets.
    const allowlist: Allowlist = {
      version: "webuntis-1",
      rules: [
        { path: "data.id", mode: "keep" },
        { path: "data.term", mode: "type" },
      ],
    };

    const canaries = {
      pupilName: "CANARY_PUPIL_a1b2c3",
      teacherName: "CANARY_TEACHER_d4e5f6",
      privateString: "CANARY_PRIVATE_g7h8i9",
      nestedHidden: "CANARY_NESTED_j0k1l2",
      nestedDeeper: "CANARY_DEEPER_m3n4o5",
      topLevel: "CANARY_TOP_p6q7r8",
    };
    const canaryValues = Object.values(canaries);

    const upstreamResponse = {
      data: {
        id: 7,
        term: "CANARY_TERM_s9t0u1",
        pupil: { name: canaries.pupilName, birthYear: 2013 },
        teacher: { name: canaries.teacherName },
        memo: canaries.privateString,
        nested: {
          hidden: canaries.nestedHidden,
          deeper: { x: canaries.nestedDeeper },
        },
      },
      other: canaries.topLevel,
    };

    const redaction = new Redactor(allowlist).redact(upstreamResponse);

    const file = CaptureFile.create({
      platform: "webuntis",
      allowlistVersion: "webuntis-1",
      capturedAt: "2025-06-15T08:30:00Z",
      requests: [
        {
          method: "GET",
          urlTemplate: "https://school.example/api/data/7",
          status: 200,
          redaction,
        },
      ],
    });

    // Assert against the ENTIRE serialized capture, not only the shape: a
    // value could theoretically leave `shape` yet reappear in a metadata
    // field (dropped_paths / array_lengths / top level).
    const encoded = file.toJson();

    for (const canary of canaryValues) {
      expect(encoded, `canary ${canary}`).not.toContain(canary);
    }
    expect(encoded).not.toContain("CANARY_TERM_s9t0u1"); // type-redacted
    expect(encoded).not.toContain("2013"); // birthYear of the pupil

    // The allowlisted behavior itself still works through the pipeline.
    expect(encoded).toContain('"id":7');
    expect(encoded).toContain('"__t":"string"');

    // Metadata must be shape paths only — never values.
    const parsed = JSON.parse(encoded) as {
      requests: Array<{ dropped_paths: string[] }>;
    };
    expect(parsed.requests[0]!.dropped_paths).toEqual([
      "data.memo",
      "data.nested",
      "data.pupil",
      "data.teacher",
      "other",
    ]);
  });
});

describe("logical_call (ADR-004)", () => {
  function requestWith(
    overrides: Partial<CaptureRequest> = {},
  ): CaptureRequest {
    return {
      method: "POST",
      urlTemplate: "/api/calls",
      status: 200,
      redaction: makeRedaction(),
      ...overrides,
    };
  }

  function parseOutput(file: CaptureFile) {
    return JSON.parse(file.toJson()) as {
      requests: Array<Record<string, unknown>>;
    };
  }

  it("omits the logical_call key entirely when the field is absent", () => {
    const file = CaptureFile.create(makeInput());

    expect(parseOutput(file).requests[0]!).not.toHaveProperty(
      "logical_call",
    );
    expect(file.toJson()).not.toContain("logical_call");
  });

  it("emits logical_call with the exact value, immediately after status", () => {
    const file = CaptureFile.create(
      makeInput({ requests: [requestWith({ logicalCall: "get-letters" })] }),
    );

    const request = parseOutput(file).requests[0]!;
    expect(request.logical_call).toBe("get-letters");
    expect(Object.keys(request)).toEqual([
      "method",
      "url_template",
      "status",
      "logical_call",
      "shape",
      "dropped_paths",
      "array_lengths",
    ]);
  });

  it("rejects an empty logical_call with the field-scoped message", () => {
    let error: unknown = null;
    try {
      CaptureFile.create(
        makeInput({ requests: [requestWith({ logicalCall: "" })] }),
      );
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(CaptureValidationError);
    expect((error as CaptureValidationError).message).toBe(
      "requests[0].logical_call: must be a non-empty string",
    );
  });

  it("rejects a non-string logical_call with the same message", () => {
    let error: unknown = null;
    try {
      CaptureFile.create(
        makeInput({
          requests: [
            { ...requestWith(), logicalCall: 42 } as unknown as CaptureRequest,
          ],
        }),
      );
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(CaptureValidationError);
    expect((error as CaptureValidationError).message).toBe(
      "requests[0].logical_call: must be a non-empty string",
    );
  });
});
