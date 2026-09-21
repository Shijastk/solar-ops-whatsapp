# Live Setup Runbook

Status: required before Milestone 1 can be called end-to-end complete.

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

The current connected Vercel tools in this session can inspect existing projects, but no project-creation action is available. Therefore the first project import is a manual account-level action.

### B1. Import the GitHub repository

In Vercel:

`Add New -> Project -> Import Git Repository`

Select:

`Shijastk/solar-ops-whatsapp`

Expected framework:

`Next.js`

Do not override the build command unless a real build issue requires it.

### B2. Add environment variables

Before the first live integration test, add:

```text
WHATSAPP_VERIFY_TOKEN=<your-long-random-value>
WHATSAPP_ACCESS_TOKEN=<Meta test access token>
WHATSAPP_PHONE_NUMBER_ID=<Meta test phone number ID>
META_APP_SECRET=<Meta app secret>
META_GRAPH_API_VERSION=v26.0

ALLOWED_WHATSAPP_SENDERS=<test sender digits only>

SUPABASE_URL=<Supabase project URL>
SUPABASE_SECRET_KEY=<Supabase server-side secret>
SUPABASE_STORAGE_BUCKET=whatsapp-media
MAX_MEDIA_BYTES=15728640
```

For `ALLOWED_WHATSAPP_SENDERS`, use digits only.

Example format:

`919876543210`

Do not include `+`, spaces, or hyphens.

### B3. Deploy

Deploy the project.

After deployment, record the public deployment hostname.

Do not consider deployment alone proof that WhatsApp ingestion works.

## Phase C - Pre-Meta health check

Open:

`https://<deployment-domain>/api/health`

Expected:

- HTTP 200
- `ok: true`
- `configured: true`

The endpoint must not reveal secret values.

If it returns HTTP 503 or `configured: false`, fix Vercel environment variables before configuring Meta.

## Phase D - Meta webhook

In the existing Meta app:

`Solar Ops Prototype`

Configure the WhatsApp webhook callback URL as:

`https://<deployment-domain>/api/whatsapp`

Use the exact same value for the Meta Verify Token as:

`WHATSAPP_VERIFY_TOKEN`

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

## Known temporary limitation

The Meta access token used during the test setup may be temporary.

Do not treat the test token as the final production credential.

Production credential lifecycle will be handled only after the prototype path is proven.
