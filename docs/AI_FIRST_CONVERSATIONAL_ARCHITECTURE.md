# Solar Ops AI-First Conversational Operations Architecture

## Status

Architecture proposal for review and staged implementation. This document does not claim that the implementation or production deployment is complete.

## Product contract

Solar Ops should feel like a natural Malayalam/Manglish/English conversation while every operational fact (stock, drivers, trips, bills, payments, company scope and status) is grounded in live authorized data.

- The model interprets intent and references; it is not the source of truth for business facts.
- Database/tool results are the only source of live operational facts.
- Replies should be concise by default and expand only when asked.
- Follow-up questions must resolve against recent context scoped to the same WhatsApp sender and business tenant.
- If the referent is unclear, ask one short clarifying question.
- If the database/tool fails or returns no evidence, say so; never fill gaps with a guess.
- The model must not execute arbitrary SQL or perform a mutation unless a separately authorized workflow explicitly allows it.

## What exists today (repository inspection)

The current project is a Next.js/TypeScript application deployed on Vercel with Supabase and WhatsApp Cloud API integration. It uses direct Groq HTTP calls for intent classification and fallback text generation (lib/whatsapp-query-intent.ts, lib/whatsapp-fallback.ts). Operational query support is a fixed intent set in lib/whatsapp-queries.ts. The fallback prompt explicitly says it has no live database facts. The voice pipeline transcribes audio, then routes it through existing document workflow/query handling (lib/ingest.ts).

This is an AI-assisted, intent-routed application today, not yet a complete context-aware conversational agent. The observed follow-up “അവർ ആരൊക്കെയാണ്?” was classified as unsupported after a driver-count question; that is evidence that cross-turn reference resolution is missing or not connected on that path.

## Recommended architecture

Keep the current Vercel + Supabase + WhatsApp stack initially. Do not introduce LangGraph as a dependency merely for its name. The official LangGraph concepts (stateful graph, persistence/checkpointing, controlled routing) are useful, but the existing TypeScript stack can implement a bounded agent loop with the Vercel AI SDK or existing provider API. Choose a framework only after a proof-of-concept comparison and latency/cost measurement.

### Request flow

1. **Ingress and identity**
   - Verify Meta webhook signature.
   - Deduplicate by WhatsApp message ID.
   - Resolve sender and tenant/business scope server-side; never trust model-supplied tenant identifiers.
   - Persist inbound text/transcript and processing metadata.

2. **Conversation context**
   - Load a small, bounded recent window for the same sender + tenant (for example, the last 6–10 turns, time-limited).
   - Store compact structured context alongside messages: last resolved intent, entity IDs (not only display names), time range, selected company/scope, and tool-result reference IDs.
   - Apply a TTL/retention policy. Never mix senders or tenants.
   - Use context only to resolve references such as “അവർ”, “അതിൽ”, “അത്”, “അവന്റെ”; it must not be treated as proof of current business facts.

3. **AI intent and reference resolution**
   - Ask the model for validated structured output, not a free-form SQL query. Example fields: intent, entities, time_range, references_previous_turn, clarification_needed, clarification_question.
   - The model can choose from an allow-listed tool registry only.
   - If an entity/reference is ambiguous, ask a short clarification instead of guessing.
   - Greetings and general questions can use a separate short conversational path that has no authority to claim live data.

4. **Allow-listed domain tools**
   - Read-only tools initially: get_active_drivers, get_driver_trips, get_stock_balance, get_bill_summary, get_trip_summary, get_pending_bills.
   - Validate all tool inputs with Zod; enforce limits, dates, company scope, authorization and query timeouts.
   - Reuse domain functions and parameterized Supabase queries; do not let the model generate executable SQL.
   - Every tool returns structured data plus provenance (table/domain function, IDs, timestamps, scope and whether data was empty/stale).

5. **Grounded response generation**
   - Give the model only the user's question, bounded relevant conversation context, and the structured tool result.
   - Require a short answer in the user's language/style.
   - Do not allow unsupported numbers, names, dates or statuses in the response.
   - Prefer deterministic templates for simple counts and small lists when that is faster and clearer; use the model to interpret the question and phrase results naturally.
   - If the tool errors or no evidence exists, use an explicit “could not verify” response.

6. **Persistence and observability**
   - Persist message ID, sender/tenant scope, resolved intent, tool names, duration, result status and reply ID.
   - Avoid logging raw audio, secrets, full phone numbers or unnecessary message contents.
   - Add traceable request IDs and bounded error messages.
   - Do not add a vector database/RAG for mutable operational facts; SQL/domain tools are the right source. Consider RAG only later for static documents/policies/manuals.

