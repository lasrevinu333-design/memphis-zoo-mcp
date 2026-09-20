// Disposable database fixtures, never a production authority admission path.
// Both modes compile real input and persist unmodified adapter envelopes.
// synthetic_append_only is explicitly limited to the predecessor shared-suite
// fixture: it adds rows under the same transaction-local INSERT guard used by
// static-weekly-operational-truth-database-tests, without resetting its state.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { compileStaticWeeklySchedule, postgresJsonbContentDigest as digest } from "../../src/static-weekly-schedule-compiler.js";
import { createStaticWeeklyDraftRpcInput, createStaticWeeklyProjectionRpcInput } from "../../src/static-weekly-schedule-database-adapter.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const q = (value) => value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const j = (value) => `${q(JSON.stringify(value))}::jsonb`;
const uuid = (value) => assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const date = (value) => {
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10), value);
  return value;
};
export function eventAuthorityWeekStart(value) {
  const day = new Date(`${date(value)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
const addDays = (value, days) => new Date(Date.parse(`${date(value)}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Input facts only. projectionAvailability is always produced by the compiler. */
export function buildEventStaticAuthoritySource({ weekStart, employees, locationId, locationCode = "EVENT_FIXTURE", locationName = "Event fixture area", assignments, proximity = [], exceptions = [], label = "event-fixture" }) {
  assert.equal(eventAuthorityWeekStart(weekStart), weekStart);
  uuid(locationId);
  assert.ok(Array.isArray(employees) && employees.length > 0 && employees.length <= 16);
  const people = employees.map((employee) => ({ ...employee, slotId: employee.slotId || randomUUID() }));
  for (const employee of people) { uuid(employee.id); uuid(employee.slotId); assert.ok(employee.displayName); }
  const availability = (employee, dayOfWeek) => ({
    slotId: employee.slotId, dayOfWeek, status: employee.status || "working",
    shift: employee.shift || { start: "07:00", end: "16:00" },
    productiveCapacityProvenance: `${label}-shift`, maxServiceEffortMinutes: 300,
    maxServiceEffortProvenance: `${label}-capacity`, qualifications: clone(employee.qualifications || ["general"]),
    qualificationProvenance: `${label}-qualification`, restrictions: [],
    restrictionProvenance: `${label}-restrictions`, acceptedRouteAnchorLocationId: locationId,
    acceptedRouteProvenance: `${label}-route`,
  });
  return {
    serviceDate: weekStart, timezone: "America/Chicago", exceptions: clone(exceptions), proximity: clone(proximity),
    slots: people.map((employee) => ({
      id: employee.slotId, label: employee.displayName,
      incumbencies: clone(employee.incumbencies || [{ personId: employee.id, displayName: employee.displayName, effectiveStart: "2020-01-01", effectiveEnd: null }]),
      ...(employee.contractorCapacity ? { contractorCapacity: true, contractorAvailability: Array.from({ length: 7 }, (_, dayOfWeek) => {
        const { slotId: ignored, ...template } = availability(employee, dayOfWeek);
        return template;
      }) } : {}),
    })),
    versions: [{
      id: randomUUID(), publicationId: randomUUID(), status: "published", effectiveStart: weekStart, effectiveEnd: null,
      objective: { requireVerifiedProximity: true },
      namedAbsentSlotIds: people.filter((employee) => employee.status === "departed_named_absent").map((employee) => employee.slotId),
      // Inactive recurring rows have no shift or working capacity. The draft
      // adapter deliberately nulls those columns, and the authority validator
      // requires exact agreement with the compiler's dated availability.
      // This is the same source shape as the day-changes database fixture.
      slotAvailability: Array.from({ length: 7 }, (_, dayOfWeek) => people.map((employee) => employee.contractorCapacity || employee.status === "unavailable"
        ? { slotId: employee.slotId, dayOfWeek, status: "unavailable" } : availability(employee, dayOfWeek))).flat(),
      assignments: assignments == null ? Array.from({ length: 7 }, (_, dayOfWeek) => people.filter((employee) => !employee.contractorCapacity && !employee.noWork).map((employee, index) => ({
        workId: `${label}-${dayOfWeek}-${index}`, dayOfWeek, locationId, locationCodeSnapshot: locationCode,
        locationNameSnapshot: locationName, includedLocations: [{ locationId, locationNameSnapshot: locationName }],
        window: { start: "08:00", end: "08:15" }, ownerSlotId: employee.slotId,
        serviceEffortMinutes: 5, serviceEffortProvenance: `${label}-effort`, priority: 1,
        priorityProvenance: `${label}-priority`, requiredQualifications: ["general"],
        qualificationProvenance: `${label}-work-qualification`, restrictions: [], restrictionProvenance: `${label}-work-restrictions`,
      }))).flat() : clone(assignments),
    }],
  };
}

function insertRows(table, rows, { conflict = "" } = {}) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  assert.ok(columns.every((column) => /^[a-z_]+$/.test(column)));
  return `insert into public.${table}(${columns.join(",")}) select ${columns.map((column) => `r.${column}`).join(",")} from jsonb_populate_recordset(null::public.${table},${j(rows)}) r ${conflict};`;
}

export async function seedCompiledEventAuthority({ sql, container, database = "postgres", managerId, employeeId, dates, label = "event-static-authority", source: suppliedSource, mode = "official" }) {
  assert.match(container || "", /^mz_schema_rebuild_[a-zA-Z0-9_]+$/);
  assert.match(database, /^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/);
  assert.ok(["official", "synthetic_append_only"].includes(mode));
  assert.equal(typeof sql, "function"); uuid(managerId);
  assert.ok(Array.isArray(dates) && dates.length > 0 && dates.length <= 31);
  const weeks = [...new Set(dates.map(eventAuthorityWeekStart))].sort();
  const query = async (statement) => String(await sql(statement)).trim().split("\n").at(-1);
  const jsonQuery = async (statement) => JSON.parse(await query(statement));
  const cp = async (name, args) => jsonQuery(`set role static_weekly_control_plane; select public.${name}(${args})::text;`);
  const release = async (name, args) => jsonQuery(`set role static_weekly_release_operator; select public.${name}(${args})::text;`);
  const managerName = await query(`select display_name from public.ops_manager_managers where manager_id=${q(managerId)}::uuid and active and not is_system_principal;`);
  assert.ok(managerName, "fixture needs an active named manager");
  let source = suppliedSource && clone(suppliedSource);
  if (!source) {
    uuid(employeeId);
    const employeeName = await query(`select display_name from public.employees where id=${q(employeeId)}::uuid and active;`);
    const place = await jsonQuery(`select jsonb_build_object('locationId',location.id,'locationCode',family.group_code,'locationName',family.group_name)::text
      from public.locations location join public.location_group_memberships membership on membership.location_id=location.id and membership.active
      join public.location_groups family on family.id=membership.location_group_id and family.active
      where location.active order by family.id,location.id limit 1;`);
    assert.ok(employeeName);
    assert.ok(place?.locationId, "fixture needs a real physical location mapped to an active group");
    source = buildEventStaticAuthoritySource({ weekStart: weeks[0], employees: [{ id: employeeId, displayName: employeeName }], ...place, label });
  }
  assert.equal(source.serviceDate, weeks[0], "source must begin at the earliest requested Monday");
  assert.equal(source.exceptions?.length || 0, 0, "seed baseline first; accept dated exceptions through applyException");
  const actor = { managerId, managerName, idempotencyKey: `${label}-${randomUUID()}` };
  const compile = async (input) => {
    const result = await compileStaticWeeklySchedule(input);
    assert.equal(result.status, "FEASIBLE", JSON.stringify(result.fatal || result.reviewWork));
    assert.equal(result.verifier?.ok, true);
    assert.equal(result.publicationAuthority, "ACCEPTABLE");
    assert.ok(result.canonicalAuthority.projectionAvailability.length > 0);
    return result;
  };
  const compiledByWeek = {}, envelopes = {}, projectionIds = {}, publicationsByWeek = {};
  const compiledByProjection = new Map();
  const slotIds = source.slots.map((slot) => slot.id);
  const employeeIds = [...new Set(source.slots.flatMap((slot) => slot.incumbencies.map((incumbent) => incumbent.personId)))];
  const result = { mode, source, slotIds, employeeIds, compiledByWeek, envelopes, projectionIds, publicationsByWeek };
  const revision = async () => Number(await query("select current_revision from public.static_weekly_schedule_control where singleton;"));

  if (mode === "official") {
    const state = await jsonQuery("select jsonb_build_object('control',(select current_revision from public.static_weekly_schedule_control where singleton),'ledger',(select coalesce(max(authority_revision),0) from public.weekly_schedule_authority_revisions),'published',(select count(*) from public.weekly_schedule_versions where lifecycle_state='published'),'slots',(select count(*) from public.weekly_roster_slots))::text;");
    assert.equal(state.control, state.ledger, "official fixture refuses a hand-seeded authority/control mismatch");
    assert.equal(state.published, 0, "official fixture requires an ungoverned disposable database");
    assert.equal(state.slots, 0, "official fixture requires an uninitialized disposable roster");
    const baseline = await compile(source);
    const health = await release("static_weekly_v3_authority_health", "");
    if (health.active_key_count === 0) await release("static_weekly_v3_configure_initial_authority_key", `${q("static-weekly-authority-hmac-v2")},${q(`disposable-fixture-${randomUUID()}-never-production`)},${q(label)}`);
    else assert.equal(health.ready, true);
    const sourceId = randomUUID();
    await release("static_weekly_v3_register_authority_source", `${q(sourceId)}::uuid,${j(baseline.canonicalAuthority.compilerInput)},${q(label)}`);
    await release("static_weekly_v6_initialize_registered_roster", `${q(sourceId)}::uuid,${q(managerId)}::uuid,${q(label)}`);
    const draft = createStaticWeeklyDraftRpcInput({ result: baseline, expectedRevision: await revision(), actor });
    const created = await cp("static_weekly_v3_create_draft", `${q(draft.effectiveStart)}::date,${q(draft.objectiveVersion)},${j(draft.objective)},${j(draft.inputProvenance)},${j(draft.document)},${draft.expectedRevision},${q(managerId)}::uuid,${q(actor.idempotencyKey)},${q(sourceId)}::uuid`);
    const published = await cp("static_weekly_v3_publish_draft", `${q(created.data.version_id)}::uuid,1,${created.revision},${q(managerId)}::uuid,${q(`${actor.idempotencyKey}-publish`)},'publish',null`);
    result.sourceId = sourceId; result.versionId = published.data.version_id; result.publicationId = published.data.publication_id;
    result.recompile = async (weekStart) => {
      assert.equal(eventAuthorityWeekStart(weekStart), weekStart);
      const current = await jsonQuery(`select row_to_json(s)::text from public.static_weekly_v6_schedule_authority_state(${q(weekStart)}::date) s;`);
      if (current.projection_status === "current" && compiledByProjection.has(current.projection_id)) {
        const previous = compiledByProjection.get(current.projection_id);
        compiledByWeek[weekStart] = previous.compiled; envelopes[weekStart] = previous.envelope; projectionIds[weekStart] = current.projection_id;
        return { replayed: true, ...previous, data: { projection_id: current.projection_id } };
      }
      const payload = await cp("static_weekly_v3_read_publication_source", `${q(result.publicationId)}::uuid,${q(weekStart)}::date`);
      const { version, ...input } = payload.compiler_input;
      const compiled = await compile({ ...input, serviceDate: weekStart, versions: [version], exceptions: payload.exceptions });
      const p = createStaticWeeklyProjectionRpcInput({ result: compiled, publicationId: result.publicationId, expectedRevision: await revision(), actor: { ...actor, idempotencyKey: `${label}-${randomUUID()}` } });
      const materialized = await cp("static_weekly_v3_materialize_projection", `${q(p.publicationId)}::uuid,${q(p.serviceDate)}::date,${q(p.exceptionSetDigest)},${q(p.compilerVersion)},${j(p.objective)},${j(p.metrics)},${q(p.replayDigest)},${j(p.envelope)},${p.expectedRevision},${q(managerId)}::uuid,${q(p.idempotencyKey)}`);
      compiledByWeek[weekStart] = compiled; envelopes[weekStart] = p.envelope; projectionIds[weekStart] = materialized.data.projection_id; publicationsByWeek[weekStart] = result.publicationId;
      compiledByProjection.set(materialized.data.projection_id, { compiled, envelope: p.envelope });
      return { ...materialized, compiled, envelope: p.envelope };
    };
    result.materialize = result.recompile;
    result.applyExceptions = async (operations) => {
      assert.ok(Array.isArray(operations) && operations.length > 0 && operations.length <= 25);
      const targetWeeks = [...new Set(operations.map((operation) => eventAuthorityWeekStart(operation.serviceDate)))];
      assert.equal(targetWeeks.length, 1, "accepted fixture batch must stay within one projection week");
      const initialRevision = await revision();
      const commands = [];
      for (const [index, operation] of operations.entries()) {
        const { serviceDate, startsAt = null, endsAt = null, reason = "Disposable event authority fixture", reversesExceptionId = null } = operation;
        date(serviceDate);
        let { exceptionType, payload } = operation;
        if (operation.operation === "cover_all") {
          exceptionType = "cover_all";
          const registered = await cp("static_weekly_v3_read_publication_source", `${q(result.publicationId)}::uuid,${q(serviceDate)}::date`);
          const slot = registered.compiler_input.slots.find((entry) => entry.id === operation.slotId && entry.contractorCapacity === true);
          const template = slot?.contractorAvailability?.find((entry) => entry.dayOfWeek === new Date(`${serviceDate}T00:00:00Z`).getUTCDay());
          assert.ok(template, "CoverAll must use the registered dated contractor template");
          payload = { availability: Object.fromEntries(["productiveCapacityProvenance", "maxServiceEffortMinutes", "maxServiceEffortProvenance", "qualifications", "qualificationProvenance", "restrictions", "restrictionProvenance", "acceptedRouteAnchorLocationId", "acceptedRouteProvenance"].map((field) => [field, clone(template[field])])) };
          payload.availability.slotId = operation.slotId;
          payload.availability.shift = clone(operation.shift || template.shift);
        }
        const expected = index === 0 ? String(initialRevision) : `(select (response->>'revision')::bigint from mutation_${index - 1})`;
        commands.push(`mutation_${index} as materialized (select public.static_weekly_v3_apply_exception(${q(exceptionType)},${q(serviceDate)}::date,${q(startsAt)}::time,${q(endsAt)}::time,${q(result.versionId)}::uuid,${q(result.publicationId)}::uuid,${q(reason)},${j(payload)},${expected},${q(managerId)}::uuid,${q(`${label}-${randomUUID()}`)},${q(reversesExceptionId)}::uuid) as response)`);
      }
      // One SQL statement accepts the complete group. The real compiler then
      // reads only database-accepted exceptions; no client exception IDs or
      // hand-authored projectionAvailability are substituted.
      const responses = await jsonQuery(`set role static_weekly_control_plane; with ${commands.join(",")} select jsonb_build_array(${commands.map((_, index) => `(select response from mutation_${index})`).join(",")})::text;`);
      const projection = await result.recompile(targetWeeks[0]);
      return { responses, exceptionIds: responses.map((response) => response.data.exception_id), compiled: projection.compiled, projection };
    };
    result.applyException = async (operation) => {
      const batch = await result.applyExceptions([operation]);
      return { exceptionId: batch.exceptionIds[0], response: batch.responses[0], mutation: batch.responses[0], compiled: batch.compiled, projection: batch.projection };
    };
    result.markEmployeeDeparted = async ({ slotId, reason = "Disposable departure fixture", weekStart = weeks[0] }) => {
      const response = await cp("static_weekly_v4_mark_employee_departed", `${q(slotId)}::uuid,${q(reason)},${await revision()},${q(managerId)}::uuid,${q(`${label}-${randomUUID()}`)}`);
      const projection = await result.recompile(weekStart);
      return { response, compiled: projection.compiled, projection };
    };
    result.replaceEmployee = async ({ slotId, newEmployeeName, reason = "Disposable replacement fixture", weekStart = weeks[0] }) => {
      const response = await cp("static_weekly_v4_replace_employee", `${q(slotId)}::uuid,${q(newEmployeeName)},${q(reason)},${await revision()},${q(managerId)}::uuid,${q(`${label}-${randomUUID()}`)}`);
      const projection = await result.recompile(weekStart);
      return { response, compiled: projection.compiled, projection };
    };
    for (const week of weeks) await result.recompile(week);
  } else {
    // Reuse the predecessor's publication on already governed weeks, preserving
    // its immutable document/history. Add this fixture's own slots and genuine
    // compiled projection; it is not a control-plane admission proof.
    await query(`begin; ${insertRows("weekly_roster_slots", source.slots.map((slot) => ({ slot_id: slot.id, slot_code: `EVENT_${slot.id.replaceAll("-", "")}`, slot_label: slot.label, created_by_manager_id: managerId, created_by_manager_name_snapshot: managerName, content_digest: digest(slot) })))} ${insertRows("weekly_roster_slot_incumbencies", source.slots.flatMap((slot) => slot.incumbencies.map((incumbent) => ({ slot_id: slot.id, person_id: incumbent.personId, person_name_snapshot: incumbent.displayName, effective_start: incumbent.effectiveStart, effective_end: incumbent.effectiveEnd, created_by_manager_id: managerId, created_by_manager_name_snapshot: managerName, content_digest: digest(incumbent) }))))} commit;`);
    for (const week of weeks) {
      let publication = await jsonQuery(`select coalesce((select jsonb_build_object('publicationId',p.publication_id,'versionId',p.version_id,'effectiveStart',v.effective_start) from public.weekly_schedule_publications p join public.weekly_schedule_versions v using(version_id) where v.version_id=public.static_weekly_effective_version(${q(week)}::date)),'null'::jsonb)::text;`);
      const isNew = publication === null;
      publication ||= { publicationId: randomUUID(), versionId: randomUUID(), effectiveStart: week };
      if (!isNew) assert.equal(await query(`select public.static_weekly_accepted_exception_set(${q(publication.publicationId)}::uuid,${q(week)}::date)::text;`), "[]", "shared synthetic fixture must not replace accepted exception authority");
      const input = clone(source);
      input.serviceDate = week;
      Object.assign(input.versions[0], { id: publication.versionId, publicationId: publication.publicationId, effectiveStart: publication.effectiveStart });
      const compiled = await compile(input);
      const baseRevision = Number(await query("select greatest(coalesce((select max(authority_revision) from public.weekly_schedule_authority_revisions),0),coalesce((select max((response_json->>'revision')::bigint) from public.weekly_schedule_command_receipts),0))+100;"));
      const draft = createStaticWeeklyDraftRpcInput({ result: compiled, expectedRevision: baseRevision, actor });
      const p = createStaticWeeklyProjectionRpcInput({ result: compiled, publicationId: publication.publicationId, expectedRevision: baseRevision, actor });
      const projectionId = randomUUID();
      const document = draft.document;
      let setup = "";
      if (isNew) {
        setup += insertRows("weekly_schedule_authority_revisions", [{ authority_revision: baseRevision, command_id: randomUUID(), operation: "publish", actor_manager_id: managerId, actor_manager_name_snapshot: managerName, content_digest: digest(document) }]);
        setup += insertRows("weekly_schedule_versions", [{ version_id: publication.versionId, version_number: baseRevision, lifecycle_state: "published", publication_kind: "publish", effective_start: week, revision: 1, objective_version: draft.objectiveVersion, objective_json: draft.objective, input_provenance_json: draft.inputProvenance, draft_document: document, content_digest: digest(document), created_by_manager_id: managerId, created_by_manager_name_snapshot: managerName, published_by_manager_id: managerId, published_by_manager_name_snapshot: managerName, published_at: new Date().toISOString() }]);
        setup += insertRows("weekly_schedule_publications", [{ publication_id: publication.publicationId, version_id: publication.versionId, authority_revision: baseRevision, publication_kind: "publish", effective_start: week, expected_revision: baseRevision - 1, idempotency_key: `${label}-${randomUUID()}`, actor_manager_id: managerId, actor_manager_name_snapshot: managerName, request_digest: digest(document), replay_digest: compiled.replayDigest, content_digest: digest(document), output_digest: digest(document) }]);
        // A reminder week can precede the predecessor's governed current week.
        // Close only our newly inserted fixture range at that existing boundary.
        setup += `insert into public.weekly_schedule_effective_range_closures(closed_version_id,closed_at_effective_date,superseding_version_id,publication_id,created_by_manager_id,created_by_manager_name_snapshot,content_digest) select ${q(publication.versionId)}::uuid,v.effective_start,v.version_id,p.publication_id,${q(managerId)}::uuid,${q(managerName)},${q(digest(document))} from public.weekly_schedule_versions v join public.weekly_schedule_publications p using(version_id) where v.lifecycle_state='published' and v.effective_start>${q(week)}::date order by v.effective_start limit 1;`;
      }
      setup += insertRows("weekly_schedule_slot_availability", document.slot_availability.map((row) => ({ ...row, version_id: publication.versionId, content_digest: digest(row) })), { conflict: "on conflict(version_id,slot_id,day_of_week) do nothing" });
      setup += insertRows("weekly_schedule_slot_assignments", document.assignments.map((row) => ({ ...row, version_id: publication.versionId, authority_facts_json: row.payload_json.authority_facts, content_digest: digest(row) })), { conflict: "on conflict(version_id,day_of_week,work_id) do nothing" });
      const commandId = randomUUID();
      setup += insertRows("weekly_schedule_authority_revisions", [{ authority_revision: baseRevision + 1, command_id: commandId, operation: "materialize_projection", actor_manager_id: managerId, actor_manager_name_snapshot: managerName, content_digest: digest(p.envelope) }]);
      setup += `insert into public.weekly_schedule_compiled_projections(projection_id,publication_id,version_id,week_start,week_end,exception_set_json,exception_set_digest,compiler_version,objective_json,metrics_json,replay_digest,authority_digest,receipt_json,projection_envelope,compiled_by_manager_id) values(${q(projectionId)}::uuid,${q(publication.publicationId)}::uuid,${q(publication.versionId)}::uuid,${q(week)}::date,${q(addDays(week,6))}::date,public.static_weekly_accepted_exception_set(${q(publication.publicationId)}::uuid,${q(week)}::date),${q(p.exceptionSetDigest)},${q(p.compilerVersion)},${j(p.objective)},${j(p.metrics)},${q(p.replayDigest)},${q(compiled.authorityDigest)},${j(p.envelope.receipt)},${j(p.envelope)},${q(managerId)}::uuid);`;
      const occurrences = p.envelope.assignments.map((assignment) => {
        const work = assignment.work_snapshot;
        const owner = compiled.canonicalAuthority.projectionAvailability.find((availability) => availability.slotId === assignment.owner_slot_id && availability.serviceDate === assignment.service_date);
        return { occurrence_id: randomUUID(), projection_id: projectionId, publication_id: publication.publicationId, version_id: publication.versionId, service_date: assignment.service_date, work_id: assignment.work_id, day_of_week: assignment.day_of_week, location_id: work.locationId, location_code_snapshot: work.locationCodeSnapshot || work.locationId, location_name_snapshot: work.locationNameSnapshot || work.locationId, coverage_start: work.window.start, coverage_end: work.window.end, owner_slot_id: assignment.owner_slot_id, owner_slot_label_snapshot: owner?.incumbentSlotLabel ?? null, owner_person_id_snapshot: assignment.owner_person_id, owner_name_snapshot: owner?.incumbentName ?? null, state: assignment.status === "assigned" ? "created" : assignment.status, state_reason: assignment.reason_code, original_actor_person_id: assignment.original_actor_person_id, original_actor_name_snapshot: assignment.original_actor_name, authority_facts_json: { ...assignment, work_snapshot: work }, occurrence_digest: digest(assignment) };
      });
      setup += insertRows("weekly_schedule_occurrences", occurrences);
      setup += insertRows("weekly_schedule_projection_assignments", occurrences.map((occurrence, index) => ({ projection_id: projectionId, occurrence_id: occurrence.occurrence_id, work_id: occurrence.work_id, status: p.envelope.assignments[index].status, reason_code: occurrence.state_reason, owner_slot_id: occurrence.owner_slot_id, owner_slot_label_snapshot: occurrence.owner_slot_label_snapshot, owner_person_id_snapshot: occurrence.owner_person_id_snapshot, owner_name_snapshot: occurrence.owner_name_snapshot, authority_facts_json: occurrence.authority_facts_json, explanation_json: p.envelope.assignments[index].explanation, content_digest: occurrence.occurrence_digest })));
      setup += insertRows("weekly_schedule_command_receipts", [{ command_id: commandId, actor_manager_id: managerId, actor_manager_name_snapshot: managerName, command_type: "materialize_projection", idempotency_key: `${label}-${randomUUID()}`, expected_revision: baseRevision, request_digest: digest(p.envelope), request_canonical_json: p.envelope, response_json: { revision: baseRevision + 1, data: { projection_id: projectionId } }, response_digest: digest(p.envelope), content_digest: digest(p.envelope) }]);
      await query(`begin; select set_config('app.static_weekly_publish_write','on',true); ${setup} commit;`);
      assert.equal(await query(`select (projection_envelope=${j(p.envelope)})::text from public.weekly_schedule_compiled_projections where projection_id=${q(projectionId)}::uuid;`), "true", "fixture must persist the exact compiler/adapter envelope");
      for (const requestedDate of dates.filter((day) => eventAuthorityWeekStart(day) === week)) {
        assert.equal(await query(`select projection_status||'|'||projection_id::text from public.static_weekly_v6_schedule_authority_state(${q(requestedDate)}::date);`), `current|${projectionId}`);
        const currentPeople = [...new Set(compiled.canonicalAuthority.projectionAvailability.filter((row) => row.serviceDate === requestedDate && row.incumbentPersonId).map((row) => row.incumbentPersonId))];
        for (const employee of currentPeople) assert.equal(await query(`select count(*) from public.static_weekly_v6_read_roster(${q(requestedDate)}::date) where employee_id=${q(employee)}::uuid;`), "1", "compiled fixture identity must resolve through the current roster");
      }
      compiledByWeek[week] = compiled; envelopes[week] = p.envelope; projectionIds[week] = projectionId; publicationsByWeek[week] = publication.publicationId;
      result.versionId = publication.versionId; result.publicationId = publication.publicationId;
    }
  }
  return result;
}
