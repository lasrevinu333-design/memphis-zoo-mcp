// Private, read-only native target/source evidence. This is deliberately not a
// provider admission, reservation, notification payload, or delivery route.
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const KINDS=new Set(['MESSAGE','SCHEDULE','LUNCH']);
const CURRENT=new Set(['CURRENT_SOURCE_ONLY','SOURCE_ONLY_POLICY_MISSING']);
const error=(code)=>Object.assign(new Error(code),{code});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function instantMicros(value){
 if(typeof value!=='string')return null;
 const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
 if(!parts)return null;
 const [,yy,mm,dd,hh,minute,ss,fraction='',offset,,offsetHours,offsetMinutes]=parts;
 const year=Number(yy),month=Number(mm),day=Number(dd);
 const leap=year%4===0&&(year%100!==0||year%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(year<1||month<1||month>12||day<1||day>days[month-1]
  ||Number(hh)>23||Number(minute)>59||Number(ss)>59
  ||(offset!=='Z'&&(Number(offsetHours)>23||Number(offsetMinutes)>59)))return null;
 const whole=Date.parse(fraction?value.replace(`.${fraction}`,''):value);
 return Number.isFinite(whole)?BigInt(whole)*1000n+BigInt(fraction.padEnd(6,'0')||'0'):null;
}

export function validateNativeTargetSourceProjection(value,{kind,sourceKey,employeeId,generationId}){
 const row=Array.isArray(value)?value.length===1?value[0]:null:value;
 if(!object(row)||row.schema!=='custodial.native-target-source.v1'||row.kind!==kind
  ||String(row.source_key||'').toLowerCase()!==sourceKey.toLowerCase()
  ||row.delivery_admitted!==false||typeof row.status!=='string')throw error('native_target_source_response_invalid');
 if(!CURRENT.has(row.status)){
  if(row.source!==undefined&&row.source!==null||row.recipient!==undefined&&row.recipient!==null)
   throw error('native_target_source_response_invalid');
  return row;
 }
 const source=row.source,recipient=row.recipient;
 if(!object(source)||!object(recipient)||String(recipient.employee_id||'').toLowerCase()!==employeeId.toLowerCase()
  ||String(recipient.generation_id||'').toLowerCase()!==generationId.toLowerCase()
  ||!UUID.test(recipient.device_id)||!UUID.test(recipient.credential_id)
  ||typeof recipient.device_identifier!=='string'||!recipient.device_identifier
  ||!Number.isSafeInteger(Number(recipient.assignment_epoch))||Number(recipient.assignment_epoch)<1
  ||!SHA.test(recipient.principal_digest)||!SHA.test(recipient.token_digest)
  ||!UUID.test(source.source_id)||typeof source.source_revision!=='string'||!source.source_revision
  ||(source.valid_from!==null&&instantMicros(source.valid_from)===null)
  ||(source.valid_until!==null&&instantMicros(source.valid_until)===null))throw error('native_target_source_response_invalid');
 if(kind==='LUNCH'){
  if(row.status!=='CURRENT_SOURCE_ONLY'||!UUID.test(source.delivery_occurrence_id)
   ||typeof source.notification_key!=='string'||!SHA.test(source.notification_key)
   ||instantMicros(source.valid_from)===null||instantMicros(source.valid_until)===null
   ||instantMicros(source.valid_until)<=instantMicros(source.valid_from)
   ||!['start','end'].includes(source.event)||!SHA.test(source.source_digest))
   throw error('native_target_source_response_invalid');
 }else if(row.status!=='SOURCE_ONLY_POLICY_MISSING'||source.valid_until!==null){
  throw error('native_target_source_response_invalid');
 }
 if(kind==='MESSAGE'&&(!UUID.test(recipient.msg_user_id)||!UUID.test(source.delivery_occurrence_id)))
  throw error('native_target_source_response_invalid');
 if(kind==='SCHEDULE'&&(source.delivery_occurrence_id!==null||!UUID.test(source.assignment_occurrence_id)))
  throw error('native_target_source_response_invalid');
 return row;
}

export async function readNativeTargetSource({runRpc,kind,sourceKey,employeeId,generationId}){
 if(typeof runRpc!=='function'||!KINDS.has(kind)||![sourceKey,employeeId,generationId].every(value=>UUID.test(value)))
  throw error('native_target_source_request_invalid');
 const result=await runRpc('custodial_native_target_source',{
  p_kind:kind,p_source_key:sourceKey,p_employee_id:employeeId,p_generation_id:generationId,
 });
 if(object(result)&&result.error)throw error('native_target_source_unavailable');
 return validateNativeTargetSourceProjection(object(result)&&Object.hasOwn(result,'data')?result.data:result,
  {kind,sourceKey,employeeId,generationId});
}
