/**
 * Connector runtime (ADR-003): the capability trio a connector receives by
 * injection. Nothing here is ambient — no Node built-ins, no browser globals.
 */
import type { Transport } from "./transport.js";

/** Monotonic enough for ordering and logging; epoch milliseconds, UTC. */
export interface Clock {
  // epoch milliseconds, UTC
  now(): number;
}

/**
 * Log fields are restricted to number and boolean so that no value can be
 * logged: there is no string field to carry one (ADR-003 records the cost —
 * an enumerated channel can be added later if evidence requires it).
 */
export type LogFields = Readonly<Record<string, number | boolean>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
}

export interface ConnectorRuntime {
  readonly transport: Transport;
  readonly clock: Clock;
  readonly logger: Logger;
}
