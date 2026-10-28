#!/usr/bin/env node

import assert from "node:assert/strict";
import { loadRecoveryRuntimeContract, validateRecoveryRuntimeConfiguration } from "./disaster-recovery-runtime-contract.mjs";

// Normal ordinary legacy row mutation: actual shipping loop + actual verified
// synthetic archive/FD reader. SQL calls are captured only; no DB or restore runs.
if (process.argv.includes('--normal-legacy-row-fidelity-only') || process.argv.includes('--normal-legacy-admission-and-effect-expiry-only')) {
 const {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync}=await import('node:fs');
 const {join}=await import('node:path'),{tmpdir}=await import('node:os');
 const {createHash}=await import('node:crypto'),{pipeline}=await import('node:stream/promises'),{createInterface}=await import('node:readline');
 const api=await import('./disaster-recovery-archive.mjs'),crypto=await import('./disaster-recovery-crypto.mjs');
 const {encodeProductionBackupTextColumnsDataRow}=await import('./production-backup-pg-dump-command.mjs');
 const source=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
 const marker='    for (const selectedTable of databaseTables) {',endMarker='    restoreTable = null;';
 function extract(text){assert.equal(text.split(marker).length,2);const start=text.indexOf(marker),end=text.indexOf(endMarker,start);assert.ok(end>start);return text.slice(start,end);}
 const currentLoop=extract(source);
 const ownedFidelityDelta="          // Legacy JSON cannot distinguish JSON-column null from SQL NULL.\n          // Require the existing mutation-fidelity proof before any row INSERT;\n          // refusal stays inside this transaction and cannot become count-only success.\n          const rawRowText = nativeTextPlans ? decodeRestoreTableRowLine(line, table)\n            : assertRestoreRowMutationFidelity(line, table);";
 assert.equal(currentLoop.split(ownedFidelityDelta).length,2,'one exact owned fidelity delta required');
 const freshInsert="          } else {\n            requireOrdinaryRestoreIntentFresh();\n            await db.query(insert, [rawRowText]);\n          }";
 assert.equal(currentLoop.split(freshInsert).length,2);
 const fidelityOnlyLoop=currentLoop.replace(freshInsert,'          } else await db.query(insert, [rawRowText]);');
 const priorLoop=fidelityOnlyLoop.replace(ownedFidelityDelta,"          const rawRowText = decodeRestoreTableRowLine(line, table);");
 assert.equal(createHash('sha256').update(priorLoop).digest('hex'),'cb42e8396760b61aedee294a93e97bed5e7898ec3e47efd459288b2e4d3604c2','all original shipping loop bytes must be recovered; unrelated drift refuses');
 assert.match(source,/readVerifiedRestoreTableSelection, decodeRestoreTableRowLine, assertRestoreRowMutationFidelity, createRestoreRowUtf8Guard/);
 assert.ok(currentLoop.includes('nativeTextPlans ? decodeRestoreTableRowLine(line, table)') && currentLoop.includes(': assertRestoreRowMutationFidelity(line, table)'));
 assert.ok(currentLoop.indexOf('assertRestoreRowMutationFidelity(line, table)')<currentLoop.indexOf('await db.query(insert, [rawRowText])'));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const identifiers=source.split(String.fromCharCode(10)).filter(line=>line.startsWith('function quoteIdentifier(')||line.startsWith('function qualified('));assert.equal(identifiers.length,2);
 function compile(loop){return new AsyncFunction('ports','const {db,databaseTables,verifiedArchive,openVerifiedRestoreTableData,createRestoreRowUtf8Guard,pipeline,createInterface,decodeRestoreTableRowLine,assertRestoreRowMutationFidelity,nativeTextPlans,nativeTextQuery,requireOrdinaryRestoreIntentFresh=()=>{}}=ports;let restorePhase,restoreTable;'+identifiers.join(String.fromCharCode(10))+String.fromCharCode(10)+loop);}
 const current=compile(currentLoop),prior=compile(priorLoop),work=mkdtempSync(join(tmpdir(),'UNIT-normal-legacy-fidelity-'));
 const key='UNIT-only-normal-legacy-fidelity-HMAC-20261027',keyId='unit-normal-legacy-fidelity-v1';
 const sha=b=>createHash('sha256').update(b).digest('hex');const cases=[];let ordinal=0;
 function fixture({raws,type='json',native=false,count=raws.length}){
  const dir=join(work,'archive-'+ordinal++);mkdirSync(join(dir,'inventory'),{recursive:true});mkdirSync(join(dir,'database'));
  const encoding=native?api.postgresTextColumnsLineEncoding:api.postgresJsonTextLineEncoding;
  const columns=[{name:'id',data_type:'bigint',generated:'',identity:''},{name:'value',data_type:type,generated:'',identity:''}];
  const catalog=['public','auth','storage'].map(schema_name=>({schema_name,table_name:'records',primary_key:['id'],columns,row_count:String(schema_name==='public'?count:0),data_file:'database/'+schema_name+'.records.jsonl',data_encoding:encoding}));
  const cat=Buffer.from(JSON.stringify(catalog)+'\n');const summary={ok:true,format:'memphis-zoo-disaster-recovery.v4',consistent_database_snapshot:true,project_ref:'abcdefghijklmnopqrst',source_identity:{database_catalog_sha256:sha(cat)},backed_up_schemas:['public','auth','storage'],table_count:3,database_row_count:count};
  const data=Buffer.from(raws.map(v=>native?encodeProductionBackupTextColumnsDataRow(v):JSON.stringify(v)).join('\n')+(raws.length?'\n':''));
  const entries=[['backup-summary.json',Buffer.from(JSON.stringify(summary)+'\n')],['inventory/table-catalog.json',cat],['database/public.records.jsonl',data],['database/auth.records.jsonl',Buffer.alloc(0)],['database/storage.records.jsonl',Buffer.alloc(0)]];
  for(const[n,b]of entries)writeFileSync(join(dir,n),b,{mode:0o600});const sums=entries.map(([n,b])=>sha(b)+'  '+n).join('\n')+'\n';writeFileSync(join(dir,'SHA256SUMS'),sums,{mode:0o600});const digest=sha(sums);
  writeFileSync(join(dir,'archive-signature.json'),JSON.stringify({format:'memphis-zoo-disaster-recovery-signature.v1',algorithm:'hmac-sha256',key_id:keyId,archive_digest:digest,signature:crypto.signBinding(crypto.archiveSignatureBinding({archiveDigest:digest,projectRef:summary.project_ref,sourceIdentity:summary.source_identity,archiveFormat:summary.format}),key)}),{mode:0o600});
  const archive=api.materializeVerifiedArchive({sourceDir:dir,archiveVerifyKey:key,archiveVerifyKeyId:keyId});return{archive,table:catalog[0],native};
 }
 async function run(label,options,{predecessor=false,refusal=null,expectRows=options.raws,expectFailure=false}={}){
  const f=fixture(options),readers=[],calls=[],parameters=[];let error;
  const open=(...args)=>{const r=api.openVerifiedRestoreTableData(...args);readers.push(r);return r;};
  const query=async(sql,args)=>{calls.push(sql);if(sql.startsWith('insert into')||sql==='UNIT_NATIVE_PLAN'){parameters.push(args[0]);return{rowCount:1,rows:[{inserted:'1',retained:'1'}]};}return{rowCount:0,rows:[]};};
  try{
   await query('begin');
   try{await(predecessor?prior:current)({db:{query},databaseTables:[f.table],verifiedArchive:f.archive,openVerifiedRestoreTableData:open,createRestoreRowUtf8Guard:api.createRestoreRowUtf8Guard,pipeline,createInterface,decodeRestoreTableRowLine:api.decodeRestoreTableRowLine,assertRestoreRowMutationFidelity:api.assertRestoreRowMutationFidelity,nativeTextPlans:f.native?new Map([[f.table,{insert:'UNIT_NATIVE_PLAN'}]]):null,nativeTextQuery:query});await query('commit');}
   catch(caught){error=caught;await query('rollback');}
   if(refusal||expectFailure){assert.ok(error);assert.equal(calls.includes('commit'),false);assert.equal(calls.at(-1),'rollback');if(refusal){assert.equal(error.code,'IMMUTABLE_LEGACY_DATA_FIDELITY_UNPROVEN');assert.equal(error.fidelity_reason,refusal);assert.equal(String(error).includes('PRIVATE-CANARY'),false);}}
   else{assert.equal(error,undefined);assert.equal(calls.at(-1),'commit');}
   assert.deepEqual(parameters,expectRows);for(const r of readers){await r.close();assert.ok(r.stream.closed&&r.stream.destroyed);}
   cases.push({case:label,status:'PASS',source:predecessor?'PRESERVED_PREDECESSOR_REPRODUCTION':'CHANGED_SHIPPING_LOOP',captured_inserts:parameters.length,commit_callback:calls.includes('commit'),refusal:refusal??null,actual_SQL:false});
   return parameters;
  }finally{for(const r of readers)await r.close();f.archive.cleanup();assert.equal(existsSync(f.archive.directory),false);}
 }
 try{
  const ambiguous='{"id":1,"value":null}';
  // JSON-column SQL NULL and JSON null have the same legacy row token. Never
  // pretend one can be inferred from this archive; both refuse mutation.
  await run('prior legacy nullable JSON reaches count-only success',{raws:[ambiguous]},{predecessor:true});
  for(const type of ['json','jsonb'])await run('legacy '+type+' ambiguous null refuses before INSERT',{raws:[ambiguous],type},{refusal:'JSON_NULL_AMBIGUOUS',expectRows:[]});
  await run('legacy exact nonnull JSON/numeric spans survive',{raws:['{"id":9223372036854775807,"value":{"n":9007199254740993,"fraction":0.12345678901234567890,"n":2}}']});
  await run('legacy JSON string null is not ambiguous null',{raws:['{"id":1,"value":"null"}']});
  await run('known non-JSON SQL NULL remains accepted',{raws:[ambiguous],type:'text'});
  await run('empty original JSON table remains empty',{raws:[]});
  const valid='{"id":1,"value":{"valid":true}}';await run('late ambiguous row never reaches commit',{raws:[valid,ambiguous]},{refusal:'JSON_NULL_AMBIGUOUS',expectRows:[valid]});
  await run('signed rowcount mismatch cannot become success',{raws:[valid],count:2},{expectFailure:true,expectRows:[valid]});
  const sqlNull='{"id":"1","value":null}',jsonNull='{"id":"1","value":"null"}';
  const params=await run('native TEXT preserves SQLNULL versus JSONnull distinct parameters',{raws:[sqlNull,jsonNull],native:true});assert.notEqual(params[0],params[1]);
  if(process.argv.includes('--normal-legacy-admission-and-effect-expiry-only')){
   function exactBetween(start,end){assert.equal(source.split(start).length,2);const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(b>a);return source.slice(a,b);}
   const preflightSource=exactBetween('async function preflightOrdinaryLegacyRestoreData() {','function requireOrdinaryRestoreIntentFresh() {');
   assert.ok(source.indexOf('await preflightOrdinaryLegacyRestoreData();')<source.indexOf('const db = new Client('));
   const preflight=new AsyncFunction('ports','const {freshPrivateDatabase=false,nativeTextDatabase=false,requireRestoreIntentFresh,requireOriginalArchiveSource,databaseTables,verifiedArchive,openVerifiedRestoreTableData,createRestoreRowUtf8Guard,pipeline,createInterface,assertRestoreRowMutationFidelity}=ports;'+preflightSource+'return preflightOrdinaryLegacyRestoreData();');
   async function admissionCase(label,options,{refusal=null,expireAtRead=null,skip=false}={}){
    const f=fixture(options),readers=[];let calls=0,error,closed=0;
    try{
     const check=()=>{if(expireAtRead!==null&&++calls>=expireAtRead)throw new Error('UNIT authorization expired');};
     try{await preflight({nativeTextDatabase:skip,requireRestoreIntentFresh:check,requireOriginalArchiveSource:()=>{},databaseTables:[f.table],verifiedArchive:f.archive,openVerifiedRestoreTableData:(...a)=>{const r=api.openVerifiedRestoreTableData(...a);readers.push(r);return r;},createRestoreRowUtf8Guard:api.createRestoreRowUtf8Guard,pipeline,createInterface,assertRestoreRowMutationFidelity:api.assertRestoreRowMutationFidelity});}catch(e){error=e;}
     if(refusal){assert.ok(error);assert.equal(error.fidelity_reason,refusal);}else if(expireAtRead!==null)assert.match(String(error),/authorization expired/);else assert.equal(error,undefined);
     for(const r of readers){await r.close();assert.ok(r.stream.closed&&r.stream.destroyed);closed++;}
     if(skip)assert.equal(readers.length,0);
     cases.push({case:label,status:'PASS',source:'EXACT_SHIPPING_PREFLIGHT_BEFORE_CLIENT',private_readers_closed:closed,target_connections:0,captured_mutations:0,actual_SQL:false});
    }finally{for(const r of readers)await r.close();f.archive.cleanup();}
   }
   await admissionCase('legacy preflight rejects late ambiguous JSON before any target connection',{raws:['{"id":1,"value":{"valid":true}}','{"id":2,"value":null}']},{refusal:'JSON_NULL_AMBIGUOUS'});
   await admissionCase('legacy preflight exact nonnull source admitted and private FD closed',{raws:['{"id":1,"value":{"n":9007199254740993}}']});
   await admissionCase('legacy preflight actual ordinary SQL NULL in known text column admitted',{raws:['{"id":1,"value":null}'],type:'text'});
   await admissionCase('legacy preflight authorization expiration during scan refuses before connection',{raws:['{"id":1,"value":{"valid":true}}']},{expireAtRead:2});
   await admissionCase('native source is not decoded by legacy preflight',{raws:['{"id":"1","value":null}'],native:true},{skip:true});
   // Compile actual lock/truncate seam. Expiration while the awaited lock was held
   // must prevent the original destructive statement; a fresh intent still works.
   const lockSource=exactBetween('      if (!nativeTextDatabase) {\n        requireOrdinaryRestoreIntentFresh();\n        await db.query(`lock table','    restorePhase = "suspend_unvalidated_restore_checks";');
   const lockCode=lockSource.slice(0,lockSource.lastIndexOf('    }')); // exclude containing databaseTables block closure
   const guardedTruncate=new AsyncFunction('ports','const {nativeTextDatabase=false,requireOrdinaryRestoreIntentFresh,db,databaseTables,qualified,nativeTextQuery,sql}=ports;'+lockCode);
   for(const expiresAfterLock of [false,true]){
    let expired=false,error;const calls=[];
    try{await guardedTruncate({requireOrdinaryRestoreIntentFresh:()=>{if(expired)throw new Error('UNIT authorization expired');},db:{query:async sql=>{calls.push(sql);if(sql.startsWith('lock table')&&expiresAfterLock)expired=true;return{rows:[]};}},databaseTables:[{schema_name:'public',table_name:'records'}],qualified:(s,t)=>'"'+s+'"."'+t+'"',nativeTextQuery:()=>assert.fail('legacy must not call native'),sql:'truncate UNIT_SELECTED_ONLY'});}catch(e){error=e;}
    assert.equal(calls.some(sql=>sql.startsWith('truncate')),!expiresAfterLock);if(expiresAfterLock)assert.match(String(error),/expired/);else assert.equal(error,undefined);
    cases.push({case:expiresAfterLock?'expiry after awaited table lock prevents TRUNCATE':'fresh authorization preserves normal lock then TRUNCATE',status:'PASS',captured_queries:calls,actual_SQL:false});
   }
   const commitMarker='    requireOrdinaryRestoreIntentFresh();\n    await db.query("commit");\n  } catch (error) {\n    await db.query("rollback").catch(() => {});\n    if (mixedDataCommitAttempted)';
   assert.equal(source.split(commitMarker).length,2,'exact ordinary DATA final-commit seam');
   const commit=new AsyncFunction('ports','const {requireOrdinaryRestoreIntentFresh,db}=ports;'+commitMarker.slice(0,commitMarker.indexOf('\n  } catch')));
   for(const expired of [false,true]){const calls=[];let error;try{await commit({requireOrdinaryRestoreIntentFresh:()=>{if(expired)throw new Error('UNIT authorization expired');},db:{query:async q=>calls.push(q)}});}catch(e){error=e;}
    assert.deepEqual(calls,expired?[]:['commit']);assert.equal(Boolean(error),expired);cases.push({case:expired?'expired ordinary intent prevents final DATA COMMIT':'fresh ordinary intent preserves final DATA COMMIT',status:'PASS',captured_queries:calls,actual_SQL:false});}
   const f=fixture({raws:['{"id":1,"value":{"valid":true}}']}),readers=[];let error,inserts=0;
   try{try{await current({db:{query:async()=>{inserts++;return{rows:[],rowCount:1};}},databaseTables:[f.table],verifiedArchive:f.archive,openVerifiedRestoreTableData:(...a)=>{const r=api.openVerifiedRestoreTableData(...a);readers.push(r);return r;},createRestoreRowUtf8Guard:api.createRestoreRowUtf8Guard,pipeline,createInterface,decodeRestoreTableRowLine:api.decodeRestoreTableRowLine,assertRestoreRowMutationFidelity:api.assertRestoreRowMutationFidelity,nativeTextPlans:null,nativeTextQuery:()=>assert.fail(),requireOrdinaryRestoreIntentFresh:()=>{throw new Error('UNIT authorization expired');}});}catch(e){error=e;}assert.match(String(error),/expired/);assert.equal(inserts,0);cases.push({case:'ordinary row effect rechecks authorization after source decoding',status:'PASS',captured_mutations:0,actual_SQL:false});}finally{for(const r of readers)await r.close();f.archive.cleanup();}
  }
  console.log(JSON.stringify({selector:process.argv.includes('--normal-legacy-admission-and-effect-expiry-only')?'--normal-legacy-admission-and-effect-expiry-only':'--normal-legacy-row-fidelity-only',status:'PASS',cases,count:cases.length,archive_verifier:'ACTUAL_SYNTHETIC_HMAC_AND_PRIVATE_READER',current_loop:'EXACT_SHIPPING_SOURCE',SQL:'NOT_RUN',limits:'Synthetic archive keys and captured transaction/query callbacks; no actual SQL null conversion, transaction rollback, actor/intent/target admission or restore effects proven.'}));
 }finally{rmSync(work,{recursive:true,force:true});assert.equal(existsSync(work),false);}
 process.exit(0);
}

// NEW fresh no-member Storage caller fragments. Inert SQL records stand in
// for already-validated inputs only; no branded archive/native admission proof.
if (process.argv.includes('--fresh-no-storage-only')) {
  const {readFileSync}=await import('node:fs');
  const {createHash}=await import('node:crypto');
  const {types}=await import('node:util');
  const {compareStorageState:actualCompareStorageState}=await import('./disaster-recovery-storage.mjs');
  const group=process.argv.find(value=>value.startsWith('--fresh-no-storage-case='))?.split('=')[1];
  const member=process.argv.find(value=>value.startsWith('--fresh-no-storage-member='))?.slice('--fresh-no-storage-member='.length);
  assert.ok(group===undefined||['reproduction','absence','refusal','present','lifetime','structure'].includes(group));
  const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
  const current=read('./production-restore.mjs'),before=read('../before/scripts/production-restore.mjs');
  assert.equal(createHash('sha256').update(before).digest('hex'),'b6349a135c6ddaf0fc862178f27e6fe440804102faa5db5cd341372eae1f3ebc');
  const predecessor=process.argv.includes('--fresh-no-storage-predecessor'),source=predecessor?before:current;
  const extract=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a);return text.slice(a,b);};
  const storage=extract(source,'  let storageEvidence;','  } else {\n    const supabase = createClient');
  const guard=extract(source,'  const requireFreshContinuation = () => {','  requireFreshContinuation();\n  if (freshPrivateDatabase)');
  const publication=extract(source,'  const storageVerified = databaseOnly ||','  restorePhase = "post_restore_verification";');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const na='NOT_APPLICABLE_ORIGINAL_NO_MEMBERS';
  const originalEvidence=()=>({original_data_readback:{storage_data:{status:na}},authority_data_readback:{storage_data:{status:na}}});
  const select=rows=>({command:'SELECT',rowCount:rows.length,rows});
  const bucket={id:'unit-only-bucket',name:'unit-only-bucket',public:false};
  async function observe(options={}) {
    const state={queries:[],writes:[],events:[],compares:0,sourceCurrent:true,sourceChecks:0};
    const withdrawn=new Error('UNIT original Source withdrawn');
    const relation=Object.hasOwn(options,'relation')?options.relation:select([{buckets_oid:null,objects_oid:null}]);
    const db={query:async(sql,params=[])=>{
      const label=sql.startsWith('select pg_catalog.to_regclass(')?'relations':
        sql==='select row_to_json(b) row from storage.buckets b order by b.id'?'buckets':
        sql==='select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id'?'objects':
        sql.startsWith('update custodial_dr.restore_manifests set storage_verified=')?'manifest':'UNEXPECTED';
      state.queries.push({label,sql,params});
      if(options.failAt===label)throw options.failure;
      if(options.onQuery)await options.onQuery(state,label);
      if(label==='relations')return relation;
      if(label==='buckets'||label==='objects') {
        if(!options.present)throw Object.assign(new Error('UNIT relation unavailable'),{code:'42P01'});
        return select((label==='buckets'?options.actualBuckets??[]:options.actualObjects??[]).map(row=>({row})));
      }
      if(label==='manifest'){state.writes.push({label,params});return {command:'UPDATE',rowCount:1,rows:[]};}
      throw new Error('Unexpected UNIT Storage query');
    }};
    const requireOriginalArchiveSource=()=>{state.sourceChecks++;if(!state.sourceCurrent)throw withdrawn;};
    const ports={db,types,requireOriginalArchiveSource,freshPrivateDatabase:options.fresh??true,databaseOnly:true,
      prepared:options.prepared??true,mutationFenceHeld:options.fence??true,
      process:{env:{RESTORE_DRILL_FORCE_STORAGE_FAILURE:options.forced?'true':'false'}},
      tableSelection:Object.freeze({storageTables:Object.freeze(options.members??[])}),
      buckets:Object.freeze(options.buckets??[]),objects:Object.freeze(options.objects??[]),
      databaseEvidence:Object.hasOwn(options,'evidence')?options.evidence:originalEvidence(),
      compareStorageState:input=>{state.compares++;return actualCompareStorageState(input);},
      restoreId:'00000000-0000-4000-8000-000000000009',generation:'1',
      recordEvent:async(stage,status,evidence)=>{state.events.push({stage,status,evidence});}};
    let failed=false,error,evidence;
    try{evidence=await new AsyncFunction('ports','const {'+Object.keys(ports).join(',')+'}=ports;'+guard+storage+
      '\n  }\n'+publication+'return storageEvidence;')(ports);}catch(caught){failed=true;error=caught;}
    return {state,failed,error,evidence,withdrawn};
  }
  const cases=[];const run=async(part,name,body)=>{if((!group||group===part)&&(!member||name.includes(member))){await body();cases.push(name);
    console.log(JSON.stringify({case:name,status:'PASS_NEW_NO_STORAGE_SOURCE_ONLY'}));}};
  const noPublication=result=>{assert.equal(result.failed,true);assert.equal(result.evidence,undefined);
    assert.deepEqual(result.state.writes,[]);assert.deepEqual(result.state.events,[]);};
  await run('reproduction','fresh signed-no-member input and observed both-absent relations yields scoped N/A',async()=>{
    const result=await observe();
    console.log(JSON.stringify({source_only:true,failed:result.failed,error_code:result.error?.code??null,
      relation_reads:result.state.queries.filter(v=>v.label==='relations').length}));
    assert.equal(result.failed,false);assert.equal(result.evidence.status,na);
    assert.deepEqual(result.state.queries.map(v=>v.label),['relations','manifest']);assert.equal(result.state.compares,0);
  });
  await run('absence','N/A publication is stage-only, not metadata/owner/bytes/provider proof',async()=>{
    const result=await observe();assert.equal(result.failed,false);
    assert.equal(result.evidence.stage_disposition,'NOT_APPLICABLE');
    assert.equal(result.evidence.scope,'FRESH_DATABASE_ONLY_ORIGINAL_NO_MEMBERS_AND_TARGET_RELATIONS_ABSENT');
    assert.deepEqual(result.evidence.target_relations,{buckets:'ABSENT',objects:'ABSENT'});
    for(const key of ['database_only_metadata_verified','metadata_and_ownership_verified','object_bytes_verified','provider_verified'])
      assert.equal(result.evidence[key],false);
    for(const key of ['archived_buckets','archived_objects','verified_object_bytes','complete_restore','resume_allowed','retry_allowed'])
      assert.equal(Object.hasOwn(result.evidence,key),false);
    assert.equal(result.evidence.metadata_only,true);
    assert.equal(result.evidence.original_data_readback_status,na);assert.equal(result.evidence.authority_data_readback_status,na);
    assert.equal(result.state.writes[0].params[1],true);
    assert.deepEqual(JSON.parse(result.state.writes[0].params[2]),result.evidence);
    assert.deepEqual(result.state.events,[{stage:'STORAGE',status:'PASSED',evidence:result.evidence}]);
  });
  for(const [name,options] of [
    ['original Storage DATA member',{members:[{schema_name:'storage',table_name:'buckets'}]}],
    ['signed bucket',{buckets:[bucket]}],['signed object',{objects:[{id:'UNIT original object'}]}],
    ['original MATCH instead of N/A',{evidence:{...originalEvidence(),original_data_readback:{storage_data:{status:'MATCH'}}}}],
    ['authority MATCH instead of N/A',{evidence:{...originalEvidence(),authority_data_readback:{storage_data:{status:'MATCH'}}}}],
    ['original readback missing',{evidence:{authority_data_readback:originalEvidence().authority_data_readback}}],
    ['authority readback missing',{evidence:{original_data_readback:originalEvidence().original_data_readback}}],
    ['original UNSUPPORTED',{evidence:{...originalEvidence(),original_data_readback:{storage_data:{status:'UNSUPPORTED'}}}}],
  ])await run('refusal','both absent never waives '+name,async()=>{
    const result=await observe(options);noPublication(result);assert.equal(result.state.queries.length,1);
    assert.match(result.error.message,/Storage relation availability/);
  });
  for(const fields of [{buckets_oid:'12',objects_oid:null},{buckets_oid:null,objects_oid:'13'}])
    await run('refusal','partial native absence '+JSON.stringify(fields),async()=>noPublication(await observe({relation:select([fields])})));
  for(const [label,relation] of [
    ['undefined',undefined],['null',null],['false',false],['zero rows',select([])],
    ['duplicate rows',select([{buckets_oid:null,objects_oid:null},{buckets_oid:null,objects_oid:null}])],
    ['wrong count',{...select([{buckets_oid:null,objects_oid:null}]),rowCount:0}],
    ['wrong command',{...select([{buckets_oid:null,objects_oid:null}]),command:'UPDATE'}],
    ['missing field',select([{buckets_oid:null}])],['extra field',select([{buckets_oid:null,objects_oid:null,approved:true}])],
    ['numeric OID',select([{buckets_oid:12,objects_oid:'13'}])],['leading zero',select([{buckets_oid:'012',objects_oid:'13'}])],
    ['OID overflow',select([{buckets_oid:'4294967296',objects_oid:'13'}])],['zero OID',select([{buckets_oid:'0',objects_oid:'13'}])],
    ['OID newline',select([{buckets_oid:'12\n',objects_oid:'13'}])],['same OIDs',select([{buckets_oid:'12',objects_oid:'12'}])],
    ['boxed OID',select([{buckets_oid:new String('12'),objects_oid:'13'}])],
  ])await run('refusal','malformed metadata '+label,async()=>noPublication(await observe({relation})));
  await run('refusal','accessor and proxy result/row never evaluate coercion or getters',async()=>{
    let touched=0;
    const getter={objects_oid:null};Object.defineProperty(getter,'buckets_oid',{enumerable:true,get(){touched++;return null;}});
    // Promise resolution performs its own then lookup before the consumer
    // receives a query result; count only consumer property inspection here.
    const proxy=new Proxy({}, {get(_target,key){if(key==='then')return undefined;touched++;throw new Error('UNIT no get');},
      ownKeys(){touched++;throw new Error('UNIT no keys');}});
    for(const relation of [select([getter]),select([proxy]),proxy])noPublication(await observe({relation}));
    assert.equal(touched,0);
  });
  await run('present','both-present path retains exact old metadata comparisons and evidence',async()=>{
    const result=await observe({present:true,relation:select([{buckets_oid:'12',objects_oid:'13'}])});assert.equal(result.failed,false);
    assert.deepEqual(result.state.queries.map(v=>v.label),['relations','buckets','objects','manifest']);assert.equal(result.state.compares,1);
    assert.deepEqual(result.evidence,{database_only_metadata_verified:true,archived_buckets:0,archived_objects:0});
  });
  await run('present','both present with signed originals uses actual old comparator',async()=>{
    const result=await observe({present:true,relation:select([{buckets_oid:'12',objects_oid:'13'}]),buckets:[bucket],actualBuckets:[bucket],members:[{table_name:'buckets'}]});
    assert.equal(result.failed,false);assert.equal(result.state.compares,1);assert.equal(result.evidence.archived_buckets,1);
  });
  await run('present','both present mismatch still refuses before manifest/event publication',async()=>{
    const result=await observe({present:true,relation:select([{buckets_oid:'12',objects_oid:'13'}]),buckets:[bucket]});
    noPublication(result);assert.match(result.error.message,/metadata restore differed/);
  });
  await run('present','nonfresh database-only trace/evidence remain unchanged',async()=>{
    const result=await observe({fresh:false,present:true});assert.equal(result.failed,false);
    assert.deepEqual(result.state.queries.map(v=>v.label),['buckets','objects','manifest']);
    assert.deepEqual(result.evidence,{database_only_metadata_verified:true,archived_buckets:0,archived_objects:0});
    assert.equal(result.state.sourceChecks,0);
  });
  for(const options of [{forced:true},{prepared:false},{fence:false}])await run('lifetime','precondition refuses before query '+JSON.stringify(options),async()=>{
    const result=await observe(options);noPublication(result);assert.equal(result.state.queries.length,0);
  });
  await run('lifetime','Source withdrawal during availability await prevents N/A/effects',async()=>{
    const result=await observe({onQuery:(state,label)=>{if(label==='relations')state.sourceCurrent=false;}});
    noPublication(result);assert.equal(result.error,result.withdrawn);assert.equal(result.state.queries.length,1);
  });
  await run('lifetime','Source withdrawal during old both-present reads prevents publication',async()=>{
    const result=await observe({present:true,relation:select([{buckets_oid:'12',objects_oid:'13'}]),onQuery:(state,label)=>{if(label==='objects')state.sourceCurrent=false;}});
    noPublication(result);assert.equal(result.error,result.withdrawn);
  });
  await run('lifetime','post-N/A manifest await withdrawal prevents later event success',async()=>{
    const result=await observe({onQuery:(state,label)=>{if(label==='manifest')state.sourceCurrent=false;}});
    assert.equal(result.failed,true);assert.equal(result.error,result.withdrawn);assert.equal(result.state.writes.length,1);
    assert.deepEqual(result.state.events,[]);assert.equal(result.evidence,undefined);
  });
  for(const error of [undefined,null,false,0,new Error('UNIT literal first query failure')])await run('lifetime','literal first metadata failure '+cases.length,async()=>{
    const result=await observe({failAt:'relations',failure:error});noPublication(result);assert.equal(result.error,error);
    assert.equal(result.state.queries.length,1);
  });
  await run('structure','only permitted fresh databaseOnly Storage block changes; provider/legacy tail exact',async()=>{
    const a='  if (databaseOnly) {\n    requireFreshContinuation();\n    const restoredBuckets = await db.query("select row_to_json(b) row from storage.buckets b order by b.id");';
    const start=before.indexOf(a),end=before.indexOf('  } else {\n    const supabase = createClient',start);assert.ok(start>0&&end>start);
    assert.equal(current.slice(0,start),before.slice(0,start));
    const newEnd=current.indexOf('  } else {\n    const supabase = createClient',start);
    assert.equal(current.slice(newEnd),before.slice(end));
    const oldBody=before.slice(start+'  if (databaseOnly) {\n'.length,end);
    assert.ok(current.slice(start,newEnd).includes(oldBody));
    const addition=current.slice(start,current.indexOf(oldBody,start));
    assert.doesNotMatch(addition,/\b(create|alter|grant|truncate|insert|setval|begin|commit|rollback)\s+(table|schema|role|sequence|transaction|into)/i);
    assert.match(addition,/to_regclass\('storage\.buckets'\)/);assert.match(addition,/to_regclass\('storage\.objects'\)/);
    assert.ok(current.indexOf('RESTORE_DRILL_FORCE_STORAGE_FAILURE',start-400)<current.indexOf('to_regclass',start));
    assert.ok(publication.includes('databaseOnly || storageEvidence.metadata_and_ownership_verified === true'));
    assert.ok(source.includes('mutations_paused: true'));assert.ok(source.includes('state: "PAUSED_RECONCILIATION"'));
  });
  assert.ok(cases.length>0);console.log(JSON.stringify({status:'FRESH_NO_STORAGE_SOURCE_COMPONENT_ONLY',cases:cases.length,native_SQL:'NOT_RUN',resources:0}));
  process.exit(0);
}

