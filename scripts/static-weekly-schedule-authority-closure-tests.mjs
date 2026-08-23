#!/usr/bin/env node
// Adversarial lifecycle proof for the final scheduler authority closure. This
// deliberately traverses the deployed control-plane read -> compile -> adapter
// -> SQL path against one fresh worker-owned PostgreSQL instance.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { compileStaticWeeklySchedule } from "../src/static-weekly-schedule-compiler.js";
import { assertExceptionCommand } from "../src/static-weekly-schedule-model.js";
import { createStaticWeeklyControlPlane } from "../src/static-weekly-control-plane.js";
import { createStaticWeeklyDraftRpcInput } from "../src/static-weekly-schedule-database-adapter.js";
import { captureSchemaCatalog, fingerprintSchemaCatalog } from "./schema-fingerprint-catalog.mjs";

const execFileAsync = promisify(execFile);
const docker = (args, options = {}) => execFileAsync("docker", args, { maxBuffer: 32 * 1024 * 1024, ...options });
const dockerSql = (statement) => {
  if (Buffer.byteLength(statement) <= 16 * 1024) return docker(["exec", container, "psql", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres", "-c", statement]);
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres"]);
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(Object.assign(new Error(`psql exited ${code}`), { stdout, stderr })));
    child.stdin.end(statement);
  });
};
const container = `mz_static_weekly_i2_closure_${process.pid}`;
const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
const manager = { manager_id: "10000000-0000-4000-8000-000000000071", manager_display_name: "Closure Named Manager", auth_mode: "trusted_device", trusted_device: true, read_only: false };
const managerRecord = { manager_id: manager.manager_id, display_name: manager.manager_display_name, roles: ["OPS_MANAGER"], active: true };
const slotId = "20000000-0000-4000-8000-000000000071";
const oldPersonId = "30000000-0000-4000-8000-000000000071";
const newPersonId = "30000000-0000-4000-8000-000000000072";
const sourceId = "80000000-0000-4000-8000-000000000071";
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

function sourceInput({ serviceDate = "2026-11-02", versionId = "60000000-0000-4000-8000-000000000071", publicationId = "70000000-0000-4000-8000-000000000071" } = {}) {
  const location = "40000000-0000-4000-8000-000000000071";
  return {
    serviceDate,
    timezone: "America/Chicago",
    exceptions: [],
    proximity: [{ from: "START", to: location, minutes: 1, verified: true, provenance: "closure-route" }],
    slots: [{ id: slotId, label: "Closure stable slot", incumbencies: [{ personId: oldPersonId, displayName: "Closure Old", effectiveStart: "2020-01-01", effectiveEnd: null }] }],
    versions: [{
      id: versionId, publicationId, status: "published", effectiveStart: serviceDate, effectiveEnd: null,
      objective: { requireVerifiedProximity: true },
      slotAvailability: Array.from({ length: 7 }, (_, dayOfWeek) => ({ slotId, dayOfWeek, status: "working", shift: { start: "07:00", end: "16:00" }, productiveCapacityProvenance: "closure-shift", maxServiceEffortMinutes: 300, maxServiceEffortProvenance: "closure-capacity", qualifications: ["general"], qualificationProvenance: "closure-qualification", restrictions: [], restrictionProvenance: "closure-restriction", acceptedRouteAnchorLocationId: "START", acceptedRouteProvenance: "closure-route" })),
      assignments: Array.from({ length: 7 }, (_, dayOfWeek) => ({ workId: `closure-work-${dayOfWeek}`, dayOfWeek, locationId: location, locationCodeSnapshot: `CLOSURE_${dayOfWeek}`, locationNameSnapshot: `Closure ${dayOfWeek}`, window: { start: "08:00", end: "09:00" }, ownerSlotId: slotId, serviceEffortMinutes: 20, serviceEffortProvenance: "closure-effort", priority: 1, priorityProvenance: "closure-priority", requiredQualifications: ["general"], qualificationProvenance: "closure-work-qualification", restrictions: [], restrictionProvenance: "closure-work-restriction" })),
    }],
  };
}

async function eventually(action, attempts = 90) {
  let error;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await action(); } catch (failure) { error = failure; await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  throw error;
}

let pool = null;
let removed = false;

function sqlLiteral(value) {
  if (value == null) return "null";
  if (typeof value === "object") return `$$${JSON.stringify(value)}$$::jsonb`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return quote(value);
}

