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
9. `docs/INTEGRATION_TESTING.md` when the task touches live/provider integration testing
10. The exact source files relevant to the requested change.

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
- Update documentation whenever architecture, schema, environment variables, testing strategy, or decisions change.
- Never commit real credentials, phone numbers, access tokens, app secrets, or Supabase secret keys.
- Do not expose server-only secrets to client components.

## Current milestone

Milestone 1 is complete:

`WhatsApp -> Meta Cloud API -> Next.js webhook -> Supabase database/private Storage`

The user has approved the next direction: keep raw inbound media only temporarily, retain useful structured data long-term, and avoid wasting Storage.

Current Milestone 2 scope:

- temporary raw-media retention
- automatic deletion of successfully stored media after approximately 24 hours
- preserve message metadata after file deletion
- internal mobile-first WhatsApp-style operations UI
- authenticated temporary preview of private files
- deterministic PDF text extraction and structured document drafts
- human approval of complete parser drafts
- manual WhatsApp text replies from the internal UI while Meta's 24-hour customer-service window is open
- outbound delivery-status tracking
- optional Groq second-pass verification of selectable-text PDFs
- automatic transactional WhatsApp summaries only after fail-closed verification
- WhatsApp Edit/Delete workflow controls with audit-safe corrections/cancellation

The user has approved parsing, manual operator replies, and this bounded automatic document-summary workflow.

Still do not invent stock semantics. Parsed or approved document data must not silently mutate stock/current-stock records until the business rule for stock IN/OUT and opening balance is explicitly defined.

Image-only/scanned PDFs that do not contain a usable text layer must be marked for OCR rather than guessed.

AI verification is not an authority by itself. Automatic recording requires deterministic parser output, an independent Groq extraction, exact normalized agreement across all persisted structured fields/items, and deterministic arithmetic checks. Any uncertainty must fail closed to review. Automatic recording means document workflow state only; it must not mutate stock.

Still out of scope unless explicitly approved:

- automatic stock mutation
- customer-facing portal
- any automatic WhatsApp message that is not part of the approved verified-document workflow
- template messaging outside the 24-hour service window
- n8n
- paid automation services
- production phone number migration

## Testing rule

Automated tests are part of the source of truth for expected code behavior, but a test file existing does not prove the code is healthy.

For every code change:

1. Read the relevant existing tests before editing implementation.
2. Add or update tests when behavior changes.
3. Run or observe the actual CI quality gate.
4. Do not claim success if CI is pending, skipped, or failing.
5. Do not weaken/delete a failing test simply to make CI green unless the requirement itself was intentionally changed and documented.

GitHub Pages is only a static quality-report surface. It does not prove the server-side WhatsApp runtime works.

Credentialed integration tests are separate from normal CI. They must be manual-only, use synthetic data, keep sender and destination restrictions enabled, clean up fixtures, and produce redacted reports with no secrets, phone numbers, media IDs, or raw payloads. The existence of an integration workflow is not proof that providers work; only an observed successful run is evidence.

## Definition of done for a change

A change is not complete until:

1. The current repository state was inspected.
2. The implementation matches `docs/REQUIREMENTS.md`.
3. Relevant tests were added or updated when behavior changed.
4. Relevant docs are updated.
5. Typecheck, lint, unit tests, and production build pass in the actual CI quality gate when CI is available.
6. No secrets were committed.
7. Any uncertainty or unverified provider assumption is explicitly documented.
8. Provider-dependent behavior is not described as end-to-end verified until the documented live integration test is performed.
