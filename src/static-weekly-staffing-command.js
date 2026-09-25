/*
 * Canonical, authority-neutral request boundary for staffing preparation.
 * This module does not authenticate a manager, compile or persist a plan,
 * publish a schedule, notify a phone, or mark any operation accepted.
 */
import { createHash } from 'node:crypto';
import { canonicalJson, isIsoServiceDate } from './static-weekly-schedule-model.js';
import { enumerateStaffingServiceWindow } from './static-weekly-staffing-preparation.js';

export const STAFFING_COMMAND_REQUEST_SCHEMA =
  'memphis-zoo.static-weekly-staffing-command-request.v1';

const ALLOWED_FIELDS = new Set([
  'commandKind',
  'employeeId',
  'startDate',
  'endDate',
  'absenceKind',
  'targetAbsenceId',
  'clientPrepareKey',
  'expectedRevision',
]);
const COMMAND_KINDS = new Set(['absence', 'cancel_absence']);
const ABSENCE_KINDS = new Set(['daily_absence', 'pto', 'unavailable']);
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const failure = code => Object.assign(new Error(code), { code });

function requireCanonicalUuid(value, code) {
  if (typeof value !== 'string' || !CANONICAL_UUID.test(value)) throw failure(code);
  return value;
}

function requireServiceDate(value, code) {
  if (typeof value !== 'string' || !isIsoServiceDate(value) || value.startsWith('0000-')) {
    throw failure(code);
  }
  return value;
}

export function createStaffingCommandRequest(input,{minimumServiceDate=null,allowElapsedAuthorityReplay=false}={}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw failure('staffing_command_request_required');
  }
  for (const field of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(field)) throw failure('staffing_command_unknown_field');
  }

  const { commandKind } = input;
  if (!COMMAND_KINDS.has(commandKind)) throw failure('staffing_command_kind_required');
  const employeeId = requireCanonicalUuid(input.employeeId, 'staffing_employee_id_required');
  const startDate = requireServiceDate(input.startDate, 'staffing_start_date_required');
  const endDate = requireServiceDate(input.endDate, 'staffing_end_date_required');
  const clientPrepareKey = requireCanonicalUuid(
    input.clientPrepareKey,
    'staffing_client_prepare_key_required',
  );
  const { expectedRevision } = input;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw failure('staffing_expected_revision_required');
  }

  let absenceKind = null;
  let targetAbsenceId = null;
  if (commandKind === 'absence') {
    if (!ABSENCE_KINDS.has(input.absenceKind)) throw failure('staffing_absence_kind_required');
    if (input.targetAbsenceId !== undefined) throw failure('staffing_target_absence_forbidden');
    absenceKind = input.absenceKind;
  } else {
    if (input.absenceKind !== undefined) throw failure('staffing_absence_kind_forbidden');
    targetAbsenceId = requireCanonicalUuid(
      input.targetAbsenceId,
      'staffing_target_absence_id_required',
    );
    const minimum=requireServiceDate(minimumServiceDate,'staffing_current_service_date_required');
    if(startDate<minimum&&!allowElapsedAuthorityReplay)throw failure('staffing_cancellation_cannot_rewrite_elapsed_service_date');
  }

  const window = enumerateStaffingServiceWindow(startDate, endDate);
  const semanticBody = Object.freeze({
    absenceKind,
    commandKind,
    employeeId,
    endDate,
    startDate,
    targetAbsenceId,
  });
  const semanticDigest = createHash('sha256').update(canonicalJson(semanticBody)).digest('hex');
  return Object.freeze({
    schema: STAFFING_COMMAND_REQUEST_SCHEMA,
    semanticBody,
    semanticDigest,
    clientPrepareKey,
    expectedRevision,
    window,
  });
}
