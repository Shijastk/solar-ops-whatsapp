import { describe, expect, it } from "vitest";
import {
  cleanupExpiredMedia,
  getMediaRetentionSettings,
  getRetentionCutoff,
} from "../scripts/maintenance/media-retention.mjs";

function createFakeSupabase({
  rows = [],
  removeFailures = new Set(),
  updateFailures = new Set(),
} = {}) {
  const state = {
    removedPaths: [],
    clearedPaths: [],
    query: {},
  };

  function selectBuilder() {
    return {
      eq(field, value) {
        state.query[field] = value;
        return this;
      },
      not(field, operator, value) {
        state.query.not = [field, operator, value];
        return this;
      },
      lt(field, value) {
        state.query.lt = [field, value];
        return this;
      },
      order(field, options) {
        state.query.order = [field, options];
        return this;
      },
      async limit(value) {
        state.query.limit = value;
        return { data: rows.slice(0, value), error: null };
      },
    };
  }

  return {
    state,
    client: {
      from(table) {
        if (table !== "whatsapp_messages") {
          throw new Error("Unexpected table");
        }

        return {
          select() {
            return selectBuilder();
          },
          update() {
            let rowId;
            let storagePath;

            const builder = {
              eq(field, value) {
                if (field === "id") rowId = value;
                if (field === "storage_path") storagePath = value;

                if (rowId !== undefined && storagePath !== undefined) {
                  if (updateFailures.has(storagePath)) {
                    return Promise.resolve({
                      error: { message: "update failed" },
                    });
                  }
                  state.clearedPaths.push(storagePath);
                  return Promise.resolve({ error: null });
                }

                return builder;
              },
            };

            return builder;
          },
        };
      },
      storage: {
        from(bucket) {
          state.bucket = bucket;
          return {
            async remove(paths) {
              const storagePath = paths[0];
              if (removeFailures.has(storagePath)) {
                return { error: { message: "remove failed" } };
              }
              state.removedPaths.push(storagePath);
              return { error: null };
            },
          };
        },
      },
    },
  };
}

describe("media retention", () => {
  it("uses safe defaults and validates settings", () => {
    const settings = getMediaRetentionSettings({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "secret",
    });

    expect(settings.storageBucket).toBe("whatsapp-media");
    expect(settings.retentionHours).toBe(24);
    expect(settings.batchSize).toBe(500);

    expect(() =>
      getMediaRetentionSettings({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "secret",
        MEDIA_RETENTION_HOURS: "0",
      }),
    ).toThrow("MEDIA_RETENTION_HOURS must be a positive integer");
  });

  it("calculates a 24-hour retention cutoff", () => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    expect(getRetentionCutoff(now, 24).toISOString()).toBe(
      "2026-09-20T12:00:00.000Z",
    );
  });

  it("deletes expired stored objects and clears only their storage paths", async () => {
    const rows = [
      {
        id: "row-1",
        storage_path: "safe/path/one.pdf",
        processed_at: "2026-09-20T00:00:00.000Z",
      },
      {
        id: "row-2",
        storage_path: "safe/path/two.pdf",
        processed_at: "2026-09-20T01:00:00.000Z",
      },
    ];
    const { client, state } = createFakeSupabase({ rows });

    const result = await cleanupExpiredMedia({
      supabase: client,
      storageBucket: "whatsapp-media",
      now: new Date("2026-09-21T12:00:00.000Z"),
      retentionHours: 24,
      batchSize: 100,
    });

    expect(result).toMatchObject({
      scannedCount: 2,
      deletedCount: 2,
      failedCount: 0,
      retentionHours: 24,
      batchSize: 100,
    });
    expect(state.bucket).toBe("whatsapp-media");
    expect(state.removedPaths).toEqual([
      "safe/path/one.pdf",
      "safe/path/two.pdf",
    ]);
    expect(state.clearedPaths).toEqual([
      "safe/path/one.pdf",
      "safe/path/two.pdf",
    ]);
    expect(state.query.processing_status).toBe("stored");
    expect(state.query.not).toEqual(["storage_path", "is", null]);
    expect(state.query.lt[0]).toBe("processed_at");
  });

  it("keeps the database path when Storage deletion fails so a later run can retry", async () => {
    const storagePath = "safe/path/retry.pdf";
    const { client, state } = createFakeSupabase({
      rows: [
        {
          id: "row-1",
          storage_path: storagePath,
          processed_at: "2026-09-20T00:00:00.000Z",
        },
      ],
      removeFailures: new Set([storagePath]),
    });

    const result = await cleanupExpiredMedia({
      supabase: client,
      storageBucket: "whatsapp-media",
      now: new Date("2026-09-21T12:00:00.000Z"),
      retentionHours: 24,
      batchSize: 100,
    });

    expect(result.deletedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(state.clearedPaths).toEqual([]);
  });

  it("reports a failed database finalization after successful object deletion", async () => {
    const storagePath = "safe/path/db-retry.pdf";
    const { client, state } = createFakeSupabase({
      rows: [
        {
          id: "row-1",
          storage_path: storagePath,
          processed_at: "2026-09-20T00:00:00.000Z",
        },
      ],
      updateFailures: new Set([storagePath]),
    });

    const result = await cleanupExpiredMedia({
      supabase: client,
      storageBucket: "whatsapp-media",
      now: new Date("2026-09-21T12:00:00.000Z"),
      retentionHours: 24,
      batchSize: 100,
    });

    expect(result.deletedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(state.removedPaths).toEqual([storagePath]);
  });
});
