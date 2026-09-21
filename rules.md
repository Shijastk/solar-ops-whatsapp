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

Milestone 1 is inbound capture only.

Do not add OCR, stock logic, dashboards, outbound WhatsApp messaging, billing, or customer portals unless the user explicitly approves the next milestone.

## 10. Documentation maintenance

Whenever a change affects architecture, schema, requirements, environment variables, deployment, testing, or an important decision, update the matching docs in the same change.
