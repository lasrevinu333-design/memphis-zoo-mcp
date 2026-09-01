# ChatGPT access to Memphis Zoo MCP

This is the controlled enablement runbook for giving a ChatGPT developer-mode app complete access to the existing Memphis Zoo MCP tool surface. Source changes alone do not enable access and do not change production.

## Architecture

- ChatGPT connects to `https://memphis-zoo-mcp.onrender.com/mcp` over Streamable HTTP.
- The MCP endpoint returns an RFC 9728 `WWW-Authenticate` challenge and exposes protected-resource metadata.
- Supabase Auth is the OAuth 2.1 authorization server. It owns PKCE, authorization codes, access and refresh tokens, client registration, and revocation.
- The Render service hosts only the sign-in/consent UI and validates Supabase access tokens.
- A token receives the full MCP tool surface only when its verified `sub` and `client_id` exactly match the Render allowlists.
- GitHub and Supabase adapter credentials remain server-side. ChatGPT never receives `MCP_CONNECTOR_TOKEN`, `GITHUB_TOKEN`, or `SUPABASE_SERVICE_ROLE_KEY`.

OAuth identity scopes do not authorize database or GitHub access. The exact user/client allowlists do. ChatGPT still applies its own confirmation behavior to write tools.

## Preconditions

Do not deploy or change Supabase Auth until the exact branch candidate has passed tests and a fresh independent web ChatGPT architecture/security/release audit.

Before enablement, record:

- reviewed Git commit and branch;
- exact Render service origin;
- exact Supabase project reference;
- one dedicated Supabase Auth owner user UUID;
- one pre-registered confidential OAuth client UUID;
- ChatGPT's exact OAuth callback URI;
- rollback owner and time window.

The production Supabase project must use an asymmetric signing key. The JWKS endpoint must return a current public key before `openid` is requested.

## Enablement sequence

1. In ChatGPT on the web, enable **Settings → Security and login → Developer mode**. Start creating a developer-mode app for the Render `/mcp` URL and record the exact callback URI ChatGPT presents. Do not paste a static bearer token.
2. In the Memphis Zoo Supabase project, enable **Authentication → OAuth Server**. Set the project Site URL to the reviewed Render origin and the authorization path to `/oauth/consent`. Keep dynamic client registration disabled for this private integration.
3. Create or invite exactly one dedicated owner in Supabase Auth. Complete its sign-in and record its user UUID. Do not put authorization in user-editable metadata.
4. Register one confidential Supabase OAuth client named for the ChatGPT Memphis Zoo MCP connection. Register ChatGPT's callback URI as an exact HTTPS URI and use `client_secret_basic` unless ChatGPT's current setup explicitly requires another supported method. Capture the client secret once without committing or logging it.
5. Configure the ChatGPT app with that OAuth client ID and secret.
6. Add the following Render environment values without changing existing GitHub, Supabase service-role, manager, device, or connector-token secrets:

   ```text
   MCP_OAUTH_ENABLED=true
   MCP_PUBLIC_URL=https://memphis-zoo-mcp.onrender.com
   SUPABASE_PUBLISHABLE_KEY=<project publishable key>
   MCP_OAUTH_COOKIE_SECRET=<new dedicated random value, at least 32 characters>
   MCP_OAUTH_ALLOWED_SUBJECTS=<exact owner user UUID>
   MCP_OAUTH_ALLOWED_CLIENT_IDS=<exact OAuth client UUID>
   MCP_OAUTH_SCOPES=openid email profile
   ```

7. Deploy only the reviewed commit. Do not merge unrelated work or rely on an automatic production deploy from another branch.
8. Refresh the ChatGPT app so it re-reads metadata and tools, then complete the Supabase sign-in and explicit complete-access consent.

## Acceptance gates

All gates are required. HTTP 200 or a successful deployment alone is not acceptance.

1. Unauthenticated `/mcp` returns `401` with `WWW-Authenticate` pointing to the exact protected-resource metadata URL.
2. Both protected-resource metadata URLs return the exact Render `/mcp` resource and the exact Supabase Auth issuer.
3. Supabase authorization-server discovery returns `200`; JWKS returns the expected asymmetric public key.
4. A wrong static connector header is rejected and never reaches OAuth validation.
5. A valid OAuth token from the wrong user or wrong client is rejected.
6. ChatGPT completes OAuth and lists every current tool in `mcp-tools.v3`, including GitHub safe-write tools and `supabase_migration_apply`.
7. ChatGPT proves one GitHub read and one Supabase read against the intended allowlisted resources.
8. ChatGPT proves write capability first with the existing dry-run/preview controls. Any real GitHub write or Supabase migration remains a separately reviewed action with exact target and rollback evidence.

Until gates 6–8 are observed in ChatGPT, report the connection as **unverified**, not ready.

## Rollback and revocation

For a code/config rollback, set `MCP_OAUTH_ENABLED=false` and redeploy the prior reviewed commit. The legacy service-token and SSE lanes remain unchanged.

For identity revocation, remove the subject or client ID from the Render allowlist, revoke the Supabase OAuth grant and the user's active session, and delete or disable the OAuth client. Supabase access-token lifetime should remain short because deleting a user alone is not a complete session-revocation procedure.

Rotate a secret only if evidence shows it was exposed. Ordinary rollback does not require rotating the existing connector, GitHub, Supabase service-role, manager, or device secrets.