function bind(statement, values) {
  if (!values.length) return String(statement);
  return String(statement).replace(/\$(\d+)/g, (_match, index) => sqlLiteral(values[Number(index) - 1]));
}

function outputJson(output) {
  const text = String(output || "").trim().split("\n").at(-1) || "";
  return JSON.parse(text);
}

function createDockerPool() {
  const client = {
    role: null,
    async query(statement, values = []) {
      const trimmed = String(statement).trim();
      if (/^begin$/i.test(trimmed)) return { rows: [] };
      const roleMatch = trimmed.match(/^set local role (static_weekly_(?:control_plane|release_operator))$/i);
      if (roleMatch) { this.role = roleMatch[1]; return { rows: [] }; }
      if (/^(commit|rollback)$/i.test(trimmed)) { this.role = null; return { rows: [] }; }
      const rendered = bind(trimmed, values);
      const prefix = this.role ? `set role ${this.role}; ` : "";
      const output = (await dockerSql(`${prefix}${rendered}`)).stdout;
      if (/\bas result\b/i.test(rendered)) return { rows: [{ result: outputJson(output) }] };
      if (/\bas state\b/i.test(rendered)) return { rows: [{ state: outputJson(output) }] };
      return { rows: [] };
    },
    release() {},
  };
  return {
    async connect() { return client; },
    async query(statement, values = []) { return client.query(statement, values); },
    async end() {},
  };
}

async function catalogClient() {
  return {
    async query(statement) {
      const wrapped = `select coalesce(json_agg(row_to_json(q)),'[]'::json)::text from (${statement}) q;`;
      return { rows: outputJson((await dockerSql(wrapped)).stdout) };
    },
    release() {},
  };
}
async function roleCall(role, functionName, values = []) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
    const result = await client.query(`select public.${functionName}(${placeholders}) as result`, values);
    await client.query("commit");
    return result.rows[0]?.result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally { client.release(); }
}
async function state() {
  const { rows } = await pool.query("select jsonb_build_object('revision',(select current_revision from public.static_weekly_schedule_control where singleton),'publications',(select count(*) from public.weekly_schedule_publications),'exceptions',(select count(*) from public.weekly_schedule_exception_commands),'receipts',(select count(*) from public.weekly_schedule_command_receipts),'projections',(select count(*) from public.weekly_schedule_compiled_projections),'occurrences',(select count(*) from public.weekly_schedule_occurrences)) as state");
  return rows[0].state;
}
async function expectNoMutation(action, pattern, label) {
  const before = await state();
  await assert.rejects(action, (error) => pattern.test(String(error?.message || error)), label);
  assert.deepEqual(await state(), before, `${label}: rejection must not mutate authority state`);
}

