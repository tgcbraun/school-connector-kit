import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CliError, defaultIo, runCli, validateLogicalCall } from "../src/cli.js";

// All synthetic data below is deliberately fictional.

const CANARIES = {
  pupil: "PUPIL_CANARY_A1B2",
  teacher: "TEACHER_CANARY_C3D4",
  note: "MEMO_CANARY_E5F6",
  nested: "NESTED_CANARY_G7H8",
  token: "TOKEN_CANARY_I9J0",
  pins: [
    "ITEM_CANARY_PIN_1",
    "ITEM_CANARY_PIN_2",
    "ITEM_CANARY_PIN_3",
    "ITEM_CANARY_PIN_4",
    "ITEM_CANARY_PIN_5",
  ],
  term: "TERM_CANARY_K5L6",
} as const;

const SYNTHETIC_INPUT = {
  id: "EXAMPLE_ID_009",
  term: CANARIES.term,
  pupil: { displayName: CANARIES.pupil },
  teacher: { name: CANARIES.teacher },
  note: CANARIES.note,
  secret: { deep: CANARIES.nested },
  unlisted: { token: CANARIES.token },
  items: [
    { code: "ITEM_EXAMPLE_A", pin: CANARIES.pins[0] },
    { code: "ITEM_EXAMPLE_B", pin: CANARIES.pins[1] },
    { code: "ITEM_EXAMPLE_C", pin: CANARIES.pins[2] },
    { code: "ITEM_EXAMPLE_D", pin: CANARIES.pins[3] },
    { code: "ITEM_EXAMPLE_E", pin: CANARIES.pins[4] },
  ],
};

const SYNTHETIC_ALLOWLIST = {
  version: "test-1",
  rules: [
    { path: "id", mode: "keep" },
    { path: "term", mode: "type" },
    { path: "items[].code", mode: "keep" },
  ],
};

let dir: string;

