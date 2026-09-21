import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getHealthConfiguration } from "@/lib/env";
import {
  OPS_SESSION_COOKIE,
  verifyOpsSession,
} from "@/lib/ops-auth";
import {
  getOpsSummary,
  listOpsMessages,
  type OpsMessage,
} from "@/lib/ops-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operations Dashboard | Solar Ops",
  robots: {
    index: false,
    follow: false,
  },
};

const MEDIA_TYPES = new Set([
  "document",
  "image",
  "audio",
  "video",
  "sticker",
]);

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function formatBytes(value: number | null): string {
  if (!value) {
    return "—";
  }

  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function maskSender(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) {
    return "••••";
  }

  return `•••• ${digits.slice(-4)}`;
}

function mediaState(message: OpsMessage): {
  label: string;
  className: string;
} {
  if (!MEDIA_TYPES.has(message.message_type)) {
    return {
      label: message.processing_status === "failed" ? "Failed" : "Stored",
      className:
        message.processing_status === "failed"
          ? "opsBadge opsBadgeDanger"
          : "opsBadge opsBadgeGood",
    };
  }

  if (message.processing_status === "failed") {
    return { label: "Failed", className: "opsBadge opsBadgeDanger" };
  }

  if (message.storage_path) {
    return { label: "File available", className: "opsBadge opsBadgeGood" };
  }

  return { label: "File deleted", className: "opsBadge opsBadgeMuted" };
}

function retentionText(message: OpsMessage): string | null {
  if (!message.storage_path || !message.processed_at) {
    return null;
  }

  const expiry = new Date(
    new Date(message.processed_at).getTime() + 24 * 60 * 60 * 1000,
  );

  return `Cleanup eligible after ${formatDate(expiry.toISOString())}`;
}

export default async function OpsDashboardPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get(OPS_SESSION_COOKIE)?.value;

  if (!verifyOpsSession(session)) {
    redirect("/ops/login");
  }

  const [messages, summary] = await Promise.all([
    listOpsMessages(100),
    getOpsSummary(),
  ]);
  const health = getHealthConfiguration();
  const runtimeHealthy =
    health.validation.webhook && health.validation.ingestion;

  return (
    <main className="opsShell">
      <header className="opsTopbar">
        <div>
          <p className="opsBrand">SOLAR OPS</p>
          <h1>Received bills</h1>
          <p>Live WhatsApp ingestion status and temporary file review.</p>
        </div>

        <div className="opsTopbarActions">
          <a className="opsSecondaryButton" href="/ops">
            Refresh
          </a>
          <form action="/api/ops/logout" method="post">
            <button className="opsGhostButton" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="opsStats" aria-label="System summary">
        <article>
          <span>Total received</span>
          <strong>{summary.totalMessages}</strong>
        </article>
        <article>
          <span>Stored</span>
          <strong>{summary.storedMessages}</strong>
        </article>
        <article>
          <span>Files available</span>
          <strong>{summary.availableFiles}</strong>
        </article>
        <article>
          <span>Failed</span>
          <strong>{summary.failedMessages}</strong>
        </article>
      </section>

      <section className="opsSystemBar">
        <div>
          <span
            className={
              runtimeHealthy
                ? "opsStatusDot opsStatusDotGood"
                : "opsStatusDot opsStatusDotDanger"
            }
            aria-hidden="true"
          />
          <strong>
            {runtimeHealthy ? "System configured" : "Configuration needs attention"}
          </strong>
        </div>
        <span>Raw files are temporary and cleanup-targeted after 24 hours.</span>
      </section>

      <section className="opsFeed">
        <div className="opsSectionHeading">
          <div>
            <h2>Recent messages</h2>
            <p>Latest 100 accepted WhatsApp messages.</p>
          </div>
        </div>

        {messages.length === 0 ? (
          <div className="opsEmpty">No accepted messages yet.</div>
        ) : (
          <div className="opsMessageList">
            {messages.map((message) => {
              const state = mediaState(message);
              const retention = retentionText(message);
              const title =
                message.original_filename ||
                (message.message_type === "text"
                  ? "WhatsApp text"
                  : message.message_type);

              return (
                <article className="opsMessageCard" key={message.id}>
                  <div className="opsMessageMain">
                    <div className="opsMessageHeading">
                      <div>
                        <p className="opsMessageType">
                          {message.message_type.toUpperCase()}
                        </p>
                        <h3>{title}</h3>
                      </div>
                      <span className={state.className}>{state.label}</span>
                    </div>

                    {message.text_body ? (
                      <p className="opsTextPreview">{message.text_body}</p>
                    ) : null}

                    <dl className="opsMetaGrid">
                      <div>
                        <dt>Sender</dt>
                        <dd>
                          {message.sender_name || "WhatsApp sender"} ·{" "}
                          {maskSender(message.sender_phone)}
                        </dd>
                      </div>
                      <div>
                        <dt>Received</dt>
                        <dd>{formatDate(message.received_at)}</dd>
                      </div>
                      <div>
                        <dt>Size</dt>
                        <dd>{formatBytes(message.media_size_bytes)}</dd>
                      </div>
                      <div>
                        <dt>Type</dt>
                        <dd>{message.mime_type || message.message_type}</dd>
                      </div>
                    </dl>

                    {retention ? (
                      <p className="opsRetentionNote">{retention}</p>
                    ) : null}
                  </div>

                  {message.storage_path ? (
                    <div className="opsMessageActions">
                      <a
                        className="opsPrimaryButton"
                        href={`/api/ops/media/${message.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View file
                      </a>
                      <details className="opsDeleteConfirm">
                        <summary>Delete file</summary>
                        <form
                          action={`/api/ops/media/${message.id}/delete`}
                          method="post"
                        >
                          <span>Raw file only; metadata stays.</span>
                          <button className="opsDangerButton" type="submit">
                            Confirm delete
                          </button>
                        </form>
                      </details>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
