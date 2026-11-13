import {createHash} from 'node:crypto';
import {isDeepStrictEqual,types} from 'node:util';
import {inspectAuthenticatedSameOriginalCompletionRead} from './native-private-custody-exchange.js';
import {parseNativeProviderJson} from './native-provider-json.js';
import {recoveryDeniedEffects,recoveryInstantMicros} from './same-original-recovery-wire.js';

const bindingKeys=['capture','observation_only','transaction_authority','original_completion_arguments_utf8',
  'original_completion_arguments_sha256','original_principal','rpc_parameters'];
const principalKeys=['device_id','canonical_device_id','employee_id','credential_id','assignment_epoch'];
const parameterKeys=['p_operation','p_device','p_credential','p_credential_hash','p_credential_key_id','p_generation',
  'p_chunk_index','p_native_request','p_request_sha256','p_attestation_digest','p_original_completion_utf8'];
const resultKeys=['reconciliation_id','context_id','occurrence_id','session_id','completion_response_id',
  'client_session_id','client_completion_id','employee_id','credential_id','assignment_epoch','payload_fingerprint',
  'started_at','ended_at','submitted_at','location_id'];
const representationKeys=['schema','state','operation_id','original_generation_id','argument_values_sha256',
  'disposition','result','transaction_authority','limits'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const attempted=new WeakSet();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fail(code='same_original_completion_read_unknown',status=503){
  throw Object.assign(new Error(code),{code,status,outcome:'UNKNOWN',retry_safe:false,limits:recoveryDeniedEffects});
}
function closed(value,keys){
  if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();
  const names=Reflect.ownKeys(value);
  if(names.length!==keys.length||names.some(key=>!keys.includes(key)))fail();
  const copy={};
  for(const key of keys){const field=Object.getOwnPropertyDescriptor(value,key);
    if(!field||!Object.hasOwn(field,'value')||!field.enumerable)fail();copy[key]=field.value;}
  return copy;
}
function field(value,key){
  if(!value||typeof value!=='object'||types.isProxy(value))return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
}
function rpcMethod(db){
  if(!db||typeof db!=='object'||types.isProxy(db))fail('same_original_completion_read_unavailable');
  for(let owner=db;owner;owner=Object.getPrototypeOf(owner)){
    if(types.isProxy(owner))fail('same_original_completion_read_unavailable');
    const descriptor=Object.getOwnPropertyDescriptor(owner,'rpc');
    if(descriptor){
      if(!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function'||types.isProxy(descriptor.value))
        fail('same_original_completion_read_unavailable');
      return descriptor.value;
    }
  }fail('same_original_completion_read_unavailable');
}
function string(value){if(typeof value!=='string'||!value.length)fail();return value;}
function uuid(value){if(typeof value!=='string'||!UUID.test(value))fail();return value;}
function sha(value){if(typeof value!=='string'||!SHA.test(value))fail();return value;}
function epoch(value){
  if(typeof value!=='string'||!(/^[1-9][0-9]{0,18}$/).test(value)||BigInt(value)>9223372036854775807n)fail();return value;
}
function utf8(value,max){
  if(typeof value!=='string'||!value.length||Buffer.byteLength(value,'utf8')>max)fail();
  const bytes=Buffer.from(value,'utf8');
  try{if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)!==value)fail();return bytes;}
  catch{bytes.fill(0);fail();}
}
function instant(value){
  if(typeof value!=='string'||value.length!==27||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value))fail();
  return recoveryInstantMicros(value);
}
function originalMillis(value){
  if(typeof value!=='string'||value.length!==24||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))fail();
  const micros=value.slice(0,-1)+'000Z';instant(micros);return micros;
}
function originalStrings(raw,principal){
  // Parse only to extract binding STRINGS. Arbitrary nested payload numbers
  // are never serialized, hashed, forwarded or used for an authorization
  // decision here. SQL alone compares the full exact original UTF8 DATA.
  let args;try{args=JSON.parse(raw);}catch{fail();}
  if(!args||Object.getPrototypeOf(args)!==Object.prototype||field(args,'p_device_id')!==principal.canonical_device_id)fail();
  const response=field(args,'p_response_json'),context=field(response,'__custodial_offline_reconciliation_v1');
  const binding=Object.freeze({client_session_id:string(field(args,'p_client_session_id')),
    client_completion_id:string(field(args,'p_client_completion_id')),context_id:uuid(field(context,'context_id')),
    started_at:originalMillis(field(args,'p_client_started_at')),ended_at:originalMillis(field(args,'p_client_ended_at'))});
  if(instant(binding.ended_at)<=instant(binding.started_at))fail();return binding;
}
function snapshot(capture){
  let inspected;try{inspected=inspectAuthenticatedSameOriginalCompletionRead(capture);}
  catch{fail('same_original_completion_capture_unbound',403);}
  const binding=closed(inspected,bindingKeys);
  if(!Object.isFrozen(inspected)||binding.capture!==capture||binding.observation_only!==true||binding.transaction_authority!==false
    ||!Object.isFrozen(binding.original_principal)||!Object.isFrozen(binding.rpc_parameters))fail();
  const principal=closed(binding.original_principal,principalKeys),params=closed(binding.rpc_parameters,parameterKeys);
  for(const key of principalKeys)string(principal[key]);
  uuid(principal.device_id);uuid(principal.employee_id);uuid(principal.credential_id);epoch(principal.assignment_epoch);
  if(!/^KIOSK_(?:0[2-9]|10)$/.test(principal.canonical_device_id))fail();
  for(const key of parameterKeys)if(key!=='p_chunk_index')string(params[key]);
  if(params.p_chunk_index!==0||params.p_device!==principal.device_id||params.p_credential!==principal.credential_id
    ||params.p_original_completion_utf8!==binding.original_completion_arguments_utf8)fail();
  for(const key of ['p_operation','p_device','p_credential','p_generation','p_native_request'])uuid(params[key]);
  for(const key of ['p_credential_hash','p_credential_key_id','p_request_sha256','p_attestation_digest'])sha(params[key]);
  sha(binding.original_completion_arguments_sha256);
  const bytes=utf8(binding.original_completion_arguments_utf8,4*1024*1024);
  try{if(hash(bytes)!==binding.original_completion_arguments_sha256)fail();}finally{bytes.fill(0);}
  return Object.freeze({capture,raw:binding.original_completion_arguments_utf8,sha:binding.original_completion_arguments_sha256,
    principal:Object.freeze(principal),parameters:binding.rpc_parameters});
}
function unchanged(capture,original){
  let current;try{current=snapshot(capture);}catch{fail();}
  if(current.capture!==original.capture||current.raw!==original.raw||current.sha!==original.sha
    ||!isDeepStrictEqual(current.principal,original.principal)
    ||!isDeepStrictEqual(current.parameters,original.parameters))fail();
}
function representation(reply,original){
  if(!reply||typeof reply!=='object'||types.isProxy(reply))fail();
  const data=Object.getOwnPropertyDescriptor(reply,'data'),error=Object.getOwnPropertyDescriptor(reply,'error');
  if(!data||!Object.hasOwn(data,'value')||!error||!Object.hasOwn(error,'value')||error.value!==null)fail();
  const bytes=utf8(data.value,65536);let value;
  try{value=closed(parseNativeProviderJson(bytes),representationKeys);}finally{bytes.fill(0);}
  if(value.schema!=='custodial.same-original-completion-SQL-read.v1'
    ||value.state!=='CURRENT_EXACT_ORIGINAL_COMPLETION_DISPOSITION_NOT_ACK'||value.transaction_authority!==false
    ||value.operation_id!==original.parameters.p_operation||value.original_generation_id!==original.parameters.p_generation
    ||value.argument_values_sha256!==original.sha
    ||!isDeepStrictEqual(closed(value.limits,Object.keys(recoveryDeniedEffects)),recoveryDeniedEffects))fail();
  if(value.disposition==='UNRESOLVED_RETAINED'){
    if(value.result!==null)fail();
  }else if(value.disposition==='ACCEPTED_EXACT_ORIGINAL'){
    const originalBinding=originalStrings(original.raw,original.principal);
    const accepted=closed(value.result,resultKeys);for(const key of resultKeys)string(accepted[key]);
    // Historical client IDs are exact original TEXT, not newly invented UUID
    // authority. The eight database identities retain strict UUID validation.
    for(const key of resultKeys)if(!['client_session_id','client_completion_id','assignment_epoch','payload_fingerprint','started_at','ended_at','submitted_at'].includes(key))uuid(accepted[key]);
    sha(accepted.payload_fingerprint);epoch(accepted.assignment_epoch);
    if(accepted.employee_id!==original.principal.employee_id||accepted.credential_id!==original.principal.credential_id
      ||accepted.assignment_epoch!==original.principal.assignment_epoch)fail();
    for(const key of ['client_session_id','client_completion_id','context_id','started_at','ended_at'])
      if(accepted[key]!==originalBinding[key])fail();
    if(instant(accepted.ended_at)<=instant(accepted.started_at))fail();
    instant(accepted.submitted_at); // Saved server civil time only; no client/server-clock ordering claim.
    value.result=Object.freeze(accepted);
  }else fail();
  const output=Object.freeze({...value,limits:recoveryDeniedEffects});
  if(Buffer.byteLength(JSON.stringify({ok:true,data:output}),'utf8')>131072)fail();return output;
}

// Fixed private adapter. The imported Source-owned inspector, not a supplied
// callback/JSON object, admits captures. No query, writer, retry or role port.
export function createSameOriginalCompletionReadStore(dependencies){
  const {db}=closed(dependencies,['db']),rpc=rpcMethod(db);
  async function readOriginalCompletionOnce(capture){
    if(!capture||typeof capture!=='object'||types.isProxy(capture))fail('same_original_completion_capture_unbound',403);
    if(attempted.has(capture))fail('same_original_completion_read_already_attempted');
    attempted.add(capture); // One attempt per capture across store instances, including uncertainty.
    const original=snapshot(capture);let reply,caught,threw=false;
    try{reply=await Reflect.apply(rpc,db,['custodial_same_original_completion_read_v1',original.parameters]);}
    catch(error){caught=error;threw=true;}
    unchanged(capture,original);
    if(field(caught,'code')==='42501'||field(field(reply,'error'),'code')==='42501')
      fail('same_original_completion_read_current_authority_denied',403);
    if(threw)fail();
    try{return representation(reply,original);}catch{fail();}
  }
  return Object.freeze({readOriginalCompletionOnce});
}