try {
  const postgresImage = process.env.SCHEMA_REBUILD_DOCKER_IMAGE || "supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
  await docker(["image", "inspect", postgresImage]);
  await docker(["run", "--rm", "-d", "--name", container, "--tmpfs", "/var/lib/postgresql/data:rw,size=1g", "-e", "POSTGRES_PASSWORD=postgres", postgresImage, "-c", "shared_preload_libraries=pg_cron,pg_net,pg_stat_statements"]);
  await eventually(() => dockerSql("select 1"));
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  pool = createDockerPool();
  await pool.query("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
  for (const name of fs.readdirSync(migrationsDir).filter((entry) => entry.endsWith(".sql")).sort()) await pool.query(fs.readFileSync(path.join(migrationsDir, name), "utf8"));
  await pool.query("insert into public.ops_manager_managers(manager_id,display_name,roles,active,metadata_json,is_system_principal) values($1,$2,array['OPS_MANAGER']::text[],true,'{}'::jsonb,false)", [manager.manager_id, manager.manager_display_name]);
  await roleCall("static_weekly_release_operator", "static_weekly_v3_configure_initial_authority_key", ["static-weekly-authority-hmac-v1", "closure-initial-authority-secret-012345678901234567890", "closure-suite"]);

  const registeredInput = sourceInput();
  const registered = await compileStaticWeeklySchedule(registeredInput);
  assert.equal(registered.status, "FEASIBLE");
  await roleCall("static_weekly_release_operator", "static_weekly_v3_register_authority_source", [sourceId, registered.canonicalAuthority.compilerInput, "closure-source"]);
  await pool.query(`insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(${quote(slotId)},'CLOSURE_SLOT','Closure stable slot',${quote(manager.manager_id)},${quote(manager.manager_display_name)},repeat('a',64)); insert into public.weekly_roster_slot_incumbencies(slot_id,person_id,person_name_snapshot,effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(${quote(slotId)},${quote(oldPersonId)},'Closure Old','2020-01-01',${quote(manager.manager_id)},${quote(manager.manager_display_name)},repeat('b',64));`);

  const controlPlane = createStaticWeeklyControlPlane({ database: pool });
  const draft = await controlPlane.createInitialDraft({ manager, sourceId, effectiveStart: "2026-11-02", expectedRevision: 0, idempotencyKey: "closure-create" });
  const publication = await controlPlane.publishDraft({ manager, draftVersionId: draft.data.version_id, expectedDraftRevision: 1, expectedRevision: 1, idempotencyKey: "closure-publish" });
  const publicationId = publication.data.publication_id;
  const versionId = publication.data.version_id;

  // FP-H1: the real source-read/control-plane/compiler/adapter/SQL route
  // must materialize every aligned horizon without another publication.
  const first = await controlPlane.materializeProjection({ manager, publicationId, serviceDate: "2026-11-02", expectedRevision: 2, idempotencyKey: "closure-first-week" });
  const second = await controlPlane.materializeProjection({ manager, publicationId, serviceDate: "2026-11-09", expectedRevision: first.revision, idempotencyKey: "closure-second-week" });
  const distant = await controlPlane.materializeProjection({ manager, publicationId, serviceDate: "2027-01-04", expectedRevision: second.revision, idempotencyKey: "closure-year-boundary" });
  assert.equal(distant.revision, 5, "the first, second, distant, and year-boundary horizons materialize through the control plane without republishing");

  // FP-M1: table-driven portable/SQL reason parity, with no partial mutation.
  for (const { label, reason, accepted } of [
    { label: "astral 500", reason: "😀".repeat(500), accepted: true },
    { label: "ascii 501", reason: "a".repeat(501), accepted: false },
    { label: "astral 501", reason: "😀".repeat(501), accepted: false },
    { label: "blank", reason: "   ", accepted: false },
    { label: "control", reason: "approved\nchange", accepted: false },
  ]) {
    const payload = { slotId, status: "working", shift: { start: "07:00", end: "16:00" } };
    const portable = { id: `closure-${label}`, type: "shift_override", serviceDate: "2026-11-03", actorId: manager.manager_id, reason, idempotencyKey: `closure-${label}`, expectedRevision: 5, payload };
    if (accepted) assert.doesNotThrow(() => assertExceptionCommand(portable), `${label} must be portable-valid`);
    else assert.throws(() => assertExceptionCommand(portable), `${label} must be portable-invalid`);
    const action = () => controlPlane.applyException({ manager, exceptionType: "shift_override", serviceDate: "2026-11-03", baseVersionId: versionId, publicationId, reason, payload, expectedRevision: 5, idempotencyKey: `closure-sql-${label}` });
    if (accepted) {
      const acceptedResult = await action();
      assert.equal(acceptedResult.revision, 7, "500-character reason advances the valid exception and its current projection atomically");
    } else await expectNoMutation(action, /reason|500|control/i, `${label} SQL reason`);
  }

  // FP-H2: arbitrary person/date replacement was retired in favor of the
  // atomic employee turnover contract proven in the complete v3 suite.
  assert.equal((await dockerSql("select (to_regprocedure('public.static_weekly_v3_replace_incumbency(uuid,uuid,text,date,bigint,uuid,text)') is null)::text")).stdout.trim(), "true");
  assert.equal((await dockerSql("select (to_regprocedure('public.static_weekly_v2_replace_incumbency(uuid,uuid,text,date,bigint,uuid,text,text)') is null)::text")).stdout.trim(), "true");

  // FP-H3: a failed sole active key recovers atomically without pre-revoking
  // it, and the readiness result includes an internal sign/verify canary.
  const healthy = await roleCall("static_weekly_release_operator", "static_weekly_v3_authority_health");
  assert.equal(healthy.ready, true); assert.equal(healthy.operational_sign_verify_canary, true);
  const keyState = async () => outputJson((await dockerSql("select coalesce(jsonb_agg(jsonb_build_object('key_id',key_id,'key_state',key_state,'recovery_of_key_id',recovery_of_key_id) order by key_id),'[]'::jsonb)::text from public.static_weekly_authority_attestation_keys")).stdout);
  const beforeBadRecovery = await keyState();
  await assert.rejects(() => roleCall("static_weekly_release_operator", "static_weekly_v3_recover_authority_key", ["static-weekly-authority-hmac-v2", "closure-recovery-secret-012345678901234567890", "static-weekly-authority-hmac-v404", "closure-recovery"]), /current active failed key/i);
  assert.deepEqual(await keyState(), beforeBadRecovery, "wrong recovery predecessor leaves every key untouched");
  const recovered = await roleCall("static_weekly_release_operator", "static_weekly_v3_recover_authority_key", ["static-weekly-authority-hmac-v2", "closure-recovery-secret-012345678901234567890", "static-weekly-authority-hmac-v1", "closure-recovery"]);
  assert.equal(recovered.ready, true); assert.equal(recovered.operational_sign_verify_canary, true);
  assert.deepEqual((await keyState()).map((row) => [row.key_id, row.key_state, row.recovery_of_key_id]), [["static-weekly-authority-hmac-v1", "revoked", null], ["static-weekly-authority-hmac-v2", "active", "static-weekly-authority-hmac-v1"]]);
  const afterRecovery = await keyState();
  for (const [keyId, predecessor] of [["static-weekly-authority-hmac-v2", "static-weekly-authority-hmac-v1"], ["static-weekly-authority-hmac-v3", "static-weekly-authority-hmac-v1"]]) {
    await assert.rejects(() => roleCall("static_weekly_release_operator", "static_weekly_v3_recover_authority_key", [keyId, "closure-rejected-recovery-secret-012345678901234567890", predecessor, "closure-recovery"]), /current active|new|recovery/i);
    assert.deepEqual(await keyState(), afterRecovery, "reused or non-current recovery lineage leaves every key untouched");
  }
  const rotated = await roleCall("static_weekly_release_operator", "static_weekly_v3_rotate_authority_key", ["static-weekly-authority-hmac-v3", "closure-healthy-rotation-secret-012345678901234567890", new Date(Date.now() + 3_600_000).toISOString(), "closure-rotation"]);
  assert.equal(rotated.ready, true);
  await roleCall("static_weekly_release_operator", "static_weekly_v3_revoke_authority_key", ["static-weekly-authority-hmac-v2", "healthy overlap revocation"]);
  assert.equal((await roleCall("static_weekly_release_operator", "static_weekly_v3_authority_health")).operational_sign_verify_canary, true, "ordinary non-active revocation remains available after healthy bounded-overlap rotation");

  // FP-M2: the canonical inventory covers custom role attributes, membership,
  // and grants, and each authority mutation alters the canonical proof.
  const catalog = await catalogClient();
  {
    const baseline = fingerprintSchemaCatalog(await captureSchemaCatalog(catalog));
    assert.deepEqual(baseline.normalized.owned_scheduler_roles.map((row) => row.role_name), ["static_weekly_control_plane", "static_weekly_release_operator", "static_weekly_runtime_20260823"]);
    assert.ok(baseline.normalized.owned_scheduler_role_memberships.some((row) => row.granted_role === "static_weekly_control_plane" && row.member_role === "static_weekly_runtime_20260823"));
    assert.ok(baseline.normalized.owned_scheduler_role_memberships.some((row) => row.granted_role === "static_weekly_control_plane"));
    assert.ok(baseline.normalized.routine_grants.some((row) => row.grantee === "static_weekly_control_plane" && row.function_name === "static_weekly_v3_materialize_projection"));
    for (const statement of [
      "alter role static_weekly_control_plane inherit",
      "grant static_weekly_control_plane to service_role",
      "grant execute on function public.static_weekly_v3_recover_authority_key(text,text,text,text) to static_weekly_control_plane",
    ]) {
      await pool.query(statement);
      const mutated = fingerprintSchemaCatalog(await captureSchemaCatalog(catalog));
      assert.notEqual(mutated.fingerprint, baseline.fingerprint, `schema fingerprint must change for covered authority mutation: ${statement}`);
    }
  }
  await controlPlane.close();
  await pool.end(); pool = null;
} finally {
  if (pool) await pool.end().catch(() => {});
  await docker(["rm", "-f", container]).catch(() => {});
  removed = true;
}
assert.equal(removed, true, "owned closure-test PostgreSQL container must be removed");
console.log("static weekly scheduler seven-finding adversarial closure lifecycle: PASS");
