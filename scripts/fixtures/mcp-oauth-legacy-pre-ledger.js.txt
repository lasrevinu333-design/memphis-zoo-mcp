import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import express from "express";

const OAUTH_VERSION = "v1";
const ACCESS_TOKEN_TYPE = "at+jwt";
const SUPPORTED_SCOPES = Object.freeze(["mcp:read", "mcp:write"]);
const DEFAULT_SCOPE = "mcp:read";
const OPENAI_ORIGIN = "https://chatgpt.com";
const STABLE_OPENAI_REDIRECT = "/connector_platform_oauth_redirect";
const CALLBACK_REDIRECT_PATTERN = /^\/connector\/oauth\/[A-Za-z0-9_-]{1,256}$/;
const PKCE_VALUE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const MAX_CLIENT_ID_BYTES = 6144;
const MAX_STATE_BYTES = 2048;
const MAX_DCR_BODY_BYTES = 8192;
const MAX_REDIRECT_URIS = 4;
const MAX_RATE_LIMIT_KEYS = 1000;
const FLOW_TTL_SECONDS = 10 * 60;
const CODE_TTL_SECONDS = 5 * 60;
const ACCESS_TTL_SECONDS = 10 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const CLIENT_TTL_SECONDS = 365 * 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 30;
const HTTPS_FLOW_COOKIE = "__Host-memphis_mcp_oauth_flow";
const LOCAL_FLOW_COOKIE = "memphis_mcp_oauth_flow";

function enabledFlag(value, fallback = false) {
  if (value == null || String(value).trim() === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function safeEqual(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(String(left ?? ""));
  const b = Buffer.isBuffer(right) ? right : Buffer.from(String(right ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function nowSeconds(now) {
  return Math.floor(now() / 1000);
}

function parseOrigin(name, rawValue, errors, { allowLocalHttp = false } = {}) {
  const raw = String(rawValue || "").trim().replace(/\/+$/, "");
  if (!raw) {
    errors.push(`${name} is missing.`);
    return null;
  }
  try {
    const url = new URL(raw);
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol !== "https:" && !(allowLocalHttp && local)) {
      errors.push(`${name} must use HTTPS${allowLocalHttp ? " or local HTTP" : ""}.`);
    }
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      errors.push(`${name} must be an origin without credentials, path, query, or fragment.`);
    }
    return url.origin;
  } catch {
    errors.push(`${name} must be a valid URL origin.`);
    return null;
  }
}

function deriveKey(rootSecret, issuer, purpose) {
  const salt = sha256(`memphis-zoo-mcp-oauth\0${OAUTH_VERSION}\0${issuer}`);
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(rootSecret, "utf8"),
    salt,
    Buffer.from(`memphis-zoo-mcp/oauth/${purpose}`, "utf8"),
    32,
  ));
}

function buildKeys(rootSecret, issuer) {
  return Object.freeze({
    accessSigning: deriveKey(rootSecret, issuer, "access/signing"),
    codeEncryption: deriveKey(rootSecret, issuer, "code/encryption"),
    codeSigning: deriveKey(rootSecret, issuer, "code/signing"),
    refreshEncryption: deriveKey(rootSecret, issuer, "refresh/encryption"),
    refreshSigning: deriveKey(rootSecret, issuer, "refresh/signing"),
    clientEncryption: deriveKey(rootSecret, issuer, "client/encryption"),
    clientSigning: deriveKey(rootSecret, issuer, "client/signing"),
    requestEncryption: deriveKey(rootSecret, issuer, "authorization-request/encryption"),
    requestSigning: deriveKey(rootSecret, issuer, "authorization-request/signing"),
    flowEncryption: deriveKey(rootSecret, issuer, "flow/encryption"),
    flowSigning: deriveKey(rootSecret, issuer, "flow/signing"),
    identifier: deriveKey(rootSecret, issuer, "operator/identifier"),
    passwordCompare: deriveKey(rootSecret, issuer, "operator/password-compare"),
    limiter: deriveKey(rootSecret, issuer, "rate-limiter"),
  });
}

export function getSelfContainedMcpOAuthConfig(env = process.env) {
  const connectorToken = String(env.MCP_CONNECTOR_TOKEN || "").trim();
  const operatorPassword = String(env.MOXIE_WEB_PASSWORD || "");
  const explicitlyConfigured = env.MCP_OAUTH_ENABLED != null
    && String(env.MCP_OAUTH_ENABLED).trim() !== "";
  const enabled = explicitlyConfigured
    ? enabledFlag(env.MCP_OAUTH_ENABLED, false)
    : Boolean(connectorToken && operatorPassword);

  if (!enabled) {
    return {
      enabled: false,
      ready: true,
      errors: [],
      scopes: [...SUPPORTED_SCOPES],
    };
  }

  const errors = [];
  const allowLocalHttp = String(env.NODE_ENV || "").trim().toLowerCase() === "test";
  const configuredOrigin = env.MCP_PUBLIC_URL
    || env.RENDER_EXTERNAL_URL
    || "https://memphis-zoo-mcp.onrender.com";
  const publicOrigin = parseOrigin("MCP public origin", configuredOrigin, errors, { allowLocalHttp });
  if (Buffer.byteLength(connectorToken, "utf8") < 32) {
    errors.push("MCP_CONNECTOR_TOKEN must contain at least 32 UTF-8 bytes for OAuth key derivation.");
  }
  if (Buffer.byteLength(operatorPassword, "utf8") < 8) {
    errors.push("MOXIE_WEB_PASSWORD must contain at least 8 UTF-8 bytes for operator login.");
  }

  const issuer = publicOrigin;
  const resource = publicOrigin ? `${publicOrigin}/mcp` : null;
  const resourceMetadataUrl = publicOrigin
    ? `${publicOrigin}/.well-known/oauth-protected-resource/mcp`
    : null;
  const keys = issuer && Buffer.byteLength(connectorToken, "utf8") >= 32
    ? buildKeys(connectorToken, issuer)
    : null;
  const operatorSub = keys
    ? `urn:memphis-zoo:mcp:operator:${hmac(keys.identifier, "primary-operator").toString("hex").slice(0, 32)}`
    : null;

  return {
    enabled: true,
    ready: errors.length === 0,
    errors,
    publicOrigin,
    issuer,
    resource,
    resourceMetadataUrl,
    scopes: [...SUPPORTED_SCOPES],
    connectorToken,
    operatorPassword,
    operatorSub,
    keys,
    flowTtlSeconds: FLOW_TTL_SECONDS,
    codeTtlSeconds: CODE_TTL_SECONDS,
    accessTtlSeconds: ACCESS_TTL_SECONDS,
    refreshTtlSeconds: REFRESH_TTL_SECONDS,
    clientTtlSeconds: CLIENT_TTL_SECONDS,
    clockSkewSeconds: CLOCK_SKEW_SECONDS,
  };
}

export function assertSelfContainedMcpOAuthConfig(env = process.env) {
  const config = getSelfContainedMcpOAuthConfig(env);
  if (config.enabled && !config.ready) {
    throw new Error(`Self-contained MCP OAuth configuration is invalid: ${config.errors.join(" ")}`);
  }
  return config;
}

export function buildMcpProtectedResourceMetadata(config) {
  if (!config?.enabled || !config?.ready) throw new Error("Self-contained MCP OAuth is not ready.");
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [...config.scopes],
    resource_name: "Memphis Zoo MCP",
  };
}

