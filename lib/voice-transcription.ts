import { z } from "zod";
import { getDocumentAutomationEnv } from "@/lib/env";

const transcriptionSchema = z.object({
  text: z.string(),
});

function extensionForAudioMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "audio/ogg") return ".ogg";
  if (normalized === "audio/mpeg") return ".mp3";
  if (normalized === "audio/mp4") return ".m4a";
  if (normalized === "audio/wav" || normalized === "audio/x-wav") return ".wav";
  if (normalized === "audio/webm") return ".webm";
  return ".ogg";
}

export async function transcribeOperationalVoice(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<string> {
  const env = getDocumentAutomationEnv();
  if (!env.apiKey) {
    throw new Error("Groq API key is not configured for voice transcription");
  }

  const mimeType = input.mimeType.toLowerCase().split(";")[0].trim();
  const form = new FormData();
  form.set(
    "file",
    new Blob([input.bytes], { type: mimeType || "audio/ogg" }),
    "voice" + extensionForAudioMime(mimeType),
  );
  form.set("model", "whisper-large-v3-turbo");
  form.set("response_format", "json");
  form.set("temperature", "0");
  form.set(
    "prompt",
    "Solar Ops godown operations. Malayalam and English may be mixed. Common terms: trip, bill, stock, driver, vehicle, panel, inverter, Emmvee, DCR, Topcon.",
  );

  const response = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.apiKey,
      },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(Math.min(env.timeoutMs, 6000)),
    },
  );

  if (!response.ok) {
    throw new Error(
      "Groq voice transcription failed with HTTP " + response.status,
    );
  }

  const parsed = transcriptionSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Groq voice transcription response was invalid");
  }

  return parsed.data.text
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}
