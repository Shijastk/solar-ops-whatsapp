# Testing

## Current status

Meta's built-in test environment has already demonstrated:

- inbound text from the user's WhatsApp to the Meta test number
- inbound PDF/document
- Meta displaying the webhook payload in its test viewer

The custom repository webhook has not yet been proven end-to-end against Vercel + Supabase.

## Required quality commands

When a runnable checkout is available:

```bash
npm install
npm run typecheck
npm run lint
npm run build
```

Do not claim these passed unless they were actually executed successfully.

## Milestone 1 end-to-end test

### Test A - health

Request:

`GET /api/health`

Expected after environment configuration:

- HTTP 200
- `ok: true`
- `configured: true`
- no secret values returned

### Test B - Meta verification

Configure Meta callback URL to:

`https://<deployment>/api/whatsapp`

Use the exact same verify token in Meta and Vercel.

Expected:

- Meta webhook verification succeeds

### Test C - text

Send:

`Hello`

Expected:

- HTTP webhook processing succeeds
- exactly one database row for the WhatsApp message ID
- `message_type = text`
- text body stored
- `processing_status = stored`

### Test D - PDF/document

Forward a small PDF.

Expected:

- one message row
- `message_type = document`
- original filename retained when supplied
- media downloaded server-side
- media uploaded to private `whatsapp-media` bucket
- internal `storage_path` stored
- `processing_status = stored`

### Test E - duplicate delivery

Replay the same valid webhook payload if a safe replay mechanism is available.

Expected:

- no second row for the same `whatsapp_message_id`

### Test F - invalid signature

Send a POST that does not contain a valid Meta signature.

Expected:

- request rejected
- no data written

### Test G - disallowed sender

When `ALLOWED_WHATSAPP_SENDERS` is configured, send from a number not on the allowlist.

Expected:

- no operational data stored for that sender
- handler returns without exposing secrets

## Test data safety

Use test documents that contain no sensitive customer information until the storage/security path has been verified.

## Future automated tests

Before Milestone 2, add focused tests around:

- payload normalization
- signature verification
- duplicate handling
- filename sanitization
- sender allowlist
- media-size rejection
