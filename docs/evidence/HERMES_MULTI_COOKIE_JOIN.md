# Hermes host probe — the joined Set-Cookie case

Status: derived facts only. No credential, no cookie value, no header
value, and no school platform appears here. The probe ran against
`httpbin.org`, a public test service.

## Question

The ninth session established that `Headers.prototype.getSetCookie` does
not exist under Hermes, and `packages/transport` falls back to
`Headers.get("set-cookie")`, which returns one string where several
`Set-Cookie` lines were sent. How that string is joined was unobserved, so
no split rule was derivable and the fallback stores the string whole (G28).

## Method

The probe source is `private-fixtures/hermes-probe/App.tsx`, git-ignored,
copied into a throwaway Expo project outside the repository. It imports
nothing from this repository. The endpoint is `httpbin.org`
`/response-headers`, a public test service, never a school platform. Two
`Set-Cookie` lines were requested: the first carrying an `Expires`
attribute whose value contains a comma by construction, the second not. The
probe compares what the host returned against the two cookie strings the
operator authored and sent, and reports booleans; it never prints the string
it received.

## Wire ground truth

Before the device run, the same endpoint was fetched with `curl` from the
workstation. The response carried two separate `Set-Cookie` header lines.
This separates the server's behaviour from the host's: any joining observed
on the device is the host's `Headers` implementation, not the server's
framing.

## Result

Run under Expo Go on an iOS device and on an Android device, both reporting
`engine.isHermes: true`. The two outputs were identical line for line.

```text
engine.isHermes: true
Headers.prototype.getSetCookie: false
multi.status: 200
multi.getSetCookie: undefined
multi.joined.isNull: false
multi.joined.length: 69
multi.joined.commaCount: 2
multi.joined.isCommaSpaceJoin: true
multi.joined.isCommaJoin: false
multi.joined.isFirstOnly: false
multi.joined.isSecondOnly: false
multi.naiveSplit.count: 3
multi.ruleSplit.count: 2
multi.ruleSplit.names: sckA,sckB
multi.accessor.getAll: undefined
multi.accessor.raw: undefined
multi.accessor.map: object
multi.accessor.underscoreHeaders: undefined
multi.accessor.entries: function
redirect.manual.honoured: true
```

## What it establishes

**The host joins with `", "` and discards nothing.** Length 69 is the two
authored cookie strings plus a two-character separator, and
`multi.joined.isCommaSpaceJoin` confirms the separator directly.

**Splitting on a bare comma fails.** `multi.naiveSplit.count` is 3 against
two cookies sent, because the `Expires` attribute's comma splits the first
cookie.

**A split rule recovers both cookies.** Splitting on a comma and optional
whitespace followed by a cookie name followed by `=` recovered both
cookies: `multi.ruleSplit.count` 2, names `sckA` and `sckB`.

**The accessor is absent on both platforms.** Hermes is the same engine on
Android, but the networking layer supplying `fetch` and `Headers` is the
platform's, so this was not derivable and had to be read. ADR-003's
two-host caveat is now answered for Hermes on both platforms; the
Flutter-embedded engine remains untested.

**`multi.accessor.map` reports `object`, so React Native's `Headers`
carries an internal store.** Whether it holds an unjoined list or the same
joined string is not derivable from a `typeof` and was not called.

## Limits

- **Two cookies, one endpoint, one run per platform.** The join separator
  is observed, not guaranteed, across hosts or React Native versions.
- **The split rule was exercised against cookie names this probe authored.**
  A cookie VALUE containing a comma followed by a token and an equals sign
  would still defeat it. No platform in this project's corpus has been
  observed emitting one, and that absence is not evidence.
- **The probe prints no platform identifier.** That the two runs came from
  two different devices rests on the operator's record of running them, not
  on the artifact. Stated here rather than left for a reader to assume.
- **The Flutter-embedded engine is untested.**
