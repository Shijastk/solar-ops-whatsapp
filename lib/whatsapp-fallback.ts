import { z } from "zod";
import { getDocumentAutomationEnv } from "@/lib/env";
import { isPricingQuestion, pricingPolicyReply } from "@/lib/pricing-policy";

const MAX_MESSAGE_CHARS = 900;

const responseSchema = z.object({
  reply: z.string().min(1).max(900),
});

const groqResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1),
});

const strictResponseSchema = {
  type: "object",
  properties: {
    reply: { type: "string", minLength: 1, maxLength: 900 },
  },
  required: ["reply"],
  additionalProperties: false,
} as const;

export function fixedOperationalFallback(): string {
  return [
    "ഈ request-ന് live operational data safely resolve ചെയ്യാൻ കഴിഞ്ഞില്ല.",
    "Try: ഇന്നത്തെ bills · pending bills · latest bill · <product> stock · ഇന്നത്തെ trip · latest trip.",
  ].join("\n");
}

export function voiceQueryClarification(transcript: string): string {
  const heard = transcript.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 220);
  return "🎙️ കേട്ടത്: “" + heard + "”\nചോദ്യം വ്യക്തമായി മനസ്സിലായില്ല. ഉൽപ്പന്നത്തിന്റെ പേരും model നമ്പറും ചേർത്ത് വീണ്ടും പറയൂ, അല്ലെങ്കിൽ text ആയി അയക്കൂ.";
}

export function fixedUniversalFallback(text: string): string {
  const normalized = text.normalize("NFKC").trim().toLowerCase();

  if (isPricingQuestion(normalized)) return pricingPolicyReply();

  if (
    /^(thanks|thank you|thx|നന്ദി|താങ്ക്സ്|നന്നി|ok thanks|okay thanks)[.! ]*$/.test(
      normalized,
    )
  ) {
    return "ശരി 👍 Trip, bill, stock സംബന്ധിച്ച കാര്യം നേരിട്ട് അയക്കാം.";
  }

  if (
    /^(help|commands|options|എന്തൊക്കെ ചെയ്യാം|എന്താണ് ചെയ്യാൻ കഴിയുക)[?! .]*$/.test(
      normalized,
    )
  ) {
    return [
      "Solar Ops-ൽ:",
      "• trip — പുതിയ trip",
      "• done — bill collection complete",
      "• ഇന്നത്തെ bills / pending bills / latest bill",
      "• product name + stock",
      "• ഇന്നത്തെ trip / latest trip",
      "PDF bill അല്ലെങ്കിൽ voice message നേരിട്ട് അയക്കാം.",
    ].join("\n");
  }

  return "Message ലഭിച്ചു. Trip, bill, stock സംബന്ധിച്ച request ആണെങ്കിൽ കുറച്ച് വ്യക്തമായി പറയൂ; Hi എന്ന് അയച്ചാൽ options കാണാം.";
}

export async function generateUniversalWhatsAppReply(
  text: string,
): Promise<string | null> {
  const env = getDocumentAutomationEnv();
  if (!env.enabled || !env.apiKey) return null;

  const boundedText = text
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
  if (!boundedText) return null;

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.model,
        messages: [
          {
            role: "system",
            content:
              "You are the Solar Ops WhatsApp assistant for a small solar godown. Reply briefly and naturally in the same language/style as the user (Malayalam, Manglish, or English). You may greet, explain how Solar Ops works, clarify commands, and answer general non-live questions. IMPORTANT: you have NO live database facts in this fallback call. Never invent or guess current stock quantities, bills, trips, drivers, destinations, company data, totals, dates, or statuses. Never provide, estimate, infer, or repeat product prices, rates, discounts, invoice totals, taxes, or other pricing amounts; if asked, state that pricing is managed by the company and is not shared via WhatsApp. If the user asks for a live operational fact that is not available in this call, say you cannot safely verify that specific fact from this fallback and suggest a supported direct query such as today's bills, pending bills, latest bill, '<product> stock', today's trip, or latest trip. Do not claim an action was performed. Do not mention Groq or AI unless the user asks. Keep the response under 5 short lines.",
          },
          {
            role: "user",
            content: boundedText,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "solar_ops_fallback_reply",
            strict: true,
            schema: strictResponseSchema,
          },
        },
        reasoning_effort: "low",
        include_reasoning: false,
        max_completion_tokens: 220,
        stream: false,
      }),
      signal: AbortSignal.timeout(Math.min(env.timeoutMs, 3000)),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(
      "Groq fallback reply failed with HTTP " + response.status,
    );
  }

  const parsedResponse = groqResponseSchema.safeParse(await response.json());
  if (!parsedResponse.success) {
    throw new Error("Groq fallback reply response shape was invalid");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(parsedResponse.data.choices[0].message.content);
  } catch {
    throw new Error("Groq fallback reply was not valid JSON");
  }

  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Groq fallback reply failed local validation");
  }

  return parsed.data.reply.normalize("NFKC").trim();
}
