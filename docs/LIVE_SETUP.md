# Live Setup Runbook

Status: Milestone 1 complete. Vercel deployment, webhook verification, app publishing, WABA subscription, real inbound text, real inbound PDF/document handling, security filters, private Storage, and credentialed provider integration are verified.

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

# Optional verified-document automation
DOCUMENT_AUTOMATION_ENABLED=false
GROQ_API_KEY
GROQ_MODEL=openai/gpt-oss-20b
GROQ_TIMEOUT_MS=7000
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

## Phase E - Controlled credentialed integration

Before a real inbound test, the repository can run a synthetic provider-level integration without disabling security filters.

Setup and workflow:

`docs/INTEGRATION_TESTING.md`

The manual GitHub Actions workflow checks:

- health and security-filter presence
- invalid signature rejection
- sender allowlist enforcement
- destination Phone Number ID enforcement
- text persistence and idempotency
- Meta media upload/retrieve/download
- private Supabase Storage
- document ingestion and byte integrity
- fixture cleanup

This suite does not send a WhatsApp message to a person and does not replace the final real-inbound acceptance test.

## Phase F - Real end-to-end test

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

Verified on 2026-09-21.

Observed:

- real Meta callback reached the deployed webhook
- one text message was accepted
- `storedCount = 1`
- the database row was persisted

### E3. PDF/media

Verified on 2026-09-21.

Observed:

- a real PDF/document callback reached the deployed webhook
- `message_type = document`
- `storedCount = 1`
- the database row has a non-null internal `storage_path`
- Supabase inspection confirms the private bucket contains the stored object

### E4. Duplicate behavior

Verified by the credentialed provider integration suite.

The same WhatsApp message ID does not create a second row when the event is replayed.

## Phase G - Evidence before declaring success

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
- sender allowlist and destination Phone Number ID restored and present in live health

Verified credentialed integration:

- workflow run `35578308664` -> PASS
- Meta media upload/retrieve/download -> PASS
- signed synthetic document webhook -> deployed Vercel endpoint -> PASS
- private Supabase Storage persistence -> PASS
- byte-integrity verification -> PASS
- Meta/Supabase cleanup -> PASS

Real inbound acceptance completed:

- real WhatsApp text -> Meta -> Vercel -> Supabase: PASS
- real WhatsApp PDF/document -> Meta -> Vercel -> private Supabase Storage + finalized database row: PASS

Milestone 1 is accepted.

## Known temporary limitation

The Meta access token used during the test setup may be temporary.

Do not treat the test token as the final production credential.

Production credential lifecycle will be handled only after the prototype path is proven.


## Media retention maintenance

A daily GitHub Actions workflow named `Media Retention` removes successfully processed raw media after the 24-hour cutoff.

It uses the existing `integration` environment secrets:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

No additional provider credential is required.

The workflow stores only a count-based report artifact. It must not log customer filenames, Storage paths, phone numbers, message payloads, or document contents.


## Internal operations dashboard

Dashboard:

`https://solar-ops-whatsapp.vercel.app/ops`

The page requires an operations session.

Preferred login configuration:

`OPS_ACCESS_KEY`

If it is not configured, the prototype temporarily accepts the existing webhook verify token as the dashboard access key.

Available files are opened using a 5-minute signed Supabase URL generated only after server-side session validation.

The dashboard also provides authenticated manual deletion for raw files. Message rows and metadata remain after file deletion.

## Phase H - Optional verified-document automation

Do not enable this feature until the corresponding database migration is applied and the production code deployment is READY.

### H1. Groq privacy control

In the Groq Console, open Data Controls and enable Zero Data Retention before sending real business document text to the verifier.

Do not paste the Groq API key into chat, GitHub, documentation, issues, or client-side code.

### H2. Vercel server environment

Add the production server-side secret:

`GROQ_API_KEY`

Keep:

`GROQ_MODEL=openai/gpt-oss-20b`

`GROQ_TIMEOUT_MS=7000`

Only after ZDR and the key are ready, set:

`DOCUMENT_AUTOMATION_ENABLED=true`

A deployment/redeployment must use the updated environment before the feature is considered enabled.

### H3. Health

`/api/health` reports an `automation` validation object without exposing the key.

Core `configured` health remains based on webhook + ingestion, so an optional automation setup problem cannot hide the fact that inbound capture itself is healthy.

### H4. Safe live acceptance