export function buildMcpAuthorizationServerMetadata(config) {
  if (!config?.enabled || !config?.ready) throw new Error("Self-contained MCP OAuth is not ready.");
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.publicOrigin}/oauth/authorize`,
    token_endpoint: `${config.publicOrigin}/oauth/token`,
    registration_endpoint: `${config.publicOrigin}/oauth/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...config.scopes],
    authorization_response_iss_parameter_supported: true,
  };
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value) {
  const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid object.");
  return parsed;
}

function sealObject(prefix, payload, encryptionKey, signingKey, random = randomBytes) {
  const iv = random(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  cipher.setAAD(Buffer.from(prefix, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const unsigned = [prefix, OAUTH_VERSION, iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
  const signature = hmac(signingKey, unsigned).toString("base64url");
  return `${unsigned}.${signature}`;
}

function openObject(value, prefix, encryptionKey, signingKey) {
  try {
    const parts = String(value || "").split(".");
    if (parts.length !== 6 || parts[0] !== prefix || parts[1] !== OAUTH_VERSION) return null;
    const unsigned = parts.slice(0, 5).join(".");
    if (!safeEqual(Buffer.from(parts[5], "base64url"), hmac(signingKey, unsigned))) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(parts[2], "base64url"));
    decipher.setAAD(Buffer.from(prefix, "utf8"));
    decipher.setAuthTag(Buffer.from(parts[4], "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parts[3], "base64url")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function signAccessToken(config, claims) {
  const header = encodeJson({ alg: "HS256", typ: ACCESS_TOKEN_TYPE, kid: "mcp-oauth-v1" });
  const payload = encodeJson(claims);
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${hmac(config.keys.accessSigning, unsigned).toString("base64url")}`;
}

function decodeAndVerifyAccessToken(config, token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const header = decodeJson(parts[0]);
    if (header.alg !== "HS256" || header.typ !== ACCESS_TOKEN_TYPE || header.kid !== "mcp-oauth-v1") return null;
    const unsigned = `${parts[0]}.${parts[1]}`;
    if (!safeEqual(Buffer.from(parts[2], "base64url"), hmac(config.keys.accessSigning, unsigned))) return null;
    return decodeJson(parts[1]);
  } catch {
    return null;
  }
}

function normalizeScopes(value, { defaultRead = true } = {}) {
  const raw = Array.isArray(value)
    ? value.flatMap((entry) => String(entry || "").split(/\s+/))
    : String(value || "").split(/\s+/);
  const scopes = [...new Set(raw.map((scope) => scope.trim()).filter(Boolean))];
  if (!scopes.length && defaultRead) scopes.push(DEFAULT_SCOPE);
  if (scopes.some((scope) => !SUPPORTED_SCOPES.includes(scope))) return null;
  if (!scopes.includes(DEFAULT_SCOPE)) return null;
  return SUPPORTED_SCOPES.filter((scope) => scopes.includes(scope));
}

function exactSingle(value) {
  if (Array.isArray(value)) return value.length === 1 ? String(value[0] || "") : "";
  return String(value || "");
}

export function validateOpenAiRedirectUri(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.origin !== OPENAI_ORIGIN || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== STABLE_OPENAI_REDIRECT && !CALLBACK_REDIRECT_PATTERN.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function validateRegistrationRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_client_metadata");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_DCR_BODY_BYTES) throw new Error("invalid_client_metadata");
  const redirectUris = normalizeStringArray(body.redirect_uris);
  if (!redirectUris.length || redirectUris.length > MAX_REDIRECT_URIS) throw new Error("invalid_redirect_uri");
  const normalizedRedirects = redirectUris.map(validateOpenAiRedirectUri);
  if (normalizedRedirects.some((uri) => !uri) || new Set(normalizedRedirects).size !== normalizedRedirects.length) {
    throw new Error("invalid_redirect_uri");
  }
  if (body.token_endpoint_auth_method != null && body.token_endpoint_auth_method !== "none") {
    throw new Error("invalid_client_metadata");
  }
  const grantTypes = body.grant_types == null
    ? ["authorization_code", "refresh_token"]
    : normalizeStringArray(body.grant_types);
  if (grantTypes.some((grant) => !["authorization_code", "refresh_token"].includes(grant))
      || !grantTypes.includes("authorization_code")) {
    throw new Error("invalid_client_metadata");
  }
  const responseTypes = body.response_types == null ? ["code"] : normalizeStringArray(body.response_types);
  if (responseTypes.length !== 1 || responseTypes[0] !== "code") throw new Error("invalid_client_metadata");
  const clientName = String(body.client_name || "ChatGPT Memphis Zoo MCP").trim();
  if (!clientName || Buffer.byteLength(clientName, "utf8") > 128) throw new Error("invalid_client_metadata");
  // ChatGPT DCR clients may omit the optional registration scope. Register the
  // server's complete bounded scope set in that case so a later write-tool
  // challenge can request step-up authorization. An explicitly read-only
  // registration remains read-only.
  const scope = body.scope == null
    ? [...SUPPORTED_SCOPES]
    : normalizeScopes(body.scope, { defaultRead: true });
  if (!scope) throw new Error("invalid_client_metadata");
  return {
    redirect_uris: normalizedRedirects,
    token_endpoint_auth_method: "none",
    grant_types: [...new Set(grantTypes)],
    response_types: ["code"],
    client_name: clientName,
    scope: scope.join(" "),
  };
}

function issueClientId(config, metadata, issuedAt, random = randomBytes) {
  return sealObject("mzc", {
    typ: "oauth_client",
    iss: config.issuer,
    metadata,
    iat: issuedAt,
    nbf: issuedAt - config.clockSkewSeconds,
    exp: issuedAt + config.clientTtlSeconds,
    jti: random(18).toString("base64url"),
  }, config.keys.clientEncryption, config.keys.clientSigning, random);
}

function verifyClientId(config, clientId, current) {
  if (!clientId || Buffer.byteLength(clientId, "utf8") > MAX_CLIENT_ID_BYTES) return null;
  const record = openObject(clientId, "mzc", config.keys.clientEncryption, config.keys.clientSigning);
  if (!record || record.typ !== "oauth_client" || record.iss !== config.issuer) return null;
  if (!Number.isSafeInteger(record.iat) || !Number.isSafeInteger(record.nbf) || !Number.isSafeInteger(record.exp)) return null;
  if (record.iat > current + config.clockSkewSeconds || record.nbf > current + config.clockSkewSeconds || record.exp <= current) return null;
  try {
    return validateRegistrationRequest(record.metadata);
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;background:#0b1f16;color:#f5fff9}main{max-width:42rem;margin:8vh auto;padding:2rem;background:#123425;border:1px solid #3f765b;border-radius:1rem}h1{margin-top:0}label{display:block;margin-top:1rem;font-weight:650}input{box-sizing:border-box;width:100%;margin-top:.35rem;padding:.75rem;border-radius:.5rem;border:1px solid #79a98f;background:#fff;color:#102117}button{margin-top:1.25rem;padding:.75rem 1rem;border:0;border-radius:.5rem;background:#f4c95d;color:#1b2b21;font-weight:750;cursor:pointer}.deny{background:#d9e4dd}.warning{padding:1rem;border-radius:.5rem;background:#45291b;border:1px solid #d89658}.detail{overflow-wrap:anywhere;color:#d8eee1}.actions{display:flex;gap:.75rem;flex-wrap:wrap}.actions form{display:inline}code{overflow-wrap:anywhere}</style></head><body><main>${body}</main></body></html>`;
}

function sendHtml(res, status, html) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.status(status).type("html").send(html);
}

function sendOAuthJsonError(res, status, error, description) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.status(status).json({ error, error_description: description });
}

function flowCookieName(config) {
  return config.publicOrigin.startsWith("https://") ? HTTPS_FLOW_COOKIE : LOCAL_FLOW_COOKIE;
}

function parseCookies(req) {
  const cookies = {};
  for (const pair of String(req.headers?.cookie || "").split(";")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

function setFlowCookie(res, config, value, maxAge = config.flowTtlSeconds) {
  const secure = config.publicOrigin.startsWith("https://") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${flowCookieName(config)}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`);
}

function clearFlowCookie(res, config) {
  setFlowCookie(res, config, "", 0);
}

function requestDigest(requestToken) {
  return sha256(String(requestToken || "")).toString("base64url");
}

function issueFlowCookie(config, kind, requestToken, csrf, issuedAt, random = randomBytes) {
  return sealObject("mzf", {
    typ: "oauth_flow",
    kind,
    request_digest: requestDigest(requestToken),
    csrf,
    iat: issuedAt,
    exp: issuedAt + config.flowTtlSeconds,
    jti: random(12).toString("base64url"),
  }, config.keys.flowEncryption, config.keys.flowSigning, random);
}

function verifyFlowCookie(config, req, kind, requestToken, csrf, current) {
  const sealed = parseCookies(req)[flowCookieName(config)];
  const flow = openObject(sealed, "mzf", config.keys.flowEncryption, config.keys.flowSigning);
  return Boolean(
    flow
    && flow.typ === "oauth_flow"
    && flow.kind === kind
    && flow.request_digest === requestDigest(requestToken)
    && safeEqual(flow.csrf, csrf)
    && Number.isSafeInteger(flow.iat)
    && Number.isSafeInteger(flow.exp)
    && flow.iat <= current + config.clockSkewSeconds
    && flow.exp > current,
  );
}

function issueAuthorizationRequest(config, details, issuedAt, random = randomBytes) {
  return sealObject("mzr", {
    typ: "authorization_request",
    ...details,
    iss: config.issuer,
    iat: issuedAt,
    exp: issuedAt + config.flowTtlSeconds,
    jti: random(18).toString("base64url"),
  }, config.keys.requestEncryption, config.keys.requestSigning, random);
}

function verifyAuthorizationRequest(config, value, current) {
  const request = openObject(value, "mzr", config.keys.requestEncryption, config.keys.requestSigning);
  if (!request || request.typ !== "authorization_request" || request.iss !== config.issuer) return null;
  if (!Number.isSafeInteger(request.iat) || !Number.isSafeInteger(request.exp)) return null;
  if (request.iat > current + config.clockSkewSeconds || request.exp <= current) return null;
  const client = verifyClientId(config, request.client_id, current);
  if (!client || !client.redirect_uris.includes(request.redirect_uri)) return null;
  if (request.resource !== config.resource || !normalizeScopes(request.scope, { defaultRead: false })) return null;
  if (!PKCE_VALUE_PATTERN.test(String(request.code_challenge || "")) || request.code_challenge_method !== "S256") return null;
  return request;
}

function redirectAuthorization(res, config, request, values) {
  const target = new URL(request.redirect_uri);
  for (const [name, value] of Object.entries(values)) {
    if (value != null && String(value) !== "") target.searchParams.set(name, String(value));
  }
  if (request.state) target.searchParams.set("state", request.state);
  target.searchParams.set("iss", config.issuer);
  res.setHeader("Cache-Control", "no-store");
  res.redirect(303, target.href);
}

function loginPage(requestToken, csrf, error = "") {
  const errorMarkup = error ? `<p class="warning">${escapeHtml(error)}</p>` : "";
  return page("Sign in to Memphis Zoo MCP", `<h1>Sign in to Memphis Zoo MCP</h1>${errorMarkup}<p>Enter the Memphis Zoo operator password. The password is verified by this server and is never sent to ChatGPT.</p><form method="post" action="/oauth/login"><input type="hidden" name="request" value="${escapeHtml(requestToken)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>Operator password<input required autocomplete="current-password" type="password" name="password" maxlength="1024"></label><button type="submit">Continue</button></form>`);
}

function consentPage(requestToken, csrf, request) {
  const scopes = String(request.scope).split(" ").map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`).join("");
  return page("Authorize Memphis Zoo MCP", `<h1>Authorize ${escapeHtml(request.client_name || "ChatGPT")}</h1><p class="warning"><strong>Operator approval required:</strong> this grants the listed access to the Memphis Zoo MCP server. ChatGPT may separately confirm write tool calls.</p><p class="detail"><strong>Redirect:</strong> <code>${escapeHtml(request.redirect_uri)}</code><br><strong>Resource:</strong> <code>${escapeHtml(request.resource)}</code></p><p>Requested scopes:</p><ul>${scopes}</ul><div class="actions"><form method="post" action="/oauth/decision"><input type="hidden" name="request" value="${escapeHtml(requestToken)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button name="decision" value="approve" type="submit">Approve access</button></form><form method="post" action="/oauth/decision"><input type="hidden" name="request" value="${escapeHtml(requestToken)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="deny" name="decision" value="deny" type="submit">Deny</button></form></div>`);
}

function errorPage(message) {
  return page("Memphis Zoo MCP authorization", `<h1>Authorization unavailable</h1><p class="warning">${escapeHtml(message)}</p>`);
}

function createRateLimiter(config, { now, windowMs = 15 * 60 * 1000, maximum = 5 } = {}) {
  const attempts = new Map();
  return {
    consume(req) {
      const current = now();
      const source = String(req.ip || req.socket?.remoteAddress || "unknown");
      const key = hmac(config.keys.limiter, source).toString("base64url");
      let entry = attempts.get(key);
      if (!entry && attempts.size >= MAX_RATE_LIMIT_KEYS) {
        for (const [candidate, value] of attempts) {
          if (current - value.startedAt >= windowMs) attempts.delete(candidate);
        }
        if (attempts.size >= MAX_RATE_LIMIT_KEYS) {
          return { allowed: false, retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) };
        }
      }
      if (!entry || current - entry.startedAt >= windowMs) entry = { startedAt: current, count: 0 };
      entry.count += 1;
      attempts.set(key, entry);
      return {
        allowed: entry.count <= maximum,
        retryAfter: Math.max(1, Math.ceil((windowMs - (current - entry.startedAt)) / 1000)),
      };
    },
    reset(req) {
      const source = String(req.ip || req.socket?.remoteAddress || "unknown");
      attempts.delete(hmac(config.keys.limiter, source).toString("base64url"));
    },
  };
}

function createReplayCache({ now }) {
  const used = new Map();
  return {
    consume(namespace, identifier, expiresAt) {
      const current = nowSeconds(now);
      for (const [key, expiry] of used) {
        if (expiry <= current) used.delete(key);
      }
      const key = `${namespace}:${identifier}`;
      if (used.has(key)) return false;
      used.set(key, expiresAt);
      return true;
    },
  };
}

function issueAuthorizationCode(config, request, issuedAt, random = randomBytes) {
  return sealObject("mza", {
    typ: "authorization_code",
    iss: config.issuer,
    aud: config.resource,
    sub: config.operatorSub,
    client_id: request.client_id,
    redirect_uri: request.redirect_uri,
    resource: request.resource,
    scope: request.scope,
    code_challenge: request.code_challenge,
    code_challenge_method: "S256",
    iat: issuedAt,
    nbf: issuedAt - config.clockSkewSeconds,
    exp: issuedAt + config.codeTtlSeconds,
    jti: random(18).toString("base64url"),
  }, config.keys.codeEncryption, config.keys.codeSigning, random);
}

function verifyTimedArtifact(config, artifact, current, type) {
  return Boolean(
    artifact
    && artifact.typ === type
    && artifact.iss === config.issuer
    && artifact.aud === config.resource
    && artifact.sub === config.operatorSub
    && artifact.resource === config.resource
    && Number.isSafeInteger(artifact.iat)
    && Number.isSafeInteger(artifact.nbf)
    && Number.isSafeInteger(artifact.exp)
    && artifact.iat <= current + config.clockSkewSeconds
    && artifact.nbf <= current + config.clockSkewSeconds
    && artifact.exp > current
    && typeof artifact.jti === "string"
    && artifact.jti.length >= 16,
  );
}

function issueTokenPair(config, {
  clientId,
  scope,
  generation = 0,
  includeRefresh = true,
}, issuedAt, random = randomBytes) {
  const accessClaims = {
    iss: config.issuer,
    aud: config.resource,
    sub: config.operatorSub,
    client_id: clientId,
    scope,
    iat: issuedAt,
    nbf: issuedAt - config.clockSkewSeconds,
    exp: issuedAt + config.accessTtlSeconds,
    jti: random(18).toString("base64url"),
  };
  const refresh = sealObject("mzt", {
    typ: "refresh_token",
    iss: config.issuer,
    aud: config.resource,
    sub: config.operatorSub,
    client_id: clientId,
    resource: config.resource,
    scope,
    generation,
    iat: issuedAt,
    nbf: issuedAt - config.clockSkewSeconds,
    exp: issuedAt + config.refreshTtlSeconds,
    jti: random(18).toString("base64url"),
  }, config.keys.refreshEncryption, config.keys.refreshSigning, random);
  const response = {
    access_token: signAccessToken(config, accessClaims),
    token_type: "Bearer",
    expires_in: config.accessTtlSeconds,
    scope,
  };
  if (includeRefresh) response.refresh_token = refresh;
  return response;
}

export class McpOAuthAccessTokenError extends Error {
  constructor(message = "Invalid OAuth access token.") {
    super(message);
    this.name = "McpOAuthAccessTokenError";
  }
}

export function verifyMcpOAuthAccessToken(config, token, { now = Date.now, requiredScopes = [] } = {}) {
  const current = nowSeconds(now);
  const claims = decodeAndVerifyAccessToken(config, token);
  const scopes = normalizeScopes(claims?.scope, { defaultRead: false });
  const client = claims ? verifyClientId(config, claims.client_id, current) : null;
  const clientScopes = normalizeScopes(client?.scope, { defaultRead: false });
  if (
    !claims
    || claims.iss !== config.issuer
    || claims.aud !== config.resource
    || claims.sub !== config.operatorSub
    || !client
    || !scopes
    || !clientScopes
    || scopes.some((scope) => !clientScopes.includes(scope))
    || !Number.isSafeInteger(claims.iat)
    || !Number.isSafeInteger(claims.nbf)
    || !Number.isSafeInteger(claims.exp)
    || claims.iat > current + config.clockSkewSeconds
    || claims.nbf > current + config.clockSkewSeconds
    || claims.exp <= current
    || claims.exp - claims.iat !== config.accessTtlSeconds
    || !String(claims.jti || "")
    || requiredScopes.some((scope) => !scopes.includes(scope))
  ) {
    throw new McpOAuthAccessTokenError();
  }
  return {
    token,
    clientId: claims.client_id,
    scopes,
    expiresAt: claims.exp,
    extra: {
      issuer: claims.iss,
      subject: claims.sub,
      audience: claims.aud,
      authSource: "self_contained_oauth",
    },
  };
}

export function buildMcpBearerChallenge(config, requiredScopes = [DEFAULT_SCOPE]) {
  const scope = normalizeScopes(requiredScopes, { defaultRead: true })?.join(" ") || DEFAULT_SCOPE;
  return `Bearer resource_metadata="${config.resourceMetadataUrl}", scope="${scope}"`;
}

function passwordMatches(config, supplied) {
  const expected = hmac(config.keys.passwordCompare, config.operatorPassword);
  const actual = hmac(config.keys.passwordCompare, String(supplied || ""));
  return safeEqual(expected, actual);
}

export function createSelfContainedMcpOAuthService({ env = process.env, now = Date.now, random = randomBytes } = {}) {
  const config = assertSelfContainedMcpOAuthConfig(env);
  const router = express.Router();
  if (!config.enabled) {
    return { enabled: false, config, router };
  }

  const metadata = buildMcpProtectedResourceMetadata(config);
  const asMetadata = buildMcpAuthorizationServerMetadata(config);
  const replayCache = createReplayCache({ now });
  const loginLimiter = createRateLimiter(config, { now });

  router.use("/oauth/register", express.json({ limit: "12kb", strict: true }));

  const serveResourceMetadata = (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(metadata);
  };
  const serveAuthorizationMetadata = (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(asMetadata);
  };
  router.get("/.well-known/oauth-protected-resource/mcp", serveResourceMetadata);
  router.get("/.well-known/oauth-protected-resource", serveResourceMetadata);
  router.get("/.well-known/oauth-authorization-server", serveAuthorizationMetadata);

  router.post("/oauth/register", (req, res) => {
    try {
      const metadataRecord = validateRegistrationRequest(req.body);
      const issuedAt = nowSeconds(now);
      const clientId = issueClientId(config, metadataRecord, issuedAt, random);
      res.setHeader("Cache-Control", "no-store");
      res.status(201).json({
        ...metadataRecord,
        client_id: clientId,
        client_id_issued_at: issuedAt,
        client_id_expires_at: issuedAt + config.clientTtlSeconds,
      });
    } catch (error) {
      const code = error?.message === "invalid_redirect_uri" ? "invalid_redirect_uri" : "invalid_client_metadata";
      sendOAuthJsonError(res, 400, code, "The public OAuth client registration was rejected.");
    }
  });

  router.get("/oauth/authorize", (req, res) => {
    const current = nowSeconds(now);
    const clientId = exactSingle(req.query.client_id);
    const client = verifyClientId(config, clientId, current);
    const redirectUri = validateOpenAiRedirectUri(exactSingle(req.query.redirect_uri));
    if (!client || !redirectUri || !client.redirect_uris.includes(redirectUri)) {
      sendHtml(res, 400, errorPage("The OAuth client or redirect URI is invalid or expired."));
      return;
    }
    const redirectable = {
      redirect_uri: redirectUri,
      state: "",
    };
    const reject = (error, description) => redirectAuthorization(res, config, redirectable, { error, error_description: description });
    const state = exactSingle(req.query.state);
    if (Buffer.byteLength(state, "utf8") > MAX_STATE_BYTES) return reject("invalid_request", "OAuth state is too large.");
    redirectable.state = state;
    if (exactSingle(req.query.response_type) !== "code") return reject("unsupported_response_type", "Only the authorization code flow is supported.");
    const resource = exactSingle(req.query.resource);
    if (resource !== config.resource) return reject("invalid_target", "The exact Memphis Zoo MCP resource is required.");
    const codeChallenge = exactSingle(req.query.code_challenge);
    if (exactSingle(req.query.code_challenge_method) !== "S256" || !PKCE_VALUE_PATTERN.test(codeChallenge)) {
      return reject("invalid_request", "PKCE S256 with a valid code challenge is required.");
    }
    const scopes = normalizeScopes(req.query.scope, { defaultRead: true });
    if (!scopes) return reject("invalid_scope", "The requested MCP scope is unsupported.");
    const registeredScopes = normalizeScopes(client.scope, { defaultRead: false });
    if (!registeredScopes || scopes.some((scope) => !registeredScopes.includes(scope))) {
      return reject("invalid_scope", "The requested MCP scope was not registered for this client.");
    }
    const requestToken = issueAuthorizationRequest(config, {
      client_id: clientId,
      client_name: client.client_name,
      redirect_uri: redirectUri,
      resource,
      scope: scopes.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    }, current, random);
    const csrf = random(24).toString("base64url");
    setFlowCookie(res, config, issueFlowCookie(config, "login", requestToken, csrf, current, random));
    sendHtml(res, 200, loginPage(requestToken, csrf));
  });

  router.post("/oauth/login", (req, res) => {
    const current = nowSeconds(now);
    const requestToken = String(req.body?.request || "");
    const csrf = String(req.body?.csrf || "");
    const request = verifyAuthorizationRequest(config, requestToken, current);
    if (!request || !verifyFlowCookie(config, req, "login", requestToken, csrf, current)) {
      clearFlowCookie(res, config);
      sendHtml(res, 403, errorPage("The sign-in form is invalid or expired. Return to ChatGPT and try again."));
      return;
    }
    const rate = loginLimiter.consume(req);
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfter));
      sendHtml(res, 429, errorPage("Too many sign-in attempts. Wait and try again."));
      return;
    }
    if (!passwordMatches(config, req.body?.password)) {
      sendHtml(res, 401, loginPage(requestToken, csrf, "The operator password was not accepted."));
      return;
    }
    loginLimiter.reset(req);
    const consentCsrf = random(24).toString("base64url");
    setFlowCookie(res, config, issueFlowCookie(config, "consent", requestToken, consentCsrf, current, random));
    sendHtml(res, 200, consentPage(requestToken, consentCsrf, request));
  });

  router.post("/oauth/decision", (req, res) => {
    const current = nowSeconds(now);
    const requestToken = String(req.body?.request || "");
    const csrf = String(req.body?.csrf || "");
    const request = verifyAuthorizationRequest(config, requestToken, current);
    const decision = String(req.body?.decision || "");
    if (!request || !verifyFlowCookie(config, req, "consent", requestToken, csrf, current) || !["approve", "deny"].includes(decision)) {
      clearFlowCookie(res, config);
      sendHtml(res, 403, errorPage("The authorization decision is invalid or expired. Return to ChatGPT and try again."));
      return;
    }
    if (!replayCache.consume("decision", request.jti, request.exp)) {
      clearFlowCookie(res, config);
      sendHtml(res, 403, errorPage("This authorization decision has already been used. Return to ChatGPT and try again."));
      return;
    }
    clearFlowCookie(res, config);
    if (decision === "deny") {
      redirectAuthorization(res, config, request, { error: "access_denied", error_description: "The operator denied access." });
      return;
    }
    const code = issueAuthorizationCode(config, request, current, random);
    redirectAuthorization(res, config, request, { code });
  });

  router.post("/oauth/token", (req, res) => {
    if (req.headers.authorization || req.body?.client_secret) {
      sendOAuthJsonError(res, 401, "invalid_client", "This public client must authenticate with token_endpoint_auth_method none.");
      return;
    }
    const current = nowSeconds(now);
    const grantType = exactSingle(req.body?.grant_type);
    const clientId = exactSingle(req.body?.client_id);
    const client = verifyClientId(config, clientId, current);
    if (!client) {
      sendOAuthJsonError(res, 401, "invalid_client", "The OAuth client is invalid or expired.");
      return;
    }
    if (grantType === "authorization_code") {
      const codeValue = exactSingle(req.body?.code);
      const code = openObject(codeValue, "mza", config.keys.codeEncryption, config.keys.codeSigning);
      const redirectUri = exactSingle(req.body?.redirect_uri);
      const resource = exactSingle(req.body?.resource);
      const verifier = exactSingle(req.body?.code_verifier);
      const verifierChallenge = PKCE_VALUE_PATTERN.test(verifier)
        ? sha256(verifier).toString("base64url")
        : "";
      if (
        !verifyTimedArtifact(config, code, current, "authorization_code")
        || code.client_id !== clientId
        || code.redirect_uri !== redirectUri
        || !client.redirect_uris.includes(redirectUri)
        || resource !== config.resource
        || code.resource !== resource
        || code.code_challenge_method !== "S256"
        || !safeEqual(code.code_challenge, verifierChallenge)
      ) {
        sendOAuthJsonError(res, 400, "invalid_grant", "The authorization code, redirect URI, resource, or PKCE verifier is invalid.");
        return;
      }
      if (!replayCache.consume("code", code.jti, code.exp)) {
        sendOAuthJsonError(res, 400, "invalid_grant", "The authorization code has already been used.");
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      res.status(200).json(issueTokenPair(config, {
        clientId,
        scope: code.scope,
        generation: 0,
        includeRefresh: client.grant_types.includes("refresh_token"),
      }, current, random));
      return;
    }
    if (grantType === "refresh_token") {
      const refreshValue = exactSingle(req.body?.refresh_token);
      const refresh = openObject(refreshValue, "mzt", config.keys.refreshEncryption, config.keys.refreshSigning);
      const resource = exactSingle(req.body?.resource);
      const requestedScopes = req.body?.scope == null
        ? normalizeScopes(refresh?.scope, { defaultRead: false })
        : normalizeScopes(req.body.scope, { defaultRead: false });
      const originalScopes = normalizeScopes(refresh?.scope, { defaultRead: false });
      if (
        !verifyTimedArtifact(config, refresh, current, "refresh_token")
        || refresh.client_id !== clientId
        || !client.grant_types.includes("refresh_token")
        || resource !== config.resource
        || !requestedScopes
        || !originalScopes
        || requestedScopes.some((scope) => !originalScopes.includes(scope))
        || !Number.isSafeInteger(refresh.generation)
        || refresh.generation < 0
      ) {
        sendOAuthJsonError(res, 400, "invalid_grant", "The refresh token, client, resource, or requested scope is invalid.");
        return;
      }
      if (!replayCache.consume("refresh", refresh.jti, refresh.exp)) {
        sendOAuthJsonError(res, 400, "invalid_grant", "The refresh token has already been rotated.");
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      res.status(200).json(issueTokenPair(config, {
        clientId,
        scope: requestedScopes.join(" "),
        generation: refresh.generation + 1,
      }, current, random));
      return;
    }
    sendOAuthJsonError(res, 400, "unsupported_grant_type", "Only authorization_code and refresh_token grants are supported.");
  });

  function authenticateRequest(req) {
    const customToken = String(
      req?.header?.("x-memphis-connector-token")
      || req?.header?.("x-mcp-connector-token")
      || "",
    ).trim();
    const authorization = String(req?.header?.("authorization") || "").trim();
    const bearer = authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : "";
    if (customToken) {
      if (!safeEqual(customToken, config.connectorToken)) return { ok: false, status: 401 };
      return {
        ok: true,
        auth: {
          mixedAuth: true,
          source: "connector_token",
          scopes: [...SUPPORTED_SCOPES],
          subject: "connector_service",
          challenge: buildMcpBearerChallenge(config),
          resourceMetadataUrl: config.resourceMetadataUrl,
        },
      };
    }
    if (authorization && !bearer) return { ok: false, status: 401 };
    if (!bearer) {
      return {
        ok: true,
        auth: {
          mixedAuth: true,
          source: "anonymous",
          scopes: [],
          subject: null,
          challenge: buildMcpBearerChallenge(config),
          resourceMetadataUrl: config.resourceMetadataUrl,
        },
      };
    }
    if (safeEqual(bearer, config.connectorToken)) {
      return {
        ok: true,
        auth: {
          mixedAuth: true,
          source: "connector_token",
          scopes: [...SUPPORTED_SCOPES],
          subject: "connector_service",
          challenge: buildMcpBearerChallenge(config),
          resourceMetadataUrl: config.resourceMetadataUrl,
        },
      };
    }
    try {
      const verified = verifyMcpOAuthAccessToken(config, bearer, { now });
      return {
        ok: true,
        auth: {
          mixedAuth: true,
          source: "self_contained_oauth",
          scopes: verified.scopes,
          subject: verified.extra.subject,
          client_id: verified.clientId,
          expires_at: verified.expiresAt,
          challenge: buildMcpBearerChallenge(config),
          resourceMetadataUrl: config.resourceMetadataUrl,
        },
      };
    } catch {
      return { ok: false, status: 401 };
    }
  }

  function middleware(req, res, next) {
    const result = authenticateRequest(req);
    if (!result.ok) {
      res.setHeader("WWW-Authenticate", buildMcpBearerChallenge(config));
      res.status(result.status || 401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    req.memphisMcpAuth = result.auth;
    req.memphisAuth = {
      role: result.auth.source === "anonymous" ? "connector_anonymous" : "connector_service",
      auth_mode: result.auth.source,
      read_only: !result.auth.scopes.includes("mcp:write"),
      subject: result.auth.subject,
      client_id: result.auth.client_id || null,
    };
    if (result.auth.source !== "anonymous") {
      // StreamableHTTPServerTransport forwards this verified request context to
      // per-tool handlers as extra.authInfo. Never expose the long-lived legacy
      // connector token through handler metadata.
      req.auth = {
        token: result.auth.source === "connector_token"
          ? "verified-legacy-connector-token"
          : "verified-self-contained-oauth-token",
        clientId: result.auth.client_id || "memphis-mcp-connector-token",
        scopes: [...result.auth.scopes],
        expiresAt: result.auth.expires_at || undefined,
        extra: {
          authSource: result.auth.source,
          subject: result.auth.subject,
          issuer: config.issuer,
          audience: config.resource,
        },
      };
    }
    next();
  }

  return {
    enabled: true,
    config,
    router,
    authenticateRequest,
    middleware,
    verifyAccessToken: (token, options = {}) => verifyMcpOAuthAccessToken(config, token, { now, ...options }),
  };
}
