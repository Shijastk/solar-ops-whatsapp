# Testing

## Current status

Meta's built-in test environment has already demonstrated:

- inbound text from the user's WhatsApp to the Meta test number
- inbound PDF/document
- Meta displaying the webhook payload in its test viewer

The custom repository webhook has not yet been proven end-to-end against Vercel + Supabase.

Automated repository tests and GitHub Actions quality gates are being added in Milestone 1. A workflow must be observed passing before it is described as successful.

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

Initial automated coverage focuses on deterministic boundaries that can be tested without real provider credentials:

- Meta webhook HMAC signature verification
- WhatsApp text payload normalization
- WhatsApp document payload normalization
- ignoring non-message webhook events
- webhook GET verification success/failure
- webhook POST rejection for invalid signatures
- invalid JSON behavior after a valid signature
- Meta Graph API default configuration

External Meta/Supabase calls are not treated as proven by unit tests.

## GitHub Actions quality gate

On pushes and pull requests the CI workflow runs:

```bash
npm install --no-audit --no-fund
npm run typecheck
npm run lint
npm run test
npm run build
```

A red workflow means the commit is not accepted as healthy.

Do not infer success from source review alone.

## Local quality commands

```bash
npm install
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
- no secret values returned

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

## Still requiring integration coverage

The following cannot be honestly proven by the initial unit suite alone:

- Supabase upsert idempotency against the real schema
- private Storage upload against the real bucket
- Meta media download against the live Graph API
- sender allowlist behavior through a complete live webhook request
- media-size rejection against a real download
- Vercel runtime behavior
- complete Meta -> Vercel -> Supabase delivery

These are covered by the manual end-to-end milestone test until a safe credentialed integration-test environment is approved.
