import assert from 'node:assert/strict';
import {deriveZooWideCoverage,readZooWideCoverage} from '../src/employee-zoo-wide-coverage.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const day={service_date:'2026-10-28',employee_id:id(1),projection_id:id(2),publication_id:id(3),projection_status:'current'};
const roster=(employee,start,end)=>({employee_active:true,roster:{employee_id:id(employee),slot_id:id(employee+10),version_id:id(4),projection_id:id(2),publication_id:id(3),projection_status:'current',active:true,staffing_state:'working',shift_start:start,shift_end:end,lunch_start:'12:00',lunch_end:'13:00'}});
const row=(location,employee,start,end)=>({...day,location_id:id(location),assigned_employee_id:id(employee),assignment_status:'assigned',coverage_start:start,coverage_end:end});
const input={roster:[roster(1,'08:00','17:00'),roster(5,'07:00','16:00')],exceptions:[],assignments:[row(20,1,'09:45','17:00'),row(21,5,'09:45','16:00'),row(21,1,'16:00','17:00')]};
const before=JSON.stringify(input),expected={schema:'employee-zoo-wide-coverage.v1',service_date:day.service_date,employee_id:id(1),publication_id:id(3),projection_id:id(2),start:'16:00',end:'17:00'};
assert.deepEqual(deriveZooWideCoverage(day,input),expected);
assert.equal(JSON.stringify(input),before,'Display derivation must not change assignments or check clocks');
assert.equal(deriveZooWideCoverage({...day,employee_id:id(5)},input),null,'Earlier departing employee is not zoo-wide');
for(const change of [
 x=>x.roster[1].roster.shift_end='17:00',
 x=>x.assignments[2].assigned_employee_id=null,
 x=>x.assignments[2].assignment_status='open',
 x=>x.assignments[2].coverage_start='16:30',
 x=>x.assignments.push(structuredClone(x.assignments[2])),
 x=>x.assignments[2].projection_id=id(99),
 x=>x.roster[1].roster.publication_id=id(99),
 x=>x.roster.push(structuredClone(x.roster[0])),
 x=>x.assignments=[],
]){const altered=structuredClone(input);change(altered);assert.equal(deriveZooWideCoverage(day,altered),null);}
const absent=structuredClone(input);absent.exceptions=[{id:id(100),type:'partial_absence',serviceDate:day.service_date,status:'accepted',sequence:1,baseVersionId:id(4),publicationId:id(3),payload:{slotId:id(11)},window:{start:'16:30',end:'17:00'}}];
assert.equal(deriveZooWideCoverage(day,absent),null,'Partial absence cannot be hidden by the closing label');
const shifted=structuredClone(input);shifted.exceptions=[{id:id(101),type:'shift_override',serviceDate:day.service_date,status:'accepted',sequence:1,baseVersionId:id(4),publicationId:id(3),payload:{slotId:id(15),shift:{start:'07:00',end:'17:00'}}}];
assert.equal(deriveZooWideCoverage(day,shifted),null,'An approved later coworker departure changes sole coverage');
let query='';assert.deepEqual(await readZooWideCoverage({day,runReadOnlySql:async sql=>{query=sql;return [{facts:input}];}}),expected);
assert.match(query,/exception_set_digest=public.static_weekly_digest_jsonb/);
assert.doesNotMatch(query,/\b(insert|update|delete|alter|drop|truncate)\b/i);
assert.equal(await readZooWideCoverage({day,runReadOnlySql:async()=>{throw Error('unavailable');}}),null);
assert.equal(await readZooWideCoverage({day:{...day,employee_id:"bad';--"},runReadOnlySql:async()=>{throw Error('must not query');}}),null);
console.log('ZOO_WIDE_COVERAGE_FOCUSED_PASS: closing window, complete ownership, open/gapped/duplicate coverage refusal, exceptions, input preservation and read-only query construction. No live database or device test.');
