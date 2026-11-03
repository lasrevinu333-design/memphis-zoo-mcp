import assert from 'node:assert/strict';
import {prepareApprovedManualEmploymentAvailability, assertApprovedManualEmploymentParticipants} from './approved-manual-employment-admission.js';

const contexts = new WeakSet();
const dayAt = (start, n) => new Date(Date.parse(start + 'T12:00Z') + n * 86400000).toISOString().slice(0, 10);

// Reads enter through the authenticated native basis, and are re-read by SQL
// at acceptance. A browser's serialized eligibility flag is never authority.
export function approvedManualEmploymentPeriod({frameStart, expectedRevision, employmentByDate}) {
  assert.ok(Array.isArray(employmentByDate) && employmentByDate.length === 7);
  const byDate = new Map(), revisionVector = [];
  for (let n = 0; n < 7; n++) {
    const serviceDate = dayAt(frameStart, n), reads = employmentByDate.filter(r => r.serviceDate === serviceDate);
    assert.equal(reads.length, 1, 'Exactly one actual employment read is required per service date');
    const view = prepareApprovedManualEmploymentAvailability({serviceDate, expectedAuthorityRevision: expectedRevision, acceptedRead: reads[0]});
    byDate.set(serviceDate, view);
    for (const employee of view.employees) revisionVector.push({serviceDate, employeeId: employee.employeeId,
      employmentRevision: employee.employmentRevision, requestId: employee.requestId});
  }
  revisionVector.sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.employeeId.localeCompare(b.employeeId));
  const context = {byDate, revisionVector}; contexts.add(context); return context;
}

export function approvedManualEmploymentChanges({week, changes, employment}) {
  assert.ok(contexts.has(employment));
  const result = structuredClone(changes), byDate = new Map(result.map(c => [c.serviceDate, c]));
  for (const [serviceDate, view] of employment.byDate) {
    const day = week.days.find(d => d.weekday === new Date(serviceDate + 'T12:00Z').getUTCDay());
    assert.ok(day);
    const preStart = view.employees.filter(e => !e.actualCoverageEligible && day.employees.some(p => p.name === e.employeeName))
      .map(e => e.employeeId).sort();
    if (!preStart.length) continue;
    const change = byDate.get(serviceDate) || {serviceDate, absentPersonIds: []};
    change.absentPersonIds = [...new Set([...change.absentPersonIds, ...preStart])].sort();
    change.preStartPersonIds = preStart;
    if (!byDate.has(serviceDate)) {result.push(change); byDate.set(serviceDate, change);}
  }
  return result.sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
}

export function assertApprovedManualEmploymentProjection({employment, projection}) {
  assert.ok(contexts.has(employment));
  for (const [serviceDate, availability] of employment.byDate) {
    const people = new Map(projection.authority.projectionAvailability.filter(a => a.serviceDate === serviceDate)
      .map(a => [a.slotId, a.incumbentPersonId]));
    const owners = projection.projectionAssignments.filter(a => a.service_date === serviceDate).map(a => a.owner_person_id).filter(Boolean);
    const loans = projection.lunchDocument.loans.filter(a => a.service_date === serviceDate);
    const lunchPeople = loans.map(a => people.get(a.normal_owner_slot_id)).filter(Boolean);
    const helpers = projection.lunchDocument.responsibilities.filter(a => a.service_date === serviceDate).map(a => people.get(a.coverer_slot_id)).filter(Boolean);
    assertApprovedManualEmploymentParticipants({availability, assignmentEmployeeIds: [...owners, ...lunchPeople], lunchCovererEmployeeIds: helpers});
    for (const employee of availability.employees) {
      const rows = projection.authority.projectionAvailability.filter(a => a.serviceDate === serviceDate && a.incumbentPersonId === employee.employeeId);
      for (const row of rows) {
        if (!employee.actualCoverageEligible) assert.notEqual(row.status, 'working', 'Pre-start employee cannot be available');
        if (row.status === 'working' && employee.approvedLunch) {
          assert.deepEqual(row.lunch, employee.approvedLunch, 'Approved dated employee lunch changed');
          const actual = loans.filter(a => a.normal_owner_slot_id === row.slotId);
          assert.equal(actual.length, 1, 'Working admitted employee needs one full-hour lunch');
          assert.equal(actual[0].coverage_start.slice(0, 5), employee.approvedLunch.start);
          assert.equal(actual[0].coverage_end.slice(0, 5), employee.approvedLunch.end);
        }
      }
    }
  }
  return true;
}
