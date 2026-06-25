import { timingSafeEqual } from "node:crypto";
import { authenticateDailyPinRequest } from "./daily-pin-auth.js";

function safeStringEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function getMcpConnectorToken(env = process.env) {
  return String(env?.MCP_CONNECTOR_TOKEN || "").trim();
}

export function requestMcpConnectorToken(req) {
  // Check custom connector token headers first
  const fromCustomHeader =
    req?.header?.("x-memphis-connector-token")
    || req?.header?.("x-mcp-connector-token");

  if (fromCustomHeader) return String(fromCustomHeader).trim();

  // Fall back to Authorization: Bearer <token> (standard HTTP auth).
  // ChatGPT MCP connectors send this via service_http auth type.
  const authHeader = String(req?.header?.("authorization") || "").trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  return "";
}

function createConnectorSession({ now = new Date() } = {}) {
  return {
    role: "connector_service",
    auth_mode: "connector_token",
    token_name: "MCP_CONNECTOR_TOKEN",
    issued_at: now.toISOString(),
  };
}

export function authenticateMcpConnectorRequest(req, { env = process.env, now = new Date() } = {}) {
  const configuredConnectorToken = getMcpConnectorToken(env);
  const providedConnectorToken = requestMcpConnectorToken(req);

  if (configuredConnectorToken) {
    if (providedConnectorToken && safeStringEqual(providedConnectorToken, configuredConnectorToken)) {
      return {
        ok: true,
        session: createConnectorSession({ now }),
        auth_source: "connector_token",
      };
    }

    const pinResult = authenticateDailyPinRequest(req, {
      allowedRoles: ["ops_manager"],
      env,
      openWhenDisabled: false,
    });
    if (pinResult.ok) {
      return { ...pinResult, auth_source: "daily_pin" };
    }
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const fallbackResult = authenticateDailyPinRequest(req, {
    allowedRoles: ["ops_manager"],
    env,
    openWhenDisabled: true,
  });
  if (fallbackResult.ok) {
    return { ...fallbackResult, auth_source: fallbackResult.session?.auth_mode === "open" ? "open_ops_manager" : "daily_pin" };
  }
  return fallbackResult;
}

export function makeMcpConnectorMiddleware({ env = process.env } = {}) {
  return function requireMcpConnectorOrOps(req, res, next) {
    const result = authenticateMcpConnectorRequest(req, { env });
    if (!result.ok) {
      res.status(result.status || 401).json({ ok: false, error: result.error || "Unauthorized" });
      return;
    }
    req.memphisAuth = result.session;
    req.memphisMcpAuth = { source: result.auth_source || null };
    next();
  };
}
