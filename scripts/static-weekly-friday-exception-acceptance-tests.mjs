#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const record=read('config/custodial-friday-herpetarium-accepted-exception-20260930.json');
const configPath='config/custodial-six-person-static-20261005.json',config=read(configPath);
const document=read(process.argv[2]||'evidence/final-october-candidate/phone-pdf-data.json');
const transition=read('evidence/final-october-candidate/transition-candidate.json');
let checks=0;
function validate(doc,ack){
 assert.equal(ack.binding.candidateRevision,document.revision);
 assert.equal(ack.binding.transitionSourceDigest,transition.sourceDigest);
 assert.equal(ack.binding.recurringSourceDigest,document.recurringSourceDigest);
 assert.equal(ack.binding.availabilityConfigSha256,createHash('sha256').update(fs.readFileSync(configPath)).digest('hex'));
 assert.deepEqual(ack.scope,{dayOfWeek:5,locationCode:'HERPETARIUM',window:{start:'15:00',end:'16:00'},expectedStatus:'OPEN',ownerSlotId:null,ownerPersonId:null,appliesTo:'October 1-4 transition and October 5 recurring pattern under the unchanged approved six-person availability'});
 assert.equal(ack.acceptance.acceptedBy,'Eric');assert.equal(ack.acceptance.acceptedAtUtc,'2026-09-30T22:50:24Z');
 assert.equal(ack.acceptance.decision,'We will just leave it open.');
 assert.equal(ack.acceptance.assistantQuestion,'One real staffing gap remains: Friday, 3–4 p.m., Herpetarium. The eligible custodians have left, and Alijah’s restriction still applies. Who should cover that hour?');
 assert.deepEqual(ack.limits,{onlyThisOperationalGapAccepted:true,allowInventedCoverage:false,allowShiftChanges:false,allowAlijahHerpetarium:false,otherCoverageRulesUnchanged:true,entireScheduleAccepted:false,productionPublicationAuthorizedByThisRecord:false,auditDisclosureApproval:'PENDING',auditUploadAuthorized:false});
 const {revision,...body}=doc;assert.equal(postgresJsonbContentDigest(body),revision);
 // Rehashed negatives exercise the exact scope, not merely a digest mismatch.
 const open=[];
 for(const day of doc.days){
  const dow=new Date(`${day.serviceDate}T12:00:00Z`).getUTCDay();
  const actualOpen=day.assignments.filter(r=>r.status!=='ASSIGNED');
  assert.equal(actualOpen.length,dow===5?1:0,'acceptance allows exactly one scoped OPEN row on Fridays and no other gap');
  for(const row of actualOpen){
   assert.equal(row.status,'OPEN');assert.equal(row.workSnapshot.locationCodeSnapshot,'HERPETARIUM');
   assert.deepEqual(row.window,{start:'15:00',end:'16:00',startMinute:900,endMinute:960});
   assert.equal(row.slotId,null);assert.equal(row.personId,null);open.push(row.serviceDate);
  }
  for(const [key,slot] of Object.entries(config.slots).filter(([,s])=>s.personId)){
   const av=day.availability.find(a=>a.slotId===slot.slotId);
   if(!slot.workDays.includes(dow)){assert.ok(!av||av.status!=='working',`${key} offday cannot change`);continue;}
   assert.equal(av.status,'working');assert.deepEqual([av.shift.start,av.shift.end],slot.shift);
   assert.deepEqual([av.lunch.start,av.lunch.end],slot.lunchByDay[String(dow)]);
  }
  assert.ok(!day.assignments.some(r=>r.slotId===config.slots.ALIJAH.slotId&&r.workSnapshot.locationCodeSnapshot==='HERPETARIUM'),'Alijah restriction is unchanged');
 }
 assert.deepEqual(open,['2026-10-02','2026-10-09']);
 return true;
}
assert.equal(validate(document,record),true);checks++;
const rehash=doc=>{const {revision,...body}=doc;doc.revision=postgresJsonbContentDigest(body);};
for(const mutate of [
 d=>d.days[0].assignments.push(structuredClone(d.days[1].assignments.find(r=>r.status==='OPEN'))),
 d=>d.days[1].assignments.find(r=>r.status==='OPEN').window.start='14:00',
 d=>d.days[1].assignments.find(r=>r.status==='OPEN').workSnapshot.locationCodeSnapshot='AQUARIUM',
 d=>d.days[1].assignments.find(r=>r.status==='OPEN').status='ASSIGNED',
 d=>d.days[1].assignments.find(r=>r.status==='OPEN').slotId=config.slots.ALIJAH.slotId,
 d=>d.days[1].availability.find(a=>a.slotId===config.slots.KATHY.slotId).shift.end='16:00',
 d=>d.days[1].assignments.splice(d.days[1].assignments.findIndex(r=>r.status==='OPEN'),1),
]){const d=structuredClone(document);mutate(d);rehash(d);assert.throws(()=>validate(d,record));checks++;}
for(const mutate of [
 a=>a.scope.dayOfWeek=4,a=>a.scope.window.end='17:00',
 a=>a.limits.entireScheduleAccepted=true,a=>a.limits.auditUploadAuthorized=true,
 a=>a.limits.productionPublicationAuthorizedByThisRecord=true,
 a=>a.binding.candidateRevision='stale',
]){const a=structuredClone(record);mutate(a);assert.throws(()=>validate(document,a));checks++;}
console.log(JSON.stringify({ok:true,checks,acceptedException:record.exceptionId,candidateRevision:document.revision,exactFridayDates:['2026-10-02','2026-10-09'],compilerInputsChanged:false,availabilityChanged:false,otherCoverageRulesChanged:false,auditDisclosureApproval:'PENDING',auditUpload:'NOT_RUN',productionWritten:false}));
