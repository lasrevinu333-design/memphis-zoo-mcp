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
  const fromCustomHeader = requestMcpConnectorCustomToken(req);
  if (fromCustomHeader) return String(fromCustomHeader).trim();

  return requestMcpBearerToken(req);
}

export function requestMcpConnectorCustomToken(req) {
  return String(
    req?.header?.("x-memphis-connector-token")
    || req?.header?.("x-mcp-connector-token")
    || ""
  ).trim();
}

export function requestMcpBearerToken(req) {
  const authHeader = String(req?.header?.("authorization") || req?.headers?.authorization || "").trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) return authHeader.slice(7).trim();
  return "";
}

function createConnectorSession({ now = new Date(), authMode = "connector_token", authInfo = null } = {}) {
  return {
    role: "connector_service",
    auth_mode: authMode,
    token_name: authMode === "connector_token" ? "MCP_CONNECTOR_TOKEN" : null,
    read_only: false,
    issued_at: now.toISOString(),
    subject: authInfo?.extra?.subject || null,
    client_id: authInfo?.clientId || null,
    expires_at: authInfo?.expiresAt || null,
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

export async function authenticateMcpConnectorRequestWithOAuth(
  req,
  {
    env = process.env,
    now = new Date(),
    allowReadOnlyNoAuth = isMcpReadOnlyNoAuthEnabled(env),
    oauthVerifier = null,
  } = {}
) {
  const configuredConnectorToken = getMcpConnectorToken(env);
  const customToken = requestMcpConnectorCustomToken(req);
  const bearerToken = requestMcpBearerToken(req);

  // Custom connector headers are a legacy service-token lane only. Never pass
  // a wrong custom token into OAuth validation or downgrade it to tokenless access.
  if (customToken) {
    if (!configuredConnectorToken || !safeStringEqual(customToken, configuredConnectorToken)) {
      return { ok: false, status: 401, error: "Unauthorized", code: "invalid_token" };
    }
    return authenticateMcpConnectorRequest(req, { env, now, allowReadOnlyNoAuth });
  }

  if (bearerToken && configuredConnectorToken && safeStringEqual(bearerToken, configuredConnectorToken)) {
    return authenticateMcpConnectorRequest(req, { env, now, allowReadOnlyNoAuth });
  }

  if (bearerToken && oauthVerifier) {
    try {
      const authInfo = await oauthVerifier.verifyAccessToken(bearerToken);
      return {
        ok: true,
        session: createConnectorSession({ now, authMode: "supabase_oauth", authInfo }),
        auth_source: "supabase_oauth",
        auth_info: authInfo,
      };
    } catch {
      return { ok: false, status: 401, error: "Unauthorized", code: "invalid_token" };
    }
  }

  if (!bearerToken && oauthVerifier && !allowReadOnlyNoAuth) {
    return { ok: false, status: 401, error: "Unauthorized", code: "invalid_token" };
  }

  return authenticateMcpConnectorRequest(req, { env, now, allowReadOnlyNoAuth });
}

export function makeMcpConnectorMiddleware(
  {
    env = process.env,
    allowReadOnlyNoAuth = isMcpReadOnlyNoAuthEnabled(env),
    oauthVerifier = null,
    resourceMetadataUrl = null,
  } = {}
) {
  return async function requireMcpConnectorAuth(req, res, next) {
    const result = await authenticateMcpConnectorRequestWithOAuth(req, {
      env,
      allowReadOnlyNoAuth,
      oauthVerifier,
    });
    if (!result.ok) {
      if ((result.status || 401) === 401 && resourceMetadataUrl) {
        res.setHeader(
          "WWW-Authenticate",
          `Bearer error="invalid_token", error_description="Unauthorized", resource_metadata="${resourceMetadataUrl}"`,
        );
      }
      res.status(result.status || 401).json({
        ok: false,
        error: result.error || "Unauthorized",
        code: result.code || ((result.status || 401) === 401 ? "invalid_token" : "authentication_unavailable"),
      });
      return;
    }
    req.memphisAuth = result.session;
    req.memphisMcpAuth = {
      source: result.auth_source || result.session?.auth_mode || "unknown",
      read_only: Boolean(result.session?.read_only),
    };
    if (result.auth_info) req.auth = result.auth_info;
    next();
  };
}
