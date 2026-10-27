import {createHash} from 'node:crypto';
import {isDeepStrictEqual,types} from 'node:util';
import {validateRecoveryOriginalTarget,recoveryTargetFields,recoveryInstantMicros} from './same-original-recovery-wire.js';

// COMPLETE assembled manifest REPRESENTATION ONLY. Never an authenticated
// native/source/manager/SQL read, review issuer, acceptance, ACK or effect token.
// This fixed private parser does NOT change the 64KiB native provider parser.
const MAX_BYTES=16777216,MAX_VALUES=2000000,MAX_DEPTH=24;
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
 READ_UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const EFFECTS=['inventory_acknowledged','work_accepted','replay_allowed','finalizer_allowed','key_removal','phone_released'];
const NAMESPACES=[
 ['MemphisZooCustodialNativeProviderV1','SEPARATE_PROVIDER_V1'],
 ['MemphisZooCustodialNativeVaultV1','LEGACY_VAULT_V1'],
 ['MemphisZooCustodialNativeVaultV2','SHARED_VAULT_V2'],
 ['MemphisZooCustodialOfflineAuthorityTimeV1','SHARED_VAULT_V2'],
 ['MemphisZooCustodialRetainedAttemptV1','SHARED_VAULT_V2'],
 ['MemphisZooCustodialRetainedBatchV1','SHARED_VAULT_V2'],
 ['MemphisZooCustodialRetainedReadQueryV1','SHARED_VAULT_V2'],
 ['WSSecureStorageSharedPreferences','LEGACY_ALIAS_BOUND_SECURE_STORAGE'],
];
const FAMILIES=[...new Set(NAMESPACES.map(([,family])=>family))].sort();
const EXPECTED=['inventory_native_request_id','registration_request_body_sha256','intent_document_sha256',
 'intent_disk_sha256','original_target','manifest_sha256'];
const ROOT=['schema','state','native_request_id','registration_request_body_sha256','intent_document_sha256',
 'intent_disk_sha256','original_target','native_held_stamp','native_namespaces','native_records',
 'browser_realm_name_encoding','browser_domains','browser_records','browser_value_frame','browser_part_set_sha256',
 'browser_accepted_exact_original_count','browser_unresolved_retained_count','retained_key_families',...EFFECTS];
const ACCEPTED='CURRENT_ACCEPTED_EXACT_ORIGINAL_NOT_ACK',UNRESOLVED='UNRESOLVED_RETAINED';
const ROWS='DECLARED_ORIGINAL_ROWS_NOT_AUTHORITY',EMPTY='DECLARED_EMPTY_DATABASE_NOT_AUTHORITY',
 UNAVAILABLE='UNAVAILABLE_UNRESOLVED_RETAINED';
