import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeOperationalVoice } from "@/lib/voice-transcription";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("transcribeOperationalVoice", () => {
  it("sends OGG/Opus audio to Azure Speech using the Malayalam locale", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "test-speech-key");
    vi.stubEnv("AZURE_SPEECH_REGION", "centralindia");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          RecognitionStatus: "Success",
          DisplayText: "റഷീദ് ഇന്ന് എത്ര ട്രിപ്പ് പോയിട്ടുണ്ട്.",
        }),
      ),
    );

    const transcript = await transcribeOperationalVoice({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/ogg",
    });

    expect(transcript).toBe("റഷീദ് ഇന്ന് എത്ര ട്രിപ്പ് പോയിട്ടുണ്ട്.");
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    expect(String(requestUrl)).toContain(
      "https://centralindia.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1",
    );
    expect(String(requestUrl)).toContain("language=ml-IN");
    expect(String(requestUrl)).toContain("format=simple");
    expect((requestInit?.headers as Record<string, string>)["Ocp-Apim-Subscription-Key"]).toBe(
      "test-speech-key",
    );
    expect((requestInit?.headers as Record<string, string>)["Content-Type"]).toBe(
      "audio/ogg; codecs=opus",
    );
  });

  it("fails clearly when the Azure Speech key is not configured", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "");
    await expect(
      transcribeOperationalVoice({
        bytes: new Uint8Array([1]),
        mimeType: "audio/ogg",
      }),
    ).rejects.toThrow("Azure Speech key is not configured");
  });

  it("does not treat a no-match response as an empty successful transcript", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "test-speech-key");
    vi.stubEnv("AZURE_SPEECH_REGION", "centralindia");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ RecognitionStatus: "NoMatch", DisplayText: "" }),
      ),
    );

    await expect(
      transcribeOperationalVoice({
        bytes: new Uint8Array([1]),
        mimeType: "audio/ogg",
      }),
    ).rejects.toThrow("Azure Speech transcription returned no recognized speech");
  });
});
