/**
 * Connector construction seam (ADR-005).
 *
 * Configuration is passed once, at construction, and is distinct from
 * credentials, which are passed only to `authenticate`. Configuration
 * addresses an instance; credentials authorise against it.
 *
 * This base carries `sourceInstance` and nothing else. That field is
 * universal by the schema's own construction — `ProvenanceEnvelope`
 * requires `source_instance` and is inlined into every concept, so every
 * record any connector emits must carry it. A platform's addressing
 * (a base URL, a tenant selector) is NOT here: one connector exists, and a
 * base type that guessed the addressing shape of the other platforms would
 * be a generalisation from n=1.
 *
 * ADR-005 records that this is weakly enforcing: nothing compels a
 * connector's configuration to extend this interface, and one that declares
 * `sourceInstance` independently typechecks identically.
 */
export interface ConnectorConfig {
  /**
   * Tenant identity stamped into every provenance envelope this connector
   * produces. Deliberately distinct from any platform-native tenant
   * selector and never derived from one: whether the normalized stream
   * carries the platform's real school identifier or an opaque local label
   * is the caller's disclosure decision, not the connector's (gap G3).
   */
  readonly sourceInstance: string;
}
