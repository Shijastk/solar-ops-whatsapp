import { z } from "zod";
import { getVoiceTranscriptionEnv } from "@/lib/env";

const transcriptionSchema = z.object({
  RecognitionStatus: z.string(),
  DisplayText: z.string().optional(),
});

function azureContentType(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "audio/ogg" || normalized === "application/ogg") {
    return "audio/ogg; codecs=opus";
  }
  if (normalized === "audio/wav" || normalized === "audio/x-wav") {
    return "audio/wav; codecs=audio/pcm; samplerate=16000";
  }
  return normalized || "application/octet-stream";
}

export async function transcribeOperationalVoice(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<string> {
  const env = getVoiceTranscriptionEnv();
  if (!env.apiKey) {
    throw new Error("Azure Speech key is not configured for voice transcription");
  }
  if (input.bytes.byteLength === 0) {
    throw new Error("Voice transcription received an empty audio payload");
  }

  const region = env.region.toLowerCase();
  if (!/^[a-z0-9-]+$/.test(region)) {
    throw new Error("Azure Speech region configuration is invalid");
  }

  const audioBuffer = new ArrayBuffer(input.bytes.byteLength);
  new Uint8Array(audioBuffer).set(input.bytes);
  const contentType = azureContentType(input.mimeType);

  const url = new URL(
    `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`,
  );
  url.searchParams.set("language", "ml-IN");
  url.searchParams.set("format", "simple");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": env.apiKey,
      "Content-Type": contentType,
      Accept: "application/json",
    },
    body: audioBuffer,
    cache: "no-store",
    signal: AbortSignal.timeout(Math.min(env.timeoutMs, 6000)),
  });

  if (!response.ok) {
    // Do not include provider response bodies or credentials in application logs.
    throw new Error("Azure Speech transcription failed with HTTP " + response.status);
  }

  const parsed = transcriptionSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.RecognitionStatus !== "Success") {
    throw new Error("Azure Speech transcription returned no recognized speech");
  }

  return (parsed.data.DisplayText ?? "")
    .normalize("NFKC")
    .replace(/\\s+/g, " ")
    .trim()
    .slice(0, 1200);
}
