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


## Recover the first named manager after disaster restore

Normal restore intentionally revokes every restored manager credential and active
personal enrollment code. An old trusted cookie or bearer cannot bootstrap the
restored service, even with the same signing secret. Never un-revoke those rows.

Use `scripts/production-restore-manager-recovery.mjs` from the admitted current
backend on the protected operator host. This command is not a public HTTP route.
It uses the existing restore reconciliation signing/verification authority, with
a separate signed purpose. Configure the normal protected database connection,
project reference, independent `OPS_MANAGER_SESSION_SECRET`, and existing
`RESTORE_RECONCILIATION_*` signing or verification key/ID through the normal
secret channel. Do not put secret values in shell history or turn on shell tracing.

The approving operator selects the actual existing active, non-system named
`CUSTODIAL_MANAGER` ID using `RESTORE_MANAGER_RECOVERY_MANAGER_ID` and identifies
themself with `RESTORE_RECONCILIATION_NAMED_ACTOR`. No manager, role or assignment
is created or changed. With the restored database fully reconciled and unpaused:

```
node scripts/production-restore-manager-recovery.mjs --create
```

This read-only command emits a short-lived signed recovery envelope, not a code.
Review and supply that exact envelope as `RESTORE_MANAGER_RECOVERY_JSON`. For
application, set `RESTORE_MANAGER_RECOVERY_APPLY=true` and the exact
`RESTORE_MANAGER_RECOVERY_CONFIRM_PROJECT_REF`. Set
`RESTORE_MANAGER_RECOVERY_CODE_FD` to a dedicated owned private pipe descriptor
between 3 and 9, then run:

```
node scripts/production-restore-manager-recovery.mjs --apply
```

The pipe must have no group/other permission bits and must not alias stdout or
stderr. Its authorized receiver keeps the code in memory and delivers it directly
to the named manager; it must not log or persist the secret. For an interactive
operator, a private shell process-substitution pipe can feed a RAM-only receiver
that displays the code on that operator's unrecorded terminal. Do not use `tee`,
a capture log, a world-readable FIFO, or a reusable credential file. The pipe
receives one JSON record containing `code_id`, `one_time_code`, and `expires_at`.
Wait for the separate sanitized committed stdout receipt before using the code.
Private delivery failure rolls back issuance; a failed COMMIT is an unknown
outcome and must be reconciled, never blindly retried with a new intent.

The command uses the existing restore and application-mutation fences and locks
normal enrollment/trust/manager tables. It requires the exact signed completed
restore generation, archive, manifest and database identity, no open discrepancies
or mutation leases, no usable manager trust, and no conflicting live recovery or
same-manager personal code. It inserts only a standard five-attempt, at-most-15-
minute hashed personal code plus a `MANAGER_RECOVERY_ISSUANCE` restore event.
It never creates a trusted credential, session or bearer itself. The manager
consumes the personal code through the unchanged normal Hub enrollment UI; the
normal service creates the HttpOnly trusted credential. Then ordinary leadership
code issuance can recover the remaining managers.

Reapplying a committed signed intent returns metadata only; it never remints or
redisplays the secret. If the delivered code is lost, expires or is explicitly
revoked before consumption, an operator may authorize a NEW signed intent after
the old code is no longer active and no usable manager trust exists. Existing
pending personal codes are not silently revoked to make recovery succeed.

For an uncertain COMMIT or lost receipt, use the original signed envelope and
verification authority with `--status`. This authenticated read-only command
accepts an expired approval solely to look up its exact historical restore event
and intent digest. It reports `COMMITTED` or `NOT_OBSERVED` and current control
state separately; no event is not proof of rollback. It never issues or returns
a code and never authorizes another recovery from a historical event.
