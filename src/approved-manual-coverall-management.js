import assert from 'node:assert/strict';
import {prepareApprovedManualCoverAllChoice} from './approved-manual-coverall-workflow.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(v,keys)=>{
 if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join(',')!==keys.slice().sort().join(','))
  fail('static_manual_coverall_request_invalid');
};
const uuid=v=>{if(typeof v!=='string'||!UUID.test(v))fail('static_manual_coverall_request_invalid');return v;};
const minute=t=>{if(typeof t!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))fail('static_manual_coverall_hours_invalid');return Number(t.slice(0,2))*60+Number(t.slice(3));};
const window=v=>{exact(v,['start','end']);if(minute(v.end)<=minute(v.start))fail('static_manual_coverall_hours_invalid');return {...v};};
const within=(a,b)=>minute(a.start)<=minute(b.start)&&minute(b.end)<=minute(a.end);
const overlaps=(a,b)=>minute(a.start)<minute(b.end)&&minute(b.start)<minute(a.end);

export function parseApprovedManualCoverAllRequest(value){
 exact(value,['choice_id','days']);uuid(value.choice_id);
 if(!Array.isArray(value.days)||value.days.length<1||value.days.length>366
  ||Buffer.byteLength(JSON.stringify(value),'utf8')>200000)fail('static_manual_coverall_request_invalid');
 const seen=new Set(),days=value.days.map(d=>{
  exact(d,['service_date','capacity_id','shift','lunch','lunch_coverer_slot_id','confirmation_reference','actual_hours_confirmed']);
  if(typeof d.service_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.service_date)
   ||!Number.isFinite(Date.parse(d.service_date+'T12:00Z'))
   ||new Date(d.service_date+'T12:00Z').toISOString().slice(0,10)!==d.service_date||seen.has(d.service_date))fail('static_manual_coverall_request_invalid');
  seen.add(d.service_date);uuid(d.capacity_id);uuid(d.lunch_coverer_slot_id);
  const shift=window(d.shift),lunch=window(d.lunch);
  if(minute(lunch.end)-minute(lunch.start)!==60||!within(shift,lunch))fail('static_manual_coverall_full_hour_lunch_required');
  if(d.actual_hours_confirmed!==true||typeof d.confirmation_reference!=='string'
   ||d.confirmation_reference.trim()!==d.confirmation_reference||!d.confirmation_reference.length
   ||d.confirmation_reference.length>256)fail('static_manual_coverall_actual_hours_confirmation_required');
  return {serviceDate:d.service_date,capacityId:d.capacity_id,shift,lunch,
   lunchCovererSlotId:d.lunch_coverer_slot_id,confirmationReference:d.confirmation_reference,actualHoursConfirmed:true};
 });
 return {choiceId:value.choice_id,days:days.sort((a,b)=>a.serviceDate.localeCompare(b.serviceDate))};
}

function summary(choice){
 if(choice==null)return null;
 const result={choiceId:choice.choiceId,choiceDigest:choice.choiceDigest,operationId:choice.operationId,
  semanticDigest:choice.semanticDigest,expectedRevision:choice.expectedRevision};
 for(const k of ['choiceId','operationId'])uuid(result[k]);
 if(!HASH.test(result.choiceDigest)||!HASH.test(result.semanticDigest)||!Number.isSafeInteger(result.expectedRevision))fail('static_manual_coverall_basis_invalid');
 return result;
}

function readOptions(basis,actor,operationId){
 if(basis?.schema!=='custodial.approved-manual-coverall-manager-basis.v1'||basis.managerId!==actor.managerId
  ||basis.operationId!==operationId||basis.command?.operation_id!==operationId
  ||basis.command?.prepared_by_manager_id!==actor.managerId||!Array.isArray(basis.retainedDays)||!Array.isArray(basis.normalSources))
  fail('static_manual_coverall_basis_invalid');
 const days=basis.retainedDays.map(r=>{
  const source=basis.normalSources.find(x=>x.sourceId===r.sourceId&&x.publicationId===r.publicationId
   &&x.source.serviceDate<=r.serviceDate&&r.serviceDate<=new Date(Date.parse(x.source.serviceDate+'T12:00Z')+6*86400000).toISOString().slice(0,10))?.source;
  if(!source||r.dayBasis?.kind!=='ABSENCE'||r.dayBasis.input?.absentPersonIds?.length!==2)fail('static_manual_coverall_basis_invalid');
  const weekday=new Date(r.serviceDate+'T12:00Z').getUTCDay(),third=basis.originalCommand?.semanticBody.employeeId;
  const capacities=source.slots.filter(s=>s.kind==='CONTRACTOR_CAPACITY'&&s.contractorCapacity===true
   &&s.incumbencies.length===0).flatMap(s=>{
    const a=s.contractorAvailability.find(x=>x.dayOfWeek===weekday);
    return a?.shift?[{capacityId:s.id,label:s.label,shift:{...a.shift},lunch:a.lunch?{start:a.lunch.start,end:a.lunch.end}:null}]:[];
   });
  const lunchCoverers=r.dayBasis.input.roster.filter(p=>p.personId!==third).map(p=>({slotId:p.slotId,label:p.name,
   shift:{...p.shift},lunch:{...p.lunch}}));
  return {serviceDate:r.serviceDate,sourceId:r.sourceId,publicationId:r.publicationId,retainedProjectionId:r.projectionId,
   retainedEnvelopeIdentity:r.envelopeIdentity,retainedPlanDigest:r.dayBasis.plan.planDigest,capacities,lunchCoverers};
 });
 return {schema:'custodial.approved-manual-coverall-options.v1',operationId,semanticDigest:basis.command.semantic_digest,
  expectedRevision:basis.command.expected_revision,state:basis.state,days,choice:summary(basis.choice),
  originalCommandPreserved:true,vendorBooked:false};
}

