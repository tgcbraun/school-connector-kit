import { describe, expect, it } from "vitest";
import {
  CAPTURE_FORMAT,
  HTML_CAPTURE_FORMAT,
  CaptureValidationError,
  HtmlCaptureFile,
  type HtmlCaptureFileInput,
} from "../src/capture-file.js";
import type {
  HtmlPaginationCapture,
  HtmlTableCapture,
} from "../src/html-capture.js";

/**
 * A hand-built canonical document (insertion order deliberately scrambled
 * relative to the canonical key order) used for the byte-exact assertion.
 */
function sampleTable(reversedKeyMaps: boolean): HtmlTableCapture {
  const rowAttributes = reversedKeyMaps
    ? { "zz-last": 1, "aa-first": 2 }
    : { "aa-first": 2, "zz-last": 1 };
  const queryParameters = reversedKeyMaps
    ? { cHash: 3, "tx_pi[client]": 1 }
    : { "tx_pi[client]": 1, cHash: 3 };
  return {
    selector: { kind: "table", classes: ["c-table"] },
    classes: ["c-table"],
    row_count: 5,
    rows_inspected: 3,
    column_count: 2,
    uniform: true,
    columns: [
      {
        content_class: "text",
        text_length: { min: 6, max: 8 },
        links: { present: 0, whole_cell: 0, child: 0 },
      },
      {
        links: { present: 3, whole_cell: 3, child: 0 },
        content_class: "link",
        text_length: { min: 10, max: 12 },
      },
    ],
    row_attributes: rowAttributes,
    query_parameters: queryParameters,
  };
}

function samplePagination(): HtmlPaginationCapture {
  return {
    selector: { kind: "pagination", classes: ["c-pagination"] },
    present: true,
    classes: ["c-pagination"],
    next_link_present: true,
  };
}

function sampleInput(unparsed: number): HtmlCaptureFileInput {
  // Scrambled insertion order: the envelope must emit the canonical order.
  return {
    capturedAt: "2025-06-15T08:30:00Z",
    allowlistVersion: "synthetic-2025-06-15",
    platform: "kikom",
    requests: [
      {
        urlTemplate: "/api/v1/school/{schoolCode}",
        status: 200,
        method: "GET",
        unparsed,
        pagination: [samplePagination()],
        tables: [sampleTable(true)],
      },
    ],
  };
}

const CANONICAL_UNPARSED = JSON.stringify(
  {
    capture_format: 2,
    platform: "kikom",
    allowlist_version: "synthetic-2025-06-15",
    captured_at: "2025-06-15T08:30:00Z",
    requests: [
      {
        method: "GET",
        url_template: "/api/v1/school/{schoolCode}",
        status: 200,
        tables: [
          {
            selector: { kind: "table", classes: ["c-table"] },
            classes: ["c-table"],
            row_count: 5,
            rows_inspected: 3,
            column_count: 2,
            uniform: true,
            columns: [
              {
                content_class: "text",
                text_length: { min: 6, max: 8 },
                links: { present: 0, whole_cell: 0, child: 0 },
              },
              {
                content_class: "link",
                text_length: { min: 10, max: 12 },
                links: { present: 3, whole_cell: 3, child: 0 },
              },
            ],
            row_attributes: { "aa-first": 2, "zz-last": 1 },
            query_parameters: { cHash: 3, "tx_pi[client]": 1 },
          },
        ],
        pagination: [
          {
            selector: { kind: "pagination", classes: ["c-pagination"] },
            present: true,
            classes: ["c-pagination"],
            next_link_present: true,
          },
        ],
        unparsed: 3,
      },
    ],
  },
  null,
  2,
);

