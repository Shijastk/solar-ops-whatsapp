# Live Operational Intent Evaluation

The live intent evaluation is a manual-only GitHub Actions workflow:

`.github/workflows/live-agent-intent-evaluation.yml`

It sends a small, fixed set of synthetic Malayalam, Manglish, and English queries to the configured Groq intent-classification model. It does not use production business data, query Supabase, change inventory/trips/bills, or send WhatsApp messages.

## Prerequisite

Configure `GROQ_API_KEY` as a secret in the GitHub Actions environment named `integration`. The workflow checks that the secret is present without printing it. Never commit the key or paste it into a report.

## Run

1. Open the repository's **Actions** tab.
2. Select **Live Agent Intent Evaluation**.
3. Choose **Run workflow** on the default branch.
4. Inspect the job summary and download the `solar-ops-agent-intent-evaluation` artifact.

The workflow is manual-only so routine CI does not make provider calls or incur unexpected usage.

## Evaluation gates

The test matrix currently contains 16 synthetic utterances across Malayalam, Manglish, and English. The workflow requires:

- At least 85% exact intent accuracy.
- Every explicit trip-start example to classify as `start_trip`.
- Zero false-positive `start_trip` classifications for all non-trip-start examples, including status/history and future-planning questions.
- Correct extraction of the named driver and yesterday flag in the corresponding example.
- Non-empty user-language fallback text for unsupported queries.
- `reply: null` for supported operational intents, so the model does not invent a live-data answer.

A pass evaluates intent classification and output shape only. It does not prove that live database results, WhatsApp delivery, latency, or the full trip workflow are correct. Those require separate acceptance checks.

## Report and privacy

The artifact contains synthetic case IDs, expected/actual intent labels, aggregate accuracy, safety-gate counts, and provider error counts. It excludes the synthetic input text, model reply text, credentials, phone numbers, customer documents, and business data.

The default CI run skips the live evaluation unless `SOLAR_OPS_RUN_LIVE_AGENT_EVAL=true` is explicitly set.
