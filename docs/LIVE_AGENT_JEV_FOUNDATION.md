# Live Agent Foundation: Free-first architecture

## Goal

Turn Solar Ops WhatsApp (text and voice) into a stateful business agent that answers from live data and executes authorized business operations. This document is a design/rollout contract, not a claim that runtime integration is complete.

## Cost and hosting constraints

Do not depend on Jev or any paid API as a requirement. Do not require a dedicated VPS/GPU. Keep orchestration and business logic in the existing Next.js/Vercel + Supabase setup. Start with the existing Groq integration and its free-tier limits; evaluate other hosted inference providers only if their current free quotas, Malayalam quality, latency, and terms fit. "Open source" describes model/code licensing, not necessarily free hosted inference. Do not assume any hosted inference service will remain free or have sufficient production quota.

## Capability contract: full business CRUD, safely staged

The goal is not just a read-only chatbot. The agent should eventually support the following actions through natural Malayalam, Manglish, and English, subject to role/authorization checks and the existing business rules:

- **Create:** add a driver, create a trip, record stock movement, add supported operational records.
- **Read/search:** list drivers, find a driver, query stock, bills, trips, payments, and operational summaries from live data.
- **Update/edit:** edit a driver's name/status or other explicitly supported fields; correct a draft bill; update trip details, driver assignment, or stock records only through the established domain workflows.
- **Deactivate/delete:** deactivate a driver by default instead of hard-deleting a referenced driver; delete only records that the domain permits deleting, with impact checks and explicit confirmation. A delete request must never be interpreted as permission to delete an unrelated or ambiguous record.
- **Business workflows:** approve bills, assign/finalize trips, and record payments only through existing validated workflow functions or transaction-safe database RPCs—not generic table writes.

This is the target capability set, not a statement that every action is implemented today. Implement each action as a separately tested vertical slice. Do not expose a generic CRUD or arbitrary-SQL tool to the model.

## Agent architecture

1. Verify the WhatsApp webhook signature and sender allowlist before any agent work.
2. Load bounded conversation state keyed by authenticated sender and business scope. Never mix users or company data.
3. Resolve clear follow-ups from recent state; ask one concise question when the referent, target record, or required fields are ambiguous.
4. Use deterministic handlers for known, simple requests; call the existing language model only when interpretation/planning is needed.
5. Give the model a strict allowlist of typed business tools. The model may propose a tool call; server code independently validates the action and all arguments.
6. Each tool derives business/company scope on the server, checks authorization, validates fields, and applies idempotency. Use database transactions/RPCs for multi-row mutations and race-sensitive uniqueness.
7. Require explicit confirmation for high-impact or hard-to-reverse actions: delete, bill approval, payments, trip finalization, reassignment with operational impact, bulk edits, and stock corrections. Bind confirmation to the exact action + target + payload + sender, and expire it. Any payload change invalidates confirmation.
8. Prefer soft-deactivation for referenced directory records. Before a permitted delete, check references and explain what will be affected. Never silently cascade-delete related business data.
9. Verify committed database state before reporting success. If verification fails or is uncertain, report that honestly; do not claim success based only on a successful model response or an attempted write.
10. Persist minimal conversation state and an audit trail; apply retention limits and do not store raw audio. Conversation history is context, not an authorization source.

## Conversation state and follow-ups

Keep a short, expiring, sender-scoped context containing only what is needed to resolve follow-ups (for example, the previous intent, canonical entity IDs/names returned by the database, date/company scope, pending required fields, and a pending confirmation payload). Do not resend the full database or the full conversation to the model on every message. Load small relevant state and query only the required rows. A phrase such as "അവർ ആരൊക്കെയാണ്?" may inherit the immediately preceding driver-count intent only when that context is still valid and belongs to the same sender/business scope; otherwise ask a clarifying question. Never infer a record ID from a name alone when multiple matches exist.

## Voice-first agent UX: infer intent, minimize unnecessary turns

The user should not have to follow a rigid form-like sequence ("add a driver" → "enter name" → confirm the name) when one voice message already contains a clear, authorized instruction. Voice and text should share the same intent/action pipeline after transcription; voice is not a separate, less capable workflow.

Example: "മുഹമ്മദ് എന്ന് പേരുള്ള പുതിയൊരു ഡ്രൈവർ വന്നിട്ടുണ്ട്. ആ പേര് നിലവിൽ ഇല്ലെങ്കിൽ പുതിയ ഡ്രൈവറായി add ചെയ്യണം."

Expected behavior:
1. Transcribe the message and extract the intended action (create driver), the candidate name (Muhammad/Mohammed/മുഹമ്മദ്, retaining the original transcript for audit), and the explicit condition (only create if no matching driver exists).
2. Check current authorized business scope and query the live driver directory. Do not ask the user to type the name again.
3. Match names conservatively: normalize Unicode/spacing and known safe transliterations, but do not treat broad fuzzy similarity as proof of identity. If a unique existing record clearly matches, do not create a duplicate; report that the driver already exists. If no credible match exists, create the driver with a server-validated, idempotent operation, then read back the committed row.
4. If several existing records are plausible matches, or the transcript/name is too uncertain to safely identify the person, ask one concise clarification. Do not guess.
5. Reply briefly with the verified outcome. Do not narrate internal steps or ask for confirmation of a low-risk, explicitly requested create-if-absent action when the target name is clear and the sender is authorized.
6. If the message only says "new driver Muhammad has joined" without an explicit action request, the agent may use the product's established operational convention only if that convention is explicitly approved and documented; otherwise ask one short intent question. Never turn mere mention into permission to write.

### Risk-based confirmation, not confirmation for every step

