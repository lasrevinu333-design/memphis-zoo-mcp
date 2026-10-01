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
The controller must be supplied by server composition. The default configuration
returns HTTP 503 with
`dated_transition_store_unavailable_requires_bounded_database_adapter`.
There is no environment switch, weekly fallback or production connection added.

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
The directly affected existing runtime regression must also pass. These are not
PostgreSQL, production or phone proofs.

The PostgreSQL bounded adapter is NOT implemented by this correction. Existing
weekly mutators cannot be used as that adapter. Required integration work is a
new server-only bounded database authority/read contract, preserving explicit
grants, current manager reauthorization, existing authority locks and immutable
history. It must bind the four persisted days to current employee schedule/Home,
lunch, cleaning occurrence and revision/target readers. Serving a parallel JSON
schedule without those occurrence/reader bindings would be incomplete. This
candidate deliberately does not mount such an employee facade or claim it exists.

The exact intended release source revision remains unspecified. No shared
checkout, database migration, production state, signing, phone or John draft was
changed. The new code is unreviewed: the earlier F1 PASS applies only to its
unchanged packet-closure scope. Coordinate shared review capacity before any
changed-input independent review submission.
