const MAP_PROJECT_URL = "https://dwzdqekusvivjbxsapdu.supabase.co";

export const MAP_DASHBOARD_MANAGER_SYSTEM_KEYS = Object.freeze({
  "afeist@memphiszoo.org": "annie_feist_operations_admin",
  "bgull@memphiszoo.org": "brandy_gull_horticulture_manager",
  "emckenney@memphiszoo.org": "eric_mckenney_facilities_maintenance_manager",
  "hlejman@memphiszoo.org": "haley_lejman_water_quality_manager",
  "jsheffield@memphiszoo.org": "jennifer_sheffield_director_operations",
});

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function mapConfiguration(env = process.env) {
  const configuredUrl = String(env.MEMPHIS_MAP_SUPABASE_URL || MAP_PROJECT_URL).trim().replace(/\/$/, "");
  const publishableKey = String(env.MEMPHIS_MAP_SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (configuredUrl !== MAP_PROJECT_URL) throw fail(503, "Memphis Map identity provider configuration is invalid.");
  if (!publishableKey || /service_role|secret/i.test(publishableKey)) {
    throw fail(503, "Memphis Map identity verification is not configured.");
  }
  return { url: configuredUrl, publishableKey };
}

export function isMapDashboardSession(session) {
  return /^map_identity:[a-z0-9_]+$/.test(String(session?.auth_mode || ""))
    && session?.access_level === "read_only"
    && session?.read_only === true;
}

export async function verifyMapManagerAccessToken(accessToken, {
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const token = String(accessToken || "").trim();
  if (!token || token.length > 8192 || typeof fetchImpl !== "function") {
    throw fail(401, "A current Memphis Map sign-in is required.");
  }
  const { url, publishableKey } = mapConfiguration(env);
  let response;
  try {
    response = await fetchImpl(`${url}/auth/v1/user`, {
      method: "GET",
      cache: "no-store",
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw fail(503, "Memphis Map sign-in verification is temporarily unavailable.");
  }
  const user = await response.json().catch(() => null);
  if (!response.ok || !user || typeof user !== "object" || Array.isArray(user)) {
    throw fail(401, "The Memphis Map sign-in is no longer current.");
  }
  const email = normalizeEmail(user.email);
  const systemKey = MAP_DASHBOARD_MANAGER_SYSTEM_KEYS[email] || "";
  const confirmed = Boolean(user.email_confirmed_at || user.confirmed_at);
  if (!systemKey || !confirmed || !String(user.id || "").trim()) {
    throw fail(403, "This Memphis Map account does not have Custodial dashboard access.");
  }
  return Object.freeze({
    provider: "memphis_map",
    provider_user_id: String(user.id),
    email,
    system_key: systemKey,
  });
}

export async function verifyCurrentMapDashboardSession(session, { store } = {}) {
  if (!isMapDashboardSession(session) || !store?.getManagerBySystemKey) {
    return { ok: false, status: 403, error: "A current named Memphis Map manager session is required." };
  }
  const systemKey = String(session.auth_mode).slice("map_identity:".length);
  if (!Object.values(MAP_DASHBOARD_MANAGER_SYSTEM_KEYS).includes(systemKey)) {
    return { ok: false, status: 403, error: "This Memphis Map account does not have Custodial dashboard access." };
  }
  const manager = await store.getManagerBySystemKey(systemKey);
  if (!manager?.active || manager.revoked_at || String(manager.manager_id || "") !== String(session.manager_id || "")) {
    return { ok: false, status: 403, error: "This manager dashboard access is no longer active." };
  }
  return {
    ok: true,
    manager,
    session: {
      ...session,
      manager_id: manager.manager_id,
      manager_display_name: manager.display_name,
      // Map identity grants dashboard-only access. Preserve the manager row,
      // but project only the least-privilege role into this session so Map SSO
      // cannot surface Custodial owner/security controls.
      roles: ["OPS_MANAGER"],
      access_level: "read_only",
      read_only: true,
      trusted_device: false,
    },
  };
}