- **May execute without an extra confirmation:** explicit, unambiguous, low-impact create-if-absent or reversible edit when the sender is authorized, the target is unique, all required values are present, and the action is covered by the approved policy.
- **Ask one clarification:** missing required data, uncertain speech-to-text, ambiguous entity match, conflicting instruction, or unclear intended operation.
- **Require explicit confirmation:** hard-delete, bill approval, payments, trip finalization, consequential reassignment, bulk changes, or other high-impact/irreversible actions. Confirmation must bind to the exact action, target, payload, sender, and expiry.
- **Never do:** invent missing values, create a record from a mere mention unless explicitly allowed by product policy, silently hard-delete referenced records, or claim success without verifying the database commit.

## First implementation slices

1. **Voice-first create-if-absent driver:** after inspecting existing creation paths and database constraints, extract intent + name from a single voice/text message, query live records, avoid duplicates, create only when clearly requested and no credible match exists, use idempotency/concurrency protection, read back after commit, and return a concise result. Do not force a separate name-entry step.
2. **Read-only follow-up context:** resolve short follow-ups such as "who are they?", "show their names", and "അതിൽ ആരൊക്കെയാണ്?" from a recent driver-count response. Fetch current active drivers from Supabase; do not use stale model memory as the source of truth.
3. **Edit/deactivate driver:** accept a complete natural-language instruction in one message; resolve a unique target and apply low-risk, reversible changes without unnecessary confirmation where policy permits. Ask one clarification only when necessary; preserve references and verify.
4. **Delete and other domain actions:** implement only after a per-action impact review and tests. Require confirmation for hard-delete and high-impact actions. Prefer deactivation for referenced records. Never expose general-purpose SQL or generic table/column mutation.
5. **Broader operational tools:** add trip, bill, stock, and payment actions one by one by reusing current business workflows; do not bypass stock ledgers, bill approval rules, trip grouping, or payment audit trails.

No new write action should be enabled in production until its tests cover sender authorization, company scoping, duplicate targets, malformed inputs, retries/replayed webhooks, concurrent requests, expired/forged confirmation, prompt injection, database failure, and failed/uncertain read-back.

## Evaluation before changing model/provider

Create a fixed, redacted Solar Ops evaluation set:
- Malayalam, Manglish, and English;
- direct questions and follow-ups such as "അവർ ആരൊക്കെയാണ്?";
- missing or ambiguous references;
- create/edit/deactivate/delete driver;
- stock, trip, bill, and payment actions;
- duplicate/replayed webhook deliveries;
- prompt injection and unauthorized senders.

Benchmark the existing Groq flow against deterministic routing + bounded state + the existing model, then optional free-tier providers if viable. Record p50/p95 latency, intent/argument accuracy, clarification rate, unsafe-action rate, and cost per successful task. Do not repeat vendor speed claims as Solar Ops measurements. Do not add another provider unless it beats the baseline on a documented metric without reducing Malayalam accuracy or safety.

## Rollout

Feature-flag the new path. Run offline tests, then shadow decisions without writes, then restricted sender allowlist tests, then expand only after accuracy and safety gates pass. Keep the existing flow as a rollback path. Do not change production data or enable writes merely because a PR exists. Prefer the smallest reliable state-machine/tool loop; adopt LangGraph or another orchestration framework only if a prototype proves the benefit outweighs added complexity.


## Implementation log — 2026-10-18

### Stock inventory read slice (branch: `agent/stock-query-agent`)

- Adds a bounded read-only intent for broad stock-list questions in Malayalam, Manglish, and English, alongside the existing product-specific stock-balance lookup.
- The answer is retrieved from the live `stock_balances` view, ordered by company/product and limited to 20 displayed rows (with one extra row used only to detect truncation).
- Unknown/un-counted balances remain explicitly labelled; the model does not supply quantities or invent products.
- This slice does not write stock, create aliases, approve bills, or bypass the immutable stock ledger.
- Automated verification is pending until the branch's actual CI run completes. Production/live WhatsApp behavior is not claimed as verified by unit tests.


### Natural-language trip start slice — branch `agent/natural-language-trip-start` (2026-10-18)

- Clear English, Manglish, and Malayalam start phrases are handled deterministically first. Other likely trip-start requests are sent to the existing strict, token-bounded Groq intent classifier; the classifier returns only `start_trip` plus an optional explicitly named driver, never SQL or business facts.
- A named driver is resolved by exact normalized match against active `ops_drivers`. If the requested driver is missing/ambiguous, no trip is created. If no driver is named, the existing `collecting` workflow starts and waits for PDFs plus the existing done/driver-selection steps.
- The existing partial unique index on active trips per sender is the duplicate guard; a concurrent uniqueness conflict is handled as “trip already open,” not as a second trip.
- This reuses the existing `delivery_trips` schema and requires no new migration. The existing trip workflow, not the model, performs the database write.
- Handler tests cover successful start, exact driver matching, unknown-driver rejection, read-query rejection, prompt injection, malformed names, replayed start messages, read-back failure, database failure, concurrent duplicate prevention, and the default-off rollout flag. Successful writes are read back by sender + inbound message ID before the agent claims success. CI is pending for this branch; production WhatsApp behavior is not yet claimed as verified.


### Rollout boundary for natural-language trip creation

`SOLAR_OPS_NATURAL_TRIP_START_ENABLED` must remain off by default. Existing exact `trip` / `New Trip` commands are unchanged. The new phrase classifier and semantic `start_trip` path run only when this dedicated flag is the literal string `true`. Do not turn it on merely because CI passes; first verify the production deployment, then run a restricted operator-controlled WhatsApp acceptance test. No production environment setting is changed by this code PR.
