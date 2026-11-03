import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadPreparedOctoberDatedPlan,createOctoberDatedMaterializationController} from '../src/static-weekly-dated-transition-materialization.js';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {readHomeTimeFacts} from '../src/employee-home-time-facts.js';
const value=JSON.parse(fs.readFileSync(new URL('../config/custodial-october-dated-plan-20261001.json',import.meta.url),'utf8'));
const verified=loadPreparedOctoberDatedPlan(value);assert.ok(createOctoberDatedMaterializationController({plan:verified}));
assert.throws(()=>createOctoberDatedMaterializationController({plan:value}),/reverified_plan_required/);
for(const mutate of [p=>p.days.pop(),p=>p.effectiveStart='2026-09-28',p=>p.days[0].assignments[0].personId=null]){
 const changed=structuredClone(value);mutate(changed);const {planDigest,...body}=changed;changed.planDigest=postgresJsonbContentDigest(body);assert.throws(()=>loadPreparedOctoberDatedPlan(changed));
}
const id=n=>`96000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const day={authority_scope:'dated_transition',service_date:'2026-10-01',employee_id:id(1),publication_id:id(2),projection_id:id(3),candidate_revision:value.phonePdfRevision};
const facts={...day,contract_version:'employee-home-time-facts.v1',projection_status:'current',shift:{active:false}};
assert.deepEqual(await readHomeTimeFacts({day,employeeId:id(1),runReadOnlySql:async()=>[{facts}]}),facts);
for(const key of ['service_date','employee_id','publication_id','projection_id','candidate_revision','projection_status','contract_version']){
 const wrong={...facts,[key]:'wrong'};assert.equal((await readHomeTimeFacts({day,employeeId:id(1),runReadOnlySql:async()=>[{facts:wrong}]})).shift,null,key);
}
for(const rows of [[],[{facts},{facts}],[{facts:null}]])assert.equal((await readHomeTimeFacts({day,employeeId:id(1),runReadOnlySql:async()=>rows})).shift,null);
assert.equal((await readHomeTimeFacts({day,employeeId:id(1),runReadOnlySql:async()=>{throw Error('fixture unavailable');}})).shift,null);
console.log(JSON.stringify({status:'PASS',checks:17,scope:'exact offline plan identity and dated Home malformed/mismatched query-result refusal'}));
