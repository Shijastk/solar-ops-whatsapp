# Credentialed Integration Testing

Status: harness implemented; a credentialed run is required before provider-dependent checks may be called verified.

Research checked: 2026-09-21.

## Purpose

Unit tests protect code behavior, but they cannot prove that the live Meta, Vercel, and Supabase accounts work together.

The credentialed integration harness exercises the deployed Milestone 1 path with synthetic test data while keeping the production security restrictions enabled.

It does **not** send a WhatsApp message to a person and it does not use customer documents.

## Provider research used by the harness

Meta's official WhatsApp Business Platform Postman workspace documents these Cloud API media operations:

- `POST /{phone-number-ID}/media` uploads media and returns a media ID.
- `GET /{media-ID}` retrieves a short-lived media URL.
- the returned media URL must be downloaded with an access token.
- `DELETE /{media-ID}` deletes uploaded media.
- `phone_number_id` can be supplied when retrieving or deleting media to bind the operation to the expected phone number.

Sources:

- https://www.postman.com/meta/whatsapp-business-platform/overview
- https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3
- https://www.postman.com/meta/whatsapp-business-platform/request/fpj02x0/retrieve-media-url
- https://www.postman.com/meta/whatsapp-business-platform/request/zsq66eh/download-media

Supabase documents server-side secret-key use for Storage and the JavaScript upload/download APIs for private buckets.

Sources:

- https://supabase.com/docs/guides/functions/storage-caching
- https://supabase.com/docs/reference/javascript/file-buckets-upload
- https://supabase.com/docs/reference/javascript/file-buckets-download
- https://supabase.com/docs/guides/storage/serving/downloads

GitHub documents manual `workflow_dispatch` workflows, encrypted Actions secrets, and workflow artifacts. The integration workflow is therefore manual-only and stores only a redacted report artifact.

Sources:

- https://docs.github.com/actions/managing-workflow-runs/manually-running-a-workflow
- https://docs.github.com/actions/concepts/security/secrets
- https://docs.github.com/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- https://docs.github.com/actions/concepts/workflows-and-actions/workflow-artifacts

## What the suite checks

The suite currently performs these checks against the deployed application:

1. `/api/health` returns healthy runtime validation.
2. `WHATSAPP_PHONE_NUMBER_ID` protection is present.
3. `ALLOWED_WHATSAPP_SENDERS` protection is present.
4. A webhook with an invalid HMAC signature is rejected.
5. A valid signed event with no messages is accepted without a write.
6. A synthetic sender not on the allowlist is ignored and not persisted.
7. A synthetic wrong Phone Number ID is ignored and not persisted.
8. A signed synthetic text message reaches the webhook and Supabase.
9. Replaying the same message ID leaves exactly one database row.
10. The configured Supabase Storage bucket is private.
11. A tiny synthetic PDF is uploaded to Meta Cloud API media storage.
12. Meta media metadata is retrieved with Phone Number ID binding.
13. The PDF is downloaded directly from Meta and hash-verified.
14. A signed document webhook containing that real Meta media ID is sent to the deployed webhook.
15. The deployed webhook downloads the media from Meta and stores it in private Supabase Storage.
16. The resulting database row is checked for stored status, filename, MIME type, size, and internal Storage path.
17. The file is downloaded from private Supabase Storage and SHA-256 compared with the original synthetic PDF.
18. Test database rows, Storage objects, and Meta media fixtures are removed.

This is deliberately broader than the normal CI suite.

## Important limitation

The harness creates a **synthetic signed webhook** using the configured Meta app secret. That proves the deployed webhook, signature verification, security filters, Meta media API, Supabase database, and private Storage work together.

It does **not** prove Meta itself delivered a real inbound WhatsApp message to the custom callback. Real inbound delivery remains a separate acceptance test when the Meta app state permits it.

## Required GitHub Actions secrets

Create a GitHub environment named:

`integration`

Then add these secrets under that environment (repository secrets also work, but environment secrets are preferred):

```text
WHATSAPP_ACCESS_TOKEN
META_APP_SECRET
WHATSAPP_PHONE_NUMBER_ID
INTEGRATION_ALLOWED_SENDER
SUPABASE_URL
SUPABASE_SECRET_KEY
```

`INTEGRATION_ALLOWED_SENDER` must be a sender that is already present in the deployed `ALLOWED_WHATSAPP_SENDERS` configuration.

Do not paste these values into documentation, issues, pull requests, Pages, or workflow inputs.

## Running from GitHub

Go to:

`GitHub -> Actions -> Credentialed Integration -> Run workflow`

Keep the default deployed URL unless intentionally testing another deployment.

The workflow is manual-only. It is not triggered by push or pull request events.

## Report

Every run writes:

```text
artifacts/integration/report.json
artifacts/integration/report.md
```

GitHub Actions uploads that directory as the artifact:

`solar-ops-integration-report`

The report contains only:

- PASS/FAIL
- check names
- durations
- safe summaries
- cleanup status
- Graph API version
- public target origin

It intentionally excludes:

- access tokens
- Meta app secrets
- sender phone numbers
- Phone Number IDs
- media IDs
- raw webhook payloads
- real documents
- Supabase credentials

Generated reports are gitignored and must not be published to GitHub Pages.

## Cleanup behavior

The GitHub workflow forces `INTEGRATION_CLEANUP=true`.

The harness attempts to remove:

- synthetic rows in `public.whatsapp_messages`
- synthetic PDF objects in the private Storage bucket
- synthetic media uploaded to Meta

Cleanup failure is included in the report and makes the integration run fail.

## Local run

The same suite can be run locally by setting the required environment variables in the shell and running:

```bash
npm run test:integration
```

Never commit a local credential file. `.env*` files are already ignored by this repository.

## Evidence rule

The existence of this workflow is not evidence that integration works.

Provider-dependent checks may be marked verified only after:

1. the manual workflow run finishes successfully,
2. the generated report shows PASS,
3. cleanup succeeds,
4. the relevant deployment and commit are identified.
