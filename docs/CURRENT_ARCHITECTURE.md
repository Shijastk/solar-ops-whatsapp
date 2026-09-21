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

This proves the deployed text-ingestion database path for Meta's dashboard sample. Real inbound WhatsApp delivery and live media download/private Storage upload remain pending.

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

A real media upload into the bucket has not yet been verified.

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

There is currently no implemented:

- OCR pipeline
- stock/inventory model
- company model
- driver model
- porter model
- invoice parser
- authentication UI
- customer dashboard
- automated WhatsApp reply path

Do not describe any of those as existing features.
