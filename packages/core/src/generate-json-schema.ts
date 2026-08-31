/**
 * Writer for the committed JSON Schema document. Zod definitions are the
 * single source of truth; this is the only writer of
 * schema/normalized-schema-{version}.json, and a test re-runs the same
 * builder (document.ts) and pins the result — a hand-edited JSON Schema
 * cannot slip in unnoticed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "./schema.js";
import { buildDocument, canonicalJson } from "./document.js";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(
  here,
  "..",
  "schema",
  `normalized-schema-${SCHEMA_VERSION}.json`,
);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, canonicalJson(buildDocument()));
console.log(`wrote ${target}`);
