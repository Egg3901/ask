# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately via GitHub's "Report a vulnerability" (Security → Advisories) on
this repository, or by contacting a maintainer directly. Include:

- what the issue is and where (file / endpoint),
- reproduction steps,
- the impact you believe it has.

We'll acknowledge as fast as we can and keep you updated on the fix.

## Scope of note

- Ask holds no identity database and no JWT secret; identity and entitlement come
  from separate loopback services.
- Live game-state access is read-only and quota-limited.
- Share/report links use unguessable, revocable tokens as the sole permission —
  report anything that lets a token be guessed, enumerated, or escalated.

## Out of scope

- Findings that require access to the server's `.env` or database file (those are
  never committed and are not part of the public surface).
- Rate-limit/quota values themselves — those are product decisions, not vulns,
  unless you can bypass them entirely.
