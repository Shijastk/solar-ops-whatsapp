# Current Architecture

This document describes the repository and deployed prototype as verified on 2026-09-21.

## Runtime

The application is a Next.js App Router project using TypeScript.

The webhook explicitly uses the Node.js runtime because the implementation uses Node cryptography and Buffer-based media handling.

## Deployment status

Verified Vercel project:

`solar-ops-whatsapp`

Framework:

`Next.js`

Stable production alias:

`https://solar-ops-whatsapp.vercel.app`

Verified state:

- production deployment: `READY`
- `/api/health`: HTTP 200
- `configured: true`
- Meta custom webhook verification succeeds
- Meta dashboard sample text reaches `POST /api/whatsapp`
- the sample text is persisted into `public.whatsapp_messages`

This proves the deployed text-ingestion database path for Meta's dashboard sample.

The credentialed provider harness also passed on 2026-09-21 and verified the synthetic media path end to end: Meta media upload/retrieval/download -> signed document webhook -> deployed Vercel endpoint -> private Supabase Storage -> database Storage path -> byte-integrity check -> cleanup.

Real inbound WhatsApp delivery from Meta to the custom callback is now verified.

On 2026-09-21:

- a real inbound text reached `POST /api/whatsapp` and logged `storedCount: 1`
- a real inbound PDF/document reached `POST /api/whatsapp` and logged `messageTypes: ['document']`, `storedCount: 1`, and `ignoredCount: 0`

Because `lib/ingest.ts` returns `stored` for media only after Meta media download, private Supabase Storage upload, and database finalization all succeed, the real PDF event verifies the complete Milestone 1 media path.

Milestone 1 is accepted.

## Current modules

### `app/api/whatsapp/route.ts`

Responsibilities:

- Meta GET verification
- reads raw POST body
- verifies `x-hub-signature-256`
- parses JSON only after signature validation
- normalizes WhatsApp messages
- hands individual messages to ingestion

### `lib/signature.ts`

Responsibilities:

- HMAC-SHA256 verification for Meta webhook POST requests
- timing-safe comparison

### `lib/whatsapp.ts`

Responsibilities:

- runtime webhook shape validation with Zod
- extract/normalize inbound message records
- map text and supported media metadata into an internal type

### `lib/meta.ts`

Responsibilities:

- fetch media metadata from Meta Graph API
- download media bytes using the access token
- enforce configured maximum media size

### `lib/ingest.ts`

Responsibilities:

- enforce optional sender allowlist
- enforce optional destination Phone Number ID check
- upsert message metadata into Supabase
- download supported media
- upload media to private Supabase Storage
- update processing state

### `lib/supabase-admin.ts`

Responsibilities:

- construct the server-only Supabase client

### `lib/env.ts`

Responsibilities:

- runtime validation of server environment configuration
- convert allowed sender string into a Set
- expose non-secret health configuration status

### `app/api/health/route.ts`

Responsibilities:

- report whether required environment variables are configured
- never return actual secret values

### `app/privacy/page.tsx`

Responsibilities:

- provide the public Solar Ops privacy policy required for Meta app publishing
- explain the inbound WhatsApp data flow and current receive-only scope
- disclose Meta, Vercel, and Supabase as service providers
- describe retention, security, sharing, and data-request handling without exposing secrets

### `scripts/integration/helpers.mjs`

Responsibilities:

- build synthetic text/document webhook fixtures
- generate a tiny synthetic PDF
- sign webhook bodies for controlled integration requests
- hash fixture bytes
- redact sensitive values from reports
- extract only safe Meta Graph error type/code/subcode/message diagnostics
- render the Markdown integration report

### `scripts/integration/run-whatsapp-e2e.mjs`

Responsibilities:

- verify deployed health and security-filter presence
- verify invalid-signature rejection
- verify sender allowlist and destination Phone Number ID enforcement
- verify text persistence and idempotency
- upload/retrieve/download a synthetic PDF through Meta Cloud API
- submit a signed synthetic document event to the deployed webhook
- verify Supabase row, private bucket, Storage path, and file-byte hash
- clean up synthetic database, Storage, and Meta media fixtures
- write redacted JSON and Markdown reports

### `.github/workflows/integration.yml`

Responsibilities:

- expose the credentialed suite only through manual `workflow_dispatch`
- inject provider credentials through GitHub Actions secrets
- force fixture cleanup
- upload the redacted integration report as a workflow artifact

## Data model

Current SQL source:

`supabase/schema.sql`

Primary table:

`public.whatsapp_messages`

Important properties:

- `whatsapp_message_id` is unique
- RLS is enabled
- no anon/authenticated policies are created
- server-side key is expected for webhook writes
- status values currently allowed:
  - `received`
  - `stored`
  - `failed`
  - `ignored`

## Storage

Expected bucket:

`whatsapp-media`

The bucket was created as private by the user during live setup.

The credentialed synthetic-media harness has verified upload/download through the private bucket, including SHA-256 byte-integrity checks and cleanup. A real Meta-delivered inbound PDF has also been verified through the deployed webhook.

