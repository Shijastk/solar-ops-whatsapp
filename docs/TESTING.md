# Testing

## Current status

Meta's built-in test environment has already demonstrated:

- inbound text from the user's WhatsApp to the Meta test number
- inbound PDF/document
- Meta displaying the webhook payload in its test viewer

The custom repository webhook has now been reached successfully by Meta.

Verified custom webhook events so far:

- Meta GET verification returned HTTP 200.
- Meta dashboard `messages` test reached `POST /api/whatsapp`.
- Runtime configuration validation is green.
- Meta dashboard sample text was parsed as one text message.
- With the prototype sender allowlist and destination Phone Number ID checks temporarily disabled for this dashboard-only test, the sample text was written successfully to `public.whatsapp_messages`.
- The user visually confirmed the row appeared in Supabase.

This proves the custom Meta dashboard test -> Vercel -> Supabase database write path for text.

It does **not** yet prove a real inbound WhatsApp message reaches the custom webhook while the app is unpublished, and it does **not** yet prove live media download/storage.

Automated repository tests and GitHub Actions quality gates are active. A workflow must be observed passing before it is described as successful.

## What GitHub Pages is used for

GitHub Pages is static hosting. It cannot execute the Next.js WhatsApp webhook or replace Vercel/serverless runtime testing.

For this repository, Pages is used only as a static quality-status report produced after the same code-quality checks pass.

The report must contain only non-sensitive information such as:

- pass status
- commit SHA
- workflow run link
- timestamp
- names of checks that passed

It must not contain:

- Meta access tokens
- Meta app secrets
- Supabase keys
- customer PDFs/images
- WhatsApp webhook payloads
- sender phone numbers
- internal business cost/profit data

## Automated unit tests

The test runner is Vitest in Node environment.

Automated coverage includes:

- Meta webhook HMAC signature verification
- WhatsApp text payload normalization
- WhatsApp document payload normalization
- ignoring non-message webhook events
- webhook GET verification success/failure
- webhook POST rejection for invalid signatures
- invalid JSON behavior after a valid signature
- Meta Graph API default configuration
- Meta media-size rejection before and after download
- successful Meta media metadata/download normalization
- integration-fixture webhook builders
- deterministic integration HMAC signing
- synthetic PDF generation and hashing
- integration-report secret/identifier redaction
- full runtime environment validation
- safe reporting of invalid environment field names without exposing values

External Meta/Supabase calls are not treated as proven by unit tests.

## Credentialed provider integration

A separate manual integration suite is implemented in:

- `scripts/integration/run-whatsapp-e2e.mjs`
- `scripts/integration/helpers.mjs`
- `.github/workflows/integration.yml`

Detailed setup, provider research, safety rules, secret names, checks, cleanup behavior, and report contents are documented in:

`docs/INTEGRATION_TESTING.md`

The suite uses a generated synthetic PDF and a signed synthetic webhook to test the deployed endpoint while keeping sender allowlisting and destination Phone Number ID restrictions enabled.

It verifies:

- deployed health and security-filter presence
- invalid signature rejection
- allowlist rejection
- destination Phone Number ID rejection
- text persistence
- idempotent replay
- private Supabase bucket state
- Meta media upload/retrieve/download
- document ingestion into Supabase Storage
- stored-file SHA-256 integrity
- cleanup of database, Storage, and Meta media fixtures

The workflow is `workflow_dispatch` only. It does not call WhatsApp's `/messages` send endpoint.

Generated reports are uploaded as workflow artifacts and are not published to GitHub Pages.

Credentialed provider integration passed on 2026-09-21 after the system user was assigned to the Test WhatsApp Business Account.

Verified in workflow run 35578308664 against commit `9d394bc6c28f9969b1d348bce0fb789788ef8283`:

- deployed health and security-filter presence
- invalid HMAC rejection
- signed empty webhook acceptance
- sender allowlist rejection
- destination Phone Number ID rejection
- signed synthetic text -> Vercel -> Supabase
- idempotent replay
- private Supabase Storage bucket
- synthetic PDF upload to Meta
- Meta media metadata retrieval
- direct Meta media download with SHA-256 round-trip verification
- signed document webhook -> deployed Vercel endpoint
- Meta media download by the webhook
- private Supabase Storage persistence
- stored-file SHA-256 integrity
- cleanup of synthetic Supabase Storage, database, and Meta media fixtures

The report finished with Overall PASS.

This still does not prove that Meta delivered a real inbound WhatsApp message to the custom callback. Real inbound delivery remains a separate acceptance test while the app is unpublished.

## GitHub Actions quality gate

The repository contains a committed `package-lock.json`.

On pushes and pull requests the CI workflow runs reproducible installs with:

```bash
npm ci --no-audit --no-fund
npm run typecheck
npm run lint
npm run test
npm run build
```

A red workflow means the commit is not accepted as healthy.

Do not infer success from source review alone.

## Local quality commands

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

Or:

```bash
npm run verify
```

Do not claim these passed unless they were actually executed successfully.

## Milestone 1 end-to-end test

### Test A - health

Request:

`GET /api/health`

Expected after environment configuration:

- HTTP 200
- `ok: true`
- `configured: true`
- `configuration.validation.webhook = true`
- `configuration.validation.ingestion = true`
- `configuration.validation.invalidFields = []`
- no secret values returned

If a configuration value is invalid, the endpoint may return HTTP 503 and only the affected environment variable names under `invalidFields`.

### Test B - Meta verification

Configure Meta callback URL to:

`https://<deployment>/api/whatsapp`

Use the exact same verify token in Meta and Vercel.

Expected:

- Meta webhook verification succeeds

### Test C - text

Send:

`Hello`

Expected:

- HTTP webhook processing succeeds
- exactly one database row for the WhatsApp message ID
- `message_type = text`
- text body stored
- `processing_status = stored`

Dashboard sample status on 2026-09-21:

- custom webhook POST: HTTP 200
- parsed messages: 1 text
- stored: 1
- user confirmed Supabase row exists

A real inbound WhatsApp text through the custom webhook is still pending.

### Test D - PDF/document

Forward a small PDF.

Expected:

- one message row
- `message_type = document`
- original filename retained when supplied
- media downloaded server-side
- media uploaded to private `whatsapp-media` bucket
- internal `storage_path` stored
- `processing_status = stored`

### Test E - duplicate delivery

Replay the same valid webhook payload if a safe replay mechanism is available.

Expected:

- no second row for the same `whatsapp_message_id`

### Test F - invalid signature

Send a POST that does not contain a valid Meta signature.

Expected:

- request rejected
- no data written

### Test G - disallowed sender

When `ALLOWED_WHATSAPP_SENDERS` is configured, send from a number not on the allowlist.

Expected:

- no operational data stored for that sender
- handler returns without exposing secrets

## Test data safety

Use test documents that contain no sensitive customer information until the storage/security path has been verified.

## Still requiring live evidence

The credentialed synthetic provider path is verified.

Real inbound acceptance completed on 2026-09-21.

Observed Vercel runtime evidence:

- real inbound text: `POST /api/whatsapp 200`, one text message, `storedCount: 1`, `ignoredCount: 0`
- real inbound document: `POST /api/whatsapp 200`, one document message, `storedCount: 1`, `ignoredCount: 0`

The media ingestion implementation returns `stored` only after the Meta media download, private Supabase Storage upload, and database update have succeeded.

Together with the previously successful credentialed integration suite for replay/idempotency, private-bucket verification, media upload/retrieval/download, Storage byte integrity, and cleanup, Milestone 1 is complete.
