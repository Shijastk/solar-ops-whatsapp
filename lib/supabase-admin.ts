import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getIngestionEnv } from "@/lib/env";

let client: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) {
    return client;
  }

  const env = getIngestionEnv();

  client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return client;
}