// NEW actual failure-output fragments with local decision DATA only. No SQL,
// private factory/Client substitute, native authority, status lookup or effects.
if (process.argv.includes('--fresh-failure-recovery-only')) {
  const {readFileSync}=await import('node:fs');
  const {types}=await import('node:util');
  const source=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
  const group=process.argv.find(v=>v.startsWith('--fresh-failure-case='))?.split('=')[1];
  assert.ok(group===undefined||['reproduction','decisions','requests','cleanup','boundary','structure','pause'].includes(group));
  const original=Object.freeze({restoreId:'00000000-0000-4000-8000-000000000009',generation:'7',archiveDigest:'a'.repeat(64),targetProjectRef:'unitonlyinvalid00000'});
  const authority=()=>Object.freeze({...original,databaseOid:'16000',effectBackendPid:4321,effectTransactionId:'102',originalTransactionId:'100'});
  const from=source.indexOf('  const failureOutput = { ok: false, restore_phase: restorePhase,');
  const to=source.indexOf('    if (freshDataReadbackDisposition)',from);
  assert.ok(from>=0&&to>from);
  const helperStart=source.indexOf('function freshRecordedFailureHandoff() {');
  const helperEnd=source.indexOf('// Retain bounded same-invocation recovery DATA for archive cleanup only.',helperStart);
  const helper=helperStart<0?'':source.slice(helperStart,helperEnd);
  const defaults=()=>({types,error:new Error('UNIT private SQL/body sentinel'),outcomeUnknown:false,uncertainty:{},
    freshPrivateDatabase:true,freshDatabaseCommitAcknowledged:true,freshAuthorityCommitAcknowledged:true,
    freshAuthorityCommitInvoked:true,freshAuthorityCommitNeedsObservation:false,freshCommitNeedsObservation:false,
    freshOriginalRequest:original,freshAuthorityOriginalRequest:authority(),prepared:true,
    restorePhase:'restore_storage',restoreTable:null,restoreId:original.restoreId,generation:7,
    archiveDigest:original.archiveDigest,projectRef:original.targetProjectRef});
  const evaluate=(overrides={})=>{
    const input={...defaults(),...overrides};
    const result=new Function('input','const {'+Object.keys(defaults()).join(',')+'}=input;'+helper+
      source.slice(from,to)+'}\nreturn failureOutput;')(input);
    return {input,result};
  };
  const cases=[];const run=(part,name,body)=>{if(!group||group===part){body();cases.push(name);
    console.log(JSON.stringify({case:name,status:'PASS_NEW_FAILURE_OUTPUT_SOURCE_ONLY'}));}};
  run('reproduction','storage failure retains independently ACKNOWLEDGED authority and exact original lookup DATA',()=>{
    const {result}=evaluate();
    console.log(JSON.stringify({observed_authority_status:result.authority_commit_status??null,
      observed_authority_lookup_present:Object.hasOwn(result,'authority_status_request'),source_only:true}));
    assert.equal(result.authority_commit_status,'ACKNOWLEDGED');assert.deepEqual(result.authority_status_request,authority());
  });
  const closedFlags=result=>{
    for(const key of ['complete_restore','resume_allowed','retry_allowed','rerun_import_allowed','retry_safe'])assert.equal(result[key],false);
    if(result.commit_status==='ACKNOWLEDGED')assert.equal(result.mutations_paused,true);
    else assert.equal(Object.hasOwn(result,'mutations_paused'),false);
    assert.equal(result.metadata_only,true);
  };
  for(const phase of ['restore_cron','restore_storage','post_restore_verification','record_fresh_original_authority_evidence',
    'final_manifest','PAUSED_RECONCILIATION','restore_cleanup','archive_cleanup','UNIT-new-stage-without-old-substring']) {
    run('decisions','both acknowledged decisions survive '+phase,()=>{
      const {result}=evaluate({restorePhase:phase});assert.equal(result.commit_status,'ACKNOWLEDGED');
      assert.equal(result.authority_commit_status,'ACKNOWLEDGED');assert.deepEqual(result.original_status_request,original);
      assert.deepEqual(result.authority_status_request,authority());closedFlags(result);
      assert.equal(result.readback_outcome,'VERIFIED_BEFORE_CONTINUATION_FAILURE');
      assert.match(result.restore_error,/verified before continuation/);assert.doesNotMatch(result.restore_error,/DATA verification is unresolved/);
    });
  }
  for(const database of ['ACKNOWLEDGED','UNKNOWN','UNAVAILABLE'])for(const effect of ['ACKNOWLEDGED','UNKNOWN','NOT_COMMITTED']) {
    run('decisions','independent original decisions '+database+'/'+effect,()=>{
      const {result}=evaluate({freshDatabaseCommitAcknowledged:database==='ACKNOWLEDGED',freshCommitNeedsObservation:database==='UNKNOWN',
        freshAuthorityCommitAcknowledged:effect==='ACKNOWLEDGED',freshAuthorityCommitNeedsObservation:effect==='UNKNOWN',
        freshAuthorityCommitInvoked:effect!=='NOT_COMMITTED',prepared:false});
      if(database==='UNAVAILABLE'){assert.equal(Object.hasOwn(result,'commit_status'),false);assert.equal(result.database_commit_status_unavailable,true);}
      else assert.equal(result.commit_status,database);
      assert.equal(result.authority_commit_status,effect);closedFlags(result);
      assert.equal(result.readback_outcome,'UNRESOLVED');
      if(effect==='NOT_COMMITTED')assert.equal(Object.hasOwn(result,'authority_status_request'),false);
    });
  }
  run('decisions','known ACK wins stale unknown-observation flags and public error assertions',()=>{
    const {result}=evaluate({freshCommitNeedsObservation:true,freshAuthorityCommitNeedsObservation:true,outcomeUnknown:true,
      error:{commit_status:'NOT_COMMITTED',authority_commit_status:'UNKNOWN',requested_original:{UNIT:'foreign'}},
      uncertainty:{outcome:'UNKNOWN',retry_safe:false}});
    assert.equal(result.commit_status,'ACKNOWLEDGED');assert.equal(result.authority_commit_status,'ACKNOWLEDGED');
    assert.deepEqual(result.authority_status_request,authority());closedFlags(result);
  });
  run('decisions','acknowledged commits alone do not assert completed original postverification',()=>{
    const {result}=evaluate({prepared:false});assert.equal(result.authority_commit_status,'ACKNOWLEDGED');
    assert.equal(result.readback_outcome,'UNRESOLVED');assert.match(result.restore_error,/verification or fence handoff remains unresolved/);
  });
  run('decisions','public success/readback error fields cannot invent a recorded commit',()=>{
    const {result}=evaluate({freshDatabaseCommitAcknowledged:false,freshCommitNeedsObservation:false,
      freshAuthorityCommitAcknowledged:false,freshAuthorityCommitNeedsObservation:false,freshAuthorityCommitInvoked:false,
      error:{commit_status:'ACKNOWLEDGED',authority_commit_status:'ACKNOWLEDGED',readback_outcome:'VERIFIED'}});
    assert.equal(Object.hasOwn(result,'commit_status'),false);assert.equal(result.database_commit_status_unavailable,true);
    assert.equal(result.authority_commit_status,'NOT_COMMITTED');
    assert.equal(result.readback_outcome,'UNRESOLVED');
  });
  const rejectedRequest=(request,extra={})=>{
    const {result}=evaluate({freshAuthorityOriginalRequest:request,...extra});assert.equal(result.authority_commit_status,'ACKNOWLEDGED');
    assert.equal(Object.hasOwn(result,'authority_status_request'),false);
    assert.deepEqual(result.authority_status_request_missing_prerequisites,
      ['restoreId','generation','archiveDigest','targetProjectRef','databaseOid','effectBackendPid','effectTransactionId','originalTransactionId']);
    closedFlags(result);return result;
  };
  for(const [label,change] of [
    ['foreign restore',v=>v.restoreId='00000000-0000-4000-8000-000000000010'],['generation',v=>v.generation='8'],
    ['archive',v=>v.archiveDigest='b'.repeat(64)],['project',v=>v.targetProjectRef='otherunitinvalid0000'],
    ['OID numeric',v=>v.databaseOid=16000],['OID zero',v=>v.databaseOid='0'],['OID leading zero',v=>v.databaseOid='016000'],
    ['OID too large',v=>v.databaseOid='4294967296'],['PID string',v=>v.effectBackendPid='4321'],['PID fractional',v=>v.effectBackendPid=4.1],
    ['PID too large',v=>v.effectBackendPid=2147483648],['xid numeric',v=>v.effectTransactionId=102],
    ['xid too large',v=>v.effectTransactionId='9223372036854775808'],['original xid missing',v=>delete v.originalTransactionId],
    ['same xid',v=>v.originalTransactionId=v.effectTransactionId],['xid whitespace',v=>v.originalTransactionId=' 100'],
    ['xid trailing LF',v=>v.effectTransactionId='102\n'],['xid exponent',v=>v.effectTransactionId='1e2'],
    ['extra field',v=>v.public_permission=true]]) {
    run('requests','closed exact lookup refuses '+label+' without demoting ACK',()=>{const value={...authority()};change(value);rejectedRequest(value);});
  }
  for(const value of [undefined,null,false,{},[],new String('UNIT no scalar coercion')]) {
    run('requests','absent or malformed lookup '+cases.length+' never backfills planned IDs',()=>rejectedRequest(value));
  }
  run('requests','maxima and canonical minimum native lookup scalars survive as DATA only',()=>{
    const value={...authority(),databaseOid:'4294967295',effectBackendPid:2147483647,effectTransactionId:'9223372036854775807',originalTransactionId:'1'};
    const {result}=evaluate({freshAuthorityOriginalRequest:value});assert.deepEqual(result.authority_status_request,value);
    assert.notEqual(result.authority_status_request,value);assert.equal(Object.isFrozen(result.authority_status_request),true);closedFlags(result);
  });
  run('requests','saved original4 absent cannot be reconstructed from planned lexical IDs or uncertainty JSON',()=>{
    const result=rejectedRequest(authority(),{freshOriginalRequest:undefined,uncertainty:{original_status_request:original}});
    assert.equal(Object.hasOwn(result,'original_status_request'),false);
    assert.deepEqual(result.original_status_request_missing_prerequisites,['restoreId','generation','archiveDigest','targetProjectRef']);
  });
  run('requests','saved original4 must itself match this original invocation',()=>{
    const foreign={...original,generation:'8'};
    const result=rejectedRequest({...authority(),generation:'8'},{freshOriginalRequest:foreign});
    assert.equal(Object.hasOwn(result,'original_status_request'),false);
  });
  run('boundary','lookup Proxy/accessors/coercible values refuse without invoking them',()=>{
    let calls=0;const proxy=new Proxy({}, {ownKeys(){calls++;throw 'UNIT secret';}});rejectedRequest(proxy);
    const value={...authority()};Object.defineProperty(value,'databaseOid',{enumerable:true,get(){calls++;throw 'UNIT secret';}});rejectedRequest(value);
    rejectedRequest({...authority(),databaseOid:{toString(){calls++;return '16000';}}});assert.equal(calls,0);
  });
  run('boundary','raw driver body/cause/SQL and message getters do not enter fresh structured failure',()=>{
    let calls=0;const error={get message(){calls++;throw 'UNIT-private-driver-body';},cause:'UNIT-private-driver-body',actual:'UNIT-private-driver-body'};
    const {result}=evaluate({error});assert.equal(calls,0);assert.equal(JSON.stringify(result).includes('UNIT-private-driver-body'),false);
    for(const key of ['cause','actual','expected'])assert.equal(Object.hasOwn(result,key),false);
  });
  for(const error of [undefined,null,false,0,'UNIT-private-driver-body']) {
    run('boundary','falsy/non-Error first failure '+String(error)+' cannot demote acknowledged decisions',()=>{
      const {result,input}=evaluate({error});assert.equal(input.error,error);
      assert.equal(result.commit_status,'ACKNOWLEDGED');assert.equal(result.authority_commit_status,'ACKNOWLEDGED');
      assert.equal(JSON.stringify(result).includes('UNIT-private-driver-body'),false);
    });
  }
  const afterNative=source.slice(source.indexOf('// Retain bounded same-invocation recovery DATA for archive cleanup only.'),source.indexOf('return restoreSuccessOutput;'));
  const logging=afterNative.slice(0,afterNative.indexOf('if (restoreLifecycleFailed) {'));
  const cleanupDefaults=()=>({...defaults(),archiveFreshFailureOutput:undefined,restoreLifecycleFailed:false,restoreCleanupErrors:[new Error('UNIT cleanup')],
    archiveCleanupFailed:false,archiveCleanupFailure:undefined,archiveLifecycleFailure:undefined});
  const cleanupRecord=(overrides={})=>{
    const input={...cleanupDefaults(),...overrides};const logs=[];
    const keys=Object.keys(input).filter(k=>k!=='archiveFreshFailureOutput');
    const result=new Function('input','console','const {'+keys.join(',')+'}=input;let archiveFreshFailureOutput;'+helper+logging+
      'return archiveFreshFailureOutput;')(input,{error:value=>logs.push(JSON.parse(value))});
    return {result,logs};
  };
  run('cleanup','native cleanup-only failure emits retained independent decisions after all resource cleanup',()=>{
    const {logs,result}=cleanupRecord();assert.equal(logs.length,1);assert.equal(logs[0].restore_phase,'restore_cleanup');
    assert.equal(logs[0].authority_commit_status,'ACKNOWLEDGED');assert.deepEqual(logs[0].authority_status_request,authority());
    assert.equal(result.restore_phase,'archive_cleanup');closedFlags(logs[0]);
    assert.equal(JSON.stringify(logs).includes('UNIT cleanup'),false);
  });
  run('cleanup','operation failure plus cleanup does not replace or duplicate its already-built first failure output',()=>{
    const {logs,result}=cleanupRecord({restoreLifecycleFailed:true});assert.equal(logs.length,0);
    assert.equal(result.authority_commit_status,'ACKNOWLEDGED');
  });
  run('cleanup','clean native completion emits nothing but retains bounded same-invocation archive failure DATA',()=>{
    const {logs,result}=cleanupRecord({restoreCleanupErrors:[]});assert.equal(logs.length,0);
    assert.equal(result.commit_status,'ACKNOWLEDGED');assert.equal(result.authority_commit_status,'ACKNOWLEDGED');
  });
  run('cleanup','archive cleanup-only failure logs original decisions then throws exact original cleanup error',()=>{
    const {result}=cleanupRecord({restoreCleanupErrors:[]}),failure=new Error('UNIT private archive failure'),logs=[];
    const fragment=source.slice(source.indexOf('if (archiveCleanupFailed && archiveFreshFailureOutput)'),source.indexOf('console.log(archiveSuccessOutput);'));
    let caught;try{new Function('archiveCleanupFailed','archiveFreshFailureOutput','archiveCleanupFailure','console',fragment)(true,result,failure,
      {error:value=>logs.push(JSON.parse(value))});}catch(error){caught=error;}
    assert.equal(caught,failure);assert.equal(logs.length,1);assert.equal(logs[0].restore_phase,'archive_cleanup');
    assert.equal(logs[0].authority_commit_status,'ACKNOWLEDGED');assert.equal(JSON.stringify(logs).includes('UNIT private archive failure'),false);
  });
  run('cleanup','retained archive handoff contains no fresh Source/private pointer or current-success reconstruction',()=>{
    const {result}=cleanupRecord();assert.deepEqual(Object.keys(result).sort(),[
      'ok','database_only','restore_phase','restore_table','commit_status','authority_commit_status','original_status_request','authority_status_request',
      'readback_outcome','mutations_paused','metadata_only','complete_restore','resume_allowed','retry_allowed','rerun_import_allowed','retry_safe','restore_error'].sort());
    assert.doesNotMatch(helper+logging,/JSON\.parse|archiveSuccessOutput|await |db\.|observeFreshOriginal/);
  });
  run('structure','failure formatter has no phase-derived decisions or new work and successful paths remain outside this change',()=>{
    assert.doesNotMatch(helper,/restorePhase|error\.|await |db\.|observeFresh|UUID|Date/);
    assert.doesNotMatch(source.slice(from,to),/restorePhase\.includes/);
    assert.ok(source.indexOf('  try { await Reflect.apply(endRestoreClient, db, []); }')<source.indexOf('function freshRecordedFailureHandoff() {'));
    assert.ok(source.indexOf('if (archiveLifecycleFailed) {')<source.indexOf('if (archiveCleanupFailed && archiveFreshFailureOutput)'));
    assert.match(source,/throw new AggregateError\(\[restoreLifecycleFailure, \.\.\.restoreCleanupErrors\]/);
  });
  for(const status of ['ACKNOWLEDGED','UNKNOWN','UNAVAILABLE']) {
    run('pause','pause fact is retained only with acknowledged original DATA, not invented before '+status,()=>{
      const {result}=evaluate({freshDatabaseCommitAcknowledged:status==='ACKNOWLEDGED',freshCommitNeedsObservation:status==='UNKNOWN',
        freshAuthorityCommitAcknowledged:false,freshAuthorityCommitInvoked:false,freshAuthorityCommitNeedsObservation:false,prepared:false});
      if(status==='UNAVAILABLE'){assert.equal(Object.hasOwn(result,'commit_status'),false);assert.equal(result.database_commit_status_unavailable,true);}
      else assert.equal(result.commit_status,status);
      closedFlags(result);
    });
  }
  run('pause','legacy cleanup path still emits no new fresh recovery output',()=>{
    const {logs,result}=cleanupRecord({freshPrivateDatabase:false});assert.equal(logs.length,0);assert.equal(result,undefined);
  });
  run('pause','invoked unacknowledged authority is UNKNOWN despite a public not-attempted exception claim',()=>{
    const {result}=evaluate({freshAuthorityCommitAcknowledged:false,freshAuthorityCommitNeedsObservation:false,freshAuthorityCommitInvoked:true,
      error:{commit_attempted:false,authority_commit_status:'NOT_COMMITTED'}});
    assert.equal(result.commit_status,'ACKNOWLEDGED');assert.equal(result.authority_commit_status,'UNKNOWN');
    assert.deepEqual(result.authority_status_request,authority());assert.equal(result.readback_outcome,'UNRESOLVED');
  });
  assert.ok(cases.length>0);
  console.log(JSON.stringify({status:'FRESH_FAILURE_RECOVERY_SOURCE_ONLY',cases:cases.length,native_SQL:'NOT_RUN',resources:0}));
  process.exit(0);
}

// NEW caller Source control-flow only. No module-link substitute for Main's
// private factory, native client/locks, SQL, intent, Source or effect admission.
if (process.argv.includes('--fresh-post-authority-continuation-only')) {
  const {readFileSync}=await import('node:fs');
  const {createHash}=await import('node:crypto');
  const {types}=await import('node:util');
  const predecessor=process.argv.includes('--fresh-post-authority-predecessor');
  const group=process.argv.find(v=>v.startsWith('--fresh-continuation-case='))?.split('=')[1];
  assert.ok(group===undefined||['reproduction','flow','refusal','tail','lifecycle','structure','handoff','holdhandoff'].includes(group));
  const source=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
  const extract=(text,start,end)=>{
    assert.equal(text.split(start).length,2);const a=text.indexOf(start)+start.length,b=text.indexOf(end,a);
    assert.ok(b>a);return text.slice(a,b);
  };
  const fresh=text=>extract(text,'try {\n  if (freshPrivateDatabase) {\n','  } else {\n  restorePhase = "preflight";');
  const shared=extract(source,'async function continueRestoreAfterDatabase(', '\ntry {\n  await db.connect();');
  const sharedDefinition='async function continueRestoreAfterDatabase('+shared;

  // Exact inverse of ONLY this caller join; no task-local before/ fixture is
  // required after integration. The complete frozen predecessor hash binds
  // the retained original statements used by the regression/preservation cases.
  let legacyTail=sharedDefinition.slice(sharedDefinition.indexOf('  let cronEvidence = null;\n'));
  legacyTail=legacyTail.replace(/^\s*requireFreshContinuation\(\);\n/gm,'');
  const freshOutput=source.slice(source.indexOf('    ...(freshPrivateDatabase ? {complete_restore:false,resume_allowed:false,retry_allowed:false,rerun_import_allowed:false,'),
    source.indexOf('      remaining_phases:["SIGNED_RECONCILIATION"],normal_production_private_apply:"PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED"} : {}),')+
    '      remaining_phases:["SIGNED_RECONCILIATION"],normal_production_private_apply:"PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED"} : {}),'.length)+'\n';
  legacyTail=legacyTail.replace(freshOutput,'').slice(0,-1); // Drop only moved function's closing brace.
  const bridgeStart=source.indexOf('      // Bridge the already-held xact fences BEFORE this original RO snapshot');
  const bridgeEnd=source.indexOf('    } catch (error) {\n      const attempted',bridgeStart);
  assert.ok(bridgeStart>=0&&bridgeEnd>bridgeStart);
  const legacyCompletion="      await db.query(\"rollback\");\n      transactionAttempted = false;\n      requireOriginalArchiveSource();\n      // Authority invalidation is observed, not full restoration or resume.\n      // Storage/reconciliation/final acceptance remain distinct later work.\n      restoreSuccessOutput = JSON.stringify({ok:true,database_only:true,restore_id:restoreId,\n        authority_generation:generation,archive_digest:archiveDigest,target_project_ref:projectRef,\n        database_phase:committed,original_data_readback:originalDataReadback,\n        authority_staged:authorityStaged,authority_commit:authorityCommitted,authority_observation:authorityObservation,\n        authority_data_readback:authorityDataReadback,\n        state:\"DATABASE_RESTORED\",mutations_paused:true,\n        complete_restore:false,resume_allowed:false,retry_allowed:false,rerun_import_allowed:false,\n        remaining_phases:[\"STORAGE\",\"AUTHORITY_EVIDENCE_RECONCILIATION\",\"POST_RESTORE_VERIFICATION\",\"SIGNED_RECONCILIATION\"],\n        normal_production_private_apply:\"PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED\"},null,2);\n";
  const before=source.replace('  holdVerifiedImmutableFreshPostAuthorityFence,\n','')
    .replace(sharedDefinition+'\n','')
    .replace(source.slice(bridgeStart,bridgeEnd),legacyCompletion)
    .replace('    // No legacy pause/prepare, second initializer, TRUNCATE/replica or second\n'+
      '    // authority rewrite. Only the original private factory may bridge to the\n'+
      '    // existing paused continuation after both acknowledged original decisions.\n',
      '    // No legacy pause/prepare, second initializer, TRUNCATE/replica, cron,\n'+
      '    // Storage, authority rewrite or reconciliation on this database phase.\n')
    .replace('  await continueRestoreAfterDatabase({databaseEvidence,immutablePrivateDataEvidence,unvalidatedCheckEvidence,invalidated});\n',legacyTail);
  assert.equal(createHash('sha256').update(before).digest('hex'),'9ce163382ab32775eedde4c5035d576ecaadc31c98738c13cb5b9aa408779645');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const cases=[];
  const run=async(part,name,body)=>{if(!group||group===part){await body();cases.push(name);
    console.log(JSON.stringify({case:name,status:'PASS_NEW_CALLER_SOURCE_ONLY'}));}};
  const request={restoreId:'00000000-0000-4000-8000-000000000009',generation:7,archiveDigest:'a'.repeat(64),targetProjectRef:'unitonlyinvalid000000'};
  const counts={employee_credentials:'1',employee_enrollment:'2',manager_credentials:'3',manager_enrollment:'4',manager_push:'5',auth_sessions:'6'};
  const post=()=>({schema:'custodial.immutable-private-post-authority-data-readback.v1',state:'SOURCE_TRANSFORMATION_VERIFIED',
    private_data:{state:'MATCH',tables:[]},ordinary_data:{state:'SOURCE_TRANSFORMATION_VERIFIED',tables:[]},
    storage_data:{status:'NOT_APPLICABLE_ORIGINAL_NO_MEMBERS',tables:[]},comparison_only:true,metadata_only:true,
    complete_restore:false,resume_allowed:false,retry_allowed:false,rerun_import_allowed:false,inventory_acknowledged:false,effects:false});
  async function recordFresh({old=false,failAt,hasFailure=false,failureValue,withdrawAt,
    postChange,observation='AUTHORITY_COMPLETION_OBSERVED',rollbackFails=false}={}) {
    const trace=[],calls=[],snapshot={};let current=true,transaction=false,rollbacks=0;
    const sourceFailure=new Error('UNIT Source withdrawn'),cleanupFailure=new Error('UNIT rollback failed');
    const step=async(label,result)=>{trace.push(label);calls.push(label);
      if(failAt===label&&hasFailure)throw failureValue;
      if(withdrawAt===label)current=false;await Promise.resolve();return result;};
    const requireOriginalArchiveSource=()=>{trace.push('source');if(!current)throw sourceFailure;};
    const db={query:async sql=>{
      const label=sql==='rollback'?'rollback':sql.startsWith('begin')?'begin':sql;
      if(label==='begin'){assert.equal(transaction,false);transaction=true;}
      if(label==='rollback'){rollbacks++;transaction=false;if(rollbackFails)throw cleanupFailure;}
      return step(label,{});
    }};
    const privateData={state:'MATCH',tables:[]},ordinaryData={state:'SOURCE_TRANSFORMATION_VERIFIED',tables:[]};
    const original={private_data:privateData,ordinary_data:ordinaryData,storage_data:{status:'NOT_APPLICABLE_ORIGINAL_NO_MEMBERS',tables:[]}};
    const committed={schema:'UNIT recorded original import DATA',commit_status:'ACKNOWLEDGED'};
    const authorityData=post();if(postChange)postChange(authorityData);
    const ports={db,requireOriginalArchiveSource,types,tableSelection:{databaseTables:[{row_count:'9007199254740993'},{row_count:'7'}]},
      verifiedArchive:Object.freeze({UNIT:'inert argument identity; NOT branded'}),intentEnvelope:{},intentVerifyKey:'UNIT unused',intentVerifyKeyId:'UNIT unused',
      ...request,projectRef:request.targetProjectRef,
      stageVerifiedImmutableFreshData:async()=>{assert.equal(transaction,true);return step('stage',{});},
      commitVerifiedImmutableFreshData:async()=>{const value=await step('data_commit',committed);transaction=false;return value;},
      inspectCommittedImmutableFreshData:async()=>{assert.equal(transaction,true);return step('original_read',original);},
      reconcileCommittedImmutableFreshAuthority:async()=>{assert.equal(transaction,false);transaction=true;
        return step('authority_stage',{completion:{revocations:counts}});},
      commitVerifiedImmutableFreshAuthority:async()=>{const value=await step('authority_commit',{requested_original:request});transaction=false;return value;},
      readVerifiedImmutableFreshAuthorityCommitOutcome:async()=>{assert.equal(transaction,true);return step('authority_read',{outcome:observation});},
      inspectCommittedImmutableFreshAuthorityData:async()=>{assert.equal(transaction,true);return step('post_read',authorityData);},
      holdVerifiedImmutableFreshPostAuthorityFence:async value=>{assert.equal(transaction,true);
        assert.equal(value.db,db);assert.equal(value.verifiedArchive,ports.verifiedArchive);
        assert.equal(calls.filter(v=>v==='post_read').length,1);snapshot.holdTransaction=true;return step('hold',undefined);},
      continueRestoreAfterDatabase:async value=>{snapshot.continuation=value;snapshot.tailTransaction=transaction;return step('continue',undefined);},
    };
    const declarations='const {db,requireOriginalArchiveSource,types,tableSelection,verifiedArchive,intentEnvelope,intentVerifyKey,intentVerifyKeyId,'+
      'restoreId,generation,archiveDigest,projectRef,stageVerifiedImmutableFreshData,commitVerifiedImmutableFreshData,inspectCommittedImmutableFreshData,'+
      'reconcileCommittedImmutableFreshAuthority,commitVerifiedImmutableFreshAuthority,readVerifiedImmutableFreshAuthorityCommitOutcome,'+
      'inspectCommittedImmutableFreshAuthorityData,holdVerifiedImmutableFreshPostAuthorityFence,continueRestoreAfterDatabase}=ports;'+
      'let prepared=false,mutationFenceHeld=false,restorePhase,restoreSuccessOutput,freshDataReadbackDisposition,freshAuthorityOriginalRequest;'+
      'let freshDatabaseCommitAcknowledged=false,freshAuthorityCommitInvoked=false,freshAuthorityCommitAcknowledged=false,'+
      'freshCommitNeedsObservation=false,freshAuthorityCommitNeedsObservation=false;let failed=false,failure;';
    const result=await new AsyncFunction('ports',declarations+'try{'+fresh(old?before:source)+'}catch(error){failed=true;failure=error;}'+
      'return {prepared,mutationFenceHeld,restorePhase,restoreSuccessOutput,freshDatabaseCommitAcknowledged,freshAuthorityCommitAcknowledged,failed,failure};')(ports);
    return {...result,trace,calls,snapshot,sourceFailure,cleanupFailure,rollbacks,transaction,failureValue};
  }
  await run('reproduction','actual fresh caller reaches shared tail rather than early DATABASE_RESTORED output',async()=>{
    const result=await recordFresh({old:predecessor});assert.equal(result.failed,false);
    console.log(JSON.stringify({predecessor,continuation_called:result.calls.includes('continue'),source_only:true}));
    assert.equal(result.calls.includes('continue'),true,'Fresh original caller stopped before its existing paused continuation');
  });
  await run('flow','one private hold under original RO snapshot, then rollback, then prepare and continue',async()=>{
    const result=await recordFresh();assert.equal(result.failed,false);
    assert.ok(result.calls.indexOf('post_read')<result.calls.indexOf('hold'));
    assert.equal(result.calls[result.calls.indexOf('hold')+1],'rollback');
    assert.equal(result.calls.at(-1),'continue');assert.equal(result.rollbacks,2);
    assert.equal(result.snapshot.holdTransaction,true);assert.equal(result.snapshot.tailTransaction,false);
    assert.equal(result.prepared,true);assert.equal(result.mutationFenceHeld,true);
    for(const name of ['stage','data_commit','authority_stage','authority_commit','post_read','hold','continue'])
      assert.equal(result.calls.filter(v=>v===name).length,1);
  });
  await run('flow','complete signed original counts stay exact decimal text and CHECKs are NOT_SUSPENDED only',async()=>{
    const result=await recordFresh(),value=result.snapshot.continuation;
    assert.equal(value.databaseEvidence.tables,2);assert.equal(value.databaseEvidence.rows,'9007199254741000');
    assert.equal(value.databaseEvidence.row_count_basis,'SIGNED_ORIGINAL_SELECTION');
    assert.deepEqual(value.unvalidatedCheckEvidence,{mode:'NOT_SUSPENDED'});
    assert.equal(Object.hasOwn(value.unvalidatedCheckEvidence,'count'),false);
    assert.equal(value.invalidated,counts);assert.equal(value.databaseEvidence.authority_data_readback.metadata_only,true);
    assert.equal(value.immutablePrivateDataEvidence,value.databaseEvidence.original_data_import);
  });
  for(const [name,change] of [['private DIFFERENT',v=>v.private_data.state='DIFFERENT'],['ordinary UNSUPPORTED',v=>v.ordinary_data.state='UNSUPPORTED'],
    ['Storage DIFFERENT',v=>v.storage_data.status='DIFFERENT'],['public effect permission',v=>v.effects=true],['missing comparison marker',v=>delete v.comparison_only]]) {
    await run('refusal',name+' refuses before session hold/continuation',async()=>{
      const result=await recordFresh({postChange:change});assert.equal(result.failed,true);
      assert.equal(result.calls.includes('hold'),false);assert.equal(result.calls.includes('continue'),false);
      assert.equal(result.prepared,false);assert.equal(result.mutationFenceHeld,false);
    });
  }
  await run('refusal','unavailable authority observation refuses before post read/hold',async()=>{
    const result=await recordFresh({observation:'UNKNOWN'});assert.equal(result.failed,true);
    assert.equal(result.calls.includes('post_read'),false);assert.equal(result.calls.includes('hold'),false);
  });
  for(const failure of [undefined,null,false,0,new Error('UNIT hold unknown')]) {
    await run('refusal','hold failure including falsy value remains original and never retries '+String(failure),async()=>{
      const result=await recordFresh({failAt:'hold',hasFailure:true,failureValue:failure});
      assert.equal(result.failed,true);assert.equal(result.failure,failure);
      assert.equal(result.calls.filter(v=>v==='hold').length,1);assert.equal(result.calls.includes('continue'),false);
      assert.equal(result.mutationFenceHeld,false);assert.equal(result.prepared,false);
    });
  }
  for(const label of ['post_read','hold','rollback']) {
    await run('refusal','Source withdrawal after '+label+' refuses publication',async()=>{
      const result=await recordFresh({withdrawAt:label});assert.equal(result.failed,true);assert.equal(result.failure,result.sourceFailure);
      assert.equal(result.calls.includes('continue'),false);assert.equal(result.prepared,false);
      if(label==='hold')assert.equal(result.mutationFenceHeld,true);
    });
  }
  await run('refusal','rollback failure does not publish preparation or tail',async()=>{
    const result=await recordFresh({rollbackFails:true});assert.equal(result.failed,true);
    assert.equal(result.calls.includes('continue'),false);assert.equal(result.prepared,false);
  });
  async function recordTail({freshPrivateDatabase=true,databaseOnly=true,prepared=true,mutationFenceHeld=true,
    failAt,hasFailure=false,failureValue,withdrawAt,unresolved=0,cronDrift=false}={}) {
    const trace=[],writes=[],events=[],controls=[];let current=true,transaction=false;
    const sourceFailure=new Error('UNIT tail Source withdrawn');
    const sourceCheck=()=>{trace.push('source');if(!current)throw sourceFailure;};
    const step=async(label,value)=>{trace.push(label);if(failAt===label&&hasFailure)throw failureValue;
      if(withdrawAt===label)current=false;await Promise.resolve();return value;};
    const db={query:async(sql,args=[])=>{
      let label=sql==='begin'||sql==='commit'||sql==='rollback'?sql:sql.includes('storage.buckets')?'buckets':sql.includes('storage.objects')?'objects':
        sql.startsWith('select count(*)')?'unresolved':sql.includes('authority_invalidated=true')?'authority_evidence':
        sql.includes('storage_verified=')?'storage_evidence':sql.includes('post_restore_verified=true')?'final_manifest':
        sql.includes('restore_discrepancies')?'cron_discrepancy':'unexpected';
      if(label==='begin'){assert.equal(transaction,false);transaction=true;}
      if(label==='commit'||label==='rollback')transaction=false;
      if(['authority_evidence','storage_evidence','final_manifest','cron_discrepancy'].includes(label))writes.push({label,sql,args});
      assert.notEqual(label,'unexpected');
      return step(label,label==='unresolved'?{rows:[{count:unresolved}]}:{rowCount:0,rows:[]});
    }};
    const ports={db,freshPrivateDatabase,databaseOnly,prepared,mutationFenceHeld,requireOriginalArchiveSource:sourceCheck,
      ...request,projectRef:request.targetProjectRef,summary:{format:'memphis-zoo-disaster-recovery.v4',source_identity:{UNIT:'original'}},
      archivedCronJobs:[],buckets:[],objects:[],secret:'UNIT-unused',
      restoreCronJobs:async()=>step('cron_restore',{before:[],actual:[],expected:[],differences:[]}),
      readCronJobs:async()=>step('cron_read',[]),compareCronJobs:()=>cronDrift?[{UNIT:'cron difference'}]:[],compareStorageState:()=>[],
      createClient:()=>{throw new Error('UNIT provider must not be reached');},
      recordEvent:async(phase,outcome,evidence)=>{events.push({phase,outcome,evidence});return step('event:'+phase,undefined);},
      setControl:async(state,options)=>{controls.push({state,options});return step('control:'+state,undefined);},
      stableJson:JSON.stringify,sha256Bytes:value=>createHash('sha256').update(value).digest('hex'),
    };
    const input={databaseEvidence:{tables:302,rows:'7380',original_data_import:{commit_status:'ACKNOWLEDGED'},
      original_data_readback:{comparison_only:true},authority_staged:{completion:{revocations:counts}},authority_commit:{commit_status:'ACKNOWLEDGED'},
      authority_observation:{outcome:'AUTHORITY_COMPLETION_OBSERVED'},authority_data_readback:{metadata_only:true}},
      immutablePrivateDataEvidence:freshPrivateDatabase?{}:null,unvalidatedCheckEvidence:{mode:'NOT_SUSPENDED'},invalidated:counts};
    const declarations='const {db,freshPrivateDatabase,databaseOnly,prepared,mutationFenceHeld,requireOriginalArchiveSource,restoreId,generation,'+
      'projectRef,archiveDigest,summary,archivedCronJobs,buckets,objects,secret,restoreCronJobs,readCronJobs,compareCronJobs,compareStorageState,'+
      'createClient,recordEvent,setControl,stableJson,sha256Bytes}=ports;let restorePhase,restoreSuccessOutput,failed=false,failure;';
    const result=await new AsyncFunction('ports','input',declarations+sharedDefinition+
      'try{await continueRestoreAfterDatabase(input);}catch(error){failed=true;failure=error;}'+
      'return {failed,failure,restorePhase,restoreSuccessOutput};')(ports,input);
    return {...result,trace,writes,events,controls,sourceFailure,transaction};
  }
  await run('tail','actual shared tail records original authority evidence and pauses, never resumes',async()=>{
    const result=await recordTail();assert.equal(result.failed,false);const output=JSON.parse(result.restoreSuccessOutput);
    assert.deepEqual(result.controls.map(v=>v.state),['STORAGE_RESTORING','VERIFYING','PAUSED_RECONCILIATION']);
    assert.equal(output.complete_restore,false);assert.equal(output.resume_allowed,false);assert.equal(output.retry_allowed,false);
    assert.equal(output.rerun_import_allowed,false);assert.equal(output.mutations_paused,true);assert.equal(output.state,'PAUSED_RECONCILIATION');
    assert.deepEqual(output.remaining_phases,['SIGNED_RECONCILIATION']);assert.equal(result.transaction,false);
    assert.equal(result.writes.filter(v=>v.label==='authority_evidence').length,1);
    assert.deepEqual(JSON.parse(result.writes[0].args[1]).invalidated,counts);
    assert.deepEqual(result.events.map(v=>v.phase),['AUTHORITY_RECONCILIATION','CRON','STORAGE','FINAL']);
    assert.equal(result.events.at(-1).evidence.resumed,false);
  });
  await run('tail','legacy caller uses same body without fresh authority evidence or new output flags',async()=>{
    const result=await recordTail({freshPrivateDatabase:false});assert.equal(result.failed,false);
    assert.equal(result.writes.some(v=>v.label==='authority_evidence'),false);
    assert.equal(Object.hasOwn(JSON.parse(result.restoreSuccessOutput),'complete_restore'),false);
  });
  for(const missing of [{databaseOnly:false},{prepared:false},{mutationFenceHeld:false}]) {
    await run('tail','fresh local/fence prerequisite refuses before any continuation IO '+JSON.stringify(missing),async()=>{
      const result=await recordTail(missing);assert.equal(result.failed,true);assert.equal(result.writes.length,0);assert.equal(result.events.length,0);
    });
  }
  for(const label of ['authority_evidence','event:AUTHORITY_RECONCILIATION','begin','cron_restore','commit','event:CRON',
    'control:STORAGE_RESTORING','buckets','objects','storage_evidence','event:STORAGE','control:VERIFYING','cron_read','unresolved','final_manifest',
    'control:PAUSED_RECONCILIATION','event:FINAL']) {
    await run('tail','late Source withdrawal after '+label+' cannot publish success',async()=>{
      const result=await recordTail({withdrawAt:label});assert.equal(result.failed,true);assert.equal(result.failure,result.sourceFailure);
      assert.equal(result.restoreSuccessOutput,undefined);
    });
  }
  for(const failure of [undefined,null,false,0,new Error('UNIT first tail failure')]) {
    await run('tail','tail preserves first falsy/error failure '+String(failure),async()=>{
      const result=await recordTail({failAt:'cron_restore',hasFailure:true,failureValue:failure});
      assert.equal(result.failed,true);assert.equal(result.failure,failure);assert.equal(result.restoreSuccessOutput,undefined);
      assert.equal(result.trace.includes('rollback'),true);assert.equal(result.controls.length,0);
    });
  }
  await run('tail','remaining discrepancies do not imply resume permission',async()=>{
    const result=await recordTail({unresolved:1,cronDrift:true});assert.equal(result.failed,false);
    const output=JSON.parse(result.restoreSuccessOutput);assert.equal(output.resume_eligible,false);assert.equal(output.resume_allowed,false);
    assert.equal(result.writes.some(v=>v.label==='cron_discrepancy'),true);
  });
  await run('structure','legacy tail statements preserved exactly except explicit fresh-only checks/evidence/output',async()=>{
    const original=extract(before,'  let cronEvidence = null;\n','  }\n} catch (error) {\n  const outcomeUnknown');
    let moved=sharedDefinition.slice(sharedDefinition.indexOf('  let cronEvidence = null;\n'));
    moved=moved.replace(/^\s*requireFreshContinuation\(\);\n/gm,'');
    moved=moved.replace('    ...(freshPrivateDatabase ? {complete_restore:false,resume_allowed:false,retry_allowed:false,rerun_import_allowed:false,\n'+
      '      archive_digest:archiveDigest,target_project_ref:projectRef,database_phase:databaseEvidence.original_data_import,\n'+
      '      original_data_readback:databaseEvidence.original_data_readback,authority_staged:databaseEvidence.authority_staged,\n'+
      '      authority_commit:databaseEvidence.authority_commit,authority_observation:databaseEvidence.authority_observation,\n'+
      '      authority_data_readback:databaseEvidence.authority_data_readback,\n'+
      '      remaining_phases:["SIGNED_RECONCILIATION"],normal_production_private_apply:"PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED"} : {}),\n','');
    assert.equal(moved,'  let cronEvidence = null;\n'+original+'}');
    const legacyStart='  } else {\n  restorePhase = "preflight";';
    assert.equal(extract(source,legacyStart,'  await continueRestoreAfterDatabase({databaseEvidence,immutablePrivateDataEvidence,unvalidatedCheckEvidence,invalidated});'),
      extract(before,legacyStart,'  let cronEvidence = null;'));
    assert.equal(source.slice(source.indexOf('} catch (error) {\n  const outcomeUnknown')),before.slice(before.indexOf('} catch (error) {\n  const outcomeUnknown')));
    assert.equal(source.slice(source.indexOf('const sourceInput = '),source.indexOf('async function continueRestoreAfterDatabase(')),
      before.slice(before.indexOf('const sourceInput = '),before.indexOf('try {\n  await db.connect();')));
    assert.equal((source.match(/async function continueRestoreAfterDatabase\(/g)||[]).length,1);
    assert.equal((source.match(/await continueRestoreAfterDatabase\(/g)||[]).length,2);
    assert.equal((fresh(source).match(/await holdVerifiedImmutableFreshPostAuthorityFence\(/g)||[]).length,1);
    assert.doesNotMatch(fresh(source),/invalidateRestoredAuthority|suspendUnvalidatedRestoreChecks|session_replication_role|truncate /i);
  });
  // The caller has earlier finally blocks: use the exact native end
  // anchor instead of adopting or rewriting their unrelated cleanup bodies.
  const cleanupStart=source.lastIndexOf('} finally {\n  if (restoreSessionLockHeld) {');
  const cleanupEnd=source.indexOf('}\nif (restoreLifecycleFailed) {',cleanupStart);
  assert.ok(cleanupStart>=0&&cleanupEnd>cleanupStart);
  const cleanupBody=source.slice(cleanupStart+'} finally {\n'.length,cleanupEnd);
  async function recordCleanup(held,{failUnlock=false}={}) {
    const trace=[],failure=new Error('UNIT unlock failure');
    const db={query:async sql=>{const label=sql.includes('production-restore')?'global_unlock':'mutation_unlock';trace.push(label);
      if(failUnlock&&label==='mutation_unlock')throw failure;return {rowCount:1,rows:[{pg_advisory_unlock:true}]};}};
    const endRestoreClient=async function(){assert.equal(this,db);trace.push('end');};
    const result=await new AsyncFunction('db','endRestoreClient','held',
      'let restoreSessionLockHeld=true,mutationFenceHeld=held;const restoreCleanupErrors=[];'+cleanupBody+
      'return {restoreSessionLockHeld,mutationFenceHeld,restoreCleanupErrors};')(db,endRestoreClient,held);
    return {...result,trace,failure};
  }
  await run('lifecycle','acknowledged hold flows through existing exact unlock and original end once',async()=>{
    const result=await recordCleanup(true);assert.deepEqual(result.trace,['global_unlock','mutation_unlock','end']);
    assert.equal(result.mutationFenceHeld,false);assert.equal(result.restoreCleanupErrors.length,0);
  });
  await run('lifecycle','unknown hold does not blind-relock or invent successful unlock; original end remains',async()=>{
    const result=await recordCleanup(false);assert.deepEqual(result.trace,['global_unlock','end']);
    assert.equal(result.restoreCleanupErrors.length,0);
  });
  await run('lifecycle','unlock failure still drains original end and blocks success in unchanged caller',async()=>{
    const result=await recordCleanup(true,{failUnlock:true});assert.deepEqual(result.trace,['global_unlock','mutation_unlock','end']);
    assert.equal(result.restoreCleanupErrors[0],result.failure);
    assert.match(source,/if \(restoreCleanupErrors.length === 1\) throw restoreCleanupErrors\[0\];/);
    assert.ok(source.lastIndexOf('return restoreSuccessOutput;')>source.indexOf('if (restoreCleanupErrors.length === 1)'));
  });
  await run('handoff','fresh paused output retains original lookup tuple and acknowledged/readback metadata',async()=>{
    const result=await recordTail();assert.equal(result.failed,false);const output=JSON.parse(result.restoreSuccessOutput);
    assert.equal(output.archive_digest,request.archiveDigest);assert.equal(output.target_project_ref,request.targetProjectRef);
    assert.equal(output.database_phase.commit_status,'ACKNOWLEDGED');assert.equal(output.original_data_readback.comparison_only,true);
    assert.deepEqual(output.authority_staged.completion.revocations,counts);assert.equal(output.authority_commit.commit_status,'ACKNOWLEDGED');
    assert.equal(output.authority_observation.outcome,'AUTHORITY_COMPLETION_OBSERVED');assert.equal(output.authority_data_readback.metadata_only,true);
    assert.equal(output.normal_production_private_apply,'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED');
  });
  await run('holdhandoff','unknown acquisition retains both acknowledged decisions and existing authority status handoff phase',async()=>{
    const failure=Object.freeze({code:'UNIT unknown hold',outcome:'UNKNOWN',retry_safe:false});
    const result=await recordFresh({failAt:'hold',hasFailure:true,failureValue:failure});
    assert.equal(result.failure,failure);assert.equal(result.freshDatabaseCommitAcknowledged,true);
    assert.equal(result.freshAuthorityCommitAcknowledged,true);assert.ok(result.restorePhase.includes('original_authority'));
    assert.equal(result.calls.filter(v=>v==='hold').length,1);assert.equal(result.calls.includes('continue'),false);
    assert.equal(result.mutationFenceHeld,false);
    assert.match(source,/if\(restorePhase.includes\('original_authority'\)\)Object.assign\(failureOutput/);
  });
  assert.ok(cases.length>0);
  console.log(JSON.stringify({status:'FRESH_PAUSED_CONTINUATION_SOURCE_ONLY',cases:cases.length,native_SQL:'NOT_RUN',
    private_factory_module_join:'MAIN_DEPENDENCY_NOT_RUN',provider:'NOT_RUN',resources:0}));process.exit(0);
}

// Only the two newly affected legacy caller fragments. These ports record
// Source control flow; they do not implement a native database or snapshot.
if (process.argv.includes('--legacy-snapshot-text-output-caller-only')) {
  const {readFileSync}=await import('node:fs');
  const {createHash}=await import('node:crypto');
  const source=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
  const hash=text=>createHash('sha256').update(text).digest('hex');
  const settings=[
    'set local extra_float_digits = 3',
    "set local datestyle = 'ISO, YMD'",
    "set local timezone = 'UTC'",
    "set local intervalstyle = 'postgres'",
    "set local bytea_output = 'hex'",
  ];
  const setup='    requireOriginalArchiveSource();\n'+settings.map(sql=>
    `    await db.query(${JSON.stringify(sql)});\n    requireOriginalArchiveSource();\n`).join('');
  const comments={
    snapshot:'    // Canonical native TEXT output belongs only to this snapshot transaction.\n',
    reconciliation:"    // Match the retained snapshot's native TEXT output before comparison/upsert.\n",
  };
  const extract=(text,start,end)=>{
    assert.equal(text.split(start).length,2);assert.equal(text.split(end).length,2);
    const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a);
    return text.slice(a,b);
  };
  const fragments={
    snapshot:extract(source,'  restorePhase = "quiescent_snapshot";',
      '\n  requireOriginalArchiveSource();\n  restorePhase = "restore_database";'),
    reconciliation:extract(source,'  restorePhase = "authority_reconciliation";',
      '\n  let cronEvidence = null;'),
  };
  const predecessorHashes={
    snapshot:'40f82cf58ea396961454ac912f808f486f4e901767a2f7be4d37cc1c6fe6a198',
    reconciliation:'32d3b0b545a0dbedc90b0dba593dcbb1a837fecc1b20d8f771d1c99b19a6d12d',
  };
  const fresh=extract(source,'  if (freshPrivateDatabase) {','  } else {\n  restorePhase = "preflight";');
  assert.equal(hash(fresh),'1ef21d99866b17a09ec0e3b354109f68251d9fcccc6e5afb80fbebd9d210450b');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const compile=fragment=>new AsyncFunction('ports',
    'const {db,requireOriginalArchiveSource,capturePreRestoreState,recordEvent,restoreId,generation,'+
    'quiescentTargetIdentity,activeLeaseCount,expiredLeaseCount,immutablePrivateDataEvidence,prepared,'+
    'mutationFenceHeld,readTargetIdentity,assertIntentTargetIdentity,compareRestoredState,'+
    'preserveCurrentReleaseIdentity,invalidateRestoredAuthority}=ports;let restorePhase;\n'+fragment);
  const cases=[],predecessors={};
  for(const [name,fragment] of Object.entries(fragments)) {
    assert.equal(fragment.split(comments[name]+setup).length,2);
    predecessors[name]=fragment.replace(comments[name]+setup,'');
    assert.equal(hash(predecessors[name]),predecessorHashes[name]);
    assert.equal(fragment.indexOf('  await db.query("begin");')<fragment.indexOf(setup),true);
    assert.deepEqual([...setup.matchAll(/await db.query\(("[^\n]+")\);/g)].map(x=>JSON.parse(x[1])),settings);
    cases.push(name+': exact five SET LOCAL additions only; original transaction/replication/cleanup unchanged');
  }
  cases.push('fresh-private branch byte-identical to frozen B72dd source');
  async function record(name,{predecessor=false,failSetting=-1,settingFailure={value:new Error('UNIT setting failure')},
    withdrawAfter=-1,initiallyCurrent=true,beginError=false,rollbackError=false,workFailure=null,
    immutable=false}={}) {
    const trace=[],executed=[],work=[],values=[];
    const profileFailure=new Error('UNIT caller requires complete native output profile');
    const sourceFailure=new Error('UNIT original Source withdrawn');
    const beginFailure=new Error('UNIT BEGIN failure'),cleanupFailure=new Error('UNIT rollback failure');
    const request=Object.freeze({restoreId:'00000000-0000-4000-8000-000000000009',generation:7});
    let current=initiallyCurrent,inTransaction=false,failed=false,failure;
    const requireOriginalArchiveSource=()=>{trace.push('source');if(!current)throw sourceFailure;};
    const requireProfile=()=>{assert.equal(inTransaction,true);if(values.length!==5)throw profileFailure;assert.deepEqual(values,settings);};
    const call=async(label,client,tuple,result)=>{
      assert.equal(client,db);requireProfile();assert.deepEqual(tuple,request);
      trace.push(label);work.push(label);if(workFailure===label)throw workFailure;return result;
    };
    const db={query:async(sql,args)=>{
      trace.push(sql);executed.push(sql);
      if(sql==='begin'){if(beginError)throw beginFailure;assert.equal(inTransaction,false);inTransaction=true;return;}
      if(sql==='rollback'){inTransaction=false;if(rollbackError)throw cleanupFailure;return;}
      if(sql==='commit'){assert.equal(inTransaction,true);inTransaction=false;return;}
      assert.equal(inTransaction,true);
      const index=settings.indexOf(sql);
      if(index!==-1){
        assert.deepEqual(values,settings.slice(0,index));
        if(failSetting===index)throw settingFailure.value;
        values.push(sql);if(withdrawAfter===index)current=false;
        await Promise.resolve();return;
      }
      if(sql==='set local session_replication_role = replica')return;
      if(sql==='show session_replication_role')return {rowCount:1,rows:[{session_replication_role:'origin'}]};
      assert.ok(sql.startsWith('update custodial_dr.restore_manifests set authority_invalidated=true,'));
      assert.equal(args[0],request.restoreId);assert.ok(work.includes('invalidate'));return;
    }};
    const ports={db,requireOriginalArchiveSource,...request,
      quiescentTargetIdentity:{migration_head:'UNIT-only'},activeLeaseCount:0,expiredLeaseCount:0,
      immutablePrivateDataEvidence:immutable?Object.freeze({}):null,prepared:true,mutationFenceHeld:true,
      readTargetIdentity:async()=>{trace.push('target_identity');return 'UNIT-target';},
      assertIntentTargetIdentity:value=>assert.equal(value,'UNIT-target'),
      capturePreRestoreState:(client,tuple)=>call('capture',client,tuple,{UNIT:'snapshot'}),
      compareRestoredState:(client,tuple)=>call('compare',client,tuple,[]),
      preserveCurrentReleaseIdentity:(client,tuple)=>call('preserve',client,tuple,1),
      invalidateRestoredAuthority:async(client,tuple)=>{
        assert.equal(client,db);assert.deepEqual(tuple,{generation:request.generation});
        requireProfile();trace.push('invalidate');work.push('invalidate');return {};
      },
      recordEvent:async(...args)=>{requireProfile();trace.push('event');work.push('event');
        assert.equal(args[1],'PASSED');},
    };
    try{await compile(predecessor?predecessors[name]:fragments[name])(ports);}
    catch(error){failed=true;failure=error;}
    return {trace,executed,work,values,failed,failure,profileFailure,sourceFailure,beginFailure,inTransaction};
  }
  for(const name of Object.keys(fragments)) {
    const old=await record(name,{predecessor:true});
    assert.equal(old.failed,true);assert.equal(old.failure,old.profileFailure);
    assert.deepEqual(old.values,[]);assert.equal(old.executed.at(-1),'rollback');
    assert.equal(old.executed.includes('commit'),false);assert.deepEqual(old.work,[]);
    cases.push(name+': predecessor lacks all five settings and refuses simulated output prerequisite');
    const good=await record(name);
    assert.equal(good.failed,false);assert.deepEqual(good.values,settings);
    assert.deepEqual(good.executed.slice(0,6),['begin',...settings]);
    assert.deepEqual(good.work,name==='snapshot'?['capture','event']:['compare','preserve','invalidate','event']);
    assert.equal(good.executed.at(-1),'commit');assert.equal(good.inTransaction,false);
    for(const sql of settings){const at=good.trace.indexOf(sql);assert.equal(good.trace[at-1],'source');assert.equal(good.trace[at+1],'source');}
    cases.push(name+': BEGIN then five fixed settings with before/after Source checks, before all own work');
    for(let index=0;index<5;index++) {
      const error=new Error('UNIT first setting error');
      const failed=await record(name,{failSetting:index,settingFailure:{value:error},rollbackError:true});
      assert.equal(failed.failed,true);assert.equal(failed.failure,error);
      assert.deepEqual(failed.executed,['begin',...settings.slice(0,index+1),'rollback']);
      assert.deepEqual(failed.work,[]);assert.equal(failed.inTransaction,false);
      cases.push(name+': setting '+index+' refusal stops later work and preserves first error despite cleanup failure');
      const withdrawn=await record(name,{withdrawAfter:index});
      assert.equal(withdrawn.failed,true);assert.equal(withdrawn.failure,withdrawn.sourceFailure);
      assert.deepEqual(withdrawn.executed,['begin',...settings.slice(0,index+1),'rollback']);
      assert.deepEqual(withdrawn.work,[]);
      cases.push(name+': Source withdrawal during setting '+index+' stops before later work');
    }
    const stale=await record(name,{initiallyCurrent:false});
    assert.equal(stale.failure,stale.sourceFailure);assert.deepEqual(stale.executed,['begin','rollback']);
    cases.push(name+': unavailable original refuses before first setting');
    for(const error of [undefined,null,false,0,'']) {
      const failed=await record(name,{failSetting:2,settingFailure:{value:error},rollbackError:true});
      assert.equal(failed.failed,true);assert.equal(failed.failure,error);
      assert.deepEqual(failed.work,[]);assert.equal(failed.executed.at(-1),'rollback');
      cases.push(name+': falsy setting failure retained exactly ('+String(error)+')');
    }
    const begin=await record(name,{beginError:true});
    assert.equal(begin.failure,begin.beginFailure);assert.deepEqual(begin.executed,['begin']);
    cases.push(name+': existing BEGIN-failure ownership unchanged, no settings or owned rollback');
    const downstream=await record(name,{workFailure:name==='snapshot'?'capture':'compare',rollbackError:true});
    assert.equal(downstream.failed,true);assert.equal(downstream.failure,name==='snapshot'?'capture':'compare');
    assert.deepEqual(downstream.work,[name==='snapshot'?'capture':'compare']);
    assert.equal(downstream.executed.at(-1),'rollback');assert.equal(downstream.executed.includes('commit'),false);
    cases.push(name+': original downstream failure and existing rollback behavior unchanged');
  }
  const privateLegacy=await record('reconciliation',{immutable:true});
  assert.equal(privateLegacy.failed,false);assert.deepEqual(privateLegacy.executed.slice(0,6),['begin',...settings]);
  assert.ok(privateLegacy.executed.includes('show session_replication_role'));
  assert.equal(privateLegacy.executed.includes('set local session_replication_role = replica'),false);
  cases.push('older immutable reconciliation retains origin/target check, no replica change');
  console.log(JSON.stringify({scope:'NEW_LEGACY_SNAPSHOT_TEXT_OUTPUT_CALLER_SOURCE_ONLY',
    production_restore_sha256:hash(source),cases,count:cases.length,
    limits:'Exact shipping caller fragments and inert query/snapshot ports only; no native SQL, output GUC/runtime/auth, archive, restore or whole-G31 proof. Historical test groups not run.',
    resources:{SQL_connections:0,child_processes:0,listeners:0}}));
  process.exit(0);
}

if(process.argv.includes('--immutable-ordinary-original-readback-only')||process.argv.includes('--immutable-ordinary-coverage-limit-only')||process.argv.includes('--immutable-ordinary-generated-types-only')||process.argv.includes('--immutable-ordinary-temp-path-only')||process.argv.includes('--immutable-ordinary-first-sql-failure-only')||process.argv.includes('--immutable-ordinary-float-output-only')){
 const {readFileSync}=await import('node:fs'),{createHash}=await import('node:crypto');
 const {types,isDeepStrictEqual}=await import('node:util'),{Readable}=await import('node:stream'),{pipeline}=await import('node:stream/promises');
 const {default:pg}=await import('pg');
 const {decodeRestoreTableRowLine,createRestoreRowUtf8Guard,createRestoreRowLineBatchDecoder,postgresJsonTextLineEncoding}=await import('./disaster-recovery-archive.mjs');
 const {compareVerifiedImmutableOrdinaryTableData:realCompare}=await import('./immutable-private-data-import.mjs');
 const source=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
 const marker='export async function compareVerifiedImmutableOrdinaryTableData(options)';assert.equal(source.split(marker).length,2);
 const append=marker.replace('export ','')+source.split(marker)[1],redaction='} catch {\n    // No raw row/SQL/session detail or missing-as-empty proof is exposed.';
 assert.equal(append.split(redaction).length,2);
 // Exact shipping append, explicitly inert Source/query ports. Real binary
 // UTF8 + chunk/line + raw-row decoders, NOT a verified archive or native SQL
 // positive. No pg.Client method/prototype is changed or connected.
 const compile=new Function('types','isDeepStrictEqual','Client','query','closed','sameSource','readVerifiedPrivateImportSource',
  'openVerifiedRestoreTableData','decodeRestoreTableRowLine','createRestoreRowUtf8Guard','createRestoreRowLineBatchDecoder',
  'postgresJsonTextLineEncoding','pipeline','recordFailure',append.replace(redaction,
   '} catch(error) { recordFailure(error);\n    // No raw row/SQL/session detail or missing-as-empty proof is exposed.')+'\nreturn compareVerifiedImmutableOrdinaryTableData;');
 const ownerCheck='CURRENT_TARGET_SOURCE_REQUIRES_OWNER_CHECK';
 const raw='{ "original_id":9223372036854775807,"payload":{ "z":1.00, "a":9007199254740993, "duplicate":1, "duplicate":2 },"recorded_at":"2026-10-17T00:00:00.123456+00:00" }';
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const fixedClosed=(value,keys)=>{
  assert.ok(value&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype);
  assert.deepEqual(Reflect.ownKeys(value).sort(),[...keys].sort());const copy={};
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);assert.ok(d&&Object.hasOwn(d,'value'));copy[key]=d.value;}return copy;
 };
 const journey=async(change=null)=>{
  const columns=[{name:'original_id',data_type:'bigint',generated:'',identity:''},
   {name:'payload',data_type:'json',generated:'',identity:''},
   {name:'recorded_at',data_type:'timestamp with time zone',generated:'',identity:''}];
  const ids=[['public','release_deployment_manifest'],['public','custodial_release_authority_restore_inventory'],
   ['public','ordinary_original'],['auth','ordinary_actor_original'],['public','empty_original']];
  const tables=ids.map(([schema_name,table_name],i)=>({schema_name,table_name,columns:structuredClone(columns),primary_key:[],
   row_count:i===4?'0':'1',data_file:`database/${schema_name}.${table_name}.jsonl`,data_encoding:postgresJsonTextLineEncoding}));
  const bytes=tables.map(t=>t.row_count==='0'?Buffer.alloc(0):Buffer.from(JSON.stringify(raw)+'\r\n'));
  const catalog=tables.map((t,i)=>({schema_name:t.schema_name,table_name:t.table_name,relation_oid:String(301+i),
   relation_kind:'r',persistence:'p',is_partition:false,owner_name:'INERT original_owner',inheritance_count:'0',dropped_count:'0',
   columns:structuredClone(t.columns),primary_key:[],supported_io:true}));
  const context={database_oid:'42',database_name:'INERT',backend_pid:123,actor:'INERT',session_actor:'INERT',transaction_id:null,
   virtual_xid:'7/8',snapshot_id:'8:9:',transaction_started_at:'INERT timestamp',read_only:'on',isolation:'repeatable read',
   row_security:'off',search_path:'pg_catalog',first_schema:'pg_catalog',timezone:'UTC',date_style:'ISO, MDY',interval_style:'postgres',float_digits:'1'};
  const counts=tables.map(t=>({original_rows:t.row_count,current_rows:t.row_count,missing_rows:'0',extra_rows:'0'}));
  const r={tables,bytes,catalog,context,counts,contextReads:0,queries:[],loans:[],open:[],close:[],sourceLive:true,sourceChecks:0,
   errors:[],eof:{},cleanupError:false,onContext:null,onCatalog:null,onCompare:null,onStream:null,onClose:null,sourceExtra:[]};
  change?.(r);
  const archive=Object.freeze({INERT:'not materialized or authenticated'});
  const original={sourceBinding:Object.freeze({INERT:'original Source stamp'}),selection:{databaseTables:[...tables,...r.sourceExtra]},privateDataMembers:[]};
  const current=()=>{r.sourceChecks++;assert.equal(r.sourceLive,true,'INERT Source withdrawn');};
  const reply=rows=>({command:'SELECT',rowCount:rows.length,rows});
  class RecordingClient{async query(sql,params){
   r.queries.push({sql,params});
   if(sql.includes("'transaction_started_at'")){r.contextReads++;r.onContext?.(r);const value=structuredClone(context);
    if(!sql.includes("'first_schema'"))delete value.first_schema;return reply([{context:value}]);}
   if(sql.includes('supported_io')){r.onCatalog?.(r);return reply(structuredClone(catalog));}
   assert.ok(sql.startsWith('with ')&&sql.includes('pg_catalog.row_to_json(r)::text collate "C"')&&sql.includes('pg_catalog.row_to_json(t)::text collate "C"'));
   assert.equal(sql.split('except all').length,3);assert.ok(!sql.includes('to_jsonb('));
   const i=tables.findIndex(t=>sql.includes(`from only "${t.schema_name}"."${t.table_name}"`));assert.ok(i>=2);
   r.loans.push({i,raw:[...params[0]]});r.onCompare?.(r,i);return reply([structuredClone(counts[i])]);
  }}
  const client=new RecordingClient();
  const compare=compile(types,isDeepStrictEqual,RecordingClient,RecordingClient.prototype.query,fixedClosed,
   (received,captured)=>{assert.equal(received,archive);assert.equal(captured,original);current();},
   received=>{assert.equal(received,archive);current();return original;},
   (received,schemaName,tableName)=>{
    assert.equal(received,archive);current();const i=tables.findIndex(t=>t.schema_name===schemaName&&t.table_name===tableName);assert.ok(i>=0);r.open.push(i);
    const stream=Readable.from((async function*(){r.onStream?.(r,i);for(let n=0;n<bytes[i].length;n+=65536)yield bytes[i].subarray(n,n+65536);})());
    return{table:structuredClone(tables[i]),stream,verified:Promise.resolve(r.eof[i]??{data_file:tables[i].data_file,sha256:hash(bytes[i]),bytes:bytes[i].length}),
     async close(){r.close.push(i);r.onClose?.(r);if(r.cleanupError)throw Error('INERT PRIVATE cleanup');}};
   },decodeRestoreTableRowLine,createRestoreRowUtf8Guard,createRestoreRowLineBatchDecoder,postgresJsonTextLineEncoding,pipeline,e=>r.errors.push(e));
  let value,error;try{value=await compare({db:client,verifiedArchive:archive});}catch(caught){error=caught;}
  assert.deepEqual(r.close,r.open);
  if(error){if(!process.argv.includes('--immutable-ordinary-first-sql-failure-only'))throw error;return{error,r};}
  assert.ok(Object.isFrozen(value)&&Object.isFrozen(value.tables)&&value.tables.every(Object.isFrozen));
  assert.ok(!JSON.stringify(value).includes('PRIVATE')&&!JSON.stringify(value).includes('payload'));
  assert.ok(r.queries.every(q=>q.sql.startsWith('select ')||q.sql.startsWith('with ')));
  return{value,r};
 };
 if(process.argv.includes('--immutable-ordinary-float-output-only')){
  // New output-profile controls using this existing inert fixture + real
  // decoders, NOT actual numeric collapse/native SQL/current-clock evidence.
  let controls=0,refusals=0;
  const denied=async change=>{
   const out=await journey(change);assert.equal(out.value.state,'UNSUPPORTED');refusals++;
   assert.ok(out.r.queries.filter(q=>q.sql.startsWith('with ')).every(q=>q.params[0].length===0));return out;
  };
  for(const profile of ['1','2','3']){
   const {value,r}=await journey(r=>{r.context.float_digits=profile;});
   assert.equal(value.state,ownerCheck,r.errors[0]?.stack);assert.ok(value.tables.slice(2).every(t=>t.state==='MATCH'));
   assert.ok(r.queries[0].sql.includes("'float_digits',pg_catalog.current_setting('extra_float_digits')"));controls++;
  }
  for(const profile of ['0','-1','-15','4','01','1 ',' 1','1\n','','NaN',0,1,2,3,-1,null,undefined,false,{},[]]){
   const out=await denied(r=>{r.context.float_digits=profile;});assert.equal(out.r.open.length,0);assert.equal(out.r.queries.length,1);
  }
  const absent=await denied(r=>{delete r.context.float_digits;});assert.equal(absent.r.open.length,0);
  for(const from of ['1','2','3'])for(const to of ['1','2','3'].filter(value=>value!==from)){
   const out=await denied(r=>{r.context.float_digits=from;r.onContext=v=>{if(v.contextReads===2)v.context.float_digits=to;};});
   assert.equal(out.r.open.length,0);assert.equal(out.r.contextReads,2);
  }
  await denied(r=>{r.onStream=v=>{v.context.float_digits='3';};});
  await denied(r=>{r.onCompare=v=>{v.context.float_digits='0';};});
  await denied(r=>{r.onClose=v=>{v.context.float_digits='-1';};});
  console.log(JSON.stringify({selected:'immutable-ordinary-float-output-only',controls,refusals,SQL:'NOT_RUN',
   source_recording_only:true,native_method_monkeypatch:false,old_groups_run:0,resources:0}));process.exit(0);
 }
 if(process.argv.includes('--immutable-ordinary-first-sql-failure-only')){
  const label='IMMUTABLE_ORDINARY_DATA_READBACK_SQL_FAILED',privateText='INERT PRIVATE driver SQL/body/detail';let controls=0,refusals=0;
  const driver=code=>{const e=new pg.DatabaseError(privateText,42,'error');e.code=code;e.detail=privateText;e.where=privateText;e.query=privateText;return e;};
  const safe=(observed,code)=>{const e=observed.error;assert.ok(e,'Native query SQLSTATE was swallowed');assert.equal(e.code,label);assert.equal(e.message,label);
   assert.equal(e.sql_state,code);assert.equal(e.outcome,'UNKNOWN');assert.equal(e.retry_safe,false);assert.ok(Object.isFrozen(e));
   assert.deepEqual(Object.keys(e).sort(),['code','outcome','retry_safe','sql_state'].sort());
   assert.equal(Object.hasOwn(e,'cause'),false);assert.equal(Object.hasOwn(e,'errors'),false);
   assert.ok(!JSON.stringify(e).includes(privateText)&&!e.stack.includes(privateText));
   assert.equal(observed.r.queries.length,observed.r.firstFailureQuery,'No native query after original query failure');controls++;};
  const arm=(r,hook,condition,code)=>{r[hook]=v=>{if(condition(v)){v.firstFailureQuery??=v.queries.length;throw driver(v.queries.length===v.firstFailureQuery?code:'25P02');}};};
  safe(await journey(r=>arm(r,'onContext',()=>true,'42501')),'42501');
  safe(await journey(r=>arm(r,'onCatalog',()=>true,'42P01')),'42P01');
  const compared=await journey(r=>arm(r,'onCompare',()=>true,'22003'));safe(compared,'22003');
  assert.ok(compared.r.queries.filter(q=>q.sql.startsWith('with ')).every(q=>q.params[0].length===0));
  safe(await journey(r=>{arm(r,'onContext',v=>v.open.length>0,'57014');r.onClose=()=>{throw driver('XX000');};}),'57014');
  safe(await journey(r=>{let n=0;r.onCatalog=v=>{if(++n===2){v.firstFailureQuery=v.queries.length;throw driver('55000');}};}),'55000');
  safe(await journey(r=>{r.onCompare=v=>{v.firstFailureQuery=v.queries.length;v.sourceLive=false;throw driver('P0001');};}),'P0001');
  let getterCalls=0,traps=0,coercions=0;
  const inherited=Object.create({code:'42501'}),accessor=Object.defineProperty(Error(privateText),'code',{get(){getterCalls++;throw Error(privateText);}});
  const proxy=new Proxy({code:'42501'},{get(){traps++;throw Error(privateText);},getOwnPropertyDescriptor(){traps++;throw Error(privateText);}});
  const wrapped={toString(){coercions++;return'42501';}};
  for(const e of [inherited,accessor,proxy,driver(null),driver(42501),driver('42p01'),driver('42501\n'),driver('ABCDEF'),driver(wrapped),privateText]){
   const out=await journey(r=>{r.onContext=v=>{v.firstFailureQuery??=v.queries.length;throw e;};});
   assert.equal(out.error,undefined);assert.equal(out.value.state,'UNSUPPORTED');assert.equal(out.r.queries.length,out.r.firstFailureQuery);refusals++;
  }
  for(const hook of ['onStream','onClose']){const out=await journey(r=>{r[hook]=()=>{throw driver('42501');};});
   assert.equal(out.error,undefined);assert.equal(out.value.state,'UNSUPPORTED');refusals++;}
  const malformed=await journey(r=>{r.counts[2].current_rows=1;});assert.equal(malformed.error,undefined);assert.equal(malformed.value.state,'UNSUPPORTED');refusals++;
  assert.equal(getterCalls,0);assert.equal(traps,0);assert.equal(coercions,0);
  console.log(JSON.stringify({selected:'immutable-ordinary-first-sql-failure-only',controls,refusals,status:'PASS_NEW_QUERY_ERROR_PROVENANCE_REDACTION_AND_CLEANUP_SOURCE_CASES',
   actual_driver_error_class:true,native_method_monkeypatch:false,SQL:'NOT_RUN',old_groups_run:0,resources:0}));process.exit(0);
 }
 if(process.argv.includes('--immutable-ordinary-temp-path-only')){
  let controls=0,refusals=0;
  for(const path of ['pg_catalog, pg_temp','pg_catalog']){
   const {value,r}=await journey(r=>{r.context.search_path=path;});
   assert.equal(value.state,ownerCheck,r.errors[0]?.stack);assert.ok(value.tables.slice(2).every(t=>t.state==='MATCH'));
   const sql=r.queries.find(q=>q.sql.includes("'transaction_started_at'")).sql;
   assert.ok(sql.includes("'first_schema',(pg_catalog.current_schemas(true))[1]::pg_catalog.text"));controls++;
  }
  for(const change of [r=>{r.context.search_path='pg_catalog';r.context.first_schema='pg_temp_1';},
   r=>{r.context.first_schema='pg_temp_1';},r=>{delete r.context.first_schema;},r=>{r.context.first_schema=null;},
   r=>{r.context.first_schema=1;},r=>{r.context.first_schema='public';},
   ...['pg_catalog, public','pg_temp, pg_catalog','pg_catalog,pg_temp','pg_catalog, pg_temp, public','"pg_catalog", pg_temp','public'].map(path=>r=>{r.context.search_path=path;}),
   r=>{r.context.row_security='on';},r=>{r.context.isolation='read committed';},
   r=>{r.onContext=v=>{if(v.contextReads>=5)v.context.first_schema='pg_temp_2';};},
   r=>{r.onContext=v=>{if(v.contextReads>=5)v.context.search_path='pg_catalog';};},
   r=>{r.onCompare=v=>{v.context.search_path='pg_catalog';};},r=>{r.onStream=v=>{v.sourceLive=false;};}]){
   const {value}=await journey(r=>{r.context.search_path='pg_catalog, pg_temp';change(r);});
   assert.equal(value.state,'UNSUPPORTED');refusals++;
  }
  console.log(JSON.stringify({selected:'immutable-ordinary-temp-path-only',controls,refusals,
   status:'PASS_NEW_EFFECTIVE_PATH_SOURCE_RECORDINGS_WITH_REAL_DECODERS',SQL:'NOT_RUN',native_method_monkeypatch:false,
   old_8_coverage_generated_groups_run:0,resources:0}));process.exit(0);
 }
 if(process.argv.includes('--immutable-ordinary-generated-types-only')){
  let controls=0,refusals=0;
  const configs=[
   ['cleaning_inspections',[['passed','boolean','s','',false]]],
   ['custodial_offline_time_reservations',[['occurred_range','tstzrange','s','',
    '["2026-10-17 00:00:00.123456+00","2026-10-17 01:00:00.654321+00")']]],
   ['event_area_aliases',[['normalized_alias','text','s','','TEST INPUT supplied original alias']]],
   ['msg_users',[['user_id','uuid','s','','11111111-1111-4111-8111-111111111111'],['active','boolean','s','',true]]],
   ['INERT_identity_always',[['supplied_identity','bigint','','a','9223372036854775807']]],
   ['INERT_identity_by_default',[['supplied_identity','bigint','','d','9007199254740993']]],
   ['custodial_dated_publications',[['staged_transaction','xid8','','','18446744073709551615']]],
  ];
  // Only the affected real catalog names/type/generated/identity metadata is
  // carried here. All row values and port replies are explicit synthetic DATA,
  // not actual table rows, native I/O acceptance, expressions or authority.
  const configure=(r,[table_name,fields])=>{
   const t=r.tables[2],c=r.catalog[2];t.table_name=c.table_name=table_name;t.data_file=`database/public.${table_name}.jsonl`;
   for(const [name,data_type,generated,identity] of fields)t.columns.push({name,data_type,generated,identity});
   c.columns=structuredClone(t.columns);
   r.bytes[2]=Buffer.from(JSON.stringify(raw.replace(/ }$/,fields.map(([name,,,,value])=>','+JSON.stringify(name)+':'+JSON.stringify(value)).join('')+' }'))+'\n');
  };
  for(const config of configs){
   const {value,r}=await journey(r=>configure(r,config));
   assert.equal(value.tables[2].state,'MATCH',`Supplied generated/identity/intrinsic DATA ${config[0]}: ${r.errors[0]?.stack??value.tables[2].state}`);
   assert.equal(r.loans.filter(x=>x.i===2).length,1);
   const loan=r.loans.find(x=>x.i===2).raw[0];
   for(const [name,,,,value] of config[1])assert.ok(loan.includes(JSON.stringify(name)+':'+JSON.stringify(value)));
   assert.ok(r.queries.every(q=>!(/\b(insert|update|delete|alter|create|set)\b/i).test(q.sql)));
   assert.ok(r.queries.every(q=>!q.sql.includes('pg_get_expr')&&!q.sql.includes('pg_attrdef')));
   controls++;
  }
  const changed=await journey(r=>{configure(r,configs[0]);r.counts[2]={original_rows:'1',current_rows:'1',missing_rows:'1',extra_rows:'1'};});
  assert.equal(changed.value.tables[2].state,'DIFFERENT','Current derived value is compared, not recomputed or ignored');controls++;
  for(const change of [r=>{r.catalog[2].columns.at(-1).generated='';},r=>{r.catalog[2].columns.at(-1).identity='a';},
   r=>{r.catalog[2].columns.at(-1).data_type='text';},r=>{r.catalog[2].supported_io=false;},
   r=>{r.bytes[2]=Buffer.from(JSON.stringify(raw)+'\n');},
   r=>{r.bytes[2]=Buffer.from(JSON.stringify(raw.replace(/ }$/,',"passed":false,"FOREIGN_EXTRA":true }'))+'\n');}]){
   const {value}=await journey(r=>{configure(r,configs[0]);change(r);});assert.equal(value.state,'UNSUPPORTED');refusals++;
  }
  for(const [name,data_type] of [['INERT_custom_range','INERT.custom_range'],['INERT_other_range','int8range'],['INERT_domain','INERT.domain'],['INERT_xid8_array','xid8[]']]){
   const {value,r}=await journey(r=>{configure(r,[name,[['supplied',''+data_type,'','','TEST INPUT']]]);r.catalog[2].supported_io=false;});
   assert.equal(value.tables[2].state,'UNSUPPORTED');assert.ok(!r.loans.some(x=>x.i===2));refusals++;
  }
  // Source-only catalog ABI checks: these do NOT evaluate PostgreSQL's actual
  // catalog expressions. Main still owns positive native type qualification.
  const ordinary=source.split(marker)[1];
  for(const fixed of ['pg_catalog.xid8','pg_catalog.xid8in(pg_catalog.cstring)','pg_catalog.xid8out(pg_catalog.xid8)',
   'pg_catalog.tstzrange','pg_catalog.range_in(pg_catalog.cstring,pg_catalog.oid,pg_catalog.int4)',
   'pg_catalog.range_out(pg_catalog.anyrange)','pg_catalog.timestamptz','pg_catalog.timestamptz_in(pg_catalog.cstring,pg_catalog.oid,pg_catalog.int4)',
   'pg_catalog.timestamptz_out(pg_catalog.timestamptz)','rngcanonical=0','rngsubtype'])assert.ok(ordinary.includes(fixed),fixed);
  assert.ok(ordinary.includes("t.oid=e.oid"),'New intrinsic paths are scalar only');
  console.log(JSON.stringify({selected:'immutable-ordinary-generated-types-only',controls,refusals,
   status:'PASS_NEW_SOURCE_AND_REAL_ROW_DECODER_RECORDINGS',native_IO_or_generated_expression_evaluation:'NOT_RUN',SQL:'NOT_RUN',
   unchanged_8_and_coverage_groups_run:0,native_method_monkeypatch:false,resources:0}));process.exit(0);
 }
 if(process.argv.includes('--immutable-ordinary-coverage-limit-only')){
  const result=await journey(r=>{
   for(let n=r.tables.length;n<4097;n++)r.tables.push({...r.tables[4],schema_name:'public',table_name:`INERT_overflow_${n}`,
    data_file:`database/public.INERT_overflow_${n}.jsonl`});
  });
  assert.equal(result.value.state,'UNSUPPORTED');assert.equal(result.value.tables.length,4097,'No declared original disappears on a resource refusal');
  assert.ok(result.value.tables.every(t=>t.state==='UNSUPPORTED'&&t.original_rows===null));assert.equal(result.r.queries.length,0);
  console.log(JSON.stringify({selected:'immutable-ordinary-coverage-limit-only',groups:1,declared_ids_retained:4097,
   before_native_SQL:true,SQL:'NOT_RUN',old_groups_run:0,resources:0}));process.exit(0);
 }
 let groups=0,refusals=0;
 const group=async(name,fn)=>{await fn();groups++;console.log(`ORDINARY_ORIGINAL_READBACK_NEW ${name} PASS_SOURCE_DECODER_RECORDING`);};
 const unsupported=async change=>{const out=await journey(change);assert.equal(out.value.state,'UNSUPPORTED',out.r.errors[0]?.stack);refusals++;return out;};
 await group('raw-json-lexemes-time-numeric-and-bootstrap-owner-exceptions',async()=>{
  assert.notEqual(JSON.stringify(pg.types.getTypeParser(114)(raw)),raw);
  assert.equal(pg.types.getTypeParser(1184)('2026-10-17 00:00:00.123456+00').toISOString(),'2026-10-17T00:00:00.123Z');
  const {value,r}=await journey();assert.equal(value.state,ownerCheck,r.errors[0]?.stack);assert.equal(value.tables.length,5);
  assert.deepEqual(value.tables.slice(0,2).map(t=>t.state),[ownerCheck,ownerCheck]);
  for(const t of value.tables.slice(0,2))assert.ok(t.original_rows==='1'&&t.current_rows===null&&t.missing_rows===null);
  assert.ok(value.tables.slice(2).every(t=>t.state==='MATCH'));
  assert.deepEqual(r.loans.map(t=>t.i),[2,3,4]);assert.deepEqual(r.loans[0].raw,[raw]);assert.deepEqual(r.loans[1].raw,[raw]);
  assert.ok(r.queries.filter(q=>q.sql.startsWith('with ')).every(q=>q.params[0].length===0));
 });
 await group('all-declared-public-auth-enumerated-no-storage-private-scope-adoption',async()=>{
  const out=await journey(r=>{r.sourceExtra.push({schema_name:'storage',table_name:'NOT_IN_SCOPE'},{schema_name:'custodial_release_identity',table_name:'NOT_IN_SCOPE'});});
  assert.equal(out.value.tables.length,5);assert.deepEqual(out.r.open,[0,1,2,3,4]);
  const missing=await unsupported(r=>{r.catalog.splice(4,1);});assert.equal(missing.value.tables[4].state,'UNSUPPORTED');assert.equal(missing.value.tables[4].original_rows,'0');
  const extra=await unsupported(r=>{r.catalog.push({...r.catalog[2],table_name:'UNSIGNED_EXTRA_TABLE',relation_oid:'999'});});
  assert.equal(extra.r.loans.length,0);assert.equal(extra.r.open.length,5);
  await unsupported(r=>{r.tables.splice(0,1);r.bytes.splice(0,1);r.catalog.splice(0,1);});
 });
 await group('bidirectional-EXCEPT-ALL-multiplicity-and-return-count-validation',async()=>{
  const duplicate=await journey(r=>{r.tables[2].row_count='2';r.bytes[2]=Buffer.from(JSON.stringify(raw)+'\n'+JSON.stringify(raw)+'\n');
   r.counts[2]={original_rows:'2',current_rows:'1',missing_rows:'1',extra_rows:'0'};});
  assert.equal(duplicate.value.state,'DIFFERENT');assert.equal(duplicate.r.loans[0].raw.length,2);
  const extra=await journey(r=>{r.counts[3]={original_rows:'1',current_rows:'2',missing_rows:'0',extra_rows:'1'};});assert.equal(extra.value.state,'DIFFERENT');
  for(const patch of [{original_rows:1},{current_rows:'01'},{missing_rows:'1'},{extra_rows:null}])
   await unsupported(r=>{Object.assign(r.counts[2],patch);});
 });
 await group('unsupported-catalog-rows-remain-explicit-after-their-original-EOF',async()=>{
  for(const change of [r=>{r.catalog[2].supported_io=false;},r=>{r.catalog[2].dropped_count='1';},
   r=>{r.catalog[2].inheritance_count='1';},r=>{r.catalog[2].is_partition=true;},r=>{r.catalog[2].relation_kind='p';},
   r=>{r.catalog[2].columns[0].data_type='integer';},r=>{r.catalog[2].primary_key=['original_id'];},
   r=>{r.catalog[2].persistence='u';},r=>{r.catalog[2].columns[0].generated='s';},
   r=>{r.catalog[2].columns[0].identity='a';}]){
   const {value,r}=await unsupported(change);assert.equal(value.tables[2].state,'UNSUPPORTED');assert.equal(value.tables[2].original_rows,'1');
   assert.equal(value.tables[3].state,'MATCH');assert.ok(!r.loans.some(x=>x.i===2));assert.equal(r.open.length,5);
  }
 });
 await group('batch-boundaries-not-one-currentness-query-per-metadata-row',async()=>{
  const result=await journey(r=>{r.tables[1].row_count='7118';r.bytes[1]=Buffer.from((JSON.stringify(raw)+'\r\n').repeat(7118));});
  assert.equal(result.value.state,ownerCheck,result.r.errors[0]?.stack);assert.equal(result.value.tables[1].original_rows,'7118');
  assert.ok(result.r.contextReads<500,`Unexpected per-row native queries: ${result.r.contextReads}`);
  assert.ok(!result.r.loans.some(t=>t.i===1));
  const unicode=raw.replace('duplicate','🦁 duplicate');
  const split=await journey(r=>{r.bytes[2]=Buffer.from(JSON.stringify(unicode)+'\r\n');});assert.equal(split.value.tables[2].state,'MATCH');assert.equal(split.r.loans[0].raw[0],unicode);
 });
 await group('every-original-file-EOF-UTF8-count-and-resource-guard-retained',async()=>{
  for(const change of [r=>{r.eof[0]={data_file:r.tables[0].data_file,sha256:'INVALID',bytes:r.bytes[0].length};},
   r=>{r.eof[1]={data_file:r.tables[1].data_file,sha256:hash(r.bytes[1]),bytes:r.bytes[1].length+1};},
   r=>{r.tables[2].row_count='0';},r=>{r.tables[2].row_count='2';},r=>{r.bytes[2]=Buffer.from([0xff]);},
   r=>{r.bytes[2]=Buffer.from(JSON.stringify('{"unknown":1}')+'\n');},r=>{r.tables[0].data_encoding=null;},
   r=>{r.tables[2].row_count='65537';},r=>{r.cleanupError=true;}])await unsupported(change);
  const bound=await unsupported(r=>{r.bytes[2]=Buffer.from(' '.repeat(16777217));});assert.ok(bound.r.open.includes(2));
 });
 await group('snapshot-source-catalog-and-output-profile-changes-never-stay-current',async()=>{
  for(const [field,value] of Object.entries({database_oid:'43',database_name:'LATER',backend_pid:124,actor:'LATER',session_actor:'LATER',
   transaction_id:'1',virtual_xid:'7/9',snapshot_id:'9:10:',transaction_started_at:'LATER',read_only:'off',isolation:'serializable',row_security:'on',
   search_path:'public',timezone:'LATER',date_style:'LATER',interval_style:'LATER',float_digits:'LATER'}))
   await unsupported(r=>{r.onContext=()=>{if(r.contextReads>=5)r.context[field]=value;};});
  await unsupported(r=>{r.onStream=(v,i)=>{if(i===2)v.sourceLive=false;};});
  await unsupported(r=>{r.onCompare=v=>{v.sourceLive=false;};});
  await unsupported(r=>{let n=0;r.onCatalog=v=>{if(++n===2)v.catalog[2].owner_name='LATER';};});
  await unsupported(r=>{r.onCompare=()=>{throw Error('PRIVATE original SQL or DATA failure');};});
 });
 await group('real-module-closed-native-refusals-no-monkeypatch-no-connect',async()=>{
  const originalQuery=pg.Client.prototype.query,client=new pg.Client({host:'127.0.0.1',database:'INERT_NOT_CONNECTED'});let getters=0,traps=0;
  for(const options of [null,{}, {db:{},verifiedArchive:{}},{db:client,verifiedArchive:{}},
   new Proxy({},{get(){traps++;throw Error('PRIVATE');},ownKeys(){traps++;throw Error('PRIVATE');}}),
   Object.defineProperty({verifiedArchive:{}},'db',{enumerable:true,get(){getters++;throw Error('PRIVATE');}})]){
   const value=await realCompare(options);assert.equal(value.state,'UNSUPPORTED');assert.deepEqual(value.tables,[]);refusals++;
  }
  assert.equal(getters,0);assert.equal(traps,0);assert.equal(pg.Client.prototype.query,originalQuery);assert.equal(client._connecting,false);assert.equal(client._connected,false);
 });
 console.log(JSON.stringify({selected:'immutable-ordinary-original-readback-only',groups,refusals,
  status:'PASS_NEW_SOURCE_RECORDINGS_REAL_CHUNK_UTF8_RAW_DECODERS_AND_REAL_MODULE_REFUSALS',SQL:'NOT_RUN',
  genuine_archive_or_snapshot_positive:'NOT_USED',native_method_monkeypatch:false,old_private_groups_run:0,old_groups_run:0,resources:0}));process.exit(0);
}