## Concise response policy

Default: answer the asked question in 1–3 short lines. Add detail only when the user asks “why/how/details”. For a follow-up, do not repeat the previous answer unless useful.

Example:
- User: “ഇപ്പോൾ എത്ര active drivers ഉണ്ട്?”
- Tool result: count 5, scope active, timestamp and driver IDs.
- Assistant: “ഇപ്പോൾ 5 active drivers ഉണ്ട്.”
- User: “അവർ ആരൊക്കെയാണ്?”
- Resolve “അവർ” to the previous active-driver set, then call get_active_drivers again or use a safely scoped recent result only if freshness policy permits.
- Assistant: provide names returned by the tool, not names inferred by the model.

For mutable values such as stock or current trip status, re-query on follow-up rather than assuming a previous result is still current. For entity-list follow-ups, preserve the prior filter but verify current data.

## Why not train the model on the database?

Operational data changes constantly. Fine-tuning is not a dependable way to provide current stock/trip/bill facts. Use the database as live tool access. Fine-tuning may be considered later for style/format consistency only if evaluations show it is needed.

## Implementation sequence

### Phase 0 — baseline and contract
- Capture current main SHA, tests, supported intents, and current production behavior.
- Add a fixed evaluation set for Malayalam, Manglish, English, voice transcripts, and multi-turn follow-ups.
- Establish concise-response and evidence-grounding acceptance criteria.

### Phase 1 — safe conversation state
- Add a Supabase migration for scoped conversation state or use a dedicated conversation-turn table.
- Scope by normalized sender identity + tenant/business ID, with TTL and bounded history.
- Add unit tests for isolation, expiration, ordering, duplicate webhook delivery and concurrent messages.
- Do not deploy until migration/RLS and service-role access are verified.

### Phase 2 — reference resolution and tool contracts
- Add structured context-aware intent resolution.
- Add read-only allow-listed domain tools for driver count/list first, then trips, stock and bills.
- Resolve “അവർ ആരൊക്കെയാണ്?” after driver count, and variants such as “അതിൽ റഷീദ് ഉണ്ടോ?” with explicit tests.
- Maintain existing deterministic handlers as low-latency paths where they are correct.

### Phase 3 — grounded natural responses
- Generate short answers from verified tool output.
- Keep the general fallback isolated from operational facts.
- Test hallucination resistance by injecting unsupported names/quantities into user prompts and verifying they are not repeated as facts.

### Phase 4 — production rollout
- Deploy to preview/staging first.
- Run end-to-end tests with a dedicated test sender and test data.
- Review latency, provider cost, timeout/failure behavior, duplicate handling and logs.
- Promote only after checks pass; verify deployed commit and health/log evidence.

## Acceptance tests

1. “എത്ര ഡ്രൈവർമാർ active ആണ്?” -> exact DB count.
2. Follow-up “അവർ ആരൊക്കെയാണ്?” -> names from the matching active-driver query.
3. “അതിൽ റഷീദ് ഇന്ന് എത്ര trip പോയി?” -> resolve driver reference, query today's trips, report only returned data.
4. Start a second sender's conversation -> no context leaks from the first sender.
5. Ambiguous “അവൻ?” with no clear antecedent -> ask one concise clarification.
6. DB timeout/error -> state inability to verify; never invent a result.
7. Stale stock result followed by “ഇപ്പോൾ?” -> re-query live stock.
8. Duplicate webhook delivery -> no duplicate reply or duplicate turn.
9. Unsupported live-data question -> explain it cannot be verified yet, not generic “model number” instructions.
10. Response is concise by default and language-matched.

## Framework decision

Do a small benchmark before selecting a new orchestration dependency:
- **Existing Groq API + typed tool router:** smallest migration and likely lowest integration risk.
- **Vercel AI SDK tool loop:** native fit for the current TypeScript/Vercel stack and multi-step tool calls.
- **LangGraph.js:** consider if the workflow needs explicit graph state, checkpointing, resumable multi-step execution or more complex branching. It is not required merely to support conversation history.

Decision criteria: measured end-to-end latency, provider cost, structured-output reliability, ease of testing, deployability on current Vercel runtime, and maintainability. No framework guarantees hallucination-free output; grounding, authorization, validation and tests do that work.