Use a non-sensitive selectable-text PDF.

Expected:

- deterministic parser completes
- Groq independently extracts the full persisted draft
- exact normalized agreement + arithmetic checks => `recorded / verified`
- one WhatsApp summary arrives with Edit/Delete controls
- summary reports stock applied or pending accurately
- Edit -> choose field -> send corrected value => `manual_override` plus audit row
- Delete -> confirmation => `cancelled`, not hard-deleted
- any mismatch/provider failure => `review_required`, no silent auto-record
- when Opening Stock is configured and every stock check passes, the outgoing bill creates one idempotent Stock OUT

Do not describe this provider flow as live-verified until those observations are made on the production deployment.


## Phase I - Opening Stock and outgoing inventory

### I1. One-time setup

Open:

`https://solar-ops-whatsapp.vercel.app/ops/stock`

Use the protected operations login.

For each existing warehouse product:

1. choose an existing company or create the company once
2. include GSTIN when available because it is a strong company identifier
3. enter the canonical product name
4. select the canonical unit
5. enter HSN/SAC when known
6. enter the current physical Opening Stock quantity

Opening Stock cannot be silently overwritten.

### I2. Safe outgoing acceptance

With a non-sensitive test product:

1. Opening Stock = 100
2. send/approve an outgoing bill quantity 30
3. expected balance = 70
4. replay the same webhook/document
5. expected balance remains 70

### I3. Spelling mismatch

Send a bill whose product description intentionally differs from the configured canonical/alias text.

Expected:

- no stock deduction
- WhatsApp receives a product-mapping list
- operator selects the correct product
- the alias is remembered
- the full bill is retried
- balance changes only after the mapping is accepted

The same rule applies to a company-name mismatch when GSTIN does not already identify it.

### I4. Insufficient stock

With available stock lower than the bill requirement:

Expected:

- WhatsApp reports required and available quantities
- zero Stock OUT rows from that bill
- balance unchanged

### I5. Edit and Delete

After successful Stock OUT:

- decrease/increase bill quantity through WhatsApp Edit
- verify the difference is represented by a correction ledger entry
- an increase beyond available stock must be rejected without changing the old quantity
- Delete must restore the bill's net deduction through a reversal before marking the document cancelled

Do not call this inventory flow production-live-verified until these observations are completed after deployment.


Opening Stock GSTIN input is optional.

For clipboard safety, the server normalizes Unicode with NFKC and accepts a GSTIN only when it can resolve one unambiguous standard GSTIN-shaped value. This supports:

- the exact 15-character GSTIN typed normally
- spaces/punctuation/invisible characters around pasted text
- NFKC-compatible full-width characters
- a copied label such as `GSTIN: 32ABMCS6908B1ZG`

If more than one GSTIN-shaped value is present, or no valid standard shape can be resolved, the request is rejected rather than guessed.

On validation failure the server logs only non-sensitive diagnostics such as raw/normalized lengths, candidate count, and shape-valid boolean. It must never log the GSTIN value itself.


## Phase J - Stock UI and adjustment acceptance

After deploying the stock-management client layer:

1. open `/ops/stock` while authenticated
2. confirm the saved product appears in Current stock
3. click **Adjust** on the existing product
4. set a new target physical quantity
5. save and confirm the row updates without a normal browser document reload
6. refresh the browser manually and confirm the adjusted quantity persists
7. verify the ledger contains an `adjustment` delta while the original Opening Stock movement remains unchanged
8. set the same quantity again and confirm no extra adjustment movement is required

Opening Stock remains the one-time starting point for a new product. Use **Adjust** for later physical-count corrections.

The temporary GSTIN debugging metadata used during the earlier investigation has been removed; validation errors remain bounded and must not log the GSTIN value.


## Phase K - Mobile stock UI acceptance

After the mobile-first stock redesign is deployed:

1. open `/ops/stock` on a phone-width viewport
2. confirm Current stock is the first working section
3. confirm each stock row shows company, product, unit/HSN, current quantity, and Adjust without horizontal page scrolling
4. open Adjust and confirm Save/Cancel controls are comfortably tappable
5. scroll to Add opening stock and confirm form fields fit the viewport at one-column mobile width
6. confirm the stock surface is light while the separate WhatsApp operations surface retains its existing theme
7. repeat Add/Adjust and confirm successful actions still refresh data without a normal document reload

No external design library is required for this acceptance.
