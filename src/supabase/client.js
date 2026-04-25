import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient(options = {}) {
  const url = options.url || process.env.SUPABASE_URL || "";
  const serviceRoleKey = options.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url) throw new Error("SUPABASE_URL is not configured.");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function resolveSupabaseClient(client) {
  return client || createSupabaseAdminClient();
}
