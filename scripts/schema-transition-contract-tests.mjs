#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReleaseManifest } from "../src/release-manifest.js";
import { assertSchemaAlignment } from "../src/schema-transition.js";
import {
  captureSchemaCatalog,
  fingerprintSchemaCatalog,
  SCHEMA_CATALOG_QUERIES,
  UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY,
  UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY,
} from "./schema-fingerprint-catalog.mjs";
import { sanitizeReadOnlySql } from "../src/supabase/read.js";

const input = JSON.parse(readFileSync(new URL("../release/schema-alignment-input.json", import.meta.url), "utf8"));
const frontend = JSON.parse(readFileSync(new URL("../release/frontend-release-manifest.json", import.meta.url), "utf8"));
const target = readFileSync(new URL("../supabase/canonical/schema-fingerprint.txt", import.meta.url), "utf8").trim();
const now = Date.parse("2026-08-21T00:00:00Z");

assert.equal(frontend.frontend_commit_sha, input.frontend_commit_sha, "the backend manifest must pin the exact audited frontend");
assert.equal(frontend.frontend_commit_state, "final_pair_bound");
assert.equal(frontend.schema_fingerprint, target, "the exact frontend pair must declare the canonical target schema");
assert.deepEqual(frontend.minimum_supported, input.minimum_supported);
const backend = buildReleaseManifest({ appVersion: "test-release" });
assert.deepEqual(backend.api_contract_versions, input.api_contract_versions);
assert.deepEqual(backend.queue_compatibility_versions, input.queue_compatibility_versions);
assert.deepEqual(backend.minimum_supported, input.minimum_supported);

const transition = frontend.schema_transition;
const aligned = assertSchemaAlignment({
  backendManifest: backend,
  frontendManifest: { schema_fingerprint: frontend.schema_fingerprint, schema_transition: transition },
  deploymentManifest: { schema_fingerprint: frontend.schema_fingerprint, schema_transition: transition },
  now,
});
assert.equal(aligned.mode, "declared");
assert.equal(transition.from_fingerprint, input.schema_from_fingerprint);
assert.equal(target, transition.to_fingerprint);
for (const section of [
  "privilege_bearing_roles", "role_memberships", "column_grants", "sequence_grants",
  "type_grants", "schema_grants", "default_privileges",
]) assert.equal(typeof SCHEMA_CATALOG_QUERIES[section], "string", `schema identity must include ${section}`);
for (const [section, sql] of Object.entries(SCHEMA_CATALOG_QUERIES)) {
  assert.doesNotThrow(
    () => sanitizeReadOnlySql(sql),
    `${section} schema inventory must pass the production read-only SQL boundary`,
  );
}
for (const section of ["table_grants", "routine_grants"]) {
  assert.match(SCHEMA_CATALOG_QUERIES[section], /not in \('postgres','supabase_admin'\)/,
    `${section} must exclude only the two equivalent managed migration-owner identities`);
}
assert.match(SCHEMA_CATALOG_QUERIES.tables, /then 'migration_owner'/);
assert.match(SCHEMA_CATALOG_QUERIES.default_privileges, /select distinct[\s\S]*owner\.rolname in \('postgres','supabase_admin'\)/,
  "default privileges must normalize equivalent managed migration owners independently of caller identity");
assert.match(SCHEMA_CATALOG_QUERIES.default_privileges, /grantee\.rolname='service_role'/,
  "schema identity must bind application mutation defaults without provider-managed or ephemeral provisioning defaults");
assert.match(SCHEMA_CATALOG_QUERIES.privilege_bearing_roles, /memphis_zoo_backup.*static_weekly_control_plane.*static_weekly_release_operator.*static_weekly_runtime_20260823/);
assert.match(SCHEMA_CATALOG_QUERIES.role_memberships, /from pg_auth_members/);
assert.match(
  SCHEMA_CATALOG_QUERIES.cron_jobs,
  /from custodial_release_identity\.custodial_schema_identity_cron_jobs\(\)/,
  "schema identity must use the fixed owner-authority cron bridge rather than caller-filtered cron.job",
);
assert.match(SCHEMA_CATALOG_QUERIES.role_memberships, /parent\.rolname<>'custodial_application_reader'/,
  "ephemeral dedicated reader login provisioning must remain outside schema identity");
