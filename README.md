# Solar Ops WhatsApp Ingestion

Production-oriented prototype for receiving WhatsApp Cloud API messages and storing operational media in a private Supabase bucket.

## Stack

- Next.js 16 App Router
- TypeScript (strict)
- Meta WhatsApp Cloud API
- Supabase Postgres + private Storage
- Vercel Functions

## Security

- Verifies Meta's `x-hub-signature-256` HMAC signature.
- Keeps Supabase secret key and Meta access token server-side only.
- Supports an optional sender allowlist.
- Rejects messages delivered to an unexpected WhatsApp Phone Number ID.
- Stores files in a private bucket.
- Does not expose temporary Meta media URLs.
- Uses the WhatsApp message ID as an idempotency key.

## 1. Supabase

Create a Supabase project.

Open **SQL Editor**, paste `supabase/schema.sql`, and run it.

Then create a private Storage bucket:

- Bucket: `whatsapp-media`
- Public: **OFF**

Get these values from Supabase:

- Project URL
- Server-side secret key (`sb_secret_...` when available)

Never expose the secret key in frontend code or commit it to GitHub.

## 2. Vercel environment variables

Add these in **Project -> Settings -> Environment Variables**:

```text
WHATSAPP_VERIFY_TOKEN=<create-a-long-random-value>
WHATSAPP_ACCESS_TOKEN=<meta-token>
WHATSAPP_PHONE_NUMBER_ID=<meta-test-number-id>
META_APP_SECRET=<Meta App Settings -> Basic -> App Secret>
META_GRAPH_API_VERSION=v26.0

ALLOWED_WHATSAPP_SENDERS=<your-number-digits-only>

SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SECRET_KEY=<server-side-secret>
SUPABASE_STORAGE_BUCKET=whatsapp-media
MAX_MEDIA_BYTES=15728640
```

Meta Graph API is intentionally pinned to `v26.0` for this prototype based on the Meta version table verified on 2026-09-21. Re-check the version before production rollout or when Meta publishes an expiration date for v26.0.

For the test sender, use digits only, for example:

```text
919876543210
```

After adding/changing Vercel environment variables, redeploy.

## 3. Meta webhook

Once deployed, use:

```text
https://<your-vercel-domain>/api/whatsapp
```

as the callback URL.

The **Verify Token** in Meta must exactly match `WHATSAPP_VERIFY_TOKEN`.

Subscribe the WhatsApp Business Account webhook to the `messages` field.

## 4. Test

1. Open `/api/health`. It should return `configured: true`.
2. Send `Hello` from the allowed WhatsApp number.
3. Forward a PDF or image to the Meta test number.
4. Check `public.whatsapp_messages` in Supabase.
5. Check the private `whatsapp-media` Storage bucket.

Expected result:

- Text message -> database row with `processing_status = stored`.
- PDF/image/audio/video/sticker -> database row + private Storage object.
- Repeated webhook delivery -> same message ID is upserted instead of creating duplicate rows.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Quality checks:

```bash
npm run typecheck
npm run lint
npm run build
```

## Notes

This repository intentionally does **not** send WhatsApp replies. The first milestone is reliable inbound capture only. OCR, invoice extraction, stock updates and dashboards should be added after the ingestion path is proven stable.
