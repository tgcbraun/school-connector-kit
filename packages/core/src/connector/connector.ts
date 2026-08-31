/**
 * Connector contract (ADR-003).
 *
 * Capabilities are DERIVED from the fetcher map rather than declared: a
 * declared list could desync from the fetchers that are actually
 * implemented, and `capabilitiesOf` makes that impossible by construction.
 */

export type ConnectorCapability =
  | "timetable_entry"
  | "assignment"
  | "event"
  | "message";

/**
 * Request parameter only — a range the caller asks for, YYYY-MM-DD on both
 * bounds. It is not one of the four record date forms (PlatformDateInt,
 * WeekdaySlot, PartialDay, DayOnly) and must not be confused with any of
 * them; translating it to the platform's own encoding is the connector's
 * responsibility (ADR-003).
 */
export interface FetchWindow {
  readonly fromInclusive: string; // YYYY-MM-DD
  readonly toInclusive: string; // YYYY-MM-DD
}

export interface FetchRequest {
  readonly window?: FetchWindow;
}

export type ConnectorCredentials = Readonly<Record<string, string>>;

/**
 * One entry per capability the connector implements; each value optional, so
 * a partial connector is a legal connector.
 *
 * Return types are intentionally `readonly unknown[]` at this stage.
 * Binding them to the schema 0.1 concepts is the next step, and needs a real
 * connector to justify the binding — recorded as gap G9 in the package
 * README, deliberately not done here.
 */
export type ConnectorFetchers = Partial<
  Record<
    ConnectorCapability,
    (request: FetchRequest) => Promise<readonly unknown[]>
  >
>;

export interface Connector {
  readonly platform: string;
  readonly fetchers: ConnectorFetchers;
  authenticate(credentials: ConnectorCredentials): Promise<void>;
}

/** Compare two strings by Unicode code point (not locale collation). */
function compareCodePoints(a: string, b: string): number {
  // Array.from splits into code points (surrogate pairs keep their order),
  // which is exactly the requested ordering domain.
  const pa = Array.from(a);
  const pb = Array.from(b);
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const ca = pa[i]!.codePointAt(0)!;
    const cb = pb[i]!.codePointAt(0)!;
    if (ca !== cb) return ca - cb;
  }
  return pa.length - pb.length;
}

/**
 * The connector's capabilities: exactly the fetcher keys that hold a
 * function, in deterministic code-point order. A fetcher key that is absent
 * or explicitly `undefined` yields no capability; under the declared types a
 * non-function value is not legal input except by an explicit cast.
 * (ADR-003, decision 6.)
 */
export function capabilitiesOf(connector: Connector): readonly ConnectorCapability[] {
  return (Object.keys(connector.fetchers) as ConnectorCapability[]).filter(
    (capability) => typeof connector.fetchers[capability] === "function",
  ).sort(compareCodePoints);
}
