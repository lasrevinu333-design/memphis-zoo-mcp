The four-day October transition needs application and database support. It is
not an operation waiting only for production signing.

The existing control plane loads registered sources on Monday, publishes with
a Monday projection start and uses a seven-day projection materializer. The
SQL authority additionally requires a complete seven-day horizon wholly inside
one effective publication. October 1–4 cannot satisfy that requirement. Do not
send this transition to the v3 weekly materializer, weaken its checks, backdate
Kathy's Admin duties or publish October 5–7 under the transition.

This correction implements the application preparation and transaction contract
in `src/static-weekly-dated-transition-materialization.js`. Preparation verifies
the unchanged complete October 1–7 compiler witness and lunch proof, verifies
the immutable phone/PDF revision, and selects exactly October 1–4. It does not
rerun or shorten the compiler. The resulting plan preserves all approved
assignment/availability/lunch data and the explicit Friday Herpetarium OPEN
exception. It does not register a recurring source.

The controller requires a distinct server-owned adapter implementing
`custodial.dated-transition-store.v1`. Its interface is documented beside the
controller. Preview binds the named manager, current authority revision,
current roster/approved availability and dependency digest. Confirmation runs
authorization, idempotency lookup, conflict checks, stage, exact readback and
receipt finalization inside one adapter transaction. The adapter must hold the
existing scheduler authority lock. An occupied transition date requires explicit
reconciliation; this candidate never overwrites protected occurrences.

The runtime mounts named-manager-only preview, confirm, operation-status and
rollback routes under `/static-weekly/dated-transition`. Client requests carry
only identities/revision, never schedule facts, dates, shifts or employee IDs.
Server composition loads only the exact offline verified plan and supplies the
bounded PostgreSQL adapter when the existing authority database is a pool.
An unapplied bounded migration fails with `dated_transition_database_adapter_unavailable`;
an explicitly disabled or absent adapter remains HTTP 503. No new connection,
environment switch or weekly fallback is added.

Rollback binds the exact current publication and projection, appends a rollback
receipt and preserves historical publication data and protected cleaning work.
Historical operation status and retry responses distinguish the original receipt
from whether its publication is currently effective. Every response retains
PENDING phone delivery; persistence is not phone acceptance.

Run the two focused scripts from the backend candidate:

```
node scripts/static-weekly-dated-transition-materialization-tests.mjs
node scripts/static-weekly-dated-transition-runtime-tests.mjs
```

The first rechecks the retained full witness and uses the explicit synthetic
database fixture in `scripts/fixtures/dated-transition-transaction-fixture.mjs`.
It tests old/new state, concurrency, revocation, stale revision/dependencies,
partial writes, wrong readback, rollback and ambiguous commit reconciliation.
The second exercises the actual runtime, manager authentication and HTTP routes
with synthetic authority; it needs only automatically cleaned localhost servers.
The directly affected existing runtime regression must also pass. These fixtures are application contract proofs, distinct from the actual
PostgreSQL fixture below. They are not production or phone proofs.

The bounded PostgreSQL implementation is in
`src/static-weekly-dated-transition-postgres.js` and forward CLI-created migration
`20261001130750_october_bounded_dated_transition.sql`. Four internal tables have
forced RLS and no direct runtime/client grants; UUID keys need no sequences.
Only the existing control-plane role can call the mutation dispatcher, which
reauthorizes the current named manager and shares the existing authority lock
and restore mutation fence. A deferred completion trigger prevents an
incomplete stage from becoming durable. Status and exact rollback reauthorize
without requiring obsolete dependencies still to be eligible for a new plan.

Existing typed employee, roster, assignment, lunch and authority readers overlay
only the active October 1–4 publication. Their earlier implementations remain
private fallbacks elsewhere and after rollback. Physical cleaning ownership
uses the unchanged operational reader, preserving real occurrence IDs and
splitting at the exact accepted lunch boundaries. Dated Home facts bind to the
same publication, projection and frozen phone/PDF revision. Dependency drift
marks reads stale rather than silently adjusting the approved schedule.
All new relation/function/ACL recovery definitions are captured in the existing
immutable release inventory. No phone delivery/acknowledgment is inferred.

Run `node scripts/static-weekly-dated-transition-postgres-tests.mjs` using the
installed digest-pinned Supabase PostgreSQL image. This test uses a disposable
network-none container with no ports, explicit synthetic dependencies, all 176
unchanged predecessor migrations, automatic public/global Data API grants
removed, and the new migration applied solely to the fixture. It exercises
actual restricted-role SQL and HTTP readers, exact assignment/lunch/cleaning
rows, the retained frontend Home formatter, denied callers, manager revocation,
partial-stage rollback, deferred completion, idempotency, staleness and exact
function/grant recovery. The copied Home formatter in
`scripts/fixtures/dated-home-facts.js` retains the earlier observed frontend
bytes; it is test evidence, not a frontend implementation change. All owned
containers, sockets and localhost servers are removed in `finally`.

The exact intended release source revision remains unspecified. No shared
checkout, database migration, production state, signing, phone or John draft was
changed. The new code is unreviewed: the earlier F1 PASS applies only to its
unchanged packet-closure scope. Coordinate shared review capacity before any
changed-input independent review submission.
