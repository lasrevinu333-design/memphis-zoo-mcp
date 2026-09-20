#!/usr/bin/env node
// Runtime regression proof. Requires one clean, owned, fully migrated local DB.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { buildEventStaticAuthoritySource, eventAuthorityWeekStart, seedCompiledEventAuthority } from "./fixtures/event-static-authority-fixture.mjs";

const container = String(process.env.EVENT_STATIC_AUTHORITY_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.EVENT_STATIC_AUTHORITY_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)
    || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("An owned disposable event-static-authority database is required.");
}
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(statement) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database], {
    input: statement, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  }).trim().split("\n").filter(Boolean).at(-1) || "";
}
const managerId = "00000000-0000-4000-8000-000000000001";
const stamp = randomUUID().replaceAll("-", "").slice(0, 10);
const [serviceDate, weekStart, nextWeek] = sql(`select public.sch_service_date(now())::text||'|'||
  (public.sch_service_date(now())-(extract(isodow from public.sch_service_date(now()))::integer-1))::text||'|'||
  (public.sch_service_date(now())-(extract(isodow from public.sch_service_date(now()))::integer-1)+7)::text;`).split("|");
assert.equal(sql("select count(*) from public.weekly_roster_slots;"), "0", "official exception proof needs a clean authority fixture");
const people = ["Owner", "Backup B", "Backup C", "No work", "CoverAll", "Off day"].map((name, index) => ({
  id: randomUUID(), slotId: randomUUID(), displayName: `Event ${name} ${stamp}`,
  noWork: index > 0, contractorCapacity: index === 4,
  qualifications: index === 3 || index === 5 ? ["no-work"] : ["general"],
  ...(index === 5 ? { status: "unavailable" } : {}),
}));
const [owner, backupB, backupC, noWork, coverall, offDay] = people;
const locationId = randomUUID(), groupId = randomUUID(), venueId = randomUUID(), groupCode = `EG${stamp}`;
sql(`insert into public.locations(id,location_code,location_name,location_type,form_type,active)
  values(${q(locationId)}::uuid,${q(`EL${stamp}`)},'Synthetic event restroom','restroom','restroom',true);
  insert into public.location_groups(id,group_code,group_name,active)
  values(${q(groupId)}::uuid,${q(groupCode)},'Synthetic event family',true);
  insert into public.location_group_memberships(location_id,location_group_id,active)
  values(${q(locationId)}::uuid,${q(groupId)}::uuid,true);
  insert into public.event_venues(id,venue_code,display_name,event_scope,location_group_id,eligible_event_venue,active)
  values(${q(venueId)}::uuid,${q(`EV${stamp}`)},'Synthetic event venue','SINGLE_VENUE',${q(groupId)}::uuid,true,true);
  ${people.map((person, index) => `insert into public.employees(id,employee_code,display_name,active,role)
    values(${q(person.id)}::uuid,${q(`EMP${BigInt(`0x${stamp}`).toString()}${index}`)},${q(person.displayName)},true,'staff');
    insert into public.msg_users(employee_id,display_name,role,is_active)
    values(${q(person.id)}::uuid,${q(person.displayName)},'employee',true);`).join("\n")}
  insert into public.daily_work_roster(service_date,employee_id,shift_start,shift_end,source_type,active)
  values(${q(serviceDate)}::date,${q(owner.id)}::uuid,'04:00','12:00','legacy-shadow',true),
    (${q(nextWeek)}::date,${q(owner.id)}::uuid,'04:00','12:00','legacy-shadow',true);`);
// A single service-day family is sufficient for these event assertions. Keep
// seven-day availability, without turning this into an unrelated equity load test.
const assignments = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  workId: `event-owner-${dayOfWeek}`, dayOfWeek, locationId,
  locationCodeSnapshot: groupCode, locationNameSnapshot: "Synthetic event family",
  includedLocations: [{ locationId, locationNameSnapshot: "Synthetic event restroom" }],
  ownerSlotId: owner.slotId, window: { start: "10:00", end: "10:30" },
  serviceEffortMinutes: 10, serviceEffortProvenance: "event-authority-fixture",
  priority: 1, priorityProvenance: "event-authority-fixture",
  requiredQualifications: ["general"], qualificationProvenance: "event-authority-fixture",
  restrictions: [], restrictionProvenance: "event-authority-fixture",
})).filter((assignment) => assignment.dayOfWeek === new Date(`${serviceDate}T12:00:00Z`).getUTCDay());
const source = buildEventStaticAuthoritySource({ weekStart, employees: people, locationId,
  locationCode: groupCode, locationName: "Synthetic event family", assignments, label: `event-${stamp}` });
