# Acceptance Records

This directory holds the MVP acceptance gate defined by the [Refinement and Acceptance
Execution Plan](../refinement-acceptance-execution-plan.md) (Slice 0.4, Slice 5.4).

## Files

- `mvp-acceptance-template.md` — the blank checklist. Copy it, don't edit it, when
  starting a candidate's record.
- `YYYY-MM-DD-mvp.md` — a dated, filled-in record for one candidate commit. Created only
  once every blocking item in the template is Pass (execution plan Slice 5.4). Until then,
  no dated record should exist in this directory.

## Naming

Name a dated record `YYYY-MM-DD-mvp.md` using the date the record was finalised (all
blocking items resolved), not the date evaluation started. If a candidate is superseded
before reaching Accepted, delete its incomplete dated record rather than leaving a
partially-filled one that could be mistaken for evidence.

## Evidence redaction rules

Records in this directory may be shared outside the immediate engineering team, so:

- Never include a real User's email address, session cookie, sign-in code, or Photo file
  content. Use the two dedicated smoke Users' redacted labels (e.g. "Smoke User A"), not
  their actual addresses.
- Never include a raw production URL, API key, allowlist entry, or infrastructure ARN.
- Screenshots/recordings must not show private Photo content, file names that could
  identify a real person, or browser chrome revealing signed-in identity (bookmarks,
  profile avatar) beyond what the test itself requires.
- Prefer hashes, counts, and pass/fail states over raw request/response bodies. If a raw
  body is needed to explain a Blocked item, redact the Email/Code/token fields first.
- A "false positive" axe annotation (execution plan Slice 0.2) must name the rule, the
  selector, and a one-sentence reason; it is not a substitute for fixing a real violation.

## Status fields

Every row in the template is Pass, Fail, or Blocked:

- **Pass** — verified against the exact candidate commit referenced in the record.
- **Fail** — verified and did not meet the item's stated criterion.
- **Blocked** — not yet verifiable (e.g. requires separately authorised production access).
  A dated record must contain zero Blocked rows among items marked blocking before it can
  say Accepted (execution plan "Final Definition of Done").
