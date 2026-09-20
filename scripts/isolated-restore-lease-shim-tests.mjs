#!/usr/bin/env node

import assert from "node:assert/strict";
import pg from "pg";
import {
  GLOBAL_MUTATION_FENCE_MIGRATION,
  ISOLATED_LEASE_SHIM_COMMENT,
  ensureIsolatedRestoreLeaseShim,
  ledgerHasGlobalMutationFence,
  retireIsolatedRestoreLeaseShim,
  verifyIsolatedSourceLeaseState,
} from "./isolated-restore-lease-shim.mjs";

class FixtureDatabase {
  constructor({
    relationName = null,
    relationComment = null,
    controlPresent = true,
    migrationPresent = false,
    relationOwner = "supabase_admin",
    currentUser = "supabase_admin",
    relationKind = "r",
    relationPersistence = "p",
    leaseCounts = { total_count: 0, active_count: 0, expired_count: 0 },
    wrongShape = false,
  } = {}) {
    this.relationName = relationName;
    this.relationComment = relationComment;
    this.controlPresent = controlPresent;
    this.migrationPresent = migrationPresent;
    this.relationOwner = relationOwner;
    this.currentUser = currentUser;
    this.relationKind = relationKind;
    this.relationPersistence = relationPersistence;
    this.leaseCounts = leaseCounts;
    this.wrongShape = wrongShape;
    this.queries = [];
  }

  async query(sql, params = []) {
    const statement = String(sql).replace(/\s+/g, " ").trim();
    this.queries.push({ statement, params });
    if (statement.includes("obj_description(relation_oid,'pg_class')")) {
      return { rows: [{
        relation_name: this.relationName,
        relation_comment: this.relationComment,
        relation_owner: this.relationName ? this.relationOwner : null,
        relation_kind: this.relationName ? this.relationKind : null,
        relation_persistence: this.relationName ? this.relationPersistence : null,
        current_user: this.currentUser,
      }] };
    }
    if (statement.includes("to_regclass('custodial_dr.restore_control')")) {
      return { rows: [{ relation_name: this.controlPresent ? "custodial_dr.restore_control" : null }] };
    }
    if (statement.startsWith("select exists(select 1 from supabase_migrations.schema_migrations")) {
      assert.deepEqual(params, [GLOBAL_MUTATION_FENCE_MIGRATION]);
      return { rows: [{ migration_present: this.migrationPresent }] };
    }
    if (statement.startsWith("create table custodial_dr.application_mutation_leases")) {
      this.relationName = "custodial_dr.application_mutation_leases";
      this.relationComment = null;
      return { rows: [] };
    }
    if (statement.startsWith("comment on table custodial_dr.application_mutation_leases")) {
      this.relationComment = ISOLATED_LEASE_SHIM_COMMENT;
      return { rows: [] };
    }
    if (statement.includes("coalesce(json_agg(json_build_object(")) {
      return { rows: [{
        columns: [
          { name: "request_id", type: this.wrongShape ? "text" : "uuid", not_null: true, default: null },
          { name: "authority_generation", type: "bigint", not_null: true, default: null },
          { name: "service_name", type: "text", not_null: true, default: null },
          { name: "admitted_at", type: "timestamp with time zone", not_null: true, default: "clock_timestamp()" },
          { name: "heartbeat_at", type: "timestamp with time zone", not_null: true, default: "clock_timestamp()" },
          { name: "expires_at", type: "timestamp with time zone", not_null: true, default: "(clock_timestamp() + '00:03:00'::interval)" },
        ],
        constraints: [
          { name: "application_mutation_lease_expiry_order", type: "c", definition: "CHECK ((expires_at > admitted_at))" },
          { name: "application_mutation_leases_authority_generation_check", type: "c", definition: "CHECK ((authority_generation >= 0))" },
          { name: "application_mutation_leases_pkey", type: "p", definition: "PRIMARY KEY (request_id)" },
          { name: "application_mutation_leases_service_name_check", type: "c", definition: "CHECK (((length(btrim(service_name)) >= 1) AND (length(btrim(service_name)) <= 120)))" },
        ],
        non_owner_acl: [
          { grantee: "postgres", privilege: "DELETE", grantable: false },
          { grantee: "postgres", privilege: "INSERT", grantable: false },
          { grantee: "postgres", privilege: "SELECT", grantable: false },
        ],
      }] };
    }
    if (statement.includes("count(*)::int total_count")) return { rows: [this.leaseCounts] };
    if (statement === "drop table custodial_dr.application_mutation_leases") {
      this.relationName = null;
      this.relationComment = null;
      return { rows: [] };
    }
    if (/^(revoke|grant) /.test(statement)) return { rows: [] };
    throw new Error(`Unexpected fixture SQL: ${statement}`);
  }
}

