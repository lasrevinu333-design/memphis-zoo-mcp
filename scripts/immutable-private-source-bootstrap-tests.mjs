#!/usr/bin/env node
// Retained UNIT archive + actual shipping Source composition, never an
// installer, SQL fixture, signer, target observation or restore authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openSync,closeSync,readFileSync,fstatSync,lstatSync,realpathSync,existsSync,constants} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {types} from 'node:util';
import {materializeVerifiedArchive,readVerifiedArchiveSourceBinding,decodeRestoreTableRowLine} from './disaster-recovery-archive.mjs';
import {prepareVerifiedImmutableBootstrapSource,assertVerifiedImmutableBootstrapSource,
 readVerifiedImmutableBootstrapAcls,readVerifiedImmutableBootstrapSourceRows} from './immutable-private-source-bootstrap.mjs';

// Only NEW direct refusal checks for the private post-authority fence entry.
// No archive/client connection/SQL/transaction/HMAC or positive ancestry is
// fabricated. These checks do not prove the owning native transition.
if(process.argv.includes('--post-authority-fence-refusal-only')){
 const {holdVerifiedImmutableFreshPostAuthorityFence:hold}=await import('./immutable-private-data-import.mjs');
 const pg=(await import('pg')).default;let getters=0,queries=0,cases=0;
 const refused=error=>error?.code==='IMMUTABLE_FRESH_POST_AUTHORITY_CONTINUATION_UNAVAILABLE'
  &&error.outcome==='UNKNOWN'&&error.retry_safe===false&&!Object.hasOwn(error,'cause')
  &&['complete_restore','resume_allowed','retry_allowed','rerun_import_allowed','inventory_acknowledged','effects'].every(key=>error[key]===false);
 const archive=Object.freeze({});
 const planned={phase:'COMMIT_ACKNOWLEDGED',authorityPhase:'COMMIT_ACKNOWLEDGED',
  originalDataReadback:{state:'MATCH'},authorityCompletion:{state:'CONSUMED_PAUSED'},
  query:()=>{queries++;throw Error('UNIT must not query');}};
 const options=[
  null,{}, {db:null,verifiedArchive:archive},
  {db:planned,verifiedArchive:archive},
  {db:new pg.Client(),verifiedArchive:archive},
  {db:planned,verifiedArchive:archive,receipt:{outcome:'AUTHORITY_COMPLETION_OBSERVED'}},
  {db:new Proxy({}, {get(){getters++;throw Error('UNIT proxy');}}),verifiedArchive:archive},
  Object.defineProperty({verifiedArchive:archive},'db',{enumerable:true,get(){getters++;throw Error('UNIT getter');}}),
  new Proxy({}, {ownKeys(){getters++;throw Error('UNIT option proxy');}}),
 ];
 for(const input of options){await assert.rejects(hold(input),refused);cases++;}
 assert.equal(getters,0);assert.equal(queries,0);
 console.log(JSON.stringify({scope:'NEW_DIRECT_PRIVATE_POST_AUTHORITY_FENCE_REFUSALS_ONLY',cases,
  SQL:false,connections:0,positive_native_ancestry:'NOT_RUN',restoration:false,resources:0}));
 process.exit(0);
}

// NEW fixed pure-helper Source joins only. Inert function-source components
// below are NOT native clients, original authenticated inputs, private scope
// admission, SQL execution or ACK/effect/restart/ABA evidence.
if(process.argv.includes('--immutable-text-helper-source-only')||process.argv.includes('--immutable-archive-io-currentness-only')){
 const ioOnly=process.argv.includes('--immutable-archive-io-currentness-only');
 const {isDeepStrictEqual}=await import('node:util'),{Readable}=await import('node:stream');
 const {pipeline}=await import('node:stream/promises'),{createInterface}=await import('node:readline');
 const pg=(await import('pg')).default,archive=await import('./disaster-recovery-archive.mjs');
 const text=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
 const v1=archive.postgresJsonTextLineEncoding,v2=archive.postgresTextColumnsLineEncoding;
 const base=readFileSync(new URL('../proposals/immutable-private-owner-context.sql',import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(base).digest('hex'),'f0c870ea6691552b47daa8eb962645512b74cdd8d26078cef05a42f52116fc55');
 const nativeCode=text.slice(text.indexOf('function nativeData(object,key){'),text.indexOf('// Capture actual original transport objects'));
 const closedCode=text.slice(text.indexOf('function closed(value,keys) {'),text.indexOf('// Actual pg.Result has additional own fields/prototype;'));
 const helperCode=text.slice(text.indexOf('const immutableTextHelperSourceSql = '),text.indexOf('// Read-only DATA comparison, never a restore/COMMIT/admission capability.'));
 assert.ok(helperCode.startsWith('const immutableTextHelperSourceSql = '));
 const refusal=()=>{throw Error('UNIT private fixed Source refusal');};
 const pure=new Function('types','isDeepStrictEqual','createHash','fail',nativeCode+closedCode+helperCode+
  '\nreturn {sql:immutableTextHelperSourceSql,capture:immutableTextHelperSource};')(types,isDeepStrictEqual,createHash,refusal);
 // Exact predicate reused from sealed Storage68d, not another Source policy.
 assert.equal(createHash('sha256').update(pure.sql).digest('hex'),'6a1413f50302d00f0eeaf38faa852db6f976364a58f53efb767b5469384a92be');
 const originalBody=name=>{const marker='CREATE FUNCTION custodial_dr.'+name+'(';assert.equal(base.split(marker).length,2);
  const a=base.indexOf('AS $fn$',base.indexOf(marker))+'AS $fn$'.length,b=base.indexOf('$fn$;',a);assert.ok(a>0&&b>a);return base.slice(a,b);};
 const helperRows=()=>[
  {oid:'500',name:'immutable_import_text_projection',arguments:'2283',returns:'25',argument_names:['original_record']},
  {oid:'501',name:'immutable_import_text_record',arguments:'2283 25',returns:'2283',argument_names:['prototype','original_row_utf8']},
 ].map(value=>({...value,body:originalBody(value.name),definition:'UNIT_COMPONENT_DEFINITION_'+value.name,
  config:['search_path=pg_catalog','extra_float_digits=3','datestyle=ISO, YMD','timezone=UTC','intervalstyle=postgres','bytea_output=hex'],source_attributes:'true'}));
 let cases=ioOnly?0:2;
 if(!ioOnly){
 const first=helperRows(),profile=pure.capture(first);
 assert.ok(Object.isFrozen(profile)&&profile.every(row=>Object.isFrozen(row)&&Object.isFrozen(row.config)&&Object.isFrozen(row.argument_names)));
 first[0].config[0]='CHANGED';first[0].argument_names[0]='CHANGED';first[0].definition='CHANGED';
 assert.equal(profile[0].config[0],'search_path=pg_catalog');assert.equal(profile[0].argument_names[0],'original_record');
 assert.notEqual(profile[0].definition,'CHANGED');assert.deepEqual(pure.capture(helperRows(),profile),profile);cases++;
 for(const change of [rows=>[],rows=>rows.slice(0,1),rows=>[...rows,{...rows[0]}],rows=>rows.reverse(),
  rows=>{rows[0].oid=500;return rows;},rows=>{rows[0].oid='0500';return rows;},rows=>{rows[0].oid='4294967296';return rows;},
  rows=>{rows[1].oid=rows[0].oid;return rows;},rows=>{rows[0].name='foreign';return rows;},
  rows=>{rows[0].arguments='25';return rows;},rows=>{rows[0].returns='114';return rows;},
  rows=>{rows[0].body+='\n';return rows;},rows=>{rows[0].body=null;return rows;},
  rows=>{rows[0].source_attributes='false';return rows;},rows=>{rows[0].source_attributes=null;return rows;},
  rows=>{rows[0].config[0]='search_path=public';return rows;},rows=>{rows[0].config[1]='extra_float_digits=1';return rows;},
  rows=>{rows[0].config.push('role=postgres');return rows;},rows=>{rows[0].config.reverse();return rows;},
  rows=>{rows[0].argument_names=['other'];return rows;},rows=>{rows[0].extra=true;return rows;}]){
  assert.throws(()=>pure.capture(change(helperRows())));cases++;
 }
 for(const change of [rows=>{rows[0].oid='502';return rows;},rows=>{rows[0].definition+=' changed';return rows;},
  rows=>{rows[0].config[2]='DateStyle=ISO, YMD';return rows;}]){
  const changed=change(helperRows());pure.capture(changed);assert.throws(()=>pure.capture(changed,profile));cases++;
 }
 let getters=0;
 for(const bad of [rows=>{Object.defineProperty(rows[0],'body',{get(){getters++;throw Error('PRIVATE GETTER');},enumerable:true});return rows;},
  rows=>{rows[0].config=new Proxy([],{get(){getters++;throw Error('PRIVATE PROXY');}});return rows;},
  rows=>{Object.setPrototypeOf(rows[0].argument_names,{});return rows;}]){assert.throws(()=>pure.capture(bad(helperRows())));cases++;}
 assert.equal(getters,0);
 }
 const targetCode=text.slice(text.indexOf('const committedAuthorityTargets='),text.indexOf('\nfunction currentCommittedAuthorityData'));
 const imageCode=text.slice(text.indexOf('function committedAuthorityImageSql('),text.indexOf('\n// Inspect only THIS module'));
 const definitions=new Function('fail','postgresJsonTextLineEncoding','postgresTextColumnsLineEncoding',targetCode+
  '\nreturn committedAuthorityTargets;')(refusal,v1,v2);
 const column=(name,data_type='text')=>({name,data_type,generated:'',identity:''});
 const clone=value=>structuredClone(value),select=rows=>({command:'SELECT',rowCount:rows.length,rows});
 const readbackCode=src=>src.slice(src.indexOf('export async function compareVerifiedImmutablePrivateTableData(options) {')).replaceAll('export async function ','async function ');
 function compile(src,p){
  const isNew=src.includes('const immutableTextHelperSourceSql = ');
  return new Function('p','types','isDeepStrictEqual','createHash',`const {Client,query,readVerifiedPrivateImportSource,sameSource,fail,
   readVerifiedImmutableBootstrapInventory,deriveOriginalAuthEnumDescriptors,openVerifiedRestoreTableData,decodeRestoreTableRowLine,
   createRestoreRowUtf8Guard,createRestoreRowLineBatchDecoder,createInterface,pipeline,prepareVerifiedImmutableBootstrapSource,
   readVerifiedImmutableBootstrapSourceRows,postgresJsonTextLineEncoding,postgresTextColumnsLineEncoding,
   currentCommittedAuthorityData,readCommittedAuthorityFrame}=p;
   const committedAuthorityDataReads=new WeakMap(),committedAuthorityOrdinaryReads=new WeakSet();
   if(p.authority){committedAuthorityDataReads.set(p.db,p.authority);committedAuthorityOrdinaryReads.add(p.authority);}
   ${nativeCode}\n${closedCode}\n${isNew?helperCode:''}\n${targetCode}\n${imageCode}\n${readbackCode(src)}
   return {compareVerifiedImmutablePrivateTableData,compareVerifiedImmutableOrdinaryTableData};`)(p,types,isDeepStrictEqual,createHash);
 }
 async function recording(kind,option={},src=text){
  let live=true,failed=false,changedDuringIo=false;
  const trace={queries:[],helpers:0,opens:0,closes:0,compares:0,frames:0,afterFailure:0};
  const source=()=>{if(!live)throw Error('PRIVATE WITHDRAWN SOURCE');};
  const encoding=option.encoding??v2;
  const ordinary=[{schema_name:'auth',table_name:'unit_rows',columns:[column('id','bigint'),column('payload','json')],primary_key:['id']},
   {schema_name:'public',table_name:'release_deployment_manifest',columns:[column('id','bigint'),column('payload','json')],primary_key:['id']},
   {schema_name:'public',table_name:'custodial_release_authority_restore_inventory',columns:[column('id','bigint'),column('object_kind'),
    column('object_identity'),column('definition_sql'),column('definition_sha256'),column('payload','json')],primary_key:['id']}];
  if(option.authority)for(const target of definitions){
   const fields=[column(target.primaryKey,'uuid'),...target.changed.map(name=>column(name,name==='enabled'?'boolean'
     :['revoked_at','updated_at'].includes(name)?'timestamp with time zone':'text')),column('payload','json')];
   ordinary.push({schema_name:target.schema,table_name:target.table,columns:fields,primary_key:[target.primaryKey]});
  }
  const privateTables=['employee_message_original_outcomes','group_original_creations'].map(table_name=>({
   schema_name:'custodial_release_identity',table_name,columns:[column('id','bigint'),column('payload','json')],primary_key:['id']}));
  const tables=[...ordinary,...privateTables].map(t=>({...t,data_file:'database/'+t.schema_name+'.'+t.table_name+'.jsonl',
   row_count:option.emptyOrdinary&&t.schema_name==='auth'&&t.table_name==='unit_rows'?'0':'1',data_encoding:encoding}));
  const originals=new Map(tables.map(t=>{
   const registry=t.table_name==='custodial_release_authority_restore_inventory';
   const raw=Object.fromEntries(t.columns.map(c=>[c.name,c.data_type==='uuid'?'10000000-0000-4000-8000-000000000001'
    :c.name==='id'?'9007199254740993':c.name==='payload'?'null':c.name==='object_kind'?'function':c.name==='object_identity'?'unit_fn()'
    :c.name==='definition_sql'?'ORIGINAL':c.name==='definition_sha256'?'original':c.name==='status'?'active':c.name==='enabled'?'true'
    :c.name==='updated_at'?'2026-10-18 00:00:00.123456+00':null]));
   return [t.data_file,encoding===v2?JSON.stringify(raw):registry
    ?'{"id":9007199254740993,"object_kind":"function","object_identity":"unit_fn()","definition_sql":"ORIGINAL","definition_sha256":"original","payload":null}'
    :'{"id":9007199254740993,"payload":null}'];
  }));
  const bytesFor=t=>t.row_count==='0'&&!option.extraOriginalRow?Buffer.alloc(0):Buffer.from(JSON.stringify(originals.get(t.data_file))+'\n');
  const binding=Object.freeze({component_only:true}),original={sourceBinding:binding,
   selection:{databaseTables:tables,privateTables:tables.slice(ordinary.length)},
   privateDataMembers:tables.slice(ordinary.length).map(t=>({...t,bytes:String(bytesFor(t).length),sha256:createHash('sha256').update(bytesFor(t)).digest('hex')}))};
  class ComponentClient{} // An isolated Source symbol; never supplied to the real native export.
  const db=new ComponentClient();
  const context={database_oid:'10',database_name:'UNIT',backend_pid:21,actor:'supabase_admin',session_actor:'supabase_admin',transaction_id:null,
   virtual_xid:'1/2',snapshot_id:'1:2:',transaction_started_at:'2026-10-18 00:00:00+00',read_only:'on',isolation:'repeatable read',
   row_security:'off',search_path:'pg_catalog, pg_temp',first_schema:'pg_catalog',float_digits:'3'};
  const query=async function(sql,params=[]){
   if(failed)trace.afterFailure++;
   trace.queries.push({sql,params:clone(params)});source();
   if(sql.includes(') context'))return select([{context:{...context,
    ...(sql.includes("'timezone'")?{timezone:'UTC',date_style:'ISO, YMD',interval_style:'postgres'}:{}),
    ...((option.changedContext&&trace.helpers)||(changedDuringIo&&(option.ioChange==='CONTEXT'||option.changeDuringCount))?{backend_pid:22}:{})}}]);
   if(sql.includes('source_attributes')){
    trace.helpers++;
    if(option.nativeErrorAt===trace.helpers){failed=true;const error=new pg.DatabaseError('PRIVATE NATIVE DETAIL',0,'error');error.code='42501';throw error;}
    if(option.withdrawAt===trace.helpers)live=false;
    if(option.replacePortAt===trace.helpers)db.query=()=>{throw Error('MUST NOT CALL REPLACEMENT');};
    return select(option.helperChange?option.helperChange(helperRows(),trace.helpers):helperRows());
   }
   if(sql.includes('inheritance_count')){
    const selected=sql.includes("n.nspname='custodial_release_identity'")?tables.slice(ordinary.length):tables.slice(0,ordinary.length);
    return select(selected.map((t,i)=>({schema_name:t.schema_name,table_name:t.table_name,relation_oid:String((t.schema_name==='custodial_release_identity'?200:100)+i),
     relation_kind:'r',persistence:'p',is_partition:false,owner_name:'supabase_admin',inheritance_count:'0',dropped_count:'0',columns:t.columns,primary_key:t.primary_key,
     ...(t.schema_name==='custodial_release_identity'?{}:{supported_io:!option.unsupported})})));
   }
   if(sql.startsWith('select pg_catalog.count(*)::text current_rows from only ')){
    trace.compares++;
    if(option.emptyReadError){failed=true;const error=new pg.DatabaseError('PRIVATE EMPTY SQL',0,'error');error.code='42501';throw error;}
    if(option.changeDuringCount)changedDuringIo=true;
    const counts={current_rows:option.currentEmptyRows??'0'};
    return select(option.duplicateCount?[counts,counts]:[counts]);
   }
   assert.ok(sql.includes('except all'));trace.compares++;
   assert.ok(params[0].every(raw=>[...originals.values()].includes(raw)));
   if(option.emptyOrdinary&&sql.includes('"auth"."unit_rows"')&&params[0].length===0){
    const current=option.currentEmptyRows??'0';
    return select([{original_rows:'0',current_rows:current,missing_rows:'0',extra_rows:current}]);
   }
   if(sql.includes('original_keys')){
    const deleted=sql.includes('"auth"."sessions"');
    return select([{original_rows:'1',original_keys:'1',transformed_rows:'1',expected_rows:deleted?'0':'1',current_rows:deleted?'0':'1',
     missing_rows:'0',extra_rows:'0',clock_fields_valid:true}]);
   }
   const counts={original_rows:'1',current_rows:'1',missing_rows:'0',extra_rows:'0'};
   if(sql.includes('transformed_rows'))Object.assign(counts,{expected_rows:'1',transformed_rows:sql.includes('"custodial_release_authority_restore_inventory"')?'1':'0'});
   return select([counts]);
  };
  ComponentClient.prototype.query=query;
  const authority=option.authority?{frame:{effect_transaction_started_at:'2026-10-18 00:00:00+00'},state:{original},
   completion:{authority_generation:'1',revocations:Object.fromEntries(definitions.map(t=>[t.counter,'1']))}}:undefined;
  const p={Client:ComponentClient,query,db,authority,fail:refusal,readVerifiedPrivateImportSource:()=>original,sameSource:source,
   currentCommittedAuthorityData:()=>source(),readCommittedAuthorityFrame:async()=>{source();trace.frames++;
    if(changedDuringIo&&option.ioChange==='FRAME')throw Error('PRIVATE FRAME CHANGED');},
   readVerifiedImmutableBootstrapInventory:()=>{source();return {sourceBinding:binding,inventory:{'inventory/application-schema.sql':'UNIT enum fixture dependency'}};},
   deriveOriginalAuthEnumDescriptors:()=>[],postgresJsonTextLineEncoding:v1,postgresTextColumnsLineEncoding:v2,pipeline,createInterface,
   decodeRestoreTableRowLine:archive.decodeRestoreTableRowLine,createRestoreRowUtf8Guard:archive.createRestoreRowUtf8Guard,
   createRestoreRowLineBatchDecoder:archive.createRestoreRowLineBatchDecoder,
   openVerifiedRestoreTableData:(_archive,schema,name)=>{source();trace.opens++;const table=tables.find(t=>t.schema_name===schema&&t.table_name===name),bytes=bytesFor(table);
    const verified=option.eofFailure?Promise.reject(Error('PRIVATE EOF')):Promise.resolve({data_file:option.foreignEof?'foreign':table.data_file,bytes:bytes.length+(option.wrongEofBytes?1:0),
     sha256:createHash('sha256').update(bytes).digest('hex')});verified.catch(()=>{});
    const selected=table.schema_name==='auth'&&table.table_name==='unit_rows';
    const stream=selected&&option.ioChange?Readable.from((async function*(){
     await Promise.resolve();changedDuringIo=true;
     if(option.ioChange==='SOURCE')live=false;
     if(option.ioChange==='PORT')db.query=()=>{throw Error('MUST NOT CALL REPLACEMENT');};
     if(bytes.length)yield bytes;
    })()):Readable.from([bytes]);
    return {table,stream,verified,async close(){trace.closes++;if(option.closeFailure)throw Error('PRIVATE CLOSE');}};
   },prepareVerifiedImmutableBootstrapSource:async()=>{source();return {};},
   readVerifiedImmutableBootstrapSourceRows:()=>{source();return {sourceBinding:binding,metadata_only:true,tables:tables.slice(1,3).map(t=>({
    schema_name:t.schema_name,table_name:t.table_name,owner_name:'supabase_admin',originalRows:[originals.get(t.data_file)],
    replacements:t.table_name==='release_deployment_manifest'?{}:{'unit_fn()':{definition_sql:'REVIEWED',definition_sha256:'reviewed'}}}))};}};
  const api=compile(src,p);let value,error;
  try{value=await api[kind==='private'?'compareVerifiedImmutablePrivateTableData':'compareVerifiedImmutableOrdinaryTableData']({db,verifiedArchive:{}});}
  catch(caught){error=caught;}
  assert.equal(trace.opens,trace.closes,'Every opened owned loan closes exactly once');assert.equal(trace.afterFailure,0);
  return {value,error,trace};
 }
 if(ioOnly){
  const predecessorPath=process.env.IMMUTABLE_ARCHIVE_IO_PREDECESSOR;
  assert.ok(predecessorPath,'The exact immutable predecessor is required for this changed owning comparison');
  const before=readFileSync(predecessorPath,'utf8');
  assert.equal(createHash('sha256').update(before).digest('hex'),'6dd45a04f973ffb62c0730d1f5409cbdb660e0a178dd5b45f3c128970e781c5c');
  const observations=[];
  for(const encoding of [v1,v2]){
   for(const currentEmptyRows of ['0','2','9007199254740993']){
    const options={encoding,emptyOrdinary:true,currentEmptyRows};
    const old=await recording('ordinary',options,before),now=await recording('ordinary',options);
    assert.equal(old.error,undefined);assert.equal(now.error,undefined);
    assert.deepEqual(now.value,old.value,'Exact empty multiset counts/results, including extra target rows, are unchanged');
    const table=now.value.tables[0];
    assert.deepEqual(table,{schema_name:'auth',table_name:'unit_rows',state:currentEmptyRows==='0'?'MATCH':'DIFFERENT',
     original_rows:'0',current_rows:currentEmptyRows,missing_rows:'0',extra_rows:currentEmptyRows});
    const counts=now.trace.queries.filter(q=>q.sql.startsWith('select pg_catalog.count(*)::text current_rows from only '));
    assert.equal(counts.length,1);assert.deepEqual(counts[0].params,[]);
    assert.equal(counts[0].sql,'select pg_catalog.count(*)::text current_rows from only "auth"."unit_rows"');
    assert.ok(!counts[0].sql.includes('immutable_import_text_'));
    const contexts=run=>run.trace.queries.filter(q=>q.sql.includes(') context')).length;
    assert.ok(contexts(now)<contexts(old),'Owned file awaits do not re-read server frames before any DB work/result');
    assert.equal(now.trace.opens,3);assert.equal(now.trace.closes,3);
    assert.equal(now.trace.helpers,encoding===v2?7:0,'The empty table never invokes a typed decoder or helper profile');
    observations.push({encoding,currentEmptyRows,before_context_queries:contexts(old),after_context_queries:contexts(now)});cases++;
   }
   for(const ioChange of ['CONTEXT','SOURCE','PORT']){
    const denied=await recording('ordinary',{encoding,emptyOrdinary:true,ioChange});
    assert.equal(denied.error,undefined);assert.equal(denied.value.state,'UNSUPPORTED');
    assert.equal(denied.trace.compares,0,'Changed original server/Source/native port during owned file await refuses before SQL comparison');cases++;
   }
   const changedAfterRead=await recording('ordinary',{encoding,emptyOrdinary:true,changeDuringCount:true});
   assert.equal(changedAfterRead.error,undefined);assert.equal(changedAfterRead.value.state,'UNSUPPORTED');
   assert.equal(changedAfterRead.trace.compares,1,'The unchanged post-SQL original frame check refuses a changed backend');cases++;
   for(const option of [{extraOriginalRow:true},{foreignEof:true},{wrongEofBytes:true},{eofFailure:true},{closeFailure:true},
    {currentEmptyRows:'01'},{currentEmptyRows:0},{duplicateCount:true},{unsupported:true}]){
    const denied=await recording('ordinary',{encoding,emptyOrdinary:true,...option});
    assert.equal(denied.error,undefined);assert.equal(denied.value.state,'UNSUPPORTED');
    if(!Object.hasOwn(option,'currentEmptyRows')&&!option.duplicateCount)assert.equal(denied.trace.compares,0);cases++;
   }
   const nativeFailure=await recording('ordinary',{encoding,emptyOrdinary:true,emptyReadError:true});
   assert.equal(nativeFailure.value,undefined);assert.equal(nativeFailure.error.code,'IMMUTABLE_ORDINARY_DATA_READBACK_SQL_FAILED');
   assert.equal(nativeFailure.error.sql_state,'42501');assert.equal(nativeFailure.trace.afterFailure,0);
   assert.doesNotMatch(JSON.stringify(nativeFailure.error)+nativeFailure.error.stack,/PRIVATE EMPTY SQL/);cases++;
   const frame=await recording('ordinary',{encoding,emptyOrdinary:true,authority:true,ioChange:'FRAME'});
   assert.equal(frame.error,undefined);assert.equal(frame.value.state,'UNSUPPORTED');assert.equal(frame.trace.compares,0);cases++;
   const nonempty=await recording('ordinary',{encoding,ioChange:'CONTEXT'});
   assert.equal(nonempty.error,undefined);assert.equal(nonempty.value.state,'UNSUPPORTED');
   assert.equal(nonempty.trace.compares,0,'The file-I/O change also keeps the nonempty owning comparison guarded');cases++;
  }
  const unknown=await recording('ordinary',{encoding:'UNKNOWN',emptyOrdinary:true});
  assert.equal(unknown.error,undefined);assert.equal(unknown.value.state,'UNSUPPORTED');assert.equal(unknown.trace.compares,0);cases++;
  console.log(JSON.stringify({selector:'immutable-archive-io-currentness-only',cases,observations,
   source_component_only:true,native_SQL:'NOT_RUN',current_native_auth_or_ABA:'NOT_PROVED',
   unchanged_groups_replayed:0,connections:0,signatures:0,provider_calls:0,resources0:true}));process.exit(0);
 }
 // New source-join behavior, not a replay of the prior 48 readback cases.
 for(const kind of ['private','ordinary']){
  const matched=await recording(kind);assert.equal(matched.error,undefined);
  assert.equal(matched.value.state,kind==='private'?'MATCH':'SOURCE_TRANSFORMATION_VERIFIED');
  assert.equal(matched.trace.helpers,kind==='private'?7:10);assert.ok(Object.isFrozen(matched.value));cases++;
  for(const change of [()=>[],rows=>rows.slice(0,1),rows=>[...rows,{...rows[1]}],
    rows=>{rows[0].body+=' altered';return rows;},rows=>{rows[0].source_attributes='false';return rows;},
    rows=>{rows[0].config[5]='bytea_output=escape';return rows;}]){
   const denied=await recording(kind,{helperChange:change});assert.equal(denied.error,undefined);assert.equal(denied.value.state,'UNSUPPORTED');
   assert.equal(denied.trace.compares,0);assert.equal(denied.trace.opens,0);cases++;
  }
  for(const at of [2,3,kind==='private'?7:10]){
   const denied=await recording(kind,{helperChange:(rows,n)=>{if(n===at)rows[0].oid='502';return rows;}});
   assert.equal(denied.error,undefined);assert.equal(denied.value.state,'UNSUPPORTED');
   assert.equal(denied.trace.compares,at===2?0:at===3?1:kind==='private'?2:3);cases++;
  }
  for(const option of [{withdrawAt:1},{withdrawAt:2},{replacePortAt:1},{changedContext:true},{eofFailure:true},{closeFailure:true}]){
   const denied=await recording(kind,option);assert.equal(denied.error,undefined);assert.equal(denied.value.state,'UNSUPPORTED');cases++;
  }
  // The row loan is already closed BEFORE helper read2; a close failure
  // would correctly stop earlier and cannot be used to fabricate this query.
  const failed=await recording(kind,{nativeErrorAt:2});assert.equal(failed.value,undefined);
  assert.equal(failed.error.code,kind==='private'?'IMMUTABLE_PRIVATE_DATA_READBACK_SQL_FAILED':'IMMUTABLE_ORDINARY_DATA_READBACK_SQL_FAILED');
  assert.equal(failed.error.sql_state,'42501');assert.equal(Object.hasOwn(failed.error,'cause'),false);
  assert.doesNotMatch(JSON.stringify(failed.error)+failed.error.stack,/PRIVATE NATIVE DETAIL|9007199254740993|DECLARE/);cases++;
 }
 const transformed=await recording('ordinary',{authority:true});assert.equal(transformed.error,undefined);
 assert.equal(transformed.value.state,'SOURCE_TRANSFORMATION_VERIFIED');assert.equal(transformed.trace.compares,9);
 assert.ok(transformed.trace.frames>0);assert.equal(transformed.value.tables.filter(t=>t.transformation==='COMMITTED_IMMUTABLE_AUTHORITY').length,6);cases++;
 for(const at of [11,12,14,15,17,18,20,21,23,24,26,27,28]){
  const denied=await recording('ordinary',{authority:true,helperChange:(rows,n)=>{if(n===at)rows[0].oid='502';return rows;}});
  assert.equal(denied.error,undefined);assert.equal(denied.value.state,'UNSUPPORTED');cases++;
 }
 // Aggregate receipt closures use their existing full context/frame ports,
 // never a new public positive native or private ancestry fixture.
 for(const name of ['inspectCommittedImmutableFreshData','inspectCommittedImmutableFreshAuthorityData']){
  const start=text.indexOf('export async function '+name+'('),end=text.indexOf('\n}\n',start)+3,method=text.slice(start,end);
  const a=method.indexOf('    let originalTextHelpers;'),b=method.indexOf(name.endsWith('AuthorityData')?"    readPhase='PRIVATE_DATA';":'    // This function is appended',a);
  const begin=method.slice(a,b),final="if(hasTextColumns){readPhase='TEXT_HELPER_SOURCE';await textHelpersCurrent();current();}";
  assert.ok(a>0&&b>a&&method.indexOf(final,method.indexOf("readPhase='FINAL_CONTEXT'"))>0);
  assert.ok(method.lastIndexOf(final)<method.lastIndexOf('return Object.freeze('));
  const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
  const build=new AsyncFunction('p','types','isDeepStrictEqual','createHash',`const {state,db,query,context,current,readCommittedAuthorityFrame,
    verifiedArchive,descriptor,before,unavailable,fail,postgresTextColumnsLineEncoding}=p;${nativeCode}\n${closedCode}\n${helperCode}\nlet readPhase='UNIT';
    ${begin}\nreturn {async finish(){${final}return readPhase;}};`);
  for(const option of [{},{missing:true},{drift:true},{withdraw:true},{contextChanged:true},{encoding:v1}]){
   let reads=0,contexts=0,frames=0,live=true;const before={opaque:'same-native-context-component-only'};
   const current=()=>{if(!live)throw Error('UNIT current Source unavailable');};
   const p={state:{original:{selection:{databaseTables:[{data_encoding:option.encoding??v2}]}}},db:{},verifiedArchive:{},descriptor:{},before,
    fail:refusal,unavailable:refusal,postgresTextColumnsLineEncoding:v2,current,context:async()=>{current();contexts++;return option.contextChanged&&reads?{}:before;},
    readCommittedAuthorityFrame:async()=>{current();frames++;},query:async()=>{reads++;const rows=helperRows();
     if(reads===2&&option.drift)rows[0].oid='502';if(reads===2&&option.withdraw)live=false;return select(option.missing?[]:rows);}};
   let error,value;try{const run=await build(p,types,isDeepStrictEqual,createHash);value=await run.finish();}catch(caught){error=caught;}
   if(option.missing||option.drift||option.withdraw||(option.contextChanged&&!name.endsWith('AuthorityData')))assert.ok(error);
   else{assert.equal(error,undefined);assert.equal(reads,option.encoding===v1?0:2);}
   if(option.encoding===v1)assert.equal(contexts+frames,0);cases++;
  }
 }
 const predecessorPath=process.env.IMMUTABLE_TEXT_HELPER_PREDECESSOR;
 let predecessor='NOT_RUN',v1Unchanged='NOT_RUN';
 if(predecessorPath){
  const before=readFileSync(predecessorPath,'utf8');assert.equal(createHash('sha256').update(before).digest('hex'),'deb63d5d585f12db7cfb3581662e30e751fb603a29aef376718c085cb9c81240');
  for(const kind of ['private','ordinary']){
   const old=await recording(kind,{helperChange:()=>[]},before);assert.equal(old.error,undefined);
   assert.notEqual(old.value.state,'UNSUPPORTED');assert.equal(old.trace.helpers,0);cases++;
   const prior=await recording(kind,{encoding:v1},before),now=await recording(kind,{encoding:v1});
   assert.deepEqual(now.value,prior.value);assert.deepEqual(now.trace,prior.trace);cases++;
  }
  const old=await recording('ordinary',{authority:true,helperChange:()=>[]},before);
  assert.equal(old.value.state,'SOURCE_TRANSFORMATION_VERIFIED');assert.equal(old.trace.helpers,0);cases++;
  predecessor='V2_COMPARISON_WITHOUT_HELPER_ATTESTATION_SOURCE_COMPONENT';v1Unchanged=true;
 }
 const actual=await import('./immutable-private-data-import.mjs');let calls=0;
 const foreign={query(){calls++;throw Error('Do not call a facade');}};
 for(const method of ['compareVerifiedImmutablePrivateTableData','compareVerifiedImmutableOrdinaryTableData']){
  assert.equal((await actual[method]({db:foreign,verifiedArchive:{}})).state,'UNSUPPORTED');cases++;
 }
 for(const method of ['inspectCommittedImmutableFreshData','inspectCommittedImmutableFreshAuthorityData']){
  await assert.rejects(actual[method]({db:foreign,verifiedArchive:{}}));cases++;
 }
 assert.equal(calls,0);
 console.log(JSON.stringify({selector:'immutable-text-helper-source-only',cases,predecessor,v1_query_trace_unchanged:v1Unchanged,
  source_component_only:true,native_SQL:'NOT_RUN',connections:0,signatures:0,provider_calls:0,old_groups_replayed:0,resources0:true}));process.exit(0);
}

// NEW v2 importer/readback composition only. Exact private Source is extracted
// with inert component bindings; these are NEVER admitted native PG clients,
// genuine private contexts, signed originals, effect or COMMIT permission.
if(process.argv.includes('--immutable-text-columns-import-only')){
 const part=process.argv.find(arg=>arg.startsWith('--text-import-case='))?.split('=')[1];
 assert.ok(part===undefined||['guards','fk','readback','authority','failures'].includes(part));
 const want=name=>part===undefined||part===name;let groups=0,cases=0;
 const {isDeepStrictEqual}=await import('node:util'),{Readable}=await import('node:stream');
 const {pipeline}=await import('node:stream/promises'),{createInterface}=await import('node:readline');
 const archiveApi=await import('./disaster-recovery-archive.mjs'),wire=await import('./production-backup-pg-dump-command.mjs');
 const v1=archiveApi.postgresJsonTextLineEncoding,v2=archiveApi.postgresTextColumnsLineEncoding;
 const text=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
 const before=readFileSync('/home/eric/Documents/Codex/2026-10-09/task-9/typed-text-import-readback-product-20261018-v1/before/scripts/immutable-private-data-import.mjs','utf8');
 assert.equal(createHash('sha256').update(before).digest('hex'),'01370197f83806262d0412dfeaa8adbf532ba5d044657f7c657eb34abb97b902');
 const closedCode=text.slice(text.indexOf('function closed(value,keys) {'),text.indexOf('// Actual pg.Result has additional own fields/prototype;'));
 const targetStart=text.indexOf('const committedAuthorityTargets='),targetEnd=text.indexOf('\nfunction currentCommittedAuthorityData',targetStart);
 const imageStart=text.indexOf('function committedAuthorityImageSql('),imageEnd=text.indexOf('\n// Inspect only THIS module',imageStart);
 const targetCode=text.slice(targetStart,targetEnd),imageCode=text.slice(imageStart,imageEnd);
 const model=new Function('fail','postgresJsonTextLineEncoding','postgresTextColumnsLineEncoding',targetCode+'\n'+imageCode+
  '\nreturn {targets:committedAuthorityTargets,sql:committedAuthorityImageSql};')(()=>{throw Error('UNIT encoding/target refused');},v1,v2);
 if(want('guards')){
  for(const marker of ['  // Carry the importer\'s supported private-table/encoding boundary BEFORE','  const privateNames=']){
   const start=text.indexOf(marker),at=text.indexOf('  if(',start),end=text.indexOf('fail();',at)+'fail();'.length;
   const fragment=marker.startsWith('  const privateNames=')?text.slice(start,end):text.slice(at,end);
   assert.ok(at>start&&end>at);
   const check=new Function('original','identities','postgresJsonTextLineEncoding','postgresTextColumnsLineEncoding','isDeepStrictEqual','fail',fragment);
   for(const encoding of [v1,v2])check({selection:{privateTables:[{table_name:'employee_message_original_outcomes'},{table_name:'group_original_creations'}]},
    privateDataMembers:[{data_encoding:encoding},{data_encoding:encoding}]},['employee_message_original_outcomes','group_original_creations'],v1,v2,isDeepStrictEqual,()=>{throw Error('UNIT unsupported');});cases++;
   for(const encoding of [undefined,null,'',v2+'\n','postgres-text-columns-line.v3']){
    assert.throws(()=>check({selection:{privateTables:[{table_name:'employee_message_original_outcomes'},{table_name:'group_original_creations'}]},
     privateDataMembers:[{data_encoding:encoding},{data_encoding:v2}]},['employee_message_original_outcomes','group_original_creations'],v1,v2,isDeepStrictEqual,()=>{throw Error('UNIT unsupported');}));cases++;
   }
  }
  const actual=await import('./immutable-private-data-import.mjs');let queries=0;
  const facade={query(){queries++;throw Error('Never use caller port');}};
  for(const name of ['compareVerifiedImmutablePrivateTableData','compareVerifiedImmutableOrdinaryTableData']){
   const unavailable=await actual[name]({db:facade,verifiedArchive:{}});assert.equal(unavailable.state,'UNSUPPORTED');cases++;
  }
  assert.equal(queries,0);groups++;
 }
 if(want('fk')){
  const start=text.indexOf('async function inactiveOriginalForeignKeys('),end=text.indexOf('// The owner context has already locked',start);
  const build=new Function('p','types','isDeepStrictEqual',`const {sameSource,openVerifiedRestoreTableData,createRestoreRowUtf8Guard,
   createRestoreRowLineBatchDecoder,decodeRestoreTableRowLine,pipeline,fail,postgresTextColumnsLineEncoding}=p;
   ${closedCode}\n${text.slice(start,end)}\nreturn inactiveOriginalForeignKeys;`);
  for(const option of [{encoding:v1},{encoding:v2},{encoding:v2,active:'1'},{encoding:v2,withdraw:true},
   {encoding:v2,eofFailure:true},{encoding:v2,declared:'2'},{encoding:v2,closeFailure:true}]){
   let closed=0,live=true,statement,parameters;const sourceError=Error('UNIT Source withdrawn'),failure=Error('UNIT EOF/close refused');
   const raw=option.encoding===v1?' {"id":"1","parent_id":null} ':' {"id":"1","parent_id":"null"} ';
   const table={schema_name:'public',table_name:'unit_nullable',row_count:option.declared??'1',data_file:'database/public.unit_nullable.jsonl',
    data_encoding:option.encoding,columns:[{name:'id'},{name:'parent_id'}]};
   const bytes=Buffer.from(JSON.stringify(raw)+'\n'),current=()=>{if(!live)throw sourceError;};
   const api=build({sameSource:current,fail:()=>{throw Error('UNIT FK refused');},postgresTextColumnsLineEncoding:v2,pipeline,
    createRestoreRowUtf8Guard:archiveApi.createRestoreRowUtf8Guard,createRestoreRowLineBatchDecoder:archiveApi.createRestoreRowLineBatchDecoder,
    decodeRestoreTableRowLine:archiveApi.decodeRestoreTableRowLine,openVerifiedRestoreTableData:()=>{
     const verified=option.eofFailure?Promise.reject(failure):Promise.resolve({data_file:table.data_file,bytes:bytes.length,sha256:'a'.repeat(64)});verified.catch(()=>{});
     return {table,stream:Readable.from([bytes]),verified,async close(){closed++;if(option.closeFailure)throw failure;}};
    }},types,isDeepStrictEqual);
   let found,error;try{found=await api({}, {},table,[{constraint_oid:'8',columns:[{name:'parent_id'}],match_type:'s'}],async(sql,args)=>{
    statement=sql;parameters=args;if(option.withdraw)live=false;
    return {rowCount:1,rows:[{constraint_oid:'8',row_count:'1',active_rows:option.active??'0',partial_rows:'0'}]};
   },async()=>current());}catch(value){error=value;}
   assert.equal(closed,1);assert.equal(parameters[0][0],raw);
   assert.ok(statement.includes('pg_catalog.num_nulls((o.image)."parent_id")'));
   assert.equal(statement.includes('custodial_dr.immutable_import_decode_record(null::"public"."unit_nullable",w.raw)'),option.encoding===v2);
   assert.equal(statement.includes('pg_catalog.json_populate_record(null::"public"."unit_nullable",w.raw::json)'),option.encoding===v1);
   assert.equal(statement.includes('immutable_import_text_record'),false);
   if(option.withdraw||option.eofFailure||option.declared||option.closeFailure)assert.ok(error);
   else{assert.equal(error,undefined);assert.equal(found.has('8'),option.active!=='1');}cases++;
  }
  groups++;
 }
 const readbackCode=src=>src.slice(src.indexOf('export async function compareVerifiedImmutablePrivateTableData(options) {')).replaceAll('export async function ','async function ');
 const compile=(src,p)=>new Function('p','types','isDeepStrictEqual',`const {Client,query,readVerifiedPrivateImportSource,sameSource,fail,
  readVerifiedImmutableBootstrapInventory,deriveOriginalAuthEnumDescriptors,openVerifiedRestoreTableData,decodeRestoreTableRowLine,
  createRestoreRowUtf8Guard,createRestoreRowLineBatchDecoder,createInterface,pipeline,prepareVerifiedImmutableBootstrapSource,
  readVerifiedImmutableBootstrapSourceRows,postgresJsonTextLineEncoding,postgresTextColumnsLineEncoding}=p;
  const committedAuthorityDataReads=new WeakMap(),committedAuthorityOrdinaryReads=new WeakSet();
  ${closedCode}\n${readbackCode(src)}\nreturn {compareVerifiedImmutablePrivateTableData,compareVerifiedImmutableOrdinaryTableData};`)(p,types,isDeepStrictEqual);
 const column=(name,data_type='text')=>({name,data_type,generated:'',identity:''});
 async function runReadback(encoding,option={},src=text){
  const fail=()=>{throw Error('UNIT readback refusal');};let live=true,opens=0,closes=0,contexts=0;
  const sourceError=Error('UNIT Source withdrawn'),queryError=Object.assign(Error('UNIT private SQL body must not leak'),{code:'55000'});
  const ordinary=[{schema_name:'auth',table_name:'unit_records',columns:[column('id','bigint'),column('value','json')],primary_key:['id']},
   {schema_name:'public',table_name:'release_deployment_manifest',columns:[column('id','bigint'),column('value','json')],primary_key:['id']},
   {schema_name:'public',table_name:'custodial_release_authority_restore_inventory',columns:[column('id','bigint'),column('object_kind'),
    column('object_identity'),column('definition_sql'),column('definition_sha256'),column('value','json')],primary_key:['id']}];
  if(option.badDefinitionType)ordinary[2].columns.find(c=>c.name==='definition_sql').data_type='json';
  const privates=['employee_message_original_outcomes','group_original_creations'].map(table_name=>({schema_name:'custodial_release_identity',table_name,
   columns:[column('id','bigint'),column('value','json')],primary_key:['id']}));
  const tables=[...ordinary,...privates].map(t=>({...t,data_file:'database/'+t.schema_name+'.'+t.table_name+'.jsonl',row_count:'1',data_encoding:encoding}));
  const rawByKey=new Map(tables.map(t=>[t.data_file,encoding===v2
   ?(t.table_name==='custodial_release_authority_restore_inventory'
    ?'{"id":"1","object_kind":"function","object_identity":"unit_fn()","definition_sql":"ORIGINAL","definition_sha256":"original","value":"null"}'
    :' {"id":"9223372036854775807","value":"null"} ')
   :(t.table_name==='custodial_release_authority_restore_inventory'
    ?'{"id":1,"object_kind":"function","object_identity":"unit_fn()","definition_sql":"ORIGINAL","definition_sha256":"original","value":null}'
    :' {"id":9223372036854775807,"value":null} ')]));
  const bytesFor=t=>Buffer.from(JSON.stringify(rawByKey.get(t.data_file))+'\n');
  const binding={},original={sourceBinding:binding,selection:{databaseTables:tables,privateTables:tables.slice(3)},
   privateDataMembers:tables.slice(3).map(t=>({...t,bytes:String(bytesFor(t).length),sha256:createHash('sha256').update(bytesFor(t)).digest('hex')}))};
  if(option.badPin)original.privateDataMembers[0].data_encoding=v1;
  const source=()=>{if(!live)throw sourceError;};
  const contextBase={database_oid:'10',database_name:'UNIT',backend_pid:21,actor:'supabase_admin',session_actor:'supabase_admin',transaction_id:null,
   virtual_xid:'1/2',snapshot_id:'1:2:',transaction_started_at:'2026-10-18 00:00:00+00',read_only:'on',isolation:'repeatable read',
   row_security:'off',search_path:'pg_catalog, pg_temp',first_schema:'pg_catalog',float_digits:'3'};
  const result=rows=>({command:'SELECT',rowCount:rows.length,rows});const comparisons=[];
  class ComponentClient{} // Only the extracted Source fragment sees this symbol.
  const query=async function(sql,args=[]){
   source();
   if(sql.includes(') context')){contexts++;if(option.changedContext&&contexts>2)return result([{context:{...contextBase,backend_pid:22}}]);
    return result([{context:sql.includes("'timezone'")?{...contextBase,timezone:'UTC',date_style:'ISO, YMD',interval_style:'postgres'}:contextBase}]);}
   if(sql.includes('inheritance_count')){
    const selected=sql.includes("n.nspname='custodial_release_identity'")?tables.slice(3):tables.slice(0,3);
    return result(selected.map((t,i)=>({schema_name:t.schema_name,table_name:t.table_name,relation_oid:String((t.schema_name==='custodial_release_identity'?200:100)+i),
     relation_kind:'r',persistence:'p',is_partition:false,owner_name:'supabase_admin',inheritance_count:'0',dropped_count:'0',columns:t.columns,primary_key:t.primary_key,
     ...(t.schema_name==='custodial_release_identity'?{}:{supported_io:!option.unsupported})})));}
   assert.ok(sql.includes('except all'));comparisons.push({sql,rows:args[0].slice()});
   assert.ok(args[0].every(raw=>[...rawByKey.values()].includes(raw)));
   if(option.queryFailure)throw queryError;if(option.withdraw)live=false;
   if(sql.includes('transformed_rows'))return result([{original_rows:'1',expected_rows:'1',current_rows:'1',missing_rows:option.different?'1':'0',extra_rows:option.different?'1':'0',
    transformed_rows:sql.includes('"custodial_release_authority_restore_inventory"')?'1':'0'}]);
   return result([{original_rows:'1',current_rows:'1',missing_rows:option.different?'1':'0',extra_rows:option.different?'1':'0'}]);
  };
  ComponentClient.prototype.query=query;
  const p={Client:ComponentClient,query,readVerifiedPrivateImportSource:()=>original,sameSource:source,fail,
   readVerifiedImmutableBootstrapInventory:()=>({sourceBinding:binding,inventory:{'inventory/application-schema.sql':'UNIT unchanged enum dependency'}}),
   deriveOriginalAuthEnumDescriptors:()=>[],postgresJsonTextLineEncoding:v1,postgresTextColumnsLineEncoding:v2,pipeline,createInterface,
   decodeRestoreTableRowLine:archiveApi.decodeRestoreTableRowLine,createRestoreRowUtf8Guard:archiveApi.createRestoreRowUtf8Guard,
   createRestoreRowLineBatchDecoder:archiveApi.createRestoreRowLineBatchDecoder,
   openVerifiedRestoreTableData:(_archive,schema,name)=>{source();opens++;const table=tables.find(t=>t.schema_name===schema&&t.table_name===name),bytes=bytesFor(table);
    const verified=option.eofFailure?Promise.reject(sourceError):Promise.resolve({data_file:table.data_file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});verified.catch(()=>{});
    return {table,stream:Readable.from([bytes]),verified,async close(){closes++;if(option.closeFailure)throw sourceError;}};
   },prepareVerifiedImmutableBootstrapSource:async()=>{source();return {};},
   readVerifiedImmutableBootstrapSourceRows:()=>{source();return {sourceBinding:binding,metadata_only:true,tables:tables.slice(1,3).map(t=>({schema_name:t.schema_name,table_name:t.table_name,
    owner_name:'supabase_admin',originalRows:[rawByKey.get(t.data_file)],replacements:t.table_name==='release_deployment_manifest'?{}:{'unit_fn()':{definition_sql:'REVIEWED',definition_sha256:'reviewed'}}}))};}};
  const api=compile(src,p),db=new ComponentClient(),outputs=[];
  let error;try{
   outputs.push(await api.compareVerifiedImmutablePrivateTableData({db,verifiedArchive:{}}));
   outputs.push(await api.compareVerifiedImmutableOrdinaryTableData({db,verifiedArchive:{}}));
  }catch(value){error=value;}
  assert.equal(opens,closes);return {outputs,comparisons,error,opens,closes,contexts};
 }
 if(want('readback')){
  const now=await runReadback(v2);assert.equal(now.error,undefined);assert.equal(now.outputs[0].state,'MATCH');
  assert.equal(now.outputs[1].state,'SOURCE_TRANSFORMATION_VERIFIED');assert.equal(now.comparisons.length,5);
  for(const {sql} of now.comparisons){assert.ok(sql.includes('custodial_dr.immutable_import_text_record(null::'));
   assert.ok(sql.includes('custodial_dr.immutable_import_text_projection(t)'));
   assert.equal(sql.includes('immutable_import_decode_record'),false);assert.equal(sql.includes('row_to_json('),false);
   assert.equal(sql.includes('jsonb_set('),false);assert.equal(sql.includes('raw.original_json::json'),false);cases++;}
  const registry=now.comparisons.find(c=>c.sql.includes('source_recipe')&&c.sql.includes('"custodial_release_authority_restore_inventory"'));
  assert.ok(registry.sql.includes('pg_catalog.json_populate_record(o.image,pg_catalog.json_build_object('));
  assert.ok(registry.sql.includes('(o.image).object_kind=\'function\''));cases++;
  const release=now.comparisons.find(c=>c.sql.includes('source_recipe')&&c.sql.includes('"release_deployment_manifest"'));
  assert.ok(!release.sql.includes('(o.image).object_kind'));assert.ok(release.sql.includes('$2::jsonb'));cases++;
  const changed=await runReadback(v2,{different:true});assert.equal(changed.outputs[0].state,'DIFFERENT');assert.equal(changed.outputs[1].state,'DIFFERENT');cases++;
  const legacy=await runReadback(v1),predecessor=await runReadback(v1,{},before);
  assert.deepEqual(legacy.outputs,predecessor.outputs);assert.deepEqual(legacy.comparisons,predecessor.comparisons);cases++;
  groups++;
 }
 if(want('authority')){
  const oldAt=before.indexOf('function committedAuthorityImageSql('),oldEnd=before.indexOf('\n// Inspect only THIS module',oldAt);
  const old=new Function('fail',targetCode+'\n'+before.slice(oldAt,oldEnd)+'\nreturn {targets:committedAuthorityTargets,sql:committedAuthorityImageSql};')(()=>{throw Error('UNIT old target refused');});
  for(let i=0;i<model.targets.length;i++){
   const target=model.targets[i],sql=model.sql(target,v2);
   assert.equal(model.sql(target,v1),old.sql(old.targets[i]));
   assert.ok(sql.includes('immutable_import_text_record(null::"'+target.schema+'"."'+target.table+'",raw.original_json)'));
   assert.ok(sql.includes('immutable_import_text_projection('));assert.ok(!sql.includes('row_to_json('));
   assert.ok(!sql.includes('immutable_import_decode_record'));
   assert.ok(sql.includes(target.predicate));assert.ok(sql.includes('count(distinct (o.image).'+target.primaryKey+')'));
   assert.ok(sql.includes('$2::text reason,$3::timestamptz'));assert.ok(sql.includes('except all'));
   if(target.schema!=='auth')assert.ok(sql.includes('pg_catalog.json_populate_record(o.image,pg_catalog.json_build_object('));
   else assert.ok(sql.includes('where false'));
   if(target.counter==='manager_push')assert.ok(sql.includes("'updated_at',$3::timestamptz"));cases++;
  }
  for(const tag of [null,'',v2+'\n','postgres-text-columns-line.v3']){assert.throws(()=>model.sql(model.targets[0],tag));cases++;}
  groups++;
 }
 if(want('failures')){
  for(const option of [{badPin:true},{eofFailure:true},{closeFailure:true},{changedContext:true},{withdraw:true},{unsupported:true},{badDefinitionType:true}]){
   const r=await runReadback(v2,option);assert.equal(r.error,undefined);
   assert.ok(r.outputs.some(o=>o.state==='UNSUPPORTED'));
   if(option.badPin)assert.equal(r.outputs[0].state,'UNSUPPORTED');cases++;
  }
  const r=await runReadback(v2,{queryFailure:true});assert.equal(r.error.code,'IMMUTABLE_PRIVATE_DATA_READBACK_SQL_FAILED');
  assert.equal(r.error.sql_state,'55000');assert.equal(Object.hasOwn(r.error,'cause'),false);assert.equal(r.comparisons.length,1);cases++;
  groups++;
 }
 console.log(JSON.stringify({selector:'immutable-text-columns-import-only',part:part||'all-new',groups,cases,
  proof:'SOURCE_AND_INERT_COMPONENT_PORTS_ONLY_NOT_NATIVE_CLIENT_OR_SQL',native_SQL:'NOT_RUN',
  signed_v2_archive_or_bootstrap_acceptance:false,producer_mounted:false,effects_or_ACK:false,old_groups_replayed:0,resources0:true}));process.exit(0);
}

// NEW trigger-safe ordinary set routing only. The extracted shipping private
// closure uses inert recorded catalog/effect replies, NOT a native SQL port.
if(process.argv.includes('--immutable-safe-ordinary-set-only')){
 const part=process.argv.find(arg=>arg.startsWith('--safe-ordinary-set-case='))?.split('=')[1];
 assert.ok(part===undefined||['routing','predecessor','profiles','consumer','original-reader'].includes(part));
 const want=name=>part===undefined||part===name;let groups=0,cases=0;
 const {isDeepStrictEqual}=await import('node:util'),{Readable}=await import('node:stream');
 const {createInterface}=await import('node:readline'),{pipeline}=await import('node:stream/promises');
 const archiveApi=await import('./disaster-recovery-archive.mjs');
 const text=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
 const closed=text.slice(text.indexOf('function closed(value,keys) {'),text.indexOf('// Actual pg.Result has additional own fields/prototype;'));
 const start=text.indexOf('async function inactiveOriginalForeignKeys('),end=text.indexOf('// Shipping fresh-target composition',start);
 assert.ok(start>0&&end>start);
 const component=text.slice(start,end);
 const build=new Function('ports','types','isDeepStrictEqual',`const {sameSource,openVerifiedRestoreTableData,
  decodeRestoreTableRowLine,createRestoreRowUtf8Guard,createRestoreRowLineBatchDecoder,pipeline,createInterface,fail}=ports;
  const selfOrdinaryConsumers=new WeakMap();${closed}\n${component}\nreturn {planVerifiedOrdinaryTables,consumeVerifiedOrdinaryTable};`);
 const raw='{"id":9007199254740993,"payload":{"fraction":0.1234567890123456789012345}}';
 const table=(name='unit_many',count='2',schema='public')=>({schema_name:schema,table_name:name,row_count:count,
  columns:[{name:'id',data_type:'bigint',generated:'',identity:''},{name:'payload',data_type:'jsonb',generated:'',identity:''}],
  primary_key:[],data_file:'database/'+schema+'.'+name+'.jsonl',data_encoding:'postgres-json-text-line.v1'});
 const guard=()=>({oid:'501',name:'custodial_disaster_restore_mutation_fence',function_oid:'500',type:62,enabled:'O',internal:false,
  argument_count:0,arguments_hex:'',when_expression:null,columns:'',constraint_oid:'0',deferrable:false,initially_deferred:false,
  parent_oid:'0',old_table:null,new_table:null});
 const fk=(parent,oid)=>({constraint_oid:oid,parent_schema_name:parent.schema_name,parent_table_name:parent.table_name,
  parent_relation_oid:parent.oid,validated:true,deferrable:false,initially_deferred:false,match_type:'s',columns:[{
   name:'id',data_type:'bigint',generated:'',identity:'',parent_name:'id',parent_data_type:'bigint',parent_generated:'',parent_identity:''}]});
 function fixture(options={}){
  const selected=options.tables??[table()],original={selection:{databaseTables:selected}},archive={};
  const events=[],counts={catalog:0,profiles:0,contexts:0,opened:0,closed:0,eof:0},effects=[];
  let live=true,contextLive=true,failed=false,error,order;
  const sourceError=Error('UNIT_SOURCE_WITHDRAWN'),contextError=Error('UNIT_CONTEXT_CHANGED'),effectError=Error('UNIT_LOST_RESULT');
  const sameSource=()=>{if(!live)throw sourceError;};
  const assertContext=async()=>{counts.contexts++;events.push('context');sameSource();if(!contextLive)throw contextError;};
  const rows=selected.map((t,i)=>({schema_name:t.schema_name,table_name:t.table_name,relation_oid:String(100+i),
   relation_kind:'r',persistence:'p',is_partition:false,foreign_keys:[]}));
  if(options.self)rows[0].foreign_keys=[fk({...selected[0],oid:'100'},'701')];
  if(options.parent)rows[0].foreign_keys=[fk({...selected[1],oid:'101'},'701')];
  if(options.activeCycle){rows[0].foreign_keys=[fk({...selected[1],oid:'101'},'701')];rows[1].foreign_keys=[fk({...selected[0],oid:'100'},'702')];}
  const ports={sameSource,fail:()=>{throw Error('UNIT_SET_COMPONENT_REFUSED');},pipeline,createInterface,
   decodeRestoreTableRowLine:archiveApi.decodeRestoreTableRowLine,createRestoreRowUtf8Guard:archiveApi.createRestoreRowUtf8Guard,
   createRestoreRowLineBatchDecoder:archiveApi.createRestoreRowLineBatchDecoder,
   openVerifiedRestoreTableData:(_archive,schema,name)=>{
    sameSource();const t=selected.find(t=>t.schema_name===schema&&t.table_name===name);assert.ok(t);counts.opened++;events.push('open');
    const originals=options.rawRows??Array.from({length:Number(t.row_count)},()=>raw);
    const bytes=Buffer.from(options.bytes??originals.map(row=>JSON.stringify(row)+'\n').join(''));
    const verified=(options.eofFailure?Promise.reject(effectError):Promise.resolve({data_file:t.data_file,bytes:bytes.length,sha256:'a'.repeat(64)}))
     .then(value=>{counts.eof++;events.push('eof');return value;});verified.catch(()=>{});
    return {table:t,stream:Readable.from([bytes]),verified,async close(){counts.closed++;events.push('close');if(options.closeFailure)throw effectError;}};
   }};
  const api=build(ports,types,isDeepStrictEqual);
  const sql=async(statement,parameters)=>{
   sameSource();
   if(statement.includes('as foreign_keys')){counts.catalog++;events.push('fk-catalog');return {rowCount:rows.length,rows};}
   if(statement.includes('as insert_triggers')){
    counts.profiles++;events.push('trigger-catalog');const requested=JSON.parse(parameters[0]);
    assert.ok(requested.length>0);assert.ok(statement.includes('not t.tgisinternal and (t.tgtype & 4)<>0'));
    assert.ok(!statement.includes("t.tgenabled in")&&!statement.includes("t.tgenabled='O'"));
    assert.ok(statement.includes("pg_catalog.to_regprocedure('custodial_dr.guard_application_mutation()')"));
    assert.ok(!/\b(?:insert into|update|delete|set constraints|commit|begin)\b/i.test(statement));
    let output=requested.map(t=>({schema_name:t.schema_name,table_name:t.table_name,
     relation_oid:rows.find(r=>r.schema_name===t.schema_name&&r.table_name===t.table_name).relation_oid,
     guard_oid:'500',insert_triggers:options.triggers===undefined?[guard()]:options.triggers}));
    options.changeProfiles?.(output,requested);if(options.profileError)throw effectError;
    if(options.withdrawAtProfile)live=false;if(options.contextAtProfile)contextLive=false;
    return {rowCount:output.length,rows:output};
   }
   assert.ok(statement.includes('pg_catalog.json_populate_record')&&options.activeCycle);
   return {rowCount:parameters.length-1,rows:parameters.slice(1).map(id=>({constraint_oid:id,row_count:String(parameters[0].length),active_rows:String(parameters[0].length),partial_rows:'0'}))};
  };
  const mutate=async(statement,args)=>{
   sameSource();events.push('mutation');effects.push({statement,args});
   if(statement.includes('insert_staged_immutable_ordinary_table')){
    assert.equal(counts.eof,1);assert.ok(events.lastIndexOf('context')>events.lastIndexOf('eof'));
    if(options.lostResult)throw effectError;
   }else assert.equal(args[2],raw);
   if(options.withdrawAtStage&&statement.includes('stage_immutable_ordinary_row'))live=false;
  };
  return {api,archive,original,selected,rows,events,counts,effects,assertContext,sql,mutate,sourceError,contextError,effectError,
   async plan(){try{order=await api.planVerifiedOrdinaryTables(archive,original,sql,assertContext);}catch(value){failed=true;error=value;}return {failed,error,order};},
   async consume(index=0){let failure,error,result;try{result=await api.consumeVerifiedOrdinaryTable(archive,original,order[index],mutate,assertContext);}
    catch(value){failure=true;error=value;}return {failed:!!failure,error,result};}};
 }
 if(want('routing')){
  for(const triggers of [[],[guard()]]){const f=fixture({triggers}),r=await f.plan();assert.equal(r.failed,false);
   assert.notEqual(r.order[0],f.selected[0]);assert.deepEqual(Object.keys(r.order[0]).sort(),['schema_name','table_name']);
   assert.equal(f.counts.profiles,1);cases++;}
  const mixed=fixture({tables:[table('unit_many'),table('unit_one','1'),table('unit_empty','0'),
   table('release_deployment_manifest','2'),table('custodial_release_authority_restore_inventory','82'),table('group_original_creations','2','custodial_release_identity')]});
  const r=await mixed.plan();assert.equal(r.failed,false);assert.equal(r.order.length,5);assert.equal(mixed.counts.profiles,1);
  for(const t of r.order)assert.equal(Object.keys(t).length===2,t.table_name==='unit_many');cases++;
  const noCandidates=fixture({tables:[table('unit_one','1'),table('unit_empty','0'),table('release_deployment_manifest','2')]});
  assert.equal((await noCandidates.plan()).failed,false);assert.equal(noCandidates.counts.profiles,0);cases++;
  const self=fixture({self:true});const sr=await self.plan();assert.equal(sr.failed,false);assert.equal(self.counts.profiles,0);
  assert.notEqual(sr.order[0],self.selected[0]);cases++;
  const parent=fixture({parent:true,tables:[table('unit_child'),table('unit_parent')]});const pr=await parent.plan();
  assert.equal(pr.failed,false);assert.deepEqual(pr.order.map(t=>t.table_name),['unit_parent','unit_child']);assert.equal(parent.counts.profiles,1);cases++;
  const cycle=fixture({activeCycle:true,tables:[table('unit_child'),table('unit_parent')]});assert.equal((await cycle.plan()).failed,true);
  assert.equal(cycle.counts.profiles,0);assert.equal(cycle.effects.length,0);cases++;
  groups++;
 }
 if(want('predecessor')){
  // New routing makes a real behavioral difference: the same multi-row
  // ordinary member was DIRECT in the exact retained predecessor planner.
  const before=readFileSync('/home/eric/Documents/Codex/2026-10-09/task-9/immutable-safe-ordinary-set-product-20261018-v1/before/scripts/immutable-private-data-import.mjs','utf8');
  assert.equal(createHash('sha256').update(before).digest('hex'),'679bc8cdf5270b1cbbe2ffb565c4ced56050cb1d95079aa749652709835c48ab');
  const oldComponent=before.slice(before.indexOf('async function inactiveOriginalForeignKeys('),before.indexOf('// Internal DATA consumer'));
  const oldPlan=new Function('ports','types','isDeepStrictEqual',`const {sameSource,fail}=ports;const selfOrdinaryConsumers=new WeakMap();${closed}\n${oldComponent}\nreturn planVerifiedOrdinaryTables;`)
   ({sameSource:()=>{},fail:()=>{throw Error('UNIT_OLD_PLANNER_REFUSAL');}},types,isDeepStrictEqual);
  const old=fixture();const oldOrder=await oldPlan(old.archive,old.original,old.sql,old.assertContext);
  assert.equal(oldOrder[0],old.selected[0]);assert.equal(old.counts.profiles,0);cases++;groups++;
 }
 if(want('profiles')){
  const changes=[t=>{t.name='unknown';},t=>{t.function_oid='999';},t=>{t.type=7;},t=>{t.type=4;},t=>{t.type=6;},
   t=>{t.enabled='D';},t=>{t.enabled='R';},t=>{t.enabled='A';},t=>{t.internal=true;},t=>{t.argument_count=1;},
   t=>{t.arguments_hex='00';},t=>{t.when_expression='true';},t=>{t.columns='1';},t=>{t.constraint_oid='123';},
   t=>{t.deferrable=true;},t=>{t.initially_deferred=true;},t=>{t.parent_oid='12';},t=>{t.old_table='old';},
   t=>{t.new_table='new';},t=>{t.oid=501;},t=>{t.oid='0';},t=>{t.oid='4294967296';},t=>{t.oid='501\n';},t=>{t.extra=true;},
   t=>{delete t.function_oid;},t=>{Object.defineProperty(t,'enabled',{get(){throw Error('GETTER_MUST_NOT_RUN');}});}];
  for(const change of changes){const t=guard();change(t);const f=fixture({triggers:[t]}),r=await f.plan();
   assert.equal(r.failed,false);assert.equal(r.order[0],f.selected[0]);cases++;}
  for(const triggers of [null,{},[guard(),{...guard(),oid:'502'}],new Proxy([],{}),[new Proxy(guard(),{})]]){
   const f=fixture({triggers}),r=await f.plan();assert.equal(r.failed,false);assert.equal(r.order[0],f.selected[0]);cases++;}
  for(const guardOid of [null,500,'0','01','4294967296','500\n']){
   const f=fixture({changeProfiles:rows=>{rows[0].guard_oid=guardOid;}}),r=await f.plan();
   assert.equal(r.failed,false);assert.equal(r.order[0],f.selected[0]);cases++;}
  for(const changeProfiles of [rows=>{rows[0].relation_oid='999';},rows=>{rows[0].schema_name='foreign';},
   rows=>{rows.push({...rows[0]});},rows=>{rows.pop();},rows=>{rows[0].extra=true;}]){
   const f=fixture({changeProfiles}),r=await f.plan();assert.equal(r.failed,true);assert.equal(f.effects.length,0);cases++;}
  for(const option of ['withdrawAtProfile','contextAtProfile','profileError']){
   const f=fixture({[option]:true}),r=await f.plan();assert.equal(r.failed,true);
   assert.equal(r.error,option==='withdrawAtProfile'?f.sourceError:option==='contextAtProfile'?f.contextError:f.effectError);
   assert.equal(f.effects.length,0);cases++;}
  assert.ok(component.includes('case when c.oid is null or c.relhasrules then null'));cases++;groups++;
 }
 if(want('consumer')){
  const f=fixture();assert.equal((await f.plan()).failed,false);assert.equal((await f.consume()).result,2);
  assert.deepEqual(f.effects.map(e=>e.statement.match(/custodial_dr\.([a-z_]+)/)[1]),
   ['stage_immutable_ordinary_row','stage_immutable_ordinary_row','insert_staged_immutable_ordinary_table']);
  assert.equal(f.effects[0].args[2],f.effects[1].args[2]);assert.equal(f.counts.closed,1);cases++;
  assert.equal((await f.consume()).failed,true);assert.equal(f.effects.length,3);assert.equal(f.counts.opened,1);cases++;
  const unsafe=fixture({triggers:[{...guard(),name:'business_trigger'}]});assert.equal((await unsafe.plan()).failed,false);
  assert.equal((await unsafe.consume()).result,2);assert.ok(unsafe.effects.every(e=>e.statement.includes('insert_immutable_ordinary_row')));cases++;
  const bootstrap=fixture({tables:[table('custodial_release_authority_restore_inventory','2')]});await bootstrap.plan();
  assert.equal((await bootstrap.consume()).result,2);assert.equal(bootstrap.effects.length,0);assert.equal(bootstrap.counts.profiles,0);cases++;
  for(const options of [{rawRows:[raw]},{rawRows:[raw,raw,raw]},{bytes:'not-json\n'},{eofFailure:true},
   {withdrawAtStage:true},{lostResult:true},{closeFailure:true}]){
   const found=fixture(options);assert.equal((await found.plan()).failed,false);assert.equal((await found.consume()).failed,true);
   assert.equal(found.counts.closed,1);assert.ok(found.effects.filter(e=>e.statement.includes('insert_staged_immutable_ordinary_table')).length<=1);
   if(!options.lostResult&&!options.closeFailure)assert.ok(found.effects.every(e=>!e.statement.includes('insert_staged_immutable_ordinary_table')));
   const n=found.effects.length;assert.equal((await found.consume()).failed,true);assert.equal(found.effects.length,n);cases++;
  }
  groups++;
 }
 if(want('original-reader')){
  const archive=materializeVerifiedArchive({sourceDir:'/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/populated-raw-release-original-v109-9WKkdl/new-auth-complete-original',
   archiveVerifyKey:'UNIT-only-auth-complete-original-HMAC-20261017',archiveVerifyKeyId:'unit-auth-complete-original-v1',supportedFormats:['memphis-zoo-disaster-recovery.v4']});
  let opened=0,closedCount=0,eofDone=false;
  try{
   const original=archiveApi.readVerifiedPrivateImportSource(archive),selected=original.selection.databaseTables;
   assert.equal(original.sourceBinding.archive_digest,'c2ca572a9b54f9e3f02f3136fbe42a590857778f310edd32e54315edd3554ef0');
   const sample=selected.find(t=>t.schema_name==='auth'&&t.table_name==='schema_migrations');assert.equal(sample.row_count,'82');
   const settings=selected.find(t=>t.schema_name==='public'&&t.table_name==='system_settings');assert.equal(settings.row_count,'20');
   const current=()=>{assert.deepEqual(archiveApi.readVerifiedPrivateImportSource(archive),original);};
   const ports={sameSource:current,fail:()=>{throw Error('UNIT_ORIGINAL_COMPONENT_REFUSED');},pipeline,createInterface,
    decodeRestoreTableRowLine:archiveApi.decodeRestoreTableRowLine,createRestoreRowUtf8Guard:archiveApi.createRestoreRowUtf8Guard,
    createRestoreRowLineBatchDecoder:archiveApi.createRestoreRowLineBatchDecoder,
    openVerifiedRestoreTableData:(a,schema,name)=>{opened++;const data=archiveApi.openVerifiedRestoreTableData(a,schema,name);
     return {...data,verified:data.verified.then(value=>{eofDone=true;return value;}),async close(){closedCount++;await data.close();}};}};
   const api=build(ports,types,isDeepStrictEqual),effects=[];
   const catalog=selected.map((t,i)=>({schema_name:t.schema_name,table_name:t.table_name,relation_oid:String(1000+i),
    relation_kind:'r',persistence:'p',is_partition:false,foreign_keys:[]}));
   const order=await api.planVerifiedOrdinaryTables(archive,original,async(statement,args)=>{
    if(statement.includes('as foreign_keys'))return {rowCount:catalog.length,rows:catalog};
    assert.ok(statement.includes('as insert_triggers'));const targets=JSON.parse(args[0]);
    return {rowCount:targets.length,rows:targets.map(t=>({...t,relation_oid:catalog.find(c=>c.schema_name===t.schema_name&&c.table_name===t.table_name).relation_oid,
     guard_oid:'500',insert_triggers:[]}))};
   },async()=>current());
   const index=order.findIndex(t=>t.schema_name==='auth'&&t.table_name==='schema_migrations');assert.ok(index>=0);
   const count=await api.consumeVerifiedOrdinaryTable(archive,original,order[index],async(statement,args)=>{
    current();if(statement.includes('insert_staged_immutable_ordinary_table'))assert.equal(eofDone,true);
    effects.push({statement,args});
   },async()=>current());
   assert.equal(count,82);assert.equal(effects.length,83);assert.equal(effects.filter(e=>e.statement.includes('stage_immutable_ordinary_row')).length,82);
   assert.equal(opened,1);assert.equal(closedCount,1);assert.equal(eofDone,true);cases++;
  }finally{await archive.cleanup();assert.equal(existsSync(archive.directory),false);}
  groups++;
 }
 console.log(JSON.stringify({selector:'immutable-safe-ordinary-set-only',part:part||'all-new',groups,cases,
  proof:'SOURCE_PLANNER_CONSUMER_AND_AUTHENTICATED_EOF_ONLY',recording_ports:'NOT_NATIVE_SQL',native_SQL:'NOT_RUN',
  old_groups_replayed:0,authority_or_ACK:false,resources0:true}));process.exit(0);
}

// NEW immutable expected-row DATA reuse only. Both complete Source assertions
// remain live; these tests never query a target or create restore authority.
if(process.argv.includes('--immutable-source-row-reuse-only')){
 const part=process.argv.find(arg=>arg.startsWith('--source-row-reuse-case='))?.split('=')[1];
 assert.ok(part===undefined||['data-and-timing','refusals'].includes(part));
 const want=name=>part===undefined||part===name;let cases=0,groups=0;
 const {performance}=await import('node:perf_hooks');
 const fs=await import('node:fs'),{tmpdir}=await import('node:os');
 const sha=value=>createHash('sha256').update(value).digest('hex');
 const sourceDir='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/populated-raw-release-original-v109-9WKkdl/new-auth-complete-original';
 const options={sourceDir,archiveVerifyKey:'UNIT-only-auth-complete-original-HMAC-20261017',archiveVerifyKeyId:'unit-auth-complete-original-v1',
  supportedFormats:['memphis-zoo-disaster-recovery.v4']};
 const deepFrozen=value=>{const seen=new Set(),pending=[value];while(pending.length){const item=pending.pop();
  if(item&&typeof item==='object'&&!seen.has(item)){seen.add(item);assert.ok(Object.isFrozen(item));
   for(const key of Reflect.ownKeys(item)){const descriptor=Object.getOwnPropertyDescriptor(item,key);assert.ok(Object.hasOwn(descriptor,'value'));pending.push(descriptor.value);}}
 }return seen.size;};
 const text=readFileSync(new URL('./immutable-private-source-bootstrap.mjs',import.meta.url),'utf8');
 const getter=text.slice(text.indexOf('export function readVerifiedImmutableBootstrapSourceRows('));
 assert.ok(getter.startsWith('export function readVerifiedImmutableBootstrapSourceRows('));
 assert.ok(getter.indexOf('assertVerifiedImmutableBootstrapSource(source,verifiedArchive);')<getter.indexOf('sourceRowExpectations.get(source)'));
 assert.ok(getter.includes('if(cached){assertVerifiedImmutableBootstrapSource(source,verifiedArchive);return cached;}'));
 assert.ok(getter.indexOf('sourceRowExpectations.set(source,expected)')>getter.lastIndexOf('assertVerifiedImmutableBootstrapSource(source,verifiedArchive);'));cases++;
 if(want('data-and-timing')){
  const archive=materializeVerifiedArchive(options);
  try{
   assert.equal(readVerifiedArchiveSourceBinding(archive).archive_digest,'c2ca572a9b54f9e3f02f3136fbe42a590857778f310edd32e54315edd3554ef0');
   const source=await prepareVerifiedImmutableBootstrapSource(archive),value=readVerifiedImmutableBootstrapSourceRows(source,archive);
   const frozenObjects=deepFrozen(value);assert.equal(value.metadata_only,true);
   assert.equal(value.sourceBinding,source.sourceBinding);assert.equal(value.tables[0].originalRows,source.releaseRows);
   assert.equal(value.tables[1].originalRows,source.registryRows);assert.equal(value.tables[1].replacements,source.registrySource);
   assert.equal(readVerifiedImmutableBootstrapSourceRows(source,archive),value);cases++;
   for(const mutate of [()=>value.tables.push({}),()=>{value.tables[0].owner_name='foreign';},
    ()=>{value.tables[0].originalRows[0]='foreign';},()=>{value.tables[1].originalRows[0]='foreign';},
    ()=>{value.tables[1].replacements[Object.keys(value.tables[1].replacements)[0]].definition_sql='foreign';}]){
    assert.throws(mutate,TypeError);assert.equal(readVerifiedImmutableBootstrapSourceRows(source,archive),value);cases++;
   }
   const beforePath='/home/eric/Documents/Codex/2026-10-09/task-9/immutable-original-source-row-reuse-product-20261018-v1/before/scripts/immutable-private-source-bootstrap.mjs';
   assert.equal(sha(readFileSync(beforePath)),'55783a49affbd1de55e63cc82fd155596d3c2a4e6d0f1e0978248d6a88271ed8');
   const before=await import(pathToFileURL(beforePath).href),oldSource=await before.prepareVerifiedImmutableBootstrapSource(archive);
   const oldValue=before.readVerifiedImmutableBootstrapSourceRows(oldSource,archive);
   assert.deepEqual(value,oldValue);assert.notEqual(before.readVerifiedImmutableBootstrapSourceRows(oldSource,archive),oldValue);cases++;
   const expectedHash=sha(JSON.stringify(value));assert.equal(expectedHash,'5f39c40e1c3b6ca83bcb0479c5234ecbd9578d1dba5c4c9ce550490a980fa14e');cases++;
   // Actual public functions and actual same admitted original. Alternate
   // short blocks to avoid mistaking OS-cache warmup for DATA construction.
   const samples={before:[],after:[]},cpu={before:0,after:0},wall={before:0,after:0};
   const run=(name,read,plan)=>{
    const started=performance.now(),usage=process.cpuUsage();
    for(let i=0;i<12;i++){const start=performance.now();const found=read(plan,archive);samples[name].push(performance.now()-start);
     if(name==='after')assert.equal(found,value);}
    wall[name]+=performance.now()-started;const used=process.cpuUsage(usage);cpu[name]+=(used.user+used.system)/1000;
   };
   for(let block=0;block<10;block++){
    for(const name of block%2?['after','before']:['before','after']){
     assert.ok(wall[name]<25000,'Bounded Source timing budget exhausted');
     if(name==='before')run(name,before.readVerifiedImmutableBootstrapSourceRows,oldSource);
     else run(name,readVerifiedImmutableBootstrapSourceRows,source);
    }
   }
   const summarize=name=>{const sorted=samples[name].slice().sort((a,b)=>a-b);assert.ok(wall[name]<30000);
    return {calls:sorted.length,wall_ms:wall[name],cpu_ms:cpu[name],median_ms:sorted[Math.floor(sorted.length/2)],p95_ms:sorted[Math.floor(sorted.length*.95)]};};
   console.log(JSON.stringify({changed_function_timings:{before:summarize('before'),after:summarize('after')},
    expected_data_sha256:expectedHash,frozen_objects:frozenObjects,registry_rows:value.tables[1].originalRows.length,
    measurement:'ACTUAL_SAME_ORIGINAL_PUBLIC_FUNCTIONS_NO_SQL_NOT_WHOLE_TIMEOUT_PROFILE'}));cases++;groups++;
  }finally{await archive.cleanup();assert.equal(existsSync(archive.directory),false);}
 }
 if(want('refusals')){
  // Each owned mirror starts with exact current Source bytes and uses the
  // REAL archive/preparer modules. Only an owned negative-test SQL copy is
  // changed/replaced; shared program SQL and original archives are untouched.
  const scripts=['immutable-private-source-bootstrap.mjs','immutable-private-domain-source.mjs','immutable-private-message-source.mjs',
   'disaster-recovery-archive.mjs','disaster-recovery-crypto.mjs'];
  for(const challenge of ['changed-byte','same-byte-replacement','withdrawal']){
   const directory=fs.mkdtempSync(join(tmpdir(),'mz-source-row-owned-'));
   assert.equal(dirname(directory),tmpdir());assert.ok(directory.startsWith(join(tmpdir(),'mz-source-row-owned-')));
   fs.mkdirSync(join(directory,'scripts'));fs.mkdirSync(join(directory,'proposals'));
   let archive,source;
   try{
    for(const name of scripts)fs.copyFileSync(new URL('./'+name,import.meta.url),join(directory,'scripts',name));
    // Use only the fixed program statements already admitted by the real
    // current constructor; do not sweep/copy unrelated proposal files.
    const loan=materializeVerifiedArchive(options);let statements;
    try{statements=(await prepareVerifiedImmutableBootstrapSource(loan)).statements;}
    finally{await loan.cleanup();assert.equal(existsSync(loan.directory),false);}
    for(const statement of statements){const bytes=readFileSync(new URL('../'+statement.sourcePath,import.meta.url));
     assert.equal(sha(bytes),statement.sourceSha256);fs.copyFileSync(new URL('../'+statement.sourcePath,import.meta.url),join(directory,statement.sourcePath));}
    const api=await import(pathToFileURL(join(directory,'scripts/disaster-recovery-archive.mjs')).href);
    const module=await import(pathToFileURL(join(directory,'scripts/immutable-private-source-bootstrap.mjs')).href);
    archive=api.materializeVerifiedArchive(options);source=await module.prepareVerifiedImmutableBootstrapSource(archive);
    const warm=module.readVerifiedImmutableBootstrapSourceRows(source,archive);
    assert.equal(module.readVerifiedImmutableBootstrapSourceRows(source,archive),warm);
    for(const fake of [{...source},new Proxy(source,{}),Object.freeze({tables:warm.tables})]){
     assert.throws(()=>module.readVerifiedImmutableBootstrapSourceRows(fake,archive),error=>error.code==='IMMUTABLE_BOOTSTRAP_SOURCE_UNAVAILABLE');cases++;
    }
    const other=api.materializeVerifiedArchive(options);
    try{assert.throws(()=>module.readVerifiedImmutableBootstrapSourceRows(source,other),error=>error.code==='IMMUTABLE_BOOTSTRAP_SOURCE_UNAVAILABLE');cases++;}
    finally{await other.cleanup();assert.equal(existsSync(other.directory),false);}
    const target=join(directory,'proposals/immutable-private-owner-context.sql'),original=readFileSync(target),identity=lstatSync(target,{bigint:true});
    if(challenge==='changed-byte'){const changed=Buffer.from(original);changed[0]^=1;fs.writeFileSync(target,changed);assert.notEqual(sha(readFileSync(target)),sha(original));}
    if(challenge==='same-byte-replacement'){const replacement=target+'.unit-replacement';fs.copyFileSync(target,replacement);
     fs.renameSync(replacement,target);assert.equal(sha(readFileSync(target)),sha(original));assert.notEqual(lstatSync(target,{bigint:true}).ino,identity.ino);}
    if(challenge==='withdrawal')await archive.cleanup();
    assert.throws(()=>module.readVerifiedImmutableBootstrapSourceRows(source,archive),error=>error.code==='IMMUTABLE_BOOTSTRAP_SOURCE_UNAVAILABLE'
     &&error.source_phase===(challenge==='withdrawal'?'ARCHIVE_CURRENTNESS':'PROGRAM_CURRENTNESS'));cases++;
   }finally{
    if(archive){await archive.cleanup();assert.equal(existsSync(archive.directory),false);}
    // Exact mkdtemp-created owned test fixture only, never a source/archive root.
    fs.rmSync(directory,{recursive:true});assert.equal(existsSync(directory),false);
   }
  }
  groups++;
 }
 console.log(JSON.stringify({selector:'immutable-source-row-reuse-only',part:part||'all-new',groups,cases,
  proof:'ACTUAL_SOURCE_DATA_REUSE_CURRENTNESS_AND_BOUNDED_TIMING_ONLY',SQL:'NOT_RUN',cached_currentness:false,
  target_or_import_authority:false,old_groups_replayed:0,resources0:true}));process.exit(0);
}

// NEW exact employee push authority Source only. Inert gate/image replies
// below are NOT active PG scope, binary-image equality or effect permission.
if(process.argv.includes('--immutable-employee-push-authority-only')){
 const part=process.argv.find(arg=>arg.startsWith('--employee-push-case='))?.split('=')[1];
 assert.ok(part===undefined||['profile','branch','contract','native-trigger'].includes(part));
 const want=name=>part===undefined||part===name;let cases=0,groups=0;
 const sql=readFileSync(new URL('../proposals/immutable-original-employee-push-authority-restore.sql',import.meta.url),'utf8');
 const sha=value=>createHash('sha256').update(value).digest('hex'),parts=sql.split('$original_employee_push_authority_profile$');
 assert.equal(parts.length,3);const profile=JSON.parse(parts[1]);
 const keys=['identity','registry_identity','before_definition','before_definition_sha256','before_prosrc_sha256',
  'restore_branch','after_prosrc_sha256','after_definition_sha256'];
 const body=definition=>{assert.equal(definition.split('AS $function$').length,2);assert.ok(definition.endsWith('$function$\n'));
  return definition.split('AS $function$')[1].slice(0,-'$function$\n'.length);};
 const check=value=>{
  assert.ok(value&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype);
  assert.deepEqual(Reflect.ownKeys(value).sort(),keys.slice().sort());
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);assert.ok(Object.hasOwn(d,'value'));assert.equal(typeof d.value,'string');}
  assert.equal(value.identity,'public.mz_reconcile_employee_push_credential_state()');
  assert.equal(value.registry_identity,'mz_reconcile_employee_push_credential_state()');
  for(const key of keys.filter(k=>k.endsWith('_sha256')))assert.ok(value[key].length===64&&/^[0-9a-f]{64}$/.test(value[key]));
  assert.equal(value.before_definition_sha256,'f7b9cde8f63ef75c44cccf284795d7e9bafd6137b2bc9aee10de0533b7f0149d');
  assert.equal(sha(value.before_definition),value.before_definition_sha256);assert.equal(sha(body(value.before_definition)),value.before_prosrc_sha256);
  assert.equal(value.before_definition.split('\nbegin\n').length,2);assert.ok(value.restore_branch.length);
  const after=value.before_definition.replace('\nbegin\n',()=> '\nbegin\n'+value.restore_branch);
  assert.equal(sha(after),value.after_definition_sha256);assert.equal(sha(body(after)),value.after_prosrc_sha256);
  assert.equal(after.split(value.restore_branch).length,2);assert.equal(after.replace(value.restore_branch,''),value.before_definition);
  return after;
 };
 if(want('profile')){
  const root='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/populated-raw-release-original-v109-9WKkdl/new-auth-complete-original/';
  const source=readFileSync(root+'inventory/source-catalog.json');assert.equal(sha(source),'0bd433901d199bd273b8442fd0b295c619cc4fe912e3d5ea7c17ab21a6c30e2d');
  const catalog=JSON.parse(source),original=catalog.functions.filter(row=>row.schema_name==='public'
   &&row.function_name==='mz_reconcile_employee_push_credential_state'&&row.identity_arguments==='');
  assert.equal(original.length,1);assert.equal(profile.before_definition,original[0].definition);check(profile);cases++;
  const consumers=catalog.triggers.filter(row=>row.definition.endsWith('EXECUTE FUNCTION '+profile.identity));
  assert.equal(consumers.length,1);assert.equal(consumers[0].schema_name,'public');assert.equal(consumers[0].table_name,'device_auth_credentials');
  assert.equal(consumers[0].trigger_name,'trg_mz_reconcile_employee_push_credential_state');assert.equal(consumers[0].enabled,'O');
  const nativeTrigger=readFileSync(root+'inventory/application-schema.sql','utf8').split('\n')
   .filter(line=>line.startsWith('CREATE TRIGGER trg_mz_reconcile_employee_push_credential_state '));
  assert.equal(nativeTrigger.length,1);assert.ok(nativeTrigger[0].endsWith(';'));
  assert.ok(sql.includes(nativeTrigger[0].slice(0,-1)));cases++;
  const grants=JSON.parse(readFileSync(root+'inventory/original-acls.json')).routines.filter(row=>row.identity===profile.identity);
  assert.equal(grants.length,1);assert.equal(grants[0].owner_name,'supabase_admin');
  assert.deepEqual(grants[0].grants,[{grantee:'postgres',grantor:'supabase_admin',privilege_type:'EXECUTE',is_grantable:false}]);cases++;
  const table=JSON.parse(readFileSync(root+'inventory/table-catalog.json')).find(row=>row.schema_name==='public'
   &&row.table_name==='custodial_release_authority_restore_inventory');assert.ok(table);
  const rows=readFileSync(root+table.data_file,'utf8').trimEnd().split('\n').map(line=>JSON.parse(decodeRestoreTableRowLine(line,table)));
  const registered=rows.filter(row=>row.object_kind==='function'&&row.object_identity===profile.registry_identity);
  assert.equal(registered.length,1);assert.equal(registered[0].definition_sql,profile.before_definition);
  assert.equal(registered[0].definition_sha256,profile.before_definition_sha256);cases++;
  const after=check(profile);for(const name of ['employee_push_registrations','event_push_instances','operational_notification_jobs']){
   assert.equal(after.split('update public.'+name).length,2);assert.equal(profile.restore_branch.includes('update public.'+name),false);cases++;
  }
  for(const changed of [{...profile,extra:'UNIT'},Object.fromEntries(Object.entries(profile).filter(([key])=>key!=='registry_identity')),
   {...profile,identity:'public.foreign()'},{...profile,registry_identity:profile.identity},
   {...profile,before_definition:profile.before_definition+'\n'},{...profile,before_definition:profile.before_definition.replaceAll('\n','\r\n')},
   {...profile,before_prosrc_sha256:'0'.repeat(64)},{...profile,after_prosrc_sha256:'0'.repeat(64)},
   {...profile,after_definition_sha256:'0'.repeat(64)},{...profile,restore_branch:''},{...profile,restore_branch:profile.restore_branch+'\n'},
   {...profile,before_definition_sha256:profile.before_definition_sha256+'\n'}]){assert.throws(()=>check(changed));cases++;}
  groups++;
 }
 if(want('native-trigger')){
  const root='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/populated-raw-release-original-v109-9WKkdl/new-auth-complete-original/';
  const original=readFileSync(root+'inventory/application-schema.sql','utf8').split('\n')
   .filter(line=>line.startsWith('CREATE TRIGGER trg_mz_reconcile_employee_push_credential_state '));
  assert.equal(original.length,1);assert.ok(original[0].endsWith(';'));cases++;
  assert.ok(sql.includes("pg_catalog.pg_get_triggerdef(t.oid,false) IS NOT DISTINCT FROM '"+original[0].slice(0,-1)+"'"));cases++;
  check(profile);assert.match(sql,/t\.tgtype=17 AND t\.tgenabled='O' AND NOT t\.tgisinternal/);cases++;
  groups++;
 }
 if(want('branch')){
  check(profile);const branch=profile.restore_branch;
  const outer=branch.match(/^  --[^\n]*\n  if ([\s\S]+?) then\n    if custodial_dr\.immutable_original_authority_guard_matches\(TG_RELID,TG_OP\) is true then/);assert.ok(outer);
  const row=branch.match(/        if ([\s\S]+?) then\n          raise exception using errcode='55000',message='Original employee push authority row differs'/);assert.ok(row);
  const first=outer[1].replace(/\s+/g,' ').trim().replace("pg_catalog.to_regclass('public.device_auth_credentials')",'relationOid')
   .replace('pg_catalog.pg_trigger_depth()','triggerDepth').replace(/ = /g,' === ').replace(/ and /g,' && ');
  const second=row[1].replace(/\s+/g,' ').trim()
   .replace('(select oid from pg_catalog.pg_roles where rolname=session_user)','ownerOid')
   .replace("v_original_authority.counts is distinct from '{}'::jsonb",'countsEmpty !== true')
   .replace("('disaster_restore_generation_'||v_original_authority.authority_generation::text)","('disaster_restore_generation_'+v_original_authority.authority_generation)")
   .replace('pg_catalog.record_image_eq(v_original_unrevoked,OLD) is not true','imageEqual !== true')
   .replace(/ is distinct from /g,' !== ').replace(/ is not null/g,' !== null').replace(/ is null/g,' === null').replace(/ or /g,' || ');
  const evaluate=new Function('frame','gate',`const {TG_OP,TG_LEVEL,TG_WHEN,TG_TABLE_SCHEMA,TG_TABLE_NAME,TG_NAME,TG_NARGS,TG_RELID,
   current_user,session_user,relationOid,triggerDepth,ownerOid,OLD,NEW,v_original_authority,countsEmpty,imageEqual,scopeUnchanged}=frame;
   if(!(${first}))return 'UNCHANGED_NORMAL_BODY';if(gate()!==true)return 'UNCHANGED_NORMAL_BODY';
   if(${second})throw Error('ROW_REFUSED_55000');if(gate()!==true||scopeUnchanged!==true)throw Error('SCOPE_REFUSED_55000');return NEW;`);
  const old=Object.freeze({revoked_at:null,revoked_reason:null,metadata_json:'{"big":9007199254740993}'});
  const changed=Object.freeze({...old,revoked_at:'2026-10-18T02:00:00.123456+00:00',revoked_reason:'disaster_restore_generation_1'});
  const scope=Object.freeze({phase:'RUNNING',completed_step:0,active_table_oid:900,owner_oid:901,result:null,authority_generation:'1'});
  const frame={TG_OP:'UPDATE',TG_LEVEL:'ROW',TG_WHEN:'AFTER',TG_TABLE_SCHEMA:'public',TG_TABLE_NAME:'device_auth_credentials',
   TG_NAME:'trg_mz_reconcile_employee_push_credential_state',TG_NARGS:0,TG_RELID:900,current_user:'supabase_admin',session_user:'supabase_admin',
   relationOid:900,triggerDepth:1,ownerOid:901,OLD:old,NEW:changed,v_original_authority:scope,countsEmpty:true,imageEqual:true,scopeUnchanged:true};
  let calls=0;assert.equal(evaluate(frame,()=>{calls++;return true;}),changed);assert.equal(calls,2);cases++;
  for(const patch of [{TG_OP:'INSERT'},{TG_OP:'DELETE'},{TG_WHEN:'BEFORE'},{TG_LEVEL:'STATEMENT'},{TG_TABLE_SCHEMA:'foreign'},
   {TG_TABLE_NAME:'employee_push_registrations'},{TG_NAME:'foreign_trigger'},{TG_NARGS:1},{TG_RELID:902},{triggerDepth:0},{triggerDepth:2},
   {current_user:'postgres'},{session_user:'service_role'}]){calls=0;assert.equal(evaluate({...frame,...patch},()=>{calls++;return true;}),'UNCHANGED_NORMAL_BODY');assert.equal(calls,0);cases++;}
  for(const gateResult of [false,null,undefined]){assert.equal(evaluate(frame,()=>gateResult),'UNCHANGED_NORMAL_BODY');cases++;}
  for(const patch of [{NEW:{...changed,revoked_at:null}},{OLD:{...old,revoked_at:changed.revoked_at}},
   {NEW:{...changed,revoked_reason:'foreign_reason'}},{NEW:{...changed,revoked_reason:null}},{imageEqual:false},{countsEmpty:false},
   ...[{phase:'CONSUMED'},{completed_step:1},{active_table_oid:902},{owner_oid:902},{result:{}},{authority_generation:'2'}]
    .map(value=>({v_original_authority:{...scope,...value}}))]){assert.throws(()=>evaluate({...frame,...patch},()=>true),/ROW_REFUSED_55000/);cases++;}
  assert.throws(()=>evaluate({...frame,scopeUnchanged:false},()=>true),/SCOPE_REFUSED_55000/);cases++;
  calls=0;assert.throws(()=>evaluate(frame,()=>++calls===1),/SCOPE_REFUSED_55000/);cases++;
  let failed=false;try{evaluate(frame,()=>{throw undefined;});}catch(value){failed=true;assert.equal(value,undefined);}assert.equal(failed,true);cases++;
  // Ordinary expiry-only update/no scope reaches the ORIGINAL derived body;
  // the same attempted change in an active effect-1 slot refuses instead.
  assert.equal(evaluate({...frame,NEW:{...old,expires_at:'UNIT-expired'}},()=>false),'UNCHANGED_NORMAL_BODY');cases++;
  groups++;
 }
 if(want('contract')){
  check(profile);
  const authority=readFileSync(new URL('../proposals/immutable-original-authority-reconciliation.sql',import.meta.url),'utf8');
  const helper=authority.match(/CREATE FUNCTION custodial_dr\.immutable_original_authority_guard_matches\([\s\S]*?AS \$fn\$([\s\S]*?)\$fn\$;/);
  assert.ok(helper);assert.equal(sha(helper[1]),'72b2bb99197370c4c0587d759ccd6b3f6a47f9fed072a3e72d49aa2b58b5a3af');
  assert.ok(sql.includes("='"+sha(helper[1])+"'"));cases++;
  for(const text of ['pg_catalog.pg_trigger_depth()<>1 OR current_user<>session_user',"scope.phase='CONSUMED' THEN RETURN false",
   "scope.phase<>'RUNNING'",'scope.active_table_oid IS DISTINCT FROM expected_oid','p_table_oid IS DISTINCT FROM expected_oid',
   'scope.original_snapshot IS DISTINCT FROM custodial_dr.immutable_original_authority_snapshot(scope.original_transaction_id)',
   "MESSAGE='Original authority active statement differs'"]){assert.ok(helper[1].includes(text));cases++;}
  for(const text of ["f.proowner=owner_oid AND NOT f.prosecdef","f.proparallel='u'","f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']",
   "WHERE a.grantee<>owner_oid",'c.relrowsecurity AND c.relforcerowsecurity',
   "t.tgtype=17 AND t.tgenabled='O' AND NOT t.tgisinternal",'t.tgqual IS NOT NULL AND t.tgnargs=0',
   "=ARRAY['revoked_at','expires_at']::text[]",'pg_catalog.pg_get_triggerdef(t.oid,false)',
   '(SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgfoid=function_oid)<>1',
   "a.grantee NOT IN(owner_oid,postgres_oid)","pg_catalog.to_jsonb(observed)-'prosrc' IS DISTINCT FROM pg_catalog.to_jsonb(original)-'prosrc'",
   "f.prosrc='record_image_eq'","lanname='internal'",'IS DISTINCT FROM pg_catalog.jsonb_build_array(original_trigger)','IS DISTINCT FROM original_scope']){
   assert.ok(sql.includes(text));cases++;
  }
  for(const text of ['v_original_unrevoked:=NEW;','v_original_unrevoked.revoked_at:=OLD.revoked_at;',
   'v_original_unrevoked.revoked_reason:=OLD.revoked_reason;','pg_catalog.record_image_eq(v_original_unrevoked,OLD) is not true',
   "'disaster_restore_generation_'||v_original_authority.authority_generation::text",'select * into strict v_original_authority',
   'transaction_id=pg_catalog.txid_current()','is distinct from pg_catalog.to_jsonb(v_original_authority)']){
   assert.ok(profile.restore_branch.includes(text));cases++;
  }
  assert.equal(sql.split('EXECUTE after_definition;').length,2);assert.equal(sql.split('PERFORM custodial_dr.immutable_import_owner_fence();').length,4);cases++;
  assert.doesNotMatch(sql,/^\s*(?:BEGIN|COMMIT|ROLLBACK);\s*$/im);cases++;
  assert.doesNotMatch(parts[0]+parts[2],/^\s*(?:GRANT|REVOKE|ALTER\s+(?:ROLE|TABLE|FUNCTION)|CREATE\s+(?:TABLE|ROLE|TRIGGER)|UPDATE|DELETE|INSERT)\b/im);cases++;
  assert.doesNotMatch(profile.restore_branch,/^\s*(?:UPDATE|DELETE|INSERT|EXECUTE|GRANT|REVOKE)\b/im);cases++;groups++;
 }
 console.log(JSON.stringify({selector:'immutable-employee-push-authority-only',part:part||'all-new',groups,cases,
  proof:'SOURCE_PROFILE_AND_INERT_GATE_ROW_PREDICATE_COMPONENTS_ONLY',native_SQL_scope_or_binary_equality:'NOT_RUN',
  derived_tables_mutated:false,normal_body_byte_identical:true,authority_or_ACK:false,old_groups_replayed:0,resources0:true}));process.exit(0);
}

// NEW authenticated-row-aware FK planning components only. Recording SQL
// classifications are explicit fixture DATA, NEVER native NULL/permission proof.
if(process.argv.includes('--immutable-row-aware-fk-only')){
 const part=process.argv.find(arg=>arg.startsWith('--row-aware-fk-case='))?.split('=')[1];
 assert.ok(part===undefined||['planner','metadata','json-null','source-reader'].includes(part));
 const want=name=>part===undefined||part===name;let cases=0,groups=0;
 const {isDeepStrictEqual}=await import('node:util'),{Readable}=await import('node:stream');
 const {pipeline}=await import('node:stream/promises');
 const archiveApi=await import('./disaster-recovery-archive.mjs');
 const text=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
 const start=text.indexOf('async function inactiveOriginalForeignKeys('),end=text.indexOf('// Internal DATA consumer',start);
 assert.ok(start>0&&end>start);const component=text.slice(start,end);
 const closed=text.slice(text.indexOf('function closed(value,keys) {'),text.indexOf('// Actual pg.Result has additional own fields/prototype;'));
 const build=new Function('ports','types','isDeepStrictEqual',`const {sameSource,assertContext,sql,openVerifiedRestoreTableData,
  createRestoreRowUtf8Guard,createRestoreRowLineBatchDecoder,decodeRestoreTableRowLine,pipeline,fail}=ports;
  const selfOrdinaryConsumers=new WeakMap();${closed}\n${component}\nreturn planVerifiedOrdinaryTables;`);
 const column=(name,type='uuid')=>({name,data_type:type,generated:'',identity:''});
 const table=(name,count='1')=>({schema_name:'public',table_name:name,row_count:count,primary_key:['id'],
  columns:[column('id'),column('parent_id'),column('second_id'),column('payload','jsonb')],
  data_file:'database/public.'+name+'.jsonl',data_encoding:'postgres-json-text-line.v1'});
 const fk=(id,parent,cols=['parent_id'],match='s')=>({constraint_oid:id,parent_schema_name:'public',parent_table_name:parent,
  parent_relation_oid:parent==='unit_a'?'101':'102',validated:true,deferrable:false,initially_deferred:false,match_type:match,
  columns:cols.map((name,index)=>({name,data_type:'uuid',generated:'',identity:'',parent_name:index?'parent_id':'id',
   parent_data_type:'uuid',parent_generated:'',parent_identity:''}))});
 const raw='{"id":"11111111-1111-4111-8111-111111111111","parent_id":null,"second_id":null,"payload":{"big":9007199254740993,"fraction":0.123456789012345678901}}';
 async function run(options={}){
  const selected=[table('unit_a',String(options.rowsA?.length??1)),table('unit_b')];
  const constraints=[fk('201','unit_b'),fk('202','unit_a')];
  if(options.composite)constraints[0]=fk('201','unit_b',['parent_id','second_id'],options.full?'f':'s');
  if(options.secondFk)constraints.push(fk('203','unit_b',['second_id']));
  if(options.jsonFk){selected[0].columns.find(c=>c.name==='parent_id').data_type='jsonb';
   selected[1].columns.find(c=>c.name==='id').data_type='jsonb';
   constraints[0].columns[0].data_type='jsonb';constraints[0].columns[0].parent_data_type='jsonb';}
  const rows=selected.map((t,index)=>({schema_name:t.schema_name,table_name:t.table_name,relation_oid:String(101+index),
   relation_kind:'r',persistence:'p',is_partition:false,foreign_keys:index?[constraints[1]]:[constraints[0],...constraints.slice(2)]}));
  if(options.self){selected.splice(1);rows.splice(1);rows[0].foreign_keys=[fk('201','unit_a')];}
  if(options.noCycle)rows[1].foreign_keys=[];
  options.change?.(rows,selected);
  const original={selection:{databaseTables:selected}},counts={opened:0,closed:0,typed:0,contexts:0},queries=[];
  let live=true,failed=false,error,result;
  const sourceFailure=Error('UNIT_SOURCE_CHANGED'),queryFailure=Error('UNIT_TYPED_QUERY_REFUSED');
  const sameSource=()=>{if(!live)throw sourceFailure;};
  const fail=()=>{throw Error('UNIT_PLANNER_REFUSED');};
  const ports={sameSource,fail,pipeline,
   createRestoreRowUtf8Guard:archiveApi.createRestoreRowUtf8Guard,createRestoreRowLineBatchDecoder:archiveApi.createRestoreRowLineBatchDecoder,
   decodeRestoreTableRowLine:archiveApi.decodeRestoreTableRowLine,
   assertContext:async()=>{counts.contexts++;sameSource();if(options.contextFailure&&counts.contexts===options.contextFailure)throw queryFailure;},
   openVerifiedRestoreTableData:(_archive,schema,name)=>{
    sameSource();counts.opened++;const t=selected.find(t=>t.table_name===name);assert.equal(schema,'public');
    const originals=name==='unit_a'?(options.rowsA??[raw]):[raw];
    const bytes=Buffer.from(originals.map(row=>JSON.stringify(row)+'\n').join(''));
    return {table:t,stream:Readable.from([bytes]),verified:options.eofFailure?Promise.reject(queryFailure):Promise.resolve({
     data_file:t.data_file,bytes:bytes.length,sha256:'a'.repeat(64)}),
     async close(){counts.closed++;if(options.closeFailure)throw queryFailure;}};
   },
   sql:async(statement,parameters)=>{
    queries.push(statement);sameSource();
    if(statement.includes('as foreign_keys'))return {rowCount:rows.length,rows};
    counts.typed++;assert.ok(statement.includes('pg_catalog.json_populate_record')&&statement.includes('pg_catalog.num_nulls('));
    assert.ok(statement.includes('as materialized')&&!statement.includes(' is null'));
    assert.ok(!/\b(?:insert|update|delete|commit|set constraints|truncate)\b/i.test(statement));
    for(const image of parameters[0])assert.ok(image.includes('9007199254740993')&&image.includes('0.123456789012345678901'));
    if(options.queryFailure)throw queryFailure;if(options.falsyFailure)throw undefined;
    if(options.withdraw)live=false;
    const output=parameters.slice(1).map(id=>({constraint_oid:id,row_count:String(parameters[0].length),
     active_rows:String(options.active?.[id]??(id==='201'?0:1)),partial_rows:String(options.partial?.[id]??0)}));
    options.changeCounts?.(output);return {rowCount:output.length,rows:output};
   }};
  // Rejection handler belongs to the existing real reader too; fixtures must
  // not turn an intentionally failed EOF into an unhandled test rejection.
  const open=ports.openVerifiedRestoreTableData;ports.openVerifiedRestoreTableData=(...args)=>{const data=open(...args);data.verified.catch(()=>{});return data;};
  try{result=await build(ports,types,isDeepStrictEqual)({},original,ports.sql,ports.assertContext);}catch(value){failed=true;error=value;}
  assert.equal(counts.closed,counts.opened);
  return {failed,error,result,counts,queries,sourceFailure,queryFailure};
 }
 if(want('planner')){
  const inactive=await run();assert.equal(inactive.failed,false);assert.deepEqual(inactive.result.map(t=>t.table_name),['unit_a','unit_b']);cases++;
  const active=await run({active:{201:1,202:1}});assert.equal(active.failed,true);cases++;
  const mixed=await run({rowsA:[raw,raw],active:{201:1,202:1}});assert.equal(mixed.failed,true);cases++;
  const composite=await run({composite:true,partial:{201:1}});assert.equal(composite.failed,false);cases++;
  const fullPartial=await run({composite:true,full:true,partial:{201:1}});assert.equal(fullPartial.failed,true);cases++;
  const fullNull=await run({composite:true,full:true});assert.equal(fullNull.failed,false);cases++;
  const duplicateEdge=await run({secondFk:true,active:{201:0,202:1,203:1}});assert.equal(duplicateEdge.failed,true);cases++;
  // The SAME raw JSON null input follows the typed native reply, not a JS
  // heuristic. Non-SQL-null replies retain the cycle and refuse.
  const jsonNull=await run({active:{201:1,202:1}});assert.equal(jsonNull.failed,true);cases++;
  const noCycle=await run({noCycle:true});assert.equal(noCycle.failed,false);assert.equal(noCycle.counts.opened,0);cases++;
  const self=await run({self:true});assert.equal(self.failed,false);assert.equal(self.counts.opened,0);
  assert.deepEqual(Object.keys(self.result[0]).sort(),['schema_name','table_name']);cases++;
  const empty=await run({rowsA:[]});assert.equal(empty.failed,false);assert.equal(empty.counts.opened,0);
  assert.equal(empty.result.length,2);cases++;
  for(const options of [{withdraw:true},{queryFailure:true},{falsyFailure:true},{eofFailure:true},{closeFailure:true},
   {contextFailure:2},{rowsA:[raw,raw],change:(_rows,tables)=>{tables[0].row_count='1';}},
   {changeCounts:rows=>{rows[0].row_count='0';}},{changeCounts:rows=>{rows[0].constraint_oid='999';}},
   {changeCounts:rows=>{rows[0].active_rows='01';}},{changeCounts:rows=>{rows[0].active_rows=0;}}]){
   const found=await run(options);assert.equal(found.failed,true);cases++;
   if(options.falsyFailure)assert.equal(found.error,undefined);
   if(options.withdraw){assert.ok(found.error instanceof AggregateError);assert.equal(found.error.errors[0],found.sourceFailure);}
  }
  groups++;
 }
 if(want('metadata')){
  for(const change of [rows=>{rows[0].foreign_keys[0].parent_relation_oid='999';},
   rows=>{rows[0].foreign_keys[0].parent_table_name='foreign_table';},rows=>{rows[0].foreign_keys[0].validated=false;},
   rows=>{rows[0].foreign_keys[0].constraint_oid='202';},rows=>{rows[0].foreign_keys[0].match_type='p';},
   rows=>{rows[0].foreign_keys[0].columns=[];},rows=>{rows[0].foreign_keys[0].columns[0].data_type='text';},
   rows=>{rows[0].foreign_keys[0].columns[0].parent_name='missing';},rows=>{rows[0].foreign_keys[0].columns[0].generated='s';},
   rows=>{rows[0].foreign_keys[0].columns.push({...rows[0].foreign_keys[0].columns[0]});},
   rows=>{rows[0].is_partition=true;},rows=>{rows[0].relation_kind='f';},rows=>{rows.pop();}]){
   const found=await run({change});assert.equal(found.failed,true);assert.equal(found.counts.opened,0);cases++;
  }
  assert.ok(component.includes('pg_catalog.unnest(k.conkey) with ordinality'));
  assert.ok(component.includes('k.confkey[keys.ordinality::integer]'));
  assert.ok(component.includes("'parent_data_type',pg_catalog.format_type(pa.atttypid,pa.atttypmod)"));cases++;groups++;
 }
 if(want('json-null')){
  const sqlNull=await run({jsonFk:true});assert.equal(sqlNull.failed,false);cases++;
  const jsonNull=await run({jsonFk:true,active:{201:1,202:1}});assert.equal(jsonNull.failed,true);cases++;
  assert.ok(jsonNull.queries.some(sql=>sql.includes('pg_catalog.num_nulls((o.image)."parent_id")')));cases++;
  // Identical raw field null does not itself grant edge removal. Only the
  // guarded typed native classification may do so; real SQL remains Main's.
  groups++;
 }
 if(want('source-reader')){
  const sourceDir='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/populated-raw-release-original-v109-9WKkdl/new-auth-complete-original';
  const archive=materializeVerifiedArchive({sourceDir,archiveVerifyKey:'UNIT-only-auth-complete-original-HMAC-20261017',
   archiveVerifyKeyId:'unit-auth-complete-original-v1',supportedFormats:['memphis-zoo-disaster-recovery.v4']});
  try{
   const original=archiveApi.readVerifiedPrivateImportSource(archive);
   assert.equal(original.sourceBinding.archive_digest,'c2ca572a9b54f9e3f02f3136fbe42a590857778f310edd32e54315edd3554ef0');
   const targets=['ops_manager_enrollment_codes','ops_manager_trusted_devices'];
   const actual=[];
   for(const name of targets){const t=original.selection.databaseTables.find(t=>t.schema_name==='public'&&t.table_name===name);assert.ok(t);
    const data=archiveApi.openVerifiedRestoreTableData(archive,'public',name),guard=archiveApi.createRestoreRowUtf8Guard(),input=archiveApi.createRestoreRowLineBatchDecoder();
    const settled=pipeline(data.stream,guard,input);settled.catch(()=>{});let count=0;
    try{for await(const lines of input)for(const line of lines){const raw=decodeRestoreTableRowLine(line,t);const row=JSON.parse(raw);actual.push([name,row]);count++;}
     await settled;const eof=await data.verified;assert.equal(eof.data_file,t.data_file);assert.equal(String(count),t.row_count);
    }finally{input.destroy();data.stream.destroy();guard.destroy();await settled.catch(()=>{});await data.close();}
   }
   const enrollment=actual.filter(([name])=>name===targets[0]),trusted=actual.filter(([name])=>name===targets[1]);
   assert.equal(enrollment.length,1);assert.equal(trusted.length,1);
   assert.notEqual(enrollment[0][1].created_by_credential_id,null);assert.equal(enrollment[0][1].consumed_credential_id,null);
   assert.equal(trusted[0][1].manager_enrollment_code_id,null);cases++;
   // Raw fixture nullness is provenance only, not the native typed SQL proof.
  }finally{await archive.cleanup();assert.equal(existsSync(archive.directory),false);}
  groups++;
 }
 console.log(JSON.stringify({selector:'immutable-row-aware-fk-only',part:part||'all-new',groups,cases,
  proof:'SOURCE_PLANNER_COMPONENTS_AND_AUTHENTICATED_ORIGINAL_READER_ONLY',native_SQL_NULL_semantics:'NOT_RUN',
  restore_or_admission:false,old_groups_replayed:0,resources0:true}));process.exit(0);
}

// NEW fixed wrapper join only. Exact shipping helper/guarded caller extraction
// below uses inert recording ports, not native SQL or installer admission.
if(process.argv.includes('--immutable-manager-push-wrapper-only')){
 const part=process.argv.find(arg=>arg.startsWith('--push-wrapper-case='))?.split('=')[1];
 assert.ok(part===undefined||['fixed-wrapper','source-graph'].includes(part));
 const want=name=>part===undefined||part===name;let cases=0,groups=0;
 const text=readFileSync(new URL('./immutable-private-source-initializer.mjs',import.meta.url),'utf8');
 const sha=value=>createHash('sha256').update(value).digest('hex');
 const start=text.indexOf('function unwrapSource(statement){'),end=text.indexOf('\n\nexport async function initializeVerifiedImmutableFreshSource',start);
 assert.ok(start>0&&end>start);const helper=text.slice(start,end);
 const unwrap=new Function('assert','sha',helper+'\nreturn unwrapSource;')(assert,sha);
 const path='proposals/immutable-original-manager-push-restore.sql';
 const pin='78662898fee5662a83564d7bd5487abac88ad1f39400a45a11eaff2539b91051';
 const sql=readFileSync(new URL('../'+path,import.meta.url),'utf8');assert.equal(sha(sql),pin);
 const statement=Object.freeze({sourcePath:path,sourceSha256:pin,sql});
 const expected=sql.replace('\nBEGIN;\n','\n').replace(/\nCOMMIT;\s*$/,'\n');
 const transaction=/^\s*(?:BEGIN|COMMIT|ROLLBACK)(?:\s+(?:WORK|TRANSACTION))?;\s*$/im;
 if(want('fixed-wrapper')){
  assert.equal(unwrap(statement),expected);assert.notEqual(expected,sql);assert.doesNotMatch(expected,transaction);cases++;
  // Reattaching only the removed outer lines reproduces ALL original inner
  // owner/ACL/matcher/trigger/Source checks byte-for-byte, with final LF intact.
  assert.equal(expected.replace('\nSET LOCAL search_path=pg_catalog;','\nBEGIN;\nSET LOCAL search_path=pg_catalog;')+'COMMIT;\n',sql);cases++;
  const before=JSON.parse(sql.split('$original_manager_push_profile$')[1]);
  const retained=JSON.parse(expected.split('$original_manager_push_profile$')[1]);assert.deepEqual(retained,before);cases++;
  for(const changed of [sql.replace('\nBEGIN;\n','\n'),sql.replace('\nCOMMIT;\n','\n'),
   sql.replace('\nBEGIN;\n','\nBEGIN;\nBEGIN;\n'),sql.replace('\nCOMMIT;\n','\nCOMMIT;\nCOMMIT;\n'),
   sql.replace('\nBEGIN;\n','\nBEGIN TRANSACTION;\n'),sql+'SELECT 1;\n',
   sql.replace('\nCOMMIT;\n','\nROLLBACK;\n'),sql.replace('PERFORM custodial_dr.immutable_import_owner_fence();','-- missing fence'),
   sql+'\n']){
   let dispatches=0;const record=value=>{dispatches++;assert.doesNotMatch(value,transaction);};
   assert.throws(()=>record(unwrap({...statement,sql:changed})));assert.equal(dispatches,0);cases++;
  }
  for(const sourceSha256 of [undefined,'0'.repeat(64),pin+'\n']){
   assert.throws(()=>unwrap({...statement,sourceSha256}));cases++;
  }
  groups++;
 }
 if(want('source-graph')){
  const sourceDir='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/populated-raw-release-original-v109-9WKkdl/new-auth-complete-original';
  const archive=materializeVerifiedArchive({sourceDir,
   archiveVerifyKey:'UNIT-only-auth-complete-original-HMAC-20261017',archiveVerifyKeyId:'unit-auth-complete-original-v1',
   supportedFormats:['memphis-zoo-disaster-recovery.v4']});
  try{
   assert.equal(readVerifiedArchiveSourceBinding(archive).archive_digest,'c2ca572a9b54f9e3f02f3136fbe42a590857778f310edd32e54315edd3554ef0');
   const source=await prepareVerifiedImmutableBootstrapSource(archive);
   assert.equal(source.statements.length,12);assert.equal(source.recipes.length,24);
   const fixed=source.statements.filter(row=>row.sourcePath===path);assert.equal(fixed.length,1);
   assert.equal(fixed[0].sourceSha256,pin);assert.equal(fixed[0].sql,sql);cases++;
   const a=text.indexOf(' const query=async(sql,params=[])=>'),b=text.indexOf('return result;};',a)+'return result;};'.length;
   const guarded=text.slice(a,b),loop='for(const statement of source.statements)await query(unwrapSource(statement));';
   assert.ok(a>0&&b>a);assert.equal(text.split(loop).length,2);
   const run=new Function('assert','sha','source','db','nativeQuery','readContext','checkSource',helper+
    '\nreturn(async()=>{'+guarded+'\n'+loop+'})();');
   const receiver=Object.freeze({inertSourceRecordingOnly:true}),commands=[],trace=[];
   const checkSource=()=>{assertVerifiedImmutableBootstrapSource(source,archive);trace.push('source');};
   const readContext=async()=>{trace.push('context');}; // Not an actual DB context.
   await run(assert,sha,source,receiver,async function(command,params){
    assert.equal(this,receiver);assert.deepEqual(params,[]);assert.doesNotMatch(command,transaction);
    commands.push(command);trace.push('record');return Object.freeze({recordingOnly:true});
   },readContext,checkSource);
   assert.equal(commands.length,12);assert.deepEqual(commands,source.statements.map(unwrap));
   assert.equal(commands[source.statements.findIndex(row=>row.sourcePath===path)],expected);
   assert.deepEqual(trace,source.statements.flatMap(()=>['context','source','record','source','context']));cases++;
   // Exactly the one new Source joins the allowlist. No broad all-proposal,
   // caller-selected or regex-based wrapper stripping rule was introduced.
   assert.ok(helper.includes("'proposals/immutable-original-manager-push-restore.sql'"));
   assert.equal(helper.split("'78662898fee5662a83564d7bd5487abac88ad1f39400a45a11eaff2539b91051'").length,2);cases++;
  }finally{await archive.cleanup();assert.equal(existsSync(archive.directory),false);}
  groups++;
 }
 console.log(JSON.stringify({selector:'immutable-manager-push-wrapper-only',part:part||'all-new',groups,cases,
  proof:'FIXED_SOURCE_WRAPPER_AND_ACTUAL_PREPARED_GRAPH_RECORDING_ONLY',native_SQL:'NOT_RUN',
  caller_transaction_or_row_security_runtime:'NOT_PROVED',old_groups_replayed:0,original_archive_modified:false,resources0:true}));process.exit(0);
}

// NEW manager-push Source profile only. Inert expression components below
// do NOT execute PostgreSQL, a private matcher, or native restore admission.
if(process.argv.includes('--immutable-manager-push-original-only')){
 const part=process.argv.find(arg=>arg.startsWith('--manager-push-case='))?.split('=')[1];
 assert.ok(part===undefined||['profile','branch','installer'].includes(part));
 const want=name=>part===undefined||part===name;let cases=0,groups=0;
 const sql=readFileSync(new URL('../proposals/immutable-original-manager-push-restore.sql',import.meta.url),'utf8');
 const sha=value=>createHash('sha256').update(value).digest('hex');
 const literal=sql.split('$original_manager_push_profile$');assert.equal(literal.length,3);
 const profile=JSON.parse(literal[1]);
 const keys=['identity','registry_identity','before_definition','before_definition_sha256','before_prosrc_sha256',
  'restore_branch','after_prosrc_sha256','after_definition_sha256'];
 const body=definition=>{
  const parts=definition.split('AS $function$');assert.equal(parts.length,2);
  assert.ok(parts[1].endsWith('$function$\n'));return parts[1].slice(0,-'$function$\n'.length);
 };
 const checkProfile=value=>{
  assert.ok(value&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype);
  assert.deepEqual(Reflect.ownKeys(value).sort(),keys.slice().sort());
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);assert.ok(Object.hasOwn(d,'value'));assert.equal(typeof d.value,'string');}
  assert.equal(value.identity,'public.ops_manager_notification_validate_owner()');
  assert.equal(value.registry_identity,'ops_manager_notification_validate_owner()');
  for(const key of keys.filter(key=>key.endsWith('_sha256')))assert.ok(value[key].length===64&&/^[0-9a-f]{64}$/.test(value[key]));
  assert.equal(value.before_definition_sha256,'c51dd11eb1a98774e84e7e22bebc807f2f31baae91e2803d68092349fe7a5212');
  assert.equal(sha(value.before_definition),value.before_definition_sha256);
  assert.equal(sha(body(value.before_definition)),value.before_prosrc_sha256);
  const needle='\nbegin\n';assert.equal(value.before_definition.split(needle).length,2);assert.ok(value.restore_branch.length>0);
  const after=value.before_definition.replace(needle,()=>needle+value.restore_branch);
  assert.equal(sha(after),value.after_definition_sha256);assert.equal(sha(body(after)),value.after_prosrc_sha256);
  assert.equal(after.split(value.restore_branch).length,2);assert.equal(after.replace(value.restore_branch,''),value.before_definition);
  return after;
 };
 if(want('profile')){
  const root='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/populated-raw-release-original-v109-9WKkdl/new-auth-complete-original/';
  const catalogBytes=readFileSync(root+'inventory/source-catalog.json');
  assert.equal(sha(catalogBytes),'0bd433901d199bd273b8442fd0b295c619cc4fe912e3d5ea7c17ab21a6c30e2d');
  const catalog=JSON.parse(catalogBytes),original=catalog.functions.filter(row=>row.schema_name==='public'
   &&row.function_name==='ops_manager_notification_validate_owner'&&row.identity_arguments==='');
  assert.equal(original.length,1);assert.equal(profile.before_definition,original[0].definition);
  const after=checkProfile(profile);assert.equal(after.endsWith('$function$\n'),true);cases++;
  // Existing strict row-line decoder preserves the raw registry definition;
  // the retained archive has string-encoded JSON lines, not caller row JSON.
  const table=JSON.parse(readFileSync(root+'inventory/table-catalog.json')).find(row=>row.schema_name==='public'
   &&row.table_name==='custodial_release_authority_restore_inventory');assert.ok(table);
  const rows=readFileSync(root+'database/public.custodial_release_authority_restore_inventory.jsonl','utf8')
   .trimEnd().split('\n').map(line=>JSON.parse(decodeRestoreTableRowLine(line,table)));
  const registry=rows.filter(row=>row.object_kind==='function'&&row.object_identity===profile.registry_identity);
  assert.equal(registry.length,1);assert.equal(registry[0].definition_sql,profile.before_definition);
  assert.equal(registry[0].definition_sha256,profile.before_definition_sha256);cases++;
  const consumers=catalog.triggers.filter(row=>row.definition.endsWith('EXECUTE FUNCTION '+profile.identity));
  assert.deepEqual(consumers.map(row=>[row.schema_name,row.table_name,row.trigger_name,row.enabled]).sort(),[
   ['public','ops_manager_notification_preferences','trg_ops_manager_notification_preferences_owner','O'],
   ['public','ops_manager_push_devices','trg_ops_manager_push_devices_owner','O']]);cases++;
  const acls=JSON.parse(readFileSync(root+'inventory/original-acls.json')).routines.filter(row=>row.identity===profile.identity);
  assert.equal(acls.length,1);assert.equal(acls[0].owner_name,'supabase_admin');
  assert.deepEqual(acls[0].grants,[{grantee:'postgres',grantor:'supabase_admin',privilege_type:'EXECUTE',is_grantable:false}]);cases++;
  assert.equal(after.replace(profile.restore_branch,''),original[0].definition);
  assert.equal(after.split('new.updated_at:=now();').length,2);
  assert.ok(after.indexOf(profile.restore_branch)<after.indexOf('select manager_id into v_manager_id'));cases++;
  for(const changed of [{...profile,extra:'UNIT'},Object.fromEntries(Object.entries(profile).filter(([key])=>key!=='registry_identity')),
   {...profile,identity:'public.foreign_owner()'},{...profile,registry_identity:profile.identity},
   {...profile,before_definition:profile.before_definition+'\n'},
   {...profile,before_definition:profile.before_definition.replaceAll('\n','\r\n')},
   {...profile,before_definition:profile.before_definition.replace('new.updated_at:=now();','new.updated_at:=clock_timestamp();')},
   {...profile,before_prosrc_sha256:'0'.repeat(64)},{...profile,after_prosrc_sha256:'0'.repeat(64)},
   {...profile,after_definition_sha256:'0'.repeat(64)},{...profile,restore_branch:''},
   {...profile,restore_branch:profile.restore_branch+'\n'},{...profile,before_definition_sha256:profile.before_definition_sha256+'\n'},
   {...profile,before_definition:new String(profile.before_definition)}]){
   assert.throws(()=>checkProfile(changed));cases++;
  }
  groups++;
 }
 if(want('branch')){
  checkProfile(profile);
  // Parse only the three exact IF expression slots from the shipped branch.
  // This preserves their Source predicates, but is NOT SQL or matcher proof.
  const branch=profile.restore_branch;
  const parsed=branch.match(/^  --[^\n]*\n  if ([\s\S]+?) then\n    if ([\s\S]+?) then\n      if custodial_dr\.immutable_import_matches_ordinary_staged\(TG_RELID,pg_catalog\.row_to_json\(NEW\)\) is true then\n        return NEW;\n      end if;\n    end if;\n  end if;\n$/);
  assert.ok(parsed);
  const translate=expression=>expression.replace(/\s+/g,' ').trim()
   .replace("pg_catalog.to_regclass('public.ops_manager_push_devices')",'relationOid')
   .replace("pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_staged(oid,json)')",'helperOid')
   .replace(/ is not null/g,' !== null').replace(/ = /g,' === ').replace(/ and /g,' && ');
  const execute=new Function('context','matcher',`const {TG_OP,TG_LEVEL,TG_WHEN,TG_TABLE_SCHEMA,TG_TABLE_NAME,TG_NAME,TG_NARGS,
   TG_RELID,current_user,session_user,relationOid,helperOid,NEW}=context;
   if(${translate(parsed[1])}){if(${translate(parsed[2])}){if(matcher(TG_RELID,NEW)===true)return NEW;}}
   return 'UNCHANGED_NORMAL_BODY';`);
  const row=Object.freeze({credential_id:'UNIT-original-revoked-credential',updated_at:'2024-01-02T03:04:05.123456+00:00',
   metadata_json:'{"large":9007199254740993,"text":"UNIT-only-original"}'});
  const context={TG_OP:'INSERT',TG_LEVEL:'ROW',TG_WHEN:'BEFORE',TG_TABLE_SCHEMA:'public',TG_TABLE_NAME:'ops_manager_push_devices',
   TG_NAME:'trg_ops_manager_push_devices_owner',TG_NARGS:0,TG_RELID:900,relationOid:900,helperOid:901,
   current_user:'supabase_admin',session_user:'supabase_admin',NEW:row};
  let calls=0;
  assert.equal(execute(context,(oid,image)=>{calls++;assert.equal(oid,900);assert.equal(image,row);return true;}),row);
  assert.equal(calls,1);assert.equal(row.updated_at,'2024-01-02T03:04:05.123456+00:00');cases++;
  for(const patch of [{TG_OP:'UPDATE'},{TG_OP:'DELETE'},{TG_OP:'TRUNCATE'},{TG_LEVEL:'STATEMENT'},{TG_WHEN:'AFTER'},
   {TG_WHEN:'INSTEAD OF'},{TG_TABLE_SCHEMA:'foreign'},{TG_TABLE_NAME:'ops_manager_notification_preferences'},
   {TG_NAME:'trg_ops_manager_notification_preferences_owner'},{TG_NAME:'UNIT_foreign_trigger'},{TG_NARGS:1},
   {TG_RELID:902},{current_user:'postgres'},{session_user:'postgres'},{current_user:'service_role',session_user:'service_role'},
   {helperOid:null}]){
   calls=0;assert.equal(execute({...context,...patch},()=>{calls++;return true;}),'UNCHANGED_NORMAL_BODY');assert.equal(calls,0);cases++;
  }
  for(const result of [false,null,undefined,0,1,'true']){
   calls=0;assert.equal(execute(context,()=>{calls++;return result;}),'UNCHANGED_NORMAL_BODY');assert.equal(calls,1);cases++;
  }
  let failed=false;try{execute(context,()=>{throw undefined;});}catch(error){failed=true;assert.equal(error,undefined);}
  assert.equal(failed,true);cases++;groups++;
 }
 if(want('installer')){
  checkProfile(profile);
  assert.match(sql,/\nBEGIN;\nSET LOCAL search_path=pg_catalog;\nDO /);
  assert.ok(sql.endsWith('COMMIT;\n'));
  assert.equal(sql.split('EXECUTE after_definition;').length,2);cases++;
  for(const guard of ["current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'",
   "pg_catalog.current_setting('session_replication_role')<>'origin'",'PERFORM custodial_dr.immutable_import_owner_fence();',
   'LOCK TABLE public.ops_manager_notification_preferences,public.ops_manager_push_devices IN ACCESS EXCLUSIVE MODE;',
   '(SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgfoid=function_oid)<>2',
   "t.tgtype=23 AND t.tgenabled='O' AND NOT t.tgisinternal",'t.tgqual IS NULL AND t.tgnargs=0',
   "pg_catalog.octet_length(t.tgargs)=0","t.tgattr::text='' AND t.tgconstraint=0",'NOT t.tgdeferrable AND NOT t.tginitdeferred',
   't.tgoldtable IS NULL AND t.tgnewtable IS NULL','pg_catalog.pg_get_triggerdef(t.oid,false) IS NOT DISTINCT FROM expected.definition',
   'p.proowner=owner_oid AND NOT p.prosecdef',"p.proargtypes[0]='pg_catalog.oid'::regtype AND p.proargtypes[1]='pg_catalog.json'::regtype",
   "p.proconfig=ARRAY['search_path=pg_catalog']::text[]",'WHERE a.grantee<>owner_oid OR a.grantor<>owner_oid',
   'original.prorettype',"original.prorettype<>'pg_catalog.trigger'::regtype OR NOT original.prosecdef",
   'before_definition IS DISTINCT FROM profile',"a.grantee NOT IN(owner_oid,postgres_oid)",
   "pg_catalog.to_jsonb(observed)-'prosrc' IS DISTINCT FROM pg_catalog.to_jsonb(original)-'prosrc'",
   'IS DISTINCT FROM original_triggers','IS DISTINCT FROM original_relations','IS DISTINCT FROM pg_catalog.to_jsonb(helper)']){
   assert.ok(sql.includes(guard),'Missing fixed Source guard');cases++;
  }
  assert.equal(sql.split('PERFORM custodial_dr.immutable_import_owner_fence();').length,4);cases++;
  // The matcher body is the EXACT existing invoker implementation, not a
  // profile name/ambient flag that can stand in for original staging authority.
  const base=readFileSync(new URL('../proposals/immutable-private-owner-context.sql',import.meta.url),'utf8');
  const matcher=base.match(/CREATE FUNCTION custodial_dr\.immutable_import_matches_ordinary_staged\([\s\S]*?AS \$fn\$([\s\S]*?)\$fn\$;/);
  assert.ok(matcher);assert.equal(sha(matcher[1]),'5f3d2e39a0adb5d4a87c670763372ecfc4d113ef33ab16eedcca38b56ad7ac42');
  assert.ok(sql.includes("='"+sha(matcher[1])+"'"));cases++;
  const outer=literal[0]+literal[2];
  assert.doesNotMatch(outer,/^\s*(?:GRANT|REVOKE|ALTER\s+(?:ROLE|FUNCTION|TABLE)|CREATE\s+(?:ROLE|TABLE|TRIGGER)|UPDATE|DELETE|INSERT)\b/im);cases++;
  assert.doesNotMatch(profile.restore_branch.replace(/^\s*--[^\n]*\n/gm,''),/\b(?:UPDATE|DELETE|SELECT|EXECUTE|SET|GRANT|REVOKE)\b/i);cases++;groups++;
 }
 console.log(JSON.stringify({selector:'immutable-manager-push-original-only',part:part||'all-new',groups,cases,
  proof:'SOURCE_PROFILE_HASH_PARSER_AND_INERT_BRANCH_COMPONENTS_ONLY',SQL:'NOT_RUN',private_matcher_executed:false,
  native_admission_or_restoration:false,normal_body_byte_preserved:true,old_groups_replayed:0,resources0:true}));process.exit(0);
}

// NEW public bootstrap error boundaries only. No historical composition,
// native SQL, fixture repair, signer or restore/effect decision is invoked.
if(process.argv.includes('--immutable-bootstrap-private-errors-only')){
 const part=process.argv.find(arg=>arg.startsWith('--bootstrap-error-case='))?.split('=')[1];
 assert.ok(part===undefined||['actual-release','handles','thrown-values'].includes(part));
 const want=name=>part===undefined||part===name;let cases=0,groups=0;
 const {inspect}=await import('node:util');
 const code='IMMUTABLE_BOOTSTRAP_SOURCE_UNAVAILABLE',message='Immutable bootstrap Source is unavailable.';
 const phases=['ARCHIVE_ADMISSION','ORIGINAL_INVENTORY','PROGRAM_SOURCE','ORIGINAL_ROWS','ORIGINAL_RELEASE',
  'SOURCE_RECIPES','ORIGINAL_REGISTRY','SOURCE_STATEMENTS','FINAL_CURRENTNESS','SOURCE_HANDLE',
  'ARCHIVE_CURRENTNESS','PROGRAM_CURRENTNESS','INVENTORY_CURRENTNESS'];
 const check=(error,phase,privateValues=[])=>{
  assert.ok(error instanceof Error);assert.ok(Object.isFrozen(error));
  assert.deepEqual(Reflect.ownKeys(error).sort(),['name','message','stack','code','source_phase'].sort());
  for(const key of Reflect.ownKeys(error)){
   const descriptor=Object.getOwnPropertyDescriptor(error,key);
   assert.ok(Object.hasOwn(descriptor,'value'));assert.equal(typeof descriptor.value,'string');
   assert.equal(descriptor.writable,false);assert.equal(descriptor.configurable,false);
  }
  assert.equal(error.name,'Error');assert.equal(error.code,code);assert.equal(error.message,message);
  assert.ok(phases.includes(error.source_phase));assert.equal(error.source_phase,phase);
  assert.equal(error.stack,'Error: '+message);assert.equal(String(error),'Error: '+message);
  assert.deepEqual(JSON.parse(JSON.stringify(error)),{code,source_phase:phase});
  for(const key of ['cause','actual','expected','archive','sourceBinding','outcome','retry_safe'])assert.equal(Object.hasOwn(error,key),false);
  const surfaces=[JSON.stringify(error),JSON.stringify({...error}),String(error),`${error}`,error.stack,
   inspect(error,{showHidden:true,depth:10}),JSON.stringify(Object.getOwnPropertyDescriptors(error))];
  for(const value of privateValues)if(typeof value==='string'&&value.length>8){
   for(const surface of surfaces)assert.equal(surface.includes(value),false,'Private value crossed Source error boundary');
  }
  const cloned=structuredClone(error);assert.equal(cloned.message,message);assert.equal(cloned.stack,'Error: '+message);
  cases++;
 };
 const root='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/';
 const materialize=sourceDir=>materializeVerifiedArchive({sourceDir,
  archiveVerifyKey:'UNIT-only-auth-complete-original-HMAC-20261017',archiveVerifyKeyId:'unit-auth-complete-original-v1',
  supportedFormats:['memphis-zoo-disaster-recovery.v4']});
 if(want('actual-release')){
  const retained=root+'populated-authority-original-v107-HpnNxm/new-auth-complete-original';
  const manifest=readFileSync(join(retained,'archive-signature.json'));
  const archive=materialize(retained);
  try{
   const binding=readVerifiedArchiveSourceBinding(archive);
   assert.equal(binding.archive_digest,'3a23652651d9085b62b23251306d06fc0587ee5026a0d94b2f7551b6a0af0096');
   const privateValues=[JSON.stringify(binding.source_identity.release),...Object.values(binding.source_identity.release),
    'AssertionError','release_id','definition_sql','SELECT ','actual:','expected:'];
   await assert.rejects(prepareVerifiedImmutableBootstrapSource(archive),error=>{
    check(error,'ORIGINAL_RELEASE',privateValues);return true;
   });
  }finally{await archive.cleanup();assert.equal(existsSync(archive.directory),false);}
  assert.deepEqual(readFileSync(join(retained,'archive-signature.json')),manifest);groups++;
 }
 if(want('handles')){
  let accessed=0;
  const hostile=new Proxy({}, {get(){accessed++;throw Error('UNIT_PRIVATE_proxy');},ownKeys(){accessed++;throw Error('UNIT_PRIVATE_keys');}});
  for(const archive of [null,undefined,{},Object.freeze({sourceBinding:{}}),hostile]){
   await assert.rejects(prepareVerifiedImmutableBootstrapSource(archive),error=>{check(error,'ARCHIVE_ADMISSION');return true;});
   assert.throws(()=>assertVerifiedImmutableBootstrapSource(archive,{}),error=>{check(error,'SOURCE_HANDLE');return true;});
  }
  const {default:pg}=await import('pg');
  const native=new pg.Client({host:'127.0.0.1',port:1,database:'UNIT_unstarted_no_connection'});
  try{await assert.rejects(prepareVerifiedImmutableBootstrapSource(native),error=>{check(error,'ARCHIVE_ADMISSION');return true;});}
  finally{await native.end();}
  assert.equal(accessed,0);
  // A genuine Source handle is constructed solely as a prerequisite for NEW
  // wrong-token and post-cleanup boundary cases; no positive suite is replayed.
  const archive=materialize(root+'auth-complete-original-release-row-v76');let source;
  try{
   source=await prepareVerifiedImmutableBootstrapSource(archive);
   for(const other of [null,{},Object.freeze({...archive})])assert.throws(
    ()=>assertVerifiedImmutableBootstrapSource(source,other),error=>{check(error,'ARCHIVE_CURRENTNESS');return true;});
  }finally{await archive.cleanup();assert.equal(existsSync(archive.directory),false);}
  assert.throws(()=>assertVerifiedImmutableBootstrapSource(source,archive),error=>{check(error,'ARCHIVE_CURRENTNESS');return true;});groups++;
 }
 if(want('thrown-values')){
  // Execute the EXACT changed public functions with inert dependency ports.
  // These cannot create an admitted Source/native client or SQL authority.
  const text=readFileSync(new URL('./immutable-private-source-bootstrap.mjs',import.meta.url),'utf8');
  const helper=text.slice(text.indexOf('const bootstrapSourceErrorPhases='),text.indexOf('const closed='));
  const methods=text.slice(text.indexOf('export async function prepareVerifiedImmutableBootstrapSource('),
   text.indexOf('export function readVerifiedImmutableBootstrapAcls(')).replaceAll('export ','');
  assert.ok(helper.startsWith('const bootstrapSourceErrorPhases=')&&methods.startsWith('async function prepare'));
  const build=new Function('ports','assert','types',`${helper}
   const inventoryKeys=[];
   const {readVerifiedPrivateImportSource,readVerifiedImmutableBootstrapInventory,requireArchive,closed,
    readBaseSource,loadImmutableDomainSourceRecipes,loadImmutableMessageSourceRecipes,readAuthoritySources,
    collectVerifiedRestoreBootstrapRows,plans}=ports;
   ${methods}
   return {prepare:prepareVerifiedImmutableBootstrapSource,assertSource:assertVerifiedImmutableBootstrapSource};`);
  let touched=0;
  const privateText='UNIT_PRIVATE_release_SQL_secret_timestamp_body_2026-10-18';
  const raw=Object.defineProperties(new Error(privateText),{
   cause:{get(){touched++;throw undefined;}},actual:{value:{release_id:privateText}},expected:{value:{sql:privateText}},
   toString:{value(){touched++;throw undefined;}},toJSON:{value(){touched++;throw undefined;}}
  });
  const hostile=new Proxy({}, {get(){touched++;throw undefined;},ownKeys(){touched++;throw undefined;},
   getPrototypeOf(){touched++;throw undefined;},getOwnPropertyDescriptor(){touched++;throw undefined;}});
  const values=[undefined,null,false,0,'',privateText,Symbol(privateText),raw,hostile];
  for(const value of values){
   const fail=()=>{throw value;},original={sourceBinding:{}},plans=new WeakMap(),token={},source={};
   const inert=()=>{};
   const baseline={readVerifiedPrivateImportSource:fail,readVerifiedImmutableBootstrapInventory:inert,
    requireArchive:inert,closed:inert,readBaseSource:inert,loadImmutableDomainSourceRecipes:inert,
    loadImmutableMessageSourceRecipes:inert,readAuthoritySources:inert,collectVerifiedRestoreBootstrapRows:inert,plans};
   await assert.rejects(build(baseline,assert,types).prepare(token),error=>{check(error,'ARCHIVE_ADMISSION',[privateText]);return true;});
   const beforeAwait={...baseline,readVerifiedPrivateImportSource:()=>original,readVerifiedImmutableBootstrapInventory:fail};
   await assert.rejects(build(beforeAwait,assert,types).prepare(token),error=>{check(error,'ORIGINAL_INVENTORY',[privateText]);return true;});
   const duringAwait={...baseline,readVerifiedPrivateImportSource:()=>original,
    readVerifiedImmutableBootstrapInventory:()=>({sourceBinding:original.sourceBinding,inventory:{}}),
    readBaseSource:()=>({}),loadImmutableDomainSourceRecipes:()=>({assertCurrent:inert}),
    loadImmutableMessageSourceRecipes:()=>({assertCurrent:inert}),readAuthoritySources:()=>[],
    collectVerifiedRestoreBootstrapRows:()=>Promise.reject(value)};
   await assert.rejects(build(duringAwait,assert,types).prepare(token),error=>{check(error,'ORIGINAL_ROWS',[privateText]);return true;});
   plans.set(source,{archive:token,original});
   const current={...baseline,requireArchive:fail};
   assert.throws(()=>build(current,assert,types).assertSource(source,token),error=>{check(error,'ARCHIVE_CURRENTNESS',[privateText]);return true;});
   const program={...baseline,requireArchive:inert,readBaseSource:fail};
   assert.throws(()=>build(program,assert,types).assertSource(source,token),error=>{check(error,'PROGRAM_CURRENTNESS',[privateText]);return true;});
  }
  assert.equal(touched,0);groups++;
 }
 console.log(JSON.stringify({selector:'immutable-bootstrap-private-errors-only',part:part||'all-new',groups,cases,
  proof:'ACTUAL_SOURCE_REFUSALS_AND_INERT_BOUNDARY_COMPONENTS_ONLY',SQL:'NOT_RUN',old_groups_replayed:0,
  archive_repaired_or_resigned:false,restore_or_COMMIT_authority:false,resources0:true}));process.exit(0);
}

// Only the NEW post-authority Source/component and closed-native refusals.
// Inert component ports below are NOT private issuance or native SQL proof.
if(process.argv.includes('--immutable-post-authority-data-only')){
 const part=process.argv.find(arg=>arg.startsWith('--post-authority-case='))?.split('=')[1];
 assert.ok(part===undefined||['admission','images','frame','sequence','zero-and-auth','readonly'].includes(part));
 const want=name=>part===undefined||part===name;let cases=0,groups=0;
 const text=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
 const {isDeepStrictEqual}=await import('node:util'),refuse=()=>{throw Error('UNIT component refusal, never native authority');};
 const a=text.indexOf('const committedAuthorityTargets='),b=text.indexOf('\nfunction currentCommittedAuthorityData',a);
 const c=text.indexOf('function committedAuthorityImageSql('),d=text.indexOf('\n// Inspect only THIS module',c);
 assert.ok(a>0&&b>a&&c>b&&d>c);
 const model=new Function('fail',text.slice(a,b)+'\n'+text.slice(c,d)+'\nreturn {targets:committedAuthorityTargets,sql:committedAuthorityImageSql};')(refuse);
 const closed=new Function('types','isDeepStrictEqual','fail',text.slice(text.indexOf('function closed(value,keys) {'),
  text.indexOf('// Actual pg.Result has additional own fields/prototype;'))+'\nreturn closed;')(types,isDeepStrictEqual,refuse);
 const completion=Object.freeze({database_oid:'9',backend_pid:21,transaction_id:'12',restore_id:'11111111-1111-4111-8111-111111111111',
  authority_generation:'1',archive_digest:'a'.repeat(64),original_transaction_id:'10',state:'CONSUMED_PAUSED',
  revocations:Object.freeze(Object.fromEntries(model.targets.map(target=>[target.counter,'1'])))});
 if(want('admission')){
  const {inspectCommittedImmutableFreshAuthorityData:inspect,compareVerifiedImmutableOrdinaryTableData:compare}=await import('./immutable-private-data-import.mjs');
  const {default:pg}=await import('pg');
  let queries=0,reads=0;
  const facade={query(){queries++;throw Error('must never use a facade');}},archive={UNIT:'not an admitted archive'};
  for(const db of [null,{},facade,new Proxy({}, {})]){
   await assert.rejects(inspect({db,verifiedArchive:archive}),error=>error.code==='IMMUTABLE_FRESH_POST_AUTHORITY_READ_UNAVAILABLE'
    &&error.outcome==='UNKNOWN'&&error.retry_safe===false&&error.effects===false&&error.inventory_acknowledged===false);cases++;
  }
  const native=new pg.Client({host:'127.0.0.1',port:1,database:'UNIT_never_connected'});
  try{
   await assert.rejects(inspect({db:native,verifiedArchive:archive}),error=>error.code==='IMMUTABLE_FRESH_POST_AUTHORITY_READ_UNAVAILABLE');cases++;
   for(const extra of [{authorityCompletion:completion},{phase:'COMMIT_ACKNOWLEDGED'},{authorityPhase:'COMMIT_ACKNOWLEDGED'},
    {originalDataReadback:{}},{effect_transaction_started_at:'2026-10-17T00:00:00Z'}]){
    await assert.rejects(inspect({db:native,verifiedArchive:archive,...extra}),error=>error.outcome==='UNKNOWN');cases++;
   }
  }finally{await native.end();}
  const accessor={get db(){reads++;return facade;},verifiedArchive:archive};
  await assert.rejects(inspect(accessor));cases++;
  const publicOverride=await compare({db:facade,verifiedArchive:archive,authorityData:{completion}});
  assert.equal(publicOverride.state,'UNSUPPORTED');assert.deepEqual(publicOverride.tables,[]);cases++;
  assert.equal(queries,0);assert.equal(reads,0);groups++;
 }
 if(want('images')||want('zero-and-auth')){
  const method=text.slice(text.indexOf('export async function compareVerifiedImmutableOrdinaryTableData(options) {'));
  const start=method.indexOf('      const authorityTarget='),end=method.indexOf('\n      if(isBootstrap){',start);
  assert.ok(start>0&&end>start);const branch=method.slice(start,end);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const run=new AsyncFunction('table','supported','originalRows','authorityData','committedAuthorityTargets','committedAuthorityImageSql',
   'source','read','isDeepStrictEqual','refuse','closed',`const summaries=[],sourceVerified='SOURCE_TRANSFORMATION_VERIFIED';
    const summary=(t,state,original_rows,counts={})=>Object.freeze({schema_name:t.schema_name,table_name:t.table_name,state,original_rows,...counts});
    const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
    for(let loop=0;loop<1;loop++){const count=originalRows.length;${branch}}return summaries;`);
  const raw='{"id":"11111111-1111-4111-8111-111111111111","metadata_json":{"large":9007199254740993,"fraction":0.123456789012345678901}}';
  const journey=async(index,fault='')=>{
   const target=model.targets[index],deleted=index===5,queries=[];let live=true;
   const columns=[...new Set([...target.changed,target.primaryKey])].map(name=>({name,data_type:name===target.primaryKey?'uuid'
    :name==='enabled'?'boolean':['revoked_at','updated_at'].includes(name)?'timestamp with time zone':'text',generated:'',identity:''}));
   const table={schema_name:target.schema,table_name:target.table,row_count:'1',primary_key:[target.primaryKey],columns};
   if(fault==='foreign-column')table.columns=columns.map(column=>column.name===target.primaryKey?{...column,data_type:'text'}:column);
   const data={completion,frame:{effect_transaction_started_at:'2026-10-17T00:00:00.123456+00:00'}};
   if(fault==='unaffected')data.completion={...completion,revocations:{...completion.revocations,[target.counter]:'0'}};
   let found,failed=false,error;
   try{found=await run(table,fault!=='unsupported',[raw],data,model.targets,model.sql,()=>{if(!live)refuse();},async(sql,params)=>{
    queries.push(sql);assert.equal(params[0][0],raw);assert.equal(params[1],'disaster_restore_generation_1');
    assert.equal(params[2],data.frame.effect_transaction_started_at);
    assert.ok(sql.includes('except all select row_data from current_rows')&&sql.includes('except all select row_data from expected_rows'));
    assert.ok(sql.includes('pg_catalog.json_populate_record')&&sql.includes('count(distinct (o.image).'+target.primaryKey+')'));
    assert.doesNotMatch(sql,/\b(?:insert|update|delete|truncate|commit|grant|set)\b/i);
    const counts={original_rows:'1',original_keys:'1',transformed_rows:'1',expected_rows:deleted?'0':'1',current_rows:deleted?'0':'1',
     missing_rows:'0',extra_rows:'0',clock_fields_valid:true};
    if(fault==='extra')Object.assign(counts,{current_rows:deleted?'1':'2',extra_rows:'1'});
    if(fault==='missing')Object.assign(counts,deleted?{current_rows:'1',extra_rows:'1'}:{current_rows:'0',missing_rows:'1'});
    if(fault==='changed')Object.assign(counts,deleted?{current_rows:'1',extra_rows:'1'}:{missing_rows:'1',extra_rows:'1'});
    if(fault==='clock')counts.clock_fields_valid=false;
    if(fault==='duplicate')counts.original_keys='0';
    if(fault==='wrong-count')counts.transformed_rows='0';
    if(fault==='wrong-type')counts.current_rows=1;
    if(fault==='unaffected')counts.transformed_rows='0';
    if(fault==='late-source')live=false;
    if(fault==='falsy-query')throw undefined;
    return [counts];
   },isDeepStrictEqual,refuse,closed);}catch(value){failed=true;error=value;}
   return {found,failed,error,queries};
  };
  if(part!=='zero-and-auth'){
  for(let i=0;i<6;i++){
   const result=await journey(i);assert.equal(result.failed,false);assert.equal(result.found[0].state,'SOURCE_TRANSFORMATION_VERIFIED');
   assert.equal(result.queries.length,1);assert.equal(result.found[0].expected_rows,i===5?'0':'1');cases++;
  }
  for(const fault of ['extra','missing','changed','clock']){
   const result=await journey(4,fault);assert.equal(result.failed,false);assert.equal(result.found[0].state,'DIFFERENT');cases++;
  }
  for(const fault of ['duplicate','wrong-count','wrong-type','late-source','falsy-query','foreign-column']){
   const result=await journey(4,fault);assert.equal(result.failed,true);assert.equal(result.found,undefined);cases++;
  }
  const unsupported=await journey(4,'unsupported');assert.equal(unsupported.found[0].state,'UNSUPPORTED');assert.equal(unsupported.queries.length,0);cases++;
  const push=model.sql(model.targets[4]);
  assert.ok(push.includes("'updated_at',$3::timestamptz"));
  assert.ok(!push.includes("'updated_at',t.updated_at")&&!push.includes("'updated_at',(o.image).updated_at"));cases++;
  assert.throws(()=>model.sql({...model.targets[4]}));cases++;
  }
  if(want('zero-and-auth')){
   for(let i=0;i<5;i++){
    const unchanged=await journey(i,'unaffected');assert.equal(unchanged.failed,false);assert.equal(unchanged.found[0].state,'MATCH');
    assert.equal(unchanged.found[0].source_transformed_rows,'0');cases++;
   }
   const survived=await journey(5,'extra');assert.equal(survived.failed,false);assert.equal(survived.found[0].state,'DIFFERENT');cases++;
   for(const target of model.targets){
    const sql=model.sql(target);
    assert.ok(sql.includes('$1::text[]')&&sql.includes('$2::text reason,$3::timestamptz effect_transaction_started_at'));
    const placeholders=[...new Set([...sql.matchAll(/\$(\d+)/g)].map(match=>Number(match[1])))].sort();
    assert.deepEqual(placeholders,[1,2,3]);cases++;
   }
  }
  groups++;
 }
 if(want('frame')){
  const start=text.indexOf('function captureCommittedAuthorityFrame('),end=text.indexOf('\nasync function readCommittedAuthorityFrame',start);
  const capture=new Function('closed','isDeepStrictEqual','fail','witnessKeys','committedAuthorityTargets',text.slice(start,end)+'\nreturn captureCommittedAuthorityFrame;')(
   closed,isDeepStrictEqual,refuse,['database_oid','backend_pid','transaction_id','restore_id','authority_generation','archive_digest'],model.targets);
  const base={database_oid:'9',backend_pid:21,transaction_id:'13',snapshot:'13:20:',read_only:'on',isolation:'repeatable read',replication:'origin',
   row_security:'off',search_path:'pg_catalog, pg_temp',first_schema:'pg_catalog',actor:'supabase_admin',session_actor:'supabase_admin',
   control_owner:'supabase_admin',held_fences:2,control:'UNIT original control TEXT',manifest:'UNIT original manifest TEXT',completion,
   effect_transaction_started_at:'2026-10-17T00:00:00.123456+00:00',finite_effect_time:true};
  const parsed=capture(base,completion,21);assert.equal(parsed.effect_transaction_started_at,base.effect_transaction_started_at);assert.ok(Object.isFrozen(parsed));cases++;
  for(const patch of [{read_only:'off'},{isolation:'read committed'},{held_fences:1},{transaction_id:'12'},{transaction_id:'10'},
   {actor:'service_role'},{backend_pid:22},{database_oid:'10'},{search_path:'pg_catalog'},{first_schema:'pg_temp_1'},
   {effect_transaction_started_at:null},{effect_transaction_started_at:123},{finite_effect_time:false},
   {completion:{...completion,authority_generation:'2'}},{extra:true}]){assert.throws(()=>capture({...base,...patch},completion,21));cases++;}
  let read=0;assert.throws(()=>capture({...base,get effect_transaction_started_at(){read++;return base.effect_transaction_started_at;}},completion,21));
  assert.equal(read,0);cases++;groups++;
 }
 if(want('sequence')){
  const entry=text.slice(text.indexOf('export async function inspectCommittedImmutableFreshAuthorityData(options){'),text.indexOf('// Read-only DATA comparison, never a restore/COMMIT/admission capability.'));
  assert.ok(entry.includes("state.phase!=='COMMIT_ACKNOWLEDGED'")&&entry.includes("state.authorityPhase!=='COMMIT_ACKNOWLEDGED'"));cases++;
  assert.ok(entry.includes('!freshAuthorityAttempts.has(state)')&&entry.includes('readback.port!==state.originalNativePort'));cases++;
  assert.ok(entry.indexOf('originalObservation=await observe()')<entry.indexOf('descriptor.frame=await readCommittedAuthorityFrame'));cases++;
  assert.ok(entry.indexOf('committedAuthorityOrdinaryReads.add(descriptor)')<entry.indexOf('await compareVerifiedImmutableOrdinaryTableData'));
  assert.ok(entry.includes('committedAuthorityOrdinaryReads.delete(descriptor);committedAuthorityDataReads.delete(db)'));cases++;
  assert.ok(entry.includes('compareVerifiedImmutablePrivateTableData')&&entry.includes('compareVerifiedStorageTableData'));
  assert.ok(entry.includes("outcomes.includes('DIFFERENT')?'DIFFERENT'"));cases++;
  assert.ok(entry.includes('inventory_acknowledged:false,effects:false'));
  assert.doesNotMatch(entry,/Reflect\.apply\(query,db,\[\s*['"`](?:BEGIN|COMMIT|UPDATE|INSERT|DELETE|SET|GRANT)/i);cases++;groups++;
 }
 if(want('readonly')){
  const start=text.indexOf('function captureCommittedAuthorityReadOnly('),end=text.indexOf('\nfunction committedAuthoritySingleContext',start);
  const capture=new Function('closed','fail',text.slice(start,end)+'\nreturn captureCommittedAuthorityReadOnly;')(closed,refuse);
  const observed={database_oid:'9',backend_pid:21,transaction_id:'13',actor:'supabase_admin',session_actor:'supabase_admin',read_only:'on',
   isolation:'repeatable read',replication:'origin',row_security:'off',search_path:'pg_catalog, pg_temp',first_schema:'pg_catalog'};
  assert.equal(capture(observed,completion).transaction_id,'13');cases++;
  for(const patch of [{read_only:'off'},{transaction_id:'12'},{transaction_id:'10'},{actor:'service_role'},
   {isolation:'read committed'},{replication:'replica'},{search_path:'pg_catalog'}]){
   assert.throws(()=>capture({...observed,...patch},completion));cases++;
  }
  const entry=text.slice(text.indexOf('export async function inspectCommittedImmutableFreshAuthorityData(options){'),text.indexOf('// Read-only DATA comparison, never a restore/COMMIT/admission capability.'));
  assert.ok(entry.indexOf('captureCommittedAuthorityReadOnly')<entry.indexOf('await prepareVerifiedImmutableBootstrapSource'));
  assert.ok(entry.includes('before.transaction_id!==initial.transaction_id'));cases++;
  const sql=text.slice(text.indexOf('const committedAuthorityReadOnlySql='),text.indexOf('\nfunction captureCommittedAuthorityReadOnly'));
  assert.ok(!sql.includes('original_snapshot')&&!sql.includes('effect_transaction_started_at')&&!sql.includes('custodial_dr.'));cases++;groups++;
 }
 console.log(JSON.stringify({selector:'immutable-post-authority-data-only',part:part||'all-new',groups,cases,
  proof:'SOURCE_COMPONENT_PARSER_CRYPTOFREE_NATIVE_REFUSALS_ONLY',actual_SQL:'NOT_RUN',private_capability_created:false,
  full_restore:false,old_groups_replayed:0,resources0:true}));process.exit(0);
}

// One NEW changed Source-clock binding; no prior test group is invoked.
if(process.argv.includes('--authority-clock-snapshot-only')){
 const retained='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/auth-complete-original-release-row-v76';
 const archive=materializeVerifiedArchive({sourceDir:retained,archiveVerifyKey:'UNIT-only-auth-complete-original-HMAC-20261017',
  archiveVerifyKeyId:'unit-auth-complete-original-v1',supportedFormats:['memphis-zoo-disaster-recovery.v4']});
 try{
  const source=await prepareVerifiedImmutableBootstrapSource(archive);
  const statement=source.statements.find(row=>row.sourcePath==='proposals/immutable-original-authority-reconciliation.sql');
  assert.ok(statement);assert.equal(statement.sourceSha256,createHash('sha256').update(statement.sql).digest('hex'));
  assert.ok(statement.sql.includes("'effect_transaction_started_at',pg_catalog.transaction_timestamp()"));
  assert.ok(statement.sql.includes("jsonb_typeof(scope.original_snapshot->'effect_transaction_started_at') IS DISTINCT FROM 'string'"));
  assert.ok(statement.sql.includes("pg_catalog.isfinite((scope.original_snapshot->>'effect_transaction_started_at')::timestamptz) IS DISTINCT FROM true"));
  assert.ok(statement.sql.includes("'effect_transaction_started_at',scope.original_snapshot->'effect_transaction_started_at'"));
  assert.ok(statement.sql.includes('NEW.original_snapshot)'));
  assertVerifiedImmutableBootstrapSource(source,archive);
  console.log(JSON.stringify({scope:'NEW current pinned bootstrap Source retains native transaction time in immutable original snapshot',
   source_sha256:statement.sourceSha256,actual_SQL:'NOT_RUN',clock_or_timestamp_authority:false,whole_restore:false,old_groups_replayed:0}));
 }finally{await archive.cleanup();}
 process.exit(0);
}

// Only the changed manager-child/credential ordering. This executes the
// exact normal effect tail against recording ports; native admission,
// SQL ownership triggers and the whole restore remain separate proof.
if(process.argv.includes('--authority-dependent-order-only')){
 const sql=readFileSync(new URL('../proposals/immutable-original-authority-reconciliation.sql',import.meta.url),'utf8');
 const ordered=['public.device_auth_credentials','public.device_auth_enrollment_codes',
  'public.ops_manager_push_devices','public.ops_manager_enrollment_codes','public.ops_manager_trusted_devices','auth.sessions'];
 for(const prefix of ['expected_oid:=CASE OLD.completed_step+1','expected_oid:=CASE scope.completed_step+1','target_oid:=CASE step']){
  const start=sql.indexOf(prefix);assert.ok(start>0);const end=sql.indexOf('END;',start);assert.ok(end>start);
  assert.deepEqual([...sql.slice(start,end).matchAll(/THEN '([^']+)'::regclass/g)].map(match=>match[1]),ordered);
 }
 const state=readFileSync(new URL('./disaster-recovery-state.mjs',import.meta.url),'utf8');
 const start=state.indexOf('  const reason = `disaster_restore_generation_${originalGeneration}`;');
 const end=state.indexOf('\n}\n\nexport async function preserveCurrentReleaseIdentity',start);
 assert.ok(start>0&&end>start);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,calls=[];
 const execute=new AsyncFunction('query','updateRequiredAuthorityTarget','restoreAuthorityRows','originalGeneration',state.slice(start,end));
 const result=await execute(async sql=>{assert.equal(sql,'delete from auth.sessions');calls.push('auth.sessions');return {rowCount:1};},
  async(_query,operation)=>{calls.push('public.'+operation.table);return 1;},()=>[], '7');
 assert.deepEqual(calls,ordered);
 assert.deepEqual(result,{employee_credentials:1,employee_enrollment:1,manager_credentials:1,manager_enrollment:1,manager_push:1,auth_sessions:1});
 assert.ok(sql.includes("WHEN 3 THEN 'manager_push'"));assert.ok(sql.includes("WHEN 5 THEN 'manager_credentials'"));
 console.log(JSON.stringify({scope:'NEW fixed manager children before credential; three SQL arm maps plus exact normal JS effect-tail recording',
  checks:2,actual_SQL:'NOT_RUN',native_admission:'NOT_RUN',old_groups_replayed:0,whole_restore:false}));process.exit(0);
}

// Only the newly implemented fixed Source-owned row comparison. Recording
// ports below execute exact Source components, NOT native SQL acceptance.
if(process.argv.includes('--immutable-source-owned-table-readback-only')){
 const requested=process.argv.find(arg=>arg.startsWith('--immutable-source-owned-case='))?.split('=')[1];
 assert.ok(requested===undefined||['source','comparison','publication'].includes(requested));
 const want=value=>requested===undefined||requested===value;
 let cases=0,groups=0;
 if(want('source')){
  const retained='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/auth-complete-original-release-row-v76';
  const archive=materializeVerifiedArchive({sourceDir:retained,
   archiveVerifyKey:'UNIT-only-auth-complete-original-HMAC-20261017',archiveVerifyKeyId:'unit-auth-complete-original-v1',
   supportedFormats:['memphis-zoo-disaster-recovery.v4'],requiredEntries:['backup-summary.json','inventory/table-catalog.json']});
  let plan;
  try{
   plan=await prepareVerifiedImmutableBootstrapSource(archive);
   const expected=readVerifiedImmutableBootstrapSourceRows(plan,archive);
   assert.equal(expected.sourceBinding,readVerifiedArchiveSourceBinding(archive));assert.equal(expected.metadata_only,true);cases++;
   assert.deepEqual(expected.tables.map(row=>row.table_name),['release_deployment_manifest','custodial_release_authority_restore_inventory']);cases++;
   assert.ok(Object.isFrozen(expected)&&Object.isFrozen(expected.tables)&&expected.tables.every(Object.isFrozen));cases++;
   const [release,registry]=expected.tables;
   assert.equal(release.owner_name,'supabase_admin');assert.equal(registry.owner_name,'supabase_admin');cases++;
   assert.equal(release.originalRows,plan.releaseRows);assert.equal(registry.originalRows,plan.registryRows);
   assert.equal(release.originalRows.length,1);assert.equal(registry.originalRows.length,Number(JSON.parse(plan.inventory['inventory/table-catalog.json'])
    .find(row=>row.schema_name==='public'&&row.table_name===registry.table_name).row_count));cases++;
   assert.deepEqual(release.replacements,{});assert.equal(registry.replacements,plan.registrySource);
   assert.equal(Object.keys(registry.replacements).length,22);cases++;
   for(const [identity,change] of Object.entries(registry.replacements)){
    const original=registry.originalRows.map(JSON.parse).filter(row=>row.object_kind==='function'&&row.object_identity===identity);
    assert.equal(original.length,1);assert.notEqual(change.definition_sql,original[0].definition_sql);
    assert.equal(createHash('sha256').update(change.definition_sql).digest('hex'),change.definition_sha256);
    assert.deepEqual(Reflect.ownKeys(change),['definition_sql','definition_sha256']);
   }cases++;
   for(const [source,other] of [[{...plan},archive],[plan,{}],[new Proxy(plan,{}),archive]]){
    assert.throws(()=>readVerifiedImmutableBootstrapSourceRows(source,other));cases++;
   }
   assert.throws(()=>{release.originalRows[0]='caller replacement';},TypeError);cases++;
  }finally{await archive.cleanup();}
  assert.throws(()=>readVerifiedImmutableBootstrapSourceRows(plan,archive));cases++;groups++;
 }
 const text=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
 const method=text.slice(text.indexOf('export async function compareVerifiedImmutableOrdinaryTableData(options) {'));
 const start=method.indexOf('      if(isBootstrap){'),end=method.indexOf('\n      if(!supported){',start);
 assert.ok(start>0&&end>start);
 const branch=method.slice(start,end),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 if(want('comparison')){
  const bootstrapLine=method.slice(method.indexOf('  const bootstrap=new Set('),method.indexOf('\n',method.indexOf('  const bootstrap=new Set(')));
  const run=new AsyncFunction('selected','supported','actual','originalContext','rawRows','original','verifiedArchive','source',
   'boundary','prepareVerifiedImmutableBootstrapSource','readVerifiedImmutableBootstrapSourceRows','read','isDeepStrictEqual','refuse','decimal','closed',
   `let bootstrapSource;const summaries=[],sourceVerified='SOURCE_TRANSFORMATION_VERIFIED';${bootstrapLine}
    const originalRows=rawRows.slice();const summary=(table,state,original_rows,counts={current_rows:null,missing_rows:null,extra_rows:null})=>
     Object.freeze({schema_name:table.schema_name,table_name:table.table_name,state,original_rows,...counts});
    for(const table of selected){const count=originalRows.length,isBootstrap=bootstrap.has(\`\${table.schema_name}.\${table.table_name}\`);${branch}}return summaries;`);
  const {isDeepStrictEqual}=await import('node:util');
  const closed=new Function('types','isDeepStrictEqual','fail',text.slice(text.indexOf('function closed(value,keys) {'),text.indexOf('// Actual pg.Result has additional own fields/prototype;'))+'\nreturn closed;')(
   types,isDeepStrictEqual,()=>{throw Error('UNIT closed DATA refused');});
  const raw='{"inventory_id":"11111111-1111-4111-8111-111111111111","object_kind":"function","object_identity":"public.unit_function()","definition_sql":"ORIGINAL","definition_sha256":"original","metadata":{"large":9007199254740993,"fraction":0.123456789012345678901},"captured_at":"2026-10-17 00:00:00.123456+00"}';
  const journey=async(fault='',release=false)=>{
   const binding={},archive={},plan={},events=[];let live=true,queries=0;
   const table={schema_name:'public',table_name:release?'release_deployment_manifest':'custodial_release_authority_restore_inventory',row_count:'1'};
   const replacements=release?{}:{'public.unit_function()':{definition_sql:'REVIEWED',definition_sha256:'reviewed'}};
   const base={original_rows:'1',expected_rows:'1',current_rows:'1',missing_rows:'0',extra_rows:'0',transformed_rows:release?'0':'1'};
   const variants={extra:{current_rows:'2',extra_rows:'1'},changed:{missing_rows:'1',extra_rows:'1'},
    missing:{current_rows:'0',missing_rows:'1'},badCount:{expected_rows:'2'},badType:{transformed_rows:1},badTransform:{transformed_rows:'2'}};
   const descriptor={...table,owner_name:'supabase_admin',originalRows:[fault==='changed-source-row'?raw+' ':raw],replacements};
   const check=()=>{events.push('source');if(!live)throw Error('UNIT late Source unavailable');};
   const getter=(value,owner)=>{assert.equal(value,plan);assert.equal(owner,archive);events.push('getter');check();
    return {sourceBinding:fault==='foreign-source'?{}:binding,tables:[descriptor],metadata_only:true};};
   let summaries,error;
   try{summaries=await run([table],fault!=='unsupported',{owner_name:fault==='foreign-owner'?'foreign_owner':'supabase_admin'},
    {actor:'supabase_admin'},[raw],{sourceBinding:binding},archive,check,async()=>{events.push('boundary');check();},
    async value=>{assert.equal(value,archive);events.push('prepare');return plan;},getter,
    async(sql,params)=>{queries++;events.push('query');assert.equal(params[0][0],raw);assert.deepEqual(params[1],JSON.stringify(replacements));
     assert.match(sql,/pg_catalog\.json_populate_record\(null::"public"\."(?:release_deployment_manifest|custodial_release_authority_restore_inventory)",e\.expected_image\)/);
     assert.match(sql,/except all select row_data from current_rows/);assert.match(sql,/except all select row_data from expected_rows/);
     assert.match(sql,/from only "public"\./);assert.match(sql,/pg_catalog\.row_to_json\(t\)::text collate "C"/);
     assert.ok(sql.includes("image->>'object_kind'='function' and $2::jsonb ? (image->>'object_identity')"));
     assert.doesNotMatch(sql,/\b(?:insert|update|delete|truncate|commit|grant)\b/i);
     if(fault==='query-error')throw undefined;
     if(fault==='late-source')live=false;
     return [{...base,...(variants[fault]||{})}];},isDeepStrictEqual,
    ()=>{throw Error('UNIT fixed comparison refused');},value=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value),closed);
   }catch(value){error={value};}
   return {summaries,error,events,queries};
  };
  const release=await journey('',true);if(release.error)throw release.error.value;
  assert.equal(release.summaries[0].state,'MATCH');assert.equal(release.summaries[0].source_transformed_rows,'0');cases++;
  const transformed=await journey();assert.equal(transformed.summaries[0].state,'SOURCE_TRANSFORMATION_VERIFIED');
  assert.equal(transformed.summaries[0].metadata_only,true);assert.equal(transformed.queries,1);cases++;
  for(const fault of ['extra','changed','missing']){
   const result=await journey(fault);assert.equal(result.summaries[0].state,'DIFFERENT');assert.equal(result.queries,1);cases++;
  }
  const unsupported=await journey('unsupported');assert.equal(unsupported.summaries[0].state,'UNSUPPORTED');
  assert.equal(unsupported.queries,0);assert.equal(unsupported.events.includes('prepare'),false);cases++;
  for(const fault of ['badCount','badType','badTransform','changed-source-row','foreign-source','foreign-owner','query-error','late-source']){
   const result=await journey(fault);assert.ok(result.error,fault);assert.equal(result.summaries,undefined,fault);
   if(['changed-source-row','foreign-source','foreign-owner'].includes(fault))assert.equal(result.queries,0);cases++;
  }
  const failed=await journey('late-source');assert.ok(failed.events.indexOf('query')<failed.events.lastIndexOf('source'));
  assert.equal(failed.summaries,undefined);cases++;groups++;
 }
 if(want('publication')){
  const finish=method.slice(method.indexOf('    if(bootstrapSource){',end),method.indexOf('\n  } catch {',end));
  assert.ok(finish.includes('readVerifiedImmutableBootstrapSourceRows(bootstrapSource,verifiedArchive)'));
  const publish=new Function('bootstrapSource','verifiedArchive','readVerifiedImmutableBootstrapSourceRows','original','source','refuse','summaries','sourceVerified',
   'const statePlaceholder=true;'+finish);
  const binding={},archive={},plan={},source=()=>{},refuse=()=>{throw Error('UNIT publish refused');};
  const args=[plan,archive,()=>({sourceBinding:binding}),{sourceBinding:binding},source,refuse];
  for(const [states,wanted] of [[['MATCH','SOURCE_TRANSFORMATION_VERIFIED'],'SOURCE_TRANSFORMATION_VERIFIED'],[['MATCH','MATCH'],'MATCH'],
   [['SOURCE_TRANSFORMATION_VERIFIED','DIFFERENT'],'DIFFERENT'],[['SOURCE_TRANSFORMATION_VERIFIED','UNSUPPORTED'],'UNSUPPORTED']]){
   const actual=publish(...args,states.map(state=>({state})),'SOURCE_TRANSFORMATION_VERIFIED');assert.equal(actual.state,wanted);cases++;
  }
  assert.throws(()=>publish(plan,archive,()=>{throw Error('UNIT withdrawn');},{sourceBinding:binding},source,refuse,
   [{state:'SOURCE_TRANSFORMATION_VERIFIED'}],'SOURCE_TRANSFORMATION_VERIFIED'));cases++;
  assert.throws(()=>publish(plan,archive,()=>({sourceBinding:{}}),{sourceBinding:binding},source,refuse,
   [{state:'SOURCE_TRANSFORMATION_VERIFIED'}],'SOURCE_TRANSFORMATION_VERIFIED'));cases++;groups++;
 }
 console.log(JSON.stringify({selector:'immutable-source-owned-table-readback',groups,cases,
  scope:'BRANDED_SOURCE_METADATA_AND_EXACT_RECORDING_COMPONENTS_ONLY',SQL:'NOT_RUN',native_comparison:'NOT_RUN',old_groups:0,resources0:true}));process.exit(0);
}

// Exact reviewed authority Source-version join only. No archive replay,
// installer, SQL/native client, signature or historical group is run.
if(process.argv.includes('--immutable-authority-push-source-pin-only')){
 const url=new URL('./immutable-private-source-bootstrap.mjs',import.meta.url);
 const text=readFileSync(url,'utf8'),sha=value=>createHash('sha256').update(value).digest('hex');
 const pinStart=text.indexOf('const authoritySourcePins=Object.freeze(['),pinEnd=text.indexOf('\nconst guardIds=',pinStart);
 const loaderStart=text.indexOf('function readAuthoritySources(){'),loaderEnd=text.indexOf('\nfunction baseRecipes(',loaderStart);
 assert.ok(pinStart>=0&&pinEnd>pinStart&&loaderStart>pinEnd&&loaderEnd>loaderStart);
 // Existing Source-component facility: use the exact private loader body and
 // real filesystem APIs. Only module URL syntax is bound for Function scope.
 const loader=text.slice(loaderStart,loaderEnd);
 const build=pins=>new Function('assert','sha','fileURLToPath','openSync','closeSync','fstatSync','readFileSync','constants','moduleUrl',
  pins+'\n'+loader.replaceAll('import.meta.url','moduleUrl')+'\nreturn {pins:authoritySourcePins,read:readAuthoritySources};')(
   assert,sha,fileURLToPath,openSync,closeSync,fstatSync,readFileSync,constants,url.href);
 const pinned=text.slice(pinStart,pinEnd),actual=build(pinned);
 // Against the predecessor this exact loader reproduces v94's mismatch
 // before any acceptance assertion or database/archive operation.
 const loaded=actual.read();
 let cases=1;
 const reviewed='b1a4542d43722c2b6e4f833d64bcf7904f781022e5f78a98137a5358fd88065f';
 const predecessor='0d4f9454ff27728a5afa1a32d8641b496c23a6f717a467730c6f8a9a7566e20b';
 assert.equal(actual.pins.length,2);assert.ok(Object.isFrozen(actual.pins)&&actual.pins.every(Object.isFrozen));cases++;
 assert.deepEqual(actual.pins,[{sourcePath:'proposals/immutable-original-authority-reconciliation.sql',sourceSha256:reviewed},
  {sourcePath:'proposals/immutable-original-authority-target-shape.sql',sourceSha256:'265185d8860131d5472db2a70f036332758b4b2f577b48582980f36ff7eacc3e'}]);cases++;
 assert.deepEqual(loaded.map(row=>row.sourcePath),actual.pins.map(row=>row.sourcePath));cases++;
 const bytes=readFileSync(new URL('../proposals/immutable-original-authority-reconciliation.sql',import.meta.url));
 assert.equal(sha(bytes),reviewed);assert.equal(loaded[0].sourceSha256,reviewed);
 assert.equal(loaded[0].sql,bytes.toString('utf8'));assert.equal(loaded[0].identity.length,6);cases++;
 // Old fixed pin must still REFUSE these new bytes; not an alternate/fallback.
 assert.equal(pinned.split(reviewed).length,2);
 assert.throws(()=>build(pinned.replace(reviewed,predecessor)).read(),error=>error.actual===reviewed&&error.expected===predecessor);cases++;
 const guard='assert.equal(sha(bytes),pin.sourceSha256);';assert.equal(loader.split(guard).length,2);
 const check=new Function('assert','sha','bytes','pin',guard);
 check(assert,sha,bytes,actual.pins[0]);cases++;
 const different=Buffer.from(bytes);different[0]^=1;
 for(const changed of [different,Buffer.concat([bytes,Buffer.from('\n')]),Buffer.concat([Buffer.from(' '),bytes]),
  Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes]),Buffer.alloc(0),
  readFileSync(new URL('../proposals/immutable-original-authority-target-shape.sql',import.meta.url))]){
  assert.throws(()=>check(assert,sha,changed,actual.pins[0]));cases++;
 }
 assert.ok(text.includes('authority=readAuthoritySources();'));
 assert.ok(text.includes('assert.deepEqual(readAuthoritySources().map(row=>row.identity),record.authorityIdentities);'));cases++;
 console.log(JSON.stringify({scope:'NEW reviewed push SQL exact-digest bootstrap Source join',cases,
  actual_filesystem_loader:'EXECUTED',public_archive_preparer:'NOT_RUN',SQL:'NOT_RUN',old_groups:0,resources0:true}));process.exit(0);
}

// NEW repeated enum Source consumption and lifetime. The actual materializer
// makes Source members read-only: mutation/ABA could not execute (EACCES).
// Do not change those modes or call that refusal an executed ABA challenge.
if(process.argv.includes('--immutable-bootstrap-inventory-cache-only')){
 const {readVerifiedImmutableBootstrapInventory}=await import('./disaster-recovery-archive.mjs');
 const sourceDir=fileURLToPath(new URL('../../../restore-runtime-authorized-KM9tAR/auth-complete-original-release-row-v76',import.meta.url));
 const archive=materializeVerifiedArchive({sourceDir,
  archiveVerifyKey:'UNIT-only-auth-complete-original-HMAC-20261017',archiveVerifyKeyId:'unit-auth-complete-original-v1',
  supportedFormats:['memphis-zoo-disaster-recovery.v4'],requiredEntries:['backup-summary.json','inventory/table-catalog.json']});
 let cases=0;
 try{
  const first=readVerifiedImmutableBootstrapInventory(archive),second=readVerifiedImmutableBootstrapInventory(archive);
  assert.equal(second,first);assert.ok(Object.isFrozen(first)&&Object.isFrozen(first.inventory));cases++;
  const path=join(archive.directory,'inventory/application-schema.sql');
  assert.equal(lstatSync(path).mode&0o222,0);cases++;
 }finally{await archive.cleanup();}
 assert.throws(()=>readVerifiedImmutableBootstrapInventory(archive));cases++;
 console.log(JSON.stringify({scope:'NEW immutable schema-byte cache/read-only Source/lifetime refusal',cases,
  mutation_ABA:'NOT_RUN_EACCES_PRESERVED_NO_MODE_CHANGE',SQL:'NOT_RUN',target_authority:false,old_groups:0,resources:0}));process.exit(0);
}

// NEW private authority factory refusal boundary only. A copied public
// preparation/stage/status cannot create original private module ancestry.
if(process.argv.includes('--immutable-fresh-authority-factory-refusals-only')){
 const {reconcileCommittedImmutableFreshAuthority,commitVerifiedImmutableFreshAuthority}=await import('./immutable-private-data-import.mjs');
 let traps=0,cases=0;
 const proxy=new Proxy({}, {get(){traps++;throw Error('not native');},getPrototypeOf(){traps++;throw Error('not native');},ownKeys(){traps++;throw Error('not native');}});
 const archive={},db={phase:'COMMIT_ACKNOWLEDGED',originalDataReadback:{},authorityPhase:'STAGED_CONSUMED'};
 const inputs=[{db,verifiedArchive:archive},{db:proxy,verifiedArchive:archive},{db:{},verifiedArchive:archive},
  {db:null,verifiedArchive:archive},{db,verifiedArchive:proxy},
  {db,verifiedArchive:archive,prepared:{effect_allowed:true}},{db,verifiedArchive:archive,completion:{}},
  Object.defineProperty({verifiedArchive:archive},'db',{enumerable:true,get(){traps++;return db;}}),proxy];
 for(const call of [reconcileCommittedImmutableFreshAuthority,commitVerifiedImmutableFreshAuthority])for(const input of inputs){
  await assert.rejects(call(input));cases++;
 }
 assert.equal(traps,0);
 console.log(JSON.stringify({scope:'NEW private authority factory rejects copied/missing ancestry',cases,traps,
  actual_SQL:'NOT_RUN',connected_native_positive:'NOT_RUN',old_groups:0,resources:0}));process.exit(0);
}

// NEW native-metadata-shaped owner correction only. Saved READ ONLY metadata
// is evidence for this Source case, never target/effect admission or SQL here.
if(process.argv.includes('--immutable-auth-enum-native-owner-only')){
 const nativeBytes=readFileSync('/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/auth-enum-native-diagnostic-v83-pvNyy7/AUTH_ENUM_IO_NATIVE_DIAGNOSTIC.json');
 assert.equal(createHash('sha256').update(nativeBytes).digest('hex'),'0dcb1f0f35ee22c69d867d16ea74628bcd4d0a3a467fe17b77420db4cbda3ade');
 const metadata=JSON.parse(nativeBytes),native=metadata.io;
 assert.equal(metadata.actual_read_only,true);assert.equal(metadata.original_restore,false);
 assert.equal(metadata.application_schema_replayed,0);assert.equal(metadata.DATA_imports,0);assert.equal(metadata.effects,0);
 const moduleSource=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
 const text=moduleSource.slice(moduleSource.indexOf('export async function compareVerifiedImmutableOrdinaryTableData(options) {'));
 const old="and ti.proowner='postgres'::pg_catalog.regrole and tout.proowner=ti.proowner";
 const next="and ti.proowner='supabase_admin'::pg_catalog.regrole and ti.proowner=en.nspowner and tout.proowner=ti.proowner";
 assert.equal(text.split(next).length,2);
 // Frozen owning-function fingerprint, not an isolated before-file dependency
 // or a whole-module pin invalidated by Main's disjoint private factory work.
 const before=text.replace(next,old);
 assert.equal(createHash('sha256').update(before).digest('hex'),'d278d063257f932bad99b92ba0142957fb25d96110744ce88b173aae6bce59a4');
 assert.equal(before.split(old).length,2);assert.equal(text,before.replace(old,next));
 const ownerClause=source=>source.match(/and ti\.proowner='([a-z_]+)'::pg_catalog\.regrole and (?:ti\.proowner=en\.nspowner and )?tout\.proowner=ti\.proowner/)[1];
 const oldOwner=ownerClause(before),newOwner=ownerClause(text);
 let cases=0,coercions=0;
 assert.equal(oldOwner,'postgres');assert.equal(newOwner,'supabase_admin');cases++;
 assert.deepEqual(native.map(row=>row.identity),['array_in(cstring,oid,integer)','array_out(anyarray)','enum_in(cstring,oid)','enum_out(anyenum)']);cases++;
 for(const io of native){
  // Demonstrate the OLD literal comparison refusing the ACTUAL saved native
  // routine owner; this is not a fresh SQL execution or a fabricated catalog.
  assert.equal(io.owner===oldOwner,false);cases++;
  assert.equal(io.nspname,'pg_catalog');assert.equal(io.lanname,'internal');
  assert.equal(io.prokind,'f');assert.equal(io.prosecdef,false);assert.equal(io.proretset,false);
  assert.equal(io.proconfig,null);assert.equal(io.probin,null);
  assert.equal(io.prosrc,io.identity.slice(0,io.identity.indexOf('(')));
  assert.equal(io.return_type,io.prosrc.endsWith('_in')?(io.prosrc.startsWith('array')?'anyarray':'anyenum'):'cstring');cases++;
 }
 const schema=readFileSync('/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/auth-complete-unit-archive-v74-8818r8/new-auth-complete-original/inventory/application-schema.sql','utf8');
 assert.equal(createHash('sha256').update(schema).digest('hex'),'a1365e8e72917436b0e2a79f81cb5c496562056b63c091be043ce667c594fdf8');
 const {deriveOriginalAuthEnumDescriptors}=await import('./immutable-original-enum-source.mjs');
 const original=deriveOriginalAuthEnumDescriptors(schema);
 assert.equal(original.length,9);assert.equal(metadata.enums.length,9);
 // Exact owner relation modeled as immutable names for this pure Source
 // check. SQL compares real OIDs to en.nspowner, then existing Source-owned
 // d.namespace_owner; a caller/observed owner is never an expected fallback.
 const ownerMatches=(routineOwner,currentNamespaceOwner,originalNamespaceOwner)=>routineOwner===newOwner
  &&routineOwner===currentNamespaceOwner&&currentNamespaceOwner===originalNamespaceOwner;
 for(const type of metadata.enums){
  const descriptor=original.find(entry=>entry.type_name===type.typname);assert.ok(descriptor);
  assert.equal(type.nspname,descriptor.schema_name);assert.equal(type.owner,descriptor.owner_name);
  assert.equal(type.namespace_owner,descriptor.namespace_owner);assert.deepEqual(type.labels,descriptor.labels);
  for(const io of native)assert.equal(ownerMatches(io.owner,type.namespace_owner,descriptor.namespace_owner),true);
  cases++;
 }
 const badOwner={toString(){coercions++;throw Error('No owner coercion');}};
 for(const owner of ['postgres','supabase_auth_admin','authenticated','service_role','unverified_platform_admin','',
  ' supabase_admin','supabase_admin\n',null,0,new String('supabase_admin'),badOwner]){
  assert.equal(ownerMatches(owner,'supabase_admin','supabase_admin'),false);cases++;
 }
 assert.equal(ownerMatches('supabase_admin','postgres','supabase_admin'),false);cases++;
 assert.equal(ownerMatches('supabase_admin','supabase_admin','postgres'),false);cases++;
 assert.equal(ownerMatches('postgres','postgres','postgres'),false);cases++;
 assert.equal(coercions,0);
 // Exact one-line equality above preserves every signature, internal source,
 // scalar/array/label/column, native context/EOF/multiset and owner equality.
 for(const needle of ['and ei.proowner=ti.proowner and eo.proowner=ti.proowner',
  'oid=en.nspowner)=d.namespace_owner','oid=e.typowner)=d.owner_name',
  'd.labels=(select pg_catalog.jsonb_agg(label.enumlabel order by label.enumsortorder)',
  'b.data_type=pg_catalog.format_type(a.atttypid,a.atttypmod)']){assert.ok(text.includes(needle));cases++;}
 console.log(JSON.stringify({scope:'NEW supported cached-platform enum native owner correction only',cases,coercions,
  saved_native_IO_routines:native.length,original_enum_namespace_bindings:original.length,
  predecessor_owner_comparison:'REFUSES_ACTUAL_NATIVE_SUPABASE_ADMIN',product_delta:'ONE_LINE_WITH_SOURCE_NAMESPACE_OID_BINDING',
  SQL:'NOT_RUN',DATA:'NOT_RUN',old_99_replayed:false,resources0:true}));process.exit(0);
}

// Incremental Source-only refusal-scope check; no SQL/native admission.
if(process.argv.includes('--immutable-auth-enum-failure-scope-only')){
 const text=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
 const method=text.slice(text.indexOf('export async function compareVerifiedImmutableOrdinaryTableData(options)'));
 const start=method.indexOf('native();const original='),end=method.indexOf('    const source=()=>{',start);
 assert.ok(start>0&&end>start);
 const prefix=new Function('readVerifiedPrivateImportSource','readVerifiedImmutableBootstrapInventory','deriveOriginalAuthEnumDescriptors',
  'dense','native','verifiedArchive','refuse','let selected=[];try{'+method.slice(start,end)+'}catch{}return selected;');
 const binding=Object.freeze({}),tables=Object.freeze([{schema_name:'auth',table_name:'sessions',row_count:'1'},
  {schema_name:'public',table_name:'unit_original',row_count:'0'},{schema_name:'storage',table_name:'unit_outside',row_count:'0'}]);
 const original=()=>({sourceBinding:binding,selection:{databaseTables:tables}});
 const fail=()=>{throw Error('UNIT fixed dependency unavailable');};
 const deps={sourceBinding:binding,inventory:{'inventory/application-schema.sql':'UNIT invalid declaration'}};
 for(const [read,parse] of [[fail,fail],[()=>deps,fail],[()=>({...deps,sourceBinding:{}}),fail]]){
  const retained=prefix(original,read,parse,value=>value,()=>{},Object.freeze({}),fail);
  assert.deepEqual(retained,tables.slice(0,2));assert.notEqual(retained,tables);
 }
 console.log(JSON.stringify({scope:'NEW incremental enum prerequisite refusal retains declared members',cases:3,
  SQL:'NOT_RUN',old_groups:0,prior_96_replayed:false,resources0:true}));process.exit(0);
}

// NEW enum descriptor/query-binding Source cases only; no native pg facade,
// SQL acceptance or archive/restore authority is fabricated.
if(process.argv.includes('--immutable-auth-enum-source-join-only')){
 const {deriveOriginalAuthEnumDescriptors:parse}=await import('./immutable-original-enum-source.mjs');
 const {splitSchemaStatements}=await import('./isolated-event-owner-schema.mjs');
 const captured='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/auth-complete-unit-archive-v74-8818r8/new-auth-complete-original/inventory/';
 const schema=readFileSync(captured+'application-schema.sql','utf8');
 assert.equal(createHash('sha256').update(schema).digest('hex'),'a1365e8e72917436b0e2a79f81cb5c496562056b63c091be043ce667c594fdf8');
 const tableBytes=readFileSync(captured+'table-catalog.json');
 assert.equal(createHash('sha256').update(tableBytes).digest('hex'),'41441e204deba6434288cc947a2e7ab1a8a4334d320c245bdb5a717d2c65488e');
 const selected=JSON.parse(tableBytes),descriptors=parse(schema);
 const expected={aal_level:['aal1','aal2','aal3'],code_challenge_method:['s256','plain'],factor_status:['unverified','verified'],
  factor_type:['totp','webauthn','phone','recovery_code'],oauth_authorization_status:['pending','approved','denied','expired'],
  oauth_client_type:['public','confidential'],oauth_registration_type:['dynamic','manual'],oauth_response_type:['code'],
  one_time_token_type:['confirmation_token','reauthentication_token','recovery_token','email_change_token_new','email_change_token_current','phone_change_token']};
 let groups=0,cases=0,traps=0;
 assert.deepEqual(descriptors,Object.entries(expected).map(([type_name,labels])=>({kind:'e',schema_name:'auth',type_name,
  namespace_owner:'supabase_admin',owner_name:'supabase_auth_admin',labels})));cases++;
 assert.ok(Object.isFrozen(descriptors)&&descriptors.every(d=>Object.isFrozen(d)&&Object.isFrozen(d.labels)));cases++;groups++;
 const head="SET standard_conforming_strings = on;\nCREATE SCHEMA auth;\nALTER SCHEMA auth OWNER TO supabase_admin;\n";
 const body="CREATE TYPE auth.unit_mood AS ENUM ('happy', 'sad');\nALTER TYPE auth.unit_mood OWNER TO supabase_auth_admin;\n";
 const unit=head+body,unsupported=error=>error.code==='IMMUTABLE_ORIGINAL_ENUM_SOURCE_UNSUPPORTED';
 const reject=value=>{assert.throws(()=>parse(value),unsupported);cases++;};
 // Explicit public UNIT variations, never re-signed archives or target rows.
 const variations=[unit+body,unit+"ALTER TYPE auth.unit_mood OWNER TO supabase_auth_admin;",unit.replace('OWNER TO supabase_auth_admin','OWNER TO authenticated'),
  unit.replace('OWNER TO supabase_admin','OWNER TO service_role'),unit.replace('CREATE SCHEMA auth;',''),unit.replace('ALTER SCHEMA auth OWNER TO supabase_admin;',''),
  unit.replace("AS ENUM ('happy', 'sad')",'AS (field text)'),unit.replace("AS ENUM ('happy', 'sad')","(INPUT=public.unit_in,OUTPUT=public.unit_out)"),
  unit.replace('CREATE TYPE','CREATE DOMAIN'),unit.replace("'happy', 'sad'","'happy', 'happy'"),unit.replace("'happy', 'sad'",''),
  unit.replace("'happy', 'sad'","E'happy', 'sad'"),unit.replace("'happy', 'sad'","$$happy$$, 'sad'"),unit.replace("'happy', 'sad'","U&'happy', 'sad'"),
  unit.replace("'happy', 'sad'","'"+'x'.repeat(64)+"', 'sad'"),unit.replace("'happy', 'sad'","'nul\0label', 'sad'"),
  unit.replace('standard_conforming_strings = on','standard_conforming_strings = off'),unit.replace('SET standard_conforming_strings = on;',''),
  unit.replace('SET standard_conforming_strings = on;','SET "standard_conforming_strings" = off;'),unit+'SET LOCAL standard_conforming_strings=off;',
  unit+'RESET standard_conforming_strings;',unit+'RESET ALL;',unit+"SELECT pg_catalog.set_config('standard_conforming_strings','off',false);",
  unit+'DO $$BEGIN NULL; END$$;',unit+'CALL public.unit_callback();',unit+'CREATE CAST (auth.unit_mood AS json) WITH FUNCTION public.unit_json(auth.unit_mood);',
  unit+"ALTER TYPE auth.unit_mood ADD VALUE 'other';",unit+"ALTER TYPE auth.unit_mood RENAME VALUE 'happy' TO 'other';",
  unit+'DROP TYPE auth.unit_mood;',unit+'DROP SCHEMA auth CASCADE;',unit+'ALTER SCHEMA auth RENAME TO other;',
  unit+'ALTER SCHEMA auth OWNER TO supabase_admin;',unit+'CREATE SCHEMA IF NOT EXISTS auth;',
  unit.replace('ALTER TYPE auth.unit_mood OWNER TO supabase_auth_admin;',''),unit.replace('unit_mood','"unit_mood\n"'),
  unit+'/* unterminated',unit+"SELECT 'unterminated",unit+'\\! forbidden\n',unit+"SET client_encoding='LATIN1';"];
 for(const sql of variations)reject(sql);
 for(const value of [null,{},new String(unit),new Proxy({}, {get(){traps++;throw Error('No coercion');}}),42])reject(value);
 assert.equal(traps,0);groups++;
 const labels=parse(unit.replace("'happy', 'sad'","'comma,semi;quote''literal', 'é🚀', 'back\\slash', ''"))[0].labels;
 assert.deepEqual(labels,["comma,semi;quote'literal",'é🚀','back\\slash','']);cases++;
 const withDecoys=head+"-- CREATE TYPE auth.fake AS ENUM ('no');\nCREATE FUNCTION public.unit_decoy() RETURNS text LANGUAGE sql AS $$ SELECT 'CREATE TYPE auth.fake AS ENUM'; $$;\n"+body;
 assert.deepEqual(parse(withDecoys),parse(unit));cases++;
 assert.deepEqual(parse("SET standard_conforming_strings=on; SELECT pg_catalog.set_config('search_path','',false);"),[]);cases++;groups++;
 const importer=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
 const marker='export async function compareVerifiedImmutableOrdinaryTableData(options) {';
 const region=importer.slice(importer.indexOf(marker));
 const a=region.indexOf('const enumColumns=[];'),b=region.indexOf('    let originalContext;',a);
 assert.ok(a>0&&b>a);
 // Run ONLY the exact synchronous derived-column binding block with detached
 // Source DATA; no production function is called with an injected SQL port.
 const bind=new Function('selected','originalEnums','refuse',region.slice(a,b)+'\nreturn {enumColumns,enumParameters};');
 const refuse=()=>{throw Error('UNIT Source binding refused');};
 const bound=bind(selected,descriptors,refuse);
 assert.equal(bound.enumColumns.length,10);assert.deepEqual(JSON.parse(bound.enumParameters[0]),descriptors);cases++;
 assert.deepEqual(bound.enumColumns.map(c=>c.schema_name+'.'+c.table_name),['auth.flow_state','auth.mfa_factors','auth.mfa_factors',
  'auth.oauth_authorizations','auth.oauth_authorizations','auth.oauth_authorizations','auth.oauth_clients','auth.oauth_clients','auth.one_time_tokens','auth.sessions']);cases++;
 const array=bind([{schema_name:'auth',table_name:'unit_array',columns:[{name:'value',data_type:'auth.aal_level[]'}]}],descriptors,refuse);
 assert.equal(array.enumColumns[0].is_array,true);assert.equal(JSON.parse(array.enumParameters[1])[0].data_type,'auth.aal_level[]');cases++;
 assert.throws(()=>bind([{schema_name:'auth',table_name:'unit_missing',columns:[{name:'value',data_type:'auth.not_original'}]}],descriptors,refuse));cases++;
 assert.throws(()=>bind(selected,descriptors.filter(d=>d.type_name!=='aal_level'),refuse));cases++;groups++;
 const sourceA=region.indexOf('const source=()=>{'),sourceB=region.indexOf('    const nativeRead=',sourceA);
 const sourceFactory=new Function('native','sameSource','verifiedArchive','original','readVerifiedImmutableBootstrapInventory','enumSchema','refuse',
  region.slice(sourceA,sourceB)+'\nreturn source;');
 const archive=Object.freeze({}),binding=Object.freeze({});let reads=0;
 let inventory={sourceBinding:binding,inventory:{'inventory/application-schema.sql':unit}};
 const live=sourceFactory(()=>{},()=>{},archive,{sourceBinding:binding},()=>{reads++;return inventory;},unit,refuse);
 live();assert.equal(reads,1);cases++;
 for(const bad of [{sourceBinding:{},inventory:inventory.inventory},{sourceBinding:binding,inventory:{'inventory/application-schema.sql':unit+'\n'}},
  {sourceBinding:binding,inventory:{}}]){inventory=bad;assert.throws(live);cases++;}
 const withdrawn=sourceFactory(()=>{},()=>{},archive,{sourceBinding:binding},()=>{throw Error('UNIT Source withdrawn');},unit,refuse);
 assert.throws(withdrawn,/Source withdrawn/);cases++;groups++;
 const qA=region.indexOf('const catalogSql=`')+'const catalogSql=`'.length,qB=region.indexOf('`;',qA),sql=region.slice(qA,qB);
 assert.equal(splitSchemaStatements(sql+';').statements.length,1);cases++;
 let depth=0;for(const token of splitSchemaStatements(sql+';').statements[0].tokens){if(token.kind==='symbol'&&token.value==='(')depth++;
  if(token.kind==='symbol'&&token.value===')')depth--;assert.ok(depth>=0);}assert.equal(depth,0);cases++;
 for(const needle of ["e.typtype='e'","e.typbasetype=0","tn.oid=en.oid","t.typowner=e.typowner","d.kind='e'",'d.schema_name=en.nspname',
  'd.type_name=e.typname','oid=en.nspowner)=d.namespace_owner','oid=e.typowner)=d.owner_name','order by label.enumsortorder',
  'b.column_name=a.attname','b.type_name=d.type_name','b.is_array=(t.oid<>e.oid)','b.data_type=pg_catalog.format_type(a.atttypid,a.atttypmod)',
  "pg_catalog.enum_in(pg_catalog.cstring,pg_catalog.oid)","pg_catalog.enum_out(pg_catalog.anyenum)","ei.prosrc='enum_in'","eo.prosrc='enum_out'",
  "lanname='internal'","ei.proowner=ti.proowner","ti.proowner='postgres'::pg_catalog.regrole",'ei.proconfig is null','ei.probin is null',
  "pg_catalog.array_in(pg_catalog.cstring,pg_catalog.oid,pg_catalog.int4)","pg_catalog.array_out(pg_catalog.anyarray)",'e.typarray=t.oid',
  'cast_row.castsource in(t.oid,e.oid) or cast_row.casttarget in(t.oid,e.oid)','$1::jsonb','$2::jsonb']){assert.ok(sql.includes(needle),needle);cases++;}
 assert.equal((region.match(/read\(catalogSql,enumParameters\)/g)||[]).length,2);cases++;
 assert.ok(region.indexOf('deriveOriginalAuthEnumDescriptors(enumSchema)')<region.indexOf('const catalog=await read(catalogSql,enumParameters)'));cases++;
 assert.ok(region.includes("readVerifiedImmutableBootstrapInventory(verifiedArchive)"));cases++;
 const before=readFileSync(new URL('../../before/immutable-private-data-import.mjs',import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(before).digest('hex'),'7cfd3df888e894f0b6c14cfca9e525354774cdb41191bc7aab544a750fbc5e53');
 const old=before.slice(before.indexOf(marker));
 const builtin=s=>s.slice(s.indexOf("tn.nspname='pg_catalog'"),s.indexOf("and am.amname='btree'))))")+"and am.amname='btree'))))".length);
 assert.equal(builtin(region),builtin(old));cases++;
 const rowsOnly=s=>s.slice(s.indexOf('    let encodedBytes=0,rawBytes=0;'),s.indexOf('    const finalCatalog='));
 assert.equal(rowsOnly(region),rowsOnly(old));cases++;
 const removeImports=s=>s.replace(/import \{deriveOriginalAuthEnumDescriptors\} from '.\/immutable-original-enum-source.mjs';\n/,'')
  .replace(',readVerifiedImmutableBootstrapInventory','');
 assert.equal(removeImports(importer.slice(0,importer.indexOf(marker))),before.slice(0,before.indexOf(marker)));cases++;groups++;
 console.log(JSON.stringify({scope:'NEW original enum parser and comparator Source binding only',groups,cases,traps,
  captured_enum_types:descriptors.length,declared_enum_columns:bound.enumColumns.length,
  builtin_range_xid8_and_row_boundaries:'BYTE_PRESERVED',enum_SQL_acceptance:'NOT_RUN',SQL:'NOT_RUN',old_groups:0,resources0:true}));process.exit(0);
}

// NEW status-adapter parser and refusal cases only. No connected native
// admission is fabricated, no query/prototype is monkeypatched, no SQL runs.
if(process.argv.includes('--immutable-fresh-authority-status-caller-only')){
 const text=readFileSync(new URL('./immutable-private-fresh-restore-recovery.mjs',import.meta.url),'utf8');
 const slice=(first,last)=>{const a=text.indexOf(first),b=text.indexOf(last,a+first.length);assert.ok(a>=0&&b>a);return text.slice(a,b);};
 const legacy=slice('const requestKeys =','// An original-status observation');
 const pure=slice('const authorityRequestKeys =','function authorityPrototypeSnapshot');
 const rows=slice('function authoritySingleRow(', '// The request is lookup DATA.');
 const components=new Function('isProxy',legacy+pure+rows+
  '\nreturn {captureAuthorityRequest,captureAuthorityStatus,captureStatus,authoritySingleRow,authorityDecimal,authorityUnavailable};')(types.isProxy);
 const request=()=>({restoreId:'11111111-1111-4111-8111-111111111111',generation:'1',archiveDigest:'a'.repeat(64),
  targetProjectRef:'abcdefghijklmnopqrst',databaseOid:'16384',effectBackendPid:4321,effectTransactionId:'900',originalTransactionId:'899'});
 const scope=(r=request())=>({state:'OBSERVED_COMMITTED_CONSUMED',database_oid:r.databaseOid,effect_backend_pid:r.effectBackendPid,
  effect_transaction_id:r.effectTransactionId,original_transaction_id:r.originalTransactionId,restore_id:r.restoreId,
  authority_generation:r.generation,archive_digest:r.archiveDigest,revocations:{employee_credentials:'0',employee_enrollment:'1',
   manager_credentials:'2',manager_enrollment:'3',manager_push:'4',auth_sessions:'9223372036854775807'}});
 const status=(r=request(),state='COMPLETE')=>({schema:'memphis-zoo-restore-original-status.v1',restore_id:r.restoreId,
  authority_generation:r.generation,archive_digest:r.archiveDigest,target_project_ref:r.targetProjectRef,state,mutations_paused:false,
  database_marker_status:'OBSERVED_DATABASE_MARKERS',database_verified:true,prior_unknown_recorded:false,
  metadata_only:true,retry_allowed:false,resume_allowed:false,rerun_import_allowed:false,complete_restore:false});
 let groups=0,cases=0,traps=0;
 const invalid=error=>error?.code==='IMMUTABLE_FRESH_AUTHORITY_COMMIT_RECOVERY_INVALID';
 // Actual exact parser functions; positive DATA parsing is not SQL provenance.
 const r=components.captureAuthorityRequest(request()),s=scope(r),parsed=components.captureAuthorityStatus(s,r);
 assert.deepEqual(r,request());assert.ok(Object.isFrozen(r)&&Object.isFrozen(parsed)&&Object.isFrozen(parsed.revocations));
 assert.notEqual(parsed,s);assert.notEqual(parsed.revocations,s.revocations);s.revocations.auth_sessions='1';
 assert.equal(parsed.revocations.auth_sessions,'9223372036854775807');cases++;
 for(const state of ['DATABASE_RESTORED','STORAGE_RESTORING','VERIFYING','PAUSED_RECONCILIATION','COMPLETE']){
  assert.equal(components.captureStatus(status(r,state),r).state,state);cases++;
 }
 for(const [key,values] of [
  ['databaseOid',[16384,'0','01','+1',' 1','1\n','4294967296',new String('16384')]],
  ['effectBackendPid',['4321',0,-1,1.1,2147483648,NaN,Infinity]],
  ['effectTransactionId',[900,0n,'0','0900','+900','900\n','9223372036854775808',new String('900')]],
  ['originalTransactionId',['900','0','0899','1e3','899\n']],
 ])for(const value of values){assert.throws(()=>components.captureAuthorityRequest({...request(),[key]:value}),invalid);cases++;}
 const proxy=new Proxy({}, {get(){traps++;throw Error('No proxy');},getPrototypeOf(){traps++;throw Error('No proxy');},ownKeys(){traps++;throw Error('No proxy');}});
 const getter=Object.defineProperty(request(),'databaseOid',{enumerable:true,get(){traps++;return '16384';}});
 for(const value of [proxy,getter,{...request(),signal:null},{...request(),[Symbol('extra')]:1},Object.create(request())]){
  assert.throws(()=>components.captureAuthorityRequest(value),invalid);cases++;
 }groups++;
 for(const [key,value] of [['state','CONSUMED_PAUSED'],['database_oid','16385'],['database_oid',16384],['effect_backend_pid','4321'],
  ['effect_transaction_id','901'],['original_transaction_id','898'],['restore_id','22222222-2222-4222-8222-222222222222'],
  ['authority_generation',1],['archive_digest','b'.repeat(64)],['revocations',null]]){
  assert.throws(()=>components.captureAuthorityStatus({...scope(r),[key]:value},r));cases++;
 }
 for(const [key,value] of [['restore_id','22222222-2222-4222-8222-222222222222'],['authority_generation','2'],
  ['archive_digest','b'.repeat(64)],['target_project_ref','b'.repeat(20)]]){
  assert.throws(()=>components.captureStatus({...status(r),[key]:value},r));cases++;
 }
 for(const value of [0,-1,'-1','00','+1','1.0','1e2',' 1','1\n','9223372036854775808',new String('1')]){
  const bad=scope(r);bad.revocations.manager_push=value;assert.throws(()=>components.captureAuthorityStatus(bad,r));cases++;
 }
 for(const bad of [proxy,{...scope(r),extra:false},{...scope(r),target_project_ref:r.targetProjectRef},
  Object.defineProperty(scope(r),'state',{enumerable:true,get(){traps++;return 'OBSERVED_COMMITTED_CONSUMED';}}),
  {...scope(r),revocations:{...scope(r).revocations,extra:'0'}},
  {...scope(r),revocations:Object.defineProperty(scope(r).revocations,'auth_sessions',{enumerable:true,get(){traps++;return '1';}})}]){
  assert.throws(()=>components.captureAuthorityStatus(bad,r));cases++;
 }groups++;
 const reply={command:'SELECT',rowCount:1,rows:[{authority_status:scope(r)}]};
 assert.equal(components.authoritySingleRow(reply,['authority_status']).authority_status.state,'OBSERVED_COMMITTED_CONSUMED');cases++;
 for(const bad of [proxy,{...reply,command:'UPDATE'},{...reply,rowCount:0},{...reply,rows:[]},
  {...reply,rows:[reply.rows[0],reply.rows[0]]},{...reply,rows:[{authority_status:scope(r),extra:false}]},
  Object.defineProperty({...reply},'rows',{enumerable:true,get(){traps++;return reply.rows;}})]){
  assert.throws(()=>components.authoritySingleRow(bad,['authority_status']));cases++;
 }assert.equal(traps,0);groups++;
 // Exact synchronous currentness and async bracketing components, with inert
 // identity observations only. Never execute the shipping pipeline on a facade.
 const currentSlice=slice('    const current = () => {','    let originalContext;');
 const guards=bindings=>new Function('isProxy','bindings',legacy+pure+
  '\nconst {db,captured,options,requested,native,authorityNative}=bindings;\n'+currentSlice+'\nreturn {current,guarded};')(types.isProxy,bindings);
 const setup=()=>{const original=request(),db={},options={db,request:original},captured={...options};
  const native={connection:{},stream:{},processID:42,parameters:{},decoders:{},queryTimeout:false,readableState:{},writableState:{}};
  const observation={...native};return{original,db,options,captured,native,observation,requested:components.captureAuthorityRequest(original),authorityNative:()=>observation};};
 for(const key of Object.keys(request())){
  const b=setup(),guard=guards(b);let calls=0;
  await assert.rejects(guard.guarded(async()=>{calls++;b.original[key]=key==='effectBackendPid'?10:'changed';}));assert.equal(calls,1);cases++;
 }
 for(const key of ['connection','stream','processID','parameters','decoders','queryTimeout','readableState','writableState']){
  const b=setup();await assert.rejects(guards(b).guarded(async()=>{b.observation[key]={};}));cases++;
 }
 for(const key of ['db','request']){const b=setup();await assert.rejects(guards(b).guarded(async()=>{b.options[key]={...b.options[key]};}));cases++;}
 for(const failure of [undefined,null,false,0,'']){
  const b=setup();let caught=false;try{await guards(b).guarded(async()=>{throw failure;});}catch(error){caught=true;assert.equal(error,failure);}
  assert.equal(caught,true);cases++;
 }
 {const b=setup(),first=Error('UNIT first read refusal');let caught=false;
  try{await guards(b).guarded(async()=>{b.original.generation='2';throw first;});}catch(error){caught=true;assert.ok(error instanceof AggregateError);assert.equal(error.errors[0],first);assert.equal(error.cause,first);}
  assert.equal(caught,true);cases++;
 }groups++;
 // Real shipping module/native constructor REFUSALS only. Never connect or
 // fabricate _connected/processID/_txStatus/a valid native SQL result.
 const actual=await import('./immutable-private-fresh-restore-recovery.mjs'),{default:pg}=await import('pg');
 const clients=[],nativeEnd=pg.Client.prototype.end,nativeQuery=pg.Client.prototype.query,nativeConnect=pg.Client.prototype.connect;
 const config={host:'not-contacted.invalid',database:'unit_status_only',user:'unit_status_only',password:'PUBLIC_UNIT_NO_CONNECTION',ssl:false};
 const client=()=>{const value=new pg.Client(config);clients.push(value);return value;};
 const checkUnknown=value=>{assert.equal(value.outcome,'UNKNOWN');assert.equal(value.observation,'UNAVAILABLE');
  assert.equal(value.database_status,null);assert.equal(value.authority_status,null);assert.equal(value.metadata_only,true);
  for(const key of ['retry_safe','retry_allowed','resume_allowed','rerun_import_allowed','complete_restore'])assert.equal(value[key],false);
  assert.ok(Object.isFrozen(value)&&Object.isFrozen(value.requested_original));assert.deepEqual(value.requested_original,request());};
 let connectionFixture,originalConnectionDescriptor;
 try{
  const ownQuery=client(),ownConnect=client(),ownConnection=client();
  connectionFixture=ownConnection;originalConnectionDescriptor=Object.getOwnPropertyDescriptor(ownConnection,'connection');
  Object.defineProperty(ownQuery,'query',{get(){traps++;throw Error('No query accessor');}});
  Object.defineProperty(ownConnect,'connect',{get(){traps++;throw Error('No connect accessor');}});
  Object.defineProperty(ownConnection,'connection',{get(){traps++;throw Error('No connection accessor');}});
  let queryCalls=0;
  for(const db of [null,{},proxy,{query(){queryCalls++;throw Error('Not native');}},client(),ownQuery,ownConnect,ownConnection]){
   checkUnknown(await actual.readVerifiedImmutableFreshAuthorityCommitOutcome({db,request:request()}));cases++;
  }
  await assert.rejects(actual.readVerifiedImmutableFreshAuthorityCommitOutcome({db:client(),request:getter}),invalid);cases++;
  for(const value of clients){assert.equal(value._connected,false);assert.equal(value._connecting,false);}
  assert.equal(queryCalls,0);assert.equal(traps,0);assert.equal(pg.Client.prototype.query,nativeQuery);assert.equal(pg.Client.prototype.connect,nativeConnect);
 }finally{
  // Restore ONLY the refused test-owned accessor for native socket cleanup.
  if(connectionFixture)Object.defineProperty(connectionFixture,'connection',originalConnectionDescriptor);
  for(const value of clients)await Reflect.apply(nativeEnd,value,[]);
 }groups++;
 // Source wiring/SQL order only; no positive facade is a native qualification.
 const adapter=text.slice(text.indexOf('export async function readVerifiedImmutableFreshAuthorityCommitOutcome'));
 assert.match(text,/select custodial_dr\.read_committed_immutable_original_authority\(\$1::oid,\$2::integer,\$3::bigint,\$4::uuid,\$5::bigint,\$6::text,\$7::bigint\) as authority_status/);
 assert.match(adapter,/first\.database_marker_status !== "OBSERVED_DATABASE_MARKERS"/);
 assert.ok(adapter.indexOf('const first = captureStatus')<adapter.indexOf('[authorityStatusSql,'));
 assert.ok(adapter.indexOf('[authorityStatusSql,')<adapter.indexOf('const final = captureStatus'));
 assert.match(adapter,/for \(const key of statusKeys\) if \(final\[key\] !== first\[key\]\) authorityUnavailable\(\)/);
 assert.doesNotMatch(adapter,/new (?:pg\.|authorityClient)|\.connect\(|Date\.now|expires_at|\.query\(/);
 assert.match(text,/pg_catalog\.txid_current_if_assigned\(\)::text assigned_transaction_id/);
 assert.match(text,/const authorityParsers = \[16, 20, 23, 25, 114, 3802\]/);
 assert.match(text,/l\.locktype='virtualxid'/);assert.match(text,/for \(const key of authorityContextKeys\) if \(row\[key\] !== originalContext\[key\]\)/);
 groups++;
 console.log(JSON.stringify({scope:'NEW authority status caller parser/currentness/refusals only',groups,cases,traps,
  actual_native_SQL_positive:'NOT_RUN',connected_stream_currentness:'NOT_RUN',SQL:'NOT_RUN',old_groups:0,resources0:true}));process.exit(0);
}

// NEW readback Source only; never execute the retained effect groups here.
if(process.argv.includes('--immutable-original-authority-status-source-only')){
 const sql=readFileSync(new URL('../proposals/immutable-original-authority-reconciliation.sql',import.meta.url),'utf8');
 const name='read_committed_immutable_original_authority';
 const signature='custodial_dr.'+name+'(oid,integer,bigint,uuid,bigint,text,bigint)';
 const extract=(source,member)=>{
  const header='CREATE FUNCTION custodial_dr.'+member+'(',start=source.indexOf(header);
  assert.ok(start>=0,member);assert.equal(source.indexOf(header,start+header.length),-1);
  const begin=source.indexOf('AS $fn$',start),end=source.indexOf('$fn$;',begin+8);
  assert.ok(begin>start&&end>begin);return {header:source.slice(start,begin),body:source.slice(begin+8,end)};
 };
 const required=(source,values)=>{for(const value of values)assert.ok(source.includes(value),'Missing read-only Source: '+value);};
 const validate=source=>{
  const read=extract(source,name),body=read.body,code=body.replace(/^\s*--.*$/gm,'');
  assert.match(read.header,/p_database_oid oid,p_effect_backend_pid integer,p_effect_transaction_id bigint,p_restore_id uuid,\n p_authority_generation bigint,p_archive_digest text,p_original_transaction_id bigint\)/);
  assert.match(read.header,/RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER PARALLEL UNSAFE SET search_path=pg_catalog,pg_temp/);
  assert.doesNotMatch(code,/\b(?:INSERT INTO|UPDATE\s+(?:public|auth|custodial_dr)\.|DELETE FROM|TRUNCATE|ALTER|CREATE|DROP|LOCK TABLE|COMMIT\s*;|ROLLBACK|EXECUTE|BEGIN TRANSACTION)\b/i);
  assert.doesNotMatch(code,/FOR (?:UPDATE|SHARE)|pg_advisory|set_config\(|clock_timestamp\(|pg_stat_get_xact|pg_catalog\.txid_current\(|pg_catalog\.pg_backend_pid\(/i);
  assert.doesNotMatch(code,/immutable_original_authority_snapshot\(|immutable_import_(?:owner_fence|assert_context|source_inventory_state|target_shape)\(/);
  required(body,[
   "current_setting('transaction_read_only')<>'on'", "current_setting('transaction_isolation') NOT IN('repeatable read','serializable')",
   "current_setting('session_replication_role')<>'origin'", 'current_user<>session_user',
   "(pg_catalog.current_schemas(true))[1]<>'pg_catalog'",'p_database_oid IS DISTINCT FROM db_oid',
   'pg_catalog.txid_current_if_assigned() IS NOT DISTINCT FROM p_effect_transaction_id',
   "oid='custodial_dr.restore_control'::regclass", "oid='custodial_dr.immutable_private_import_context'::regclass",
   "oid='custodial_dr.immutable_original_authority_scopes'::regclass",'c.relowner=actor_oid',
   'c.relrowsecurity AND c.relforcerowsecurity','WHERE a.grantee<>actor_oid',
   'WHERE s.database_oid=db_oid AND s.restore_id=p_restore_id AND s.authority_generation=p_authority_generation',
   'IF record_count<>1 THEN','scope.backend_pid IS DISTINCT FROM p_effect_backend_pid',
   'scope.transaction_id IS DISTINCT FROM p_effect_transaction_id',
   'scope.original_transaction_id IS DISTINCT FROM p_original_transaction_id',
   'scope.archive_digest IS DISTINCT FROM p_archive_digest',"scope.phase IS DISTINCT FROM 'CONSUMED'",
   'scope.completed_step IS DISTINCT FROM 6 OR scope.active_table_oid IS NOT NULL',
   "jsonb_typeof(scope.counts) IS DISTINCT FROM 'object'", "jsonb_typeof(scope.counts->item) IS DISTINCT FROM 'string'",
   "translate(value,'0123456789','')<>''", "value COLLATE \"C\">'9223372036854775807' COLLATE \"C\"",
   'scope.result IS DISTINCT FROM expected_result',
   'to_jsonb(ctx) IS DISTINCT FROM scope.original_snapshot->\'import_context\'',
   "ctx.phase IS DISTINCT FROM 'FINISHED'",'ctx.restore_id IS DISTINCT FROM scope.restore_id',
   'ctx.authority_generation IS DISTINCT FROM scope.authority_generation','ctx.archive_digest IS DISTINCT FROM scope.archive_digest',
   "'authority_reconciliation',custodial_dr.immutable_original_authority_scope_shape()",
   "(recorded_source-'recovery_inventory') IS DISTINCT FROM fresh_source",
   "(recorded_source-'recovery_inventory') IS DISTINCT FROM (ctx.target_shape-'recovery_inventory')",
   "recorded_source->'authority_reconciliation' IS DISTINCT FROM scope_shape",
   "jsonb_array_length(scope_shape->'functions') IS DISTINCT FROM 6",
   "scope_shape->'import_ancestry'->'relation'->'force' IS DISTINCT FROM 'true'::jsonb",
   "scope_shape->'import_ancestry'->'function'->'config' IS DISTINCT FROM '[\"search_path=pg_catalog\"]'::jsonb",
   "pg_get_functiondef(p.oid)","FROM pg_catalog.pg_roles r WHERE r.rolname=current_user", "'database_owner',(SELECT datdba",
   "FROM selected_relations c", "pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) ORDER BY i.restore_order,i.object_kind,i.object_identity,i.inventory_id)",
   "(recorded_inventory-'epoch') IS DISTINCT FROM fresh_inventory", "(import_inventory-'epoch') IS DISTINCT FROM fresh_inventory",
   'file_node:=pg_catalog.pg_relation_filenode(inventory_oid)',"'transaction_id',p_effect_transaction_id::text",
   "'transaction_id',p_original_transaction_id::text", "'inserted','0','updated','0','deleted','0'",
   "MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNKNOWN',DETAIL='outcome=UNKNOWN;retry_safe=false'",
   "ERRCODE='42501',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNAVAILABLE'",
   "RETURN jsonb_build_object('state','OBSERVED_COMMITTED_CONSUMED'",
   "'effect_backend_pid',scope.backend_pid,'effect_transaction_id',scope.transaction_id::text",
  ]);
  assert.equal((body.match(/IF record_count<>1 THEN/g)||[]).length,2);
  assert.equal((body.match(/\bRETURN jsonb_build_object/g)||[]).length,1);
  const keys=body.slice(body.indexOf('RETURN jsonb_build_object')).match(/'[a-z_]+'(?=,)/g).map(value=>value.slice(1,-1));
  assert.deepEqual(keys,['state','database_oid','effect_backend_pid','effect_transaction_id','original_transaction_id','restore_id',
   'authority_generation','archive_digest','revocations']);
  const shape=extract(source,'immutable_original_authority_scope_shape').body;
  required(shape,["to_regprocedure('"+signature+"')", "'import_ancestry',jsonb_build_object",'pg_get_functiondef(p.oid)',
   "oid='custodial_dr.immutable_private_import_context'::regclass", "to_regprocedure('custodial_dr.immutable_import_context_source_immutable()')"]);
  const acl=source.slice(source.indexOf('DO $acl$'));
  required(acl,["to_regprocedure('"+signature+"')", "REVOKE ALL ON FUNCTION %s FROM %s RESTRICT",'WHERE grantee<>owner_oid']);
 };
 validate(sql);
 // Scope lifecycle, guard predicate and fixed six-effect operation bodies
 // are byte-identical to the sealed predecessor, not rerun against a fake DB.
 const retainedBodies={
  immutable_original_authority_scope_guard:'490ac55a10d2004704f3e40ecba185d69809071438e727040fc01b54a951cb75',
  immutable_original_authority_guard_matches:'62b5940dd30ee2cc1dd21c328989c853abdc861cb4ad36f6fc896cc72d61e00a',
  reconcile_committed_immutable_original_authority:'e951de5b7399cbbb767c62465b8da3a7f3781ffcb5a3b0a5b86133e8dbc59e5e',
 };
 for(const [member,hash] of Object.entries(retainedBodies))assert.equal(createHash('sha256').update(extract(sql,member).body).digest('hex'),hash);
 const mutations=[
  ["current_setting('transaction_read_only')<>'on'",'false'],
  ["scope.phase IS DISTINCT FROM 'CONSUMED'","scope.phase IS DISTINCT FROM 'RUNNING'"],
  ['IF record_count<>1 THEN','IF record_count<0 THEN'],
  ['scope.result IS DISTINCT FROM expected_result','false'],
  ["translate(value,'0123456789','')<>''",'false'],
  ['scope.archive_digest IS DISTINCT FROM p_archive_digest','false'],
  ["(recorded_source-'recovery_inventory') IS DISTINCT FROM fresh_source",'false'],
  ["(recorded_inventory-'epoch') IS DISTINCT FROM fresh_inventory",'false'],
  ['WHERE a.grantee<>actor_oid','WHERE false'],
  ['pg_catalog.txid_current_if_assigned() IS NOT DISTINCT FROM p_effect_transaction_id','false'],
  ["'effect_backend_pid',scope.backend_pid","'effect_backend_pid',pg_catalog.pg_backend_pid()"],
  ["to_regprocedure('"+signature+"')",'NULL'],
  [' RETURN jsonb_build_object(\'state\',\'OBSERVED_COMMITTED_CONSUMED\'',
   ' UPDATE custodial_dr.immutable_original_authority_scopes SET phase=\'RUNNING\';\n RETURN jsonb_build_object(\'state\',\'OBSERVED_COMMITTED_CONSUMED\''],
  [' RETURN jsonb_build_object(\'state\',\'OBSERVED_COMMITTED_CONSUMED\'',
   ' PERFORM custodial_dr.immutable_original_authority_snapshot(p_original_transaction_id);\n RETURN jsonb_build_object(\'state\',\'OBSERVED_COMMITTED_CONSUMED\''],
 ];
 for(const [before,after] of mutations){assert.ok(sql.includes(before));assert.throws(()=>validate(sql.replaceAll(before,after)),before);}
 console.log(JSON.stringify({scope:'NEW historical consumed-scope readback Source only',source_sha256:createHash('sha256').update(sql).digest('hex'),
  new_reader_contract_groups:6,new_reader_source_mutation_refusals:mutations.length,prior_effect_groups_run:0,
  retained_effect_bodies:'BYTE_IDENTICAL',sql_parse:'NOT_RUN',SQL:'NOT_RUN',native_status_restart_proof:'NOT_RUN',resources0:true}));
 process.exit(0);
}

// NEW proposal-only contract checks. These inspect the real released SQL
// Source, not a simulated backend, valid intent, effect scope or native lease.
if(process.argv.includes('--immutable-original-authority-sql-source-only')){
 const sql=readFileSync(new URL('../proposals/immutable-original-authority-reconciliation.sql',import.meta.url),'utf8');
 const body=(source,name)=>{
  const header='CREATE FUNCTION custodial_dr.'+name+'(';
  const start=source.indexOf(header);assert.ok(start>=0,name);assert.equal(source.indexOf(header,start+1),-1);
  const begin=source.indexOf('AS $fn$',start),end=source.indexOf('$fn$;',begin+8);
  assert.ok(begin>start&&end>begin);return source.slice(begin+8,end);
 };
 const required=(source,parts)=>{for(const part of parts)assert.ok(source.includes(part),'Missing fixed Source: '+part);};
 const validate=source=>{
  const executable=source.replace(/^\s*--.*$/gm,'');
  assert.equal((executable.match(/CREATE TABLE /g)||[]).length,1);
  assert.equal((executable.match(/CREATE FUNCTION /g)||[]).length,6);
  assert.equal((executable.match(/SECURITY INVOKER PARALLEL UNSAFE/g)||[]).length,6);
  assert.doesNotMatch(executable,/SECURITY DEFINER|CREATE OR REPLACE|\bGRANT\s|\bALTER ROLE\b|\bSET ROLE\b|DISABLE TRIGGER|session_replication_role\s*=|set_config\(/i);
  assert.doesNotMatch(executable,/UPDATE custodial_dr\.immutable_private_import_context|DELETE FROM custodial_release_identity|UPDATE custodial_dr\.restore_control|INSERT INTO custodial_dr\.restore_events/i);
  required(source,[
   'PRIMARY KEY(database_oid,backend_pid,transaction_id), UNIQUE(restore_id,authority_generation)',
   'immutable_original_authority_scopes FORCE ROW LEVEL SECURITY',
   'creator IS DISTINCT FROM',"current_user=session_user AND current_user=%L",
   'ENABLE ALWAYS TRIGGER immutable_original_authority_scope_immutable',
   'ENABLE ALWAYS TRIGGER immutable_original_authority_scope_no_truncate',
   'FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader',
   "pg_catalog.acldefault('f',owner_oid)",'WHERE grantee<>owner_oid',
   "REVOKE ALL ON FUNCTION %s FROM %s RESTRICT",
  ]);
  const guard=body(source,'immutable_original_authority_scope_guard');
  required(guard,["IF TG_OP='DELETE' OR TG_OP='TRUNCATE'",'NEW.transaction_id IS DISTINCT FROM pg_catalog.txid_current()',
   "ELSIF TG_OP='UPDATE' AND OLD.phase='RUNNING'",'NEW.original_snapshot)',
   'OLD.completed_step<6 AND NEW.completed_step=OLD.completed_step',
   'NEW.active_table_oid IS NULL AND NEW.completed_step=OLD.completed_step+1',
   "OLD.completed_step=6 AND OLD.active_table_oid IS NULL AND NEW.phase='CONSUMED'",
   "MESSAGE='Original authority scope transition refused'"]);
  const snapshot=body(source,'immutable_original_authority_snapshot');
  required(snapshot,[
   'PERFORM custodial_dr.immutable_import_owner_fence()',
   "current_setting('transaction_read_only')<>'off'", "current_setting('transaction_isolation') NOT IN('repeatable read','serializable')",
   "current_setting('session_replication_role')<>'origin'", "current_setting('row_security')<>'off'",
   "current_setting('search_path')<>'pg_catalog, pg_temp'", "(pg_catalog.current_schemas(true))[1]<>'pg_catalog'",
   'p_original_transaction_id=pg_catalog.txid_current()',
   "'memphis-zoo-application-mutation-admission','memphis-zoo-application-mutation-fence'",
   "l.mode='ExclusiveLock'", "l.mode='AccessExclusiveLock'", "l.mode IN('ShareLock'",
   "c.relkind='r'", "c.relpersistence='p' AND NOT c.relispartition",'FROM pg_catalog.pg_inherits',
   "pg_catalog.has_table_privilege(actor_oid,c.oid,'SELECT')", "WHEN r.identity='auth.sessions' THEN 'DELETE' ELSE 'UPDATE' END)",
   'AND NOT pg_catalog.row_security_active(c.oid)',
   "t.tgtype=62 AND t.tgenabled='O' AND t.tgqual IS NULL AND t.tgnargs=0",
   "'custodial_dr.guard_application_mutation()'::regprocedure)<>5",
   'a.atttypid=to_regtype(fixed.type)',"a.attgenerated='' AND a.attidentity='')<>12",
   'backend_pid=pg_catalog.pg_backend_pid() AND transaction_id=p_original_transaction_id FOR SHARE',
   "ctx.phase<>'FINISHED'", "ctl.state<>'DATABASE_RESTORED' OR ctl.mutations_paused IS DISTINCT FROM true",
   "(to_jsonb(ctl)-ARRAY['state','updated_at']) IS DISTINCT FROM (ctx.original_control-ARRAY['state','updated_at'])",
   "(ctx.original_manifest->>'expires_at')::timestamptz<=clock_timestamp()",
   "ctx.target_shape->'authority_reconciliation' IS NULL", "ctx.target_shape->'authority_reconciliation' IS DISTINCT FROM scope_shape",
   "(ctx.target_shape-'recovery_inventory') IS DISTINCT FROM (source-'recovery_inventory')",
   "jsonb_array_length(scope_shape->'functions') IS DISTINCT FROM 6",'WHERE a.grantee<>actor_oid',
   "(old_inventory-'epoch') IS DISTINCT FROM (fresh_inventory-'epoch')",
   "fresh_inventory->'epoch'->>'transaction_id' IS DISTINCT FROM pg_catalog.txid_current()::text",
   "fresh_inventory->'epoch'->>'inserted' IS DISTINCT FROM '0'",
   "fresh_inventory->'epoch'->>'updated' IS DISTINCT FROM '0'", "fresh_inventory->'epoch'->>'deleted' IS DISTINCT FROM '0'",
   'manifest.database_evidence IS DISTINCT FROM expected_database', 'event.evidence_json IS DISTINCT FROM expected_event',
   "event.actor IS DISTINCT FROM ctl.started_by", "'private_rows',private_rows::text,'transaction_authority',false,'admission_resumed',false",
   "MESSAGE='Original authority expired during validation'",
  ]);
  const terminal=snapshot.indexOf("MESSAGE='Original authority expired during validation'");
  assert.ok(terminal>snapshot.indexOf('manifest.database_evidence IS DISTINCT FROM expected_database')&&terminal<snapshot.indexOf('RETURN jsonb_build_object'));
  const match=body(source,'immutable_original_authority_guard_matches');
  required(match,['pg_catalog.pg_trigger_depth()<>1 OR current_user<>session_user',
   "IF NOT FOUND OR scope.phase='CONSUMED' THEN RETURN false",'p_table_oid IS DISTINCT FROM expected_oid',
   "p_operation IS DISTINCT FROM CASE WHEN scope.completed_step=5 THEN 'DELETE' ELSE 'UPDATE' END",
   'scope.original_snapshot IS DISTINCT FROM custodial_dr.immutable_original_authority_snapshot(scope.original_transaction_id)']);
  const operation=body(source,'reconcile_committed_immutable_original_authority');
  assert.match(source,/reconcile_committed_immutable_original_authority\(\n p_database_oid oid,p_backend_pid integer,p_transaction_id bigint,p_restore_id uuid,\n p_authority_generation bigint,p_archive_digest text,p_original_transaction_id bigint\)/);
  required(operation,['p_database_oid IS DISTINCT FROM','p_backend_pid IS DISTINCT FROM pg_catalog.pg_backend_pid()',
   'p_transaction_id IS DISTINCT FROM pg_catalog.txid_current()',
   'WHERE restore_id=p_restore_id AND authority_generation=p_authority_generation',
   'original:=custodial_dr.immutable_original_authority_snapshot(p_original_transaction_id)',
   "original,'RUNNING',0,NULL,effect_counts",'FOR step IN 1..6 LOOP',
   "reason:='disaster_restore_generation_'||p_authority_generation::text",'SET active_table_oid=target_oid',
   'SET active_table_oid=NULL,completed_step=step,counts=effect_counts',
   "SET phase='CONSUMED',result=completion",'completed_step=6 AND active_table_oid IS NULL',
   "'state','CONSUMED_PAUSED','revocations',effect_counts",'RETURN completion;', 'EXCEPTION WHEN OTHERS THEN RAISE;']);
  assert.equal((operation.match(/original IS DISTINCT FROM custodial_dr\.immutable_original_authority_snapshot\(p_original_transaction_id\)/g)||[]).length,3);
  const lock=operation.indexOf('LOCK TABLE ONLY auth.sessions'),scope=operation.indexOf('INSERT INTO custodial_dr.immutable_original_authority_scopes');
  assert.ok(lock>=0&&lock<scope&&operation.indexOf('original:=')<scope);
  const targets=['auth.sessions','public.device_auth_credentials','public.device_auth_enrollment_codes',
   'public.ops_manager_enrollment_codes','public.ops_manager_push_devices','public.ops_manager_trusted_devices'];
  const locks=operation.slice(lock,operation.indexOf(';',lock));for(const target of targets)assert.ok(locks.includes('ONLY '+target));
  const statements=[
   'UPDATE public.device_auth_credentials SET revoked_at=clock_timestamp(),revoked_reason=reason WHERE revoked_at IS NULL;',
   'UPDATE public.device_auth_enrollment_codes SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL;',
   'UPDATE public.ops_manager_trusted_devices SET revoked_at=clock_timestamp(),revoked_reason=reason WHERE revoked_at IS NULL;',
   "UPDATE public.ops_manager_enrollment_codes SET status='revoked',revoked_at=clock_timestamp(),revoked_reason=reason WHERE status='active';",
   'UPDATE public.ops_manager_push_devices SET enabled=false,revoked_at=clock_timestamp(),revoked_reason=reason\n     WHERE coalesce(enabled,true)=true OR revoked_at IS NULL;',
   'DELETE FROM auth.sessions;',
  ];
  for(const statement of statements){assert.equal(operation.split(statement).length,2);assert.ok(operation.includes(statement+'\n    GET DIAGNOSTICS affected=ROW_COUNT;'));}
  assert.equal((operation.match(/\bUPDATE public\./g)||[]).length,5);assert.equal((operation.match(/\bDELETE FROM auth\./g)||[]).length,1);
  assert.ok(operation.indexOf("SET phase='CONSUMED'")<operation.indexOf('RETURN completion;'));
  assert.doesNotMatch(operation,/\bEXECUTE\b|\bCOMMIT\s*;|\bBEGIN TRANSACTION\b|\bRETURN (?:true|false)\b/i);
 };
 validate(sql);
 const mutations=[
  ["ctx.phase<>'FINISHED'","ctx.phase<>'STAGING'"],
  ["ctx.target_shape->'authority_reconciliation' IS NULL",'false'],
  ['p_transaction_id IS DISTINCT FROM pg_catalog.txid_current()','false'],
  ['l.mode=\'ExclusiveLock\'','l.mode=\'ShareLock\''],
  ['ONLY auth.sessions,',''],
  ["t.tgenabled='O'","t.tgenabled='D'"],
  ['SET phase=\'CONSUMED\',result=completion','SET phase=\'RUNNING\',result=completion'],
  ['DELETE FROM auth.sessions;','DELETE FROM auth.users;'],
  ['manifest.database_evidence IS DISTINCT FROM expected_database','false'],
  ['WHERE a.grantee<>actor_oid','WHERE false'],
  ['AND NOT pg_catalog.row_security_active(c.oid)',''],
 ];
 for(const [before,after] of mutations){assert.ok(sql.includes(before));assert.throws(()=>validate(sql.replaceAll(before,after)),before);}
 console.log(JSON.stringify({scope:'NEW fixed original authority SQL proposal Source contract only',
  source_sha256:createHash('sha256').update(sql).digest('hex'),source_contract_groups:6,source_mutation_refusals:mutations.length,
  sql_parse:'NOT_RUN',SQL:'NOT_RUN',native_effects:'NOT_RUN',guard_or_factory_integration:'NOT_INSTALLED',old_groups:0,resources0:true}));
 process.exit(0);
}

// Exact normal caller setup slices, with inert await/Source recording only.
// This neither connects to PostgreSQL nor fabricates private reader admission.
if(process.argv.includes('--normal-lossless-output-profile-only')){
 const code=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
 const profiles=[
  {phase:'read_committed_fresh_original_data',mode:'read only',
   start:'      restorePhase = "read_committed_fresh_original_data";',stop:'      // Preserve only observed comparison metadata',
   reader:'inspectCommittedImmutableFreshData'},
  {phase:'prepare_committed_fresh_original_authority',mode:'read write',
   start:'      // Fixed same-original RW preparation snapshot',stop:'      const refuseAuthorityPreparation =',
   reader:'prepareCommittedImmutableFreshAuthority'},
 ];
 const setting='set local extra_float_digits = 3';let cases=0;
 for(const profile of profiles){
  const start=code.indexOf(profile.start),stop=code.indexOf(profile.stop,start);
  assert.ok(start>0&&stop>start);assert.equal(code.indexOf(profile.start,start+1),-1);
  const body=code.slice(start,stop);
  assert.equal(body.split('await db.query("'+setting+'");').length,2);
  assert.match(body,/requireOriginalArchiveSource\(\);\n      await db\.query\("set local extra_float_digits = 3"\);\n      requireOriginalArchiveSource\(\);/);
  assert.doesNotMatch(body,/process\.env|db\.query\(["'](?:insert|update|delete|truncate|create|alter|commit|rollback)\b/i);
  const evaluate=new Function('ports','return (async()=>{let transactionAttempted=false,restorePhase;'
   +'const db=ports.db,verifiedArchive=ports.archive,requireOriginalArchiveSource=ports.source;'
   +'const '+profile.reader+'=ports.read;try{'+body
   +'return {ok:true,transactionAttempted,restorePhase};}catch(error){return {ok:false,error,transactionAttempted,restorePhase};}})()');
  const expected=['begin isolation level repeatable read '+profile.mode,setting,
   'set local search_path = pg_catalog, pg_temp','set local row_security = off',
   "select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-admission',0))",
   "select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))",
   'lock table public.custodial_release_authority_restore_inventory in share mode'];
  const run=async(failAt)=>{
   const trace=[],queries=[],archive=Object.freeze({fixture:'inert caller boundary only'}),failure=new Error('UNIT_PROFILE_REFUSAL');
   let sourceCount=0,reads=0,digits;
   const db={async query(sql){trace.push('query:'+sql);queries.push(sql);
    if(failAt==='setting'&&sql===setting)throw failure;if(sql===setting)digits=3;return {};}};
   const source=()=>{trace.push('source');sourceCount++;
    if((failAt==='before-setting'&&sourceCount===(profile.mode==='read only'?1:2))
      ||(failAt==='after-setting'&&queries.at(-1)===setting))throw failure;};
   const read=async options=>{trace.push('reader');reads++;assert.deepEqual(Object.keys(options).sort(),['db','verifiedArchive']);
    assert.equal(options.db,db);assert.equal(options.verifiedArchive,archive);assert.equal(digits,3);
    assert.deepEqual(queries,expected);return Object.freeze({fixture:'no native result or authority'});};
   const result=await evaluate({db,archive,source,read});cases++;
   return {...result,trace,queries,reads,failure};
  };
  const good=await run();assert.equal(good.ok,true);assert.equal(good.transactionAttempted,true);
  assert.equal(good.restorePhase,profile.phase);assert.equal(good.reads,1);assert.deepEqual(good.queries,expected);
  const index=good.trace.indexOf('query:'+setting);
  assert.equal(good.trace[index-1],'source');assert.equal(good.trace[index+1],'source');
  assert.ok(index<good.trace.indexOf('reader'));assert.equal(good.trace.at(-1),'source');
  for(const failAt of ['before-setting','setting','after-setting']){
   const bad=await run(failAt);assert.equal(bad.ok,false);assert.equal(bad.error,bad.failure);
   assert.equal(bad.transactionAttempted,true);assert.equal(bad.restorePhase,profile.phase);assert.equal(bad.reads,0);
   assert.deepEqual(bad.queries,expected.slice(0,failAt==='before-setting'?1:2));
  }
 }
 assert.equal(code.split('await db.query("set local extra_float_digits = 3");').length,3);
 console.log(JSON.stringify({scope:'NEW normal post-COMMIT RO/RW lossless output caller setup recording',cases,
  modes:['read only','read write'],fixed_extra_float_digits:3,connections:0,SQL:'NOT_RUN',signatures_created:0,
  native_profile_and_join:'NOT_RUN: Main owns native validation',old_groups:0,resources0:true}));process.exit(0);
}

// New importer entry refusals only: no private freshStaged state, signed
// token, acknowledged COMMIT, connected client or SQL result is fabricated.
if(process.argv.includes('--private-authority-preparation-entry-only')){
 const module=await import('./immutable-private-data-import.mjs'),{default:pg}=await import('pg');
 assert.equal(typeof module.prepareCommittedImmutableFreshAuthority,'function');
 const read=module.prepareCommittedImmutableFreshAuthority,nativeQuery=pg.Client.prototype.query,end=pg.Client.prototype.end;
 const client=new pg.Client(),own=new pg.Client();class OtherClient extends pg.Client{}const other=new OtherClient();
 let refusals=0,traps=0;
 const proxy=new Proxy({}, {get(){traps++;throw Error('No proxy');},getPrototypeOf(){traps++;throw Error('No proxy');},ownKeys(){traps++;throw Error('No proxy');}});
 Object.defineProperty(own,'query',{get(){traps++;throw Error('No own query');}});
 const archive=Object.freeze({}),finished=Object.freeze({database_oid:'16384',backend_pid:123,transaction_id:'1',restore_id:'11111111-1111-4111-8111-111111111111',
  authority_generation:'1',archive_digest:'a'.repeat(64),private_rows:'2',transaction_authority:false,admission_resumed:false});
 const expected=error=>{assert.equal(error.code,'IMMUTABLE_FRESH_AUTHORITY_PREPARATION_UNAVAILABLE');assert.equal(error.outcome,'UNKNOWN');
  assert.equal(error.retry_safe,false);assert.equal(error.complete_restore,false);assert.equal(error.resume_allowed,false);assert.equal(error.effect_allowed,false);
  assert.equal(error.message,error.code);assert.equal(Object.hasOwn(error,'cause'),false);assert.equal(Object.hasOwn(error,'actual'),false);
  assert.equal(Object.hasOwn(error,'expected'),false);refusals++;return true;};
 try{
  for(const value of [undefined,null,[],{},proxy,{db:client},{db:client,verifiedArchive:archive,freshIntent:{}},
   {db:client,verifiedArchive:archive,finished},{db:client,verifiedArchive:archive,mode:'READ WRITE'},
   {db:client,verifiedArchive:archive,phase:'COMMIT_ACKNOWLEDGED'}])await assert.rejects(read(value),expected);
  const accessor={verifiedArchive:archive};Object.defineProperty(accessor,'db',{enumerable:true,get(){traps++;throw Error('No db getter');}});
  await assert.rejects(read(accessor),expected);
  for(const db of [null,{},proxy,own,other,{query(){traps++;throw Error('No injected SQL');}}])
   await assert.rejects(read({db,verifiedArchive:archive}),expected);
  for(const verifiedArchive of [undefined,null,{},proxy,archive,{...archive,finished,commit_status:'ACKNOWLEDGED'}])
   await assert.rejects(read({db:client,verifiedArchive}),expected);
  client.freshStaged={phase:'COMMIT_ACKNOWLEDGED',verifiedArchive:archive,imported:finished};
  client.phase='COMMIT_ACKNOWLEDGED';client.inspectionInFlight=false;
  await assert.rejects(read({db:client,verifiedArchive:archive}),expected);
  await assert.rejects(read({db:new Proxy(client,{}),verifiedArchive:archive}),expected);
  assert.equal(traps,0);assert.equal(client._connected,false);assert.equal(client._connecting,false);assert.equal(pg.Client.prototype.query,nativeQuery);
  const code=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
  const start=code.indexOf('export async function prepareCommittedImmutableFreshAuthority(options)'),stop=code.indexOf('// Read-only DATA comparison',start);
  assert.ok(start>0&&stop>start);const body=code.slice(start,stop);
  assert.match(body,/closed\(options,\['db','verifiedArchive'\]\)/);
  assert.match(body,/freshStaged\.get\(db\)/);assert.match(body,/state\.phase!=='COMMIT_ACKNOWLEDGED'/);
  assert.match(body,/state\.inspectionInFlight===true/);assert.match(body,/freshAuthorityPreparations\.has\(db\)/);
  assert.match(body,/state\.inspectionInFlight=true;freshAuthorityPreparations\.add\(db\)/);
  assert.match(body,/sameSource\(verifiedArchive,original\)/);assert.match(body,/live!==captured/);
  assert.match(body,/state\.freshIntent!==freshIntent/);assert.match(body,/state\.imported!==imported/);
  assert.match(body,/current\(\);\n    const value=await readVerifiedImmutableFreshAuthorityPreparation\(\{db,verifiedArchive,freshIntent,finished:imported\}\);\n    current\(\);/);
  assert.match(body,/observed\.original_transaction_id!==imported\.transaction_id/);
  assert.match(body,/observed\.transaction_id===observed\.original_transaction_id/);
  assert.match(body,/observed\.private_rows!==imported\.private_rows/);
  assert.match(body,/current_context:Object\.freeze\(observed\)/);assert.match(body,/requested_original:request/);
  assert.match(body,/freshAuthorityPreparations\.delete\(db\);state\.inspectionInFlight=false/);
  assert.doesNotMatch(body,/state\.phase\s*=|freshStaged\.set|Reflect\.apply\(query|\b(?:BEGIN|COMMIT|ROLLBACK);|pg_advisory_(?:xact_)?lock\s*\(/);
 }finally{await Reflect.apply(end,other,[]);await Reflect.apply(end,own,[]);await Reflect.apply(end,client,[]);}
 console.log(JSON.stringify({scope:'NEW private acknowledged-original authority-preparation entry refusal and Source contract',refusals,
  private_state_fabrications:0,native_query_monkeypatches:0,connections:0,SQL:'NOT_RUN',signed_intents_created:0,old_groups:0,
  positive_private_preparation:'NOT_RUN: Main actual private stage/COMMIT and native new transaction required',resources0:true}));process.exit(0);
}

// Fixed RW preparation export: actual native-port refusals and unchanged
// Source assertion slices, not positive SQL, signed intent or ACK authority.
if(process.argv.includes('--fresh-authority-preparation-only')){
 const module=await import('./immutable-private-fresh-restore-commit-context.mjs'),{default:pg}=await import('pg');
 assert.equal(typeof module.readVerifiedImmutableFreshAuthorityPreparation,'function');
 assert.deepEqual(Object.keys(module).sort(),['readVerifiedImmutableFreshCommitPreparation','readVerifiedImmutableFreshCommitRecord',
  'readVerifiedImmutableFreshPostDatabaseContext','readVerifiedImmutableFreshAuthorityPreparation'].sort());
 const read=module.readVerifiedImmutableFreshAuthorityPreparation,query=pg.Client.prototype.query,end=pg.Client.prototype.end;
 const client=new pg.Client(),own=new pg.Client();let traps=0,refusals=0,componentRefusals=0;
 const finished=Object.freeze({database_oid:'16384',backend_pid:123,transaction_id:'9007199254740993',restore_id:'11111111-1111-4111-8111-111111111111',
  authority_generation:'1',archive_digest:'a'.repeat(64),private_rows:'2',transaction_authority:false,admission_resumed:false});
 const options={db:client,verifiedArchive:{},freshIntent:{},finished};
 const expected=error=>{assert.equal(error.code,'IMMUTABLE_FRESH_AUTHORITY_PREPARATION_UNAVAILABLE');assert.equal(error.message,error.code);
  assert.equal(error.check_phase,'INPUT');assert.equal(error.outcome,'UNKNOWN');assert.equal(error.retry_safe,false);
  assert.deepEqual(Object.keys(error).sort(),['code','outcome','retry_safe','check_phase'].sort());refusals++;return true;};
 const proxy=new Proxy({}, {get(){traps++;throw Error('No proxy');},getPrototypeOf(){traps++;throw Error('No proxy');},ownKeys(){traps++;throw Error('No proxy');}});
 Object.defineProperty(own,'query',{get(){traps++;throw Error('No query override');}});
 try{
  for(const value of [null,undefined,[],{},proxy,{...options,mode:'READ WRITE'},{...options,authorityPreparation:true},
   {...options,postDatabase:true},{...options,finished:undefined}])await assert.rejects(read(value),expected);
  const accessor={...options};Object.defineProperty(accessor,'db',{enumerable:true,get(){traps++;throw Error('No getter');}});
  await assert.rejects(read(accessor),expected);
  for(const db of [null,{},proxy,own,{query(){traps++;throw Error('No injected port');}}])await assert.rejects(read({...options,db}),expected);
  for(const [key,value]of [['database_oid',16384],['database_oid','0'],['transaction_id','01'],['transaction_id','9223372036854775808'],
   ['backend_pid','123'],['restore_id','foreign'],['authority_generation','0'],['archive_digest','x'.repeat(64)],
   ['private_rows',2],['transaction_authority',true],['admission_resumed',true],['extra',true]])
   await assert.rejects(read({...options,finished:{...finished,[key]:value}}),expected);
  await assert.rejects(read(options),expected); // Public copies never become original private brands.
  assert.equal(traps,0);assert.equal(client._connected,false);assert.equal(client._connecting,false);assert.equal(pg.Client.prototype.query,query);
  const code=readFileSync(new URL('./immutable-private-fresh-restore-commit-context.mjs',import.meta.url),'utf8');
  const {runInNewContext}=await import('node:vm');
  const first=code.match(/assert\.equal\(firstRead\.read_only,[^;]+;/)[0];
  const start=code.indexOf("    assert.equal(row.actor,'supabase_admin');"),stop=code.indexOf('    assert.equal(row.context_count,1);',start);
  assert.ok(start>=0&&stop>start);const settings=code.slice(start,stop);
  const row={actor:'supabase_admin',session_actor:'supabase_admin',read_only:'off',isolation:'repeatable read',row_security:'off',replication:'origin',
   search_path:'pg_catalog, pg_temp',first_schema:'pg_catalog'};
  const check=(row,authorityPreparation,postDatabase=true)=>runInNewContext(settings,{assert,row,authorityPreparation,postDatabase,firstRead:{isolation:'repeatable read'}});
  runInNewContext(first,{assert,authorityPreparation:true,firstRead:{read_only:'off'}});
  runInNewContext(first,{assert,authorityPreparation:false,firstRead:{read_only:'on'}});
  for(const authorityPreparation of [true,false]){
   assert.throws(()=>runInNewContext(first,{assert,authorityPreparation,firstRead:{read_only:authorityPreparation?'on':'off'}}));componentRefusals++;
  }
  check(row,true);check({...row,read_only:'on'},false);check({...row,search_path:'pg_catalog'},false,false);
  for(const change of [{read_only:'on'},{search_path:'pg_catalog'},{first_schema:'pg_temp_1'},{row_security:'on'},{replication:'replica'},
   {actor:'postgres'},{session_actor:'postgres'},{isolation:'read committed'}]){assert.throws(()=>check({...row,...change},true));componentRefusals++;}
  assert.throws(()=>check(row,false));componentRefusals++;
  assert.match(code,/readVerifiedImmutableFreshAuthorityPreparation\(options\)\{return readContext\(options,true,true,true\);\}/);
  assert.match(code,/assert\.notEqual\(first\.transaction_id,prior\.transaction_id/);assert.match(code,/assert\.equal\(firstRead\.held_fences,2\)/);
  assert.match(code,/comparePostDatabaseInventory\(ctx\.original_inventory,ctx\.current_inventory,prior,first\)/);
  assert.match(code,/database_verified:recorded,storage_verified:false,authority_invalidated:false,post_restore_verified:false/);
  assert.match(code,/\['transaction_authority',false\],\['admission_resumed',false\]/);
  assert.doesNotMatch(code,/pg_advisory_(?:xact_)?lock\s*\(|\bLOCK\s+TABLE\b|\bSET\s+(?:LOCAL|ROLE)\b|\b(?:BEGIN|COMMIT|ROLLBACK);/i);
 }finally{await Reflect.apply(end,own,[]);await Reflect.apply(end,client,[]);}
 console.log(JSON.stringify({scope:'NEW fixed RW authority-preparation DATA reader',refusals,component_refusals:componentRefusals,
  native_query_monkeypatches:0,connections:0,SQL:'NOT_RUN',positive_native_preparation:'NOT_RUN: Main owns acknowledged COMMIT/current native transaction',
  signed_intents_created:0,old_groups:0,resources0:true}));process.exit(0);
}

// Newly joined normal caller slice, recorded without executing the CLI,
// native pg, signed inputs, private importer state or any actual SQL.
if(process.argv.includes('--normal-authority-preparation-caller-only')){
 const code=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
 const start=code.indexOf('      // Fixed same-original RW preparation snapshot'),stop=code.indexOf('      // Only the real private stage state',start);
 assert.ok(start>0&&stop>start,'Normal caller must prepare after the completed RO snapshot');
 const body=code.slice(start,stop);
 const request=Object.freeze({restoreId:'11111111-1111-4111-8111-111111111111',generation:'1',archiveDigest:'a'.repeat(64),targetProjectRef:'unit-only-recording'});
 const oldContext=Object.freeze({database_oid:'16384',backend_pid:123,transaction_id:'2',restore_id:request.restoreId,authority_generation:'1',
  archive_digest:request.archiveDigest,original_transaction_id:'1',private_rows:'2',transaction_authority:false,admission_resumed:false});
 const originalDataReadback=Object.freeze({current_context:oldContext});
 const context=Object.freeze({...oldContext,transaction_id:'3'});
 const makePreparation=(changes={})=>Object.freeze({requested_original:request,current_context:context,preparation_only:true,
  effect_allowed:false,transaction_authority:false,admission_resumed:false,complete_restore:false,
  resume_allowed:false,retry_allowed:false,rerun_import_allowed:false,...changes});
 const archive=Object.freeze({fixture:'recording DATA only, never a verified archive'});
 const evaluate=new Function('types','freshOriginalRequest','originalDataReadback','verifiedArchive','ports',
  'return (async()=>{let transactionAttempted=false,restorePhase;const db=ports.db;const requireOriginalArchiveSource=ports.source;'
  +'const prepareCommittedImmutableFreshAuthority=ports.prepare;try{'+body
  +'return {ok:true,authorityPreparation,transactionAttempted,restorePhase};}catch(error){return {ok:false,error,transactionAttempted,restorePhase};}})()');
 const sqls=['begin isolation level repeatable read read write','set local extra_float_digits = 3','set local search_path = pg_catalog, pg_temp','set local row_security = off',
  "select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-admission',0))",
  "select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))",
  'lock table public.custodial_release_authority_restore_inventory in share mode','rollback'];
 let cases=0,traps=0,thenReads=0;
 const run=async(settings={})=>{
  const trace=[],queries=[];let sourceCount=0,prepares=0;
  const failure=settings.failure??new Error('UNIT_RECORDING_REFUSAL');
  const db={async query(sql){queries.push(sql);trace.push('query:'+sql);if(settings.queryFailureAt===queries.length)throw failure;return {};}};
  const source=()=>{trace.push('source');sourceCount++;if(settings.sourceFailureAt===sourceCount)throw failure;};
  const prepare=async options=>{trace.push('prepare');prepares++;assert.deepEqual(Object.keys(options).sort(),['db','verifiedArchive']);
   assert.equal(options.db,db);assert.equal(options.verifiedArchive,archive);if(settings.prepareFailure)throw failure;
   return Object.hasOwn(settings,'value')?settings.value:makePreparation();};
  const result=await evaluate(types,request,originalDataReadback,archive,{db,source,prepare});cases++;
  return {...result,trace,queries,sourceCount,prepares,failure};
 };
 const good=await run();assert.equal(good.ok,true);assert.equal(good.transactionAttempted,false);assert.equal(good.prepares,1);
 assert.deepEqual(good.queries,sqls);assert.equal(good.authorityPreparation.preparation_only,true);
 for(let i=0;i<good.trace.length;i++)if(good.trace[i].startsWith('query:')||good.trace[i]==='prepare'){
  assert.equal(good.trace[i-1],'source');assert.equal(good.trace[i+1],'source');
 }
 assert.equal(good.trace.indexOf('prepare')>good.trace.indexOf('query:'+sqls[6]),true);
 assert.equal(good.trace.indexOf('prepare')<good.trace.indexOf('query:rollback'),true);
 for(let queryFailureAt=1;queryFailureAt<=sqls.length;queryFailureAt++){
  const result=await run({queryFailureAt});assert.equal(result.ok,false);assert.equal(result.error,result.failure);
  assert.equal(result.transactionAttempted,true);assert.equal(result.queries.length,queryFailureAt);
 }
 const lost=await run({prepareFailure:true});assert.equal(lost.ok,false);assert.equal(lost.error,lost.failure);assert.equal(lost.transactionAttempted,true);
 assert.deepEqual(lost.queries,sqls.slice(0,-1));
 for(let sourceFailureAt=1;sourceFailureAt<=good.sourceCount;sourceFailureAt++){
  const result=await run({sourceFailureAt});assert.equal(result.ok,false);assert.equal(result.error,result.failure);
  assert.equal(result.transactionAttempted,sourceFailureAt>1&&sourceFailureAt<good.sourceCount);
 }
 const badValues=[null,[],{},makePreparation({preparation_only:false}),makePreparation({extra:false}),
  makePreparation({requested_original:Object.freeze({...request,generation:1})}),
  makePreparation({requested_original:Object.freeze({...request,archiveDigest:'b'.repeat(64)})}),
  makePreparation({requested_original:Object.freeze({...request,extra:false})}),
  makePreparation({current_context:Object.freeze({...context,transaction_id:oldContext.transaction_id})}),
  makePreparation({current_context:Object.freeze({...context,transaction_id:oldContext.original_transaction_id})}),
  makePreparation({current_context:Object.freeze({...context,transaction_id:'01'})}),
  makePreparation({current_context:Object.freeze({...context,transaction_id:'9223372036854775808'})}),
  makePreparation({current_context:Object.freeze({...context,archive_digest:'b'.repeat(64)})}),
  makePreparation({current_context:Object.freeze({...context,private_rows:'3'})}),
  {...makePreparation()}];
 for(const key of ['effect_allowed','transaction_authority','admission_resumed','complete_restore','resume_allowed','retry_allowed','rerun_import_allowed'])
  badValues.push(makePreparation({[key]:true}));
 const getter={...makePreparation()};Object.defineProperty(getter,'preparation_only',{enumerable:true,get(){traps++;throw Error('No getter');}});
 // Async return necessarily probes then before the caller resumes. Permit
 // only that language-level lookup; caller validation must not touch traps.
 badValues.push(Object.freeze(getter),new Proxy({}, {get(target,key){if(key==='then'){thenReads++;return undefined;}traps++;throw Error('No proxy');},
  ownKeys(){traps++;throw Error('No proxy');},getPrototypeOf(){traps++;throw Error('No proxy');}}));
 for(const [badIndex,value]of badValues.entries()){const result=await run({value});assert.equal(result.ok,false);assert.equal(result.transactionAttempted,true);
  assert.equal(result.error.code,'IMMUTABLE_FRESH_AUTHORITY_PREPARATION_UNAVAILABLE',`Synthetic case ${badIndex}: ${result.error.name}: ${result.error.message}`);assert.equal(result.error.outcome,'UNKNOWN');
  assert.equal(result.error.retry_safe,false);assert.equal(result.error.commit_status,'ACKNOWLEDGED');assert.equal(result.error.resume_allowed,false);
  assert.deepEqual(result.queries,sqls.slice(0,-1));assert.equal(Object.hasOwn(result.error,'cause'),false);}
 assert.equal(traps,0);assert.ok(thenReads>0);
 assert.match(code,/inspectCommittedImmutableFreshData\(\{db,verifiedArchive\}\)/);
 assert.match(code.slice(0,start),/await db\.query\("rollback"\);\n      transactionAttempted = false;\n$/);
 assert.match(code,/original_data_readback:originalDataReadback,authority_preparation:authorityPreparation,state:"DATABASE_RESTORED"/);
 assert.doesNotMatch(body,/process\.env|stageVerified|commitVerified|inspectCommitted|freshIntent|finished:|\b(?:insert|update|delete|truncate|create|alter)\b/i);
 console.log(JSON.stringify({scope:'NEW normal RW preparation caller Source recording only',cases,query_shape:sqls,
  source_checks_per_success:good.sourceCount,preparation_calls_per_success:1,promise_then_probes:thenReads,connections:0,SQL:'NOT_RUN',private_ACK_state_created:0,
  signatures_created:0,old_groups:0,native_join:'NOT_RUN: pending separate importer-entry integration and Main owning fixture',resources0:true}));process.exit(0);
}

// Newly affected actual Source assertions and native-port refusals only. No
// positive branded archive/intent/context or native query is manufactured.
if(process.argv.includes('--post-database-explicit-temp-last-only')){
 const {runInNewContext}=await import('node:vm'),{default:pg}=await import('pg');
 const module=await import('./immutable-private-fresh-restore-commit-context.mjs');
 const code=readFileSync(new URL('./immutable-private-fresh-restore-commit-context.mjs',import.meta.url),'utf8');
 const start=code.indexOf("    assert.equal(row.actor,'supabase_admin');"),end=code.indexOf('    assert.equal(row.context_count,1);',start);
 assert.ok(start>=0&&end>start);const settings=code.slice(start,end);
 const contextRow={actor:'supabase_admin',session_actor:'supabase_admin',read_only:'on',isolation:'repeatable read',
  row_security:'off',replication:'origin',search_path:'pg_catalog, pg_temp',first_schema:'pg_catalog'};
 const check=(row,postDatabase=true)=>runInNewContext(settings,{assert,row,postDatabase,authorityPreparation:false,firstRead:{isolation:'repeatable read'}});
 check(contextRow);let componentRefusals=0;
 for(const search_path of ['pg_catalog','pg_temp, pg_catalog','public, pg_catalog, pg_temp','pg_catalog, public, pg_temp',
  'pg_catalog,pg_temp','"pg_catalog", pg_temp','pg_catalog, pg_temp, public','']){
  assert.throws(()=>check({...contextRow,search_path}));componentRefusals++;
 }
 for(const first_schema of ['pg_temp_1','public',null,undefined]){
  assert.throws(()=>check({...contextRow,first_schema}));componentRefusals++;
 }
 check({...contextRow,read_only:'off',search_path:'pg_catalog'},false);
 assert.throws(()=>check({...contextRow,read_only:'off'},false));componentRefusals++;
 const fenceChecks=code.match(/      assert\.equal\(firstRead\.search_path,'pg_catalog, pg_temp'\);assert\.equal\(firstRead\.first_schema,'pg_catalog'\);/g);
 assert.equal(fenceChecks?.length,1);const checkFence=firstRead=>runInNewContext(fenceChecks[0],{assert,firstRead});
 checkFence(contextRow);
 for(const firstRead of [{...contextRow,search_path:'pg_catalog'},{...contextRow,first_schema:'pg_temp_1'},
  {...contextRow,first_schema:null}]){assert.throws(()=>checkFence(firstRead));componentRefusals++;}
 const fenceStart=code.indexOf('const postDatabaseFenceSql='),fenceEnd=code.indexOf('const postDatabaseContextSql=',fenceStart);
 assert.match(code.slice(fenceStart,fenceEnd),/pg_catalog\.current_setting\('search_path'\) search_path,\(pg_catalog\.current_schemas\(true\)\)\[1\] first_schema/);
 assert.match(code,/\.replace\("pg_catalog\.current_setting\('search_path'\) search_path,",/);
 const fenceKeys="'database_oid','backend_pid','transaction_id','read_only','isolation','search_path','first_schema','held_fences','recovery_inventory'";
 assert.equal(code.split(fenceKeys).length-1,2); // before/after closed observations
 assert.match(code,/assert\.deepEqual\(closed\(one\(await raw\(postDatabase\?postDatabaseFenceSql:fenceSql\)\)/);
 assert.match(code,/\]\),firstRead\);\n    current\(\);return postDatabase\?/);
 const nativeQuery=pg.Client.prototype.query,nativeEnd=pg.Client.prototype.end,client=new pg.Client();let nativeRefusals=0,traps=0;
 const finished={database_oid:'16384',backend_pid:123,transaction_id:'1',restore_id:'11111111-1111-4111-8111-111111111111',
  authority_generation:'1',archive_digest:'a'.repeat(64),private_rows:'2',transaction_authority:false,admission_resumed:false};
 const refusal=error=>{assert.equal(error.code,'IMMUTABLE_FRESH_POST_DATABASE_CONTEXT_UNAVAILABLE');assert.equal(error.check_phase,'INPUT');
  assert.equal(error.outcome,'UNKNOWN');assert.equal(error.retry_safe,false);nativeRefusals++;return true;};
 try{
  for(const db of [client,{query(){traps++;throw Error('No injected port');}},new Proxy({}, {getPrototypeOf(){traps++;throw Error('No proxy');}})])
   await assert.rejects(module.readVerifiedImmutableFreshPostDatabaseContext({db,verifiedArchive:{},freshIntent:{},finished}),refusal);
  assert.equal(traps,0);assert.equal(client._connected,false);assert.equal(client._connecting,false);assert.equal(pg.Client.prototype.query,nativeQuery);
 }finally{await Reflect.apply(nativeEnd,client,[]);}
 console.log(JSON.stringify({scope:'NEW explicit temp-last Source-component checks and native-port refusals',component_refusals:componentRefusals,
  native_refusals:nativeRefusals,old_search_path_contract_unchanged:true,before_after_path_observations:'SOURCE_BOUND_ONLY',
  positive_native_context:'NOT_RUN: Main owning SQL required',native_query_monkeypatches:0,connections:0,SQL:'NOT_RUN',old_groups:0,resources0:true}));process.exit(0);
}

// Newly affected bounded failure wire only; no positive native context or
// previous group replay. The native query prototype is never monkeypatched.
if(process.argv.includes('--post-database-check-phase-only')){
 const {default:pg}=await import('pg'),module=await import('./immutable-private-fresh-restore-commit-context.mjs');
 const read=module.readVerifiedImmutableFreshPostDatabaseContext;
 const phases=['INPUT','NATIVE_FENCE','ORIGINAL_CONTEXT','SOURCE_EPOCH','CURRENT_CONTROL','DATABASE_MARKERS','FINAL_FENCE'];
 const finished={database_oid:'16384',backend_pid:123,transaction_id:'1',restore_id:'11111111-1111-4111-8111-111111111111',
  authority_generation:'1',archive_digest:'a'.repeat(64),private_rows:'2',transaction_authority:false,admission_resumed:false};
 const nativeQuery=pg.Client.prototype.query,nativeEnd=pg.Client.prototype.end,client=new pg.Client();let traps=0,refusals=0;
 const proxy=new Proxy({}, {get(){traps++;throw Error('private trap');},ownKeys(){traps++;throw Error('private trap');},getPrototypeOf(){traps++;throw Error('private trap');}});
 const assertFailure=error=>{
  assert.equal(error.code,'IMMUTABLE_FRESH_POST_DATABASE_CONTEXT_UNAVAILABLE');assert.equal(error.outcome,'UNKNOWN');assert.equal(error.retry_safe,false);
  assert.equal(error.check_phase,'INPUT');assert.equal(Object.getOwnPropertyDescriptor(error,'check_phase').value,'INPUT');
  assert.deepEqual(Object.keys(error).sort(),['code','outcome','retry_safe','check_phase'].sort());
  assert.equal(error.message,'IMMUTABLE_FRESH_POST_DATABASE_CONTEXT_UNAVAILABLE');assert.equal(Object.hasOwn(error,'cause'),false);
  assert.equal(Object.hasOwn(error,'actual'),false);assert.equal(Object.hasOwn(error,'expected'),false);refusals++;return true;
 };
 try{
  for(const options of [null,{},proxy,{db:null,verifiedArchive:{},freshIntent:{},finished},
   {db:client,verifiedArchive:{},freshIntent:{},finished:{...finished,database_oid:16384}},
   {db:client,verifiedArchive:{},freshIntent:{},finished:{...finished,transaction_id:'01'}},
   {db:client,verifiedArchive:{},freshIntent:{},finished}])await assert.rejects(read(options),assertFailure);
  const accessor={verifiedArchive:{},freshIntent:{},finished};Object.defineProperty(accessor,'db',{enumerable:true,get(){traps++;throw Error('private getter');}});
  await assert.rejects(read(accessor),assertFailure);
  for(const original of [module.readVerifiedImmutableFreshCommitPreparation,module.readVerifiedImmutableFreshCommitRecord]){
   await assert.rejects(original({db:null,verifiedArchive:{},freshIntent:{}}),error=>{
    assert.equal(error.code,'IMMUTABLE_FRESH_COMMIT_CONTEXT_UNAVAILABLE');assert.equal(Object.hasOwn(error,'check_phase'),false);
    assert.deepEqual(Object.keys(error).sort(),['code','outcome','retry_safe'].sort());return true;});
  }
  const code=readFileSync(new URL('./immutable-private-fresh-restore-commit-context.mjs',import.meta.url),'utf8');
  const assignments=[...code.matchAll(/(?:let checkPhase=|if\(postDatabase\)checkPhase=)'([A-Z_]+)'/g)].map(match=>match[1]);
  assert.deepEqual([...new Set(assignments)].sort(),phases.slice().sort());
  assert.match(code,/if\(postDatabase\)failure\.check_phase=checkPhase;/);
  assert.doesNotMatch(code,/checkPhase\s*=\s*(?:options|priorData|error|row|ctx|firstRead)\b/);
  assert.match(code,/failure\.sql_state=code\.value/);assert.equal(traps,0);assert.equal(pg.Client.prototype.query,nativeQuery);
  assert.equal(client._connecting,false);assert.equal(client._connected,false);
 }finally{await Reflect.apply(nativeEnd,client,[]);}
 console.log(JSON.stringify({scope:'NEW bounded post-DATABASE reader failure field',refusals,phase_values:phases,old_error_contracts_unchanged:true,
  native_query_monkeypatches:0,connections:0,SQL:'NOT_RUN',later_native_phases:'SOURCE_BOUND_ONLY_PENDING_MAIN',old_groups:0,resources0:true}));process.exit(0);
}

// New actual-module refusal cases only. No native method monkeypatch, signed
// token manufacture, SQL fixture, historical groups or positive context claim.
if(process.argv.includes('--post-database-original-context-refusals-only')){
 const module=await import('./immutable-private-fresh-restore-commit-context.mjs'),{default:pg}=await import('pg');
 const read=module.readVerifiedImmutableFreshPostDatabaseContext,cases=[];let traps=0;
 assert.deepEqual(Object.keys(module).sort(),['readVerifiedImmutableFreshCommitPreparation','readVerifiedImmutableFreshCommitRecord','readVerifiedImmutableFreshPostDatabaseContext','readVerifiedImmutableFreshAuthorityPreparation'].sort());
 const finished=Object.freeze({database_oid:'16384',backend_pid:123,transaction_id:'9007199254740993',restore_id:'11111111-1111-4111-8111-111111111111',
  authority_generation:'1',archive_digest:'a'.repeat(64),private_rows:'2',transaction_authority:false,admission_resumed:false});
 const archive=Object.freeze({}),token=Object.freeze({});
 const expected=error=>{assert.equal(error.code,'IMMUTABLE_FRESH_POST_DATABASE_CONTEXT_UNAVAILABLE');assert.equal(error.outcome,'UNKNOWN');assert.equal(error.retry_safe,false);return true;};
 const refuse=value=>assert.rejects(read(value),expected);
 const run=async(name,work)=>{await work();cases.push(name);console.log('POST_DATABASE_CONTEXT_NEW '+name+' PASS');};
 const nativeQuery=pg.Client.prototype.query,nativeEnd=pg.Client.prototype.end;
 const client=new pg.Client({connectionString:'postgresql://unit_only@not-contacted.invalid/unit_only'});
 try{
  await run('closed-options-and-native-port-refusal',async()=>{
   const proxy=new Proxy({}, {get(){traps++;throw Error('No proxy access');},getPrototypeOf(){traps++;throw Error('No proxy access');},ownKeys(){traps++;throw Error('No proxy access');}});
   for(const value of [null,undefined,[],proxy,{}, {db:client,verifiedArchive:archive,freshIntent:token,finished,extra:false}])await refuse(value);
   const getter={verifiedArchive:archive,freshIntent:token,finished};Object.defineProperty(getter,'db',{enumerable:true,get(){traps++;throw Error('No getter access');}});await refuse(getter);
   for(const db of [null,{},Object.create(null),proxy,{query(){traps++;throw Error('No injected query');}}])await refuse({db,verifiedArchive:archive,freshIntent:token,finished});
   const own=new pg.Client();Object.defineProperty(own,'query',{get(){traps++;throw Error('No query getter');}});
   try{await refuse({db:own,verifiedArchive:archive,freshIntent:token,finished});}finally{await Reflect.apply(nativeEnd,own,[]);}
   class OtherClient extends pg.Client{}const other=new OtherClient();
   try{await refuse({db:other,verifiedArchive:archive,freshIntent:token,finished});}finally{await Reflect.apply(nativeEnd,other,[]);}
   assert.equal(traps,0);
  });
  await run('closed-finished-data-and-int64-oid-bounds',async()=>{
   const changes=[['database_oid',16384],['database_oid','0'],['database_oid','4294967296'],['database_oid','016384'],
    ['backend_pid','123'],['backend_pid',0],['backend_pid',2147483648],['transaction_id',9007199254740992],
    ['transaction_id','01'],['transaction_id','9223372036854775808'],['transaction_id','1\n'],['restore_id','foreign'],
    ['authority_generation',1],['authority_generation','0'],['archive_digest','b'.repeat(63)],['private_rows',2],['private_rows','-1'],
    ['private_rows','9223372036854775808'],['transaction_authority',true],['admission_resumed',true],['extra',false]];
   for(const [key,value]of changes)await refuse({db:client,verifiedArchive:archive,freshIntent:token,finished:{...finished,[key]:value}});
   for(const value of [null,[],Object.create(null),new Proxy(finished,{get(){traps++;throw Error('No finished proxy');}})])
    await refuse({db:client,verifiedArchive:archive,freshIntent:token,finished:value});
   const accessor={...finished};Object.defineProperty(accessor,'private_rows',{enumerable:true,get(){traps++;throw Error('No finished getter');}});
   await refuse({db:client,verifiedArchive:archive,freshIntent:token,finished:accessor});assert.equal(traps,0);
  });
  await run('public-archive-and-finished-json-never-mint-original-context',async()=>{
   for(const value of [finished,{...finished,transaction_id:'9223372036854775807'},Object.freeze({...finished,private_rows:'0'})])
    await refuse({db:client,verifiedArchive:archive,freshIntent:token,finished:value});
   for(const db of [{},null])for(const originalRead of [module.readVerifiedImmutableFreshCommitPreparation,module.readVerifiedImmutableFreshCommitRecord])
    await assert.rejects(originalRead({db,verifiedArchive:archive,freshIntent:token}),error=>error.code==='IMMUTABLE_FRESH_COMMIT_CONTEXT_UNAVAILABLE');
   assert.equal(client._connecting,false);assert.equal(client._connected,false);assert.equal(pg.Client.prototype.query,nativeQuery);
  });
  await run('fixed-new-transaction-and-lossless-source-epoch-contract',()=>{
   const code=readFileSync(new URL('./immutable-private-fresh-restore-commit-context.mjs',import.meta.url),'utf8');
   assert.match(code,/assert\.notEqual\(first\.transaction_id,prior\.transaction_id/);
   assert.match(code,/assert\.equal\(firstRead\.read_only,authorityPreparation\?'off':'on'\)/);assert.match(code,/\['repeatable read','serializable'\]/);
   assert.match(code,/authorityPreparation=false/);assert.match(code,/row\.read_only,postDatabase&&!authorityPreparation\?'on':'off'/);
   assert.match(code,/memphis-zoo-application-mutation-admission/);assert.match(code,/memphis-zoo-application-mutation-fence/);
   assert.match(code,/immutable_import_source_inventory_state\(\)/);assert.match(code,/shape_matches/);
   assert.match(code,/Original canonical Source rowset\/count\/relation identity changed/);assert.match(code,/Original Source relation was rewritten/);
   assert.match(code,/New transaction has already mutated Source inventory/);assert.match(code,/original_transaction_id:finished\.transaction_id/);
   assert.doesNotMatch(code,/pg_advisory_(?:xact_)?lock\s*\(|\bLOCK\s+TABLE\b|\bSET\s+(?:LOCAL|ROLE)\b|\b(?:BEGIN|COMMIT|ROLLBACK);/i);
  });
 }finally{await Reflect.apply(nativeEnd,client,[]);}
 assert.equal(pg.Client.prototype.query,nativeQuery);assert.equal(traps,0);
 console.log(JSON.stringify({scope:'NEW native-port/closed-input refusals and fixed Source contract only',cases,count:cases.length,
  positive_native_context:'NOT_RUN: Main owns actual acknowledged COMMIT, same-backend new RR READ ONLY transaction, BOTH advisory fences and inventory SHARE lock',
  native_query_monkeypatches:0,connections:0,SQL:'NOT_RUN',new_signatures:0,old_groups:0,resources0:true}));process.exit(0);
}

let refusalDriver;
// Main owns the native client, transaction, canonical fixture and BOTH global
// fences. This adversarial member owns only its fixed savepoint; it does not
// create/repair a fixture, acquire fences, commit/end, or close the archive.
export async function runImmutableFreshSourceRefusalCase(db,verifiedArchive,profile){
 if(!['NO_GLOBAL_FENCES','POPULATED_ORIGINAL'].includes(profile))throw new Error('Fixed Source refusal profile required.');
 if(!db||typeof db!=='object'||types.isProxy(db)||Object.hasOwn(db,'query')
   ||Object.getPrototypeOf(db)===Object.prototype||Object.getPrototypeOf(db)===null)
  throw new Error('Original native refusal client required.');
 if(!refusalDriver){const {default:pg}=await import('pg');refusalDriver=Object.freeze({Client:pg.Client,query:pg.Client.prototype.query});}
 const {Client,query:nativeQuery}=refusalDriver;
 const native=()=>{
  if(types.isProxy(db)||Object.getPrototypeOf(db)!==Client.prototype||Object.hasOwn(db,'query')||Client.prototype.query!==nativeQuery)
   throw new Error('Original native refusal client changed.');
 };
 native();
 const {initializeVerifiedImmutableFreshSource}=await import('./immutable-private-source-initializer.mjs');
 const source=await prepareVerifiedImmutableBootstrapSource(verifiedArchive);
 const current=()=>{native();assertVerifiedImmutableBootstrapSource(source,verifiedArchive);};
 const raw=async(sql,args=[])=>{native();return await Reflect.apply(nativeQuery,db,[sql,args]);};
 const read=async(sql,args=[])=>{current();const result=await raw(sql,args);current();return result;};
 const scopes=['public','auth','storage','custodial_release_identity'];
 assert.deepEqual([...source.sourceBinding.summary.backed_up_schemas].sort(),scopes.slice().sort());
 const relations=JSON.parse(source.inventory['inventory/original-relations.json']);
 assert.ok(Array.isArray(relations)&&relations.length>0);
 const quote=value=>'"'+value.replaceAll('"','""')+'"',countArgs=[],names=new Set();
 for(const row of relations){
  assert.ok(scopes.includes(row.schema_name)&&row.relation_kind==='r'&&row.is_partition===false);
  assert.equal(typeof row.table_name,'string');assert.ok(row.table_name.length>0&&!row.table_name.includes('\0'));
  const key=JSON.stringify([row.schema_name,row.table_name]);assert.ok(!names.has(key));names.add(key);
  countArgs.push(row.schema_name,row.table_name);
 }
 // The actual unsafe builtin belongs in EVERY count branch, not an outer
 // projection. Keep the signed Source order without locale/Append ordering
 // assumptions; the ordinal is internal and is not returned to the caller.
 const countSql='select schema_name,table_name,row_count,transaction_id from ('+relations.map((row,i)=>'select '+i
  +'::integer source_ordinal,$'+(i*2+1)+'::text schema_name,$'+(i*2+2)
  +'::text table_name,count(*)::text row_count,pg_catalog.txid_current()::text transaction_id from ONLY '
  +quote(row.schema_name)+'.'+quote(row.table_name)).join(' union all ')+') original_counts order by source_ordinal';
 const contextSql=`select current_user actor,session_user session_actor,current_database() database,
  (select oid::text from pg_catalog.pg_database where datname=current_database()) database_oid,
  pg_backend_pid() backend_pid,pg_catalog.txid_current()::text transaction_id,
  (select proparallel::text from pg_catalog.pg_proc where oid='pg_catalog.txid_current()'::pg_catalog.regprocedure) counter_parallel_safety,
  current_setting('transaction_read_only') readonly,current_setting('session_replication_role') replication,
  current_setting('row_security') row_security,current_setting('search_path') search_path,
  (select pg_get_userbyid(datdba) from pg_catalog.pg_database where datname=current_database()) database_owner,
  (select pg_get_userbyid(nspowner) from pg_catalog.pg_namespace where nspname='custodial_dr') dr_owner,
  (select count(*)::int from pg_catalog.pg_class where oid in(to_regclass('custodial_dr.restore_control'),
   to_regclass('custodial_dr.restore_manifests'),to_regclass('custodial_dr.application_mutation_leases'),
   to_regclass('custodial_release_identity.group_original_creations'),to_regclass('custodial_release_identity.employee_message_original_outcomes'))
   and relkind='r' and relowner=(select oid from pg_catalog.pg_roles where rolname=current_user)) original_owned_relations,
  (select count(*)::int from custodial_dr.application_mutation_leases) active_leases,
  (select count(*)::int from unnest(array['memphis-zoo-application-mutation-admission','memphis-zoo-application-mutation-fence']) f(name)
   where exists(select 1 from pg_catalog.pg_locks l where l.locktype='advisory' and l.pid=pg_backend_pid()
    and l.database=(select oid from pg_catalog.pg_database where datname=current_database()) and l.granted and l.mode='ExclusiveLock'
    and l.classid=((hashtextextended(f.name,0)>>32)&4294967295)::oid
    and l.objid=(hashtextextended(f.name,0)&4294967295)::oid and l.objsubid=1)) held_fences`;
 // Fixed affected metadata only. TEXT JSON snapshots avoid JavaScript numeric
 // coercion of original generations/rows; none is logged or used as authority.
 const metadataSql=`select
  (select count(*)::text from custodial_dr.restore_control) controls,
  (select count(*)::text from custodial_dr.restore_manifests) manifests,
  (select count(*)::text from custodial_dr.restore_events) events,
  (select count(*)::text from supabase_migrations.schema_migrations) migrations,
  (select count(*)::text from cron.job) jobs,
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text from custodial_dr.restore_control t) control_rows,
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text from custodial_dr.restore_manifests t) manifest_rows,
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text from custodial_dr.restore_events t) event_rows,
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text from custodial_dr.application_mutation_leases t) lease_rows,
  (select coalesce(jsonb_agg(jsonb_build_object('oid',c.oid::text,'name',c.relname,'kind',c.relkind,
   'owner',c.relowner::text,'acl',c.relacl::text,'rls',c.relrowsecurity,'force',c.relforcerowsecurity)
   order by c.oid),'[]'::jsonb)::text from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where n.nspname='custodial_dr' and c.relname in('immutable_private_import_context','immutable_private_import_rows','immutable_ordinary_import_rows')) private_source_relations,
  (select coalesce(jsonb_agg(jsonb_build_object('oid',p.oid::text,'identity',p.oid::regprocedure::text,
   'definition',pg_get_functiondef(p.oid),'owner',p.proowner::text,'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig)
   order by p.oid),'[]'::jsonb)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
   where n.nspname='custodial_dr' and p.prokind='f' and p.proname in('immutable_import_context_source_immutable',
   'immutable_import_staged_rows_immutable','immutable_import_owner_fence','immutable_import_source_inventory_state',
   'immutable_import_target_shape','immutable_import_assert_context','begin_immutable_private_import','immutable_import_matches_ordinary_staged',
   'insert_immutable_ordinary_row','stage_immutable_ordinary_row','insert_staged_immutable_ordinary_table','stage_immutable_private_row',
   'immutable_import_matches_staged','finish_immutable_private_import')) private_source_functions`;
 const snapshot=async()=>{
  const contextResult=await read(contextSql);assert.equal(contextResult.rowCount,1);const context=contextResult.rows[0];
  const shape=(await read(`select n.nspname schema_name,c.relname table_name,c.relkind::text relation_kind,c.relispartition is_partition,
   pg_get_userbyid(c.relowner) owner_name,c.relrowsecurity,c.relforcerowsecurity
   from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where n.nspname=any($1::text[]) and c.relkind in('r','p','f') order by n.nspname,c.relname`,[scopes])).rows;
  assert.deepEqual(shape,relations,'Original declared relation set differs');
  const fixedResult=await read(metadataSql);assert.equal(fixedResult.rowCount,1);
  assert.equal(context.counter_parallel_safety,'u','Actual transaction counter must be parallel-unsafe');
  assert.equal(typeof context.transaction_id,'string');assert.match(context.transaction_id,/^[1-9][0-9]{0,18}(?![\s\S])/);
  assert.deepEqual((await read(contextSql)).rows,[context],'Original count transaction/parallel contract changed');
  const countResult=await read(countSql,countArgs),counts=countResult.rows;
  assert.equal(countResult.rowCount,relations.length);assert.equal(counts.length,relations.length);
  const counted=new Set();
  for(let i=0;i<counts.length;i++){
   const count=counts[i],relation=relations[i];
   assert.deepEqual(Reflect.ownKeys(count).sort(),['schema_name','table_name','row_count','transaction_id'].sort());
   assert.equal(count.schema_name,relation.schema_name);assert.equal(count.table_name,relation.table_name);
   assert.equal(count.transaction_id,context.transaction_id,'Count belongs to another original transaction');
   assert.equal(typeof count.row_count,'string');assert.match(count.row_count,/^(0|[1-9][0-9]*)(?![\s\S])/);
   const key=JSON.stringify([count.schema_name,count.table_name]);assert.ok(!counted.has(key),'Duplicate original count member');counted.add(key);
  }
  assert.deepEqual(counted,names,'Original count membership differs');
  assert.deepEqual((await read(contextSql)).rows,[context],'Original count transaction/parallel contract changed after read');
  const recipes=(await read(`select i.identity,p.oid::text oid,pg_get_functiondef(p.oid) definition,
   p.prosrc,pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.prosecdef definer,p.proconfig config
   from unnest($1::text[]) with ordinality i(identity,ordinality)
   left join pg_catalog.pg_proc p on p.oid=to_regprocedure(i.identity) and p.prokind='f' order by i.ordinality`,
   [source.recipes.map(recipe=>recipe.identity)])).rows;
  assert.equal(recipes.length,source.recipes.length);
  return {context,shape,fixed:fixedResult.rows[0],counts,recipes};
 };
 let saved=false,before,afterRollback,failed=false,failure,refused=false,refusal,initializerCalls=0,preRollback='NOT_REACHED';
 const cleanup=[];
 try{
  current();await raw('SAVEPOINT immutable_fresh_source_refusal_case');saved=true;current();
  before=await snapshot();const context=before.context;
  assert.equal(context.actor,'supabase_admin');assert.equal(context.session_actor,context.actor);assert.equal(context.readonly,'off');
  assert.equal(context.replication,'origin');assert.equal(context.row_security,'off');assert.equal(context.search_path,'pg_catalog');
  assert.equal(context.database_owner,'postgres');assert.equal(context.dr_owner,'postgres');
  assert.equal(context.original_owned_relations,5);assert.equal(context.active_leases,0);
  assert.equal(typeof context.database_oid,'string');assert.match(context.database_oid,/^[1-9][0-9]{0,9}(?![\s\S])/);
  assert.ok(BigInt(context.database_oid)<=4294967295n);assert.ok(Number.isInteger(context.backend_pid)&&context.backend_pid>0);
  assert.equal(typeof context.transaction_id,'string');assert.match(context.transaction_id,/^[1-9][0-9]{0,18}(?![\s\S])/);
  assert.ok(Number.isInteger(context.held_fences)&&context.held_fences>=0&&context.held_fences<=2);
  assert.deepEqual((await read(contextSql)).rows[0],context,'Same caller transaction/owner/fences required');
  for(let i=0;i<source.recipes.length;i++){
   assert.equal(before.recipes[i].identity,source.recipes[i].identity);assert.equal(before.recipes[i].owner,'supabase_admin');
   assert.equal(before.recipes[i].definition,source.recipes[i].before,'Original recipe predecessor required');
  }
  const total=before.counts.reduce((sum,row)=>sum+BigInt(row.row_count),0n);
  if(profile==='NO_GLOBAL_FENCES')assert.notEqual(context.held_fences,2,'Declared missing-fence prerequisite does not exist');
  else{assert.equal(context.held_fences,2,'Both original global fences required');assert.ok(total>0n,'Declared populated original does not exist');}
  initializerCalls++;
  try{await initializeVerifiedImmutableFreshSource({db,verifiedArchive});}catch(error){refused=true;refusal=error;}
  // A SQL-error-aborted transaction cannot establish pre-rollback no-effects.
  // Always restore only our savepoint below; never call that rollback evidence
  // that the initializer made no changes before its refusal.
  try{const after=await snapshot();assert.deepEqual(after,before,'Initializer refusal changed fixed original metadata');preRollback='METADATA_IDENTICAL';}
  catch(error){if(error?.code==='25P02')preRollback='UNAVAILABLE_SQL_TRANSACTION_ABORTED';else throw error;}
  assert.ok(refused,'Initializer unexpectedly succeeded on declared bad prerequisite');
  assert.equal(refusal?.code,'ERR_ASSERTION','Initializer refused a different/unsupported prerequisite');
  assert.equal(refusal?.operator,'strictEqual');
  if(profile==='NO_GLOBAL_FENCES'){assert.equal(refusal.actual,context.held_fences);assert.equal(refusal.expected,2);}
  else{
   const first=relations.map(row=>before.counts.find(count=>count.schema_name===row.schema_name&&count.table_name===row.table_name))
    .find(row=>BigInt(row.row_count)>0n);
   assert.equal(refusal.actual,first.row_count);assert.equal(refusal.expected,'0');
   assert.ok(refusal.message.startsWith('Fresh Source target contains original application DATA'));
  }
 }catch(error){failed=true;failure=error;}
 finally{
  if(saved){
   let rolledBack=false,released=false;
   try{await raw('ROLLBACK TO SAVEPOINT immutable_fresh_source_refusal_case');rolledBack=true;}catch(error){cleanup.push(error);}
   try{await raw('RELEASE SAVEPOINT immutable_fresh_source_refusal_case');released=true;}catch(error){cleanup.push(error);}
   if(rolledBack&&released&&before)try{afterRollback=await snapshot();assert.deepEqual(afterRollback,before,'Original metadata changed after own rollback');}catch(error){cleanup.push(error);}
  }
 }
 if(failed||cleanup.length){
  const original=refused?refusal:failure;
  const errors=[...(failed?[failure]:[]),...cleanup];if(refused&&original!==failure)errors.unshift(original);
  throw new AggregateError(errors,'Immutable fresh Source refusal case failed; pre-rollback observation: '+preRollback,
   {cause:original??errors[0]});
 }
 assert.equal(initializerCalls,1);assert.ok(afterRollback,'Own rollback verification unavailable');current();
 return Object.freeze({profile,initializer_calls:initializerCalls,expected_prerequisite_refused:true,
  before_rollback:preRollback,after_own_rollback:'METADATA_IDENTICAL',caller_transaction_owned:false,target_authority:false});
}

// Imports (including Main's explicit query-mode flag) never run historical
// composition cases, old Source pins, process.exit or any SQL automatically.
const reconciliationCommitMode=process.argv.includes('--reconciliation-commit-outcome-source-only');
const reconciliationReplayInt8Mode=process.argv.includes('--reconciliation-current-replay-int8-source-only');
const reconciliationExpiryJoinMode=process.argv.includes('--reconciliation-expiry-int8-join-source-only');
const reconciliationManifestPinsMode=process.argv.includes('--reconciliation-original-manifest-pins-source-only');
const reconciliationPausedControlMode=process.argv.includes('--reconciliation-paused-control-pins-source-only');
if(reconciliationCommitMode||reconciliationReplayInt8Mode||reconciliationExpiryJoinMode||reconciliationManifestPinsMode||reconciliationPausedControlMode){
 // Exact shipping lifecycle Source, extracted AFTER signature/configuration
 // admission. All ports below are explicitly INERT recording objects, never
 // native clients, valid signed intents, SQL authority or a CLI fallback.
 const code=readFileSync(new URL('./apply-production-restore-reconciliation.mjs',import.meta.url),'utf8');
 const start=code.indexOf('// Read-request DATA only:');assert.ok(start>0);
 assert.match(code,/import \{ types \} from "node:util";/);
 assert.match(code,/const nativeQuery = nativeClientPrototype.query;/);
 assert.match(code,/const nativeConnect = nativeClientPrototype.connect;/);
 assert.match(code,/const nativeEnd = nativeClientPrototype.end;/);
 const body=code.slice(start);
 assert.doesNotMatch(body,/process\.exit\(/);
 assert.equal((body.match(/Reflect\.apply\(nativeQuery, db, \["commit"\]\)/g)||[]).length,1);
 assert.equal((body.match(/await commitOriginalReconciliationOnce\(\)/g)||[]).length,2);
 const {stableJson}=await import('./disaster-recovery-crypto.mjs');
 const {createRequire}=await import('node:module');
 const require=createRequire(import.meta.url);
 const Result=require('pg/lib/result'); // real parser shape, NO client/connection
 const pgTypes=require('pg').types;
 const int8Parser=pgTypes.getTypeParser(20);
 const receipt=(command='COMMIT')=>{const r=new Result();r.addCommandComplete({text:command});return r;};
 const sha=value=>createHash('sha256').update(value).digest('hex');
 const intent=Object.freeze({restore_id:'11111111-1111-4111-8111-111111111111',authority_generation:7,
  reconciliation_id:'22222222-2222-4222-8222-222222222222',archive_digest:'a'.repeat(64),actor:'INERT_SOURCE_RECORDING_ACTOR',
  final_manifest_sha256:'b'.repeat(64),discrepancy_snapshot_sha256:sha(stableJson([])),
  resolutions:Object.freeze([]),storage_supported_state_resample:null,target_project_ref:'recording_source_only'});
 // Actual installed default int8 parser, not a fabricated numeric SQL row.
 // Signed intent remains numeric; both recorded SQL control branches are text.
 const controlGeneration=int8Parser(String(intent.authority_generation));
 assert.equal(typeof controlGeneration,'string');assert.equal(controlGeneration,'7');
 const expectedRequest={restore_id:intent.restore_id,authority_generation:intent.authority_generation,
  reconciliation_id:intent.reconciliation_id,archive_digest:intent.archive_digest};
 const projectRef='recording_source_only';
 const evaluate=new Function('Client','nativeClientPrototype','nativeQuery','nativeConnect','nativeEnd','types','db',
  'intent','intentDigest','projectRef','sha256','stableJson','discrepancySnapshot','process','console','allowCrashProbe',
  'originalReconciliationExpiresAt','originalReconciliationExpiresAtMs','Date',
  'return (async()=>{'+body+`
   let duplicateRefused=false;
   if(commitAttempted){try{await commitOriginalReconciliationOnce();}catch(error){duplicateRefused=/already attempted/.test(error.message);}}
   return {failed,failure,commitAttempted,commitConfirmed,duplicateRefused,originalReconciliationRequest};
  })();`);
 const invoke=async(config={})=>{
  const trace=[],output=[],diagnostics=[];let thrown,caught=false,value;
  // Explicit inert clock/input DATA for Source composition ONLY. Neither this
  // clock nor the boolean recording below is a genuine signed/DB/G28 witness.
  const recordedNow=Date.parse('2026-10-17T12:00:00.000Z'),recordedExpiry=recordedNow+30000;
  let lifetimeReads=0,commitReturned=false;
  const recordedDate={now:()=>recordedNow+(config.expireAfterCommit&&commitReturned?30001:0)};
  const processPort={env:{RESTORE_RECONCILIATION_TEST_FAIL_BEFORE_COMMIT:config.precommitProbe?'true':''},exitCode:undefined};
  const fault=name=>{if(Object.hasOwn(config,name))throw config[name];};
  class RecordingClient{
   async connect(){trace.push({phase:'connect'});fault('connectError');}
   async end(){trace.push({phase:'end'});fault('endError');}
   async query(sql,args=[]){
    const s=sql.trim();let phase;
    if(s==='commit')phase='commit';else if(s==='rollback')phase='rollback';
    else if(s==='select pg_catalog.clock_timestamp() < $1::pg_catalog.timestamptz as original_intent_current')phase='lifetime';
    else if(s.startsWith('select pg_advisory_unlock('))phase='unlock';
    else if(s.startsWith('select pg_advisory_lock('))phase='lock';
    else if(s==='begin isolation level serializable')phase='begin';
    else if(s.startsWith('select pg_advisory_xact_lock('))phase='fence';
    else if(s.startsWith('select * from custodial_dr.restore_control'))phase='control';
    else if(s.startsWith('select 1 from custodial_dr.restore_events'))phase='prior';
    else if(s.startsWith('select * from custodial_dr.restore_manifests'))phase='manifest';
    else if(s.startsWith('select category,status,'))phase='discrepancies';
    else if(s.startsWith('select count(*)::int count from custodial_dr.restore_discrepancies'))phase='remaining';
    else if(s.startsWith('select count(*)::int count from custodial_dr.application_mutation_leases'))phase='leases';
    else if(s.startsWith('update custodial_dr.restore_control set'))phase='complete';
    else if(s.startsWith('insert into custodial_dr.restore_events'))phase='event';
    else throw new Error('Unexpected recording statement');
    trace.push({phase,sql,args});fault(phase+'Error');
    if(phase==='commit'){commitReturned=true;return Object.hasOwn(config,'receipt')?config.receipt:receipt();}
    if(phase==='lifetime'){
     lifetimeReads++;assert.deepEqual(args,[new Date(recordedExpiry).toISOString()]);
     const r=receipt('SELECT 1');r.rows=[{original_intent_current:pgTypes.getTypeParser(16)(config.expireServerAt===lifetimeReads?'f':'t')}];return r;
    }
    if(phase==='control'){
     // Actual SELECT receipt metadata and installed native scalar shapes.
     // These rows remain inert fixture DATA, never current-control authority.
     const row=config.replay?{state:'COMPLETE',mutations_paused:false,
      restore_id:intent.restore_id,authority_generation:controlGeneration,archive_digest:intent.archive_digest,
      target_project_ref:intent.target_project_ref,...config.replayControl}:
      {singleton:pgTypes.getTypeParser(16)('t'),state:pgTypes.getTypeParser(25)('PAUSED_RECONCILIATION'),
       mutations_paused:pgTypes.getTypeParser(16)('t'),restore_id:pgTypes.getTypeParser(2950)(intent.restore_id),
       authority_generation:controlGeneration,archive_digest:pgTypes.getTypeParser(25)(intent.archive_digest),
       target_project_ref:pgTypes.getTypeParser(25)(projectRef),...config.pausedControl};
     const r=receipt('SELECT 1');
     r.rows=Object.hasOwn(config,'controlRows')?config.controlRows:
      Array.from({length:config.controlCopies??1},()=>({...row}));
     r.rowCount=Object.hasOwn(config,'controlRowCount')?config.controlRowCount:Array.isArray(r.rows)?r.rows.length:1;
     return r;
    }
    if(phase==='prior')return {rowCount:config.unmatchedReplay?0:1};
    if(phase==='manifest'){
     // Real SELECT receipt shape and installed scalar parsers, not omitted
     // original columns or numeric bigint substitutes. No database executes.
     const row={restore_id:pgTypes.getTypeParser(2950)(intent.restore_id),authority_generation:controlGeneration,
      archive_digest:pgTypes.getTypeParser(25)(intent.archive_digest),
      database_verified:pgTypes.getTypeParser(16)('t'),authority_invalidated:pgTypes.getTypeParser(16)('t'),
      post_restore_verified:pgTypes.getTypeParser(16)('t'),storage_verified:pgTypes.getTypeParser(16)('t'),
      final_manifest_sha256:pgTypes.getTypeParser(25)(intent.final_manifest_sha256),...config.manifest};
     const r=receipt('SELECT 1');
     r.rows=Object.hasOwn(config,'manifestRows')?config.manifestRows:
      Array.from({length:config.manifestCopies??1},()=>({...row}));
     r.rowCount=Object.hasOwn(config,'manifestRowCount')?config.manifestRowCount:Array.isArray(r.rows)?r.rows.length:1;
     return r;
    }
    if(phase==='discrepancies')return {rows:[]};
    if(phase==='remaining'||phase==='leases')return {rows:[{count:0}]};
    if(phase==='event'&&config.changeNative)Object.defineProperty(this,'query',{value:()=>{throw new Error('Changed own query must not run');}});
    return {rowCount:1,rows:[]};
   }
  }
  const prototype=RecordingClient.prototype,db=new RecordingClient();
  if(config.ownQuery)db.query=()=>{throw new Error('Own query must not run');};
  const consolePort={log:s=>{trace.push({phase:'log'});output.push(JSON.parse(s));},error:s=>{trace.push({phase:'diagnostic'});diagnostics.push(JSON.parse(s));}};
  try{value=await evaluate(RecordingClient,prototype,prototype.query,prototype.connect,prototype.end,types,db,intent,'c'.repeat(64),projectRef,
   sha,stableJson,rows=>{assert.deepEqual(rows,[]);return [];},processPort,consolePort,true,
   new Date(recordedExpiry).toISOString(),recordedExpiry,recordedDate);}
  catch(error){caught=true;thrown=error;}
  return {trace,output,diagnostics,processPort,value,caught,thrown};
 };
 // Legacy contracts retain their original event projection; the FULL raw
 // trace retains the new readonly calls. The new JOIN selector asserts them.
 const phases=r=>r.trace.filter(x=>reconciliationExpiryJoinMode||x.phase!=='lifetime').map(x=>x.phase),count=(r,p)=>r.trace.filter(x=>x.phase===p).length;
 const unknown=r=>{
  assert.equal(r.caught,false);assert.equal(r.output.length,0);assert.equal(r.diagnostics.length,1);assert.equal(r.processPort.exitCode,1);
  assert.deepEqual(r.diagnostics[0],{ok:false,code:r.value.commitConfirmed?'RESTORE_RECONCILIATION_COMMIT_CONFIRMED_CLEANUP_FAILED':'RESTORE_RECONCILIATION_COMMIT_UNKNOWN',
   outcome:'UNKNOWN',retry_safe:false,read_request:expectedRequest});
  assert.equal(r.value.failed,true);assert.equal(r.value.commitAttempted,true);assert.equal(r.value.duplicateRefused,true);
  assert.ok(Object.isFrozen(r.value.originalReconciliationRequest));assert.equal(count(r,'rollback'),0);
  assert.equal(count(r,'commit'),1);assert.equal(count(r,'unlock'),1);assert.equal(count(r,'end'),1);
  assert.deepEqual(phases(r).slice(phases(r).indexOf('commit')+1),['unlock','end','diagnostic']);
 };
 if(reconciliationPausedControlMode){
  const rawPhases=r=>r.trace.map(row=>row.phase);
  const refuse=r=>{
   assert.equal(r.caught,true,'Noncanonical original PAUSED control must refuse before manifest');
   assert.match(r.thrown.message,/Paused restore control does not match the signed reconciliation/);
   assert.deepEqual(rawPhases(r),['connect','lock','begin','fence','control','rollback','unlock','end']);
   for(const phase of ['manifest','discrepancies','lifetime','complete','event','commit'])assert.equal(count(r,phase),0);
   assert.equal(r.output.length,0);assert.equal(r.diagnostics.length,0);assert.equal(r.processPort.exitCode,undefined);
  };
  const noncanonical=await invoke({pausedControl:{authority_generation:'07'}});
  if(!noncanonical.caught)console.log(JSON.stringify({case:'NEW predecessor noncanonical PAUSED control acceptance',
   control_generation_text:'07',original_intent_generation:7,manifest_original_matched:true,
   resumed:noncanonical.output[0]?.resumed,raw_trace:rawPhases(noncanonical),
   limit:'Full post-signature Source with inert ports only, NOT SQL/signed/current-control proof'}));
  refuse(noncanonical);
  const typed=await invoke();assert.equal(typed.caught,false);assert.equal(typed.value.commitConfirmed,true);
  assert.equal(typed.value.duplicateRefused,true);assert.equal(typed.diagnostics.length,0);
  assert.deepEqual(rawPhases(typed),['connect','lock','begin','fence','control','manifest','discrepancies','remaining','leases',
   'lifetime','complete','event','lifetime','commit','unlock','end','log']);
  assert.deepEqual(typed.trace.find(row=>row.phase==='control').args,[]);
  assert.deepEqual(typed.output,[{ok:true,idempotent_replay:false,restore_id:intent.restore_id,reconciliation_id:intent.reconciliation_id,resumed:true}]);
  console.log('NEW PAUSED control boundary: noncanonical generation refuses before manifest; actual installed-pg single typed row follows unchanged manifest/clock/one-COMMIT/cleanup path (Source recording only)');
  let coerced=0;
  const boxedId={toString(){coerced++;return intent.restore_id;},[Symbol.toPrimitive](){coerced++;return intent.restore_id;}};
  const boxedGeneration={valueOf(){coerced++;return 7;},[Symbol.toPrimitive](){coerced++;return 7;}};
  const invalid=[{restore_id:'33333333-3333-4333-8333-333333333333'},{restore_id:undefined},
   {restore_id:new String(intent.restore_id)},{restore_id:boxedId},
   {archive_digest:'f'.repeat(64)},{archive_digest:undefined},{archive_digest:new String(intent.archive_digest)},
   {target_project_ref:'foreign_recording_only'},{target_project_ref:undefined},{target_project_ref:new String(projectRef)},
   ...['8','0','07','+7','-7',' 7','7 ','7\n','7e0','7.0','0x7','9223372036854775808','99999999999999999999',
    undefined,null,7,7n,new String('7'),new Number(7),boxedGeneration].map(authority_generation=>({authority_generation}))];
  for(const pausedControl of invalid)refuse(await invoke({pausedControl}));
  assert.equal(coerced,0);assert.equal(pgTypes.getTypeParser(20),int8Parser);
  console.log('NEW PAUSED original tuple: missing/foreign/boxed/coercible UUID/archive/project and noncanonical/nonpositive/overflow/wrong-type int8 reject without coercion or parser change, before manifest/effects');
  for(const config of [{controlCopies:0},{controlCopies:2},{controlCopies:2,controlRowCount:1},
   {controlRowCount:0},{controlRowCount:2},{controlRowCount:'1'},{controlRowCount:undefined},
   {controlRowCount:null},{controlRowCount:new Number(1)},{controlRows:[null]},{controlRows:new Array(1)},
   {controlRows:{0:{state:'PAUSED_RECONCILIATION',mutations_paused:true,restore_id:intent.restore_id,
    authority_generation:controlGeneration,archive_digest:intent.archive_digest,target_project_ref:projectRef},length:1}}])refuse(await invoke(config));
  for(const pausedControl of [{state:'PAUSED_FAILURE'},{state:undefined},{state:new String('PAUSED_RECONCILIATION')},
   {mutations_paused:false},{mutations_paused:undefined},{mutations_paused:'true'},{mutations_paused:new Boolean(true)}])refuse(await invoke({pausedControl}));
  console.log('NEW PAUSED cardinality/state: missing/duplicate/inconsistent/coercible SELECT counts/rows refuse; exact PAUSED state and actual paused Boolean remain required (NOT SQL proof)');
 }else if(reconciliationManifestPinsMode){
  // New owning manifest boundary ONLY. Raw trace includes existing clock
  // reads; no legacy phase projection, signing stub or native SQL authority.
  const rawPhases=r=>r.trace.map(x=>x.phase);
  const refuse=r=>{
   assert.equal(r.caught,true,'Contradictory original manifest must refuse before discrepancies');
   assert.match(r.thrown.message,/Final restore manifest does not match the signed reconciliation/);
   assert.deepEqual(rawPhases(r),['connect','lock','begin','fence','control','manifest','rollback','unlock','end']);
   for(const phase of ['discrepancies','lifetime','complete','event','commit'])assert.equal(count(r,phase),0);
   assert.equal(r.output.length,0);assert.equal(r.diagnostics.length,0);assert.equal(r.processPort.exitCode,undefined);
  };
  const contradictory=await invoke({manifest:{restore_id:pgTypes.getTypeParser(2950)('33333333-3333-4333-8333-333333333333'),
   authority_generation:int8Parser('8'),archive_digest:pgTypes.getTypeParser(25)('f'.repeat(64))}});
  if(!contradictory.caught)console.log(JSON.stringify({case:'NEW predecessor contradictory manifest acceptance',
   original_control_matched:true,foreign_manifest_fields:3,verified_flags_and_finalhash_matched:true,
   resumed:contradictory.output[0]?.resumed,raw_trace:rawPhases(contradictory),limit:'Inert full post-signature Source flow only; NO SQL/signing/native acceptance'}));
  refuse(contradictory);
  const exact=await invoke();assert.equal(exact.caught,false);assert.equal(exact.value.commitConfirmed,true);
  assert.equal(exact.value.duplicateRefused,true);assert.equal(exact.diagnostics.length,0);
  assert.deepEqual(rawPhases(exact),['connect','lock','begin','fence','control','manifest','discrepancies','remaining','leases',
   'lifetime','complete','event','lifetime','commit','unlock','end','log']);
  assert.deepEqual(exact.trace.find(row=>row.phase==='manifest').args,[intent.restore_id]);
  assert.deepEqual(exact.output,[{ok:true,idempotent_replay:false,restore_id:intent.restore_id,reconciliation_id:intent.reconciliation_id,resumed:true}]);
  console.log('NEW original manifest owning boundary: contradictory original refuses; exact installed-pg UUID/int8/text/bool row retains full existing checks/clock/one-COMMIT/cleanup sequence (Source recording only)');
  let coerced=0;
  const coercible={toString(){coerced++;return controlGeneration;},[Symbol.toPrimitive](){coerced++;return controlGeneration;}};
  const invalid=[{restore_id:'33333333-3333-4333-8333-333333333333'},
   {restore_id:undefined},{restore_id:new String(intent.restore_id)},
   {archive_digest:'f'.repeat(64)},{archive_digest:undefined},{archive_digest:new String(intent.archive_digest)},
   ...['8','0','07','+7','-7',' 7','7 ','7\n','7e0','7.0','9223372036854775808','99999999999999999999',
    undefined,null,7,7n,new String('7'),coercible].map(authority_generation=>({authority_generation}))];
  for(const manifest of invalid)refuse(await invoke({manifest}));
  assert.equal(coerced,0);assert.equal(pgTypes.getTypeParser(20),int8Parser);
  console.log('NEW original manifest pins: missing/foreign/boxed ID and archive plus canonical-int8/type/overflow/coercible generation refusals before discrepancies or effects; original parser unchanged');
  for(const config of [{manifestCopies:0},{manifestCopies:2},{manifestCopies:2,manifestRowCount:1},
   {manifestRowCount:0},{manifestRowCount:2},{manifestRowCount:'1'},{manifestRowCount:null},
   {manifestRowCount:undefined},{manifestRowCount:new Number(1)},{manifestRows:null},
   {manifestRows:{0:{},length:1}},{manifestRows:new Array(1)}])refuse(await invoke(config));
  for(const manifest of [{database_verified:false},{authority_invalidated:false},{post_restore_verified:false},
   {database_verified:'true'},{authority_invalidated:'true'},{post_restore_verified:'true'},
   {final_manifest_sha256:'e'.repeat(64)},{final_manifest_sha256:undefined}])refuse(await invoke({manifest}));
  console.log('NEW original manifest cardinality/verification: missing/duplicate/inconsistent/coercible SELECT row counts and rows refuse; original exact Boolean/finalhash checks retained (NOT DB proof)');
 }else if(reconciliationExpiryJoinMode){
  const normal=await invoke();assert.equal(normal.caught,false);assert.equal(normal.value.commitConfirmed,true);
  assert.equal(count(normal,'lifetime'),2);assert.equal(count(normal,'complete'),1);assert.equal(count(normal,'commit'),1);
  assert.equal(count(normal,'rollback'),0);assert.equal(normal.output[0].resumed,true);assert.equal(normal.diagnostics.length,0);
  const seq=phases(normal);assert.ok(seq.indexOf('lifetime')<seq.indexOf('complete'));
  assert.deepEqual(seq.slice(seq.indexOf('complete')),['complete','event','lifetime','commit','unlock','end','log']);
  const replay=await invoke({replay:true});assert.equal(replay.caught,false);assert.equal(replay.value.commitConfirmed,true);
  assert.equal(count(replay,'lifetime'),1);assert.equal(replay.output[0].idempotent_replay,true);
  assert.deepEqual(phases(replay),['connect','lock','begin','fence','control','prior','lifetime','commit','unlock','end','log']);
  const foreign=await invoke({replay:true,replayControl:{authority_generation:'8'}});
  assert.equal(foreign.caught,true);assert.equal(count(foreign,'prior'),0);assert.equal(count(foreign,'lifetime'),0);
  assert.equal(count(foreign,'commit'),0);assert.equal(foreign.output.length,0);assert.equal(count(foreign,'rollback'),1);
  for(const [expireServerAt,completed]of[[1,0],[2,1]]){
   const expired=await invoke({expireServerAt});assert.equal(expired.caught,true);
   assert.equal(count(expired,'complete'),completed);assert.equal(count(expired,'commit'),0);
   assert.equal(count(expired,'rollback'),1);assert.equal(expired.output.length,0);assert.equal(expired.diagnostics.length,0);
   assert.deepEqual(phases(expired).slice(-3),['rollback','unlock','end']);
  }
  const late=await invoke({expireAfterCommit:true});assert.equal(late.caught,false);assert.equal(late.output.length,0);
  assert.equal(count(late,'commit'),1);assert.equal(count(late,'rollback'),0);assert.equal(late.diagnostics.length,1);
  assert.equal(late.diagnostics[0].outcome,'UNKNOWN');assert.equal(late.diagnostics[0].retry_safe,false);
  assert.deepEqual(late.diagnostics[0].read_request,expectedRequest);assert.equal(late.processPort.exitCode,1);
  assert.equal(late.value.duplicateRefused,true);
  console.log(JSON.stringify({scope:'NEW combined int8/current-control + original deadline + one-COMMIT lifecycle Source join',
   cases:6,status:'PASS_RECORDING_ONLY',installed_pg_int8_and_bool_parser:true,signatures:0,SQL:false,
   native_clients:0,genuine_clock_or_auth:false,old_groups_replayed:0,limits:'Exact joined shipping post-signature Source with inert ports only. No signed admission, DB/server clock, restore/resume or G28 proof.'}));
 }else if(reconciliationReplayInt8Mode){
  // Only the newly affected int8 wire boundary; no historical seven-group
  // replay or old thirteen tuple cases. Ports still never execute native SQL.
  const exact=await invoke({replay:true});
  assert.equal(exact.caught,false);assert.equal(exact.value.commitConfirmed,true);assert.equal(exact.value.duplicateRefused,true);
  assert.deepEqual(phases(exact),['connect','lock','begin','fence','control','prior','commit','unlock','end','log']);
  assert.deepEqual(exact.trace.find(row=>row.phase==='prior').args,
   [intent.restore_id,intent.authority_generation,intent.reconciliation_id,'c'.repeat(64)]);
  assert.deepEqual(exact.output,[{ok:true,idempotent_replay:true,restore_id:intent.restore_id,reconciliation_id:intent.reconciliation_id}]);
  assert.equal(exact.diagnostics.length,0);
  console.log('NEW replay int8 wire: installed pg OID20 parser returns primitive text 7; numeric signed intent matches exact text, original event/digest query and single COMMIT/cleanup retained (Source recording, NOT SQL)');
  let coerced=0;
  const coercible={toString(){coerced++;return '7';},valueOf(){coerced++;return 7;},[Symbol.toPrimitive](){coerced++;return '7';}};
  const proxy=new Proxy(coercible,{get(){coerced++;throw new Error('Generation proxy must not be read');}});
  const invalid=[7,7n,new String('7'),new Number(7),null,undefined,false,{},coercible,proxy,
   '', '0','00','07','+7','-7',' 7','7 ','\t7','7\n','7\r\n','7.0','7e0','0x7','NaN','Infinity',
   '9223372036854775808','99999999999999999999','9223372036854775807','6','8'];
  for(const authority_generation of invalid){
   const r=await invoke({replay:true,replayControl:{authority_generation}});
   assert.equal(r.caught,true);assert.match(r.thrown.message,/Completed restore control does not match the signed reconciliation/);
   assert.deepEqual(phases(r),['connect','lock','begin','fence','control','rollback','unlock','end']);
   assert.equal(count(r,'prior'),0);assert.equal(count(r,'commit'),0);assert.equal(r.output.length,0);
   assert.equal(r.diagnostics.length,0);assert.equal(r.processPort.exitCode,undefined);
  }
  assert.equal(coerced,0);assert.equal(pgTypes.getTypeParser(20),int8Parser);
  const guardStart=body.indexOf('    // Native pg int8 is canonical text;');
  const guardEnd=body.indexOf('    const prior = await db.query(`',guardStart);
  assert.ok(guardStart>0&&guardEnd>guardStart);
  const guard=body.slice(guardStart,guardEnd);
  assert.match(guard,/BigInt\(control\.authority_generation\) > 9223372036854775807n/);
  assert.match(guard,/control\.authority_generation !== String\(intent\.authority_generation\)/);
  assert.doesNotMatch(guard,/Number\(|parseInt\(|parseFloat\(|\.trim\(/);
  console.log('NEW replay int8 type refusals: numeric/boxed/proxy/coercible/noncanonical/nonpositive/overflow/different generations refuse before lookup/COMMIT; no coercion/parser override or success (NOT SQL proof)');
 }else{
 const good=await invoke();
 assert.equal(good.caught,false);assert.equal(good.value.commitConfirmed,true);assert.equal(good.value.duplicateRefused,true);
 assert.equal(count(good,'commit'),1);assert.equal(count(good,'rollback'),0);assert.equal(good.diagnostics.length,0);
 assert.deepEqual(phases(good),['connect','lock','begin','fence','control','manifest','discrepancies','remaining','leases','complete','event','commit','unlock','end','log']);
 assert.deepEqual(good.output,[{ok:true,idempotent_replay:false,restore_id:intent.restore_id,reconciliation_id:intent.reconciliation_id,resumed:true}]);
 const complete=good.trace.find(x=>x.phase==='complete'),event=good.trace.find(x=>x.phase==='event');
 assert.deepEqual(complete.args,[intent.restore_id,intent.authority_generation]);
 assert.deepEqual(event.args.slice(0,3),[intent.restore_id,intent.authority_generation,intent.actor]);
 const retained=JSON.parse(event.args[3]);assert.equal(retained.reconciliation_id,intent.reconciliation_id);assert.equal(retained.archive_digest,intent.archive_digest);
 assert.equal(retained.final_manifest_sha256,intent.final_manifest_sha256);assert.deepEqual(retained.resolutions,[]);
 console.log('NEW reconciliation COMMIT: real pg Result parser shape, one consumed native-method recording call, original write/evidence arguments, success only after unlock/end (NOT SQL acceptance)');
 let touched=0;
 const accessed=receipt();Object.defineProperty(accessed,'command',{get(){touched++;return 'COMMIT';}});
 const extraAccessor=receipt();Object.defineProperty(extraAccessor,'unexpected',{get(){touched++;return true;}});
 const rowAccessor=receipt();Object.defineProperty(rowAccessor,'rows',{get(){touched++;return [];}});
 const rowsExtra=receipt();rowsExtra.rows.extra=true;
 const proxyReceipt=new Proxy(receipt(),{ownKeys(){touched++;throw new Error('Proxy must not be inspected');}});
 const proxyRows=receipt();proxyRows.rows=new Proxy([],{get(){touched++;throw new Error('Proxy rows must not be read');}});
 const inherited=Object.create({command:'COMMIT'});Object.assign(inherited,{rowCount:null,rows:[]});
 for(const invalid of [receipt('ROLLBACK'),null,undefined,[],[receipt()],{command:'COMMIT',rowCount:0,rows:[]},
  {command:'COMMIT',rowCount:null,rows:[{}]},{command:'COMMIT',rowCount:null,rows:new Array(1)},inherited,
  accessed,extraAccessor,rowAccessor,rowsExtra,proxyReceipt,proxyRows])unknown(await invoke({receipt:invalid}));
 assert.equal(touched,0);
 console.log('NEW reconciliation malformed/ROLLBACK/accessor/proxy receipts: exact-original UNKNOWN, no accessor/trap invocation, rollback, retry or post-attempt writes');
 for(const cause of [new Error('INERT lost COMMIT response'),undefined,null,false,0,'']){
  const r=await invoke({commitError:cause});unknown(r);assert.equal(r.value.failure,cause);assert.equal(r.value.commitConfirmed,false);
 }
 console.log('NEW reconciliation lost/falsy COMMIT failures: first cause retained privately; only bounded original tuple emitted, no duplicate COMMIT');
 const replay=await invoke({replay:true});
 assert.equal(replay.caught,false);assert.equal(replay.value.duplicateRefused,true);
 assert.deepEqual(phases(replay),['connect','lock','begin','fence','control','prior','commit','unlock','end','log']);
 assert.deepEqual(replay.output,[{ok:true,idempotent_replay:true,restore_id:intent.restore_id,reconciliation_id:intent.reconciliation_id}]);
 unknown(await invoke({replay:true,receipt:receipt('ROLLBACK')}));
 const unmatched=await invoke({replay:true,unmatchedReplay:true});
 assert.equal(unmatched.caught,true);assert.match(unmatched.thrown.message,/different reconciliation authority/);
 assert.deepEqual(phases(unmatched).slice(-3),['rollback','unlock','end']);assert.equal(count(unmatched,'commit'),0);assert.equal(unmatched.output.length,0);
 console.log('NEW reconciliation matched replay: original matching predicate, no repeated writes, same one-shot COMMIT and cleanup; unmatched replay refuses');
 for(const cause of [new Error('INERT before COMMIT'),undefined,false]){
  const r=await invoke({beginError:cause});assert.equal(r.caught,true);assert.equal(r.thrown,cause);assert.equal(count(r,'commit'),0);
  assert.deepEqual(phases(r),['connect','lock','begin','rollback','unlock','end']);assert.equal(r.output.length,0);assert.equal(r.diagnostics.length,0);
 }
 const probe=await invoke({precommitProbe:true});assert.equal(probe.caught,true);assert.match(probe.thrown.message,/crash probe before commit/);
 assert.equal(count(probe,'complete'),0);assert.equal(count(probe,'event'),0);assert.equal(count(probe,'commit'),0);assert.equal(count(probe,'rollback'),1);
 console.log('NEW reconciliation known pre-COMMIT/falsy errors: rollback once, no UNKNOWN or positive output; existing crash action/guards preserved');
 const first=new Error('INERT first failure'),rollback=new Error('INERT rollback failure'),unlock=new Error('INERT unlock failure'),end=new Error('INERT end failure');
 const combined=await invoke({beginError:first,rollbackError:rollback,unlockError:unlock,endError:end});
 assert.equal(combined.caught,true);assert.ok(combined.thrown instanceof AggregateError);
 assert.equal(combined.thrown.cause.cause,first);assert.deepEqual(combined.thrown.cause.errors,[first,rollback]);
 assert.deepEqual(combined.thrown.errors.slice(1),[unlock,end]);assert.equal(count(combined,'end'),1);assert.equal(combined.output.length,0);
 for(const config of [{unlockError:unlock},{endError:end},{unlockError:undefined},{endError:undefined},{replay:true,endError:end}]){
  const r=await invoke(config);unknown(r);assert.equal(r.value.commitConfirmed,true);assert.ok(r.value.failure instanceof AggregateError);
 }
 const lostCleanup=await invoke({commitError:first,unlockError:unlock,endError:end});unknown(lostCleanup);
 assert.equal(lostCleanup.value.failure.cause,first);assert.deepEqual(lostCleanup.value.failure.errors,[first,unlock,end]);
 console.log('NEW reconciliation cleanup failures: end drains after unlock failure, first/falsy failures retained, no premature success or claimed rollback after COMMIT');
 const connect=await invoke({connectError:first});assert.equal(connect.caught,true);assert.equal(connect.thrown,first);
 assert.deepEqual(phases(connect),['connect','end']);assert.equal(connect.output.length,0);
 const lock=await invoke({lockError:first});assert.equal(lock.caught,true);assert.equal(lock.thrown,first);
 assert.deepEqual(phases(lock),['connect','lock','unlock','end']);assert.equal(lock.output.length,0);
 const own=await invoke({ownQuery:true});assert.equal(own.caught,true);assert.match(own.thrown.message,/native reconciliation client changed/);
 assert.deepEqual(phases(own),['end']);
 const changed=await invoke({changeNative:true});assert.equal(changed.caught,false);assert.equal(changed.output.length,0);
 assert.equal(changed.value.commitAttempted,true);assert.equal(changed.value.commitConfirmed,false);assert.equal(changed.value.duplicateRefused,true);
 assert.equal(count(changed,'commit'),0);assert.equal(count(changed,'rollback'),0);assert.equal(count(changed,'end'),1);
 assert.deepEqual(changed.diagnostics[0].read_request,expectedRequest);assert.equal(changed.diagnostics[0].retry_safe,false);
 console.log('NEW reconciliation connection/lock/native-method failures: cleanup drains, no native override/duplicate dispatch; Source recording only, no signed intent/native SQL/COMMIT proof');
 }
}
const reconciliationLocalMode=process.argv.includes('--apply-reconciliation-local-fixture-source-only');
if(reconciliationLocalMode){
 // Only the actual effect-free configuration guards/downloader factory are
 // extracted. No signing, signature stub, CLI import, connect/query or probe.
 const code=readFileSync(new URL('./apply-production-restore-reconciliation.mjs',import.meta.url),'utf8');
 const storage=readFileSync(new URL('./disaster-recovery-storage.mjs',import.meta.url));
 assert.equal(createHash('sha256').update(storage).digest('hex'),'94558c9c3cd5bc5e7dec6739b7b10a29206c0a6383a263be3c2a6ef67766402d');
 const {isExplicitLocalRestoreFixtureTarget}=await import('./disaster-recovery-storage.mjs');
 const {default:pg}=await import('pg');
 assert.match(code,/import \{ captureStorageSupportedState, validateStorageOperatorEvidence, isExplicitLocalRestoreFixtureTarget \} from "\.\/disaster-recovery-storage\.mjs";/);
 const guardStart=code.indexOf('const target = new URL(databaseUrl);',code.indexOf('const intentDigest ='));
 const dbStart=code.indexOf('const db = new Client({',guardStart),connectStart=code.indexOf('await db.connect();',dbStart);
 assert.ok(guardStart>code.indexOf('Production restore reconciliation signature verification failed.')&&dbStart>guardStart&&connectStart>dbStart);
 const guardCode=code.slice(guardStart,dbStart);
 assert.match(guardCode,/const allowCrashProbe = isExplicitLocalRestoreFixtureTarget\(databaseUrl\);/);
 assert.doesNotMatch(guardCode,/\.hostname|\.pathname|createClient|new Client|\.connect\(|\.query\(/);
 const guard=new Function('databaseUrl','testStorageBytes','process','isExplicitLocalRestoreFixtureTarget',guardCode+'return allowCrashProbe;');
 const makeStart=code.indexOf('function makeStorageDownloader() {'),makeEnd=code.indexOf('const intentDigest =',makeStart);
 assert.ok(makeStart>0&&makeEnd>makeStart);
 const make=new Function('databaseUrl','testStorageBytes','storageSecret','projectRef','createClient','isExplicitLocalRestoreFixtureTarget',
  code.slice(makeStart,makeEnd)+'return makeStorageDownloader;');
 const loopback='postgresql://fixture_only:fixture_only_not_real@127.0.0.1/mz_schema_rebuild_task9';
 const localhost='postgres://fixture_only:fixture_only_not_real@localhost/mz_schema_rebuild_task9';
 const remote=loopback+'?host=not-a-local-target.invalid';
 const fixtureBytes=Buffer.from('isolated-test-bytes'),fixture=JSON.stringify({['fixture-bucket\0fixture-object']:fixtureBytes.toString('base64')});
 let nativeConstructions=0,providers=0;
 const config=(uri,bytes,flag)=>guard(uri,bytes,{env:{RESTORE_RECONCILIATION_TEST_FAIL_BEFORE_COMMIT:flag}},isExplicitLocalRestoreFixtureTarget);
 const construct=(uri,bytes,flag)=>{const local=config(uri,bytes,flag);nativeConstructions++;return {local,client:new pg.Client({connectionString:uri})};};
 const provider=()=>{providers++;return {storage:{from(){throw new Error('Provider IO must not run');}}};};
 const factory=(uri,bytes)=>make(uri,bytes,'INERT-NONSECRET-RECORDING-ONLY','unitrecordingonly0000',provider,isExplicitLocalRestoreFixtureTarget)();
 for(const uri of [loopback,localhost]){
  const {local,client}=construct(uri,fixture,'TrUe');assert.equal(local,true);assert.equal(client.connectionParameters.host,new URL(uri).hostname);
 }
 assert.equal(nativeConstructions,2);
 for(const uri of [remote,loopback+'?hostaddr=192.0.2.1',loopback+'?port=9999',loopback+'?',loopback+'#',
  'postgresql://fixture_only:fixture_only_not_real@not-a-local-target.invalid/mz_schema_rebuild_task9',
  'postgresql:///mz_schema_rebuild_task9?host=/tmp/fixture-only',
  'https://127.0.0.1/mz_schema_rebuild_task9',
  'postgresql://fixture_only:fixture_only_not_real@127.0.0.1/ordinary_database']){
  for(const [bytes,flag] of [[fixture,''],['','true'],[fixture,'TRUE']]){
   assert.throws(()=>construct(uri,bytes,flag),/reconciliation .*fixture|reconciliation crash probe/i);
   assert.equal(nativeConstructions,2);assert.equal(providers,0);
  }
 }
 console.log('NEW apply reconciliation early gates: real helper, two no-connect native constructors, URI overrides/nonlocal/protocol/path refusals before construction/provider (no signatures or SQL)');
 for(const uri of [loopback,localhost]){
  const download=factory(uri,fixture);assert.deepEqual(await download('fixture-bucket','fixture-object'),fixtureBytes);
  await assert.rejects(download('fixture-bucket','missing'),/No isolated Storage-byte fixture/);
 }
 assert.equal(providers,0);
 for(const bytes of [fixture,'not-json']){
  assert.throws(()=>factory(remote,bytes),/Storage-byte fixture is restricted/);assert.equal(providers,0);
 }
 assert.throws(()=>factory(loopback,'not-json'),SyntaxError);assert.equal(providers,0);
 console.log('NEW apply reconciliation downloader: exact local fixture bytes; invalid requested fixture cannot parse/fall through to provider (Source factory ports only)');
 for(const flag of ['true','TRUE','TrUe'])assert.throws(()=>config(remote,'',flag),/reconciliation crash probe/);
 for(const flag of ['',undefined,'false','1','yes',' true '])assert.equal(config(remote,'',flag),false);
 const normal=construct(remote,'','false');assert.equal(normal.local,false);assert.equal(normal.client.connectionParameters.host,'not-a-local-target.invalid');
 const downloader=factory(remote,'');assert.equal(typeof downloader,'function');assert.equal(providers,1);
 console.log('NEW apply reconciliation ordinary configuration: existing exact flag semantics and non-test pg URI/provider factory path unchanged; no provider IO');
 const late=code.slice(code.indexOf('  if (String(process.env.RESTORE_RECONCILIATION_TEST_FAIL_BEFORE_COMMIT',connectStart));
 assert.ok(late.startsWith('  if (String(process.env.RESTORE_RECONCILIATION_TEST_FAIL_BEFORE_COMMIT || "").toLowerCase() === "true") {\n    if (!allowCrashProbe) throw new Error("The reconciliation crash probe is restricted to a disposable loopback database.");\n    throw new Error("Isolated reconciliation crash probe before commit.");\n  }'));
 assert.equal(nativeConstructions,3);assert.equal(providers,1);
 console.log('NEW apply reconciliation ordering: guards precede actual Client/connect, signature region not executed/stubbed, later crash action bytes retained and not executed');
}
const databaseRecordMode=process.argv.includes('--immutable-fresh-database-record-source-only');
if(databaseRecordMode){
 // Exact recorder Source with explicitly inert dependency/SQL ports ONLY.
 // These recording markers are never private tokens, signed inputs, native
 // clients or SQL authority. Actual shipping imports have no such fallback.
 const code=readFileSync(new URL('./immutable-private-fresh-restore-record.mjs',import.meta.url),'utf8');
 assert.match(code,/import pg from 'pg';/);
 assert.match(code,/from '\.\/immutable-private-fresh-restore-commit-context\.mjs';/);
 assert.match(code,/from '\.\/immutable-private-fresh-restore-evidence\.mjs';/);
 assert.match(code,/from '\.\/immutable-private-fresh-restore-intent\.mjs';/);
 const begin=code.indexOf('const Client=');assert.ok(begin>0);
 const body=code.slice(begin).replace('export async function recordVerifiedImmutableFreshDatabaseEvidence','async function recordVerifiedImmutableFreshDatabaseEvidence');
 const compile=new Function('assert','types','pg','readVerifiedImmutableFreshRestoreIntent',
  'readVerifiedImmutableFreshCommitPreparation','readVerifiedImmutableFreshCommitRecord','buildVerifiedImmutableFreshDatabaseEvidence',
  body+'\nreturn {record:recordVerifiedImmutableFreshDatabaseEvidence,recordSql};');
 const clone=value=>structuredClone(value),freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
 const finished=freeze({database_oid:'16384',backend_pid:123,transaction_id:'100',restore_id:'11111111-2222-3333-4444-555555555555',
  authority_generation:'1',archive_digest:'a'.repeat(64),private_rows:'2',transaction_authority:false,admission_resumed:false});
 const release=freeze({release_id:'UNIT recording only',backend_commit:'b'.repeat(40),frontend_commit:'c'.repeat(40),migration_head:'20261017000000',migration_manifest_sha256:'d'.repeat(64)});
 const view=freeze({intent:{restore_id:finished.restore_id,authority_generation:1,archive_digest:finished.archive_digest,actor:'UNIT recording actor',
  target_project_ref:'unitrecordingonly0000',target_release_identity:release},envelope:{recordingOnly:true},
  sourceBinding:{archive_digest:finished.archive_digest,project_ref:'unitrecordingonly0000',source_identity:{release:{...release,archived_extra:'preserved'}}}});
 const evidence=freeze({database:{recordingOnly:true,original_data_import:clone(finished)},event:{recordingOnly:true,original_data_import:clone(finished)}});
 function setup({changeFinished,changeReply,withdrawAt,throwAt,throwValue,alsoWithdraw=false,changeView=false,badEvidence=false}={}){
  const trace=[],writes=[],failure=new Error('RECORDED_ORIGINAL_SOURCE_WITHDRAWN'),archive=Object.freeze({recordingOnly:true}),token=Object.freeze({recordingOnly:true});
  let live=true,preparations=0,optionsIdentity,readerCalls=0,foreignView=false,module;
  const hit=label=>{trace.push(label);if(label===withdrawAt)live=false;if(label===throwAt){if(alsoWithdraw)live=false;throw throwValue;}};
  const readIntent=(sameToken,sameArchive)=>{
   readerCalls++;assert.equal(sameToken,token);assert.equal(sameArchive,archive);if(!live)throw failure;
   return foreignView?freeze({...view,intent:clone(view.intent)}):view;
  };
  const checkOptions=options=>{
   assert.ok(Object.isFrozen(options));assert.deepEqual(Object.keys(options).sort(),['db','freshIntent','verifiedArchive']);
   assert.equal(options.db,db);assert.equal(options.verifiedArchive,archive);assert.equal(options.freshIntent,token);
   if(optionsIdentity)assert.equal(options,optionsIdentity);else optionsIdentity=options;
  };
  const readPreparation=async options=>{
   checkOptions(options);const label='preparation'+preparations++;hit(label);
   const value=clone(finished);if(changeFinished)changeFinished(value,label);if(changeView&&label==='preparation1')foreignView=true;return freeze(value);
  };
  const build=options=>{
   hit('build');assert.deepEqual(Object.keys(options).sort(),['finished','freshIntent','verifiedArchive']);assert.deepEqual(options.finished,finished);
   assert.equal(options.verifiedArchive,archive);assert.equal(options.freshIntent,token);return badEvidence?freeze({database:evidence.database,event:evidence.event,extra:false}):evidence;
  };
  const readRecord=async options=>{checkOptions(options);hit('record');const value=clone(finished);if(changeFinished)changeFinished(value,'record');return freeze(value);};
  class RecordingClient{async query(sql,args){
   assert.equal(this,db);assert.equal(sql,module.recordSql);writes.push({sql,args});hit('sql');
   const result={rowCount:1,rows:[{control_count:1,manifest_count:1,event_count:1,database_oid:finished.database_oid,backend_pid:finished.backend_pid,
    transaction_id:finished.transaction_id,restore_id:finished.restore_id,authority_generation:'1',archive_digest:finished.archive_digest}]};
   if(changeReply)changeReply(result);return result;
  }}
  module=compile(assert,types,{Client:RecordingClient},readIntent,readPreparation,readRecord,build);const db=new RecordingClient();
  return {module,db,archive,token,trace,writes,failure,get readerCalls(){return readerCalls;}};
 }
 async function run(options){const f=setup(options);let result,error,failed=false;try{result=await f.module.record({db:f.db,verifiedArchive:f.archive,freshIntent:f.token});}catch(cause){failed=true;error=cause;}return{...f,result,error,failed};}
 const selected=process.argv.find(v=>v.startsWith('--immutable-database-record-case='))?.slice('--immutable-database-record-case='.length);
 assert.ok(selected===undefined||['sequence','witness','failures','native-refusals','module-refusals'].includes(selected));
 if(!selected||selected==='sequence'){
  const good=await run();assert.equal(good.failed,false);assert.deepEqual(good.trace,['preparation0','build','preparation1','sql','record']);
  assert.deepEqual(good.result,evidence);assert.ok(Object.isFrozen(good.result)&&Object.isFrozen(good.result.database)&&Object.isFrozen(good.result.event));
  assert.equal(good.writes.length,1);const {sql,args}=good.writes[0];
  assert.deepEqual(args,[finished.restore_id,'1',finished.archive_digest,view.sourceBinding.project_ref,view.intent.target_project_ref,view.intent.actor,
   JSON.stringify(evidence.database),JSON.stringify(evidence.event),finished.database_oid,finished.backend_pid,finished.transaction_id,
   JSON.stringify({archive:view.sourceBinding.source_identity.release,target:release,retry_of_restore_id:null})]);
  assert.match(sql,/with changed_control as/);assert.match(sql,/from changed_control c where m\.restore_id=c\.restore_id/);
  assert.match(sql,/from changed_manifest m\n join changed_control c/);assert.match(sql,/x\.phase='FINISHED'/);
  assert.match(sql,/x\.original_control=to_jsonb\(c\)/);assert.match(sql,/c\.state='PREPARING' and c\.mutations_paused/);
  assert.match(sql,/not m\.database_verified and m\.database_evidence='\{\}'::jsonb/);
  assert.match(sql,/not exists\(select 1 from custodial_dr\.restore_events\)/);
  assert.doesNotMatch(sql,/\b(BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|SET ROLE|CREATE|DELETE)\b/i);
  await assert.rejects(good.module.record({db:good.db,verifiedArchive:good.archive,freshIntent:good.token}));assert.equal(good.writes.length,1);
  console.log('NEW DATABASE record Source sequence: preparation/build/recheck/one linked parameterized CTE/record verification; exact frozen DATA and one attempt (recording only)');
 }
 if(!selected||selected==='witness'){
  for(const [key,value] of [['database_oid',16384],['backend_pid','123'],['transaction_id','01'],['restore_id','foreign'],['authority_generation','2'],
   ['archive_digest','foreign'],['private_rows','9223372036854775808'],['transaction_authority',true],['admission_resumed',true],['extra',false]]){
   const result=await run({changeFinished:(row,label)=>{if(label==='preparation0')row[key]=value;}});assert.ok(result.failed);assert.equal(result.writes.length,0);
  }
  for(const label of ['preparation1','record']){
   const result=await run({changeFinished:(row,actual)=>{if(actual===label)row.private_rows='3';}});
   assert.ok(result.failed);assert.equal(result.writes.length,label==='preparation1'?0:1);
  }
  const foreign=await run({changeView:true});assert.ok(foreign.failed);assert.equal(foreign.writes.length,0);
  const payload=await run({badEvidence:true});assert.ok(payload.failed);assert.equal(payload.writes.length,0);
  for(const key of ['control_count','manifest_count','event_count','database_oid','backend_pid','transaction_id','restore_id','authority_generation','archive_digest']){
   const result=await run({changeReply:reply=>{reply.rows[0][key]=typeof reply.rows[0][key]==='number'?0:'foreign';}});
   assert.ok(result.failed);assert.equal(result.writes.length,1);assert.ok(!result.trace.includes('record'));
  }
  console.log('NEW DATABASE record witnesses: strict nine-field Source/currentness, changed pre/post witness, partial counts or foreign reply refuse without adoption/retry (recording only)');
 }
 if(!selected||selected==='failures'){
  for(const point of ['preparation0','build','preparation1','sql','record']){
   const result=await run({withdrawAt:point});assert.ok(result.failed);assert.equal(result.writes.length,['sql','record'].includes(point)?1:0);
  }
  for(const point of ['preparation0','preparation1','sql','record']){
   const result=await run({throwAt:point,throwValue:undefined});assert.ok(result.failed);assert.equal(result.error,undefined);
   assert.equal(result.writes.length,['sql','record'].includes(point)?1:0);
  }
  const combined=await run({throwAt:'sql',throwValue:undefined,alsoWithdraw:true});assert.ok(combined.failed);assert.ok(combined.error instanceof AggregateError);
  assert.equal(combined.error.errors[0],undefined);assert.equal(combined.error.errors[1],combined.failure);assert.equal(combined.error.cause,undefined);
  assert.equal(combined.writes.length,1);assert.ok(!combined.trace.includes('record'));
  console.log('NEW DATABASE record failure phases: Source withdrawal and falsy/combined lost-reply errors preserved; no compensation, retry or COMMIT (recording only)');
 }
 if(!selected||selected==='native-refusals'){
  const f=setup();let traps=0;const proxy=new Proxy({}, {get(){traps++;throw new Error('trap');},getPrototypeOf(){traps++;throw new Error('trap');}});
  for(const db of [null,{},Object.create(null),proxy,{query(){throw new Error('Caller query must not run');}}])
   await assert.rejects(f.module.record({db,verifiedArchive:f.archive,freshIntent:f.token}));
  const own=new f.db.constructor();Object.defineProperty(own,'query',{get(){traps++;throw new Error('getter');}});
  await assert.rejects(f.module.record({db:own,verifiedArchive:f.archive,freshIntent:f.token}));
  const options={};Object.defineProperty(options,'db',{enumerable:true,get(){traps++;throw new Error('getter');}});Object.assign(options,{verifiedArchive:f.archive,freshIntent:f.token});
  await assert.rejects(f.module.record(options));assert.equal(traps,0);assert.equal(f.trace.length,0);assert.equal(f.readerCalls,0);assert.equal(f.writes.length,0);
  console.log('NEW DATABASE record native/options guard Source: foreign/proxy/own-query/accessor cases stop before dependency or SQL ports (recording only; not native client qualification)');
 }
 if(selected==='module-refusals'){
  // Separate actual module-link/refusal member: NO client is constructed,
  // connected or overridden, and NO valid token/envelope is manufactured.
  const hash=value=>createHash('sha256').update(value).digest('hex');
  for(const [name,pin] of [
   ['immutable-private-fresh-restore-commit-context.mjs','e9a1c087d079d3de5ce5dbbbf880499d7dabe8decbb431c367b7e8fbc394be53'],
   ['immutable-private-fresh-restore-evidence.mjs','cf0e8142c5f0e573002e76cbad799fe97f473c56d15254b3b256a418480fd6c0'],
  ])assert.equal(hash(readFileSync(new URL('./'+name,import.meta.url))),pin);
  const sql=setup().module.recordSql;
  assert.match(sql,/m\.reconciliation_manifest_sha256 is null/);
  for(const clause of [
   'x.database_oid=$9::oid','x.database_oid=(select oid from pg_catalog.pg_database where datname=current_database())',
   'x.backend_pid=$10::integer','x.backend_pid=pg_backend_pid()','x.transaction_id=$11::bigint','x.transaction_id=txid_current()',
   'x.restore_id=c.restore_id','x.authority_generation=c.authority_generation','x.archive_digest=c.archive_digest',
   "x.phase='FINISHED'",'x.active_table_oid is null','x.active_row_sha256 is null','x.original_control=to_jsonb(c)',
  ])assert.ok(sql.includes(clause),'Fixed native FINISHED-context clause must remain');
  const {recordVerifiedImmutableFreshDatabaseEvidence:actual}=await import('./immutable-private-fresh-restore-record.mjs');
  let traps=0,callerQueries=0;const proxy=new Proxy({}, {get(){traps++;throw new Error('trap');},getPrototypeOf(){traps++;throw new Error('trap');}});
  for(const db of [null,{},Object.create(null),proxy,{query(){callerQueries++;throw new Error('Caller SQL must not run');}}])
   await assert.rejects(actual({db,verifiedArchive:undefined,freshIntent:undefined}));
  const own={};Object.defineProperty(own,'query',{get(){traps++;throw new Error('getter');}});
  await assert.rejects(actual({db:own,verifiedArchive:undefined,freshIntent:undefined}));
  const options={verifiedArchive:undefined,freshIntent:undefined};Object.defineProperty(options,'db',{enumerable:true,get(){traps++;throw new Error('getter');}});
  await assert.rejects(actual(options));assert.equal(traps,0);assert.equal(callerQueries,0);
  console.log('NEW DATABASE record actual module link: sealed context/evidence inputs, fixed actual-native FINISHED clauses, invalid ports/options refused without client construction, SQL, keys or token minting');
 }
}
const freshControlMode=process.argv.includes('--immutable-fresh-restore-control-source-only');
if(freshControlMode){
 // Exact shipping Source evaluated with inert recording ports ONLY. These
 // views are NOT signed envelopes, WeakMap tokens, native clients or runtime
 // admission inputs; the actual module always imports Task8's private reader.
 const code=readFileSync(new URL('./immutable-private-fresh-restore-control.mjs',import.meta.url),'utf8');
 assert.match(code,/import pg from 'pg';/);
 assert.match(code,/import \{readVerifiedImmutableFreshRestoreIntent\} from '\.\/immutable-private-fresh-restore-intent\.mjs';/);
 const start=code.indexOf('const Client=');assert.ok(start>0);
 const body=code.slice(start).replace('export async function prepareVerifiedImmutableFreshRestoreControl','async function prepareVerifiedImmutableFreshRestoreControl');
 const compile=new Function('assert','types','pg','readVerifiedImmutableFreshRestoreIntent',body+'\nreturn {prepare:prepareVerifiedImmutableFreshRestoreControl,contextSql};');
 const clone=value=>structuredClone(value),freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
 const release=freeze({release_id:'UNIT-recording-only',backend_commit:'a'.repeat(40),frontend_commit:'b'.repeat(40),migration_head:'20261017000000',migration_manifest_sha256:'c'.repeat(64)});
 const intent=freeze({restore_id:'11111111-2222-3333-4444-555555555555',authority_generation:1,retry_of_restore_id:null,
  resume_after_verification:false,archive_digest:'d'.repeat(64),source_project_ref:'unitrecordingonly0000',target_project_ref:'unitrecordingonly0000',
  target_migration_head:release.migration_head,target_release_identity:release,actor:'UNIT recording actor'});
 const binding=freeze({project_ref:intent.source_project_ref,source_identity:{release:{...release,archived_extra:'preserved'}}});
 const view=freeze({intent,envelope:{recordingOnly:true},sourceBinding:binding});
 const ready={state:'READY',authority_generation:'0',mutations_paused:false,restore_id:null,archive_digest:null,source_project_ref:null,
  target_project_ref:null,release_identity:{},started_by:null,started_at:null,completed_at:null,failure_reason:null};
 const manifest={restore_id:intent.restore_id,authority_generation:'1',archive_digest:intent.archive_digest,database_verified:false,storage_verified:false,
  authority_invalidated:false,post_restore_verified:false,database_evidence:{},storage_evidence:{},authority_evidence:{},final_manifest_sha256:null};
 function setup({changeContext,changeResult,withdrawAt,throwAt,throwValue,autocommit=false}={}){
  let phase='READY',contexts=0,live=true,module,readerCalls=0;
  const archive=Object.freeze({recordingOnly:true}),token=Object.freeze({recordingOnly:true}),trace=[],effects=[],failure=new Error('RECORDED_ORIGINAL_SOURCE_WITHDRAWN');
  const reader=(sameToken,sameArchive)=>{readerCalls++;assert.equal(sameToken,token);assert.equal(sameArchive,archive);if(!live)throw failure;return view;};
  class RecordingClient{async query(sql,args=[]){
   let label,result;
   if(sql===module.contextSql){
    label='context';const control=phase==='READY'?clone(ready):{state:'PREPARING',authority_generation:'1',mutations_paused:true,
     restore_id:intent.restore_id,archive_digest:intent.archive_digest,source_project_ref:binding.project_ref,target_project_ref:intent.target_project_ref,
     release_identity:{archive:clone(binding.source_identity.release),target:clone(release),retry_of_restore_id:null},started_by:intent.actor,
     started_at:'2026-10-17 00:00:00+00',completed_at:null,failure_reason:null};
    const row={database_oid:'16384',backend_pid:123,transaction_id:autocommit?String(100+contexts):'100',actor:'supabase_admin',session_actor:'supabase_admin',
     database_owner:'postgres',dr_owner:'postgres',control_owner:'supabase_admin',replication:'origin',row_security:'off',search_path:'pg_catalog',read_only:'off',
     lease_count:'0',held_fences:2,control_count:1,control,manifest_count:phase==='PREPARED'?1:0,manifest:phase==='PREPARED'?clone(manifest):null,events_count:0};
    if(changeContext)changeContext(row,contexts,phase);contexts++;result={rowCount:1,rows:[row]};
   }else if(sql.startsWith('select state,authority_generation')){label='lock';assert.match(sql,/for update$/);result={rowCount:1,rows:[clone(ready)]};}
   else if(sql==='select max(version)::text migration_head from supabase_migrations.schema_migrations'){label='migration';result={rowCount:1,rows:[{migration_head:release.migration_head}]};}
   else if(sql.startsWith('select release_id,backend_commit')){label='release';assert.match(sql,/where status='deployed'/);result={rowCount:1,rows:[clone(release)]};}
   else if(sql.startsWith('update custodial_dr.restore_control')){
    label='update';assert.equal(phase,'READY');assert.match(sql,/state='READY' and not mutations_paused and authority_generation=0 and restore_id is null and archive_digest is null/);
    assert.deepEqual(args,[intent.restore_id,intent.archive_digest,binding.project_ref,intent.target_project_ref,
     JSON.stringify({archive:binding.source_identity.release,target:release,retry_of_restore_id:null}),intent.actor]);
    phase='PAUSED';effects.push(label);result={rowCount:1,rows:[{started_at:'2026-10-17 00:00:00+00'}]};
   }else if(sql.startsWith('insert into custodial_dr.restore_manifests')){
    label='manifest';assert.equal(phase,'PAUSED');assert.deepEqual(args,[intent.restore_id,intent.archive_digest]);phase='PREPARED';effects.push(label);
    result={rowCount:1,rows:[{restore_id:intent.restore_id,authority_generation:'1',archive_digest:intent.archive_digest}]};
   }else throw new Error('Unexpected recording SQL');
   trace.push({label,sql,args});if(throwAt===label)throw throwValue;
   if(changeResult)changeResult(result,label);if(withdrawAt===label)live=false;return result;
  }}
  module=compile(assert,types,{Client:RecordingClient},reader);
  const db=new RecordingClient();
  return {db,archive,token,module,trace,effects,failure,get readerCalls(){return readerCalls;}};
 }
 async function run(options){
  const fixture=setup(options);let value,error,failed=false;
  try{value=await fixture.module.prepare({db:fixture.db,verifiedArchive:fixture.archive,freshIntent:fixture.token});}catch(cause){failed=true;error=cause;}
  return {...fixture,value,error,failed};
 }
 const selected=process.argv.find(v=>v.startsWith('--immutable-fresh-control-case='))?.slice('--immutable-fresh-control-case='.length);
 assert.ok(selected===undefined||['sequence','preconditions','failures','native-refusals'].includes(selected));
 if(!selected||selected==='sequence'){
  const good=await run();assert.equal(good.failed,false);assert.ok(Object.isFrozen(good.value));
  assert.deepEqual(good.value,{database_oid:'16384',backend_pid:123,transaction_id:'100',restore_id:intent.restore_id,authority_generation:'1',archive_digest:intent.archive_digest});
  assert.deepEqual(good.effects,['update','manifest']);
  assert.deepEqual(good.trace.map(r=>r.label),['context','context','context','lock','context','context','migration','context','context','release','context',
   'context','update','context','context','manifest','context','context']);
  for(const command of good.trace)assert.doesNotMatch(command.sql,/\b(BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|SET ROLE|CREATE TABLE|ALTER TABLE|DELETE)\b/i);
  await assert.rejects(good.module.prepare({db:good.db,verifiedArchive:good.archive,freshIntent:good.token}));assert.equal(good.trace.length,18);
  console.log('NEW fresh control Source sequence: same transaction, fixed row lock/release/migration, guarded pause+manifest, frozen six-field DATA, one attempt (recording only)');
 }
 if(!selected||selected==='preconditions'){
  for(const patch of [{actor:'postgres'},{session_actor:'other'},{database_owner:'other'},{dr_owner:'other'},{control_owner:'postgres'},
   {replication:'replica'},{row_security:'on'},{search_path:'public'},{read_only:'on'},{lease_count:'1'},{held_fences:1},
   {database_oid:16384},{control_count:0},{manifest_count:1},{events_count:1}]){
   const result=await run({changeContext:row=>Object.assign(row,patch)});assert.ok(result.failed);assert.equal(result.effects.length,0);
  }
  for(const patch of [{state:'COMPLETE'},{authority_generation:'1'},{mutations_paused:true},{restore_id:intent.restore_id},{archive_digest:intent.archive_digest}]){
   const result=await run({changeContext:row=>Object.assign(row.control,patch)});assert.ok(result.failed);assert.equal(result.effects.length,0);
  }
  for(const key of ['database_oid','backend_pid','transaction_id']){
   const result=await run({changeContext:(row,n)=>{if(n===1)row[key]=key==='backend_pid'?124:'999';}});assert.ok(result.failed);assert.equal(result.effects.length,0);
  }
  const auto=await run({autocommit:true});assert.ok(auto.failed);assert.equal(auto.effects.length,0);
  for(const label of ['lock','migration','release']){
   const result=await run({changeResult:(value,name)=>{if(name===label)value.rows[0][name==='lock'?'state':name==='migration'?'migration_head':'backend_commit']='changed';}});
   assert.ok(result.failed);assert.equal(result.effects.length,0);
  }
  console.log('NEW fresh control preconditions: wrong native context/READY0/lineage, autocommit, stale migration/release and locked-row mismatch refuse before writes (recording only)');
 }
 if(!selected||selected==='failures'){
  for(const withdrawAt of ['context','lock','migration','release','update','manifest']){
   const result=await run({withdrawAt});assert.ok(result.failed);assert.equal(result.effects.length,withdrawAt==='manifest'?2:withdrawAt==='update'?1:0);
  }
  for(const label of ['update','manifest']){
   const result=await run({changeResult:(reply,name)=>{if(name===label)reply.rowCount=0;}});assert.ok(result.failed);assert.equal(result.effects.length,label==='update'?1:2);
  }
  for(const phase of ['PAUSED','PREPARED']){
   const result=await run({changeContext:(row,n,actualPhase)=>{if(phase===actualPhase)row.control.target_project_ref='foreign';}});
   assert.ok(result.failed);assert.equal(result.effects.length,phase==='PAUSED'?1:2);
  }
  const badManifest=await run({changeContext:(row,n,phase)=>{if(phase==='PREPARED')row.manifest.database_verified=true;}});assert.ok(badManifest.failed);
  const falsy=await run({throwAt:'manifest',throwValue:undefined});assert.ok(falsy.failed);assert.equal(falsy.error,undefined);assert.equal(falsy.effects.length,2);
  console.log('NEW fresh control post-effect failures: source withdrawal, lost receipt, foreign control/manifest and falsy native failure propagate; no compensation/retry (recording only)');
 }
 if(!selected||selected==='native-refusals'){
  const fixture=setup();let traps=0;
  const proxy=new Proxy({}, {get(){traps++;throw new Error('trap');},getPrototypeOf(){traps++;throw new Error('trap');}});
  for(const db of [null,{},Object.create(null),proxy,{query(){throw new Error('Caller query must not run');}}])
   await assert.rejects(fixture.module.prepare({db,verifiedArchive:fixture.archive,freshIntent:fixture.token}));
  const own=new fixture.db.constructor();Object.defineProperty(own,'query',{get(){traps++;throw new Error('getter');}});
  await assert.rejects(fixture.module.prepare({db:own,verifiedArchive:fixture.archive,freshIntent:fixture.token}));
  const options={};Object.defineProperty(options,'db',{enumerable:true,get(){traps++;throw new Error('options getter');}});
  Object.assign(options,{verifiedArchive:fixture.archive,freshIntent:fixture.token});await assert.rejects(fixture.module.prepare(options));
  assert.equal(traps,0);assert.equal(fixture.trace.length,0);assert.equal(fixture.readerCalls,0);
  console.log('NEW fresh control native guard Source: null/foreign/proxy/own-query/options accessor refusal before reader or IO (recording only, not actual native-client qualification)');
 }
}
const namespaceColumnBatchMode=process.argv.includes('--namespace-column-acl-batch-source-only');
if(namespaceColumnBatchMode){
 // Exact private capture/reconciler/batch/caller Source with inert recording
 // ports. Never a native client, SQL permission or initialization proof.
 const code=readFileSync(new URL('./immutable-private-source-acl.mjs',import.meta.url),'utf8');
 const begin=code.indexOf('   async function captureOriginalNamespaceColumnAcls(client){');
 const end=code.indexOf('   async function captureOriginalRoutineAcls(client){',begin);
 assert.ok(begin>0&&end>begin);const component=code.slice(begin,end);
 const quote=code.match(/^const quoteIdentifier=.*;$/m)?.[0];assert.ok(quote);
 const functions=new Function('assert',quote+'\n'+component+'\nreturn {captureOriginalNamespaceColumnAcls,reconcileOriginalNamespaceColumnAcls};')(assert);
 const {captureOriginalNamespaceColumnAcls:capture,reconcileOriginalNamespaceColumnAcls:reconcile}=functions;
 const portStart=code.indexOf('  const target=Object.freeze({query:async(sql,args=[])=>{');
 const portEnd=code.indexOf('\n  current();const routines=',portStart);assert.ok(portStart>0&&portEnd>portStart);
 const listStart=code.indexOf('function list(value){'),listEnd=code.indexOf('function identifier(value){',listStart);
 assert.ok(listStart>0&&listEnd>listStart);
 const makeTarget=new Function('assert','types','current','context','fresh','raw',
  code.slice(listStart,listEnd)+'\n'+code.slice(portStart,portEnd)+'\nreturn target;');
 const callerStart=code.indexOf('const namespaces_columns=await reconcileOriginalNamespaceColumnAcls(');
 const callerEnd=code.indexOf('\n  await fresh();',callerStart);assert.ok(callerStart>0&&callerEnd>callerStart);
 const caller=code.slice(callerStart,callerEnd);
 assert.equal(caller,'const namespaces_columns=await reconcileOriginalNamespaceColumnAcls(target,originalAcls.namespaces_columns);current();await context();current();');
 const invoke=new Function('target','originalAcls','reconcileOriginalNamespaceColumnAcls','current','context',
  'return(async()=>{'+caller+'return namespaces_columns;})();');
 const clone=value=>structuredClone(value),grant=(grantee,privilege_type,is_grantable=false)=>
  ({grantee,grantor:'supabase_admin',privilege_type,is_grantable});
 const originalRows=['public','auth','storage','custodial_release_identity'].map(schema_name=>
  ({kind:'SCHEMA',schema_name,object_name:schema_name,owner_name:'supabase_admin',column_name:null,grants:[grant('reader','USAGE')]}));
 originalRows.push({kind:'COLUMN',schema_name:'public',object_name:'native";rows',owner_name:'supabase_admin',column_name:'c";col',grants:[]},
  {kind:'COLUMN',schema_name:'public',object_name:'zeta',owner_name:'supabase_admin',column_name:'epoch',grants:[grant('reader','UPDATE')]});
 const original=await capture({query:async()=>({rows:clone(originalRows)})});
 const originalCopy=clone(original);
 const extraRows=clone(originalRows),publicSchema=extraRows.find(r=>r.kind==='SCHEMA'&&r.schema_name==='public');
 publicSchema.grants[0].is_grantable=true;publicSchema.grants.push(grant('PUBLIC','CREATE'),grant('extra";role','USAGE',true));
 extraRows.find(r=>r.object_name==='native";rows').grants.push(grant('service_role','SELECT'));
 extraRows.find(r=>r.object_name==='zeta').grants[0].is_grantable=true;
 const expectedCommands=[
  'REVOKE SELECT ("c"";col") ON TABLE "public"."native"";rows" FROM "service_role" GRANTED BY "supabase_admin" RESTRICT',
  'REVOKE GRANT OPTION FOR UPDATE ("epoch") ON TABLE "public"."zeta" FROM "reader" GRANTED BY "supabase_admin" RESTRICT',
  'REVOKE CREATE ON SCHEMA "public" FROM PUBLIC GRANTED BY "supabase_admin" RESTRICT',
  'REVOKE USAGE ON SCHEMA "public" FROM "extra"";role" GRANTED BY "supabase_admin" RESTRICT',
  'REVOKE GRANT OPTION FOR USAGE ON SCHEMA "public" FROM "reader" GRANTED BY "supabase_admin" RESTRICT',
 ];
 async function run({rows=extraRows,expected=original,after=originalRows,failAt,receipt,receipts,rawFailure}={}){
  const trace=[],batches=[],writes=[],failure=new Error('FIXTURE_SOURCE_OR_ACTOR_WITHDRAWN');
  let currentRows=clone(rows),reads=0,contexts=0,freshes=0,currents=0,failed=false,error,result;
  const hit=label=>{trace.push(label);if(label===failAt)throw failure;};
  const current=()=>hit('current:'+currents++),context=async()=>hit('context:'+contexts++),fresh=async()=>hit('fresh:'+freshes++);
  const raw=async(sql,args=[])=>{
   assert.deepEqual(args,[]);
   if(sql.startsWith('REVOKE ')){
    hit('raw:batch');writes.push(sql);assert.equal(sql,expectedCommands.join(';\n'));
    if(rawFailure)throw rawFailure;
    currentRows=clone(after);
    return receipts??expectedCommands.map(()=>({command:'REVOKE',rowCount:null,rows:[]}));
   }
   assert.match(sql,/with namespaces as/);assert.match(sql,/pg_catalog\.aclexplode/);
   hit('raw:read:'+reads++);return {rows:clone(currentRows)};
  };
  const port=makeTarget(assert,types,current,context,fresh,raw);
  const target=Object.freeze({query:port.query,revokeBatch:async commands=>{
   batches.push(commands);assert.ok(Object.isFrozen(commands));
   const confirmed=await port.revokeBatch(commands);return receipt===undefined?confirmed:receipt;
  }});
  try{result=await invoke(target,{namespaces_columns:expected},reconcile,current,context);}catch(cause){failed=true;error=cause;}
  assert.deepEqual(original,originalCopy,'Independently retained original metadata must not change');
  return {failed,error,result,trace,batches,writes,reads,failure};
 }
 const requested=process.argv.find(arg=>arg.startsWith('--namespace-column-acl-case='))?.slice('--namespace-column-acl-case='.length);
 assert.ok(requested===undefined||['batch','preflight','terminal','readback'].includes(requested));
 if(!requested||requested==='batch'){
  const good=await run();assert.equal(good.failed,false);assert.equal(good.batches.length,1);assert.deepEqual(good.batches[0],expectedCommands);
  assert.equal(good.writes.length,1);assert.equal(good.reads,2);assert.ok(Object.isFrozen(good.result));
  assert.deepEqual(good.result,{revoked_privileges:3,revoked_grant_options:2});
  assert.deepEqual(good.trace,['context:0','current:0','raw:read:0','context:1','current:1',
   'fresh:0','current:2','raw:batch','fresh:1','current:3','context:2','current:4','raw:read:1','context:3','current:5',
   'current:6','context:4','current:7']);
  const empty=await run({rows:originalRows});assert.equal(empty.failed,false);assert.equal(empty.batches.length,0);assert.equal(empty.writes.length,0);
  assert.equal(empty.reads,2);assert.deepEqual(empty.result,{revoked_privileges:0,revoked_grant_options:0});
  console.log('NEW namespace/column batch: exact quoted commands, one native batch/receipt, empty plan no batch, unchanged return/readback/final caller guard (recording only)');
 }
 if(!requested||requested==='preflight'){
  for(const change of [
   rows=>{rows.find(r=>r.schema_name==='storage').grants=[];},
   rows=>{rows.find(r=>r.schema_name==='storage').owner_name='foreign_owner';},
   rows=>{rows.find(r=>r.schema_name==='storage').grants[0].grantor='foreign_grantor';},
   rows=>{rows.find(r=>r.object_name==='zeta').object_name='foreign_table';},
   rows=>{rows.push(clone(rows[0]));},
  ]){
   const rows=clone(extraRows);change(rows);const result=await run({rows});assert.ok(result.failed);assert.equal(result.batches.length,0);assert.equal(result.writes.length,0);
  }
  const needsOption=clone(original);needsOption.find(r=>r.schema_name==='storage').grants[0].is_grantable=true;
  const optionMissing=await run({expected:needsOption});assert.ok(optionMissing.failed);assert.equal(optionMissing.batches.length,0);
  const foreign=clone(original);foreign[0].identity='caller SQL';const badOriginal=await run({expected:foreign});
  assert.ok(badOriginal.failed);assert.equal(badOriginal.reads,0);assert.equal(badOriginal.batches.length,0);
  console.log('NEW namespace/column preflight: late missing right/option/grantor, changed owner/set/identity, duplicate descriptor refuse before any batch (recording only)');
 }
 if(!requested||requested==='terminal'){
  for(const receipt of [Object.freeze({revocation_count:4}),Object.freeze({revocation_count:'5'}),Object.freeze({revocation_count:5,extra:false}),null]){
   const result=await run({receipt});assert.ok(result.failed);assert.equal(result.batches.length,1);assert.equal(result.writes.length,1);assert.equal(result.reads,1);
  }
  for(const receipts of [[],[{command:'GRANT',rowCount:null,rows:[]}],expectedCommands.map(()=>({command:'REVOKE',rowCount:0,rows:[]}))]){
   const result=await run({receipts});assert.ok(result.failed);assert.equal(result.writes.length,1);assert.equal(result.reads,1);
  }
  const nativeFailure=new Error('FIXTURE_RESTRICT_REFUSAL'),native=await run({rawFailure:nativeFailure});
  assert.ok(native.failed);assert.equal(native.error,nativeFailure);assert.equal(native.writes.length,1);assert.equal(native.reads,1);
  for(const [failAt,writes] of [['current:0',0],['context:0',0],['context:1',0],['fresh:0',0],['fresh:1',1],['context:4',1]]){
   const result=await run({failAt});assert.ok(result.failed);assert.equal(result.error,result.failure);assert.equal(result.writes.length,writes);
  }
  console.log('NEW namespace/column terminal failures: wrong closed receipt/native result, RESTRICT refusal and Source/final-actor callbacks cannot return success or retry (recording only)');
 }
 if(!requested||requested==='readback'){
  for(const change of [
   rows=>{rows.find(r=>r.schema_name==='storage').grants=[];},
   rows=>{rows.find(r=>r.object_name==='zeta').grants[0].is_grantable=true;},
   rows=>{rows.find(r=>r.object_name==='zeta').grants[0].grantor='foreign_grantor';},
   rows=>{rows.find(r=>r.object_name==='zeta').owner_name='foreign_owner';},
  ]){
   const after=clone(originalRows);change(after);const result=await run({after});assert.ok(result.failed);
   assert.equal(result.batches.length,1);assert.equal(result.writes.length,1);assert.equal(result.reads,2);
  }
  console.log('NEW namespace/column readback: missing/changed grant, option, owner or grantor refuses without second batch (recording only)');
 }
}
const recipeCatalogMode=process.argv.includes('--immutable-recipe-catalog-batch-source-only');
if(recipeCatalogMode){
 // Exact shipping component + unchanged guarded query, with inert recording
 // ports ONLY. No pg.Client, SQL, Source admission or installer proof here.
 const initializer=readFileSync(new URL('./immutable-private-source-initializer.mjs',import.meta.url),'utf8');
 const sha=value=>createHash('sha256').update(value).digest('hex');
 const start=initializer.indexOf(' const recipeIdentities=');
 const end=initializer.indexOf(" await query('select custodial_dr.immutable_import_owner_fence()');",start);
 assert.ok(start>0&&end>start);const component=initializer.slice(start,end);
 assert.equal(sha(component),'c2e8cd8933753d767c87f435523fbd9d10c32cdfb96b576056f9428c6fbfb508');
 const guardStart=initializer.indexOf(' const query=async(sql,params=[])=>');
 const guardEnd=initializer.indexOf('return result;};',guardStart)+'return result;};'.length;
 const guardedQuery=initializer.slice(guardStart,guardEnd);
 assert.equal(guardedQuery," const query=async(sql,params=[])=>{await readContext();checkSource();const result=await Reflect.apply(nativeQuery,db,[sql,params]);\n  checkSource();await readContext();return result;};");
 assert.equal(component.split('for(const statement of source.statements)await query(unwrapSource(statement));').length,2);
 assert.equal(component.split('await readRecipeCatalog()').length,3);
 assert.match(component,/p\.oid::regprocedure::text identity/);
 assert.match(component,/left join pg_catalog\.pg_proc p on p\.oid=to_regprocedure\(i\.identity\) and p\.prokind='f'/);
 assert.match(component,/from unnest\(\$1::text\[\]\) with ordinality i\(identity,ordinality\)/);
 assert.match(component,/order by i\.ordinality/);
 const unwrapStart=initializer.indexOf('function unwrapSource(statement){');
 const unwrapEnd=initializer.indexOf('\n\nexport async function initializeVerifiedImmutableFreshSource',unwrapStart);
 assert.ok(unwrapStart>0&&unwrapEnd>unwrapStart);
 const evaluate=new Function('assert','sha','source','db','nativeQuery','readContext','checkSource',
  initializer.slice(unwrapStart,unwrapEnd)+'\nreturn(async()=>{'+guardedQuery+'\n'+component+'})();');
 const paths=['immutable-private-owner-context.sql','immutable-original-event-restore.sql','immutable-original-employee-restore.sql',
  'immutable-original-messenger-restore.sql','immutable-original-message-guards-restore.sql','immutable-original-message-effects-restore.sql',
  'immutable-original-message-audit-restore.sql','immutable-original-message-receipts-restore.sql','immutable-original-device-boundary-restore.sql'];
 const recipes=Array.from({length:23},(_,i)=>Object.freeze({identity:`public.fixture_original_guard_${i}()`,
  before:`exact original definition ${i}`,after:`exact installed definition ${i}`,
  beforeBodyHash:sha(`original body ${i}`),afterBodyHash:sha(`installed body ${i}`)}));
 const statements=paths.map((path,i)=>Object.freeze({sourcePath:'proposals/'+path,
  sql:[0,2,8].includes(i)?`\nBEGIN;\n-- inert fixed Source statement ${i}\nCOMMIT;\n`:`-- inert fixed Source statement ${i}`}));
 const source=Object.freeze({recipes:Object.freeze(recipes),statements:Object.freeze(statements)});
 const unwrapped=statements.map(s=>new Function('assert',initializer.slice(unwrapStart,unwrapEnd)+';return unwrapSource;')(assert)(s));
 const clone=value=>structuredClone(value);
 async function run({input=source,change,withdrawAt,failAt}={}){
  const trace=[],commands=[],receiver=Object.freeze({recordingOnly:true}),failure=new Error('FIXTURE_CURRENTNESS_WITHDRAWN');
  let catalog=0,current=true,failed=false,error;
  const check=label=>{trace.push(label);if(label===failAt||!current)throw failure;};
  const readContext=async()=>check('context:'+trace.filter(v=>v.startsWith('context:')).length);
  const checkSource=()=>check('source:'+trace.filter(v=>v.startsWith('source:')).length);
  const nativeQuery=async function(sql,params){
   assert.equal(this,receiver);commands.push({sql,params});trace.push('query:'+commands.length);
   if(sql.includes('with ordinality i(identity,ordinality)')){
    catalog++;assert.deepEqual(params,[input.recipes.map(r=>r.identity)]);assert.ok(Object.isFrozen(params[0]));
    const side=catalog===1?'before':'after';
    const rows=input.recipes.map((r,i)=>({ordinal:i+1,identity:r.identity,definition:r[side],
     prosrc:(side==='before'?'original':'installed')+' body '+i,owner:'supabase_admin'}));
    const result={rowCount:rows.length,rows};if(change)change(result,side);
    if(withdrawAt===side)current=false;
    return result;
   }
   assert.deepEqual(params,[]);return {rowCount:0,rows:[]};
  };
  try{await evaluate(assert,sha,input,receiver,nativeQuery,readContext,checkSource);}catch(cause){failed=true;error=cause;}
  return {trace,commands,catalog,failed,error,failure};
 }
 const good=await run();assert.equal(good.failed,false);
 assert.equal(good.catalog,2);assert.equal(good.commands.length,11);
 assert.deepEqual(good.commands.slice(1,-1).map(c=>c.sql),unwrapped);
 assert.deepEqual(good.trace,good.commands.flatMap((_,i)=>[
  'context:'+2*i,'source:'+2*i,'query:'+(i+1),'source:'+(2*i+1),'context:'+(2*i+1)]));
 console.log('NEW recipe catalog component: two fresh ordered reads, nine unchanged individual statements, all query guards retained (recording only)');
 for(const side of ['before','after']){
  const corruptions=[
   result=>result.rows.pop(),
   result=>{result.rowCount--;},
   result=>{result.rows[1].identity=result.rows[0].identity;},
   result=>{result.rows[0].identity='public.foreign_guard()';},
   result=>{[result.rows[0],result.rows[1]]=[result.rows[1],result.rows[0]];},
   result=>{result.rows[0].ordinal=2;},
   result=>{result.rows[0].identity=null;result.rows[0].definition=null;result.rows[0].prosrc=null;result.rows[0].owner=null;},
   result=>{result.rows[0].definition+=' changed';},
   result=>{result.rows[0].prosrc+=' changed';},
   result=>{result.rows[0].owner='foreign_owner';},
   result=>{result.rows[0].extra='foreign field';},
  ];
  for(const corrupt of corruptions){
   const result=await run({change:(value,actualSide)=>{if(side===actualSide)corrupt(value);}});
   assert.ok(result.failed,'Every changed catalog tuple must refuse');
   assert.equal(result.commands.length,side==='before'?1:11);
  }
 }
 console.log('NEW recipe catalog refusals: missing/foreign/duplicate/order/definition/body/owner/closed rows on both sides (recording only)');
 const duplicate=clone(source);duplicate.recipes[1].identity=duplicate.recipes[0].identity;
 const short=clone(source);short.recipes.pop();
 for(const input of [duplicate,short]){const result=await run({input});assert.ok(result.failed);assert.equal(result.commands.length,0);}
 console.log('NEW recipe Source membership: duplicate or missing original identity refuses before catalog IO (recording only)');
 for(const side of ['before','after']){
  const result=await run({withdrawAt:side});assert.ok(result.failed);assert.equal(result.error,result.failure);
  assert.equal(result.commands.length,side==='before'?1:11);
 }
 for(const [failAt,commandCount] of [['context:0',0],['source:0',0],['source:1',1],['context:1',1],
   ['context:2',1],['source:2',1],['source:3',2],['context:3',2],
   ['context:20',10],['source:20',10],['source:21',11],['context:21',11]]){
  const result=await run({failAt});assert.ok(result.failed);assert.equal(result.error,result.failure);
  assert.equal(result.commands.length,commandCount);
 }
 console.log('NEW recipe currentness: original callback failure retained before/after each affected side and Source statement boundary (recording only)');
}
const refusalQueryMode=reconciliationPausedControlMode||reconciliationManifestPinsMode||reconciliationExpiryJoinMode||reconciliationReplayInt8Mode||reconciliationCommitMode||reconciliationLocalMode||databaseRecordMode||freshControlMode||namespaceColumnBatchMode||recipeCatalogMode||process.argv.includes('--immutable-bootstrap-initializer-query-mode')
 ||!process.argv[1]||pathToFileURL(resolve(process.argv[1])).href!==import.meta.url;
if(!refusalQueryMode){
assert.ok(process.argv.includes('--immutable-bootstrap-composition-only'),'Explicit new composition selector required');
const requested=process.argv.find(arg=>arg.startsWith('--immutable-bootstrap-composition-case='))?.slice('--immutable-bootstrap-composition-case='.length);
assert.ok(['positive','ownership','cleanup'].includes(requested),'Select positive, ownership or cleanup; no automatic replay');
const project=dirname(dirname(fileURLToPath(import.meta.url)));
const retained='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/authenticated-setwise-original-restore-v16/authenticated-original-source';
const sha=value=>createHash('sha256').update(value).digest('hex');
const identity=s=>[s.dev,s.ino,s.mode,s.uid,s.gid,s.size,s.nlink,s.mtimeNs,s.ctimeNs];
const loans=new Map();
function readPinned(path,pin){
 assert.equal(realpathSync(path),resolve(path),'Original no-symlink input required');
 for(let directory=dirname(path);;directory=dirname(directory)){
  const state=lstatSync(directory);assert.ok(state.isDirectory()&&!state.isSymbolicLink());
  if(dirname(directory)===directory)break;
 }
 const named=lstatSync(path,{bigint:true});assert.ok(named.isFile()&&!named.isSymbolicLink()&&named.nlink===1n);
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  assert.deepEqual(identity(fstatSync(fd,{bigint:true})),identity(named));
  const bytes=readFileSync(fd);assert.equal(BigInt(bytes.length),named.size);
  assert.deepEqual(identity(fstatSync(fd,{bigint:true})),identity(named));
  assert.deepEqual(identity(lstatSync(path,{bigint:true})),identity(named));
  const digest=sha(bytes);if(pin!==undefined)assert.equal(digest,pin,'Exact original input digest required');
  const previous=loans.get(path);
  if(previous){assert.equal(digest,previous.digest);assert.deepEqual(identity(named),previous.identity);}
  else loans.set(path,{digest,identity:identity(named)});
  return bytes;
 }finally{closeSync(fd);}
}
const sourcePins={
 'scripts/immutable-private-source-bootstrap.mjs':'495234ea132f27291cd7dfefe38e14c8dad338666f66f8483cee587a66cb2365',
 'scripts/immutable-private-message-source.mjs':'8acdd6f42c65695faf0312fca19d20050d8c51c025a9db53dbdb8064c1514b62',
 'scripts/immutable-private-domain-source.mjs':'ab1c8f943826a744f2ff40216982e6c3007ba03a2f9c81b29a9c8a555f2b44ca',
 'scripts/disaster-recovery-archive.mjs':'5d418f5e75e31670c2ef5e41b76ccdd2c1dd6f9c237b36960937410bb14bf19d',
 'scripts/disaster-recovery-crypto.mjs':'a316e4e1771f74f37a57da60883470d34d5854f6907d3e24016871baa7b387df',
 'proposals/immutable-private-owner-context.sql':'b2a628db97d31854d9bce28f6f9bc266fda5d02f19f2a39888e4daf19a48afcf',
 'proposals/immutable-original-event-restore.sql':'e96326ecf6b7fcaa0f22d4a2c6eac9495958a18a72a0cae5fd0609efa4eec236',
 'proposals/immutable-original-employee-restore.sql':'283a7f010dd72bf371018db08ee6143b84e6a33ca55feeb99526f7dc29cec208',
 'proposals/immutable-original-messenger-restore.sql':'857ea9ac7b67b45ecfda0cae37c26ee5c9764924dcf2aedc0ad9da9260c74354',
 'proposals/immutable-original-message-guards-restore.sql':'f2c99f1fe58c8c569a1b3cf1b70d69c049607caca8e73f4d2f0479bad1a7768c',
 'proposals/immutable-original-message-effects-restore.sql':'0b28beda0231ff0940f9bdda392327b4dd24b14f86a2154139ca39feb9154604',
 'proposals/immutable-original-message-audit-restore.sql':'bfdd883690411b2a79a26ceac6ef80c008c5e24055b5d3b1af64b2232da2109a',
 'proposals/immutable-original-message-receipts-restore.sql':'98a4f593caf9c62eb42dfae893c67d0e2f84fc5e6b518965b27a92927ac00f88',
 'proposals/immutable-original-device-boundary-restore.sql':'57e66370a7bf892c54a87da520ca00b2bfd25c69341f77be1f6679a3552f1222',
};
for(const [name,pin]of Object.entries(sourcePins))readPinned(join(project,name),pin);
readPinned(join(retained,'SHA256SUMS'),'969fde44613e2153f5eebce6df7308efcdfc00c7cd7c80dd69ce316b62941132');
readPinned(join(retained,'backup-summary.json'),'95cf5b21e47f7829f30d89948adf287986eca6bc406f494e29b9dfb294d1f634');
readPinned(join(retained,'archive-signature.json'),'85335b2a4c2d1db98608ca4087a10769cbb7c15ccb033ac39b0b7d829f4aba50');
const inventoryFields=[['application-schema.sql','application_schema_sha256'],['migration-ledger.json','migration_ledger_sha256'],
 ['cron-jobs.json','cron_jobs_sha256'],['extensions.json','extensions_sha256'],['table-catalog.json','database_catalog_sha256'],
 ['original-relations.json','original_relations_sha256'],['original-guards.json','original_guards_sha256'],['original-acls.json','original_acls_sha256']];
const snapshots=[],unhandled=[],observe=error=>unhandled.push(error);
process.on('unhandledRejection',observe);
function materialize(){
 const archive=materializeVerifiedArchive({sourceDir:retained,
  archiveVerifyKey:'UNIT-only-immutable-archive-verification-key-20261016',archiveVerifyKeyId:'unit-immutable-archive-v1',
  supportedFormats:['memphis-zoo-disaster-recovery.v4'],requiredEntries:['backup-summary.json',...inventoryFields.map(([name])=>'inventory/'+name)]});
 snapshots.push(archive);return archive;
}
const closed=(value,keys)=>assert.deepEqual(Reflect.ownKeys(value).sort(),keys.slice().sort());
function frozenGraph(value){
 const visited=new Set(),queue=[value];
 while(queue.length){const item=queue.pop();if(!item||typeof item!=='object'||visited.has(item))continue;
  visited.add(item);assert.ok(Object.isFrozen(item),'Returned Source/ACL DATA must be frozen');queue.push(...Object.values(item));}
}
const expectedIdentities=[
 'custodial_release_identity.guard_group_original_creation()','custodial_dr.guard_application_mutation()',
 'public.app_event_place_admission_guard()','public.app_event_supersession_guard()','public.events_app_events_set_end_date()',
 'public.events_app_validate_scope_venue()','public.events_app_isolate_needs_review()',
 'public.static_weekly_v15_advance_recurring_generation()','public.msg_enforce_canonical_active_pair_participants()',
 'public.msg_enforce_canonical_active_pair_thread()','public.msg_preserve_original_group_creation()',
 'public.msg_reject_retired_ops_manager_shared_participation()','public.msg_reject_retired_ops_manager_shared_thread_mutation()',
 'public.custodial_record_offline_authority_activation_boundary()','public.msg_enqueue_background_work()',
 'public.msg_memphis_pre_generate_schedule()','public.msg_audit_persisted_message()','public.mz_enqueue_employee_message_push()',
 'public.ops_manager_enqueue_message_push()','public.msg_reject_retired_ops_manager_shared_message_mutation()',
 'public.mz_reject_event_messenger_message()','public.msg_reject_retired_ops_manager_shared_message_audit_mutation()',
 'public.msg_reject_retired_ops_manager_shared_receipt_mutation()',
];
const sourceOrder=['immutable-private-owner-context.sql','immutable-original-event-restore.sql','immutable-original-employee-restore.sql',
 'immutable-original-messenger-restore.sql','immutable-original-message-guards-restore.sql','immutable-original-message-effects-restore.sql',
 'immutable-original-message-audit-restore.sql','immutable-original-message-receipts-restore.sql','immutable-original-device-boundary-restore.sql']
 .map(name=>'proposals/'+name);
let phase='materialize retained UNIT archive',firstFailure,failed=false,passed=false;
const cleanupFailures=[];
try{
 const archive=materialize(),binding=readVerifiedArchiveSourceBinding(archive);
 phase='prepare real shipping Source from retained v16 UNIT archive';
 const source=await prepareVerifiedImmutableBootstrapSource(archive);
 if(requested==='positive'){
  phase='positive exact Source composition assertions';
  closed(source,['schema','sourceBinding','inventory','releaseRows','registryRows','memberProofs','recipes','registrySource','statements',
   'target_authority','transaction_authority','import_authority','resume_allowed']);
  assert.equal(source.schema,'custodial.immutable-private-source-bootstrap.v1');assert.equal(source.sourceBinding,binding);
  for(const key of ['target_authority','transaction_authority','import_authority','resume_allowed'])assert.equal(source[key],false);
  frozenGraph(source);assert.equal(source.recipes.length,23);assert.equal(new Set(source.recipes.map(r=>r.identity)).size,23);
  assert.deepEqual(source.recipes.map(r=>r.identity).sort(),expectedIdentities.slice().sort());
  for(const recipe of source.recipes){assert.equal(sha(recipe.before),recipe.beforeHash);assert.equal(sha(recipe.after),recipe.afterHash);}
  assert.equal(Object.keys(source.registrySource).length,22);
  assert.deepEqual(source.statements.map(s=>s.sourcePath),sourceOrder);
  for(const statement of source.statements){assert.equal(statement.sourceSha256,sourcePins[statement.sourcePath]);
   assert.equal(statement.sql,new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(readPinned(join(project,statement.sourcePath),statement.sourceSha256)));}
  closed(source.inventory,inventoryFields.map(([name])=>'inventory/'+name));
  for(const [name,field]of inventoryFields){const path='inventory/'+name,bytes=readPinned(join(retained,path),binding.source_identity[field]);
   assert.equal(source.inventory[path],new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}
  const catalog=JSON.parse(source.inventory['inventory/table-catalog.json']);
  for(const [index,name,rows]of [[0,'release_deployment_manifest',source.releaseRows],[1,'custodial_release_authority_restore_inventory',source.registryRows]]){
   const table=catalog.find(t=>t.schema_name==='public'&&t.table_name===name);assert.ok(table);
   const bytes=readPinned(join(retained,table.data_file)),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
   const lines=text.split(/\r\n|\r|\n/);if(lines.at(-1)==='')lines.pop();
   assert.deepEqual(rows,lines.map(line=>decodeRestoreTableRowLine(line,table)));assert.equal(String(rows.length),table.row_count);
   assert.deepEqual(source.memberProofs[index],{schema_name:'public',table_name:name,row_count:table.row_count,
    data_file:table.data_file,sha256:sha(bytes),bytes:bytes.length});
  }
  assert.equal(source.releaseRows.length,1);assert.ok(source.registryRows.length>0);
  const registry=source.registryRows.map(text=>JSON.parse(text));
  for(const recipe of source.recipes){
   const aliases=recipe.registry_identity===recipe.identity&&recipe.identity.startsWith('public.')?[recipe.identity,recipe.identity.slice(7)]:[recipe.registry_identity];
   const originals=registry.filter(row=>row.object_kind==='function'&&aliases.includes(row.object_identity));
   if(recipe.identity==='custodial_dr.guard_application_mutation()'){assert.equal(originals.length,0);continue;}
   assert.equal(originals.length,1);assert.equal(originals[0].definition_sql,recipe.before);assert.equal(originals[0].definition_sha256,recipe.beforeHash);
   assert.deepEqual(source.registrySource[originals[0].object_identity],{definition_sql:recipe.after,definition_sha256:recipe.afterHash});
  }
  const acls=readVerifiedImmutableBootstrapAcls(source,archive);closed(acls,['routines','relations','namespaces_columns']);
  assert.deepEqual(acls,JSON.parse(source.inventory['inventory/original-acls.json']));frozenGraph(acls);
  assert.equal(assertVerifiedImmutableBootstrapSource(source,archive),undefined);
 }else if(requested==='ownership'){
  phase='private plan and exact archive binding refusal assertions';
  const second=materialize();assert.notEqual(readVerifiedArchiveSourceBinding(second),binding);
  for(const forged of [{},{...source},structuredClone(source),new Proxy(source,{})]){
   assert.throws(()=>assertVerifiedImmutableBootstrapSource(forged,archive));assert.throws(()=>readVerifiedImmutableBootstrapAcls(forged,archive));}
  assert.throws(()=>assertVerifiedImmutableBootstrapSource(source,second));assert.throws(()=>readVerifiedImmutableBootstrapAcls(source,second));
  assert.throws(()=>assertVerifiedImmutableBootstrapSource(source,{...archive}));
  assert.equal(assertVerifiedImmutableBootstrapSource(source,archive),undefined);
 }else{
  phase='original cleanup revokes only that Source read assertions';
  const acls=readVerifiedImmutableBootstrapAcls(source,archive);frozenGraph(acls);
  archive.cleanup();assert.equal(existsSync(archive.directory),false);
  assert.throws(()=>assertVerifiedImmutableBootstrapSource(source,archive));assert.throws(()=>readVerifiedImmutableBootstrapAcls(source,archive));
  // Detached frozen metadata surviving close is not currentness or an ABA proof.
  frozenGraph(source);frozenGraph(acls);
 }
 passed=true;
}catch(error){failed=true;firstFailure=error;console.error(JSON.stringify({scope:'NEW_BOOTSTRAP_SOURCE_COMPOSITION_FAILURE',case:requested,phase,
 failure_name:error?.name??typeof error,code:error?.code??null,message:error?.message??String(error),SQL:'NOT_RUN'}));}
finally{
 for(const archive of snapshots)try{archive.cleanup();assert.equal(existsSync(archive.directory),false);}catch(error){cleanupFailures.push(error);}
 for(const [path,record]of loans)try{readPinned(path,record.digest);}catch(error){cleanupFailures.push(error);}
 process.off('unhandledRejection',observe);if(unhandled.length)cleanupFailures.push(...unhandled);
}
if(cleanupFailures.length)throw new AggregateError(failed?[firstFailure,...cleanupFailures]:cleanupFailures,'Composition input/cleanup failure',
 {cause:failed?firstFailure:cleanupFailures[0]});
if(failed)throw firstFailure;
assert.equal(passed,true);
console.log(JSON.stringify({scope:'NEW_RETAINED_UNIT_BOOTSTRAP_SOURCE_COMPOSITION_ONLY',case:requested,status:'PASS_SOURCE_ONLY',
 assembler_sha256:sourcePins['scripts/immutable-private-source-bootstrap.mjs'],original_archive_digest:'969fde44613e2153f5eebce6df7308efcdfc00c7cd7c80dd69ce316b62941132',
 borrowed_and_original_inputs:'UNCHANGED',materialized_snapshots_removed:snapshots.length,SQL:'NOT_RUN',installer:'NOT_RUN',DATA_import:'NOT_RUN',
 authority:false,limits:'No normal dry-run, target, commit, activation, genuine archive key or ABA/physical proof.',resources:{SQL_clients:0,JVMs:0,listeners:0}}));
}
