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
 if(value?.schema!==schemas[kind]+'-preview.v1'||value.status!=='PREVIEW_ONLY'||value.published!==false||value.solverInvoked!==false
  ||value.serviceDate!==selected.effective_start||value.authorityRevision!==selected.expected_revision||!HASH.test(value.previewDigest||'')
  ||typeof value.templateId!=='string'||!value.templateId||!Array.isArray(value.assignments)||!value.assignments.length||value.assignments.length>10000
  ||!Array.isArray(value.lunch?.loans)||!Array.isArray(value.lunch?.responsibilities)||value.lunch.loans.length>1000||value.lunch.responsibilities.length>10000
  ||!value.mapping||typeof value.mapping!=='object')error('The approved schedule preview is incomplete or mismatched. Nothing was published.');
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
function create({api,managerId,baseUrl,storage=root.localStorage,nonce=()=>root.crypto.randomUUID(),onState=()=>{}}={}){
 if(typeof api!=='function'||!UUID.test(managerId||'')||typeof baseUrl!=='string')error('Current manager and scheduler service are required.');
 const base=new URL(baseUrl).origin,key='mz_approved_schedule_pending_v1:'+encodeURIComponent(base)+':'+managerId;
 let busy=false,broken=false;
 function read(){
  let text;try{text=storage.getItem(key);}catch{broken=true;error('Saved schedule recovery cannot be read.');}
  if(!text)return null;
  try{
   const record=JSON.parse(text);if(text.length>12000||record.schema!=='custodial.approved-schedule-pending.v1'||record.managerId!==managerId||record.base!==base
    ||!Object.hasOwn(paths,record.kind)||record.path!==paths[record.kind]+'/confirm'||typeof record.encoded!=='string'||JSON.stringify(record.body)!==record.encoded)throw Error();
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
  try{const result=await api(record.path,{method:'POST',body:record.encoded,expectedManagerId:managerId});
   const receipt=validateReceipt(record.kind,result,record.body);
   const current=read();if(!current||current.encoded!==record.encoded)error('Saved operation changed while the response was pending.');
   save({...current,acceptance:receipt});return receipt;
  }finally{busy=false;}
 }
 return Object.freeze({pending,isBlocked:()=>broken||!!read(),
  async confirm(kind,preview,input){if(read()||broken)error('Resolve the existing saved schedule confirmation first.');
   const selected=selectors(kind,input);if(preview?.previewDigest==null)error('Review an approved plan first.');
   const id=nonce();if(!UUID.test(id))error('Operation identity unavailable.');
   const body={...selected,preview_digest:preview.previewDigest,...(kind==='initial'?{idempotency_key:id}:{confirmation_key:id})};
   const record={schema:'custodial.approved-schedule-pending.v1',managerId,base,kind,path:paths[kind]+'/confirm',body,encoded:JSON.stringify(body),acceptance:null};
   save(record);return send(record);
  },
  async retry(){const record=read();if(!record)error('No saved schedule confirmation.');return record.acceptance||send(record);},
  acknowledge(snapshot){const record=read();if(!record?.acceptance)error('Verified acceptance is required before clearing recovery.');
   const receipt=record.acceptance;
   if(snapshot?.week_start!==record.body.effective_start||snapshot.projection_status!=='current'||!Number.isSafeInteger(snapshot.authority_revision)
    ||snapshot.authority_revision<receipt.authority_revision||!snapshot.current_publication?.publication_id||!snapshot.latest_projection?.projection_id)error('Current schedule readback is incomplete; the accepted request stays saved.');
   if(snapshot.authority_revision===receipt.authority_revision&&(snapshot.current_publication.publication_id!==receipt.publication_id||snapshot.latest_projection.projection_id!==receipt.projection_id))error('Current schedule does not match its acceptance.');
   storage.removeItem(key);if(storage.getItem(key)!==null)error('Accepted receipt could not be cleared.');onState(null);return {current:snapshot.authority_revision===receipt.authority_revision,receipt:COPY(receipt)};
  }});
}
const api=Object.freeze({create,selectors,validatePreview,validateReceipt,paths});root.MemphisApprovedSchedule=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