function write(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

function baseArgs(overrides: Record<string, string> = {}): string[] {
  const flag = (key: string, fallback: string): string =>
    overrides[key] ?? fallback;

  const args = [
    "--input",
    flag("input", join(dir, "in.json")),
    "--allowlist",
    flag("allowlist", join(dir, "allowlist.json")),
    "--platform",
    flag("platform", "example"),
    "--captured-at",
    flag("captured-at", "2025-06-15T08:30:00Z"),
    "--method",
    flag("method", "GET"),
    "--url-template",
    flag("url-template", "/api/data?start={start}&end={end}"),
    "--status",
    flag("status", "200"),
    "--output",
    flag("output", join(dir, "out.json")),
  ];
  if (overrides["logical-call"] !== undefined) {
    // ADR-004: the flag is optional; appended only when an override supplies
    // it, so `baseArgs()` still describes the flag-absent run.
    args.push("--logical-call", overrides["logical-call"]);
  }
  if ("force" in overrides) {
    args.push("--force");
  }
  return args;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "capture-cli-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("capture CLI", () => {
  it("produces a capture from synthetic input and allowlist", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const result = runCli(baseArgs(), defaultIo);

    expect(result.code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
    expect(parsed.capture_format).toBe(1);
    expect(parsed.platform).toBe("example");
    expect(parsed.allowlist_version).toBe("test-1");
    expect(parsed.captured_at).toBe("2025-06-15T08:30:00Z");
    expect(parsed.requests).toHaveLength(1);
    const request = parsed.requests[0];
    expect(request.method).toBe("GET");
    expect(request.url_template).toBe(
      "/api/data?start={start}&end={end}",
    );
    expect(request.status).toBe(200);
  });

  it("matches the exact CaptureFile structure", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const result = runCli(baseArgs(), defaultIo);
    expect(result.code).toBe(0);

    const raw = readFileSync(join(dir, "out.json"), "utf8");
    const parsed = JSON.parse(raw);

    expect(Object.keys(parsed)).toEqual([
      "capture_format",
      "platform",
      "allowlist_version",
      "captured_at",
      "requests",
    ]);
    const request = parsed.requests[0];
    expect(Object.keys(request)).toEqual([
      "method",
      "url_template",
      "status",
      "shape",
      "dropped_paths",
      "array_lengths",
    ]);
    expect(request.shape).toEqual({
      id: "EXAMPLE_ID_009",
      items: [
        { code: "ITEM_EXAMPLE_A" },
        { code: "ITEM_EXAMPLE_B" },
        { code: "ITEM_EXAMPLE_C" },
      ],
      term: { __t: "string", __len: CANARIES.term.length },
    });
    expect(request.dropped_paths).toEqual([
      "items[].pin",
      "note",
      "pupil",
      "secret",
      "teacher",
      "unlisted",
    ]);
    expect(request.array_lengths).toEqual({ items: 5 });
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("keeps every non-allowlisted canary out of the entire serialized output", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const result = runCli(baseArgs(), defaultIo);
    expect(result.code).toBe(0);

    const raw = readFileSync(join(dir, "out.json"), "utf8");
    expect(raw).not.toContain(CANARIES.pupil);
    expect(raw).not.toContain(CANARIES.teacher);
    expect(raw).not.toContain(CANARIES.note);
    expect(raw).not.toContain(CANARIES.nested);
    expect(raw).not.toContain(CANARIES.token);
    for (const pin of CANARIES.pins) {
      expect(raw).not.toContain(pin);
    }
  });

  it("never leaks the original string of a type-tokenized value", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const result = runCli(baseArgs(), defaultIo);
    expect(result.code).toBe(0);

    const raw = readFileSync(join(dir, "out.json"), "utf8");
    expect(raw).not.toContain(CANARIES.term);
    expect(raw).toContain('"__t"');
    expect(raw).toContain(`"__len": ${CANARIES.term.length}`);
  });

  it("refuses malformed input JSON without echoing its contents", () => {
    const bad = `{"note": "${CANARIES.note}",,` ;
    write("in.json", bad);
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const result = runCli(baseArgs(), defaultIo);

    expect(result.code).toBe(1);
    expect(result.message).toBe("the --input file is not valid JSON");
  });

  it("refuses malformed allowlist JSON without echoing its contents", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", `{"version": "${"X".repeat(1)}",,`);

    const result = runCli(baseArgs(), defaultIo);

    expect(result.code).toBe(1);
    expect(result.message).toBe(
      "the --allowlist file is not valid JSON",
    );
  });

  it("refuses an unknown allowlist mode", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify({
      version: "test-1",
      rules: [{ path: "id", mode: "mask" }],
    }));

    const result = runCli(baseArgs(), defaultIo);

    expect(result.code).toBe(1);
    expect(result.message).toContain("mode");
  });

  it("refuses malformed allowlist rule paths", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify({
      version: "test-1",
      rules: [{ path: "a..b", mode: "keep" }],
    }));

    const result = runCli(baseArgs(), defaultIo);

    expect(result.code).toBe(1);
    expect(result.message).toContain("a..b");
  });

  it("refuses an allowlist whose rules are not an array", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify({
      version: "test-1",
      rules: { path: "id", mode: "keep" },
    }));

    const result = runCli(baseArgs(), defaultIo);

    expect(result.code).toBe(1);
    expect(result.message).toContain('"rules" must be an array');
  });

  it("refuses an empty allowlist version", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify({
      version: "",
      rules: [{ path: "id", mode: "keep" }],
    }));

    const result = runCli(baseArgs(), defaultIo);

    expect(result.code).toBe(1);
    expect(result.message).toContain('"version"');
  });

  it("refuses unknown allowlist keys", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify({
      version: "test-1",
      rules: [{ path: "id", mode: "keep" }],
      extra: "nope",
    }));

    const result = runCli(baseArgs(), defaultIo);

    expect(result.code).toBe(1);
    expect(result.message).toContain('exactly the keys "version" and "rules"');
  });

  it("refuses absolute URLs and never echoes them", () => {
    const rawUrl = "https://tenant-7.school-canary.example/api?student=123456";
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const result = runCli(
      baseArgs({ "url-template": rawUrl }),
      defaultIo,
    );

    expect(result.code).toBe(1);
    expect(result.message).not.toContain("tenant-7");
    expect(result.message).not.toContain("school-canary.example");
    expect(result.message).not.toContain("123456");
  });

  it("refuses unsafe raw query values without echoing them", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const result = runCli(
      baseArgs({ "url-template": "/api/data?student=123456" }),
      defaultIo,
    );

    expect(result.code).toBe(1);
    expect(result.message).not.toContain("123456");
  });

  it("accepts safe templated query values and records them exactly", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));
    const template = "/api/schools/{school}/periods/{term}/items?from={start}&to={end}";

    const result = runCli(baseArgs({ "url-template": template }), defaultIo);

    expect(result.code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
    expect(parsed.requests[0].url_template).toBe(template);
  });

  it("accepts digit-and-dot version path segments", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));
    const template =
      "/api/1.0/current-timetable?date={date}&week=true&substitutions=false";

    const result = runCli(baseArgs({ "url-template": template }), defaultIo);

    expect(result.code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
    expect(parsed.requests[0].url_template).toBe(template);
  });

  it("still rejects raw query values after the version-segment relaxation", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const result = runCli(
      baseArgs({ "url-template": "/api/1.0/day?day=2026-08-30" }),
      defaultIo,
    );

    expect(result.code).toBe(1);
    expect(result.message).not.toContain("2026-08-30");
  });

  it("still rejects path segments mixing digits and letters (e.g. 1.0x)", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const result = runCli(
      baseArgs({ "url-template": "/api/1.0x/current-timetable?date={date}" }),
      defaultIo,
    );

    expect(result.code).toBe(1);
    expect(result.message).not.toContain("1.0x");
  });

  it("accepts a single trailing slash before the query", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));
    const template =
      "/api/1.0/current-timetable/?date={date}&week=true&substitutions=false";

    const result = runCli(baseArgs({ "url-template": template }), defaultIo);

    expect(result.code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
    expect(parsed.requests[0].url_template).toBe(template);
  });

  it("accepts a single trailing slash with no query", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));
    const template = "/api/1.0/data/";

    const result = runCli(baseArgs({ "url-template": template }), defaultIo);

    expect(result.code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
    expect(parsed.requests[0].url_template).toBe(template);
  });

  it("still rejects interior empty segments (double slashes)", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const result = runCli(
      baseArgs({ "url-template": "/api//data/1.0/x?from={f}" }),
      defaultIo,
    );

    expect(result.code).toBe(1);
    expect(result.message).not.toContain("//");
  });

  it("rejects invalid captured-at timestamps", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    for (const capturedAt of [
      "2025-13-01T00:00:00Z",
      "2025-06-15T08:30:00+02:00",
      "2025-06-15 08:30:00Z",
      "yesterday",
    ]) {
      const result = runCli(
        baseArgs({ "captured-at": capturedAt }),
        defaultIo,
      );
      expect(result.code, capturedAt).toBe(1);
      expect(result.message).toContain("captured_at");
    }
  });

  it("rejects invalid HTTP statuses", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    for (const status of ["99", "600", "0200", "20.5", "abc"]) {
      const result = runCli(baseArgs({ status }), defaultIo);
      expect(result.code, status).toBe(1);
      expect(result.message).toContain("HTTP status");
    }
  });

  it("rejects unsupported or empty methods, but normalizes case", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    for (const method of ["FETCH", "", "get post"]) {
      const result = runCli(baseArgs({ method }), defaultIo);
      expect(result.code, JSON.stringify(method)).toBe(1);
    }

    const lower = runCli(baseArgs({ method: "get" }), defaultIo);
    expect(lower.code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
    expect(parsed.requests[0].method).toBe("GET");
  });

  it("refuses to overwrite an existing output file by default", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));
    const out = join(dir, "out.json");
    writeFileSync(
      out,
      JSON.stringify({ capture_format: 0, prior: "PRIOR_CONTENT" }),
      "utf8",
    );
    const prior = readFileSync(out, "utf8");

    const result = runCli(baseArgs({ output: out }), defaultIo);

    expect(result.code).toBe(1);
    expect(result.message).toContain("--force");
    expect(readFileSync(out, "utf8")).toBe(prior);
  });

  it("overwrites explicitly and safely with --force", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));
    const out = join(dir, "out.json");
    writeFileSync(out, "PRIOR_CONTENT", "utf8");

    const result = runCli(baseArgs({ output: out, force: "true" }), defaultIo);

    expect(result.code).toBe(0);
    const content = readFileSync(out, "utf8");
    expect(content).not.toContain("PRIOR_CONTENT");
    expect(JSON.parse(content).capture_format).toBe(1);
  });

  it("refuses to write through a symlinked output path, even with --force", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));
    const target = join(dir, "outside-target.json");
    writeFileSync(target, "TARGET_CONTENT", "utf8");
    const link = join(dir, "link.json");
    symlinkSync(target, link);

    const plain = runCli(baseArgs({ output: link }), defaultIo);
    expect(plain.code).toBe(1);
    expect(plain.message).toContain("symlink");

    const forced = runCli(
      baseArgs({ output: link, force: "true" }),
      defaultIo,
    );
    expect(forced.code).toBe(1);
    expect(readFileSync(target, "utf8")).toBe("TARGET_CONTENT");
  });

  it("produces byte-identical output across repeated runs", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const first = runCli(baseArgs({ output: join(dir, "first.json") }), defaultIo);
    expect(first.code).toBe(0);
    const second = runCli(
      baseArgs({ output: join(dir, "second.json") }),
      defaultIo,
    );
    expect(second.code).toBe(0);

    expect(
      readFileSync(join(dir, "second.json"), "utf8"),
    ).toBe(readFileSync(join(dir, "first.json"), "utf8"));
  });

  it("is unaffected by input key order or rule order", () => {
    const shuffledInput = {
      note: SYNTHETIC_INPUT.note,
      items: SYNTHETIC_INPUT.items,
      id: SYNTHETIC_INPUT.id,
      term: SYNTHETIC_INPUT.term,
      unlisted: SYNTHETIC_INPUT.unlisted,
      teacher: SYNTHETIC_INPUT.teacher,
      secret: SYNTHETIC_INPUT.secret,
      pupil: SYNTHETIC_INPUT.pupil,
    };
    const shuffledAllowlist = {
      rules: [
        { path: "items[].code", mode: "keep" },
        { path: "id", mode: "keep" },
        { path: "term", mode: "type" },
      ],
      version: "test-1",
    };

    write("in.json", JSON.stringify(shuffledInput));
    write("allowlist.json", JSON.stringify(shuffledAllowlist));

    const shuffled = runCli(
      baseArgs({ output: join(dir, "shuffled.json") }),
      defaultIo,
    );
    expect(shuffled.code).toBe(0);

    const canonical = runCli(
      baseArgs({
        input: write("in2.json", JSON.stringify(SYNTHETIC_INPUT)),
        allowlist: write(
          "allowlist2.json",
          JSON.stringify(SYNTHETIC_ALLOWLIST),
        ),
        output: join(dir, "canonical.json"),
      }),
      defaultIo,
    );
    expect(canonical.code).toBe(0);

    expect(
      readFileSync(join(dir, "shuffled.json"), "utf8"),
    ).toBe(readFileSync(join(dir, "canonical.json"), "utf8"));
  });

  it("lets array elements after the third contribute nothing to the capture", () => {
    const variantA: Record<string, unknown> = { ...SYNTHETIC_INPUT };
    variantA.items = [
      { code: "ITEM_EXAMPLE_A", pin: "PIN_A_1" },
      { code: "ITEM_EXAMPLE_B", pin: "PIN_A_2" },
      { code: "ITEM_EXAMPLE_C", pin: "PIN_A_3" },
      { code: "LATE_CANARY_A_7", pin: "LATE_CANARY_A_8" },
      { code: "LATE_CANARY_A_9", pin: "LATE_CANARY_A_10" },
    ];
    const variantB: Record<string, unknown> = { ...SYNTHETIC_INPUT };
    variantB.items = [
      { code: "ITEM_EXAMPLE_A", pin: "PIN_B_1" },
      { code: "ITEM_EXAMPLE_B", pin: "PIN_B_2" },
      { code: "ITEM_EXAMPLE_C", pin: "PIN_B_3" },
      { code: "TOTALLY_DIFFERENT_X", pin: "TOTALLY_DIFFERENT_Y" },
      { code: "ANOTHER_DIFFERENT_Z", pin: "STILL_DIFFERENT_W" },
    ];

    write("a.json", JSON.stringify(variantA));
    write("b.json", JSON.stringify(variantB));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const resA = runCli(baseArgs({ input: join(dir, "a.json"), output: join(dir, "outA.json") }), defaultIo);
    expect(resA.code).toBe(0);
    const resB = runCli(baseArgs({ input: join(dir, "b.json"), output: join(dir, "outB.json") }), defaultIo);
    expect(resB.code).toBe(0);

    expect(
      readFileSync(join(dir, "outB.json"), "utf8"),
    ).toBe(readFileSync(join(dir, "outA.json"), "utf8"));
    const raw = readFileSync(join(dir, "outA.json"), "utf8");
    expect(raw).not.toContain("LATE_CANARY_A_7");
    expect(raw).not.toContain("TOTALLY_DIFFERENT_X");
  });

  it("keeps enforcing reserved-key fail-closed protection", () => {
    const input = {
      data: { "student.name": "RESERVED_KEY_CANARY_Z1" },
    };
    write("in.json", JSON.stringify(input));
    write("allowlist.json", JSON.stringify({
      version: "test-1",
      rules: [{ path: "data.student.name", mode: "keep" }],
    }));

    const result = runCli(baseArgs(), defaultIo);

    expect(result.code).toBe(1);
    expect(result.message).toContain("reserved path syntax");
    expect(result.message).not.toContain("RESERVED_KEY_CANARY_Z1");
  });

  it("never embeds local filesystem paths in the output", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));
    const out = join(dir, "out.json");

    const result = runCli(baseArgs({ output: out }), defaultIo);
    expect(result.code).toBe(0);

    const raw = readFileSync(out, "utf8");
    const scratchBase = dir.split("capture-cli-")[1];
    expect(scratchBase).toBeTruthy();
    expect(raw).not.toContain(scratchBase);
    expect(raw).not.toContain(dir);
  });

  it("denies unusual but legitimate object keys deterministically", () => {
    const input = {
      "élève 1": "UNICODE_KEY_VALUE_V1",
      id: "EXAMPLE_ID_009",
    };
    write("in.json", JSON.stringify(input));
    write("allowlist.json", JSON.stringify({
      version: "test-1",
      rules: [{ path: "id", mode: "keep" }],
    }));

    const first = runCli(baseArgs({ output: join(dir, "f.json") }), defaultIo);
    expect(first.code).toBe(0);
    const second = runCli(baseArgs({ output: join(dir, "s.json") }), defaultIo);
    expect(second.code).toBe(0);

    expect(
      readFileSync(join(dir, "s.json"), "utf8"),
    ).toBe(readFileSync(join(dir, "f.json"), "utf8"));
    const raw = readFileSync(join(dir, "f.json"), "utf8");
    expect(raw).not.toContain("UNICODE_KEY_VALUE_V1");
    expect(raw).toContain("élève 1");
  });

  it("rejects missing, unknown, duplicate, or valueless flags", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const missing = runCli(
      ["--input", join(dir, "in.json")],
      defaultIo,
    );
    expect(missing.code).toBe(1);
    expect(missing.message).toContain("missing required option");

    const unknown = runCli(
      [...baseArgs().slice(0, 2), "--bogus", "x", ...baseArgs().slice(2)],
      defaultIo,
    );
    expect(unknown.code).toBe(1);
    expect(unknown.message).toContain("--bogus");

    const duplicate = runCli(
      [...baseArgs(), "--platform", "example"],
      defaultIo,
    );
    expect(duplicate.code).toBe(1);
    expect(duplicate.message).toContain("duplicate option");

    const duplicateInput = runCli(
      [...baseArgs(), "--input", join(dir, "in.json")],
      defaultIo,
    );
    expect(duplicateInput.code).toBe(1);
    expect(duplicateInput.message).toContain("duplicate option --input");

    const valueless = runCli(
      [...baseArgs().slice(0, -1), "--output"],
      defaultIo,
    );
    expect(valueless.code).toBe(1);
    expect(valueless.message).toContain("requires a value");
  });

  it("rejects empty flag values", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const result = runCli(baseArgs({ platform: "" }), defaultIo);

    expect(result.code).toBe(1);
    expect(result.message).toContain("--platform");
  });

  it("fails closed on an empty allowlist rule set (nothing survives)", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify({ version: "empty-1", rules: [] }));

    const result = runCli(baseArgs(), defaultIo);
    expect(result.code).toBe(0);

    const content = readFileSync(join(dir, "out.json"), "utf8");
    expect(content).not.toContain("EXAMPLE_ID_009");
    const parsed = JSON.parse(content);
    expect(parsed.requests[0].shape).toEqual({});
    expect(parsed.requests[0].dropped_paths).toEqual([]);
    expect(parsed.requests[0].array_lengths).toEqual({});
  });

  it("refuses to write into an output path that is a directory", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));
    const outDirPath = join(dir, "outdir");
    mkdirSync(outDirPath);

    const result = runCli(baseArgs({ output: outDirPath }), defaultIo);

    expect(result.code).toBe(1);
    expect(result.message).toContain("not a regular file");
  });

  it("accepts a bare -- end-of-options separator (npm/pnpm passthrough)", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    const result = runCli(["--", ...baseArgs()], defaultIo);

    expect(result.code).toBe(0);
    expect(readFileSync(join(dir, "out.json"), "utf8")).toContain(
      "capture_format",
    );
  });

  it("resolves relative flag paths against the caller's cwd (INIT_CWD)", () => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));

    // Simulates the pnpm-script situation: the CLI process's cwd is the
    // package directory (no such files there), but the caller's cwd —
    // exposed as INIT_CWD — holds the files. Relative flag values must
    // therefore resolve against INIT_CWD, not process.cwd().
    const previous = process.env.INIT_CWD;
    try {
      process.env.INIT_CWD = dir;
      const result = runCli(
        baseArgs({ input: "in.json", allowlist: "allowlist.json", output: "out.json" }),
        defaultIo,
      );
      expect(result).toEqual({ code: 0, message: "capture written" });
      expect(readFileSync(join(dir, "out.json"), "utf8")).toContain(
        "capture_format",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.INIT_CWD;
      } else {
        process.env.INIT_CWD = previous;
      }
    }
  });
});

