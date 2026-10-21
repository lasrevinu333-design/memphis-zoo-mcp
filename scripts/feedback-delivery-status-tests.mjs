import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {attachFeedbackDelivery,unknownFeedbackDelivery,employeeFeedbackReceipt} from '../src/feedback-delivery-status.js';
if(process.argv.includes('--main-receipt-mount-only')){
 const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 assert.match(source,/import \{ attachFeedbackDelivery, employeeFeedbackReceipt \} from "\.\/feedback-delivery-status\.js"/);
 const route=source.slice(source.indexOf('app.post("/feedback-api/submit"'),source.indexOf('app.post("/feedback-api/submit"')+2600);
 assert.match(route,/publicSubmissionRateLimit\("feedback"\), requireFeedbackSubmitAuthority/);
 assert.match(route,/const item = await createSystemFeedbackItem/);
 const literal=route.match(/const safeItem = (\{[\s\S]*?\n    \});/);assert(literal);
 const project=new Function('item','deliveryItem','employeeFeedbackReceipt','return ('+literal[1]+');');
 const row={id:'11111111-1111-4111-8111-111111111111',operation_id:'22222222-2222-4222-8222-222222222222',
  request_fingerprint:'a'.repeat(64),category:'app_problem',priority:'normal',message:'Synthetic original ñ zero0',
  page_url:'employee-feedback.html',hub_context:'employee',device_id:'KIOSK_SYNTHETIC',status:'new',
  notification_status:'queued',created_at:'2026-10-11T00:00:00Z',newly_inserted:true,
  metadata_json:{identity_verification:{status:'verified',kind:'enrolled_employee_device',device_id:'KIOSK_SYNTHETIC',employee_id:'33333333-3333-4333-8333-333333333333'}}};
 const {createFeedbackOutbox}=await import('../../frontend/mobile/src/custodial/feedback-outbox.js');
 const run=async supplied=>{
  const memory=new Map(),storage={get length(){return memory.size;},key:i=>[...memory.keys()][i],getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  let sent=0;const box=createFeedbackOutbox({storage,mutate:fn=>fn({deviceId:row.device_id,generation:1}),
   identity:async()=>({deviceId:row.device_id,employeeId:row.metadata_json.identity_verification.employee_id}),online:()=>true,
   request:async()=>{sent++;return{ok:true,meta:{contract_version:'feedback.v3.enrolled-authority'},data:{item:project(supplied,{email_delivery:unknownFeedbackDelivery()},employeeFeedbackReceipt)}};}});
  await box.save({operation_id:row.operation_id,category:row.category,priority:row.priority,message:row.message,page_url:row.page_url});
  const original=[...memory.values()][0],accepted=await box.flush();return{memory,original,accepted,sent};
 };
 const valid=await run(row);assert.deepEqual(valid.accepted,[row.operation_id]);assert.equal(valid.memory.size,0);assert.equal(valid.sent,1);
 const absent=structuredClone(row);delete absent.request_fingerprint;const missing=await run(absent);
 assert.deepEqual(missing.accepted,[]);assert.equal([...missing.memory.values()][0],missing.original);
 const foreign=structuredClone(row);foreign.metadata_json.identity_verification.employee_id='44444444-4444-4444-8444-444444444444';
 const mismatched=await run(foreign);assert.deepEqual(mismatched.accepted,[]);assert.equal([...mismatched.memory.values()][0],mismatched.original);
 console.log(JSON.stringify({status:'MAIN_CANONICAL_SAFEITEM_TO_OUTBOX_MOUNT_PASS',cases:3,at_utc:new Date().toISOString(),
  actualSourceLiteralAndBothModules:true,SQL_HTTP_Auth:false,InboxDelivered:false,oldCasesReplayed:false}));process.exit(0);
}
async function affectedReceiptCases(){
 const row={id:'11111111-1111-4111-8111-111111111111',operation_id:'22222222-2222-4222-8222-222222222222',request_fingerprint:'a'.repeat(64),category:'need_help',priority:'normal',message:'Synthetic ñ original\nzero0',page_url:'employee-feedback.html',hub_context:'employee',device_id:'KIOSK_SYNTHETIC',metadata_json:{identity_verification:{status:'verified',kind:'enrolled_employee_device',device_id:'KIOSK_SYNTHETIC',employee_id:'33333333-3333-4333-8333-333333333333'}}};
 let cases=0;const expected=employeeFeedbackReceipt(row);assert.equal(expected.employee_id,row.metadata_json.identity_verification.employee_id);assert.equal(expected.device_id,row.device_id);assert.deepEqual(Object.keys(expected),['schema','device_id','employee_id','content_sha256']);assert.equal(Object.isFrozen(expected),true);assert.equal(expected.content_sha256.length,64);cases++;
 for(const change of [r=>{delete r.request_fingerprint;},r=>{r.device_id='OTHER';},r=>{r.metadata_json.identity_verification.kind='caller';},r=>{r.metadata_json.identity_verification.status='unverified';},r=>{r.metadata_json.identity_verification.employee_id='invalid';},r=>{r.metadata_json.image_attachment={sha256:'missing'};},r=>{r.metadata_json='{invalid';},r=>{r.hub_context='manager';}]){const clone=structuredClone(row);change(clone);assert.equal(employeeFeedbackReceipt(clone),null);cases++;}
 for(const field of ['message','category','priority','page_url']){const clone=structuredClone(row);clone[field]=({message:'Changed original',category:'app_problem',priority:'high',page_url:'other.html'})[field];assert.notEqual(employeeFeedbackReceipt(clone).content_sha256,expected.content_sha256);cases++;}
 const image=structuredClone(row);image.metadata_json.image_attachment={sha256:'b'.repeat(64),storage_path:'private',base64:'never return'};assert.notEqual(employeeFeedbackReceipt(image).content_sha256,expected.content_sha256);assert.deepEqual(employeeFeedbackReceipt({...row,metadata_json:JSON.stringify(row.metadata_json)}),expected);assert.deepEqual(employeeFeedbackReceipt({...row,message:' '+row.message+' ',category:' NEED_HELP ',priority:' NORMAL '}),expected);assert.equal(JSON.stringify(row).includes('never return'),false);cases++;
 console.log(JSON.stringify({status:'FEEDBACK_CANONICAL_RECEIPT_PASS',cases,at_utc:new Date().toISOString(),rows:'synthetic canonical readback',realAuth:false,sql:false,mailDelivered:false}));
}
if(process.argv.includes('--affected-receipt-only')){await affectedReceiptCases();process.exit(0);}
async function affectedProjectionCases(){
 const id='11111111-1111-4111-8111-111111111111',original={id,message:'Synthetic original ñ text',operation_id:'22222222-2222-4222-8222-222222222222'};
 const result=(state,evidence_state,extras={})=>({feedback_id:id,state,evidence_state,relay_paused:true,needs_attention:state==='needs_attention',possible_duplicate:false,protected_attachment_pending:false,...extras});
 const project=async value=>(await attachFeedbackDelivery([original],{client:{rpc:async()=>({data:[value]})}}))[0];
 let cases=0;
 for(const value of [result('queued','inbox_observed'),result('connector_accepted','inbox_observed'),result('outcome_unknown','sent_observed'),result('inbox_observed','no_send_evidence'),result('needs_attention','not_enrolled'),result('needs_attention','no_send_evidence',{needs_attention:false}),result('sent_observed','sent_observed',{possible_duplicate:true,needs_attention:false})]){
  const actual=await project(value);assert.deepEqual(actual.email_delivery,unknownFeedbackDelivery(),'contradictory status cannot claim delivery evidence');assert.equal(actual.message,original.message);assert.equal(actual.operation_id,original.operation_id);cases++;
 }
 for(const evidence of ['no_send_evidence','outcome_unknown','connector_accepted','sent_observed']){
  const actual=await project(result('needs_attention',evidence));assert.equal(actual.email_delivery.state,'needs_attention');assert.equal(actual.email_delivery.evidence_state,evidence);cases++;
 }
 const duplicate=await project(result('inbox_observed','inbox_observed',{possible_duplicate:true,needs_attention:true}));assert.equal(duplicate.email_delivery.evidence_state,'inbox_observed');assert.equal(duplicate.email_delivery.possible_duplicate,true);cases++;
 console.log(JSON.stringify({status:'FEEDBACK_DELIVERY_AFFECTED_PROJECTION_PASS',cases,at_utc:new Date().toISOString(),rpc_synthetic:true,provider_sent_or_inbox_proof:false}));
}
if(process.argv.includes('--affected-projection-only')){await affectedProjectionCases();process.exit(0);}
let checks=0;const same=(a,b)=>{assert.deepEqual(a,b);checks++;};
const row={id:randomUUID(),message:'Full original message',status:'acknowledged',notification_status:'historical'};
const status=(id,state='queued',evidence_state='no_send_evidence')=>({feedback_id:id,state,evidence_state,relay_paused:true,needs_attention:state==='needs_attention',possible_duplicate:false,protected_attachment_pending:false});
for(const [state,evidence] of [['queued','no_send_evidence'],['claimed','no_send_evidence'],['outcome_unknown','outcome_unknown'],['connector_accepted','connector_accepted'],['sent_observed','sent_observed'],['inbox_observed','inbox_observed'],['needs_attention','inbox_observed'],['not_enrolled','not_enrolled']]){
 const before=structuredClone(row);const received=status(row.id,state,evidence);
 const [result]=await attachFeedbackDelivery([row],{client:{rpc:async(name,args)=>{same(name,'custodial_feedback_delivery_status');same(args,{p_feedback_ids:[row.id]});return {data:[{...received,claim_token:'never expose',email_text:'never expose'}]};}}});
 same(result.email_delivery.state,state);same(result.email_delivery.evidence_state,evidence);same(Object.hasOwn(result.email_delivery,'claim_token'),false);same(row,before);same(result.message,row.message);same(result.status,'acknowledged');
}
for(const response of [{error:{message:'outage'}},{data:[]},{data:[status(randomUUID())]},{data:[status(row.id),status(row.id)]},{data:[{...status(row.id),relay_paused:'false'}]},{data:[status(row.id,'sent')]}]){
 same((await attachFeedbackDelivery([row],{client:{rpc:async()=>response}}))[0].email_delivery,unknownFeedbackDelivery());
}
same((await attachFeedbackDelivery([row]))[0].email_delivery,unknownFeedbackDelivery());
await assert.rejects(()=>attachFeedbackDelivery([{id:'not-uuid'}]));checks++;
const rows=Array.from({length:205},()=>({id:randomUUID()}));const lengths=[];
const complete=await attachFeedbackDelivery(rows,{client:{rpc:async(_,args)=>{lengths.push(args.p_feedback_ids.length);return {data:args.p_feedback_ids.map(id=>status(id))};}}});
same(lengths,[100,100,5]);same(complete.length,205);same(complete.every(r=>r.email_delivery.state==='queued'),true);
let call=0;const failed=await attachFeedbackDelivery(rows,{client:{rpc:async(_,args)=>++call===2?{error:{}}:{data:args.p_feedback_ids.map(id=>status(id))}}});
same(failed.every(r=>r.email_delivery.state==='unavailable'),true);
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
assert.match(source,/app\.post\("\/feedback-api\/submit", publicSubmissionRateLimit\("feedback"\), requireFeedbackSubmitAuthority/);checks++;
assert.match(source,/app\.get\("\/dashboard-api\/system-feedback", requireOpsManagerAuth/);checks++;
assert.match(source,/attachFeedbackDelivery\(await listSystemFeedbackItems/);checks++;
console.log(JSON.stringify({status:'FEEDBACK_DELIVERY_STATUS_ADAPTER_PASS',checks,mailSent:false}));