export async function readApprovedManualCoverAllChoiceSummary({client,call,actor,operationId}){
 return summary(await call(client,'static_weekly_read_coverall_choice_summary',[uuid(operationId),actor.managerId]));
}

export function createApprovedManualCoverAllManagement({transaction,requireManager,lockAuthority,call,prepareStaffingCommand}){
 for(const fn of [transaction,requireManager,lockAuthority,call,prepareStaffingCommand])assert.equal(typeof fn,'function');
 const credential=manager=>({id:uuid(manager.credential_id),device:manager.device_id,access:manager.access_level});
 const read=async(client,actor,manager,operation)=>{
  const c=credential(manager);
  if(typeof c.device!=='string'||!c.device.length||!['full_access','read_only'].includes(c.access))fail('static_manual_coverall_current_credential_required');
  return call(client,'static_weekly_read_coverall_manager_basis',[actor.managerId,operation,c.id,c.device,c.access]);
 };
 return {
  async getApprovedManualCoverAllOptions({manager,operationId}){
   const actor=requireManager(manager,'manage_coverall'),operation=uuid(operationId);
   return transaction(async client=>{await lockAuthority(client);return readOptions(await read(client,actor,manager,operation),actor,operation);});
  },
  async prepareApprovedManualCoverAllStaffing({manager,operationId,request}){
   const actor=requireManager(manager,'manage_coverall'),operation=uuid(operationId),parsed=parseApprovedManualCoverAllRequest(request),
    principal=JSON.stringify([actor.managerId,actor.managerName,manager.credential_id,manager.device_id,manager.access_level]);
   const current=()=>{const now=requireManager(manager,'manage_coverall');if(principal!==JSON.stringify([now.managerId,now.managerName,manager.credential_id,manager.device_id,manager.access_level]))fail('staffing_original_principal_changed');};
   const choiceSummary=await transaction(async client=>{
    await lockAuthority(client);current();
    const basis=await read(client,actor,manager,operation),options=readOptions(basis,actor,operation);current();
    if(basis.state!=='PREPARING'||basis.eligible!==true||!basis.originalCommand||!options.days.length)fail('static_manual_coverall_choice_required');
    if(parsed.days.map(d=>d.serviceDate).join(',')!==options.days.map(d=>d.serviceDate).sort().join(','))fail('static_manual_coverall_all_required_days_needed');
    const days=parsed.days.map(d=>{
     const o=options.days.find(x=>x.serviceDate===d.serviceDate),capacity=o.capacities.find(x=>x.capacityId===d.capacityId),helper=o.lunchCoverers.find(x=>x.slotId===d.lunchCovererSlotId);
     // The capacity template identifies eligible source-bound work. Confirmed
     // vendor hours may differ (e.g. a 05:00 Tammy replacement); the maintained
     // overlay checks every required segment without extending employee hours.
     if(!capacity)fail('static_manual_coverall_source_capacity_required');
     if(!helper||!within(helper.shift,d.lunch)||overlaps(helper.lunch,d.lunch))fail('static_manual_coverall_full_hour_helper_required');
     return {...d,sourceId:o.sourceId,publicationId:o.publicationId};
    });
    const prepared=prepareApprovedManualCoverAllChoice({originalCommand:basis.originalCommand,basis,choiceId:parsed.choiceId,days}),c=credential(manager);
    const stored=await call(client,'static_weekly_prepare_coverall_choice',[prepared.choice,c.id,c.device,c.access]);current();
    if(stored?.state!=='PREPARING'||stored.operationId!==operation||stored.choiceId!==parsed.choiceId||stored.choiceDigest!==prepared.choice.choiceDigest)
     fail('static_manual_coverall_choice_not_persisted');
    return summary(prepared.choice);
   });
   // Accepted authority is reconciled by the maintained staffing acceptance.
   // Only a known committed choice reaches the maintained preparation. An
   // unknown connection/COMMIT throws above and never resubmits this request.
   current();
   try{return {...await prepareStaffingCommand({manager,operationId:operation}),coverallChoice:choiceSummary};}
   catch(error){if(error&&typeof error==='object'){error.operationId=operation;error.coverallChoice=choiceSummary;}throw error;}
  }
 };
}