describe("logical-call flag (ADR-004)", () => {
  beforeEach(() => {
    write("in.json", JSON.stringify(SYNTHETIC_INPUT));
    write("allowlist.json", JSON.stringify(SYNTHETIC_ALLOWLIST));
  });

  function parseOutput() {
    return JSON.parse(readFileSync(join(dir, "out.json"), "utf8")) as {
      requests: Array<Record<string, unknown>>;
    };
  }

  it("omits logical_call from the output when the flag is not supplied", () => {
    const result = runCli(baseArgs(), defaultIo);

    expect(result.code).toBe(0);
    expect(parseOutput().requests[0]!).not.toHaveProperty("logical_call");
  });

  it("carries a valid logical call through, immediately after status", () => {
    const result = runCli(
      baseArgs({ "logical-call": "get-letters" }),
      defaultIo,
    );

    expect(result.code).toBe(0);
    expect(parseOutput().requests[0]!.logical_call).toBe("get-letters");
    expect(Object.keys(parseOutput().requests[0]!)).toEqual([
      "method",
      "url_template",
      "status",
      "logical_call",
      "shape",
      "dropped_paths",
      "array_lengths",
    ]);
  });

  it.each([
    ["digit-led", "9letters"],
    ["containing a dot", "get.letters"],
    ["containing a space", "get letters"],
    ["containing a slash", "get/letters"],
  ])("rejects a %s logical call", (_label, value) => {
    const result = runCli(baseArgs({ "logical-call": value }), defaultIo);

    expect(result.code).toBe(1);
    expect(result.message).toBe(
      "must be a logical-call identifier: a letter-led name of letters, " +
        "digits, hyphens, or underscores — no whitespace, no dots, no slashes",
    );
    expect(result.message).not.toContain(value);
  });

  it("rejects a duplicate --logical-call flag", () => {
    const result = runCli(
      [
        ...baseArgs(),
        "--logical-call",
        "get-letters",
        "--logical-call",
        "letter-detail",
      ],
      defaultIo,
    );

    expect(result.code).toBe(1);
    expect(result.message).toBe("duplicate option --logical-call");
  });

  it("never echoes a rejected logical call in the error message", () => {
    const secret = "SECRET.label_9x";
    const result = runCli(
      baseArgs({ "logical-call": secret }),
      defaultIo,
    );

    expect(result.code).toBe(1);
    expect(result.message).not.toContain(secret);
  });

  it("rejects the empty flag value at the parse layer with a fixed message", () => {
    const result = runCli(
      [...baseArgs(), "--logical-call", ""],
      defaultIo,
    );

    expect(result.code).toBe(1);
    expect(result.message).toBe("option --logical-call requires a value");
  });

  it("rejects the empty string at the grammar level with code LOGICAL_CALL", () => {
    let error: unknown = null;
    try {
      validateLogicalCall("");
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe("LOGICAL_CALL");
    expect((error as CliError).message).toBe(
      "must be a logical-call identifier: a letter-led name of letters, " +
        "digits, hyphens, or underscores — no whitespace, no dots, no slashes",
    );
  });
});

describe("logical-call flag on the html path", () => {
  // Synthetic html-path fixtures, deliberately fictional and distinct from
  // the html-cli suite's canaries.
  const SYNTHETIC_PAGE = `<!DOCTYPE html>
<html>
<head><title>HTML_LC_PAGE_TITLE</title></head>
<body>
<table class="c-table">
<tr data-uid="u1"><td>HTML_LC_CELL_ONE</td></tr>
<tr data-uid="u2"><td>HTML_LC_CELL_TWO</td></tr>
</table>
</body>
</html>
`;

  const SYNTHETIC_HTML_ALLOWLIST = {
    version: "html-lc-test-1",
    selectors: [{ kind: "table", classes: ["c-table"], row_attribute: "data-uid" }],
  };

  function htmlArgs(): string[] {
    return [
      "html",
      "--input",
      join(dir, "page.html"),
      "--allowlist",
      join(dir, "allowlist.json"),
      "--platform",
      "kikom",
      "--captured-at",
      "2025-06-15T08:30:00Z",
      "--method",
      "GET",
      "--url-template",
      "/api/v1/list/{token}",
      "--status",
      "200",
      "--output",
      join(dir, "out.json"),
    ];
  }

  beforeEach(() => {
    write("page.html", SYNTHETIC_PAGE);
    write("allowlist.json", JSON.stringify(SYNTHETIC_HTML_ALLOWLIST));
  });

  it("rejects --logical-call with the fixed ARGUMENTS-style message", () => {
    const result = runCli(
      [...htmlArgs(), "--logical-call", "get-letters"],
      defaultIo,
    );

    expect(result.code).toBe(1);
    expect(result.message).toBe(
      "option --logical-call is not supported on the html path",
    );
  });

  it("never echoes a rejected --logical-call value on the html path", () => {
    const secret = "SECRET.html_cell_8";
    const result = runCli(
      [...htmlArgs(), "--logical-call", secret],
      defaultIo,
    );

    expect(result.code).toBe(1);
    expect(result.message).not.toContain(secret);
    expect(result.message).toBe(
      "option --logical-call is not supported on the html path",
    );
  });

  it("succeeds unchanged on the html path when the flag is not supplied", () => {
    const result = runCli(htmlArgs(), defaultIo);

    expect(result.code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "out.json"), "utf8")) as {
      capture_format: number;
      requests: Array<Record<string, unknown>>;
    };
    expect(parsed.capture_format).toBe(2);
    expect(parsed.requests[0]!).not.toHaveProperty("logical_call");
  });
});
