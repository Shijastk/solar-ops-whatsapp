import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  OPS_SESSION_COOKIE,
  verifyOpsSession,
} from "@/lib/ops-auth";
import { getAgentEnabled } from "@/lib/agent-settings";

export const dynamic = "force-dynamic";

const resultMessages: Record<string, string> = {
  enabled: "Agent enabled. Operational workflows will use the central setting.",
  disabled: "Agent disabled. New operational processing is paused.",
  failed: "Could not save the setting. The current state has not been confirmed.",
  invalid: "Invalid setting request.",
};

export default async function AgentSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const cookieStore = await cookies();
  if (!verifyOpsSession(cookieStore.get(OPS_SESSION_COOKIE)?.value)) {
    redirect("/ops/login");
  }

  const [enabled, params] = await Promise.all([
    getAgentEnabled(),
    searchParams,
  ]);

  return (
    <main className="opsShell">
      <header className="opsTopbar">
        <div>
          <p className="opsBrand">SOLAR OPS</p>
          <h1>Agent settings</h1>
          <p>One control for operational WhatsApp automation.</p>
        </div>
        <div className="opsTopbarActions">
          <a className="opsSecondaryButton" href="/ops">Back to WhatsApp</a>
          <a className="opsSecondaryButton" href="/ops/stock">Stock</a>
        </div>
      </header>

      {params.result && resultMessages[params.result] ? (
        <p className="opsAlert" role="status">{resultMessages[params.result]}</p>
      ) : null}

      <section className="opsStats" aria-labelledby="agent-toggle-heading">
        <article>
          <span>Operational agent</span>
          <strong id="agent-toggle-heading">{enabled ? "Enabled" : "Disabled"}</strong>
          <p>
            {enabled
              ? "Incoming operational messages may run enabled workflows."
              : "Incoming messages are stored, but automated workflow handling is paused."}
          </p>
          <form action="/api/ops/settings/agent" method="post" style={{ marginTop: 18 }}>
            <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
            <button
              className={enabled ? "opsDangerButton" : "opsPrimaryButton"}
              type="submit"
            >
              {enabled ? "Disable agent" : "Enable agent"}
            </button>
          </form>
        </article>
      </section>
    </main>
  );
}
