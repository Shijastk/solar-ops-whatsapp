import { createHash, randomBytes } from "node:crypto";
import { deterministicUuid } from "@/lib/idempotency";
import { sendOpsReply } from "@/lib/replies";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { NormalizedWhatsAppMessage } from "@/lib/whatsapp";

type DriverIntent =
  | { action: "list" }
  | { action: "create"; name: string }
  | { action: "deactivate"; name: string };

export function normalizeDriverName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizedKey(value: string): string {
  return normalizeDriverName(value).toLocaleLowerCase("en-IN");
}

/**
 * Deliberately recognizes only clear, explicit driver mutations. Unknown or
 * ambiguous wording falls through to the existing workflow rather than writing.
 */
export function parseDriverMutation(text: string): DriverIntent | null {
  const value = normalizeDriverName(text).replace(/[.!?।]+$/g, "").trim();
  const patterns: Array<{ action: DriverIntent["action"]; regex: RegExp }> = [
    { action: "list", regex: /^(?:please\s+)?(?:list|show|display)\s+(?:all\s+)?drivers$/i },
    { action: "list", regex: /^(?:drivers|driver list)\s+(?:list|show|parayu|kaanikku)$/i },
    {
      action: "create",
      regex: /^(?:please\s+)?(?:add|create|register)\s+(?:a\s+)?(?:new\s+)?driver\s+(?:named\s+)?(.+?)(?:\s+(?:as\s+a\s+new\s+driver))?$/i,
    },
    {
      action: "create",
      regex: /^(?:please\s+)?(?:add|register)\s+(.+?)\s+(?:as\s+)?(?:a\s+)?new\s+driver$/i,
    },
    {
      action: "deactivate",
      regex: /^(?:please\s+)?(?:delete|remove|deactivate)\s+(?:the\s+)?driver\s+(?:named\s+)?(.+)$/i,
    },
    {
      action: "deactivate",
      regex: /^(?:please\s+)?(?:delete|remove|deactivate)\s+(.+?)\s+(?:from\s+)?(?:the\s+)?driver(?:\s+list|\s+directory)?$/i,
    },
  ];

  // Malayalam/Manglish patterns are intentionally conservative. Names are
  // captured only from explicit action phrases; general mentions never write.
  const malayalamPatterns: Array<{ action: "create" | "deactivate"; regex: RegExp }> = [
    { action: "create", regex: /^(.+?)\s+(?:പുതിയ\s+)?ഡ്രൈവറായി\s+(?:ആഡ്\s+ചെയ്യണം|ചേർക്കണം|ചേർക്കൂ)$/u },
    { action: "create", regex: /^(.+?)\s+(?:new\s+)?driver\s+(?:ആയി|ayi)\s+add\s+(?:ചെയ്യണം|cheyyanam|cheyyu)$/iu },
    { action: "deactivate", regex: /^(.+?)യെ?\s+(?:ഡ്രൈവർ\s+ലിസ്റ്റിൽ\s+നിന്ന്\s+)?(?:ഡിലീറ്റ്\s+ചെയ്യണം|ഡിലീറ്റ്|ഒഴിവാക്കണം|നീക്കം\s+ചെയ്യണം)$/u },
    { action: "deactivate", regex: /^(.+?)\s+(?:delete|remove|deactivate)\s+(?:cheyyanam|cheyyu|ചെയ്യണം)$/iu },
    { action: "deactivate", regex: /^(?:delete|remove)\s+(.+?)\s+driver$/i },
  ];

  for (const entry of patterns) {
    const match = value.match(entry.regex);
    if (entry.action === "list" && match) return { action: "list" };
    if (match?.[1]) {
      const name = normalizeDriverName(match[1].replace(/^(?:the|a|an)\s+/i, "").replace(/[.!?।]+$/g, ""));
      if (isValidDriverName(name)) return { action: entry.action as "create" | "deactivate", name };
    }
  }

  for (const entry of malayalamPatterns) {
    const match = value.match(entry.regex);
    const candidate = match?.[1] ?? "";
    if (candidate) {
      const name = normalizeDriverName((candidate.endsWith(String.fromCodePoint(0x0d26, 0x0d3f, 0x0d28, 0x0d46)) ? candidate.slice(0, -4) + String.fromCodePoint(0x0d26, 0x0d4d) : candidate.replace(/(?:ിനെ|നെ|യെ|യെ?)+$/u, "").replace(/ine$/i, "")));
      if (isValidDriverName(name)) return { action: entry.action, name };
    }
  }

  return null;
}

