import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { nonemployeeCoverAllSource } from './fixtures/nonemployee-coverall-source.mjs';
import { snapshotDatedRosterSlot } from '../src/static-weekly-schedule-model.js';
import { compileStaticWeeklySchedule } from '../src/static-weekly-schedule-compiler.js';
import { verifyStaticWeeklyScheduleResult } from '../src/static-weekly-schedule-verifier.js';
import { createStaticWeeklyProjectionRpcInput } from '../src/static-weekly-schedule-database-adapter.js';
import { createStaticWeeklyLunchAuthorityDocument } from '../src/static-weekly-lunch-authority-adapter.js';
import { createStaticWeeklyLunchCoverageCandidate } from '../src/static-weekly-lunch-coverage.js';
import { shutdownStaticWeeklyCompiler } from '../src/static-weekly-schedule-compiler-runtime.js';
const { source, employees, capacities } = nonemployeeCoverAllSource();
let checks = 0;
function check(name, predicate) { assert.ok(predicate, name); checks++; console.log('PASS', name); }
try {
  const capacity = source.slots.find(s => s.kind === 'CONTRACTOR_CAPACITY');
  check('exact nonemployee snapshot has no incumbent', snapshotDatedRosterSlot(capacity, source.serviceDate).personId === null);
  for (const patch of [{ capacityId: randomUUID() }, { contractorCapacity: false }, { label: 'Fake employee' }, { incumbencies: source.slots[0].incumbencies }]) {
    assert.throws(() => snapshotDatedRosterSlot({ ...capacity, ...patch }, source.serviceDate)); checks++;
  }
  const before = JSON.stringify(source.slots.slice(0, 9));
  const baseline = await compileStaticWeeklySchedule(source);
  if (baseline.status !== 'FEASIBLE' || baseline.publicationAuthority !== 'ACCEPTABLE') console.log(JSON.stringify({ baselineStatus: baseline.status, fatal: baseline.fatal, review:baseline.reviewWork }));
  check('fresh nine-employee plus eight capacity source compiles', baseline.status === 'FEASIBLE' && baseline.publicationAuthority === 'ACCEPTABLE');
  check('unrequested capacity never owns routine baseline work', baseline.weeklyAssignments.every(a => employees.some(p => p.slot === a.slotId)));
  check('fresh baseline preserves employee source bytes', JSON.stringify(source.slots.slice(0, 9)) === before);
  const activated = structuredClone(source);
  const template = structuredClone(capacity.contractorAvailability[0]); delete template.dayOfWeek; delete template.lunch; delete template.status;
  activated.exceptions = [
    { id: randomUUID(), type: 'cover_all', serviceDate: source.serviceDate, baseVersionId: source.versions[0].id, publicationId: source.versions[0].publicationId,
      actorId: 'synthetic-manager', expectedRevision: 1, idempotencyKey: 'manual-capacity', sequence: 1, reason: 'Explicit synthetic manager added capacity, no employee absence', payload: { availability: { ...template, slotId: capacity.id } } },
    { id: randomUUID(), type: 'lunch', serviceDate: source.serviceDate, baseVersionId: source.versions[0].id, publicationId: source.versions[0].publicationId,
      actorId: 'synthetic-manager', expectedRevision: 2, idempotencyKey: 'manual-capacity-lunch', sequence: 2, reason: 'Actual agreed one-hour break', window: { start: '11:00', end: '12:00' }, payload: { slotId: capacity.id } },
  ];
  const result = await compileStaticWeeklySchedule(activated);
  if (result.status !== 'FEASIBLE' || result.publicationAuthority !== 'ACCEPTABLE') console.log(JSON.stringify({ status: result.status, fatal: result.fatal, verification: result.verification }));
  check('manual capacity real compiler accepted', result.status === 'FEASIBLE' && result.publicationAuthority === 'ACCEPTABLE');
  check('independent verifier accepts same typed authority', verifyStaticWeeklyScheduleResult(activated, result).ok);
  const assigned = result.weeklyAssignments.filter(a => a.slotId === capacity.id);
  check('manual added nonemployee actually receives work', assigned.length > 0);
  check('typed owner cannot turn into a person', assigned.every(a => a.ownerKind === 'CONTRACTOR_CAPACITY' && a.capacityId === capacity.id && a.personId === null && a.displayName === null));
  const rpc = createStaticWeeklyProjectionRpcInput({ result, publicationId: source.versions[0].publicationId, expectedRevision: 1,
    actor: { managerId: randomUUID(), managerName: 'Synthetic manager', idempotencyKey: 'typed-capacity' } });
  check('real database adapter carries typed capacity instead of fake employee', rpc.envelope.assignments.filter(a => a.owner_slot_id === capacity.id).every(a => a.owner_kind === 'CONTRACTOR_CAPACITY' && a.capacity_id === capacity.id && a.owner_person_id === null));
  const candidate = createStaticWeeklyLunchCoverageCandidate(activated, result);
  if (candidate.status !== 'PLANNED') console.log(JSON.stringify({ lunchStatus: candidate.status, lunches: candidate.lunches.map(l => ({ owner:l.normalOwnerSlotId, capacity:l.normalOwnerCapacityId, areas:l.locationGroupIds, status:l.status, reason:l.reason })) }));
  const lunch = createStaticWeeklyLunchAuthorityDocument({ input: activated, result, candidate });
  check('real derived lunch retains typed contractor normal owner', lunch.loans.some(l => l.normal_owner_capacity_id === capacity.id && l.normal_owner_person_id === null));
  check('contractor helper never becomes notification recipient', lunch.notification_intents.every(i => employees.some(p => p.slot === i.coverer_slot_id)));
  check('no unrequested capacity participates', result.weeklyAssignments.every(a => !capacities.some(p => p.slot === a.slotId) || a.slotId === capacity.id));
  console.log(JSON.stringify({ status: 'PASS', checks, scope: 'actual portable compiler/independent verifier/adapters with fresh synthetic nine employees and eight nonemployee capacities; no SQL/source publication/phone proof' }));
} finally { await shutdownStaticWeeklyCompiler(); }
