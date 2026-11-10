# Exact activation digest caller repair

This pending SQL bundle starts from the captured original live definitions and
supersedes the two earlier pending activation baseline/context repair apply
inputs. Do not apply it after those files: its exact preimage checks will refuse.
Preserve their source and qualification receipts as history.

The parent-owned live, forced-rollback diagnostic identified large
`static_weekly_digest_jsonb` SQL-function contexts during activation. The global
helper is exactly a strict SQL call to `static_weekly_digest_text(p_value::text)`.
Its text helper looks up pgcrypto and dynamically executes UTF8 conversion,
the existing extension's SHA256 digest and hex encoding. This bundle expands
that exact chain at 31 call sites in eight captured activation owners, using
`pg_catalog.encode(extensions.digest(pg_catalog.convert_to((expression)::text,'UTF8'),'sha256'),'hex')`.
It does not change either global helper, algorithm, JSONB serialization,
NULL semantics, authority checks, exceptions, guard ordering, full equality,
stored documents, transaction identity or the 60-second product deadline. The
already qualified baseline memoization and local unused-context releases are
included. No new database resource or privilege is created.

All eight original definitions, owner/ACL/security/search-path metadata and
matching recovery rows must agree before the first change. Only the two matching
function restore rows are updated. Grants, authority surface and the ALWAYS
immutability guard are preserved and read back. The same-stem JSON records all
original/replacement bytes, exact substitution spans and prior qualified seams.
The actual pgcrypto 1.3 namespace, UTF8 encoding, bytea digest definition, owner,
ACL, schema ACL and callable metadata are checked before and after. Six callers
are postgres security definers; the two invokers have postgres-only execution
and run within those definer chains. Control-plane schema USAGE stays denied.

`npm run test:activation-digest-callsite` checks byte-for-byte reconstruction,
exact original helper semantics, actual PG17 DDL/readback, recovery updates,
changed owner/ACL/helper/inventory refusal, duplicate refusal and hash parity for
SQL NULL, JSON null, Unicode, numbers and structured data. It also proves the
control-plane to definer to invoker crypto call succeeds while direct
control-plane crypto access remains denied. External dependency
tables are explicitly synthetic DDL ports. This is not full live activation or
a performance result. Local flat, TOASTed and structured fixtures did not
reproduce the large live retained contexts. The first owner-local helper
expansion removed the large live contexts but still missed the 60-second limit.
A local 1500-call benchmark measured about 50–52 ms for the text helper versus
6.1–6.3 ms for the same direct crypto expression, with identical output. Actual
performance still requires the parent's exact guarded full transaction rehearsal
and rollback/quiescence proof; local timing is not a production PASS.

The explicit `custodial_coverall.lunch_validator_fingerprint()` closure does not
include any of the eight changed callers or their recovery rows. Its global
digest helpers and all validator/wrapper definitions remain unchanged. Existing
data/packet/preview identities remain identical because all hashes still use the
same expression and bytes. No admission proof is forged or bypassed.

The full connected-catalog observer includes function definitions and therefore
an applied repair changes its actual fingerprint. The historical 311-migration
canonical target and deployed signed backend identity must not be relabeled as a
new observed catalog match. This is the existing qualified narrow repair and
explicit OWNER_TEST_ONLY route; full production admission remains separate.
Record the actual apply receipt and observed delta, then archive exact SQL under
the real applied version. Do not replay an uncertain original activation or
carry an expired Chicago service-date basis across midnight.

Runtime JavaScript is unchanged. A pending-doc/test/manifest commit is not a
claim that the deployed backend was rebuilt, or that this SQL has been applied.
