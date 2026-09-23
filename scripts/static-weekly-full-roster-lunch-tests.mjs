import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileStaticWeeklySchedule} from '../src/static-weekly-schedule-compiler.js';
import {createStaticWeeklyLunchAuthorityDocument,verifyStaticWeeklyLunchAuthorityDocument} from '../src/static-weekly-lunch-authority-adapter.js';
const path=process.env.STATIC_WEEKLY_COVERAGE_PACKET;
assert.ok(path,'explicit local prepared packet required; no database/network');
const packet=JSON.parse(readFileSync(path,'utf8'));
const config=JSON.parse(readFileSync(new URL('../config/custodial-recurring-schedule-20260923.json',import.meta.url),'utf8'));
const untouched=JSON.stringify(packet),input=structuredClone(packet.compilerInput);
const originalVacancies=[...input.version.vacantSlotIds];assert.equal(originalVacancies.length,3);
// These identities exist only in this future-full-staff simulation, never a
// registration artifact or production employee. Historical rows are retained.
for(const slotId of originalVacancies){
  const slot=input.slots.find(s=>s.id===slotId);assert.ok(slot);
  const hex=createHash('sha256').update('SYNTHETIC_TEST_ONLY:'+slotId).digest('hex');
  const personId=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
  slot.incumbencies.push({personId,displayName:'SYNTHETIC TEST VACANCY FILL',effectiveStart:input.serviceDate,effectiveEnd:null});
  for(const row of input.version.slotAvailability.filter(r=>r.slotId===slotId))row.status='working';
}
input.version.vacantSlotIds=[];
input.versions=[input.version];delete input.version;
const result=await compileStaticWeeklySchedule(input);
assert.equal(result.status,'FEASIBLE',JSON.stringify(result.fatal||result.verifier));
assert.equal(result.publicationAuthority,'ACCEPTABLE');assert.equal(result.verifier.ok,true);
assert.equal(result.openWork.length,0,'full-staff fixture may not leave work open');
assert.equal(result.reviewWork.length,0,'full-staff fixture may not hide review work');
const document=createStaticWeeklyLunchAuthorityDocument({input,result});
assert.equal(document.verification_status,'VERIFIED');
assert.equal(verifyStaticWeeklyLunchAuthorityDocument({input,result,document}).ok,true);
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
const slots=new Map(Object.values(config.slots).map(s=>[s.slotId,s]));
assert.equal(document.loans.length,45,'nine recurring positions each work five days');
let twoHelpers=0,oneHelper=0;
for(const loan of document.loans){
  const owner=slots.get(loan.normal_owner_slot_id);assert.ok(owner);
  assert.ok(owner.workDays.includes(loan.day_of_week),'loan on owner off day');
  assert.equal(loan.coverage_start,owner.lunch[0]);assert.equal(loan.coverage_end,owner.lunch[1]);
  assert.equal(minute(loan.coverage_end)-minute(loan.coverage_start),60);
  assert.equal(new Set(loan.helper_slot_ids).size,loan.helper_slot_ids.length);
  assert.ok(loan.helper_slot_ids.length===2||loan.helper_slot_ids.length===1);
  if(loan.helper_slot_ids.length===2)twoHelpers++;
  else {oneHelper++;assert.ok(loan.fallback,'single helper must be an explicit verified fallback');}
  for(const slotId of loan.helper_slot_ids){
    const helper=slots.get(slotId);assert.ok(helper);
    assert.notEqual(slotId,loan.normal_owner_slot_id);
    assert.ok(helper.workDays.includes(loan.day_of_week));
    assert.ok(helper.shift[0]<=loan.coverage_start&&helper.shift[1]>=loan.coverage_end);
    assert.ok(helper.lunch[1]<=loan.coverage_start||helper.lunch[0]>=loan.coverage_end);
    const intents=document.notification_intents.filter(n=>n.loan_id===loan.loan_id&&n.coverer_slot_id===slotId);
    assert.deepEqual(intents.map(n=>n.event).sort(),['end','start']);
    assert.equal(intents.find(n=>n.event==='start').scheduled_time,loan.coverage_start);
    assert.equal(intents.find(n=>n.event==='end').scheduled_time,loan.coverage_end);
  }
}
assert.equal(document.persistence_authority,'NOT_PERSISTED');
assert.ok(document.notification_intents.every(n=>n.delivery_state==='NOT_ENQUEUED'));
assert.ok(document.responsibilities.every(r=>r.creates_deep_clean===false));
assert.equal(JSON.stringify(packet),untouched,'real six-person source is unchanged by simulation');
const evidence={passed:true,daysChecked:7,scheduledLunches:document.loans.length,
 twoHelpers,oneHelper,notificationIntents:document.notification_intents.length,
 fullStaffSimulation:true,realVacanciesUnchanged:3,providerSent:false,physicalVerification:false,
 documentIdentity:document.document_identity};
if(process.env.STATIC_WEEKLY_LUNCH_EVIDENCE_FILE)writeFileSync(process.env.STATIC_WEEKLY_LUNCH_EVIDENCE_FILE,
 JSON.stringify({evidence,classification:'SYNTHETIC_FUTURE_STAFF_TEST_ONLY',document},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(evidence,null,2));
