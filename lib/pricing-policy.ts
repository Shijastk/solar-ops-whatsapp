export function isPricingQuestion(text: string): boolean {
  const normalized = text.normalize("NFKC").toLowerCase();
  return (
    /₹|\b(?:price|pricing|rate|cost|amount|quotation|quote)\b|\b(?:rs\.?|rupees?|inr)\b|\b(?:bill|invoice)\s+(?:total|amount)\b/i.test(
      normalized,
    ) ||
    /(?:വില|റേറ്റ്|വിലവിവരം|തുക|എത്ര രൂപ|എത്ര വില)|\b(?:vila|vilay|vilayethra|ethra roopa|ethra rate)\b/i.test(
      normalized,
    )
  );
}

export function pricingPolicyReply(): string {
  return "വില/റേറ്റ്/ബിൽ തുകകൾ WhatsApp-ൽ പങ്കിടുന്നില്ല. Pricing സ്ഥിരീകരിക്കാൻ കമ്പനിയെ ബന്ധപ്പെടുക.";
}
