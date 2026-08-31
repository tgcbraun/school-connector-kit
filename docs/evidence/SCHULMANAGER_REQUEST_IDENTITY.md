# Schulmanager request identity — evidence (round 2)

Status: published evidence, reviewed for privacy before commit. Derived from
**reading a private connector's source** and from reading the capture tooling
in this repository — not from a capture. No Schulmanager capture has been
taken. Contains **no real values** (no names, IDs, tokens, institution
identifiers, host names, or bundle version). Field names and structural facts
only.

Round 2 supersedes round 1 of this document. Round 1 drew a capture-tooling
consequence from findings 3 and 4 that reading `cli.ts` withdrew; the
correction is recorded at the end rather than silently overwritten.

## Sources

- The private Family Dashboard Schulmanager connector — read read-only over
  SSH, not part of this repository and not published. Three reads: a
  structural map, the batched-call wrapper, and an earlier round-1 read.
- `tools/capture/src/capture-file.ts`, `src/redactor.ts`, `src/cli.ts`,
  `test/capture-file.test.ts` — read in this repository.

## Transport facts (structural)

```text
auth      POST /api/salt   {emailOrUsername, institutionId}
          POST /api/login  {emailOrUsername, password, hash, mobileApp,
                            institutionId}
          -> JWT, carried as Authorization: Bearer

data      POST /api/calls  {bundleVersion, requests: [...]}
          -> {results: [{status, data}, ...], systemStatusMessages: [...]}

headers   response X-New-Bearer-Token   rotation, must be adopted
          response x-ratelimit-remaining
```

## Platform findings

**1. `/api/calls` is an RPC tunnel, not a batch of endpoints.** Each element of
`requests[]` carries `moduleName` and `endpointName`. `endpointName: "poqa"`
takes a model name, an action and an ORM include-tree as parameters. The URL is
constant across every logical call; what is being requested lives in the body.

**2. Results correlate to requests by position only.** The connector returns
`results[i].data` for each `requests_[i]`. No field in a result echoes the
request that produced it. An `/api/calls` response is **not self-describing**:
the response alone cannot say which logical calls it answers.

**3. Several logical calls are co-resident in one HTTP transaction.** The
letters flow issues `get-letters` and `user-can-see-setting-for-letter-mailing`
in a single `requests[]` list — one POST, two logical calls, two independent
per-result statuses under one HTTP 200. This is a fact about the wire. What
follows for the capture tooling is at "Correction" below, not here.

**4. There are two independent status axes.** The envelope carries an HTTP
status; each element of `results[]` carries its own `status`. The private
connector raises on any non-200 result, so it never exercises a mixed-status
envelope.

**5. N+1 fetch.** The letters flow fetches a list, then issues one detail
request per letter (`poqa findByPk`, scoped to a single model). ADR-003's
fetcher returns `Promise<readonly unknown[]>` from a single call with no notion
of a second round-trip.

**6. Token rotation is per-call, not per-session.** The rotation header is
checked on every `/api/calls` response and the session dies if the new token is
not adopted. The only two writes to the `Authorization` header are in login and
in the calls wrapper — **nothing outside the calls wrapper touches auth after
login**. This closes the second of the two outstanding reads on the private
connector.

**7. HTML inside a JSON field.** Letter detail responses carry HTML in a body
field. Format 1 tooling captures it as a string with a length token, which says
nothing about its structure.

## Privacy note, carried forward

The **login response carries children's first names** under
`user.associatedParents[].student.{id, firstname}`. That makes it the
highest-sensitivity response in the corpus. Its allowlist needs care beyond the
other three platforms, and this is recorded before any capture so the
expectation exists in advance.

This note was present in round 1 and dropped by the round-2 rewrite. It is
restored here; no test covers prose, so nothing caught its absence.

## Capture-tooling findings

**8. The format-1 CLI writes exactly one request per invocation.** `runCli`
rejects a repeated `--input` and constructs a single-element `requests` array.
`--input` repeats on the **format-2** path only. The multi-entry format-1
envelope that `CaptureFileInput` permits has never been written by this CLI.

**9. Identity fields are absent from the model, not mis-keyed.**
`CaptureRequest` carries `method`, `urlTemplate`, `status`, `redaction`. There
is no request-body field. The distinguishing information is not captured at
all.

**10. The Redactor samples arrays at three elements.** `value.slice(0, 3)`
emits at most three element shapes, with the true count preserved in
`arrayLengths`. Sound for payload arrays; it would silently truncate an
envelope array of sub-requests, which is one reason not to traverse one.

**11. Allowlist rules are path-keyed, so array elements cannot be
discriminated.** Every element of a `requests[]` array normalizes to the single
path `requests[]`. Heterogeneous elements share one allowlist decision, and
deny-by-default resolves the union to the intersection. This is the
allowlist-binding gate of ADR-002 recurring along a new axis.

**12. Template grammar lives in the CLI, not the model.** `validateUrlTemplate`
enforces the safe relative-template grammar; `CaptureFile` checks only
non-empty string and documents pass-through. The test fixtures' absolute URLs
exercise that pass-through deliberately. Any new identity field follows the
same division.

## Interpretation — decided vs not decided

Decided:
1. Logical identity for Schulmanager lives in the **request body**, not in the
   URL, method or status. The existing key cannot express it.
2. The fix is a **caller-supplied discriminator** on `CaptureRequest` — the
   logical call name, supplied like `--url-template` and `--method` already
   are, validated in the CLI, never derived from the payload. Findings 8, 10
   and 11 together rule out a sub-request entity: the operator already scopes
   a capture by choosing one decoded input file, so one capture per logical
   call avoids traversing an envelope array at all.
3. Because the discriminator is a flag, no body value needs promoting to
   structural metadata. The Redactor stays deny-by-default with no exemption,
   and no privacy argument about `moduleName` / `endpointName` is required.
4. ADR-002 §9's fail-closed rule gains a format-1 analogue: one capture per
   logical call, as one capture per selector profile in format 2.

Not decided:
- Which status the operator records: the envelope's HTTP status or the
  per-result `status`. No divergence between them has been observed, because
  no response has been captured.
- What a mixed-status envelope looks like on the wire. No source read carries
  evidence of one; the private connector raises on any non-200 result, which is
  a fact about that code rather than about the wire. ADR-004 records this as an
  open consequence rather than a prerequisite: under one capture per logical
  call no envelope is represented whole, so there is no per-result axis to
  specify.
- Whether `poqa` include-trees vary in shape across calls to the same model.
- Whether rotation also occurs on the auth endpoints; only the data endpoint
  was read for it.

## Correction to round 1

Round 1 concluded that findings 3 and 4 forced a **sub-request entity** inside
`CaptureFile`. That conclusion was drawn from `capture-file.ts` alone: the type
permits a multi-entry `requests` array. Reading `cli.ts` showed the format-1
write path never produces one (finding 8), which reduces the change to a single
discriminator field. Round 1 also prepared a privacy argument for promoting
`moduleName` / `endpointName` to structural metadata; that argument is
withdrawn as unnecessary, not overruled.

The method note: a write path cannot be inferred from the type it constructs.
