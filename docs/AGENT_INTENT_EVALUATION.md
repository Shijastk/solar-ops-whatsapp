# Live Operational Intent Evaluation

The live intent evaluation workflow is defined in `.github/workflows/live-agent-intent-evaluation.yml`. It runs on pushes to the active query-routing PR branch and can also be started manually against an explicitly selected branch or commit.

It sends a fixed set of synthetic Malayalam, Manglish, and English queries to the configured Groq intent-classification model. It does not use production business data, query Supabase, change inventory/trips/bills, or send WhatsApp messages.

## Prerequisite

Configure `GROQ_API_KEY` as a secret in the GitHub Actions environment named `integration`. The workflow checks that the secret is present without printing it. Never commit the key or paste it into a report.

## Run

For the automatic run, push a commit to `fix/driver-query-routing-and-stock-lists` and inspect the **Live Agent Intent Evaluation** workflow associated with that exact commit. For a manual run, open **Actions → Live Agent Intent Evaluation → Run workflow** and choose the branch/commit to evaluate. The workflow checks out the selected ref (or the triggering commit SHA for push events).

## Evaluation gates

The evaluation matrix covers synthetic utterances across Malayalam, Manglish, and English. The workflow requires:

- At least 85% exact intent accuracy.
- Every explicit trip-start example to classify as `start_trip`.
- Zero false-positive `start_trip` classifications for non-trip-start examples, including status/history and future-planning questions.
- Correct extraction of the named driver and yesterday flag in corresponding examples.
- Non-empty user-language fallback text for unsupported queries.
- `reply: null` for supported operational intents, so the model does not invent a live-data answer.

A pass evaluates intent classification and output shape only. It does not prove that live database results, WhatsApp delivery, latency, or the full trip workflow are correct. Those require separate acceptance checks.

## Report and privacy

The artifact contains synthetic case IDs, expected/actual intent labels, aggregate accuracy, safety-gate counts, and provider error counts. It excludes synthetic input text, model reply text, credentials, phone numbers, customer documents, and business data.

The default CI run skips the live evaluation unless `SOLAR_OPS_RUN_LIVE_AGENT_EVAL=true` is explicitly set.
