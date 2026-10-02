# LOCATION dispatch and original ACK — guarded source contract

This adds a callable LOCATION-only source route. It does not activate a native
factory, manifest component, `/native-provider` index mount, Firebase resource or
qualified clock. No deployment, live provider delivery or device acceptance is
claimed. EVENT, MESSAGE, SCHEDULE/lunch and other required kinds are not widened
into the LOCATION parser.

## One original attempt

`employee-notifications.deliverClaimedJob` delegates only a non-test
`employee_native_push` with `employee_location_status` to
`deliverNativeLocationJob`. Its branch precedes the legacy catch/release/health
path. Generic sender, Event logic, manager digest and test notifications remain
unchanged. A retry consults the original immutable reservation, not a new lease,
recipient or token. An accepted outcome can be read back; refusal, unknown or a
prepared reservation never authorizes a second attempt.

`createPushRuntime.prepareNativeLocationSender` prepares the existing scoped
OAuth token first. Target resolution then reads the exact current original
employee/device/credential/epoch/registration/generation/principal/token tuple.
`custodial_native_location_dispatch_prepare` calls final locked LOCATION
reservation admission and atomically records a unique attempt and outcome UUID.
It grants permission only on the fresh commit response. A lost commit response
or death before HTTP leaves a prepared reservation, not a resend permission.
Authenticated inventory remains available for valid original work.

The single-use closure sends the exact canonical, hashed SQL payload as FCM
`data`, with Android HIGH, package restriction and SQL-derived whole-second TTL.
No mixed `notification`, collapse key, APNs payload, clipped source field or
client-supplied time is added. TTL is floored from exact SQL microsecond
`valid_until - reservation_at`, capped at the documented four-week provider
limit. Zero is permitted when less than one second remains. The fixed 15-second
HTTP timeout and 16-KiB response limit are resource budgets, not clock accuracy
or validity assumptions. There is no OAuth/network await between the fresh
permit's validation and the one HTTP invocation.

The native expiry/current-principal admission is still required: provider TTL,
SQL admission and an immediate function call do not certify actual send/arrival
time across process suspension or provider delay. No local wall-clock rounding,
invented safety margin, numeric drift bound or FCM acceptance becomes display
authority. Production remains subject to the unfulfilled qualification gate.

A validated successful fixed-project FCM message name is provider acceptance
only. Explicit 4xx refusal (except ambiguous request timeout) is known
nonacceptance. Network loss, 5xx, redirect, timeout or malformed/oversized success
are unknown. Only finite diagnostic codes are persisted. Every attempted outcome
uses the database-owned operation UUID and exact original binding. Lost outcome
responses trigger exact readback, not another send. Missing committed evidence
remains pending; a later worker finding only prepared state retains it as
unknown/no-resend. No successor registration health is changed.

Transport reference: [Firebase REST message schema](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages).
The supported shipping SDK/token/configuration contract must still be verified
before activation; this source does not silently replace token registration with
Firebase Installation ID or claim current provider configuration acceptance.

## Exact original ACK projection

Only an already admitted immutable `acknowledged` event can create the private
projection record and original legacy suppression row. The receipt function
invokes projection in its own transaction, including replay: projection failure
cannot return a drainable accepted ACK. Its ordered authority locks and current
credential/person/device/epoch checks are retained; original generation,
reservation, key, principal, token and content must match. Retired same-principal
original history can settle without giving a successor authority.

The projection writes only `acknowledged_at`, using original server receipt
time. Received/displayed/opened/dismissed remain separate; local Dismiss and
Open never become an acknowledgement. Existing timestamps and metadata are
preserved on exact actor/job/key matches; a conflicting actor/job fails the
whole receipt transaction. Response-loss replay preserves original bytes and
timestamps. No cleaning session, cadence baseline or successor key is changed.

## Database security, recovery and tests

Migration `20261003080000_native_location_dispatch_and_ack.sql` adds two private
FORCE-RLS tables with ALWAYS append-only triggers and explicit deny-by-default
grants. Only dispatch status and clock-owning prepare wrappers are service-role
callable. No runtime can call the synthetic-time or ACK projection helper, and
no client/service role receives direct table access. It narrowly extends the
existing receipt/outcome functions and captures exact affected function, grant,
relation, column, state, constraint, index and trigger recovery definitions.

Run `node scripts/native-location-dispatch-contract-tests.mjs` for the actual
employee callsite, existing private OAuth closure and unavailable/typed guards.
Run `node scripts/native-location-dispatch-database-tests.mjs` for full current
migration replay with default grants absent and synthetic SQL→coordinator→FCM
wire, loss/replay/current authority/ACK/concurrency/recovery checks. Its owned
PostgreSQL container has network disabled, no published port, tmpfs data and
exact finally cleanup. No test contacts a provider. Existing employee and
manager notification contract runners cover unchanged routes.

## Remaining source versus later release gates

Real source capability gaps remain: complete single native runtime owner and
removal/effect/finalization fencing, all required canonical protected kinds,
current-business presentation/audio integration, and supported target-specific
clock qualification. The required evidence is a defensible worst-case numeric
quantization/error/drift qualification for the shipping elapsedRealtime/boot/
SoC/kernel path, applicable across suspend/reboot/environment, with exact
profile/source/version binding and independent acceptance. No `q_ns` or `p_ppm`
is inferred from the nonce/A/B transport, tests or generic documentation.

A possible no-new-paid official target evidence route remains unproved. A
historical/as-of alternative changes current/unexpired/offline obligations and
needs owner/master reconciliation plus independent review; it is not an enabled
fallback. Parent owns complete master trace, source integration and fresh
independent final audit. All 22 full NOT/REV4.1-NOT records remain open; this
advances bounded NOT-002/003 and REV4.1-NOT-004/005 receipt/identity/recovery and
LOCATION producer/sender portions only. Later artifact/configuration/provider/
retained-data/Fully/physical proofs remain later gates, not circular evidence
required before reviewing the source. READY, FINISHED and COMPLETE are not
claimed by this document.
