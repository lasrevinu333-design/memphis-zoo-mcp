import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";

const container = String(process.env.EVENT_TRANSITION_TEST_CONTAINER || "");
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)) {
  throw new Error("EVENT_TRANSITION_TEST_CONTAINER must name an owned disposable schema-rebuild container.");
}
const database = String(process.env.EVENT_TRANSITION_TEST_DATABASE || container);
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(database)) throw new Error("Disposable test database required.");
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const psqlArgs = (sql) => ["exec", "-i", container, "psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
  "-U", "supabase_admin", "-d", database, "-c", sql];
const sql = (statement) => execFileSync("docker", psqlArgs(statement), { encoding: "utf8" }).trim();

const managers = sql(`select manager_id::text from public.ops_manager_managers where active
  and revoked_at is null and not is_system_principal
  and roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
  order by manager_id limit 2;`).split("\n");
assert.equal(managers.length, 2, "Two active named managers are required for the race fixture");
const [venue, group] = sql(`select id::text||'|'||location_group_id::text from public.event_venues
  where venue_code='ZOO_FOOTPRINT' and active limit 1;`).split("|");
assert.ok(venue && group);
const event = JSON.parse(sql(`select public.app_apply_event_command('create',null,
  jsonb_build_object('event_name','Disposable simultaneous cancellation',
    'location_group_id',${q(group)}::uuid,'event_scope','ZOO_WIDE',
    'primary_venue_id',${q(venue)}::uuid,'venue_ids',jsonb_build_array(${q(venue)}::uuid),
    'display_location','Zoo Footprint','status','SCHEDULED','needs_review',false,
    'event_date','2026-11-01','end_date','2026-11-01','start_time','09:00:00','end_time','11:00:00',
    'start_instant_utc','2026-11-01T15:00:00.000Z','end_instant_utc','2026-11-01T17:00:00.000Z',
    'operation_id',${q(randomUUID())}::uuid,'actor_manager_id',${q(managers[0])}::uuid),null,null)::text;`));
const call = (manager, operation) => `select public.app_transition_event_cancellation(
  ${q(event.id)}::uuid,'cancel',1,${q(operation)}::uuid,${q(manager)}::uuid,'simultaneous manager race')::text;`;
const firstOperation = randomUUID();
const secondOperation = randomUUID();
function run(statement) {
  return new Promise((resolve) => {
    const child = spawn("docker", psqlArgs(statement));
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
const first = run(`begin; ${call(managers[0],firstOperation)} select pg_sleep(2); commit;`);
await new Promise((resolve) => setTimeout(resolve, 250));
const second = run(call(managers[1],secondOperation));
const [firstResult, secondResult] = await Promise.all([first, second]);
assert.equal(firstResult.status, 0, `First manager transaction failed: ${firstResult.stderr}`);
assert.notEqual(secondResult.status, 0, "Stale second manager transaction unexpectedly succeeded");
assert.match(secondResult.stderr, /Event changed since this preview/i);
assert.equal(sql(`select count(*) from public.events_app_transition_receipts where event_id=${q(event.id)}::uuid;`), "1");
assert.equal(sql(`select status||'|'||revision from public.events_app_events where id=${q(event.id)}::uuid;`), "CANCELLED|2");
console.log(JSON.stringify({ ok:true, event_id:event.id, first_manager:managers[0],
  second_manager:managers[1], winner_operation:firstOperation, second_sqlstate:"40901" }));
