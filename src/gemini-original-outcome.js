const SCHEMA='custodial.console-original-outcome.v1';
const UNKNOWN=Object.freeze({schema:SCHEMA,state:'UNCONFIRMED_ORIGINAL_RETAINED'});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ORIGINAL_KEYS=['client_message_id','correlation_id','conversation_id','body','orderedattachment_ids','created_at'];
const ORIGINAL_METADATA=new Set(['original_attachment_ids','original_client_time_policy']);
const POLICY='LOCAL_DISPLAY_METADATA_NOT_SERVER_AUTHORITY';
const uuid=value=>typeof value==='string'&&UUID.test(value);

// Descriptor reads never execute a caller-supplied getter. Persisted SQL JSON
// is plain data; a fabricated/accessor-bearing row cannot establish an outcome.
function fields(value,exact){
  if(value===null||typeof value!=='object'||Array.isArray(value))return null;
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return null;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||!Object.hasOwn(descriptors[key],'value')))return null;
  if(exact&&(Reflect.ownKeys(descriptors).length!==exact.length||exact.some(key=>!Object.hasOwn(descriptors,key))))return null;
  return descriptors;
}
const value=(descriptors,key)=>descriptors?.[key]?.value;
function orderedIds(input){
  if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||input.length>8)return null;
  const descriptors=Object.getOwnPropertyDescriptors(input);
  if(Reflect.ownKeys(descriptors).length!==input.length+1)return null;
  const ids=[];
  for(let index=0;index<input.length;index++){
    const item=descriptors[index];
    if(!item||!Object.hasOwn(item,'value')||!uuid(item.value))return null;
    ids.push(item.value);
  }
  return ids;
}
function timestamp(input){
  if(typeof input!=='string')return false;
  const match=input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/);
  if(!match)return false;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1||month<1||month>12||day<1||day>days[month-1]
    ||Number(match[4])>23||Number(match[5])>59||Number(match[6])>59)return false;
  const zone=match[7];
  return zone==='Z'||(Number(zone.slice(1,3))<=14&&Number(zone.slice(4))<=59
    &&(Number(zone.slice(1,3))<14||Number(zone.slice(4))===0));
}

// The caller must already have authenticated the current actor and read both
// rows under its current SQL snapshot. This pure projection grants no access.
export function originalConsoleOutcome(actor,expected,user,assistant){
  try{
    const a=fields(actor),e=fields(expected,ORIGINAL_KEYS),u=fields(user),s=fields(assistant);
    if(!a||!e||!u||!s||!uuid(value(a,'managerId'))||!uuid(value(a,'credentialId')))return UNKNOWN;
    const clientId=value(e,'client_message_id'),correlation=value(e,'correlation_id');
    const conversation=value(e,'conversation_id'),body=value(e,'body'),created=value(e,'created_at');
    const attachments=orderedIds(value(e,'orderedattachment_ids'));
    if(!uuid(clientId)||!uuid(correlation)||!uuid(conversation)||typeof body!=='string'
      ||!body.trim()||body.length>30000||!attachments||!timestamp(created))return UNKNOWN;

    const metadata=fields(value(u,'metadata_json'));
    const savedAttachments=orderedIds(value(metadata,'original_attachment_ids'));
    if(!metadata||!savedAttachments||value(metadata,'source')!=='direct_authenticated_user'
      ||value(metadata,'original_client_time_policy')!==POLICY
      ||Object.keys(metadata).some(key=>key.startsWith('original_')&&!ORIGINAL_METADATA.has(key))
      ||savedAttachments.length!==attachments.length
      ||savedAttachments.some((id,index)=>id!==attachments[index]))return UNKNOWN;

    const userId=value(u,'message_id'),assistantId=value(s,'message_id');
    const userCompleted=value(u,'completed_at'),assistantCompleted=value(s,'completed_at');
    if(!uuid(userId)||!uuid(assistantId)||userId===assistantId
      ||value(u,'role')!=='user'||value(u,'state')!=='completed'
      ||value(u,'manager_id')!==value(a,'managerId')||value(u,'conversation_id')!==conversation
      ||value(u,'client_message_id')!==clientId||value(u,'correlation_id')!==correlation
      ||value(u,'body')!==body||value(u,'response_to_message_id')!=null
      ||value(s,'role')!=='assistant'||value(s,'state')!=='completed'
      ||value(s,'manager_id')!==value(a,'managerId')||value(s,'conversation_id')!==conversation
      ||value(s,'correlation_id')!==correlation||value(s,'response_to_message_id')!==userId
      ||!timestamp(userCompleted)||!timestamp(assistantCompleted))return UNKNOWN;

    return Object.freeze({schema:SCHEMA,state:'PERSISTED_COMPLETED_TURN_ONLY',
      client_message_id:value(u,'client_message_id'),correlation_id:value(u,'correlation_id'),
      conversation_id:value(u,'conversation_id'),body:value(u,'body'),
      orderedattachment_ids:Object.freeze([...savedAttachments]),
      created_at:created,created_at_policy:POLICY,
      user_message_id:userId,assistant_message_id:assistantId,
      user_completed_at:userCompleted,assistant_completed_at:assistantCompleted});
  }catch{return UNKNOWN;}
}
