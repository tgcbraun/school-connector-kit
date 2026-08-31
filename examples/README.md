# Examples

Only synthetic example data is allowed in this directory.

Never commit captures from real school accounts.

## Golden capture example (synthetic)

This directory contains the canonical golden example for the capture tool:

| File | Role |
| ---- | ---- |
| `synthetic-response.json` | A fictional upstream response (all values are placeholders). |
| `synthetic-allowlist.json` | A fictional, minimal allowlist for it. |
| `expected-capture.json` | The deterministic capture output the tool must reproduce byte-for-byte. |

It is a contract, not a sample: `tools/capture` has a test that re-runs
the documented command and asserts the exact output.

Reproduce it from the repository root:

```sh
pnpm --filter @school-connector-kit/capture capture -- \
  --input examples/synthetic-response.json \
  --allowlist examples/synthetic-allowlist.json \
  --platform example \
  --captured-at 2025-06-15T08:30:00Z \
  --method GET \
  --url-template '/api/example?start={start}&end={end}' \
  --status 200 \
  --output /tmp/expected-copy.json
```

Then compare `/tmp/expected-copy.json` with `expected-capture.json` —
they must be identical.

## Golden HTML structural capture example (synthetic, `capture_format` 2)

| File | Role |
| ---- | ---- |
| `synthetic-html-page.html` | A fictional captured HTML page (all markup is invented). |
| `synthetic-html-allowlist.json` | A fictional format-2 allowlist (selectors only). |
| `expected-html-capture.json` | The deterministic capture output the tool must reproduce byte-for-byte. |

Reproduce it from the repository root:

```sh
pnpm --filter @school-connector-kit/capture capture -- html \
  --input examples/synthetic-html-page.html \
  --allowlist examples/synthetic-html-allowlist.json \
  --platform kikom \
  --captured-at 2025-06-15T08:30:00Z \
  --method GET \
  --url-template '/api/v1/schedule/{term}' \
  --status 200 \
  --output /tmp/expected-html-copy.json
```

Then compare `/tmp/expected-html-copy.json` with
`expected-html-capture.json` — they must be identical. The golden answer
deliberately contains no cell text, no attribute values, no URL paths, and
no query-parameter values — only names, counts, and lengths.
