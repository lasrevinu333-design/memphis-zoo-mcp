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

MCP never accepts an Ops Manager token. A dedicated `MCP_CONNECTOR_TOKEN` remains available for strict service and legacy SSE clients; Streamable HTTP access follows the separately documented full/read-only tokenless connector policy.

## Native Android/iOS authority v2

Native Ops Manager apps use `manager-device-auth.v2`; they do not place the
long-lived device credential in the WebView. Each installation creates separate
P-256 signing and wrapping keys in the platform-protected key store. The backend
accepts only low-S ES256 P1363 proofs over an exact semantic request digest and
exact route, and it seals enrollment and short-lived Ops sessions to the device
wrapping key with ECDH P-256, HKDF-SHA256, and AES-256-GCM.

Enrollment and recovery are resumable two-phase operations. A one-time code is
reserved while a sealed result is pending; the prior credential remains active
during recovery until the device confirms its locally committed replacement.
Exact retries return the same durable sealed envelope after response loss or a
backend restart. Confirmation serializes on the device binding and leaves one
active credential/key generation. Cancellation and expiry erase the server-side
verifier and envelope while preserving audit metadata. Plaintext device secrets
are never stored in PostgreSQL.

`recover` signs its challenge with the current active transport signing key,
binds a distinct fresh signing/wrapping pair into that challenge, and then
proves the new signing key on the enrollment operation. iOS additionally proves
the current App Attest installation key; Android supplies a fresh Play Integrity
verdict. If the current transport-signing or protected attestation identity is missing or unusable,
the native app performs an explicit local `replace` flow mapped on the wire to
purpose/flow `enroll`: fresh attestation, fresh transport keys, the same device
ID, and a fresh personal one-time manager code. The old credential and
installation remain active until the new sealed credential confirms. Cancelling
retires only the pending replacement and revokes its one-time code; it never
revokes the old authority. Clients must not switch flows automatically after a
generic server failure or discard offline work.

Every short-lived bearer session is revalidated against its durable session
row, live manager roles, credential authority epoch, active installation, and
active key generation. Revocation, removal, cross-version replacement, manager
deactivation, role changes, expiration, or assignment supersession therefore
fails closed immediately. Removal atomically revokes credentials and sessions,
deactivates push registration, cancels eligible queued notifications, retires
the installation/key generations, and stores an idempotent non-secret receipt.
The sealed `ops_session` is exactly two non-empty base64url segments separated
by one period and is bounded to 32–8192 UTF-8 bytes on the backend, Android,
and iOS.

The canonical native role order is `OPS_MANAGER`, `CUSTODIAL_MANAGER`,
`DIRECTOR`, `SECURITY_ADMIN`. Any specialized manager role implies
`OPS_MANAGER`. `CUSTODIAL_MANAGER` is preserved end to end so native full-access
sessions retain the same custodial leadership and administrative authority as
the established web dashboard; malformed or noncanonical signed role arrays
fail closed.

Android enrollment/session issuance requires a live Play Integrity verdict for
the exact package, production signing digest, allowed version, request hash,
device-integrity level, and licensing policy. iOS requires the pinned Apple App
Attestation root, a valid certificate chain/nonce/key identity, the exact real
Team ID plus bundle ID, monotonically increasing assertions, and allowlisted
validation category and bundle version. Attestation policy content is reduced
to a stable fingerprint; changing any allowlisted identity or build replaces
unconsumed challenges and prevents old-policy pending enrollment results from
being accepted.

Deployment stays fail-closed until all v2 environment checks pass. Apply the
forward-only migration first, configure the exact production Android and iOS
attestation identities, then set `MANAGER_V2_ENABLED=true`. Keep
`MANAGER_V2_SERVER_SECRET` stable and backed up; rotating it is an intentional
fleet-wide credential invalidation. See `docs/env.md` for the complete variable
list. Generated golden vectors contain test-only keys and identities and are
interoperability fixtures, never production policy.
