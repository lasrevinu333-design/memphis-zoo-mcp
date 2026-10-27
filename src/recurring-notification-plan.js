import {createHash} from 'node:crypto';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,list)=>object(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...list].sort());
const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function exactPlanReceiptInstant(value){
 if(typeof value!=='string')return false;
 const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{3}|\d{6}))?Z$/.exec(value);if(!m)return false;
 const fraction=(m[2]||'').padEnd(6,'0'),millis=m[1]+'.'+fraction.slice(0,3)+'Z',n=Date.parse(millis);
 return Number.isFinite(n)&&new Date(n).toISOString()===millis;
}
const unavailable=()=>({schema:'custodial.recurring-current-notification-plan-unavailable.v1',complete:false,receipt_eligible:false});
export function validateRecurringNotificationPlan(envelope,{delivery,serviceDate,devicePk,deviceId,employeeId,credentialId,epoch}){
 const v2=envelope?.schema==='custodial.recurring-current-notification-plan-envelope.v2';
 if(!keys(envelope,['schema','body','bodyJsonText','bodyDigest'])||(!v2&&envelope.schema!=='custodial.recurring-current-notification-plan-envelope.v1')
  ||typeof envelope.bodyJsonText!=='string'||Buffer.byteLength(envelope.bodyJsonText)>196608||!DIGEST.test(envelope.bodyDigest)
  ||createHash('sha256').update(envelope.bodyJsonText).digest('hex')!==envelope.bodyDigest)return null;
 let body;try{body=JSON.parse(envelope.bodyJsonText);}catch{return null;}
 if(!same(body,envelope.body)||!keys(body,['schema','complete','receipt_eligible','scope','source','service_date','intent_id','target_digest','target',
  'rendered_digest','backend_principal_digest','plan_read_id','semantic_digest','device_pk','canonical_device_id','employee_id','credential_id','assignment_epoch','observed_at','valid_until','notification_state',
  'accepted_lunch_intents','required_effects','required_audio','source_counts',...(v2?['delivery_bindings']:[])])
  ||body.schema!==(v2?'custodial.recurring-current-notification-plan.v2':'custodial.recurring-current-notification-plan.v1')||body.complete!==true||body.receipt_eligible!==false
  ||body.scope!=='CURRENT_PRESENTATION_AND_FULL_EFFECTS_REQUIRED_BY_ACCEPTED_TARGET_NOT_FUTURE_ALARM_INVENTORY'
  ||!['AUTHENTICATED_BLOCKED_TARGET','FULL_ACCEPTED_LUNCH_AND_EXHAUSTIVE_CURRENT_LOCATION_DERIVATION'].includes(body.source)
  ||typeof body.plan_read_id!=='string'||!UUID.test(body.plan_read_id)
  ||typeof body.semantic_digest!=='string'||!DIGEST.test(body.semantic_digest)
  ||typeof body.backend_principal_digest!=='string'||!DIGEST.test(body.backend_principal_digest)
  ||body.rendered_digest!==(delivery.target.targetType==='SCHEDULE'?delivery.viewDigest:delivery.targetDigest)
  ||body.service_date!==serviceDate||body.intent_id!==delivery.intentId||body.target_digest!==delivery.targetDigest
  ||!same(body.target,delivery.target)||body.device_pk!==devicePk||body.canonical_device_id!==deviceId
  ||body.employee_id!==employeeId||body.credential_id!==credentialId||body.assignment_epoch!==String(epoch))return null;
 const instant=x=>{if(typeof x!=='string')return null;const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.(\d{6})Z$/.exec(x);if(!m)return null;
  const millis=m[1]+'.'+m[2].slice(0,3)+'Z',n=Date.parse(millis);return Number.isFinite(n)&&new Date(n).toISOString()===millis?BigInt(n)*1000n+BigInt(m[2].slice(3)):null;};
 const observed=instant(body.observed_at),until=instant(body.valid_until);
 if(observed===null||until===null||until<=observed
  ||!keys(body.notification_state,['notifications_silent','silent_reason','override_enabled'])
  ||typeof body.notification_state.notifications_silent!=='boolean'||typeof body.notification_state.silent_reason!=='string'
  ||typeof body.notification_state.override_enabled!=='boolean'
  ||!keys(body.source_counts,['accepted_lunch_intents','current_assigned_locations'])
  ||!Object.values(body.source_counts).every(x=>Number.isSafeInteger(x)&&x>=0&&x<=1024)
  ||!Array.isArray(body.accepted_lunch_intents)||body.accepted_lunch_intents.length!==body.source_counts.accepted_lunch_intents
  ||!Array.isArray(body.required_effects)||body.required_effects.length>1024||!Array.isArray(body.required_audio)
  ||body.required_audio.length!==body.required_effects.length)return null;
 const seen=new Set();
 for(const effect of body.required_effects){
  if(!object(effect)||typeof effect.notification_key!=='string'||!effect.notification_key||seen.has(effect.notification_key)
   ||effect.required_audio!==true||!['FULL_ACCEPTED_LUNCH_DOCUMENT','EXHAUSTIVE_NORMAL_CURRENT_LOCATION_CYCLES'].includes(effect.origin))return null;
  seen.add(effect.notification_key);
  const data=effect.origin==='FULL_ACCEPTED_LUNCH_DOCUMENT'?effect.notification?.data:effect.data;
  if(!object(data)||data.notification_key!==effect.notification_key||data.service_date!==serviceDate
   ||data.receipt_employee_id!==employeeId||data.receipt_credential_id!==credentialId||data.receipt_device_id!==deviceId
   ||data.receipt_assignment_epoch!==String(epoch))return null;
 }
 if(new Set(body.required_audio).size!==seen.size||body.required_audio.some(x=>!seen.has(x)))return null;
 if(v2){
  const binding=body.delivery_bindings;
  if(body.required_effects.length===0||!keys(binding,['schema','state','entries'])
   ||binding.schema!=='custodial.recurring-original-native-delivery-bindings.v1'||!Array.isArray(binding.entries))return null;
  if(binding.state==='UNAVAILABLE'){
   if(binding.entries.length!==0)return null; // Explicit unavailable DATA, never empty delivery proof.
  }else if(binding.state==='ORIGINAL_NATIVE_RESERVATIONS'){
   if(binding.entries.length!==seen.size)return null;
   const bindingKeys=new Set(),originalJobs=new Set();
   for(let i=0;i<binding.entries.length;i++){
    const entry=binding.entries[i],effect=body.required_effects[i],data=effect.origin==='FULL_ACCEPTED_LUNCH_DOCUMENT'?effect.notification.data:effect.data;
    if(!keys(entry,['notification_key','receipt_job_id','generation_id','registration_id','principal_digest','token_digest',
      'reservation_at','valid_until','content_sha256','native_kind','audio_origin','speech_sha256'])
     ||!Object.values(entry).every(value=>typeof value==='string')||entry.notification_key!==effect.notification_key
     ||bindingKeys.has(entry.notification_key)||originalJobs.has(entry.receipt_job_id)
     ||![entry.receipt_job_id,entry.generation_id,entry.registration_id].every(value=>UUID.test(value))
     ||![entry.principal_digest,entry.token_digest,entry.content_sha256,entry.speech_sha256].every(value=>DIGEST.test(value))
     ||entry.audio_origin!=='ORIGINAL_NATIVE_JOB'||!['employee_lunch_coverage','employee_location_status'].includes(entry.native_kind)
     ||entry.native_kind!==data.kind)return null;
    const reserved=instant(entry.reservation_at),expires=instant(entry.valid_until);
    if(reserved===null||expires===null||reserved>observed||expires<=observed||until>expires)return null;
    bindingKeys.add(entry.notification_key);originalJobs.add(entry.receipt_job_id);
    // speech_sha256 binds the ORIGINAL NATIVE JOB words, not the normal
    // location renderer's legitimately different text. Actual native payload
    // and genuine per-job SDK completion remain independent native custody.
   }
  }else return null;
 }
 if(delivery.target.targetType==='BLOCKED_RECURRING_AUTHORITY'&&(body.source!=='AUTHENTICATED_BLOCKED_TARGET'
  ||body.required_effects.length!==0||body.accepted_lunch_intents.length!==0||body.source_counts.current_assigned_locations!==0))return null;
 return envelope;
}
export async function readRecurringNotificationPlan({runRpc,delivery,serviceDate,assignment,credentialId}){
 const devicePk=assignment?.canonical_device_pk,deviceId=assignment?.canonical_device_id||assignment?.device_id,
  employeeId=assignment?.assigned_employee_id,epoch=Number(assignment?.assignment_epoch),current=delivery?.delivery;
 if(!['RECURRING_TERMINAL','RECURRING_SCHEDULE'].includes(delivery?.mode)||!object(current)
  ||![devicePk,employeeId,credentialId,current.intentId].every(x=>typeof x==='string'&&UUID.test(x))
  ||typeof deviceId!=='string'||!deviceId||!DIGEST.test(current.targetDigest)||!Number.isSafeInteger(epoch)||epoch<1)return unavailable();
 try{
  const envelope=await runRpc('static_weekly_v27_issue_recurring_notification_plan',{p_date:serviceDate,p_device:devicePk,p_credential:credentialId,
   p_employee:employeeId,p_epoch:epoch,p_intent:current.intentId,p_target_digest:current.targetDigest});
  return validateRecurringNotificationPlan(envelope,{delivery:current,serviceDate,devicePk,deviceId,employeeId,credentialId,epoch})||unavailable();
 }catch{return unavailable();} // Ordinary GET remains compatible; missing/old schema is NEVER an empty plan.
}
