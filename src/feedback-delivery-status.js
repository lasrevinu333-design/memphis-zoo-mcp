import {createHash} from 'node:crypto';
import {normalizeFeedbackInput} from './public-submission-controls.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(['queued','claimed','outcome_unknown','connector_accepted','sent_observed','inbox_observed','needs_attention','not_enrolled']);
const EVIDENCE=new Set(['not_enrolled','no_send_evidence','outcome_unknown','connector_accepted','sent_observed','inbox_observed']);
// Fixed relay.v2 transition/readback relationship. A held attention state can
// retain earlier positive evidence; it must not turn that evidence into a new
// send or hide duplicate attention. No other state can outrank its receipts.
const STATE_EVIDENCE=Object.freeze({not_enrolled:['not_enrolled'],queued:['no_send_evidence'],claimed:['no_send_evidence'],
  outcome_unknown:['outcome_unknown'],connector_accepted:['connector_accepted'],sent_observed:['sent_observed'],inbox_observed:['inbox_observed'],
  needs_attention:['no_send_evidence','outcome_unknown','connector_accepted','sent_observed','inbox_observed']});
export const unknownFeedbackDelivery=()=>({state:'unavailable',evidence_state:'unavailable',relay_paused:null,needs_attention:false,possible_duplicate:false,protected_attachment_pending:false});

// Only persisted canonical readback may issue an employee cleanup receipt.
// It binds normalized submitted content and original actor, not email delivery.
export function employeeFeedbackReceipt(item){
  let metadata=item?.metadata_json;if(typeof metadata==='string'){try{metadata=JSON.parse(metadata);}catch{return null;}}
  const actor=metadata?.identity_verification,image=metadata?.image_attachment;
  if(!UUID.test(item?.id)||!UUID.test(item?.operation_id)||!/^[a-f0-9]{64}$/i.test(item?.request_fingerprint||'')
    ||item?.hub_context!=='employee'||actor?.status!=='verified'||actor?.kind!=='enrolled_employee_device'
    ||!UUID.test(actor?.employee_id)||typeof item?.device_id!=='string'||!item.device_id||actor?.device_id!==item.device_id
    ||(image&&!/^[a-f0-9]{64}$/.test(image.sha256||'')))return null;
  try{
    const {category,priority,message,pageUrl}=normalizeFeedbackInput(item);
    return Object.freeze({schema:'employee-feedback-receipt.v1',device_id:item.device_id,employee_id:actor.employee_id.toLowerCase(),
      content_sha256:createHash('sha256').update(JSON.stringify([category,priority,message,pageUrl,image?.sha256||null])).digest('hex')});
  }catch{return null;}
}

// Called only after submission authority/readback or named-manager list auth.
// Never use IDs supplied by an unauthenticated status endpoint.
export async function attachFeedbackDelivery(rows,{client}={}) {
  if(!Array.isArray(rows)||rows.length>500||rows.some(row=>!UUID.test(row?.id||'')))throw new TypeError('Expected a bounded authorized feedback result.');
  const values=new Map();
  try{
    if(!client?.rpc)throw new Error('Status authority unavailable');
    for(let offset=0;offset<rows.length;offset+=100){
      const ids=[...new Set(rows.slice(offset,offset+100).map(row=>row.id))];
      const {data,error}=await client.rpc('custodial_feedback_delivery_status',{p_feedback_ids:ids});
      if(error||!Array.isArray(data)||data.length!==ids.length)throw new Error('Incomplete status readback');
      const seen=new Set();
      for(const result of data){
        if(!ids.includes(result?.feedback_id)||seen.has(result.feedback_id)||!STATES.has(result.state)||!EVIDENCE.has(result.evidence_state)
          ||!STATE_EVIDENCE[result.state].includes(result.evidence_state)
          ||result.needs_attention!==(result.state==='needs_attention'||result.possible_duplicate===true)
          ||['relay_paused','needs_attention','possible_duplicate','protected_attachment_pending'].some(key=>typeof result[key]!=='boolean'))throw new Error('Invalid status readback');
        seen.add(result.feedback_id);
        const {state,evidence_state,relay_paused,needs_attention,possible_duplicate,protected_attachment_pending}=result;
        values.set(result.feedback_id,{state,evidence_state,relay_paused,needs_attention,possible_duplicate,protected_attachment_pending});
      }
    }
  }catch{
    // Persistence already succeeded. Do not turn a mail-status outage into a
    // second submission or fabricate a queued/delivered result.
    values.clear();
  }
  return rows.map(row=>({...row,email_delivery:values.get(row.id)||unknownFeedbackDelivery()}));
}
