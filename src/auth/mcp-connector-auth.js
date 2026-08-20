import { timingSafeEqual } from "node:crypto";

function safeStringEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function getMcpConnectorToken(env = process.env) {
  return String(env?.MCP_CONNECTOR_TOKEN || "").trim();
}

export function isMcpFullNoAuthEnabled(_env = process.env) {
  // Full mutation authority always requires an authenticated connector token.
  // Keep this compatibility helper fail-closed so a stale deployment setting
  // cannot silently restore the retired tokenless mutation surface.
  return false;
}

export function isMcpReadOnlyNoAuthEnabled(env = process.env) {
  const value = String(env?.MCP_ALLOW_READONLY_NOAUTH ?? "false").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(value);
}

export function requestMcpConnectorToken(req) {
  const fromCustomHeader =
    req?.header?.("x-memphis-connector-token")
    || req?.header?.("x-mcp-connector-token");
  if (fromCustomHeader) return String(fromCustomHeader).trim();

  const authHeader = String(req?.header?.("authorization") || "").trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) return authHeader.slice(7).trim();
  return "";
}

function createConnectorSession({ now = new Date(), authMode = "connector_token" } = {}) {
  return {
    role: "connector_service",
    auth_mode: authMode,
    token_name: authMode === "connector_token" ? "MCP_CONNECTOR_TOKEN" : null,
    read_only: false,
    issued_at: now.toISOString(),
  };
}

function createReadOnlyConnectorSession({ now = new Date() } = {}) {
  return {
    role: "connector_readonly",
    auth_mode: "noauth_readonly",
    read_only: true,
    issued_at: now.toISOString(),
  };
}

export function authenticateMcpConnectorRequest(
  req,
  {
    env = process.env,
    now = new Date(),
    allowReadOnlyNoAuth = isMcpReadOnlyNoAuthEnabled(env),
  } = {}
) {
  const configuredConnectorToken = getMcpConnectorToken(env);
  const providedConnectorToken = requestMcpConnectorToken(req);

  // Tokenless access is restricted to the separately enabled diagnostic-only
  // server. It never reaches GitHub or Supabase mutators. A presented but
  // incorrect token is never downgraded to tokenless access.
  if (!providedConnectorToken && allowReadOnlyNoAuth) {
    return {
      ok: true,
      session: createReadOnlyConnectorSession({ now }),
      auth_source: "noauth_readonly",
    };
  }

  if (!configuredConnectorToken) {
    return { ok: false, status: 503, error: "MCP connector authentication is not configured." };
  }

  if (!providedConnectorToken || !safeStringEqual(providedConnectorToken, configuredConnectorToken)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return {
    ok: true,
    session: createConnectorSession({ now }),
    auth_source: "connector_token",
  };
}

export function makeMcpConnectorMiddleware(
  {
    env = process.env,
    allowReadOnlyNoAuth = isMcpReadOnlyNoAuthEnabled(env),
  } = {}
) {
  return function requireMcpConnectorAuth(req, res, next) {
    const result = authenticateMcpConnectorRequest(req, { env, allowReadOnlyNoAuth });
    if (!result.ok) {
      res.status(result.status || 401).json({ ok: false, error: result.error || "Unauthorized" });
      return;
    }
    req.memphisAuth = result.session;
    req.memphisMcpAuth = {
      source: result.auth_source || result.session?.auth_mode || "unknown",
      read_only: Boolean(result.session?.read_only),
    };
    next();
  };
}