if(process.argv.includes('--immutable-private-original-readback-only')||process.argv.includes('--immutable-private-temp-path-only')||process.argv.includes('--immutable-private-first-sql-failure-only')||process.argv.includes('--immutable-private-float-output-only')){
 const {readFileSync}=await import('node:fs'),{createHash}=await import('node:crypto');
 const {types,isDeepStrictEqual}=await import('node:util'),{Readable}=await import('node:stream');
 const {pipeline}=await import('node:stream/promises'),{createInterface}=await import('node:readline');
 const {default:pg}=await import('pg');
 const {decodeRestoreTableRowLine,createRestoreRowUtf8Guard,postgresJsonTextLineEncoding}=await import('./disaster-recovery-archive.mjs');
 const {compareVerifiedImmutablePrivateTableData:realCompare}=await import('./immutable-private-data-import.mjs');
 const source=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
 const marker='export async function compareVerifiedImmutablePrivateTableData(options)';
 assert.equal(source.split(marker).length,2);
 // Compile ONLY the exact shipping append, with explicitly inert Source/query
 // ports. No pg.Client method/prototype is replaced; this is NOT SQL, a real
 // verified archive, snapshot ownership, authentication or restore evidence.
 const append=marker.replace('export ','')+source.split(marker)[1].split('export async function compareVerifiedImmutableOrdinaryTableData(options)')[0];
 const redaction='} catch {\n    // No raw original data, SQL detail or session identity leaves this reader.';
 assert.equal(append.split(redaction).length,2);
 const compile=new Function('types','isDeepStrictEqual','Client','query','closed','sameSource',
  'readVerifiedPrivateImportSource','openVerifiedRestoreTableData','decodeRestoreTableRowLine',
  'createRestoreRowUtf8Guard','postgresJsonTextLineEncoding','pipeline','createInterface','recordFailure',
  append.replace(redaction,'} catch(error) { recordFailure(error);\n    // No raw original data, SQL detail or session identity leaves this reader.')
   +'\nreturn compareVerifiedImmutablePrivateTableData;');
 const names=['employee_message_original_outcomes','group_original_creations'],schema='custodial_release_identity';
 const rawA='{ "original_key":"TEST INPUT A","original_json":{"wide":9223372036854775807,"fraction":0.123456789012345678901},"recorded_at":"2026-10-17T00:00:00.123456+00:00" }';
 const rawB='{ "original_key":"TEST INPUT B","original_json":{"n":9007199254740993},"recorded_at":"2026-10-17T00:00:00.654321+00:00" }';
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 function fixedClosed(value,keys){
  assert.ok(value&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype);
  assert.deepEqual(Reflect.ownKeys(value).sort(),[...keys].sort());const copy={};
  for(const key of keys){const field=Object.getOwnPropertyDescriptor(value,key);assert.ok(field&&Object.hasOwn(field,'value'));copy[key]=field.value;}
  return copy;
 }
 const journey=async change=>{
  const columns=[{name:'original_key',data_type:'text',generated:'',identity:''},
   {name:'original_json',data_type:'jsonb',generated:'',identity:''},
   {name:'recorded_at',data_type:'timestamp with time zone',generated:'',identity:''}];
  const tables=names.map((table_name,i)=>({schema_name:schema,table_name,primary_key:['original_key'],columns:structuredClone(columns),
   row_count:'1',data_encoding:postgresJsonTextLineEncoding,data_file:`database/${schema}.${table_name}.jsonl`}));
  const bytes=[Buffer.from(JSON.stringify(rawA)+'\n'),Buffer.from(JSON.stringify(rawB)+'\n')];
  const members=tables.map((t,i)=>({schema_name:schema,table_name:t.table_name,row_count:t.row_count,data_file:t.data_file,
   data_encoding:t.data_encoding,sha256:hash(bytes[i]),bytes:String(bytes[i].length)}));
  const catalog=tables.map((t,i)=>({schema_name:schema,table_name:t.table_name,relation_oid:String(501+i),relation_kind:'r',
   persistence:'p',is_partition:false,owner_name:'INERT original_owner',inheritance_count:'0',dropped_count:'0',
   columns:structuredClone(t.columns),primary_key:[...t.primary_key]}));
  const context={database_oid:'42',database_name:'INERT local fixture',backend_pid:123,actor:'INERT original_owner',
   session_actor:'INERT original_owner',transaction_id:null,virtual_xid:'7/8',snapshot_id:'8:9:',transaction_started_at:'INERT timestamp',
   read_only:'on',isolation:'repeatable read',row_security:'off',search_path:'pg_catalog',first_schema:'pg_catalog',float_digits:'1'};
  const counts=names.map(()=>({original_rows:'1',current_rows:'1',missing_rows:'0',extra_rows:'0'}));
  const recording={tables,members,catalog,context,counts,bytes,sourceLive:true,contextReads:0,open:0,close:0,queries:[],loans:[],eof:[],
   sourceReads:0,cleanupError:false,onContext:null,onCompare:null,onStream:null,onCatalog:null,onClose:null,errors:[]};
  change?.(recording);
  const archive=Object.freeze({INERT:'not verified authority'});
  const original={sourceBinding:Object.freeze({INERT:'same Source stamp'}),selection:{privateTables:tables},privateDataMembers:members};
  const current=()=>{recording.sourceReads++;assert.equal(recording.sourceLive,true,'INERT Source withdrawal');};
  const reply=rows=>({command:'SELECT',rowCount:rows.length,rows});
  class RecordingClient{async query(sql,params){
   recording.queries.push({sql,params});
   if(sql.includes("'transaction_started_at'")){
    recording.contextReads++;recording.onContext?.(recording);const value=structuredClone(context);
    if(!sql.includes("'first_schema'"))delete value.first_schema;return reply([{context:value}]);
   }
   if(sql.includes('inheritance_count')){recording.onCatalog?.(recording);return reply(structuredClone(catalog));}
   assert.ok(sql.includes('except all')&&sql.includes('json_populate_record(null::'));
   const index=recording.loans.length,loan=[...params[0]];recording.loans.push(loan);
   assert.equal(sql.split('except all').length,3);assert.ok(sql.includes('from only "custodial_release_identity".'));
   recording.onCompare?.(recording,index);return reply([structuredClone(counts[index])]);
  }}
  const query=RecordingClient.prototype.query,db=new RecordingClient();
  const compare=compile(types,isDeepStrictEqual,RecordingClient,query,fixedClosed,
   (received,previous)=>{assert.equal(received,archive);assert.equal(previous,original);current();},
   received=>{assert.equal(received,archive);current();return original;},
   (received,receivedSchema,name)=>{
    assert.equal(received,archive);assert.equal(receivedSchema,schema);current();const i=names.indexOf(name);assert.ok(i>=0);
    recording.open++;
    const stream=Readable.from((async function*(){recording.onStream?.(recording,i);yield bytes[i].subarray(0,5);yield bytes[i].subarray(5);})());
    const eof=recording.eof[i]??{data_file:members[i].data_file,sha256:hash(bytes[i]),bytes:bytes[i].length};
    return{table:structuredClone(tables[i]),stream,verified:Promise.resolve(eof),async close(){recording.close++;recording.onClose?.(recording);
     if(recording.cleanupError)throw Error('INERT PRIVATE cleanup failure');}};
   },decodeRestoreTableRowLine,createRestoreRowUtf8Guard,postgresJsonTextLineEncoding,pipeline,createInterface,error=>recording.errors.push(error));
  let value,error;try{value=await compare({db,verifiedArchive:archive});}catch(caught){error=caught;}
  assert.equal(recording.open,recording.close,'All opened reader ports closed');
  if(error){if(!process.argv.includes('--immutable-private-first-sql-failure-only'))throw error;return{error,recording};}
  assert.ok(Object.isFrozen(value)&&Object.isFrozen(value.tables)&&value.tables.every(Object.isFrozen));
  assert.deepEqual(Object.keys(value),['state','tables']);
  assert.ok(!JSON.stringify(value).includes('PRIVATE')&&!JSON.stringify(value).includes('TEST INPUT'));
  assert.ok(recording.queries.every(c=>c.sql.startsWith('select ')||c.sql.startsWith('with ')));
  return{value,recording};
 };
 if(process.argv.includes('--immutable-private-float-output-only')){
  // Same new profile controls in the private owning fixture; its original
  // rows/EOF/catalog/transaction/cleanup assertions remain in use unchanged.
  let controls=0,refusals=0;
  const denied=async change=>{
   const out=await journey(change);assert.equal(out.value.state,'UNSUPPORTED');refusals++;
   assert.ok(out.recording.queries.filter(q=>q.sql.startsWith('with ')).every(q=>q.params[0].length===0));return out;
  };
  for(const profile of ['1','2','3']){
   const {value,recording:r}=await journey(r=>{r.context.float_digits=profile;});
   assert.equal(value.state,'MATCH',r.errors[0]?.stack);assert.ok(value.tables.every(t=>t.state==='MATCH'));
   assert.ok(r.queries[0].sql.includes("'float_digits',pg_catalog.current_setting('extra_float_digits')"));controls++;
  }
  for(const profile of ['0','-1','-15','4','01','1 ',' 1','1\n','','NaN',0,1,2,3,-1,null,undefined,false,{},[]]){
   const out=await denied(r=>{r.context.float_digits=profile;});assert.equal(out.recording.open,0);assert.equal(out.recording.queries.length,1);
  }
  const absent=await denied(r=>{delete r.context.float_digits;});assert.equal(absent.recording.open,0);
  for(const from of ['1','2','3'])for(const to of ['1','2','3'].filter(value=>value!==from)){
   const out=await denied(r=>{r.context.float_digits=from;r.onContext=v=>{if(v.contextReads===2)v.context.float_digits=to;};});
   assert.equal(out.recording.open,0);assert.equal(out.recording.contextReads,2);
  }
  await denied(r=>{r.onStream=v=>{v.context.float_digits='3';};});
  await denied(r=>{r.onCompare=v=>{v.context.float_digits='0';};});
  await denied(r=>{r.onClose=v=>{v.context.float_digits='-1';};});
  console.log(JSON.stringify({selected:'immutable-private-float-output-only',controls,refusals,SQL:'NOT_RUN',
   source_recording_only:true,native_method_monkeypatch:false,old_groups_run:0,resources:0}));process.exit(0);
 }
 if(process.argv.includes('--immutable-private-first-sql-failure-only')){
  const label='IMMUTABLE_PRIVATE_DATA_READBACK_SQL_FAILED',privateText='INERT PRIVATE driver SQL/body/detail';let controls=0,refusals=0;
  const driver=code=>{const e=new pg.DatabaseError(privateText,42,'error');e.code=code;e.detail=privateText;e.where=privateText;e.query=privateText;return e;};
  const safe=(observed,code)=>{const e=observed.error;assert.ok(e,'Native query SQLSTATE was swallowed');assert.equal(e.code,label);assert.equal(e.message,label);
   assert.equal(e.sql_state,code);assert.equal(e.outcome,'UNKNOWN');assert.equal(e.retry_safe,false);assert.ok(Object.isFrozen(e));
   assert.deepEqual(Object.keys(e).sort(),['code','outcome','retry_safe','sql_state'].sort());
   assert.equal(Object.hasOwn(e,'cause'),false);assert.equal(Object.hasOwn(e,'errors'),false);
   assert.ok(!JSON.stringify(e).includes(privateText)&&!e.stack.includes(privateText));
   assert.equal(observed.recording.queries.length,observed.recording.firstFailureQuery);controls++;};
  const arm=(r,hook,condition,code)=>{r[hook]=v=>{if(condition(v)){v.firstFailureQuery??=v.queries.length;throw driver(v.queries.length===v.firstFailureQuery?code:'25P02');}};};
  safe(await journey(r=>arm(r,'onContext',()=>true,'42501')),'42501');
  safe(await journey(r=>arm(r,'onCatalog',()=>true,'42P01')),'42P01');
  const compared=await journey(r=>arm(r,'onCompare',()=>true,'22003'));safe(compared,'22003');
  assert.ok(compared.recording.queries.filter(q=>q.sql.startsWith('with ')).every(q=>q.params[0].length===0));
  safe(await journey(r=>{arm(r,'onContext',v=>v.open>0,'57014');r.onClose=()=>{throw driver('XX000');};}),'57014');
  safe(await journey(r=>{let n=0;r.onCatalog=v=>{if(++n===2){v.firstFailureQuery=v.queries.length;throw driver('55000');}};}),'55000');
  safe(await journey(r=>{r.onCompare=v=>{v.firstFailureQuery=v.queries.length;v.sourceLive=false;throw driver('P0001');};}),'P0001');
  let getterCalls=0,traps=0,coercions=0;
  const inherited=Object.create({code:'42501'}),accessor=Object.defineProperty(Error(privateText),'code',{get(){getterCalls++;throw Error(privateText);}});
  const proxy=new Proxy({code:'42501'},{get(){traps++;throw Error(privateText);},getOwnPropertyDescriptor(){traps++;throw Error(privateText);}});
  const wrapped={toString(){coercions++;return'42501';}};
  for(const e of [inherited,accessor,proxy,driver(null),driver(42501),driver('42p01'),driver('42501\n'),driver('ABCDEF'),driver(wrapped),privateText]){
   const out=await journey(r=>{r.onContext=v=>{v.firstFailureQuery??=v.queries.length;throw e;};});
   assert.equal(out.error,undefined);assert.equal(out.value.state,'UNSUPPORTED');assert.equal(out.recording.queries.length,out.recording.firstFailureQuery);refusals++;
  }
  for(const hook of ['onStream','onClose']){const out=await journey(r=>{r[hook]=()=>{throw driver('42501');};});
   assert.equal(out.error,undefined);assert.equal(out.value.state,'UNSUPPORTED');refusals++;}
  const malformed=await journey(r=>{r.counts[0].current_rows=1;});assert.equal(malformed.error,undefined);assert.equal(malformed.value.state,'UNSUPPORTED');refusals++;
  assert.equal(getterCalls,0);assert.equal(traps,0);assert.equal(coercions,0);
  console.log(JSON.stringify({selected:'immutable-private-first-sql-failure-only',controls,refusals,status:'PASS_NEW_QUERY_ERROR_PROVENANCE_REDACTION_AND_CLEANUP_SOURCE_CASES',
   actual_driver_error_class:true,native_method_monkeypatch:false,SQL:'NOT_RUN',old_groups_run:0,resources:0}));process.exit(0);
 }
 if(process.argv.includes('--immutable-private-temp-path-only')){
  let controls=0,refusals=0;
  for(const path of ['pg_catalog, pg_temp','pg_catalog']){
   const {value,recording:r}=await journey(r=>{r.context.search_path=path;});
   assert.equal(value.state,'MATCH',r.errors[0]?.stack);
   const sql=r.queries.find(q=>q.sql.includes("'transaction_started_at'")).sql;
   assert.ok(sql.includes("'first_schema',(pg_catalog.current_schemas(true))[1]::pg_catalog.text"));controls++;
  }
  for(const change of [r=>{r.context.search_path='pg_catalog';r.context.first_schema='pg_temp_1';},
   r=>{r.context.first_schema='pg_temp_1';},r=>{delete r.context.first_schema;},r=>{r.context.first_schema=null;},
   r=>{r.context.first_schema=false;},r=>{r.context.first_schema='public';},
   ...['pg_catalog, public','pg_temp, pg_catalog','pg_catalog,pg_temp','pg_catalog, pg_temp, public','"pg_catalog", pg_temp','public'].map(path=>r=>{r.context.search_path=path;}),
   r=>{r.context.row_security='on';},r=>{r.context.isolation='read committed';},
   r=>{r.onContext=v=>{if(v.contextReads>=5)v.context.first_schema='pg_temp_2';};},
   r=>{r.onContext=v=>{if(v.contextReads>=5)v.context.search_path='pg_catalog';};},
   r=>{r.onCompare=v=>{v.context.search_path='pg_catalog';};},r=>{r.onStream=v=>{v.sourceLive=false;};}]){
   const {value}=await journey(r=>{r.context.search_path='pg_catalog, pg_temp';change(r);});
   assert.equal(value.state,'UNSUPPORTED');refusals++;
  }
  console.log(JSON.stringify({selected:'immutable-private-temp-path-only',controls,refusals,
   status:'PASS_NEW_EFFECTIVE_PATH_SOURCE_RECORDINGS_WITH_REAL_DECODERS',SQL:'NOT_RUN',native_method_monkeypatch:false,
   old_private_groups_run:0,resources:0}));process.exit(0);
 }
 let groups=0,refusals=0;
 const group=async(name,body)=>{await body();groups++;console.log(`PRIVATE_ORIGINAL_READBACK_NEW ${name} PASS_SOURCE_RECORDING`);};
 const unsupported=async change=>{const r=await journey(change);assert.equal(r.value.state,'UNSUPPORTED');
  assert.ok(r.value.tables.every(t=>t.state==='UNSUPPORTED'&&t.original_rows===null&&t.current_rows===null));refusals++;return r;};
 await group('raw-precision-native-SQL-loans-and-closed-metadata',async()=>{
  assert.notEqual(JSON.stringify(pg.types.getTypeParser(114)(rawA)),rawA);
  assert.equal(pg.types.getTypeParser(1184)('2026-10-17 00:00:00.123456+00').toISOString(),'2026-10-17T00:00:00.123Z');
  const {value,recording:r}=await journey();assert.equal(value.state,'MATCH',r.errors[0]?.stack);assert.deepEqual(r.loans,[[rawA],[rawB]]);
  assert.ok(r.contextReads>r.queries.filter(c=>c.sql.startsWith('with ')).length*2);
  for(const table of value.tables)assert.deepEqual(Object.keys(table),['schema_name','table_name','state','original_rows','current_rows','missing_rows','extra_rows']);
  assert.ok(r.queries.filter(c=>c.sql.startsWith('with ')).every(c=>c.params[0].length===0),'Temporary raw arrays cleared after use');
  const serializable=await journey(r=>{r.context.isolation='serializable';r.context.transaction_id='9223372036854775807';});
  assert.equal(serializable.value.state,'MATCH');
 });
 await group('bidirectional-multiplicity-and-exact-count-consistency',async()=>{
  const different=await journey(r=>{r.tables[0].row_count=r.members[0].row_count='2';
   r.bytes[0]=Buffer.from(JSON.stringify(rawA)+'\n'+JSON.stringify(rawA)+'\n');r.members[0].bytes=String(r.bytes[0].length);r.members[0].sha256=hash(r.bytes[0]);
   r.counts[0]={original_rows:'2',current_rows:'1',missing_rows:'1',extra_rows:'0'};});
  assert.equal(different.value.state,'DIFFERENT');assert.equal(different.recording.loans[0].length,2);
  const extra=await journey(r=>{r.counts[1]={original_rows:'1',current_rows:'2',missing_rows:'0',extra_rows:'1'};});assert.equal(extra.value.state,'DIFFERENT');
  await unsupported(r=>{r.counts[0].missing_rows='1';});
  await unsupported(r=>{r.counts[0].current_rows=1;});
  await unsupported(r=>{r.counts[0].original_rows='01';});
 });
 await group('explicit-zero-requires-real-stream-EOF-not-missing-metadata',async()=>{
  const result=await journey(r=>{for(let i=0;i<2;i++){r.tables[i].row_count=r.members[i].row_count='0';r.bytes[i]=Buffer.alloc(0);
   r.members[i].bytes='0';r.members[i].sha256=hash(r.bytes[i]);r.counts[i]={original_rows:'0',current_rows:'0',missing_rows:'0',extra_rows:'0'};}});
  assert.equal(result.value.state,'MATCH');assert.equal(result.recording.close,2);
  await unsupported(r=>{r.tables.pop();});await unsupported(r=>{r.members.pop();});
  await unsupported(r=>{r.tables[0].row_count=r.members[0].row_count='0';});
  await unsupported(r=>{r.tables[0].data_encoding=r.members[0].data_encoding=null;});
 });
 await group('EOF-UTF8-shape-count-hash-and-bounded-resource-refusals',async()=>{
  for(const change of [r=>{r.eof[0]={data_file:r.members[0].data_file,sha256:'f'.repeat(64),bytes:r.bytes[0].length};},
   r=>{r.members[0].bytes=String(r.bytes[0].length+1);},r=>{r.tables[0].row_count=r.members[0].row_count='2';},
   r=>{r.bytes[0]=Buffer.from([0xff]);},r=>{r.bytes[0]=Buffer.from(JSON.stringify('{"unknown":1}')+'\n');},
   r=>{r.bytes[0]=Buffer.from(JSON.stringify(rawA.replace('"original_key":','"original_key":"duplicate","original_key":'))+'\n');},
   r=>{r.members[0].bytes='16777217';},r=>{r.tables[0].row_count=r.members[0].row_count='65537';}])await unsupported(change);
 });
 await group('exact-catalog-scope-columns-primary-key-and-no-generated-omission',async()=>{
  for(const change of [r=>r.catalog.pop(),r=>r.catalog.push({...r.catalog[0],table_name:'foreign'}),
   r=>{r.catalog[0].columns[0].data_type='bigint';},r=>{r.catalog[0].primary_key=[];},
   r=>{r.catalog[0].dropped_count='1';},r=>{r.catalog[0].inheritance_count='1';},
   r=>{r.catalog[0].is_partition=true;},r=>{r.catalog[0].persistence='u';},
   r=>{r.tables[0].columns[0].generated=r.catalog[0].columns[0].generated='s';},
   r=>{r.tables[0].columns[0].identity=r.catalog[0].columns[0].identity='a';},
   r=>{let calls=0;r.onCatalog=()=>{if(++calls===2)r.catalog[0].owner_name='INERT successor';};}])await unsupported(change);
 });
 await group('every-original-snapshot-dimension-withdraws-without-current-match',async()=>{
  for(const [field,value] of Object.entries({database_oid:'43',database_name:'successor',backend_pid:124,actor:'successor',session_actor:'successor',
   transaction_id:'9',virtual_xid:'7/9',snapshot_id:'9:10:',transaction_started_at:'LATER',read_only:'off',isolation:'read committed',row_security:'on',search_path:'public'}))
   await unsupported(r=>{r.onContext=()=>{if(r.contextReads>=5)r.context[field]=value;};});
  await unsupported(r=>{r.context.read_only='off';});await unsupported(r=>{r.context.isolation='read committed';});
  await unsupported(r=>{r.onStream=()=>{r.sourceLive=false;};});
  await unsupported(r=>{r.onCompare=()=>{r.sourceLive=false;};});
 });
 await group('cleanup-read-errors-and-partial-comparisons-never-leak-or-pass',async()=>{
  await unsupported(r=>{r.cleanupError=true;});
  await unsupported(r=>{r.onCompare=()=>{throw Error('INERT PRIVATE SQL request payload');};});
  const failedSecond=await unsupported(r=>{r.counts[1].extra_rows=null;});assert.equal(failedSecond.recording.loans.length,2);
 });
 await group('real-native-module-refuses-unverified-input-no-method-monkeypatch',async()=>{
  const nativeQuery=pg.Client.prototype.query;let getters=0,traps=0;
  const client=new pg.Client({host:'127.0.0.1',database:'INERT_NOT_CONNECTED'});
  for(const options of [{db:{},verifiedArchive:{}},{db:client,verifiedArchive:{}},null,
   new Proxy({},{get(){traps++;throw Error('PRIVATE');},ownKeys(){traps++;throw Error('PRIVATE');}}),
   Object.defineProperty({verifiedArchive:{}},'db',{enumerable:true,get(){getters++;throw Error('PRIVATE');}})]){
   const result=await realCompare(options);assert.equal(result.state,'UNSUPPORTED');refusals++;
  }
  assert.equal(getters,0);assert.equal(traps,0);assert.equal(pg.Client.prototype.query,nativeQuery);
  assert.equal(client._connecting,false);assert.equal(client._connected,false);
 });
 console.log(JSON.stringify({selected:'immutable-private-original-readback-only',groups,refusals,
  status:'PASS_SOURCE_RECORDINGS_REAL_UTF8_ROW_DECODER_AND_REAL_MODULE_REFUSALS',SQL:'NOT_RUN',real_verified_archive:'NOT_USED',
  native_method_monkeypatch:false,old_groups_run:0,resources:0}));process.exit(0);
}

