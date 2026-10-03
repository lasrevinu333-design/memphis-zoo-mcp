import assert from 'node:assert/strict';
import { postgresJsonbContentDigest as digest } from '../src/static-weekly-schedule-compiler.js';
import { createRecurringCorrectionBinding, recurringCorrectionWitness,
  requireMatchingRecurringCorrectionWitness, RECURRING_CORRECTION_BINDING_SCHEMA } from '../src/static-weekly-recurring-correction-binding.js';

const id = number => `81000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const week = '2026-10-05';
const binding = { schema: RECURRING_CORRECTION_BINDING_SCHEMA, sourceId: id(1), canonicalDigest: 'a'.repeat(64) };
const snapshot = { week_start: week, authority_revision: 7,
  current_publication: { publication_id: id(2) },
  sources: [{ source_id: id(3), source_digest: 'b'.repeat(64) },
    { source_id: id(1), source_digest: binding.canonicalDigest }],
  roster: [{ slot_id: id(4), incumbent_person_id: id(5) }],
  availability: [{ slot_id: id(4), day_of_week: 1, availability_state: 'working' }] };
const patternSource = { source_id: id(6), publication_id: id(7) };
const correctionSource = { source_id: id(1), compiler_input: { serviceDate: week,
  slots: [{ id: id(4), incumbencies: [{ personId: id(5) }] }], version: { assignments: [] } } };
const input = { binding, snapshot, patternSource, correctionSource, effectiveWeek: week,
  expectedRevision: 7, recurringGeneration: 3, effectivePublicationId: id(2) };
const errorCode = code => error => error?.code === code;
let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const rejected = (run, code, label) => { assert.throws(run, errorCode(code), label); checks++; };

check(createRecurringCorrectionBinding(null), null, 'unconfigured server construction remains dormant');
const configured = createRecurringCorrectionBinding(binding);
check(Object.isFrozen(configured), true, 'server binding cannot be mutated after construction');
check(configured, binding, 'server binding retains exact typed ID and raw registry digest');
for (const altered of [{ ...binding, sourceId: id(2), extra: true },
  { ...binding, sourceId: 'not-a-uuid' }, { ...binding, canonicalDigest: 'A'.repeat(64) },
  { ...binding, schema: 'synthetic.fixture' }, [binding]]) {
  rejected(() => createRecurringCorrectionBinding(altered),
    'static_weekly_recurring_correction_binding_invalid', 'closed constructor rejects hostile binding');
}

const witness = recurringCorrectionWitness(input);
check(witness.sourceId, binding.sourceId, 'source chosen from configured binding, not snapshot first row');
check(witness.canonicalDigest, binding.canonicalDigest, 'raw registered digest stays distinct');
check(witness.hydratedDigest, digest(correctionSource.compiler_input), 'week-hydrated digest binds actual reader bytes');
check(witness.rosterDigest, digest({ roster: snapshot.roster, availability: snapshot.availability }),
  'dated roster and availability are bound');
check(witness.effectivePublicationId, id(2), 'effective publication is bound separately from historical pattern');
check(requireMatchingRecurringCorrectionWitness(witness, recurringCorrectionWitness(input)).digest,
  witness.digest, 'fresh exact reread matches');
const reordered = structuredClone(snapshot); reordered.sources.reverse();
check(recurringCorrectionWitness({ ...input, snapshot: reordered }).sourceId, binding.sourceId,
  'competing source list order cannot select a different correction source');

const missing = structuredClone(snapshot); missing.sources = missing.sources.filter(row => row.source_id !== binding.sourceId);
rejected(() => recurringCorrectionWitness({ ...input, snapshot: missing }),
  'static_weekly_recurring_correction_source_unavailable', 'retired or absent active source refuses');
const duplicated = structuredClone(snapshot); duplicated.sources.push(structuredClone(duplicated.sources[1]));
rejected(() => recurringCorrectionWitness({ ...input, snapshot: duplicated }),
  'static_weekly_recurring_correction_source_unavailable', 'duplicate exact source identity refuses');
const changedDigest = structuredClone(snapshot); changedDigest.sources[1].source_digest = 'c'.repeat(64);
rejected(() => recurringCorrectionWitness({ ...input, snapshot: changedDigest }),
  'static_weekly_recurring_correction_source_unavailable', 'raw registry digest drift refuses');
rejected(() => recurringCorrectionWitness({ ...input, correctionSource: { ...correctionSource, source_id: id(9) } }),
  'static_weekly_recurring_correction_source_unavailable', 'reader cannot rebound to competing ID');
rejected(() => recurringCorrectionWitness({ ...input, patternSource: { ...patternSource, source_id: binding.sourceId } }),
  'static_weekly_recurring_correction_context_changed', 'distinct source cannot masquerade as same pattern');
for (const changed of [
  { snapshot: { ...snapshot, week_start: '2026-10-12' } },
  { snapshot: { ...snapshot, authority_revision: 8 } },
  { snapshot: { ...snapshot, current_publication: { publication_id: id(8) } } },
  { recurringGeneration: -1 },
]) rejected(() => recurringCorrectionWitness({ ...input, ...changed }),
  'static_weekly_recurring_correction_context_changed', 'week/revision/publication/generation mismatch refuses');
for (const changed of [
  { snapshot: { ...snapshot, roster: [{ slot_id: id(4), incumbent_person_id: id(8) }] } },
  { snapshot: { ...snapshot, availability: [{ slot_id: id(4), day_of_week: 1, availability_state: 'absent' }] } },
  { correctionSource: { ...correctionSource, compiler_input: { ...correctionSource.compiler_input, marker: 'changed' } } },
]) rejected(() => requireMatchingRecurringCorrectionWitness(witness,
  recurringCorrectionWitness({ ...input, ...changed })),
  'static_weekly_recurring_correction_authority_changed', 'changed roster or hydrated source refuses reread');
rejected(() => requireMatchingRecurringCorrectionWitness(witness, { ...witness, sourceId: id(9) }),
  'static_weekly_recurring_correction_authority_changed', 'same digest with tampered witness payload refuses');
console.log(JSON.stringify({ status: 'PASS', checks, scope: 'pure server-owned correction binding and locked-read witness; no SQL, solver, publication or operational source registration' }));
