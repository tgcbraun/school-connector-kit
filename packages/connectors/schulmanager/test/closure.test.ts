/**
 * Entry-closure rule for the Schulmanager connector (ADR-003, decision 9).
 *
 * RULE: nothing reachable from the package entry point may use Node
 * built-ins or DOM globals, because that closure is what a React Native or
 * Flutter-hosted bundle loads. Build-time modules are out of scope by being
 * unreachable, not by being named: there is no exclusion list, and none
 * should be able to drift.
 *
 * The scan starts at packages/connectors/schulmanager/src/index.ts and follows
 * its transitive import closure: import/export-from specifiers that are
 * relative are followed, with "./x.js" resolving to the sibling "./x.ts"
 * source file; bare specifiers (e.g. "@school-connector-kit/core") are not
 * followed; node_modules is never descended; each file is visited exactly
 * once. A global *reference* means a bare expression use (window.innerWidth,
 * process.env); a declared property name ("readonly window?: FetchWindow"),
 * an object key, or a member access ("request.window") is not a reference —
 * the contract itself mandates a field named "window" on FetchRequest. The
 * identifier check runs over code with comments and string contents blanked
 * (offset preserving), so prose and values cannot read as identifiers; the
 * "node:" check looks at string literals in an import / export-from /
 * require context.
 *
 * The scanner and its 11 control cases are a deliberate DUPLICATE of the
 * ones in packages/core/test/connector-contract.test.ts (per the package
 * brief): each connector package carries its own copy, rooted at its own
 * entry point, so the rule cannot be weakened by editing one shared file.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FORBIDDEN_NAMES = [
  "window",
  "document",
  "localStorage",
  "navigator",
  "Buffer",
  "process",
  "__dirname",
  "__filename",
];

interface CoreViolation {
  kind: "import_specifier" | "identifier_reference";
  token: string;
  line: number;
}

/**
 * Blank out comments and string literal contents (offset-preserving:
 * newlines survive, everything else becomes a space) so the identifier
 * check sees code only. Keep, separately, each string literal with the code
 * that immediately precedes it, for the import-context check.
 */
function blankLiterals(
  src: string,
): {
  code: string;
  literals: { start: number; value: string; before: string }[];
} {
  const chars = Array.from(src);
  const codespace = [...chars];
  const literals: { start: number; value: string; before: string }[] = [];
  let i = 0;
  const n = chars.length;

  while (i < n) {
    const c = chars[i]!;
    const two = chars.slice(i, i + 2).join("");
    if (two === "//") {
      while (i < n && chars[i] !== "\n") {
        codespace[i] = " ";
        i += 1;
      }
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && chars.slice(i, i + 2).join("") !== "*/") {
        if (chars[i] !== "\n") codespace[i] = " ";
        i += 1;
      }
      if (i < n) {
        codespace[i] = " ";
        codespace[i + 1] = " ";
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const start = i;
      const quote = c;
      let value = "";
      i += 1;
      while (i < n && chars[i] !== quote) {
        value += chars[i]!;
        if (chars[i] !== "\n") codespace[i] = " ";
        i += 1;
      }
      if (i < n) {
        codespace[i] = " ";
        i += 1;
      }
      const before = codespace.slice(start - 60, start).join("");
      literals.push({ start, value, before });
      continue;
    }
    i += 1;
  }
  return { code: codespace.join(""), literals };
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function isImporterContext(before: string): boolean {
  return (
    /(^|[^\w$])from\s*$/.test(before) ||
    /(^|[^\w$])import\s*$/.test(before) ||
    /(^|[^\w$])require\s*\(\s*$/.test(before)
  );
}

/** The two checks the rule cares about, applied to one source file's text. */
function scanSource(src: string): CoreViolation[] {
  const violations: CoreViolation[] = [];
  const { code, literals } = blankLiterals(src);

  for (const lit of literals) {
    if (lit.value.startsWith("node:") && isImporterContext(lit.before)) {
      violations.push({
        kind: "import_specifier",
        token: lit.value,
        line: lineAt(src, lit.start),
      });
    }
  }

  for (const name of FORBIDDEN_NAMES) {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}_$])${name}(?![\\p{L}\\p{N}_$])`,
      "gu",
    );
    for (const m of code.matchAll(re)) {
      if (!m.index) continue;
      // A *reference to the runtime global*, not the mere presence of a
      // token: member access ("request.window") and a declared property/key
      // name ("readonly window?: …", an object key "window: …") are exempt.
      // A bare expression use ("window.innerWidth", "document.cookie",
      // "process.env") is what the rule exists to catch.
      let pi = m.index - 1;
      while (pi >= 0 && /\s/.test(code.charAt(pi))) pi -= 1;
      if (pi >= 0 && code.charAt(pi) === ".") continue; // member access
      let fi = m.index + name.length;
      while (fi < code.length && /\s/.test(code.charAt(fi))) fi += 1;
      if (code.charAt(fi) === ":" || code.charAt(fi) === "?")
        continue; // property/key name
      violations.push({
        kind: "identifier_reference",
        token: name,
        line: lineAt(src, m.index),
      });
      break; // one occurrence per name per file is enough to fail the scan
    }
  }

  return violations;
}

describe("scanner controls (kept positive/negative cases)", () => {
  const cases: { label: string; src: string; expected: string[] }[] = [
    { label: "banned: window.innerWidth", src: `const x = window.innerWidth;`, expected: ["identifier_reference:window"] },
    { label: "allowed: readonly window?: property", src: `readonly window?: FetchWindow;`, expected: [] },
    { label: "allowed: window:", src: `const o = { window: 1 };`, expected: [] },
    { label: "allowed: member access request.window", src: `const o = { w: request.window };`, expected: [] },
    { label: "banned: document.cookie", src: `const d = document.cookie;`, expected: ["identifier_reference:document"] },
    { label: "banned: process.env", src: `const e = process.env.FOO;`, expected: ["identifier_reference:process"] },
    { label: "banned: node:module import", src: `import { createRequire } from "node:module";`, expected: ["import_specifier:node:module"] },
    { label: "banned: node:fs require", src: `const r = require("node:fs");`, expected: ["import_specifier:node:fs"] },
    { label: "allowed: bare zod import", src: `import { z } from "zod";`, expected: [] },
    { label: "allowed: forbidden words in a comment", src: `// forbidden window document process in comments`, expected: [] },
    { label: "allowed: forbidden words in a string value", src: `const s = "window document";`, expected: [] },
  ];

  it.each(cases.map((c) => [c.label, c.src, c.expected]))(
    '%# "%s"',
    (_label, src, expected) => {
      const got = scanSource(src)
        .map((v) => `${v.kind}:${v.token}`)
        .sort();
      expect(got).toEqual(expected);
    },
  );
});

