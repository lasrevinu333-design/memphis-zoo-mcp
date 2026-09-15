# ChatGPT access to Memphis Zoo MCP

The Memphis Zoo backend is its own bounded OAuth 2.1 authorization server for
the private ChatGPT developer-mode app. It does not require Supabase OAuth
Server, a Supabase Auth user, another database migration, or another secret.

## Authority and key separation

- The exact protected resource is
  `https://memphis-zoo-mcp.onrender.com/mcp`.
- RFC 9728 protected-resource metadata points to the same Render origin as the
  RFC 8414 authorization-server issuer.
- The existing high-entropy `MCP_CONNECTOR_TOKEN` is input only to
  purpose-separated HKDF-SHA256 keys for client registrations, authorization
  requests, flow cookies, codes, access tokens, refresh tokens, identifiers,
  password comparison, and rate-limit keys. The connector token is never sent
  to ChatGPT or copied into a token.
- The existing `MOXIE_WEB_PASSWORD` is the one operator login credential. A
  constant-time derived comparison verifies it. It is never stored in a
  browser cookie or returned to ChatGPT.
- Authorization codes and refresh tokens use authenticated encryption plus a
  separately derived outer HMAC. Access tokens are short-lived HS256 tokens
  with a separately derived signing key.

This deliberately reuses two already-managed production secrets without using
the same derived key for two purposes. Rotating `MCP_CONNECTOR_TOKEN` revokes
all issued OAuth artifacts and legacy connector sessions at once, so rotation
must remain an explicit coordinated recovery action.

## Protocol contract

- Dynamic client registration is stateless and accepts only public clients
  using `token_endpoint_auth_method=none`, authorization-code and refresh-token
  grants, and PKCE S256. When ChatGPT omits the optional registration scope, the
  client is registered for the server's bounded read/write scope set so a later
  protected write can request authorization; an explicit read-only registration
  remains read-only.
- Registered redirects must be exact HTTPS ChatGPT callbacks: the stable
  `https://chatgpt.com/connector_platform_oauth_redirect`, or
  `https://chatgpt.com/connector/oauth/{callback_id}` with a bounded callback
  identifier. Queries, fragments, embedded credentials, other origins, and
  unbounded registration payloads are rejected.
- The authorization request and token exchange must preserve the exact `/mcp`
  resource, client ID, redirect URI, scope, and PKCE binding.
- Every redirect-based authorization success or error includes the exact `iss`
  parameter. The metadata advertises
  `authorization_response_iss_parameter_supported=true`.
- Access-token verification requires exact `iss`, `aud`, `sub`, `client_id`,
  `exp`, `nbf`, `iat`, `scope`, signature, and client-registration validity.
- Authorization codes are five minutes, access tokens ten minutes, rotating
  refresh tokens thirty days, and stateless client registrations one year.
- Codes and rotating refresh tokens have an in-process replay cache. Because
  the design intentionally adds no persistent store, a process restart can
  clear that defense before an otherwise valid artifact expires. Short
  lifetimes, PKCE, exact resource/redirect binding, authenticated encryption,
  and TLS bound that residual limitation.

## Mixed authentication

Anonymous requests may initialize the MCP transport, list the full 17-tool
catalog, and call only `ping`. Every other current tool is listed with an OAuth
security scheme and challenges before its adapter can run:

- read tools require `mcp:read`;
- safe writes, migrations, admin, and unclassified future tools require both
  `mcp:read` and `mcp:write`;
- every `tools/list` descriptor carries top-level `securitySchemes` and the
  `_meta.securitySchemes` compatibility mirror;
- every denied tool result carries `_meta["mcp/www_authenticate"]`;
- an invalid presented HTTP credential receives `401` and the same canonical
  `WWW-Authenticate` protected-resource link.

The legacy `MCP_CONNECTOR_TOKEN` bearer/custom-header lane retains complete
tool access, and legacy SSE remains connector-token-only. A wrong legacy custom
header never falls through to OAuth.

## Initial connection

No infrastructure-console work is needed. In ChatGPT developer-mode app setup:

1. Use `https://memphis-zoo-mcp.onrender.com/mcp`.
2. Select mixed authentication with dynamic client registration.
3. ChatGPT registers its constrained public client and starts PKCE.
4. One unavoidable browser interaction opens the Memphis Zoo login page. Enter
   the existing Moxie operator password, then separately press **Approve
   access** on the consent page. A correct password never auto-approves.
5. Refresh the app's tools after the first successful connection.

The server auto-enables this provider when both existing credentials are
present. `MCP_OAUTH_ENABLED=false` is an optional emergency disable switch;
`MCP_OAUTH_ENABLED=true` makes missing or invalid prerequisites a startup
error. `MCP_PUBLIC_URL` is an optional explicit origin override; Render's
external origin is used when present, then the canonical production origin.

## Acceptance and rollback

Run `npm run test:mcp-auth`. Acceptance requires the raw wire suite to prove
discovery, constrained DCR, PKCE, password and consent separation, code
exchange, refresh rotation, replay rejection, wrong password/redirect/resource
rejection, per-tool metadata, runtime challenges, the exact 17-tool catalog,
and preserved legacy-token access.

Deployment and HTTP success alone are not final acceptance. ChatGPT must then
complete the operator login/consent, list all 17 tools, execute one protected
GitHub read and one protected Supabase read, and demonstrate write authority
only through existing dry-run/preview controls.

Rollback is code/config only: set `MCP_OAUTH_ENABLED=false` or redeploy the
previous reviewed commit. Do not rotate an existing secret merely to roll back.
