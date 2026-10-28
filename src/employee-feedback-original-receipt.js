import { authoritativeFeedbackPayload } from './feedback-authority.js';
import { employeeFeedbackReceipt } from './feedback-delivery-status.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const unavailable=()=>Object.assign(new Error('Original feedback receipt is not confirmed. Keep the saved original.'),{status:409});

// Mounted behind the same current employee credential middleware as submit.
// This reader cannot insert, send mail, recreate a purged row, or retire data.
export function makeEmployeeFeedbackOriginalReceiptReader({readItem,revalidate}) {
  if(typeof readItem!=='function'||typeof revalidate!=='function')throw new TypeError('Fixed original reader and current authority required.');
  return async request=>{
    const operationId=request.body?.operation_id;
    if(!UUID.test(operationId||'')||request.body?.hub_context!=='employee')throw unavailable();
    const first=authoritativeFeedbackPayload(request).identity_verification;
    const requireOriginal=async()=>{
      await revalidate(request);
      const current=authoritativeFeedbackPayload(request).identity_verification;
      if(JSON.stringify(current)!==JSON.stringify(first))throw unavailable();
    };
    await requireOriginal();
    const item=await readItem(operationId);
    await requireOriginal();
    let metadata=item?.metadata_json;
    if(typeof metadata==='string'){try{metadata=JSON.parse(metadata);}catch{throw unavailable();}}
    const actor=metadata?.identity_verification;
    if(!item||item.operation_id?.toLowerCase()!==operationId.toLowerCase()
      ||actor?.status!=='verified'||actor?.kind!=='enrolled_employee_device'
      ||actor.device_id!==first.device_id||actor.employee_id?.toLowerCase()!==first.employee_id
      ||actor.credential_id?.toLowerCase()!==first.credential_id
      ||String(actor.assignment_epoch)!==String(first.assignment_epoch))throw unavailable();
    const binding=employeeFeedbackReceipt(item);
    if(!binding)throw unavailable();
    return {ok:true,data:{item:{id:item.id,operation_id:item.operation_id,binding}},
      meta:{contract_version:'feedback.v3.enrolled-authority'}};
  };
}