describe("HtmlCaptureFile (capture_format 2)", () => {
  it("declares format 2 as a sibling of format 1", () => {
    expect(CAPTURE_FORMAT).toBe(1);
    expect(HTML_CAPTURE_FORMAT).toBe(2);
  });

  it("serializes in canonical key order regardless of input insertion order", () => {
    const file = HtmlCaptureFile.create(sampleInput(3));
    expect(file.toJson(2)).toBe(CANONICAL_UNPARSED);
  });

  it("omits the unparsed key when it is zero", () => {
    const file = HtmlCaptureFile.create(sampleInput(0));
    const json = file.toJson(2);
    expect(json).not.toContain("unparsed");
    const roundTripped = JSON.parse(json) as {
      requests: Array<Record<string, unknown>>;
    };
    expect(roundTripped.requests[0]?.unparsed).toBeUndefined();
    expect(roundTripped.requests[0]?.tables).toBeDefined();
  });

  it("re-sorts string-key maps to code point order at serialization time", () => {
    const ordered = HtmlCaptureFile.create(sampleInput(1)).toJson();
    const reversedInput = HtmlCaptureFile.create(
      {
        ...sampleInput(1),
        requests: sampleInput(1).requests.map((request) => ({
          ...request,
          tables: request.tables.map((table) => ({
            ...table,
            row_attributes: { "zz-last": 1, "aa-first": 2 },
            query_parameters: { cHash: 3, "tx_pi[client]": 1 },
          })),
        })),
      },
    ).toJson();
    expect(ordered).toBe(reversedInput);
  });

  it("produces byte-identical output across repeated serializations", () => {
    const a = HtmlCaptureFile.create(sampleInput(3)).toJson();
    const b = HtmlCaptureFile.create(sampleInput(3)).toJson(2);
    expect(JSON.parse(a)).toEqual(JSON.parse(b));
    expect(HtmlCaptureFile.create(sampleInput(3)).toJson(2)).toBe(
      CANONICAL_UNPARSED,
    );
  });

  it("rejects an invalid captured_at (offset timestamp)", () => {
    const input = sampleInput(0);
    input.capturedAt = "2025-06-15T08:30:00+02:00";
    expect(() => HtmlCaptureFile.create(input)).toThrowError(
      CaptureValidationError,
    );
  });

  it("rejects unknown keys at the request, input, and selector levels", () => {
    const base = sampleInput(0);
    const rebuilt: HtmlCaptureFileInput = {
      ...base,
      requests: base.requests.map((request, index) =>
        index === 0 ? { ...request, stray: true } : request,
      ),
    };
    expect(() => HtmlCaptureFile.create(rebuilt)).toThrowError(
      CaptureValidationError,
    );

    const withExtraInputKey: Record<string, unknown> = {
      ...sampleInput(0),
      mode: "keep",
    };
    expect(() =>
      HtmlCaptureFile.create(withExtraInputKey as unknown as HtmlCaptureFileInput),
    ).toThrowError(CaptureValidationError);

    const tableWithBadSelector = {
      ...sampleTable(false),
      selector: { kind: "table", classes: ["c-table"], extra: 1 },
    } as unknown as HtmlTableCapture;
    const payload = sampleInput(0);
    payload.requests = payload.requests.map((request) => ({
      ...request,
      tables: [tableWithBadSelector],
    }));
    expect(() => HtmlCaptureFile.create(payload)).toThrowError(
      CaptureValidationError,
    );
  });

  it("rejects structural garbage in the payload (statuses, counts, classes, unparsed)", () => {
    const makeTable = (): Record<string, unknown> =>
      JSON.parse(JSON.stringify(sampleTable(false)));

    const expectRejected = (request: Record<string, unknown>): void => {
      const input: Record<string, unknown> = {
        platform: "kikom",
        allowlistVersion: "synthetic-2025-06-15",
        capturedAt: "2025-06-15T08:30:00Z",
        requests: [request],
      };
      expect(() =>
        HtmlCaptureFile.create(input as unknown as HtmlCaptureFileInput),
      ).toThrowError(CaptureValidationError);
    };

    const baseRequest = (table: Record<string, unknown>): Record<string, unknown> => ({
      method: "GET",
      urlTemplate: "/x",
      status: 200,
      tables: [table],
      pagination: [],
      unparsed: 0,
    });

    expectRejected({
      method: "GET",
      urlTemplate: "/x",
      status: 99,
      tables: [],
      pagination: [],
      unparsed: 0,
    });
    expectRejected({
      method: "GET",
      urlTemplate: "/x",
      status: 200,
      tables: [makeTable()],
      pagination: [],
      unparsed: -1,
    });

    {
      const table = makeTable();
      table.row_count = -3;
      expectRejected(baseRequest(table));
    }
    {
      const table = makeTable();
      table.uniform = "yes";
      expectRejected(baseRequest(table));
    }
    {
      const table = makeTable();
      table.classes = ["ok", 42];
      expectRejected(baseRequest(table));
    }
  });
});
