import {z} from 'zod';
import {feedbackTriageSchema,feedbackTriageAcceptedAtSchema} from './feedback-triage.js';

const uuid=z.string().uuid();
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const instant=feedbackTriageAcceptedAtSchema;
const storedCommand=feedbackTriageSchema.extend({feedback_id:uuid}).strict();
const receipt=z.object({request_id:uuid,feedback_id:uuid,status:z.enum(['acknowledged','resolved','closed']),
  triage_version:hash,actor_manager_id:uuid,actor_credential_id:uuid,accepted_at:instant}).strict();
const resultSchema=z.discriminatedUnion('outcome',[
  z.object({ok:z.literal(true),outcome:z.literal('APPLIED'),retry_safe:z.literal(false),command:storedCommand,receipt}).strict(),
  z.object({ok:z.literal(true),outcome:z.literal('UNKNOWN'),retry_safe:z.literal(false)}).strict(),
]);
const failure=(status,code)=>Object.assign(new Error(code),{status,code});
const sessionFields=['manager_id','credential_id','device_id','token','expires_at','role','access_level','read_only','auth_mode'];

function managerBinding(session){
  if(session?.role!=='ops_manager'||session.read_only!==false||session.access_level!=='full_access'
    ||!uuid.safeParse(session.manager_id).success||!uuid.safeParse(session.credential_id).success
    ||typeof session.device_id!=='string'||!session.device_id||session.device_id.length>96
    ||typeof session.token!=='string'||!session.token||session.token.length>8192
    ||typeof session.auth_mode!=='string'||!session.auth_mode||session.auth_mode.length>96
    ||!instant.safeParse(session.expires_at).success||Date.parse(session.expires_at)<=Date.now())
    throw failure(403,'feedback_triage_status_auth_required');
  return Object.freeze(Object.fromEntries(sessionFields.map(key=>[key,session[key]])));
}

async function currentManager(req,requireOpsManagerWrite){
  let accepted=0,denied=false,status=503;
  const sink={headersSent:false,writableEnded:false,setHeader(){},
    status(value){status=[401,403].includes(value)?value:503;return this;},
    json(){denied=true;return this;}};
  // Supplied req.memphisAuth is never authority. Use the existing async normal
  // manager middleware, which verifies the signature and current registry.
  delete req.memphisAuth;
  try{await requireOpsManagerWrite(req,sink,error=>{if(error)denied=true;else accepted++;});}
  catch{throw failure(503,'feedback_triage_status_unconfirmed');}
  if(denied||accepted!==1)throw failure(status,'feedback_triage_status_auth_required');
  return managerBinding(req.memphisAuth);
}

function exactApplied(result,original){
  if(!Object.keys(original).every(key=>result.command[key]===original[key]))return false;
  const r=result.receipt;
  return r.request_id===original.request_id&&r.feedback_id===original.feedback_id&&r.status===original.status
    &&r.actor_manager_id===original.expected_manager_id&&r.actor_credential_id===original.expected_credential_id
    &&r.triage_version!==original.expected_version;
}

/** Exact original receipt read only. Main supplies the fixed reader and mount. */
export function feedbackTriageStatusHandler({readOriginalReceipt,requireOpsManagerWrite}={}){
  if(typeof readOriginalReceipt!=='function'||typeof requireOpsManagerWrite!=='function')
    throw new TypeError('feedback_triage_status_fixed_reader_and_normal_gate_required');
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Authorization, Cookie, X-Device-Id');
    try{
      const input=feedbackTriageSchema.safeParse(req.body),target=uuid.safeParse(req.params?.feedbackId);
      if(!input.success||!target.success)throw failure(422,'feedback_triage_status_request_invalid');
      const original=Object.freeze({...input.data,feedback_id:target.data});
      const binding=await currentManager(req,requireOpsManagerWrite);
      if(binding.manager_id!==original.expected_manager_id||binding.credential_id!==original.expected_credential_id)
        throw failure(403,'feedback_triage_status_manager_changed');
      const args=Object.freeze({p_request:original.request_id,p_manager:original.expected_manager_id,
        p_credential:original.expected_credential_id,p_feedback:original.feedback_id,
        p_action:original.status,p_expected_version:original.expected_version});
      let raw,unavailable=false;
      try{raw=await readOriginalReceipt(args);}catch{unavailable=true;}
      // Zod captures primitive stored evidence before the next auth await.
      // Neither a caller mutation nor a later reader-result mutation rebinds it.
      const parsed=unavailable?null:resultSchema.safeParse(raw);
      const captured=parsed?.success?parsed.data:null;
      if(captured?.outcome==='APPLIED'){Object.freeze(captured.command);Object.freeze(captured.receipt);}
      if(captured)Object.freeze(captured);
      const current=await currentManager(req,requireOpsManagerWrite);
      if(!sessionFields.every(key=>current[key]===binding[key]))throw failure(403,'feedback_triage_status_manager_changed');
      if(!captured||(captured.outcome==='APPLIED'&&!exactApplied(captured,original)))
        throw failure(503,'feedback_triage_status_unconfirmed');
      return res.status(200).json(captured);
    }catch(error){
      const status=[401,403,422].includes(error?.status)?error.status:503;
      const code=status===422?'feedback_triage_status_request_invalid':status===403
        ?'feedback_triage_status_manager_changed':status===401?'feedback_triage_status_auth_required':'feedback_triage_status_unconfirmed';
      return res.status(status).json({ok:false,outcome:'UNKNOWN',retry_safe:false,code,
        error:'Exact original triage outcome is not confirmed. Keep the saved original request; do not resend the action.'});
    }
  };
}