Current path strategy is approximately:

`<sender>/<year>/<month>/<hashed-message-id>/<filename>`

## Environment variables currently referenced by source

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `META_APP_SECRET`
- `META_GRAPH_API_VERSION`
- `ALLOWED_WHATSAPP_SENDERS`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `MAX_MEDIA_BYTES`

Do not rename these without updating source, `.env.example`, README, and documentation together.

## Important boundary

Current source implements deterministic PDF document parsing and manual operator replies, but still has no:

- OCR pipeline for scanned/image-only PDFs
- stock/inventory mutation model
- company master-data model
- driver model
- porter model
- customer dashboard
- automatic WhatsApp reply path
- template-message path outside the customer-service window
- production-grade multi-user authentication

Do not describe those missing capabilities as existing features.


## Temporary media retention

Milestone 2A adds a low-cost raw-media lifecycle.

### `scripts/maintenance/media-retention.mjs`

Responsibilities:

- validate Supabase maintenance configuration
- calculate the retention cutoff
- query only successfully stored media with a non-null Storage path
- delete eligible private Storage objects
- clear `storage_path` only after successful object deletion
- leave failed items retryable
- emit count-only reports with no customer identifiers or file paths

Defaults:

- retention target: 24 hours
- maximum rows per run: 500
- Storage bucket: `whatsapp-media`

### `.github/workflows/media-retention.yml`

Responsibilities:

- run the cleanup once per day
- reuse the protected `integration` environment Supabase secrets
- allow explicit manual runs
- prevent overlapping cleanup runs
- upload a non-sensitive retention report artifact

The workflow is scheduled for 21:00 UTC daily. GitHub scheduling may be delayed, so the 24-hour value is a cutoff target rather than a guaranteed exact deletion time.

The retention workflow itself does not require changing the existing `whatsapp_messages` row shape. After successful deletion, the message row remains and only `storage_path` is cleared. Separate additive tables now hold structured document drafts/items and outbound-message state.


## Internal operations dashboard

A mobile-first internal verification UI is implemented at:

`/ops`

### Authentication

`lib/ops-auth.ts` provides:

- timing-safe access-key comparison
- optional dedicated `OPS_ACCESS_KEY`
- temporary fallback to `WHATSAPP_VERIFY_TOKEN` when no dedicated dashboard key is configured
- HMAC-signed, expiring session cookies using the existing server-side Meta app secret
- HttpOnly + SameSite=Strict cookie settings
- same-origin validation for state-changing POST requests

No Supabase secret or Meta access token is sent to the browser.

### Data access

`lib/ops-data.ts` performs server-only reads through the existing Supabase admin client and validates returned row shapes with Zod.

The dashboard renders the latest accepted messages, high-level counts, masked sender references, processing state, file availability, and approximate 24-hour cleanup eligibility.

### File preview

`GET /api/ops/media/[id]`:

- requires a valid operations session
- validates the message id
- resolves the current private Storage path
- creates a 5-minute Supabase signed URL server-side
- redirects the authenticated browser to that temporary URL

The bucket remains private.

### Manual deletion

`POST /api/ops/media/[id]/delete`:

- requires a valid operations session
- requires same-origin POST
- allows deletion only for successfully stored media
- removes the Storage object first
- clears `storage_path` only after Storage deletion succeeds
- preserves the WhatsApp message row and metadata

This web dashboard is internal only. It is not a customer portal.

The stable production alias may still be serving the earlier deployed revision until Vercel allows the next production build. Repository CI success does not by itself prove the new Milestone 2C source is live.


## Structured document parsing

`lib/pdf-extract.ts` uses `unpdf` to extract positioned PDF text and reconstruct text lines without binding parsing to exact page coordinates. Untrusted PDF work is bounded by page count, extracted-text length, image allocation, and a timeout.

`lib/document-parser.ts` applies deterministic labels/anchors. Missing values remain null. Documents without a usable text layer become `needs_ocr`.

`lib/document-processing.ts` stores bounded extracted text plus structured data in `document_drafts` and `document_items`. Approved drafts are not silently overwritten.

New PDFs are parsed after successful private Storage persistence. Parser failure does not turn a successfully stored WhatsApp document into an ingestion failure.

No stock table is changed by parsing or approval.

## Manual WhatsApp replies

`lib/meta-messages.ts` sends operator-authored text replies through Meta's phone-number `/messages` endpoint and includes the stored inbound WhatsApp message ID as reply context.

`lib/replies.ts` derives recipients server-side, enforces the latest-inbound 24-hour service window, uses request IDs for send idempotency, persists outbound state, and applies timestamped Meta status webhooks.

Outbound state is stored in `whatsapp_outbound_messages`.

The main webhook processes both inbound messages and outbound message-status notifications.

## WhatsApp-style operations UI

The protected `/ops` surface groups messages by hashed conversation keys and renders inbound/outbound bubbles. Document messages can expose structured fields/items plus parse, approve, private-view, and delete actions. The composer is enabled only while the 24-hour service window is open.

Full phone numbers are not placed in dashboard URLs.
