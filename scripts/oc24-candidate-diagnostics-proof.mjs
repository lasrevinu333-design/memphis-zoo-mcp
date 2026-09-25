import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateStaticWeeklySchedulingProgram,postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
const source=JSON.parse(readFileSync(process.argv[2],'utf8')).compilerInput;
for(const filled of [false,true]){
 const s=structuredClone(source);
 if(filled){
  for(const [i,id] of s.version.vacantSlotIds.entries()){
   s.slots.find(slot=>slot.id===id).incumbencies=[{personId:`40000000-0000-4000-8000-00000000020${i}`,displayName:`Synthetic Runtime Hire ${i}`,effectiveStart:s.serviceDate,effectiveEnd:null}];
   for(const a of s.version.slotAvailability.filter(a=>a.slotId===id))a.status='working';
  }
  s.version.vacantSlotIds=[];
 }
 const {version,...rest}=s,program=generateStaticWeeklySchedulingProgram({...rest,versions:[version]});
 assert.equal(program.error,undefined);
 console.log(JSON.stringify({case:filled?'filled-nine':'current-six',inputDigest:program.problem.inputDigest,
  candidatesDigest:digest([...program.problem.candidates]),modelBasisDigest:digest(program.modelBasis),
  objectiveDigest:digest(program.objectives),diagnosticBytes:Buffer.byteLength(JSON.stringify([...program.problem.staticRejections]))}));
}
