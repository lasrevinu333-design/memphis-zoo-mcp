import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {modelAcceptedSevenSupportedVacancy} from '../src/accepted-seven-update-preparation.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
let checks=0;const check=fn=>{fn();checks++;};
// Synthetic continuation of a retained read-only fixture. No live vacancy,
// publication, enrollment, employee activation or original command is run.
const s=structuredClone(JSON.parse(readFileSync(new URL('./fixtures/manual-live-roster-20261030.json',import.meta.url))).readback);
s.serviceDate='2026-11-15';
const slotId='7044faec-4bbd-57ca-a898-ddd719503113',employeeId='06228c5d-5123-4b8b-b730-e01114bdc971';
const slot=s.rosterSlots.find(x=>x.slotId===slotId);slot.incumbencies[0].effectiveEnd='2026-11-09';
slot.incumbencies.push({incumbencyId:'00000000-0000-4000-8000-000000007701',personId:employeeId,displayName:'Kiltra Horton',effectiveStart:'2026-11-09',effectiveEnd:null});
const original=JSON.stringify(s),m=modelAcceptedSevenSupportedVacancy(s),after=m.expectedPostSnapshot;
check(()=>assert.equal(JSON.stringify(s),original));
check(()=>assert.equal(m.beforeRosterDigest,digest(s)));
check(()=>assert.equal(m.expectedPostRosterDigest,digest(after)));
check(()=>assert.equal(after.authorityRevision,s.authorityRevision+1));
check(()=>assert.deepEqual(after.parentPublication,s.parentPublication));
check(()=>{const p=after.employees.find(p=>p.employeeId===employeeId);assert.equal(p.active,false);assert.equal(p.hasMessenger,false);});
check(()=>{const a=after.rosterSlots.find(x=>x.slotId===slotId);assert.deepEqual(a.incumbencies[0],slot.incumbencies[0]);assert.deepEqual(a.incumbencies[1],{...slot.incumbencies[1],effectiveEnd:s.serviceDate});});
check(()=>assert.deepEqual(after.rosterSlots.filter(x=>x.slotId!==slotId),s.rosterSlots.filter(x=>x.slotId!==slotId)));
check(()=>assert.deepEqual(after.employees.filter(x=>x.employeeId!==employeeId),s.employees.filter(x=>x.employeeId!==employeeId)));
for(const mutate of [x=>{x.authorityRevision=Number.MAX_SAFE_INTEGER;},x=>{x.serviceDate='2026-02-30';},
 x=>{x.employees.find(p=>p.employeeId===employeeId).active=false;},x=>{x.employees.find(p=>p.employeeId===employeeId).hasMessenger=false;},
 x=>{x.employees.find(p=>p.employeeId===employeeId).displayName='replacement';},x=>{x.employees.push(x.employees.find(p=>p.employeeId===employeeId));},
 x=>{x.rosterSlots.find(p=>p.slotId===slotId).incumbencies.at(-1).personId='other';},
 x=>{x.rosterSlots.find(p=>p.slotId===slotId).incumbencies.at(-1).effectiveStart=x.serviceDate;},
 x=>{const rows=x.rosterSlots.find(p=>p.slotId===slotId).incumbencies;rows.push({...rows.at(-1),incumbencyId:'00000000-0000-4000-8000-000000007702',effectiveStart:'2026-11-20'});},
 x=>{x.rosterSlots.find(p=>p.slotId!==slotId).incumbencies.push({...slot.incumbencies.at(-1)});}]){
 check(()=>{const x=structuredClone(s);mutate(x);assert.throws(()=>modelAcceptedSevenSupportedVacancy(x));});
}
check(()=>assert.equal(m.actualSqlExecuted,false));check(()=>assert.equal(m.liveVacancyObserved,false));
console.log(JSON.stringify({status:'PASS_SUPPORTED_V8_V12_VACANCY_SNAPSHOT_MODEL',checks,
 originalHistoryAndOtherEmployeesPreserved:true,actualSQL:false,phoneBuildOrInstall:false}));
