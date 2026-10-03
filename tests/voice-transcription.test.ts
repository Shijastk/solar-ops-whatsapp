import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeOperationalVoice } from "../lib/voice-transcription";

const originals = {
  enabled: process.env.DOCUMENT_AUTOMATION_ENABLED,
  key: process.env.GROQ_API_KEY,
  model: process.env.GROQ_MODEL,
  timeout: process.env.GROQ_TIMEOUT_MS,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore("DOCUMENT_AUTOMATION_ENABLED", originals.enabled);
  restore("GROQ_API_KEY", originals.key);
  restore("GROQ_MODEL", originals.model);
  restore("GROQ_TIMEOUT_MS", originals.timeout);
});

describe("operational voice transcription", () => {
  it("uses Groq Whisper Turbo with the audio file only", async () => {
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    process.env.GROQ_API_KEY = "groq-test-secret";
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    process.env.GROQ_TIMEOUT_MS = "7000";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "ഇന്നത്തെ trip ഏതാണ്" }), {
        status: 200,
        headers: { "content-type": "application/json" },
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
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer groq-test-secret",
    });
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("temperature")).toBe("0");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });
});
