import assert from 'node:assert/strict';
import {
  STAFFING_COMMAND_REQUEST_SCHEMA,
  createStaffingCommandRequest,
} from '../src/static-weekly-staffing-command.js';

let checks = 0;
const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const rejects = (input, code) => {
  assert.throws(() => createStaffingCommandRequest(input), error => error?.code === code);
  checks++;
};
const base = {
  commandKind: 'absence',
  employeeId: '10000000-0000-4000-8000-000000000001',
  startDate: '2026-09-28',
  endDate: '2026-10-09',
  absenceKind: 'daily_absence',
  clientPrepareKey: '20000000-0000-4000-8000-000000000001',
  expectedRevision: 19,
};
const absence = createStaffingCommandRequest(base);
same(absence.schema, STAFFING_COMMAND_REQUEST_SCHEMA);
same(absence.semanticBody, {
  absenceKind: 'daily_absence',
  commandKind: 'absence',
  employeeId: base.employeeId,
  endDate: base.endDate,
  startDate: base.startDate,
  targetAbsenceId: null,
});
same(absence.clientPrepareKey, base.clientPrepareKey);
same(absence.expectedRevision, 19);
same(absence.window.dates.length, 12);
same(absence.window.weeks, ['2026-09-28', '2026-10-05']);
assert.match(absence.semanticDigest, /^[0-9a-f]{64}$/); checks++;
same(Object.isFrozen(absence) && Object.isFrozen(absence.semanticBody)
  && Object.isFrozen(absence.window) && Object.isFrozen(absence.window.dates), true);
same(createStaffingCommandRequest(structuredClone(base)), absence, 'same semantic request is deterministic');

for (const absenceKind of ['daily_absence', 'pto', 'unavailable']) {
  same(createStaffingCommandRequest({ ...base, absenceKind }).semanticBody.absenceKind, absenceKind);
}
const cancellation = createStaffingCommandRequest({
  ...base,
  commandKind: 'cancel_absence',
  absenceKind: undefined,
  targetAbsenceId: '30000000-0000-4000-8000-000000000001',
},{minimumServiceDate:'2026-09-25'});
same(cancellation.semanticBody, {
  absenceKind: null,
  commandKind: 'cancel_absence',
  employeeId: base.employeeId,
  endDate: base.endDate,
  startDate: base.startDate,
  targetAbsenceId: '30000000-0000-4000-8000-000000000001',
});
assert.notEqual(cancellation.semanticDigest, absence.semanticDigest); checks++;
assert.throws(()=>createStaffingCommandRequest({...base,commandKind:'cancel_absence',absenceKind:undefined,
 targetAbsenceId:'30000000-0000-4000-8000-000000000001',startDate:'2026-09-24'},
 {minimumServiceDate:'2026-09-25'}),error=>error?.code==='staffing_cancellation_cannot_rewrite_elapsed_service_date');checks++;
same(createStaffingCommandRequest({...base,commandKind:'cancel_absence',absenceKind:undefined,
 targetAbsenceId:'30000000-0000-4000-8000-000000000001',startDate:'2026-09-24'},
 {minimumServiceDate:'2026-09-25',allowElapsedAuthorityReplay:true}).semanticBody.startDate,'2026-09-24',
 'authenticated authority may canonicalize an elapsed byte-identical replay so PostgreSQL can resolve its prepare key first');

for (const field of Object.keys(base)) {
  rejects({ ...base, [field]: undefined }, `staffing_${field.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)}_required`);
}
for (const bad of ['', '10000000-0000-4000-8000-00000000001',
  '10000000-0000-4000-8000-00000000000G', ' 10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001 ']) {
  rejects({ ...base, employeeId: bad }, 'staffing_employee_id_required');
  rejects({ ...base, clientPrepareKey: bad }, 'staffing_client_prepare_key_required');
}
for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '19', null, NaN]) {
  rejects({ ...base, expectedRevision: bad }, 'staffing_expected_revision_required');
}
for (const bad of ['absence ', 'ABSENCE', 'cancel', '', null, 1]) {
  rejects({ ...base, commandKind: bad }, 'staffing_command_kind_required');
}
for (const bad of ['sick', 'vacation', '', null, 1, ' daily_absence']) {
  rejects({ ...base, absenceKind: bad }, 'staffing_absence_kind_required');
}
rejects({ ...base, targetAbsenceId: '30000000-0000-4000-8000-000000000001' }, 'staffing_target_absence_forbidden');
rejects({ ...base, commandKind: 'cancel_absence', absenceKind: undefined }, 'staffing_target_absence_id_required');
rejects({ ...base, commandKind: 'cancel_absence', absenceKind: 'pto', targetAbsenceId: '30000000-0000-4000-8000-000000000001' }, 'staffing_absence_kind_forbidden');
rejects({ ...base, commandKind: 'cancel_absence', absenceKind: undefined, targetAbsenceId: 'not-a-uuid' }, 'staffing_target_absence_id_required');
rejects({ ...base, unexpected: true }, 'staffing_command_unknown_field');
rejects({ ...base, managerId: '40000000-0000-4000-8000-000000000001' }, 'staffing_command_unknown_field');
rejects({ ...base, reason: 'medical detail' }, 'staffing_command_unknown_field');
rejects({ ...base, startDate: '2026-10-09', endDate: '2026-09-28' }, 'staffing_reversed_window');
rejects({ ...base, startDate: '2026-01-01', endDate: '2027-01-02' }, 'staffing_date_limit');
assert.equal(JSON.stringify(base).includes('reason'), false, 'private leave reasons are not accepted input'); checks++;
console.log(JSON.stringify({ status: 'PASS', checks,
  scope: 'pure canonical staffing request; no auth, preview, compile, SQL, acceptance, delivery or phone proof' }));
