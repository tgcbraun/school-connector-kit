/**
 * Connector error contract (ADR-003).
 *
 * SECURITY/PRIVACY RULE — the `message` supplied to this constructor must be
 * a FIXED string chosen by the caller. No response value, credential, URL
 * query value, or header value may ever be interpolated into it. Messages
 * travel through host bridges and into host logs; anything interpolated in
 * here is published to that surface.
 */

export type ConnectorErrorCode =
  | "auth_failed"
  | "transport_failed"
  | "unexpected_response"
  | "not_supported";

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;

  constructor(code: ConnectorErrorCode, message: string) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
  }
}
