# Live Agent Foundation: Jev + Business Tools

## Goal

Turn Solar Ops WhatsApp (text and voice) into a stateful business agent that can answer from live data and execute approved business operations. This document defines the first safe implementation slice; it is not a claim that the agent is already implemented.

## Jev's role

Jev (TypeSafe System One) returns typed decisions and probabilities; it is not a conversational LLM and does not perform database actions. Use it only for bounded decisions that can be expressed as a fixed choice, score, or yes/no question, such as intent routing or whether a request is ambiguous enough to clarify. Keep deterministic validation and permissions in code. Never treat Jev confidence as authorization or proof that a business fact is true.

Official API: https://api.typesafe.ai/docs
Endpoint: POST https://api.typesafe.ai/v1/systemone
Model discovery: GET https://api.typesafe.ai/v1/models
Authentication: Bearer API key. Do not commit keys or send them in chat/logs.

## Proposed request path

1. Verify WhatsApp webhook signature and sender allowlist.
2. Load a small, bounded conversation state keyed by the authenticated sender and business scope. Never mix users or company data.
3. Resolve obvious follow-ups deterministically when the prior turn identifies the referent; otherwise ask one focused question.
4. Route simple supported requests to deterministic handlers; use Jev only for typed decisions and a language model for natural-language interpretation, complex planning, and concise replies.
5. Give the agent a strict allowlist of domain tools. No arbitrary SQL, generic CRUD, or model-selected table/column names.
6. Every tool validates input, derives company scope on the server, checks authorization, and applies idempotency. Use database transactions/RPCs for multi-row mutations.
7. Require explicit confirmation for high-impact or hard-to-reverse actions (bill approval, payments, deletions, trip finalization, bulk edits). Bind confirmation to the exact action payload and expire it.
8. Verify committed state from the database before telling the user an action succeeded. If verification fails or is ambiguous, report that honestly.
9. Persist minimal conversation state and an audit trail; apply retention limits and avoid storing raw audio.

## First end-to-end slice

Implement create_driver only after checking the current ops_drivers schema and all existing driver creation paths. The table currently has id, name, normalized_name, active, last_used_at, created_at, and updated_at. The first workflow must:
- extract a name, or ask for it;
- normalize and validate the name;
- detect duplicates using normalized names;
- write through a server-side validated operation with idempotency;
- read the row back after commit;
- only then send a success message;
- handle concurrent duplicate attempts safely.

Do not enable any new write operation in production until tests cover authorization, duplicates, retries, malformed inputs, and failed/uncertain commits.

## Evaluation before choosing routing defaults

Build a fixed Solar Ops evaluation set from real, redacted examples:
- Malayalam, Manglish, and English;
- direct questions and follow-ups such as “അവർ ആരൊക്കെയാണ്?”;
- missing/ambiguous entity references;
- create/update/deactivate driver;
- stock, trip, bill, and payment actions;
- duplicate/replayed webhook deliveries;
- prompt-injection attempts and unauthorized senders.

Compare current Groq classification alone vs Jev-gated routing vs deterministic rules + Jev + Groq fallback. Record p50/p95 latency, intent/argument accuracy, clarification rate, unsafe-action rate, and cost per successful task. Do not adopt vendor speed/price claims as Solar Ops results.

## Rollout

Feature-flag the new path. Run offline tests, then shadow decisions without writes, then a restricted sender allowlist, then expand only when accuracy and safety gates pass. Keep the existing flow as a rollback path. Do not make a broad framework migration (for example, LangGraph) until a small prototype proves it improves reliability and operational complexity for this app.
