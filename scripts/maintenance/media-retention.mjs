import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_RETENTION_HOURS = 24;
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;

function parsePositiveInteger(value, fallback, name, maximum) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  if (maximum !== undefined && parsed > maximum) {
    throw new Error(`${name} must be <= ${maximum}`);
  }

  return parsed;
}

export function getMediaRetentionSettings(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const supabaseSecretKey = env.SUPABASE_SECRET_KEY?.trim();
  const storageBucket =
    env.SUPABASE_STORAGE_BUCKET?.trim() || "whatsapp-media";

  const missing = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseSecretKey) missing.push("SUPABASE_SECRET_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable names: ${missing.join(", ")}`,
    );
  }

  return {
    supabaseUrl,
    supabaseSecretKey,
    storageBucket,
    retentionHours: parsePositiveInteger(
      env.MEDIA_RETENTION_HOURS,
      DEFAULT_RETENTION_HOURS,
      "MEDIA_RETENTION_HOURS",
    ),
    batchSize: parsePositiveInteger(
      env.MEDIA_RETENTION_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      "MEDIA_RETENTION_BATCH_SIZE",
      MAX_BATCH_SIZE,
    ),
    reportDir:
      env.MEDIA_RETENTION_REPORT_DIR?.trim() ||
      "artifacts/media-retention",
  };
}

export function getRetentionCutoff(now, retentionHours) {
  return new Date(now.getTime() - retentionHours * 60 * 60 * 1000);
}

async function fetchExpiredRows({
  supabase,
  cutoffIso,
  batchSize,
}) {
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id, storage_path, processed_at")
    .eq("processing_status", "stored")
    .not("storage_path", "is", null)
    .lt("processed_at", cutoffIso)
    .order("processed_at", { ascending: true })
    .limit(batchSize);

  if (error) {
    throw new Error(
      `Failed to query expired media rows: ${error.message}`,
    );
  }

  return data ?? [];
}

async function removeStoredObject({
  supabase,
  storageBucket,
  storagePath,
}) {
  const { error } = await supabase.storage
    .from(storageBucket)
    .remove([storagePath]);

  if (error) {
    throw new Error(
      `Failed to delete expired media object: ${error.message}`,
    );
  }
}

async function clearStoragePath({
  supabase,
  rowId,
  storagePath,
}) {
  const { error } = await supabase
    .from("whatsapp_messages")
    .update({ storage_path: null })
    .eq("id", rowId)
    .eq("storage_path", storagePath);

  if (error) {
    throw new Error(
      `Failed to clear expired media path: ${error.message}`,
    );
  }
}

export async function cleanupExpiredMedia({
  supabase,
  storageBucket,
  now = new Date(),
  retentionHours = DEFAULT_RETENTION_HOURS,
  batchSize = DEFAULT_BATCH_SIZE,
}) {
  if (!Number.isInteger(retentionHours) || retentionHours <= 0) {
    throw new Error("retentionHours must be a positive integer");
  }
  if (
    !Number.isInteger(batchSize) ||
    batchSize <= 0 ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new Error(
      `batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}`,
    );
  }

  const cutoff = getRetentionCutoff(now, retentionHours);
  const rows = await fetchExpiredRows({
    supabase,
    cutoffIso: cutoff.toISOString(),
    batchSize,
  });

  let deletedCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    const storagePath = row.storage_path;
    if (typeof storagePath !== "string" || storagePath.length === 0) {
      failedCount += 1;
      continue;
    }

    try {
      await removeStoredObject({
        supabase,
        storageBucket,
        storagePath,
      });
      await clearStoragePath({
        supabase,
        rowId: row.id,
        storagePath,
      });
      deletedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  return {
    cutoff: cutoff.toISOString(),
    scannedCount: rows.length,
    deletedCount,
    failedCount,
    batchSize,
    retentionHours,
  };
}

export async function runMediaRetentionFromEnvironment({
  env = process.env,
  now = new Date(),
} = {}) {
  const settings = getMediaRetentionSettings(env);
  const supabase = createClient(
    settings.supabaseUrl,
    settings.supabaseSecretKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  const startedAt = now.toISOString();
  const result = await cleanupExpiredMedia({
    supabase,
    storageBucket: settings.storageBucket,
    now,
    retentionHours: settings.retentionHours,
    batchSize: settings.batchSize,
  });

  const report = {
    ok: result.failedCount === 0,
    startedAt,
    finishedAt: new Date().toISOString(),
    retentionHours: result.retentionHours,
    cutoff: result.cutoff,
    scannedCount: result.scannedCount,
    deletedCount: result.deletedCount,
    failedCount: result.failedCount,
    batchSize: result.batchSize,
  };

  await mkdir(settings.reportDir, { recursive: true });
  await writeFile(
    `${settings.reportDir}/report.json`,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  console.log(
    "Media retention summary",
    JSON.stringify({
      ok: report.ok,
      retentionHours: report.retentionHours,
      scannedCount: report.scannedCount,
      deletedCount: report.deletedCount,
      failedCount: report.failedCount,
    }),
  );

  return report;
}

const entryPoint =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (entryPoint) {
  try {
    const report = await runMediaRetentionFromEnvironment();
    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown media retention error";
    console.error("Media retention failed", { message });
    process.exitCode = 1;
  }
}
