import {z} from 'zod';
const uuid=z.string().uuid();
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const feedbackTriageSchema=z.object({request_id:uuid,status:z.enum(['acknowledged','resolved','closed']),
 expected_version:hash,expected_manager_id:uuid,expected_credential_id:uuid}).strict();
export function feedbackTriageHandler({runRpc}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{
   const command=feedbackTriageSchema.parse(req.body),feedbackId=uuid.parse(req.params.feedbackId);
   const auth=req.memphisAuth;
   if(!auth||auth.read_only||auth.access_level==='read_only'||auth.manager_id!==command.expected_manager_id
    ||auth.credential_id!==command.expected_credential_id)
    return res.status(403).json({ok:false,command_rejected:true,code:'feedback_manager_changed',
     error:'The original full-access manager identity is required. Saved action remains protected.'});
   const result=await runRpc('custodial_feedback_triage',{p_request:command.request_id,p_manager:auth.manager_id,
    p_credential:auth.credential_id,p_feedback:feedbackId,p_action:command.status,p_expected_version:command.expected_version});
   const r=result?.receipt;
   if(result?.ok!==true||r?.request_id!==command.request_id||r?.feedback_id!==feedbackId||r?.status!==command.status
    ||r?.actor_manager_id!==auth.manager_id||r?.actor_credential_id!==auth.credential_id
    ||!hash.safeParse(r?.triage_version).success)
    throw new Error('Unconfirmed exact Feedback receipt');
   return res.json(result);
  }catch(error){
   const code=String(error?.code||'');
   const status=error?.name==='ZodError'||code==='22023'?422:code==='42501'?403:code==='P0002'?404:code==='40001'?409:503;
   return res.status(status).json({ok:false,command_rejected:status!==503,code:status===503?'feedback_triage_unconfirmed':code||'invalid_feedback_triage',
    error:status===503?'The action is not confirmed. Retain the exact saved request and retry.':
     'Feedback or manager authority changed. Refresh and review before a new action.'});
  }
 };
}
