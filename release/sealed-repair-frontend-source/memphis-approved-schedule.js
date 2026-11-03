(function(root){
'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const COPY=x=>JSON.parse(JSON.stringify(x));
const paths={initial:'/static-weekly/approved-initial',recurring:'/static-weekly/recurring-adaptation'};
const schemas={initial:'custodial.approved-static-initial',recurring:'custodial.approved-static'};
const error=message=>{throw new Error(message);};
function monday(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value&&d.getUTCDay()===1;}
function selectors(kind,input){
 if(!Object.hasOwn(paths,kind)||!input||!monday(input.effective_start)||!Number.isSafeInteger(input.expected_revision)||input.expected_revision<0)error('Invalid approved schedule selection.');
 const keys=kind==='initial'?['source_id','template_id','effective_start','expected_revision']:['effective_start','expected_revision',...(Object.hasOwn(input,'template_id')?['template_id']:[])];
 if(Object.keys(input).length!==keys.length||keys.some(k=>!Object.hasOwn(input,k)))error('Schedule requests accept approved source identities only.');
 if(kind==='initial'&&!UUID.test(input.source_id||''))error('Select the registered approved baseline.');
 if(Object.hasOwn(input,'template_id')&&(typeof input.template_id!=='string'||!input.template_id.trim()||input.template_id!==input.template_id.trim()||input.template_id.length>128))error('Invalid approved template identity.');
 return COPY(input);
}
function validatePreview(kind,value,input,snapshot){
 const selected=selectors(kind,input);
 const view=value?.constraintView;
 if(value?.schema!==schemas[kind]+'-preview.v1'||value.status!=='PREVIEW_ONLY'||value.published!==false||value.solverInvoked!==false
  ||value.serviceDate!==selected.effective_start||value.authorityRevision!==selected.expected_revision||!HASH.test(value.previewDigest||'')
  ||typeof value.templateId!=='string'||!value.templateId||!Array.isArray(value.assignments)||!value.assignments.length||value.assignments.length>10000
  ||!Array.isArray(value.lunch?.loans)||!Array.isArray(value.lunch?.responsibilities)||value.lunch.loans.length>1000||value.lunch.responsibilities.length>10000
  ||!value.mapping||typeof value.mapping!=='object'
  ||view?.schema!=='custodial.approved-static-constraint-view.v1'
  ||view.contract!=='FIXED_APPROVED_PATTERN_COMPLETE_HARD_CONSTRAINTS_NOT_OPTIMALITY'
  ||!HASH.test(view.hardConstraintDigest||'')||!HASH.test(view.physicalCoverageDigest||'')||!HASH.test(view.mappingDigest||'')
  ||!Number.isSafeInteger(view.hardConstraintCount)||view.hardConstraintCount<1
  ||!Array.isArray(view.slotAvailability)||!view.slotAvailability.length||!Array.isArray(view.projectionAvailability)||!view.projectionAvailability.length
  ||view.balance?.optimized!==false||view.opening?.proven!==false)error('The approved schedule preview is incomplete or mismatched. Nothing was published.');
 if(selected.template_id&&value.templateId!==selected.template_id)error('The approved template changed.');
 if(kind==='initial'&&value.sourceId!==selected.source_id)error('The registered baseline changed.');
 if(kind==='recurring'&&value.sourcePublicationId!==snapshot?.current_publication?.publication_id)error('The published pattern changed.');
 const start=Date.parse(selected.effective_start+'T12:00:00Z'),seen=new Set();
 for(const row of value.assignments){
  const key=row?.planWorkId,at=Date.parse(String(row?.serviceDate)+'T12:00:00Z');
  if(typeof key!=='string'||!key||seen.has(key)||!Number.isFinite(at)||at<start||at>=start+7*86400000
   ||!['ASSIGNED','OPEN'].includes(row.status)||!row.window||typeof row.window.start!=='string'||typeof row.window.end!=='string'
   ||(row.status==='ASSIGNED'&&(!UUID.test(row.personId||'')||!UUID.test(row.slotId||'')))
   ||(row.status==='OPEN'&&(row.personId!==null||row.slotId!==null)))error('The returned duties contain invalid or repeated identities.');
  seen.add(key);
 }
 return COPY(value);
}
function validateReceipt(kind,receipt,body){
 if(receipt?.schema!==schemas[kind]+'-confirmation.v1'||!['PERSISTED_CURRENT','ACCEPTED_ORIGINAL_RECEIPT'].includes(receipt.status)
  ||receipt.ok!==true||receipt.persistence_status!=='PERSISTED'||receipt.solverInvoked!==false
  ||!UUID.test(receipt.publication_id||'')||!UUID.test(receipt.projection_id||'')||!HASH.test(receipt.lunch_document_identity||'')
  ||!Number.isSafeInteger(receipt.authority_revision)||receipt.authority_revision<=body.expected_revision
  ||receipt.previewDigest!==body.preview_digest)error('Schedule acceptance is not verified. Keep the exact saved request; do not publish again.');
 if(kind==='initial'&&receipt.source_id!==body.source_id)error('Accepted baseline source mismatch.');
 return COPY(receipt);
}
const unresolvedReasons=Object.freeze({
 NO_ELIGIBLE_INTERVAL_OWNER:'No eligible employee can cover this interval.',
 ORIGINAL_BUDGET_INSUFFICIENT_FOR_POSITIVE_SEGMENTS:'The original workload budget cannot cover the required positive segments.',
 NAMED_HANDOFF_UNAVAILABLE:'The required named handoff is unavailable.',
 FIXED_VISIT_REQUIRES_SINGLE_AVAILABLE_OWNER:'This fixed visit needs one employee available for its whole window.',
 LOCKED_PARENT_UNAVAILABLE:'The locked original duty owner is unavailable.'
});
function validateUnresolvedPreview(value,binding){
 const bad=()=>error('The unresolved preview is malformed or no longer matches the original selection. Nothing can be confirmed.');
 const data=(v,keys)=>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Reflect.ownKeys(v).length!==keys.length
   ||Reflect.ownKeys(v).some(k=>typeof k!=='string'||!keys.includes(k)))bad();
  const result={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!Object.hasOwn(d,'value'))bad();result[key]=d.value;}return result;
 };
 const wanted=data(binding,['sourcePublicationId','authorityRevision','serviceDate','kind','templateId']);
 const v=data(value,['schema','status',...Object.keys(wanted),'unresolved']);
 const date=typeof v.serviceDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v.serviceDate)?new Date(v.serviceDate+'T12:00:00Z'):null;
 if(v.schema!=='custodial.approved-static-unresolved-preview.v1'||v.status!=='UNRESOLVED'||v.kind!=='DATED_ABSENCE'
  ||typeof v.sourcePublicationId!=='string'||!UUID.test(v.sourcePublicationId)
  ||!Number.isSafeInteger(v.authorityRevision)||v.authorityRevision<0||!date||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==v.serviceDate
  ||!(v.templateId===null||typeof v.templateId==='string'&&v.templateId.trim()===v.templateId&&v.templateId.length>0&&v.templateId.length<=128)
  ||Object.keys(wanted).some(key=>v[key]!==wanted[key]))bad();
 const rows=v.unresolved;if(!Array.isArray(rows)||rows.length<1||rows.length>10000||Reflect.ownKeys(rows).length!==rows.length+1)bad();
 const parsed=[];
 for(let i=0;i<rows.length;i++){
  const d=Object.getOwnPropertyDescriptor(rows,String(i));if(!d||!Object.hasOwn(d,'value'))bad();
  const r=data(d.value,['dayOfWeek','parentWorkId','window','reason','originalBudget','requiredSegments']),w=data(r.window,['start','end']);
  if(r.dayOfWeek!==date.getUTCDay()||typeof r.parentWorkId!=='string'||!r.parentWorkId||r.parentWorkId.trim()!==r.parentWorkId
   ||r.parentWorkId.length>512||/[\x00-\x1f\x7f]/.test(r.parentWorkId)||typeof r.reason!=='string'||!Object.hasOwn(unresolvedReasons,r.reason)
   ||typeof w.start!=='string'||typeof w.end!=='string'||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(w.start)
   ||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(w.end)||w.start>=w.end
   ||!Number.isSafeInteger(r.originalBudget)||r.originalBudget<1
   ||(r.reason==='ORIGINAL_BUDGET_INSUFFICIENT_FOR_POSITIVE_SEGMENTS'
    ?!Number.isSafeInteger(r.requiredSegments)||r.requiredSegments<=r.originalBudget:r.requiredSegments!==null))bad();
  parsed.push({...r,window:w});
 }
 const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
 return freeze({...v,unresolved:parsed});
}
const refusedMessages=new Set(['initial manager snapshot requires one active registered recurring source','initial manager snapshot requires exactly one active registered recurring source']);
function end(s){return new Date(Date.parse(s+'T12:00:00Z')+6*86400000).toISOString().slice(0,10);}
function validSnapshotWindow(snapshot,requestedWeek){
 const civil=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00Z'))&&new Date(v+'T12:00Z').toISOString().slice(0,10)===v;
 if(!civil(requestedWeek)||!civil(snapshot?.week_start))return false;
 const start=new Date(snapshot.week_start+'T12:00:00Z');
 if(!Number.isFinite(start.getTime())||start.toISOString().slice(0,10)!==snapshot.week_start||snapshot.week_end!==end(snapshot.week_start))return false;
 const period=snapshot.approved_manual_period;
 if(period){
  if(period.schema!=='custodial.approved-manual-period-window.v1'||period.manifestSha256!=='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f'
   ||!UUID.test(period.publicationId||'')||!UUID.test(period.versionId||'')||period.publicationId!==snapshot.current_publication?.publication_id
   ||period.versionId!==snapshot.current_publication?.version_id||period.frameStart!==snapshot.week_start||period.frameEnd!==snapshot.week_end
   ||period.normalSourceLocked!==true||!civil(period.origin)||period.origin>period.frameStart
   ||(Date.parse(period.frameStart+'T12:00Z')-Date.parse(period.origin+'T12:00Z'))%(7*86400000)!==0)return false;
  return snapshot.week_start<=requestedWeek&&requestedWeek<=snapshot.week_end
   ||monday(requestedWeek)&&snapshot.week_start<=end(requestedWeek)&&snapshot.week_end>=requestedWeek;
 }
 if(monday(snapshot.week_start)&&snapshot.week_start<=requestedWeek&&requestedWeek<=snapshot.week_end)return true;
 const manual=snapshot.approved_manual_schedule;
 if(manual?.schema!=='custodial.approved-manual-manager-view.v1'
  ||manual.manifestSha256!=='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f'
  ||!UUID.test(manual.publicationId||'')||!UUID.test(manual.projectionId||'')
  ||manual.publicationId!==snapshot.current_publication?.publication_id||manual.projectionId!==snapshot.latest_projection?.projection_id
  ||!Array.isArray(manual.days)||manual.days.length!==7)return false;
 const dates=manual.days.map(d=>d.serviceDate).sort(),expected=Array.from({length:7},(_,n)=>new Date(start.getTime()+n*86400000).toISOString().slice(0,10));
 return JSON.stringify(dates)===JSON.stringify(expected)&&snapshot.week_start<=end(requestedWeek)&&snapshot.week_end>=requestedWeek;
}
async function loadInitialEntry({api,weekStart,owner}){
 if(typeof api!=='function'||typeof weekStart!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)||new Date(weekStart+'T12:00Z').toISOString().slice(0,10)!==weekStart)throw Error('Invalid week');
 try{return {mode:'snapshot',snapshot:await api('/static-weekly/manager-snapshot?week_start='+encodeURIComponent(weekStart))};}
 catch(error){if(!owner||error.status!==409||error.code!=='23514'||!refusedMessages.has(error.message))throw error;}
 const initialDate=new Date(weekStart+'T12:00Z');initialDate.setUTCDate(initialDate.getUTCDate()-(initialDate.getUTCDay()+6)%7);weekStart=initialDate.toISOString().slice(0,10);
 const selection=await api('/static-weekly/approved-initial/selection?week_start='+encodeURIComponent(weekStart));
 if(selection?.schema!=='custodial.approved-initial-selection.v1'||selection.week_start!==weekStart||selection.week_end!==end(weekStart)
  ||!Number.isSafeInteger(selection.authority_revision)||selection.authority_revision<0||selection.published!==false
  ||selection.snapshot_authority!=='SELECTION_METADATA_ONLY'||!Array.isArray(selection.initial)||selection.initial.length>256)throw Error('Invalid approved selection metadata');
 const seen=new Set();for(const row of selection.initial){
  if(!UUID.test(row.source_id||'')||typeof row.template_id!=='string'||!row.template_id.trim()||row.template_id.length>128
   ||!monday(row.effective_start)||!Number.isSafeInteger(row.staffing_count)||row.staffing_count<1||row.staffing_count>256
   ||seen.has(row.source_id))throw Error('Invalid or duplicate approved pattern');seen.add(row.source_id);
 }
 return {mode:'selection',metadata:COPY(selection),published:false,snapshot:null};
}
function selectInitial(entry,sourceId){
 if(entry?.mode!=='selection')throw Error('Approved selection is required');
 const row=entry.metadata.initial.find(r=>r.source_id===sourceId&&r.effective_start===entry.metadata.week_start);
 if(!row)throw Error('No approved pattern matches this source and week');
 return {source_id:row.source_id,template_id:row.template_id,effective_start:row.effective_start,expected_revision:entry.metadata.authority_revision};
}

