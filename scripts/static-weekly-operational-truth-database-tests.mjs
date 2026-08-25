#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.CUSTODIAL_STATIC_TRUTH_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.CUSTODIAL_STATIC_TRUTH_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)
    || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("An owned disposable schema-rebuild database is required.");
}

const ids = {
  manager: randomUUID(), employee: randomUUID(), slot: randomUUID(), version: randomUUID(),
  publication: randomUUID(), projection: randomUUID(), publishCommand: randomUUID(),
  projectionCommand: randomUUID(), group: randomUUID(), physical: randomUUID(),
  responseGroup: randomUUID(), responsePhysical: randomUUID(), occurrence: randomUUID(),
  responseOccurrence: randomUUID(), legacyGroup: randomUUID(), legacyLocation: randomUUID(),
  availability: randomUUID(), incumbency: randomUUID(), staffing: randomUUID(),
};
const discriminator = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
const codes = {
  employee: `TE${discriminator.slice(0, 6)}`,
  physical: `TS${discriminator.slice(0, 6)}`,
  responsePhysical: `TR${discriminator.slice(0, 6)}`,
  legacyLocation: `TL${discriminator.slice(0, 6)}`,
  group: `TG${discriminator.slice(0, 6)}`,
  responseGroup: `TQ${discriminator.slice(0, 6)}`,
  legacyGroup: `TX${discriminator.slice(0, 6)}`,
  slot: `TW${discriminator.slice(0, 6)}`,
};
const hash = (label) => createHash("sha256").update(`${discriminator}:${label}`).digest("hex");
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;

