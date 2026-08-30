# Security Policy

## Reporting security issues

Do not report security vulnerabilities that contain personal school data,
credentials, authentication tokens, session cookies, pupil identifiers, or
other sensitive information in a public GitHub issue.

Security issues should be reported privately to the project maintainer.

## Sensitive data

The repository must never contain:

- real usernames or passwords;
- session cookies or authentication tokens;
- `.env` files containing credentials;
- production SQLite databases;
- identifiable pupil, parent, teacher, or school records;
- unredacted API captures from real accounts.

All committed test fixtures must be synthetic or demonstrably redacted.

## Capture tooling

Capture and redaction tools must follow a deny-by-default model.

No value from an upstream response may be emitted unless explicitly permitted
by the applicable capture policy.