function create({api,auth=root.MemphisAuth,managerId,baseUrl,storage=root.localStorage,nonce=()=>root.crypto.randomUUID(),onState=()=>{}}={}){
 if(typeof api!=='function'||!UUID.test(managerId||'')||typeof baseUrl!=='string')error('Current manager and scheduler service are required.');
 const base=new URL(baseUrl).origin,key='mz_approved_schedule_pending_v1:'+encodeURIComponent(base)+':'+managerId;
 let busy=false,broken=false;
 function read(){
  let text;try{text=storage.getItem(key);}catch{broken=true;error('Saved schedule recovery cannot be read.');}
  if(!text)return null;
  try{
   const record=JSON.parse(text);if(text.length>12000||record.schema!=='custodial.approved-schedule-pending.v1'||record.managerId!==managerId||record.base!==base
    ||!Object.hasOwn(paths,record.kind)||record.path!==paths[record.kind]+'/confirm'||typeof record.encoded!=='string'||JSON.stringify(record.body)!==record.encoded
    ||(record.state!==undefined&&!['PENDING','ACCEPTED','REJECTED'].includes(record.state))
    ||(record.state==='ACCEPTED'&&!record.acceptance)
    ||(record.state==='REJECTED'&&(record.acceptance||![400,401,403,409,422].includes(record.rejectionStatus)||typeof record.error!=='string')))throw Error();
   const {preview_digest,idempotency_key,confirmation_key,...input}=record.body;
   selectors(record.kind,input);if(!HASH.test(preview_digest||''))throw Error();
   const operationKey=record.kind==='initial'?idempotency_key:confirmation_key;
   if(!UUID.test(operationKey||'')||(record.kind==='initial'?confirmation_key!==undefined:idempotency_key!==undefined))throw Error();
   if(record.acceptance)validateReceipt(record.kind,record.acceptance,record.body);
   return record;
  }catch{broken=true;error('Saved schedule request is invalid. Preserve it for manager recovery; no request was sent.');}
 }
 function save(record){const encoded=JSON.stringify(record);storage.setItem(key,encoded);if(storage.getItem(key)!==encoded)error('Schedule recovery could not be saved. Nothing was sent.');onState(COPY(record));}
 function pending(){const record=read();onState(record?COPY(record):null);return record;}
 async function send(record){
  if(busy)error('The exact schedule request is already in progress.');busy=true;
  try{let result,coordinationPending=false;
   try{result=await api(record.path,{method:'POST',body:record.encoded,expectedManagerId:managerId});}
   catch(failure){
    // The normal HTTP owner can return a committed, exact receipt alongside
    // failed later lease coordination. Validate it exactly like HTTP success.
    // Missing/unbound receipt is still uncertainty, never an invented success.
    if(failure?.acceptedResult!==undefined){result=validateReceipt(record.kind,failure.acceptedResult,record.body);coordinationPending=true;}
    else{if(failure?.serverRejected===true&&[400,401,403,409,422].includes(failure.status)){
     const current=read();if(current?.encoded===record.encoded)save({...current,state:'REJECTED',rejectionStatus:failure.status,error:String(failure.message||'Request rejected').slice(0,600)});
    }throw failure;}
   }
   const receipt=validateReceipt(record.kind,result,record.body);
   const current=read();if(!current||current.encoded!==record.encoded)error('Saved operation changed while the response was pending.');
   save({...current,state:'ACCEPTED',acceptance:receipt,coordination_pending:coordinationPending});return receipt;
  }finally{busy=false;}
 }
 function statusData(value,keys){
  if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype
   ||Reflect.ownKeys(value).length!==keys.length||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!keys.includes(key)))
   error('The original confirmation status is malformed; preserve the saved request.');
  const copy={};for(const key of keys){const field=Object.getOwnPropertyDescriptor(value,key);
   if(!field||!Object.hasOwn(field,'value'))error('The original confirmation status requires exact data fields.');copy[key]=field.value;}return copy;
 }
 function statusReceipt(record,value){
  const body=record.body,confirmationKey=record.kind==='initial'?body.idempotency_key:body.confirmation_key;
  const status=statusData(value,['schema','kind','state','confirmationKey','request','receipt']);
  if(status.schema!=='custodial.approved-static-confirmation-status.v1'||status.kind!==record.kind
   ||status.confirmationKey!==confirmationKey||!['NOT_FOUND','ACCEPTED'].includes(status.state))
   error('The original confirmation status does not match its saved operation.');
  if(status.state==='NOT_FOUND'){
   if(status.request!==null||status.receipt!==null)error('The original confirmation status is contradictory.');
   error('The original confirmation was not found. Its outcome remains unresolved; do not submit it again.');
  }
  const expected=record.kind==='initial'?{sourceId:body.source_id,effectiveStart:body.effective_start,
   templateId:body.template_id,expectedRevision:body.expected_revision,previewDigest:body.preview_digest,idempotencyKey:confirmationKey}:
   {publicationId:null,serviceDate:body.effective_start,kind:'RECURRING_STAFFING',templateId:body.template_id??null,
    expectedRevision:body.expected_revision,previewDigest:body.preview_digest,idempotencyKey:confirmationKey};
  const request=statusData(status.request,Object.keys(expected));
  if(Object.keys(expected).some(key=>request[key]!==expected[key]))error('The accepted original request differs from the saved selection.');
  return validateReceipt(record.kind,status.receipt,body);
 }
 async function readOriginalStatus(record){
  if(busy)error('The exact schedule request is already in progress.');
  const scheduler=root.MemphisSchedulerActions;
  const principal=()=>{const current=scheduler?.principal(auth);
   if(!current||current.managerId!==managerId||!scheduler.permissions(auth).management)
    error('Current named-manager write access is required to read the original confirmation.');return current;};
  const originalPrincipal=principal(),originalText=storage.getItem(key),originalRecord=JSON.stringify(record);
  const current=()=>{
   if(!scheduler.same(originalPrincipal,principal()))error('Manager access changed during original confirmation readback.');
   const observed=read();if(storage.getItem(key)!==originalText||JSON.stringify(observed)!==originalRecord)
    error('Saved operation changed during original confirmation readback. Preserve its current bytes.');
   return observed;
  };
  const confirmationKey=record.kind==='initial'?record.body.idempotency_key:record.body.confirmation_key;
  busy=true;
  try{
   current();
   const value=await api(paths[record.kind]+'/confirmations/'+encodeURIComponent(confirmationKey),{method:'GET',expectedManagerId:managerId});
   current();const receipt=statusReceipt(record,value);const observed=current();
   save({...observed,state:'ACCEPTED',acceptance:receipt});return receipt;
  }finally{busy=false;}
 }
 return Object.freeze({pending,isBlocked:()=>broken||!!read(),
  async confirm(kind,preview,input){if(read()||broken)error('Resolve the existing saved schedule confirmation first.');
   const selected=selectors(kind,input);if(preview?.previewDigest==null)error('Review an approved plan first.');
   const id=nonce();if(!UUID.test(id))error('Operation identity unavailable.');
   const body={...selected,preview_digest:preview.previewDigest,...(kind==='initial'?{idempotency_key:id}:{confirmation_key:id})};
   const record={schema:'custodial.approved-schedule-pending.v1',managerId,base,kind,path:paths[kind]+'/confirm',body,encoded:JSON.stringify(body),state:'PENDING',acceptance:null};
   save(record);return send(record);
  },
  async retry(){const record=read();if(!record)error('No saved schedule confirmation.');if(record.state==='REJECTED')error('This request was conclusively rejected. Refresh and dismiss it before reviewing a corrected preview.');return record.acceptance||readOriginalStatus(record);},
  discardRejected(){const record=read();if(busy||record?.state!=='REJECTED')error('Only an explicitly rejected request may be dismissed.');storage.removeItem(key);if(storage.getItem(key)!==null)error('Could not dismiss rejected request.');onState(null);},
  acknowledge(snapshot){const record=read();if(!record?.acceptance)error('Verified acceptance is required before clearing recovery.');
   const receipt=record.acceptance;
   if(snapshot?.week_start!==record.body.effective_start||snapshot.projection_status!=='current'||!Number.isSafeInteger(snapshot.authority_revision)
    ||snapshot.authority_revision<receipt.authority_revision||!snapshot.current_publication?.publication_id||!snapshot.latest_projection?.projection_id)error('Current schedule readback is incomplete; the accepted request stays saved.');
   if(snapshot.authority_revision===receipt.authority_revision&&(snapshot.current_publication.publication_id!==receipt.publication_id||snapshot.latest_projection.projection_id!==receipt.projection_id))error('Current schedule does not match its acceptance.');
   storage.removeItem(key);if(storage.getItem(key)!==null)error('Accepted receipt could not be cleared.');onState(null);return {current:snapshot.authority_revision===receipt.authority_revision,receipt:COPY(receipt)};
  }});
}
// Native/manual activation is distinct from the historical source/template flow.
const manualPath='/static-weekly/manual-activation';
function civilDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))return false;const n=Date.parse(value+'T12:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value;}
const sevenEnd=value=>new Date(Date.parse(value+'T12:00:00Z')+6*86400000).toISOString().slice(0,10);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exactFields=(value,fields)=>plain(value)&&Object.keys(value).length===fields.length&&fields.every(k=>Object.hasOwn(value,k));
function validateManualOptions(roster){
 const value=roster?.approvedManualActivation;
 if(value?.schema!=='custodial.approved-manual-activation-options.v2'||!civilDate(value.serviceDate)||!Number.isSafeInteger(value.authorityRevision)||value.authorityRevision<0
  ||roster.serviceDate!==value.serviceDate||roster.authorityRevision!==value.authorityRevision||!Array.isArray(value.choices)||value.choices.length>256)
  error('Current approved activation choices are unavailable. No activation was sent.');
 const seen=new Set();for(const row of value.choices){if(!exactFields(row,['packetId','label','serviceDate','windowEnd','expectedRevision','activationEligible'])
  ||!UUID.test(row.packetId||'')||typeof row.label!=='string'||!row.label.trim()||row.label.length>400||row.serviceDate!==value.serviceDate
  ||row.windowEnd!==sevenEnd(row.serviceDate)||row.expectedRevision!==value.authorityRevision||row.activationEligible!==true||seen.has(row.packetId))
  error('The server-listed activation selection is invalid.');seen.add(row.packetId);}
 const a=value.active;if(a!==null&&(!exactFields(a,['sourceId','publicationId','projectionId','authorityRevision','projectionStatus','normalSourceLocked','initialOperationId','initialProjectionId'])
  ||!UUID.test(a.sourceId||'')||!UUID.test(a.publicationId||'')||!(a.projectionId===null||UUID.test(a.projectionId||''))
  ||a.authorityRevision!==value.authorityRevision||typeof a.projectionStatus!=='string'||!a.projectionStatus||a.normalSourceLocked!==true
  ||!UUID.test(a.initialOperationId||'')||!UUID.test(a.initialProjectionId||'')))error('The accepted normal source status is unavailable.');
 return COPY(value);
}
function validateManualPreview(value,choice,managerId){
 if(value?.status==='CURRENT_TYPED_EMPLOYMENT_PACKET_REQUIRED'&&value.activationEligible===false)
  error('A current employment-aware approved packet is required. The original packet remains preserved; nothing was activated.');
 if(value?.schema!=='custodial.approved-manual-activation-preview.v2'||value.status!=='PREVIEW_ONLY'||value.published!==false
  ||value.managerId!==managerId||value.packetId!==choice.packetId||value.expectedRevision!==choice.expectedRevision
  ||value.serviceDate!==choice.serviceDate||value.windowEnd!==choice.windowEnd||!UUID.test(value.sourceId||'')
  ||!HASH.test(value.previewDigest||'')||!HASH.test(value.sourceDigest||'')||!HASH.test(value.packetPreviewDigest||'')||!HASH.test(value.packetFingerprint||'')
  ||value.operationIdRequired!==true||value.activationKind!=='INITIAL_EMPLOYMENT_OPERATIONALIZATION'||value.normalPatternSolverInvoked!==false
  ||value.operationalAdjustmentPending!==true||value.atomicRosterAndPublication!==true||value.currentPositions!==22||value.additionalCapacityPositions!==8
  ||value.prospectivePositions!==30||value.newEmployees!==0||!Array.isArray(value.employmentRevisionVector)||value.employmentRevisionVector.length!==14)
  error('The actual approved activation preview is incomplete or changed. Nothing was activated.');
 const seen=new Set();for(const row of value.employmentRevisionVector){const id=row?.serviceDate+':'+row?.employeeId;
  if(!exactFields(row,['serviceDate','employeeId','employmentRevision','requestId'])||!civilDate(row.serviceDate)||row.serviceDate<value.serviceDate||row.serviceDate>value.windowEnd
   ||!UUID.test(row.employeeId||'')||!Number.isSafeInteger(row.employmentRevision)||row.employmentRevision<0||!(row.requestId===null||UUID.test(row.requestId||''))||seen.has(id))
   error('The original seven-day employment bindings changed.');seen.add(id);}
 return COPY(value);
}
function validateManualReceipt(receipt,body,context,managerId){
 if(!receipt||!['PERSISTED_CURRENT','ACCEPTED_ORIGINAL_RECEIPT'].includes(receipt.status))error('Activation acceptance is unverified. Keep the exact original request.');
 if(receipt.schema==='custodial.approved-manual-activation-confirmation.v1'){
  if(body.operation_id!==undefined||receipt.ok!==true||receipt.persistence_status!=='PERSISTED'||receipt.packetId!==body.packet_id
   ||receipt.previewDigest!==body.preview_digest||receipt.solverInvoked!==false||!UUID.test(receipt.source_id||'')||!UUID.test(receipt.publication_id||'')
   ||!UUID.test(receipt.projection_id||'')||!HASH.test(receipt.lunch_document_identity||'')||!Number.isSafeInteger(receipt.authority_revision)
   ||receipt.authority_revision<=body.expected_revision||!civilDate(receipt.serviceDate)||receipt.windowEnd!==sevenEnd(receipt.serviceDate))error('The original v1 activation receipt does not match its saved request.');
 }else if(receipt.schema==='custodial.approved-manual-coverall-source-confirmation.v2'){
  if(!UUID.test(body.operation_id||'')||receipt.operationId!==body.operation_id||receipt.managerId!==managerId
   ||!UUID.test(receipt.sourceId||'')||!UUID.test(receipt.publicationId||'')||!UUID.test(receipt.projectionId||'')||!HASH.test(receipt.lunchDocumentIdentity||'')
   ||!Number.isSafeInteger(receipt.authorityRevision)||receipt.authorityRevision<=body.expected_revision||receipt.sourceId!==context?.sourceId
   ||receipt.frameStart!==context?.serviceDate||receipt.frameEnd!==context?.windowEnd||receipt.normalPatternSolverInvoked!==false
   ||typeof receipt.operationalSelectionSolverInvoked!=='boolean'||receipt.samePhysicalTransaction!==true||receipt.actualPositions!==30
   ||receipt.newEmployeesCreated!==false||receipt.weeklyBaselineChanged!==false
   ||JSON.stringify(receipt.employmentRevisionVector)!==JSON.stringify(context?.employmentRevisionVector)
   ||(receipt.packetId!==undefined&&receipt.packetId!==body.packet_id)||(receipt.previewDigest!==undefined&&receipt.previewDigest!==body.preview_digest)
   ||(receipt.idempotencyKey!==undefined&&receipt.idempotencyKey!==body.idempotency_key))error('The native activation receipt does not match its original operation and employment preview.');
 }else error('Unsupported activation receipt. Preserve the original request.');
 return COPY(receipt);
}
function createManualActivation({api,auth=root.MemphisAuth,managerId,baseUrl,storage=root.localStorage,nonce=()=>root.crypto.randomUUID(),otherPending=()=>false,onState=()=>{}}={}){
 if(typeof api!=='function'||!UUID.test(managerId||'')||typeof baseUrl!=='string')error('Current manager and scheduler service are required.');
 const base=new URL(baseUrl).origin,key='mz_manual_activation_pending_v1:'+encodeURIComponent(base)+':'+managerId;
 let busy=false,broken=false,choices=null,reviewed=null;
 const principal=()=>{const s=root.MemphisSchedulerActions,p=s?.principal(auth);if(!p||p.managerId!==managerId||!s.permissions(auth).management)error('Current leadership management access is required. Original activation remains saved.');return p;};
 const same=(a,b)=>root.MemphisSchedulerActions.same(a,b);
 function read(){let text;try{text=storage.getItem(key);}catch{broken=true;error('Original activation recovery cannot be read.');}if(text===null)return null;
  try{const r=JSON.parse(text),b=r.body;if(text.length>12000||!['custodial.manual-activation-pending.v1','custodial.manual-activation-pending.v2'].includes(r.schema)
   ||r.managerId!==managerId||r.base!==base||r.path!==manualPath+'/confirm'||r.encoded!==JSON.stringify(b)||!['PENDING','ACCEPTED','REJECTED'].includes(r.state)
   ||!exactFields(b,b?.operation_id===undefined?['packet_id','expected_revision','preview_digest','idempotency_key']:['packet_id','operation_id','expected_revision','preview_digest','idempotency_key'])
   ||!UUID.test(b.packet_id||'')||!Number.isSafeInteger(b.expected_revision)||b.expected_revision<0||!HASH.test(b.preview_digest||'')||!UUID.test(b.idempotency_key||'')
   ||(b.operation_id!==undefined&&!UUID.test(b.operation_id))||(r.state==='ACCEPTED'&&!r.acceptance)
   ||(r.state==='REJECTED'&&(r.acceptance||![400,401,403,409,422].includes(r.rejectionStatus)||typeof r.error!=='string')))throw Error();
   if(r.acceptance)validateManualReceipt(r.acceptance,b,r.context,managerId);return r;
  }catch{broken=true;error('Original activation recovery is invalid. Preserve its bytes; no request was sent.');}}
 function save(r){const text=JSON.stringify(r);storage.setItem(key,text);if(storage.getItem(key)!==text)error('Original activation could not be saved. Nothing was sent.');onState(COPY(r));}
 function pending(){const r=read();onState(r?COPY(r):null);return r;}
 async function bound(path,options,record=null){const actor=principal(),raw=record?storage.getItem(key):null;if(record&&raw!==JSON.stringify(record))error('Original activation changed before dispatch.');
  const current=()=>{if(!same(actor,principal()))error('Manager access changed. Original activation remains saved.');if(record&&storage.getItem(key)!==raw)error('Original activation changed during readback. Preserve current bytes.');};
  current();try{const value=await api(path,{...options,expectedManagerId:managerId});current();return value;}catch(e){current();throw e;}}
 return Object.freeze({pending,isBlocked:()=>broken||!!read(),
  async load(){choices=validateManualOptions(await bound(manualPath+'/roster',{method:'GET'}));reviewed=null;return COPY(choices);},
  async preview(packetId){if(busy||read()||broken||otherPending())error('Resolve the saved scheduler operation first.');const choice=choices?.choices.find(x=>x.packetId===packetId);if(!choice||choices.active)error('Select a current server-listed approved activation packet.');busy=true;
   try{const value=await bound(manualPath+'/preview',{method:'POST',body:JSON.stringify({packet_id:choice.packetId,expected_revision:choice.expectedRevision})});reviewed=validateManualPreview(value,choice,managerId);return COPY(reviewed);}finally{busy=false;}},
  async confirm(preview){if(busy||read()||broken||otherPending()||!reviewed||JSON.stringify(preview)!==JSON.stringify(reviewed))error('Review the current original activation preview first.');
   const operation=nonce(),idempotency=nonce();if(!UUID.test(operation)||!UUID.test(idempotency)||operation===idempotency)error('Distinct original activation identities are required.');
   const body={packet_id:reviewed.packetId,operation_id:operation,expected_revision:reviewed.expectedRevision,preview_digest:reviewed.previewDigest,idempotency_key:idempotency};
   const r={schema:'custodial.manual-activation-pending.v2',managerId,base,path:manualPath+'/confirm',body,encoded:JSON.stringify(body),state:'PENDING',acceptance:null,
    context:{sourceId:reviewed.sourceId,serviceDate:reviewed.serviceDate,windowEnd:reviewed.windowEnd,employmentRevisionVector:COPY(reviewed.employmentRevisionVector)}};save(r);busy=true;
   try{let receipt;try{receipt=await bound(r.path,{method:'POST',body:r.encoded},r);}catch(e){if(e.acceptedResult!==undefined)receipt=e.acceptedResult;
    else{if(e.serverRejected===true&&[400,401,403,409,422].includes(e.status))save({...r,state:'REJECTED',rejectionStatus:e.status,error:String(e.message).slice(0,600)});throw e;}}
    const accepted=validateManualReceipt(receipt,body,r.context,managerId);save({...r,state:'ACCEPTED',acceptance:accepted});return accepted;
   }finally{busy=false;reviewed=null;}},
  async recover(){const r=read();if(!r||busy)error('No available original activation recovery.');busy=true;
   try{const query=new URLSearchParams({idempotency_key:r.body.idempotency_key,...(r.body.operation_id?{operation_id:r.body.operation_id}:{})});
    const status=await bound(manualPath+'/outcome?'+query,{method:'GET'},r);
    if(!['custodial.approved-manual-activation-status.v1','custodial.approved-manual-activation-status.v2'].includes(status?.schema)
     ||status.idempotencyKey!==r.body.idempotency_key||status.doesNotAuthorizeRetry!==true||!['ACCEPTED','NOT_FOUND'].includes(status.state)
     ||(r.body.operation_id&&status.operationId!==r.body.operation_id))error('Original activation status is unverified. Do not submit it again.');
    if(status.state==='NOT_FOUND')error('Original activation was not found. Its outcome is unresolved; no confirmation will be resent.');
    const wanted={managerId,packetId:r.body.packet_id,...(r.body.operation_id?{operationId:r.body.operation_id}:{}),expectedRevision:r.body.expected_revision,previewDigest:r.body.preview_digest,idempotencyKey:r.body.idempotency_key};
    if(!exactFields(status.original?.request,Object.keys(wanted))||Object.keys(wanted).some(k=>status.original.request[k]!==wanted[k])
     ||(r.body.operation_id&&status.original.operationId!==r.body.operation_id))error('Original activation request identity changed. Keep the saved request.');
    const accepted=validateManualReceipt(status.original.receipt,r.body,r.context,managerId);save({...r,state:'ACCEPTED',acceptance:accepted});return accepted;
   }finally{busy=false;}},
  acknowledge(snapshot){const r=read();if(!r?.acceptance)error('Verified original acceptance required.');const a=r.acceptance,v2=a.schema==='custodial.approved-manual-coverall-source-confirmation.v2',revision=v2?a.authorityRevision:a.authority_revision,pub=v2?a.publicationId:a.publication_id,proj=v2?a.projectionId:a.projection_id;
   if(snapshot?.projection_status!=='current'||!Number.isSafeInteger(snapshot.authority_revision)||snapshot.authority_revision<revision||snapshot.current_publication?.publication_id!==pub
    ||!UUID.test(snapshot.latest_projection?.projection_id||'')||(snapshot.authority_revision===revision&&snapshot.latest_projection.projection_id!==proj))error('Accepted activation remains saved until exact current schedule readback.');
   storage.removeItem(key);if(storage.getItem(key)!==null)error('Accepted activation recovery could not be retired.');onState(null);return COPY(a);},
  discardRejected(){const r=read();if(busy||r?.state!=='REJECTED')error('Only a conclusively rejected original activation may be dismissed.');storage.removeItem(key);if(storage.getItem(key)!==null)error('Rejected activation remains saved.');onState(null);reviewed=null;},
  clearPreview(){reviewed=null;}
 });
}

function mountManualActivation({container,before,api,auth,managerId,baseUrl,storage,nonce,otherPending=()=>false,available=()=>true,onState=()=>{},onBusy=()=>{},onAccepted=async()=>null}={}){
 const doc=container?.ownerDocument||root.document;if(!doc||!container)error('Activation panel is unavailable.');
 const panel=doc.createElement('section');panel.id='manual-activation-panel';panel.className='status';panel.hidden=true;
 const node=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;},title=node('h2','Approved normal schedule activation'),status=node('p','Reading current approved activation choices…'),label=node('label','Approved staffing plan '),select=node('select'),summary=node('p'),buttons=node('div');status.setAttribute('role','status');status.setAttribute('aria-live','polite');select.id='manual-activation-choice';label.append(select);
 const button=(id,text)=>{const b=node('button',text);b.id=id;b.type='button';b.className='btn';buttons.append(b);return b;};
 const refresh=button('manual-activation-refresh','Refresh approved activation'),previewButton=button('manual-activation-preview','Preview approved activation'),confirmButton=button('manual-activation-confirm','Activate reviewed schedule'),recover=button('manual-activation-recover','Read original activation outcome'),dismiss=button('manual-activation-dismiss','Dismiss rejected activation');
 panel.append(title,status,label,summary,buttons);container.insertBefore(panel,before||null);
 let options=null,preview=null,busy=false,record=null;
 const controller=createManualActivation({api,auth,managerId,baseUrl,storage,nonce,otherPending,onState:r=>{record=r;onState(r);refreshControls();}});
 function allowed(){try{return available()&&root.MemphisSchedulerActions.principal(auth)?.managerId===managerId&&root.MemphisSchedulerActions.permissions(auth).management===true;}catch{return false;}}
 function refreshControls(){panel.hidden=!allowed();const held=busy||otherPending()||!allowed(),locked=!!options?.active;select.hidden=locked;label.hidden=locked;select.disabled=held||!!record;
  refresh.disabled=busy||!allowed();previewButton.hidden=locked;previewButton.disabled=held||!!record||!select.value;
  confirmButton.hidden=locked||!preview;confirmButton.disabled=held||!!record||!preview;recover.hidden=!record;recover.disabled=busy||!allowed();dismiss.hidden=record?.state!=='REJECTED';dismiss.disabled=busy||!allowed();
  if(record)status.textContent=record.state==='ACCEPTED'?'The original activation was accepted. Its receipt is saved until current schedule readback.':record.state==='REJECTED'?'The original activation was conclusively rejected. Its request is preserved; refresh before dismissing.':'The original activation outcome is unresolved. Read its exact outcome; confirmation will not be resent.';
 }
 async function run(work){if(busy)return;busy=true;onBusy(true);refreshControls();try{await work();}catch(e){status.textContent=(record?.state==='ACCEPTED'?'Accepted receipt remains saved. ':'')+String(e.message||e);}finally{busy=false;onBusy(false);refreshControls();}}
 async function load(){preview=null;options=await controller.load();select.replaceChildren();const empty=node('option','Select an approved staffing plan');empty.value='';select.append(empty);
  for(const choice of options.choices){const o=node('option',choice.label+' · '+choice.serviceDate+' through '+choice.windowEnd);o.value=choice.packetId;select.append(o);}
  if(options.active){const a=options.active;title.textContent='Active approved normal source — locked';status.textContent=a.projectionStatus==='current'&&a.projectionId?'The approved normal source is active and locked. Current dated coverage is available.':'The approved normal source is locked. Current dated coverage: '+a.projectionStatus+'. Refresh the current schedule before relying on coverage.';summary.textContent='The seven normal views remain read-only. Use the existing absence/PTO workflow for dated changes; no normal schedule is regenerated here.';}
  else{title.textContent='Approved normal schedule activation';status.textContent=options.choices.length?'Select the current server-approved staffing plan, then review before activation.':'No current approved activation packet is available. Nothing can be activated.';summary.textContent='Only current approved choices are listed. Staffing, employment and the operational schedule are validated together during activation.';}
  refreshControls();return options;
 }
 async function accept(work){const receipt=await work();preview=null;status.textContent='Activation accepted. Reading the current schedule…';const snapshot=await onAccepted(receipt);controller.acknowledge(snapshot);await load();}
 refresh.addEventListener('click',()=>run(load));select.addEventListener('change',()=>{preview=null;controller.clearPreview();summary.textContent='Review the selected approved plan before activation.';refreshControls();});
 previewButton.addEventListener('click',()=>run(async()=>{preview=await controller.preview(select.value);summary.textContent='Approved staffing basis for '+preview.serviceDate+' through '+preview.windowEnd+' · '+preview.currentPositions+' existing positions + '+preview.additionalCapacityPositions+' approved capacity positions; no new employees. The normal pattern stays fixed. Final operational placement is prepared and validated atomically on confirmation.';status.textContent='Preview only — nothing activated. Review the staffing basis before confirming.';}));
 confirmButton.addEventListener('click',()=>run(()=>accept(()=>controller.confirm(preview))));recover.addEventListener('click',()=>run(()=>accept(()=>controller.recover())));
 dismiss.addEventListener('click',()=>run(async()=>{await load();controller.discardRejected();await load();}));
 controller.pending();refreshControls();
 return Object.freeze({load,refreshControls,pending:controller.pending,normalLocked:()=>!!options?.active,acknowledge:controller.acknowledge,element:panel});
}

const api=Object.freeze({mountManualActivation,createManualActivation,validateManualOptions,validateManualPreview,validateManualReceipt,manualPath,create,selectors,validatePreview,validateReceipt,validateUnresolvedPreview,unresolvedReasons,validSnapshotWindow,loadInitialEntry,selectInitial,paths});root.MemphisApprovedSchedule=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
