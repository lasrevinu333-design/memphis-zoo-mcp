import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {pathToFileURL} from 'node:url';
import {decodeNativeOriginalInventoryManifest as decode} from '../src/native-original-inventory-manifest.js';
import {recoveryTargetFields} from '../src/same-original-recovery-wire.js';
import {parseNativeProviderJson,nativeProviderJsonLimits} from '../src/native-provider-json.js';

// Synthetic manifest/receipt DATA only. No native issuer, private assembler,
// current manager, registration, ledger/SQL acceptance, ACK or key capability.
const sha=value=>createHash('sha256').update(value).digest('hex');
const h=n=>sha(String(n)),uuid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const effects={inventory_acknowledged:false,work_accepted:false,replay_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false};
const partition=[
 ['MemphisZooCustodialNativeProviderV1','SEPARATE_PROVIDER_V1'],
 ['MemphisZooCustodialNativeVaultV1','LEGACY_VAULT_V1'],
 ['MemphisZooCustodialNativeVaultV2','SHARED_VAULT_V2'],
 ['MemphisZooCustodialOfflineAuthorityTimeV1','SHARED_VAULT_V2'],
 ['MemphisZooCustodialRetainedAttemptV1','SHARED_VAULT_V2'],
 ['MemphisZooCustodialRetainedBatchV1','SHARED_VAULT_V2'],
 ['MemphisZooCustodialRetainedReadQueryV1','SHARED_VAULT_V2'],
 ['WSSecureStorageSharedPreferences','LEGACY_ALIAS_BOUND_SECURE_STORAGE'],
];
const A='CURRENT_ACCEPTED_EXACT_ORIGINAL_NOT_ACK',U='UNRESOLVED_RETAINED',R='DECLARED_ORIGINAL_ROWS_NOT_AUTHORITY';
function units(text){
 const raw=Buffer.alloc(text.length*2);
 for(let i=0;i<text.length;i++){raw[i*2]=text.charCodeAt(i)>>>8;raw[i*2+1]=text.charCodeAt(i)&255;}
 const result=raw.toString('base64');raw.fill(0);return result;
}
function target(){
 const out={};let next=1;
 for(const key of recoveryTargetFields)out[key]=['operation_id','separation_id','canonical_device_pk','employee_id','credential_id','original_generation_id'].includes(key)
  ?uuid(next++):key==='canonical_device_id'?'KIOSK_02':key==='engine_revision'?'0'
  :['assignment_epoch','separation_authority_revision'].includes(key)?'1':h(key);
 return out;
}
function completion(t,accepted=true){
 const read={schema:'custodial.same-original-completion-SQL-read.v1',
  state:'CURRENT_EXACT_ORIGINAL_COMPLETION_DISPOSITION_NOT_ACK',operation_id:t.operation_id,
  original_generation_id:t.original_generation_id,argument_values_sha256:h('args'),
  disposition:accepted?'ACCEPTED_EXACT_ORIGINAL':U,result:null,transaction_authority:false,limits:{...effects}};
 if(accepted)read.result={reconciliation_id:uuid(11),context_id:uuid(12),occurrence_id:uuid(13),session_id:uuid(14),
  completion_response_id:uuid(15),client_session_id:uuid(16),client_completion_id:uuid(17),employee_id:t.employee_id,
  credential_id:t.credential_id,assignment_epoch:'1',payload_fingerprint:h('payload'),
  started_at:'2026-10-16T11:00:00.123000Z',ended_at:'2026-10-16T11:00:01.123000Z',
  submitted_at:'2026-10-16T10:00:00.123000Z',location_id:uuid(18)};
 return {argument_sha256:h('args'),original_query_request_id:uuid(19),request_body_sha256:h('read-body'),
  actual_response_sha256:h('response'),readback:read};
}
function domain(ordinal,store,database,version,objectStore,count,state=R){
 return {domain_ordinal:ordinal,store,database_utf16be_base64:database===null?null:units(database),version,
  object_store_utf16be_base64:objectStore===null?null:units(objectStore),record_count:count,state};
}
function fixture(){
 const t=target(),native=[],names=[];
 for(let i=0;i<partition.length;i++){
  const [namespace,key_family]=partition[i],number=i===2?3:1;
  for(let n=0;n<number;n++)native.push({ordinal:native.length,namespace,key_family,raw_identity_sha256:h(namespace+n),
   raw_type:['STRING','INTEGER','LONG','BOOLEAN','FLOAT_RAW_BITS','STRING_SET'][i%6],
   local_source_classification:'NAMESPACE_SEMANTICS_UNRESOLVED_RETAINED',
   disposition:i===2?A:U,completion_readback:i===2?completion(t):null});
  names.push({namespace,record_count:number,accepted_exact_original_count:i===2?number:0,unresolved_retained_count:i===2?0:number});
 }
 const families=[...new Set(partition.map(x=>x[1]))].sort().map(key_family=>({
  key_family,source_declared_raw_rows_to_preserve:native.filter(x=>x.key_family===key_family).length,
  possible_undeclared_references:'UNKNOWN',all_writer_durable_freeze_or_ABA_guard:false,
  current_server_reconciliation:false,zero_rows_is_not_key_removal_authority:true,finalizer_allowed:false,key_removal:false}));
 const domains=[domain(0,'localStorage',null,null,null,1),domain(1,'sessionStorage',null,null,null,null,'UNAVAILABLE_UNRESOLVED_RETAINED'),
  domain(2,'indexedDB','',1,null,0,'DECLARED_EMPTY_DATABASE_NOT_AUTHORITY'),domain(3,'indexedDB','mz_scan_queue',4,'actions',2),
  domain(4,'indexedDB','z'+String.fromCharCode(0xd800),1,'lo'+String.fromCharCode(0xdc00),2),
  domain(5,'indexedDB','z'+String.fromCharCode(0xdc00),1,'',0)];
 const rows=[0,3,3,4,4].map((domain_ordinal,ordinal)=>({ordinal,domain_ordinal,key_sha256:h(ordinal>=3?'same-key':ordinal),
  body_sha256:h(ordinal>=3?'same-body':ordinal),disposition:ordinal===1?A:U,completion_readback:ordinal===1?completion(t):null}));
 return {schema:'custodial.native-original-complete-inventory-manifest.v1',
  state:'ALL_DECLARED_ORIGINAL_ROWS_WITH_EXPLICIT_UNRESOLVED_RETENTION_NOT_ACK',native_request_id:uuid(99),
  registration_request_body_sha256:h('registration'),intent_document_sha256:h('intent'),intent_disk_sha256:h('intent-disk'),
  original_target:t,native_held_stamp:'DURABLE_HELD:1',native_namespaces:names,native_records:native,
  browser_realm_name_encoding:'UTF16_CODE_UNITS_BE_BASE64',browser_domains:domains,browser_records:rows,
  browser_value_frame:{schema:'custodial.browser-original-value-frame.v1',encoding:'MZBRV001',observation_sha256:h('observation'),
   frame_sha256:h('frame'),byte_count:1024,chunk_bytes:1048576,chunk_count:1,record_count:5,session_storage_state:'NOT_DECLARED_UNKNOWN',
   chunk_sha256:[h('frame')],native_authority:false,durable_retention:false,inventory_acknowledged:false,finalizer_allowed:false,key_removal:false},
  browser_part_set_sha256:h('parts'),browser_accepted_exact_original_count:1,browser_unresolved_retained_count:4,
  retained_key_families:families,...effects};
}
function expected(m,raw){
 return {inventory_native_request_id:m.native_request_id,registration_request_body_sha256:m.registration_request_body_sha256,
  intent_document_sha256:m.intent_document_sha256,intent_disk_sha256:m.intent_disk_sha256,
  original_target:structuredClone(m.original_target),manifest_sha256:sha(raw)};
}
function saved(m=fixture(),text){const raw=Buffer.from(text??JSON.stringify(m));return {m,raw,expected:expected(m,raw)};}
function refuses(f,raw=f.raw,original=f.expected){
 const before=!types.isProxy(raw)&&Buffer.isBuffer(raw)?Buffer.from(raw):null;
 assert.throws(()=>decode(raw,original),e=>e.code==='native_original_inventory_manifest_invalid'&&e.outcome==='UNKNOWN'&&e.retry_safe===false);
 if(before)assert.deepEqual(raw,before);
}
function changed(edit){const m=fixture();edit(m);refuses(saved(m));}
function allFrozen(value){if(value&&typeof value==='object'){assert(Object.isFrozen(value));for(const item of Object.values(value))allFrozen(item);}}

