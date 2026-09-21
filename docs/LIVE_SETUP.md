# Live Setup Runbook

Status: Vercel deployment and health check verified. Meta custom webhook + Supabase end-to-end capture still pending.

This runbook intentionally separates account-level manual actions from code changes.

## Safety rules

- Never paste Meta access tokens, Meta app secrets, Supabase secret keys, or Vercel secrets into chat.
- Never commit secrets to GitHub.
- Use Vercel Environment Variables for server-side secrets.
- Keep the Supabase media bucket private.
- Use only non-sensitive test documents until the end-to-end path is verified.

## Phase A - Supabase

### A1. Create or select the project

Create a Supabase project for Solar Ops.

### A2. Apply the database schema

In Supabase:

`SQL Editor -> New query`

Open this repository file:

`supabase/schema.sql`

Run the complete SQL file.

Expected table:

`public.whatsapp_messages`

Important expected constraint:

`whatsapp_message_id` must be unique.

### A3. Create private Storage bucket

In Supabase:

`Storage -> New bucket`

Use:

- Bucket name: `whatsapp-media`
- Public bucket: **OFF**

Do not make this bucket public.

### A4. Collect server-side values

Keep these values ready for Vercel:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Do not send them in chat.

## Phase B - Vercel

### B1. Import the GitHub repository

Verified complete on 2026-09-21.

Project:

`solar-ops-whatsapp`

Framework:

`Next.js`

Stable production alias:

`https://solar-ops-whatsapp.vercel.app`

### B2. Environment variables

Verified through the non-secret health endpoint that the required runtime configuration is present.

Required configuration includes:

```text
WHATSAPP_VERIFY_TOKEN
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
META_APP_SECRET
META_GRAPH_API_VERSION=v26.0
ALLOWED_WHATSAPP_SENDERS

SUPABASE_URL
SUPABASE_SECRET_KEY
SUPABASE_STORAGE_BUCKET=whatsapp-media
MAX_MEDIA_BYTES=15728640
```

Secret values must remain only in Vercel/account configuration.

### B3. Deployment

Verified production deployment state:

`READY`

No Vercel runtime errors were reported in the one-hour verification window.

## Phase C - Pre-Meta health check

Verified complete on 2026-09-21.

Endpoint:

`https://solar-ops-whatsapp.vercel.app/api/health`

Observed:

- HTTP 200
- `ok: true`
- `configured: true`
- no secret values returned

## Phase D - Meta webhook

This is the current next step.

In the existing Meta app:

`Solar Ops Prototype`

Configure the WhatsApp webhook callback URL as:

`https://solar-ops-whatsapp.vercel.app/api/whatsapp`

Use the exact same value for the Meta Verify Token as the Vercel environment variable:

`WHATSAPP_VERIFY_TOKEN`

Do not reveal or paste that token into chat.

Subscribe to the WhatsApp `messages` webhook field.

Expected:

Meta webhook verification succeeds.

## Phase E - End-to-end test

### E1. Text message

From the allowed test sender, send:

`Hello`

Expected in Supabase:

- one row in `public.whatsapp_messages`
- `message_type = text`
- `text_body = Hello`
- `processing_status = stored`

### E2. PDF

Forward a small non-sensitive PDF to the Meta test WhatsApp number.

Expected:

- one new database row
- `message_type = document`
- original filename when Meta supplies it
- `processing_status = stored`
- non-null internal `storage_path`

Expected in Storage:

- the PDF exists inside private bucket `whatsapp-media`

### E3. Duplicate behavior

The same WhatsApp message ID must not create a second row if Meta retries the event.

## Phase F - Evidence before declaring success

Milestone 1 is complete only when all of these are true:

1. GitHub Actions CI is green for the tested commit.
2. Vercel deployment is live.
3. `/api/health` reports configured.
4. Meta accepts the custom webhook.
5. A real inbound text is stored in Supabase.
6. A real inbound PDF is stored in private Supabase Storage.
7. The related database row contains its Storage path.

Current verified items: 1, 2, and 3.

## Known temporary limitation

The Meta access token used during the test setup may be temporary.

Do not treat the test token as the final production credential.

Production credential lifecycle will be handled only after the prototype path is proven.
