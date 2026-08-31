/**
 * Package entry point. Named re-exports of the shippable package surface:
 * the schema. `document.ts` and `generate-json-schema.ts` are build-time
 * modules and are deliberately not reachable from this entry point.
 */
export * from "./schema.js";