const tests={
 v2_original_argument_bytes_survive_without_numeric_normalization(){
  const m=fixture();m.schema='custodial.native-original-complete-inventory-manifest.v2';
  const argument=' \n{"original_integer":9223372036854775807,"precise":1.000000000000000001,"text":"🙂"}\t';
  for(const row of [...m.native_records,...m.browser_records])if(row.completion_readback){
   const c=row.completion_readback;c.original_arguments_utf8=argument;c.argument_sha256=sha(argument);
   c.readback.argument_values_sha256=c.argument_sha256;
  }
  const f=saved(m),out=decode(...args(f));
  for(const row of [...out.native_records,...out.browser_records])if(row.completion_readback)
   assert.equal(row.completion_readback.original_arguments_utf8,argument);
  assert.ok(Object.isFrozen(out));assert.deepEqual(f.raw,Buffer.from(JSON.stringify(m)));
 },
 v2_missing_changed_or_foreign_original_arguments_refuse(){
  function complete(){
   const m=fixture();m.schema='custodial.native-original-complete-inventory-manifest.v2';
   for(const row of [...m.native_records,...m.browser_records])if(row.completion_readback){
    const c=row.completion_readback;c.original_arguments_utf8=' {"raw":"original"}\n';
    c.argument_sha256=sha(c.original_arguments_utf8);c.readback.argument_values_sha256=c.argument_sha256;
   }return m;
  }
  for(const edit of [c=>delete c.original_arguments_utf8,c=>c.original_arguments_utf8+=' ',
   c=>c.original_arguments_utf8=null,c=>c.original_arguments_utf8={raw:'original'},
   c=>c.argument_sha256=h('other'),c=>c.readback.argument_values_sha256=h('other')]){
   const m=complete();edit(m.native_records.find(row=>row.completion_readback).completion_readback);refuses(saved(m));
  }
  const old=fixture();old.native_records.find(row=>row.completion_readback).completion_readback.original_arguments_utf8='{}';
  refuses(saved(old)); // v1 is NOT silently interpreted/upgraded as v2.
 },
 v2_original_arguments_have_independent_four_MiB_bound(){
  const m=fixture();m.schema='custodial.native-original-complete-inventory-manifest.v2';
  for(const row of [...m.native_records,...m.browser_records])if(row.completion_readback){
   const c=row.completion_readback;c.original_arguments_utf8='{}';c.argument_sha256=sha('{}');
   c.readback.argument_values_sha256=c.argument_sha256;
  }
  const c=m.native_records.find(row=>row.completion_readback).completion_readback;
  c.original_arguments_utf8=' '.repeat(4194305);c.argument_sha256=sha(c.original_arguments_utf8);
  c.readback.argument_values_sha256=c.argument_sha256;
  const f=saved(m);assert.ok(f.raw.length<16777216);refuses(f);
 },
 strict_allowed_numeric_spellings_and_realm_bounds(){
  const f=saved(),source=f.raw.toString('utf8');
  for(const spelling of ['0.0','0e0','0E+0','-0']){
   const text=source.replace('"ordinal":0','"ordinal":'+spelling);
   assert.notEqual(text,source);
   const raw=Buffer.from(text);refuses(f,raw,{...f.expected,manifest_sha256:sha(raw)});
  }
  for(const spelling of ['1.0','1e0']){
   const text=source.replace('"record_count":1','"record_count":'+spelling);
   assert.notEqual(text,source);
   const raw=Buffer.from(text);refuses(f,raw,{...f.expected,manifest_sha256:sha(raw)});
  }
  changed(m=>m.browser_domains[4].database_utf16be_base64=units('z'.repeat(1025)));
  changed(m=>m.browser_domains[4].version=9007199254740992);
  changed(m=>m.browser_domains[4].version=0);
  changed(m=>m.browser_domains[4].version='1');
  changed(m=>m.browser_domains[4].record_count=4097);
  changed(m=>m.native_namespaces[0].record_count='1');
  changed(m=>m.native_records[0].ordinal='0');
  changed(m=>m.key_removal='false');
  changed(m=>m.browser_value_frame.durable_retention=true);
 },
 exact_original_and_detached_untrusted(){
  const f=saved(),rawBefore=Buffer.from(f.raw),expectedBefore=structuredClone(f.expected),value=decode(f.raw,f.expected);
  assert.deepEqual(value,f.m);assert.deepEqual(f.raw,rawBefore);assert.deepEqual(f.expected,expectedBefore);allFrozen(value);
  assert.equal(value.native_namespaces.length,8);assert.equal(value.browser_records.length,5);
  assert.equal(value.native_records.filter(x=>x.disposition===A).length,3);
  assert.equal(value.browser_records[3].key_sha256,value.browser_records[4].key_sha256);
  assert.notEqual(value.browser_records[3].ordinal,value.browser_records[4].ordinal);
  f.raw.fill(0);f.expected.original_target.operation_id=uuid(200);f.m.browser_records.pop();
  assert.equal(value.browser_records.length,5);assert.notEqual(value.original_target.operation_id,f.expected.original_target.operation_id);
  for(const key of Object.keys(effects))assert.equal(value[key],false);
  assert.throws(()=>{value.browser_records[0].disposition=A;},TypeError);
  assert.equal(value.native_records[2].completion_readback.readback.transaction_authority,false);
  assert(!Object.hasOwn(value,'transaction_authority'));assert(!Object.hasOwn(value,'authenticated'));
 },
 original_digest_target_and_expected_ownership(){
  const f=saved();
  for(const key of Object.keys(f.expected)){
   const p=structuredClone(f.expected);
   if(key==='original_target')p[key].operation_id=uuid(100);else p[key]=key==='inventory_native_request_id'?uuid(100):h('wrong');
   refuses(f,f.raw,p);
   const missing=structuredClone(f.expected);delete missing[key];refuses(f,f.raw,missing);
  }
  refuses(f,Buffer.concat([f.raw,Buffer.from(' ')]));
  for(const key of ['manifest_sha256','original_target']){
   const getter={...f.expected};Object.defineProperty(getter,key,{enumerable:true,get(){throw Error('must not invoke');}});refuses(f,f.raw,getter);
  }
  refuses(f,f.raw,new Proxy(f.expected,{ownKeys(){throw Error('must not invoke');}}));
  refuses(f,f.raw,{...f.expected,ack:true});
  const p=structuredClone(f.expected);p.original_target=new Proxy(p.original_target,{});refuses(f,f.raw,p);
 },
 strict_json_and_bounds(){
  const f=saved();const source=f.raw.toString('utf8');
  for(const text of ['{"schema":"duplicate",'+source.slice(1),
   source.replace('"schema":','"\\u0073chema":"duplicate","schema":'),
   source+' false','[]','null','{"a":1.0}','{"a":1e0}','{"a":-0}','{"a":9007199254740992}',
   source.replace('"DURABLE_HELD:1"','"\\ud800"'),source.replace('"DURABLE_HELD:1"','"\\udc00"'),
   '\ufeff'+source,' '.repeat(10),source.replace('"schema"',"schema")]){
   const raw=Buffer.from(text),pin={...f.expected,manifest_sha256:sha(raw)};refuses(f,raw,pin);
  }
  const invalid=Buffer.from([0xc3,0x28]);refuses(f,invalid,{...f.expected,manifest_sha256:sha(invalid)});
  refuses(f,Buffer.alloc(0));refuses(f,Buffer.alloc(16777217));refuses(f,new Uint8Array(f.raw));
  refuses(f,new Proxy(f.raw,{}));
  const shared=Buffer.from(new SharedArrayBuffer(f.raw.length));f.raw.copy(shared);refuses(f,shared);
  changed(m=>m.extra=true);changed(m=>delete m.browser_records);
  changed(m=>m.native_held_stamp='DURABLE_HELD:0');changed(m=>m.native_held_stamp='DURABLE_HELD:9223372036854775808');
  // Actual private complete-input ceiling, including valid trailing whitespace.
  // This remains a new decoder case, not a replay of provider-parser tests.
  const maximum=Buffer.alloc(16777216,32);f.raw.copy(maximum);
  assert.equal(decode(maximum,{...f.expected,manifest_sha256:sha(maximum)}).native_request_id,f.m.native_request_id);
  assert.equal(nativeProviderJsonLimits.MAX_BYTES,65536);
  assert.throws(()=>parseNativeProviderJson(maximum),e=>e.code==='native_provider_json_invalid');
 },
 native_partitions_families_and_counts(){
  changed(m=>m.native_namespaces.pop());changed(m=>m.native_namespaces[0]=m.native_namespaces[1]);
  changed(m=>m.native_namespaces.reverse());changed(m=>m.native_namespaces[0].record_count++);
  changed(m=>m.native_namespaces[2].accepted_exact_original_count--);changed(m=>m.native_namespaces[0].unresolved_retained_count=0);
  changed(m=>m.native_records[0].ordinal=1);changed(m=>m.native_records[0].key_family='SHARED_VAULT_V2');
  changed(m=>m.native_records[0].raw_type='NUMBER');changed(m=>m.native_records[0].local_source_classification='unavailable');
  changed(m=>m.native_records[0].raw_identity_sha256='A'.repeat(64));
  changed(m=>m.native_records[3].raw_identity_sha256=m.native_records[2].raw_identity_sha256);
  changed(m=>m.native_records[0].namespace='FOREIGN');changed(m=>m.native_records[1].namespace=m.native_records[0].namespace);
  changed(m=>m.native_records.pop());changed(m=>m.retained_key_families.pop());
  changed(m=>m.retained_key_families[0].source_declared_raw_rows_to_preserve++);
  changed(m=>m.retained_key_families[0].possible_undeclared_references='NONE');
  changed(m=>m.retained_key_families[0].all_writer_durable_freeze_or_ABA_guard=true);
 },
 realm_code_units_empty_unknown_and_original_multiplicity(){
  const f=saved(),value=decode(f.raw,f.expected);
  assert.equal(value.browser_domains[1].record_count,null);
  assert.equal(value.browser_domains[2].object_store_utf16be_base64,null);
  assert.equal(value.browser_domains[5].object_store_utf16be_base64,'');
  const bytes=Buffer.from(value.browser_domains[4].database_utf16be_base64,'base64');
  assert.equal(bytes.readUInt16BE(bytes.length-2),0xd800);
  const store=Buffer.from(value.browser_domains[4].object_store_utf16be_base64,'base64');
  assert.equal(store.readUInt16BE(store.length-2),0xdc00);
  const known=fixture();known.browser_domains[1].record_count=0;known.browser_domains[1].state=R;
  known.browser_value_frame.session_storage_state='CAPTURED_READ_ONLY_NOT_AUTHENTICATED';decode(...args(saved(known)));
  // Names are code units, not UTF8 scalars. Valid pairs, NUL and delimiter
  // characters preserve separate exact realms without ambiguous joined keys.
  const pair=fixture();pair.browser_domains[4].database_utf16be_base64=units('z\0|\ud83d\ude03');
  pair.browser_domains[4].object_store_utf16be_base64=units('\0|\ud800');decode(...args(saved(pair)));
  changed(m=>m.browser_realm_name_encoding='UTF8');
  changed(m=>m.browser_domains[4].database_utf16be_base64='YQ=='); // odd bytes
  changed(m=>m.browser_domains[4].database_utf16be_base64='YR=='); // noncanonical pad bits
  changed(m=>m.browser_domains[4].database_utf16be_base64+=' ');
  changed(m=>m.browser_domains[4].domain_ordinal=3);
  changed(m=>m.browser_domains[1].record_count=0);
  changed(m=>m.browser_domains[2].record_count=1);
  changed(m=>m.browser_domains[5].database_utf16be_base64=m.browser_domains[4].database_utf16be_base64);
  changed(m=>m.browser_domains[0].version=1);
  changed(m=>m.browser_records[0].domain_ordinal=1);
  changed(m=>m.browser_records[1].domain_ordinal=4);
  changed(m=>m.browser_records[4].ordinal=3);
  changed(m=>m.browser_records.pop());
  changed(m=>m.browser_domains[4].record_count=1);
  changed(m=>m.browser_unresolved_retained_count--);
  changed(m=>m.browser_value_frame.record_count--);
  changed(m=>m.browser_value_frame.session_storage_state='CAPTURED_READ_ONLY_NOT_AUTHENTICATED');
  changed(m=>m.browser_value_frame.chunk_sha256[0]=h('foreign'));
 },
 completion_claims_are_closed_data_never_effects(){
  const m=fixture();
  m.native_records[2].disposition=U;m.native_records[2].completion_readback=completion(m.original_target,false);
  m.native_namespaces[2].accepted_exact_original_count--;m.native_namespaces[2].unresolved_retained_count++;
  assert.equal(decode(...args(saved(m))).native_records[2].completion_readback.readback.result,null);
  for(const flag of Object.keys(effects)){
   changed(m=>m[flag]=true);changed(m=>m.native_records[2].completion_readback.readback.limits[flag]=true);
  }
  changed(m=>m.native_records[2].completion_readback=null);
  changed(m=>m.native_records[2].completion_readback.readback.result=null);
  changed(m=>m.native_records[2].completion_readback.argument_sha256=h('foreign'));
  changed(m=>m.native_records[2].completion_readback.readback.operation_id=uuid(100));
  changed(m=>m.native_records[2].completion_readback.readback.transaction_authority=true);
  changed(m=>m.native_records[2].completion_readback.readback.result.credential_id=uuid(100));
  changed(m=>m.native_records[2].completion_readback.readback.result.started_at='2026-02-30T11:00:00.123000Z');
  changed(m=>m.native_records[2].completion_readback.readback.result.ended_at=m.native_records[2].completion_readback.readback.result.started_at);
  changed(m=>m.native_records[2].completion_readback.readback.result.assignment_epoch='01');
  changed(m=>m.native_records[0].completion_readback=completion(m.original_target));
  changed(m=>m.browser_records[0].completion_readback=completion(m.original_target));
  changed(m=>m.browser_records[1].completion_readback.readback.disposition=U);
 },
};
function args(f){return [f.raw,f.expected];}
export {fixture as createOriginalInventoryManifestFixture,expected as originalInventoryManifestPins};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const selected=process.argv.slice(2);
 if(selected.length!==2||selected[0]!=='--manifest-only'||!Object.hasOwn(tests,selected[1]))throw Error('Select one NEW manifest decoder DATA member');
 tests[selected[1]]();console.log('PASS_UNTRUSTED_MANIFEST_DATA_ONLY '+selected[1]);
}
