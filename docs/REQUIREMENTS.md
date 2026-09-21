# Requirements

Status: Milestone 1 accepted on 2026-09-21

## Goal

Reliably receive inbound WhatsApp messages sent to the Solar Ops WhatsApp account and store their metadata and supported media without requiring a separate operator app.

## Functional requirements

### R1 - Webhook verification

The backend must expose a Meta-compatible webhook verification endpoint.

Current route:

`GET /api/whatsapp`

It must return the supplied Meta challenge only when the verify token matches the server configuration.

### R2 - Incoming webhook

The backend must accept:

`POST /api/whatsapp`

It must parse supported WhatsApp Business Account `messages` webhook events.

### R3 - Authenticity check

Incoming POST requests must be rejected when the Meta webhook signature is missing or invalid.

### R4 - Text messages

For supported inbound text messages, store at least:

- WhatsApp message ID
- sender phone
- sender name when supplied
- message type
- text body
- received timestamp
- destination phone number metadata when supplied

### R5 - Media messages

Initial supported media categories:

- document/PDF
- image
- audio/voice
- video
- sticker

For media, the system should:

1. retain message metadata
2. retrieve media from Meta using the server-side access token
3. upload the bytes to the configured private Supabase Storage bucket
4. store the resulting internal Storage path in the database

### R6 - No temporary URL dependency

Meta temporary attachment URLs must not be treated as permanent storage.

### R7 - Idempotency

The same WhatsApp message ID arriving multiple times must not create duplicate database rows.

### R8 - Private storage

Received business documents must be stored in a non-public Supabase bucket.

### R9 - Sender restriction

The prototype must support an optional allowlist of permitted inbound WhatsApp sender numbers.

### R10 - Processing state

A message must expose a clear state such as:

- received
- stored
- failed

Failure information should be persisted for debugging when possible.

### R11 - No outbound messaging

Milestone 1 must not automatically send WhatsApp replies.

### R12 - No OCR yet

Milestone 1 must not:

- run OCR
- infer company names
- extract invoice line items
- modify inventory

Those belong to a later explicitly approved milestone.

### R13 - Public privacy policy

The deployed application must expose a public privacy policy at:

`/privacy`

The policy must accurately describe the current inbound WhatsApp data flow, categories of data processed, purposes, service providers, storage/retention, security controls, sharing, and access/correction/deletion requests.

It must not publish credentials, customer documents, internal costs, or other operational secrets.

## Non-functional requirements

### N1 - Readability

Implementation must favor maintainable, explicit TypeScript over clever abstractions.

### N2 - Secret isolation

All provider credentials remain server-side environment variables.

### N3 - Minimal cost

The prototype should remain compatible with zero/low-cost free tiers during validation.

### N4 - Minimal operator friction

The end user's intended action is simply forwarding a WhatsApp message/document.

### N5 - Runtime validation

Untrusted webhook payloads and environment configuration should be validated at runtime.

### N6 - Automated quality gate

Every push and pull request must run automated checks for:

- TypeScript type errors
- ESLint errors
- unit tests
- Next.js production build

A failed check must be visible in GitHub Actions. Do not claim a commit is healthy unless the relevant workflow actually passes.

### N7 - GitHub Pages quality report

When GitHub Pages is available for the repository/account, the project may publish a static quality-status page generated only after all automated checks pass.

The Pages site is not the application runtime and must never contain secrets, customer documents, internal costs, environment values, or webhook payload data.

### N8 - Credentialed integration safety

Live provider integration tests must:

- be manually triggered rather than run on every push or pull request
- use synthetic data only
- keep sender allowlisting and destination Phone Number ID restrictions enabled
- avoid outbound WhatsApp messages to people
- clean up synthetic database, Storage, and Meta media fixtures
- produce redacted reports that contain no credentials, phone numbers, media IDs, or raw payloads
- remain separate from GitHub Pages

## Acceptance criteria for Milestone 1

A successful end-to-end test is:

1. User sends `Hello` to the configured WhatsApp test/business number.
2. A row appears in `public.whatsapp_messages`.
3. User forwards a PDF.
4. A second row appears.
5. The PDF appears in the private `whatsapp-media` bucket.
6. The row contains the internal Storage path.
7. Re-delivering the same webhook does not create a duplicate row.
8. The repository quality workflow passes for the tested commit.

Milestone 1 acceptance completed on 2026-09-21.

Observed real inbound evidence:

- real WhatsApp text -> Meta -> custom Vercel webhook -> Supabase: PASS
- real WhatsApp PDF/document -> Meta -> custom Vercel webhook -> media download -> private Supabase Storage -> finalized database row: PASS
- credentialed replay/idempotency and media byte-integrity checks: PASS
- repository CI for the deployed implementation: PASS


## Milestone 2A - Temporary media retention

Status: approved direction; implementation in progress.

### R14 - Raw media is temporary

Successfully processed inbound media must not be retained indefinitely.

The default retention target is 24 hours.

### R15 - Deletion safety

The retention job may delete only media rows that:

- have `processing_status = stored`
- still contain a non-null `storage_path`
- have `processed_at` older than the configured retention cutoff

If Storage deletion fails, the database `storage_path` must remain present so a later run can retry.

### R16 - Preserve non-file metadata

Deleting the raw Storage object must not delete the WhatsApp message row.

The current metadata, such as message type, original filename, MIME type, hash/size metadata, sender metadata, and timestamps, may remain for operational traceability.

### R17 - No invented extraction schema

The long-term direction is to retain only useful structured business data instead of raw PDFs/images.

However, the exact invoice fields and stock semantics are not yet defined. The implementation must not invent them or automatically update inventory until those rules are explicitly approved.

### N9 - Low-cost scheduled cleanup

The prototype should reuse existing low-cost infrastructure.

The scheduled cleanup runs once per day using GitHub Actions and the existing protected `integration` environment Supabase credentials.

Because scheduled workflows can be delayed, 24 hours is a retention target rather than a hard deletion SLA.
