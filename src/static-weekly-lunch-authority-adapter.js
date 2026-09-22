import { postgresJsonbContentDigest } from './static-weekly-schedule-compiler.js';
import {
  createStaticWeeklyLunchCoverageCandidate,
  verifyStaticWeeklyLunchCoverageCandidate,
} from './static-weekly-lunch-coverage.js';

export const STATIC_WEEKLY_LUNCH_AUTHORITY_SCHEMA = 'memphis-zoo.static-weekly-lunch-authority-document.v1';
const clone = value => structuredClone(value);
const text = value => typeof value === 'string' ? value : '';
const array = value => Array.isArray(value) ? value : [];
const fail = (code, detail = {}) => {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, detail);
  throw error;
};

function ensureUnique(rows, key, code) {
  const seen = new Set();
  for (const row of rows) {
    const value = text(row?.[key]);
    if (!value || seen.has(value)) fail(code, { [key]: value || null });
    seen.add(value);
  }
}

function normalizedLoan(loan) {
  return {
    loan_id: loan.loanId,
    service_date: loan.serviceDate,
    day_of_week: loan.dayOfWeek,
    normal_owner_slot_id: loan.normalOwnerSlotId,
    normal_owner_person_id: loan.normalOwnerPersonId,
    coverage_start: loan.window?.start ?? null,
    coverage_end: loan.window?.end ?? null,
    status: loan.status,
    reason: loan.reason ?? null,
    helper_slot_ids: clone(loan.helperSlotIds || []),
    fallback: loan.fallback ?? null,
    total_distance_minutes: loan.totalDistance ?? null,
  };
}
function normalizedResponsibility(loan, row) {
  return {
    responsibility_id: row.responsibilityId,
    loan_id: loan.loanId,
    service_date: loan.serviceDate,
    day_of_week: loan.dayOfWeek,
    normal_owner_slot_id: row.normalOwnerSlotId,
    normal_owner_person_id: row.normalOwnerPersonId,
    coverer_slot_id: row.covererSlotId,
    coverer_person_id: row.covererPersonId,
    coverage_purpose: row.coveragePurpose,
    coverage_start: loan.window?.start ?? null,
    coverage_end: loan.window?.end ?? null,
    check_deadline_policy: row.checkDeadlinePolicy,
    creates_deep_clean: row.createsDeepClean === true,
    proximity_evidence: clone(row.proximityEvidence || []),
    segments: clone(row.segments || []),
  };
}

function normalizedNotificationIntent(loan, intent, event) {
  const start = event === 'start';
  return {
    notification_key: start ? intent.startKey : intent.endKey,
    loan_id: loan.loanId,
    service_date: loan.serviceDate,
    event,
    scheduled_time: start ? intent.startTime : intent.endTime,
    coverer_slot_id: intent.covererSlotId,
    delivery_state: intent.deliveryState,
  };
}

export function createStaticWeeklyLunchAuthorityDocument({ input, result, candidate = null } = {}) {
  if (!input || !result) fail('lunch_authority_base_required');
  const exactCandidate = candidate || createStaticWeeklyLunchCoverageCandidate(input, result);
  const verification = verifyStaticWeeklyLunchCoverageCandidate(input, result, exactCandidate);
  if (!verification.ok) fail('lunch_authority_candidate_verification_failed', { reason: verification.reason || null });
  if (exactCandidate.publicationAuthority !== 'NOT_PUBLISHED' || exactCandidate.status !== 'PLANNED') {
    fail('lunch_authority_candidate_not_publishable');
  }
  const loans = array(exactCandidate.lunches).map(normalizedLoan);
  const responsibilities = array(exactCandidate.lunches).flatMap(loan =>
    array(loan.responsibilities).map(row => normalizedResponsibility(loan, row)));
  const notificationIntents = array(exactCandidate.lunches).flatMap(loan =>
    array(loan.notificationIntents).flatMap(intent => [
      normalizedNotificationIntent(loan, intent, 'start'),
      normalizedNotificationIntent(loan, intent, 'end'),
    ]));

  ensureUnique(loans, 'loan_id', 'lunch_authority_duplicate_loan');
  ensureUnique(responsibilities, 'responsibility_id', 'lunch_authority_duplicate_responsibility');
  ensureUnique(notificationIntents, 'notification_key', 'lunch_authority_duplicate_notification');
  for (const row of responsibilities) {
    if (row.coverage_purpose !== 'lunch_coverage'
      || row.check_deadline_policy !== 'inherit_existing_90_minute_deadline'
      || row.creates_deep_clean !== false) {
      fail('lunch_authority_responsibility_policy_invalid', { responsibilityId: row.responsibility_id });
    }
  }
  for (const intent of notificationIntents) {
    if (intent.delivery_state !== 'NOT_ENQUEUED' || !['start', 'end'].includes(intent.event)) {
      fail('lunch_authority_notification_intent_invalid', { notificationKey: intent.notification_key });
    }
  }

  const document = {
    schema: STATIC_WEEKLY_LUNCH_AUTHORITY_SCHEMA,
    persistence_authority: 'NOT_PERSISTED',
    verification_status: 'VERIFIED',
    week_start: exactCandidate.weekStart,
    base_authority_digest: result.authorityDigest,
    base_replay_digest: result.replayDigest,
    source_input_digest: exactCandidate.sourceInputDigest,
    candidate_digest: exactCandidate.candidateDigest,
    loans,
    responsibilities,
    notification_intents: notificationIntents,
  };
  document.semantic_snapshot = {
    schema: 'memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',
    loans_digest: postgresJsonbContentDigest(loans),
    responsibilities_digest: postgresJsonbContentDigest(responsibilities),
    notification_intents_digest: postgresJsonbContentDigest(notificationIntents),
  };
  document.document_identity = postgresJsonbContentDigest(document);
  return document;
}

export function verifyStaticWeeklyLunchAuthorityDocument({ input, result, document } = {}) {
  try {
    if (!document || document.schema !== STATIC_WEEKLY_LUNCH_AUTHORITY_SCHEMA) return { ok: false, reason: 'lunch_authority_document_schema_invalid' };
    const expected = createStaticWeeklyLunchAuthorityDocument({ input, result });
    return {
      ok: postgresJsonbContentDigest(expected) === postgresJsonbContentDigest(document),
      expected_identity: expected.document_identity,
    };
  } catch (error) {
    return { ok: false, reason: error.code || 'lunch_authority_document_invalid' };
  }
}
