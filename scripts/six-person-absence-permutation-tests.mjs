import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createStaticWeeklyCompilerRuntime} from '../src/static-weekly-schedule-compiler-runtime.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
import {verifyStaticWeeklyScheduleResult} from '../src/static-weekly-schedule-verifier.js';
import {createContractorCapacityTransitionCandidate} from '../src/static-weekly-contractor-source-transition.js';
import {createStaticWeeklyProjectionRpcInput} from '../src/static-weekly-schedule-database-adapter.js';
import {createStaticWeeklyLunchPreviewDocument} from '../src/static-weekly-lunch-publication.js';
import {loadSixPersonAbsenceSource} from './fixtures/six-person-absence-source.mjs';

// Explicit retained input, never inferred from a host/cloud path. This is the
// exact current October 5 six-person TEMPLATE, not a production publication.
const packetPath=process.env.STATIC_WEEKLY_TEST_SIX_PACKET;
const outputPath=process.env.STATIC_WEEKLY_ABSENCE_PROOF_OUTPUT;
assert.ok(outputPath,'new evidence directory required');
assert.equal(fs.existsSync(outputPath),false,'refuse to overwrite an earlier proof');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const packet=loadSixPersonAbsenceSource({retainedPacketPath:packetPath||null});
const configBytes=fs.readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url));
assert.equal(sha(configBytes),'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30','exact current corrected owner config');
const config=JSON.parse(configBytes), original=packet.compilerInput;
assert.equal(digest(original),packet.sourceDigest);
assert.equal(packet.sourceDigest,'ac98f94d0c28a9cd493898bef2463059ef59a80bfcac1f8d0a455ddf6901571a');
fs.mkdirSync(outputPath,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(outputPath,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const uuid=n=>`62000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const basis={authority_revision:1,trusted_service_date:'2026-10-02',publication_id:original.version.publicationId,
 current_publication_id:original.version.publicationId,version_id:original.version.id,source_id:packet.sourceId,
 source_digest:packet.sourceDigest,compiler_input:original,roster_digest:digest(original.slots),dependency_digest:digest(original.proximity),
 future_exception_count:0,capacity_dependency_findings:[],all_slot_ids:original.slots.map(s=>s.id)};
const selection=original.slots.filter(s=>s.contractorCapacity).map((s,i)=>({legacy_slot_id:s.id,new_capacity_id:uuid(i+1),capacity_code:`CoverAll0${i+1}`}));
const preview=createContractorCapacityTransitionCandidate({basis,selection,effectiveStart:'2026-10-05',expectedRevision:1,
 reason:'Explicit disposable six-person typed-source compiler proof, not source admission',candidateVersionId:uuid(20),candidatePublicationId:uuid(21)});
assert.equal(preview.admitted,false);assert.equal(preview.published,false);assert.equal(preview.employeeRowsCreated,0);
const raw=preview.candidateSource;
const base={...structuredClone(raw),versions:[structuredClone(raw.version)]};delete base.version;
const ordinary=base.slots.filter(s=>!s.contractorCapacity), capacities=base.slots.filter(s=>s.contractorCapacity);
assert.equal(ordinary.length,9);assert.equal(capacities.length,8);
const currentIds=new Set(Object.values(config.slots).filter(s=>s.personId).map(s=>s.personId));
assert.equal(currentIds.size,6);
assert.ok(capacities.every(s=>s.kind==='CONTRACTOR_CAPACITY'&&s.incumbencies.length===0));
assert.deepEqual(ordinary,original.slots.filter(s=>!s.contractorCapacity),'ordinary positions/history unchanged by actual preview helper');
const command=(id,type,payload,sequence,window)=>({id,type,payload,sequence,...(window?{window}:{}),serviceDate:base.serviceDate,
 baseVersionId:base.versions[0].id,publicationId:base.versions[0].publicationId,actorId:uuid(30),expectedRevision:sequence,
 idempotencyKey:id,reason:'Explicit disposable manager absence/capacity proof; no live staffing fact'});
const absentKeys=['KAREN','TAMMY'];
const absences=absentKeys.map((key,i)=>command(`six-absence-${key}`,'daily_absence',{slotId:config.slots[key].slotId},i+1));
const cases={baseline:[],one:[absences[0]],two:absences,array_permutation:[...absences].reverse(),
 admission_order_permutation:[{...absences[1],sequence:1,expectedRevision:1},{...absences[0],sequence:2,expectedRevision:2}]};
// Explicitly selected fixture capacity shift and lunch reuse Karen's published
// times, with all inherited qualifications/route/capacity provenance intact.
// This does NOT assert any real contractor agreed these times or autoactivate it.
const cap=capacities[0], template=cap.contractorAvailability.find(a=>a.dayOfWeek===1);
const availability=structuredClone(template);delete availability.dayOfWeek;delete availability.status;delete availability.lunch;
availability.slotId=cap.id;availability.shift={start:config.slots.KAREN.shift[0],end:config.slots.KAREN.shift[1]};
availability.productiveCapacityProvenance=`disposable-explicit-manager:${packet.sourceDigest}:KAREN-equivalent-shift`;
cases.manual_capacity=[...absences,command('six-explicit-manual-capacity','cover_all',{availability},3),
 command('six-explicit-capacity-break','lunch',{slotId:cap.id},4,{start:config.slots.KAREN.lunch[0],end:config.slots.KAREN.lunch[1]})];
const requested=(process.env.STATIC_WEEKLY_ABSENCE_PROOF_CASES||Object.keys(cases).join(',')).split(',');
assert.ok(requested.every(k=>Object.hasOwn(cases,k))&&new Set(requested).size===requested.length);
assert.ok(!requested.some(k=>k.includes('permutation'))||requested.includes('two'),'permutation proof requires original two-absence result');
if(process.env.CI==='true')assert.deepEqual(requested,Object.keys(cases),'required CI cannot skip, reorder or narrow owning cases');
const runtime=createStaticWeeklyCompilerRuntime({exposeProcessIdentityForTest:true});
const summaries=[],results=new Map();let checks=0;
const check=(name,predicate)=>{assert.ok(predicate,name);checks++;console.log('PASS',name);};
const semantic=r=>r.weeklyAssignments.map(a=>({planWorkId:a.planWorkId,serviceDate:a.serviceDate,status:a.status,slotId:a.slotId,
 personId:a.personId,ownerKind:a.ownerKind,capacityId:a.capacityId,window:a.window,workSnapshot:a.workSnapshot}));
try {
 write('basis-and-preview.json',{scope:'Pure actual source-preview helper with explicit synthetic inventory witnesses; not SQL admission',basis,preview});
 for(const name of requested){
  const input=structuredClone(base);input.exceptions=structuredClone(cases[name]);const before=JSON.stringify(input);
  write(`${name}-input.json`,input);console.log('COMPILING',name);
  const result=await runtime.compile(input);write(`${name}-result.json`,result);
  check(`${name}: caller source is not mutated`,JSON.stringify(input)===before);
  console.log('RESULT',JSON.stringify({name,status:result.status,fatal:result.fatal,rows:result.weeklyAssignments?.length,verifier:result.verifier?.ok}));
  check(`${name}: complete compiler witness exists (no heuristic/unknown acceptance)`,Boolean(result.weeklyAssignments&&result.certificate));
  const independent=verifyStaticWeeklyScheduleResult(input,result);write(`${name}-independent-verifier.json`,independent);
  check(`${name}: independently regenerated full program verifies`,independent.ok===true&&result.verifier?.ok===true);
  check(`${name}: only six current employee IDs appear`,result.weeklyAssignments.every(a=>!a.personId||currentIds.has(a.personId)));
  const activated=new Set(input.exceptions.filter(e=>e.type==='cover_all').map(e=>e.payload.availability.slotId));
  check(`${name}: capacity never appears without explicit manual command`,result.weeklyAssignments.every(a=>!capacities.some(s=>s.id===a.slotId)||activated.has(a.slotId)));
  const projected=result.canonicalAuthority.projectionAvailability;
  for(const row of result.weeklyAssignments){
   if(row.status!=='ASSIGNED'){check(`${name}: unresolved owner remains visibly null`,row.slotId===null&&row.personId===null);continue;}
   const av=projected.find(a=>a.slotId===row.slotId&&a.serviceDate===row.serviceDate);
   assert.equal(av?.status,'working','only actual working availability');
   assert.ok(row.window.start>=av.shift.start&&row.window.end<=av.shift.end,'no shift extension');
   assert.ok(!(row.slotId===config.slots.ALIJAH.slotId&&row.workSnapshot.locationCodeSnapshot==='HERPETARIUM'),'hard prohibition');
   if(capacities.some(s=>s.id===row.slotId)){assert.equal(row.ownerKind,'CONTRACTOR_CAPACITY');assert.equal(row.capacityId,row.slotId);assert.equal(row.personId,null);assert.equal(row.displayName,null);}
  }
  checks+=3;
  for(const [key,slot]of Object.entries(config.slots).filter(([,s])=>s.personId))for(const av of projected.filter(a=>a.slotId===slot.slotId)){
   const targetAbsent=input.exceptions.some(e=>e.type==='daily_absence'&&e.payload.slotId===slot.slotId&&e.serviceDate===av.serviceDate);
   if(targetAbsent){assert.notEqual(av.status,'working');assert.ok(!result.weeklyAssignments.some(a=>a.slotId===slot.slotId&&a.serviceDate===av.serviceDate));}
   else if(slot.workDays.includes(av.dayOfWeek)){assert.equal(av.status,'working',key);assert.deepEqual([av.shift.start,av.shift.end],slot.shift);assert.deepEqual([av.lunch.start,av.lunch.end],slot.lunchByDay[String(av.dayOfWeek)]);}
   else assert.notEqual(av.status,'working',key+' stays off');
  }
  checks++;
  check(`${name}: exact ordinary recurring source survives dated overlay`,digest(result.canonicalAuthority.compilerInput.version.assignments)===digest(base.versions[0].assignments));
  check(`${name}: exact directed proximity facts survive`,digest(result.canonicalAuthority.compilerInput.proximity)===digest(base.proximity));
  if(result.status==='FEASIBLE'){
   check(`${name}: only verified feasible result is acceptable`,result.publicationAuthority==='ACCEPTABLE');
   const rpc=createStaticWeeklyProjectionRpcInput({result,publicationId:base.versions[0].publicationId,expectedRevision:1,
    actor:{managerId:uuid(30),managerName:'Disposable proof manager',idempotencyKey:`six-proof-${name}`}});
   write(`${name}-projection-envelope.json`,rpc);
   check(`${name}: actual projection adapter preserves typed/null-person ownership`,rpc.envelope.assignments.filter(a=>a.owner_kind==='CONTRACTOR_CAPACITY').every(a=>a.owner_person_id===null&&activated.has(a.capacity_id)));
   const lunch=createStaticWeeklyLunchPreviewDocument(result);write(`${name}-lunch-preview.json`,lunch);
  }else check(`${name}: review cannot claim publication acceptance`,result.status==='REVIEW'&&result.publicationAuthority==='REVIEW');
  if(name==='baseline'){
   const open=result.weeklyAssignments.filter(a=>a.status==='OPEN');
   check('baseline retains exactly the owner accepted Friday OPEN exception',open.length===1&&open.every(a=>a.workSnapshot.locationCodeSnapshot==='HERPETARIUM'&&a.window.start==='15:00'&&a.window.end==='16:00'&&a.dayOfWeek===5));
  }
  if(name==='array_permutation'){
   check('same immutable commands: array order cannot change exact replay identity',result.replayDigest===results.get('two')?.replayDigest);
   assert.deepEqual(semantic(result),semantic(results.get('two')));checks++;
  }
  if(name==='admission_order_permutation'){
   assert.deepEqual(semantic(result),semantic(results.get('two')),'independent daily absences commute semantically across admission sequence');checks++;
  }
  if(name==='manual_capacity'){
   check('explicit selected nonemployee capacity actually receives dated work',result.weeklyAssignments.some(a=>a.status==='ASSIGNED'&&a.capacityId===cap.id&&a.personId===null));
   check('other seven inactive capacities cannot become automatic helpers/owners',result.weeklyAssignments.every(a=>!a.capacityId||a.capacityId===cap.id));
  }
  summaries.push({name,status:result.status,publicationAuthority:result.publicationAuthority,independentVerifier:independent.ok,
   inputDigest:result.inputDigest,replayDigest:result.replayDigest,rows:result.weeklyAssignments.length,
   openRows:result.openWork.length,reviewRows:result.reviewWork.length,manualCapacityAssigned:result.weeklyAssignments.filter(a=>a.ownerKind==='CONTRACTOR_CAPACITY'&&a.status==='ASSIGNED').length,
   objective:result.objective});results.set(name,result);
 }
 write('summary.json',{status:'PASS',checks,sourceDigest:packet.sourceDigest,typedCandidateDigest:preview.candidateDigest,cases:summaries,
  scope:'Current isolated production compiler/full independent verifier and real pure source/projection/lunch adapters; exact six-person template; no SQL admission, manager HTTP, production inventory, phone or independent review proof'});
 console.log(JSON.stringify({status:'PASS',checks,cases:summaries.map(({objective,...s})=>s)}));
}catch(error){write('failure.json',{status:'FAIL',checks,error:{message:error.message,stack:error.stack},completed:summaries});throw error;}
finally{await runtime.shutdown();write('cleanup.json',runtime.getReadiness());}
