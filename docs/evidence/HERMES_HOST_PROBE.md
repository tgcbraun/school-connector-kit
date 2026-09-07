# Hermes host probe — Set-Cookie accessibility

Status: derived facts only. No credential, no cookie value, no header
value, and no platform host appears here. The probe ran against
`httpbin.org`, a public test service.

## Question

ADR-003 records an unverified-behaviour caveat about two mobile hosts:
whether `Set-Cookie` is readable from JavaScript under Hermes and under a
Flutter-embedded engine. No run had ever tested a host — every probe and
every live run in this repository tested a server.

ADR-011 made the caveat load-bearing. Decision 1 puts the cookie jar in
the Transport, and `packages/transport` fills that jar by calling
`res.headers.getSetCookie()`. Alternative (b) considered guarding that
call against hosts lacking the method and rejected the guard, on the
grounds that it writes code against a platform nobody has run. This probe
is the channel that rejection named.

## Probe

`private-fixtures/hermes-probe/`, git-ignored, copied into a throwaway
Expo project outside the repository. It imports nothing from this
repository: importing `packages/transport` would pull the pnpm workspace
into an Expo resolver and answer no additional question.

Run under Expo Go, SDK 57, on an iOS device. The probe prints booleans,
counts, HTTP status codes and response header NAMES only.

## Result

```text
engine.isHermes: true
typeof fetch: function
typeof Headers: function
Headers.prototype.getSetCookie: false
setcookie.status: 302
headers.iterable: true
headers.names: access-control-allow-credentials,access-control-allow-origin,
               content-length,content-type,date,location,server,set-cookie
res.headers.getSetCookie: undefined
headers.get.setCookie.isNull: false
redirect.manual.status: 302
redirect.manual.honoured: true
```

## Established

**`Headers.prototype.getSetCookie` does not exist under Hermes.** The
prototype check and the instance check agree, so this is the method's
absence and not an instance quirk. `packages/transport` calls it bare,
so that call cannot succeed on this host. The probe read the method's
absence; it did not call it, so the failure mode follows from the
language rather than from an observation.

**The `set-cookie` header is nevertheless present and readable.** It
appears in the response header names, and `res.headers.get("set-cookie")`
returned a non-null value. The session is not lost under Hermes — only
the accessor is.

**ADR-011 decision 4 holds.** `redirect: "manual"` was honoured: a 302 was
surfaced rather than followed.

**ADR-011 decision 3 is implementable.** Response headers are enumerable,
so the strip of exactly `set-cookie` and `cookie` can be performed.

## Not established

- **Whether `.get("set-cookie")` is a usable substitute.** It returns one
  comma-joined string where `getSetCookie()` returns an array. Splitting
  that string is ambiguous: a cookie value may contain a comma, and an
  `Expires` attribute contains one by construction. This probe observed a
  single cookie and therefore does not exercise the joined case at all.
  **This matters concretely rather than theoretically:** the WebUntis live
  run recorded in `WEBUNTIS_SESSION_COOKIE_SCOPE.md` ended authentication
  with three cookies set by the server in one step.
- **The Flutter-embedded engine.** Untested. ADR-003's caveat is now half
  answered, not answered.
- **Android.** The reading is from one iOS device under Expo Go. Hermes is
  the same engine on Android, but the networking layer that supplies
  `fetch` and `Headers` is the platform's, not the engine's, and that
  layer is what lacks the method.
- **Whether header iteration order or duplication differs.** The probe
  used `forEach`; `packages/transport` uses `for..of`. Both rest on the
  same iterator in practice, but only `forEach` was exercised here.

## Consequence

ADR-011 alternative (b) is falsified by evidence rather than by argument.
The guard it declined is no longer anticipation — the host that lacks the
method has been run, and it is one of the two hosts ADR-003's caveat
names.

`packages/transport` is unchanged by this document. The implementation
question — how to recover multiple cookies from a joined header string
without a splitting heuristic that a comma in a value would break — is
not answered by this probe and is not decided here.
