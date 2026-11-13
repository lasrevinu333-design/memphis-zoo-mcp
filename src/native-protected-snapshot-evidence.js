import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

// UNMOUNTED retention-only verifier for NativeSeparationEvidence/WorkSnapshot.
// The private owning route must first authenticate the original credential and
// fetch its immutable context/full native principal. These arguments alone do
// not authenticate a caller. No SQL, HTTP, signing, ACK, work or reuse effect.
const VERSION='custodial-native-protected-snapshot.v1';
const SCHEMA='custodial.native-protected-work-snapshot.v1';
const HEX=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const TYPES=new Set(['string','int32','int64','boolean','float32','string-set']);
const fail=()=>{throw Object.assign(new Error('native_protected_snapshot_evidence_invalid'),{status:400,code:'native_protected_snapshot_evidence_invalid'});};
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype
  &&isDeepStrictEqual(Object.keys(value).sort(),[...keys].sort());
const sameHex=(a,b)=>typeof a==='string'&&typeof b==='string'&&HEX.test(a)&&HEX.test(b)
  &&timingSafeEqual(Buffer.from(a,'ascii'),Buffer.from(b,'ascii'));
function parseExactObject(bytes,maxBytes){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>maxBytes)fail();
  let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail();}
  let at=0,values=0;
  const space=()=>{while(at<text.length&&/[ \t\r\n]/.test(text[at]))at++;};
  const string=()=>{
    if(text[at]!=='"')fail();const begin=at++;
    while(at<text.length){const ch=text[at++];if(ch==='\\'){at++;continue;}if(ch==='"'){
      let value;try{value=JSON.parse(text.slice(begin,at));}catch{fail();}
      for(let i=0;i<value.length;i++){const unit=value.charCodeAt(i);if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))fail();}else if(unit>=0xdc00&&unit<=0xdfff)fail();}
      return value;
    }}fail();
  };
  const value=depth=>{
    if(depth>24||++values>32768)fail();space();const ch=text[at];
    if(ch==='"'){string();return;}
    if(ch==='{'){at++;space();const seen=new Set();if(text[at]==='}'){at++;return;}while(true){space();const key=string();if(seen.has(key))fail();seen.add(key);space();if(text[at++]!==':')fail();value(depth+1);space();const end=text[at++];if(end==='}')return;if(end!==',')fail();}}
    if(ch==='['){at++;space();if(text[at]===']'){at++;return;}while(true){value(depth+1);space();const end=text[at++];if(end===']')return;if(end!==',')fail();}}
    for(const literal of ['true','false','null'])if(text.startsWith(literal,at)){at+=literal.length;return;}
    const number=/^-?(?:0|[1-9][0-9]*)/.exec(text.slice(at));if(!number||number[0]==='-0'||!Number.isSafeInteger(Number(number[0])))fail();at+=number[0].length;
  };
  value(0);space();if(at!==text.length)fail();
  let parsed;try{parsed=JSON.parse(text);}catch{fail();}
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')fail();return parsed;
}
const CONTEXT_KEYS=['schema','separation_id','authority_revision','employee_id','device_id','canonical_device_id','credential_id','assignment_epoch','cutoff_at','state','native_inventory_state','server_known_open_sessions','new_work_allowed','phone_released','purpose'];
const V1_KEYS=['schema_version','device_id','employee_id','assignment_epoch','credential_id','credential_operation_id','installation_seal','enrolled_at'];
const V2_KEYS=['schema_version','device_id','employee_id','assignment_epoch','credential_id','activation_operation_id','activation_receipt_sha256','legacy_binding_id','legacy_binding_kind','installation_binding_sha256','installation_seal','enrolled_at'];
function validateOwners(context,principal,credential){
  if(!exact(context,CONTEXT_KEYS)||context.schema!=='custodial.separation-context.v1'
    ||context.state!=='PENDING_RECONCILIATION'||context.purpose!=='SEPARATION_STATUS_ONLY'
    ||context.new_work_allowed!==false||context.phone_released!==false
    ||!UUID.test(context.separation_id)||!UUID.test(context.device_id)
    ||!UUID.test(context.employee_id)||!UUID.test(context.credential_id)
    ||!/^KIOSK_(?:0[2-9]|10)$/.test(context.canonical_device_id)
    ||!Number.isSafeInteger(context.authority_revision)||context.authority_revision<1
    ||!Number.isSafeInteger(context.assignment_epoch)||context.assignment_epoch<1
    ||typeof context.cutoff_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(context.cutoff_at)
    ||!Number.isFinite(Date.parse(context.cutoff_at))||!Array.isArray(context.server_known_open_sessions)
    ||!['UNKNOWN','VERIFIED_EMPTY','PROTECTED_PENDING','RECONCILED'].includes(context.native_inventory_state))fail();
  const v1=principal?.schema_version==='custodial-protected-principal.v1',v2=principal?.schema_version==='custodial-protected-principal.v2';
  if(!v1&&!v2||!exact(principal,v1?V1_KEYS:V2_KEYS))fail();
  for(const [key,value]of Object.entries(principal))if(key==='assignment_epoch'){
    if(!Number.isSafeInteger(value)||value<1)fail();
  }else if(typeof value!=='string')fail();
  if(principal.device_id!==context.canonical_device_id||principal.employee_id!==context.employee_id
    ||principal.credential_id!==context.credential_id||principal.assignment_epoch!==context.assignment_epoch
    ||!/^[A-Za-z0-9._:-]{8,512}$/.test(principal.installation_seal)
    ||principal.enrolled_at.length>64||!principal.enrolled_at.endsWith('Z')||!Number.isFinite(Date.parse(principal.enrolled_at)))fail();
  if(v1&&!UUID.test(principal.credential_operation_id))fail();
  if(v2&&(!UUID.test(principal.activation_operation_id)||!UUID.test(principal.legacy_binding_id)
    ||!HEX.test(principal.activation_receipt_sha256)||!HEX.test(principal.installation_binding_sha256)
    ||!['authenticated_legacy_installation_observation','confirmed_enrollment_operation'].includes(principal.legacy_binding_kind)))fail();
  if(typeof credential!=='string'||credential.length>4096)fail();const dot=credential.indexOf('.');
  if(dot<1||credential.slice(0,dot)!==context.credential_id||!credential.slice(dot+1))fail();
  return credential.slice(dot+1);
}
export function verifyNativeProtectedSnapshotEvidence(wireBytes,{separationContext,nativePrincipal,credentialToken}={}){
  if(!Buffer.isBuffer(wireBytes))fail();
  // Snapshot caller-owned inputs synchronously; do not return their references.
  let context,principal;try{context=structuredClone(separationContext);principal=structuredClone(nativePrincipal);}catch{fail();}
  const secret=validateOwners(context,principal,credentialToken);
  const wire=parseExactObject(Buffer.from(wireBytes),262144);
  if(!exact(wire,['attestation_version','manifest_body','manifest_sha256','attestation'])
    ||wire.attestation_version!==VERSION||typeof wire.manifest_body!=='string'
    ||!HEX.test(wire.manifest_sha256)||!HEX.test(wire.attestation))fail();
  const bodyBytes=Buffer.from(wire.manifest_body,'utf8'),body=parseExactObject(bodyBytes,131072);
  if(!sameHex(hash(wire.manifest_body),wire.manifest_sha256))fail();
  const expected=createHmac('sha256',secret).update([VERSION,context.credential_id,wire.manifest_sha256].join('\n'),'utf8').digest('hex');
  if(!sameHex(expected,wire.attestation))fail();
  if(!exact(body,['schema','separation_context','original_principal','raw_snapshot_sha256','record_count','records','native_semantic_inventory_state','browser_inventory_state','new_work_allowed','phone_released'])
    ||body.schema!==SCHEMA||!isDeepStrictEqual(body.separation_context,context)||!isDeepStrictEqual(body.original_principal,principal)
    ||body.native_semantic_inventory_state!=='UNKNOWN'||body.browser_inventory_state!=='UNKNOWN'
    ||body.new_work_allowed!==false||body.phone_released!==false||!HEX.test(body.raw_snapshot_sha256)
    ||!Number.isSafeInteger(body.record_count)||body.record_count<0||body.record_count>4096
    ||!Array.isArray(body.records)||body.records.length!==body.record_count)fail();
  let previous='';
  for(const row of body.records){
    if(!Array.isArray(row)||row.length!==3||typeof row[0]!=='string'||!/^(?:[a-f0-9]{4}){1,1024}$/.test(row[0])
      ||row[0]<=previous||!TYPES.has(row[1])||typeof row[2]!=='string'||!HEX.test(row[2]))fail();
    previous=row[0];let key='';for(let n=0;n<row[0].length;n+=4)key+=String.fromCharCode(Number.parseInt(row[0].slice(n,n+4),16));
    if(key==='native_separation_freeze.v1'||key==='native_separation_probe.v1')fail();
  }
  const records=JSON.stringify(body.records);if(records.length>196608||!sameHex(hash(JSON.stringify([SCHEMA,records])),body.raw_snapshot_sha256))fail();
  return Object.freeze({schema:'custodial.native-protected-raw-binding.v1',verification:'MATCHED_RAW_BINDING_RETENTION_ONLY',
    separation_id:context.separation_id,credential_id:context.credential_id,
    manifest_sha256:wire.manifest_sha256,raw_snapshot_sha256:body.raw_snapshot_sha256,record_count:body.record_count,
    native_semantic_inventory_state:'UNKNOWN',browser_inventory_state:'UNKNOWN',inventory_acknowledged:false,
    automatic_acceptance:false,new_work_allowed:false,phone_released:false});
}
export const nativeProtectedSnapshotEvidenceLimits=Object.freeze({wireBytes:262144,bodyBytes:131072,records:4096,parserValues:32768,depth:24});
