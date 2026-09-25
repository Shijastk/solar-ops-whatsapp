# Project Context

## Project name

Solar Ops WhatsApp Ingestion

Repository: `Shijastk/solar-ops-whatsapp`

## Why this project exists

The user's father currently manages warehouse/godown operations for multiple solar distribution companies.

The existing working process is intentionally simple:

1. Companies send bills/documents through WhatsApp.
2. The father downloads/reads them.
3. He coordinates porters, vehicles, drivers, dispatch, and related physical operations.
4. Daily calculations are handwritten.
5. Photos/reports are sent back through WhatsApp.

A previous custom app failed in real use because it required duplicate manual data entry such as adding stock, selecting companies, and distributing bills inside another app.

The current product principle is therefore:

> Do not force the operator to adopt a new workflow. Make the software follow the existing WhatsApp workflow.

## Prototype workflow

The user forwards a bill, PDF, photo, text message, or other supported media to a dedicated WhatsApp endpoint.

The system should automatically receive it and persist it.

```text
Operator WhatsApp
      |
      | forward
      v
Meta WhatsApp test/business number
      |
      v
Meta WhatsApp Cloud API webhook
      |
      v
Next.js webhook on Vercel
      |
      +--> Supabase Postgres metadata
      |
      +--> Supabase private Storage media
```

## Business constraints

- Initial budget is effectively zero.
- The existing operational process must not be disrupted.
- Existing company relationships and current income must not be put at risk.
- The first prototype should prove automatic inbound capture before adding AI or business automation.
- Internal operating cost/margin data must not be exposed to customers by default.
- This repository is currently an internal operations prototype, not a customer SaaS product.

## Confirmed live Meta test

Milestone 1 live inbound capture was completed on 2026-09-21.

Verified real inbound path:

- the Meta app was published
- the app was subscribed to the Test WhatsApp Business Account
- a real WhatsApp text message reached the custom Vercel webhook and was stored
- a real WhatsApp PDF/document reached the custom Vercel webhook
- the document was processed with `storedCount: 1`
- the ingestion code returns `stored` for media only after Meta download, private Supabase Storage upload, and database finalization succeed

The earlier credentialed synthetic provider suite also passed, including media byte-integrity and cleanup checks.

## Current technology direction

- Next.js App Router
- TypeScript with strict checking
- Vercel Functions for the webhook
- Supabase Postgres for metadata
- Supabase private Storage for received media
- Meta WhatsApp Cloud API
- Zod for runtime validation

## Product principle

The operator should ideally perform only the action they already understand:

`Forward to Solar Ops`

Everything after that should be automated behind the scenes.


## Approved next direction - temporary raw media

After Milestone 1 acceptance, the user approved minimizing file storage.

The intended lifecycle is now:

1. Receive and process the WhatsApp document.
2. Keep the raw file only temporarily.
3. Retain useful structured/operational data long-term.
4. Automatically delete the raw Storage object after approximately 24 hours when processing succeeded.

The current source now extracts deterministic structured fields from selectable-text PDFs into review drafts, while retaining raw media only temporarily. Parser approval is intentionally separate from stock mutation because warehouse stock-direction and opening-balance rules are still a business decision.


## Approved next direction - verified document automation

The user approved a low-friction document workflow that keeps WhatsApp as the operator surface.

For selectable-text PDFs:

1. Keep the deterministic semantic parser as the first extractor.
2. Optionally run a small Groq model as an independent second extractor using strict JSON Schema output.
3. Compare every persisted structured field, every line item, and deterministic arithmetic checks.
4. Automatically mark the document workflow recorded only when the two independent extractions agree.
5. Send a concise WhatsApp summary with Edit/Delete controls.
6. Let the operator type only a corrected value after selecting a field to edit.
7. Treat Delete as cancellation from the active workflow while retaining an audit trail.

This automation is fail-closed. Scanned PDFs, missing fields, mismatches, provider errors, timeouts, or rate limits go to review. No AI result or document approval is permitted to mutate warehouse stock yet. A separate stock-IN document sample and explicit inventory rules are still required before stock automation.
