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

export function isMcpReadOnlyNoAuthEnabled(env = process.env) {
  const value = String(env?.MCP_ALLOW_READONLY_NOAUTH ?? "true").trim().toLowerCase();
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

function createConnectorSession({ now = new Date() } = {}) {
  return {
    role: "connector_service",
    auth_mode: "connector_token",
    token_name: "MCP_CONNECTOR_TOKEN",
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

  // ChatGPT custom apps do not send customer-defined API-key headers. Permit a
  // tokenless handshake only in an explicitly read-only tool mode. A presented
  // but incorrect token is never downgraded to anonymous access.
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
