# Decisions

## D001 - Preserve the WhatsApp workflow

Decision: The operator will not be required to enter the same information into another app.

Reason: A previous stock/dispatch app was abandoned because manual duplicate data entry created too much friction.

## D002 - WhatsApp is the initial user interface

Decision: The first interaction is simply forwarding a message/document to the Solar Ops WhatsApp destination.

Reason: This matches the existing behavior and reduces adoption risk.

## D003 - Internal operations system before customer SaaS

Decision: Build an internal ingestion/operations foundation first.

Reason: The business value is the operational network and coordination, not forcing client companies to adopt software.

## D004 - Inbound first, no automatic replies

Decision: Milestone 1 receives and stores messages only.

Reason: It reduces cost, permissions, complexity, and accidental customer-facing behavior.

## D005 - Supabase as persistence layer

Decision: Use Supabase Postgres for metadata and private Storage for media in the prototype.

Reason: It offers a simple low-cost managed backend and the user already understands the ecosystem.

## D006 - Next.js + TypeScript

Decision: Use Next.js App Router and TypeScript rather than a static HTML/CSS project.

Reason: The solution needs server endpoints, provider integrations, validation, and a maintainable path to a future operational dashboard.

## D007 - Vercel as prototype runtime

Decision: Target Vercel Functions for the initial hosted webhook.

Reason: It integrates with GitHub and supports Next.js server routes.

Note: Hosting-plan suitability for long-term commercial production must be reviewed separately.

## D008 - Private media

Decision: Incoming PDFs/images/business documents are private by default.

Reason: They may contain commercially sensitive information.

## D009 - Idempotency by WhatsApp message ID

Decision: `whatsapp_message_id` is unique.

Reason: Webhook providers may retry delivery.

## D010 - No OCR-driven stock update without confirmation

Decision: Future OCR may create a draft, but it must not silently mutate stock until a later explicit business rule is approved.

Reason: Invoice/OCR mistakes could corrupt operational inventory.

## D011 - Do not expose internal margins by default

Decision: Future customer-facing views, if added, must not expose porter/driver/vendor cost or internal margin unless the business intentionally chooses to disclose it.

Reason: Internal procurement/operating data is not inherently customer-facing information.

## D012 - Unknown provider details must be verified

Decision: Provider-version assumptions must not be invented.

Current concern: `META_GRAPH_API_VERSION` is presently defaulted in source. Before production, the exact supported/current Meta Graph API version must be verified against official Meta documentation and then intentionally pinned.
