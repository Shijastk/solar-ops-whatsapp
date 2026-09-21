# AGENTS.md

This file is the first instruction file for any coding agent working in this repository.

## Mandatory startup sequence

Before changing code, read these files in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `rules.md`
4. `docs/REQUIREMENTS.md`
5. `docs/CURRENT_ARCHITECTURE.md`
6. `docs/DECISIONS.md`
7. `docs/TESTING.md`
8. `docs/KNOWN_ISSUES.md`
9. The exact source files relevant to the requested change.

Do not make a code change based only on memory, prior conversation, assumptions, or file names.

## Non-negotiable anti-hallucination rule

If a required fact is not present in the repository or verified from the actual external provider documentation, do not invent it.

Examples:

- Do not invent environment variable names.
- Do not invent Supabase tables or columns.
- Do not invent Meta webhook payload fields.
- Do not invent API versions.
- Do not invent Vercel project configuration.
- Do not assume a feature already exists.
- Do not assume a file has the same contents as a previous session.

When uncertain, stop and state the exact concern to the user before implementing that part.

## Change discipline

- Inspect current code before editing it.
- Make the smallest coherent change.
- Keep code readable and boring rather than clever.
- Prefer small named functions with one responsibility.
- Avoid unnecessary abstractions.
- Avoid adding dependencies unless they remove substantial complexity.
- Keep external provider code behind small modules.
- Update documentation whenever architecture, schema, environment variables, or decisions change.
- Never commit real credentials, phone numbers, access tokens, app secrets, or Supabase secret keys.
- Do not expose server-only secrets to client components.

## Current milestone

Milestone 1 is inbound WhatsApp capture only:

`WhatsApp -> Meta Cloud API -> Next.js webhook -> Supabase database/private Storage`

Not part of Milestone 1 unless the user explicitly approves it:

- OCR
- invoice parsing
- stock mutation
- customer-facing portal
- WhatsApp auto-replies
- outbound notification system
- n8n
- paid automation services
- production phone number migration

## Definition of done for a change

A change is not complete until:

1. The current repository state was inspected.
2. The implementation matches `docs/REQUIREMENTS.md`.
3. Relevant docs are updated.
4. Typecheck, lint, and build are expected to pass; when execution is available, run them.
5. No secrets were committed.
6. Any uncertainty or unverified provider assumption is explicitly documented.
