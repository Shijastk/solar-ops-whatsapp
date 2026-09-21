# Repository Rules

## 1. Source of truth

The repository is the source of truth for code.

The documentation under `docs/` is the source of truth for intended behavior.

Automated tests are executable checks for selected requirements, not a replacement for requirements or live provider integration testing.

If code, tests, and documentation disagree, do not guess which one is correct. Identify the mismatch and ask the user before making a behavior-changing decision.

## 2. No hallucinated codebase

Never claim a file, function, endpoint, table, field, integration, test, deployment, or workflow result exists without reading/verifying it.

Before discussing how an implementation currently works, inspect the relevant file.

Before claiming code is healthy, inspect the actual CI result for the relevant commit when CI is available.

## 3. Ask when uncertain

If there is meaningful ambiguity that can affect data, cost, security, or the business workflow, explain the concern and ask the user.

Do not silently choose a business rule.

Examples that require confirmation:

- changing what counts as stock in/out
- automatically updating inventory from OCR
- sending automatic WhatsApp replies
- exposing cost/profit data
- onboarding a real production phone number
- changing the database schema in a destructive way
- introducing a paid service
- changing customer-facing workflow

## 4. Code style

Code must be easy to read.

Prefer:

- descriptive names
- short functions
- explicit control flow
- typed boundaries
- small modules
- comments only where the reason is not obvious

Avoid:

- giant files
- deeply nested logic
- premature generic abstractions
- magic constants
- copy-paste provider logic
- clever one-liners that reduce readability

## 5. Security

- Never commit secrets.
- Never put `SUPABASE_SECRET_KEY` in client-side code.
- Never put Meta access tokens or app secrets in browser code.
- Validate webhook authenticity before processing payloads.
- Keep media private by default.
- Do not store temporary Meta download URLs as permanent file URLs.
- Keep sender allowlisting available for the prototype.
- Do not log secret values.
- Never put real webhook payloads, phone numbers, customer documents, or credentials on GitHub Pages.

## 6. Data integrity

- WhatsApp message ID is the idempotency key.
- Repeated webhook deliveries must not create duplicate message rows.
- Media download/storage failure must be visible as a failed processing state.
- Do not automatically mutate future stock data from unverified OCR output.

## 7. Testing discipline

Every behavior change must be considered for automated regression coverage.

The CI quality gate must run:

- TypeScript typecheck
- ESLint
- unit tests
- Next.js production build

Do not:

- claim tests passed without observing a successful run
- delete/skip tests just to silence a failure
- treat a GitHub Pages deployment as a backend integration test
- treat mocked/unit tests as proof that Meta, Vercel, or Supabase are configured correctly

Live provider behavior requires the documented end-to-end test.

## 8. External APIs

Provider behavior changes.

Before introducing or changing:

- Meta Graph API version
- Meta webhook fields
- Supabase key conventions
- Vercel runtime assumptions
- GitHub Pages/Actions behavior

verify current official documentation or clearly mark the item as unverified.

## 9. Scope control

Milestone 1 inbound capture is complete.

The user has approved temporary media retention and the direction of extracting only useful business data from documents. The current implementation may add safe media-retention infrastructure.

Do not silently choose the invoice extraction schema. The exact fields that matter, correction flow, company-identification rules, and stock-in/out semantics remain business decisions that require explicit confirmation before OCR/parser output can mutate operational data.

Do not add automatic stock mutation, dashboards, outbound WhatsApp messaging, billing, paid services, or customer portals unless explicitly approved.

## 10. Documentation maintenance

Whenever a change affects architecture, schema, requirements, environment variables, deployment, testing, or an important decision, update the matching docs in the same change.


## 11. Credentialed integration safety

The provider integration suite is intentionally separate from normal CI.

Rules:

- It must run only by explicit manual action such as `workflow_dispatch`; never on every push or pull request.
- It must use synthetic text and a generated synthetic PDF. Never use customer invoices, photos, voice notes, or other real business documents.
- It must not call the WhatsApp `/messages` send endpoint or send a WhatsApp message to a person.
- It must refuse to proceed when the deployed sender allowlist or destination Phone Number ID protection is absent.
- Credentials and sender/destination identifiers must come from protected environment/repository secrets, not workflow inputs or committed files.
- The workflow must force cleanup of synthetic Supabase rows, Storage objects, and Meta media fixtures.
- Reports may contain only pass/fail state, timings, safe summaries, public target origin, API version, and cleanup status.
- Reports must never contain tokens, app secrets, phone numbers, Phone Number IDs, media IDs, raw webhook payloads, Supabase credentials, or customer data.
- Generated credentialed reports are workflow artifacts, not GitHub Pages content.
- Do not claim Meta/Vercel/Supabase integration is verified until an actual credentialed run completes successfully and its report is inspected.
