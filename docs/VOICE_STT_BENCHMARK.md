# Malayalam / Manglish voice STT benchmark

This benchmark compares the current Groq Whisper Turbo model with Groq Whisper Large v3 without changing the production transcription path.

## Why

The production transcript has misrecognized a Malayalam operational question. Do not assume a different model is better until both models are tested on the same speech clips with known reference transcripts.

## Safety

- Use self-recorded, non-sensitive test phrases or synthetic fixtures. Do not use customer voice notes or confidential business conversations.
- Audio files and the reference manifest are local-only and gitignored.
- The script sends each selected audio file to Groq's transcription API. Do not run it on audio unless you are comfortable with that provider processing the sample.
- Keep `GROQ_API_KEY` in the local shell environment. Never paste it into chat, source, or the manifest.
- The benchmark does not call Supabase, WhatsApp, or Vercel and does not change production behavior.

## Setup

From the repository root:

1. Create `voice-benchmark/audio/`.
2. Put 10–20 short, clear audio clips in that folder. Include natural Kerala Malayalam, Manglish, and Malayalam-English business terms.
3. Create `voice-benchmark/manifest.json` using the example below. The reference must be the exact words spoken, including the product names/numbers.
4. Set `GROQ_API_KEY` in the shell, then run `npm run benchmark:voice-stt`.

Example local-only `voice-benchmark/manifest.json`:

```json
[
  {
    "file": "audio/01-yesterday-products.ogg",
    "reference": "ഇന്നലെ dispatch ചെയ്ത products ഏതെല്ലാമായിരുന്നു?"
  },
  {
    "file": "audio/02-stock-question.wav",
    "reference": "Emmvee 560 watt panel എത്ര എണ്ണം ബാക്കിയുണ്ട്?"
  }
]
```

You can also pass a manifest path explicitly:

```bash
GROQ_API_KEY='set-in-your-shell' npm run benchmark:voice-stt -- ./voice-benchmark/manifest.json
```

## Metrics

Both models receive the same file, `language=ml`, solar-operations vocabulary prompt, and `temperature=0`.

- **WER**: word error rate; lower is better.
- **CER**: character error rate; lower is better.
- **Latency**: time for the transcription HTTP request; lower is faster.
- The script prints each reference/transcript pair locally to support manual review.

WER/CER are not enough for this use case. Manually count critical errors separately: changed product/brand names, wrong model/wattage, wrong quantities/dates, and a changed question intent. A low average error rate can still hide a critical business error.

## Decision rule

Do not switch production models from one or two clips. Review the full sample set. Prefer a model only if it consistently improves the intended Malayalam/Manglish utterances without unacceptable latency or critical entity errors. If both fail similarly, investigate audio quality, recording duration, silence/clipping, language hint, and prompt vocabulary before deciding.

This benchmark compares two Groq models only. Azure and Sarvam require separate provider-specific test adapters and must not be described as benchmarked by this script.
