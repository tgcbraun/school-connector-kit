# WebUntis connector — a Hermes application run

Status: derived facts only. This document records runs against a live
platform. No credential, no cookie name, no cookie value, no header value,
no session id, no school identifier, no server host and no account
identifier appears here. Response header NAMES, HTTP statuses, byte
lengths, booleans, counts and one JSON-RPC error code do.

## Question

Two things had never been done. `packages/transport`'s fallback path —
the one taken where `Headers.prototype.getSetCookie` is absent — had never
run against a real platform's cookies. And no connector in this repository
had ever been hosted by an application, which is the reason ADR-003 exists.

`HERMES_MULTI_COOKIE_JOIN.md` established the host's join separator against
a public endpoint, and `WEBUNTIS_MULTI_COOKIE_ROUND_TRIP.md` round-tripped
the split rule against three real cookies — but that round trip
reconstructed the joined string on a workstation host that HAS the
accessor. The array was real; the join was modelled.

## Application

A throwaway Expo application outside the repository, SDK 57, run under
Expo Go on one iOS device and one Android device. Unlike the probe in
`HERMES_HOST_PROBE.md`, this application imports the built packages: it
constructs a connector and authenticates through it.

The three packages were copied into the application's `node_modules` as
their manifests plus their `dist` trees. Metro resolved all three with no
configuration change, although each package declares an `exports` map, no
`main` field, and `"type": "module"`.

The screen prints booleans, counts, statuses, byte lengths and header
names. Credentials are typed into fields on the device and are not
persisted.

## Result

Connector run, iOS:

```text
platform.os=ios platform.version=26.6.1
engine.isHermes=true
host.getSetCookie=false
authenticate ok transport=package jar=private
session_survived_fetch=true
rows=4
schema_valid=4/4
lesson_id_present=4 remark_present=4 remark_empty=4 completed_true=2
```

Connector run, Android:

```text
platform.os=android platform.version=36
engine.isHermes=true
host.getSetCookie=false
authenticate failed code=auth_failed name=ConnectorError
```

The connector collapses five distinct conditions into `auth_failed`, so a
second control was added to the screen: it issues the same authentication
request through `transport.send` directly, without the connector, and
reports the response's shape. Both devices were read with it minutes
apart.

Authentication shape, Android:

```text
http.status=200
body.length=79
body.isJson=true
body.topLevelKeys=error,id,jsonrpc
result.present=false
result.hasSessionId=false
error.present=true
error.code=-8504
error.messageLength=15
```

Authentication shape, iOS:

```text
http.status=200
body.length=131
body.isJson=true
body.topLevelKeys=id,jsonrpc,result
result.present=true
result.hasSessionId=true
error.present=false
```

`headers.names` was printed by both shape probes and is omitted here for
length. Neither list carried `set-cookie`. The two lists were not compared
against each other, so no claim is made here that they are identical.

## Established

**The fallback path ran against a real platform's cookies.**
`host.getSetCookie=false` and `authenticate ok` appear in the same iOS run.
`WEBUNTIS_SESSION_COOKIE_SCOPE.md` records this platform setting three
cookies in one authentication step; this run cannot observe that count,
because ADR-011 decision 1 makes the jar private. What this run does
observe is that whatever the platform set arrived through `Headers.get`,
was split by `SET_COOKIE_SEPARATOR`, and was sent back on a second request
— `session_survived_fetch=true` is that second request succeeding. The
joined string is not reconstructed here.

**A connector ran inside an application.** ADR-003's contract was written
so that these connectors could run on a phone. One now has, end to end:
constructed through ADR-005's factory, authenticated, fetched, and 4 of 4
emitted rows validated against the committed schema.

**The published packages are consumable by a bundler that is not Node.**
Metro resolved three `exports`-only, `main`-less ESM packages with no
resolver configuration.

**`for..of` over a `Headers` object works under Hermes on both platforms.**
`transport.ts` iterates response headers that way, destructuring entries,
and both shape probes and both connector runs went through it — the
Android run reaches the header strip before failing at the status check.
Previous readings used `forEach` only.

**Hermes on Android reads as Hermes on iOS.** `engine.isHermes=true` and
`host.getSetCookie=false` were read on both devices. This
extends `HERMES_MULTI_COOKIE_JOIN.md`'s finding through a different
channel: the connector's own request rather than an authored probe.

## Not established

- **Why Android's authentication is rejected.** `error.code=-8504` with
  HTTP 200 and well-formed JSON-RPC means the platform received the
  request and refused the credentials. The same credentials authenticate
  from Node on the workstation, twice, and from iOS through this same
  screen minutes earlier. The host layer is ruled out: the request left
  the device, reached the platform and returned parseable. What differs
  between the two devices has not been identified. The password field is
  the one value no reading can inspect, and it is the last untested
  explanation rather than an observed cause.
- **Whether the Android connector path would succeed given an accepted
  credential.** It has never reached past `authenticate`.
- **The Flutter-embedded engine.** Untested, and out of scope by decision
  rather than by omission.
- **The residual G28 case.** A cookie value containing a comma followed by
  a token and `=` would still split wrongly. No platform in this corpus has
  been observed emitting one, and this run does not change that.

## Consequence

`packages/transport` is unchanged by this document. The fallback it ships
is no longer the one piece of shipped behaviour resting on a model.

The application is throwaway and is not part of this repository. The
`node_modules` copy it used is a convenience for one run and is not a
packaging recommendation.