assert.match(
  SCHEMA_CATALOG_QUERIES.role_memberships,
  /parent\.rolname~'\^custodial_readonly_runtime_\[0-9\]\{8\}\$'[\s\S]*member\.rolname in \('postgres','supabase_admin'\)[\s\S]*reader_parent\.rolname='custodial_application_reader'/,
  "the safe managed-owner membership created for a dedicated runtime login must not make schema identity caller-dependent",
);
assert.match(
  SCHEMA_CATALOG_QUERIES.owned_scheduler_role_memberships,
  /parent\.rolname='static_weekly_runtime_20260823'[\s\S]*member\.rolname in \('postgres','supabase_admin'\)[\s\S]*grantor\.rolname in \('postgres','supabase_admin'\)[\s\S]*m\.admin_option[\s\S]*not parent\.rolinherit/,
  "PostgreSQL 17 managed creator-admin control over the bounded scheduler login must not create a false schema drift",
);
assert.match(
  SCHEMA_CATALOG_QUERIES.role_memberships,
  /parent\.rolname='static_weekly_runtime_20260823'[\s\S]*member\.rolname in \('postgres','supabase_admin'\)[\s\S]*grantor\.rolname in \('postgres','supabase_admin'\)[\s\S]*m\.admin_option[\s\S]*not parent\.rolinherit/,
  "the general role inventory must apply the same exact managed creator-admin normalization",
);
const authorityBaseline = { privilege_bearing_roles: [], role_memberships: [], table_grants: [] };
assert.equal(
  fingerprintSchemaCatalog({ tables: [{ table_name: "commented", object_comment: "release truth" }] }).fingerprint,
  fingerprintSchemaCatalog({ tables: [{ table_name: "commented", comment: "release truth" }] }).fingerprint,
  "database-driver object_comment fields and canonical comment fields must share one identity",
);
const unexpectedRole = structuredClone(authorityBaseline);
unexpectedRole.privilege_bearing_roles.push({ role_name: "unexpected_login", can_login: true, bypasses_rls: true });
assert.notEqual(fingerprintSchemaCatalog(authorityBaseline).fingerprint, fingerprintSchemaCatalog(unexpectedRole).fingerprint,
  "a captured application role must change connected schema identity");
const unexpectedMembership = structuredClone(authorityBaseline);
unexpectedMembership.role_memberships.push({ granted_role: "service_role", member_role: "unexpected_login", admin_option: false });
assert.notEqual(fingerprintSchemaCatalog(authorityBaseline).fingerprint, fingerprintSchemaCatalog(unexpectedMembership).fingerprint,
  "an arbitrary service-role membership must change connected schema identity");
const supportedRelationBaseline = { tables: [], views: [] };
const materializedViewAddition = structuredClone(supportedRelationBaseline);
materializedViewAddition.views.push({
  schema_name: "public",
  view_name: "identity_materialized",
  relation_kind: "m",
  owner_name: "postgres",
  definition: " select 1 as value;",
  comment: null,
});
assert.notEqual(
  fingerprintSchemaCatalog(supportedRelationBaseline).fingerprint,
  fingerprintSchemaCatalog(materializedViewAddition).fingerprint,
  "a public materialized view addition must change schema identity",
);
const partitionedTableAddition = structuredClone(supportedRelationBaseline);
partitionedTableAddition.tables.push({
  schema_name: "public",
  table_name: "identity_partitioned",
  relation_kind: "p",
  owner_name: "postgres",
  rls_enabled: false,
  rls_forced: false,
  partition_key: "LIST (bucket)",
  comment: null,
});
assert.notEqual(
  fingerprintSchemaCatalog(supportedRelationBaseline).fingerprint,
  fingerprintSchemaCatalog(partitionedTableAddition).fingerprint,
  "a public partitioned table addition must change schema identity",
);
const queryNames = new Map([
  ...Object.entries(SCHEMA_CATALOG_QUERIES),
  ["unsupported_relations", UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY],
  ["unsupported_types", UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY],
].map(([name, sql]) => [sql, name]));
await assert.rejects(() => captureSchemaCatalog({
  async query(sql) {
    const name = queryNames.get(sql);
    if (name === "unsupported_relations") return { rows: [{ relation_name: "foreign_bridge", relation_kind: "f" }] };
    if (name === "unsupported_types") return { rows: [] };
    return { rows: [] };
  },
}), /Unsupported public foreign table must be reviewed before schema fingerprint capture: foreign_bridge/);
await assert.rejects(() => captureSchemaCatalog({
  async query(sql) {
    const name = queryNames.get(sql);
    if (name === "unsupported_types") return { rows: [{ type_name: "composite_bridge", type_kind: "c" }] };
    if (name === "unsupported_relations") return { rows: [] };
    return { rows: [] };
  },
}), /Unsupported public composite type must be reviewed before schema fingerprint capture: composite_bridge/);
assert.throws(() => assertSchemaAlignment({
  backendManifest: backend,
  frontendManifest: { schema_fingerprint: "f".repeat(64), schema_transition: transition },
  deploymentManifest: { schema_fingerprint: frontend.schema_fingerprint, schema_transition: transition }, now,
}), /outside the transition/);
console.log(JSON.stringify({ ok: true, schema_transition_contract: "passed" }, null, 2));
