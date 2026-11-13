import assert from 'node:assert/strict';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {prepareApprovedManualAbsenceDay,validateApprovedManualAbsenceProposal} from './approved-manual-absence.js';

const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const contains=(a,b)=>a.start<=b.start&&b.end<=a.end;
const overlaps=(a,b)=>a.start<b.end&&b.start<a.end;
const active=(w,t)=>minute(w.start)<=t&&t<minute(w.end);

// Explicit, unpublished review inputs. The normal week and canonical dated
// input remain untouched. Native admission independently regenerates the
// canonical input, so a review digest cannot silently become a published day.
export function prepareApprovedManualAbsenceLunchReview({lunchStartOffsetsBySlot,...context}){
 const basis=prepareApprovedManualAbsenceDay(context);
 assert.ok(basis.absentPersonIds.length>=1&&basis.absentPersonIds.length<=2,'Lunch review requires an affected one/two-absence day');
 assert.ok(lunchStartOffsetsBySlot&&typeof lunchStartOffsetsBySlot==='object'&&!Array.isArray(lunchStartOffsetsBySlot));
 const offsets=Object.entries(lunchStartOffsetsBySlot).sort(([a],[b])=>a.localeCompare(b));
 assert.ok(offsets.every(([slot,delta])=>basis.roster.some(p=>p.slotId===slot)&&[0,-30,30].includes(delta)),'Only real remaining employees and unchanged/±30-minute starts');
 const changes=offsets.filter(([,delta])=>delta!==0).map(([slotId,minutes])=>{
  const person=basis.roster.find(p=>p.slotId===slotId),from=structuredClone(person.lunch),
   to={start:time(minute(from.start)+minutes),end:time(minute(from.end)+minutes)};
  assert.equal(minute(to.end)-minute(to.start),60);assert.ok(contains(person.shift,to),'Lunch must remain inside the actual shift');
  return{slotId,name:person.name,minutes,from,to};
 });
 assert.ok(changes.length,'Use the unchanged canonical plan before preparing a lunch exception');
 const input=structuredClone(basis);delete input.inputDigest;
 for(const change of changes)input.roster.find(p=>p.slotId===change.slotId).lunch=change.to;
 input.issues=input.issues.filter(i=>!['NO_FULL_HOUR_LUNCH_HELPER','NO_AVAILABLE_EMPLOYEE'].includes(i.code));
 input.lunches=input.roster.map(p=>{
  const candidateSlotIds=input.roster.filter(c=>c.slotId!==p.slotId&&contains(c.shift,p.lunch)&&!overlaps(c.lunch,p.lunch)).map(c=>c.slotId).sort();
  if(!candidateSlotIds.length)input.issues.push({code:'NO_FULL_HOUR_LUNCH_HELPER',recipientSlotId:p.slotId,window:p.lunch,constraint:'A real helper must cover the entire hour outside their own lunch'});
  return{recipientSlotId:p.slotId,window:structuredClone(p.lunch),candidateSlotIds};
 });
 const edges=new Set([minute(input.checkedWindow.start),minute(input.checkedWindow.end)]);
 for(const phase of input.phases)for(const t of Object.values(phase.window))edges.add(minute(t));
 for(const person of input.roster)for(const window of [person.shift,person.lunch])for(const t of Object.values(window))edges.add(minute(t));
 const ordered=[...edges].filter(t=>t>=minute(input.checkedWindow.start)&&t<=minute(input.checkedWindow.end)).sort((a,b)=>a-b);
 input.slices=[];
 for(let i=0;i<ordered.length-1;i++){
  const start=ordered[i],end=ordered[i+1],phase=input.phases.find(p=>active(p.window,start)),window={start:time(start),end:time(end)},
   availableSlotIds=input.roster.filter(p=>active(p.shift,start)&&!active(p.lunch,start)).map(p=>p.slotId).sort();
  assert.ok(phase);
  if(!availableSlotIds.length)input.issues.push({code:'NO_AVAILABLE_EMPLOYEE',window,constraint:'No fully covered schedule exists for this candidate'});
  input.slices.push({index:i,phase:phase.index,window,minutes:end-start,availableSlotIds,
   lunchRecipientSlotIds:input.roster.filter(p=>active(p.lunch,start)).map(p=>p.slotId).sort()});
 }
 input.status=input.issues.length?'COVERAGE_CONSTRAINTS_UNRESOLVED':'PREPARED_FOR_EXPLICIT_OBJECTIVE';
 input.lunchReview={schema:'custodial.absence-only-lunch-review.v1',baseInputDigest:basis.inputDigest,
  serviceDate:basis.serviceDate,changes,normalWeekChanged:false,publicationEligible:false,
  lastResortLunchGapPermittedMinutes:30,usedUncoveredMinutes:0};
 return{...input,inputDigest:digest(input)};
}

export function validateApprovedManualAbsenceLunchReview({context,lunchStartOffsetsBySlot,input,plan,proposal}){
 assert.deepEqual(input,prepareApprovedManualAbsenceLunchReview({...context,lunchStartOffsetsBySlot}),'Review must match the exact real source and bounded lunch offsets');
 const validation=validateApprovedManualAbsenceProposal({input,plan,proposal});
 return{...validation,status:'VALIDATED_UNPUBLISHED_ABSENCE_LUNCH_REVIEW',changes:input.lunchReview.changes,
  uncoveredPeriods:[],uncoveredMinutes:0,normalWeekChanged:false,publicationEligible:false,productionWritten:false};
}
