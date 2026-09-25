import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
import {compileAndPrepareStaticWeeklyScheduleIsolated,shutdownStaticWeeklyCompiler} from '../src/static-weekly-schedule-compiler-runtime.js';

// Exact owner candidate plus explicitly SYNTHETIC manager operations. No
// mutation/publication of that packet or any production/phone record.
const source=JSON.parse(readFileSync(process.argv[2],'utf8')).compilerInput,original=digest(source);
const s=structuredClone(source),slot=s.slots.find(x=>x.label==='CoverAll contractor capacity 1');
assert.ok(slot?.contractorCapacity);
const template=slot.contractorAvailability.find(x=>x.dayOfWeek===1);
assert.ok(template);
const {dayOfWeek,shift:unusedShift,...facts}=template;
const shift={start:'07:00',end:'15:00'},lunch={start:'11:00',end:'12:00'};
const common={serviceDate:s.serviceDate,baseVersionId:s.version.id,publicationId:s.version.publicationId,
 actorId:'10000000-0000-4000-8000-000000000101',reason:'Synthetic explicit manager capacity for OC24 test',status:'accepted'};
s.exceptions=[
 {...common,id:'oc24-manual-capacity',type:'cover_all',acceptedAt:s.serviceDate+'T06:00:00Z',sequence:1,expectedRevision:0,idempotencyKey:'oc24-manual-capacity',payload:{availability:{...facts,slotId:slot.id,shift}}},
 {...common,id:'oc24-manual-lunch',type:'lunch',acceptedAt:s.serviceDate+'T06:00:01Z',sequence:2,expectedRevision:1,idempotencyKey:'oc24-manual-lunch',window:lunch,payload:{slotId:slot.id}},
];
const {version,...rest}=s;
try{
 const began=performance.now(),p=await compileAndPrepareStaticWeeklyScheduleIsolated({...rest,versions:[version]},
  {kind:'projection',publicationId:version.publicationId,expectedRevision:2,actor:{managerId:common.actorId,managerName:'Synthetic OC24 Runtime Manager',idempotencyKey:'oc24-manual-runtime'}});
 assert.equal(p.lunchDocument.verification_status,'VERIFIED');
 assert.equal(p.lunchDocument.loans.filter(l=>l.status==='REVIEW_REQUIRED').length,0);
 const contractorLunch=p.lunchDocument.loans.find(l=>l.normal_owner_slot_id===slot.id);
 assert.ok(contractorLunch);assert.equal(contractorLunch.coverage_start,lunch.start);assert.equal(contractorLunch.coverage_end,lunch.end);
 const rows=p.envelope.assignments.filter(a=>a.owner_slot_id===slot.id);
 assert.ok(rows.length,'manual capacity must receive work');
 assert.ok(rows.every(a=>a.service_date===s.serviceDate&&a.work_snapshot.window.start>=shift.start&&a.work_snapshot.window.end<=shift.end));
 assert.equal(digest(source),original,'frozen source remains immutable');
 assert.equal(digest(s.version.slotAvailability),digest(source.version.slotAvailability),'normal staff lunches/availability untouched');
 console.log(JSON.stringify({status:'PASS',sourceDigest:original,manualInputDigest:digest(s),shift,lunch,contractorRows:rows.length,
  contractorWindows:[...new Set(rows.map(a=>a.work_snapshot.window.start+'-'+a.work_snapshot.window.end))],
  loans:p.lunchDocument.loans.length,lunchIdentity:p.lunchDocument.document_identity,replayDigest:p.replayDigest,
  elapsedMilliseconds:Math.round(performance.now()-began),production:false,independentAudit:false}));
}finally{await shutdownStaticWeeklyCompiler();}
