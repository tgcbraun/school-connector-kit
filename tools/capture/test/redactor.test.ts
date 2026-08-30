import { describe, expect, it } from "vitest";

import { Redactor, RedactorError, type Allowlist } from "../src/redactor.js";

describe("Redactor", () => {
  it("drops values that are not explicitly allowlisted", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        {
          path: "data.allowed",
          mode: "keep",
        },
      ],
    };

    const input = {
      data: {
        allowed: "safe-value",
        secret: "CANARY_SECRET_7a19",
      },
      unrelated: "CANARY_UNRELATED_b483",
    };

    const result = new Redactor(allowlist).redact(input);

    expect(result.shape).toEqual({
      data: {
        allowed: "safe-value",
      },
    });

    const encoded = JSON.stringify(result.shape);

    expect(encoded).not.toContain("CANARY_SECRET_7a19");
    expect(encoded).not.toContain("CANARY_UNRELATED_b483");

    expect(result.droppedPaths).toEqual([
      "data.secret",
      "unrelated",
    ]);
  });

  it("replaces a type-allowlisted string without leaking the original value", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        {
          path: "student.name",
          mode: "type",
        },
      ],
    };

    const original = "CANARY_STUDENT_NAME_91f2";

    const input = {
      student: {
        name: original,
      },
    };

    const result = new Redactor(allowlist).redact(input);

    expect(result.shape).toEqual({
      student: {
        name: {
          __t: "string",
          __len: original.length,
        },
      },
    });

    expect(JSON.stringify(result.shape)).not.toContain(original);
  });

  it("emits the correct type tokens for all supported scalar types", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        { path: "values.stringValue", mode: "type" },
        { path: "values.intValue", mode: "type" },
        { path: "values.doubleValue", mode: "type" },
        { path: "values.boolValue", mode: "type" },
        { path: "values.nullValue", mode: "type" },
      ],
    };

    const input = {
      values: {
        stringValue: "CANARY_STRING_123",
        intValue: 42,
        doubleValue: 42.5,
        boolValue: true,
        nullValue: null,
      },
    };

    const result = new Redactor(allowlist).redact(input);

    expect(result.shape).toEqual({
      values: {
        boolValue: {
          __t: "bool",
        },
        doubleValue: {
          __t: "double",
        },
        intValue: {
          __t: "int",
        },
        nullValue: {
          __t: "null",
        },
        stringValue: {
          __t: "string",
          __len: "CANARY_STRING_123".length,
        },
      },
    });

    expect(JSON.stringify(result.shape)).not.toContain(
      "CANARY_STRING_123",
    );
  });

  it("keeps at most three array elements and records the original length", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        {
          path: "items[].id",
          mode: "keep",
        },
      ],
    };

    const input = {
      items: Array.from({ length: 10 }, (_, index) => ({
        id: index + 1,
      })),
    };

    const result = new Redactor(allowlist).redact(input);

    expect(result.shape).toEqual({
      items: [
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ],
    });

    expect(result.arrayLengths).toEqual({
      items: 10,
    });

    expect(result.droppedPaths).toEqual([]);
  });

  it("does not inspect array elements after the third element", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        {
          path: "items[].id",
          mode: "keep",
        },
      ],
    };

    const input = {
      items: [
        { id: 1 },
        { id: 2 },
        { id: 3 },
        {
          id: 4,
          secret: "CANARY_MUST_NEVER_BE_INSPECTED_4",
        },
        {
          id: 5,
          secret: "CANARY_MUST_NEVER_BE_INSPECTED_5",
        },
      ],
    };

    const result = new Redactor(allowlist).redact(input);

    expect(result.shape).toEqual({
      items: [
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ],
    });

    expect(result.arrayLengths).toEqual({
      items: 5,
    });

    expect(result.droppedPaths).toEqual([]);

    const encoded = JSON.stringify(result);

    expect(encoded).not.toContain(
      "CANARY_MUST_NEVER_BE_INSPECTED_4",
    );
    expect(encoded).not.toContain(
      "CANARY_MUST_NEVER_BE_INSPECTED_5",
    );
  });

  it("drops deeply nested unallowlisted keys and records normalized paths", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        {
          path: "data.periods[].subject.name",
          mode: "keep",
        },
      ],
    };

    const input = {
      data: {
        periods: [
          {
            subject: {
              name: "Mathematik",
              internalId: "CANARY_SUBJECT_ID_51ab",
            },
            teacher: {
              name: "CANARY_TEACHER_NAME_77cd",
            },
          },
        ],
      },
    };

    const result = new Redactor(allowlist).redact(input);

    expect(result.shape).toEqual({
      data: {
        periods: [
          {
            subject: {
              name: "Mathematik",
            },
          },
        ],
      },
    });

    const encoded = JSON.stringify(result.shape);

    expect(encoded).not.toContain("CANARY_SUBJECT_ID_51ab");
    expect(encoded).not.toContain("CANARY_TEACHER_NAME_77cd");

    expect(result.droppedPaths).toEqual([
      "data.periods[].subject.internalId",
      "data.periods[].teacher",
    ]);
  });

  it("traverses ancestor containers without requiring explicit rules for them", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        {
          path: "data.result.periods[].subject.name",
          mode: "keep",
        },
      ],
    };

    const input = {
      data: {
        result: {
          periods: [
            {
              subject: {
                name: "Deutsch",
              },
            },
          ],
        },
      },
    };

    const result = new Redactor(allowlist).redact(input);

    expect(result.shape).toEqual({
      data: {
        result: {
          periods: [
            {
              subject: {
                name: "Deutsch",
              },
            },
          ],
        },
      },
    });
  });

  it("retains structural containers that become empty after redaction", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        {
          path: "data.items[].allowed",
          mode: "keep",
        },
      ],
    };

    const input = {
      data: {
        items: [
          {
            hidden: "CANARY_ONLY_HIDDEN_VALUE",
          },
        ],
      },
    };

    const result = new Redactor(allowlist).redact(input);

    expect(result.shape).toEqual({
      data: {
        items: [
          {},
        ],
      },
    });

    expect(result.arrayLengths).toEqual({
      "data.items": 1,
    });

    expect(result.droppedPaths).toEqual([
      "data.items[].hidden",
    ]);

    expect(JSON.stringify(result.shape)).not.toContain(
      "CANARY_ONLY_HIDDEN_VALUE",
    );
  });

  it("produces byte-identical output when called twice with the same input", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        {
          path: "data.items[].id",
          mode: "keep",
        },
        {
          path: "data.items[].name",
          mode: "type",
        },
      ],
    };

    const input = {
      ignored: "CANARY_IGNORED_d921",
      data: {
        items: [
          {
            name: "Alpha",
            id: 2,
            hidden: "CANARY_HIDDEN_82ab",
          },
          {
            id: 1,
            name: "Beta",
          },
        ],
      },
    };

    const redactor = new Redactor(allowlist);

    const first = redactor.redact(input);
    const second = redactor.redact(input);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first.shape)).toBe(
      JSON.stringify(second.shape),
    );
  });

  it("produces byte-identical shape output for equivalent objects with different key order", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        { path: "record.a", mode: "keep" },
        { path: "record.b", mode: "keep" },
        { path: "record.c", mode: "keep" },
      ],
    };

    const firstInput = {
      record: {
        c: 3,
        a: 1,
        b: 2,
      },
    };

    const secondInput = {
      record: {
        b: 2,
        c: 3,
        a: 1,
      },
    };

    const redactor = new Redactor(allowlist);

    const first = redactor.redact(firstInput);
    const second = redactor.redact(secondInput);

    expect(JSON.stringify(first.shape)).toBe(
      JSON.stringify(second.shape),
    );

    expect(JSON.stringify(first)).toBe(
      JSON.stringify(second),
    );
  });

  it("sorts and de-duplicates dropped paths", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        {
          path: "items[].allowed",
          mode: "keep",
        },
      ],
    };

    const input = {
      zzz: "CANARY_Z",
      items: [
        {
          allowed: 1,
          secret: "CANARY_A",
        },
        {
          allowed: 2,
          secret: "CANARY_B",
        },
        {
          allowed: 3,
          secret: "CANARY_C",
        },
      ],
      aaa: "CANARY_AAA",
    };

    const result = new Redactor(allowlist).redact(input);

    expect(result.droppedPaths).toEqual([
      "aaa",
      "items[].secret",
      "zzz",
    ]);
  });

  it("returns an empty object for an object root with an empty allowlist", () => {
    const allowlist: Allowlist = {
      version: "empty",
      rules: [],
    };

    const input = {
      secret: "CANARY_OBJECT_SECRET",
    };

    const result = new Redactor(allowlist).redact(input);

    expect(result.shape).toEqual({});
    expect(result.arrayLengths).toEqual({});
    expect(result.droppedPaths).toEqual([]);
    expect(JSON.stringify(result.shape)).not.toContain(
      "CANARY_OBJECT_SECRET",
    );
  });

  it("returns an empty array for an array root with an empty allowlist", () => {
    const allowlist: Allowlist = {
      version: "empty",
      rules: [],
    };

    const input = [
      "CANARY_ARRAY_SECRET",
      123,
    ];

    const result = new Redactor(allowlist).redact(input);

    expect(result.shape).toEqual([]);
    expect(result.arrayLengths).toEqual({});
    expect(result.droppedPaths).toEqual([]);
  });

  it("returns null for a scalar root with an empty allowlist", () => {
    const allowlist: Allowlist = {
      version: "empty",
      rules: [],
    };

    const result = new Redactor(allowlist).redact(
      "CANARY_SCALAR_SECRET",
    );

    expect(result.shape).toBeNull();
    expect(result.arrayLengths).toEqual({});
    expect(result.droppedPaths).toEqual([]);
  });

  it("orders arrayLengths keys by code point, independent of locale collation", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        { path: "Data.items[]", mode: "keep" },
        { path: "data.items[]", mode: "keep" },
      ],
    };

    const input = {
      Data: { items: [1] },
      data: { items: [1, 2] },
    };

    const result = new Redactor(allowlist).redact(input);

    // Code point order puts "Data.items" before "data.items"
    // ('D' U+0044 < 'd' U+0064), while a locale such as en-US collates
    // "data.items" first. The emitted key order must be a stable contract,
    // not a byproduct of the host's ICU/locale — the same input must
    // serialize byte-identically on every platform.
    expect(Object.keys(result.arrayLengths)).toEqual([
      "Data.items",
      "data.items",
    ]);
    expect(result.arrayLengths).toEqual({
      "Data.items": 1,
      "data.items": 2,
    });
  });

  it("applies the last rule for a duplicate allowlist path deterministically", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        { path: "dup.value", mode: "keep" },
        { path: "dup.value", mode: "type" },
      ],
    };

    const original = "CANARY_DUP_9c31";

    const result = new Redactor(allowlist).redact({
      dup: { value: original },
    });

    expect(result.shape).toEqual({
      dup: { value: { __t: "string", __len: original.length } },
    });
    expect(JSON.stringify(result.shape)).not.toContain(original);
    expect(result.droppedPaths).toEqual([]);
  });

  it("ignores allowlist rules whose path does not exist in the input", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        { path: "missing.deep.leaf", mode: "keep" },
        { path: "present", mode: "keep" },
      ],
    };

    const result = new Redactor(allowlist).redact({
      present: "safe-value",
      extra: "CANARY_EXTRA_4f02",
    });

    // An absent rule path is neither synthesized in the shape nor
    // recorded as a dropped path; only the input's own members appear.
    expect(result.shape).toEqual({ present: "safe-value" });
    expect(result.droppedPaths).toEqual(["extra"]);
    expect(result.arrayLengths).toEqual({});
    expect(JSON.stringify(result)).not.toContain("CANARY_EXTRA_4f02");
  });

  it("normalizes nested structures inside arrays without leaking uninspected data", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        { path: "matrix[].label", mode: "type" },
        { path: "matrix[].rows[].value", mode: "keep" },
      ],
    };

    const input = {
      matrix: [
        {
          label: "CANARY_LABEL_5b77",
          rows: [
            { value: 1 },
            { value: 2 },
            { value: 3 },
            { value: 4999, note: "CANARI_ROW_NOT_INSPECTED_1d" },
          ],
          secret: "CANARY_ROW_SECRET_8e21",
        },
      ],
    };

    const result = new Redactor(allowlist).redact(input);

    // Objects inside arrays keep their normalized "arr[].key" membership
    // paths, and nested arrays compose as "arr[].inner[].key".
    expect(result.shape).toEqual({
      matrix: [
        {
          label: { __t: "string", __len: "CANARY_LABEL_5b77".length },
          rows: [
            { value: 1 },
            { value: 2 },
            { value: 3 },
          ],
        },
      ],
    });

    // Original lengths are metadata for inspected arrays; the fourth row's
    // values must contribute nothing.
    expect(result.arrayLengths).toEqual({
      matrix: 1,
      "matrix[].rows": 4,
    });
    expect(result.droppedPaths).toEqual(["matrix[].secret"]);

    const encoded = JSON.stringify(result);
    expect(encoded).not.toContain("CANARY_LABEL_5b77");
    expect(encoded).not.toContain("CANARY_ROW_SECRET_8e21");
    expect(encoded).not.toContain("CANARI_ROW_NOT_INSPECTED_1d");
    expect(encoded).not.toContain("4999");
  });

  it("denies undefined values instead of throwing when allowlist rules exist", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [{ path: "anything", mode: "keep" }],
    };

    const result = new Redactor(allowlist).redact(undefined);

    expect(result.shape).toBeNull();
    expect(result.droppedPaths).toEqual([]);
    expect(result.arrayLengths).toEqual({});
  });
  it("refuses to authorize a literal key whose dotted join equals a rule path", () => {
    // The user-reported ambiguity: rule data.student.name targets
    // data > student > name (three structures), but a literal key
    // "student.name" joins to the exact same path string. A
    // deny-by-default redactor must fail closed, not choose a winner.
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [{ path: "data.student.name", mode: "keep" }],
    };

    expect(() =>
      new Redactor(allowlist).redact({
        data: { "student.name": "CANARY_DOT_KEY_6d21" },
      }),
    ).toThrow(RedactorError);

    // With the same allowlist, the genuine nested structure must still
    // be authorized — reserved-key rejection must not weaken ordinary
    // paths.
    const ok = new Redactor(allowlist).redact({
      data: { student: { name: "ordinary" } },
    });
    expect(ok.shape).toEqual({ data: { student: { name: "ordinary" } } });
  });

  it('refuses to let a literal key impersonate the "[]" array token', () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        { path: "rows[].value", mode: "keep" },
        { path: "rows2[]", mode: "keep" },
      ],
    };

    // A sibling key "rows[]" containing the array token must not be able
    // to supply members that match the array-element path "rows[].value".
    expect(() =>
      new Redactor(allowlist).redact({
        rows: [{ value: 1 }],
        "rows[]": { value: "CANARY_SQUARE_8f43" },
      }),
    ).toThrow(RedactorError);

    // A scalar stored under the literal key "rows2[]" must not match the
    // element rule "rows2[]".
    expect(() =>
      new Redactor(allowlist).redact({
        "rows2[]": "CANARY_SQUARE_9a54",
      }),
    ).toThrow(RedactorError);

    // The genuine array structure keeps working under the same allowlist.
    const ok = new Redactor(allowlist).redact({
      rows: [{ value: 1 }],
      rows2: ["x"],
    });
    expect(ok.shape).toEqual({ rows: [{ value: 1 }], rows2: ["x"] });
  });

  it("keeps the offending value out of the reserved-key error message", () => {
    const canary = "CANARY_MSG_LEAK_7e32";
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [{ path: "data.student.name", mode: "keep" }],
    };

    let thrown: unknown;
    try {
      new Redactor(allowlist).redact({ data: { "student.name": canary } });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RedactorError);
    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toMatch(/reserved path syntax/i);
    // Structure may appear; the value must not.
    expect(message).not.toContain(canary);
  });

  it("keeps ordinary nested object and array paths behaving exactly as before", () => {
    const allowlist: Allowlist = {
      version: "test-1",
      rules: [
        { path: "data.student.name", mode: "keep" },
        { path: "data.periods[].subject.name", mode: "type" },
        { path: "rows[].id", mode: "keep" },
      ],
    };

    const original = "CANARY_SUBJECT_4b18";
    const result = new Redactor(allowlist).redact({
      data: {
        student: { name: "ordinary" },
        periods: [
          { subject: { name: original } },
          { subject: { name: "CANARY_SUBJECT_5c29" } },
        ],
      },
      rows: [{ id: 1 }, { id: 2 }],
      other: "CANARY_OTHER_3a07",
    });

    expect(result.shape).toEqual({
      data: {
        periods: [
          { subject: { name: { __t: "string", __len: original.length } } },
          { subject: { name: { __t: "string", __len: "CANARY_SUBJECT_5c29".length } } },
        ],
        student: { name: "ordinary" },
      },
      rows: [{ id: 1 }, { id: 2 }],
    });
    expect(result.arrayLengths).toEqual({ "data.periods": 2, rows: 2 });
    expect(result.droppedPaths).toEqual(["other"]);
    const encoded = JSON.stringify(result);
    expect(encoded).not.toContain(original);
    expect(encoded).not.toContain("CANARY_SUBJECT_5c29");
    expect(encoded).not.toContain("CANARY_OTHER_3a07");
  });

  it("rejects malformed or ambiguous allowlist rule paths at construction", () => {
    const invalidPaths = [
      "data..name", // empty segment
      "data.", // trailing separator
      ".data", // leading separator
      "a.b[", // unterminated bracket
      "a[b]c", // stray brackets inside a segment
      "a.b[1]", // numeric indices are outside the grammar
      "a[]b", // text directly after the array token
      "m[][]n", // bare identifier after array tokens
      "a.[]", // array token in a member position
    ];

    for (const path of invalidPaths) {
      expect(
        () =>
          new Redactor({
            version: "test-1",
            rules: [{ path, mode: "keep" as const }],
          }),
        path,
      ).toThrow(RedactorError);
    }

    // Grammar-correct, unusual paths must keep being accepted.
    for (const path of ["rows[]", "rows[].value", "[].id", "m[][].n", "x y"]) {
      expect(
        () =>
          new Redactor({
            version: "test-1",
            rules: [{ path, mode: "keep" as const }],
          }),
        path,
      ).not.toThrow();
    }
  });

});