/**
 * Package entry point (ADR-003). Named re-exports of the shippable surface
 * only: the schema and the connector contract.
 *
 * `document.ts` (the schema-document builder) and `generate-json-schema.ts`
 * (the JSON-Schema writer) are build-time modules and are deliberately NOT
 * reachable from this entry point; the first reads the Zod version via
 * `node:module` at import time. They are out of scope of the no-Node/no-DOM
 * rule by being unreachable, not by being named (ADR-003, decision 9).
 */
export * from "./schema.js";
export * from "./connector/config.js";
export * from "./connector/connector.js";
export * from "./connector/errors.js";
export * from "./connector/runtime.js";
export * from "./connector/transport.js";
