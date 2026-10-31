import assert from 'node:assert/strict';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {snapshotContractorCapacity} from './static-weekly-schedule-model.js';
const clone=structuredClone,uuid=x=>assert.match(x,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),
 minute=x=>{assert.match(x,/^(?:[01]\d|2[0-3]):[0-5]\d$/);return Number(x.slice(0,2))*60+Number(x.slice(3));},
 hashObject=(x,key)=>{const {[key]:value,...body}=x;assert.equal(value,digest(body));},
 exact=(x,keys)=>assert.deepEqual(Object.keys(x).sort(),[...keys].sort());
// Pure DATA correspondence, not manager authentication or SQL acceptance.
// Only source-bound, paired typed facts already lowered by this native owner
// can leave the generic legacy mapper. Raw facts/digests are never rewritten.
export function validateApprovedManualCoverAllFacts({source,exceptions,sourceId=null,selectedDays=[],priorDays=[],pendingChoice=null,originalCommand=null}){
 const before=digest({source,exceptions,sourceId,selectedDays,priorDays,pendingChoice,originalCommand}),version=source.version||source.versions?.[0];
 assert.ok(Array.isArray(exceptions)&&exceptions.length<=512);const groups=new Map(),legacy=[];
 for(const fact of exceptions){
  if(!Object.hasOwn(fact,'coverAllChoiceId')&&!Object.hasOwn(fact,'coverAllOperationId')){legacy.push(fact);continue;}
  uuid(fact.coverAllChoiceId);uuid(fact.coverAllOperationId);uuid(fact.actorId);assert.ok(['cover_all','lunch'].includes(fact.type));
  const keys=['id','type','reason','actorId','payload','sequence','serviceDate','baseVersionId','payloadDigest','publicationId','idempotencyKey','coverAllChoiceId','expectedRevision','coverAllOperationId',...(fact.type==='lunch'?['window']:[]),...(Object.hasOwn(fact,'status')?['status']:[])];exact(fact,keys);
  assert.ok(!Object.hasOwn(fact,'status')||fact.status==='accepted');assert.ok(Number.isSafeInteger(fact.expectedRevision)&&fact.expectedRevision>=0);assert.equal(fact.sequence,fact.expectedRevision+1);
  assert.equal(fact.baseVersionId,version.id);assert.equal(fact.publicationId,version.publicationId);assert.match(fact.serviceDate,/^\d{4}-\d{2}-\d{2}$/);assert.equal(new Date(fact.serviceDate+'T12:00Z').toISOString().slice(0,10),fact.serviceDate);
  assert.ok(fact.serviceDate>=source.serviceDate&&fact.serviceDate<=new Date(Date.parse(source.serviceDate+'T12:00Z')+6*86400000).toISOString().slice(0,10));
  const key=fact.serviceDate,group=groups.get(key)||[];assert.ok(!group.some(x=>x.type===fact.type),'Exactly one typed pair per date');group.push(fact);groups.set(key,group);
 }
 const typedDays=[];
 for(const [serviceDate,facts]of groups){
  assert.equal(facts.length,2,'Complete typed CoverAll plus lunch pair required');const cover=facts.find(x=>x.type==='cover_all'),lunch=facts.find(x=>x.type==='lunch');assert.ok(cover&&lunch);
  for(const key of ['actorId','sequence','baseVersionId','publicationId','coverAllChoiceId','expectedRevision','coverAllOperationId','reason','status'])assert.equal(cover[key],lunch[key]);
  for(const fact of facts){const prefix=fact.type==='cover_all'?'coverall:':'coverall-lunch:';assert.equal(fact.id,prefix+fact.coverAllOperationId+':'+serviceDate);assert.equal(fact.idempotencyKey,fact.id);}
  exact(cover.payload,['availability']);exact(lunch.payload,['slotId']);exact(lunch.window,['start','end']);assert.equal(cover.payloadDigest,digest(cover.payload));assert.equal(lunch.payloadDigest,digest({payload:lunch.payload,window:lunch.window}));
  const chosen=selectedDays.filter(x=>x.serviceDate===serviceDate),prior=priorDays.filter(x=>x.serviceDate===serviceDate&&x.kind==='COVERALL');assert.ok(chosen.length<=1&&prior.length<=1);
  let selected=chosen[0]||prior[0];
  if(pendingChoice&&cover.coverAllOperationId===pendingChoice.operationId){
   hashObject(pendingChoice,'choiceDigest');assert.equal(pendingChoice.schema,'custodial.approved-manual-coverall-choice.v1');assert.equal(cover.coverAllChoiceId,pendingChoice.choiceId);assert.equal(cover.actorId,pendingChoice.managerId);assert.equal(cover.expectedRevision,pendingChoice.expectedRevision);
   assert.ok(originalCommand);assert.equal(originalCommand.operationId,pendingChoice.operationId);assert.equal(originalCommand.preparerId,pendingChoice.managerId);assert.equal(originalCommand.expectedRevision,pendingChoice.expectedRevision);assert.equal(originalCommand.semanticDigest,pendingChoice.semanticDigest);assert.deepEqual(originalCommand.semanticBody,pendingChoice.canonicalSemanticBody);
   const pending=pendingChoice.days.filter(x=>x.serviceDate===serviceDate);assert.equal(pending.length,1);assert.ok(!selected||selected.kind==='COVERALL');selected=selected||pending[0];
  }
  assert.ok(selected,'Typed facts require the selected or immutable prior native overlay');
  if(selected.kind!=='COVERALL'&&prior[0]){
   // Recurrence supplies the immutable accepted day metadata as well as its
   // native prior overlay. Both roles must agree; neither may replace the other.
   const accepted=selected,old=prior[0].overlay,substitute=old.substitute;
   assert.equal(accepted.actualHoursConfirmed,true);assert.equal(accepted.publicationId,version.publicationId);
   if(sourceId!==null)assert.equal(accepted.sourceId,sourceId);assert.equal(accepted.choiceId,cover.coverAllChoiceId);
   assert.equal(accepted.overlayDigest,old.overlayDigest);assert.equal(accepted.retainedPlanDigest,prior[0].plan.planDigest);
   assert.equal(accepted.capacityId,substitute.slotId);assert.deepEqual(accepted.shift,substitute.shift);assert.deepEqual(accepted.lunch,substitute.lunch);
   assert.equal(accepted.confirmationReference,substitute.confirmationReference);
   const relief=old.lunchPlans.filter(x=>x.recipientSlotId===substitute.slotId);assert.equal(relief.length,1);assert.equal(accepted.lunchCovererSlotId,relief[0].covererSlotId);
   selected=prior[0];
  }
  let shift,window,slotId,helper,confirmation,overlay=null;
  if(selected.kind==='COVERALL'){
   overlay=selected.overlay;hashObject(overlay,'overlayDigest');hashObject(selected.plan,'planDigest');hashObject(selected.input,'inputDigest');assert.equal(overlay.sourceDigest,digest(source));assert.equal(selected.input.sourceDigest,digest(source));assert.equal(overlay.acceptedPlanDigest,selected.plan.planDigest);assert.equal(selected.input.absentPersonIds.length,2);assert.equal(overlay.serviceDate,serviceDate);
   const substitute=overlay.substitute;assert.equal(substitute.kind,'CONTRACTOR_CAPACITY');assert.equal(substitute.actualHoursConfirmed,true);shift=substitute.shift;window=substitute.lunch;slotId=substitute.slotId;confirmation=substitute.confirmationReference;
   const relief=overlay.lunchPlans.filter(x=>x.recipientSlotId===slotId);assert.equal(relief.length,1);assert.deepEqual(relief[0].window,window);helper=relief[0].covererSlotId;
  }else{
   assert.equal(selected.actualHoursConfirmed,true);assert.equal(selected.publicationId,version.publicationId);if(sourceId!==null)assert.equal(selected.sourceId,sourceId);if(selected.choiceId!==undefined)assert.equal(selected.choiceId,cover.coverAllChoiceId);
   if(cover.status!=='accepted')assert.ok(pendingChoice&&pendingChoice.operationId===cover.coverAllOperationId,'Pending facts require the exact owner-bound choice');
   shift=selected.shift;window=selected.lunch;slotId=selected.capacityId;helper=selected.lunchCovererSlotId;confirmation=selected.confirmationReference;
   const retained=priorDays.filter(x=>x.serviceDate===serviceDate);assert.ok(retained.length<=1);if(retained[0])assert.equal(selected.retainedPlanDigest,retained[0].plan.planDigest);
   assert.match(selected.overlayDigest,/^[a-f0-9]{64}$/);
  }
  uuid(slotId);uuid(helper);assert.ok(typeof confirmation==='string'&&confirmation.length>0&&confirmation.length<=256);exact(shift,['start','end']);exact(window,['start','end']);const start=minute(shift.start),end=minute(shift.end),lunchStart=minute(window.start),lunchEnd=minute(window.end);assert.ok(end>start&&lunchEnd-lunchStart===60&&start<=lunchStart&&lunchEnd<=end);
  assert.equal(lunch.payload.slotId,slotId);assert.deepEqual(lunch.window,window);
  const slots=source.slots.filter(x=>x.id===slotId);assert.equal(slots.length,1);const slot=slots[0];snapshotContractorCapacity(slot,serviceDate);const day=new Date(serviceDate+'T12:00Z').getUTCDay(),templates=slot.contractorAvailability.filter(x=>x.dayOfWeek===day);assert.equal(templates.length,1);
  const template=clone(templates[0]);delete template.breakChoice;const expected={...template,slotId,dayOfWeek:day,status:'working',shift:clone(shift),lunch:{...clone(window),startMinute:lunchStart,endMinute:lunchEnd},maxDutyMinutes:end-start-60,maxDutyProvenance:template.productiveCapacityProvenance,blockedWindows:[]};assert.deepEqual(cover.payload.availability,expected,'Typed availability must be exact registered template plus actual selected hours/lunch');
  typedDays.push({serviceDate,choiceId:cover.coverAllChoiceId,operationId:cover.coverAllOperationId,overlay,substitute:{slotId,serviceDate,shift:clone(shift),lunch:clone(window),lunchCovererSlotId:helper,confirmationReference:confirmation,managerConfirmed:true,actualHoursConfirmed:true}});
 }
 assert.equal(digest({source,exceptions,sourceId,selectedDays,priorDays,pendingChoice,originalCommand}),before);
 return {legacyExceptions:legacy,typedDays,acceptedExceptionsDigest:digest(exceptions)};
}
export function applyApprovedManualTypedCoverAllChanges(changes,validated){
 const result=clone(changes);
 for(const day of validated.typedDays){let change=result.find(x=>x.serviceDate===day.serviceDate);assert.ok(change&&change.absentPersonIds.length===3,'Exact three-person union required before typed substitution');if(day.overlay)assert.deepEqual([...change.absentPersonIds].sort(),day.overlay.absentPersonIds,'Accepted overlay absence set changed');change.substitute=clone(day.substitute);}
 return result;
}
