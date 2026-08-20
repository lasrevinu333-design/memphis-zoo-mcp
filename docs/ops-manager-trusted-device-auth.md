# Ops Manager trusted-device authentication

A manager enters a personal, one-time eight-digit enrollment code for each phone or browser. Successful enrollment creates a revocable server-side record and an HttpOnly, Secure cookie. The reusable cookie secret never enters response JSON or JavaScript storage, and only its HMAC is stored in PostgreSQL.

Each page load exchanges the trusted-device cookie for a short-lived access token. Access tokens remain only in JavaScript memory and expire after 15 minutes by default. Refresh is silent. Persistent enrollment lasts 90 days by default and can never exceed 365 days from creation, even if an older database row contains a later expiration.

A device asks for a new personal code when its cookie/browser data is cleared, its credential is revoked or expired, the dedicated signing secret is rotated, or an administrator deliberately reenrolls that device.

Production configuration:

- `OPS_MANAGER_SESSION_SECRET`: mandatory independent HMAC key for access tokens and credential hashes. Production startup fails when it is absent; Gemini, Moxie and Supabase secrets are never substitutes.
- `OPS_MANAGER_ACCESS_TTL_MS`: optional short-lived token TTL, bounded to 1–60 minutes.
- `OPS_MANAGER_TRUST_TTL_MS`: optional trusted-device lifetime, default 90 days and bounded to 1–365 days.
- `OPS_MANAGER_COOKIE_DOMAIN`, `OPS_MANAGER_COOKIE_SAME_SITE`, `OPS_MANAGER_COOKIE_SECURE`: optional cookie controls.

Cookie enrollment, refresh and logout require an exact approved browser/app origin. Device ID alone grants no authority. Logout clears the cookie only after server-side revocation succeeds; a revocation outage leaves access visibly intact for a later retry.

The retired `/mobile-auth-api/*` endpoints return `410` and never accept or return a JavaScript-readable reusable credential.

## Exact cutover order

This is an exact-pair cutover because the old manager app depends on the retired credential endpoints, while the corrected app depends on the HttpOnly cookie endpoints.

1. Verify `OPS_MANAGER_SESSION_SECRET` is configured as an independent Render secret without printing it.
2. Record active named manager devices and prepare one-time personal enrollment codes for the managers who need current access.
3. Apply `20260820143000_bound_ops_manager_device_trust.sql`. It preserves each previous expiration in `metadata_json` and clamps all rows to the 365-day hard limit.
4. Deploy the corrected backend and corrected manager app as one admitted pair.
5. Reenroll each required manager device with its personal one-time code. Existing raw-credential manager installations are not silently migrated through JavaScript.
6. Verify trusted-device refresh, origin rejection, revocation, notification registration and named-manager attribution.

Rollback before physical acceptance: restore the prior exact backend/app pair, drop `ops_manager_trusted_devices_bounded_lifetime`, and restore `expires_at` only from the preserved `pre_bounded_trust_expires_at` value after explicit approval. Do not restore a revoked credential.

MCP never accepts an Ops Manager token. A dedicated `MCP_CONNECTOR_TOKEN` remains available for strict service and legacy SSE clients; Streamable HTTP access follows the separately documented full/read-only tokenless connector policy.