if(process.argv.includes("--original-release-raw-timestamp-only")){
 const {preserveCurrentReleaseIdentity:preserve}=await import("./disaster-recovery-state.mjs");
 const {createHash}=await import("node:crypto"),{default:pg}=await import("pg"),{stableJson}=await import("./disaster-recovery-crypto.mjs");
 const restoreId="11111111-1111-4111-8111-111111111111";
 assert.equal(pg.types.getTypeParser(1184)("infinity"),Infinity);
 const source={release_id:"TEST INPUT native timestamp representation",backend_commit:"a".repeat(40),frontend_commit:"b".repeat(40),
  migration_head:"20261016143226",migration_manifest_sha256:"c".repeat(64),environment_contract_version:"TEST INPUT",
  status:"retired",details_json:{},created_at:"infinity",deployed_at:"-infinity"};
 const raw=JSON.stringify(source),fields=Object.keys(source),writes=[];
 const snapshot=rows=>({restore_id:restoreId,authority_generation:"7",category:"release_identity",row_count:String(rows.length),
  snapshot_sha256:createHash("sha256").update(stableJson(rows)).digest("hex"),
  state_json:{missing:false,fields,data_encoding:"postgres-json-text-line.v1",rows}});
 let selected=snapshot([raw]);
 const db={async query(sql,params){if(sql.includes("from custodial_dr.pre_restore_snapshots"))return{rowCount:1,rows:[selected]};
  writes.push(params);return{rowCount:1};}};
 assert.equal(await preserve(db,{restoreId,generation:7}),1);assert.deepEqual(writes,[[raw]]);
 for(const field of ["created_at","deployed_at"]){
  selected=snapshot([JSON.stringify({...source,[field]:123})]);const count=writes.length;
  await assert.rejects(preserve(db,{restoreId,generation:7}),error=>error.code==="RESTORE_ORIGINAL_RELEASE_SNAPSHOT_INVALID");
  assert.equal(writes.length,count);
 }
 console.log(JSON.stringify({selected:"original-release-raw-timestamp-only",status:"PASS_EXPORTED_HELPER_INERT_RECORDING",
  controls:1,prewrite_refusals:2,SQL:"NOT_RUN",old_groups_run:0,resources:0}));
 process.exit(0);
}

