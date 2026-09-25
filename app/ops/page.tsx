import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getHealthConfiguration } from "@/lib/env";
import {
  OPS_SESSION_COOKIE,
  verifyOpsSession,
} from "@/lib/ops-auth";
import {
  buildOpsConversations,
  listOpsDraftsForMessages,
  listOpsMessages,
  listOpsOutboundMessages,
  type OpsDocumentDraft,
  type OpsMessage,
  type OpsOutboundMessage,
} from "@/lib/ops-data";
import { isWithinCustomerServiceWindow } from "@/lib/replies";
import {
  ChatTimeline,
  OpsLiveRefresh,
  ReplyForm,
} from "./ops-live-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operations Chat | Solar Ops",
  robots: {
    index: false,
    follow: false,
  },
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function formatBytes(value: number | null): string {
  if (!value) return "—";
  if (value < 1024 * 1024) {
    return Math.max(1, Math.round(value / 1024)) + " KB";
  }
  return (value / (1024 * 1024)).toFixed(1) + " MB";
}

function formatMoney(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

function maskSender(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length <= 4 ? "••••" : "•••• " + digits.slice(-4);
}

function documentTitle(message: OpsMessage): string {
  return (
    message.original_filename ||
    (message.message_type === "text" ? "WhatsApp text" : message.message_type)
  );
}

function documentStatus(draft: OpsDocumentDraft | undefined): string {
  if (!draft) return "Not parsed";
  if (draft.workflow_status === "cancelled") return "Deleted";
  if (draft.workflow_status === "recorded") {
    if (draft.verification_status === "verified") return "Auto verified";
    if (draft.verification_status === "manual_override") return "Manually verified";
    return "Recorded";
  }
  if (draft.workflow_status === "review_required") return "Review required";
  if (draft.parse_status === "approved") return "Approved";
  if (draft.parse_status === "ready_for_review") return "Ready to review";
  if (draft.parse_status === "needs_review") return "Needs review";
  if (draft.parse_status === "needs_ocr") return "Needs OCR";
  if (draft.parse_status === "failed") return "Parse failed";
  return draft.parse_status;
}

function isPdf(message: OpsMessage): boolean {
  return (
    message.mime_type?.toLowerCase() === "application/pdf" ||
    message.original_filename?.toLowerCase().endsWith(".pdf") === true
  );
}

function DraftCard({
  message,
  draft,
}: {
  message: OpsMessage;
  draft: OpsDocumentDraft;
}) {
  return (
    <div className="waParseCard">
      <div className="waParseHeader">
        <div>
          <span>PARSED BILL</span>
          <strong>{documentStatus(draft)}</strong>
        </div>
        <div className="waParseBadges">
          <span className={"waParseState waParseState-" + draft.parse_status}>
            {draft.parse_status.replaceAll("_", " ")}
          </span>
          <span className={"waParseState waWorkflowState-" + draft.workflow_status}>
            {draft.workflow_status.replaceAll("_", " ")}
          </span>
        </div>
      </div>

      <dl className="waParsedGrid">
        <div>
          <dt>Company</dt>
          <dd>{draft.supplier_name || "—"}</dd>
        </div>
        <div>
          <dt>Document</dt>
          <dd>{draft.document_number || "—"}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{draft.document_date || "—"}</dd>
        </div>
        <div>
          <dt>e-Way bill</dt>
          <dd>{draft.eway_bill_number || "—"}</dd>
        </div>
        <div>
          <dt>Ship to</dt>
          <dd>{draft.consignee_name || "—"}</dd>
        </div>
        <div>
          <dt>Vehicle</dt>
          <dd>{draft.vehicle_number || "—"}</dd>
        </div>
      </dl>

      {draft.consignee_address ? (
        <p className="waParsedAddress">{draft.consignee_address}</p>
      ) : null}

      {draft.items.length > 0 ? (
        <div className="waItems">
          {draft.items.map((item) => (
            <div className="waItem" key={item.id}>
              <div>
                <strong>{item.description}</strong>
                <span>{item.hsn_sac ? "HSN " + item.hsn_sac : "Product"}</span>
              </div>
              <div className="waItemQty">
                <strong>
                  {item.quantity ?? "—"} {item.unit ?? ""}
                </strong>
                <span>{formatMoney(item.amount)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="waParsedTotals">
        <span>Total</span>
        <strong>{formatMoney(draft.total_amount)}</strong>
      </div>

      {draft.missing_fields.length > 0 ? (
        <p className="waParseWarning">
          Missing: {draft.missing_fields.join(", ")}
        </p>
      ) : null}

      <p className="waVerificationMeta">
        Verification: {draft.verification_status.replaceAll("_", " ")}
        {draft.verification_provider
          ? " · " +
            draft.verification_provider +
            (draft.verification_model ? " / " + draft.verification_model : "")
          : ""}
        {" · Stock: " + draft.stock_status.replaceAll("_", " ")}
      </p>

      <div className="waParseActions">
        {draft.parse_status === "ready_for_review" &&
        draft.workflow_status !== "cancelled" ? (
          <form action={"/api/ops/messages/" + message.id + "/approve"} method="post">
            <button className="waApproveButton" type="submit">
              Approve data
            </button>
          </form>
        ) : null}
        {draft.parse_status !== "approved" &&
        draft.workflow_status !== "cancelled" &&
        message.storage_path ? (
          <form action={"/api/ops/messages/" + message.id + "/parse"} method="post">
            <button className="waSecondaryAction" type="submit">
              Parse again
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function InboundBubble({
  message,
  draft,
}: {
  message: OpsMessage;
  draft: OpsDocumentDraft | undefined;
}) {
  return (
    <article className="waRow waRowInbound" id={"message-" + message.id}>
      <div className="waBubble waInboundBubble">
        {message.text_body ? (
          <p className="waMessageText">{message.text_body}</p>
        ) : (
          <div className="waDocument">
            <div className="waDocumentIcon">PDF</div>
            <div>
              <strong>{documentTitle(message)}</strong>
              <span>
                {formatBytes(message.media_size_bytes)} ·{" "}
                {message.mime_type || message.message_type}
              </span>
            </div>
          </div>
        )}

        {isPdf(message) && draft ? (
          <DraftCard message={message} draft={draft} />
        ) : null}

        {isPdf(message) && !draft && message.storage_path ? (
          <form
            className="waInlineAction"
            action={"/api/ops/messages/" + message.id + "/parse"}
            method="post"
          >
            <button type="submit">Parse bill data</button>
          </form>
        ) : null}

        <div className="waBubbleActions">
          {message.storage_path ? (
            <a
              href={"/api/ops/media/" + message.id}
              target="_blank"
              rel="noreferrer"
            >
              View file
            </a>
          ) : (
            <span>Raw file deleted</span>
          )}
          {message.storage_path ? (
            <details className="waDelete">
              <summary>Delete</summary>
              <form
                action={"/api/ops/media/" + message.id + "/delete"}
                method="post"
              >
                <span>Structured data stays.</span>
                <button type="submit">Confirm delete</button>
              </form>
            </details>
          ) : null}
        </div>

        <footer>
          <span>{documentStatus(draft)}</span>
          <time>{formatTime(message.received_at)}</time>
        </footer>
      </div>
    </article>
  );
}

function OutboundBubble({ message }: { message: OpsOutboundMessage }) {
  return (
    <article className="waRow waRowOutbound">
      <div className="waBubble waOutboundBubble">
        <p className="waMessageText">{message.body}</p>
        {message.error_message ? (
          <p className="waSendError">{message.error_message}</p>
        ) : null}
        <footer>
          <span>{message.status}</span>
          <time>{formatTime(message.sent_at || message.created_at)}</time>
        </footer>
      </div>
    </article>
  );
}

export default async function OpsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    conversation?: string;
    reply?: string;
    document?: string;
    stock?: string;
  }>;
}) {
  const cookieStore = await cookies();
  const session = cookieStore.get(OPS_SESSION_COOKIE)?.value;
  if (!verifyOpsSession(session)) redirect("/ops/login");

  const params = await searchParams;
  const [messages, outbound] = await Promise.all([
    listOpsMessages(),
    listOpsOutboundMessages(),
  ]);
  const drafts = await listOpsDraftsForMessages(
    messages.map((message) => message.id),
  );
  const conversations = buildOpsConversations(messages, outbound);
  const selected =
    conversations.find((item) => item.key === params.conversation) ??
    conversations[0] ??
    null;

  const health = getHealthConfiguration();
  const runtimeHealthy =
    health.validation.webhook && health.validation.ingestion;

  const timeline = selected
    ? [
        ...selected.messages.map((message) => ({
          type: "inbound" as const,
          time: message.received_at,
          message,
        })),
        ...selected.outbound.map((message) => ({
          type: "outbound" as const,
          time: message.sent_at || message.created_at,
          message,
        })),
      ].sort(
        (left, right) =>
          new Date(left.time).getTime() - new Date(right.time).getTime(),
      )
    : [];

  const latestInbound = selected?.messages[selected.messages.length - 1] ?? null;
  const canReply =
    latestInbound && isWithinCustomerServiceWindow(latestInbound.received_at);
  const lastTimelineEntry = timeline[timeline.length - 1];
  const lastEventKey = lastTimelineEntry
    ? lastTimelineEntry.type + "-" + lastTimelineEntry.message.id
    : "empty";

  return (
    <main className="waShell">
      <OpsLiveRefresh />

      {(params.reply || params.document || params.stock) && (
        <div className="waNotice" role="status">
          {params.reply === "sent" ? "Reply sent." : null}
          {params.reply === "window_closed"
            ? "24-hour reply window is closed. A Meta template would be required."
            : null}
          {params.reply === "failed"
            ? "Reply failed. The message was not automatically retried."
            : null}
          {params.reply === "pending"
            ? "Reply is still being processed."
            : null}
          {params.reply === "invalid" ? "Reply text was invalid." : null}
          {params.document === "approved" ? "Parsed bill approved." : null}
          {params.document === "approval_failed"
            ? "Bill approval was not allowed."
            : null}
          {params.document === "failed" ? "Bill parsing failed." : null}
          {params.document &&
          !["approved", "approval_failed", "failed"].includes(params.document)
            ? "Bill parsed: " + params.document.replaceAll("_", " ") + "."
            : null}
          {params.stock
            ? " Stock: " + params.stock.replaceAll("_", " ") + "."
            : null}
        </div>
      )}

      <div className="waApp">
        <aside className="waConversationList">
          <header className="waSidebarHeader">
            <div className="waAvatar waBrandAvatar">S</div>
            <div className="waSidebarIdentity">
              <strong>Solar Ops</strong>
              <span className={runtimeHealthy ? "waOnline" : "waOffline"}>
                {runtimeHealthy ? "Live" : "Check config"}
              </span>
            </div>
            <div className="waHeaderActions">
              <a className="waHeaderAction" href="/ops/stock">
                Stock
              </a>
              <form action="/api/ops/logout" method="post">
                <button className="waHeaderAction" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </header>

          <div className="waListHeader">
            <h1>Chats</h1>
            <span>{conversations.length}</span>
          </div>

          <div className="waConversationScroll">
            {conversations.length === 0 ? (
              <p className="waEmptyList">No WhatsApp messages yet.</p>
            ) : (
              conversations.map((conversation) => {
                const latest =
                  conversation.messages[conversation.messages.length - 1];
                return (
                  <a
                    className={
                      "waConversation " +
                      (selected?.key === conversation.key
                        ? "waConversationActive"
                        : "")
                    }
                    href={"/ops?conversation=" + conversation.key}
                    key={conversation.key}
                  >
                    <div className="waAvatar">
                      {(conversation.senderName || "W")
                        .slice(0, 1)
                        .toUpperCase()}
                    </div>
                    <div>
                      <strong>
                        {conversation.senderName || "WhatsApp sender"}
                      </strong>
                      <p>{documentTitle(latest)}</p>
                      <span>{maskSender(conversation.senderPhone)}</span>
                    </div>
                    <time>{formatTime(conversation.latestReceivedAt)}</time>
                  </a>
                );
              })
            )}
          </div>
        </aside>

        <section className="waChat">
          {selected ? (
            <>
              <header className="waChatHeader">
                <div className="waAvatar">
                  {(selected.senderName || "W").slice(0, 1).toUpperCase()}
                </div>
                <div className="waChatIdentity">
                  <strong>{selected.senderName || "WhatsApp sender"}</strong>
                  <span>{maskSender(selected.senderPhone)}</span>
                </div>
                <span className="waLiveLabel">Live updates</span>
              </header>

              <ChatTimeline
                conversationKey={selected.key}
                lastEventKey={lastEventKey}
              >
                {timeline.map((entry) =>
                  entry.type === "inbound" ? (
                    <InboundBubble
                      draft={drafts.get(entry.message.id)}
                      key={"in-" + entry.message.id}
                      message={entry.message}
                    />
                  ) : (
                    <OutboundBubble
                      key={"out-" + entry.message.id}
                      message={entry.message}
                    />
                  ),
                )}
              </ChatTimeline>

              <footer className="waComposer">
                {latestInbound && canReply ? (
                  <ReplyForm
                    action={"/api/ops/messages/" + latestInbound.id + "/reply"}
                    requestId={randomUUID()}
                  />
                ) : (
                  <p>
                    Free-form reply unavailable: no inbound message in the last
                    24 hours.
                  </p>
                )}
              </footer>
            </>
          ) : (
            <div className="waNoChat">Select a WhatsApp conversation.</div>
          )}
        </section>
      </div>
    </main>
  );
}
