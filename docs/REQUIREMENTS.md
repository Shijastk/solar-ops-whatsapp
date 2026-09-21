# Requirements

Status: Milestone 1

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

Milestone 1 is not accepted until the full path is tested against the custom deployed webhook, not only Meta's built-in webhook viewer.