assert.equal(ledgerHasGlobalMutationFence([]), false);
assert.equal(ledgerHasGlobalMutationFence([{ version: GLOBAL_MUTATION_FENCE_MIGRATION }]), true);

const baseline = new FixtureDatabase();
assert.deepEqual(
  await ensureIsolatedRestoreLeaseShim(baseline, { sourceMigrationPresent: false }),
  { created: true, sourceMigrationPresent: false },
);
assert.equal(baseline.relationComment, ISOLATED_LEASE_SHIM_COMMENT);
assert.deepEqual(
  await ensureIsolatedRestoreLeaseShim(baseline, { sourceMigrationPresent: false }),
  { created: false, sourceMigrationPresent: false },
  "preparation is idempotent only for the exact marked shim",
);
assert.deepEqual(
  await retireIsolatedRestoreLeaseShim(baseline),
  { retired: true, alreadyAbsent: false, sourceMigrationPresent: false },
);
assert.equal(baseline.relationName, null);

await assert.rejects(
  ensureIsolatedRestoreLeaseShim(new FixtureDatabase(), { sourceMigrationPresent: true }),
  /ledger includes the global mutation fence/,
  "an applied migration with a missing lease table is schema drift, not a compatibility case",
);
await assert.rejects(
  ensureIsolatedRestoreLeaseShim(new FixtureDatabase({
    relationName: "custodial_dr.application_mutation_leases",
    relationComment: "unmarked",
  }), { sourceMigrationPresent: false }),
  /unmarked/,
  "an unexpected pre-migration table cannot be mistaken for the disposable shim",
);
await assert.rejects(
  ensureIsolatedRestoreLeaseShim(new FixtureDatabase({ controlPresent: false }), { sourceMigrationPresent: false }),
  /signed restore control plane/,
);

const applied = new FixtureDatabase({
  relationName: "custodial_dr.application_mutation_leases",
  relationComment: "production mutation lease authority",
  migrationPresent: true,
});
assert.deepEqual(
  await ensureIsolatedRestoreLeaseShim(applied, { sourceMigrationPresent: true }),
  { created: false, sourceMigrationPresent: true },
);
assert.deepEqual(
  await retireIsolatedRestoreLeaseShim(applied),
  { retired: false, alreadyAbsent: false, sourceMigrationPresent: true },
  "a source schema that already owns the real migration table is preserved",
);

await assert.rejects(
  retireIsolatedRestoreLeaseShim(new FixtureDatabase({
    relationName: "custodial_dr.application_mutation_leases",
    relationComment: ISOLATED_LEASE_SHIM_COMMENT,
    migrationPresent: true,
  })),
  /cannot survive/,
);
await assert.rejects(
  retireIsolatedRestoreLeaseShim(new FixtureDatabase({
    relationName: "custodial_dr.application_mutation_leases",
    relationComment: ISOLATED_LEASE_SHIM_COMMENT,
    leaseCounts: { total_count: 1, active_count: 0, expired_count: 1 },
  })),
  /not empty/,
  "expired leases remain fail-closed blockers and are never discarded by rehearsal cleanup",
);
await assert.rejects(
  retireIsolatedRestoreLeaseShim(new FixtureDatabase({
    relationName: "custodial_dr.application_mutation_leases",
    relationComment: ISOLATED_LEASE_SHIM_COMMENT,
    relationOwner: "unexpected_owner",
  })),
  /not owned/,
  "only the exact isolated restore identity can own and retire the shim",
);
await assert.rejects(
  retireIsolatedRestoreLeaseShim(new FixtureDatabase({ migrationPresent: true })),
  /recorded but its application mutation lease table is missing/,
);

