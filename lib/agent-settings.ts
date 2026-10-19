import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function getAgentEnabled(): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("ops_agent_settings")
      .select("enabled")
      .eq("singleton", true)
      .maybeSingle();

    if (error || !data) {
      console.error("Central agent setting could not be read", {
        reason: error?.message ?? "setting row missing",
      });
      return false;
    }

    return data.enabled === true;
  } catch (error) {
    console.error("Central agent setting could not be read", {
      reason: error instanceof Error ? error.message.slice(0, 160) : "unknown error",
    });
    return false;
  }
}

export async function setAgentEnabled(enabled: boolean): Promise<void> {
  const { data, error } = await getSupabaseAdmin()
    .from("ops_agent_settings")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("singleton", true)
    .select("enabled")
    .maybeSingle();

  if (error || !data || data.enabled !== enabled) {
    throw new Error("Central agent setting could not be updated");
  }
}
