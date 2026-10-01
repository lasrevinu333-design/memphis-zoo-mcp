import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareOctoberDatedMaterialization,createOctoberDatedMaterializationController} from '../src/static-weekly-dated-transition-materialization.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {createDatedTransitionDatabaseFixture,MANAGER_ID} from './fixtures/dated-transition-transaction-fixture.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const bundle={recurringPacket:read('../evidence/october5-recurring.json'),
 transitionCandidate:read('../evidence/final-october-candidate/transition-candidate.json'),
 document:read('../evidence/final-october-candidate/phone-pdf-data.json'),
 compilerResult:read('../evidence/final-october-candidate/dated_transition-compiler-result.json')};
const originalDigest=digest(bundle);const plan=prepareOctoberDatedMaterialization(bundle);
const checks=[];const manager={managerId:MANAGER_ID};
const check=(label,fn)=>{fn();checks.push(label);};
const rejected=async(label,fn,pattern)=>{await assert.rejects(fn,pattern);checks.push(label);};
const setup=()=>{const db=createDatedTransitionDatabaseFixture(plan);return {db,controller:createOctoberDatedMaterializationController({plan,store:db.store})};};
const preview=(c)=>c.preview({manager,expectedRevision:17});
const confirmation=p=>({manager,expectedRevision:17,idempotencyKey:'October-transition-one',previewDigest:p.previewDigest});
check('original compiler, phone and PDF inputs remain unchanged',()=>assert.equal(digest(bundle),originalDigest));
check('plan contains exactly four days, full seven-day proof retained',()=>{
 assert.deepEqual(plan.days.map(d=>d.serviceDate),['2026-10-01','2026-10-02','2026-10-03','2026-10-04']);
 assert.equal(plan.completeWitness.end,'2026-10-07');
 assert.deepEqual(plan.days,bundle.document.days.filter(d=>d.phase==='dated_transition'));
});
check('caller cannot supply a forged or deserialized rehashed plan',()=>{
 const forged=structuredClone(plan);forged.days[0].assignments[0].personId=null;
 const {planDigest,...body}=forged;forged.planDigest=digest(body);
 assert.throws(()=>createOctoberDatedMaterializationController({plan:forged,store:setup().db.store}),/reverified_plan_required/);
 assert.throws(()=>createOctoberDatedMaterializationController({plan:structuredClone(plan)}),/reverified_plan_required/);
});
const unavailable=createOctoberDatedMaterializationController({plan});
check('ordinary weekly adapter cannot silently stand in for bounded storage',()=>assert.throws(()=>unavailable.preview({manager,expectedRevision:17}),/requires_bounded_database_adapter/));
const {db,controller}=setup();const old=db.inspect();const p=await preview(controller);
check('preview writes nothing and cannot claim phone delivery',()=>{assert.deepEqual(db.inspect(),old);assert.equal(p.published,false);assert.equal(p.phoneDeliveryState,'PENDING');});
const response=await controller.confirm(confirmation(p));
check('atomic confirmation stores all four days with same phone/PDF identity',()=>{
 assert.equal(response.revision,18);assert.equal(response.phonePdfRevision,bundle.document.revision);
 for(const day of plan.days)assert.deepEqual(db.inspect().rows[day.serviceDate],day);
 assert.equal(db.inspect().receipts.length,1);assert.equal(response.affectedPhonesUpdated,false);
});
check('historical days, October 5, saved cleaning and approval inputs unchanged',()=>{
 for(const date of Object.keys(old.rows))assert.deepEqual(db.inspect().rows[date],old.rows[date]);
 assert.deepEqual(db.inspect().protectedWork,old.protectedWork);assert.deepEqual(db.inspect().rosterSlots,old.rosterSlots);
});
for(const day of plan.days){
 const view=await controller.readDay(day.serviceDate);
 check('exact dated readback '+day.serviceDate,()=>{assert.deepEqual(view.day,day);assert.equal(view.phonePdfRevision,plan.phonePdfRevision);});
}
for(const date of ['2026-09-28','2026-09-30','2026-10-05','2026-10-07'])await rejected('no backdate or recurring spill '+date,()=>controller.readDay(date),/outside_exclusive_range/);
const repeated=await controller.confirm(confirmation(p));
check('exact retry returns committed receipt without duplicate rows or revision',()=>{
 assert.equal(repeated.replayed,true);assert.equal(repeated.effectivePublicationCurrent,true);assert.equal(db.inspect().authorityRevision,18);assert.equal(db.inspect().receipts.length,1);
});
await rejected('same key cannot describe a different request',()=>controller.confirm({...confirmation(p),expectedRevision:18}),/idempotency conflict/);
const rollback={manager,expectedRevision:18,idempotencyKey:'October-rollback-one',publicationId:response.publicationId,projectionId:response.projectionId};
await rejected('rollback binds exact publication identity',()=>controller.rollback({...rollback,publicationId:'96000000-0000-4000-8000-000000000333'}),/rollback_identity_mismatch/);
const rolled=await controller.rollback(rollback);
check('rollback deactivates only transition; history and protected work retained',()=>{
 assert.equal(rolled.revision,19);assert.deepEqual(db.inspect().rows,old.rows);assert.deepEqual(db.inspect().protectedWork,old.protectedWork);
 assert.equal(db.inspect().publications.length,1);assert.equal(db.inspect().publications[0].active,false);assert.equal(db.inspect().rollbackHistory.length,1);
});
assert.equal(await controller.readDay('2026-10-01'),null);checks.push('rollback never leaves a dated reader serving withdrawn data');
const afterRollback=await controller.confirm(confirmation(p));
check('historical idempotent receipt cannot claim withdrawn publication current',()=>assert.equal(afterRollback.effectivePublicationCurrent,false));
const historical=await controller.status({manager,idempotencyKey:'October-transition-one'});
check('status distinguishes immutable operation receipt from current authority',()=>{assert.equal(historical.operationReceipt.state,'PERSISTED');assert.equal(historical.effectivePublicationCurrent,false);});
for(const [label,change,pattern] of [
 ['manager revocation',s=>s.managers=[],/manager_not_authorized/],
 ['revision conflict',s=>s.authorityRevision++,/revision_conflict/],
 ['dependency drift without revision',s=>s.dependencyNonce++,/preview_mismatch/],
 ['incumbent change',s=>s.rosterSlots[0].personId='96000000-0000-4000-8000-000000000555',/roster mismatch/],
 ['approved shift drift',s=>s.approvedAvailability[0].availability[0].shift.start='04:00',/availability mismatch/],
 ['protected occurrence already exists',s=>s.rows['2026-10-01']={protected:true},/existing_occurrences/],
 ]){
 const {db:d,controller:c}=setup();const pre=await preview(c);d.change(change);const before=d.inspect();
 await rejected(label+' rejects before write',()=>c.confirm(confirmation(pre)),pattern);
 check(label+' leaves state unchanged',()=>assert.deepEqual(d.inspect(),before));
}
for(const failure of ['before-stage','partial-stage','readback','wrong-readback','after-receipt','lying-phone-receipt','before-commit']){
 const {db:d,controller:c}=setup();const pre=await preview(c);d.setFailure(failure);const before=d.inspect();
 await rejected('failure '+failure+' rejects confirmation',()=>c.confirm(confirmation(pre)),/fixture-failure|persisted rows mismatch|completion_receipt_mismatch/);
 check('failure '+failure+' rolls back every prefix and receipt',()=>assert.deepEqual(d.inspect(),before));
}
{
 const {db:d,controller:c}=setup();const pre=await preview(c);d.setFailure('after-commit');
 await rejected('ambiguous commit must not return a success claim',()=>c.confirm(confirmation(pre)),/after-commit/);
 d.setFailure(null);const status=await c.status({manager,idempotencyKey:'October-transition-one'});
 check('exact receipt reconciles ambiguous commit',()=>{assert.equal(status.operationReceipt.revision,18);assert.equal(status.effectivePublicationCurrent,true);});
 const retry=await c.confirm(confirmation(pre));check('ambiguous retry creates no duplicate',()=>{assert.equal(retry.replayed,true);assert.equal(d.inspect().authorityRevision,18);});
}
{
 const {db:d,controller:c}=setup();const pre=await preview(c);const req=confirmation(pre);
 const responses=await Promise.all([c.confirm(req),c.confirm(req)]);
 check('concurrent identical confirmations serialize and return one receipt',()=>{
  assert.equal(d.maxConcurrent(),1);assert.equal(d.inspect().receipts.length,1);assert.equal(d.inspect().authorityRevision,18);
  assert.equal(responses.filter(r=>r.replayed===true).length,1);
 });
 const before=d.inspect();d.setFailure('rollback');
 await rejected('rollback error rejects',()=>c.rollback({manager,expectedRevision:18,idempotencyKey:'rollback-fail',publicationId:responses[0].publicationId,projectionId:responses[0].projectionId}),/fixture-failure/);
 check('rollback error preserves current publication and all saved work',()=>assert.deepEqual(d.inspect(),before));
}
check('accepted Friday OPEN retained without coverage or shift invention',()=>{
 const friday=plan.days.find(d=>d.serviceDate==='2026-10-02');const open=friday.assignments.filter(a=>a.status==='OPEN');
 assert.equal(open.length,1);assert.equal(open[0].workSnapshot.locationCodeSnapshot,'HERPETARIUM');assert.equal(open[0].personId,null);
 assert.deepEqual(open[0].window,{start:'15:00',end:'16:00',startMinute:900,endMinute:960});assert.equal(plan.acceptedExceptions[0].ownerQuote,'We will just leave it open.');
});
const output={status:'PASS',checks:checks.length,planDigest:plan.planDigest,phonePdfRevision:plan.phonePdfRevision,
 scope:'complete retained compiler/lunch witness verification plus explicit synthetic bounded database transaction fixture; no PostgreSQL, mounted manager API, signing, production or phone proof',
 productionWritten:false,sourcePlanClassification:plan.classification,checksPassed:checks};
if(process.env.DATED_TRANSITION_EVIDENCE_DIR){
 fs.mkdirSync(process.env.DATED_TRANSITION_EVIDENCE_DIR,{recursive:true});
 for(const [name,value] of [['materialization-plan.json',plan],['materialization-results.json',output],['fixture-before.json',old],['fixture-after-rollback.json',db.inspect()]])
  fs.writeFileSync(new URL(name,'file://'+process.env.DATED_TRANSITION_EVIDENCE_DIR+'/'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({...output,checksPassed:undefined}));
