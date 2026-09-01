import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import express from "express";
import { createClient } from "@supabase/supabase-js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTHORIZATION_ID_PATTERN = /^[A-Za-z0-9._~-]{1,512}$/;
const SUPPORTED_SCOPES = new Set(["openid", "email", "profile", "phone"]);
const DEFAULT_SCOPES = ["openid", "email", "profile"];
const COOKIE_VERSION = "v1";
const HTTPS_COOKIE_NAME = "__Host-memphis_mcp_oauth";
const LOCAL_COOKIE_NAME = "memphis_mcp_oauth";
const DEFAULT_UI_SESSION_SECONDS = 8 * 60 * 60;
const DEFAULT_CSRF_SECONDS = 10 * 60;

function enabledFlag(value, fallback = false) {
  if (value == null || String(value).trim() === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function scopeList(value) {
  const values = String(value || "").trim().split(/[\s,]+/).filter(Boolean);
  return values.length ? [...new Set(values)] : [...DEFAULT_SCOPES];
}

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function parseOrigin(name, value, errors, { allowLocalHttp = false } = {}) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) {
    errors.push(`${name} is missing.`);
    return null;
  }
  try {
    const url = new URL(raw);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(allowLocalHttp && local)) {
      errors.push(`${name} must use HTTPS${allowLocalHttp ? " or local HTTP" : ""}.`);
    }
    if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
      errors.push(`${name} must be one origin without credentials, path, query, or fragment.`);
    }
    return url.origin;
  } catch {
    errors.push(`${name} must be a valid URL origin.`);
    return null;
  }
}

export function getMcpOAuthConfig(env = process.env) {
  const enabled = enabledFlag(env.MCP_OAUTH_ENABLED, false);
  if (!enabled) {
    return {
      enabled: false,
      ready: true,
      errors: [],
      scopes: [...DEFAULT_SCOPES],
      allowedSubjects: new Set(),
      allowedClientIds: new Set(),
    };
  }

  const errors = [];
  const publicOrigin = parseOrigin("MCP_PUBLIC_URL", env.MCP_PUBLIC_URL, errors, { allowLocalHttp: true });
  const supabaseOrigin = parseOrigin("SUPABASE_URL", env.SUPABASE_URL, errors, { allowLocalHttp: true });
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "").trim();
  const cookieSecret = String(env.MCP_OAUTH_COOKIE_SECRET || "").trim();
  const allowedSubjects = new Set(csv(env.MCP_OAUTH_ALLOWED_SUBJECTS));
  const allowedClientIds = new Set(csv(env.MCP_OAUTH_ALLOWED_CLIENT_IDS));
  const scopes = scopeList(env.MCP_OAUTH_SCOPES);

  if (!publishableKey) errors.push("SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY is missing.");
  if (cookieSecret.length < 32) errors.push("MCP_OAUTH_COOKIE_SECRET must contain at least 32 characters.");
  if (!allowedSubjects.size) errors.push("MCP_OAUTH_ALLOWED_SUBJECTS must contain at least one Supabase Auth user UUID.");
  if (!allowedClientIds.size) errors.push("MCP_OAUTH_ALLOWED_CLIENT_IDS must contain at least one Supabase OAuth client UUID.");
  for (const subject of allowedSubjects) {
    if (!UUID_PATTERN.test(subject)) errors.push(`MCP_OAUTH_ALLOWED_SUBJECTS contains an invalid UUID: ${subject}`);
  }
  for (const clientId of allowedClientIds) {
    if (!UUID_PATTERN.test(clientId)) errors.push(`MCP_OAUTH_ALLOWED_CLIENT_IDS contains an invalid UUID: ${clientId}`);
  }
  for (const scope of scopes) {
    if (!SUPPORTED_SCOPES.has(scope)) errors.push(`MCP_OAUTH_SCOPES contains unsupported scope: ${scope}`);
  }

  const issuer = supabaseOrigin ? `${supabaseOrigin}/auth/v1` : null;
  const resource = publicOrigin ? `${publicOrigin}/mcp` : null;
  const resourceMetadataUrl = publicOrigin
    ? `${publicOrigin}/.well-known/oauth-protected-resource/mcp`
    : null;

  return {
    enabled: true,
    ready: errors.length === 0,
    errors,
    publicOrigin,
    supabaseOrigin,
    issuer,
    resource,
    resourceMetadataUrl,
    publishableKey,
    cookieSecret,
    allowedSubjects,
    allowedClientIds,
    scopes,
    uiSessionSeconds: boundedPositiveInteger(
      env.MCP_OAUTH_UI_SESSION_SECONDS,
      DEFAULT_UI_SESSION_SECONDS,
      24 * 60 * 60,
    ),
    csrfSeconds: boundedPositiveInteger(env.MCP_OAUTH_CSRF_SECONDS, DEFAULT_CSRF_SECONDS, 30 * 60),
  };
}

