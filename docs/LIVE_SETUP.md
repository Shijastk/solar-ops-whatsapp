# Live Setup Runbook

Status: Vercel deployment, webhook verification, and Meta dashboard sample text -> Supabase database write verified. Real inbound text and media storage remain pending.

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

Verified complete on 2026-09-21.

Expected/verified table:

`public.whatsapp_messages`

### A3. Create private Storage bucket

In Supabase:

`Storage -> New bucket`

Use:

- Bucket name: `whatsapp-media`
- Public bucket: **OFF**

Verified created by the user on 2026-09-21.

### A4. Collect server-side values

Keep these values in Vercel only:

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

Runtime validation is currently healthy.

Normal prototype configuration includes:

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

Important temporary test state:

- `ALLOWED_WHATSAPP_SENDERS` was removed temporarily.
- `WHATSAPP_PHONE_NUMBER_ID` was removed temporarily.

Restore both values before broader live/production testing.

### B3. Deployment

Verified production deployment state:

`READY`

## Phase C - Pre-Meta health check

Verified complete on 2026-09-21.

Endpoint:

`https://solar-ops-whatsapp.vercel.app/api/health`

Observed after the current temporary test configuration:

- HTTP 200
- `ok: true`
- `configured: true`
- webhook validation true
- ingestion validation true
- no invalid fields
- no secret values returned

## Phase D - Meta webhook

Verified complete on 2026-09-21.

Meta app:

`Solar Ops Prototype`

Callback:

`https://solar-ops-whatsapp.vercel.app/api/whatsapp`

Verified:

- Meta GET verification returned HTTP 200.
- `messages` webhook field is subscribed.
- Meta dashboard `messages` test reaches the custom POST endpoint.

## Phase E - End-to-end test

### E1. Dashboard sample text

Verified on 2026-09-21.

Observed:

- Meta dashboard sent one text message event.
- Vercel returned HTTP 200.
- processing summary: one text, stored 1, ignored 0.
- user confirmed a row appeared in `public.whatsapp_messages`.

This proves the custom dashboard test -> Vercel -> Supabase database write path.

It is not equivalent to a real inbound WhatsApp message through the custom webhook.

### E2. Real inbound text

Pending.

Expected:

- one row in `public.whatsapp_messages`
- `message_type = text`
- text body stored
- `processing_status = stored`

### E3. PDF/media

Pending.

Expected:

- one new database row
- `message_type = document`
- original filename when Meta supplies it
- `processing_status = stored`
- non-null internal `storage_path`

Expected in Storage:

- the PDF exists inside private bucket `whatsapp-media`

### E4. Duplicate behavior

Pending.

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

Verified now:

- CI/deployment/health
- custom webhook verification
- dashboard sample text persisted into Supabase

Still pending:

- real inbound text on the custom webhook
- real PDF/media download and private Storage upload

## Known temporary limitation

The Meta access token used during the test setup may be temporary.

Do not treat the test token as the final production credential.

Production credential lifecycle will be handled only after the prototype path is proven.
