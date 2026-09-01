# WebUntis session cookie scope — probe evidence

Status: derived facts only. No tenant host, no school identifier, no session
id, no credential, no response value appears here.

## Question

The private WebUntis shim sends two cookies on every authenticated request:
`JSESSIONID` and `schoolname` (the latter a base64 encoding of the school
selector, not session state). ADR-003 decision 3 gives cookie ownership to
the Transport, and `assertNoCookieHeaders` forbids a connector from setting
either. `JSESSIONID` is session state a Transport acquires from `Set-Cookie`;
`schoolname` is caller-supplied configuration a response-driven cookie jar
would never hold.

If the homework endpoint required `schoolname`, ADR-003 would have no seam
for it and the decision would need amending.

## Probe

`private-fixtures/webuntis/probe_cookie_scope.py`. One authentication, then
the same `GET /WebUntis/api/homeworks/lessons` request issued twice in the
same session — run A with both cookies, run B with `JSESSIONID` only. No
bearer token in either run. The script writes no files and prints only
status, body byte count, and JSON-parseability.

## Result

```text
run_a_status=200 run_a_body_bytes=4335 run_a_json=true
run_b_status=200 run_b_body_bytes=4335 run_b_json=true
```

Identical status, identical body size, both parsed as JSON.

## Established

**The homework endpoint does not require the `schoolname` cookie.** The
school selector is carried by the `school` query parameter on the JSON-RPC
authentication call; once the session exists, the session cookie alone
authorises the REST fetch.

**Consequence: ADR-003 decision 3 stands unamended.** A Transport owning
only response-set cookies is sufficient for a WebUntis connector. No
configuration-cookie seam is needed, and none is added.

## Not established

- Scope is one tenant, one endpoint, one session. This does not establish
  that no WebUntis endpoint requires the cookie, nor that no other tenant
  configuration does.
- Whether the bearer token from `/WebUntis/api/token/new` is ever required.
  The shim treats it as best-effort and additive; run B omitted it and
  succeeded, so it is not required *here*, and the connector does not
  fetch one.
- Body byte equality is a strong signal that the same rows were returned,
  but the probe compares sizes, not contents. It does not prove identity.

## Note on the private shim

The shim has been sending a cookie the endpoint does not need. Not a
defect — it mirrors the established private connector — but the
justification for it no longer holds. Recorded, not acted on.
