# WebUntis round-trip — the separator against real cookies

Status: derived facts only. The probe targeted a live school platform; no
credential, no cookie value, and no platform message text appear here.
Only counts, cookie NAMES and one boolean are printed.

## Question

The Hermes probe established that the host joins several `Set-Cookie`
lines with `", "` and that a rule splitting at a comma followed by a
cookie name and `=` recovered both of two cookies the operator authored.
Whether that rule holds against real cookies from a real platform was
unevidenced, and G28 named a live run against a multi-cookie platform as
the settling evidence.

## Method

A one-off Node expression, no file written, run against a live WebUntis
authentication. It reads the `Set-Cookie` array the host supplies via
`getSetCookie`, re-joins it with `", "` to reconstruct exactly what a host
lacking that accessor would return from `Headers.get`, applies the
separator, and compares the result element-for-element against the
original array. It prints counts, cookie NAMES and one boolean. No cookie
value is printed.

## Result

```text
lines=3
naiveSplit=5
ruleSplit=3
ruleNames=JSESSIONID,schoolname,Tenant-Id
roundTripsExactly=true
```

Run twice: once with a narrow name character class, and once with the exact
separator that ships in `packages/transport`. Both round-tripped exactly.

## What it establishes

**The separator recovers three real cookies from a real platform exactly.** The split array was element-for-element identical to what `getSetCookie` returned.

**Splitting on a bare comma fails on real data, not only on authored data.** Five pieces from three cookies: the failure mode the fallback was written around is confirmed against real data.

**This is the evidence G28 named.** The fallback in `packages/transport` now splits rather than storing the joined string whole.

## Limits

- **The reconstruction assumes the host joins with `", "`.** That is observed on Hermes under iOS and Android and is not guaranteed for any other host.
- **Three cookies, one platform, one authentication.**
- **The joined string was reconstructed, not observed.** The run was on a
  host that HAS `getSetCookie`, so the array is real and the join is
  simulated. A real platform's cookies have not yet been read through
  `Headers.get` on a host that lacks the accessor — that is a device run,
  and it remains outstanding.
- **The residual case is untouched.** A cookie VALUE containing a comma, a token and `=` would still split wrongly, and none has been observed.
