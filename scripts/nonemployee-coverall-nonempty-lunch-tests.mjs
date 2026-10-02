import assert from 'node:assert/strict';
import { nonemployeeCoverAllLunchSource } from './fixtures/nonemployee-coverall-source.mjs';
import { compileStaticWeeklySchedule } from '../src/static-weekly-schedule-compiler.js';
import { createStaticWeeklyLunchCoverageCandidate } from '../src/static-weekly-lunch-coverage.js';
import { createStaticWeeklyLunchAuthorityDocument } from '../src/static-weekly-lunch-authority-adapter.js';
import { shutdownStaticWeeklyCompiler } from '../src/static-weekly-schedule-compiler-runtime.js';
let checks = 0;
const check = (name, predicate) => { assert.ok(predicate, name); checks++; console.log('PASS', name); };
try {
  const { source, employees, capacities } = nonemployeeCoverAllLunchSource();
  const baseline = await compileStaticWeeklySchedule(source);
  check('baseline two real normal owners independently accepted', baseline.publicationAuthority === 'ACCEPTABLE');
  const baselineLunch = createStaticWeeklyLunchCoverageCandidate(source, baseline);
  check('baseline nonempty lunch relief preserves original constraints', baselineLunch.status === 'PLANNED' && baselineLunch.lunches.some(l => l.responsibilities.length));
  const activated = structuredClone(source), capacity = activated.slots[9];
  const template = structuredClone(capacity.contractorAvailability[0]);
  delete template.dayOfWeek; delete template.lunch; delete template.status;
  const exception = (index, type, payload, window = null) => ({ id: `nonempty-${index}`, type,
    serviceDate: source.serviceDate, baseVersionId: source.versions[0].id, publicationId: source.versions[0].publicationId,
    actorId: 'synthetic-manager', expectedRevision: index, idempotencyKey: `nonempty-${index}`, sequence: index,
    reason: 'Explicit synthetic manager admission evidence', payload, ...(window ? { window } : {}) });
  activated.exceptions = [exception(1, 'cover_all', { availability: { ...template, slotId: capacity.id } }),
    exception(2, 'lunch', { slotId: capacity.id }, { start: '12:00', end: '13:00' }),
    exception(3, 'manager_correction', { locks: [{ workId: source.versions[0].assignments[0].workId, slotId: employees[0].slot },
      { workId: source.versions[0].assignments[1].workId, slotId: capacity.id }] })];
  const result = await compileStaticWeeklySchedule(activated);
  if (result.publicationAuthority !== 'ACCEPTABLE') console.log(JSON.stringify({ status: result.status, fatal: result.fatal, review: result.reviewWork }));
  check('explicit manager dated typed replacement accepted', result.publicationAuthority === 'ACCEPTABLE');
  const candidate = createStaticWeeklyLunchCoverageCandidate(activated, result);
  if (candidate.status !== 'PLANNED') console.log(JSON.stringify(candidate));
  check('nonempty typed lunch is actually planned', candidate.status === 'PLANNED');
  const document = createStaticWeeklyLunchAuthorityDocument({ input: activated, result, candidate });
  check('typed normal owner lends actual physical area to real helper', document.responsibilities.some(r => r.normal_owner_capacity_id === capacities[0].slot && r.normal_owner_person_id === null && r.coverer_person_id === employees[0].id && r.segments.length));
  check('typed helper covers employee area without invented person', document.responsibilities.some(r => r.normal_owner_person_id === employees[0].id && r.coverer_capacity_id === capacities[0].slot && r.coverer_person_id === null && r.segments.length));
  check('no nonemployee phone notification recipient', document.notification_intents.every(i => i.coverer_slot_id !== capacities[0].slot));
  check('normal ownership returns after both lunches', document.responsibilities.every(r => r.segments.every(s => s.window.start === r.coverage_start && s.window.end === r.coverage_end)));
  const noBreak = structuredClone(activated);
  noBreak.exceptions = noBreak.exceptions.filter(e => e.type !== 'lunch');
  noBreak.exceptions[0].payload.availability.breakChoice = 'NONE';
  const noBreakResult = await compileStaticWeeklySchedule(noBreak);
  check('explicit typed no-break source accepted without fabricated lunch', noBreakResult.publicationAuthority === 'ACCEPTABLE');
  const noBreakLunch = createStaticWeeklyLunchAuthorityDocument({input:noBreak,result:noBreakResult});
  check('no-break capacity has no scheduled lunch loan', noBreakLunch.loans.every(l=>l.normal_owner_slot_id!==capacity.id));
  check('no-break capacity can still lend real employee lunch coverage', noBreakLunch.responsibilities.some(r=>r.coverer_capacity_id===capacity.id&&r.coverer_person_id===null));
  const missing = structuredClone(noBreak);delete missing.exceptions[0].payload.availability.breakChoice;
  const missingResult = await compileStaticWeeklySchedule(missing);
  check('missing choice is not silently interpreted as no break', createStaticWeeklyLunchCoverageCandidate(missing,missingResult).status==='REVIEW_REQUIRED');
  const contradictory = structuredClone(activated);contradictory.exceptions[0].payload.availability.breakChoice='NONE';
  check('no-break plus scheduled lunch rejected', (await compileStaticWeeklySchedule(contradictory)).publicationAuthority !== 'ACCEPTABLE');
  const forged = structuredClone(noBreak);forged.exceptions[0].payload.availability.slotId=employees[0].slot;
  check('employee cannot acquire no-break exemption', (await compileStaticWeeklySchedule(forged)).publicationAuthority !== 'ACCEPTABLE');
  console.log(JSON.stringify({ status: 'PASS', checks, scope: 'portable real compiler and derived nonempty typed borrower/helper; not SQL/HTTP/physical evidence' }));
} finally { await shutdownStaticWeeklyCompiler(); }