const evidenceDirectory = String(process.env.EVENT_STATIC_AUTHORITY_EVIDENCE_DIR || "").trim();
if (evidenceDirectory) {
  assert.ok(isAbsolute(evidenceDirectory));
  writeFileSync(join(evidenceDirectory, `synthetic-compiler-input-${stamp}.json`), `${JSON.stringify(source, null, 2)}\n`, { flag: "wx" });
}
const fixture = await seedCompiledEventAuthority({ sql, container, database, managerId,
  dates: [serviceDate], label: `event-official-${stamp}`, source, mode: "official" });
const checks = [];
function record(name, result, expected) {
  assert.deepEqual(result, expected, name);
  checks.push(name);
  console.log(JSON.stringify({ check: name, ok: true }));
}
function createEvent(date, employeeId, audience = "specific_employees") {
  const id = randomUUID();
  sql(`insert into public.events_app_events(id,event_name,location_group_id,event_date,start_time,end_time,status,event_scope,primary_venue_id,display_location,needs_review,audience_scope,audience_employee_ids)
    values(${q(id)}::uuid,'Synthetic event reminder',${q(groupId)}::uuid,${q(date)}::date,'18:00','19:00','SCHEDULED','SINGLE_VENUE',${q(venueId)}::uuid,'Synthetic',false,${q(audience)},array[${q(employeeId)}::uuid]);`);
  assert.equal(sql(`select location_group_id::text from public.events_app_events where id=${q(id)}::uuid;`), groupId,
    "event normalization must bind the intended actual location family");
  return id;
}
const event = createEvent(serviceDate, owner.id);
const assignedEvent = createEvent(serviceDate, owner.id, "assigned_location");
const noWorkEvent = createEvent(serviceDate, noWork.id);
const offDayEvent = createEvent(serviceDate, offDay.id);
const missingEvent = createEvent(nextWeek, owner.id);
function schedule(eventId, employeeId, kind = "shift_plus_15") {
  return JSON.parse(sql(`select coalesce(json_agg(json_build_object('reminder_date',s.reminder_date,'local_time',to_char(s.scheduled_for at time zone 'America/Chicago','HH24:MI:SS'))),'[]'::json)::text
    from public.events_app_events e cross join lateral public.mz_event_reminder_schedule(e.id,e.revision,${q(employeeId)}::uuid,${q(kind)}) s where e.id=${q(eventId)}::uuid;`));
}
const at = (time) => [{ reminder_date: serviceDate, local_time: time }];
record("current_compiler_shift_overrides_legacy_shadow", schedule(event, owner.id), at("07:15:00"));
const solvedOwners = JSON.parse(sql(`select coalesce(jsonb_agg(distinct assigned_employee_id),'[]'::jsonb)::text
  from public.static_weekly_v6_read_schedule_segments(${q(serviceDate)}::date)
  where location_group_id=${q(groupId)}::uuid and owner_type='EMPLOYEE' and status='ASSIGNED';`));
assert.equal(solvedOwners.length, 1, "assigned-location proof needs one actual compiler-selected canonical owner");
assert.ok(people.some((person) => person.id === solvedOwners[0] && !person.contractorCapacity));
record("assigned_location_uses_current_canonical_owner_without_legacy_owner", schedule(assignedEvent, solvedOwners[0]), at("07:15:00"));
record("working_employee_with_no_selected_work_is_eligible", schedule(noWorkEvent, noWork.id), at("07:15:00"));
record("baseline_off_day_is_not_working", schedule(offDayEvent, offDay.id), []);
record("missing_projection_rejects_attractive_legacy_shadow", schedule(missingEvent, owner.id), []);
record("legacy_guard_remains_enabled", sql(`select count(*) from pg_trigger where tgrelid='public.daily_work_roster'::regclass and tgname='trg_static_weekly_fence_daily_work_roster' and tgenabled='O';`), "1");
sql(`update public.employees set active=false where id=${q(owner.id)}::uuid;`);
record("inactive_employee_is_ineligible", schedule(event, owner.id), []);
sql(`update public.employees set active=true where id=${q(owner.id)}::uuid;`);
const credentialId = randomUUID();
const pushDeviceId = sql(`insert into public.devices(id,device_id,device_name,active,assigned_employee_id)
  values(${q(randomUUID())}::uuid,'KIOSK_10','Synthetic event device',true,${q(owner.id)}::uuid)
  on conflict(device_id) do update set assigned_employee_id=excluded.assigned_employee_id,active=true
  returning id::text;`);
