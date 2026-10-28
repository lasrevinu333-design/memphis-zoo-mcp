import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Only digests of opaque artifacts cross the database boundary; no raw token is stored.
export function oauthArtifactDigest(kind, value) {
  return createHash("sha256").update(JSON.stringify(["custodial.mcp-oauth.durable.v2", kind, value])).digest("hex");
}
export function oauthBindingDigest(config, clientId, authorityGeneration) {
  return oauthArtifactDigest("binding", [config.issuer, config.resource, config.operatorSub, clientId, authorityGeneration]);
}
export function createMcpOAuthDurableStore(env = process.env) {
  const url = String(env.SUPABASE_URL || "").trim();
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init = {}) => fetch(input, { ...init,
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }) } });
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error || typeof data !== "boolean") throw new Error("Durable OAuth authority did not confirm operation.");
    return data;
  }
  return {
    async generation() {
      const { data, error } = await client.rpc("mcp_oauth_authority_generation_v2");
      if (error || typeof data !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(data)
          || BigInt(data)>9223372036854775807n) throw new Error("OAuth generation unavailable.");
      return data;
    },
    consumeDecision: ({ artifactDigest, expiresAt, authorityGeneration }) => rpc("mcp_oauth_consume_decision_v2", {
      p_artifact_digest: artifactDigest, p_expires_at: expiresAt, p_authority_generation: authorityGeneration }),
    exchange: ({ codeDigest, codeExpiresAt, familyDigest, bindingDigest, refreshDigest, expiresAt, authorityGeneration }) => rpc("mcp_oauth_exchange_code_v2", {
      p_code_digest: codeDigest, p_code_expires_at: codeExpiresAt, p_family_digest: familyDigest,
      p_binding_digest: bindingDigest, p_refresh_digest: refreshDigest, p_expires_at: expiresAt, p_authority_generation: authorityGeneration }),
    rotate: ({ familyDigest, bindingDigest, previousDigest, generation, nextDigest, expiresAt, authorityGeneration }) => rpc("mcp_oauth_rotate_refresh_v2", {
      p_family_digest: familyDigest, p_binding_digest: bindingDigest, p_previous_digest: previousDigest,
      p_generation: generation, p_next_digest: nextDigest, p_expires_at: expiresAt, p_authority_generation: authorityGeneration }),
    active: ({ familyDigest, bindingDigest, authorityGeneration }) => rpc("mcp_oauth_family_active_v2", {
      p_family_digest: familyDigest, p_binding_digest: bindingDigest, p_authority_generation: authorityGeneration }),
  };
}