if(process.argv.includes("--original-release-raw-snapshot-only")){
 const {preserveCurrentReleaseIdentity:preserve}=await import("./disaster-recovery-state.mjs");
 const {createHash}=await import("node:crypto"),{default:pg}=await import("pg");
 const {stableJson}=await import("./disaster-recovery-crypto.mjs");
 const restoreId="11111111-1111-4111-8111-111111111111",generation="7";
 const fields=["release_id","backend_commit","frontend_commit","migration_head","migration_manifest_sha256",
  "environment_contract_version","status","details_json","created_at","deployed_at"];
 // Explicit TEST INPUT in existing capture wire: arbitrary original JSON
 // numeric lexemes and timestamp microseconds remain PostgreSQL-owned DATA.
 const raw=id=>`{ "release_id":${JSON.stringify(id)},"backend_commit":"${"a".repeat(40)}","frontend_commit":"${"b".repeat(40)}","migration_head":"20261016143226","migration_manifest_sha256":"${"c".repeat(64)}","environment_contract_version":"TEST INPUT original","status":"retired","details_json":{"big":9223372036854775807,"precise":0.123456789012345678901,"wide":1e400,"nested":[null,false,"\\u003c original"]},"created_at":"2026-10-17T00:00:00.123456+00:00","deployed_at":null }`;
 const frame=rows=>({restore_id:restoreId,authority_generation:generation,category:"release_identity",row_count:String(rows.length),
  snapshot_sha256:createHash("sha256").update(stableJson(rows)).digest("hex"),
  state_json:{missing:false,fields:[...fields],data_encoding:"postgres-json-text-line.v1",rows}});
 const result=rows=>({rowCount:1,rows:[frame(rows)]});
 const journey=async(readResult,{options={restoreId,generation:7},onWrite=null,readError=null,writeResult={rowCount:1}}={})=>{
  const calls=[],writes=[];let value,error;
  try{value=await preserve({async query(sql,params){calls.push({sql,params});
   if(calls.length===1){if(readError)throw readError;return readResult;}
   writes.push(params);if(onWrite)await onWrite(writes.length);if(writeResult instanceof Error)throw writeResult;return writeResult;
  }},options);}catch(caught){error=caught;}
  return{calls,writes,value,error};
 };
 let groups=0,refusals=0,getters=0,traps=0;
 const run=async(name,body)=>{await body();groups++;console.log(`ORIGINAL_RELEASE_RAW_NEW ${name} PASS`);};
 const refuses=async value=>{const observed=await journey(value);assert.equal(observed.error?.code,"RESTORE_ORIGINAL_RELEASE_SNAPSHOT_INVALID");
  assert.equal(observed.writes.length,0);refusals++;};
 await run("native-parser-loss-demonstrated-but-raw-SQL-parameter-exact",async()=>{
  const timestamp="2026-10-17 00:00:00.123456+00",parsedTime=pg.types.getTypeParser(1184)(timestamp);
  assert.equal(parsedTime.toISOString(),"2026-10-17T00:00:00.123Z");
  assert.notEqual(JSON.stringify(pg.types.getTypeParser(114)('{"big":9223372036854775807}')),'{"big":9223372036854775807}');
  const first=raw("TEST INPUT original microseconds"),second=raw("TEST INPUT historical release"),source=result([first,second]);
  const before=JSON.stringify(source),observed=await journey(source);assert.equal(observed.error,undefined);assert.equal(observed.value,2);
  assert.deepEqual(observed.calls[0].params,[restoreId,generation]);
  assert.match(observed.calls[0].sql,/restore_id=\$1::uuid and authority_generation=\$2::bigint/);
  assert.deepEqual(observed.writes,[[first],[second]]);assert.equal(JSON.stringify(source),before);
  for(const call of observed.calls.slice(1))assert.match(call.sql,/json_populate_record\(null::public\.release_deployment_manifest,\$1::json\)/);
  assert.ok(observed.writes[0][0].includes("9223372036854775807")&&observed.writes[0][0].includes(".123456+00:00")&&observed.writes[0][0].includes("1e400"));
 });
 await run("explicit-present-empty-distinct-from-missing-or-legacy",async()=>{
  const empty=result([]);empty.rows[0].state_json.fields.reverse();
  const observed=await journey(empty);assert.equal(observed.error,undefined);assert.equal(observed.value,0);assert.equal(observed.calls.length,1);
  for(const missing of [null,{}, {rowCount:0,rows:[]},{rowCount:2,rows:[frame([]),frame([])]}])await refuses(missing);
  for(const state of [{fields:[...fields],rows:[]},
   {...frame([]).state_json,missing:true},{...frame([]).state_json,missing:"false"},
   {...frame([]).state_json,data_encoding:undefined},{...frame([]).state_json,data_encoding:"json-object.v1"},
   {...frame([]).state_json,rows:[JSON.parse(raw("legacy object"))]},{...frame([]).state_json,fields:[]}])
   await refuses({rowCount:1,rows:[{...frame([]),state_json:state}]});
 });
 await run("entire-original-count-hash-generation-and-row-set-before-first-write",async()=>{
  for(const patch of [{restore_id:"22222222-2222-4222-8222-222222222222"},{authority_generation:"8"},
   {authority_generation:7},{category:"employee_status"},{row_count:"0"},{row_count:1},{row_count:"01"},
   {snapshot_sha256:"d".repeat(64)},{snapshot_sha256:null}])await refuses({rowCount:1,rows:[{...frame([raw("valid")]),...patch}]});
  const duplicate=raw("duplicate");await refuses(result([duplicate,duplicate]));
  const valid=raw("valid first");
  for(const invalid of ["{","[]","null",JSON.stringify({...JSON.parse(valid),release_id:3}),
   JSON.stringify({...JSON.parse(valid),backend_commit:"short"}),JSON.stringify({...JSON.parse(valid),details_json:null}),
   JSON.stringify({...JSON.parse(valid),created_at:123}),JSON.stringify({...JSON.parse(valid),extra:true})])
   await refuses(result([valid,invalid]));
  const duplicatedField=frame([]);duplicatedField.state_json.fields[1]=duplicatedField.state_json.fields[0];await refuses({rowCount:1,rows:[duplicatedField]});
 });
 await run("owned-raw-string-loan-survives-later-snapshot-mutation",async()=>{
  const first=raw("first"),second=raw("second"),input=result([first,second]);
  const observed=await journey(input,{onWrite:async count=>{
   if(count===1){input.rows[0].state_json.rows[1]="LATE INVALID MUTATION";input.rows[0].authority_generation="8";await Promise.resolve();}
  }});assert.equal(observed.error,undefined);assert.equal(observed.value,2);assert.deepEqual(observed.writes,[[first],[second]]);
 });
 await run("missing-generation-and-uninspectable-snapshot-refuse-without-effects",async()=>{
  for(const value of [undefined,0,"07","7\n","9223372036854775808",{}]){
   const observed=await journey(result([]),{options:{restoreId,generation:value}});
   assert.equal(observed.error?.code,"RESTORE_ORIGINAL_RELEASE_SNAPSHOT_INVALID");assert.equal(observed.calls.length,0);refusals++;
  }
  const accessor=frame([]);Object.defineProperty(accessor.state_json,"rows",{enumerable:true,get(){getters++;throw Error("PRIVATE");}});
  await refuses({rowCount:1,rows:[accessor]});
  await refuses({rowCount:1,rows:[new Proxy(frame([]),{get(){traps++;throw Error("PRIVATE");},ownKeys(){traps++;throw Error("PRIVATE");}})]});
  assert.equal(getters,0);assert.equal(traps,0);
 });
 await run("read-and-write-failures-stay-first-no-default-no-write-retry",async()=>{
  const failure=Error("INERT original read failure"),read=await journey(null,{readError:failure});assert.equal(read.error,failure);assert.equal(read.writes.length,0);
  const write=await journey(result([raw("first"),raw("second")]),{writeResult:failure});assert.equal(write.error,failure);assert.equal(write.writes.length,1);
  const zero=await journey(result([raw("one")]),{writeResult:{rowCount:0}});assert.equal(zero.error?.code,"RESTORE_ORIGINAL_RELEASE_SNAPSHOT_INVALID");assert.equal(zero.writes.length,1);
 });
 console.log(JSON.stringify({selected:"original-release-raw-snapshot-only",status:"PASS_EXPORTED_HELPER_INERT_RAW_ROW_RECORDINGS",
  groups,prewrite_refusals:refusals,accessor_calls:getters,proxy_traps:traps,legacy_object_cases_replayed:0,old_groups_run:0,
  SQL:"NOT_RUN",real_release_capture_or_activation:"NOT_RUN",resources:0}));
 process.exit(0);
}

// Newly affected finished-DATA serialization only. Recording Source readers
// below are NOT private token/archive/FINISHED-context or commit authority.
if(process.argv.includes("--immutable-fresh-database-evidence-only")){
 const {readFileSync}=await import("node:fs");
 const {types,isDeepStrictEqual}=await import("node:util");
 const {restoreCheckEvidence}=await import("./restore-unvalidated-checks.mjs");
 const {buildVerifiedImmutableFreshDatabaseEvidence:realBuild}=await import("./immutable-private-fresh-restore-evidence.mjs");
 const code=readFileSync(new URL("./immutable-private-fresh-restore-evidence.mjs",import.meta.url),"utf8");
 const imports=[
  "import {types,isDeepStrictEqual} from 'node:util';\n",
  "import {readVerifiedImmutableFreshRestoreIntent} from './immutable-private-fresh-restore-intent.mjs';\n",
  "import {readVerifiedPrivateImportSource} from './disaster-recovery-archive.mjs';\n",
  "import {restoreCheckEvidence} from './restore-unvalidated-checks.mjs';\n",
 ];
 let body=code;
 for(const line of imports){assert.equal(body.split(line).length,2,"Exact shipping imports required");body=body.replace(line,"");}
 const exported="export function buildVerifiedImmutableFreshDatabaseEvidence(options)";
 assert.equal(body.split(exported).length,2);
 body=body.replace(exported,"function buildVerifiedImmutableFreshDatabaseEvidence(options)");
 const compile=new Function("types","isDeepStrictEqual","readVerifiedImmutableFreshRestoreIntent",
  "readVerifiedPrivateImportSource","restoreCheckEvidence",body+"\nreturn buildVerifiedImmutableFreshDatabaseEvidence;");
 const id="12345678-1234-1234-1234-123456789abc",digest="a".repeat(64);
 let variants=0,getters=0,traps=0,coercions=0;
 const fixture=()=>{
  const archive=Object.freeze({recording:"NOT_A_REAL_ARCHIVE"}),token=Object.freeze({recording:"NOT_A_REAL_TOKEN"});
  const binding=Object.freeze({archive_digest:digest}),intent=Object.freeze({restore_id:id,authority_generation:1,archive_digest:digest});
  const captured=Object.freeze({intent,sourceBinding:binding});
  const table=(schema_name,table_name,row_count)=>Object.freeze({schema_name,table_name,row_count});
  const privateDataMembers=Object.freeze([table("custodial_release_identity","employee_message_original_outcomes","2"),
   table("custodial_release_identity","group_original_creations","1")]);
  const selection=Object.freeze({databaseTables:Object.freeze([table("public","release_deployment_manifest","7"),
   table("public","custodial_release_authority_restore_inventory","9007199254740993"),
   table("public","employees","3"),...privateDataMembers,table("auth","users","0")])});
  const original=Object.freeze({sourceBinding:binding,selection,privateDataMembers});
  const finished={database_oid:"4294967295",backend_pid:2147483647,transaction_id:"9223372036854775807",
   restore_id:id,authority_generation:"1",archive_digest:digest,private_rows:"3",transaction_authority:false,admission_resumed:false};
  const trace=[],state={captured,original,intentReads:0,sourceReads:0,checks:0};
  const build=compile(types,isDeepStrictEqual,(actualToken,actualArchive)=>{
   trace.push("intent");state.intentReads++;assert.equal(actualToken,token);assert.equal(actualArchive,archive);
   return state.onIntent?state.onIntent():state.captured;
  },actualArchive=>{
   trace.push("source");state.sourceReads++;assert.equal(actualArchive,archive);
   return state.onSource?state.onSource():state.original;
  },values=>{trace.push("checks");state.checks++;assert.deepEqual(values,[]);return restoreCheckEvidence(values);});
  return {archive,token,binding,intent,captured,original,selection,finished,trace,state,build,
   options:()=>({verifiedArchive:archive,freshIntent:token,finished})};
 };
 const refuses=(build,options)=>{
  let error;try{build(options);}catch(observed){error=observed;}
  assert.equal(error?.code,"IMMUTABLE_FRESH_DATABASE_EVIDENCE_INVALID");variants++;
 };
 const frozenClosed=(value,keys)=>{assert.equal(Object.isFrozen(value),true);assert.deepEqual(Reflect.ownKeys(value).sort(),keys.slice().sort());};
 const f=fixture(),before=JSON.stringify(f.finished),output=f.build(f.options());
 frozenClosed(output,["database","event"]);
 const common=["tables","unvalidated_check_constraints","original_data_import","consumed_source_tables",
  "consumed_source_rows","preserved_current_release_bootstrap"];
 frozenClosed(output.database,[...common,"rows"]);frozenClosed(output.event,common);
 assert.equal(output.database.tables,5);assert.equal(output.database.rows,"9007199254740999");
 assert.equal(output.database.consumed_source_tables,6);assert.equal(output.database.consumed_source_rows,"9007199254741006");
 assert.equal(Object.hasOwn(output.event,"rows"),false);
 assert.equal(output.database.original_data_import,output.event.original_data_import);
 assert.notEqual(output.database.original_data_import,f.finished);
 frozenClosed(output.database.original_data_import,Object.keys(f.finished));
 assert.deepEqual(output.database.original_data_import,f.finished);
 const checks=output.database.unvalidated_check_constraints;
 frozenClosed(checks,["count","sha256","constraints","mode"]);
 assert.deepEqual(checks,{...restoreCheckEvidence([]),mode:"NOT_SUSPENDED"});
 assert.equal(Object.isFrozen(checks.constraints),true);
 assert.equal(output.event.unvalidated_check_constraints,checks);
 assert.equal(output.database.preserved_current_release_bootstrap,true);
 assert.equal(JSON.stringify(f.finished),before);
 f.finished.private_rows="changed";assert.equal(output.database.original_data_import.private_rows,"3");
 assert.throws(()=>{output.event.tables=0;},TypeError);
 assert.deepEqual(f.trace,["intent","source","checks","source","intent"]);
 // Exact wire bounds and contradictory/unknown fields.
 for(const [key,value] of [
  ["database_oid",1],["database_oid","0"],["database_oid","01"],["database_oid","4294967296"],
  ["backend_pid",0],["backend_pid",2147483648],["backend_pid","1"],["backend_pid",1.5],
  ["transaction_id","0"],["transaction_id","01"],["transaction_id","9223372036854775808"],
  ["authority_generation","0"],["authority_generation","2"],["authority_generation",1],
  ["archive_digest","b".repeat(64)],["archive_digest",digest+"\n"],["restore_id",id.toUpperCase()],
  ["restore_id","22345678-1234-1234-1234-123456789abc"],["private_rows","2"],["private_rows",3],
  ["private_rows","03"],["private_rows","-1"],["private_rows","9223372036854775808"],
  ["transaction_authority",true],["transaction_authority",0],["admission_resumed",true],["admission_resumed","false"],
 ]){
  const x=fixture();x.finished[key]=value;refuses(x.build,x.options());
 }
 for(const kind of ["missing","extra","getter","proxy","symbol","options-getter","options-proxy","options-extra"]){
  const x=fixture(),args=x.options();
  if(kind==="missing")delete x.finished.private_rows;
  if(kind==="extra")x.finished.complete_restore=true;
  if(kind==="symbol")x.finished[Symbol("unknown")]=false;
  if(kind==="getter")Object.defineProperty(x.finished,"private_rows",{enumerable:true,get(){getters++;throw Error("PRIVATE");}});
  if(kind==="proxy")args.finished=new Proxy(x.finished,{get(){traps++;throw Error("PRIVATE");},ownKeys(){traps++;throw Error("PRIVATE");}});
  if(kind==="options-getter")Object.defineProperty(args,"finished",{enumerable:true,get(){getters++;throw Error("PRIVATE");}});
  if(kind==="options-proxy"){refuses(x.build,new Proxy(args,{ownKeys(){traps++;throw Error("PRIVATE");}}));continue;}
  if(kind==="options-extra")args.allow=true;
  refuses(x.build,args);
 }
 for(const kind of ["sparse","array-getter","array-proxy","count-getter","count-proxy","count-number","count-lexical","duplicate","private-mismatch"]){
  const x=fixture();let tables=[...x.selection.databaseTables],members=x.original.privateDataMembers;
  if(kind==="sparse")delete tables[1];
  if(kind==="array-getter")Object.defineProperty(tables,"1",{enumerable:true,get(){getters++;throw Error("PRIVATE");}});
  if(kind==="array-proxy")tables=new Proxy(tables,{get(){traps++;throw Error("PRIVATE");}});
  if(kind==="count-getter"){tables[1]={...tables[1]};Object.defineProperty(tables[1],"row_count",{enumerable:true,get(){getters++;throw Error("PRIVATE");}});}
  if(kind==="count-proxy")tables[1]={...tables[1],row_count:{toString(){coercions++;throw Error("PRIVATE");}}};
  if(kind==="count-number")tables[1]={...tables[1],row_count:9007199254740992};
  if(kind==="count-lexical")tables[1]={...tables[1],row_count:"1e3"};
  if(kind==="duplicate")tables[1]=tables[0];
  if(kind==="private-mismatch")members=[{...members[0],row_count:"3"},members[1]];
  x.state.original={...x.original,selection:{databaseTables:tables},privateDataMembers:members};
  refuses(x.build,x.options());assert.equal(x.state.checks,0);
 }
 for(const kind of ["initial-binding","final-binding","final-selection","final-token","expiry","source-error"]){
  const x=fixture();
  if(kind==="initial-binding")x.state.captured={...x.captured,sourceBinding:{...x.binding}};
  if(kind==="final-binding")x.state.onSource=()=>x.state.sourceReads===1?x.original:{...x.original,sourceBinding:{...x.binding}};
  if(kind==="final-selection")x.state.onSource=()=>x.state.sourceReads===1?x.original:{...x.original,selection:{databaseTables:[]}};
  if(kind==="final-token")x.state.onIntent=()=>x.state.intentReads===1?x.captured:{...x.captured};
  if(kind==="expiry")x.state.onIntent=()=>{if(x.state.intentReads===2)throw Error("SYNTHETIC_EXPIRED");return x.captured;};
  if(kind==="source-error")x.state.onSource=()=>{throw Error("SYNTHETIC_SOURCE_UNAVAILABLE");};
  refuses(x.build,x.options());
 }
 // Real module import: only unbranded/malformed DATA. No signing, token mint,
 // verified archive materialization or positive private-control fabrication.
 for(const token of [null,{},Object.freeze(Object.create(null)),new Proxy({},{get(){traps++;throw Error("PRIVATE");}})]){
  const x=fixture();refuses(realBuild,{verifiedArchive:{},freshIntent:token,finished:x.finished});
 }
 assert.equal(getters,0);assert.equal(traps,0);assert.equal(coercions,0);
 console.log(JSON.stringify({scope:"NEW immutable fresh database evidence",status:"PASS_SOURCE_RECORDING_AND_REAL_REFUSAL",
  serialization_controls:1,refusal_variants:variants,source_order:f.trace,accessor_calls:getters,proxy_traps:traps,
  coercions,signatures:0,SQL:"NOT_RUN",valid_real_intent:"NOT_RUN",COMMIT:"NOT_RUN",resources:0,
  limits:"Recording Source readers validate serialization only; real module checks refuse unbranded inputs. No FINISHED context, SQL metadata, custody, COMMIT or resume authority."}));
 process.exit(0);
}

