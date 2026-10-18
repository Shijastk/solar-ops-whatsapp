import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeOperationalVoice } from "../lib/voice-transcription";

const keys = ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "AZURE_SPEECH_TIMEOUT_MS"] as const;
const originals = Object.fromEntries(keys.map((key) => [key, process.env[key])) as Record<(typeof keys)[number], string | undefined>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of keys) {
    const value = originals[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("operational voice transcription", () => {
  it("uses Azure Speech with the Malayalam locale", async () => {
    process.env.AZURE_SPEECH_KEY = "azure-test-secret";
    process.env.AZURE_SPEECH_REGION = "centralindia";
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        RecognitionStatus: "Success",
        DisplayText: "ഇന്നത്തെ trip ഏതാണ്",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transcribeOperationalVoice({
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: "audio/ogg; codecs=opus",
      }),
    ).resolves.toBe("ഇന്നത്തെ trip ഏതാണ്");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("https://centralindia.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1");
    expect(String(url)).toContain("language=ml-IN");
    expect(String(url)).toContain("format=simple");
    expect(init.headers).toMatchObject({
      "Ocp-Apim-Subscription-Key": "azure-test-secret",
      "Content-Type": "audio/ogg; codecs=opus",
    });
    expect(init.body).toBeInstanceOf(ArrayBuffer);
  });

  it("fails clearly when the Azure Speech key is missing", async () => {
    delete process.env.AZURE_SPEECH_KEY;
    await expect(
      transcribeOperationalVoice({
        bytes: new Uint8Array([1]),
        mimeType: "audio/ogg",
      }),
    ).rejects.toThrow("Azure Speech key is not configured");
  });

  it("rejects a no-match response", async () => {
    process.env.AZURE_SPEECH_KEY = "azure-test-secret";
    process.env.AZURE_SPEECH_REGION = "centralindia";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ RecognitionStatus: "NoMatch", DisplayText: "" }),
    ));

    await expect(
      transcribeOperationalVoice({
        bytes: new Uint8Array([1]),
        mimeType: "audio/ogg",
      }),
    ).rejects.toThrow("Azure Speech transcription returned no recognized speech");
  });
});