sql(`insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at,metadata_json)
  values(${q(credentialId)}::uuid,${q(pushDeviceId)}::uuid,repeat('e',64),'Synthetic event credential',now(),now()+interval '1 day','{}'::jsonb);
  insert into public.employee_push_registrations(registration_id,device_id,credential_id,employee_id,assignment_epoch,platform,fcm_token,token_hash)
  select ${q(randomUUID())}::uuid,id,${q(credentialId)}::uuid,assigned_employee_id,assignment_epoch,'android',${q(`synthetic-event-token-${stamp}`)},repeat('f',64)
  from public.devices where id=${q(pushDeviceId)}::uuid;`);
const enqueue = () => JSON.parse(sql(`select public.mz_enqueue_employee_event_pushes((${q(serviceDate)}::date+time '00:00') at time zone 'America/Chicago')::text;`));
assert.equal(enqueue().ok, true);
record("enqueue_creates_current_canonical_candidate", sql(`select count(*) from public.event_push_instances
  where event_id=${q(event)}::uuid and device_id=${q(pushDeviceId)}::uuid and notification_kind='shift_plus_15'
    and state='pending' and to_char(scheduled_for at time zone 'America/Chicago','HH24:MI')='07:15';`), "1");
record("enqueue_never_uses_missing_projection_legacy_shadow", sql(`select count(*) from public.event_push_instances
  where event_id=${q(missingEvent)}::uuid and device_id=${q(pushDeviceId)}::uuid;`), "0");

async function accepted(exceptionType, person, options = {}) {
  return fixture.applyException({ serviceDate, exceptionType, reason: `Synthetic accepted ${exceptionType}`,
    payload: { slotId: person.slotId, ...(options.payload || {}) }, ...options });
}
async function reverse(change) {
  assert.match(change.exceptionId, /^[0-9a-f-]{36}$/);
  return fixture.applyException({ serviceDate, exceptionType: "reverse", reason: "Reverse synthetic accepted change",
    reversesExceptionId: change.exceptionId, payload: { reversesExceptionId: change.exceptionId } });
}
const pto = await accepted("pto", owner);
record("accepted_full_pto_is_ineligible", schedule(event, owner.id), []);
assert.equal(enqueue().ok, true);
record("enqueue_cancels_prior_candidate_after_accepted_pto", sql(`select count(*) from public.event_push_instances i
  join public.operational_notification_jobs j on j.source_id=i.instance_id and j.job_type='employee_event_push'
  where i.event_id=${q(event)}::uuid and i.device_id=${q(pushDeviceId)}::uuid
    and i.notification_kind='shift_plus_15' and i.state='cancelled' and j.status='dead';`), "1");
await reverse(pto);
record("reversed_pto_restores_canonical_eligibility", schedule(event, owner.id), at("07:15:00"));
assert.equal(enqueue().ok, true);
record("enqueue_restores_unclaimed_candidate_only_after_canonical_reversal", sql(`select count(*) from public.event_push_instances i
  join public.operational_notification_jobs j on j.source_id=i.instance_id and j.job_type='employee_event_push'
  where i.event_id=${q(event)}::uuid and i.device_id=${q(pushDeviceId)}::uuid
    and i.notification_kind='shift_plus_15' and i.state='pending' and j.status='pending';`), "1");
const full = await accepted("daily_absence", owner);
record("accepted_full_absence_is_ineligible", schedule(event, owner.id), []);
await reverse(full);
const partial = await accepted("partial_absence", owner, { startsAt: "07:00", endsAt: "08:00" });
record("accepted_partial_absence_blocks_fixed_shift_plus_15", schedule(event, owner.id), []);
await reverse(partial);
const latePartial = await accepted("partial_absence", owner, { startsAt: "13:00", endsAt: "14:00" });
record("later_partial_absence_preserves_fixed_candidate", schedule(event, owner.id), at("07:15:00"));
await reverse(latePartial);
const shifted = await accepted("shift_override", owner, { payload: { slotId: owner.slotId, status: "working", shift: { start: "09:00", end: "17:00" } } });
record("accepted_shift_override_moves_only_to_new_shift_plus_15", schedule(event, owner.id), at("09:15:00"));
await reverse(shifted);