// Newly moved shipping Source loader only; no installer, SQL or admission.
if (process.argv.includes("--immutable-message-source-only")) {
  const { createHash } = await import("node:crypto");
  const { readFileSync, writeFileSync, copyFileSync, mkdtempSync, mkdirSync, renameSync,
    symlinkSync, linkSync, unlinkSync, rmSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  const { loadImmutableMessageSourceRecipes: load } = await import("./immutable-private-message-source.mjs");
  const selected = process.argv.find(arg => arg.startsWith("--immutable-message-source-case="))?.slice("--immutable-message-source-case=".length);
  const cases = [], roots = [];
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  const paths = ["proposals/immutable-original-message-effects-restore.sql","proposals/immutable-original-message-guards-restore.sql",
    "proposals/immutable-original-message-audit-restore.sql","proposals/immutable-original-message-receipts-restore.sql"];
  const pins = ["0b28beda0231ff0940f9bdda392327b4dd24b14f86a2154139ca39feb9154604",
    "f2c99f1fe58c8c569a1b3cf1b70d69c049607caca8e73f4d2f0479bad1a7768c",
    "bfdd883690411b2a79a26ceac6ef80c008c5e24055b5d3b1af64b2232da2109a",
    "98a4f593caf9c62eb42dfae893c67d0e2f84fc5e6b518965b27a92927ac00f88"];
  const identities = ["msg_enqueue_background_work()","msg_memphis_pre_generate_schedule()","msg_audit_persisted_message()",
    "mz_enqueue_employee_message_push()","ops_manager_enqueue_message_push()",
    "msg_reject_retired_ops_manager_shared_message_mutation()","mz_reject_event_messenger_message()",
    "msg_reject_retired_ops_manager_shared_message_audit_mutation()","msg_reject_retired_ops_manager_shared_receipt_mutation()"];
  const closed = (value, keys) => { assert.equal(Object.getPrototypeOf(value), Object.prototype);
    assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort()); assert.equal(Object.isFrozen(value), true); };
  const run = async (name, body) => { if (selected && selected !== name) return;
    await body(); cases.push(name); console.log(JSON.stringify({case:name,status:"PASS_NEW_SOURCE_ONLY"})); };
  const fixture = async () => {
    const root = mkdtempSync(join(tmpdir(),"mz-message-source-")); roots.push(root);
    mkdirSync(join(root,"scripts")); mkdirSync(join(root,"proposals"));
    copyFileSync(fileURLToPath(new URL("./immutable-private-message-source.mjs",import.meta.url)),join(root,"scripts/immutable-private-message-source.mjs"));
    for (const path of paths) copyFileSync(fileURLToPath(new URL("../"+path,import.meta.url)),join(root,path));
    const module = await import(pathToFileURL(join(root,"scripts/immutable-private-message-source.mjs")).href);
    return {root,load:module.loadImmutableMessageSourceRecipes};
  };
  try {
    await run("MESSAGE_SOURCE_NEW fixed frozen shipping output and exact pins", async () => {
      const result = load();
      closed(result,["recipes","statements","assertCurrent"]);
      assert.equal(Object.isFrozen(result.recipes),true); assert.equal(Object.isFrozen(result.statements),true);
      assert.equal(Object.isFrozen(result.assertCurrent),true); assert.equal(result.recipes.length,9); assert.equal(result.statements.length,4);
      assert.deepEqual(result.recipes.map(row=>row.identity),identities.map(id=>"public."+id));
      assert.deepEqual(result.recipes.map(row=>row.registry_identity),identities);
      for (const row of result.recipes) {
        closed(row,["identity","registry_identity","before","after","beforeHash","afterHash","beforeBodyHash","afterBodyHash"]);
        assert.equal(digest(row.before),row.beforeHash); assert.equal(digest(row.after),row.afterHash);
        const body = definition => { const marker="AS $function$";
          return definition.slice(definition.indexOf(marker)+marker.length,-"$function$\n".length); };
        assert.equal(digest(body(row.before)),row.beforeBodyHash); assert.equal(digest(body(row.after)),row.afterBodyHash);
      }
      for (let i=0;i<result.statements.length;i++) {
        const row=result.statements[i]; closed(row,["sourcePath","sourceSha256","sql"]);
        assert.equal(row.sourcePath,paths[i]); assert.equal(row.sourceSha256,pins[i]); assert.equal(digest(row.sql),pins[i]);
      }
      result.assertCurrent(); await Promise.resolve(); result.assertCurrent();
      assert.throws(()=>{result.recipes[0].after="not Source";},TypeError);
      assert.throws(()=>load({sourcePath:"caller-selected"}));
    });
    await run("MESSAGE_SOURCE_NEW changed and restored bytes are never adopted", async () => {
      const f=await fixture(),result=f.load(),path=join(f.root,paths[0]),bytes=readFileSync(path);
      const changed=Buffer.from(bytes);changed[0]^=1;writeFileSync(path,changed);
      assert.throws(()=>result.assertCurrent()); assert.throws(()=>f.load());
      writeFileSync(path,bytes);
      assert.throws(()=>result.assertCurrent(),"Restored bytes cannot renew original file metadata");
    });
    await run("MESSAGE_SOURCE_NEW equal-byte replacement and file symlink refuse", async () => {
      const f=await fixture(),result=f.load(),path=join(f.root,paths[1]),saved=path+".original";
      renameSync(path,saved);copyFileSync(saved,path);
      assert.throws(()=>result.assertCurrent(),"Equal bytes do not replace original inode");
      unlinkSync(path);symlinkSync(saved,path);
      assert.throws(()=>f.load());assert.throws(()=>result.assertCurrent());
    });
    await run("MESSAGE_SOURCE_NEW directory and nonregular inputs refuse", async () => {
      const f=await fixture(),result=f.load(),directory=join(f.root,"proposals"),saved=directory+".original";
      renameSync(directory,saved);symlinkSync(saved,directory);
      assert.throws(()=>f.load());assert.throws(()=>result.assertCurrent());
      unlinkSync(directory);renameSync(saved,directory);
      const path=join(f.root,paths[2]);renameSync(path,path+".original");mkdirSync(path);
      assert.throws(()=>f.load());assert.throws(()=>result.assertCurrent());
    });
    await run("MESSAGE_SOURCE_NEW hardlink alias cannot retain currentness", async () => {
      const f=await fixture(),result=f.load(),path=join(f.root,paths[3]),alias=path+".alias";
      linkSync(path,alias);assert.throws(()=>result.assertCurrent());assert.throws(()=>f.load());
      unlinkSync(alias);assert.throws(()=>result.assertCurrent(),"Removing alias cannot renew original metadata");
    });
    assert.ok(cases.length>0,"Unknown or empty message-source selector");
  } finally {
    for (const root of roots) { rmSync(root,{recursive:true,force:true}); assert.equal(existsSync(root),false); }
  }
  console.log(JSON.stringify({scope:"NEW_SHIPPING_MESSAGE_SOURCE_ONLY",cases,count:cases.length,temporary_roots_removed:roots.length,
    SQL:"NOT_RUN",installation:"NOT_RUN",authority:"NONE",limits:"Pinned Source composition/lifetime only; no target, registry, DATA, signer or provider."}));
  process.exit(0);
}

// Main supplies existing synthetic metadata and the original expected tuple.
// This member creates no fixture, DATA, authority, role or reconciliation.
if (process.argv.includes("--original-restore-status-database")) {
  const { lstat, realpath } = await import("node:fs/promises");
  const { resolve, dirname, basename } = await import("node:path");
  const closed = (value, keys) => {
    assert.ok(value && Object.getPrototypeOf(value) === Object.prototype && !Array.isArray(value));
    assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
  };
  const required = name => {
    const value = process.env[name];
    assert.ok(typeof value === "string" && value.length > 0, "Required status test input missing");
    return value;
  };
  const request = JSON.parse(required("RESTORE_STATUS_TEST_REQUEST_JSON"));
  const expected = JSON.parse(required("RESTORE_STATUS_TEST_EXPECTED_JSON"));
  closed(request, ["restoreId", "generation", "archiveDigest", "targetProjectRef"]);
  assert.equal(typeof request.restoreId, "string");
  assert.match(request.restoreId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?![\s\S])/);
  assert.equal(typeof request.generation, "string");
  assert.match(request.generation, /^[1-9][0-9]{0,18}(?![\s\S])/);
  assert.ok(BigInt(request.generation) <= 9223372036854775807n);
  assert.equal(typeof request.archiveDigest, "string");
  assert.match(request.archiveDigest, /^[0-9a-f]{64}(?![\s\S])/);
  assert.equal(typeof request.targetProjectRef, "string");
  assert.match(request.targetProjectRef, /^[a-z0-9]{20}(?![\s\S])/);
  const refusal = Object.hasOwn(expected, "refusal");
  const checkDto = value => {
    closed(value, ["schema", "restore_id", "authority_generation", "archive_digest", "target_project_ref", "state",
      "mutations_paused", "database_marker_status", "database_verified", "prior_unknown_recorded", "metadata_only",
      "retry_allowed", "resume_allowed", "rerun_import_allowed", "complete_restore"]);
    assert.equal(value.schema, "memphis-zoo-restore-original-status.v1");
    assert.equal(value.restore_id, request.restoreId); assert.equal(value.authority_generation, request.generation);
    assert.equal(value.archive_digest, request.archiveDigest); assert.equal(value.target_project_ref, request.targetProjectRef);
    assert.ok(["READY", "PREPARING", "DATABASE_RESTORED", "STORAGE_RESTORING", "VERIFYING", "PAUSED_FAILURE", "PAUSED_RECONCILIATION", "COMPLETE"].includes(value.state));
    assert.ok(["UNRESOLVED", "OBSERVED_DATABASE_MARKERS", "NOT_OBSERVED"].includes(value.database_marker_status));
    for (const key of ["mutations_paused", "prior_unknown_recorded"]) assert.equal(typeof value[key], "boolean");
    assert.ok(value.database_verified === null || typeof value.database_verified === "boolean");
    assert.equal(value.metadata_only, true);
    for (const key of ["retry_allowed", "resume_allowed", "rerun_import_allowed", "complete_restore"]) assert.equal(value[key], false);
  };
  if (refusal) {
    closed(expected, ["refusal"]); assert.equal(expected.refusal, "RESTORE_ORIGINAL_STATUS_UNAVAILABLE");
  } else checkDto(expected);
  // No URL query options/host overrides, implicit PGHOST, service lookup, or
  // remote hostname. Original URL fields are the only connection coordinates.
  const rawUrl = required("RESTORE_STATUS_TEST_DB_URL");
  assert.ok(!/[\u0000-\u0020\u007f]/.test(rawUrl), "Status fixture URL whitespace/control refused");
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error("Local status fixture URL required"); }
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Local status fixture URL required");
  assert.ok(url.search === "" && url.hash === "", "Status fixture URL options/fragments refused");
  assert.ok(rawUrl === rawUrl.trim(), "Status fixture URL whitespace refused");
  const host = decodeURIComponent(url.hostname), user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.slice(1));
  assert.ok(user.length > 0 && password.length > 0 && database.length > 0 && !database.includes("/"), "Explicit fixture coordinates required");
  assert.ok(![host, user, password, database].some(value => /[\u0000-\u001f\u007f]/.test(value)), "Invalid fixture coordinates");
  const port = url.port === "" ? 5432 : Number(url.port);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  let socket = false;
  if (host.startsWith("/")) {
    socket = true;
    assert.equal(resolve(host), host, "Canonical owned socket directory required");
    assert.equal(await realpath(host), host, "Socket directory symlink refused");
    const directory = await lstat(host);
    assert.ok(directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === process.getuid()
      && (directory.mode & 0o022) === 0, "Private test-owned socket directory required");
    const path = resolve(host, ".s.PGSQL." + port), entry = await lstat(path);
    assert.equal(dirname(path), host); assert.equal(basename(path), ".s.PGSQL." + port);
    assert.ok(entry.isSocket() && !entry.isSymbolicLink(), "Existing fixture Unix socket required");
  } else assert.ok(host === "127.0.0.1" || host === "[::1]", "Literal loopback fixture required");
  const { default: pg } = await import("pg");
  const { readOriginalRestoreDatabaseStatus: readStatus } = await import("./disaster-recovery-state.mjs");
  const db = new pg.Client({ host: host === "[::1]" ? "::1" : host, port, user, password, database,
    ssl: false, options: "", replication: false, application_name: "custodial-original-status-owning-test",
    connectionTimeoutMillis: 5000, query_timeout: 15000 });
  let connected = false, failed = false, firstFailure;
  const cleanupFailures = [];
  try {
    const parameters = db.connectionParameters;
    assert.ok(parameters.host === (host === "[::1]" ? "::1" : host) && parameters.port === port
      && parameters.user === user && parameters.password === password && parameters.database === database
      && parameters.ssl === false && !parameters.options && !parameters.replication,
      "Ambient connection overrides refused");
    await db.connect(); connected = true;
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (refusal) await assert.rejects(() => readStatus(db, request), error => error.code === expected.refusal);
    else {
      const actual = await readStatus(db, request);
      checkDto(actual); assert.deepEqual(actual, expected);
    }
  } catch (error) { firstFailure = error; failed = true; }
  finally {
    if (connected) try { await db.query("ROLLBACK"); } catch (error) { cleanupFailures.push(error); }
    try { await Reflect.apply(pg.Client.prototype.end, db, []); } catch (error) { cleanupFailures.push(error); }
  }
  if (cleanupFailures.length) throw new AggregateError(failed ? [firstFailure, ...cleanupFailures] : cleanupFailures,
    "Original status owning cleanup failed", {cause: failed ? firstFailure : cleanupFailures[0]});
  if (failed) throw firstFailure;
  // Emit a successful test receipt only after both rollback and end succeeded.
  console.log(JSON.stringify({scope:"ORIGINAL_STATUS_EXISTING_DATABASE_METADATA_ONLY", matched:refusal?"EXPECTED_REFUSAL":"EXACT_METADATA_DTO",
    transport:socket?"OWNED_UNIX_SOCKET":"LOOPBACK", cleanup:"ROLLBACK_AND_END_COMPLETED", DATA_import:"NOT_RUN", authority:false}));
  process.exit(0);
}

