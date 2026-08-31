# Committed Fixtures

Publishable, structurally redacted captures of upstream school/Kita
platform responses — **synthetic or fully human-reviewed only**.

`fixtures/` is the ONLY place a capture may live once it is publishable.
Raw or semi-redacted real responses never land here; they pass through the
promotion workflow below first.

## Layout

```
fixtures/<platform>/variant-XXX/
  capture.json       # a redacted capture (see tools/capture)
  allowlist.json     # the exact allowlist used to produce it
  README.md          # human review summary (see checklist below)
```

A variant carries one or more capture/allowlist pairs. An allowlist binds to exactly one capture file. When a variant carries more than one pair, each pair is named to identify the page or endpoint it serves. Kikom serves two structurally different tables, so its `variant-001` carries two pairs, which serve as the worked example:

```
  capture-informationen.json  +  allowlist-informationen.json
  capture-termine.json        +  allowlist-termine.json
```

- `<platform>` is the observed platform (`webuntis`, `kikom`, …).
- `variant-XXX` is a **materially different observed shape** of that
  platform (different API version, tenant configuration, response family,
  or payload structure) — assigned sequentially per platform (`variant-001`,
  `variant-002`, …).
- A variant is NOT a school. Never organize fixtures by institution;
  never include a school id, tenant id, or any value that identifies an
  institution in `README.md` or a capture.

## Promotion workflow

```
real response (developer, trusted local environment)
   └─> private-fixtures/            (git-ignored; private by construction)
         └─> tools/capture          (redaction, deny-by-default)
               └─> HUMAN privacy review   (checklist below; mandatory)
                     └─> fixtures/<platform>/variant-XXX/
                           └─> git commit
```

No stage may be skipped, and no stage automates the human review.
**Do not claim automated redaction alone is sufficient.**

## Human review checklist (all items must hold)

1. Every `keep`-ed value was explicitly reviewed and justified. A capture may
   legitimately keep no values at all. In that case item 1 is satisfied by
   recording that fact in the variant README rather than by listing
   justifications.
2. No values other than reviewed `keep` values appear anywhere in the capture.
3. `dropped_paths` was read in full — each dropped name is acceptable to
   publish as a field name (names are structural information, not values).
4. `array_lengths` was reviewed — lengths themselves must not leak
   (school size, class size, pupil count, or any other sensitive count)
   or be justified in `README.md`.
5. `url_template` was reviewed for identification risk (route +
   placeholders read together with the context of how the capture was made).
6. `captured_at` is a real timestamp the reviewer accepts, or a
   deliberately re-stamped value recorded in `README.md`.
7. `platform` and `allowlist_version` are correct and non-identifying.
8. The allowlist file that produced the capture is committed beside it and
   still matches.
9. The capture was re-run through the tool and is byte-reproducible from
   the committed allowlist + a synthetic stand-in where real bytes must not
   be shared.
10. No value in the capture identifies a natural person (pupil, teacher,
    staff, parent) or family.
11. No value identifies an institution (school name, school id, tenant,
    address, phone, email).
12. `README.md` exists; it records the date the human privacy review was
    performed, states that the review passed, and records the per-`keep`
    justification, or records that the capture keeps no values at all. Review
    accountability is carried by the commit author in Git history; requiring
    a contributor to attach their name to a published file imposes a privacy
    cost the commit record already covers without it.
13. The fixture is usable by downstream work WITHOUT access to the original
    response or to `private-fixtures/`.

If any item fails, the item is fixed upstream (allowlist change /
re-capture) and the whole review is repeated. Review is per-capture and
per-version — an allowlist change re-opens the review.

## Rules

- Synthetic fixtures (clearly labelled as such) may enter with an
  abbreviated checklist noting "synthetic" in `README.md`.
- `private-fixtures/` is git-ignored and must STAY that way.
- Deleting a fixture requires a follow-up note in `README.md` history or a
  PR description, because downstream tests may reference it.
