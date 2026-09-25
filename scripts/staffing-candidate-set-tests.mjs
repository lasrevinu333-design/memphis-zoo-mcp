import assert from 'node:assert/strict';
import { createStaffingCandidateSet, STAFFING_CANDIDATE_SET_SCHEMA } from '../src/static-weekly-staffing-candidates.js';
import { enumerateStaffingServiceWindow } from '../src/static-weekly-staffing-preparation.js';

let checks = 0;
const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const rejects = (input, code) => { assert.throws(() => createStaffingCandidateSet(input), error => error?.code === code); checks++; };
const window = enumerateStaffingServiceWindow('2026-09-28', '2026-10-09');
const payload = name => ({ identity: name, complete: true, revision: 19 });
const candidates = [
  { candidateKind: 'schedule_refresh', candidateKey: 'employee:2', serviceDate: '2026-10-01', payload: payload('refresh-2') },
  { candidateKind: 'lunch', candidateKey: 'week:2026-10-05', serviceDate: '2026-10-05', payload: payload('lunch-2') },
  { candidateKind: 'projection', candidateKey: 'week:2026-09-28', serviceDate: '2026-09-28', payload: payload('projection-1') },
  { candidateKind: 'schedule_refresh', candidateKey: 'employee:1', serviceDate: '2026-09-30', payload: payload('refresh-1') },
  { candidateKind: 'projection', candidateKey: 'week:2026-10-05', serviceDate: '2026-10-05', payload: payload('projection-2') },
  { candidateKind: 'lunch', candidateKey: 'week:2026-09-28', serviceDate: '2026-09-28', payload: payload('lunch-1') },
];
const set = createStaffingCandidateSet({ window, candidates });
same(set.schema, STAFFING_CANDIDATE_SET_SCHEMA);
assert.match(set.digest, /^[0-9a-f]{64}$/); checks++;
same(set.rowCount, 6); same(set.summary, { weeks: 2, serviceDates: 12, projections: 2, lunches: 2, scheduleRefreshes: 2 });
same(set.rows.map(row => `${row.serviceDate}:${row.candidateKind}:${row.candidateKey}`), [
  '2026-09-28:lunch:week:2026-09-28', '2026-09-28:projection:week:2026-09-28',
  '2026-09-30:schedule_refresh:employee:1', '2026-10-01:schedule_refresh:employee:2',
  '2026-10-05:lunch:week:2026-10-05', '2026-10-05:projection:week:2026-10-05',
]);
same(Object.isFrozen(set) && Object.isFrozen(set.rows) && set.rows.every(row => Object.isFrozen(row) && Object.isFrozen(row.payload)), true);
same(createStaffingCandidateSet({ window, candidates: structuredClone(candidates) }), set, 'candidate identity is deterministic');
rejects({ window, candidates: candidates.filter(row => !(row.candidateKind === 'lunch' && row.serviceDate === '2026-10-05')) }, 'staffing_candidate_lunch_weeks_incomplete');
rejects({ window, candidates: candidates.filter(row => !(row.candidateKind === 'projection' && row.serviceDate === '2026-10-05')) }, 'staffing_candidate_projection_weeks_incomplete');
rejects({ window, candidates: [...candidates, structuredClone(candidates[0])] }, 'staffing_candidate_duplicate');
rejects({ window, candidates: candidates.map((row, index) => index ? row : { ...row, serviceDate: '2026-10-10' }) }, 'staffing_candidate_date_outside_command');
rejects({ window, candidates: candidates.map((row, index) => index ? row : { ...row, candidateKey: ' employee:2' }) }, 'staffing_candidate_key_required');
rejects({ window, candidates: candidates.map((row, index) => index ? row : { ...row, payload: [] }) }, 'staffing_candidate_payload_required');
rejects({ window, candidates: candidates.map((row, index) => index ? row : { ...row, unexpected: true }) }, 'staffing_candidate_unknown_field');
rejects({ window, candidates: candidates.map((row, index) => index ? row : { ...row, candidateKind: 'phone_updated' }) }, 'staffing_candidate_kind_required');
const midweekWindow=enumerateStaffingServiceWindow('2026-09-30','2026-10-02');
same(createStaffingCandidateSet({window:midweekWindow,candidates:[
  {candidateKind:'lunch',candidateKey:'week:2026-09-28',serviceDate:'2026-09-28',payload:payload('lunch')},
  {candidateKind:'projection',candidateKey:'week:2026-09-28',serviceDate:'2026-09-28',payload:payload('projection')},
]}).summary.weeks,1,'a midweek command stages its complete containing Monday week');
console.log(JSON.stringify({ status: 'PASS', checks,
  scope: 'complete deterministic non-authoritative candidate set; no compiler, SQL staging, confirm, publication, delivery or phone proof' }));
