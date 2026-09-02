# Schulmanager — reviewed format-1 capture (v1, first capture)

Four reviewed structural captures of the Schulmanager platform — one per
logical call — and the format-1 allowlists that produced them.

## Facts

- **Platform:** Schulmanager
- **Capture session:** one session on 2026-09-02; four logical calls —
  `login`, `get-letters`, `letter-mailing-setting`, `letter-detail`. One
  capture per logical call, ADR-004 decision 5.
- **Endpoints:** three of the four POST to the same URL, `/api/calls`;
  `login` POSTs to `/api/login`. That endpoint is an RPC tunnel: the URL is
  constant and the logical call travels in the request body.
  `logical_call` is what distinguishes the three `/api/calls` captures.
  It is platform-scoped and must not be used as a cross-platform join key.
- **`capture_format`:** 1
- **Allowlists:** one per capture, committed beside it and still matching
  it. Every rule in all four is `mode: "type"`; there are zero `keep`
  rules, consistent with the three fixtures already committed.

## Files

```
capture-login.json                    # the /api/login response
allowlist-login.json                  # the exact allowlist that produced it
capture-get-letters.json              # /api/calls, logical_call get-letters
allowlist-get-letters.json            # the exact allowlist that produced it
capture-letter-mailing-setting.json   # /api/calls, logical_call letter-mailing-setting
allowlist-letter-mailing-setting.json # the exact allowlist that produced it
capture-letter-detail.json            # /api/calls, logical_call letter-detail
allowlist-letter-detail.json          # the exact allowlist that produced it
README.md                             # this file
```

Each capture keeps JSON types (`__t`), string lengths (`__len`), and array
lengths (`array_lengths`) only. It contains **no real values otherwise**:
no letter text or title, no names, no ID values, no school name, no tenant
identity.

## Why this layout is four pairs

The other fixtures in this directory carry a single
`capture.json` / `allowlist.json` pair (WebUntis, DieSchulApp); Kikom
carries two. This one deliberately carries **four**. Schulmanager's data
responses all travel to the same constant URL, `/api/calls`, with the
logical call in the request body (finding 1 in
`docs/evidence/SCHULMANAGER_REQUEST_IDENTITY.md`), and an allowlist binds
to exactly one capture file. Since the response envelope alone cannot say
which logical call it answers, one capture was taken per logical call
(ADR-004 decision 5) and each pair is named for the call it serves.

## What the JSON cannot say about itself

1. **Profiles are sampled, not complete.** Arrays are sampled at three
   elements: at most the first three array elements are inspected and
   emitted, with the true length recorded separately in `array_lengths`.
   `get-letters` listed ten letters and the capture emits three.
2. **`results[].data` is untyped across logical calls.** It is an array in
   `get-letters`, an object in `letter-detail`, and a bare boolean in
   `letter-mailing-setting`. The envelope does not determine the payload
   shape; only the logical call does. `logical_call` is a
   Schulmanager-scoped name and must not be used as a cross-platform join
   key.
3. **There are two status axes.** `results[]` carries a per-result `status`
   that is independent of the HTTP status. ADR-004 decision 6 left this
   axis open; it is now observed, and both are 200 in these captures. A
   divergent pair is not observed in this data.
4. **`systemStatusMessages` is platform chrome.** It appears in every
   `/api/calls` response — all three data captures carry it — and is
   unrelated to the logical call. It is an operator notice. Its `text` is
   denied in all three; only its structural fields survive.
5. **The dropped names in the letter detail carry two different reasons
   that the file cannot tell apart.** In `capture-letter-detail.json`,
   `dropped_paths` carries four names denied for two different reasons.
   `text` and `title` were denied because they carry a letter's content.
   `answerDeadline` and `options` were denied because both were null in
   this capture and their shapes are therefore unobserved — the same
   treatment WebUntis gave `attachments` (empty in all observed rows) and
   DieSchulApp gave `room` (null in all observed rows). The distinction
   matters: one pair was denied as values, the other as absence of
   evidence, and a connector must not assume a shape for either pair
   until the null pair is observed non-null.
6. **The login response carries the corpus's highest-sensitivity shape.**
   It is per-parent, with the associated student nested: `id` and `sex`
   are kept as type tokens, while the names, `classId`, `institutionId`,
   the e-mail, `associatedTeachers`, and the raw `jwt` are all in
   `dropped_paths`. This is the response the privacy note in
   `docs/evidence/SCHULMANAGER_REQUEST_IDENTITY.md` flags in advance.
7. **One attempted call was not captured.** `POST /api/salt` returned HTTP
   404 with an HTML body on this tenant during the session, so it has no
   capture here. Login succeeds without it.
8. **Open gaps — absence here is not confirmation:**
   - no unread letter appears in the sample: every sampled `get-letters`
     row carries `readTimestamp` as a 24-character string. The private
     connector treats a falsy `readTimestamp` as unread, so the null form
     exists upstream and is not evidenced here
   - `answerDeadline` and `options` were denied for being null (point 5);
     their real shapes have never been observed
   - both status axes read 200 wherever both exist (point 3); a divergent
     pair has never been observed

## Provenance

- Reviewed by a human as part of the school-connector-kit privacy review
  process, against the captures taken 2026-09-02; the review passed and
  the checklist in `fixtures/README.md` applies.
- Every capture keeps no values: all allowlist rules are `mode: "type"`
  and there are zero `keep` rules, so the checklist's per-`keep`
  justification item is satisfied by recording that fact here rather than
  by listing justifications.
- Reproducible from the raw responses via `tools/capture` (format-1 path)
  with the allowlists in this directory.
- `private-fixtures/schulmanager/` holds the private originals; this
  directory stands alone and needs no access to them.