const typed=Object.getPrototypeOf(Uint8Array.prototype),
 getBuffer=Object.getOwnPropertyDescriptor(typed,'buffer').get,
 getLength=Object.getOwnPropertyDescriptor(typed,'byteLength').get,
 getOffset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,
 getCapacity=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const fail=()=>{throw Object.assign(new TypeError('native_original_inventory_manifest_invalid'),
 {code:'native_original_inventory_manifest_invalid',status:400,outcome:'UNKNOWN',retry_safe:false});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function plain(value){return value!==null&&typeof value==='object'&&!types.isProxy(value)
 &&[Object.prototype,null].includes(Object.getPrototypeOf(value));}
function exact(value,fields){
 if(!plain(value)||Reflect.ownKeys(value).length!==fields.length)fail();
 for(const key of Reflect.ownKeys(value)){
  const d=Object.getOwnPropertyDescriptor(value,key);
  if(!fields.includes(key)||!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();
 }
}
function string(value,pattern){if(typeof value!=='string'||!pattern.test(value))fail();}
function integer(value,max,min=0){if(!Number.isSafeInteger(value)||Object.is(value,-0)||value<min||value>max)fail();return value;}
function list(value,max,min=0){if(!Array.isArray(value)||value.length<min||value.length>max)fail();return value;}
function denied(value){exact(value,EFFECTS);for(const key of EFFECTS)if(value[key]!==false)fail();}
function frozen(value){if(value&&typeof value==='object'){for(const item of Object.values(value))frozen(item);Object.freeze(value);}return value;}
function owned(input){
 if(types.isProxy(input)||!Buffer.isBuffer(input)||Object.getPrototypeOf(input)!==Buffer.prototype)fail();
 try{
  const backing=getBuffer.call(input),length=getLength.call(input),offset=getOffset.call(input),capacity=getCapacity.call(backing);
  if(Object.getPrototypeOf(backing)!==ArrayBuffer.prototype||length<1||length>MAX_BYTES||offset+length>capacity)fail();
  return Buffer.from(new Uint8Array(backing,offset,length));
 }catch{fail();}
}
function expectedSnapshot(original){
 exact(original,EXPECTED);const copy={};
 for(const key of EXPECTED){
  const value=Object.getOwnPropertyDescriptor(original,key).value;
  if(key==='original_target'){
   exact(value,recoveryTargetFields);const target={};
   for(const field of recoveryTargetFields){
    const item=Object.getOwnPropertyDescriptor(value,field).value;if(typeof item!=='string')fail();
    Object.defineProperty(target,field,{value:item,enumerable:true});
   }
   copy[key]=validateRecoveryOriginalTarget(target);
  }else{string(value,key==='inventory_native_request_id'?UUID:SHA);copy[key]=value;}
 }
 return copy;
}

// One fixed complete-manifest JSON reader: duplicates, unsafe/floating numeric
// spellings, malformed UTF8/surrogates and trailing data refuse before exposure.
function parseManifest(bytes){
 let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail();}
 let at=0,values=0;
 const space=()=>{while(at<text.length&&' \t\r\n'.includes(text[at]))at++;};
 function quoted(){
  if(text[at++]!=='"')fail();const begin=at-1;
  while(at<text.length){
   const c=text[at++];if(c==='\\'){at++;continue;}
   if(c==='"'){
    let result;try{result=JSON.parse(text.slice(begin,at));}catch{fail();}
    for(let i=0;i<result.length;i++){
     const c=result.charCodeAt(i);
     if(c>=0xd800&&c<=0xdbff){const low=result.charCodeAt(++i);if(!(low>=0xdc00&&low<=0xdfff))fail();}
     else if(c>=0xdc00&&c<=0xdfff)fail();
    }
    return result;
   }
  }fail();
 }
 function value(depth){
  if(depth>MAX_DEPTH||++values>MAX_VALUES)fail();space();const c=text[at];
  if(c==='"')return quoted();
  if(c==='{'){
   at++;space();const result={},keys=new Set();if(text[at]==='}'){at++;return result;}
   while(true){
    space();const key=quoted();if(keys.has(key))fail();keys.add(key);space();if(text[at++]!==':')fail();
    Object.defineProperty(result,key,{value:value(depth+1),enumerable:true,writable:true,configurable:true});
    space();const end=text[at++];if(end==='}')return result;if(end!==',')fail();
   }
  }
  if(c==='['){
   at++;space();const result=[];if(text[at]===']'){at++;return result;}
   while(true){result.push(value(depth+1));space();const end=text[at++];if(end===']')return result;if(end!==',')fail();}
  }
  for(const [literal,result] of [['true',true],['false',false],['null',null]])
   if(text.startsWith(literal,at)){at+=literal.length;return result;}
  const begin=at;if(text[at]==='-')at++;
  if(text[at]==='0')at++;
  else{if(!(text[at]>='1'&&text[at]<='9'))fail();while(text[at]>='0'&&text[at]<='9')at++;}
  const spelling=text.slice(begin,at),number=Number(spelling);
  if(!Number.isSafeInteger(number)||spelling==='-0')fail();return number;
 }
 const result=value(0);space();if(at!==text.length)fail();return result;
}

function canonicalBase64(value,maxBytes,even=false){
 if(typeof value!=='string'||value.length>4*Math.ceil(maxBytes/3)||value.length%4!==0)fail();
 let padding=false;
 for(let i=0;i<value.length;i++){
  const c=value.charCodeAt(i);
  if(c===61){padding=true;if(i<value.length-2)fail();}
  else if(padding||!(c>=65&&c<=90||c>=97&&c<=122||c>=48&&c<=57||c===43||c===47))fail();
 }
 const bytes=Buffer.from(value,'base64');
 if(bytes.length>maxBytes||even&&bytes.length%2!==0||bytes.toString('base64')!==value){bytes.fill(0);fail();}
 return bytes;
}
function name(value,maxUnits){
 const bytes=canonicalBase64(value,maxUnits*2,true);const parts=[];
 try{
  for(let at=0;at<bytes.length;at+=4096){
   const units=[];for(let i=at;i<Math.min(at+4096,bytes.length);i+=2)units.push((bytes[i]<<8)|bytes[i+1]);
   parts.push(String.fromCharCode(...units));
  }
  return parts.join(''); // Exact code units, including unpaired surrogates.
 }finally{bytes.fill(0);}
}
function completion(value,disposition,target,withArguments){
 if(value===null){if(disposition!==UNRESOLVED)fail();return;}
 exact(value,['argument_sha256','original_query_request_id','request_body_sha256','actual_response_sha256','readback',
  ...(withArguments?['original_arguments_utf8']:[])]);
 for(const key of ['argument_sha256','request_body_sha256','actual_response_sha256'])string(value[key],SHA);
 if(withArguments){
  const text=value.original_arguments_utf8;
  if(typeof text!=='string'||text.length<1||Buffer.byteLength(text,'utf8')>4194304)fail();
  const bytes=Buffer.from(text,'utf8');
  try{if(bytes.toString('utf8')!==text||hash(bytes)!==value.argument_sha256)fail();}
  finally{bytes.fill(0);}
  // Original DATA is not parsed/reserialized here. The fixed SQL owner must
  // re-read its full exact arguments before a semantic manager decision.
 }
 // Source requireSource() bounds only nonempty; the request issuer itself owns
 // UUID authenticity. Do not turn a string into a current request capability.
 if(typeof value.original_query_request_id!=='string'||!value.original_query_request_id.length
  ||value.original_query_request_id.length>65536)fail();
 const read=value.readback;
 exact(read,['schema','state','operation_id','original_generation_id','argument_values_sha256',
  'disposition','result','transaction_authority','limits']);
 if(read.schema!=='custodial.same-original-completion-SQL-read.v1'
  ||read.state!=='CURRENT_EXACT_ORIGINAL_COMPLETION_DISPOSITION_NOT_ACK'||read.transaction_authority!==false
  ||read.operation_id!==target.operation_id||read.original_generation_id!==target.original_generation_id
  ||read.argument_values_sha256!==value.argument_sha256)fail();
 denied(read.limits);
 if(read.disposition===UNRESOLVED){if(read.result!==null||disposition!==UNRESOLVED)fail();}
 else if(read.disposition==='ACCEPTED_EXACT_ORIGINAL'){
  if(disposition!==ACCEPTED)fail();const result=read.result;
  const fields=['reconciliation_id','context_id','occurrence_id','session_id','completion_response_id',
   'client_session_id','client_completion_id','employee_id','credential_id','assignment_epoch','payload_fingerprint',
   'started_at','ended_at','submitted_at','location_id'];
  exact(result,fields);for(const key of fields)if(typeof result[key]!=='string'||result[key].length<1)fail();
  for(const key of ['reconciliation_id','context_id','occurrence_id','session_id','completion_response_id',
   'employee_id','credential_id','location_id'])string(result[key],READ_UUID);
  string(result.assignment_epoch,/^[1-9][0-9]{0,15}$/);
  if(BigInt(result.assignment_epoch)>9007199254740991n||result.assignment_epoch!==target.assignment_epoch
   ||result.employee_id!==target.employee_id||result.credential_id!==target.credential_id)fail();
  string(result.payload_fingerprint,SHA);
  const start=recoveryInstantMicros(result.started_at),end=recoveryInstantMicros(result.ended_at);
  recoveryInstantMicros(result.submitted_at);if(start>=end)fail();
 }else fail();
 if(Buffer.byteLength(JSON.stringify(read),'utf8')>65536)fail();
}
function nativeRows(manifest,target,withArguments){
 const names=list(manifest.native_namespaces,8,8),rows=list(manifest.native_records,32768);
 const counts=Array(8).fill(0),accepted=Array(8).fill(0),seen=NAMESPACES.map(()=>new Set());
 let last=-1;
 for(let ordinal=0;ordinal<rows.length;ordinal++){
  const row=rows[ordinal];
  exact(row,['ordinal','namespace','key_family','raw_identity_sha256','raw_type','local_source_classification','disposition','completion_readback']);
  if(row.ordinal!==ordinal)fail();
  const index=NAMESPACES.findIndex(([namespace])=>namespace===row.namespace);
  if(index<last||index<0||row.key_family!==NAMESPACES[index][1])fail();last=index;
  if(++counts[index]>4096)fail();string(row.raw_identity_sha256,SHA);
  if(seen[index].has(row.raw_identity_sha256))fail();seen[index].add(row.raw_identity_sha256);
  if(!['STRING','INTEGER','LONG','BOOLEAN','FLOAT_RAW_BITS','STRING_SET'].includes(row.raw_type))fail();
  string(row.local_source_classification,/^[A-Z0-9_]{1,160}$/);
  if(![ACCEPTED,UNRESOLVED].includes(row.disposition))fail();
  if(row.completion_readback!==null&&row.namespace!=='MemphisZooCustodialNativeVaultV2')fail();
  completion(row.completion_readback,row.disposition,target,withArguments);
  if(row.disposition===ACCEPTED)accepted[index]++;
 }
 const familyCounts=new Map(FAMILIES.map(family=>[family,0]));
 for(let i=0;i<8;i++){
  const item=names[i];exact(item,['namespace','record_count','accepted_exact_original_count','unresolved_retained_count']);
  if(item.namespace!==NAMESPACES[i][0])fail();
  integer(item.record_count,4096);integer(item.accepted_exact_original_count,4096);integer(item.unresolved_retained_count,4096);
  if(item.record_count!==counts[i]||item.accepted_exact_original_count!==accepted[i]
   ||item.unresolved_retained_count!==counts[i]-accepted[i])fail();
  const family=NAMESPACES[i][1];familyCounts.set(family,familyCounts.get(family)+counts[i]);
 }
 const families=list(manifest.retained_key_families,FAMILIES.length,FAMILIES.length);
 for(let i=0;i<FAMILIES.length;i++){
  const item=families[i];
  exact(item,['key_family','source_declared_raw_rows_to_preserve','possible_undeclared_references',
   'all_writer_durable_freeze_or_ABA_guard','current_server_reconciliation','zero_rows_is_not_key_removal_authority',
   'finalizer_allowed','key_removal']);
  if(item.key_family!==FAMILIES[i]||item.source_declared_raw_rows_to_preserve!==familyCounts.get(FAMILIES[i])
   ||item.possible_undeclared_references!=='UNKNOWN'||item.zero_rows_is_not_key_removal_authority!==true
   ||item.all_writer_durable_freeze_or_ABA_guard!==false||item.current_server_reconciliation!==false
   ||item.finalizer_allowed!==false||item.key_removal!==false)fail();
 }
}
function browserRows(manifest,target,withArguments){
 if(manifest.browser_realm_name_encoding!=='UTF16_CODE_UNITS_BE_BASE64')fail();
 const domains=list(manifest.browser_domains,4098,2),rows=list(manifest.browser_records,4096);
 const names=[],counts=Array(domains.length).fill(0);let dbCount=0,lastDatabase=null,currentVersion=null,priorStore=null,emptyDatabase=false,stores=0;
 for(let i=0;i<domains.length;i++){
  const domain=domains[i];
  exact(domain,['domain_ordinal','store','database_utf16be_base64','version','object_store_utf16be_base64','record_count','state']);
  if(domain.domain_ordinal!==i)fail();
  if(i<2){
   if(domain.store!==(i===0?'localStorage':'sessionStorage')||domain.database_utf16be_base64!==null
    ||domain.object_store_utf16be_base64!==null||domain.version!==null)fail();
   if(i===1&&domain.state===UNAVAILABLE){if(domain.record_count!==null)fail();}
   else{if(domain.state!==ROWS)fail();integer(domain.record_count,4096);}
   names.push(null);continue;
  }
  if(domain.store!=='indexedDB')fail();
  const database=name(domain.database_utf16be_base64,1024);integer(domain.version,9007199254740991,1);
  const objectStore=domain.object_store_utf16be_base64===null?null:name(domain.object_store_utf16be_base64,4194304);
  integer(domain.record_count,4096);
  if(lastDatabase===null||database!==lastDatabase){
   if(lastDatabase!==null&&database<=lastDatabase||++dbCount>32)fail();
   lastDatabase=database;currentVersion=domain.version;priorStore=null;emptyDatabase=false;stores=0;
  }else if(currentVersion!==domain.version||emptyDatabase)fail();
  if(objectStore===null){
   if(stores||domain.state!==EMPTY||domain.record_count!==0)fail();emptyDatabase=true;
  }else{
   if(domain.state!==ROWS||priorStore!==null&&objectStore<=priorStore||++stores>128)fail();
   priorStore=objectStore;
  }
  names.push({database,objectStore,version:domain.version});
 }
 let accepted=0,lastDomain=-1;
 for(let ordinal=0;ordinal<rows.length;ordinal++){
  const row=rows[ordinal];exact(row,['ordinal','domain_ordinal','key_sha256','body_sha256','disposition','completion_readback']);
  if(row.ordinal!==ordinal)fail();const index=integer(row.domain_ordinal,domains.length-1);
  if(index<lastDomain||domains[index].record_count===null||++counts[index]>domains[index].record_count)fail();lastDomain=index;
  string(row.key_sha256,SHA);string(row.body_sha256,SHA);
  if(![ACCEPTED,UNRESOLVED].includes(row.disposition))fail();
  const realm=names[index];
  if(row.completion_readback!==null&&(!realm||realm.database!=='mz_scan_queue'
   ||realm.objectStore!=='actions'||realm.version<1||realm.version>6))fail();
  completion(row.completion_readback,row.disposition,target,withArguments);
  if(row.disposition===ACCEPTED)accepted++;
 }
 for(let i=0;i<domains.length;i++)if(counts[i]!== (domains[i].record_count??0))fail();
 integer(manifest.browser_accepted_exact_original_count,4096);integer(manifest.browser_unresolved_retained_count,4096);
 if(manifest.browser_accepted_exact_original_count!==accepted||manifest.browser_unresolved_retained_count!==rows.length-accepted)fail();
 const frame=manifest.browser_value_frame;
 exact(frame,['schema','encoding','observation_sha256','frame_sha256','byte_count','chunk_bytes','chunk_count','record_count',
  'session_storage_state','chunk_sha256','native_authority','durable_retention','inventory_acknowledged','finalizer_allowed','key_removal']);
 if(frame.schema!=='custodial.browser-original-value-frame.v1'||frame.encoding!=='MZBRV001')fail();
 for(const key of ['observation_sha256','frame_sha256'])string(frame[key],SHA);
 const bytes=integer(frame.byte_count,67108864,56),chunks=integer(frame.chunk_count,64,1);
 if(frame.chunk_bytes!==1048576||chunks!==Math.ceil(bytes/1048576)||frame.record_count!==rows.length)fail();
 list(frame.chunk_sha256,chunks,chunks);for(const item of frame.chunk_sha256)string(item,SHA);
 if(chunks===1&&frame.chunk_sha256[0]!==frame.frame_sha256)fail();
 if(frame.session_storage_state!==(domains[1].record_count===null?'NOT_DECLARED_UNKNOWN':'CAPTURED_READ_ONLY_NOT_AUTHENTICATED'))fail();
 for(const key of ['native_authority','durable_retention','inventory_acknowledged','finalizer_allowed','key_removal'])if(frame[key]!==false)fail();
 string(manifest.browser_part_set_sha256,SHA);
}

/** Validates exact bytes/pins and structure only. The returned deeply frozen,
 * detached manifest is UNTRUSTED DATA; even CURRENT_ACCEPTED labels/receipts
 * must be rechecked by Main's actual current ledger/manager transaction. */
export function decodeNativeOriginalInventoryManifest(exactAssembledUtf8,expectedOriginal){
 let raw;
 try{
  raw=owned(exactAssembledUtf8);const expected=expectedSnapshot(expectedOriginal);
  if(hash(raw)!==expected.manifest_sha256)fail();
  const manifest=parseManifest(raw);exact(manifest,ROOT);
  const withArguments=manifest.schema==='custodial.native-original-complete-inventory-manifest.v2';
  if(!withArguments&&manifest.schema!=='custodial.native-original-complete-inventory-manifest.v1'
   ||manifest.state!=='ALL_DECLARED_ORIGINAL_ROWS_WITH_EXPLICIT_UNRESOLVED_RETENTION_NOT_ACK'
   ||manifest.native_request_id!==expected.inventory_native_request_id)fail();
  for(const key of ['registration_request_body_sha256','intent_document_sha256','intent_disk_sha256'])
   if(manifest[key]!==expected[key])fail();
  const target=validateRecoveryOriginalTarget(manifest.original_target);
  if(!isDeepStrictEqual(target,expected.original_target))fail();
  if(typeof manifest.native_held_stamp!=='string'||!/^DURABLE_HELD:[1-9][0-9]{0,18}$/.test(manifest.native_held_stamp)
   ||BigInt(manifest.native_held_stamp.slice(13))>9223372036854775807n)fail();
  for(const key of EFFECTS)if(manifest[key]!==false)fail();
  nativeRows(manifest,target,withArguments);browserRows(manifest,target,withArguments);
  return frozen(manifest);
 }catch{fail();}
 finally{raw?.fill(0);}
}