// Exact sealed CLI status branch, in-process recording ports ONLY. This does
// not instantiate/fake a pg.Client or qualify the actual native-client reader.
if (process.argv.includes("--original-restore-status-cleanup-source-only")) {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const text = readFileSync(new URL("./create-production-restore-reconciliation.mjs", import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(text).digest("hex"),
    "423ade88239e46fbd06d8703d3457237938c157caa249a43865af4c5a1e3a093", "Exact sealed cleanup Source required");
  const start = text.indexOf("if (statusMode) {\n  let status, firstFailure;");
  const end = text.indexOf("\n} else {\nawait db.connect();", start);
  assert.ok(start > 0 && end > start, "Exact status-only branch required");
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const settle = new AsyncFunction("db", "Client", "statusMode", "readOriginalRestoreDatabaseStatus", "statusRequest", "console",
    text.slice(start, end) + "\n}");
  const request = Object.freeze({restoreId:"11111111-2222-4333-8444-555555555555", generation:"7",
    archiveDigest:"a".repeat(64), targetProjectRef:"abcdefghijklmnopqrst"});
  const metadata = Object.freeze({schema:"SYNTHETIC_RECORDING_SENTINEL_NOT_A_DATABASE_STATUS"});
  const invoke = async (failures = {}) => {
    const order = [], logs = [];
    const step = name => { order.push(name); if (Object.hasOwn(failures, name)) throw failures[name]; };
    class RecordingStatusPorts {
      async connect() { step("connect"); }
      async query(sql) {
        assert.ok(sql === "begin isolation level repeatable read read only" || sql === "rollback");
        step(sql === "rollback" ? "rollback" : "begin");
      }
      async end() { assert.equal(this, db); step("nativeend"); }
    }
    const db = new RecordingStatusPorts();
    db.end = async () => assert.fail("Own end override must not run");
    let failed = false, failure;
    try {
      await settle(db, RecordingStatusPorts, true, async (client, tuple) => {
        assert.equal(client, db); assert.equal(tuple, request); step("read"); return metadata;
      }, request, {log:line => { step("log"); logs.push(JSON.parse(line)); }});
    } catch (error) { failed = true; failure = error; }
    return {order, logs, failed, failure};
  };
  const cases = [];
  const run = async (name, body) => { await body(); cases.push(name); };
  const noOutput = result => assert.deepEqual(result.logs, []);
  await run("STATUS_CLEANUP_NEW success outputs only after native close", async () => {
    const result = await invoke(); assert.equal(result.failed, false);
    assert.deepEqual(result.order, ["connect", "begin", "read", "rollback", "nativeend", "log"]);
    assert.deepEqual(result.logs, [metadata]);
  });
  await run("STATUS_CLEANUP_NEW read failure survives cleanup failures", async () => {
    const original = new Error("Synthetic read failure");
    const result = await invoke({read:original, rollback:new Error("Synthetic rollback failure"), nativeend:new Error("Synthetic end failure")});
    assert.equal(result.failed, true); assert.equal(result.failure, original); noOutput(result);
    assert.deepEqual(result.order, ["connect", "begin", "read", "rollback", "nativeend"]);
  });
  await run("STATUS_CLEANUP_NEW rollback failure prevents output and still closes", async () => {
    const original = new Error("Synthetic rollback failure"), result = await invoke({rollback:original});
    assert.equal(result.failed, true); assert.equal(result.failure, original); noOutput(result);
    assert.deepEqual(result.order, ["connect", "begin", "read", "rollback", "nativeend"]);
  });
  await run("STATUS_CLEANUP_NEW native end failure prevents output", async () => {
    const original = new Error("Synthetic end failure"), result = await invoke({nativeend:original});
    assert.equal(result.failed, true); assert.equal(result.failure, original); noOutput(result);
    assert.deepEqual(result.order, ["connect", "begin", "read", "rollback", "nativeend"]);
  });
  await run("STATUS_CLEANUP_NEW failed connect does not rollback but closes", async () => {
    const original = new Error("Synthetic connect failure"), result = await invoke({connect:original});
    assert.equal(result.failed, true); assert.equal(result.failure, original); noOutput(result);
    assert.deepEqual(result.order, ["connect", "nativeend"]);
  });
  await run("STATUS_CLEANUP_NEW failed begin rolls back once then closes", async () => {
    const original = new Error("Synthetic begin failure"), result = await invoke({begin:original});
    assert.equal(result.failed, true); assert.equal(result.failure, original); noOutput(result);
    assert.deepEqual(result.order, ["connect", "begin", "rollback", "nativeend"]);
  });
  await run("STATUS_CLEANUP_NEW undefined and falsy original failures are retained", async () => {
    for (const value of [undefined, null, false, 0, ""]) for (const phase of ["connect", "begin", "read", "rollback", "nativeend"]) {
      const result = await invoke({[phase]:value});
      assert.equal(result.failed, true); assert.equal(result.failure, value); noOutput(result);
      assert.deepEqual(result.order, phase === "connect" ? ["connect", "nativeend"]
        : phase === "begin" ? ["connect", "begin", "rollback", "nativeend"] : ["connect", "begin", "read", "rollback", "nativeend"]);
    }
  });
  assert.equal(cases.length, 7);
  console.log(JSON.stringify({scope:"NEW_STATUS_CLEANUP_SOURCE_CONTROL_FLOW_ONLY", cases, count:cases.length,
    actual_SQL:"NOT_RUN", native_reader:"NOT_RUN", child_processes:0, authority:false}));
  process.exit(0);
}

// New metadata-status boundaries only; no connection, SQL, signer or provider.
if (process.argv.includes("--original-restore-status-source-only")) {
  const { default: pg } = await import("pg");
  const { readOriginalRestoreDatabaseStatus: readStatus } = await import("./disaster-recovery-state.mjs");
  const { spawnSync } = await import("node:child_process");
  const request = { restoreId: "11111111-2222-4333-8444-555555555555", generation: "7",
    archiveDigest: "a".repeat(64), targetProjectRef: "abcdefghijklmnopqrst" };
  const denied = error => error.code === "RESTORE_ORIGINAL_STATUS_UNAVAILABLE";
  const clients = [], cases = [];
  try {
    let queryCalls = 0;
    const fake = { query() { queryCalls++; throw new Error("Injected query must not run"); } };
    const getter = Object.defineProperty({}, "query", { get() { queryCalls++; throw new Error("Getter must not run"); } });
    for (const db of [null, {}, fake, getter, new Proxy(fake, {})])
      await assert.rejects(() => readStatus(db, request), denied);
    const overridden = new pg.Client({connectionString:"postgresql://fixture:fixture@127.0.0.1:1/fixture"}); clients.push(overridden);
    overridden.query = () => { queryCalls++; throw new Error("Own override must not run"); };
    await assert.rejects(() => readStatus(overridden, request), denied);
    assert.equal(queryCalls, 0);
    cases.push("ORIGINAL_STATUS_NEW native-client-only refusal before query");
    const client = new pg.Client({connectionString:"postgresql://fixture:fixture@127.0.0.1:1/fixture"}); clients.push(client);
    for (const change of [
      {restoreId:"not-a-uuid"}, {restoreId:request.restoreId+"\n"}, {generation:7}, {generation:"0"},
      {generation:"01"}, {generation:"7\n"}, {generation:"9223372036854775808"},
      {archiveDigest:"b".repeat(63)}, {archiveDigest:request.archiveDigest+"\n"},
      {targetProjectRef:"different"}, {targetProjectRef:request.targetProjectRef+"\n"},
    ]) await assert.rejects(() => readStatus(client, {...request,...change}), denied);
    assert.equal(client._connected, false); assert.equal(client._queryQueue.length, 0);
    cases.push("ORIGINAL_STATUS_NEW malformed original tuple refused before IO");
    const names = ["RESTORE_RECONCILIATION_STATUS_ID","RESTORE_RECONCILIATION_STATUS_GENERATION","RESTORE_RECONCILIATION_STATUS_ARCHIVE_DIGEST"];
    for (const name of names) {
      // Missing DB URL and keys also guarantee no connection/signature if this
      // prerequisite regresses; the expected status-specific error is earlier.
      const child = spawnSync(process.execPath, [new URL("./create-production-restore-reconciliation.mjs", import.meta.url).pathname],
        {env:{[name]:name.endsWith("_ID")?request.restoreId:name.endsWith("_GENERATION")?"7":request.archiveDigest},
          encoding:"utf8",timeout:10000});
      if (child.error) throw child.error; // Preserve denial; never retry/reroute.
      assert.notEqual(child.status, 0);
      assert.match(child.stderr, /Original status requires RESTORE_RECONCILIATION_STATUS_ID/);
      assert.doesNotMatch(child.stderr, /must contain at least 32 bytes/);
    }
    cases.push("ORIGINAL_STATUS_NEW partial CLI tuple needs no signing key or connection");
  } finally {
    for (const client of clients) await pg.Client.prototype.end.call(client);
  }
  console.log(JSON.stringify({scope:"NEW_ORIGINAL_STATUS_NEGATIVE_SOURCE_ONLY",cases,count:cases.length,
    actual_SQL:"NOT_RUN",positive_status:"NOT_RUN",connections:0,limits:"Actual module/native client rejection and local CLI prerequisites only; no database metadata or owner/transaction proof."}));
  process.exit(0);
}

// Newly moved original ACL adapter: native/Source refusals only, no SQL.
if (process.argv.includes("--immutable-source-acl-refusals-only")) {
  const pg = (await import("pg")).default;
  const { reconcileVerifiedImmutableBootstrapAcls: reconcile } = await import("./immutable-private-source-acl.mjs");
  const cases=[],clients=[];
  let queryCallbacks=0,callerGetters=0,proxyTraps=0;
  const run=async(name,body)=>{await body();cases.push(name);console.log(JSON.stringify({case:name,status:"PASS_NEW_REFUSAL_ONLY"}));};
  const client=()=>{const value=new pg.Client({connectionString:"postgresql://fixture:fixture@127.0.0.1:1/fixture"});
    clients.push(value);return value;};
  const counterfeit=Object.freeze({rawRows:Object.freeze([]),inventory:Object.freeze({}),target_empty:true});
  try {
    await run("SOURCE_ACL_NEW absent and injected query ports refuse before IO",async()=>{
      for(const value of [null,undefined,{},Object.freeze({query(){queryCallbacks++;throw Error("caller query must never run");}})])
        await assert.rejects(()=>reconcile(value,counterfeit,{}),/Actual native pg.Client required/);
    });
    await run("SOURCE_ACL_NEW client proxy and getter query refuse without callbacks",async()=>{
      const value=client(),proxy=new Proxy(value,{get(){proxyTraps++;throw Error("proxy getter");},getPrototypeOf(){proxyTraps++;throw Error("proxy prototype");}});
      await assert.rejects(()=>reconcile(proxy,counterfeit,{}),/Actual native pg.Client required/);
      Object.defineProperty(value,"query",{get(){callerGetters++;throw Error("query getter");},configurable:true});
      await assert.rejects(()=>reconcile(value,counterfeit,{}),/Actual native pg.Client required/);
    });
    await run("SOURCE_ACL_NEW actual client refuses null and JSON plan authority",async()=>{
      const value=client();
      for(const source of [null,{},counterfeit,JSON.parse(JSON.stringify(counterfeit))])
        await assert.rejects(()=>reconcile(value,source,{}));
    });
    await run("SOURCE_ACL_NEW plan proxies and accessors cannot manufacture Source",async()=>{
      const value=client(),source=new Proxy({}, {get(){proxyTraps++;throw Error("plan callback");}});
      await assert.rejects(()=>reconcile(value,source,{}));
      const getterSource={};Object.defineProperty(getterSource,"rawRows",{enumerable:true,get(){callerGetters++;throw Error("plan getter");}});
      await assert.rejects(()=>reconcile(value,getterSource,{}));
    });
    await run("SOURCE_ACL_NEW native client own override is never dispatched",async()=>{
      const value=client();value.query=()=>{queryCallbacks++;throw Error("override");};
      await assert.rejects(()=>reconcile(value,counterfeit,{}),/Actual native pg.Client required/);
    });
    assert.equal(queryCallbacks,0);assert.equal(callerGetters,0);assert.equal(proxyTraps,0);
    for(const value of clients){assert.equal(value._connected,false);assert.equal(value._queryQueue.length,0);}
  } finally {
    for(const value of clients)await pg.Client.prototype.end.call(value);
  }
  console.log(JSON.stringify({scope:"NEW_SOURCE_ACL_NATIVE_REFUSAL_ONLY",cases,count:cases.length,connections:0,
    query_callbacks:queryCallbacks,caller_getters:callerGetters,proxy_traps:proxyTraps,clients_closed:clients.length,
    SQL:"NOT_RUN",positive_reconciliation:"NOT_RUN",authority:"NONE",
    limits:"Native port and unbranded Source refusal only; real actor/fences/empty target/revocations require Main SQL qualification."}));
  process.exit(0);
}

// Exact v1 issuer generation boundaries only: actual Source slices, recording
// UUID/binding/signature ports; no CLI, signing key, SQL or connection runs.
if (process.argv.includes("--restore-v1-generation-only")) {
  const {readFileSync}=await import("node:fs");
  const {createHash}=await import("node:crypto");
  const projectRef="abcdefghijklmnopqrst",cases=[];
  const make=(name)=>{
    const source=readFileSync(new URL("./"+name,import.meta.url),"utf8");
    const issuer=name==="create-production-restore-intent.mjs";
    const start=source.indexOf(issuer?"  const controlState = control.rows[0];":"  const state = control.rows[0];");
    const end=source.indexOf(issuer?"  const retryFailure =":"  const manifestResult =",start);
    const intentStart=source.indexOf("  const intent = {",end);
    const intentEnd=source.indexOf('  await db.query("rollback");',intentStart);
    assert.ok(start>=0&&end>start&&intentStart>end&&intentEnd>intentStart,"Exact issuer admission/output Source required");
    const execute=new Function("control","projectRef","fixture","createHash","randomUUID","signBinding",
      "restoreIntentBinding","restoreReconciliationBinding","stableJson","console",
      'const {summary,archiveDigest,retryFailure,migration,release,actor,ttlMinutes,keyId,key,manifest,discrepancySnapshotSha256,storageSupportedStateResample,resolutions}=fixture;\n'
      +source.slice(start,end)+"\n"+source.slice(intentStart,intentEnd));
    return value=>{
      const trace={uuid:0,binding:0,sign:0,outputs:[]};
      const fixture={summary:{project_ref:projectRef,source_identity:{fixture:"synthetic-generation-only"}},archiveDigest:"a".repeat(64),
        retryFailure:false,migration:{rows:[{migration_head:"synthetic"}]},release:{rows:[{release_id:"synthetic"}]},
        actor:"Synthetic Generation Fixture",ttlMinutes:5,keyId:"recording-only",key:null,
        manifest:{final_manifest_sha256:"b".repeat(64)},discrepancySnapshotSha256:"c".repeat(64),
        storageSupportedStateResample:null,resolutions:[]};
      const control={rows:[{authority_generation:value,state:"PAUSED_RECONCILIATION",mutations_paused:true,
        restore_id:"22222222-2222-4222-8222-222222222222",target_project_ref:projectRef}]};
      let error;
      try {
        execute(control,projectRef,fixture,createHash,
          ()=>{trace.uuid++;return "11111111-1111-4111-8111-111111111111";},
          ()=>{trace.sign++;return "RECORDING_NO_SIGNATURE";},
          value=>{trace.binding++;return value;},value=>{trace.binding++;return value;},
          JSON.stringify,{log:value=>trace.outputs.push(JSON.parse(value))});
      } catch(value){error=value;}
      return {trace,error};
    };
  };
  const issue=make("create-production-restore-intent.mjs"),reconcile=make("create-production-restore-reconciliation.mjs");
  const admitted=(run,input,expected)=>{
    const {trace,error}=run(input);assert.equal(error,undefined);
    assert.deepEqual([trace.uuid,trace.binding,trace.sign,trace.outputs.length],[1,1,1,1]);
    const value=trace.outputs[0].intent.authority_generation;
    assert.equal(value,expected);assert.equal(typeof value,"number");assert.ok(Number.isSafeInteger(value)&&value>0);
    assert.equal(JSON.stringify({authority_generation:value}),'{"authority_generation":'+expected+'}');
    return value;
  };
  const refused=(run,input)=>{
    const {trace,error}=run(input);assert.ok(error instanceof Error,"Unsupported generation must refuse");
    assert.deepEqual(trace,{uuid:0,binding:0,sign:0,outputs:[]},"Refusal precedes UUID, binding, signing and emission");
  };
  const run=(name,body)=>{body();cases.push(name);console.log(JSON.stringify({case:name,status:"PASS_NEW_RECORDING_SOURCE_ONLY"}));};
  run("RESTORE_GENERATION_NEW intent exact safe next numeric",()=>{
    for(const value of ["0","1","42","9007199254740989","9007199254740990"])
      admitted(issue,value,Number(BigInt(value)+1n));
  });
  run("RESTORE_GENERATION_NEW intent malformed unsafe and exhausted refuse before UUID",()=>{
    const values=["9007199254740991","9007199254740992","9007199254740993","9223372036854775807","9223372036854775808",
      "1000000000000000000000","", "00","01"," 1","1 ","1\n","1\r\n","+1","-1","-0","1.0","1e3","１",
      0,1,Number.MAX_SAFE_INTEGER,9007199254740992,Infinity,NaN,1n,null,undefined,{},[]];
    for(const value of values)refused(issue,value);
    let coercions=0;refused(issue,{toString(){coercions++;return "1";}});assert.equal(coercions,0);
  });
  run("RESTORE_GENERATION_NEW reconciliation exact positive safe numeric",()=>{
    for(const value of ["1","2","42","9007199254740990","9007199254740991"])
      admitted(reconcile,value,Number(BigInt(value)));
  });
  run("RESTORE_GENERATION_NEW reconciliation malformed zero and unsafe refuse before UUID",()=>{
    const values=["0","9007199254740992","9007199254740993","9223372036854775807","9223372036854775808",
      "1000000000000000000000","", "00","01"," 1","1 ","1\n","1\r\n","+1","-1","-0","1.0","1e3","１",
      0,1,Number.MAX_SAFE_INTEGER,9007199254740992,Infinity,NaN,1n,null,undefined,{},[]];
    for(const value of values)refused(reconcile,value);
    let coercions=0;refused(reconcile,{toString(){coercions++;return "1";}});assert.equal(coercions,0);
  });
  console.log(JSON.stringify({scope:"NEW_RESTORE_V1_GENERATION_SOURCE_ONLY",cases,count:cases.length,
    SQL:"NOT_RUN",CLI:"NOT_RUN",UUID:"RECORDING_ONLY",signing:"NOT_RUN",keys_retrieved:0,connections:0,
    limits:"Actual generation admission/output Source with synthetic recording ports; no genuine signatures, pause, SQL, archive admission or status-reader proof."}));
  process.exit(0);
}

// Newly changed initializer count region plus its unchanged guarded caller.
// Synthetic recording callbacks only; not native Source/owner/SQL authority.
if(process.argv.includes("--immutable-initializer-counts-only")){
 const {readFileSync}=await import("node:fs"),{types}=await import("node:util");
 const text=readFileSync(new URL("./immutable-private-source-initializer.mjs",import.meta.url),"utf8");
 const queryStart=text.indexOf(" const query=async("),queryEnd=text.indexOf("\n const inventory=",queryStart);
 const countStart=text.indexOf(" const counterParallelSafety="),countEnd=text.indexOf("\n const before=",countStart);
 const quote=text.split("\n").find(line=>line.startsWith("const quote="));
 assert.ok(queryStart>0&&queryEnd>queryStart&&countStart>queryEnd&&countEnd>countStart&&quote);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const execute=new AsyncFunction("assert","types","relations","schemas","originalContext","db","nativeQuery","readContext","checkSource",
  quote+"\n"+text.slice(queryStart,queryEnd)+"\n"+text.slice(countStart,countEnd));
 const relations=Array.from({length:279},(_,index)=>({schema_name:index===278?"storage":"public",
  table_name:index===278?'quote";not_sql':"table_"+String(index).padStart(3,"0"),relation_kind:"r",is_partition:false,
  owner_name:"supabase_admin",relrowsecurity:true,relforcerowsecurity:index%2===0}));
 const originalContext=Object.freeze({transaction_id:"123456"});
 const schemas=["public","auth","storage","custodial_release_identity"];
 let variants=0,accessors=0,proxyTraps=0;
 const invoke=async(options={})=>{
  const tables=options.relations||relations,trace={catalog:0,counts:0,events:[],completed:false},sourceFailure=Error("Synthetic original Source changed"),ownerFailure=Error("Synthetic original owner/fence changed");
  let changedSource=false,changedOwner=false,sqlObserved,paramsObserved;
  const db={};
  const readContext=async()=>{trace.events.push("context");if(changedOwner)throw ownerFailure;};
  const checkSource=()=>{trace.events.push("source");if(changedSource)throw sourceFailure;};
  const query=async function(sql,params){
   assert.equal(this,db);
   if(sql.startsWith("select proparallel::text counter_parallel_safety")){
    trace.catalog++;trace.events.push("catalog");
    assert.ok(sql.includes("oid='pg_catalog.txid_current()'::pg_catalog.regprocedure"));
    return options.catalog||{rowCount:1,rows:[{counter_parallel_safety:"u"}]};
   }
   trace.counts++;trace.events.push("counts");sqlObserved=sql;paramsObserved=params.slice();
   if(options.queryError)throw options.queryError;
   const rows=tables.map(row=>({schema_name:row.schema_name,table_name:row.table_name,row_count:"0",transaction_id:originalContext.transaction_id}));
   const result={rowCount:rows.length,rows};if(options.changeResult)options.changeResult(result);
   await Promise.resolve();
   changedSource=options.changeSource===true;changedOwner=options.changeOwner===true;
   return result;
  };
  let error;try{await execute(assert,types,tables,schemas,originalContext,db,query,readContext,checkSource);trace.completed=true;}
  catch(value){error=value;}
  return{trace,error,sql:sqlObserved,params:paramsObserved,sourceFailure,ownerFailure};
 };
 const healthy=await invoke();assert.equal(healthy.error,undefined);assert.equal(healthy.trace.completed,true);
 assert.equal(healthy.trace.catalog,1);assert.equal(healthy.trace.counts,1);
 assert.deepEqual(healthy.trace.events,["context","source","catalog","source","context","context","source","counts","source","context"]);
 assert.deepEqual(healthy.params,relations.flatMap(row=>[row.schema_name,row.table_name]));
 const parts=relations.map((row,index)=>{
  const quoted=value=>'"'+value.replaceAll('"','""')+'"';
  return "select $"+(2*index+1)+"::text schema_name,$"+(2*index+2)
   +"::text table_name,count(*)::text row_count,pg_catalog.txid_current()::text transaction_id,"
   +index+"::integer original_ordinal from ONLY "+quoted(row.schema_name)+"."+quoted(row.table_name);
 });
 assert.equal(healthy.sql,"select schema_name,table_name,row_count,transaction_id from ("+parts.join(" UNION ALL ")+") original_counts order by original_ordinal");
 assert.equal(healthy.sql.split("pg_catalog.txid_current()::text").length-1,279);
 for(const catalog of [{rowCount:0,rows:[]},{rowCount:1,rows:[{counter_parallel_safety:"s"}]},
  {rowCount:1,rows:[{counter_parallel_safety:"r"}]},{rowCount:1,rows:[{counter_parallel_safety:null}]},
  {rowCount:1,rows:[{counter_parallel_safety:"u",extra:true}]}]){
  const result=await invoke({catalog});assert.ok(result.error instanceof Error);assert.equal(result.trace.counts,0);
  assert.equal(result.trace.completed,false);variants++;
 }
 const malformed=[
  result=>{result.rowCount--;},result=>{result.rows.pop();},result=>{result.rows.push({...result.rows[0]});result.rowCount++;},
  result=>{result.rows[1]={...result.rows[0]};},result=>{[result.rows[0],result.rows[1]]=[result.rows[1],result.rows[0]];},
  result=>{result.rows[0].schema_name="auth";},result=>{result.rows[0].table_name="foreign";},
  result=>{result.rows[0].row_count="1";},result=>{result.rows[0].row_count=0;},
  result=>{result.rows[0].transaction_id="123457";},result=>{result.rows[0].transaction_id=123456;},
  result=>{delete result.rows[0].transaction_id;},result=>{result.rows[0].extra=true;},
  result=>{Object.defineProperty(result.rows[0],"hidden",{value:true});},
  result=>{result.rows[0][Symbol("unexpected")]=true;},
  result=>{Object.defineProperty(result.rows[0],"row_count",{get(){accessors++;return "0";},enumerable:true});},
  result=>{result.rows[0]=Object.assign(Object.create(null),result.rows[0]);},
  result=>{result.rows[0]=new Proxy(result.rows[0],{get(){proxyTraps++;throw Error("proxy count");}});}
 ];
 for(const changeResult of malformed){const result=await invoke({changeResult});assert.ok(result.error instanceof Error);
  assert.equal(result.trace.counts,1);assert.equal(result.trace.completed,false);variants++;}
 for(const mutation of [
  rows=>{rows[1]={...rows[0]};},rows=>{rows[0].schema_name="pg_catalog";},
  rows=>{rows[0].relation_kind="f";},rows=>{rows[0].is_partition=true;},
  rows=>{rows[0].table_name="bad\0name";},rows=>{rows[0].table_name="x".repeat(64);},rows=>{rows[0].table_name="\ud800";}
 ]){
  const rows=relations.map(row=>({...row}));mutation(rows);const result=await invoke({relations:rows});
  assert.ok(result.error instanceof Error);assert.equal(result.trace.counts,0);assert.equal(result.trace.completed,false);variants++;
 }
 for(const options of [{changeSource:true},{changeOwner:true}]){
  const result=await invoke(options);assert.equal(result.error,options.changeSource?result.sourceFailure:result.ownerFailure);
  assert.equal(result.trace.counts,1);assert.equal(result.trace.completed,false);variants++;
 }
 const queryError=Error("Synthetic native count failure"),failed=await invoke({queryError});
 assert.equal(failed.error,queryError);assert.equal(failed.trace.completed,false);variants++;
 assert.equal(accessors,0);assert.equal(proxyTraps,0);
 console.log(JSON.stringify({case:"INITIALIZER_COUNTS_NEW one serial bound complete original-table count and fail-closed caller",
  status:"PASS_NEW_RECORDING_SOURCE_ONLY",tables:279,count_queries:healthy.trace.counts,catalog_queries:healthy.trace.catalog,
  refusal_variants:variants,accessor_callbacks:accessors,proxy_traps:proxyTraps,SQL:"NOT_RUN",native_initializer:"NOT_RUN",
  limits:"Actual released count region and unchanged guarded query Source; recording callbacks are not authenticated Source/actor/fence/parallel-execution or initialization proof.",
  connections:0,resources:0}));
 process.exit(0);
}

// Newly batched migration-ledger hydration and its existing guarded caller/
// final readback only. Recording Source fixture, never native SQL authority.
if(process.argv.includes("--immutable-initializer-ledger-only")){
 const {readFileSync}=await import("node:fs");
 const text=readFileSync(new URL("./immutable-private-source-initializer.mjs",import.meta.url),"utf8");
 const queryStart=text.indexOf(" const query=async("),queryEnd=text.indexOf("\n const inventory=",queryStart);
 const inventory=text.split("\n").find(line=>line.startsWith(" const inventory="));
 const start=text.indexOf(" const ledgerRaw="),end=text.indexOf("\n // Preserve signed cron originals",start);
 const readbackStart=text.indexOf(" const restoredLedger="),readbackEnd=text.indexOf("\n const cronCompared=",readbackStart);
 assert.ok(queryStart>0&&queryEnd>queryStart&&inventory&&start>queryEnd&&end>start&&readbackStart>end&&readbackEnd>readbackStart);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const execute=new AsyncFunction("assert","source","db","nativeQuery","readContext","checkSource",
  text.slice(queryStart,queryEnd)+"\n"+inventory+"\n"+text.slice(start,end)+"\n"+text.slice(readbackStart,readbackEnd)+"\nreturn ledger;");
 const raw=String.raw`[
  {"version":"20261017000002","name":null,"statements":null},
  {"version":"20261017000001","name":"quote: \" slash: \\ unicode: \u0061 café",
   "statements":[null,"","NULL","select 9007199254740993, 1.2300e+3","semi; -- retained data","quote: \" slash: \\"]},
  {"version":"20261017000003","name":"","statements":[]}
 ]`;
 const parsed=JSON.parse(raw);assert.equal(parsed[0].statements,null);assert.equal(parsed[1].statements[0],null);
 assert.equal(parsed[1].statements[2],"NULL");assert.deepEqual(parsed[2].statements,[]);
 const sql=`insert into supabase_migrations.schema_migrations(version,name,statements)
  select r.version,r.name,r.statements
  from pg_catalog.json_array_elements($1::json) with ordinality e(image,ordinality)
  cross join lateral pg_catalog.json_populate_record(null::supabase_migrations.schema_migrations,e.image) r
  order by e.ordinality`;
 const invoke=async(options={})=>{
  const originalRaw=Object.hasOwn(options,"raw")?options.raw:raw;
  const source=Object.freeze({inventory:Object.freeze({"inventory/migration-ledger.json":originalRaw})}),db={};
  const trace={inserts:0,readbacks:0,completed:false,events:[],params:null};
  const sourceError=Error("Synthetic original Source changed"),ownerError=Error("Synthetic original owner/transaction changed");
  let sourceChanged=false,ownerChanged=false;
  const readContext=async()=>{trace.events.push("context");if(ownerChanged)throw ownerError;};
  const checkSource=()=>{trace.events.push("source");if(sourceChanged)throw sourceError;};
  const nativeQuery=async function(statement,params){
   assert.equal(this,db);
   if(statement.startsWith("insert into supabase_migrations.schema_migrations(")){
    trace.inserts++;trace.events.push("insert");trace.params=params.slice();
    assert.equal(statement,sql);assert.deepEqual(params,[originalRaw]);assert.equal(params[0],originalRaw);
    if(options.queryError)throw options.queryError;
    await Promise.resolve();sourceChanged=options.changeSource===true;ownerChanged=options.changeOwner===true;
    return{rowCount:Object.hasOwn(options,"rowCount")?options.rowCount:JSON.parse(originalRaw).length};
   }
   assert.ok(statement.startsWith("select version::text,name::text,statements from supabase_migrations.schema_migrations"));
   assert.ok(statement.includes("order by array_position($1::text[],version::text)"));trace.readbacks++;trace.events.push("readback");
   const rows=JSON.parse(originalRaw);assert.deepEqual(params,[rows.map(row=>row.version)]);
   if(options.changeReadback)options.changeReadback(rows);
   return{rowCount:rows.length,rows};
  };
  let error,value;try{value=await execute(assert,source,db,nativeQuery,readContext,checkSource);trace.completed=true;}
  catch(failure){error=failure;}
  return{trace,error,value,sourceError,ownerError};
 };
 const healthy=await invoke();assert.equal(healthy.error,undefined);assert.deepEqual(healthy.value,parsed);
 assert.equal(healthy.trace.inserts,1);assert.equal(healthy.trace.readbacks,1);assert.equal(healthy.trace.completed,true);
 assert.deepEqual(healthy.trace.params,[raw]);
 assert.deepEqual(healthy.trace.events,["context","source","insert","source","context","context","source","readback","source","context"]);
 let refusals=0;
 for(const rowCount of [0,2,4,"3",null,undefined]){
  const result=await invoke({rowCount});assert.ok(result.error instanceof Error);assert.equal(result.trace.inserts,1);
  assert.equal(result.trace.readbacks,0);assert.equal(result.trace.completed,false);refusals++;
 }
 for(const changeReadback of [
  rows=>rows.reverse(),rows=>{rows[1].statements[3]="select 9007199254740992, 1230";},
  rows=>{rows[0].statements=[];},rows=>{rows[2].statements=null;},rows=>{rows[1].statements[0]="NULL";},
  rows=>{rows[0].name="";},rows=>{rows.pop();}
 ]){
  const result=await invoke({changeReadback});assert.ok(result.error instanceof Error);
  assert.equal(result.trace.inserts,1);assert.equal(result.trace.readbacks,1);assert.equal(result.trace.completed,false);refusals++;
 }
 for(const options of [{changeSource:true},{changeOwner:true}]){
  const result=await invoke(options);assert.equal(result.error,options.changeSource?result.sourceError:result.ownerError);
  assert.equal(result.trace.inserts,1);assert.equal(result.trace.readbacks,0);assert.equal(result.trace.completed,false);refusals++;
 }
 const originalError=Error("Synthetic original INSERT failure"),failed=await invoke({queryError:originalError});
 assert.equal(failed.error,originalError);assert.equal(failed.trace.inserts,1);assert.equal(failed.trace.readbacks,0);refusals++;
 for(const value of ["null","{}","[","1"]){
  const result=await invoke({raw:value});assert.ok(result.error instanceof Error);
  assert.equal(result.trace.inserts,0);assert.equal(result.trace.readbacks,0);assert.equal(result.trace.completed,false);refusals++;
 }
 console.log(JSON.stringify({case:"INITIALIZER_LEDGER_NEW one raw ordered typed INSERT and unchanged exact readback/caller",
  status:"PASS_NEW_RECORDING_SOURCE_ONLY",original_rows:parsed.length,insert_queries:healthy.trace.inserts,
  exact_readback_queries:healthy.trace.readbacks,refusal_variants:refusals,raw_source_parameter_byte_identical:true,
  SQL:"NOT_RUN",native_initializer:"NOT_RUN",connections:0,resources:0,
  limits:"Actual ledger region/guarded query/final readback Source with recording ports; native PG array/type/order/trigger/runtime equivalence remains Main-owned."}));
 process.exit(0);
}

// Newly affected routine ACL builder -> private guarded batch-port contract.
// Actual Source functions with synthetic catalog/actor/receipt recording only.
if(process.argv.includes("--immutable-routine-acl-batch-only")){
 const {readFileSync}=await import("node:fs");
 const text=readFileSync(new URL("./immutable-private-source-acl.mjs",import.meta.url),"utf8");
 const start=text.indexOf("   async function captureOriginalRoutineAcls("),end=text.indexOf("   async function captureOriginalRelationAcls(",start);
 assert.ok(start>0&&end>start);
 const reconcile=new Function("assert",text.slice(start,end)+"\nreturn reconcileOriginalRoutineAcls;")(assert);
 const owner="supabase_admin",clone=value=>structuredClone(value);
 const freeze=value=>{if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
 const grant=(grantee,is_grantable=false,grantor=owner)=>({grantee,grantor,privilege_type:"EXECUTE",is_grantable});
 const original=freeze([
  {kind:"FUNCTION",schema_name:"public",object_name:"a_function",identity:"public.a_function(integer)",owner_name:owner,column_name:null,grants:[grant('reader"named')]},
  {kind:"PROCEDURE",schema_name:"public",object_name:"z_procedure",identity:"public.z_procedure(text)",owner_name:owner,column_name:null,grants:[]}
 ]);
 const originalBytes=JSON.stringify(original);
 const commands=[
  "REVOKE EXECUTE ON FUNCTION public.a_function(integer) FROM PUBLIC RESTRICT",
  'REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.a_function(integer) FROM "reader""named" RESTRICT',
  'REVOKE EXECUTE ON PROCEDURE public.z_procedure(text) FROM "extra;role" RESTRICT'
 ];
 let refusalVariants=0;
 const invoke=async(options={})=>{
  const expected=options.original||original,actual=clone(original);
  if(!options.empty){actual[0].grants=[grant("PUBLIC"),grant('reader"named',true)];actual[1].grants=[grant("extra;role")];}
  if(options.mutateActual)options.mutateActual(actual);
  let projected=false;
  const trace={captures:0,actors:0,batches:0,raw_writes:0,commands:null,events:[]};
  const target={async query(sql){
   assert.equal(this,target);
   if(/^REVOKE\b/.test(sql)){trace.raw_writes++;throw Error("Original ACL writes require the guarded batch port");}
   if(sql.includes("from pg_catalog.pg_proc p")){
    trace.captures++;trace.events.push("capture");
    return{rows:[{search_path:options.captureSearchPath||"pg_catalog",
      routines:clone(projected&&!options.keepExtras?expected:actual)}]};
   }
   assert.equal(sql,"select current_user actor,session_user session_actor,pg_catalog.current_setting('search_path') search_path");
   trace.actors++;trace.events.push("actor");
   return{rows:[{actor:trace.actors===2&&options.finalOwner?options.finalOwner:owner,
     session_actor:options.sessionActor||owner,search_path:options.ownerSearchPath||"pg_catalog"}]};
  },async revokeBatch(value){
   assert.equal(this,target);trace.batches++;trace.events.push("batch");
   assert.ok(Array.isArray(value)&&value.length>0);
   assert.deepEqual(Reflect.ownKeys(value),[...Array.from({length:value.length},(_,i)=>String(i)),"length"]);
   trace.commands=value.slice();assert.deepEqual(value,commands);
   if(options.batchError)throw options.batchError;
   projected=true;
   return Object.hasOwn(options,"receipt")?options.receipt:Object.freeze({revocation_count:value.length});
  }};
  let result,error;try{result=await reconcile(target,expected);}catch(value){error=value;}
  assert.equal(JSON.stringify(original),originalBytes,"Frozen original ACL DATA unchanged");
  return{result,error,trace};
 };
 const empty=await invoke({empty:true});assert.equal(empty.error,undefined);
 assert.deepEqual(empty.result,{revoked_count:0,privilege_revokes:0,grant_option_revokes:0});
 assert.deepEqual(empty.trace,{captures:2,actors:2,batches:0,raw_writes:0,commands:null,events:["capture","actor","capture","actor"]});
 const current=await invoke();assert.equal(current.error,undefined);
 assert.deepEqual(current.result,{revoked_count:3,privilege_revokes:2,grant_option_revokes:1});
 assert.deepEqual(current.trace,{captures:2,actors:2,batches:1,raw_writes:0,commands:commands.slice(),events:["capture","actor","batch","capture","actor"]});
 const cases=[
  {mutateActual:rows=>{rows[0].grants=rows[0].grants.filter(g=>g.grantee!=='reader"named');}},
  {mutateActual:rows=>{rows[1].grants[0].grantor="other_owner";}},
  {mutateActual:rows=>{rows[1].owner_name="other_owner";}},
  {mutateActual:rows=>{rows[1].identity="public.foreign_procedure(text)";}},
  {mutateActual:rows=>{rows[1].kind="AGGREGATE";}},
  {captureSearchPath:"public"},{sessionActor:"other_session"},{ownerSearchPath:"public"},
  {original:freeze(clone(original).reverse())},
  {original:freeze(clone(original).map((row,i)=>i===0?{...row,grants:[grant('reader"named',true)]}:row)),empty:true}
 ];
 for(const options of cases){const {error,trace}=await invoke(options);assert.ok(error instanceof Error);
  assert.equal(trace.batches,0);assert.equal(trace.raw_writes,0);refusalVariants++;}
 for(const receipt of [null,{},Object.freeze({revocation_count:0}),{revocation_count:2},{revocation_count:4},
  {revocation_count:"3"},{revocation_count:3,extra:true}]){
  const {error,trace}=await invoke({receipt});assert.ok(error instanceof Error);
  assert.equal(trace.batches,1);assert.equal(trace.captures,1);assert.equal(trace.raw_writes,0);refusalVariants++;
 }
 let receiptGetters=0;const receipt={};Object.defineProperty(receipt,"revocation_count",{enumerable:true,get(){receiptGetters++;return 3;}});
 const accessor=await invoke({receipt});assert.ok(accessor.error instanceof Error);assert.equal(receiptGetters,0);
 assert.equal(accessor.trace.batches,1);assert.equal(accessor.trace.captures,1);refusalVariants++;
 const batchError=Error("Synthetic original batch/source guard refused"),failed=await invoke({batchError});
 assert.equal(failed.error,batchError);assert.equal(failed.trace.batches,1);assert.equal(failed.trace.captures,1);refusalVariants++;
 for(const options of [{keepExtras:true},{finalOwner:"other_owner"}]){
  const {error,trace}=await invoke(options);assert.ok(error instanceof Error);
  assert.equal(trace.batches,1);assert.equal(trace.captures,2);assert.equal(trace.raw_writes,0);refusalVariants++;
 }
 console.log(JSON.stringify({case:"ROUTINE_ACL_BATCH_NEW complete plan empty/nonempty receipts and refusals",
  status:"PASS_NEW_RECORDING_SOURCE_ONLY",nonempty_batch_calls:current.trace.batches,exact_commands:3,
  privilege_revokes:current.result.privilege_revokes,option_revokes:current.result.grant_option_revokes,empty_batch_calls:empty.trace.batches,
  refusal_variants:refusalVariants,SQL:"NOT_RUN",native_batch_wrapper:"NOT_RUN",connections:0,resources:0,
  limits:"Actual private routine capture/reconciler Source with recording ports; no native actor/Source/fence/REVOKE/transaction proof."}));
 process.exit(0);
}

// Newly added private archive/intent key-independence seam only. One actual
// retained UNIT archive materialization, no signing or target/database work.
if(process.argv.includes("--immutable-fresh-intent-key-only")){
 const {createHash}=await import("node:crypto");
 const {readFileSync,lstatSync,existsSync,renameSync,copyFileSync}=await import("node:fs");
 const {join}=await import("node:path");
 const {materializeVerifiedArchive,assertVerifiedArchiveIndependentIntentKey:independent}=await import("./disaster-recovery-archive.mjs");
 const input="/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/authenticated-setwise-original-restore-v16/authenticated-original-source";
 const archiveKey="UNIT-only-immutable-archive-verification-key-20261016";
 const different="UNIT-only-independent-intent-comparison-20261017";
 const digest=createHash("sha256").update(archiveKey).digest("hex");
 const controls=["SHA256SUMS","backup-summary.json","archive-signature.json"];
 const hashes=Object.fromEntries(controls.map(name=>[name,createHash("sha256").update(readFileSync(join(input,name))).digest("hex")]));
 const originalRoot=lstatSync(input);
 let archive,owned,closed=false,refusals=0,valid=0,getters=0,proxyTraps=0,coercions=0;
 const cleanup=()=>{
  if(!archive||closed)return;
  const actual=lstatSync(owned.directory);
  assert.ok(actual.isDirectory()&&!actual.isSymbolicLink()&&actual.dev===owned.dev&&actual.ino===owned.ino&&actual.uid===process.getuid());
  archive.cleanup();assert.equal(existsSync(owned.directory),false);closed=true;
 };
 const terminate=()=>{try{cleanup();}finally{process.exit(124);}};
 process.once("SIGTERM",terminate);
 const refuse=(value,key)=>{
  let error;try{independent(value,key);}catch(failure){error=failure;}
  assert.ok(error instanceof Error,"Original live Source and independent bounded primitive key required");
  assert.equal(String(error.message).includes(archiveKey),false);
  assert.equal(String(error.message).includes(digest),false);refusals++;
 };
 try{
  archive=materializeVerifiedArchive({sourceDir:input,archiveVerifyKey:archiveKey,
   archiveVerifyKeyId:"unit-immutable-archive-v1",supportedFormats:["memphis-zoo-disaster-recovery.v4"]});
  const stat=lstatSync(archive.directory);
  owned={directory:archive.directory,dev:stat.dev,ino:stat.ino,uid:stat.uid,mode:stat.mode&511};
  console.log(JSON.stringify({owned_materialized_copy:owned,scope:"NEW_KEY_INDEPENDENCE_UNIT_ONLY"}));
  assert.equal(owned.uid,process.getuid());assert.equal(owned.mode,448);
  const publicKeys=Reflect.ownKeys(archive);
  for(const key of [different,"UNIT-only-"+"x".repeat(22),"UNIT-only-"+"x".repeat(65526),
    "UNIT-only-"+"é".repeat(11),"UNIT-only-"+"é".repeat(32763)]){
   assert.equal(independent(archive,key),undefined);valid++;
  }
  refuse(archive,archiveKey);refuse(archive,archiveKey.slice());
  for(const key of [undefined,null,true,false,0,1,1n,Symbol("UNIT-only"),{},[],()=>{coercions++;},
   new String(different),Buffer.from(different),new Uint8Array(32),"","x".repeat(31),
   "UNIT-only-"+"x".repeat(65527),"UNIT-only-"+"é".repeat(32764)]){
   refuse(archive,key);
  }
  refuse(archive,{toString(){coercions++;return different;}});
  refuse(archive,new Proxy({}, {get(){proxyTraps++;throw Error("key proxy");}}));
  const fake={};Object.defineProperty(fake,"directory",{get(){getters++;return owned.directory;}});
  for(const value of [null,undefined,{},fake,Object.create(archive),
   {...archive,archiveVerificationKeySha256:"caller-value",approved:true},
   new Proxy(archive,{get(){proxyTraps++;throw Error("archive proxy");},getPrototypeOf(){proxyTraps++;throw Error("archive prototype");}})]){
   refuse(value,different);
  }
  const descriptor=Object.getOwnPropertyDescriptor(archive,"directory");
  try{
   Object.defineProperty(archive,"directory",{configurable:true,enumerable:true,get(){getters++;return owned.directory;}});
   refuse(archive,different);
  }finally{Object.defineProperty(archive,"directory",descriptor);}
  archive.archiveVerificationKeySha256="caller-value";archive.independent_intent_key=true;
  try{refuse(archive,archiveKey);assert.equal(independent(archive,different),undefined);valid++;}
  finally{delete archive.archiveVerificationKeySha256;delete archive.independent_intent_key;}
  assert.deepEqual(Reflect.ownKeys(archive),publicKeys,"No key/digest fields added to public archive");
  const visible=JSON.stringify(archive);
  assert.equal(visible.includes(archiveKey),false);assert.equal(visible.includes(digest),false);
  assert.equal(getters,0);assert.equal(proxyTraps,0);assert.equal(coercions,0);
  // Mutate only this exact owned verification copy, never the retained input.
  const control=join(owned.directory,"SHA256SUMS"),saved=control+".owned-original";
  renameSync(control,saved);copyFileSync(saved,control);
  assert.notEqual(lstatSync(control).ino,lstatSync(saved).ino);
  refuse(archive,different); // Equal bytes at a foreign inode are not current.
  cleanup();refuse(archive,different);refuse({...archive},different);
 }finally{
  cleanup();process.off("SIGTERM",terminate);
  const after=lstatSync(input);assert.equal(after.dev,originalRoot.dev);assert.equal(after.ino,originalRoot.ino);
  for(const [name,expected]of Object.entries(hashes))assert.equal(createHash("sha256").update(readFileSync(join(input,name))).digest("hex"),expected);
 }
 console.log(JSON.stringify({case:"FRESH_INTENT_KEY_NEW private actual archive independence and lifetime",
  status:"PASS_NEW_UNIT_ARCHIVE_ONLY",materializations:1,valid_comparisons:valid,refusals,getters,proxy_traps:proxyTraps,coercions,
  copy_cleanup:{directory:owned.directory,dev:owned.dev,ino:owned.ino,absent:!existsSync(owned.directory)},
  original_controls_and_root_unchanged:true,SQL:"NOT_RUN",intent_signing:"NOT_RUN",restore_authority:"NONE",
  limits:"Existing retained UNIT signature verification and private key-independence/lifetime only; no genuine signer, intent authorization, Source initialization, DATA/COMMIT/resume or live SQL proof.",
  connections:0,resources:0}));
 process.exit(0);
}

// Newly affected UNKNOWN/retry boundaries only. Exact shipping Source with
// recording ports: no CLI entrypoint, pg.Client, target, signing or SQL runs.
if(process.argv.includes('--immutable-unknown-commit-source-only')||process.argv.includes('--original-status-failure-handoff-only')){
  const {readFileSync}=await import('node:fs');
  const handoffOnly=process.argv.includes('--original-status-failure-handoff-only');
  const selected=process.argv.find(arg=>arg.startsWith('--immutable-unknown-case='))?.slice('--immutable-unknown-case='.length);
  const cases=[],unhandled=[],observe=error=>unhandled.push(error);
  process.on('unhandledRejection',observe);
  const run=async(name,body)=>{if(handoffOnly!==name.startsWith('ORIGINAL_STATUS_HANDOFF_NEW '))return;if(selected&&selected!==name)return;await body();cases.push(name);console.log(JSON.stringify({case:name,status:'PASS_SOURCE_RECORDING_ONLY'}));};
  try{
    const applyText=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
    const start=applyText.lastIndexOf('\n} catch (error) {')+1,finallyStart=applyText.indexOf('\n} finally {',start),end=applyText.indexOf('\n}',finallyStart+'\n} finally {'.length)+2;
    assert.ok(start>0&&finallyStart>start&&end>finallyStart,'Exact outer CLI catch/finally required');
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    const settle=new AsyncFunction('originalError','prepared','restoreId','generation','archiveDigest','projectRef','restorePhase','restoreTable','mutationFenceHeld','setControl','recordEvent','db','console',
      'try {throw originalError;\n'+applyText.slice(start,end));
    const original={restoreId:'11111111-2222-4333-8444-555555555555',generation:7,archiveDigest:'a'.repeat(64)};
    const invoke=async(error,prepared=true)=>{
      const writes=[],cleanup=[],logs=[];
      const db={query:async(sql,args)=>{cleanup.push({sql,args});},end:async()=>{cleanup.push({end:true});}};
      let thrown;
      try{await settle(error,prepared,original.restoreId,original.generation,original.archiveDigest,'abcdefghijklmnopqrst','restore_database_original_mixed',null,true,
        async(...args)=>{writes.push({control:args});},async(...args)=>{writes.push({event:args});},db,{error:line=>logs.push(JSON.parse(line))});}
      catch(failure){thrown=failure;}
      assert.equal(thrown,error,'Original error must survive catch/finally');assert.equal(logs.length,1);
      assert.equal(cleanup.length,3);assert.ok(cleanup[0].sql.includes('memphis-zoo-production-restore'));
      assert.ok(cleanup[1].sql.includes('memphis-zoo-application-mutation-fence'));assert.deepEqual(cleanup[2],{end:true});
      return {writes,cleanup,log:logs[0]};
    };
    await run('UNKNOWN_COMMIT_NEW unknown prepared and unprepared preserve original identity without failure writes',async()=>{
      for(const prepared of [true,false]){
        const error=Object.assign(new Error('Synthetic immutable commit reply unavailable'),{code:'IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN',outcome:'UNKNOWN',retry_safe:false});
        const {writes,log}=await invoke(error,prepared);assert.deepEqual(writes,[]);
        assert.equal(log.outcome,'UNKNOWN');assert.equal(log.retry_safe,false);assert.equal(log.code,error.code);
        assert.equal(log.restore_id,original.restoreId);assert.equal(log.authority_generation,original.generation);assert.equal(log.archive_digest,original.archiveDigest);
        assert.equal(log.target_project_ref,'abcdefghijklmnopqrst');assert.ok(!log.restore_error.includes(error.message));
        assert.equal(log.ok,false);assert.equal(log.restore_phase,'restore_database_original_mixed');assert.equal(log.restore_table,null);
      }
    });
    await run('UNKNOWN_COMMIT_NEW known failure retains prior PAUSED_FAILURE event and finally behavior',async()=>{
      const error=new Error('Synthetic known failure');const {writes,log}=await invoke(error);
      assert.deepEqual(writes,[{control:['PAUSED_FAILURE',{paused:true,failureReason:error.message}]},
        {event:['restore_database_original_mixed','FAILED',{error:error.message}]}]);
      assert.equal(Object.hasOwn(log,'outcome'),false);assert.equal(Object.hasOwn(log,'retry_safe'),false);
      assert.deepEqual((await invoke(error,false)).writes,[]);
    });
    await run('UNKNOWN_COMMIT_REBIND unknown foreign metadata cannot label a planned restore',async()=>{
      const error=Object.assign(new Error('SYNTHETIC_PRIVATE_DETAIL_MUST_NOT_ESCAPE'),{outcome:'UNKNOWN',retry_safe:false,
        restore_id:'foreign',authority_generation:999,archive_digest:'b'.repeat(64),target_project_ref:'foreign',code:'SYNTHETIC_PRIVATE_CODE'});
      const {writes,log}=await invoke(error);assert.deepEqual(writes,[]);assert.equal(Object.hasOwn(log,'code'),false);
      for(const key of ['restore_id','authority_generation','archive_digest','target_project_ref','requested_original_restore'])
        assert.equal(Object.hasOwn(log,key),false,'Unrecognized UNKNOWN must not label a planned identity as original');
      assert.ok(!JSON.stringify(log).includes('SYNTHETIC_PRIVATE'));
    });
    await run('ORIGINAL_STATUS_HANDOFF_NEW current immutable UNKNOWN maps exact reader arguments without authority',async()=>{
      for(const code of ['IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN','PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'])for(const prepared of [false,true]){
        const error=Object.assign(new Error('SYNTHETIC_PRIVATE_DETAIL'),{code,outcome:'UNKNOWN',retry_safe:false});
        const {log,writes}=await invoke(error,prepared);assert.deepEqual(writes,[]);
        assert.deepEqual(log.original_status_request,{restoreId:original.restoreId,generation:'7',archiveDigest:original.archiveDigest,targetProjectRef:'abcdefghijklmnopqrst'});
        assert.deepEqual(Object.keys(log.original_status_request).sort(),['archiveDigest','generation','restoreId','targetProjectRef']);
        assert.equal(log.metadata_only,true);for(const key of ['retry_allowed','resume_allowed','rerun_import_allowed'])assert.equal(log[key],false);
        assert.equal(log.outcome,'UNKNOWN');assert.equal(log.retry_safe,false);assert.equal(log.code,code);
        assert.equal(Object.hasOwn(log,'original_status_request_missing_prerequisites'),false);
        assert.ok(!JSON.stringify(log).includes('SYNTHETIC_PRIVATE_DETAIL'));
      }
    });
    await run('ORIGINAL_STATUS_HANDOFF_NEW malformed current binding never emits a reader request',async()=>{
      // Reuse the existing exact shipping catch/finally function with recording
      // ports only; no CLI entrypoint, status reader or actual SQL is invoked.
      const valid={restoreId:original.restoreId,generation:7,archiveDigest:original.archiveDigest,projectRef:'abcdefghijklmnopqrst'};
      for(const change of [
        {restoreId:'invalid'}, {restoreId:'AAAAAAAA-2222-4333-8444-555555555555'}, {restoreId:original.restoreId+'\n'},
        {generation:0}, {generation:-1}, {generation:1.5}, {generation:NaN}, {generation:Infinity}, {generation:{}},
        {generation:'01'}, {generation:'7\n'}, {generation:'+7'}, {generation:'7.0'}, {generation:'9223372036854775808'},
        {archiveDigest:'A'.repeat(64)}, {archiveDigest:original.archiveDigest+'\n'}, {archiveDigest:null},
        {projectRef:'ABCDEFGHIJKLMNOPQRST'}, {projectRef:'abcdefghijklmnopqrst\n'}, {projectRef:''},
      ]){
        const tuple={...valid,...change},logs=[],cleanup=[];
        const error=Object.assign(new Error('SYNTHETIC_UNKNOWN'),{code:'IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN',outcome:'UNKNOWN',retry_safe:false});
        await assert.rejects(()=>settle(error,false,tuple.restoreId,tuple.generation,tuple.archiveDigest,tuple.projectRef,'restore_database_original_mixed',null,true,
          async()=>assert.fail('No failure-state write'),async()=>assert.fail('No failure event'),
          {query:async()=>cleanup.push('unlock'),end:async()=>cleanup.push('end')},{error:line=>logs.push(JSON.parse(line))}),e=>e===error);
        assert.equal(logs.length,1);assert.equal(Object.hasOwn(logs[0],'original_status_request'),false);
        assert.deepEqual(cleanup,['unlock','unlock','end']);
      }
      for(const generation of ['7','9223372036854775807']){
        const logs=[],error=Object.assign(new Error('SYNTHETIC_UNKNOWN'),{code:'IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN',outcome:'UNKNOWN',retry_safe:false});
        await assert.rejects(()=>settle(error,false,valid.restoreId,generation,valid.archiveDigest,valid.projectRef,'restore_database_original_mixed',null,false,
          async()=>assert.fail('No failure-state write'),async()=>assert.fail('No failure event'),{query:async()=>{},end:async()=>{}},{error:line=>logs.push(JSON.parse(line))}),e=>e===error);
        assert.equal(logs[0].original_status_request.generation,generation,'Already canonical generation text is preserved');
      }
    });
    await run('ORIGINAL_STATUS_HANDOFF_NEW prior read request reports missing archive and project without planned substitution',async()=>{
      const prior=Object.freeze({restore_id:'66666666-7777-4888-8999-aaaaaaaaaaaa',authority_generation:'6'});
      const error=Object.assign(new Error('SYNTHETIC_PRIVATE_HISTORY'),{code:'RESTORE_RETRY_RECONCILIATION_REQUIRED',outcome:'UNKNOWN',retry_safe:false,
        requested_original_restore:prior,archive_digest:'b'.repeat(64),target_project_ref:'different'});
      const {log,writes}=await invoke(error,false);assert.deepEqual(writes,[]);assert.deepEqual(log.requested_original_restore,prior);
      assert.equal(Object.hasOwn(log,'original_status_request'),false);
      assert.deepEqual(log.original_status_request_missing_prerequisites,['archiveDigest','targetProjectRef']);
      for(const key of ['restore_id','authority_generation','archive_digest','target_project_ref'])assert.equal(Object.hasOwn(log,key),false);
      for(const key of ['retry_allowed','resume_allowed','rerun_import_allowed'])assert.equal(log[key],false);
      const absent=await invoke(Object.assign(new Error('SYNTHETIC_UNKNOWN'),{code:error.code,outcome:'UNKNOWN',retry_safe:false}),false);
      assert.equal(Object.hasOwn(absent.log,'requested_original_restore'),false);assert.equal(Object.hasOwn(absent.log,'original_status_request'),false);
      assert.deepEqual(absent.log.original_status_request_missing_prerequisites,['restoreId','generation','archiveDigest','targetProjectRef']);
    });
    await run('ORIGINAL_STATUS_HANDOFF_NEW generic unknown and known errors cannot acquire a status handoff',async()=>{
      for(const error of [Object.assign(new Error('SYNTHETIC_PRIVATE_DETAIL'),{outcome:'UNKNOWN',retry_safe:false,code:'OTHER_UNKNOWN',
        restore_id:original.restoreId,authority_generation:'7',archive_digest:original.archiveDigest,target_project_ref:'abcdefghijklmnopqrst'}),
        Object.assign(new Error('Known failure'),{code:'IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN'})]){
        const {log}=await invoke(error,false);
        for(const key of ['original_status_request','original_status_request_missing_prerequisites','metadata_only','retry_allowed','resume_allowed','rerun_import_allowed'])assert.equal(Object.hasOwn(log,key),false);
      }
    });
    const {refuseUnreconciledImmutableRetry:guard}=await import('./disaster-recovery-state.mjs');
    assert.equal(typeof guard,'function','Actual sealed retry guard required');
    const issuerText=readFileSync(new URL('./create-production-restore-intent.mjs',import.meta.url),'utf8');
    const allowedRow=()=>({control_count:1,matching_control_count:1,manifest_count:1,matching_manifest_count:1,event_count:1,
      failure_recorded:true,conflicting_events:false,unresolved_events:false,private_data_verified:false,contradictory_evidence:false});
    const denied=error=>error.code==='RESTORE_RETRY_RECONCILIATION_REQUIRED'&&error.outcome==='UNKNOWN'&&error.retry_safe===false;
    const port=(reply=()=>({rowCount:1,rows:[allowedRow()]}))=>{const calls=[];return {calls,db:{query:async(sql,args)=>{
      calls.push({sql,args});return reply(sql,args);
    }}};};
    // Assert outside the guard's catch: a fixture assertion must never be
    // swallowed and counted as its expected history-unavailable refusal.
    const readOnly=({calls})=>{assert.equal(calls.length,1);const {sql,args}=calls[0];
      assert.ok(/^\s*with original_control as/.test(sql),'One fixed history query only');
      assert.deepEqual(args,[original.restoreId,'7']);assert.ok(!/\b(insert|update|delete|truncate|grant|revoke|set\s+role)\b/i.test(sql));};
    await run('UNKNOWN_COMMIT_NEW unknown and committed-private history flags refuse without any write',async()=>{
      for(const flag of ['unresolved_events','private_data_verified']){
        const x=port(()=>({rowCount:1,rows:[{...allowedRow(),[flag]:true}]}));
        await assert.rejects(()=>guard(x.db,{restoreId:original.restoreId,generation:'7'}),denied);readOnly(x);
        const sql=x.calls[0].sql;
        assert.ok(sql.includes("outcome='UNKNOWN' or evidence_json->>'outcome'='UNKNOWN'"));
        assert.ok(sql.includes("evidence_json->'retry_safe'='false'::jsonb"));
        assert.ok(sql.includes("database_verified=true and database_evidence ? 'original_data_import'"));
        assert.ok(!/\blimit\b/i.test(sql),'Later/last events cannot hide the earlier history in this fixed query');
      }
    });
    await run('UNKNOWN_COMMIT_NEW missing foreign contradictory malformed and unavailable history all refuse',async()=>{
      for(const change of [{control_count:0},{control_count:2},{matching_control_count:0},{manifest_count:0},{matching_manifest_count:0},
        {event_count:0},{failure_recorded:false},{conflicting_events:true},{contradictory_evidence:true},
        {control_count:'1'},{unresolved_events:'false'},{private_data_verified:null},{extra:false}]){
        const x=port(()=>({rowCount:1,rows:[{...allowedRow(),...change}]}));
        await assert.rejects(()=>guard(x.db,{restoreId:original.restoreId,generation:7}),denied);readOnly(x);
      }
      for(const reply of [{rowCount:0,rows:[]},{rowCount:1,rows:[]},{rowCount:1,rows:[{}]},{rowCount:2,rows:[allowedRow(),allowedRow()]}]){
        const x=port(()=>reply);await assert.rejects(()=>guard(x.db,{restoreId:original.restoreId,generation:7}),denied);readOnly(x);
      }
      const unavailable=port(()=>{throw Object.assign(new Error('SYNTHETIC_PRIVATE_HISTORY_ERROR'),{code:'08006'});});
      await assert.rejects(()=>guard(unavailable.db,{restoreId:original.restoreId,generation:7}),error=>denied(error)&&!error.message.includes('SYNTHETIC_PRIVATE'));
      readOnly(unavailable);
    });
    await run('UNKNOWN_COMMIT_NEW known legacy and nonprivate failed readback returns no admission value',async()=>{
      for(const event_count of [1,4])for(const generation of [7,'7']){
        const row=Object.freeze({...allowedRow(),event_count}),x=port(()=>({rowCount:1,rows:[row]}));
        assert.equal(await guard(x.db,{restoreId:original.restoreId,generation}),undefined);readOnly(x);
        assert.deepEqual(row,{...allowedRow(),event_count});
      }
    });
    await run('UNKNOWN_COMMIT_NEW both retry-only callsites precede signing pause and effects',async()=>{
      for(const [text,object,after,boundary]of [[issuerText,'controlState','  const leases =','restore_id: randomUUID()'],
        [applyText,'previousControl','  const preflightTargetIdentity =','restorePhase = "pause_admission"']]){
        const call='await refuseUnreconciledImmutableRetry(db, { restoreId: '+object+'.restore_id, generation: '+object+'.authority_generation });';
        const at=text.indexOf(call);assert.ok(at>0&&at<text.indexOf(boundary));assert.equal(text.split(call).length,2);
        const blockStart=text.lastIndexOf('  if (retryFailure) {',at),blockEnd=text.indexOf(after,at);
        assert.ok(blockStart>=0&&blockEnd>at);const block=text.slice(blockStart,blockEnd);
        const retryBranch=new AsyncFunction('retryFailure','refuseUnreconciledImmutableRetry','db','controlState','previousControl',block);
        for(const retry of [false,true]){
          const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});
            if(sql.includes('original_control as'))return {rowCount:1,rows:[{...allowedRow(),unresolved_events:true}]};
            throw new Error('Guard must refuse before subsequent lease read or effect');}};
          const control={restore_id:original.restoreId,authority_generation:'7'};
          if(retry)await assert.rejects(()=>retryBranch(true,guard,db,control,control),denied);
          else await retryBranch(false,guard,db,control,control);
          assert.equal(calls.length,retry?1:0);
          if(retry)readOnly({calls});
        }
      }
      assert.ok(issuerText.indexOf('await refuseUnreconciledImmutableRetry')<issuerText.indexOf('signature: signBinding('));
    });
    await run('UNKNOWN_COMMIT_NEW private unsupported hold remains before client creation and connection',async()=>{
      const hold=applyText.indexOf('if (privateImportBlocker !== null) {'),client=applyText.indexOf('const db = new Client('),connect=applyText.indexOf('await db.connect();',client);
      assert.ok(hold>=0&&client>hold&&connect>client);
      const end=applyText.indexOf('\n}',hold);assert.ok(end>hold);
      assert.ok(applyText.slice(hold,end).includes('failure.code = privateImportBlocker;'));
      assert.ok(applyText.slice(hold,end).includes('throw failure;'));
    });
    await run('UNKNOWN_COMMIT_JOIN prior retry refusal retains requested prior identity without planned tuple',async()=>{
      const prior={restoreId:'66666666-7777-4888-8999-aaaaaaaaaaaa',generation:'6'},calls=[];
      let refusal;
      try{await guard({query:async(sql,args)=>{calls.push({sql,args});return {rowCount:1,rows:[{...allowedRow(),unresolved_events:true}]};}},prior);}
      catch(error){refusal=error;}
      assert.ok(denied(refusal));assert.equal(calls.length,1);assert.deepEqual(calls[0].args,[prior.restoreId,prior.generation]);
      assert.ok(Object.isFrozen(refusal.requested_original_restore));
      assert.deepEqual(refusal.requested_original_restore,{restore_id:prior.restoreId,authority_generation:prior.generation});
      const {writes,log}=await invoke(refusal,false);assert.deepEqual(writes,[]);
      assert.equal(log.code,'RESTORE_RETRY_RECONCILIATION_REQUIRED');assert.equal(log.outcome,'UNKNOWN');assert.equal(log.retry_safe,false);
      assert.deepEqual(log.requested_original_restore,refusal.requested_original_restore);
      for(const key of ['restore_id','authority_generation','archive_digest','target_project_ref'])assert.equal(Object.hasOwn(log,key),false);
      let invalid;
      try{await guard({query:async()=>assert.fail('Invalid original input must not query')},{restoreId:'invalid',generation:'6'});}catch(error){invalid=error;}
      assert.ok(denied(invalid));assert.equal(Object.hasOwn(invalid,'requested_original_restore'),false);
      const absent=await invoke(invalid,false);assert.deepEqual(absent.writes,[]);assert.equal(Object.hasOwn(absent.log,'requested_original_restore'),false);
      for(const key of ['restore_id','authority_generation','archive_digest','target_project_ref'])assert.equal(Object.hasOwn(absent.log,key),false);
      let getterCalls=0;
      const accessor=Object.freeze({get restore_id(){getterCalls++;return prior.restoreId;},authority_generation:prior.generation});
      for(const pointer of [{restore_id:prior.restoreId,authority_generation:prior.generation},
        Object.freeze({restore_id:prior.restoreId,authority_generation:prior.generation,extra:true}),accessor]){
        const error=Object.assign(new Error('SYNTHETIC_PRIVATE_DETAIL'),{code:'RESTORE_RETRY_RECONCILIATION_REQUIRED',outcome:'UNKNOWN',retry_safe:false,requested_original_restore:pointer});
        const result=await invoke(error,false);assert.deepEqual(result.writes,[]);assert.equal(Object.hasOwn(result.log,'requested_original_restore'),false);
        for(const key of ['restore_id','authority_generation','archive_digest','target_project_ref'])assert.equal(Object.hasOwn(result.log,key),false);
      }
      assert.equal(getterCalls,0,'Inspecting a requested pointer must not invoke its getter');
    });
    assert.ok(cases.length>0,'Unknown/empty UNKNOWN commit case selector');
    await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(unhandled,[]);
    console.log(JSON.stringify({selector:handoffOnly?'--original-status-failure-handoff-only':'--immutable-unknown-commit-source-only',count:cases.length,cases,
      status:'PASS_NEW_UNKNOWN_RETRY_SOURCE_RECORDING_ONLY',actual_SQL:'NOT_RUN',
      limits:'Actual sealed Source and recording query/catch ports only. No target/auth/signature/pg.Client/transaction, reconciliation, DATA restore or retry authority proof.',resources:{SQL_connections:0,JVMs:0,listeners:0}}));
  }finally{process.off('unhandledRejection',observe);assert.deepEqual(unhandled,[]);}
  process.exit(0);
}