const liveDatabaseUrl = String(process.env.ISOLATED_LEASE_SHIM_TEST_DATABASE_URL || "").trim();
const signedFenceLedger = [{ version: GLOBAL_MUTATION_FENCE_MIGRATION }];
const permanentOptions = {
  relationName: "custodial_dr.application_mutation_leases",
  relationComment: "In-flight external API work admitted under a restore generation. Heartbeats keep live work visible; abandoned leases expire after three minutes.",
  relationOwner: "postgres",
  migrationPresent: true,
};
const permanent = new FixtureDatabase(permanentOptions);
assert.deepEqual(await verifyIsolatedSourceLeaseState(permanent, { sourceLedger: signedFenceLedger }), {
  source_global_fence_present: true, permanent_lease_table_preserved: true,
  temporary_shim_absent: true, active_mutation_leases: 0, expired_mutation_leases: 0,
});
assert.equal(permanent.queries.some(({ statement }) => /^(drop|delete|truncate|alter) /i.test(statement)), false,
  "permanent-table verification must be read-only and must never delete the real table or its leases");
assert.equal((await verifyIsolatedSourceLeaseState(new FixtureDatabase(), { sourceLedger: [] })).temporary_shim_absent, true);
for (const [override, message] of [
  [{ relationName: null }, /must be preserved/],
  [{ relationComment: ISOLATED_LEASE_SHIM_COMMENT }, /source marker/],
  [{ relationComment: null }, /source marker/],
  [{ relationOwner: "wrong_owner" }, /not owned/],
  [{ relationKind: "v" }, /ordinary persistent/],
  [{ relationPersistence: "u" }, /ordinary persistent/],
  [{ wrongShape: true }, /shape is not exact/],
  [{ leaseCounts: { total_count: 1, active_count: 1, expired_count: 0 } }, /not empty/],
  [{ leaseCounts: { total_count: 1, active_count: 0, expired_count: 1 } }, /not empty/],
  [{ migrationPresent: false }, /does not match its signed/],
]) {
  await assert.rejects(verifyIsolatedSourceLeaseState(new FixtureDatabase({ ...permanentOptions, ...override }),
    { sourceLedger: signedFenceLedger }), message);
}
await assert.rejects(verifyIsolatedSourceLeaseState(new FixtureDatabase({
  relationName: "custodial_dr.application_mutation_leases", relationComment: ISOLATED_LEASE_SHIM_COMMENT,
}), { sourceLedger: [] }), /temporary lease shim must be absent/);
await assert.rejects(verifyIsolatedSourceLeaseState(permanent, { sourceLedger: [] }), /does not match its signed/);

if (liveDatabaseUrl) {
  const { Client } = pg;
  const live = new Client({ connectionString: liveDatabaseUrl, application_name: "isolated-lease-shim-live-test" });
  await live.connect();
  try {
    await live.query("begin");
    await live.query("create schema if not exists custodial_dr");
    await live.query("create schema if not exists supabase_migrations");
    await live.query("create table if not exists custodial_dr.restore_control(singleton boolean primary key)");
    await live.query("create table if not exists supabase_migrations.schema_migrations(version text primary key)");
    await live.query("delete from supabase_migrations.schema_migrations where version=$1", [GLOBAL_MUTATION_FENCE_MIGRATION]);
    assert.equal((await ensureIsolatedRestoreLeaseShim(live, { sourceMigrationPresent: false })).created, true);
    assert.equal((await live.query("select to_regclass('custodial_dr.application_mutation_leases') is not null present")).rows[0].present, true);
    assert.equal((await retireIsolatedRestoreLeaseShim(live)).retired, true);
    assert.equal((await live.query("select to_regclass('custodial_dr.application_mutation_leases') is null absent")).rows[0].absent, true);
    await live.query("rollback");
  } catch (error) {
    await live.query("rollback").catch(() => {});
    throw error;
  } finally {
    await live.end();
  }
}

console.log("ISOLATED_RESTORE_LEASE_SHIM_TESTS_PASS");