export function assertMcpOAuthConfig(env = process.env) {
  const config = getMcpOAuthConfig(env);
  if (config.enabled && !config.ready) {
    throw new Error(`MCP OAuth configuration is invalid: ${config.errors.join(" ")}`);
  }
  return config;
}

export function buildMcpProtectedResourceMetadata(config) {
  if (!config?.enabled || !config?.ready) throw new Error("MCP OAuth must be enabled and configured.");
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...config.scopes],
    resource_name: "Memphis Zoo MCP",
  };
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error("Malformed JWT.");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Malformed JWT payload.");
  return payload;
}

function tokenScopes(payload) {
  if (Array.isArray(payload.scope)) return payload.scope.map(String).filter(Boolean);
  if (typeof payload.scope === "string") return payload.scope.split(/\s+/).filter(Boolean);
  return [];
}

export class McpOAuthTokenError extends Error {
  constructor(message = "Invalid OAuth access token.") {
    super(message);
    this.name = "McpOAuthTokenError";
  }
}

function createBrowserlessSupabaseClient(config) {
  return createClient(config.supabaseOrigin, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createMcpOAuthVerifier({ env = process.env, supabaseClient } = {}) {
  const config = assertMcpOAuthConfig(env);
  if (!config.enabled) return null;
  const client = supabaseClient || createBrowserlessSupabaseClient(config);

  return {
    config,
    async verifyAccessToken(token) {
      let payload;
      try {
        payload = decodeJwtPayload(token);
      } catch {
        throw new McpOAuthTokenError();
      }

      const subject = String(payload.sub || "");
      const clientId = String(payload.client_id || "");
      const expiresAt = Number(payload.exp);
      if (
        payload.iss !== config.issuer
        || !config.allowedSubjects.has(subject)
        || !config.allowedClientIds.has(clientId)
        || !Number.isFinite(expiresAt)
        || expiresAt <= Date.now() / 1000
      ) {
        throw new McpOAuthTokenError();
      }

      const { data, error } = await client.auth.getUser(token);
      const user = data?.user;
      if (error || !user || user.id !== subject || !config.allowedSubjects.has(user.id)) {
        throw new McpOAuthTokenError();
      }

      return {
        token,
        clientId,
        scopes: tokenScopes(payload),
        expiresAt,
        extra: {
          subject,
          issuer: config.issuer,
          authSource: "supabase_oauth",
        },
      };
    },
  };
}

function keyFromSecret(secret) {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function sealMcpOAuthSession(session, secret, random = randomBytes) {
  const iv = random(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [COOKIE_VERSION, iv.toString("base64url"), encrypted.toString("base64url"), tag.toString("base64url")].join(".");
}

export function openMcpOAuthSession(value, secret) {
  try {
    const [version, ivValue, encryptedValue, tagValue, extra] = String(value || "").split(".");
    if (version !== COOKIE_VERSION || !ivValue || !encryptedValue || !tagValue || extra) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(decrypted.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function cookieName(config) {
  return config.publicOrigin.startsWith("https://") ? HTTPS_COOKIE_NAME : LOCAL_COOKIE_NAME;
}

function parseCookies(req) {
  const values = {};
  for (const pair of String(req.headers?.cookie || "").split(";")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (name) values[name] = value;
  }
  return values;
}

function setSessionCookie(res, config, session) {
  const value = sealMcpOAuthSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    user_id: session.user?.id || null,
  }, config.cookieSecret);
  if (value.length > 3800) throw new Error("MCP OAuth session exceeds the safe cookie size.");
  const secure = config.publicOrigin.startsWith("https://") ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${cookieName(config)}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${config.uiSessionSeconds}`,
  );
}

function clearSessionCookie(res, config) {
  const secure = config.publicOrigin.startsWith("https://") ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${cookieName(config)}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`,
  );
}

function normalizeAuthorizationId(value) {
  const authorizationId = String(value || "").trim();
  return AUTHORIZATION_ID_PATTERN.test(authorizationId) ? authorizationId : "";
}

function safeStringEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function csrfToken(config, authorizationId, userId, issuedAt) {
  const signature = createHmac("sha256", config.cookieSecret)
    .update(`${authorizationId}\n${userId}\n${issuedAt}`)
    .digest("base64url");
  return `${issuedAt}.${signature}`;
}

function verifyCsrfToken(config, token, authorizationId, userId, nowSeconds) {
  const [issuedValue, signature, extra] = String(token || "").split(".");
  const issuedAt = Number(issuedValue);
  if (extra || !Number.isSafeInteger(issuedAt) || !signature) return false;
  if (issuedAt > nowSeconds + 30 || nowSeconds - issuedAt > config.csrfSeconds) return false;
  return safeStringEqual(token, csrfToken(config, authorizationId, userId, issuedAt));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function page({ title, body }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;background:#0b1f16;color:#f5fff9}main{max-width:42rem;margin:8vh auto;padding:2rem;background:#123425;border:1px solid #3f765b;border-radius:1rem;box-shadow:0 1rem 3rem #0006}h1{margin-top:0}label{display:block;margin-top:1rem;font-weight:650}input{box-sizing:border-box;width:100%;margin-top:.35rem;padding:.75rem;border-radius:.5rem;border:1px solid #79a98f;background:#fff;color:#102117}button{margin-top:1.25rem;padding:.75rem 1rem;border:0;border-radius:.5rem;background:#f4c95d;color:#1b2b21;font-weight:750;cursor:pointer}.deny{background:#d9e4dd}.warning{padding:1rem;border-radius:.5rem;background:#45291b;border:1px solid #d89658}.detail{overflow-wrap:anywhere;color:#d8eee1}.actions{display:flex;gap:.75rem;flex-wrap:wrap}.actions form{display:inline}ul{line-height:1.6}code{overflow-wrap:anywhere}</style></head>
<body><main>${body}</main></body></html>`;
}

function sendHtml(res, status, html) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.status(status).type("html").send(html);
}

function loginPage(authorizationId, error = "") {
  const errorMarkup = error ? `<p class="warning">${escapeHtml(error)}</p>` : "";
  return page({
    title: "Sign in to Memphis Zoo MCP",
    body: `<h1>Sign in to Memphis Zoo MCP</h1>${errorMarkup}
<p>Use the dedicated, allowlisted Supabase Auth account for this private connector.</p>
<form method="post" action="/oauth/login">
<input type="hidden" name="authorization_id" value="${escapeHtml(authorizationId)}">
<label>Email<input required autocomplete="username" inputmode="email" type="email" name="email" maxlength="320"></label>
<label>Password<input required autocomplete="current-password" type="password" name="password" maxlength="1024"></label>
<button type="submit">Sign in</button></form>`,
  });
}

function errorPage(message) {
  return page({
    title: "Memphis Zoo MCP authorization",
    body: `<h1>Authorization unavailable</h1><p class="warning">${escapeHtml(message)}</p>`,
  });
}

function requestedScopes(details) {
  return String(details?.scope || "").split(/\s+/).filter(Boolean);
}

function validateAuthorizationDetails(config, details, userId) {
  if (!details || typeof details !== "object" || !("authorization_id" in details)) {
    throw new Error("Authorization details are unavailable.");
  }
  if (details.user?.id !== userId || !config.allowedSubjects.has(userId)) {
    throw new Error("This Supabase user is not authorized for Memphis Zoo MCP.");
  }
  if (!config.allowedClientIds.has(String(details.client?.id || ""))) {
    throw new Error("This OAuth client is not authorized for Memphis Zoo MCP.");
  }
  const disallowedScopes = requestedScopes(details).filter((scope) => !config.scopes.includes(scope));
  if (disallowedScopes.length) throw new Error("The OAuth client requested an unsupported scope.");
}

function safeOAuthRedirect(redirectUrl, registeredRedirectUri) {
  const target = new URL(redirectUrl);
  const registered = new URL(registeredRedirectUri);
  if (target.origin !== registered.origin || target.pathname !== registered.pathname || target.hash) {
    throw new Error("OAuth provider returned an invalid redirect URI.");
  }
  for (const [name, value] of registered.searchParams.entries()) {
    if (!target.searchParams.getAll(name).includes(value)) {
      throw new Error("OAuth provider returned an invalid redirect URI.");
    }
  }
  return target.href;
}

async function authenticatedUiSession(req, res, config, clientFactory) {
  const sealed = parseCookies(req)[cookieName(config)];
  const stored = openMcpOAuthSession(sealed, config.cookieSecret);
  if (!stored?.access_token || !stored?.refresh_token) return null;
  const client = clientFactory(config);
  const { data, error } = await client.auth.setSession({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
  });
  const session = data?.session;
  if (error || !session?.access_token || !session?.user) {
    clearSessionCookie(res, config);
    return null;
  }
  const { data: userData, error: userError } = await client.auth.getUser(session.access_token);
  const user = userData?.user;
  if (userError || !user || user.id !== session.user.id || !config.allowedSubjects.has(user.id)) {
    clearSessionCookie(res, config);
    return null;
  }
  setSessionCookie(res, config, session);
  return { client, session, user };
}

function createLoginRateLimiter({ windowMs = 15 * 60 * 1000, maximum = 5 } = {}) {
  const attempts = new Map();
  return function allow(req, res) {
    const now = Date.now();
    const key = String(req.ip || req.socket?.remoteAddress || "unknown");
    const current = attempts.get(key);
    const entry = !current || now - current.startedAt >= windowMs
      ? { startedAt: now, count: 0 }
      : current;
    entry.count += 1;
    attempts.set(key, entry);
    if (attempts.size > 1000) {
      for (const [candidate, value] of attempts) {
        if (now - value.startedAt >= windowMs) attempts.delete(candidate);
      }
    }
    if (entry.count <= maximum) return true;
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((windowMs - (now - entry.startedAt)) / 1000))));
    sendHtml(res, 429, errorPage("Too many sign-in attempts. Wait and try again."));
    return false;
  };
}

export function createMcpOAuthRouter({
  env = process.env,
  clientFactory = createBrowserlessSupabaseClient,
  now = () => Date.now(),
} = {}) {
  const config = assertMcpOAuthConfig(env);
  const router = express.Router();
  if (!config.enabled) return router;
  const metadata = buildMcpProtectedResourceMetadata(config);
  const allowLogin = createLoginRateLimiter();

  const serveMetadata = (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(metadata);
  };
  router.get("/.well-known/oauth-protected-resource/mcp", serveMetadata);
  router.get("/.well-known/oauth-protected-resource", serveMetadata);

  router.get("/oauth/consent", async (req, res) => {
    const authorizationId = normalizeAuthorizationId(req.query.authorization_id);
    if (!authorizationId) {
      sendHtml(res, 400, errorPage("The authorization request is missing or malformed."));
      return;
    }
    try {
      const authenticated = await authenticatedUiSession(req, res, config, clientFactory);
      if (!authenticated) {
        sendHtml(res, 200, loginPage(authorizationId));
        return;
      }
      const { data, error } = await authenticated.client.auth.oauth.getAuthorizationDetails(authorizationId);
      if (error || !data) {
        sendHtml(res, 400, errorPage("The OAuth authorization request is invalid or expired."));
        return;
      }
      if (!("authorization_id" in data)) {
        res.redirect(303, data.redirect_url);
        return;
      }
      validateAuthorizationDetails(config, data, authenticated.user.id);
      const issuedAt = Math.floor(now() / 1000);
      const csrf = csrfToken(config, authorizationId, authenticated.user.id, issuedAt);
      const scopes = requestedScopes(data).map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`).join("");
      const body = `<h1>Authorize ${escapeHtml(data.client.name || "ChatGPT")}</h1>
<p class="warning"><strong>Complete access:</strong> approval exposes the Memphis Zoo MCP full GitHub and Supabase tool surface to this OAuth client. ChatGPT will still show its own confirmations for write actions.</p>
<p class="detail"><strong>Client ID:</strong> <code>${escapeHtml(data.client.id)}</code><br><strong>Redirect:</strong> <code>${escapeHtml(data.redirect_uri)}</code></p>
<p>Requested identity scopes:</p><ul>${scopes || "<li>None</li>"}</ul>
<div class="actions"><form method="post" action="/oauth/decision"><input type="hidden" name="authorization_id" value="${escapeHtml(authorizationId)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button name="decision" value="approve" type="submit">Approve complete access</button></form>
<form method="post" action="/oauth/decision"><input type="hidden" name="authorization_id" value="${escapeHtml(authorizationId)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="deny" name="decision" value="deny" type="submit">Deny</button></form></div>`;
      sendHtml(res, 200, page({ title: "Authorize Memphis Zoo MCP", body }));
    } catch {
      sendHtml(res, 403, errorPage("This user or OAuth client is not authorized for Memphis Zoo MCP."));
    }
  });

  router.post("/oauth/login", async (req, res) => {
    const authorizationId = normalizeAuthorizationId(req.body?.authorization_id);
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");
    if (!authorizationId || !email || !password) {
      sendHtml(res, 400, loginPage(authorizationId, "Email, password, and authorization request are required."));
      return;
    }
    if (!allowLogin(req, res)) return;
    const client = clientFactory(config);
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data?.session?.user || !config.allowedSubjects.has(data.session.user.id)) {
        if (data?.session) await client.auth.signOut({ scope: "local" }).catch(() => {});
        sendHtml(res, 401, loginPage(authorizationId, "Sign-in failed or this account is not allowlisted."));
        return;
      }
      setSessionCookie(res, config, data.session);
      res.redirect(303, `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
    } catch {
      sendHtml(res, 401, loginPage(authorizationId, "Sign-in failed or this account is not allowlisted."));
    }
  });

  router.post("/oauth/decision", async (req, res) => {
    const authorizationId = normalizeAuthorizationId(req.body?.authorization_id);
    const decision = String(req.body?.decision || "");
    if (!authorizationId || !["approve", "deny"].includes(decision)) {
      sendHtml(res, 400, errorPage("The authorization decision is malformed."));
      return;
    }
    try {
      const authenticated = await authenticatedUiSession(req, res, config, clientFactory);
      if (!authenticated) {
        sendHtml(res, 401, loginPage(authorizationId, "Your sign-in session expired."));
        return;
      }
      const nowSeconds = Math.floor(now() / 1000);
      if (!verifyCsrfToken(config, req.body?.csrf, authorizationId, authenticated.user.id, nowSeconds)) {
        sendHtml(res, 403, errorPage("The authorization form expired. Return to ChatGPT and try again."));
        return;
      }
      const { data: details, error: detailsError } = await authenticated.client.auth.oauth.getAuthorizationDetails(authorizationId);
      if (detailsError || !details || !("authorization_id" in details)) {
        sendHtml(res, 400, errorPage("The OAuth authorization request is invalid or expired."));
        return;
      }
      validateAuthorizationDetails(config, details, authenticated.user.id);
      const action = decision === "approve"
        ? authenticated.client.auth.oauth.approveAuthorization.bind(authenticated.client.auth.oauth)
        : authenticated.client.auth.oauth.denyAuthorization.bind(authenticated.client.auth.oauth);
      const { data, error } = await action(authorizationId, { skipBrowserRedirect: true });
      if (error || !data?.redirect_url) {
        sendHtml(res, 400, errorPage("Supabase could not complete the authorization decision."));
        return;
      }
      res.redirect(303, safeOAuthRedirect(data.redirect_url, details.redirect_uri));
    } catch {
      sendHtml(res, 403, errorPage("This user or OAuth client is not authorized for Memphis Zoo MCP."));
    }
  });

  router.post("/oauth/logout", async (req, res) => {
    try {
      const authenticated = await authenticatedUiSession(req, res, config, clientFactory);
      if (authenticated) await authenticated.client.auth.signOut({ scope: "local" });
    } catch {}
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  return router;
}
