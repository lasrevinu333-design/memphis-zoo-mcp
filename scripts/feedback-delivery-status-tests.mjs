import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {attachFeedbackDelivery,unknownFeedbackDelivery} from '../src/feedback-delivery-status.js';
let checks=0;const same=(a,b)=>{assert.deepEqual(a,b);checks++;};
const row={id:randomUUID(),message:'Full original message',status:'acknowledged',notification_status:'historical'};
const status=(id,state='queued',evidence_state='no_send_evidence')=>({feedback_id:id,state,evidence_state,relay_paused:true,needs_attention:false,possible_duplicate:false,protected_attachment_pending:false});
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
