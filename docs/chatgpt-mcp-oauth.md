# ChatGPT access to Memphis Zoo MCP

This is the controlled enablement runbook for giving a ChatGPT developer-mode app complete access to the existing Memphis Zoo MCP tool surface. Source changes alone do not enable access and do not change production.

## Architecture

- ChatGPT connects to `https://memphis-zoo-mcp.onrender.com/mcp` over Streamable HTTP.
- The MCP endpoint returns an RFC 9728 `WWW-Authenticate` challenge and exposes protected-resource metadata for the exact `https://memphis-zoo-mcp.onrender.com/mcp` resource.
- Supabase Auth is the OAuth 2.1 authorization server. It owns PKCE, authorization codes, access and refresh tokens, client registration, and revocation.
- The Render service hosts only the sign-in/consent UI and validates Supabase access tokens.
- A token receives the full MCP tool surface only when its verified `iss`, `sub`, `client_id`, lifetime, scopes, and `aud`/`resource` binding match the configured contract.
- Every advertised Streamable HTTP tool carries a top-level OAuth `securitySchemes` declaration and `_meta.securitySchemes` compatibility mirror; unauthenticated HTTP requests and guarded tool-error results carry the same `mcp/www_authenticate` challenge.
- GitHub and Supabase adapter credentials remain server-side. ChatGPT never receives `MCP_CONNECTOR_TOKEN`, `GITHUB_TOKEN`, or `SUPABASE_SERVICE_ROLE_KEY`.

OAuth identity scopes do not authorize database or GitHub access. The exact user/client allowlists do. ChatGPT still applies its own confirmation behavior to write tools.

## Preconditions

Do not deploy or change Supabase Auth until the exact branch candidate has passed tests and a fresh independent web ChatGPT architecture/security/release audit.

Before enablement, record:

- reviewed Git commit and branch;
- exact Render service origin;
- exact Supabase project reference;
- one dedicated Supabase Auth owner user UUID;
- one pre-registered Supabase OAuth client UUID and its selected token endpoint authentication method;
- ChatGPT's exact OAuth callback URI;
- rollback owner and time window.

The default connector scope is `email`, which remains compatible with a Supabase project still using HS256. If `openid` is selected, first migrate the project to an asymmetric signing key and prove that JWKS returns its current public key; Supabase cannot issue OIDC ID tokens under HS256.

## Enablement sequence

1. In the ChatGPT plugin/app management page, start creating the private MCP app for the Render `/mcp` URL. Record the exact callback URI and client-identification mode shown for this connection. Do not paste a static bearer token; OpenAI hosts do not support customer-provided API keys for this flow.
2. In the Memphis Zoo Supabase project, enable **Authentication → OAuth Server**. This feature is currently beta and free on all Supabase plans. Set the project Site URL to the reviewed Render origin and the authorization path to `/oauth/consent`. Keep dynamic client registration disabled for this private, predefined-client integration.
3. Create or invite exactly one dedicated owner in Supabase Auth. Complete its sign-in and record its user UUID. Do not put authorization in user-editable metadata.
4. Register one Supabase OAuth client named for the ChatGPT Memphis Zoo MCP connection. Register the management page's callback URI as an exact HTTPS URI. Supabase's current metadata does not advertise RFC 9207 authorization-response issuer identification by default, so use the callback-ID-specific URI unless the live discovery document explicitly advertises support and every success/error redirect returns the exact `iss`. Use the exact public or confidential token endpoint method selected in the app management page; capture any client secret once without committing or logging it.
5. Configure the ChatGPT app with that OAuth client ID and the selected token-endpoint method. Supply a client secret only when the management page selected a confidential-client method; a public client uses `none` and has no secret.
6. Configure a Supabase Custom Access Token Hook for this exact OAuth `client_id`. For that client only, add `aud: "https://memphis-zoo-mcp.onrender.com/mcp"` (or an equivalent `resource` claim) and `scope: "email"`; preserve every original required claim. Return no custom audience or scope for other clients. Supabase invokes the hook for all token issuance, so the exact `client_id` condition is mandatory. The resource server deliberately rejects Supabase's default `aud: "authenticated"`, tokens not bound to this exact resource, and tokens missing a required scope.
7. Add the following Render environment values without changing existing GitHub, Supabase service-role, manager, device, or connector-token secrets:

   ```text
   MCP_OAUTH_ENABLED=true
   MCP_PUBLIC_URL=https://memphis-zoo-mcp.onrender.com
   SUPABASE_PUBLISHABLE_KEY=<project publishable key>
   MCP_OAUTH_COOKIE_SECRET=<new dedicated random value, at least 32 characters>
   MCP_OAUTH_ALLOWED_SUBJECTS=<exact owner user UUID>
   MCP_OAUTH_ALLOWED_CLIENT_IDS=<exact OAuth client UUID>
   MCP_OAUTH_SCOPES=email
   ```

