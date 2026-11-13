import { postgresJsonbContentDigest } from './static-weekly-schedule-compiler.js';

export const RECURRING_CORRECTION_BINDING_SCHEMA = 'memphis-zoo.recurring-current-correction-binding.v1';
export const RECURRING_CORRECTION_WITNESS_SCHEMA = 'memphis-zoo.recurring-current-correction-witness.v1';

const uuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const fail = code => Object.assign(new Error(code), { code });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

// This record comes only from server construction, never a manager request,
// snapshot list order or a synthetic source fixture's ID.
export function createRecurringCorrectionBinding(value) {
  if (value === null || value === undefined) return null;
  if (!exactKeys(value, ['schema', 'sourceId', 'canonicalDigest'])
    || value.schema !== RECURRING_CORRECTION_BINDING_SCHEMA
    || !uuid(value.sourceId) || !digest(value.canonicalDigest)) {
    throw fail('static_weekly_recurring_correction_binding_invalid');
  }
  return Object.freeze({ schema: value.schema, sourceId: value.sourceId,
    canonicalDigest: value.canonicalDigest });
}

// Called only after the control-plane transaction has taken the shared
// scheduler authority lock and read the exact future-week manager snapshot and
// active date-hydrated registry source. The snapshot supplies the stored RAW
// registry digest; hydration necessarily has a different, separately bound
// compiler-input digest.
export function recurringCorrectionWitness({ binding, snapshot, patternSource, correctionSource,
  effectiveWeek, expectedRevision, recurringGeneration, effectivePublicationId }) {
  const configured = createRecurringCorrectionBinding(binding);
  if (!configured) throw fail('static_weekly_recurring_correction_binding_required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveWeek ?? '')
    || snapshot?.week_start !== effectiveWeek
    || snapshot?.authority_revision !== expectedRevision
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !Number.isSafeInteger(recurringGeneration) || recurringGeneration < 0
    || !uuid(patternSource?.source_id) || !uuid(patternSource?.publication_id)
    || !uuid(effectivePublicationId) || !uuid(snapshot?.current_publication?.publication_id)
    || snapshot.current_publication.publication_id !== effectivePublicationId
    || patternSource.source_id === configured.sourceId
    || !Array.isArray(snapshot.sources) || !Array.isArray(snapshot.roster)
    || !Array.isArray(snapshot.availability)) {
    throw fail('static_weekly_recurring_correction_context_changed');
  }
  const matches = snapshot.sources.filter(row => row?.source_id === configured.sourceId);
  if (matches.length !== 1 || matches[0].source_digest !== configured.canonicalDigest
    || correctionSource?.source_id !== configured.sourceId
    || !correctionSource.compiler_input || typeof correctionSource.compiler_input !== 'object'
    || Array.isArray(correctionSource.compiler_input)) {
    throw fail('static_weekly_recurring_correction_source_unavailable');
  }
  const result = {
    schema: RECURRING_CORRECTION_WITNESS_SCHEMA,
    sourceId: configured.sourceId,
    canonicalDigest: configured.canonicalDigest,
    hydratedDigest: postgresJsonbContentDigest(correctionSource.compiler_input),
    patternSourceId: patternSource.source_id,
    patternPublicationId: patternSource.publication_id,
    effectivePublicationId,
    effectiveWeek,
    authorityRevision: expectedRevision,
    recurringGeneration,
    managerSnapshotDigest: postgresJsonbContentDigest(snapshot),
    rosterDigest: postgresJsonbContentDigest({ roster: snapshot.roster, availability: snapshot.availability }),
  };
  return Object.freeze({ ...result, digest: postgresJsonbContentDigest(result) });
}

export function requireMatchingRecurringCorrectionWitness(expected, actual) {
  if (!expected || !actual || expected.digest !== actual.digest
    || postgresJsonbContentDigest(expected) !== postgresJsonbContentDigest(actual)) {
    throw fail('static_weekly_recurring_correction_authority_changed');
  }
  return actual;
}
