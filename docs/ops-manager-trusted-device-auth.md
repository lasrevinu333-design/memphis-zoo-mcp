# Ops Manager trusted-device authentication

The manager password is entered once per browser/device. A successful enrollment creates a revocable server-side credential and an HttpOnly, Secure cookie. The raw persistent credential is never stored in PostgreSQL or browser JavaScript storage.

Each page load exchanges the trusted-device cookie for a short-lived access token. Access tokens remain only in JavaScript memory and expire after 15 minutes by default. Refresh is silent. The persistent enrollment lasts ten years by default and can be revoked through logout or database administration.

A device asks for the manager password again only when its cookie/browser data is cleared, its credential is revoked or expired, the server signing secret is rotated, or an administrator deliberately reenrolls that device.

Production configuration:

- `OPS_MANAGER_PASSWORD`: preferred enrollment password.
- `OPS_MANAGER_SESSION_SECRET`: HMAC key for access tokens and credential hashes.
- `OPS_MANAGER_ACCESS_TTL_MS`: optional short-lived token TTL, bounded to 1–60 minutes.
- `OPS_MANAGER_TRUST_TTL_MS`: optional trusted-device lifetime, bounded to 1 day–10 years.
- `OPS_MANAGER_COOKIE_DOMAIN`, `OPS_MANAGER_COOKIE_SAME_SITE`, `OPS_MANAGER_COOKIE_SECURE`: optional cookie controls.

For transition only, enrollment falls back to the existing Gemini or Moxie password when `OPS_MANAGER_PASSWORD` is absent. Set the dedicated variable and rotate it after the first deployment.

MCP never accepts an Ops Manager token. `MCP_CONNECTOR_TOKEN` is mandatory and independently scoped.
