import {z} from 'zod';
const uuid=z.string().uuid();
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const feedbackTriageSchema=z.object({request_id:uuid,status:z.enum(['acknowledged','resolved','closed']),
 expected_version:hash,expected_manager_id:uuid,expected_credential_id:uuid}).strict();
function validAcceptedAt(value){
 const parts=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-](\d{2}):(\d{2}))$/);
 if(!parts||parts[0]!==value)return false;
 const year=Number(parts[1]),month=Number(parts[2]),day=Number(parts[3]);
 if(year<1||month<1||month>12)return false;
 const leap=year%4===0&&(year%100!==0||year%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 return day>=1&&day<=days[month-1]&&Number(parts[4])<=23&&Number(parts[5])<=59&&Number(parts[6])<=59
  &&(parts[8]==='Z'||Number(parts[9])<=23&&Number(parts[10])<=59);
}
// Canonical SQL receipt timestamp: Gregorian civil fields, seconds, zero to
// six fractional digits, and an explicit numeric offset or Z. Preserve bytes;
// never repair invalid dates, truncate microseconds, or infer clock freshness.
export const feedbackTriageAcceptedAtSchema=z.string().refine(validAcceptedAt);
const resultSchema=z.object({ok:z.literal(true),replayed:z.boolean(),receipt:z.object({request_id:uuid,feedback_id:uuid,
 status:z.enum(['acknowledged','resolved','closed']),triage_version:hash,actor_manager_id:uuid,actor_credential_id:uuid,accepted_at:feedbackTriageAcceptedAtSchema}).strict()}).strict();
const sameActor=(auth,command)=>auth&&!auth.read_only&&auth.access_level!=='read_only'
 &&auth.manager_id===command.expected_manager_id&&auth.credential_id===command.expected_credential_id;
export function feedbackTriageHandler({runRpc}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{
   const command=feedbackTriageSchema.parse(req.body),feedbackId=uuid.parse(req.params.feedbackId);
   if(!sameActor(req.memphisAuth,command))
    return res.status(403).json({ok:false,command_rejected:true,code:'feedback_manager_changed',
     error:'The original full-access manager identity is required. Saved action remains protected.'});
   const raw=await runRpc('custodial_feedback_triage',{p_request:command.request_id,p_manager:command.expected_manager_id,
    p_credential:command.expected_credential_id,p_feedback:feedbackId,p_action:command.status,p_expected_version:command.expected_version});
   const parsed=resultSchema.safeParse(raw),r=parsed.success?parsed.data.receipt:null;
   if(!sameActor(req.memphisAuth,command)||!r||r.request_id!==command.request_id||r.feedback_id!==feedbackId||r.status!==command.status
    ||r.actor_manager_id!==command.expected_manager_id||r.actor_credential_id!==command.expected_credential_id
    ||r.triage_version===command.expected_version)
    throw new Error('Unconfirmed exact Feedback receipt');
   return res.json(parsed.data);
  }catch(error){
   const code=String(error?.code||'');
   const status=error?.name==='ZodError'||code==='22023'?422:code==='42501'?403:code==='P0002'?404:code==='40001'?409:503;
   return res.status(status).json({ok:false,command_rejected:status!==503,code:status===503?'feedback_triage_unconfirmed':code||'invalid_feedback_triage',
    error:status===503?'The outcome is uncertain. Keep the original saved request. Confirm its exact status before any new action; do not resend it.':
     'Feedback or manager authority changed. Refresh and review before a new action.'});
  }
 };
}
