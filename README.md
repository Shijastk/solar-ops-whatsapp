# Solar Ops WhatsApp Ingestion

Production-oriented prototype for receiving WhatsApp Cloud API messages and storing operational media in a private Supabase bucket.

## Stack

- Next.js 16 App Router
- TypeScript (strict)
- Meta WhatsApp Cloud API
- Supabase Postgres + private Storage
- Vercel Functions
- GitHub Actions + Vitest quality gate

## Project instructions

Before changing code, coding agents must read:

- `AGENTS.md`
- `CONTEXT.md`
- `rules.md`
- `docs/REQUIREMENTS.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/TESTING.md`
- `docs/KNOWN_ISSUES.md`
- `docs/INTEGRATION_TESTING.md` when working on live/provider integration testing

For the account-level deployment sequence, use:

`docs/LIVE_SETUP.md`

## Security

- Verifies Meta's `x-hub-signature-256` HMAC signature.
- Keeps Supabase secret key and Meta access token server-side only.
- Supports an optional sender allowlist.
- Rejects messages delivered to an unexpected WhatsApp Phone Number ID.
- Stores files in a private bucket.
- Does not expose temporary Meta media URLs.
- Uses the WhatsApp message ID as an idempotency key.

## Supabase

Run:

`supabase/schema.sql`

in Supabase SQL Editor.

Create a private Storage bucket:

- Bucket: `whatsapp-media`
- Public: **OFF**

## Required server environment variables

```text
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
META_APP_SECRET=
META_GRAPH_API_VERSION=v26.0
ALLOWED_WHATSAPP_SENDERS=

SUPABASE_URL=
SUPABASE_SECRET_KEY=
SUPABASE_STORAGE_BUCKET=whatsapp-media
MAX_MEDIA_BYTES=15728640
```

Meta Graph API is intentionally pinned to `v26.0` based on the version table verified for this project on 2026-09-21. Re-check before production rollout or when Meta publishes a v26.0 expiration date.

Never commit real environment values.

## Meta webhook

After Vercel deployment:

```text
https://<your-vercel-domain>/api/whatsapp
```

The Meta Verify Token must exactly match `WHATSAPP_VERIFY_TOKEN`.

Subscribe to the `messages` field.

## End-to-end success criteria

1. `/api/health` returns `configured: true`.
2. An inbound WhatsApp text creates a database row.
3. An inbound PDF creates a database row.
4. The PDF is stored in private `whatsapp-media`.
5. The row contains the internal Storage path.
6. GitHub Actions CI passes for the tested commit.

Full sequence:

`docs/LIVE_SETUP.md`

## Local development

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Quality gate:

```bash
npm run verify
```

CI separately runs typecheck, lint, Vitest, and the Next.js production build.

Credentialed provider integration is manual-only:

```bash
npm run test:integration
```

The GitHub Actions workflow `Credentialed Integration` uses synthetic data to test the deployed webhook, security filters, Meta media upload/retrieval/download, Supabase database persistence, private Storage, byte integrity, idempotency, and cleanup. It never sends a WhatsApp message to a person. See `docs/INTEGRATION_TESTING.md`.

## Scope

Milestone 1 intentionally does **not** include:

- OCR
- invoice extraction
- stock updates
- customer dashboards
- automatic WhatsApp replies

Those are added only after reliable inbound capture is proven.


## Temporary media retention

Raw WhatsApp media is now treated as temporary working data.

The scheduled `Media Retention` GitHub Actions workflow runs once per day and removes successfully processed Storage objects older than the 24-hour cutoff. The WhatsApp message row remains, while `storage_path` is cleared after successful deletion.

Manual/local maintenance command:

```bash
npm run maintenance:media-retention
```

The cleanup report contains counts only and must not contain customer filenames, Storage paths, phone numbers, payloads, or document contents.

The long-term direction is to retain useful structured bill/invoice data rather than raw files. Exact extraction fields are intentionally not implemented yet because those business semantics must be defined explicitly before parser/OCR output is treated as operational data.


## Operations dashboard

The internal verification dashboard is available at:

`/ops`

It is mobile-first and shows recent accepted WhatsApp messages, storage state, file size/type, masked sender reference, runtime status, and temporary-file availability.

Security:

- server-side session only
- HttpOnly + SameSite=Strict cookie
- private Supabase bucket remains private
- file previews use a 5-minute signed URL generated server-side
- raw files can be deleted manually without deleting the message row
- `OPS_ACCESS_KEY` is the preferred login key
- if `OPS_ACCESS_KEY` is not configured, the prototype temporarily falls back to `WHATSAPP_VERIFY_TOKEN`

For broader production or the future mobile app, replace the fallback with dedicated user authentication.
