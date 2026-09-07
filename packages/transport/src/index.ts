/**
 * Entry point (ADR-011 decision 5): this package is the one part of the kit
 * that touches the host, and its shippable surface is the factory and
 * nothing else — the jar is per-instance state and part of no surface.
 */
export { createFetchTransport } from "./transport.js";