// ---------------------------------------------------------------------------
// The rule: the transitive import closure from the package entry point
// ---------------------------------------------------------------------------

describe("entry-point closure scan (ADR-003 decision 9)", () => {
  const srcRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
  );

  interface ClosureFile {
    rel: string;
    via: string;
  }
  interface Violation extends CoreViolation {
    file: string;
    via: string;
  }

  function buildClosure(entryAbs: string): { files: Map<string, ClosureFile>; problems: Violation[] } {
    const files = new Map<string, ClosureFile>();
    const problems: Violation[] = [];
    const queue: { abs: string; via: string }[] = [{ abs: entryAbs, via: "" }];

    while (queue.length > 0) {
      const { abs, via } = queue.shift()!;
      if (files.has(abs)) continue; // each file visited once
      const rel = path.relative(srcRoot, abs);
      const viaHere = via || "(entry)";
      files.set(abs, { rel, via: viaHere });

      const src = fs.readFileSync(abs, "utf8");
      const { literals } = blankLiterals(src);
      for (const lit of literals) {
        if (!isImporterContext(lit.before)) continue;
        const spec = lit.value;
        if (!spec.startsWith("./") && !spec.startsWith("../")) continue; // bare specifiers are not followed
        const target = path.resolve(
          path.dirname(abs),
          spec.replace(/\.js$/, ".ts"),
        );
        if (files.has(target)) continue;
        if (!fs.existsSync(target) || !target.startsWith(srcRoot + path.sep)) {
          problems.push({
            kind: "import_specifier",
            token: spec,
            line: lineAt(src, lit.start),
            file: rel,
            via: viaHere,
          });
          continue;
        }
        queue.push({ abs: target, via: `${viaHere} -> ${spec}` });
      }
    }

    for (const [abs, meta] of files) {
      const src = fs.readFileSync(abs, "utf8");
      for (const v of scanSource(src)) {
        problems.push({ ...v, file: meta.rel, via: meta.via });
      }
    }

    return { files, problems };
  }

  it("no module reachable from the entry point uses Node built-ins or DOM globals", () => {
    const entry = path.join(srcRoot, "index.ts");
    const { files, problems } = buildClosure(entry);
    expect(files.size, "the closure must contain at least the entry point").toBeGreaterThan(0);

    // Success requires the closure list to be printed:
    // eslint-disable-next-line no-console
    console.log(
      "ENTRY CLOSURE (" + problems.length + " problem(s)): " +
        [...files.values()].map((f) => `${f.rel}  [via ${f.via}]`).join(" | "),
    );

    expect(problems).toEqual([]);
  }, 10_000);
});
