import {validateCohortPlaceInput,placeOperationMutates} from './custodial-cohort-place-input.mjs';
import {feedbackTriageSchema} from './feedback-triage.js';
// Typed completed-record correction and bounded open-problem projection.
// A browser supplies facts, never a database actor, RPC name or backend secret.
const fault=(code,status=422)=>Object.assign(new Error(code),{code,status});
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
function timestamp(value){
 if(typeof value!=='string')return false;
 const m=value.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.(\d{1,6}))?)?(Z|([+-])(\d\d):(\d\d))$/);
 if(!m)return false;
 const y=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
 const days=[31,(y%4===0&&(y%100!==0||y%400===0))?29:28,31,30,31,30,31,31,30,31,30,31];
 return y>=1&&month>=1&&month<=12&&day>=1&&day<=days[month-1]&&Number(m[4])<24&&Number(m[5])<60&&Number(m[6]||0)<60
  &&(m[8]==='Z'||Number(m[10])<24&&Number(m[11])<60)&&Number.isFinite(Date.parse(value));
}
export const CORRECTION_FIELDS=['corrected_employee_id','corrected_location_id','corrected_device_id','corrected_started_at','corrected_ended_at'];
export function validateRecordOperation(action,input){
 if(!object(input)||Buffer.byteLength(JSON.stringify(input),'utf8')>(action==='place_operation'?65536:16384))throw fault('invalid_record_request');
 if(action==='place_operation'){try{return validateCohortPlaceInput(input);}catch{throw fault('invalid_record_request');}}
 if(['feedback_triage','feedback_triage_status'].includes(action)){const parsed=feedbackTriageSchema.extend({feedback_id:feedbackTriageSchema.shape.expected_manager_id}).strict().safeParse(input);if(!parsed.success)throw fault('invalid_record_request');return parsed.data;}
 if(action==='unfinished_work'){if(!exact(input,['limit'])||!Number.isInteger(input.limit)||input.limit<1||input.limit>100)throw fault('invalid_record_request');}
 else if(['clear_unfinished_work','unfinished_work_outcome'].includes(action)){if(!exact(input,action==='clear_unfinished_work'?['notice_id','operation_id','reason']:['notice_id','operation_id'])||!uuid(input.notice_id)||!uuid(input.operation_id)||(action==='clear_unfinished_work'&&(typeof input.reason!=='string'||!input.reason.trim()||input.reason.trim().length>1000)))throw fault('invalid_record_request');}
 else if(action==='choices'){if(!exact(input,[]))throw fault('invalid_record_request');}
 else if(action==='open_problems'){if(!exact(input,['limit'])||!Number.isInteger(input.limit)||input.limit<1||input.limit>200)throw fault('invalid_record_request');}
 else if(action==='completion_evidence'){
  if(!exact(input,['session_uuid'])||typeof input.session_uuid!=='string'||input.session_uuid.length<1||input.session_uuid.length>400
   ||input.session_uuid.startsWith(' ')||input.session_uuid.endsWith(' ')||[...input.session_uuid].length>200
   ||[...input.session_uuid].some(c=>c.codePointAt(0)===0||(c.codePointAt(0)>=0xD800&&c.codePointAt(0)<=0xDFFF)))throw fault('invalid_record_request');
 }
 else if(action==='truth'){if(!exact(input,['session_id'])||!uuid(input.session_id))throw fault('invalid_record_request');}
 else if(action==='correction_outcome'){if(!exact(input,['session_id','operation_id'])||!uuid(input.session_id)||!uuid(input.operation_id))throw fault('invalid_record_request');}
 else if(action==='correct'){
  const required=['session_id','operation_id','reason','expected_correction_id','expected_session_uuid'];
  if(!required.every(k=>Object.hasOwn(input,k))||Object.keys(input).some(k=>![...required,...CORRECTION_FIELDS].includes(k))
   ||!uuid(input.session_id)||!uuid(input.operation_id)||(input.expected_correction_id!==null&&!uuid(input.expected_correction_id))
   ||typeof input.expected_session_uuid!=='string'||!input.expected_session_uuid||input.expected_session_uuid.length>512
   ||typeof input.reason!=='string'||!input.reason.trim()||input.reason.trim().length>1000)throw fault('invalid_record_request');
  for(const k of CORRECTION_FIELDS){const value=input[k];if(value==null)continue;
   if(k.endsWith('_id')?!uuid(value):!timestamp(value))throw fault('invalid_record_request');}
  if(!CORRECTION_FIELDS.some(k=>input[k]!=null))throw fault('invalid_record_request');
 }else throw fault('invalid_record_action');
 const selected=structuredClone(input);
 if(action==='correct'){selected.reason=selected.reason.trim();for(const k of CORRECTION_FIELDS)selected[k]??=null;}
 return selected;
}
export function recordOperationFailure(error){
 const status=error.status||({'42501':403,'P0002':404,'40001':409,'23505':409,'40901':409,'22023':422,'22P02':422,'22007':422,'23503':422}[error.code])||503;
 const selected=status===401?403:([403,404,409,422,503].includes(status)?status:503);
 const code={403:'record_authority_denied',404:'record_not_found',409:'record_correction_conflict',422:'invalid_record_request',503:'record_outcome_unconfirmed'}[selected];
 return {status:selected,body:{ok:false,error:code,code}};
}
export function installCustodialRecordRoutes(app,{requireOpsManagerAuth,requireOpsManagerWrite,runRpc,managerId,backendSecret,leadershipRecordBridge}){
 const dispatch=async(req,action,input)=>{
  const selected=validateRecordOperation(action,input);
  if(req.memphisAuth?.auth_mode==='custodial_leadership_pin'){
   if(typeof leadershipRecordBridge!=='function')throw fault('record_authority_unavailable',503);
   return leadershipRecordBridge(req,action,selected);
  }
  return runRpc('custodial_named_record_operation_v1',{p_manager_id:managerId(req),p_backend_execution_secret:backendSecret(),p_action:action,p_input:selected});
 };
 const handler=(action,select,contract)=>async(req,res)=>{try{
  const data=await dispatch(req,action,select(req));if(!object(data))throw fault('record_readback_unavailable',503);
  res.set?.('Cache-Control','no-store');res.status(action==='correct'&&data.replayed!==true?201:200).json({ok:true,contract_version:contract,data});
 }catch(e){const failure=recordOperationFailure(e);res.set?.('Cache-Control','no-store');res.status(failure.status).json(failure.body);}};
 const base='/admin-api/custodial';
 app.get(base+'/unfinished-work',requireOpsManagerAuth,handler('unfinished_work',()=>({limit:100}),'custodial.unfinished-work.v1'));
 app.get(base+'/unfinished-work/:noticeId/operations/:operationId',requireOpsManagerAuth,handler('unfinished_work_outcome',req=>({notice_id:req.params?.noticeId,operation_id:req.params?.operationId}),'custodial.unfinished-work.v1'));
 app.post(base+'/unfinished-work/:noticeId/clear',requireOpsManagerWrite,handler('clear_unfinished_work',req=>{
  if(!exact(req.body,['reason']))throw fault('invalid_record_request');
  return {notice_id:req.params?.noticeId,operation_id:req.get?.('Idempotency-Key')||req.headers?.['idempotency-key'],reason:req.body.reason};
 },'custodial.unfinished-work.v1'));
 app.get(base+'/cleaning-correction-choices',requireOpsManagerAuth,handler('choices',()=>({}),'cleaning-correction-choices.v1'));
 app.get(base+'/open-problems',requireOpsManagerAuth,handler('open_problems',req=>({limit:req.query?.limit===undefined?100:Number(req.query.limit)}),'custodial.open-problems.v1'));
 app.get(base+'/cleaning-sessions/:sessionId/truth',requireOpsManagerAuth,handler('truth',req=>({session_id:req.params?.sessionId}),'cleaning-truth.v1'));
 app.get(base+'/cleaning-sessions/:sessionId/corrections/:operationId',requireOpsManagerAuth,handler('correction_outcome',req=>({session_id:req.params?.sessionId,operation_id:req.params?.operationId}),'cleaning-truth.v1'));
 app.post(base+'/cleaning-sessions/:sessionId/corrections',requireOpsManagerWrite,handler('correct',req=>{
  if(!object(req.body)||Object.hasOwn(req.body,'session_id')||Object.hasOwn(req.body,'operation_id'))throw fault('invalid_record_request');
  return {...req.body,session_id:req.params?.sessionId,operation_id:req.get?.('Idempotency-Key')||req.headers?.['idempotency-key']};
 },'cleaning-truth.v1'));
}

export const recordOperationRequiresCsrf=(action,input)=>action==='clear_unfinished_work'||action==='correct'||action==='feedback_triage'||(action==='place_operation'&&placeOperationMutates(input));