// Prove event-day eligibility separately from the reminder-day candidate:
// Neither accepted window alone consumes the full event-day shift; their union
// does. Distinct partial_absence/lunch types respect semantic duplicate guards.
const futureDate = sql(`select (${q(serviceDate)}::date+2)::text;`);
await fixture.recompile(eventAuthorityWeekStart(futureDate));
const futureEvent = createEvent(futureDate, owner.id);
record("separate_event_day_is_working_before_absence_union", schedule(futureEvent, owner.id, "two_days_before"), at("07:15:00"));
const unionA = await accepted("partial_absence", owner, { serviceDate: futureDate, startsAt: "07:00", endsAt: "15:00" });
record("partially_available_event_day_preserves_prior_reminder", schedule(futureEvent, owner.id, "two_days_before"), at("07:15:00"));
await assert.rejects(accepted("lunch", owner, { serviceDate: futureDate, startsAt: "15:00", endsAt: "16:00" }),
  /working_slot_missing_provenance.*nonpositive_productive_capacity/,
  "the real compiler refuses a zero-capacity working day instead of inventing current authority");
record("zero_capacity_exception_union_has_no_current_authority", sql(`select projection_status<>'current'
  from public.static_weekly_v6_schedule_authority_state(${q(futureDate)}::date);`), "t");
record("unpublishable_full_union_fails_closed_for_prior_reminder", schedule(futureEvent, owner.id, "two_days_before"), []);
// The accepted command exists, but its compilation was correctly refused.
// Reverse that exact durable command, never a fabricated exception identity.
const unionB = { exceptionId: sql(`select exception_id::text from public.weekly_schedule_exception_commands e
  where e.publication_id=${q(fixture.publicationId)}::uuid and e.service_date=${q(futureDate)}::date
    and e.exception_type='lunch' and e.payload_json->>'slotId'=${q(owner.slotId)}
    and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id);`) };
for (const change of [unionB, unionA]) {
  assert.match(change.exceptionId, /^[0-9a-f-]{36}$/);
  await fixture.applyException({ serviceDate: futureDate, exceptionType: "reverse", reason: "Reverse synthetic event-day absence union",
    reversesExceptionId: change.exceptionId, payload: { reversesExceptionId: change.exceptionId } });
}

// The first two absent slots own no demand. The third owns the one small
// required family; the registered contractor is its only qualified capacity.
const coverallBatch = await fixture.applyExceptions([
  { serviceDate, exceptionType: "pto", payload: { slotId: backupB.slotId }, reason: "First internal absence" },
  { serviceDate, exceptionType: "daily_absence", payload: { slotId: backupC.slotId }, reason: "Second internal absence" },
  { serviceDate, exceptionType: "pto", payload: { slotId: owner.slotId }, reason: "Third absence needs registered CoverAll" },
  { serviceDate, operation: "cover_all", slotId: coverall.slotId, reason: "Accepted registered contractor capacity" },
]);
record("accepted_coverall_owns_canonical_family", sql(`select count(*) from public.static_weekly_v6_read_schedule_segments(${q(serviceDate)}::date)
  where assigned_employee_id=${q(coverall.id)}::uuid and location_group_id=${q(groupId)}::uuid and status='ASSIGNED';`), "1");
record("assigned_location_excludes_real_coverall_owner", schedule(assignedEvent, coverall.id), []);
await fixture.applyExceptions([...coverallBatch.exceptionIds].reverse().map((exceptionId) => ({
  serviceDate, exceptionType: "reverse", reason: "Reverse synthetic contractor coverage batch",
  reversesExceptionId: exceptionId, payload: { reversesExceptionId: exceptionId },
})));

const revision = () => Number(sql("select current_revision from public.static_weekly_schedule_control where singleton;"));
const cp = (name, args) => JSON.parse(sql(`set role static_weekly_control_plane; select public.${name}(${args})::text;`));
cp("static_weekly_v4_mark_employee_departed", `${q(owner.slotId)}::uuid,'Synthetic departure',${revision()},${q(managerId)}::uuid,${q(`event-depart-${stamp}`)}`);
record("stale_staffing_projection_rejects_legacy_shadow", schedule(event, owner.id), []);
await fixture.recompile(weekStart);
record("departed_employee_is_ineligible_after_recompile", schedule(event, owner.id), []);
const replacement = cp("static_weekly_v4_replace_employee", `${q(owner.slotId)}::uuid,${q(`Event Replacement ${stamp}`)},'Synthetic replacement',${revision()},${q(managerId)}::uuid,${q(`event-replace-${stamp}`)}`);
const replacementId = replacement.data.new_employee_id;
const replacementEvent = createEvent(serviceDate, replacementId);
record("new_incumbent_rejects_old_projection_identity", schedule(replacementEvent, replacementId), []);
await fixture.recompile(weekStart);
record("new_incumbent_is_eligible_only_after_real_recompile", schedule(replacementEvent, replacementId), at("07:15:00"));
record("old_incumbent_never_inherits_replacement_eligibility", schedule(event, owner.id), []);