function isValidDriverName(name: string): boolean {
  return name.length >= 2 &&
    name.length <= 120 &&
    !/[\n\r]/.test(name) &&
    !/^(?:please|named|a new driver|new driver|ഡ്രൈവറായി|driver)$/i.test(name);
}

export async function handleDriverMutation(
  message: NormalizedWhatsAppMessage,
  storedMessageId: string,
): Promise<"handled" | "ignored"> {
  if (message.type !== "text" || !message.textBody) return "ignored";
  if (process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED !== "true") return "ignored";

  const supabase = getSupabaseAdmin();
  const confirmationMatch = message.textBody.trim().match(/^confirm\\s+driver\\s+([a-f0-9]{48})$/i);

  if (confirmationMatch) {
    const tokenHash = createHash("sha256").update(confirmationMatch[1].toLowerCase()).digest("hex");
    const { data, error } = await supabase.rpc("confirm_ops_driver_deactivation", {
      p_token_hash: tokenHash,
      p_sender_phone: message.senderPhone,
    });

    if (error) throw new Error("Driver deactivation confirmation failed");

    const result = data as { status?: string; driver_name?: string } | null;
    const body = result?.status === "deactivated"
      ? "✅ " + result.driver_name + " എന്ന driver deactivate ചെയ്തു."
      : result?.status === "already_inactive"
        ? "ℹ️ ഈ driver ഇതിനകം inactive ആണ്. വീണ്ടും മാറ്റമൊന്നും വരുത്തിയിട്ടില്ല."
        : "⚠️ Confirmation token അസാധുവാണ്, കാലാവധി കഴിഞ്ഞു, അല്ലെങ്കിൽ ഈ sender-ന് നൽകിയതല്ല. മാറ്റമൊന്നും വരുത്തിയിട്ടില്ല.";

    await sendOpsReply({
      requestId: deterministicUuid("driver-deactivate-confirm-result:" + message.messageId),
      replyToMessageId: storedMessageId,
      knownInboundAt: message.timestamp,
      body,
    });
    return "handled";
  }

  const intent = parseDriverMutation(message.textBody);
  if (!intent) return "ignored";

  if (intent.action === "list") {
    const { data: drivers, error } = await supabase
      .from("ops_drivers")
      .select("name, active")
      .eq("active", true)
      .order("name", { ascending: true })
      .limit(51);

    if (error) throw new Error("Driver list lookup failed: " + error.message);

    const activeDrivers = (drivers ?? []).slice(0, 50);
    const hasMore = (drivers ?? []).length > 50;
    const heading = hasMore
      ? "🚚 Active drivers (first 50; more exist):"
      : "🚚 Active drivers (" + activeDrivers.length + "):";
    const body = activeDrivers.length
      ? heading + "\n" + activeDrivers.map((driver, index) => String(index + 1) + ". " + driver.name).join("\n")
      : "ℹ️ ഇപ്പോൾ active drivers ഒന്നുമില്ല.";

    await sendOpsReply({
      requestId: deterministicUuid("driver-list:" + message.messageId),
      replyToMessageId: storedMessageId,
      knownInboundAt: message.timestamp,
      body,
    });
    return "handled";
  }

  const name = normalizeDriverName(intent.name);
  const key = normalizedKey(name);

  if (intent.action === "create") {
    const { data: existing, error: lookupError } = await supabase
      .from("ops_drivers")
      .select("id, name, active")
      .eq("normalized_name", key)
      .maybeSingle();

    if (lookupError) throw new Error("Driver lookup failed: " + lookupError.message);

    if (existing?.active) {
      await sendOpsReply({
        requestId: deterministicUuid("driver-create-exists:" + message.messageId),
        replyToMessageId: storedMessageId,
        knownInboundAt: message.timestamp,
        body: "ℹ️ " + existing.name + " എന്ന ഡ്രൈവർ നിലവിലുണ്ട്. പുതിയ record ചേർത്തിട്ടില്ല.",
      });
      return "handled";
    }

    if (existing && !existing.active) {
      await sendOpsReply({
        requestId: deterministicUuid("driver-create-inactive:" + message.messageId),
        replyToMessageId: storedMessageId,
        knownInboundAt: message.timestamp,
        body: existing.name + " എന്ന പേരിൽ inactive driver record ഉണ്ട്. വീണ്ടും active ആക്കണോ?",
      });
      return "handled";
    }

    const { data: created, error: insertError } = await supabase
      .from("ops_drivers")
      .insert({ name, normalized_name: key, active: true })
      .select("id, name, active")
      .single();

    if (insertError) {
      // A concurrent request may have inserted the same unique normalized key.
      if (insertError.code === "23505") {
        const { data: concurrent, error: concurrentLookupError } = await supabase
          .from("ops_drivers")
          .select("id, name, active")
          .eq("normalized_name", key)
          .maybeSingle();
        if (concurrentLookupError || !concurrent?.active) {
          throw new Error("Driver insert conflicted but the saved record could not be verified");
        }
        await sendOpsReply({
          requestId: deterministicUuid("driver-create-race:" + message.messageId),
          replyToMessageId: storedMessageId,
          knownInboundAt: message.timestamp,
          body: "ℹ️ " + concurrent.name + " എന്ന ഡ്രൈവർ ഇതിനകം ചേർത്തിട്ടുണ്ട്. Duplicate ചേർത്തിട്ടില്ല.",
        });
        return "handled";
      }
      throw new Error("Driver creation failed: " + insertError.message);
    }

    const { data: verified, error: verifyError } = await supabase
      .from("ops_drivers")
      .select("id, name, active")
      .eq("id", created.id)
      .maybeSingle();

    if (verifyError || !verified?.active || verified.name !== name) {
      throw new Error("Driver creation could not be verified after insert");
    }

    await sendOpsReply({
      requestId: deterministicUuid("driver-created:" + message.messageId),
      replyToMessageId: storedMessageId,
      knownInboundAt: message.timestamp,
      body: "✅ " + verified.name + " എന്ന പുതിയ driver ചേർത്തു.",
    });
    return "handled";
  }

  const { data: matches, error: lookupError } = await supabase
    .from("ops_drivers")
    .select("id, name, active")
    .eq("normalized_name", key)
    .eq("active", true)
    .limit(2);

  if (lookupError) throw new Error("Driver lookup failed: " + lookupError.message);

  if (!matches?.length) {
    await sendOpsReply({
      requestId: deterministicUuid("driver-delete-missing:" + message.messageId),
      replyToMessageId: storedMessageId,
      knownInboundAt: message.timestamp,
      body: "ℹ️ " + name + " എന്ന active driver കണ്ടെത്തിയില്ല. മാറ്റമൊന്നും വരുത്തിയിട്ടില്ല.",
    });
    return "handled";
  }

  if (matches.length > 1) {
    await sendOpsReply({
      requestId: deterministicUuid("driver-delete-ambiguous:" + message.messageId),
      replyToMessageId: storedMessageId,
      knownInboundAt: message.timestamp,
      body: name + " എന്ന പേരിൽ ഒന്നിലധികം active driver records ഉണ്ട്. കൃത്യമായ record തിരഞ്ഞെടുക്കണം.",
    });
    return "handled";
  }

  const token = randomBytes(24).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { error: confirmationInsertError } = await supabase
    .from("ops_driver_action_confirmations")
    .insert({
      token_hash: tokenHash,
      sender_phone: message.senderPhone,
      driver_id: matches[0].id,
      action: "deactivate",
      expires_at: expiresAt,
    });

  if (confirmationInsertError) {
    throw new Error("Driver deactivation confirmation could not be created");
  }

  await sendOpsReply({
    requestId: deterministicUuid("driver-deactivate-confirmation:" + message.messageId),
    replyToMessageId: storedMessageId,
    knownInboundAt: message.timestamp,
    body: "⚠️ " + matches[0].name + " എന്ന driver-നെ deactivate ചെയ്യാൻ 5 മിനിറ്റിനുള്ളിൽ ഇതേ WhatsApp നമ്പറിൽ നിന്ന് കൃത്യമായി ഈ സന്ദേശം reply ചെയ്യുക: CONFIRM DRIVER " + token + "\\nToken ഒരിക്കൽ മാത്രം ഉപയോഗിക്കാം. നിങ്ങൾ ആവശ്യപ്പെട്ടിട്ടില്ലെങ്കിൽ അവഗണിക്കുക.",
  });
  return "handled";
}
