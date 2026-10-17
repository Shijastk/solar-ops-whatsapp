#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const DEFAULT_MANIFEST = path.join(REPO_ROOT, "voice-benchmark", "manifest.json");
const MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"];
const PROMPT =
  "സോളാർ ഗോഡൗൺ. ബിൽ, സ്റ്റോക്ക്, ട്രിപ്പ്, ഡ്രൈവർ, വാഹനം, പാനൽ, ഇൻവെർട്ടർ. Emmvee, DCR, Topcon. മലയാളവും English ഉൽപ്പന്നപ്പേരുകളും.";

function normalize(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[?!,;:()[\]{}"'’“”]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function metricParts(reference, hypothesis) {
  const expectedWords = normalize(reference).split(" ").filter(Boolean);
  const actualWords = normalize(hypothesis).split(" ").filter(Boolean);
  const expectedChars = Array.from(normalize(reference).replace(/\s/g, ""));
  const actualChars = Array.from(normalize(hypothesis).replace(/\s/g, ""));
  return {
    wordErrors: editDistance(expectedWords, actualWords),
    referenceWords: expectedWords.length,
    characterErrors: editDistance(expectedChars, actualChars),
    referenceChars: expectedChars.length,
  };
}

async function transcribe({ bytes, filePath, model, apiKey }) {
  const form = new FormData();
  form.set(
    "file",
    new Blob([bytes], { type: mimeTypeFor(filePath) }),
    path.basename(filePath),
  );
  form.set("model", model);
  form.set("language", "ml");
  form.set("response_format", "json");
  form.set("temperature", "0");
  form.set("prompt", PROMPT);

  const started = performance.now();
  const response = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    },
  );
  const elapsedMs = Math.round(performance.now() - started);
  if (!response.ok) {
    throw new Error(`${model} returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (typeof payload.text !== "string") {
    throw new Error(`${model} returned an invalid transcription response`);
  }
  return { text: payload.text.trim(), elapsedMs };
}

function mimeTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".mp4": "audio/mp4",
  };
  return mimeTypes[extension] ?? "application/octet-stream";
}

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Set GROQ_API_KEY in your shell before running this benchmark.");
  }

  const manifestPath = path.resolve(
    process.cwd(),
    process.argv[2] ?? DEFAULT_MANIFEST,
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw new Error("Manifest must be a non-empty JSON array.");
  }

  const samples = [];
  for (const [index, item] of manifest.entries()) {
    if (
      typeof item?.file !== "string" ||
      typeof item?.reference !== "string" ||
      !item.reference.trim()
    ) {
      throw new Error(`Manifest item ${index + 1} needs file and reference strings.`);
    }
    const filePath = path.resolve(path.dirname(manifestPath), item.file);
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile() || fileInfo.size === 0) {
      throw new Error(`Audio sample ${index + 1} is empty or not a file.`);
    }
    samples.push({ filePath, reference: item.reference });
  }

  const totals = Object.fromEntries(
    MODELS.map((model) => [
      model,
      {
        wordErrors: 0,
        referenceWords: 0,
        characterErrors: 0,
        referenceChars: 0,
        elapsedMs: 0,
        samples: 0,
      },
    ]),
  );

  console.log(`Samples: ${samples.length}; models: ${MODELS.join(", ")}`);
  console.log("Same language hint, prompt, and temperature are used for both models.");
  console.log("Do not commit the audio or manifest; see docs/VOICE_STT_BENCHMARK.md.");

  for (const [index, sample] of samples.entries()) {
    const bytes = await readFile(sample.filePath);
    console.log(`\nSample ${index + 1}/${samples.length}: ${path.basename(sample.filePath)}`);
    for (const model of MODELS) {
      const result = await transcribe({
        bytes,
        filePath: sample.filePath,
        model,
        apiKey,
      });
      const metrics = metricParts(sample.reference, result.text);
      const total = totals[model];
      total.wordErrors += metrics.wordErrors;
      total.referenceWords += metrics.referenceWords;
      total.characterErrors += metrics.characterErrors;
      total.referenceChars += metrics.referenceChars;
      total.elapsedMs += result.elapsedMs;
      total.samples += 1;
      const wer = metrics.referenceWords ? metrics.wordErrors / metrics.referenceWords : 0;
      const cer = metrics.referenceChars ? metrics.characterErrors / metrics.referenceChars : 0;
      console.log(`  ${model}: ${result.elapsedMs} ms | WER ${(wer * 100).toFixed(1)}% | CER ${(cer * 100).toFixed(1)}%`);
      console.log(`    Reference: ${sample.reference}`);
      console.log(`    Heard:     ${result.text || "(empty transcript)"}`);
    }
  }

  console.log("\nAggregate results (lower error is better):");
  for (const model of MODELS) {
    const total = totals[model];
    const wer = total.referenceWords ? total.wordErrors / total.referenceWords : 0;
    const cer = total.referenceChars ? total.characterErrors / total.referenceChars : 0;
    console.log(
      `  ${model}: WER ${(wer * 100).toFixed(2)}% | CER ${(cer * 100).toFixed(2)}% | mean latency ${Math.round(total.elapsedMs / total.samples)} ms`,
    );
  }
  console.log("\nWER/CER are normalized text metrics; inspect brand names, quantities, dates, and intent separately.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Benchmark failed.");
  process.exitCode = 1;
});
