#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.CUSTODIAL_COVERAGE_POLICY_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.CUSTODIAL_COVERAGE_POLICY_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("A disposable schema-rebuild database is required.");
}

async function sql(statement) {
  const { stdout } = await execFileAsync("docker", [
    "exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At",
    "-U", "supabase_admin", "-d", database, "-c", statement,
  ], { maxBuffer: 8 * 1024 * 1024 });
  return String(stdout || "").split("\n").map((line) => line.trim()).filter(Boolean).at(-1) || "";
}

async function expectFailure(statement, pattern) {
  await assert.rejects(() => sql(statement), (error) => {
    assert.match(String(error?.stderr || error?.message || error), pattern);
    return true;
  });
}

const ids = {
  first: "00000000-0000-4000-8000-00000000e101",
  second: "00000000-0000-4000-8000-00000000e102",
  third: "00000000-0000-4000-8000-00000000e103",
  coverAll1: "",
  firstLocation: "00000000-0000-4000-8000-00000000e105",
  secondLocation: "00000000-0000-4000-8000-00000000e106",
  protectedLocation: "00000000-0000-4000-8000-00000000e107",
  thirdLocation: "00000000-0000-4000-8000-00000000e111",
  firstAssignment: "00000000-0000-4000-8000-00000000e108",
  secondAssignment: "00000000-0000-4000-8000-00000000e109",
  protectedAssignment: "00000000-0000-4000-8000-00000000e110",
  thirdAssignment: "00000000-0000-4000-8000-00000000e112",
};
const serviceDate = "2026-08-24";
const assignment = (originalEmployeeId, locationGroupId) => ({
  location_group_id: locationGroupId,
  segment_number: 1,
  coverage_start: "08:00:00",
  coverage_end: "12:00:00",
  original_employee_id: originalEmployeeId,
});
const payload = ({ thirdOriginal = ids.third, thirdCapacity = ids.coverAll1 } = {}) => JSON.stringify({
  service_date: serviceDate,
  internally_redistributed_employee_ids: [ids.first, ids.second],
  coverall_absent_employee_ids: [ids.third],
  coverage: [
    { absent_employee_id: ids.third, coverall_capacity_employee_id: thirdCapacity, assignments: [assignment(thirdOriginal, ids.thirdLocation), assignment(ids.third, ids.protectedLocation)] },
  ],
}).replaceAll("'", "''");

ids.coverAll1 = await sql("select id::text from public.employees where employee_code='COVERALL_01' and active=true order by id limit 1;");
assert.match(ids.coverAll1, /^[0-9a-f-]{36}$/i, "the disposable baseline must contain first registered CoverAll capacity");

await sql(`
  insert into public.employees(id,employee_code,display_name,active,role) values
    ('${ids.first}','COVERAGE_FIRST','First Absence',true,'staff'),
    ('${ids.second}','COVERAGE_SECOND','Second Absence',true,'staff'),
    ('${ids.third}','COVERAGE_THIRD','Third Absence',true,'staff');
  insert into public.location_groups(id,group_code,group_name,active) values
    ('${ids.firstLocation}','POLICY_FIRST','First absence area',true),
    ('${ids.secondLocation}','POLICY_SECOND','Second absence area',true),
    ('${ids.protectedLocation}','POLICY_PROTECTED','Manager protected area',true),
    ('${ids.thirdLocation}','POLICY_THIRD','Third absence area',true);
  insert into public.coverage_templates(location_group_id,day_of_week,segment_number,assigned_employee_id,coverage_start,coverage_end,active,coverage_purpose) values
    ('${ids.firstLocation}',1,1,'${ids.first}','08:00','12:00',true,'area_owner'),
    ('${ids.secondLocation}',1,1,'${ids.second}','08:00','12:00',true,'area_owner'),
    ('${ids.protectedLocation}',1,1,'${ids.third}','08:00','12:00',true,'area_owner'),
    ('${ids.thirdLocation}',1,1,'${ids.third}','08:00','12:00',true,'area_owner');
  insert into public.daily_schedule_assignments(
    id,service_date,location_group_id,segment_number,assigned_employee_id,owner_type,
    coverage_start,coverage_end,status,load_points,source_type,coverage_purpose
  ) values
    ('${ids.firstAssignment}','${serviceDate}','${ids.firstLocation}',1,'${ids.first}','EMPLOYEE','08:00','12:00','ASSIGNED',1,'coverage_template','area_owner'),
    ('${ids.secondAssignment}','${serviceDate}','${ids.secondLocation}',1,'${ids.first}','EMPLOYEE','08:00','12:00','ASSIGNED',1,'coverage_template_unavailable:auto_reassigned','area_owner'),
    ('${ids.protectedAssignment}','${serviceDate}','${ids.protectedLocation}',1,'${ids.first}','EMPLOYEE','08:00','12:00','ASSIGNED',1,'manager_override','area_owner'),
    ('${ids.thirdAssignment}','${serviceDate}','${ids.thirdLocation}',1,'${ids.first}','EMPLOYEE','08:00','12:00','ASSIGNED',1,'coverage_template_unavailable:auto_reassigned','area_owner');
`);


/* OC24-01 supersedes the old third-absence assignment policy. Keep the same
   concrete assigned/protected work fixture and prove the retired API cannot
   mutate any of it, even if the caller forges plausible contractor capacity. */
for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
 await expectFailure(`set role ${role}; select public.app_apply_coverall_assignment_policy_v2('${payload()}'::jsonb);`,/permission denied/i);
}
await expectFailure(`select public.app_apply_coverall_assignment_policy_v2('${payload()}'::jsonb);`,/CoverAll must be added manually/i);
for(const id of [ids.firstAssignment,ids.secondAssignment,ids.thirdAssignment,ids.protectedAssignment]){
 assert.equal(await sql(`select assigned_employee_id::text from public.daily_schedule_assignments where id='${id}';`),ids.first,'existing assignment preserved '+id);
}
assert.equal(await sql(`select count(*) from public.daily_work_roster where service_date='${serviceDate}' and employee_id='${ids.coverAll1}'::uuid;`),'0','absence formula cannot silently add contractor capacity');
assert.equal(await sql(`select count(*) from public.daily_schedule_assignments where service_date='${serviceDate}' and assigned_employee_id='${ids.coverAll1}'::uuid;`),'0','absence formula cannot move any assignments');
console.log(JSON.stringify({ok:true,policy:'OC24-manual-contractor-only',runtimeRolesDenied:6,ownerRpcRetired:true,existingAssignmentsPreserved:4,noAutomaticCapacity:true}));