async function sql(statement, { expectFailure = false } = {}) {
  try {
    const result = await execFileAsync("docker", ["exec", container, "psql", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", statement], { maxBuffer: 16 * 1024 * 1024 });
    if (expectFailure) assert.fail(`Expected SQL failure: ${statement}`);
    return result.stdout.trim().split("\n").map((line) => line.trim()).filter(Boolean).at(-1) || "";
  } catch (error) {
    if (!expectFailure) throw error;
    return String(error.stderr || error.message);
  }
}

const [serviceDate, weekStart, weekEnd, dayOfWeek] = (await sql(`
  select public.sch_service_date(now())::text || '|' ||
    (public.sch_service_date(now())-(extract(isodow from public.sch_service_date(now()))::integer-1))::text || '|' ||
    (public.sch_service_date(now())-(extract(isodow from public.sch_service_date(now()))::integer-1)+6)::text || '|' ||
    extract(dow from public.sch_service_date(now()))::integer::text;
`)).split("|");
assert.equal(await sql(`select (public.static_weekly_effective_version(${q(serviceDate)}::date) is null)::text;`),
  "true", "the disposable fixture requires an ungoverned current service date");
const publishRevision = Number(await sql("select coalesce(max(authority_revision),0)+100 from public.weekly_schedule_authority_revisions;"));
const projectionRevision = publishRevision + 1;
const staffingRevision = publishRevision + 2;

await sql(`
begin;
select set_config('app.static_weekly_publish_write','on',true);

insert into public.employees(id,employee_code,display_name,active,role)
values(${q(ids.employee)}::uuid,${q(codes.employee)},'Operational Truth Employee',true,'staff');
insert into public.locations(id,location_code,location_name,location_type,form_type,active,sort_order)
values
  (${q(ids.physical)}::uuid,${q(codes.physical)},'Operational Truth Restroom','restroom','restroom',true,1),
  (${q(ids.responsePhysical)}::uuid,${q(codes.responsePhysical)},'Operational Response Duty','exhibit','exhibit',true,2),
  (${q(ids.legacyLocation)}::uuid,${q(codes.legacyLocation)},'Legacy Shadow Location','restroom','restroom',true,3);
insert into public.location_groups(id,group_code,group_name,active)
values
  (${q(ids.group)}::uuid,${q(codes.group)},'Operational Truth Family',true),
  (${q(ids.responseGroup)}::uuid,${q(codes.responseGroup)},'Operational Response Family',true),
  (${q(ids.legacyGroup)}::uuid,${q(codes.legacyGroup)},'Legacy Shadow Family',true);
insert into public.location_group_memberships(location_id,location_group_id,active)
values
  (${q(ids.physical)}::uuid,${q(ids.group)}::uuid,true),
  (${q(ids.responsePhysical)}::uuid,${q(ids.responseGroup)}::uuid,true),
  (${q(ids.legacyLocation)}::uuid,${q(ids.legacyGroup)}::uuid,true);

insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
values(${q(ids.slot)}::uuid,${q(codes.slot)},'Operational Truth Slot',${q(ids.manager)}::uuid,'Truth Manager',${q(hash("1"))});
insert into public.weekly_roster_slot_incumbencies(incumbency_id,slot_id,person_id,person_name_snapshot,effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
values(${q(ids.incumbency)}::uuid,${q(ids.slot)}::uuid,${q(ids.employee)}::uuid,'Operational Truth Employee','2020-01-01',${q(ids.manager)}::uuid,'Truth Manager',${q(hash("2"))});

insert into public.weekly_schedule_authority_revisions(authority_revision,command_id,operation,actor_manager_id,actor_manager_name_snapshot,content_digest)
values(${publishRevision},${q(ids.publishCommand)}::uuid,'publish',${q(ids.manager)}::uuid,'Truth Manager',${q(hash("3"))});
insert into public.weekly_schedule_versions(version_id,version_number,lifecycle_state,publication_kind,effective_start,revision,objective_version,objective_json,input_provenance_json,draft_document,content_digest,created_by_manager_id,created_by_manager_name_snapshot,published_by_manager_id,published_by_manager_name_snapshot,published_at)
values(${q(ids.version)}::uuid,${publishRevision},'published','publish',${q(weekStart)}::date,1,'truth.v1','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,${q(hash("4"))},${q(ids.manager)}::uuid,'Truth Manager',${q(ids.manager)}::uuid,'Truth Manager',now());
insert into public.weekly_schedule_publications(publication_id,version_id,authority_revision,publication_kind,effective_start,expected_revision,idempotency_key,actor_manager_id,actor_manager_name_snapshot,request_digest,replay_digest,content_digest,output_digest)
values(${q(ids.publication)}::uuid,${q(ids.version)}::uuid,${publishRevision},'publish',${q(weekStart)}::date,0,${q(`truth-publish-${discriminator}`)},${q(ids.manager)}::uuid,'Truth Manager',${q(hash("5"))},${q(hash("6"))},${q(hash("7"))},${q(hash("8"))});
insert into public.weekly_schedule_slot_availability(availability_id,version_id,slot_id,day_of_week,availability_state,shift_start,shift_end,lunch_start,lunch_end,capacity_units,max_load_points,qualification_snapshot,qualification_provenance,restriction_snapshot,restriction_provenance,slot_label_snapshot,incumbent_person_id_snapshot,incumbent_name_snapshot,content_digest)
values(${q(ids.availability)}::uuid,${q(ids.version)}::uuid,${q(ids.slot)}::uuid,${Number(dayOfWeek)},'working','07:00','16:00','11:00','11:30',1,100,'["general"]'::jsonb,'{}'::jsonb,'[]'::jsonb,'{}'::jsonb,'Operational Truth Slot',${q(ids.employee)}::uuid,'Operational Truth Employee',${q(hash("9"))});

insert into public.weekly_schedule_compiled_projections(projection_id,publication_id,version_id,week_start,week_end,exception_set_json,exception_set_digest,compiler_version,objective_json,metrics_json,replay_digest,authority_digest,receipt_json,projection_envelope,compiled_by_manager_id)
values(${q(ids.projection)}::uuid,${q(ids.publication)}::uuid,${q(ids.version)}::uuid,${q(weekStart)}::date,${q(weekEnd)}::date,'[]'::jsonb,public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(${q(ids.publication)}::uuid,${q(weekStart)}::date)),'truth.compiler.v1','{}'::jsonb,'{}'::jsonb,${q(hash("a"))},${q(hash("b"))},'{}'::jsonb,'{}'::jsonb,${q(ids.manager)}::uuid);
insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
values(${q(ids.projectionCommand)}::uuid,${q(ids.manager)}::uuid,'Truth Manager','materialize_projection',${q(`truth-project-${discriminator}`)},${publishRevision},${q(hash("c"))},'{}'::jsonb,jsonb_build_object('revision',${projectionRevision},'data',jsonb_build_object('projection_id',${q(ids.projection)})),${q(hash("d"))},${q(hash("e"))});

insert into public.weekly_schedule_occurrences(occurrence_id,projection_id,publication_id,version_id,service_date,work_id,day_of_week,location_id,location_code_snapshot,location_name_snapshot,coverage_start,coverage_end,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,state,original_actor_person_id,original_actor_name_snapshot,authority_facts_json,occurrence_digest)
values
  (${q(ids.occurrence)}::uuid,${q(ids.projection)}::uuid,${q(ids.publication)}::uuid,${q(ids.version)}::uuid,'${serviceDate}'::date,'truth-scan-${discriminator}',${Number(dayOfWeek)},${q(ids.physical)}::uuid,${q(codes.group)},'Operational Truth Family','08:00','09:00',${q(ids.slot)}::uuid,'Operational Truth Slot',${q(ids.employee)}::uuid,'Operational Truth Employee','created',${q(ids.employee)}::uuid,'Operational Truth Employee',jsonb_build_object('work_snapshot',jsonb_build_object('serviceMode','scan_tracked','serviceEffortMinutes',10,'includedLocations',jsonb_build_array(jsonb_build_object('locationId',${q(ids.physical)},'locationNameSnapshot','Operational Truth Restroom')))),${q(hash("f"))}),
  (${q(ids.responseOccurrence)}::uuid,${q(ids.projection)}::uuid,${q(ids.publication)}::uuid,${q(ids.version)}::uuid,'${serviceDate}'::date,'truth-response-${discriminator}',${Number(dayOfWeek)},${q(ids.responsePhysical)}::uuid,${q(codes.responseGroup)},'Operational Response Family','09:00','10:00',${q(ids.slot)}::uuid,'Operational Truth Slot',${q(ids.employee)}::uuid,'Operational Truth Employee','created',${q(ids.employee)}::uuid,'Operational Truth Employee',jsonb_build_object('work_snapshot',jsonb_build_object('serviceMode','response_only_no_clean','serviceEffortMinutes',5,'includedLocations','[]'::jsonb)),${q(hash("0"))});

insert into public.daily_work_roster(service_date,employee_id,shift_start,shift_end,source_type,active)
values(${q(serviceDate)}::date,${q(ids.employee)}::uuid,'04:00','12:00','legacy-shadow',true);
insert into public.daily_schedule_assignments(service_date,location_group_id,segment_number,assigned_employee_id,owner_type,coverage_start,coverage_end,status,load_points,source_type,coverage_purpose)
values(${q(serviceDate)}::date,${q(ids.legacyGroup)}::uuid,1,${q(ids.employee)}::uuid,'EMPLOYEE','04:00','05:00','ASSIGNED',99,'legacy-shadow','area_owner');
commit;
`);

assert.equal(await sql(`select authority_source||'|'||projection_status||'|'||projection_id::text from public.static_weekly_v6_schedule_authority_state(${q(serviceDate)}::date);`),
  `static_weekly_projection|current|${ids.projection}`, "the effective publication selects one current exact projection");
assert.equal(await sql(`select count(*)||'|'||min(coverage_start)||'|'||bool_and(source_type='static_weekly_projection') from public.static_weekly_v6_read_schedule_segments(${q(serviceDate)}::date);`),
  "2|08:00:00|true", "governed schedule rows ignore conflicting legacy assignments");
assert.equal(await sql(`select count(*) from public.static_weekly_v6_read_schedule_segments(${q(serviceDate)}::date) where group_code=${q(codes.legacyGroup)};`),
  "0", "the mutable legacy scheduler cannot override a governed date");
assert.equal(await sql(`select count(*)||'|'||min(location_code)||'|'||min(coverage_start)::text from public.custodial_operational_location_assignments(${q(serviceDate)}::date);`),
  `1|${codes.physical}|08:00:00`, "physical truth expands only the scan-tracked included location");
assert.equal(await sql(`select count(*) from public.custodial_operational_location_assignments(${q(serviceDate)}::date) where location_id=${q(ids.responsePhysical)}::uuid;`),
  "0", "response-only work never becomes a cleaning obligation");
assert.equal(await sql(`select count(*)||'|'||min(coverage_start)||'|'||bool_and(source_type='static_weekly_projection') from public.v_memphis_area_schedule where service_date=${q(serviceDate)}::date;`),
  "2|08:00|true", "AI and analytics compatibility views consume canonical static authority");
assert.equal(await sql(`select employee_name||'|'||shift_start||'|'||lunch_start||'|'||active::text from public.static_weekly_v6_read_roster(${q(serviceDate)}::date);`),
  "Operational Truth Employee|07:00:00|11:00:00|true", "manager roster uses static shift and lunch authority");
assert.equal(await sql(`select schedule_authority_source||'|'||schedule_projection_status||'|'||(status_code<>'not_cleaned')::text from public.v_location_dashboard_status where location_id=${q(ids.physical)}::uuid;`),
  "static_weekly_projection|current|true", "manager dashboard derives the scan-tracked location from current static authority");
assert.equal(await sql(`select schedule_authority_source||'|'||schedule_projection_status||'|'||status_code from public.v_location_dashboard_status where location_id=${q(ids.responsePhysical)}::uuid;`),
  "static_weekly_projection|current|not_cleaned", "response-only work remains visible but never becomes a cleaning obligation");
assert.equal(await sql(`select schedule_authority_source||'|'||schedule_projection_status||'|'||status_code from public.v_location_dashboard_status where location_id=${q(ids.legacyLocation)}::uuid;`),
  "static_weekly_projection|current|not_cleaned", "legacy shadow assignments cannot create governed dashboard due state");

for (const role of ["public", "anon", "authenticated", "service_role"]) {
  assert.equal(await sql(`select has_function_privilege(${q(role)},'public.static_weekly_v6_read_schedule_segments(date)','EXECUTE')::text;`),
    "false", `${role} cannot invoke the canonical schedule reader directly`);
}
assert.equal(await sql(`select has_function_privilege('custodial_application_reader','public.static_weekly_v6_read_schedule_segments(date)','EXECUTE')::text;`),
  "true", "the dedicated read-only application role can invoke canonical schedule authority");
assert.equal(await sql(`select has_function_privilege('service_role','public.custodial_backend_queue_due_scan_alerts(integer,boolean,integer,integer,text)','EXECUTE')::text;`),
  "true", "the backend may invoke only the fixed secret-bound scan-alert operation");
assert.equal(await sql(`select has_function_privilege('service_role','public.sch_queue_due_scan_alerts(integer,boolean,integer,integer)','EXECUTE')::text;`),
  "false", "the generic service role cannot invoke the weaker alert writer directly");
for (const role of ["public", "anon", "authenticated"]) {
  assert.equal(await sql(`select has_function_privilege(${q(role)},'public.custodial_backend_queue_due_scan_alerts(integer,boolean,integer,integer,text)','EXECUTE')::text;`),
    "false", `${role} cannot invoke the backend scan-alert operation`);
}
assert.match(await sql(`set role service_role; select public.custodial_backend_queue_due_scan_alerts(1,true,30,30,'wrong-secret');`, { expectFailure: true }),
  /custodial backend execution boundary is not authorized/i,
  "the fixed alert operation rejects an invalid backend secret");
assert.equal(await sql(`
  begin;
  update public.custodial_backend_execution_config
  set execution_secret_digest=encode(extensions.digest(convert_to('scan-alert-disposable-secret-20260825','UTF8'),'sha256'),'hex'), enabled=true
  where config_key=true;
  set local role service_role;
  select (public.custodial_backend_queue_due_scan_alerts(1,true,30,30,'scan-alert-disposable-secret-20260825')->>'ok')::text;
  rollback;
`), "true", "the fixed alert operation executes a dry run with the current backend secret");

await sql(`
begin;
insert into public.weekly_schedule_authority_revisions(authority_revision,command_id,operation,actor_manager_id,actor_manager_name_snapshot,content_digest)
values(${staffingRevision},gen_random_uuid(),'mark_employee_departed',${q(ids.manager)}::uuid,'Truth Manager',${q(hash("a"))});
insert into public.weekly_roster_slot_staffing_states(staffing_state_id,slot_id,employee_id,staffing_state,effective_start,authority_revision,actor_manager_id,actor_manager_name_snapshot,reason,content_digest)
values(${q(ids.staffing)}::uuid,${q(ids.slot)}::uuid,${q(ids.employee)}::uuid,'working',${q(serviceDate)}::date,${staffingRevision},${q(ids.manager)}::uuid,'Truth Manager','stale projection proof',${q(hash("b"))});
commit;
`);
assert.equal(await sql(`select projection_status from public.static_weekly_v6_schedule_authority_state(${q(serviceDate)}::date);`),
  "stale_staffing_change", "a newer staffing authority invalidates the old projection");
assert.equal(await sql(`select count(*) from public.static_weekly_v6_read_schedule_segments(${q(serviceDate)}::date);`),
  "0", "stale governed authority fails closed instead of falling back to legacy rows");
assert.equal(await sql(`select count(*) from public.v_memphis_area_schedule where service_date=${q(serviceDate)}::date;`),
  "0", "compatibility views also fail closed on stale governed authority");
assert.equal(await sql(`select schedule_projection_status||'|'||status_code from public.v_location_dashboard_status where location_id=${q(ids.physical)}::uuid;`),
  "stale_staffing_change|not_cleaned", "dashboard exposes stale authority and refuses false due/readiness state");

console.log("STATIC_WEEKLY_OPERATIONAL_TRUTH_DATABASE_PASS");