// Newly affected shipping table loop with the ACTUAL private DATA reader.
// Query capture is synthetic: this is not a restore/SQL transaction proof.
if (process.argv.includes('--normal-data-consumer-join-only')) {
  const {createHash}=await import('node:crypto');
  const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {pipeline}=await import('node:stream/promises');const {createInterface}=await import('node:readline');
  const {materializeVerifiedArchive,readVerifiedArchiveSourceBinding,openVerifiedRestoreTableData,
    decodeRestoreTableRowLine,createRestoreRowUtf8Guard,postgresJsonTextLineEncoding}=await import('./disaster-recovery-archive.mjs');
  const {archiveSignatureBinding,signBinding}=await import('./disaster-recovery-crypto.mjs');
  const sourceText=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
  const start=sourceText.indexOf('  await db.query("begin");\n  let unvalidatedCheckEvidence');
  const end=sourceText.indexOf('\n  await setControl("DATABASE_RESTORED")',start);
  assert.ok(start>0 && end>start);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const consume=new AsyncFunction('db','databaseTables','verifiedArchive','openVerifiedRestoreTableData',
    'createRestoreRowUtf8Guard','pipeline','createInterface','decodeRestoreTableRowLine','requireOriginalArchiveSource',
    'suspendUnvalidatedRestoreChecks','reinstateUnvalidatedRestoreChecks',
    'let restorePhase,restoreTable;const quoteIdentifier=x=>`"${String(x).replaceAll(\'"\',\'""\')}"`;const qualified=(s,t)=>quoteIdentifier(s)+"."+quoteIdentifier(t);const restoreCheckEvidence=()=>({});\n'+sourceText.slice(start,end));
  const root=mkdtempSync(join(tmpdir(),'normal-data-consumer-join-'));
  const hash=x=>createHash('sha256').update(x).digest('hex'),key='disaster-recovery-archive-materialization-test-key-0001',keyId='archive-materialization-test-v1';
  const raw='{"id":9223372036854775807,"value":{"integer":9007199254740993,"text":"'+ 'café🐾'.repeat(14000)+'\\noriginal"}}';
  const cases=[],unhandled=[];const observe=error=>unhandled.push(error);process.on('unhandledRejection',observe);
  try {
    for (const kind of ['exact_multi_chunk','empty_original','query_failure','source_closed_during_insert','invalid_original_UTF8','signed_row_count_mismatch']) {
      const directory=join(root,kind);mkdirSync(join(directory,'inventory'),{recursive:true,mode:0o700});mkdirSync(join(directory,'database'),{mode:0o700});
      const data=kind==='empty_original'||kind==='signed_row_count_mismatch'?Buffer.alloc(0):kind==='invalid_original_UTF8'?Buffer.from([0xc3,0x28,0x0a]):Buffer.from(JSON.stringify(raw)+'\n');
      const rowCount=kind==='empty_original'?0:1;
      const catalog=['public','auth','storage'].map(schema_name=>({schema_name,table_name:'records',primary_key:['id'],
        columns:[{name:'id',generated:'',identity:'',data_type:'bigint'},{name:'value',generated:'',identity:'',data_type:'json'}],
        row_count:String(schema_name==='public'?rowCount:0),data_file:`database/${schema_name}.records.jsonl`,data_encoding:postgresJsonTextLineEncoding}));
      const catalogBytes=Buffer.from(JSON.stringify(catalog)+'\n');
      const summary={ok:true,format:'memphis-zoo-disaster-recovery.v4',consistent_database_snapshot:true,project_ref:'abcdefghijklmnopqrst',
        source_identity:{database_catalog_sha256:hash(catalogBytes)},backed_up_schemas:['public','auth','storage'],table_count:3,database_row_count:rowCount};
      const entries=[['backup-summary.json',Buffer.from(JSON.stringify(summary)+'\n')],['inventory/table-catalog.json',catalogBytes],
        ['database/public.records.jsonl',data],['database/auth.records.jsonl',Buffer.alloc(0)],['database/storage.records.jsonl',Buffer.alloc(0)]];
      for(const [path,bytes]of entries)writeFileSync(join(directory,path),bytes,{mode:0o600});
      const sums=entries.map(([path,bytes])=>hash(bytes)+'  '+path).join('\n')+'\n';writeFileSync(join(directory,'SHA256SUMS'),sums,{mode:0o600});
      const digest=hash(sums);writeFileSync(join(directory,'archive-signature.json'),JSON.stringify({format:'memphis-zoo-disaster-recovery-signature.v1',algorithm:'hmac-sha256',
        key_id:keyId,archive_digest:digest,signature:signBinding(archiveSignatureBinding({archiveDigest:digest,projectRef:summary.project_ref,sourceIdentity:summary.source_identity,archiveFormat:summary.format}),key)}),{mode:0o600});
      const archive=materializeVerifiedArchive({sourceDir:directory,archiveVerifyKey:key,archiveVerifyKeyId:keyId});
      const binding=readVerifiedArchiveSourceBinding(archive),readers=[],calls=[],parameters=[];
      const queryFailure=new Error('synthetic target query failure');let failure=null;
      const open=(...args)=>{const reader=openVerifiedRestoreTableData(...args);readers.push(reader);return reader;};
      const current=()=>{assert.equal(readVerifiedArchiveSourceBinding(archive),binding);};
      const db={query:async(sql,args)=>{calls.push(sql);if(sql.startsWith('insert into')){
        parameters.push(args[0]);if(kind==='query_failure')throw queryFailure;
        if(kind==='source_closed_during_insert')archive.cleanup();await new Promise(resolve=>setImmediate(resolve));
      }if(sql==='commit'){for(const reader of readers){await reader.verified;assert.ok(reader.stream.closed);}current();}}};
      try {
        try{await consume(db,[catalog[0]],archive,open,createRestoreRowUtf8Guard,pipeline,createInterface,decodeRestoreTableRowLine,current,async()=>[],async()=>({}));}
        catch(error){failure=error;}
        if(kind==='exact_multi_chunk'||kind==='empty_original') {
          assert.equal(failure,null);assert.deepEqual(parameters,kind==='empty_original'?[]:[raw]);
          assert.equal(calls.filter(x=>x==='commit').length,1);assert.equal(calls.includes('rollback'),false);
        }else{
          assert.ok(failure);assert.equal(calls.includes('commit'),false);assert.equal(calls.at(-1),'rollback');
          if(kind==='query_failure')assert.equal(failure,queryFailure);
          if(kind==='source_closed_during_insert')assert.deepEqual(parameters,[raw]);
          if(kind==='invalid_original_UTF8')assert.deepEqual(parameters,[]);
        }
        for(const reader of readers){await reader.close();assert.ok(reader.stream.destroyed&&reader.stream.closed);}
        cases.push({case:kind,status:'PASS',query_target:'SYNTHETIC_CAPTURE_ONLY'});
      }finally{for(const reader of readers)await reader.close();archive.cleanup();assert.equal(existsSync(archive.directory),false);}
    }
    await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(unhandled,[]);
  } finally {process.off('unhandledRejection',observe);rmSync(root,{recursive:true,force:true});assert.equal(existsSync(root),false);}
  console.log(JSON.stringify({scope:'NEW_ACTUAL_PRIVATE_DATA_READER_THROUGH_SHIPPING_CONSUMER_SOURCE',cases,count:cases.length,
    limits:'Exact shipping table loop/current commit fence, actual materializer/no-follow reader/UTF8/raw decoder/pipeline/FD cleanup; synthetic unit HMAC and query capture. No actual SQL transaction, signed restore intent, private import or target effects. Literal OS close/COMMIT/ROLLBACK loss not injected.'}));
  process.exit(0);
}

// Newly affected normal-v1 SOURCE wiring only. No issuer/apply entrypoint,
// database, genuine key, target, initialization or old contract suite runs.
if (process.argv.includes('--normal-source-binding-wiring-only') || process.argv.includes('--normal-source-currentness-only') || process.argv.includes('--normal-source-commit-boundary-only')) {
  const currentnessOnly = process.argv.includes('--normal-source-currentness-only');
  const commitBoundaryOnly = process.argv.includes('--normal-source-commit-boundary-only');
  const {createHash}=await import('node:crypto');
  const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {materializeVerifiedArchive,readVerifiedArchiveSourceBinding}=await import('./disaster-recovery-archive.mjs');
  const {archiveSignatureBinding,signBinding,stableJson}=await import('./disaster-recovery-crypto.mjs');
  const work=mkdtempSync(join(tmpdir(),'normal-v1-source-wiring-'));
  const snapshots=[],cases=[],hash=value=>createHash('sha256').update(value).digest('hex');
  const key='disaster-recovery-archive-materialization-test-key-0001',keyId='archive-materialization-test-v1';
  const summary={ok:true,format:'memphis-zoo-disaster-recovery.v4',consistent_database_snapshot:true,
    project_ref:'abcdefghijklmnopqrst',source_identity:{release:{release_id:'synthetic-source-only'},marker:'original'}};
  try {
    const source=join(work,'source');mkdirSync(source,{mode:0o700});
    const bytes=JSON.stringify(summary)+'\n';writeFileSync(join(source,'backup-summary.json'),bytes,{mode:0o600});
    const sums=hash(bytes)+'  backup-summary.json\n';writeFileSync(join(source,'SHA256SUMS'),sums,{mode:0o600});
    const digest=hash(sums);writeFileSync(join(source,'archive-signature.json'),JSON.stringify({
      format:'memphis-zoo-disaster-recovery-signature.v1',algorithm:'hmac-sha256',key_id:keyId,archive_digest:digest,
      signature:signBinding(archiveSignatureBinding({archiveDigest:digest,projectRef:summary.project_ref,
        sourceIdentity:summary.source_identity,archiveFormat:summary.format}),key)}),{mode:0o600});
    const archive=materializeVerifiedArchive({sourceDir:source,archiveVerifyKey:key,archiveVerifyKeyId:keyId});snapshots.push(archive);
    // Run the exact shipping caller binding statements, not a copied exporter.
    const bindingFor=filename=>{
      const text=readFileSync(new URL('./'+filename,import.meta.url),'utf8');
      const first=text.indexOf('const sourceBinding = readVerifiedArchiveSourceBinding(verifiedArchive);');
      const last=text.indexOf('const archiveDigest = sourceBinding.archive_digest;',first);
      assert.ok(first>=0&&last>first,'Normal caller must consume private authenticated source binding');
      const code=text.slice(first,last+'const archiveDigest = sourceBinding.archive_digest;'.length);
      return new Function('readVerifiedArchiveSourceBinding','verifiedArchive',code+'return {sourceBinding,summary,archiveDigest};');
    };
    const issuer=bindingFor('create-production-restore-intent.mjs'),apply=bindingFor('production-restore.mjs');
    if (commitBoundaryOnly) {
      const text=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
      const first=text.indexOf('const sourceBinding = readVerifiedArchiveSourceBinding(verifiedArchive);');
      const functionEnd=text.indexOf('\n}',text.indexOf('function requireOriginalArchiveSource()',first))+2;
      const make=new Function('readVerifiedArchiveSourceBinding','verifiedArchive',text.slice(first,functionEnd)+'return requireOriginalArchiveSource;');
      const start=text.indexOf('    restoreTable = null;\n    restorePhase = "reinstate_unvalidated_restore_checks";');
      const end=text.indexOf('\n  await setControl("DATABASE_RESTORED")',start);
      assert.ok(start>0 && end>start);
      const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
      const settle=new AsyncFunction('db','reinstateUnvalidatedRestoreChecks','requireOriginalArchiveSource',
        'let restoreTable,restorePhase,unvalidatedCheckEvidence;const suspendedChecks=[];try {\n'+text.slice(start,end));
      for (const invalidate of [false,true]) {
        const originalArchive=materializeVerifiedArchive({sourceDir:source,archiveVerifyKey:key,archiveVerifyKeyId:keyId});
        snapshots.push(originalArchive);const requireCurrent=make(readVerifiedArchiveSourceBinding,originalArchive);
        const calls=[];const db={query:async sql=>{calls.push(sql);}};
        const reinstate=async client=>{assert.equal(client,db);if(invalidate)originalArchive.cleanup();return {};};
        if(invalidate) {
          await assert.rejects(settle(db,reinstate,requireCurrent));
          assert.deepEqual(calls,['rollback']);
        } else {
          await settle(db,reinstate,requireCurrent);assert.deepEqual(calls,['commit']);
        }
        cases.push({case:invalidate?'closed_original_after_constraints_refuses_commit':'same_original_after_constraints_allows_source_commit_boundary',status:'PASS'});
      }
    } else if (currentnessOnly) {
      for (const filename of ['create-production-restore-intent.mjs','production-restore.mjs']) {
        const originalArchive=materializeVerifiedArchive({sourceDir:source,archiveVerifyKey:key,archiveVerifyKeyId:keyId});
        snapshots.push(originalArchive);
        const text=readFileSync(new URL('./'+filename,import.meta.url),'utf8');
        const first=text.indexOf('const sourceBinding = readVerifiedArchiveSourceBinding(verifiedArchive);');
        const functionEnd=text.indexOf('\n}',text.indexOf('function requireOriginalArchiveSource()',first))+2;
        assert.ok(first>=0 && functionEnd>first);
        const make=new Function('readVerifiedArchiveSourceBinding','verifiedArchive',text.slice(first,functionEnd)+'return requireOriginalArchiveSource;');
        const requireCurrent=make(readVerifiedArchiveSourceBinding,originalArchive);
        requireCurrent();
        const path=join(originalArchive.directory,'backup-summary.json');
        const original=readFileSync(path);
        // The private copied snapshot is intentionally read-only. Retain the
        // original denied setup attempt; do not chmod/bypass it to claim a
        // successful changed-file scenario at this caller layer.
        assert.throws(()=>writeFileSync(path,'changed copied original source'),error=>error.code==='EACCES');
        assert.deepEqual(readFileSync(path),original);requireCurrent();
        originalArchive.cleanup();assert.throws(requireCurrent);
        cases.push(filename+' exact source boundary retains read-only controls and refuses cleaned original receipt');
      }
      const text=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
      assert.ok(text.includes('requireOriginalArchiveSource();\n  restorePhase = "pause_admission";'));
      assert.ok(text.includes('requireOriginalArchiveSource();\n  restorePhase = "restore_database";'));
      process.exitCode=0;
    } else {
    archive.summary.project_ref='unsigned-public-replacement';archive.summary.source_identity.marker='foreign';archive.archiveDigest='0'.repeat(64);
    for(const [name,reader]of [['issuer',issuer],['apply',apply]]){
      const value=reader(readVerifiedArchiveSourceBinding,archive);
      assert.deepEqual(value.summary,summary);assert.equal(value.archiveDigest,digest);
      assert.equal(value.sourceBinding.source_identity_sha256,hash(stableJson(summary.source_identity)));
      assert.ok(Object.isFrozen(value.summary)&&Object.isFrozen(value.summary.source_identity));
      assert.throws(()=>reader(readVerifiedArchiveSourceBinding,{...archive}));
      cases.push(name+' actual shipping binding retains original private source and refuses copied receipt');
    }
    archive.cleanup();
    assert.throws(()=>issuer(readVerifiedArchiveSourceBinding,archive));assert.throws(()=>apply(readVerifiedArchiveSourceBinding,archive));
    cases.push('both normal callers refuse closed original source before source facts escape');
    const applyText=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
    const issuerText=readFileSync(new URL('./create-production-restore-intent.mjs',import.meta.url),'utf8');
    assert.ok(applyText.indexOf('sourceBinding = readVerifiedArchiveSourceBinding')<applyText.indexOf('const db = new Client('));
    assert.ok(issuerText.indexOf('sourceBinding = readVerifiedArchiveSourceBinding')<issuerText.indexOf('const db = new Client('));
    assert.ok(applyText.includes('PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'));
    assert.ok(issuerText.includes('key === archiveVerifyKey'));
    cases.push('new source wiring precedes normal target connection without lifting independent signer/private import boundaries');
    }
  } finally {
    for(const archive of snapshots)archive.cleanup();
    rmSync(work,{recursive:true,force:true});assert.equal(existsSync(work),false);
    for(const archive of snapshots)assert.equal(existsSync(archive.directory),false);
  }
  console.log(JSON.stringify({scope:commitBoundaryOnly?'NEW_SOURCE_BEFORE_DATABASE_COMMIT_BOUNDARY_ONLY':currentnessOnly?'NEW_SOURCE_BOUNDARY_CURRENTNESS_ONLY':'NEW_NORMAL_V1_SOURCE_BINDING_STATEMENTS_ONLY',cases,count:cases.length,
    limits:'Actual source exporter/materializer and exact caller statements with synthetic unit HMAC/local files only; read-only mutation denied, not changed-file qualification; no issuer/apply execution, database, approved keys, signer/target/init/production authority.'}));
  process.exit(0);
}

const commit = "a".repeat(40);
const projectRef = "abcdefghijklmnopqrst";
const contract = loadRecoveryRuntimeContract(new URL("../release/disaster-recovery-runtime-contract.json", import.meta.url));
const releaseIdentity = { release_id: "release-1", backend_commit: commit, frontend_commit: "b".repeat(40), migration_head: "20260827151000" };
const environment = (name) => Object.fromEntries(Object.entries(contract.services[name].required_non_secret_environment).map(([key, value]) => [
  key,
  value === "$SUPABASE_PROJECT_URL" ? `https://${projectRef}.supabase.co` : value,
]));
const service = (name) => ({
  service_id: `srv-${name}`,
  deployment_id: `dep-${name}`,
  deployment_commit: commit,
  public_url: `https://${name}.example.test`,
  build_command: contract.services[name].build_command,
  start_command: contract.services[name].start_command,
  liveness_path: contract.services[name].liveness_path,
  readiness_path: contract.services[name].readiness_path,
  non_secret_environment: environment(name),
  required_secret_presence: Object.fromEntries(contract.services[name].required_secret_presence.map((key) => [key, true])),
});
const configuration = {
  format: "memphis-zoo.disaster-recovery-runtime-configuration.v1",
  project_ref: projectRef,
  release_id: releaseIdentity.release_id,
  backend_commit: commit,
  frontend_commit: releaseIdentity.frontend_commit,
  migration_head: releaseIdentity.migration_head,
  services: { backend: service("backend"), static_weekly_control_plane: service("static_weekly_control_plane") },
  dependencies: {
    supabase_project_ref: projectRef,
    backend_render_service_id: "srv-backend",
    static_weekly_render_service_id: "srv-static_weekly_control_plane",
    frontend_origin: "https://frontend.example.test",
    attendance_origin: "https://attendance.example.test",
  },
};
assert.deepEqual(validateRecoveryRuntimeConfiguration({ contract, configuration, releaseIdentity, projectRef }), configuration);
assert.deepEqual(validateRecoveryRuntimeConfiguration({ contract, configuration, releaseIdentity, projectRef }), configuration,
  "reviewed backup tooling is independently attributable and need not already be the deployed release");
assert.throws(() => validateRecoveryRuntimeConfiguration({ contract, configuration: { ...configuration, api_secret: "do-not-archive" }, releaseIdentity, projectRef }), /must contain exactly/);
assert.throws(() => validateRecoveryRuntimeConfiguration({
  contract,
  configuration: {
    ...configuration,
    services: {
      ...configuration.services,
      backend: {
        ...configuration.services.backend,
        required_secret_presence: {
          ...configuration.services.backend.required_secret_presence,
          EXTRA_DATABASE_PASSWORD: "plaintext-archive-leak",
        },
      },
    },
  },
  releaseIdentity,
  projectRef,
}), /must contain exactly/);
assert.throws(() => validateRecoveryRuntimeConfiguration({
  contract,
  configuration: {
    ...configuration,
    services: {
      ...configuration.services,
      static_weekly_control_plane: {
        ...configuration.services.static_weekly_control_plane,
        non_secret_environment: {
          ...configuration.services.static_weekly_control_plane.non_secret_environment,
          SUPABASE_URL: undefined,
        },
      },
    },
  },
  releaseIdentity,
  projectRef,
}), /SUPABASE_URL is missing or differs/);
assert.throws(() => validateRecoveryRuntimeConfiguration({ contract, configuration: { ...configuration, services: { ...configuration.services, backend: { ...configuration.services.backend, deployment_commit: "c".repeat(40) } } }, releaseIdentity, projectRef }), /exact live release commit/);
const staticCommit = "c".repeat(40);
const splitConfiguration = { ...configuration, services: {
  ...configuration.services,
  static_weekly_control_plane: { ...configuration.services.static_weekly_control_plane, deployment_commit: staticCommit },
} };
const recordedServiceIdentity = Object.fromEntries(Object.entries(splitConfiguration.services).map(([name, value]) => [
  name, Object.fromEntries(["service_id", "deployment_id", "deployment_commit", "public_url"]
    .map((field) => [field, value[field]])),
]));
const splitIdentity = { ...releaseIdentity, details_json: {
  static_render_commit: staticCommit,
  recovery_service_identity: recordedServiceIdentity,
} };
assert.deepEqual(validateRecoveryRuntimeConfiguration({ contract, configuration: splitConfiguration,
  releaseIdentity: splitIdentity, projectRef }), splitConfiguration,
"an independently deployed static control plane must match its complete recorded identity");
assert.throws(() => validateRecoveryRuntimeConfiguration({ contract, configuration: splitConfiguration,
  releaseIdentity, projectRef }), /exact live release commit/,
"a split deployment is not accepted without its recorded static commit");
assert.throws(() => validateRecoveryRuntimeConfiguration({ contract, configuration,
  releaseIdentity: splitIdentity, projectRef }), /exact live release commit/,
"the old static commit cannot be falsely substituted for the recorded one");
assert.throws(() => validateRecoveryRuntimeConfiguration({ contract, configuration: splitConfiguration,
  releaseIdentity: { ...releaseIdentity, details_json: { static_render_commit: "invalid" } }, projectRef }),
  /Recorded static control-plane commit is malformed/);
assert.throws(() => validateRecoveryRuntimeConfiguration({ contract, configuration: splitConfiguration,
  releaseIdentity: { ...releaseIdentity, details_json: { static_render_commit: staticCommit } }, projectRef }),
  /no recorded recovery service identity/);
for (const value of [null, false, 0, {}, [], "", " "]) {
  assert.throws(() => validateRecoveryRuntimeConfiguration({ contract, configuration,
    releaseIdentity: { ...releaseIdentity, details_json: { static_render_commit: value } }, projectRef }),
  /Recorded static control-plane commit is malformed/);
}
for (const field of ["deployment_id", "public_url", "service_id"]) {
  const changed = structuredClone(splitConfiguration);
  changed.services.static_weekly_control_plane[field] = field === "public_url"
    ? "https://forged-static.example.test" : `forged-${field}`;
  if (field === "service_id") changed.dependencies.static_weekly_render_service_id =
    changed.services.static_weekly_control_plane.service_id;
  assert.throws(() => validateRecoveryRuntimeConfiguration({ contract, configuration: changed,
    releaseIdentity: splitIdentity, projectRef }), /differs from the recorded recovery service identity/);
}
const changedBackendDeployment = structuredClone(splitConfiguration);
changedBackendDeployment.services.backend.deployment_id = "dep-forged-backend";
assert.throws(() => validateRecoveryRuntimeConfiguration({ contract, configuration: changedBackendDeployment,
  releaseIdentity: splitIdentity, projectRef }), /differs from the recorded recovery service identity/);
const changedRecordedIdentity = structuredClone(splitIdentity);
changedRecordedIdentity.details_json.recovery_service_identity.static_weekly_control_plane.deployment_id =
  "dep-forged-static";
assert.throws(() => validateRecoveryRuntimeConfiguration({ contract, configuration: splitConfiguration,
  releaseIdentity: changedRecordedIdentity, projectRef }), /differs from the recorded recovery service identity/);
console.log("DISASTER_RECOVERY_RUNTIME_CONTRACT_TESTS_PASS");
