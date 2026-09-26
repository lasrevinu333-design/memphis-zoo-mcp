import assert from "node:assert/strict";
import { assertOwnedReleaseFixture, canonicalReleaseFixtureConnection } from "./release-migration-fixture-guard.mjs";

const ownerToken = "a".repeat(32);
const containerId = "b".repeat(64);
const hostname = containerId.slice(0, 12);
const databaseName = `mz_schema_rebuild_releaseplan_${ownerToken}`;
const good = { ownerToken, containerId, hostname,
  readOwnerFile: () => ownerToken,
  databaseUrl: `postgresql://supabase_admin:postgres@127.0.0.1:5432/${databaseName}` };
assert.equal(assertOwnedReleaseFixture(good), databaseName);
assert.deepEqual(canonicalReleaseFixtureConnection(databaseName), {
  clientConfig: { host: "127.0.0.1", port: 5432, database: databaseName, user: "supabase_admin", password: "postgres", ssl: false },
  databaseUrl: `postgresql://supabase_admin:postgres@127.0.0.1:5432/${databaseName}`,
});
assert.throws(() => canonicalReleaseFixtureConnection("production"));
for (const bad of [
  { ownerToken: "" },
  { containerId: "" },
  { hostname: "unrelated" },
  { readOwnerFile: () => { throw new Error("wrapper ownership mount absent"); } },
  { readOwnerFile: () => "c".repeat(32) },
  { databaseUrl: "postgresql://u:p@prod.example.com/postgres?application_name=ci" },
  { databaseUrl: "postgresql://test-user:p@prod.example.com/postgres" },
  { databaseUrl: `postgresql://u:p@ci.example.com:5432/${databaseName}` },
  { databaseUrl: `postgresql://u:p@127.0.0.1:5432/mz_schema_rebuild_releaseplan_${"c".repeat(32)}` },
  { databaseUrl: `postgresql://u:p@127.0.0.1:5432/${databaseName}?application_name=ci` },
  { databaseUrl: `postgresql://u:p@127.0.0.1:5432/${databaseName}` },
]) assert.throws(() => assertOwnedReleaseFixture({ ...good, ...bad }));
console.log("RELEASE_MIGRATION_FIXTURE_GUARD_TESTS_PASS");
