import {isIsoServiceDate,serviceDateWeekday} from './static-weekly-schedule-model.js';

export const APPROVED_INITIAL_REQUEST_ERROR='static_weekly_approved_initial_request_invalid';
const invalid=()=>{throw Object.assign(new Error('Initial schedule accepts only a registered source, approved template, effective Monday and exact revision/confirmation identity.'),{code:APPROVED_INITIAL_REQUEST_ERROR});};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const bounded=(value,max)=>typeof value==='string'&&value.length>=1&&value.length<=max&&value===value.trim()&&!/[\x00-\x1f\x7f]/.test(value);

// The route accepts identities, not a client-produced schedule or permission.
// Both commands reach the already verified distinct fixed-baseline SQL path.
export function approvedInitialRequest(body,{confirm=false}={}){
 const keys=['source_id','effective_start','template_id','expected_revision',...(confirm?['preview_digest','idempotency_key']:[])];
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==keys.length
  ||keys.some(k=>!Object.hasOwn(body,k)))invalid();
 if(typeof body.source_id!=='string'||!uuid.test(body.source_id)
  ||typeof body.effective_start!=='string'||body.effective_start.startsWith('0000-')
  ||!isIsoServiceDate(body.effective_start)||serviceDateWeekday(body.effective_start)!==1
  ||!bounded(body.template_id,128)||!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0)invalid();
 if(confirm&&(!bounded(body.idempotency_key,200)||typeof body.preview_digest!=='string'||!/^[a-f0-9]{64}$/.test(body.preview_digest)))invalid();
 return Object.freeze({sourceId:body.source_id,effectiveStart:body.effective_start,templateId:body.template_id,
  expectedRevision:body.expected_revision,...(confirm?{previewDigest:body.preview_digest,idempotencyKey:body.idempotency_key}:{})});
}
