# Native provider interval API and SQL prerequisite

Conditional source only. No production index mount, provider send, factory activation, new resource, qualification constant, or historical event conversion occurs here. Companion native source implements PC01/PC02 with no selected production profile. This file supplements, not replaces, the accepted corrected plan (`6623462ca36fb1891e8def589e7e26804f63eb3a5ff8a1f16c79a6791dbf4d8b`) and clock addendum (`25d4218373c451e0d9bfb8f64c4422883728fdd1d443b49760780571d3553982`).

## Integration contract

The existing exported `installNativeProviderRoutes(app,{db,env,requireCurrentCredential})` adapter in `src/native-provider-api.js` owns the four exact native provider POST paths. Its existing current-credential middleware, raw body, HMAC proof, native request UUID, full recipient equality and no-store requirements remain mandatory. Parent owns production index integration; do not independently mount this adapter or add an unauthenticated clock endpoint.

Register/status retain the existing authenticated registration-clock wrapper. Inventory now calls **only** `custodial_native_provider_inventory_clock(uuid,text,uuid,text,jsonb)`. Successful output has exactly `{ok:true,data,clock}`; `data` is the existing frozen bounded inventory page, while `clock` has exactly `native_request_id`, canonical six-fraction UTC `server_now`, and `valid_until`. S is sampled after current proof and current-recipient/generation/registration locks, not copied from the frozen page. The fresh nonce must match the actual native request, page time cannot exceed S, and clock horizon is positive and at most 15 minutes or earlier credential expiry. Cursor-restart409 returns no clock. A historical page-only result cannot supply time authority.

Events use `custodial.native-provider-events.v2`, event `.v2` and receipt `.v2`. Preserve all original identity/content fields plus exact `original_observation` and separate immutable `admission_bounds`. Each observation has exactly `earliest_at`, `latest_at`, `clock_profile_id`, `elapsed_realtime_ms`, `boot_count`; all three time/profile fields are null together for unknown original observations. Admission and displayed observations require known intervals. Batch size remains1..16 and64KiB, current principal must be uniform, original IDs/actions unique, and actions are finite received/displayed/opened/acknowledged. Missing response entries remain pending; no synthetic acceptance or Dismiss-to-ACK conversion.

SQL checks both interval endpoints against the original reservation/expiry, original received transition and native chronology. Original observation is never rewritten from receipt arrival time. Current credentials and original generation/reservation are checked again; immutable replay must match exact original event bytes. The two existing LOCATION acknowledgement projections remain in the transaction. Historical v1 events remain stored, immutable and non-authoritative for new v2 transitions. Existing receipt binding still requires the exact LOCATION payload schema; this does not implement MESSAGE/SCHEDULE/EVENT/LUNCH admission.

## Migration, permissions and recovery

`supabase/migrations/20261003150000_native_provider_interval_protocol.sql` was created using Supabase CLI2.109.1 then moved to the parent-reserved forward timestamp. No broad repair, reset or deployment. It adds/replaces exactly these seven function identities:

1. `custodial_native_provider_interval_observation(jsonb,boolean)`
2. `custodial_native_provider_observation_order(jsonb,jsonb)`
3. `custodial_native_provider_event_shape(jsonb)`
4. `custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamp with time zone)`
5. `custodial_native_provider_events(uuid,text,uuid,text,jsonb)`
6. `custodial_native_provider_inventory_clock_at(uuid,text,uuid,text,jsonb,timestamp with time zone,timestamp with time zone)`
7. `custodial_native_provider_inventory_clock(uuid,text,uuid,text,jsonb)`

All client/runtime roles lose default execute on these functions. Only `service_role` receives execute on the two public wrappers (5 and7); internal time seams are not granted. Exact14 owning recovery function/grant rows are captured, with the existing immutable recovery inventory restored; no global recapture. Parent final combined canary must enumerate all seven after subsequent migrations. The Supabase permission guidance was applied as explicit least-privilege RPC grants, absent-default-role tests and exact recovery definitions.

## Actual bounded evidence and remaining work

API contract102 and event contract62 checks passed. The disposable no-network database proof replayed207 exact migrations with automatic table/sequence grants absent before/after each migration and passed176 functional/role/recovery/chronology checks. It exported the actual authenticated HTTP -> SQL inventory response and original events/receipts consumed by the native tests. Final fixture SHA-256: `18f445de17650c0d5dacabf10292f7423ce929f57b1e4b03e7d4ac7456ce324a`. Fixture Git metadata identifies the baseline because source was uncommitted during execution; its migration/source hashes identify tested bytes. Do not relabel it as a final-commit replay. Parent owns combined-candidate replay and canary.

No required-kind business TTL is inferred from the sample's15-minute horizon. Current unread/deletion/ACK or schedule publication supersession are necessary semantic invalidations but do not, by themselves, supply a finite offline `valid_until`. The new source-only target projection is useful evidence, not delivery admission. Required-kind lifecycle/validity, application-context production owner/effects, exact route mounting, combined reviews and a legitimately supported native clock profile remain open.
