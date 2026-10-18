# Live Agent Foundation: Free-first architecture

## Goal

Turn Solar Ops WhatsApp (text and voice) into a stateful business agent that answers from live data and executes approved business operations. This is an architecture and rollout plan, not a claim that runtime integration is complete.

## Cost and hosting constraints

Do not depend on Jev or any paid API as a requirement. Do not require a dedicated VPS/GPU. Keep orchestration and business logic in the existing Next.js/Vercel + Supabase setup. Start with the existing Groq integration and its free-tier limits; evaluate other hosted inference providers only if their current free quotas, Malayalam quality, latency, and terms fit. "Open source" describes model/code licensing, not necessarily free hosted inference. Hugging Face hosted inference credits are small and subject to change, so do not assume they support production traffic for free.

## Agent architecture

1. Verify the WhatsApp webhook signature and sender allowlist.
2. Load a bounded conversation state keyed by authenticated sender and business scope. Never mix users or company data.
3. Resolve clear follow-ups from recent state; ask one concise question when the referent or required fields are ambiguous.
4. Use deterministic handlers for known, simple requests; call the existing language model only when interpretation/planning is needed.
5. Give the model a strict allowlist of typed business tools. Never expose arbitrary SQL, generic CRUD, or model-selected table/column names.
6. Each tool validates inputs, derives company scope on the server, checks authorization, and applies idempotency. Use database transactions/RPCs for multi-row mutations.
7. Require explicit confirmation for high-impact or hard-to-reverse actions (bill approval, payments, deletions, trip finalization, bulk edits). Bind confirmation to the exact action payload and expire it.
8. Verify committed database state before reporting success. If verification fails or is uncertain, report that honestly.
9. Persist minimal conversation state and an audit trail; apply retention limits and avoid storing raw audio.

## First end-to-end slice

Implement create_driver only after checking all existing driver creation paths. The current ops_drivers schema has id, name, normalized_name, active, last_used_at, created_at, and updated_at. The workflow must extract a name or ask for it, normalize and validate the name, prevent duplicate names safely under concurrent requests, apply idempotency, read the row back after commit, and only then confirm success.

Do not enable any new write operation in production until tests cover authorization, duplicates, retries, malformed inputs, and failed/uncertain commits.

## Evaluation before changing model/provider

Create a fixed, redacted Solar Ops evaluation set:
- Malayalam, Manglish, and English;
- direct questions and follow-ups such as “അവർ ആരൊക്കെയാണ്?”;
- missing or ambiguous references;
- create/update/deactivate driver;
- stock, trip, bill, and payment actions;
- duplicate/replayed webhook deliveries;
- prompt injection and unauthorized senders.

Benchmark the existing Groq flow against deterministic routing plus the existing model, then optional free-tier providers if they are viable. Record p50/p95 latency, intent/argument accuracy, clarification rate, unsafe-action rate, and cost per successful task. Do not repeat vendor speed claims as Solar Ops measurements. Do not add another provider unless it beats the baseline on a documented metric without reducing Malayalam accuracy or safety.

## Rollout

Feature-flag the new path. Run offline tests, then shadow decisions without writes, then a restricted sender allowlist, then expand only when accuracy and safety gates pass. Keep the existing flow as a rollback path. Prefer the smallest reliable state-machine/tool loop; adopt LangGraph or another orchestration framework only if a prototype proves the benefit outweighs added complexity.