8. Deploy only the reviewed commit. Do not merge unrelated work or rely on an automatic production deploy from another branch.
9. Create one fresh app link and then start a fresh ChatGPT/Codex task so it re-reads the link ID, metadata, and tool registry. Complete the Supabase sign-in and explicit complete-access consent. Do not loop reconnects in a task holding an older link snapshot.

## Acceptance gates

All gates are required. HTTP 200 or a successful deployment alone is not acceptance.

1. With the default strict setting, unauthenticated `/mcp` returns `401` with `WWW-Authenticate` pointing to the exact protected-resource metadata URL and the body carries the same `mcp/www_authenticate` value. If read-only noauth was explicitly enabled, missing credentials can initialize only the read/mixed surface, an invalid bearer still returns this `401`, and any anonymous write returns the same challenge as an MCP tool error without running its adapter.
2. Both protected-resource metadata URLs return the exact Render `/mcp` resource, exact Supabase Auth issuer, header bearer method, and configured scopes.
3. Supabase authorization-server discovery at `https://<project-ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1` returns `200` and advertises `S256`. One bounded OAuth trace proves the exact `/mcp` `resource` value is sent on both authorization and token requests, survives the code exchange, and appears as the exact token `aud`/`resource` binding. The default `email`-only HS256 flow is validated through the Auth server; if `openid` is enabled, JWKS must also return the expected asymmetric public key.
4. A wrong static connector header is rejected and never reaches OAuth validation.
5. Decode one newly issued token without logging it and prove the exact issuer, allowlisted subject/client, `/mcp` audience/resource, numeric `exp`/optional `nbf`, and complete scope claim. Tokens with any mismatch are rejected before a tool runs.
6. ChatGPT completes OAuth and lists every current tool in `mcp-tools.v3`, including GitHub safe-write tools and `supabase_migration_apply`; each listed tool contains matching top-level and `_meta` `securitySchemes`. If read-only noauth is enabled, every direct manifest read tool is callable before linking while write/migration tools remain OAuth-only.
7. ChatGPT proves one GitHub read and one Supabase read against the intended allowlisted resources.
8. ChatGPT proves write capability first with the existing dry-run/preview controls. Any real GitHub write or Supabase migration remains a separately reviewed action with exact target and rollback evidence.

Until gates 6–8 are observed in ChatGPT, report the connection as **unverified**, not ready.

## Rollback and revocation

For a code/config rollback, set `MCP_OAUTH_ENABLED=false` and redeploy the prior reviewed commit. The legacy service-token and SSE lanes remain unchanged.

For identity revocation, remove the subject or client ID from the Render allowlist, revoke the Supabase OAuth grant and the user's active session, and delete or disable the OAuth client. Supabase access-token lifetime should remain short because deleting a user alone is not a complete session-revocation procedure.

Rotate a secret only if evidence shows it was exposed. Ordinary rollback does not require rotating the existing connector, GitHub, Supabase service-role, manager, or device secrets.