// Hostile stored-envelope challenges are deliberately separate from the real
// accepted-exception path above. Each appends synthetic rows in a rolled-back
// transaction; no official receipt, projection, or trigger is changed.
const currentProjection = fixture.projectionIds[weekStart];
const currentEnvelope = JSON.parse(sql(`select projection_envelope::text from public.weekly_schedule_compiled_projections where projection_id=${q(currentProjection)}::uuid;`));
function challengeEnvelope(name, mutate) {
  const envelope = structuredClone(currentEnvelope);
  const entries = envelope.authority.projectionAvailability;
  const entry = entries.find((row) => row.serviceDate === serviceDate && row.incumbentPersonId === replacementId);
  assert.ok(entry);
  mutate(entry, envelope);
  const projectionId = randomUUID(), commandId = randomUUID();
  const result = JSON.parse(sql(`begin;
    insert into public.weekly_schedule_compiled_projections
    select (jsonb_populate_record(null::public.weekly_schedule_compiled_projections,to_jsonb(p)||jsonb_build_object(
      'projection_id',${q(projectionId)},'authority_digest',public.static_weekly_digest_jsonb(${q(JSON.stringify(envelope))}::jsonb),
      'projection_envelope',${q(JSON.stringify(envelope))}::jsonb))).*
    from public.weekly_schedule_compiled_projections p where projection_id=${q(currentProjection)}::uuid;
    insert into public.weekly_schedule_command_receipts
    select (jsonb_populate_record(null::public.weekly_schedule_command_receipts,to_jsonb(r)||jsonb_build_object(
      'command_id',${q(commandId)},'idempotency_key',${q(`hostile-${name}-${stamp}`)},
      'response_json',jsonb_build_object('revision',(select max((response_json->>'revision')::bigint)+1 from public.weekly_schedule_command_receipts),
        'data',jsonb_build_object('projection_id',${q(projectionId)}))))).*
    from public.weekly_schedule_command_receipts r where command_type='materialize_projection'
      and response_json#>>'{data,projection_id}'=${q(currentProjection)} limit 1;
    select jsonb_build_object('selected_current',exists(select 1 from public.static_weekly_v6_schedule_authority_state(${q(serviceDate)}::date)
      where projection_status='current' and projection_id=${q(projectionId)}::uuid),
      'reminders',(select count(*) from public.events_app_events e cross join lateral
        public.mz_event_reminder_schedule(e.id,e.revision,${q(replacementId)}::uuid,'shift_plus_15') s
        where e.id=${q(replacementEvent)}::uuid))::text;
    rollback;`));
  record(`hostile_${name}_fails_closed_without_sql_error`, result, { selected_current: true, reminders: 0 });
  assert.equal(sql(`select count(*) from public.weekly_schedule_compiled_projections where projection_id=${q(projectionId)}::uuid;`), "0");
}
for (const [name, mutate] of [
  ["missing_shift", (entry) => { delete entry.shift; }],
  ["invalid_shift_time", (entry) => { entry.shift.start = "not-a-time"; }],
  ["numeric_shift_time", (entry) => { entry.shift.start = 7; }],
  ["null_blocked_windows", (entry) => { entry.blockedWindows = null; }],
  ["malformed_blocked_windows", (entry) => { entry.blockedWindows = [{ start: "07:00", end: "banana" }]; }],
  ["overlapping_absence_full_union", (entry) => { entry.blockedWindows = [{ start: "07:00", end: "13:00" }, { start: "12:00", end: "16:00" }]; }],
  ["duplicate_availability", (entry, envelope) => { envelope.authority.projectionAvailability.push(structuredClone(entry)); }],
  ["wrong_incumbent", (entry) => { entry.incumbentPersonId = owner.id; }],
  ["string_day_of_week", (entry) => { entry.dayOfWeek = String(entry.dayOfWeek); }],
  ["malformed_contractor_flag", (entry, envelope) => { envelope.authority.compilerInput.slots.find((slot) => slot.id === entry.slotId).contractorCapacity = "false"; }],
]) challengeEnvelope(name, mutate);
record("hostile_transactions_preserve_real_current_authority", schedule(replacementEvent, replacementId), at("07:15:00"));

console.log(JSON.stringify({ ok: true, marker: "EVENT_STATIC_AUTHORITY_DATABASE_PASS", checks,
  official_publication_and_exception_path: true, positive_projection_availability_hand_authored: false,
  hostile_envelope_challenges: "explicit synthetic append-and-rollback only",
  source_runtime_changed_by_test: false, legacy_governed_write_bypass: false }, null, 2));
