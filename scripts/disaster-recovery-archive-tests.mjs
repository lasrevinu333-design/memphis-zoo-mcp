#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import { materializeVerifiedArchive, restoreArchiveAdmission, selectVerifiedRestoreTables,
  decodeRestoreTableRowLine, postgresJsonTextLineEncoding, createRestoreRowUtf8Guard } from "./disaster-recovery-archive.mjs";
import { archiveSignatureBinding, signBinding, stableJson } from "./disaster-recovery-crypto.mjs";

// Actual disposable PostgreSQL + actual owning CLI. UNIT archive/intent keys,
// populated native rows, normal restore control/fences; no production reads.
if(process.argv.includes('--ordinary-native-text-owner-sql')){
 const {default:pg}=await import('pg'),{randomUUID}=await import('node:crypto');
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
 const execute=promisify(execFile),{stableJsonFile}=await import('./disaster-recovery-crypto.mjs');
 const wire=await import('./production-backup-pg-dump-command.mjs');
 const url=new URL(process.env.RESTORE_DRILL_DATABASE_URL||'invalid:');
 assert.ok(['postgres:','postgresql:'].includes(url.protocol)&&['127.0.0.1','localhost'].includes(url.hostname));
 const admin=new pg.Client({connectionString:String(url)});await admin.connect();
 const work=mkdtempSync(join(tmpdir(),'UNIT-native-text-owning-')),key='UNIT-native-text-original-archive-HMAC-20261021',keyId='UNIT-native-text-owner';
 const intentKey='UNIT-native-text-independent-intent-HMAC-20261021',project='abcdefghijklmnopqrst';
 let cases=0;
 await admin.query(readFileSync(new URL('../supabase/canonical/production-source-role-catalog.sql',import.meta.url),'utf8'));
 try{for(const scenario of ['positive','wrong-type','custom-enum-text-cast','external-FK','late-storage-mutation','lost-COMMIT']){
  const name='mz_schema_rebuild_unit_native_'+randomUUID().replaceAll('-',''),target=new URL(String(url));target.pathname='/'+name;
  const db=new pg.Client({connectionString:String(target)});let proxy,proxyFaults=0;const proxySockets=new Set();const archive=join(work,scenario);mkdirSync(join(archive,'inventory'),{recursive:true});mkdirSync(join(archive,'database'));
  try{
   await admin.query('create database '+pg.escapeIdentifier(name)+' owner postgres template template0');await db.connect();
   await db.query(`create schema auth;create schema storage;create schema custodial_release_identity;create schema cron;create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
    insert into supabase_migrations.schema_migrations values('20261021111917','UNIT_actual_native_owner',ARRAY[]::text[]);
    create table cron.job(jobid bigserial primary key,schedule text,command text,nodename text,nodeport integer,database text,username text,active boolean,jobname text);
    create type auth.unit_kind as enum('first','second');
    create table public.unit_records(id bigint generated always as identity primary key,precise numeric(30,10),json_value json,sql_null json,json_null json,
      native_array numeric[],moment timestamptz,bytes bytea,kind auth.unit_kind,period tstzrange,derived text generated always as (id::text) stored);
    insert into public.unit_records(id,precise,json_value,sql_null,json_null,native_array,moment,bytes,kind,period) overriding system value
      values(9007199254740993,12345678901234567890.1234567890,' {"n":9007199254740993,"n":2} ',null,'null',
      '[0:1]={9007199254740993.1234567890,NULL}'::numeric[],'2026-10-21 13:00:00.123456+00','\\x00ff','second','[2026-10-21 13:00:00.123456+00,2026-10-21 13:01:00.654321+00)');
    create table public.device_auth_credentials(id uuid,revoked_at timestamptz,revoked_reason text);
    create table public.device_auth_enrollment_codes(id uuid,revoked_at timestamptz);
    create table public.ops_manager_trusted_devices(id uuid,revoked_at timestamptz,revoked_reason text);
    create table public.ops_manager_enrollment_codes(id uuid,status text,revoked_at timestamptz,revoked_reason text);
    create table public.ops_manager_push_devices(id uuid,enabled boolean,revoked_at timestamptz);
    create table auth.sessions(id uuid);
    create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid,bucket_id text,name text);
    create table storage.unit_records(id bigint primary key,precise numeric,body json);
    insert into storage.unit_records values(9223372036854775807,123456789012345678901234567890.123456789,' {"storage":9007199254740993} ');
    create table public.release_deployment_manifest(release_id text primary key,backend_commit text not null,frontend_commit text not null,migration_head text not null,
      migration_manifest_sha256 text not null,environment_contract_version text not null,status text not null,details_json jsonb not null,created_at timestamptz not null,deployed_at timestamptz);
    insert into public.release_deployment_manifest values('UNIT_native_release',repeat('a',40),repeat('b',40),'20261021111917',repeat('c',64),'UNIT','deployed','{}',now(),now());`);
   await db.query(readFileSync(new URL('../supabase/migrations/20260820125325_custodial_disaster_restore_generation_authority.sql',import.meta.url),'utf8'));
   await db.query(readFileSync(new URL('../supabase/migrations/20260827150000_disaster_recovery_global_mutation_fence.sql',import.meta.url),'utf8'));
   const entries=new Map(),hash=b=>createHash('sha256').update(b).digest('hex');
   const emit=(path,value)=>{const b=Buffer.isBuffer(value)?value:Buffer.from(value);writeFileSync(join(archive,path),b,{mode:0o600});entries.set(path,b);return hash(b);};
   await db.query('begin isolation level repeatable read read only');
   for(const statement of ["set local search_path=pg_catalog","set local extra_float_digits=3","set local datestyle='ISO, YMD'","set local timezone='UTC'","set local intervalstyle='postgres'","set local bytea_output='hex'"])await db.query(statement);
   const tables=(await db.query(`select n.nspname schema_name,c.relname table_name,
    coalesce((select jsonb_agg(a.attname order by k.ordinality) from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum,ordinality)
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum where i.indrelid=c.oid and i.indisprimary),'[]'::jsonb) primary_key,
    (select jsonb_agg(jsonb_build_object('name',a.attname,'data_type',format_type(a.atttypid,a.atttypmod),'generated',a.attgenerated,'identity',a.attidentity) order by a.attnum)
      from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) columns
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and c.relkind='r' order by n.nspname,c.relname`)).rows;
   const quote=v=>pg.escapeIdentifier(v),literal=v=>"E'"+v.replaceAll('\\','\\\\').replaceAll("'","''")+"'";
   for(const table of tables){
    const projection=`json_object(ARRAY[${table.columns.map(c=>literal(c.name)).join(',')}]::text[],ARRAY[${table.columns.map(c=>'r.'+quote(c.name)+'::text').join(',')}]::text[])::text`;
    const rows=(await db.query('select '+projection+' raw from only '+quote(table.schema_name)+'.'+quote(table.table_name)+' r')).rows;
    table.row_count=String(rows.length);table.data_file='database/'+table.schema_name+'.'+table.table_name+'.jsonl';table.data_encoding=wire.productionBackupTextColumnsDataEncoding;
    emit(table.data_file,rows.map(r=>wire.encodeProductionBackupTextColumnsDataRow(r.raw)+'\n').join(''));
   }
   const release=JSON.parse((await db.query('select row_to_json(r)::text raw from public.release_deployment_manifest r')).rows[0].raw);
   const ledger=(await db.query('select * from supabase_migrations.schema_migrations order by version')).rows;
   await db.query('rollback');
   const identity={migration_head:'20261021111917',migration_ledger_count:ledger.length,cron_job_count:0,release};
   for(const [file,field,value] of [['application-schema.sql','application_schema_sha256','-- Actual disposable native fixture; owning CLI does not execute schema DATA\n'],
     ['migration-ledger.json','migration_ledger_sha256',ledger],['cron-jobs.json','cron_jobs_sha256',[]],['extensions.json','extensions_sha256',[]],
     ['runtime-contract.json','runtime_contract_sha256',{}],['runtime-configuration.json','runtime_configuration_sha256',{}]])
     identity[field]=emit('inventory/'+file,typeof value==='string'?value:stableJsonFile(value));
   identity.database_catalog_sha256=emit('inventory/table-catalog.json',stableJsonFile(tables));emit('inventory/storage-buckets.json','[]\n');emit('inventory/storage-objects.json','[]\n');
   const summary={ok:true,format:'memphis-zoo-disaster-recovery.v4',consistent_database_snapshot:true,project_ref:project,backed_up_schemas:['public','auth','storage','custodial_release_identity'],
    source_identity:identity,table_count:tables.length,database_row_count:tables.reduce((n,t)=>n+Number(t.row_count),0),storage_bucket_count:0,storage_object_count:0};
   emit('backup-summary.json',stableJsonFile(summary));const sums=[...entries].sort(([a],[b])=>a.localeCompare(b)).map(([p,b])=>hash(b)+'  '+p).join('\n')+'\n';writeFileSync(join(archive,'SHA256SUMS'),sums);
   writeFileSync(join(archive,'archive-signature.json'),stableJsonFile({format:'memphis-zoo-disaster-recovery-signature.v1',algorithm:'hmac-sha256',key_id:keyId,archive_digest:hash(sums),
    signature:signBinding(archiveSignatureBinding({archiveDigest:hash(sums),projectRef:project,sourceIdentity:identity,archiveFormat:summary.format}),key)}));
   if(scenario==='wrong-type')await db.query('alter table public.unit_records alter column json_value type jsonb using json_value::jsonb');
   if(scenario==='custom-enum-text-cast')await db.query(`create function auth.unit_kind_text(auth.unit_kind) returns text language sql immutable as $$select 'changed'::text$$;create cast(auth.unit_kind as text) with function auth.unit_kind_text(auth.unit_kind) as assignment`);
   if(scenario==='external-FK')await db.query(`create schema outside_scope;create table outside_scope.dependent(id bigint references public.unit_records(id));insert into outside_scope.dependent values(9007199254740993)`);
   if(scenario==='late-storage-mutation')await db.query(`create function custodial_dr.unit_late_storage_mutation() returns trigger language plpgsql as $$begin
     if new.database_verified and not old.database_verified then update storage.unit_records set precise=0;end if;return new;end$$;
     create trigger unit_late_storage_mutation before update on custodial_dr.restore_manifests for each row execute function custodial_dr.unit_late_storage_mutation();
     alter table custodial_dr.restore_manifests enable always trigger unit_late_storage_mutation`);
   const env={...process.env,SUPABASE_DB_URL:String(target),SUPABASE_PROJECT_REF:project,RESTORE_SOURCE_DIR:archive,RESTORE_ARCHIVE_VERIFY_KEY:key,RESTORE_ARCHIVE_VERIFY_KEY_ID:keyId,
    RESTORE_NAMED_ACTOR:'UNIT actual disposable native owner',RESTORE_INTENT_SIGNING_KEY:intentKey,RESTORE_INTENT_SIGNING_KEY_ID:keyId+'-intent',RESTORE_DATABASE_ONLY:'true'};
   const produced=await execute(process.execPath,[new URL('./create-production-restore-intent.mjs',import.meta.url).pathname],{env,timeout:20000,maxBuffer:1024*1024});
   const normalEnv={...env,RESTORE_APPLY:'true',RESTORE_INTENT_JSON:produced.stdout,RESTORE_INTENT_VERIFY_KEY:intentKey,RESTORE_INTENT_VERIFY_KEY_ID:keyId+'-intent'};
   if(scenario==='lost-COMMIT'){
    const net=await import('node:net');
    // Transparent real PostgreSQL wire proxy; constructor-fixed one-shot fault
    // discards ONLY the third actual COMMIT's successful server reply. Neither
    // caller flags nor fabricated query results enter the native owner.
    proxy=net.createServer(client=>{
     const server=net.connect({host:url.hostname,port:Number(url.port||5432)});
     proxySockets.add(client);proxySockets.add(server);
     let upstream=Buffer.alloc(0),downstream=Buffer.alloc(0),startup=true,commits=0,armed=false,committed=false;
     const finish=()=>{client.destroy();server.destroy();proxySockets.delete(client);proxySockets.delete(server);};
     client.on('error',finish);server.on('error',finish);client.on('close',()=>server.destroy());server.on('close',()=>client.destroy());
     client.on('data',chunk=>{
      server.write(chunk);upstream=Buffer.concat([upstream,chunk]);
      if(startup){if(upstream.length<4)return;const size=upstream.readUInt32BE(0);if(upstream.length<size)return;upstream=upstream.subarray(size);startup=false;}
      while(upstream.length>=5){const size=upstream.readUInt32BE(1)+1;if(upstream.length<size)break;
       if(upstream[0]===81&&/^commit\0$/i.test(upstream.subarray(5,size).toString('utf8'))&&++commits===3)armed=true;
       upstream=upstream.subarray(size);
      }
     });
     server.on('data',chunk=>{
      downstream=Buffer.concat([downstream,chunk]);while(downstream.length>=5){
       const size=downstream.readUInt32BE(1)+1;if(downstream.length<size)break;
       const frame=downstream.subarray(0,size);downstream=downstream.subarray(size);
       if(!armed)client.write(frame);else{
        if(frame[0]===67&&frame.subarray(5).toString('utf8')==='COMMIT\0')committed=true;
        if(frame[0]===90){assert.equal(committed,true);proxyFaults++;finish();}
       }
      }
     });
    });
    await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
    const proxied=new URL(String(target));proxied.port=String(proxy.address().port);normalEnv.SUPABASE_DB_URL=String(proxied);
   }

   let result,error;try{result=await execute(process.execPath,[new URL('./production-restore.mjs',import.meta.url).pathname],{env:normalEnv,timeout:45000,maxBuffer:2*1024*1024});}catch(e){error=e;}
   if(scenario==='positive'){
    assert.equal(error,undefined,error?.stderr);const output=JSON.parse(result.stdout);assert.equal(output.ok,true);assert.equal(output.database_only,true);
    const evidence=(await db.query('select database_evidence from custodial_dr.restore_manifests')).rows[0].database_evidence;
    assert.deepEqual(evidence.native_text_readback,{state:'MATCH',tables:tables.length,original_text_multiset:true});
    assert.equal((await db.query('select precise::text value from storage.unit_records')).rows[0].value,'123456789012345678901234567890.123456789');
    assert.equal(output.storage.exact_table_data.status,'MATCH');
    assert.equal(output.storage.exact_table_data.original_text_multiset,true);
   }else if(scenario==='lost-COMMIT'){
    assert.ok(error);assert.equal(proxyFaults,1);assert.ok(error.stderr.includes('NATIVE_TEXT_DATA_COMMIT_OUTCOME_UNKNOWN'));
    const control=(await db.query('select state,mutations_paused from custodial_dr.restore_control')).rows[0];
    assert.deepEqual(control,{state:'DATABASE_RESTORED',mutations_paused:true});
    assert.equal((await db.query('select database_verified from custodial_dr.restore_manifests')).rows[0].database_verified,true);
    const replayEnv={...normalEnv,SUPABASE_DB_URL:String(target)};
    await assert.rejects(()=>execute(process.execPath,[new URL('./production-restore.mjs',import.meta.url).pathname],{env:replayEnv,timeout:20000}),e=>e.stderr.includes('Another restore or reconciliation already holds'));
    assert.equal((await db.query('select count(*)::text count from custodial_dr.restore_manifests')).rows[0].count,'1');
    assert.equal((await db.query("select count(*)::text count from custodial_dr.restore_events where phase='DATABASE' and outcome='PASSED'")).rows[0].count,'1');
   }else{
    assert.ok(error,'Expected causal refusal: '+scenario);assert.equal((await db.query('select count(*)::text count from public.unit_records')).rows[0].count,'1');
    assert.equal((await db.query('select database_verified from custodial_dr.restore_manifests')).rows[0].database_verified,false);
   }
   cases++;console.log(JSON.stringify({scenario,status:'PASS_ACTUAL_NATIVE_SQL_AND_OWNING_UNIT_CLI',real_production_backup:false}));
  }finally{for(const socket of proxySockets)socket.destroy();if(proxy)await new Promise(resolve=>proxy.close(resolve));await db.end().catch(()=>{});await admin.query('drop database if exists '+pg.escapeIdentifier(name)+' with (force)');}
 }}finally{await admin.end();rmSync(work,{recursive:true,force:true});}
 console.log(JSON.stringify({selector:'ordinary-native-text-owner-sql',cases,proof:'ACTUAL_DISPOSABLE_POSTGRES_AND_NORMAL_SIGNED_UNIT_OWNER',production_restore:false}));process.exit(0);
}

// Pure DATA SQL-plan checks for the normal owning entry. These never grant
// a native client, pause, intent, transaction or restore capability.
if(process.argv.includes('--ordinary-native-text-owner-only')){
 const source=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
 const begin=source.indexOf('function nativeTextRestorePlan('),end=source.indexOf('async function requireNativeTextRelationCensus(',begin);
 assert.ok(begin>0&&end>begin);
 const quoteIdentifier=value=>'"'+String(value).replaceAll('"','""')+'"';
 const qualified=(schema,table)=>quoteIdentifier(schema)+'.'+quoteIdentifier(table);
 const plan=new Function('stableJson','quoteIdentifier','qualified',source.slice(begin,end)+'return nativeTextRestorePlan;')(stableJson,quoteIdentifier,qualified);
 let cases=0;
 const check=(name,fn)=>{fn();cases++;console.log(JSON.stringify({case:name,status:'PASS_DATA_OR_SOURCE_ONLY'}));};
 const table={schema_name:'public',table_name:'records',primary_key:['id'],columns:[
   {name:'id',data_type:'bigint',generated:'',identity:'a'},
   {name:'native_json',data_type:'json',generated:'',identity:''},
   {name:'native_array',data_type:'numeric[]',generated:'',identity:''},
   {name:'derived',data_type:'text',generated:'s',identity:''}]};
 const actual={relation_kind:'r',is_partition:false,inheritance_count:'0',dropped_count:'0',
   columns:structuredClone(table.columns),primary_key:['id'],casts:table.columns.map((c,i)=>({name:c.name,
   type_schema:'pg_catalog',type_name:['int8','json','_numeric','text'][i],supported_io:true}))};
 check('native DATA uses raw parameter and actual quoted type identities',()=>{
   const sql=plan(table,actual);assert.match(sql.insert,/\$1::pg_catalog\.json->>E'id'\)::"pg_catalog"\."int8"/);
   assert.match(sql.insert,/\$1::pg_catalog\.json->>E'native_json'\)::"pg_catalog"\."json"/);
   assert.match(sql.insert,/"pg_catalog"\."_numeric"/);assert.doesNotMatch(sql.insert,/json_populate_record/);
   assert.match(sql.insert,/overriding system value/);assert.doesNotMatch(sql.insert,/\("derived"\)/);
   assert.match(sql.compare,/except all/);assert.match(sql.compare,/r\."derived"::pg_catalog\.text/);
   assert.match(sql.compare,/collate pg_catalog\."C"/);
 });
 check('field names are escaped independently for identifiers and E literals',()=>{
   const strange='q\\\'";--';const t=structuredClone(table),a=structuredClone(actual);
   t.columns[1].name=strange;a.columns[1].name=strange;a.casts[1].name=strange;
   const sql=plan(t,a);assert.ok(sql.insert.includes(quoteIdentifier(strange)));
   assert.ok(sql.insert.includes("E'"+strange.replaceAll("\\","\\\\").replaceAll("'","''")+"'"));
 });
 for(const [name,mutate] of [
   ['changed type',a=>a.columns[1].data_type='jsonb'],['changed order',a=>a.columns.reverse()],
   ['changed generated',a=>a.columns[1].generated='s'],['changed identity',a=>a.columns[0].identity=''],
   ['changed primary key',a=>a.primary_key=[]],['partition',a=>a.is_partition=true],
   ['foreign table',a=>a.relation_kind='f'],['partition parent',a=>a.relation_kind='p'],
   ['inheritance',a=>a.inheritance_count='1'],['dropped column',a=>a.dropped_count='1'],
   ['unsupported I/O',a=>a.casts[1].supported_io=false],['wrong cast column',a=>a.casts[1].name='id'],
   ['missing cast',a=>a.casts.pop()],['NUL type',a=>a.casts[0].type_name='int8\0bad']]){
   check(name+' refuses before target data SQL',()=>{const a=structuredClone(actual);mutate(a);
     assert.throws(()=>plan(table,a),error=>error.code==='NATIVE_TEXT_TARGET_CATALOG_MISMATCH');});
 }
 check('target type names cannot introduce SQL syntax',()=>{
   const a=structuredClone(actual);a.casts[0].type_schema='p";select';a.casts[0].type_name='t";--';
   assert.ok(plan(table,a).insert.includes('"p"";select"."t"";--"'));
 });
 check('all-generated populated target refuses',()=>{
   const t=structuredClone(table),a=structuredClone(actual);t.columns.forEach(c=>c.generated='s');a.columns=structuredClone(t.columns);
   assert.throws(()=>plan(t,a));
 });
 check('owning ordering preserves signed intent and refuses production native APPLY before connect',()=>{
   assert.ok(source.indexOf('captureVerifiedOriginalRestoreIntent(intentEnvelope')<source.indexOf('if (nativeTextLegacyBlocker !== null)'));
   assert.ok(source.indexOf('if (nativeTextLegacyBlocker !== null)')<source.indexOf('  await db.connect();'));
   assert.match(source,/nativeTextDatabase = hasOrdinaryNativeText && databaseOnly/);
   assert.match(source,/tableSelection\.databaseTables\.every\(table=>table\.data_encoding===postgresTextColumnsLineEncoding\)/);
   const prepare=source.indexOf('nativeTextPlans=nativeTextDatabase ? await prepareNativeTextRestorePlans()');
   assert.ok(prepare>source.indexOf('restorePhase = "acquire_global_mutation_fence"'));
   assert.ok(prepare<source.indexOf('restorePhase = "truncate_target_tables"'));
   assert.match(source,/Date\.now\(\) >= expiresAt/);assert.match(source,/db\._txStatus !== "T"/);
 });
 check('native truncation denies external FK closure and type casts reject custom functions',()=>{
   assert.ok(source.includes('nativeTextDatabase ? "" : " cascade"'));
   assert.match(source,/x\.castsource=t\.oid and x\.casttarget='pg_catalog\.text'/);
   assert.match(source,/x\.castsource='pg_catalog\.text'::pg_catalog\.regtype and x\.casttarget=t\.oid/);
   assert.match(source,/cast_proc\.pronamespace<>'pg_catalog'::pg_catalog\.regnamespace/);
   assert.match(source,/cast_proc\.prolang<>/);
 });
 check('whole-table final readback and evidence precede same COMMIT; unknown cannot retry',()=>{
   const evidence=source.indexOf('if(nativeTextDatabase){\n      await recordDatabaseRestored();');
   const compare=source.indexOf('await compareNativeTextRestorePlans(nativeTextPlans);',evidence);
   const commit=source.indexOf('    await db.query("commit");',compare);
   assert.ok(evidence>0&&compare>evidence&&commit>compare);
   assert.match(source,/nativeTextDatabase \? "NATIVE_TEXT_DATA_COMMIT_OUTCOME_UNKNOWN"/);
   assert.match(source,/code === "NATIVE_TEXT_DATA_COMMIT_OUTCOME_UNKNOWN"/);
   assert.match(source,/if \(prepared && !outcomeUnknown\)/);
 });
 const scope=await import('./production-backup-rehearsal-scope.mjs');
 const summary={format:'memphis-zoo-disaster-recovery.v4',project_ref:'abcdefghijklmnopqrst',database_row_count:3,table_count:2,storage_object_count:0,
   source_identity:{backup_tool_commit:'a'.repeat(40),backup_tool_tree:'b'.repeat(40),migration_head:'20261021111917',migration_ledger_count:235,migration_ledger_sha256:'c'.repeat(64)}};
 const run={id:39605791047,repository:{full_name:'unit/repo'},status:'completed',conclusion:'success',head_sha:'a'.repeat(40),path:'.github/workflows/production-disaster-recovery-backup.yml'};
 check('backup-only source/run lineage metadata agrees without granting effects',()=>{
   scope.assertBackupOnlySourceBinding({summary,run,backupRunId:'39605791047',repository:'unit/repo'});
   assert.equal(scope.backupArchiveMetadata(summary,'d'.repeat(64)).length,8);
 });
 for(const [name,change] of [['failed run',r=>r.conclusion='failure'],['pending run',r=>r.status='in_progress'],
   ['wrong source commit',r=>r.head_sha='d'.repeat(40)],['wrong repository',r=>r.repository.full_name='foreign/repo'],
   ['wrong workflow',r=>r.path='other.yml'],['wrong run',r=>r.id++ ]])check(name+' cannot bind backup-only receipt',()=>{
   const r=structuredClone(run);change(r);assert.throws(()=>scope.assertBackupOnlySourceBinding({summary,run:r,backupRunId:'39605791047',repository:'unit/repo'}));
 });
 check('empty source and metadata line injection refuse',()=>{
   assert.throws(()=>scope.assertBackupOnlySourceBinding({summary:{...summary,database_row_count:0},run,backupRunId:'39605791047',repository:'unit/repo'}));
   const bad=structuredClone(summary);bad.source_identity.backup_tool_commit+='\n';
   assert.throws(()=>scope.backupArchiveMetadata(bad,'d'.repeat(64)));
 });
 const restore={ok:true,database_only:true,state:'PAUSED_RECONCILIATION',mutations_paused:true,database_tables:2,database_rows:3,
   restore_id:'a'.repeat(8)+'-'+ 'a'.repeat(4)+'-'+ 'a'.repeat(4)+'-'+ 'a'.repeat(4)+'-'+ 'a'.repeat(12),authority_generation:1,final_manifest_sha256:'f'.repeat(64),
   database_evidence:{native_text_readback:{state:'MATCH',tables:2,original_text_multiset:true}},
   storage:{database_only_metadata_verified:true,exact_table_data:{status:'MATCH',tables:1,original_text_multiset:true}}};
 const receipt=r=>scope.backupOnlyRestoreReceipt({summary,restore:r,toolCommit:'e'.repeat(40),backupRunId:'39605791047',archiveDigest:'d'.repeat(64),storageTableCount:1});
 check('backup-only receipt keeps source/tool identities and denies broader admission',()=>{
   const r=receipt(restore);assert.equal(r.source_commit,'a'.repeat(40));assert.equal(r.qualification_tool_commit,'e'.repeat(40));
   for(const field of ['forward_migrations_applied','candidate_migration_admission','runtime_admission','storage_provider_admission','full_rehearsal_attestation'])assert.equal(r[field],false);
 });
 for(const [name,change] of [['row count',r=>r.database_rows=2],['table count',r=>r.database_tables=3],
   ['unpaused',r=>r.mutations_paused=false],['wrong state',r=>r.state='COMPLETE'],
   ['native mismatch',r=>r.database_evidence.native_text_readback.state='DIFFERENT'],
   ['Storage mismatch',r=>r.storage.exact_table_data.status='DIFFERENT'],['Storage missing table',r=>r.storage.exact_table_data.tables=0]])
   check(name+' cannot claim backup fidelity',()=>{const r=structuredClone(restore);change(r);assert.throws(()=>receipt(r));});
 check('backup-only workflow exits before forward SQL/runtime and skips full attestation',()=>{
   const flow=readFileSync(new URL('../.github/workflows/production-backup-migration-rehearsal.yml',import.meta.url),'utf8');
   assert.match(flow,/default: full_candidate/);assert.match(flow,/if: inputs\.rehearsal_scope != 'backup_only'/);
   const boundary=flow.indexOf('node scripts/production-backup-rehearsal-scope.mjs restore-result');
   assert.ok(boundary>flow.indexOf('RESTORE_APPLY=true'));assert.ok(flow.indexOf('exit 0',boundary)<flow.indexOf('release:migrations:apply'));
   assert.match(flow,/test "\$source_commit" = "\$GITHUB_SHA"/);
 });
 console.log(JSON.stringify({selector:'ordinary-native-text-owner-only',cases,
   proof:'PURE_SQL_PLAN_AND_OWNING_SOURCE_GUARDS_ONLY',native_sql_or_populated_restore:false}));
 process.exit(0);
}

// Newly mandatory legacy mutation admission only. Real UNIT signed archive
// reads/EOF/cleanup, plus extracted owning entry prefixes with inert effects.
// No facade is supplied as an accepted native client to shipping methods.
if(process.argv.includes('--legacy-original-fidelity-only')){
 const api=await import('./disaster-recovery-archive.mjs'),wire=await import('./production-backup-pg-dump-command.mjs');
 const {types,isDeepStrictEqual}=await import('node:util'),{splitSchemaStatements}=await import('./isolated-event-owner-schema.mjs');
 const {readdirSync,readlinkSync}=await import('node:fs'),{default:pg}=await import('pg');
 const {captureVerifiedOriginalRestoreIntent,restoreIntentBinding}=await import('./disaster-recovery-crypto.mjs');
 const part=process.argv.find(v=>v.startsWith('--legacy-fidelity-case='))?.split('=')[1];
 const member=process.argv.find(v=>v.startsWith('--legacy-fidelity-member='))?.slice('--legacy-fidelity-member='.length);
 assert.ok(part===undefined||['tokens','source','archive','entries','late-entry','hardening','real-original','final-join'].includes(part));
 const work=mkdtempSync(join(tmpdir(),'UNIT-legacy-fidelity-')),archives=[],cases=[],causes=new WeakMap();let ordinal=0;
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>Buffer.from(JSON.stringify(value)+'\n');
 const key='UNIT-only-legacy-fidelity-archive-HMAC-20261018',keyId='unit-legacy-fidelity-v1';
 const v1=api.postgresJsonTextLineEncoding,v2=api.postgresTextColumnsLineEncoding;
 const code='IMMUTABLE_LEGACY_DATA_FIDELITY_UNPROVEN';
 const fail=(cause,code='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED')=>{
   const error=Object.assign(new Error(code),{code,outcome:'UNKNOWN',retry_safe:false});causes.set(error,cause);throw error;
 };
 let lastOpened=null;
 const text=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
 const start=text.indexOf('function sameSource('),end=text.indexOf('// Closed, one-consumption routing DATA',start);
 assert.ok(start>0&&end>start);
 const helpers=new Function('readVerifiedPrivateImportSource','isDeepStrictEqual','fail','splitSchemaStatements',
   'readVerifiedImmutableBootstrapInventory','postgresTextColumnsLineEncoding','openVerifiedRestoreTableData',
   'createRestoreRowUtf8Guard','createRestoreRowLineBatchDecoder','pipeline','assertRestoreRowMutationFidelity',
   'assertVerifiedLegacyRestoreDataCurrent',text.slice(start,end)+'\nreturn {sameSource,legacyOriginalColumnSources,requireLegacyOriginalDataFidelity};')(
   api.readVerifiedPrivateImportSource,isDeepStrictEqual,fail,splitSchemaStatements,api.readVerifiedImmutableBootstrapInventory,v2,
   (...args)=>{lastOpened=args[1]+'.'+args[2];return api.openVerifiedRestoreTableData(...args);},api.createRestoreRowUtf8Guard,api.createRestoreRowLineBatchDecoder,pipeline,
   api.assertRestoreRowMutationFidelity,api.assertVerifiedLegacyRestoreDataCurrent);
 const run=async(group,name,body)=>{if((!part||part===group)&&(!member||name.includes(member))){
   const first=archives.length;try{await body();cases.push(group+': '+name);console.log(JSON.stringify({case:group+': '+name,status:'PASS_NEW_COMPONENT_ONLY'}));}
   finally{for(const archive of archives.slice(first))archive.cleanup();}
 }};
 const descriptor=(type,encoding=v1)=>({columns:[{name:'value',data_type:type}],...(encoding===undefined?{}:{data_encoding:encoding})});
 const line=(raw,encoding=v1)=>encoding===undefined?raw:encoding===v2?wire.encodeProductionBackupTextColumnsDataRow(raw):JSON.stringify(raw);
 const refuseRow=(type,raw,reason)=>assert.throws(()=>api.assertRestoreRowMutationFidelity(line(raw),descriptor(type)),e=>{
   assert.equal(e.code,code);assert.equal(e.fidelity_reason,reason);assert.equal(Object.hasOwn(e,'cause'),false);
   assert.equal(Object.hasOwn(e,'actual'),false);assert.equal(Object.hasOwn(e,'expected'),false);
   assert.equal(String(e).includes('private-canary'),false);return true;
 });
 const quote=v=>'"'+v.replaceAll('"','""')+'"';
 const schema=tables=>"SET standard_conforming_strings = on;\nSELECT pg_catalog.set_config('search_path', '', false);\n"
   +tables.map(t=>'CREATE TABLE '+quote(t.schema_name)+'.'+quote(t.table_name)+' ('
     +t.columns.map(c=>quote(c.name)+' '+c.data_type).join(',')+');\n').join('');
 function fixture({raws=['{"id":9223372036854775807,"value":{"n":9007199254740993,"n":2}}'],type='json',encoding=v1,
   declared,bytes,schemaChange=s=>s,extra=[],allV2=false}={}){
   const dir=join(work,'original-'+ordinal++);mkdirSync(join(dir,'inventory'),{recursive:true});mkdirSync(join(dir,'database'));
   const table=(schema_name,table_name,data,columns,tag=encoding)=>({schema_name,table_name,primary_key:['id'],columns,
     row_count:String(data.length),data_file:'database/'+schema_name+'.'+table_name+'.jsonl',...(tag===undefined?{}:{data_encoding:tag})});
   const simple=[{name:'id',data_type:'bigint',generated:'',identity:''}],columns=[...simple,{name:'value',data_type:type,generated:'',identity:''}];
   const catalog=[table('public','records',raws,columns),table('auth','records',[],simple),table('storage','records',[],simple),
     table('custodial_release_identity','employee_message_original_outcomes',[],simple),
     table('custodial_release_identity','group_original_creations',[],simple),
     ...extra.map(item=>table(item.schema||'public',item.name,item.raws,item.columns||columns,item.encoding||encoding))];
   if(declared!==undefined)catalog[0].row_count=declared;
   if(allV2)for(const table of catalog)table.data_encoding=v2;
   const entries=new Map(),dataRows=[raws,[],[],[],[],...extra.map(item=>item.raws)];
   catalog.forEach((table,i)=>entries.set(table.data_file,i===0&&bytes!==undefined?bytes:
     Buffer.from(dataRows[i].map(raw=>line(raw,table.data_encoding)).join('\n')+(dataRows[i].length?'\n':''))));
   const members=[['application-schema.sql','application_schema_sha256'],['migration-ledger.json','migration_ledger_sha256'],
     ['cron-jobs.json','cron_jobs_sha256'],['extensions.json','extensions_sha256'],['table-catalog.json','database_catalog_sha256'],
     ['original-relations.json','original_relations_sha256'],['original-guards.json','original_guards_sha256'],['original-acls.json','original_acls_sha256']];
   const identity={};
   for(const [name,field]of members){const data=name==='application-schema.sql'?Buffer.from(schemaChange(schema(catalog))):name==='table-catalog.json'?json(catalog):json([]);
     entries.set('inventory/'+name,data);identity[field]=hash(data);}
   const summary={ok:true,format:'memphis-zoo-disaster-recovery.v4',consistent_database_snapshot:true,project_ref:'unitunitunitunitunit',
     source_identity:identity,backed_up_schemas:['public','auth','storage','custodial_release_identity'],table_count:catalog.length,
     database_row_count:catalog.reduce((sum,t)=>sum+Number(t.row_count),0)};
   entries.set('backup-summary.json',json(summary));
   for(const [name,data]of entries)writeFileSync(join(dir,name),data,{flag:'wx'});
   const sums=Buffer.from([...entries].map(([name,data])=>hash(data)+'  '+name).join('\n')+'\n');writeFileSync(join(dir,'SHA256SUMS'),sums,{flag:'wx'});
   const digest=hash(sums);writeFileSync(join(dir,'archive-signature.json'),json({format:'memphis-zoo-disaster-recovery-signature.v1',
     algorithm:'hmac-sha256',key_id:keyId,archive_digest:digest,signature:signBinding(archiveSignatureBinding({archiveDigest:digest,
       projectRef:summary.project_ref,sourceIdentity:identity,archiveFormat:summary.format}),key)}),{flag:'wx'});
   const archive=materializeVerifiedArchive({sourceDir:dir,archiveVerifyKey:key,archiveVerifyKeyId:keyId});archives.push(archive);
   return {archive,catalog,entries,dir,original:api.readVerifiedPrivateImportSource(archive)};
 }
 const noFds=archive=>assert.deepEqual(readdirSync('/proc/self/fd').flatMap(fd=>{try{return readlinkSync('/proc/self/fd/'+fd).includes(archive.directory)?[fd]:[];}catch{return [];}}),[]);
 async function scan(f,onCurrent=()=>{}){let checks=0;lastOpened=null;
   try{await helpers.requireLegacyOriginalDataFidelity(f.archive,f.original,()=>{onCurrent(++checks);helpers.sameSource(f.archive,f.original);});}
   finally{noFds(f.archive);}return checks;
 }
 const rejection=promise=>assert.rejects(promise,e=>{assert.equal(e.code,code);assert.equal(Object.hasOwn(e,'cause'),false);
   assert.equal(Object.hasOwn(e,'actual'),false);assert.equal(Object.hasOwn(e,'expected'),false);
   assert.equal(String(e).includes('private-canary'),false);return true;});
 try{
   await run('real-original','retained c2ca legacy archive refuses mandatory scan without re-signing or mutation',async()=>{
     const dir='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/populated-raw-release-original-v109-9WKkdl/new-auth-complete-original';
     const digest=hash(readFileSync(dir+'/SHA256SUMS'));
     assert.equal(digest,'c2ca572a9b54f9e3f02f3136fbe42a590857778f310edd32e54315edd3554ef0');
     const archive=materializeVerifiedArchive({sourceDir:dir,archiveVerifyKey:'UNIT-only-auth-complete-original-HMAC-20261017',
       archiveVerifyKeyId:'unit-auth-complete-original-v1'});archives.push(archive);
     const f={archive,original:api.readVerifiedPrivateImportSource(archive)};
     let failure;try{await scan(f);}catch(error){failure=error;}
     assert.equal(failure?.code,code);const inner=causes.get(failure);
     assert.equal(inner?.code,code,'Must reach the new DATA classification; fixed internal location '+inner?.stack?.split('\n').slice(1,3).join(' '));
     assert.ok(['JSON_NULL_AMBIGUOUS','ARRAY_BOUNDARIES_UNRECORDED','FLOAT_PROFILE_UNRECORDED','TYPE_UNSUPPORTED'].includes(inner.fidelity_reason));
     assert.equal(hash(readFileSync(dir+'/SHA256SUMS')),digest);
     console.log(JSON.stringify({original_archive_digest:digest,first_refusal:inner.fidelity_reason,original_modified:false,SQL:'NOT_RUN'}));
   });
   await run('final-join','closed scalar/nonnull JSON legacy and v2 mixture retains exact bytes under final guards',async()=>{
     const f=fixture({type:'numeric(40,20)',raws:['{"id":-9223372036854775808,"value":12345678901234567890.12345678901234567890}'],
       extra:[{name:'typed_nulls',encoding:v2,raws:['{"id":"1","value":null}']},
         {name:'json_lexical',encoding:v1,columns:[{name:'id',data_type:'bigint',generated:'',identity:''},{name:'value',data_type:'json',generated:'',identity:''}],
           raws:['{"id":1,"value":{"outer":[null,{"same":9007199254740993,"same":0.000000000000000000001}]}}']}]});
     const bytes=readFileSync(f.archive.directory+'/database/public.records.jsonl');assert.ok(await scan(f)>10);
     assert.equal(readFileSync(f.archive.directory+'/database/public.records.jsonl').equals(bytes),true);
     assert.equal(api.assertVerifiedLegacyRestoreDataCurrent(f.archive),undefined);
   });
   await run('final-join','zero-row earlier original remains pinned across a later member EOF',async()=>{
     const f=fixture({extra:[{name:'late_empty_pin',raws:['{"id":1,"value":{}}']}]});let replaced=false;
     await rejection(scan(f,()=>{if(replaced||lastOpened!=='public.late_empty_pin')return;replaced=true;
       const path=f.archive.directory+'/database/auth.records.jsonl';assert.equal(readFileSync(path).length,0);
       renameSync(path,path+'.retired');writeFileSync(path,Buffer.alloc(0));
     }));assert.equal(replaced,true);
   });
   await run('hardening','exception privacy never coerces raw getter/proxy/falsy failures',()=>{
     let coerced=0;const thrown=new Proxy({},{get(){coerced++;throw 'private-canary';},ownKeys(){coerced++;throw 'private-canary';}});
     for(const value of [thrown,new Error('private-canary'),undefined,null,0,false]){
       const column={name:'value'};Object.defineProperty(column,'data_type',{get(){throw value;}});
       assert.throws(()=>api.assertRestoreRowMutationFidelity(line('{"value":1}'),{columns:[column],data_encoding:v1}),e=>{
         assert.equal(e.code,code);assert.equal(e.fidelity_reason,'ROW_UNSUPPORTED');assert.equal(JSON.stringify(e).includes('private-canary'),false);
         assert.equal(e.stack.includes('private-canary'),false);assert.equal(Object.hasOwn(e,'cause'),false);return true;
       });
     }assert.equal(coerced,0);
   });
   await run('hardening','native scalar escaped Unicode refuses nonrepresentable text without touching JSON payloads',()=>{
     for(const value of ['"\\ud800"','"\\udc00"','"\\u0000"'])refuseRow('text','{"value":'+value+'}','ROW_UNSUPPORTED');
     for(const value of ['"\\ud83d\\ude00"','"\\u00e9"']){const raw='{"value":'+value+'}';
       assert.equal(api.assertRestoreRowMutationFidelity(line(raw),descriptor('text')),raw);}
     const raw='{"value":{"opaque":"\\u0000","same":9007199254740993,"same":2}}';
     assert.equal(api.assertRestoreRowMutationFidelity(line(raw),descriptor('json')),raw);
   });
   await run('hardening','currentness public exception never exposes raw native paths or archive claims',()=>{
     const f=fixture(),path=f.archive.directory+'/database/public.records.jsonl';renameSync(path,path+'.retired');
     for(const archive of [f.archive,{...f.archive}])assert.throws(()=>api.assertVerifiedLegacyRestoreDataCurrent(archive),error=>{
       assert.equal(error.code,code);for(const key of ['cause','actual','expected','path','syscall','errno'])assert.equal(Object.hasOwn(error,key),false);
       for(const rendered of [String(error),error.stack,JSON.stringify(error)]){
         assert.equal(rendered.includes(f.archive.directory),false);assert.equal(rendered.includes(f.archive.archiveDigest),false);
         assert.equal(rendered.includes('public.records'),false);
       }return true;
     });noFds(f.archive);
   });
   await run('hardening','exact native integer bounds without Number conversion',()=>{
     for(const [type,low,high]of [['smallint','-32768','32767'],['integer','-2147483648','2147483647'],['bigint','-9223372036854775808','9223372036854775807']]){
       for(const value of [low,high]){const raw='{"value":'+value+'}';assert.equal(api.assertRestoreRowMutationFidelity(line(raw),descriptor(type)),raw);}
       for(const value of [String(BigInt(low)-1n),String(BigInt(high)+1n),'1.0','1e1','"1"'])refuseRow(type,'{"value":'+value+'}','ROW_UNSUPPORTED');
     }
     const table=descriptor('double precision');table.capture_profile={extra_float_digits:3};
     assert.throws(()=>api.assertRestoreRowMutationFidelity(line('{"value":0.1}'),table),e=>e.code===code&&e.fidelity_reason==='FLOAT_PROFILE_UNRECORDED');
   });
   await run('hardening','schema-setting and post-declaration type substitutions never bind a built-in',()=>{
     const tables=[{schema_name:'public',table_name:'unit',row_count:'1',columns:[{name:'value',data_type:'json'}]}],source=schema(tables);
     for(const change of ['SET SCHEMA \'public\';','DISCARD ALL;','ALTER TABLE ONLY public.unit ALTER COLUMN value TYPE public.unit_domain;',
       'ALTER TABLE public.unit RENAME COLUMN value TO other;','DROP TABLE public.unit;',
       'CREATE OR REPLACE FUNCTION pg_catalog.json_in() RETURNS text LANGUAGE sql AS $$select \'unit\'$$;'])
       assert.throws(()=>helpers.legacyOriginalColumnSources(tables,source+change));
   });
   await run('tokens','real v120 ambiguous representation remains readable, but mutation refuses both json types',()=>{
     for(const type of ['json','jsonb']){const raw='{"value":null}';assert.equal(decodeRestoreTableRowLine(line(raw),descriptor(type)),raw);
       refuseRow(type,raw,'JSON_NULL_AMBIGUOUS');}
   });
   for(const type of ['bigint','numeric(40,20)','text','boolean','timestamp with time zone','bytea'])await run('tokens','safe native '+type,()=>{
     const value=type==='bigint'?'9223372036854775807':type.startsWith('numeric')?'9007199254740993.12345678901234567890':
       type==='boolean'?'false':type.startsWith('timestamp')?'"2026-10-18T01:02:03.123456+00:00"':type==='bytea'?'"\\\\x00ff"':'"private-canary"';
     const raw=' { "value" : '+value+' } ';assert.equal(api.assertRestoreRowMutationFidelity(line(raw),descriptor(type)),raw);
     assert.equal(api.assertRestoreRowMutationFidelity(line('{"value":null}'),descriptor(type)),'{"value":null}');
   });
   for(const value of ['{"n":9007199254740993,"n":2,"fraction":0.12345678901234567890}','[null,{"v":null}]','"null"','false','9007199254740993'])
     await run('tokens','nonnull json token '+cases.length,()=>{const raw='{"value":'+value+'}';
       assert.equal(api.assertRestoreRowMutationFidelity(line(raw),descriptor('json')),raw);});
   for(const type of ['integer[]','json[]','jsonb[]','text[]'])await run('tokens','SQL array dimensions '+type,()=>{
     refuseRow(type,'{"value":[]}','ARRAY_BOUNDARIES_UNRECORDED');
     assert.equal(api.assertRestoreRowMutationFidelity(line('{"value":null}'),descriptor(type)),'{"value":null}');
   });
   for(const type of ['real','double precision'])await run('tokens','unrecorded float profile '+type,()=>{
     refuseRow(type,'{"value":0.12345678901234567890}','FLOAT_PROFILE_UNRECORDED');
     assert.equal(api.assertRestoreRowMutationFidelity(line('{"value":null}'),descriptor(type)),'{"value":null}');
   });
   for(const type of ['public.unit_domain','auth.unit_enum','public.custom_base','money','interval','JSONB','jsonb\n'])
     await run('tokens','unknown type '+type.trim(),()=>{refuseRow(type,'{"value":"private-canary"}','TYPE_UNSUPPORTED');
       refuseRow(type,'{"value":null}','TYPE_UNSUPPORTED');});
   for(const raw of ['{"value":1,"\\u0076alue":2}','{"value":null,"extra":"private-canary"}',
     '{"value":','[]'])await run('tokens','malformed row '+cases.length,()=>{refuseRow('json',raw,'ROW_UNSUPPORTED');});
   await run('tokens','explicit v2 discriminates SQL null/JSON null without legacy classification',()=>{
     for(const value of ['null','"null"','"[0:1]={NULL,1}"','"0.12345678901234567890"']){
       const raw='{"value":'+value+'}';assert.equal(api.assertRestoreRowMutationFidelity(line(raw,v2),descriptor('public.unit_domain',v2)),raw);}
     for(const tag of [null,'',v1+'\n','postgres-text-columns-line.v3'])
       assert.throws(()=>api.assertRestoreRowMutationFidelity(line('{"value":null}'),descriptor('json',tag)),e=>e.code===code);
   });
   await run('tokens','missing-tag legacy remains readable, never inferred to be v2',()=>{
     const table={columns:[{name:'value',data_type:'json'}]},raw='{"value":null}';
     assert.equal(decodeRestoreTableRowLine(raw,table),raw);assert.throws(()=>api.assertRestoreRowMutationFidelity(raw,table),e=>e.code===code);
     assert.equal(api.assertRestoreRowMutationFidelity('{"value":{"n":9007199254740993}}',table),'{"value":{"n":9007199254740993}}');
   });
   await run('source','empty-path original exact declaration binds built-in spelling',()=>{
     const tables=[{schema_name:'public',table_name:'unit',row_count:'1',columns:[{name:'x',data_type:'jsonb'},{name:'n',data_type:'numeric(40,20)'}]}];
     helpers.legacyOriginalColumnSources(tables,schema(tables));
     for(const altered of [schema(tables).replace("'', false","'public', false"),schema(tables).replace('"x" jsonb','"x" public.jsonb'),
       schema(tables).replace('"x" jsonb','"other" jsonb'),schema(tables)+schema(tables),
       schema(tables)+'DO $$begin null; end$$;',schema(tables)+'SET search_path=public;',schema(tables).replace('CREATE TABLE','CREATE TABLE ONLY'),
       schema(tables).replace('numeric(40,20)','numeric(20,10)'),schema(tables)+'CREATE TYPE pg_catalog.text;'])
       assert.throws(()=>helpers.legacyOriginalColumnSources(tables,altered));
   });
   await run('archive','actual signed nonnull JSON and duplicate rows retain exact source bytes through EOF',async()=>{
     const f=fixture({raws:['{"id":9223372036854775807,"value":{"n":9007199254740993,"n":2}}',
       '{"id":9223372036854775807,"value":{"n":9007199254740993,"n":2}}']});
     const before=hash(readFileSync(f.archive.directory+'/database/public.records.jsonl'));assert.ok(await scan(f)>10);
     assert.equal(hash(readFileSync(f.archive.directory+'/database/public.records.jsonl')),before);
   });
   for(const type of ['json','jsonb','integer[]','double precision','public.unit_domain'])await run('archive','late ambiguous authenticated row '+type,async()=>{
     const first=type==='json'||type==='jsonb'?'{"id":1,"value":{}}':'{"id":1,"value":null}';
     const bad=type==='json'||type==='jsonb'?'null':type==='integer[]'?'[1]':type==='double precision'?'0.1':'"private-canary"';
     await rejection(scan(fixture({type,raws:[first,'{"id":2,"value":'+bad+'}']})));
   });
   await run('archive','mixed v2 and later unsafe legacy member refuses all before effects',async()=>{
     await rejection(scan(fixture({encoding:v2,raws:['{"id":"1","value":"{}"}'],extra:[{name:'late_legacy',encoding:v1,raws:['{"id":1,"value":null}']}]})));
   });
   await run('archive','all empty legacy members require actual zero-byte EOF even with unknown column type',async()=>{
     assert.ok(await scan(fixture({raws:[],type:'public.unit_domain'}))>10);
     await rejection(scan(fixture({raws:[],type:'json',bytes:Buffer.from(line('{"id":1,"value":{}}')+'\n')})));
   });
   await run('archive','missing rows and extra rows do not adopt signed row_count as EOF',async()=>{
     for(const [declared,raws]of [['2',['{"id":1,"value":{}}']],['0',['{"id":1,"value":{}}']]])
       await rejection(scan(fixture({declared,raws})));
   });
   await run('archive','invalid UTF8/truncated original refuses without descriptor leaks',async()=>{
     for(const bytes of [Buffer.from([0xc3,0x28]),Buffer.from('"{\\"id\\":1')])await rejection(scan(fixture({bytes})));
   });
   await run('archive','source lifetime withdrawal and same-byte replacement are not cached',async()=>{
     for(const mode of ['withdraw','replace','rewrite']){
       const f=fixture();let once=false;
       await rejection(scan(f,n=>{if(n!==4||once)return;once=true;
         if(mode==='withdraw')f.archive.cleanup();else{
           const path=f.archive.directory+'/database/public.records.jsonl',bytes=readFileSync(path);
           if(mode==='replace'){renameSync(path,path+'.retired');writeFileSync(path,bytes);}else writeFileSync(path,bytes);
         }}));assert.equal(once,true);
     }
   });
   await run('archive','already-read earlier member cannot change while later member is consumed',async()=>{
     const f=fixture({extra:[{name:'later',raws:['{"id":1,"value":{}}']}]});let changed=false;
     await rejection(scan(f,()=>{if(changed)return;
       // The original opener is merely recorded; all streams/EOF remain real.
       const path=f.archive.directory+'/database/public.records.jsonl';
       if(lastOpened==='public.later'){changed=true;const bytes=readFileSync(path);renameSync(path,path+'.retired');writeFileSync(path,bytes);}
     }));assert.equal(changed,true);
   });
   await run('archive','genuine v2 catalog leaves existing typed route unchanged without new source inventory dependency',async()=>{
     const f=fixture({allV2:true,raws:['{"id":"1","value":null}']});
     renameSync(f.archive.directory+'/inventory/application-schema.sql',f.archive.directory+'/inventory/unavailable.sql');
     assert.equal(await scan(f),0); // Mandatory joins still check native/source; legacy scan has no v2 work.
   });
   await run('archive','forged archive never gains legacy pass',async()=>{
     const f=fixture();await rejection(helpers.requireLegacyOriginalDataFidelity({...f.archive},f.original,()=>helpers.sameSource({...f.archive},f.original)));
   });
   for(const withdrawAfter of [false,true])await run(withdrawAfter?'late-entry':'entries',withdrawAfter?
     'source withdrawal after successful EOF cannot become a cached entry permission':
     'actual fresh/direct prefixes gate first DDL/DML on full authenticated legacy scan',async()=>{
     const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
     const signatures=['stageVerifiedImmutableFreshData','stageVerifiedImmutablePrivateData'];
     for(const name of signatures)for(const unsafe of withdrawAfter?[false]:[true,false]){
       const f=fixture({raws:unsafe?['{"id":1,"value":{} }','{"id":2,"value":null}']:['{"id":1,"value":{}}']});
       const binding=f.original.sourceBinding,events=[],db=new pg.Client();
       const intent={archive_digest:binding.archive_digest,source_project_ref:binding.project_ref,target_project_ref:binding.project_ref,
         source_identity_sha256:binding.source_identity_sha256,authority_generation:1,actor:'UNIT local fixture',
         restore_id:'11111111-1111-4111-8111-111111111111',expires_at:new Date(Date.now()+3600000).toISOString()};
       const intentKey='UNIT-only-legacy-fidelity-INTENT-HMAC-20261018',intentId='unit-legacy-fidelity-intent-v1';
       const envelope={format:'memphis-zoo-production-restore-intent.v1',algorithm:'hmac-sha256',key_id:intentId,intent,
         signature:signBinding(restoreIntentBinding(intent),intentKey)};
       const begin=text.indexOf('export async function '+name+'('),stop=text.indexOf(name.endsWith('FreshData')?
         '  const initialized=await initializeVerifiedImmutableFreshSource(':'  const initial=await sql(',begin);
       assert.ok(begin>0&&stop>begin);
       const body=text.slice(begin,stop).replace('export async function','async function')+"\n events.push('first-effect');return; }\nreturn "+name+'(options);';
       const args={options:{db,verifiedArchive:f.archive,originalIntentEnvelope:envelope,intentVerifyKey:intentKey,intentVerifyKeyId:intentId},
         events,closed:(value,keys)=>{assert.deepEqual(Object.keys(value).sort(),keys.slice().sort());return value;},types,Client:pg.Client,query:pg.Client.prototype.query,
         captureFreshNativePort:()=>Object.freeze({}),sameFreshNativePort:()=>{},nativeData:()=> 'T',fail,freshClients:new WeakSet(),freshArchives:new WeakSet(),attempted:new WeakSet(),
         readVerifiedPrivateImportSource:api.readVerifiedPrivateImportSource,captureVerifiedImmutableFreshRestoreIntent:()=>Object.freeze({}),
         captureVerifiedOriginalRestoreIntent,readVerifiedImmutableFreshRestoreIntent:()=>({sourceBinding:binding,intent}),
         identities:['employee_message_original_outcomes','group_original_creations'],isDeepStrictEqual,postgresJsonTextLineEncoding:v1,postgresTextColumnsLineEncoding:v2,
         sameSource:helpers.sameSource,requireLegacyOriginalDataFidelity:async(...args)=>{
           await helpers.requireLegacyOriginalDataFidelity(...args);if(withdrawAfter)f.archive.cleanup();
         },
         assertVerifiedLegacyRestoreDataCurrent:api.assertVerifiedLegacyRestoreDataCurrent};
       const call=new AsyncFunction(...Object.keys(args),body)(...Object.values(args));
       if(withdrawAfter){await assert.rejects(call,e=>e.code==='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED');assert.deepEqual(events,[]);}
       else if(unsafe){await rejection(call);assert.deepEqual(events,[]);}else{await call;assert.deepEqual(events,['first-effect']);}
       noFds(f.archive);
     }
   });
   console.log(JSON.stringify({selector:'--legacy-original-fidelity-only',part:part||'all',status:'PASS_NEW_SOURCE_AND_UNIT_ARCHIVE_CASES',
     count:cases.length,cases,native_SQL:'NOT_RUN',native_admission:'NOT_RUN',authority:false,old_groups_replayed:0,resources:0}));
 }finally{for(const archive of archives)archive.cleanup();rmSync(work,{recursive:true,force:true});}
 process.exit(0);
}

// Exact correction of the NEW local fixture producer's directory labels.
// No database work, old group replay, row rewrite or accepting verifier stub.
if(process.argv.includes('--auth-complete-original-producer-path-only')||process.argv.includes('--auth-complete-original-release-identity-only')){
 const releaseOnly=process.argv.includes('--auth-complete-original-release-identity-only');
 const {dirname}=await import('node:path');
 const {readVerifiedPrivateImportSource}=await import('./disaster-recovery-archive.mjs');
 const root='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/';
 const seed=root+(releaseOnly?'auth-complete-original-producer-path-v75':'auth-complete-unit-archive-v74-8818r8/new-auth-complete-original');
 const destination=root+(releaseOnly?'auth-complete-original-release-row-v76':'auth-complete-original-producer-path-v75');
 const key='UNIT-only-auth-complete-original-HMAC-20261017',keyId='unit-auth-complete-original-v1';
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
 const originalSums=readFileSync(seed+'/SHA256SUMS');
 assert.equal(hash(originalSums),releaseOnly?'263c20d0b7f3ab7127a6984d0310363e3fc7de522e63653e06e5fedd36e95f72':'75ba3af66edb8f63126abf6f912332bb47219fef7d876accee84480fa3dc16cc');
 if(!releaseOnly)assert.equal(hash(readFileSync(seed+'/archive-signature.json')),'5ccfa5eba59da5f557d87490edb591ec1a9639a14a8befbe3f27fe8c9260abe6');
 assert.equal(existsSync(destination),false,'Never overwrite an earlier UNIT original');
 const original=materializeVerifiedArchive({sourceDir:seed,archiveVerifyKey:key,archiveVerifyKeyId:keyId,
  supportedFormats:['memphis-zoo-disaster-recovery.v4'],requiredEntries:['backup-summary.json','inventory/table-catalog.json']});
 let verified;
 try{
  const signed=new Map(originalSums.toString().trimEnd().split('\n').map(line=>[line.slice(66),line.slice(0,64)]));
  const files=new Map();
  for(const name of original.checksumPaths){
   const bytes=readFileSync(original.directory+'/'+name);assert.equal(hash(bytes),signed.get(name));files.set(name,bytes);
  }
  const catalog=JSON.parse(files.get('inventory/table-catalog.json')),summary=JSON.parse(files.get('backup-summary.json'));
  assert.equal(catalog.length,302);assert.equal(summary.fixture_only,true);assert.equal(summary.actual_deployment,false);
  let count=0,totalRows=0;const byteBindings=[];
  for(const table of catalog){
   const from=(releaseOnly?'database/':'data/')+table.schema_name+'.'+table.table_name+'.jsonl',to='database/'+table.schema_name+'.'+table.table_name+'.jsonl';
   assert.equal(table.data_file,from);if(!releaseOnly)assert.equal(files.has(to),false);assert.ok(files.has(from));
   const bytes=files.get(from);assert.equal(hash(bytes),signed.get(from));if(!releaseOnly){files.delete(from);files.set(to,bytes);table.data_file=to;}
   byteBindings.push({from,to,sha256:hash(bytes),bytes:bytes.length,row_count:table.row_count});count++;totalRows+=Number(table.row_count);
  }
  assert.equal(count,302);assert.equal(totalRows,summary.database_row_count);
  files.set('inventory/table-catalog.json',json(catalog));
  summary.source_identity.database_catalog_sha256=hash(files.get('inventory/table-catalog.json'));
  if(releaseOnly){
   const {readProductionBackupOriginalRelease}=await import('./production-backup-original-metadata.mjs');
   const release=catalog.find(table=>table.schema_name==='public'&&table.table_name==='release_deployment_manifest');
   assert.equal(release.row_count,'1');const raw=JSON.parse(files.get(release.data_file).toString().trimEnd());
   const actual=readProductionBackupOriginalRelease({command:'SELECT',rowCount:1,rows:[{original_row:raw}]});
   assert.equal(actual.release_id,summary.source_identity.release.release_id);
   assert.equal(actual.backend_commit,summary.source_identity.release.backend_commit);
   assert.equal(actual.migration_manifest_sha256,summary.source_identity.release.migration_manifest_sha256);
   summary.source_identity.release=actual;
  }
  const provenance=JSON.parse(files.get('inventory/fixture-provenance.json'));
  provenance[releaseOnly?'original_release_row_correction':'producer_path_correction']={original_archive_digest:hash(originalSums),
   kind:releaseOnly?'FULL_NATIVE_RELEASE_ROW_WITH_MICROSECONDS_AND_RECOVERY_COLUMN':'REQUIRED_PRODUCER_DATABASE_DIRECTORY',
   database_rows_modified:0,database_SQL_reexecuted:false,old_original_modified:false};
  files.set('inventory/fixture-provenance.json',json(provenance));files.set('backup-summary.json',json(summary));
  mkdirSync(destination,{mode:0o700});
  for(const [name,bytes]of files){mkdirSync(dirname(destination+'/'+name),{recursive:true,mode:0o700});
   writeFileSync(destination+'/'+name,bytes,{flag:'wx',mode:0o600});}
  const sums=Buffer.from([...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,bytes])=>hash(bytes)+'  '+name).join('\n')+'\n');
  writeFileSync(destination+'/SHA256SUMS',sums,{flag:'wx',mode:0o600});const digest=hash(sums);
  writeFileSync(destination+'/archive-signature.json',json({format:'memphis-zoo-disaster-recovery-signature.v1',algorithm:'hmac-sha256',key_id:keyId,
   archive_digest:digest,signature:signBinding(archiveSignatureBinding({archiveDigest:digest,projectRef:summary.project_ref,
    sourceIdentity:summary.source_identity,archiveFormat:summary.format}),key)}),{flag:'wx',mode:0o600});
  verified=materializeVerifiedArchive({sourceDir:destination,archiveVerifyKey:key,archiveVerifyKeyId:keyId,
   supportedFormats:['memphis-zoo-disaster-recovery.v4'],requiredEntries:['backup-summary.json','inventory/table-catalog.json']});
  const source=readVerifiedPrivateImportSource(verified);
  assert.equal(source.sourceBinding.archive_digest,digest);assert.equal(source.selection.databaseTables.length,302);
  assert.equal(source.selection.privateTables.length,2);
  assert.ok(source.selection.databaseTables.some(table=>table.schema_name==='auth'&&table.table_name==='sessions'&&table.row_count==='1'));
  for(const binding of byteBindings)assert.equal(hash(readFileSync(verified.directory+'/'+binding.to)),binding.sha256);
  const receipt={scope:releaseOnly?'NEW_UNIT_ORIGINAL_NATIVE_RELEASE_ROW_METADATA_CORRECTION_NO_SQL_OR_RESTORE':'NEW_UNIT_ORIGINAL_PRODUCER_PATH_CORRECTION_ACTUAL_VERIFIED_ARCHIVE_NO_SQL_OR_RESTORE',destination,archive_digest:digest,
   original_archive_digest:hash(originalSums),table_count:302,rows:totalRows,original_DATA_byte_bindings:byteBindings,
   private_table_count:2,auth_session_originals:1,only_metadata_changes:releaseOnly?['summary exact original release row','fixture provenance']:['table-catalog data_file labels','summary catalog digest','fixture provenance'],
   disposable_UNIT_HMAC:true,APK_signing:false,real_keys:false,production:false,restore_executed:false,authority_effects:false,old_groups_replayed:0};
  writeFileSync(root+(releaseOnly?'AUTH_COMPLETE_ORIGINAL_RELEASE_ROW_RESULT_20261017.json':'AUTH_COMPLETE_ORIGINAL_PRODUCER_PATH_RESULT_20261017.json'),json(receipt),{flag:'wx',mode:0o600});
  assert.equal(hash(readFileSync(seed+'/SHA256SUMS')),hash(originalSums));
  console.log(JSON.stringify({scope:receipt.scope,destination,archive_digest:digest,table_count:302,rows:totalRows,
   same_original_DATA_files:count,actual_SQL:0,restore:false,authority_effects:false}));
 }finally{if(verified)verified.cleanup();original.cleanup();}
 process.exit(0);
}

// Newly affected outer archive-owner lifetime only. No materialization,
// verification/signature stub, real restore body, pgClient or SQL execution.
if(process.argv.includes("--restore-archive-lifetime-only")){
 const source=readFileSync(new URL("./production-restore.mjs",import.meta.url),"utf8");
 const start=source.indexOf("const cleanupVerifiedArchive = verifiedArchive.cleanup;");
 const body=source.indexOf("const sourceDir = verifiedArchive.directory;",start);
 const innerEnd=source.lastIndexOf("  })();");
 const acquired=source.indexOf("const verifiedArchive = materializeVerifiedArchive({");
 assert.ok(acquired>=0&&start>acquired&&body>start&&innerEnd>body);
 assert.ok(source.slice(acquired,start).trimEnd().endsWith("});"),"Owner lifetime must start only after materializer returns");
 assert.equal(source.slice(0,acquired).includes("cleanupVerifiedArchive"),false);
 assert.equal(source.includes("process.exit("),false);
 const outer=source.slice(start,body)+"return await inertBody(verifiedArchive);\n"+source.slice(innerEnd);
 for(const forbidden of ["signBinding","materializeVerifiedArchive(","db.query","new Client","rmSync","sourceInputDir"])
  assert.equal(outer.includes(forbidden),false);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const execute=new AsyncFunction("verifiedArchive","inertBody","console",outer);
 const cases=[];let getters=0;
 const marker=()=>new Error("Synthetic archive lifetime failure");
 async function invoke(options={}){
  const order=[],logs=[],counts={cleanup:0,emit:0};let caught=false,error,settled=false;
  const archive={cleanup:async function(...args){
   assert.equal(this,archive);assert.deepEqual(args,[]);
   counts.cleanup++;order.push("archive:start");await Promise.resolve();order.push("archive:settled");settled=true;
   if(Object.hasOwn(options,"cleanupError"))throw options.cleanupError;
  }};
  try{
   await execute(archive,async original=>{
    assert.equal(original,archive);order.push("body");
    if(options.withdrawCleanup)Object.defineProperty(archive,"cleanup",{get(){getters++;throw marker();}});
    if(Object.hasOwn(options,"bodyError"))throw options.bodyError;
    return options.body?await options.body(order):"UNSIGNED_INERT_APPLY_OUTPUT";
   },{log(value){assert.equal(settled,true);counts.emit++;order.push("emit");logs.push(value);}});
  }catch(observed){caught=true;error=observed;}
  return {order,logs,counts,caught,error};
 }
 const noOutput=value=>{assert.equal(value.caught,true);assert.equal(value.counts.emit,0);assert.deepEqual(value.logs,[]);
  assert.equal(value.counts.cleanup,1);};
 {
  const result=await invoke({withdrawCleanup:true});
  assert.equal(result.caught,false);assert.deepEqual(result.logs,["UNSIGNED_INERT_APPLY_OUTPUT"]);
  assert.deepEqual(result.order,["body","archive:start","archive:settled","emit"]);
  assert.deepEqual(result.counts,{cleanup:1,emit:1});
  cases.push("one captured owner cleanup with original receiver settles before sole emission");
 }
 const dryStart=source.indexOf("if (!apply) {",body),dryEnd=source.indexOf("\nif (!databaseUrl)",dryStart);
 assert.ok(dryStart>body&&dryEnd>dryStart);
 const dry=source.slice(dryStart,dryEnd);
 const dryRun=new AsyncFunction("apply","archiveDigest","archiveAdmission","tableSelection","privateImportBlocker",
  "immutableBootstrapPreparation","summary","catalog","buckets","objects",dry+'\nthrow Error("Inert apply branch must not run");');
 const drySummary={project_ref:"INERT_PROJECT",source_identity:{fixture:"DATA_ONLY"},database_row_count:0};
 const expectedDry={ok:true,dry_run:true,archive_verified:true,archive_signature_verified:true,archive_digest:"INERT_DIGEST",
  restore_compatible:true,archive_format_restore_compatible:true,selected_database_tables:0,selected_private_tables:0,
  data_import_blocker:null,historical_verification_only:false,project_ref_in_archive:"INERT_PROJECT",
  source_identity:drySummary.source_identity,tables:0,rows:0,storage_buckets:0,storage_objects:0};
 const inertDry=()=>dryRun(false,"INERT_DIGEST",{restore_compatible:true,historical_verification_only:false},
  {databaseTables:[],privateTables:[]},null,null,drySummary,[],[],[]);
 {
  const result=await invoke({body:inertDry});
  assert.equal(result.caught,false);assert.deepEqual(result.logs,[JSON.stringify(expectedDry,null,2)]);
  assert.deepEqual(result.order,["body","archive:start","archive:settled","emit"]);
  cases.push("actual dry-run packaging returns without exit and retains exact inert output bytes");
 }
 for(const mode of ["early-validation","preconnect-private-hold","managed-apply"]){
  const primary=marker(),result=await invoke({bodyError:primary});noOutput(result);assert.equal(result.error,primary);
  cases.push(mode+" inert failure closes owner once with primary intact");
 }
 for(const primary of [undefined,null,0,""]){
  const cleanup=marker(),result=await invoke({bodyError:primary,cleanupError:cleanup});
  noOutput(result);assert.ok(result.error instanceof AggregateError);
  assert.equal(result.error.cause,primary);assert.equal(result.error.errors.length,2);
  assert.equal(result.error.errors[0],primary);assert.equal(result.error.errors[1],cleanup);
  cases.push("primitive original failure retained alongside cleanup failure ("+String(typeof primary)+")");
 }
 {
  const primary=Object.create(null),cleanup=Object.create(null);
  for(const value of [primary,cleanup]){
   Object.defineProperty(value,"message",{get(){getters++;throw marker();}});
   Object.defineProperty(value,"toJSON",{get(){getters++;throw marker();}});
  }
  const result=await invoke({bodyError:primary,cleanupError:cleanup});noOutput(result);
  assert.equal(result.error.errors[0],primary);assert.equal(result.error.errors[1],cleanup);
  assert.equal(result.error.message,"Production restore failed; verified archive cleanup also failed.");
  cases.push("failure aggregation does not inspect caller getters or serialize private body/output");
 }
 {
  const cleanup=marker(),result=await invoke({body:inertDry,cleanupError:cleanup});
  noOutput(result);assert.equal(result.error,cleanup);
  cases.push("dry-run cleanup failure refuses successful output");
 }
 // Keep and execute only the EXISTING managed-client cleanup Source with
 // inert locks=false and recording native end; ALL actual restore IO is absent.
 const managedStart=source.indexOf("const endRestoreClient = Client.prototype.end;",body);
 const managedTry=source.indexOf("try {\n  await db.connect();",managedStart);
 const managedCatch=source.indexOf("} catch (error) {\n  restoreLifecycleFailed = true;",managedTry);
 assert.ok(managedStart>body&&managedTry>managedStart&&managedCatch>managedTry&&managedCatch<innerEnd);
 const managed=source.slice(managedStart,managedTry)+"try {\n  restoreSuccessOutput = await inertManagedBody();\n"
  +source.slice(managedCatch,innerEnd);
 const finishClient=new AsyncFunction("Client","db","mutationFenceHeld","inertManagedBody",managed);
 for(const failed of [false,true]){
  const endFailure=marker(),cleanupFailure=marker();
  const result=await invoke({...(failed?{cleanupError:cleanupFailure}:{}),body:async order=>{
   function Client(){}
   const db={query(){throw Error("No lock or SQL fixture exists");}};
   Object.defineProperty(db,"end",{get(){getters++;throw marker();}});
   Client.prototype.end=async function(){
    assert.equal(this,db);order.push("native:end:start");await Promise.resolve();order.push("native:end:settled");
    if(failed)throw endFailure;
   };
   return finishClient(Client,db,false,async()=>"INERT_CLIENT_OUTPUT");
  }});
  if(failed){noOutput(result);assert.equal(result.error.errors[0],endFailure);assert.equal(result.error.errors[1],cleanupFailure);}
  else{assert.equal(result.caught,false);assert.deepEqual(result.logs,["INERT_CLIENT_OUTPUT"]);}
  assert.ok(result.order.indexOf("native:end:settled")<result.order.indexOf("archive:start"));
  cases.push("existing managed native end settles before owner cleanup ("+(failed?"failure":"success")+")");
 }
 assert.equal(getters,0);
 console.log(JSON.stringify({scope:"NEW production restore owned archive lifetime",status:"PASS_INERT_SOURCE_LIFETIME_ONLY",
  cases,count:cases.length,caller_getters:getters,materializations:0,signatures:0,keys_retrieved:0,
  actual_restore_body:"NOT_RUN",SQL:"NOT_RUN",native_clients:0,resources:0,
  limits:"Exact outer wrapper/dry-run packaging and existing managed cleanup Source with inert inputs only; no signed archive, filesystem deletion, SQL, client or restore-authority proof."}));
 process.exit(0);
}

// New shipping fresh-staging orchestration only. Actual callable Source with
// inert dependency recording: no signature creation, SQL or authority proof.
if(process.argv.includes('--immutable-fresh-data-composition-only')){
  const {types,isDeepStrictEqual}=await import('node:util'),{default:pg}=await import('pg');
  const text=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
  const start=text.indexOf('export async function stageVerifiedImmutableFreshData('),end=text.indexOf('// Stage and finish ONLY',start);
  assert.ok(start>0&&end>start);const body=text.slice(start,end).replace('export async function','async function');
  const keys=['database_oid','backend_pid','transaction_id','restore_id','authority_generation','archive_digest'];
  const closed=(v,k)=>{assert.ok(v&&Object.getPrototypeOf(v)===Object.prototype);assert.deepEqual(Reflect.ownKeys(v).sort(),k.slice().sort());return v;};
  const modes=['valid','duplicate','fake-client','bad-intent','unsupported-private','wrong-encoding','source-withdraw',
    'initializer-authority','foreign-control','foreign-import','wrong-count','resume-import','source-after-import'];
  for(const mode of modes){
    const events=[],db=new pg.Client(),archive={},binding=Object.freeze({archive_digest:'a'.repeat(64)});
    const rawEnvelope={intent:{restore_id:'11111111-1111-1111-1111-111111111111',authority_generation:1}};
    const envelope=structuredClone(rawEnvelope);Object.freeze(envelope.intent);Object.freeze(envelope);
    const original={sourceBinding:binding,selection:{privateTables:[{table_name:'employee_message_original_outcomes'},
      {table_name:mode==='unsupported-private'?'unknown_original':'group_original_creations'}]},
      privateDataMembers:[{row_count:'1',data_encoding:mode==='wrong-encoding'?'unknown':postgresJsonTextLineEncoding},
        {row_count:'1',data_encoding:postgresJsonTextLineEncoding}]};
    const token={};let withdrawn=false;
    const witness={database_oid:'5',backend_pid:411,transaction_id:'1285',restore_id:envelope.intent.restore_id,
      authority_generation:'1',archive_digest:binding.archive_digest};
    const initialize=async()=>{events.push('initialize');rawEnvelope.intent.restore_id='changed-caller';
      if(mode==='source-withdraw')withdrawn=true;
      return{schema:'custodial.immutable-private-source-initialized.v1',database_oid:'5',backend_pid:411,transaction_id:'1285',
        guard_recipes:23,source_statements:9,initialized_source_only:true,transaction_authority:mode==='initializer-authority',
        restore_complete:false,admission_resumed:false};};
    const prepare=async()=>{events.push('prepare');return{...witness,...(mode==='foreign-control'?{backend_pid:99}:{})};};
    const importer=async options=>{events.push('import');assert.equal(options.originalIntentEnvelope,envelope);
      assert.equal(options.originalIntentEnvelope.intent.restore_id,witness.restore_id);
      if(mode==='source-after-import')withdrawn=true;
      return{...witness,...(mode==='foreign-import'?{transaction_id:'2000'}:{}),private_rows:mode==='wrong-count'?'1':'2',
        transaction_authority:false,admission_resumed:mode==='resume-import'};};
    const make=new Function('Client','query','types','isDeepStrictEqual','closed','fail','readVerifiedPrivateImportSource',
      'sameSource','captureVerifiedImmutableFreshRestoreIntent','readVerifiedImmutableFreshRestoreIntent',
      'initializeVerifiedImmutableFreshSource','prepareVerifiedImmutableFreshRestoreControl',
      'stageVerifiedImmutablePrivateData','witnessKeys','identities','postgresJsonTextLineEncoding',
      'const freshClients=new WeakSet(),freshArchives=new WeakSet(),freshStaged=new WeakMap();'+body+'return stageVerifiedImmutableFreshData;');
    const stage=make(pg.Client,pg.Client.prototype.query,types,isDeepStrictEqual,closed,()=>{throw Error('REFUSED');},
      ()=>original,()=>{if(withdrawn)throw Error('WITHDRAWN');},()=>{events.push('capture');if(mode==='bad-intent')throw Error('BAD_INTENT');return token;},
      value=>{assert.equal(value,token);return{intent:envelope.intent,envelope,sourceBinding:binding};},initialize,prepare,importer,
      keys,['employee_message_original_outcomes','group_original_creations'],postgresJsonTextLineEncoding);
    const options={db:mode==='fake-client'?{query(){}}:db,verifiedArchive:archive,originalIntentEnvelope:rawEnvelope,
      intentVerifyKey:'UNIT-only-never-used-for-signing-1234',intentVerifyKeyId:'unit-existing-only'};
    if(['valid','duplicate'].includes(mode)){
      const result=await stage(options);assert.ok(Object.isFrozen(result));assert.equal(result.private_rows,'2');
      assert.equal(result.restore_complete,false);assert.equal(result.transaction_authority,false);
      assert.deepEqual(events,['capture','initialize','prepare','import']);
      if(mode==='duplicate'){await assert.rejects(()=>stage(options));assert.equal(events.length,4);}
    }else{
      await assert.rejects(()=>stage(options));
      if(mode==='fake-client')assert.deepEqual(events,[]);
      if(['bad-intent','unsupported-private','wrong-encoding'].includes(mode))assert.deepEqual(events,['capture']);
      if(['source-withdraw','initializer-authority'].includes(mode))assert.deepEqual(events,['capture','initialize']);
      if(mode==='foreign-control')assert.deepEqual(events,['capture','initialize','prepare']);
    }
  }
  console.log(JSON.stringify({scope:'NEW_FRESH_STAGING_CALLER_COMPOSITION_RECORDING_ONLY',new_groups:modes.length,
    crypto_and_SQL:'NOT_RUN',signing:'NOT_RUN',authority:'NONE',existing_private_importer_body_changed:false}));
  process.exit(0);
}

// New private stage -> metadata record -> single COMMIT control flow only.
// Exact shipping Source, inert dependencies/recording class, not native SQL.
if(process.argv.includes('--immutable-fresh-commit-composition-only')||process.argv.includes('--immutable-fresh-commit-withdrawn-request-only')){
  const {types,isDeepStrictEqual}=await import('node:util');
  const text=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
  const start=text.indexOf('export async function stageVerifiedImmutableFreshData('),end=text.indexOf('// Stage and finish ONLY',start);
  assert.ok(start>0&&end>start);const body=text.slice(start,end).replaceAll('export async function','async function');
  const keys=['database_oid','backend_pid','transaction_id','restore_id','authority_generation','archive_digest'];
  const closed=(value,names)=>{assert.ok(value&&Object.getPrototypeOf(value)===Object.prototype);
    assert.deepEqual(Reflect.ownKeys(value).sort(),names.slice().sort());return value;};
  function fixture(mode='ack'){
    const calls=[],archive={},binding=Object.freeze({archive_digest:'a'.repeat(64)}),token={};let withdrawn=false,release;
    const intent=Object.freeze({restore_id:'11111111-1111-1111-1111-111111111111',authority_generation:1,target_project_ref:'abcdefghijklmnopqrst'});
    const envelope=Object.freeze({intent}),original={sourceBinding:binding,
      selection:{privateTables:[{table_name:'employee_message_original_outcomes'},{table_name:'group_original_creations'}]},
      privateDataMembers:[{row_count:'1',data_encoding:postgresJsonTextLineEncoding},{row_count:'1',data_encoding:postgresJsonTextLineEncoding}]};
    const witness={database_oid:'5',backend_pid:411,transaction_id:'1285',restore_id:intent.restore_id,
      authority_generation:'1',archive_digest:binding.archive_digest};
    const imported=Object.freeze({...witness,private_rows:'2',transaction_authority:false,admission_resumed:false});
    class RecordingClient{async query(sql){calls.push(sql);assert.equal(sql,'COMMIT');
      if(mode==='lost')throw Error('PRIVATE_FIXTURE_ERROR_MUST_NOT_ESCAPE');
      if(mode==='withdraw-commit')withdrawn=true;
      if(mode==='proxy-receipt')return new Proxy({},{ownKeys(){throw Error('Receipt proxy must not run');}});
      return{command:mode==='rollback-tag'?'ROLLBACK':'COMMIT',rowCount:null,rows:[]};}}
    const db=new RecordingClient();
    const make=new Function('Client','query','types','isDeepStrictEqual','closed','fail','readVerifiedPrivateImportSource','sameSource',
      'captureVerifiedImmutableFreshRestoreIntent','readVerifiedImmutableFreshRestoreIntent','initializeVerifiedImmutableFreshSource',
      'prepareVerifiedImmutableFreshRestoreControl','stageVerifiedImmutablePrivateData','recordVerifiedImmutableFreshDatabaseEvidence',
      'readVerifiedImmutableFreshCommitRecord','witnessKeys','identities','postgresJsonTextLineEncoding',
      'const freshClients=new WeakSet(),freshArchives=new WeakSet(),freshStaged=new WeakMap();'+body+
      'return{stage:stageVerifiedImmutableFreshData,commit:commitVerifiedImmutableFreshData};');
    const api=make(RecordingClient,RecordingClient.prototype.query,types,isDeepStrictEqual,closed,()=>{throw Error('REFUSED');},
      ()=>original,()=>{if(withdrawn)throw Error('SOURCE_WITHDRAWN');},()=>token,()=>({intent,envelope,sourceBinding:binding}),
      async()=>({schema:'custodial.immutable-private-source-initialized.v1',...witness,guard_recipes:23,source_statements:9,
        initialized_source_only:true,transaction_authority:false,restore_complete:false,admission_resumed:false}),
      async()=>({...witness}),async()=>imported,
      async()=>{calls.push('record');if(mode==='record-failure')throw Error('PRIVATE_FIXTURE_ERROR_MUST_NOT_ESCAPE');
        if(mode==='withdraw-record')withdrawn=true;if(mode==='concurrent')await new Promise(resolve=>{release=resolve;});return{};},
      async()=>{calls.push('read-record');return mode==='wrong-original'?{...imported,transaction_id:'2000'}:imported;},
      keys,['employee_message_original_outcomes','group_original_creations'],postgresJsonTextLineEncoding);
    const stage=()=>api.stage({db,verifiedArchive:archive,originalIntentEnvelope:envelope,intentVerifyKey:'UNIT-unused',intentVerifyKeyId:'UNIT-unused'});
    const commit=(selectedDb=db,selectedArchive=archive)=>api.commit({db:selectedDb,verifiedArchive:selectedArchive});
    return{api,db,archive,calls,stage,commit,otherDb:()=>new RecordingClient(),release:()=>release(),withdraw:()=>{withdrawn=true;}};
  }
  let groups=0;
  const withdrawnOnly=process.argv.includes('--immutable-fresh-commit-withdrawn-request-only');
  for(const mode of (withdrawnOnly?['before-commit-withdraw']:['ack','lost','rollback-tag','proxy-receipt','withdraw-commit','record-failure','withdraw-record','wrong-original'])){
    const f=fixture(mode);await f.stage();
    if(mode==='before-commit-withdraw')f.withdraw();
    if(mode==='ack'){
      const result=await f.commit();assert.equal(result.commit_status,'ACKNOWLEDGED');assert.equal(result.complete_restore,false);
      assert.equal(result.retry_allowed,false);assert.equal(result.resume_allowed,false);assert.ok(Object.isFrozen(result.requested_original));
      assert.deepEqual(f.calls,['record','read-record','COMMIT']);
    }else{
      const attempted=['lost','rollback-tag','proxy-receipt','withdraw-commit'].includes(mode);
      await assert.rejects(()=>f.commit(),error=>error.code===(attempted?'IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN':'IMMUTABLE_PRIVATE_DATA_COMMIT_NOT_ADMITTED')
        &&error.outcome==='UNKNOWN'&&error.retry_safe===false&&error.commit_attempted===attempted
        &&error.requested_original.restoreId==='11111111-1111-1111-1111-111111111111'
        &&!error.message.includes('PRIVATE_FIXTURE_ERROR'));
      assert.equal(f.calls.filter(value=>value==='COMMIT').length,attempted?1:0);
    }
    const before=f.calls.length;await assert.rejects(()=>f.commit());assert.equal(f.calls.length,before,'No second commit or record');groups++;
  }
  if(!withdrawnOnly){
  const unstaged=fixture();await assert.rejects(()=>unstaged.commit());assert.deepEqual(unstaged.calls,[]);groups++;
  const foreign=fixture();await foreign.stage();await assert.rejects(()=>foreign.commit(foreign.otherDb()));
  await assert.rejects(()=>foreign.commit(foreign.db,{}));assert.deepEqual(foreign.calls,[]);groups++;
  const concurrent=fixture('concurrent');await concurrent.stage();const original=concurrent.commit();
  await assert.rejects(()=>concurrent.commit());assert.deepEqual(concurrent.calls,['record']);concurrent.release();await original;
  assert.deepEqual(concurrent.calls,['record','read-record','COMMIT']);groups++;
  }
  console.log(JSON.stringify({scope:'NEW_FRESH_COMMIT_PRIVATE_STATE_RECORDING_ONLY',groups,SQL:'NOT_RUN',
    signatures_created:0,authority:'NONE',limits:'Exact caller Source/inert recording class; not real pg, valid intent, SQL or durable commit proof.'}));
  process.exit(0);
}

if(process.argv.includes('--immutable-fresh-commit-context-source-only')){
  const {types}=await import('node:util');
  const text=readFileSync(new URL('./immutable-private-fresh-restore-commit-context.mjs',import.meta.url),'utf8');
  const start=text.indexOf('const Client=pg.Client,');assert.ok(start>0);
  const body=text.slice(start).replaceAll('export async function','async function');
  let groups=0,getters=0;
  for(const mode of ['preparation','recorded','phase','shape','expired','foreign-original','foreign-control','partial-marker',
    'history','source-withdraw','final-xid','original-xid','getter-row']){
    const recorded=mode==='recorded'||mode==='partial-marker',calls=[],archive={},token={};let sourceWithdrawn=false;
    const release={release_id:'UNIT_ONLY',backend_commit:'a'.repeat(40),frontend_commit:'b'.repeat(40),
      migration_head:'20261016143226',migration_manifest_sha256:'c'.repeat(64)};
    const binding={archive_digest:'d'.repeat(64),source_identity_sha256:'e'.repeat(64),project_ref:'abcdefghijklmnopqrst',source_identity:{release}};
    const intent={restore_id:'11111111-1111-1111-1111-111111111111',authority_generation:1,target_project_ref:binding.project_ref,
      target_migration_head:release.migration_head,target_release_identity:release,actor:'UNIT recorded context',expires_at:'2026-10-17T12:00:00.000Z'};
    const original={sourceBinding:binding,selection:{databaseTables:[]},privateDataMembers:[{row_count:'1'},{row_count:'1'}]};
    const captured=Object.freeze({intent,envelope:{intent},sourceBinding:binding});
    const witness={database_oid:'5',backend_pid:411,transaction_id:'1285',restore_id:intent.restore_id,
      authority_generation:'1',archive_digest:binding.archive_digest};
    const control={singleton:true,authority_generation:1,mutations_paused:true,state:'PREPARING',restore_id:intent.restore_id,
      archive_digest:binding.archive_digest,source_project_ref:binding.project_ref,target_project_ref:intent.target_project_ref,
      release_identity:{archive:release,target:release,retry_of_restore_id:null},started_by:intent.actor,
      started_at:'2026-10-17T10:00:00.000Z',completed_at:null,failure_reason:null,updated_at:'2026-10-17T10:00:00.000Z'};
    const evidence={database:{original_data_import:'INERT_RECORDING'},event:{original_data_import:'INERT_RECORDING'}};
    const ctx={...witness,phase:'FINISHED',active_table_oid:null,active_row_sha256:null,shape_matches:true,unexpired:true,private_rows:'2',
      original_control:structuredClone(control),original_manifest:{schema:'custodial.immutable-private-import-manifest.v1',archive_digest:binding.archive_digest,
        source_identity_sha256:binding.source_identity_sha256,source_project_ref:binding.project_ref,target_project_ref:intent.target_project_ref,
        actor:intent.actor,expires_at:intent.expires_at,target_migration_head:intent.target_migration_head,target_release_identity:release,
        catalog:original.selection.databaseTables,private_data_members:original.privateDataMembers}};
    const row={actor:'supabase_admin',session_actor:'supabase_admin',read_only:'off',row_security:'off',replication:'origin',search_path:'pg_catalog',
      context_count:1,import_context:ctx,control_count:1,control:{...control,state:recorded?'DATABASE_RESTORED':'PREPARING'},manifest_count:1,
      manifest:{restore_id:intent.restore_id,authority_generation:'1',archive_digest:binding.archive_digest,database_verified:recorded,
        storage_verified:false,authority_invalidated:false,post_restore_verified:false,database_evidence:recorded?evidence.database:{},
        storage_evidence:{},authority_evidence:{},final_manifest_sha256:null,reconciliation_manifest_sha256:null},
      events:recorded?[{restore_id:intent.restore_id,authority_generation:'1',phase:'DATABASE',outcome:'PASSED',actor:intent.actor,evidence_json:evidence.event}]:[]};
    if(mode==='phase')ctx.phase='STAGING';if(mode==='shape')ctx.shape_matches=false;if(mode==='expired')ctx.unexpired=false;
    if(mode==='foreign-original')ctx.restore_id='22222222-2222-2222-2222-222222222222';
    if(mode==='foreign-control')row.control.mutations_paused=false;
    if(mode==='partial-marker')row.manifest.database_verified=false;if(mode==='history')row.context_count=2;
    if(mode==='getter-row')Object.defineProperty(row,'import_context',{enumerable:true,get(){getters++;return ctx;}});
    class RecordingClient{async query(sql){calls.push(sql.startsWith('with owner_guard')?'fence':'context');
      if(sql.startsWith('with owner_guard'))return{rowCount:1,rows:[{database_oid:'5',backend_pid:411,
        transaction_id:mode==='original-xid'?'0':mode==='final-xid'&&calls.length===3?'1286':'1285'}]};
      assert.ok(sql.includes('context_count')&&sql.includes('immutable_import_target_shape()'));
      if(mode==='source-withdraw')sourceWithdrawn=true;return{rowCount:1,rows:[row]};}}
    const db=new RecordingClient(),make=new Function('assert','types','pg','readVerifiedPrivateImportSource',
      'readVerifiedImmutableFreshRestoreIntent','buildVerifiedImmutableFreshDatabaseEvidence',body+
      '\nreturn{pre:readVerifiedImmutableFreshCommitPreparation,record:readVerifiedImmutableFreshCommitRecord};');
    const api=make(assert,types,{Client:RecordingClient},()=>original,()=>{if(sourceWithdrawn)throw Error('WITHDRAWN');return captured;},()=>evidence);
    const read=()=>recorded?api.record({db,verifiedArchive:archive,freshIntent:token}):api.pre({db,verifiedArchive:archive,freshIntent:token});
    if(['preparation','recorded'].includes(mode)){
      const result=await read();assert.deepEqual(result,{...witness,private_rows:'2',transaction_authority:false,admission_resumed:false});
      assert.ok(Object.isFrozen(result));assert.deepEqual(calls,['fence','context','fence']);
    }else await assert.rejects(read,error=>error.code==='IMMUTABLE_FRESH_COMMIT_CONTEXT_UNAVAILABLE'&&error.retry_safe===false);
    groups++;
  }
  assert.equal(getters,0);
  console.log(JSON.stringify({scope:'NEW_FINISHED_COMMIT_CONTEXT_SOURCE_RECORDING_ONLY',groups,getters,
    SQL:'NOT_RUN',valid_tokens_created:0,signatures_created:0,authority:'NONE'}));
  process.exit(0);
}

if(process.argv.includes('--immutable-fresh-commit-unstaged-native-only')){
  const {default:pg}=await import('pg');
  const {commitVerifiedImmutableFreshData}=await import('./immutable-private-data-import.mjs');
  const db=new pg.Client({host:'127.0.0.1',port:1,database:'mz_schema_rebuild_UNIT_REFUSAL',user:'UNIT_ONLY',password:'UNIT_ONLY_NOT_REAL'});
  try{
    await assert.rejects(()=>commitVerifiedImmutableFreshData({db,verifiedArchive:{}}),
      error=>error.code==='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'&&error.retry_safe===false);
    assert.equal(db._connecting,false);assert.equal(db._connected,false);assert.equal(db.queryQueue.length,0);
  }finally{await db.end();}
  console.log(JSON.stringify({scope:'NEW_ACTUAL_NATIVE_COMMIT_WITHOUT_PRIVATE_STAGE_REFUSED',groups:1,
    connected:false,queued_SQL:0,signatures_created:0,positive_commit:'NOT_RUN'}));
  process.exit(0);
}

// Actual new shipping entry, original retained archive and an intentionally
// INVALID signature. No signing, connection, SQL or valid-intent authority.
if(process.argv.includes('--immutable-fresh-entry-invalid-intent-only')){
  const {default:pg}=await import('pg');
  const {readVerifiedPrivateImportSource}=await import('./disaster-recovery-archive.mjs');
  const {stageVerifiedImmutableFreshData}=await import('./immutable-private-data-import.mjs');
  const input='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/authenticated-setwise-original-restore-v16/authenticated-original-source';
  const archive=materializeVerifiedArchive({sourceDir:input,archiveVerifyKey:'UNIT-only-immutable-archive-verification-key-20261016',
    archiveVerifyKeyId:'unit-immutable-archive-v1',supportedFormats:['memphis-zoo-disaster-recovery.v4']});
  const db=new pg.Client({host:'127.0.0.1',port:1,database:'mz_schema_rebuild_UNIT_REFUSAL',user:'UNIT_ONLY',password:'UNIT_ONLY_NOT_REAL'});
  const {lstatSync}=await import('node:fs');const owned=lstatSync(archive.directory),directory=archive.directory;
  console.log(JSON.stringify({scope:'NEW_INVALID_INTENT_OWNED_COPY',directory,dev:owned.dev,ino:owned.ino,uid:owned.uid}));
  let cleaned=false;
  const cleanup=()=>{if(cleaned)return;const stat=lstatSync(directory);
    assert.ok(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.dev===owned.dev&&stat.ino===owned.ino&&stat.uid===process.getuid());
    archive.cleanup();assert.equal(existsSync(directory),false);cleaned=true;};
  const terminate=()=>{try{cleanup();}finally{process.exit(124);}};process.once('SIGTERM',terminate);
  try{
    const {sourceBinding:binding}=readVerifiedPrivateImportSource(archive),release=binding.source_identity.release;
    const target=Object.fromEntries(['release_id','backend_commit','frontend_commit','migration_head','migration_manifest_sha256'].map(key=>[key,release[key]]));
    const envelope={format:'memphis-zoo-production-restore-intent.v1',algorithm:'hmac-sha256',key_id:'unit-invalid-intent-only',
      signature:'0'.repeat(64),intent:{restore_id:'11111111-1111-1111-1111-111111111111',authority_generation:1,retry_of_restore_id:null,
        archive_digest:binding.archive_digest,source_project_ref:binding.project_ref,target_project_ref:binding.project_ref,
        source_identity_sha256:binding.source_identity_sha256,target_migration_head:binding.source_identity.migration_head,
        target_release_identity:target,actor:'UNIT invalid intent refusal',approved_at:new Date().toISOString(),
        expires_at:new Date(Date.now()+60000).toISOString(),resume_after_verification:false}};
    assert.equal(db._connecting,false);assert.equal(db._connected,false);assert.equal(db.queryQueue.length,0);
    await assert.rejects(()=>stageVerifiedImmutableFreshData({db,verifiedArchive:archive,originalIntentEnvelope:envelope,
      intentVerifyKey:'UNIT-only-independent-invalid-intent-verification-20261017',intentVerifyKeyId:'unit-invalid-intent-only'}),
      error=>error.code==='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'&&error.outcome==='UNKNOWN'&&error.retry_safe===false);
    assert.equal(db._connecting,false);assert.equal(db._connected,false);assert.equal(db.queryQueue.length,0);
  }finally{process.off('SIGTERM',terminate);cleanup();await db.end();}
  console.log(JSON.stringify({scope:'NEW_ACTUAL_FRESH_ENTRY_INVALID_SIGNATURE_BEFORE_INITIALIZER',groups:1,
    valid_signatures_created:0,connected:false,queued_SQL:0,owned_archive_copy_absent:true,
    positive_fresh_restore:'NOT_RUN',authority:'NONE'}));
  process.exit(0);
}

// NEW DATA-at-consumption cases only. Synthetic HMAC archive keys are unit
// fixture data, not a real signed restore intent, target or import authority.
if(process.argv.includes('--native-text-columns-archive-only'))process.argv.push('--verified-table-data-only');
if (process.argv.includes('--immutable-bootstrap-prerequisite-errors-only') || process.argv.includes('--immutable-bootstrap-raw-source-only') || process.argv.includes('--immutable-source-selection-parsing-only') || process.argv.includes('--immutable-mutation-witness-caller-only') || process.argv.includes('--immutable-bootstrap-batch-source-only')) {
  // Enter only the existing signed-archive fixture below, never its old cases.
  process.argv.push('--verified-table-data-only');
}
if (process.argv.includes('--immutable-bootstrap-metadata-source-only') || process.argv.includes('--immutable-authority-reconciliation-source-only') || process.argv.includes("--verified-table-data-only") || process.argv.includes("--immutable-private-source-only") || process.argv.includes('--immutable-owner-context-source-only') || process.argv.includes('--immutable-owner-context-static-only') || process.argv.includes('--immutable-mixed-consumer-source-only') || process.argv.includes('--immutable-intent-owner-join-only') || process.argv.includes('--immutable-fixed-row-consumer-source-only') || process.argv.includes('--immutable-dependency-order-source-only') || process.argv.includes('--immutable-empty-dependency-order-source-only') || process.argv.includes('--immutable-row-count-before-insert-source-only') || process.argv.includes("--immutable-private-row-count-before-stage-source-only") || process.argv.includes('--immutable-self-reference-consumer-source-only')) {
  const bootstrapBatchOnly = process.argv.includes('--immutable-bootstrap-batch-source-only');
  const textColumnsOnly = process.argv.includes('--native-text-columns-archive-only');
  const prerequisiteErrorsOnly = process.argv.includes('--immutable-bootstrap-prerequisite-errors-only');
  const bootstrapRawOnly = prerequisiteErrorsOnly || process.argv.includes('--immutable-bootstrap-raw-source-only');
  const bootstrapMetadataOnly = process.argv.includes('--immutable-bootstrap-metadata-source-only');
  const selectionParsingOnly = process.argv.includes('--immutable-source-selection-parsing-only');
  const mutationWitnessOnly = process.argv.includes('--immutable-mutation-witness-caller-only');
  const authorityReconciliationOnly = process.argv.includes('--immutable-authority-reconciliation-source-only');
  const selfReferenceOnly = process.argv.includes('--immutable-self-reference-consumer-source-only');
  const privateStageCountOnly = process.argv.includes("--immutable-private-row-count-before-stage-source-only");
  const rowCountBoundOnly = process.argv.includes('--immutable-row-count-before-insert-source-only');
  const emptyDependencyOrderOnly = process.argv.includes('--immutable-empty-dependency-order-source-only');
  const dependencyOrderOnly = process.argv.includes('--immutable-dependency-order-source-only');
  const fixedRowConsumerOnly = process.argv.includes('--immutable-fixed-row-consumer-source-only');
  const intentOwnerJoinOnly = process.argv.includes('--immutable-intent-owner-join-only');
  const mixedConsumerOnly = bootstrapBatchOnly || bootstrapMetadataOnly || authorityReconciliationOnly || selfReferenceOnly || privateStageCountOnly || rowCountBoundOnly || emptyDependencyOrderOnly || dependencyOrderOnly || fixedRowConsumerOnly || process.argv.includes('--immutable-mixed-consumer-source-only');
  const mixedCase = process.argv.find(arg=>arg.startsWith('--immutable-mixed-case='))?.slice('--immutable-mixed-case='.length);
  const immutableSourceOnly = process.argv.includes("--immutable-private-source-only");
  const ownerContextStaticOnly = process.argv.includes('--immutable-owner-context-static-only');
  const ownerContextOnly = intentOwnerJoinOnly || ownerContextStaticOnly || process.argv.includes('--immutable-owner-context-source-only');
  const { openVerifiedRestoreTableData: open, readVerifiedRestoreTableSelection: selectOriginal } = await import("./disaster-recovery-archive.mjs");
  const work = mkdtempSync(join(tmpdir(), "archive-data-consumption-test-"));
  const key = "disaster-recovery-archive-materialization-test-key-0001", keyId = "archive-materialization-test-v1";
  const hash = value => createHash("sha256").update(value).digest("hex");
  const snapshots = [], readers = [], cases = [], unhandled = [];
  const observeUnhandled = error => unhandled.push(error);
  process.on("unhandledRejection", observeUnhandled);
  let ordinal = 0;
  function fixture({ data = Buffer.from(JSON.stringify('{"id":9223372036854775807,"value":{"n":9007199254740993,"text":"café\\n\\u0000","bytea":"\\\\x0011"}}') + "\n"),
    legacy = false, omitCatalog = false, identityHash = undefined, changeCatalog = null, badChecksum = false, sourceSymlink = false,
    privateTables = [], ordinaryTables = [], declaredRows = undefined } = {}) {
    const directory = join(work, `source-${ordinal++}`);
    mkdirSync(join(directory, "inventory"), { recursive: true, mode: 0o700 });
    mkdirSync(join(directory, "database"), { mode: 0o700 });
    const catalog = ["public", "auth", "storage"].map(schema_name => ({ schema_name, table_name: "records", primary_key: ["id"],
      columns: [{ name: "id", generated: "", identity: "", data_type: "bigint" },
        { name: "value", generated: "", identity: "", data_type: "json" }],
      row_count: schema_name === "public" && data.length ? "1" : "0", data_file: `database/${schema_name}.records.jsonl`,
      ...(legacy ? {} : { data_encoding: postgresJsonTextLineEncoding }) }));
    for (const item of privateTables) catalog.push({schema_name:'custodial_release_identity',table_name:item.name,
      primary_key:item.primaryKey,columns:item.columns,row_count:item.data.length?'1':'0',
      data_file:`database/custodial_release_identity.${item.name}.jsonl`,data_encoding:postgresJsonTextLineEncoding});
    for (const item of ordinaryTables) catalog.push({schema_name:item.schema,table_name:item.name,
      primary_key:item.primaryKey,columns:item.columns,row_count:item.data.length?'1':'0',
      data_file:`database/${item.schema}.${item.name}.jsonl`,data_encoding:postgresJsonTextLineEncoding});
    if (changeCatalog) changeCatalog(catalog);
    const catalogBytes = Buffer.from(JSON.stringify(catalog) + "\n");
    const sourceIdentity = { database_catalog_sha256: identityHash ?? hash(catalogBytes) };
    const summary = { ok: true, format: "memphis-zoo-disaster-recovery.v4", consistent_database_snapshot: true,
      project_ref: "abcdefghijklmnopqrst", source_identity: sourceIdentity, backed_up_schemas: ["public", "auth", "storage",...(privateTables.length?['custodial_release_identity']:[])],
      table_count: catalog.length, database_row_count: declaredRows ?? (data.length ? 1 : 0)+privateTables.filter(item=>item.data.length).length+ordinaryTables.filter(item=>item.data.length).length };
    const entries = new Map([["backup-summary.json", Buffer.from(JSON.stringify(summary) + "\n")],
      ...(!omitCatalog ? [["inventory/table-catalog.json", catalogBytes]] : []),
      ["database/public.records.jsonl", data], ["database/auth.records.jsonl", Buffer.alloc(0)], ["database/storage.records.jsonl", Buffer.alloc(0)],
      ...privateTables.map(item=>[`database/custodial_release_identity.${item.name}.jsonl`,item.data]),
      ...ordinaryTables.map(item=>[`database/${item.schema}.${item.name}.jsonl`,item.data])]);
    for (const [path, bytes] of entries) writeFileSync(join(directory, path), bytes);
    if (sourceSymlink) {
      renameSync(join(directory, "database/public.records.jsonl"), join(directory, "original-data"));
      symlinkSync(join(directory, "original-data"), join(directory, "database/public.records.jsonl"));
    }
    const sums = [...entries].map(([path, bytes]) => `${badChecksum && path === "database/public.records.jsonl" ? "0".repeat(64) : hash(bytes)}  ${path}`).join("\n") + "\n";
    writeFileSync(join(directory, "SHA256SUMS"), sums);
    const archiveDigest = hash(sums);
    writeFileSync(join(directory, "archive-signature.json"), JSON.stringify({ format: "memphis-zoo-disaster-recovery-signature.v1",
      algorithm: "hmac-sha256", key_id: keyId, archive_digest: archiveDigest,
      signature: signBinding(archiveSignatureBinding({ archiveDigest, projectRef: summary.project_ref, sourceIdentity,
        archiveFormat: summary.format }), key) }));
    return { directory, data };
  }
  function materialize(source) {
    const archive = materializeVerifiedArchive({ sourceDir: source.directory, archiveVerifyKey: key, archiveVerifyKeyId: keyId });
    snapshots.push(archive); return archive;
  }
  function reader(archive, schema = "public", table = "records") {
    const result = open(archive, schema, table); readers.push(result); return result;
  }
  async function bytes(result) {
    const chunks = []; for await (const chunk of result.stream) chunks.push(chunk);
    await result.verified; return Buffer.concat(chunks);
  }
  const run = async (name, body) => {
    if(intentOwnerJoinOnly&&!name.startsWith('INTENT_OWNER_JOIN_NEW '))return;
    if(ownerContextStaticOnly&&!name.startsWith('proposal static owner'))return;
    if(mixedConsumerOnly&&mixedCase&&name!==mixedCase)return;
    const firstReader = readers.length, firstSnapshot = snapshots.length;
    try { await body(); cases.push(name); if(mixedConsumerOnly)console.log(JSON.stringify({case:name,status:'PASS_SOURCE_RECORDING_ONLY'})); }
    finally {
      for (const result of readers.slice(firstReader)) await result.close();
      for (const archive of snapshots.slice(firstSnapshot)) archive.cleanup();
    }
  };
  try {
    if(textColumnsOnly){
      const part=process.argv.find(arg=>arg.startsWith('--text-archive-case='))?.split('=')[1];
      assert.ok(part===undefined||['decoder','selection','reader','bootstrap','currentness'].includes(part));
      const api=await import('./disaster-recovery-archive.mjs');
      const wire=await import('./production-backup-pg-dump-command.mjs');
      const {readdirSync,readlinkSync}=await import('node:fs');
      const tag=api.postgresTextColumnsLineEncoding,encode=wire.encodeProductionBackupTextColumnsDataRow;
      assert.equal(tag,wire.productionBackupTextColumnsDataEncoding);assert.equal(tag,'postgres-text-columns-line.v2');
      assert.equal(hash(readFileSync(new URL('./production-backup-pg-dump-command.mjs',import.meta.url))),
        '8ad52b64334f4338582429ade37ad1a3c094d6732a28ec9b5f213b5142f3d55f');
      const rawNull=' { "id" : "9223372036854775807", "value" : null } ';
      const rawJSONNull=' { "id" : "9223372036854775807", "value" : "null" } ';
      const rawPrecise=' { "value" : "{  \\"n\\":9007199254740993,\\"fraction\\":0.12345678901234567890,\\"n\\":2 }", "id" : "1" } ';
      const table={columns:[{name:'id'},{name:'value'}],data_encoding:tag};
      let scenarios=0;
      const fresh=(options={})=>fixture({...options,changeCatalog:catalog=>{
        for(const t of catalog)t.data_encoding=tag;options.changeCatalog?.(catalog);
      }});
      const only=async(name,body)=>{if(!part||part===name)await run('TEXT_COLUMNS_ARCHIVE_NEW '+name,body);};
      const noFds=archive=>{
        const found=readdirSync('/proc/self/fd').flatMap(fd=>{try{return readlinkSync('/proc/self/fd/'+fd).includes(archive.directory)?[fd]:[];}catch{return [];}});
        assert.deepEqual(found,[],'Every owned archive DATA FD must settle');
      };
      const readRows=async result=>{
        const decoder=api.createRestoreRowLineBatchDecoder(),settled=pipeline(result.stream,decoder);settled.catch(()=>{});
        const values=[];try{for await(const lines of decoder)for(const line of lines)values.push(decodeRestoreTableRowLine(line,result.table));
          await settled;const eof=await result.verified;return {values,eof};
        }finally{decoder.destroy();result.stream.destroy();await settled.catch(()=>{});await result.close();}
      };
      await only('decoder',async()=>{
        for(const raw of [rawNull,rawJSONNull,rawPrecise,JSON.stringify({id:'1',value:'[0:2]={"null",NULL,"x"}'}),
          JSON.stringify({id:'1',value:'\\x0000ff'}),JSON.stringify({id:'1',value:'"\\ud800"'}),
          JSON.stringify({id:'1',value:'2026-10-18 01:02:03.123456+00'})]){
          assert.equal(decodeRestoreTableRowLine(encode(raw),table),raw);scenarios++;
        }
        assert.notEqual(decodeRestoreTableRowLine(encode(rawNull),table),decodeRestoreTableRowLine(encode(rawJSONNull),table));scenarios++;
        for(const raw of ['{"id":"1","value":1}','{"id":"1","value":false}','{"id":"1","value":[]}',
          '{"id":"1","value":{}}','{"id":"first","\\u0069d":"second","value":null}',
          '{"id":"1","value":"\\ud800"}','{"id":"1","\\udc00":null}',
          '{"id":"1","value":"\ud800"}','{"id":"1"}','{"id":"1","value":null,"extra":null}']){
          assert.throws(()=>decodeRestoreTableRowLine(JSON.stringify(raw),table),/Malformed or metadata-mismatched/);scenarios++;
        }
        for(const line of [rawNull,'null','1','{}','[]','"not-json"',JSON.stringify(JSON.stringify(rawNull))]){
          assert.throws(()=>decodeRestoreTableRowLine(line,table));scenarios++;
        }
        for(const data_encoding of [null,undefined,'',3,{},tag+'\n',' '+tag,'postgres-text-columns-line.v3']){
          assert.throws(()=>decodeRestoreTableRowLine(encode(rawNull),{...table,data_encoding}),/Unsupported signed/);scenarios++;
        }
        for(const columns of [[{name:'id'},{name:'id'}],[{name:'id'},{name:'other'}],[]]){
          assert.throws(()=>decodeRestoreTableRowLine(encode(rawNull),{...table,columns}));scenarios++;
        }
        // Legacy branches remain discriminating regressions, not a replay of
        // the old codec suite. A tag is never inferred from matching bytes.
        const old=' {"id":9223372036854775807,"value":{"n":9007199254740993,"n":2}} ';
        assert.equal(decodeRestoreTableRowLine(JSON.stringify(old),{...table,data_encoding:postgresJsonTextLineEncoding}),old);
        assert.equal(decodeRestoreTableRowLine(old,{columns:table.columns}),old);
        assert.throws(()=>decodeRestoreTableRowLine(JSON.stringify(old),table));
        assert.throws(()=>decodeRestoreTableRowLine(JSON.stringify(rawNull),{columns:table.columns}));scenarios++;
      });
      await only('selection',async()=>{
        const legacySource=fresh({data:Buffer.from(encode(rawJSONNull)+'\n')});
        const summaryPath=join(legacySource.directory,'backup-summary.json');
        const legacySummary=JSON.parse(readFileSync(summaryPath));legacySummary.backed_up_schemas.push('custodial_release_identity');
        writeFileSync(summaryPath,JSON.stringify(legacySummary)+'\n');
        const sumsPath=join(legacySource.directory,'SHA256SUMS'),lines=readFileSync(sumsPath,'utf8').trimEnd().split('\n').map(line=>line.endsWith('  backup-summary.json')?hash(readFileSync(summaryPath))+'  backup-summary.json':line);
        const sums=lines.join('\n')+'\n';writeFileSync(sumsPath,sums);
        const digest=hash(sums);writeFileSync(join(legacySource.directory,'archive-signature.json'),JSON.stringify({format:'memphis-zoo-disaster-recovery-signature.v1',algorithm:'hmac-sha256',key_id:keyId,archive_digest:digest,
          signature:signBinding(archiveSignatureBinding({archiveDigest:digest,projectRef:legacySummary.project_ref,sourceIdentity:legacySummary.source_identity,archiveFormat:legacySummary.format}),key)}));
        const legacy=materialize(legacySource),emptySelection=selectOriginal(legacy,{databaseOnly:true});
        assert.equal(emptySelection.privateTables.length,0);assert.equal(emptySelection.databaseTables.length,3);scenarios++;
        const detachedCatalog=JSON.parse(readFileSync(join(legacy.directory,'inventory/table-catalog.json')));
        assert.throws(()=>selectVerifiedRestoreTables({summary:legacy.summary,catalog:detachedCatalog,checksumPaths:new Set([...legacy.checksumPaths,'database/custodial_release_identity.hidden.jsonl'])}),/Private original files exist/);scenarios++;
        const source=fresh({data:Buffer.from(encode(rawJSONNull)+'\n'),privateTables:[{name:'unit_private_original',
          primaryKey:['id'],columns:table.columns.map(c=>({...c,data_type:c.name==='id'?'bigint':'json',generated:'',identity:''})),
          data:Buffer.from(encode(rawNull)+'\n')}],changeCatalog:catalog=>{
            delete catalog.find(t=>t.schema_name==='auth').data_encoding;
            catalog.find(t=>t.schema_name==='storage').data_encoding=postgresJsonTextLineEncoding;
          }});
        const archive=materialize(source),selection=selectOriginal(archive,{databaseOnly:true}),binding=api.readVerifiedArchiveSourceBinding(archive);
        assert.equal(selection.databaseTables.length,4);assert.equal(selection.privateTables.length,1);
        assert.equal(selection.privateTables[0].data_encoding,tag);assert.ok(Object.isFrozen(selection));
        assert.equal(selectOriginal(archive,{databaseOnly:true}),selection);
        const privateSource=api.readVerifiedPrivateImportSource(archive);
        assert.equal(privateSource.sourceBinding,binding);assert.equal(privateSource.privateDataMembers[0].data_encoding,tag);
        assert.equal(privateSource.privateDataMembers[0].sha256,hash(Buffer.from(encode(rawNull)+'\n')));scenarios++;
        for(const data_encoding of [null,'',3,{},tag+'\n','postgres-text-columns-line.v3']){
          const invalid=materialize(fresh({changeCatalog:catalog=>{catalog[0].data_encoding=data_encoding;}}));
          assert.throws(()=>selectOriginal(invalid,{databaseOnly:true}),/Unsupported signed/);
          assert.throws(()=>reader(invalid),/Unsupported signed/);scenarios++;
        }
        const foreign=Object.freeze({...archive});assert.throws(()=>selectOriginal(foreign,{databaseOnly:true}));
        assert.throws(()=>api.readVerifiedPrivateImportSource(foreign));scenarios++;
      });
      await only('reader',async()=>{
        const originals=[rawNull,rawJSONNull,rawJSONNull],data=Buffer.from(originals.map(encode).join('\r\n'));
        const archive=materialize(fresh({data,declaredRows:3,changeCatalog:catalog=>{catalog[0].row_count='3';}}));
        const result=reader(archive),actual=await readRows(result);
        assert.deepEqual(actual.values,originals);assert.equal(actual.eof.sha256,hash(data));assert.equal(actual.eof.bytes,data.length);
        assert.equal(actual.eof.data_file,'database/public.records.jsonl');assert.equal(result.table.data_encoding,tag);
        assert.ok(Object.isFrozen(result.table)&&Object.isFrozen(result.table.columns));noFds(archive);scenarios++;
        const long=JSON.stringify({id:'1',value:'x'.repeat(65532)+'é🦁'}),wireBytes=Buffer.from(encode(long));
        const large=materialize(fresh({data:wireBytes})),found=await readRows(reader(large));
        assert.deepEqual(found.values,[long]);assert.equal(found.eof.sha256,hash(wireBytes));noFds(large);scenarios++;
        for(const bytes of [Buffer.from([0xc3,0x28,0x0a]),Buffer.from([0xc3]),Buffer.from('"{\\"id\\":\\"1\\",\\"value\\":1}"\n'),
          Buffer.from(JSON.stringify('{"id":"1"}')+'\n')]){
          const malformed=materialize(fresh({data:bytes}));await assert.rejects(()=>readRows(reader(malformed)));noFds(malformed);scenarios++;
        }
        const truncated=reader(materialize(fresh({data:Buffer.from(encode(long)+'\n')})));
        assert.equal(truncated.stream.read(1).length,1);truncated.stream.destroy();
        await assert.rejects(truncated.verified,/EOF/);await truncated.close();assert.ok(truncated.stream.closed);scenarios++;
        assert.throws(()=>materialize(fresh({data:Buffer.from(encode(rawNull)+'\n'),badChecksum:true})),/checksum/);scenarios++;
      });
      await only('bootstrap',async()=>{
        const release=[rawPrecise],registry=[rawNull,rawJSONNull],data=Buffer.from(encode(rawNull)+'\n');
        const bootstrap=(options={})=>materialize(fresh({data,ordinaryTables:[
          {schema:'public',name:'release_deployment_manifest',primaryKey:['id'],columns:table.columns.map(c=>({...c,data_type:'text',generated:'',identity:''})),
            data:Buffer.from(encode(release[0])+'\n')},
          {schema:'public',name:'custodial_release_authority_restore_inventory',primaryKey:['id'],columns:table.columns.map(c=>({...c,data_type:'text',generated:'',identity:''})),
            data:options.registryWire??Buffer.from(registry.map(encode).join('\n')+'\n')}],
          declaredRows:1+release.length+(options.count??registry.length),changeCatalog:catalog=>{
            catalog.find(t=>t.table_name==='custodial_release_authority_restore_inventory').row_count=String(options.count??registry.length);
          }}));
        const archive=bootstrap(),result=await api.collectVerifiedRestoreBootstrapRows(archive);
        assert.deepEqual(result.releaseRows,release);assert.deepEqual(result.registryRows,registry);
        assert.equal(result.sourceBinding,api.readVerifiedArchiveSourceBinding(archive));
        assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.releaseRows)&&Object.isFrozen(result.registryRows));
        for(const proof of result.memberProofs){const bytes=readFileSync(join(archive.directory,proof.data_file));
          assert.equal(proof.sha256,hash(bytes));assert.equal(proof.bytes,bytes.length);}
        noFds(archive);scenarios++;
        for(const options of [{count:3},{count:1},{registryWire:Buffer.from(encode(rawNull)+'\n')},
          {registryWire:Buffer.from(JSON.stringify('{"id":"1","value":{}}')+'\n'),count:1}]){
          const invalid=bootstrap(options);await assert.rejects(()=>api.collectVerifiedRestoreBootstrapRows(invalid));noFds(invalid);scenarios++;
        }
      });
      await only('currentness',async()=>{
        for(const mode of ['replacement','hardlink','withdrawal']){
          const archive=materialize(fresh({data:Buffer.from(encode(rawNull)+'\n')})),result=reader(archive);
          const path=join(archive.directory,'database/public.records.jsonl');
          if(mode==='replacement'){renameSync(path,path+'.original');writeFileSync(path,readFileSync(path+'.original'));}
          if(mode==='hardlink')linkSync(path,path+'.alias');
          if(mode==='withdrawal')archive.cleanup();
          await assert.rejects(()=>readRows(result));await assert.rejects(result.verified);await result.close();
          assert.ok(result.stream.closed);noFds(archive);scenarios++;
        }
        const archive=materialize(fresh({data:Buffer.from(encode(rawNull)+'\n')}));archive.cleanup();
        assert.throws(()=>selectOriginal(archive,{databaseOnly:true}));assert.throws(()=>reader(archive));scenarios++;
      });
      assert.deepEqual(unhandled,[]);
      console.log(JSON.stringify({selector:'native-text-columns-archive-only',part:part||'all-new',groups:cases.length,scenarios,
        proof:part==='decoder'?'ACTUAL_V2_CODEC_AND_EXACT_COLUMN_KEY_DATA_ONLY':'ACTUAL_SIGNED_PUBLIC_UNIT_ARCHIVES_AND_SOURCE_READER_ONLY',
        UNIT_archive_materializations:snapshots.length,actual_SQL:'NOT_RUN',
        v2_SQL_or_import_admission:false,bootstrap_metadata_interpreted:false,producer_mounted:false,
        old_groups_replayed:0,real_keys:false,resources0:true}));
    }else if(bootstrapRawOnly){
      const {collectVerifiedRestoreBootstrapRows:collect,readVerifiedImmutableBootstrapInventory:inventoryOf,
        readVerifiedArchiveSourceBinding:bindingOf}=await import('./disaster-recovery-archive.mjs');
      const {readdirSync,readlinkSync}=await import('node:fs');
      const raw=' { "value":{"n":9007199254740993,"scale":1.230000,"s":"café\\n"},"id":9223372036854775807 } ';
      const inventoryFields=[['application-schema.sql','application_schema_sha256'],['migration-ledger.json','migration_ledger_sha256'],
        ['cron-jobs.json','cron_jobs_sha256'],['extensions.json','extensions_sha256'],['table-catalog.json','database_catalog_sha256'],
        ['original-relations.json','original_relations_sha256'],['original-guards.json','original_guards_sha256'],['original-acls.json','original_acls_sha256']];
      // Extend the existing signed UNIT archive fixture, not a target or an
      // installer/signing-authority fixture. No actual production key is used.
      const bootstrap=({release=[raw],registry=[raw,raw],releaseCount=release.length,registryCount=registry.length,
        registryWire,inventoryChanges={},identityChanges={},omitRelease=false,releaseSchema='public',
        omitRegistry=false,registrySchema='public',omitInventory=[]}={})=>{
        const encode=rows=>Buffer.from(rows.map(row=>JSON.stringify(row)).join('\r\n')+(rows.length?'\r\n':''));
        const tables=[...(!omitRelease?[{schema:releaseSchema,name:'release_deployment_manifest',data:encode(release)}]:[]),
          ...(!omitRegistry?[{schema:registrySchema,name:'custodial_release_authority_restore_inventory',data:registryWire??encode(registry)}]:[])]
          .map(table=>({...table,primaryKey:['id'],columns:[{name:'id',generated:'',identity:'',data_type:'bigint'},
            {name:'value',generated:'',identity:'',data_type:'json'}]}));
        const original=fixture({data:Buffer.from([0xff]),ordinaryTables:tables,omitCatalog:omitInventory.includes('table-catalog.json'),
          declaredRows:1+(omitRelease?0:releaseCount)+(omitRegistry?0:registryCount),changeCatalog:catalog=>{
            for(const table of catalog){if(table.table_name==='release_deployment_manifest')table.row_count=String(releaseCount);
              if(table.table_name==='custodial_release_authority_restore_inventory')table.row_count=String(registryCount);}
          }});
        const summaryPath=join(original.directory,'backup-summary.json'),summary=JSON.parse(readFileSync(summaryPath));
        const inventories={};
        for(const [name,field]of inventoryFields){
          if(omitInventory.includes(name)){delete summary.source_identity[field];continue;}
          const path='inventory/'+name;
          const bytes=Object.hasOwn(inventoryChanges,name)?Buffer.from(inventoryChanges[name]):name==='table-catalog.json'
            ?readFileSync(join(original.directory,path)):Buffer.from(name.endsWith('.sql')?'-- SYNTHETIC Source only\nSELECT 9007199254740993;\n':' {"n":9007199254740993,"scale":1.230000}\n');
          writeFileSync(join(original.directory,path),bytes);inventories[path]=bytes;
          summary.source_identity[field]=hash(bytes);
        }
        for(const [name,value]of Object.entries(identityChanges)){
          if(value===undefined)delete summary.source_identity[name];else summary.source_identity[name]=value;
        }
        writeFileSync(summaryPath,JSON.stringify(summary)+'\n');
        const entries=new Map(readFileSync(join(original.directory,'SHA256SUMS'),'utf8').trimEnd().split('\n').map(line=>[line.slice(66),line.slice(0,64)]));
        entries.set('backup-summary.json',hash(readFileSync(summaryPath)));
        for(const [path,bytes]of Object.entries(inventories))entries.set(path,hash(bytes));
        const sums=[...entries].map(([path,digest])=>digest+'  '+path).join('\n')+'\n',archiveDigest=hash(sums);
        writeFileSync(join(original.directory,'SHA256SUMS'),sums);
        writeFileSync(join(original.directory,'archive-signature.json'),JSON.stringify({format:'memphis-zoo-disaster-recovery-signature.v1',
          algorithm:'hmac-sha256',key_id:keyId,archive_digest:archiveDigest,signature:signBinding(archiveSignatureBinding({archiveDigest,
            projectRef:summary.project_ref,sourceIdentity:summary.source_identity,archiveFormat:summary.format}),key)}));
        return {archive:materialize(original),inventories,release,registry};
      };
      const noFds=archive=>{
        const stillOpen=readdirSync('/proc/self/fd').flatMap(fd=>{try{return readlinkSync('/proc/self/fd/'+fd).includes(archive.directory)?[fd]:[];}catch{return [];}});
        assert.deepEqual(stillOpen,[],'Collector must close its archive FDs without closing the archive');
      };
      const rawCase=process.argv.find(arg=>arg.startsWith('--immutable-bootstrap-raw-case='))?.slice('--immutable-bootstrap-raw-case='.length);
      const rawRun=async(name,body)=>{if(!rawCase||rawCase===name){await run(name,body);console.log(JSON.stringify({case:name,status:'PASS_NEW_SOURCE_UNIT_ONLY'}));}};
      if(prerequisiteErrorsOnly){
        const typed=(code,member)=>error=>{
          assert.ok(error instanceof Error);
          assert.deepEqual(Object.keys(error).sort(),['code','source_member']);
          assert.equal(error.code,code);assert.equal(error.source_member,member);
          assert.equal(Object.hasOwn(error,'cause'),false);
          assert.deepEqual(JSON.parse(JSON.stringify(error)),{code,source_member:member});
          assert.ok(['Fixed signed bootstrap inventory is unavailable.','Bootstrap requires one original release and nonempty original registry.',
            'Bootstrap original member is unavailable.'].includes(error.message));
          return true;
        };
        const untyped=error=>{
          assert.ok(error instanceof Error);assert.equal(Object.hasOwn(error,'source_member'),false);
          assert.equal(Object.hasOwn(error,'code'),false);return true;
        };
        await rawRun('BOOTSTRAP_DIAGNOSTIC_NEW exact first fixed missing inventory member',async()=>{
          for(const [name]of inventoryFields){const {archive}=bootstrap({omitInventory:[name]});
            assert.throws(()=>inventoryOf(archive),typed('IMMUTABLE_BOOTSTRAP_INVENTORY_UNAVAILABLE','inventory/'+name));noFds(archive);}
          const {archive}=bootstrap({omitInventory:['original-relations.json','original-guards.json','original-acls.json']});
          assert.throws(()=>inventoryOf(archive),typed('IMMUTABLE_BOOTSTRAP_INVENTORY_UNAVAILABLE','inventory/original-relations.json'));noFds(archive);
        });
        await rawRun('BOOTSTRAP_DIAGNOSTIC_NEW mismatched or absent signed field exposes no input detail',async()=>{
          for(const [name,field]of inventoryFields)for(const value of [undefined,'0'.repeat(64),'SYNTHETIC_PRIVATE_FIELD_MUST_NOT_ESCAPE']){
            const {archive}=bootstrap({identityChanges:{[field]:value}});
            assert.throws(()=>inventoryOf(archive),typed('IMMUTABLE_BOOTSTRAP_INVENTORY_UNAVAILABLE','inventory/'+name));noFds(archive);
          }
        });
        await rawRun('BOOTSTRAP_DIAGNOSTIC_NEW only fixed original row prerequisites named',async()=>{
          for(const options of [{omitRelease:true},{releaseSchema:'auth'},{release:[]},{release:[raw,raw]},{release:[],releaseCount:1}]){
            const {archive}=bootstrap(options);await assert.rejects(()=>collect(archive),typed('IMMUTABLE_BOOTSTRAP_ORIGINAL_ROWS_UNAVAILABLE','public.release_deployment_manifest'));noFds(archive);
          }
          for(const options of [{omitRegistry:true},{registrySchema:'auth'},{registry:[]},{registryWire:Buffer.alloc(0),registryCount:1}]){
            const {archive}=bootstrap(options);await assert.rejects(()=>collect(archive),typed('IMMUTABLE_BOOTSTRAP_ORIGINAL_ROWS_UNAVAILABLE','public.custodial_release_authority_restore_inventory'));noFds(archive);
          }
        });
        await rawRun('BOOTSTRAP_DIAGNOSTIC_NEW forged closed and earlier selection failures never acquire member',async()=>{
          let accesses=0;const forged=Object.defineProperty({},'directory',{get(){accesses++;throw new Error('SYNTHETIC_CALLER_DETAIL');}});
          const {archive}=bootstrap();
          for(const value of [{},forged,{...archive},new Proxy(archive,{}),{code:'IMMUTABLE_BOOTSTRAP_INVENTORY_UNAVAILABLE',source_member:'SYNTHETIC_CALLER_MEMBER'}]){
            assert.throws(()=>inventoryOf(value),untyped);await assert.rejects(()=>collect(value),untyped);
          }
          assert.equal(accesses,0);
          archive.cleanup();assert.throws(()=>inventoryOf(archive),untyped);await assert.rejects(()=>collect(archive),untyped);noFds(archive);
          const invalid=bootstrap({identityChanges:{database_catalog_sha256:'0'.repeat(64)}}).archive;
          await assert.rejects(()=>collect(invalid),untyped);noFds(invalid);
        });
        assert.equal(cases.length,rawCase?1:4);assert.deepEqual(unhandled,[]);
        console.log(JSON.stringify({selector:'--immutable-bootstrap-prerequisite-errors-only',count:cases.length,cases,
          limits:'NEW bounded prerequisite Error fields on actual exports/signed UNIT inputs only; no CLI rendering, target, SQL, admission or authority.',actual_SQL:'NOT_RUN',resources:{SQL_connections:0,JVMs:0,listeners:0}}));
      }else{
      await rawRun('BOOTSTRAP_RAW_NEW exact raw largeinteger rows fixed selection EOF proofs and immutable copies',async()=>{
        const {archive,release,registry}=bootstrap(),binding=bindingOf(archive),result=await collect(archive);
        assert.deepEqual(Object.keys(result).sort(),['sourceBinding','releaseRows','registryRows','memberProofs'].sort());
        assert.equal(result.sourceBinding,binding);assert.deepEqual(result.releaseRows,release);assert.deepEqual(result.registryRows,registry);
        assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.releaseRows)&&Object.isFrozen(result.registryRows)&&Object.isFrozen(result.memberProofs));
        assert.equal(result.memberProofs.length,2);
        for(const proof of result.memberProofs){assert.ok(Object.isFrozen(proof));assert.equal(proof.schema_name,'public');
          assert.equal(proof.data_file,'database/public.'+proof.table_name+'.jsonl');
          assert.equal(proof.sha256,hash(readFileSync(join(archive.directory,proof.data_file))));
          assert.equal(proof.bytes,readFileSync(join(archive.directory,proof.data_file)).length);}
        assert.throws(()=>result.releaseRows.push('{}'),TypeError);assert.equal(bindingOf(archive),binding);noFds(archive);
        // The unrelated malformed public.records was never consumed; the
        // importer's all-DATA gates remain separate, not waived by this getter.
      });
      await rawRun('BOOTSTRAP_RAW_NEW release exactly one and registry exact nonzero counts required',async()=>{
        for(const options of [{release:[]},{release:[raw,raw]},{registry:[]},{registryCount:3},{registryCount:1}]){
          const {archive}=bootstrap(options);await assert.rejects(()=>collect(archive));noFds(archive);
        }
      });
      await rawRun('BOOTSTRAP_RAW_NEW missing foreign copied and closed source refuses',async()=>{
        for(const options of [{omitRelease:true},{releaseSchema:'auth'}]){const {archive}=bootstrap(options);await assert.rejects(()=>collect(archive));noFds(archive);}
        const {archive}=bootstrap();await assert.rejects(()=>collect({...archive}));assert.throws(()=>inventoryOf({...archive}));
        archive.cleanup();await assert.rejects(()=>collect(archive));assert.throws(()=>inventoryOf(archive));noFds(archive);
      });
      await rawRun('BOOTSTRAP_RAW_NEW actual UTF8 row decoder and short EOF failures close own resources',async()=>{
        for(const wire of [Buffer.from([0xc3]),Buffer.from([0xc3,0x28,0x0a]),Buffer.from('"not-json"\n'),Buffer.from('\n')]){
          const {archive}=bootstrap({registryWire:wire,registryCount:1});
          await assert.rejects(()=>collect(archive));assert.ok(bindingOf(archive));noFds(archive);
        }
      });
      await rawRun('BOOTSTRAP_RAW_NEW actual source withdrawal and same-byte file replacement at await refuse',async()=>{
        const closed=bootstrap().archive,pending=collect(closed);closed.cleanup();await assert.rejects(pending);noFds(closed);
        const {archive}=bootstrap(),path=join(archive.directory,'database/public.custodial_release_authority_restore_inventory.jsonl');
        const held=collect(archive);renameSync(path,path+'.original');writeFileSync(path,readFileSync(path+'.original'));
        await assert.rejects(held);noFds(archive);
      });
      await rawRun('BOOTSTRAP_RAW_NEW multichunk nonterminated exact original row publishes only after EOF',async()=>{
        const longRaw=' {"id":9223372036854775807,"value":{"n":9007199254740993,"text":"'+'x'.repeat(65530)+'café"}} ';
        const wire=Buffer.from(JSON.stringify(longRaw)),{archive}=bootstrap({registry:[longRaw],registryWire:wire,registryCount:1});
        const result=await collect(archive);assert.deepEqual(result.registryRows,[longRaw]);
        assert.equal(result.memberProofs[1].bytes,wire.length);assert.equal(result.memberProofs[1].sha256,hash(wire));noFds(archive);
      });
      await rawRun('BOOTSTRAP_INVENTORY_NEW eight exact UTF8 members strings binding and frozen closed map',async()=>{
        const {archive,inventories}=bootstrap(),binding=bindingOf(archive),result=inventoryOf(archive);
        assert.deepEqual(Object.keys(result).sort(),['inventory','sourceBinding']);assert.equal(result.sourceBinding,binding);
        assert.deepEqual(Object.keys(result.inventory),inventoryFields.map(([name])=>'inventory/'+name));
        assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.inventory));
        for(const [path,bytes]of Object.entries(inventories))assert.equal(result.inventory[path],bytes.toString('utf8'));
        assert.equal(Object.hasOwn(result.inventory,'inventory/source-pins.json'),false);noFds(archive);
      });
      await rawRun('BOOTSTRAP_INVENTORY_NEW absent mismatched signed identity and malformed bytes refuse',async()=>{
        for(const options of [{identityChanges:{original_acls_sha256:undefined}},
          {identityChanges:{original_guards_sha256:'0'.repeat(64)}},
          {inventoryChanges:{'application-schema.sql':Buffer.from([0xc3])}},
          {inventoryChanges:{'original-acls.json':Buffer.from([0xc3,0x28])}}]){
          const {archive}=bootstrap(options);assert.throws(()=>inventoryOf(archive));noFds(archive);
        }
      });
      await rawRun('BOOTSTRAP_INVENTORY_NEW same-byte named inode replacement and hardlink alias refuse',async()=>{
        for(const alias of [false,true]){const {archive}=bootstrap(),path=join(archive.directory,'inventory/original-acls.json');
          if(alias)linkSync(path,path+'.alias');else{renameSync(path,path+'.original');writeFileSync(path,readFileSync(path+'.original'));}
          assert.throws(()=>inventoryOf(archive));noFds(archive);
        }
      });
      assert.equal(cases.length,rawCase?1:9);assert.deepEqual(unhandled,[]);
      console.log(JSON.stringify({selector:'--immutable-bootstrap-raw-source-only',count:cases.length,cases,actual_SQL:'NOT_RUN',
        limits:'NEW actual exports and signed UNIT archive/host streams only; no target bootstrap, schema/guard acceptance, genuine archive key, DATA import, admission or authority.',resources:{SQL_connections:0,JVMs:0,listeners:0}}));
      }
    }else if(bootstrapBatchOnly){
      const {types,isDeepStrictEqual}=await import('node:util');
      const {createRestoreRowLineBatchDecoder,readVerifiedPrivateImportSource:sourceOf}=await import('./disaster-recovery-archive.mjs');
      assert.equal(typeof createRestoreRowLineBatchDecoder,'function','Sealed batch-decoder product prerequisite required');
      const consumer=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
      const first=consumer.indexOf('function fail('),last=consumer.indexOf('// Stage and finish ONLY');
      assert.ok(first>=0&&last>first);assert.ok(consumer.slice(first,last).includes('createRestoreRowLineBatchDecoder'));
      // Actual decoder versus the old guarded readline wire, never a copied
      // parser. Frozen batches are DATA, not target/source admission.
      const decodeBatches=async chunks=>{
        const source=Readable.from(chunks),decoder=createRestoreRowLineBatchDecoder(),settled=pipeline(source,decoder);
        settled.catch(()=>{});const batches=[],originals=chunks.map(chunk=>Buffer.from(chunk));
        try{
          for await(const batch of decoder){
            assert.ok(Array.isArray(batch)&&Object.isFrozen(batch));
            assert.deepEqual(Reflect.ownKeys(batch),[...Array.from({length:batch.length},(_,i)=>String(i)),'length']);
            for(const line of batch)assert.equal(typeof line,'string');batches.push(batch);
          }
          await settled;assert.deepEqual(chunks,originals);return batches;
        }finally{source.destroy();decoder.destroy();await settled.catch(()=>{});}
      };
      const legacyLines=async chunks=>{
        const source=Readable.from(chunks),guard=createRestoreRowUtf8Guard(),input=createInterface({input:guard,crlfDelay:Infinity});
        const settled=pipeline(source,guard);settled.catch(()=>{});const lines=[];
        try{for await(const line of input)lines.push(line);await settled;return lines;}
        finally{input.close();source.destroy();guard.destroy();await settled.catch(()=>{});}
      };
      await run('BOOTSTRAP_BATCH_NEW exact LF CR CRLF Unicode and EOF match legacy readline',async()=>{
        for(const text of ['', '\n', '\r', '\r\n', 'a\nb\n', 'a\rb\r', 'a\r\nb\r\n', '\n\r\n\r', 'unterminated', '\ufeffcafé😀\r\n\rnext\n\nlast']){
          const bytes=Buffer.from(text);
          for(let split=0;split<=bytes.length;split++){
            const chunks=[bytes.subarray(0,split),bytes.subarray(split)];
            assert.deepEqual((await decodeBatches(chunks)).flat(),await legacyLines(chunks));
          }
          const chunks=[...bytes].map(byte=>Buffer.from([byte]));
          assert.deepEqual((await decodeBatches(chunks)).flat(),await legacyLines(chunks));
        }
      });
      await run('BOOTSTRAP_BATCH_NEW one actual chunk batches many exact lines without per-line yields',async()=>{
        const lines=Array.from({length:7118},(_,i)=>JSON.stringify(' {"id":'+i+',"value":{"n":9223372036854775807,"v":1.2300}}'));
        const bytes=Buffer.from(lines.join('\r\n')+'\r\n'),batches=await decodeBatches([bytes]);
        assert.deepEqual(batches.flat(),lines);assert.ok(batches.length<=2,'Only one chunk plus EOF emission, not a yield per line');
      });
      await run('BOOTSTRAP_BATCH_NEW malformed and truncated UTF8 refuse including split sequences',async()=>{
        for(const bytes of [Buffer.from([0xc0,0x80]),Buffer.from([0x80]),Buffer.from([0xed,0xa0,0x80]),Buffer.from([0xf4,0x90,0x80,0x80]),Buffer.from([0xc3]),Buffer.from([0xf0,0x9f,0x98])]){
          for(const chunks of [[bytes],[...bytes].map(byte=>Buffer.from([byte]))]){
            await assert.rejects(()=>decodeBatches(chunks));await assert.rejects(()=>legacyLines(chunks));
          }
        }
      });
      const columns=[{name:'id',data_type:'bigint',generated:'',identity:''},{name:'value',data_type:'json',generated:'',identity:''}];
      const registry='custodial_release_authority_restore_inventory',release='release_deployment_manifest';
      const raw=' {"id":9223372036854775807,"value":{"n":9007199254740993,"decimal":1.2300,"original":"café😀"}}';
      const wire=rows=>Buffer.from(rows.map(row=>JSON.stringify(row)+'\n').join(''));
      const metadata=({name=registry,schema='public',rows=[raw],declared=rows.length,data=wire(rows)}={})=>materialize(fixture({data:Buffer.alloc(0),
        privateTables:['employee_message_original_outcomes','group_original_creations'].map(name=>({name,primaryKey:['id'],columns,data:Buffer.alloc(0)})),
        ordinaryTables:[{schema,name,primaryKey:['id'],columns,data}],declaredRows:declared,
        changeCatalog:catalog=>{catalog.find(table=>table.schema_name===schema&&table.table_name===name).row_count=String(declared);}}));
      const unknown=error=>error.code==='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'&&error.outcome==='UNKNOWN'&&error.retry_safe===false;
      const sourceUnknown=error=>unknown(error)||(error instanceof AggregateError&&unknown(error.cause)
        &&error.errors[0]===error.cause&&error.errors.every(unknown));
      const openRecords=[],decodedLines=[];let batchHook=null,closeHook=null,openHook=null,decoderCreations=0;
      // Reuse the existing extracted shipping-consumer fixture. Hooks observe
      // actual decoder yields/actual reader close; never replace parse results,
      // manufacture an EOF receipt, pg.Client, context or target authority.
      const consume=new Function('types','isDeepStrictEqual','privateFailures','readVerifiedPrivateImportSource',
        'openVerifiedRestoreTableData','createRestoreRowUtf8Guard','createRestoreRowLineBatchDecoder','pipeline','createInterface','decodeRestoreTableRowLine',
        consumer.slice(first,last)+'\nreturn consumeVerifiedOrdinaryTable;')(
        types,isDeepStrictEqual,new WeakMap(),sourceOf,(...args)=>{
          const data=open(...args),record={data,closes:0};readers.push(data);openRecords.push(record);if(openHook)openHook(data);
          return {...data,close:async()=>{record.closes++;await data.close();if(closeHook)await closeHook();}};
        },createRestoreRowUtf8Guard,()=>{
          decoderCreations++;const decoder=createRestoreRowLineBatchDecoder();
          if(batchHook){const iterate=decoder[Symbol.asyncIterator];decoder[Symbol.asyncIterator]=function(){const iterator=Reflect.apply(iterate,this,[]);
            return {async next(){const item=await iterator.next();if(!item.done)await batchHook(item.value);return item;},
              async return(){return iterator.return();},[Symbol.asyncIterator](){return this;}};};}
          return decoder;
        },pipeline,createInterface,(line,table)=>{decodedLines.push(line);return decodeRestoreTableRowLine(line,table);});
      const choose=(original,name=registry,schema='public')=>original.selection.databaseTables.find(t=>t.schema_name===schema&&t.table_name===name);
      const cleanRecord=start=>{assert.equal(openRecords.length-start,1,'No internal retry/new reader');assert.equal(openRecords[start].closes,1,'Consumer closes its actual reader once');assert.ok(openRecords[start].data.stream.closed);};
      await run('BOOTSTRAP_BATCH_NEW signed many-row and empty fixed members retain EOF and two contexts without DML',async()=>{
        for(const name of [registry,release])for(const count of [0,7118]){
          const rows=Array.from({length:count},(_,i)=>raw.replace('9223372036854775807',String(i))),archive=metadata({name,rows}),original=sourceOf(archive);
          const start=openRecords.length,decodedStart=decodedLines.length,created=decoderCreations,calls=[];let contexts=0;
          assert.equal(await consume(archive,original,choose(original,name),async(...args)=>calls.push(args),async()=>{contexts++;}),count);
          assert.deepEqual(calls,[]);assert.equal(contexts,2);assert.equal(decoderCreations-created,1);cleanRecord(start);
          assert.deepEqual(decodedLines.slice(decodedStart),rows.map(row=>JSON.stringify(row)));
          const eof=await openRecords[start].data.verified;assert.equal(eof.sha256,hash(wire(rows)));assert.equal(eof.bytes,wire(rows).length);
          assert.equal(eof.data_file,choose(original,name).data_file);
        }
      });
      await run('BOOTSTRAP_BATCH_NEW exact name and realm only leave adjacent ordinary mutations unbatched',async()=>{
        for(const [schema,name] of [['public','ordinary_batch_adjacent'],['auth',registry],['public',registry+'_copy']]){
          const archive=metadata({schema,name}),original=sourceOf(archive),start=openRecords.length,created=decoderCreations,calls=[];
          assert.equal(await consume(archive,original,choose(original,name,schema),async(text,args)=>calls.push({text,args}),async()=>{}),1);
          assert.deepEqual(calls,[{text:'select custodial_dr.insert_immutable_ordinary_row($1::text,$2::text,$3::text,$4::jsonb) as context',args:[schema,name,raw]}]);
          assert.equal(decoderCreations,created);cleanRecord(start);
        }
      });
      await run('BOOTSTRAP_BATCH_NEW declared short excess malformed UTF8 and interrupted EOF refuse with one cleanup',async()=>{
        for(const options of [{rows:[raw],declared:0},{rows:[],declared:1},{rows:[raw,raw],declared:1},
          {declared:1,data:Buffer.from('not-json\n')},{declared:1,data:Buffer.from([0xc3])}]){
          const archive=metadata(options),original=sourceOf(archive),start=openRecords.length,calls=[];let contexts=0;
          await assert.rejects(()=>consume(archive,original,choose(original),async(...args)=>calls.push(args),async()=>{contexts++;}));
          assert.deepEqual(calls,[]);assert.equal(contexts,1);cleanRecord(start);
        }
        // Materialized originals are deliberately read-only. Preserve the
        // initial EACCES overwrite attempt; use the existing real-reader
        // stream-error facility instead, never chmod/replace protected input.
        const archive=metadata(),original=sourceOf(archive),table=choose(original),start=openRecords.length,calls=[];
        const failure=new Error('SYNTHETIC_ORIGINAL_DATA_STREAM_INTERRUPTED');
        openHook=data=>data.stream.destroy(failure);
        try{await assert.rejects(()=>consume(archive,original,table,async(...args)=>calls.push(args),async()=>{}),error=>error===failure);}
        finally{openHook=null;}
        assert.deepEqual(calls,[]);cleanRecord(start);await assert.rejects(openRecords[start].data.verified,error=>error===failure);
      });
      await run('BOOTSTRAP_BATCH_NEW source withdrawal at actual batch yield and close retains failure no retry',async()=>{
        for(const boundary of ['yield-close','reader-close']){
          const archive=metadata({rows:Array.from({length:100},()=>raw)}),original=sourceOf(archive),start=openRecords.length,calls=[];let hit=false;
          const withdraw=()=>{if(hit)return;hit=true;archive.cleanup();};
          if(boundary==='reader-close')closeHook=withdraw;else batchHook=async()=>{await Promise.resolve();withdraw();};
          try{await assert.rejects(()=>consume(archive,original,choose(original),async(...args)=>calls.push(args),async()=>{}),sourceUnknown);}
          finally{batchHook=null;closeHook=null;}
          assert.ok(hit);assert.deepEqual(calls,[]);cleanRecord(start);
        }
      });
      await run('BOOTSTRAP_BATCH_NEW final context refusal cannot complete metadata or cause DML',async()=>{
        const archive=metadata({rows:Array.from({length:80},()=>raw)}),original=sourceOf(archive),start=openRecords.length,calls=[];
        const refusal=new Error('SYNTHETIC_FINAL_CONTEXT_WITHDRAWN');let contexts=0;
        await assert.rejects(()=>consume(archive,original,choose(original),async(...args)=>calls.push(args),async()=>{if(++contexts===2)throw refusal;}),error=>error===refusal);
        assert.equal(contexts,2);assert.deepEqual(calls,[]);cleanRecord(start);
      });
      assert.ok(cases.length>0,'Unknown/empty new bootstrap batch case selector');
      console.log(JSON.stringify({selector:'--immutable-bootstrap-batch-source-only',count:cases.length,cases,
        status:'PASS_NEW_BOOTSTRAP_BATCH_SOURCE_RECORDING_ONLY',actual_SQL:'NOT_RUN',
        limits:'Actual sealed decoder/extracted shipping consumer and signed UNIT archives. Recording mutation/context ports only; no real pg.Client, target/owner/server guards, DATA restore or performance qualification.',
        resources:{SQL_connections:0,JVMs:0,listeners:0}}));
    }else if(mutationWitnessOnly){
      const {types,isDeepStrictEqual}=await import('node:util');
      const {readVerifiedPrivateImportSource:sourceOf}=await import('./disaster-recovery-archive.mjs');
      const source=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
      const prefixStart=source.indexOf('const witnessKeys='),prefixEnd=source.indexOf('// Stage and finish ONLY');
      const sqlStart=source.indexOf('  async function sql('),sqlEnd=source.indexOf('  const initial=',sqlStart);
      const checkStart=source.indexOf('  async function assertContext(){'),checkEnd=source.indexOf('  // Private closure:',checkStart);
      const mutateStart=source.indexOf('  async function mutate('),mutateEnd=source.indexOf('  const ordinaryOrder=',mutateStart);
      const privateStart=source.indexOf('  let total=0;'),privateEnd=source.indexOf('  for(const selected of ordinaryOrder)',privateStart);
      assert(prefixStart>0&&prefixEnd>prefixStart&&sqlStart>prefixEnd&&sqlEnd>sqlStart&&checkEnd>checkStart&&mutateEnd>mutateStart&&privateEnd>privateStart);
      // Existing extracted-shipping-source facility. Actual signed UNIT
      // readers/loops/private mutation closure; query RECORDS protocol only.
      // No pg.Client substitute, server checks or target authority are claimed.
      const build=new Function('types','isDeepStrictEqual','privateFailures','readVerifiedPrivateImportSource',
        'openVerifiedRestoreTableData','createRestoreRowUtf8Guard','pipeline','createInterface','decodeRestoreTableRowLine',
        source.slice(prefixStart,prefixEnd)+'\nreturn function(verifiedArchive,original,witness,query){const db={};\n'+
        source.slice(sqlStart,sqlEnd)+source.slice(checkStart,checkEnd)+source.slice(mutateStart,mutateEnd)+
        '\nreturn {readWitness:contextWitness,ordinary:selected=>consumeVerifiedOrdinaryTable(verifiedArchive,original,selected,mutate,assertContext),'+
        'plan:()=>planVerifiedOrdinaryTables(verifiedArchive,original,sql,assertContext),private:async()=>{'+
        source.slice(privateStart,privateEnd)+'\nreturn total;}};};')(
        types,isDeepStrictEqual,new WeakMap(),sourceOf,(...args)=>{const data=open(...args);readers.push(data);return data;},
        createRestoreRowUtf8Guard,pipeline,createInterface,decodeRestoreTableRowLine);
      const witness=Object.freeze({database_oid:'42',backend_pid:123,transaction_id:'456',restore_id:'11111111-2222-4333-8444-555555555555',authority_generation:'7',archive_digest:'a'.repeat(64)});
      const reply=()=>({rowCount:1,rows:[{context:{...witness}}]});
      const unknown=e=>e.code==='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'&&e.outcome==='UNKNOWN'&&e.retry_safe===false;
      const raw=' {"id":9223372036854775807,"value":{"n":9007199254740993,"decimal":1.2300,"original":"café"}}';
      const columns=[{name:'id',data_type:'bigint',generated:'',identity:''},{name:'value',data_type:'json',generated:'',identity:''}];
      const wire=rows=>Buffer.from(rows.map(row=>JSON.stringify(row)+'\n').join(''));
      const ordinary=(rows=[raw],declared=rows.length)=>materialize(fixture({data:wire(rows),declaredRows:declared,
        changeCatalog:catalog=>{catalog[0].row_count=String(declared);}}));
      const pick=original=>original.selection.databaseTables.find(t=>t.schema_name==='public'&&t.table_name==='records');
      const fixed={ordinary:'select custodial_dr.insert_immutable_ordinary_row($1::text,$2::text,$3::text,$4::jsonb) as context',
        stage:'select custodial_dr.stage_immutable_ordinary_row($1::text,$2::text,$3::text,$4::jsonb) as context',
        set:'select custodial_dr.insert_staged_immutable_ordinary_table($1::text,$2::text,$3::jsonb) as context',
        private:'select custodial_dr.stage_immutable_private_row($1::text,$2::text,$3::text,$4::jsonb) as context'};
      const fixtureApi=(archive,respond=()=>reply())=>{const original=sourceOf(archive),calls=[];
        const api=build(archive,original,witness,async(text,args)=>{calls.push({text,args});return respond(text,args,original);});
        return {archive,original,calls,api};};
      const privateArchive=()=>materialize(fixture({data:Buffer.alloc(0),privateTables:['employee_message_original_outcomes','group_original_creations'].map(name=>({name,primaryKey:['id'],columns,data:wire([raw])}))}));
      const withSelf=(text,_args,original)=>text.includes('pg_catalog.pg_constraint')?{rowCount:original.selection.databaseTables.length,
        rows:original.selection.databaseTables.map((t,i)=>({schema_name:t.schema_name,table_name:t.table_name,relation_oid:String(11+i),relation_kind:'r',persistence:'p',is_partition:false,
          foreign_keys:t.schema_name==='public'?[{constraint_oid:'91',parent_schema_name:t.schema_name,parent_table_name:t.table_name,parent_relation_oid:String(11+i),validated:true,deferrable:false,initially_deferred:false}]:[]}))}:reply();
      const contextReads=calls=>calls.filter(c=>c.text.includes('immutable_import_assert_context()')).length;
      const oidTextOnly=process.argv.includes('--immutable-witness-oid-text-only');
      await run('MUTATION_WITNESS_OID_TEXT_NEW strict OID text and bounded PID preserve private mutation witness',async()=>{
        const x=fixtureApi(ordinary());
        assert.equal(await x.api.ordinary(pick(x.original)),1);
        assert.deepEqual(x.calls[0],{text:fixed.ordinary,args:['public','records',raw,JSON.stringify(witness)]});
        assert.equal(JSON.parse(x.calls[0].args[3]).database_oid,'42');assert.equal(x.calls.length,2);
        for(const database_oid of ['1','42','4294967295'])for(const backend_pid of [1,123,2147483647]){
          const context={...witness,database_oid,backend_pid};
          assert.deepEqual(x.api.readWitness({rowCount:1,rows:[{context}]}),context);
        }
        let coerced=0;const object={toString(){coerced++;return '42';},valueOf(){coerced++;return 42;}};
        const invalidOids=[42,0,4294967295,42n,null,undefined,true,object,new String('42'),'',
          '0','00','01','+1','-1',' 42','42 ','42\n','42\r','42\r\n','42\u2028','42\u2029',
          '1.0','1e2','0x2a','4294967296','9007199254740993','9'.repeat(1000)];
        for(const database_oid of invalidOids)assert.throws(()=>x.api.readWitness({rowCount:1,rows:[{context:{...witness,database_oid}}]}),unknown);
        for(const backend_pid of [0,-0,-1,1.5,2147483648,Number.MAX_SAFE_INTEGER,NaN,Infinity,'123',123n,null,undefined,object])
          assert.throws(()=>x.api.readWitness({rowCount:1,rows:[{context:{...witness,backend_pid}}]}),unknown);
        assert.equal(coerced,0);
        for(const database_oid of [42,'43']){
          const bad=fixtureApi(ordinary(),()=>({rowCount:1,rows:[{context:{...witness,database_oid}}]}));
          await assert.rejects(()=>bad.api.ordinary(pick(bad.original)),unknown);assert.equal(bad.calls.length,1);
          assert.equal(JSON.parse(bad.calls[0].args[3]).database_oid,'42');
        }
      });
      if(!oidTextOnly){
      await run('MUTATION_WITNESS_NEW ordinary original raw plus private witness one command then EOF check',async()=>{
        const x=fixtureApi(ordinary());assert.equal(await x.api.ordinary(pick(x.original)),1);
        assert.deepEqual(x.calls[0],{text:fixed.ordinary,args:['public','records',raw,JSON.stringify(witness)]});
        assert.equal(x.calls.length,2);assert.equal(contextReads(x.calls),1);assert.ok(readers.at(-1).stream.closed);await readers.at(-1).verified;
      });
      await run('MUTATION_WITNESS_NEW private staging binds original witness without added context reads',async()=>{
        const x=fixtureApi(privateArchive());assert.equal(await x.api.private(),2);assert.equal(contextReads(x.calls),0);
        assert.deepEqual(x.calls.map(c=>c.text),[fixed.private,fixed.private]);
        assert.deepEqual(x.calls.map(c=>c.args),['employee_message_original_outcomes','group_original_creations'].map(name=>['custodial_release_identity',name,raw,JSON.stringify(witness)]));
      });
      await run('MUTATION_WITNESS_NEW staged set keeps EOF context and validates both mutation returns',async()=>{
        const x=fixtureApi(ordinary(),withSelf),order=await x.api.plan(),selected=order.find(t=>t.schema_name==='public');x.calls.length=0;
        assert.equal(await x.api.ordinary(selected),1);assert.equal(contextReads(x.calls),1);
        assert.equal(x.calls[0].text,fixed.stage);assert.deepEqual(x.calls[0].args,['public','records',raw,JSON.stringify(witness)]);
        assert.equal(x.calls[2].text,fixed.set);assert.deepEqual(x.calls[2].args,['public','records',JSON.stringify(witness)]);assert.equal(x.calls.length,3);
      });
      await run('MUTATION_WITNESS_NEW each of four commands rejects wrong returned witness UNKNOWN no replay',async()=>{
        for(const target of Object.values(fixed)){
          const x=fixtureApi(target===fixed.private?privateArchive():ordinary(),(text,args,original)=>text===target?{rowCount:1,rows:[{context:{...witness,transaction_id:'457'}}]}:withSelf(text,args,original));
          let selected=pick(x.original);if(target===fixed.stage||target===fixed.set)selected=(await x.api.plan()).find(t=>t.schema_name==='public');x.calls.length=0;
          await assert.rejects(()=>target===fixed.private?x.api.private():x.api.ordinary(selected),unknown);
          assert.equal(x.calls.filter(c=>c.text===target).length,1);assert.equal(x.calls.at(-1).text,target);
        }
      });
      await run('MUTATION_WITNESS_NEW type-sensitive mismatch for every original witness field refuses',async()=>{
        for(const key of Object.keys(witness)){
          const changed=typeof witness[key]==='number'?String(witness[key]):key==='transaction_id'?456:witness[key]+'foreign';
          const x=fixtureApi(ordinary(),()=>({rowCount:1,rows:[{context:{...witness,[key]:changed}}]}));
          await assert.rejects(()=>x.api.ordinary(pick(x.original)),unknown);assert.equal(x.calls.length,1);
        }
      });
      await run('MUTATION_WITNESS_NEW closed one-row decoder refuses null missing extra and sparse shapes',async()=>{
        const x=fixtureApi(ordinary()),bad=[null,{},[],{rowCount:0,rows:[]},{rowCount:1,rows:[]},{rowCount:1,rows:[{context:{...witness}},{}]},
          {rowCount:1,rows:[{context:{...witness}},,]},{rowCount:1,rows:[{}]},{rowCount:1,rows:[{context:null}]},
          {rowCount:1,rows:[{context:{...witness},extra:false}]},{rowCount:1,rows:[{context:{...witness,extra:false}}]}];
        for(const key of Object.keys(witness)){const context={...witness};delete context[key];bad.push({rowCount:1,rows:[{context}]});}
        const symbol={...witness,[Symbol('foreign')]:false};bad.push({rowCount:1,rows:[{context:symbol}]});
        for(const value of bad)assert.throws(()=>x.api.readWitness(value),unknown);
        assert.deepEqual(x.api.readWitness(reply()),witness);assert.equal(x.calls.length,0);
      });
      await run('MUTATION_WITNESS_NEW getters and proxies refuse without invoking caller code',async()=>{
        const x=fixtureApi(ordinary());let touched=0;const getter=()=>{touched++;throw new Error('GETTER_MUST_NOT_RUN');};
        const outer=reply();Object.defineProperty(outer,'rows',{get:getter});const count=reply();Object.defineProperty(count,'rowCount',{get:getter});
        const row={};Object.defineProperty(row,'context',{get:getter});const context={...witness};Object.defineProperty(context,'archive_digest',{get:getter});
        const array=reply().rows;Object.defineProperty(array,'0',{get:getter});
        const proxy=new Proxy(reply(),{get:getter,getPrototypeOf:getter,ownKeys:getter});const rowsProxy=new Proxy(reply().rows,{get:getter,getPrototypeOf:getter,ownKeys:getter});
        for(const value of [outer,count,{rowCount:1,rows:[row]},{rowCount:1,rows:[{context}]},{rowCount:1,rows:array},proxy,{rowCount:1,rows:rowsProxy}])assert.throws(()=>x.api.readWitness(value),unknown);
        assert.equal(touched,0);assert.equal(x.calls.length,0);
      });
      await run('MUTATION_WITNESS_NEW SQL refusal and source withdrawal retain UNKNOWN and never retry',async()=>{
        const refused=fixtureApi(ordinary(),()=>{throw Object.assign(new Error('SYNTHETIC_RAW_DETAIL'),{code:'23514'});});
        await assert.rejects(()=>refused.api.ordinary(pick(refused.original)),e=>unknown(e)&&e.sql_state==='23514'&&!e.message.includes('RAW_DETAIL')&&!Object.hasOwn(e,'cause'));assert.equal(refused.calls.length,1);
        const archive=ordinary(),withdrawn=fixtureApi(archive,()=>{archive.cleanup();return reply();});
        await assert.rejects(()=>withdrawn.api.ordinary(pick(withdrawn.original)),unknown);assert.equal(withdrawn.calls.length,1);
      });
      await run('MUTATION_WITNESS_NEW declared bounds refuse mutation before excess original DATA',async()=>{
        for(const [rows,declared,expected] of [[[raw],0,0],[[raw,raw],1,1]]){
          const x=fixtureApi(ordinary(rows,declared));await assert.rejects(()=>x.api.ordinary(pick(x.original)),unknown);
          assert.equal(x.calls.filter(c=>c.text===fixed.ordinary).length,expected);assert.equal(contextReads(x.calls),0);
        }
      });
      await run('MUTATION_WITNESS_NEW bootstrap metadata remains no-effect with both context boundaries',async()=>{
        const archive=materialize(fixture({data:Buffer.alloc(0),ordinaryTables:[{schema:'public',name:'custodial_release_authority_restore_inventory',primaryKey:['id'],columns,data:wire([raw])}]}));
        const x=fixtureApi(archive),selected=x.original.selection.databaseTables.find(t=>t.table_name==='custodial_release_authority_restore_inventory');
        assert.equal(await x.api.ordinary(selected),1);assert.equal(x.calls.length,2);assert.equal(contextReads(x.calls),2);
      });
      }
      assert.equal(cases.length,oidTextOnly?1:11);
      console.log(JSON.stringify({selector:oidTextOnly?'--immutable-mutation-witness-caller-only --immutable-witness-oid-text-only':'--immutable-mutation-witness-caller-only',count:cases.length,cases,status:'PASS_NEW_CALLER_WITNESS_SOURCE_PROTOCOL_ONLY',actual_SQL:'NOT_RUN',server_mutation_contract:'MAIN_TASK7_OWNING_QUALIFICATION_REQUIRED',limits:'Actual extracted shipping closures and signed UNIT reader/EOF; recording query replies only. No server pre/post assertions, real pg.Client admission, DATA mutation, rollback, ACK or performance qualification.'}));
    }else if(selectionParsingOnly){
      await run('SELECTION_PARSING_NEW repeated reads reuse only exact mode validated selection',async()=>{
        const archive=materialize(fixture()),ordinary=selectOriginal(archive),database=selectOriginal(archive,{databaseOnly:true});
        assert.equal(selectOriginal(archive),ordinary);assert.equal(selectOriginal(archive,{databaseOnly:true}),database);
        assert.notEqual(ordinary,database);assert.equal(ordinary.databaseTables.length,2);assert.equal(database.databaseTables.length,3);
        assert.deepEqual(ordinary,selectVerifiedRestoreTables({summary:archive.summary,catalog:JSON.parse(readFileSync(join(archive.directory,'inventory/table-catalog.json'))),checksumPaths:archive.checksumPaths}));
        for(const databaseOnly of [null,0,1,'true',{},new Boolean(true)])assert.throws(()=>selectOriginal(archive,{databaseOnly}),/coverage/i);
        assert.equal(selectOriginal(archive),ordinary);
      });
      await run('SELECTION_PARSING_NEW reused containers arrays and table graph are deeply frozen',async()=>{
        const archive=materialize(fixture()),selection=selectOriginal(archive),pending=[selection];
        while(pending.length){const value=pending.pop();if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));pending.push(...Object.values(value));}}
        assert.throws(()=>selection.databaseTables.pop(),TypeError);
        assert.throws(()=>{selection.databaseTables[0].columns[0].data_type='foreign';},TypeError);
        assert.equal(selectOriginal(archive),selection);
      });
      await run('SELECTION_PARSING_NEW public summary and checksum mutations do not poison private cache',async()=>{
        const archive=materialize(fixture()),selection=selectOriginal(archive);
        archive.summary.table_count=0;archive.summary.source_identity.database_catalog_sha256='0'.repeat(64);
        archive.checksumPaths.clear();archive.checksumBytes.fill(0);archive.archiveDigest='0'.repeat(64);
        assert.equal(selectOriginal(archive),selection);assert.equal(selection.catalogRows,1);
      });
      await run('SELECTION_PARSING_NEW warm cache refuses changed catalog bytes',async()=>{
        const archive=materialize(fixture());selectOriginal(archive);
        const path=join(archive.directory,'inventory/table-catalog.json'),bytes=readFileSync(path);
        chmodSync(path,0o600);writeFileSync(path,bytes.toString('utf8').replace('records','foreign'));
        assert.throws(()=>selectOriginal(archive),/catalog/i);
      });
      await run('SELECTION_PARSING_NEW warm cache refuses same bytes replacement inode and aliases',async()=>{
        for(const alias of [false,true]){
          const archive=materialize(fixture());selectOriginal(archive);
          const path=join(archive.directory,'inventory/table-catalog.json'),saved=path+'.owned';
          if(alias)linkSync(path,saved);else{const bytes=readFileSync(path);renameSync(path,saved);writeFileSync(path,bytes);}
          assert.throws(()=>selectOriginal(archive),/catalog/i);
        }
      });
      await run('SELECTION_PARSING_NEW warm cache still rejects changed source controls',async()=>{
        for(const name of ['backup-summary.json','SHA256SUMS','archive-signature.json']){
          const archive=materialize(fixture());selectOriginal(archive);
          const path=join(archive.directory,name),bytes=readFileSync(path);renameSync(path,path+'.owned');writeFileSync(path,bytes);
          assert.throws(()=>selectOriginal(archive));
        }
      });
      await run('SELECTION_PARSING_NEW warm cache refuses root substitution and closed lifetime',async()=>{
        const archive=materialize(fixture());selectOriginal(archive);
        const directory=archive.directory,saved=directory+'.owned';renameSync(directory,saved);mkdirSync(directory,{mode:0o700});
        try{assert.throws(()=>selectOriginal(archive));}finally{rmdirSync(directory);renameSync(saved,directory);}
        archive.cleanup();assert.throws(()=>selectOriginal(archive),/snapshot/i);
      });
      await run('SELECTION_PARSING_NEW separate materializations never share a parsed selection',async()=>{
        const source=fixture(),first=materialize(source),second=materialize(source),one=selectOriginal(first),two=selectOriginal(second);
        assert.notEqual(one,two);assert.deepEqual(one,two);first.cleanup();assert.equal(selectOriginal(second),two);
        assert.throws(()=>selectOriginal({...second}),/snapshot/i);
      });
      await run('SELECTION_PARSING_NEW malformed catalog cannot populate reusable selection',async()=>{
        const archive=materialize(fixture({changeCatalog:catalog=>{catalog[0].columns[0].data_type='';}}));
        assert.throws(()=>selectOriginal(archive),/column/i);assert.throws(()=>selectOriginal(archive),/column/i);
      });
      assert.equal(cases.length,9);
      console.log(JSON.stringify({selector:'--immutable-source-selection-parsing-only',cases,count:cases.length,status:'PASS_NEW_SYNTHETIC_ARCHIVE_SELECTION_CASES_ONLY',sql:'NOT_RUN',performance:'NOT_MEASURED'}));
    }else if(authorityReconciliationOnly){
      const source=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
      const start=source.indexOf('  restorePhase = "authority_reconciliation";');
      const end=source.indexOf('  let cronEvidence = null;',start);
      assert.ok(start>=0&&end>start);
      // Existing extracted-shipping-source facility, not a second restore
      // implementation. All SQL/state/source/target ports here RECORD calls;
      // no connected pg.Client, original-owner admission or DATA effect exists.
      const reconcile=new Function('db','immutablePrivateDataEvidence','prepared','mutationFenceHeld','restoreId','generation',
        'requireOriginalArchiveSource','readTargetIdentity','assertIntentTargetIdentity','compareRestoredState',
        'preserveCurrentReleaseIdentity','invalidateRestoredAuthority','recordEvent',
        'return (async()=>{let restorePhase;\n'+source.slice(start,end)+'\nreturn {restorePhase,discrepancies,invalidated};})();');
      const make=({mixed=true,mode={rowCount:1,rows:[{session_replication_role:'origin'}]},prepared=true,fence=true,
        sourceFailureAt=0,targetFailure=null,effectFailure=null,rollbackFailure=false}={})=>{
        const calls=[],restoreId='00000000-0000-4000-8000-000000000001',generation=7;
        const originalEvidence=mixed?Object.freeze({source_recording_only:true}):null;
        const target=Object.freeze({source_recording_target_only:true}),differences=Object.freeze([{category:'device_assignments'}]);
        const invalidated=Object.freeze({employee_credentials:2,auth_sessions:1});let checks=0;
        const sourceError=new Error('SYNTHETIC_ORIGINAL_SOURCE_WITHDRAWN');
        const db={async query(text,args=[]){
          assert.equal(this,db,'the original db receiver must be retained');
          if(text==='show session_replication_role'){calls.push('mode');assert.deepEqual(args,[]);return mode;}
          if(text==='set local session_replication_role = replica'){
            calls.push('replica');assert.equal(mixed,false,'immutable reconciliation attempted replica mode');return {rowCount:0,rows:[]};
          }
          if(['begin','commit','rollback'].includes(text)){
            calls.push(text);if(text==='rollback'&&rollbackFailure)throw new Error('SYNTHETIC_ROLLBACK_REPLY_LOST');return {rowCount:0,rows:[]};
          }
          assert.ok(text.startsWith('update custodial_dr.restore_manifests set authority_invalidated=true'));
          calls.push('manifest');assert.deepEqual(args,[restoreId,JSON.stringify({invalidated,preserved_release_rows:1,discrepancies:differences})]);
          return {rowCount:1,rows:[]};
        }};
        const execute=()=>reconcile(db,originalEvidence,prepared,fence,restoreId,generation,
          ()=>{calls.push('source');if(++checks===sourceFailureAt)throw sourceError;},
          async()=>{calls.push('target');if(targetFailure)throw targetFailure;return target;},
          actual=>{calls.push('identity');assert.equal(actual,target);},
          async(actual,args)=>{calls.push('compare');assert.equal(actual,db);assert.deepEqual(args,{restoreId,generation});return differences;},
          async(actual,args)=>{calls.push('release');assert.equal(actual,db);assert.deepEqual(args,{restoreId});return 1;},
          async(actual,args)=>{calls.push('invalidate');assert.equal(actual,db);assert.deepEqual(args,{generation});if(effectFailure)throw effectFailure;return invalidated;},
          async(phase,state,details)=>{calls.push('event');assert.equal(phase,'AUTHORITY_RECONCILIATION');assert.equal(state,'PASSED');
            assert.deepEqual(details,{invalidated,preserved_release_rows:1,discrepancies:differences});});
        return {calls,execute,sourceError,differences,invalidated,originalEvidence};
      };
      await run('AUTHORITY_ORIGIN_NEW immutable DATA keeps origin and exact reconciliation order',async()=>{
        const x=make(),result=await x.execute();
        assert.deepEqual(x.calls,['begin','source','mode','source','target','identity','source','compare','release','invalidate','manifest','event','commit']);
        assert.equal(result.restorePhase,'authority_reconciliation');assert.equal(result.discrepancies,x.differences);assert.equal(result.invalidated,x.invalidated);
        assert.deepEqual(x.originalEvidence,{source_recording_only:true});
      });
      await run('AUTHORITY_ORIGIN_NEW nonorigin malformed mode or missing fence refuses before reconciliation',async()=>{
        for(const mode of [{rowCount:1,rows:[{session_replication_role:'replica'}]},
          {rowCount:1,rows:[{session_replication_role:'local'}]},{rowCount:0,rows:[]},
          {rowCount:2,rows:[{session_replication_role:'origin'},{session_replication_role:'origin'}]},
          {rowCount:1,rows:[{}]},{rowCount:1,rows:[{session_replication_role:true}]}]){
          const x=make({mode});await assert.rejects(x.execute,/origin/i);
          assert.deepEqual(x.calls,['begin','source','mode','rollback']);
        }
        for(const options of [{prepared:false},{fence:false}]){
          const x=make(options);await assert.rejects(x.execute,/fence/i);assert.deepEqual(x.calls,['begin','rollback']);
        }
      });
      await run('AUTHORITY_ORIGIN_NEW unchanged mutable route retains replica and original state calls',async()=>{
        const x=make({mixed:false}),result=await x.execute();
        assert.deepEqual(x.calls,['begin','replica','compare','release','invalidate','manifest','event','commit']);
        assert.equal(result.discrepancies,x.differences);assert.equal(result.invalidated,x.invalidated);
      });
      await run('AUTHORITY_ORIGIN_NEW source or target withdrawal cannot reach state mutations',async()=>{
        for(const sourceFailureAt of [1,2,3]){
          const x=make({sourceFailureAt});await assert.rejects(x.execute,error=>error===x.sourceError);
          assert.equal(x.calls.at(-1),'rollback');assert.equal(x.calls.includes('compare'),false);assert.equal(x.calls.includes('replica'),false);
        }
        const targetFailure=new Error('SYNTHETIC_ORIGINAL_TARGET_CHANGED'),x=make({targetFailure});
        await assert.rejects(x.execute,error=>error===targetFailure);
        assert.deepEqual(x.calls,['begin','source','mode','source','target','rollback']);
      });
      await run('AUTHORITY_ORIGIN_NEW guarded invalidation refusal retains first failure without fallback or retry',async()=>{
        const effectFailure=Object.assign(new Error('SYNTHETIC_EXISTING_GUARD_REFUSAL'),{code:'42501'});
        for(const rollbackFailure of [false,true]){
          const x=make({effectFailure,rollbackFailure});await assert.rejects(x.execute,error=>error===effectFailure);
          assert.deepEqual(x.calls,['begin','source','mode','source','target','identity','source','compare','release','invalidate','rollback']);
        }
      });
      assert.ok(cases.length>0,'Unknown/empty authority-reconciliation case selector');
      console.log(JSON.stringify({selector:'--immutable-authority-reconciliation-source-only',count:cases.length,cases,
        status:'PASS_CHANGED_CALLER_ROUTING_SOURCE_RECORDING_ONLY',actual_SQL:'NOT_RUN',
        limits:'Extracted shipping reconciliation region and recording ports only; no real owner/fence/identity/RLS/ALWAYS/auth invalidation, immutable DATA, rollback, anti-resurrection or runtime activation proof.',
        resources:{SQL_connections:0,listeners:0,JVMs:0}}));
    }else if(privateStageCountOnly){
      const {types,isDeepStrictEqual}=await import('node:util');
      const {readVerifiedPrivateImportSource:sourceOf}=await import('./disaster-recovery-archive.mjs');
      const consumer=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
      const failStart=consumer.indexOf('function fail('),planStart=consumer.indexOf('// The owner context');
      const sqlStart=consumer.indexOf('  async function sql('),sqlEnd=consumer.indexOf('  const initial=',sqlStart);
      const loopStart=consumer.indexOf('  let total=0;'),loopEnd=consumer.indexOf('  for(const selected of ordinaryOrder)',loopStart);
      assert.ok(failStart>=0&&planStart>failStart&&sqlStart>planStart&&sqlEnd>sqlStart&&loopStart>sqlEnd&&loopEnd>loopStart);
      // Existing extracted-source protocol facility: execute the ACTUAL private
      // DATA loop AND SQL source-currentness wrapper. query is a recording port,
      // never a connected pg.Client or a substitute owner/target admission.
      const privateFailureRecords=new WeakMap();
      const consume=new Function('types','isDeepStrictEqual','privateFailures','readVerifiedPrivateImportSource',
        'openVerifiedRestoreTableData','createRestoreRowUtf8Guard','pipeline','createInterface','decodeRestoreTableRowLine',
        consumer.slice(failStart,planStart)+'\nreturn async function(verifiedArchive,original,query){const db={};\n'+
        consumer.slice(sqlStart,sqlEnd)+consumer.slice(loopStart,loopEnd)+'\nreturn total;};')(
        types,isDeepStrictEqual,privateFailureRecords,sourceOf,(...args)=>{const data=open(...args);readers.push(data);return data;},
        createRestoreRowUtf8Guard,pipeline,createInterface,decodeRestoreTableRowLine);
      const columns=[{name:'id',data_type:'bigint',generated:'',identity:''},{name:'value',data_type:'json',generated:'',identity:''}];
      const raw='{"id":9223372036854775807,"value":{"n":9007199254740993,"original":"private"}}';
      const second='{"id":5,"value":{"original":"private-excess"}}';
      const encodeRows=rows=>Buffer.from(rows.map(row=>JSON.stringify(row)+'\n').join(''));
      const name='group_original_creations',schema='custodial_release_identity';
      const makeCount=(declared,rows)=>materialize(fixture({data:Buffer.alloc(0),declaredRows:declared,privateTables:[
        {name:'employee_message_original_outcomes',primaryKey:['id'],columns,data:Buffer.alloc(0)},
        {name,primaryKey:['id'],columns,data:encodeRows(rows)}],
        changeCatalog:catalog=>{catalog.find(table=>table.schema_name===schema&&table.table_name===name).row_count=String(declared);}}));
      const fixedSql='select custodial_dr.stage_immutable_private_row($1::text,$2::text,$3::text)';
      const sourceFailure=error=>error.code==='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'&&error.outcome==='UNKNOWN'&&error.retry_safe===false;
      const privateTable=original=>original.selection.privateTables.find(table=>table.table_name===name);
      await run('PRIVATE_STAGE_BOUND_NEW declared zero refuses before first fixed staging callback',async()=>{
        const archive=makeCount(0,[raw]),original=sourceOf(archive),calls=[];
        assert.equal(privateTable(original).row_count,'0');
        await assert.rejects(()=>consume(archive,original,async(text,args)=>calls.push({text,args})),sourceFailure);
        if(calls.length)console.error(JSON.stringify({case:'PRIVATE_STAGE_BOUND_NEW declared zero',
          stage:'ACTUAL_PRIVATE_LOOP_RECORDED_EXCESS_STAGE_BEFORE_EOF_REFUSAL',authenticated_row_count:'0',recorded_fixed_calls:calls.length}));
        assert.equal(calls.length,0);assert.ok(readers.at(-1).stream.closed);
      });
      await run('PRIVATE_STAGE_BOUND_NEW declared one refuses second fixed staging callback',async()=>{
        const archive=makeCount(1,[raw,second]),original=sourceOf(archive),calls=[];
        await assert.rejects(()=>consume(archive,original,async(text,args)=>calls.push({text,args})),sourceFailure);
        assert.deepEqual(calls,[{text:fixedSql,args:[schema,name,raw]}]);assert.ok(readers.at(-1).stream.closed);
      });
      await run('PRIVATE_STAGE_BOUND_NEW exact empty and positive retain original EOF SHA count and raw bytes',async()=>{
        for(const declared of [0,1]){
          const rows=declared?[raw]:[],archive=makeCount(declared,rows),original=sourceOf(archive),calls=[],before=JSON.stringify(original),first=readers.length;
          assert.equal(await consume(archive,original,async(text,args)=>calls.push({text,args})),declared);
          assert.deepEqual(calls,declared?[{text:fixedSql,args:[schema,name,raw]}]:[]);
          assert.equal(readers.length-first,2);
          for(const data of readers.slice(first)){
            const eof=await data.verified,member=original.privateDataMembers.find(row=>row.data_file===data.table.data_file);
            assert.equal(eof.data_file,member.data_file);assert.equal(eof.sha256,member.sha256);assert.equal(String(eof.bytes),member.bytes);
            assert.ok(data.stream.closed);
          }
          assert.equal(JSON.stringify(sourceOf(archive)),before);
        }
      });
      await run('PRIVATE_STAGE_BOUND_NEW short DATA and caller selected member counts refuse without staging',async()=>{
        const short=makeCount(1,[]),shortOriginal=sourceOf(short),calls=[];
        await assert.rejects(()=>consume(short,shortOriginal,async(text,args)=>calls.push({text,args})),sourceFailure);
        assert.deepEqual(calls,[]);assert.ok(readers.at(-1).stream.closed);
        const archive=makeCount(1,[raw]),original=sourceOf(archive),first=readers.length;
        const forgedMembers={...original,privateDataMembers:original.privateDataMembers.map(row=>row.table_name===name?{...row,row_count:'0'}:row)};
        await assert.rejects(()=>consume(archive,forgedMembers,async()=>calls.push('forged-member')),sourceFailure);
        const forgedSelection={...original,selection:{...original.selection,privateTables:original.selection.privateTables.map(row=>row.table_name===name?{...row,row_count:'0'}:row)}};
        await assert.rejects(()=>consume(archive,forgedSelection,async()=>calls.push('forged-selection')),sourceFailure);
        assert.equal(readers.length,first);assert.deepEqual(calls,[]);
      });
      await run('PRIVATE_STAGE_BOUND_NEW real source replacement and query refusal stop continuation UNKNOWN no retry',async()=>{
        const archive=makeCount(2,[raw,second]),original=sourceOf(archive),calls=[];
        await assert.rejects(()=>consume(archive,original,async(text,args)=>{
          calls.push({text,args});const path=join(archive.directory,'inventory/table-catalog.json');
          renameSync(path,path+'.preserved-original');writeFileSync(path,readFileSync(path+'.preserved-original'));
        }),sourceFailure);
        assert.deepEqual(calls,[{text:fixedSql,args:[schema,name,raw]}]);assert.ok(readers.at(-1).stream.closed);
        const refused=makeCount(1,[raw]),first=readers.length,attempts=[];
        await assert.rejects(()=>consume(refused,sourceOf(refused),async(text,args)=>{
          attempts.push({text,args});throw Object.assign(new Error('SYNTHETIC_RECORDING_QUERY_REFUSAL'),{code:'08003'});
        }),error=>sourceFailure(error)&&error.sql_state==='08003');
        assert.deepEqual(attempts,[{text:fixedSql,args:[schema,name,raw]}]);assert.equal(readers.length-first,2);
        assert.ok(readers.at(-1).stream.closed);
      });
      assert.ok(cases.length>0,'Unknown/empty private-stage-count case selector');
      console.log(JSON.stringify({selector:'--immutable-private-row-count-before-stage-source-only',count:cases.length,cases,
        status:'PASS_NEW_PRIVATE_STAGE_COUNT_BOUND_SOURCE_PROTOCOL_ONLY',
        limits:'Actual signed UNIT archives and extracted ACTUAL private loop/source-currentness SQL wrapper; recording fixed staging callbacks, not SQL, rollback, target admission, first restore or activation.',
        actual_SQL:'NOT_RUN',private_import_activation:'UNSUPPORTED_UNQUALIFIED',resources:{SQL_connections:0,JVMs:0}}));
    }else if(mixedConsumerOnly){
      const {types,isDeepStrictEqual}=await import('node:util');
      const {readVerifiedPrivateImportSource}=await import('./disaster-recovery-archive.mjs');
      const consumer=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
      const first=consumer.indexOf('function fail('),last=consumer.indexOf('// Stage and finish ONLY');
      assert.ok(first>=0&&last>first);
      // Existing source-loop fixture pattern: compile the ACTUAL internal
      // consumer and its original-source checks, not a copied implementation.
      // Recording SQL/context callbacks below establish NO target capability.
      const privateFailureRecords=new WeakMap();
      const observedOrdinaryEof=new WeakSet(); // Actual private reader promise, observation only.
      const {consume,scrubFailure,plan}=new Function('types','isDeepStrictEqual','privateFailures','readVerifiedPrivateImportSource',
        'openVerifiedRestoreTableData','createRestoreRowUtf8Guard','pipeline','createInterface','decodeRestoreTableRowLine',
        consumer.slice(first,last)+'\nreturn {consume:consumeVerifiedOrdinaryTable,scrubFailure:fail,plan:planVerifiedOrdinaryTables};')(
        types,isDeepStrictEqual,privateFailureRecords,readVerifiedPrivateImportSource,
        (...args)=>{const data=open(...args);readers.push(data);if(selfReferenceOnly)data.verified.then(()=>observedOrdinaryEof.add(data),()=>{});return data;},
        createRestoreRowUtf8Guard,pipeline,createInterface,decodeRestoreTableRowLine);
      const columns=[{name:'id',data_type:'bigint',generated:'',identity:''},{name:'value',data_type:'json',generated:'',identity:''}];
      const raw='{"id":4,"value":{"original":"mixed"}}',wire=Buffer.from(JSON.stringify(raw)+'\n');
      const privateRow={name:'group_original_creations',primaryKey:['id'],columns,data:wire};
      const make=options=>materialize(fixture({data:wire,privateTables:[privateRow],...options}));
      const sourceOf=archive=>readVerifiedPrivateImportSource(archive);
      const selected=(original,schema='public',name='records')=>original.selection.databaseTables.find(table=>table.schema_name===schema&&table.table_name===name);
      const sourceFailure=error=>error.code==='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'&&error.outcome==='UNKNOWN'&&error.retry_safe===false;
      if(bootstrapMetadataOnly){
        const registry='custodial_release_authority_restore_inventory',release='release_deployment_manifest';
        const originalRaw=' { "id":9223372036854775807, "value":{"n":9007199254740993,"decimal":1.2300,"source":"café original metadata, not target authority"} }';
        const secondRaw='{"id":5,"value":{"source":"second original metadata row"}}';
        const encodeRows=rows=>Buffer.from(rows.map(row=>JSON.stringify(row)+'\n').join(''));
        const metadata=items=>make({data:Buffer.alloc(0),privateTables:[{...privateRow,data:Buffer.alloc(0)}],
          ordinaryTables:items.map(item=>({schema:item.schema??'public',name:item.name,primaryKey:['id'],columns,
            data:item.data??encodeRows(item.rows??[])})),
          declaredRows:items.reduce((total,item)=>total+(item.declared??item.rows?.length??0),0),
          changeCatalog:catalog=>{for(const item of items)catalog.find(table=>table.schema_name===(item.schema??'public')
            &&table.table_name===item.name).row_count=String(item.declared??item.rows?.length??0);}});
        const selectedMetadata=(original,name=registry,schema='public')=>selected(original,schema,name);
        await run('BOOTSTRAP_METADATA_NEW bounded read-only lifetime rejects final context change',async()=>{
          const rows=Array.from({length:64},(_,i)=>'{"id":'+i+',"value":{"original":"metadata only"}}');
          const archive=metadata([{name:registry,rows}]),original=sourceOf(archive),table=selectedMetadata(original),calls=[];
          let checks=0;
          assert.equal(await consume(archive,original,table,async(...args)=>calls.push(args),async()=>{checks++;}),64);
          assert.equal(checks,2,'read-only metadata checks context at entry and authenticated EOF, not every row');
          assert.deepEqual(calls,[]);const eof=await readers.at(-1).verified;
          assert.equal(eof.sha256,hash(encodeRows(rows)));assert.equal(eof.bytes,encodeRows(rows).length);
          const changed=metadata([{name:registry,rows}]),changedOriginal=sourceOf(changed),refusal=new Error('current target changed during metadata read');
          let changedChecks=0;
          await assert.rejects(consume(changed,changedOriginal,selectedMetadata(changedOriginal),
            async(...args)=>calls.push(args),async()=>{if(++changedChecks===2)throw refusal;}),error=>error===refusal);
          assert.equal(changedChecks,2);assert.deepEqual(calls,[]);
          assert.ok(readers.at(-1).stream.closed);
        });
        await run('BOOTSTRAP_METADATA_NEW both fixed members verify empty and nonempty EOF without DML',async()=>{
          for(const name of [registry,release])for(const rows of [[originalRaw],[],[originalRaw,secondRaw]]){
            const archive=metadata([{name,rows}]),original=sourceOf(archive),table=selectedMetadata(original,name),calls=[];
            const before=JSON.stringify(original);let checks=0;
            assert.equal(await consume(archive,original,table,async(text,args)=>calls.push({text,args}),async()=>{checks++;}),rows.length);
            assert.deepEqual(calls,[],'current Source bootstrap metadata must never reach INSERT/stage/set');
            assert.equal(checks,2);
            const data=readers.at(-1),eof=await data.verified;
            assert.equal(eof.data_file,table.data_file);assert.equal(eof.sha256,hash(encodeRows(rows)));
            assert.equal(eof.bytes,encodeRows(rows).length);assert.ok(data.stream.closed);
            assert.equal(JSON.stringify(sourceOf(archive)),before);
          }
        });
        await run('BOOTSTRAP_METADATA_NEW real planner keeps self registry zero DML and rejects unselected FK parent',async()=>{
          const archive=metadata([{name:registry,rows:[originalRaw]}]),original=sourceOf(archive);
          const rows=original.selection.databaseTables.map((table,i)=>({schema_name:table.schema_name,table_name:table.table_name,
            relation_oid:String(100+i),relation_kind:'r',persistence:'p',is_partition:false,foreign_keys:[]}));
          const row=rows.find(table=>table.table_name===registry);
          row.foreign_keys.push({constraint_oid:'900',parent_schema_name:'public',parent_table_name:registry,
            parent_relation_oid:row.relation_oid,validated:true,deferrable:false,initially_deferred:false});
          let catalogQueries=0;
          const catalog=async(text,args)=>{catalogQueries++;assert.ok(text.includes("k.contype='f'"));
            assert.deepEqual(args,[JSON.stringify(original.selection.databaseTables.map(({schema_name,table_name})=>({schema_name,table_name})))]);
            return {rowCount:rows.length,rows};};
          const ordered=await plan(archive,original,catalog,async()=>{}),table=ordered.find(table=>table.table_name===registry);
          assert.equal(catalogQueries,1);assert.equal(ordered.length,original.selection.databaseTables.length-original.selection.privateTables.length);
          const calls=[];assert.equal(await consume(archive,original,table,async(text,args)=>calls.push({text,args}),async()=>{}),1);
          assert.deepEqual(calls,[],'even a planner-owned staged selection cannot INSERT the registry set');
          assert.equal((await readers.at(-1).verified).sha256,hash(encodeRows([originalRaw])));
          const readerCount=readers.length;
          await assert.rejects(()=>consume(archive,original,table,async()=>calls.push('retry'),async()=>{}),sourceFailure);
          assert.equal(readers.length,readerCount);assert.deepEqual(calls,[]);
          row.foreign_keys[0].parent_table_name='unselected_original_parent';
          row.foreign_keys[0].parent_relation_oid='999';
          await assert.rejects(()=>plan(archive,original,catalog,async()=>{}),sourceFailure);
          assert.equal(catalogQueries,2);assert.equal(readers.length,readerCount);
        });
        await run('BOOTSTRAP_METADATA_NEW mixed bootstrap and adjacent business keep exact fixed INSERT routing',async()=>{
          const items=[{name:release,rows:[]},{name:registry,rows:[originalRaw]},
            {name:'ordinary_original_business',rows:[secondRaw]},
            {name:registry,schema:'auth',rows:[originalRaw]},{name:registry+'_copy',rows:[secondRaw]}];
          const archive=metadata(items),original=sourceOf(archive),before=JSON.stringify(original),calls=[];
          for(const item of items){const table=selectedMetadata(original,item.name,item.schema??'public');
            assert.equal(await consume(archive,original,table,async(text,args)=>calls.push({text,args}),async()=>{}),item.rows.length);
            const eof=await readers.at(-1).verified;assert.equal(eof.sha256,hash(encodeRows(item.rows)));
          }
          const fixed='select custodial_dr.insert_immutable_ordinary_row($1::text,$2::text,$3::text)';
          assert.deepEqual(calls,[{text:fixed,args:['public','ordinary_original_business',secondRaw]},
            {text:fixed,args:['auth',registry,originalRaw]},{text:fixed,args:['public',registry+'_copy',secondRaw]}]);
          assert.equal(JSON.stringify(sourceOf(archive)),before);
          const privateTable=original.selection.privateTables[0],prior=readers.length;
          await assert.rejects(()=>consume(archive,original,privateTable,async()=>calls.push('private-skip'),async()=>{}),sourceFailure);
          assert.equal(readers.length,prior);assert.equal(calls.length,3);
        });
        await run('BOOTSTRAP_METADATA_NEW signed count and strict UTF8 failures cannot complete metadata',async()=>{
          for(const item of [{name:registry,rows:[originalRaw],declared:0},{name:registry,rows:[],declared:1},
            {name:registry,rows:[originalRaw,secondRaw],declared:1}]){
            const archive=metadata([item]),original=sourceOf(archive),calls=[];
            await assert.rejects(()=>consume(archive,original,selectedMetadata(original),async(text,args)=>calls.push({text,args}),async()=>{}),sourceFailure);
            assert.deepEqual(calls,[]);assert.ok(readers.at(-1).stream.closed);
          }
          const archive=metadata([{name:registry,declared:1,data:Buffer.from([0xc0,0x80,0x0a])}]),original=sourceOf(archive),calls=[];
          await assert.rejects(()=>consume(archive,original,selectedMetadata(original),async()=>calls.push('invalid-utf8'),async()=>{}));
          assert.deepEqual(calls,[]);assert.ok(readers.at(-1).stream.closed);
        });
        await run('BOOTSTRAP_METADATA_NEW original bytes source and context cannot be adopted across await',async()=>{
          for(const boundary of ['pre-row','post-row','post-EOF','source-close','same-bytes-catalog']){
            const archive=metadata([{name:registry,rows:[originalRaw]}]),original=sourceOf(archive),table=selectedMetadata(original),calls=[];
            const refusal=new Error('SYNTHETIC_BOOTSTRAP_CONTEXT_WITHDRAWN');let checks=0;
            await assert.rejects(()=>consume(archive,original,table,async()=>calls.push('unexpected'),async()=>{
              checks++;await new Promise(resolve=>setImmediate(resolve));
              if(checks===({ 'pre-row':1,'post-row':2,'post-EOF':3 }[boundary]))throw refusal;
              if(checks===1&&boundary==='source-close')archive.cleanup();
              if(checks===1&&boundary==='same-bytes-catalog'){
                const file=join(archive.directory,'inventory/table-catalog.json');renameSync(file,file+'.original');writeFileSync(file,readFileSync(file+'.original'));
              }
            }),error=>['pre-row','post-row','post-EOF'].includes(boundary)?error===refusal:sourceFailure(error));
            assert.deepEqual(calls,[]);assert.ok(readers.at(-1).stream.closed);
          }
          const archive=metadata([{name:registry,rows:[originalRaw]}]),original=sourceOf(archive),table=selectedMetadata(original),calls=[];
          const file=join(archive.directory,table.data_file);renameSync(file,file+'.original');
          writeFileSync(file,encodeRows([secondRaw]));
          await assert.rejects(()=>consume(archive,original,table,async()=>calls.push('changed-payload'),async()=>{}));
          assert.deepEqual(calls,[]);assert.deepEqual(readFileSync(file+'.original'),encodeRows([originalRaw]));
        });
        assert.ok(cases.length>0,'Unknown/empty bootstrap metadata case selector');
        console.log(JSON.stringify({selector:'--immutable-bootstrap-metadata-source-only',count:cases.length,cases,
          status:'PASS_FIXED_BOOTSTRAP_METADATA_SOURCE_RECORDING_ONLY',actual_SQL:'NOT_RUN',
          limits:'Actual signed unit archives/private no-follow readers/extracted shipping consumer+FK planner; recording ports only. No curated target registry/owner/context/bootstrap, guarded SQL, rollback, anti-resurrection, DATA restore or activation proof.',
          resources:{SQL_connections:0,listeners:0,JVMs:0}}));
      }else if(selfReferenceOnly){
        const empty=Buffer.alloc(0),emptyPrivate={...privateRow,data:empty};
        const name='employee_native_push_generations',stageSql='select custodial_dr.stage_immutable_ordinary_row($1::text,$2::text,$3::text)',
          finishSql='select custodial_dr.insert_staged_immutable_ordinary_table($1::text,$2::text)',
          ordinarySql='select custodial_dr.insert_immutable_ordinary_row($1::text,$2::text,$3::text)';
        // Structural source DATA, not complete provider SQL-valid records or
        // a live restore target. Preserve lexical numeric/JSON/row multiplicity.
        const historyColumns=[['generation_id','uuid'],['prior_generation_id','uuid'],['assignment_epoch','bigint'],['native_app','json']]
          .map(([name,data_type])=>({name,data_type,generated:'',identity:''}));
        const rawParent='{"generation_id":"11111111-1111-4111-8111-111111111111","prior_generation_id":null,"assignment_epoch":7,"native_app":{"n":9007199254740993,"decimal":1.230000}}',
          rawChild=' { "native_app":{"n":9223372036854775807,"text":"café\\n"},"assignment_epoch":7,"prior_generation_id":"11111111-1111-4111-8111-111111111111","generation_id":"22222222-2222-4222-8222-222222222222" }',
          rawChild2=rawChild.replace('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333');
        const encodeRows=rows=>Buffer.from(rows.map(row=>JSON.stringify(row)+'\n').join(''));
        const makeSelf=(rowData=[rawChild,rawParent,rawChild2],declared=rowData.length,parent=false)=>make({data:empty,privateTables:[emptyPrivate],
          ordinaryTables:[{schema:'public',name,primaryKey:['generation_id'],columns:historyColumns,data:encodeRows(rowData)},
            ...(parent?[{schema:'public',name:'z_parent',primaryKey:['id'],columns,data:wire}]:[])],declaredRows:declared+(parent?1:0),
          changeCatalog:catalog=>{catalog.find(table=>table.table_name===name).row_count=String(declared);}});
        const catalogRows=original=>original.selection.databaseTables.map((table,index)=>({schema_name:table.schema_name,table_name:table.table_name,
          relation_oid:String(index+100),relation_kind:'r',persistence:'p',is_partition:false,foreign_keys:[]}));
        const edge=(rows,child,parent,id='900')=>{const p=rows.find(row=>row.table_name===parent);
          rows.find(row=>row.table_name===child).foreign_keys.push({constraint_oid:id,parent_schema_name:p.schema_name,parent_table_name:p.table_name,
            parent_relation_oid:p.relation_oid,validated:true,deferrable:false,initially_deferred:false});};
        const readCatalog=(original,rows)=>async(text,args)=>{assert.ok(text.includes("k.contype='f'"));
          assert.deepEqual(args,[JSON.stringify(original.selection.databaseTables.map(({schema_name,table_name})=>({schema_name,table_name})))]);
          return {rowCount:rows.length,rows};};
        const route=async(archive,original,rows)=>{const ordered=await plan(archive,original,readCatalog(original,rows),async()=>{});
          return {ordered,chosen:ordered.find(table=>table.table_name===name)};};
        const selfRows=original=>{const rows=catalogRows(original);edge(rows,name,name);return rows;};
        await run('SELF_STAGE_NEW complete nonempty self original stages exact rows then one set after verified EOF',async()=>{
          for(const parent of [false,true]){
            const rowData=[rawChild,rawParent,rawChild2],archive=makeSelf(rowData,rowData.length,parent),original=sourceOf(archive),rows=selfRows(original),calls=[];
            if(parent)edge(rows,name,'z_parent','901');
            let ordered;
            try{({ordered}=await route(archive,original,rows));}
            catch(error){console.error(JSON.stringify({case:'SELF_STAGE_NEW nonempty self original',stage:'ACTUAL_PLANNER_REFUSED_AFTER_VALID_SELF_CATALOG',
              original_row_count:selected(original,'public',name).row_count,ordinary_readers_opened:readers.length,recording_stage_calls:0}));throw error;}
            assert.ok(Object.isFrozen(ordered));assert.equal(ordered.length,original.selection.databaseTables.length-1);
            if(parent)assert.ok(ordered.findIndex(table=>table.table_name==='z_parent')<ordered.findIndex(table=>table.table_name===name));
            for(const table of ordered)await consume(archive,original,table,async(text,args)=>{
              if(text===finishSql){const data=readers.at(-1);assert.equal(observedOrdinaryEof.has(data),true);
                assert.equal(data.stream.readableEnded,true);const eof=await data.verified;
                assert.equal(eof.sha256,hash(encodeRows(rowData)));assert.equal(eof.bytes,encodeRows(rowData).length);
                assert.equal(calls.filter(call=>call.text===stageSql).length,rowData.length);}
              calls.push({text,args});
            },async()=>{});
            assert.deepEqual(calls,[...(parent?[{text:ordinarySql,args:['public','z_parent',raw]}]:[]),
              ...rowData.map(row=>({text:stageSql,args:['public',name,row]})),{text:finishSql,args:['public',name]}]);
            assert.ok(readers.at(-1).stream.closed);
          }
        });
        await run('SELF_STAGE_NEW excess short and empty claimed sources never reach final insertion',async()=>{
          for(const [declared,rowData,stages]of [[1,[rawChild,rawParent],1],[2,[rawChild],1],[0,[rawChild],0]]){
            const archive=makeSelf(rowData,declared),original=sourceOf(archive),rows=selfRows(original),{chosen}=await route(archive,original,rows),calls=[];
            await assert.rejects(()=>consume(archive,original,chosen,async(text,args)=>calls.push({text,args}),async()=>{}),sourceFailure);
            assert.equal(calls.length,stages);assert.ok(calls.every(call=>call.text===stageSql));assert.equal(calls.some(call=>call.text===finishSql),false);
            assert.ok(readers.at(-1).stream.closed);
          }
        });
        await run('SELF_STAGE_NEW source loss context loss and ambiguous final result cannot retry',async()=>{
          for(const boundary of ['source','context','ambiguous-set']){
            const archive=makeSelf(),original=sourceOf(archive),{chosen}=await route(archive,original,selfRows(original)),calls=[],failure=new Error('SYNTHETIC_SELF_STAGE_UNKNOWN');
            let checks=0;
            const sql=async(text,args)=>{calls.push({text,args});if(boundary==='source'&&text===stageSql){await Promise.resolve();archive.cleanup();}
              if(boundary==='ambiguous-set'&&text===finishSql)throw failure;};
            await assert.rejects(()=>consume(archive,original,chosen,sql,async()=>{if(++checks===7&&boundary==='context')throw failure;}),
              error=>boundary==='source'?sourceFailure(error):error===failure);
            assert.equal(calls.filter(call=>call.text===finishSql).length,boundary==='ambiguous-set'?1:0);
            const before=calls.length;
            await assert.rejects(()=>consume(archive,original,chosen,sql,async()=>{}),sourceFailure);
            assert.equal(calls.length,before);assert.ok(readers.at(-1).stream.closed);
          }
        });
        await run('SELF_STAGE_NEW target parents constraints and cross table cycles stay fail closed',async()=>{
          for(const variant of ['cycle','private-parent','missing-parent','parent-oid','unvalidated','unknown','duplicate-constraint']){
            const archive=makeSelf(undefined,3,true),original=sourceOf(archive),rows=selfRows(original),before=readers.length;
            if(variant==='cycle'){edge(rows,name,'z_parent','901');edge(rows,'z_parent',name,'902');}
            else if(variant==='private-parent')edge(rows,name,privateRow.name,'901');
            else{const fk=rows.find(row=>row.table_name===name).foreign_keys[0];
              if(variant==='missing-parent')fk.parent_table_name='missing';if(variant==='parent-oid')fk.parent_relation_oid='99999';
              if(variant==='unvalidated')fk.validated=false;if(variant==='unknown')fk.authority=true;
              if(variant==='duplicate-constraint')edge(rows,name,'z_parent',fk.constraint_oid);}
            await assert.rejects(()=>route(archive,original,rows),sourceFailure);assert.equal(readers.length,before);
          }
        });
        await run('SELF_STAGE_NEW routing data cannot be copied moved or consumed twice',async()=>{
          const archive=makeSelf(),original=sourceOf(archive),{chosen}=await route(archive,original,selfRows(original)),calls=[];
          assert.ok(Object.isFrozen(chosen));
          await assert.rejects(()=>consume(archive,original,{...chosen},async()=>calls.push('forged'),async()=>{}),sourceFailure);assert.deepEqual(calls,[]);
          const other=makeSelf(),otherOriginal=sourceOf(other),before=readers.length;
          await assert.rejects(()=>consume(other,otherOriginal,chosen,async()=>calls.push('foreign'),async()=>{}),sourceFailure);
          await assert.rejects(()=>consume(archive,original,chosen,async()=>calls.push('revived'),async()=>{}),sourceFailure);
          assert.deepEqual(calls,[]);assert.equal(readers.length,before);
        });
        assert.ok(cases.length>0,'Unknown/empty self-reference consumer case selector');
        console.log(JSON.stringify({selector:'--immutable-self-reference-consumer-source-only',count:cases.length,cases,
          status:'PASS_NEW_SELF_REFERENCE_SOURCE_PROTOCOL_ONLY',
          limits:'Actual signed UNIT archive, original private source/EOF reader and extracted shipping planner/consumer; recording SQL/context callbacks only. No connected pg.Client owner-context admission, actual SQL FK/trigger execution, rollback, full restore or production activation proof.',
          actual_SQL:'NOT_RUN',resources:{SQL_connections:0,JVMs:0}}));
      }else if(rowCountBoundOnly){
        const empty=Buffer.alloc(0),emptyPrivate={...privateRow,data:empty};
        const rawSecond='{"id":5,"value":{"original":"excess"}}';
        const encodeRows=rows=>Buffer.from(rows.map(row=>JSON.stringify(row)+'\n').join(''));
        const makeCount=(declared,rows)=>make({data:encodeRows(rows),privateTables:[emptyPrivate],declaredRows:declared,
          changeCatalog:catalog=>{catalog.find(table=>table.schema_name==='public'&&table.table_name==='records').row_count=String(declared);}});
        const fixedSql='select custodial_dr.insert_immutable_ordinary_row($1::text,$2::text,$3::text)';
        await run('ROW_COUNT_BOUND_NEW declared zero stops first excess row before fixed INSERT',async()=>{
          const archive=makeCount(0,[raw]),original=sourceOf(archive),table=selected(original),calls=[];
          assert.equal(table.row_count,'0');
          await assert.rejects(()=>consume(archive,original,table,async(text,args)=>calls.push({text,args}),async()=>{}),sourceFailure);
          if(calls.length)console.error(JSON.stringify({case:'ROW_COUNT_BOUND_NEW declared zero',
            stage:'ACTUAL_CONSUMER_RECORDED_EXCESS_INSERT_BEFORE_EOF_REFUSAL',authenticated_row_count:table.row_count,
            recorded_fixed_calls:calls.length}));
          assert.equal(calls.length,0);assert.ok(readers.at(-1).stream.closed);
        });
        await run('ROW_COUNT_BOUND_NEW declared one stops second row before fixed INSERT',async()=>{
          const archive=makeCount(1,[raw,rawSecond]),original=sourceOf(archive),table=selected(original),calls=[];let checks=0;
          assert.equal(table.row_count,'1');
          await assert.rejects(()=>consume(archive,original,table,async(text,args)=>calls.push({text,args}),async()=>{checks++;}),sourceFailure);
          assert.deepEqual(calls,[{text:fixedSql,args:['public','records',raw]}]);
          assert.equal(checks,3);assert.ok(readers.at(-1).stream.closed);
        });
        await run('ROW_COUNT_BOUND_NEW honest zero and one retain exact EOF counts and calls',async()=>{
          for(const declared of [0,1]){
            const rows=declared?[raw]:[],archive=makeCount(declared,rows),original=sourceOf(archive),
              table=selected(original),before=JSON.stringify(original.selection),calls=[];let checks=0;
            assert.equal(await consume(archive,original,table,async(text,args)=>calls.push({text,args}),async()=>{checks++;}),declared);
            assert.deepEqual(calls,declared?[{text:fixedSql,args:['public','records',raw]}]:[]);
            assert.equal(checks,declared?3:1);
            const data=readers.at(-1),eof=await data.verified;
            assert.equal(eof.data_file,table.data_file);assert.equal(eof.bytes,encodeRows(rows).length);
            assert.equal(eof.sha256,hash(encodeRows(rows)));assert.ok(data.stream.closed);
            assert.equal(JSON.stringify(original.selection),before);
          }
        });
        await run('ROW_COUNT_BOUND_NEW short DATA caller counts and context stay fail closed',async()=>{
          const shortArchive=makeCount(1,[]),shortOriginal=sourceOf(shortArchive),calls=[];
          await assert.rejects(()=>consume(shortArchive,shortOriginal,selected(shortOriginal),
            async(text,args)=>calls.push({text,args}),async()=>{}),sourceFailure);
          assert.deepEqual(calls,[]);assert.ok(readers.at(-1).stream.closed);
          const archive=makeCount(1,[raw]),original=sourceOf(archive),table=selected(original),before=readers.length;
          const forged={...table,row_count:'0'};
          await assert.rejects(()=>consume(archive,original,forged,async()=>calls.push('forged'),async()=>{}),sourceFailure);
          const changed={...original,selection:{...original.selection,databaseTables:original.selection.databaseTables.map(row=>row===table?forged:row)}};
          await assert.rejects(()=>consume(archive,changed,forged,async()=>calls.push('changed'),async()=>{}),sourceFailure);
          assert.equal(readers.length,before);assert.deepEqual(calls,[]);
          const refused=new Error('SYNTHETIC_ORIGINAL_ROW_CONTEXT_REFUSAL');
          await assert.rejects(()=>consume(archive,original,table,async()=>calls.push('context'),
            async()=>{throw refused;}),error=>error===refused);
          assert.deepEqual(calls,[]);assert.ok(readers.at(-1).stream.closed);
        });
        assert.ok(cases.length>0,'Unknown/empty row-count-bound case selector');
        console.log(JSON.stringify({selector:'--immutable-row-count-before-insert-source-only',count:cases.length,cases,
          status:'PASS_NEW_DECLARED_ROW_COUNT_BOUND_SOURCE_PROTOCOL_ONLY',
          limits:'Actual signed UNIT archive and extracted original consumer; recording fixed SQL/context ports only. No actual target INSERT, transaction rollback, owner admission or restore activation proof.',
          actual_SQL:'NOT_RUN',resources:{SQL_connections:0,JVMs:0}}));
      }else if(dependencyOrderOnly||emptyDependencyOrderOnly){
        // Only the actual internal planner/consumer are extracted above.
        // These graph rows/SQL callbacks model a catalog protocol, NOT a
        // connected target, owner context, fresh DATA or constraint execution.
        const tableKey=table=>JSON.stringify([table.schema_name,table.table_name]);
        const catalogRows=original=>original.selection.databaseTables.map((table,index)=>({schema_name:table.schema_name,
          table_name:table.table_name,relation_oid:String(index+100),relation_kind:'r',persistence:'p',is_partition:false,foreign_keys:[]}));
        const fk=(rows,child,parent,id='900')=>{
          const target=rows.find(row=>row.table_name===parent);
          rows.find(row=>row.table_name===child).foreign_keys.push({constraint_oid:id,parent_schema_name:target.schema_name,
            parent_table_name:target.table_name,parent_relation_oid:target.relation_oid,validated:true,deferrable:false,initially_deferred:false});
        };
        const makeGraph=()=>make({data:Buffer.alloc(0),ordinaryTables:['a_child','z_parent'].map(name=>({schema:'public',name,primaryKey:['id'],columns,data:wire})),
          changeCatalog:catalog=>catalog.sort((a,b)=>a.table_name==='a_child'?-1:b.table_name==='a_child'?1:0)});
        const observed=[];
        const readCatalog=(original,rows,after=async()=>{})=>async(text,args)=>{
          observed.push({text,args});assert.ok(text.includes('from pg_catalog.pg_constraint k'));
          assert.ok(text.includes("k.contype='f'"));assert.ok(text.includes('jsonb_to_recordset($1::jsonb)'));
          assert.deepEqual(args,[JSON.stringify(original.selection.databaseTables.map(({schema_name,table_name})=>({schema_name,table_name})))]);
          await after();return {rowCount:rows.length,rows};
        };
        if(emptyDependencyOrderOnly){
          const empty=Buffer.alloc(0),emptyPrivate={...privateRow,data:empty};
          const makeEmpty=(names=['a_child','z_parent'],parentData=empty)=>make({data:empty,privateTables:[emptyPrivate],
            ordinaryTables:names.map(name=>({schema:'public',name,primaryKey:['id'],columns,data:name==='z_parent'?parentData:empty}))});
          const consumeEvery=async(archive,original,ordered)=>{
            const ordinary=original.selection.databaseTables.filter(table=>table.schema_name!=='custodial_release_identity');
            assert.ok(Object.isFrozen(ordered));assert.equal(ordered.length,ordinary.length);
            assert.deepEqual(new Set(ordered),new Set(ordinary));
            const before=JSON.stringify(original.selection),calls=[];
            for(const table of ordered){
              const prior=readers.length;
              assert.equal(await consume(archive,original,table,async(text,args)=>calls.push({text,args}),async()=>{}),Number(table.row_count));
              assert.equal(readers.length,prior+1);
              const data=readers.at(-1),eof=await data.verified;
              assert.equal(eof.data_file,table.data_file);assert.ok(data.stream.closed);
              if(table.row_count==='0'){assert.equal(eof.bytes,0);assert.equal(eof.sha256,hash(empty));}
            }
            assert.equal(JSON.stringify(original.selection),before);
            assert.ok(calls.every(call=>call.text==='select custodial_dr.insert_immutable_ordinary_row($1::text,$2::text,$3::text)'));
            return calls;
          };
          await run('EMPTY_DEPENDENCY_NEW empty self FK retains exact zero-count SOURCE readback',async()=>{
            const archive=makeEmpty(['events_app_events']),original=sourceOf(archive),rows=catalogRows(original);
            const table=selected(original,'public','events_app_events');assert.equal(table.row_count,'0');
            fk(rows,'events_app_events','events_app_events');
            const row=rows.find(row=>row.table_name==='events_app_events');
            assert.equal(row.foreign_keys[0].parent_relation_oid,row.relation_oid);
            let checks=0,ordered;observed.length=0;
            try{ordered=await plan(archive,original,readCatalog(original,rows),async()=>{checks++;});}
            catch(error){
              assert.ok(sourceFailure(error));assert.equal(observed.length,1);assert.equal(checks,1);
              console.error(JSON.stringify({case:'EMPTY_DEPENDENCY_NEW empty self FK',stage:'ACTUAL_PLANNER_REFUSED_AFTER_VALID_CATALOG',
                authenticated_child_row_count:table.row_count,selected_self_parent:true,ordinary_readers_opened:0}));
              throw error;
            }
            assert.equal(checks,2);assert.equal(observed.length,1);assert.ok(ordered.includes(table));
            assert.deepEqual(await consumeEvery(archive,original,ordered),[]);
          });
          await run('EMPTY_DEPENDENCY_NEW empty cycle and empty child keep every selected ordinary table',async()=>{
            for(const variant of ['empty-cycle','deferrable-empty-cycle','empty-child-nonempty-parent']){
              const archive=makeEmpty(undefined,variant==='empty-child-nonempty-parent'?wire:empty),
                original=sourceOf(archive),rows=catalogRows(original);observed.length=0;
              fk(rows,'a_child','z_parent');
              if(variant!=='empty-child-nonempty-parent')fk(rows,'z_parent','a_child','901');
              if(variant==='deferrable-empty-cycle')for(const row of rows)for(const edge of row.foreign_keys){
                edge.deferrable=true;edge.initially_deferred=true;
              }
              let checks=0;
              const ordered=await plan(archive,original,readCatalog(original,rows),async()=>{checks++;});
              assert.equal(checks,2);assert.equal(observed.length,1);
              const calls=await consumeEvery(archive,original,ordered);
              assert.deepEqual(calls.map(call=>call.args),variant==='empty-child-nonempty-parent'?[['public','z_parent',raw]]:[]);
            }
          });
          await run('EMPTY_DEPENDENCY_NEW nonempty cross-table cycles remain unsupported after staged-self support',async()=>{
            for(const variant of ['cycle','deferrable-cycle']){
              const archive=makeGraph(),original=sourceOf(archive),rows=catalogRows(original);
              fk(rows,'a_child','z_parent');fk(rows,'z_parent','a_child','901');
              if(variant.startsWith('deferrable'))for(const row of rows)for(const edge of row.foreign_keys){
                edge.deferrable=true;edge.initially_deferred=true;
              }
              assert.equal(selected(original,'public','a_child').row_count,'1');
              const before=readers.length;observed.length=0;
              await assert.rejects(()=>plan(archive,original,readCatalog(original,rows),async()=>{}),sourceFailure);
              assert.equal(observed.length,1);assert.equal(readers.length,before);
            }
          });
          await run('EMPTY_DEPENDENCY_NEW zero child still validates catalog parents constraints and owner context',async()=>{
            for(const variant of ['unselected','foreign','private-parent','private-child','parent-oid','constraint-oid','unknown-field',
              'unvalidated','invalid-deferred','missing-relation','duplicate-relation']){
              const archive=makeEmpty(),original=sourceOf(archive),rows=catalogRows(original);observed.length=0;
              fk(rows,variant==='private-child'?privateRow.name:'a_child',variant==='private-parent'?privateRow.name:'z_parent');
              const child=rows.find(row=>row.table_name===(variant==='private-child'?privateRow.name:'a_child')),edge=child.foreign_keys[0];
              if(variant==='unselected')edge.parent_table_name='unselected_parent';
              if(variant==='foreign')edge.parent_schema_name='unselected_schema';
              if(variant==='parent-oid')edge.parent_relation_oid='9999';
              if(variant==='constraint-oid')edge.constraint_oid='0';
              if(variant==='unknown-field')edge.authority=true;
              if(variant==='unvalidated')edge.validated=false;
              if(variant==='invalid-deferred')edge.initially_deferred=true;
              if(variant==='missing-relation')rows.pop();
              if(variant==='duplicate-relation')rows[1]={...rows[0]};
              const before=readers.length;
              await assert.rejects(()=>plan(archive,original,readCatalog(original,rows),async()=>{}),sourceFailure);
              assert.equal(observed.length,1);assert.equal(readers.length,before);
            }
            for(const boundary of ['before','after','query','close']){
              const archive=makeEmpty(),original=sourceOf(archive),rows=catalogRows(original),
                refused=new Error('SYNTHETIC_EMPTY_ORDER_CONTEXT_REFUSAL');let checks=0;observed.length=0;
              fk(rows,'a_child','a_child');
              await assert.rejects(()=>plan(archive,original,readCatalog(original,rows,async()=>{
                if(boundary==='query')throw refused;if(boundary==='close')archive.cleanup();
              }),async()=>{if(++checks===(boundary==='before'?1:boundary==='after'?2:99))throw refused;}),
                error=>boundary==='close'?sourceFailure(error):error===refused);
              assert.equal(observed.length,boundary==='before'?0:1);
            }
          });
          await run('EMPTY_DEPENDENCY_NEW altered counts and nonempty zero-count DATA refuse',async()=>{
            for(const count of [0,'00','-0','1',null]){
              const archive=makeEmpty(['events_app_events']),original=sourceOf(archive),rows=catalogRows(original);
              const changed={...original,selection:{...original.selection,databaseTables:original.selection.databaseTables.map(table=>
                table.table_name==='events_app_events'?{...table,row_count:count}:table)}};
              let queries=0,checks=0;const before=readers.length;
              await assert.rejects(()=>plan(archive,changed,async()=>{queries++;return {rowCount:rows.length,rows};},async()=>{checks++;}),sourceFailure);
              assert.equal(queries,0);assert.equal(checks,0);assert.equal(readers.length,before);
            }
            // Synthetic signed catalog can lie about its DATA row count. It
            // cannot make the unchanged authenticated EOF/count consumer pass.
            const archive=make({data:empty,privateTables:[emptyPrivate],ordinaryTables:[
              {schema:'public',name:'events_app_events',primaryKey:['id'],columns,data:wire}],declaredRows:0,
              changeCatalog:catalog=>{catalog.find(table=>table.table_name==='events_app_events').row_count='0';}}),
              original=sourceOf(archive),rows=catalogRows(original),calls=[];
            fk(rows,'events_app_events','events_app_events');
            const ordered=await plan(archive,original,readCatalog(original,rows),async()=>{}),
              table=selected(original,'public','events_app_events');assert.ok(ordered.includes(table));
            await assert.rejects(()=>consume(archive,original,table,async(text,args)=>calls.push({text,args}),async()=>{}),sourceFailure);
            // The joined count bound now refuses before the first excess
            // fixed INSERT. Historical one-call behavior remains in the
            // immutable EMPTY-FK receipt; this recording port is not real SQL
            // or transaction rollback proof.
            assert.deepEqual(calls,[]);
            assert.ok(readers.at(-1).stream.closed);
          });
          assert.ok(cases.length>0,'Unknown/empty EMPTY dependency case selector');
          console.log(JSON.stringify({selector:'--immutable-empty-dependency-order-source-only',count:cases.length,cases,
            status:'PASS_NEW_EMPTY_DEPENDENCY_SOURCE_PROTOCOL_ONLY',
            limits:'Actual signed UNIT archive and original source reader/planner/consumer with recording catalog/context ports only; no database, owner admission, real constraints, rollback, restore activation or DATA-import authority.',
            actual_SQL:'NOT_RUN',resources:{SQL_connections:0,listeners:0,JVMs:0}}));
        }else{
        await run('DEPENDENCY_ORDER_NEW reversed acyclic target graph consumes every selected ordinary original parent first',async()=>{
          const archive=makeGraph(),original=sourceOf(archive),before=JSON.stringify(original.selection),rows=catalogRows(original),calls=[];
          assert.equal(original.selection.databaseTables[0].table_name,'a_child');fk(rows,'a_child','z_parent');
          let checks=0;observed.length=0;
          const ordered=await plan(archive,original,readCatalog(original,rows),async()=>{checks++;});
          assert.ok(Object.isFrozen(ordered));assert.equal(checks,2);assert.equal(observed.length,1);
          assert.deepEqual(ordered.map(tableKey),['["auth","records"]','["public","records"]','["public","z_parent"]','["public","a_child"]','["storage","records"]']);
          assert.deepEqual(new Set(ordered),new Set(original.selection.databaseTables.filter(table=>table.schema_name!=='custodial_release_identity')));
          for(const table of ordered)assert.equal(await consume(archive,original,table,async(text,args)=>{calls.push({text,args});},async()=>{}),Number(table.row_count));
          assert.deepEqual(calls.map(call=>call.args),[['public','z_parent',raw],['public','a_child',raw]]);
          assert.ok(calls.every(call=>call.text==='select custodial_dr.insert_immutable_ordinary_row($1::text,$2::text,$3::text)'));
          assert.equal(JSON.stringify(original.selection),before);assert.ok(readers.every(data=>data.stream.closed));
        });
        await run('DEPENDENCY_ORDER_NEW closed or replaced original during catalog await refuses before ordinary INSERT',async()=>{
          for(const boundary of ['close','replace']){
            const archive=makeGraph(),original=sourceOf(archive),rows=catalogRows(original);observed.length=0;const readersBefore=readers.length;
            await assert.rejects(()=>plan(archive,original,readCatalog(original,rows,async()=>{
              await new Promise(resolve=>setImmediate(resolve));
              if(boundary==='close')archive.cleanup();else{
                const path=join(archive.directory,'inventory/table-catalog.json');renameSync(path,path+'.original');writeFileSync(path,readFileSync(path+'.original'));
              }
            }),async()=>{}),sourceFailure);
            assert.equal(observed.length,1);assert.equal(readers.length,readersBefore);
          }
        });
        await run('DEPENDENCY_ORDER_NEW context loss or failed catalog read never reaches ordinary INSERT or retries',async()=>{
          for(const boundary of ['before','after','query']){
            const archive=makeGraph(),original=sourceOf(archive),rows=catalogRows(original),refusal=new Error('SYNTHETIC_CONTEXT_OR_CATALOG_REFUSAL');
            let checks=0;observed.length=0;const readersBefore=readers.length;
            await assert.rejects(()=>plan(archive,original,readCatalog(original,rows,async()=>{if(boundary==='query')throw refusal;}),async()=>{
              await Promise.resolve();if(++checks===(boundary==='before'?1:boundary==='after'?2:99))throw refusal;
            }),error=>error===refusal);
            assert.equal(observed.length,boundary==='before'?0:1);assert.equal(readers.length,readersBefore);
          }
        });
        await run('DEPENDENCY_ORDER_NEW foreign private missing or contradictory target dependencies refuse before ordinary INSERT',async()=>{
          for(const variant of ['unselected','foreign','private','parent-oid','missing-relation','extra-relation','duplicate-relation','unknown-field','unvalidated']){
            const archive=makeGraph(),original=sourceOf(archive),rows=catalogRows(original);observed.length=0;
            fk(rows,'a_child',variant==='private'?privateRow.name:'z_parent');
            const child=rows.find(row=>row.table_name==='a_child'),edge=child.foreign_keys[0];
            if(variant==='unselected')edge.parent_table_name='unselected_parent';
            if(variant==='foreign')edge.parent_schema_name='foreign_private_schema';
            if(variant==='parent-oid')edge.parent_relation_oid='9999';
            if(variant==='missing-relation')rows.pop();
            if(variant==='extra-relation')rows.push({...rows[0],table_name:'not_selected',relation_oid:'9999'});
            if(variant==='duplicate-relation')rows[1]={...rows[0]};
            if(variant==='unknown-field')edge.authority=true;
            if(variant==='unvalidated')edge.validated=false;
            const readersBefore=readers.length;
            await assert.rejects(()=>plan(archive,original,readCatalog(original,rows),async()=>{}),sourceFailure);
            assert.equal(observed.length,1);assert.equal(readers.length,readersBefore);
          }
        });
        await run('DEPENDENCY_ORDER_NEW cross-table cycles including deferrable refuse before ordinary INSERT after staged-self support',async()=>{
          for(const variant of ['cycle','deferrable-cycle']){
            const archive=makeGraph(),original=sourceOf(archive),rows=catalogRows(original);observed.length=0;
            fk(rows,'a_child','z_parent');fk(rows,'z_parent','a_child','901');
            if(variant.startsWith('deferrable'))for(const row of rows)for(const edge of row.foreign_keys){edge.deferrable=true;edge.initially_deferred=true;}
            const readersBefore=readers.length;
            await assert.rejects(()=>plan(archive,original,readCatalog(original,rows),async()=>{}),sourceFailure);
            assert.equal(observed.length,1);assert.equal(readers.length,readersBefore);
          }
        });
        assert.ok(cases.length>0,'Unknown/empty dependency case selector');
        console.log(JSON.stringify({selector:'--immutable-dependency-order-source-only',count:cases.length,cases,status:'PASS_NEW_DEPENDENCY_SOURCE_PROTOCOL_ONLY',
          limits:'Actual signed unit archive/no-follow reader/internal planner and consumer; recording catalog/context ports do not prove PostgreSQL dependencies, locks, owner admission, freshness, INSERT, rollback or activation.',actual_SQL:'NOT_RUN',resources:{SQL_connections:0,listeners:0,JVMs:0}}));
        }
      }else if(fixedRowConsumerOnly){
        const fixedSql='select custodial_dr.insert_immutable_ordinary_row($1::text,$2::text,$3::text)';
        const exactRaw='{ "id":9223372036854775807, "value":{"n":9007199254740993,"decimal":1.2300,"json":{"kept":1,"kept":2}} }';
        const exactWire=Buffer.from(JSON.stringify(exactRaw)+'\n');
        await run('FIXED_ROW_NEW exact literal and original large-number JSON TEXT with generated identity metadata',async()=>{
          for(const variant of ['ordinary','identity','generated']){
            const archive=make({data:exactWire,changeCatalog:catalog=>{if(variant==='identity')catalog[0].columns[0].identity='a';if(variant==='generated')catalog[0].columns[1].generated='s';}});
            const original=sourceOf(archive),table=selected(original),calls=[];let checks=0;
            assert.equal(await consume(archive,original,table,async(text,args)=>{assert.equal(text,fixedSql);calls.push({text,args});},async()=>{checks++;}),1);
            assert.deepEqual(calls,[{text:fixedSql,args:[table.schema_name,table.table_name,exactRaw]}]);
            assert.equal(checks,3);const eof=await readers.at(-1).verified;
            assert.equal(eof.sha256,hash(exactWire));assert.equal(eof.bytes,exactWire.length);assert.ok(readers.at(-1).stream.closed);
          }
        });
        await run('FIXED_ROW_NEW historical bootstrap verifies exact bytes with zero fixed calls',async()=>{
          const archive=make({ordinaryTables:[{schema:'public',name:'release_deployment_manifest',primaryKey:['id'],columns,data:exactWire}]}),original=sourceOf(archive);let calls=0,checks=0;
          assert.equal(await consume(archive,original,selected(original,'public','release_deployment_manifest'),async()=>{calls++;},async()=>{checks++;}),1);
          assert.equal(calls,0);assert.equal(checks,3);assert.equal((await readers.at(-1).verified).sha256,hash(exactWire));
        });
        await run('FIXED_ROW_NEW generated-only nonempty metadata still refuses before fixed call',async()=>{
          const archive=make({changeCatalog:catalog=>{for(const column of catalog[0].columns)column.generated='s';}}),original=sourceOf(archive);let calls=0;
          await assert.rejects(()=>consume(archive,original,selected(original),async()=>{calls++;},async()=>{}),sourceFailure);
          assert.equal(calls,0);assert.ok(readers.at(-1).stream.closed);
        });
        await run('FIXED_ROW_NEW Source owner close while fixed call awaits refuses completion',async()=>{
          const archive=make({data:exactWire}),original=sourceOf(archive),calls=[];
          await assert.rejects(()=>consume(archive,original,selected(original),async(text,args)=>{calls.push({text,args});await new Promise(resolve=>setImmediate(resolve));archive.cleanup();},async()=>{}),sourceFailure);
          assert.deepEqual(calls,[{text:fixedSql,args:['public','records',exactRaw]}]);assert.ok(readers.at(-1).stream.closed);
        });
        await run('FIXED_ROW_NEW original catalog replacement during fixed await cannot adopt same-byte successor',async()=>{
          const archive=make({data:exactWire}),original=sourceOf(archive),calls=[];
          await assert.rejects(()=>consume(archive,original,selected(original),async(text,args)=>{calls.push({text,args});await new Promise(resolve=>setImmediate(resolve));
            const path=join(archive.directory,'inventory/table-catalog.json');renameSync(path,path+'.original');writeFileSync(path,readFileSync(path+'.original'));},async()=>{}),sourceFailure);
          assert.deepEqual(calls,[{text:fixedSql,args:['public','records',exactRaw]}]);assert.ok(readers.at(-1).stream.closed);
        });
        await run('FIXED_ROW_NEW recording context loss before or after fixed await cannot finish or repeat',async()=>{
          for(const boundary of ['before','after']){
            const archive=make({data:exactWire}),original=sourceOf(archive),calls=[],refusal=new Error('SYNTHETIC_CONTEXT_REFUSAL_NOT_SQL_OWNER_PROOF');let checks=0;
            await assert.rejects(()=>consume(archive,original,selected(original),async(text,args)=>{calls.push({text,args});await new Promise(resolve=>setImmediate(resolve));},async()=>{await Promise.resolve();if(++checks===(boundary==='before'?1:2))throw refusal;}),error=>error===refusal);
            assert.deepEqual(calls,boundary==='before'?[]:[{text:fixedSql,args:['public','records',exactRaw]}]);assert.ok(readers.at(-1).stream.closed);
          }
        });
        await run('FIXED_ROW_NEW actual error scrubber retains first private failure and no second fixed call',async()=>{
          const archive=make({data:exactWire}),original=sourceOf(archive),calls=[],failure=Object.assign(new Error('SYNTHETIC_PRIVATE_DETAIL'),{code:'42501',detail:'SYNTHETIC_PRIVATE_ROW'});let rejection;
          await assert.rejects(()=>consume(archive,original,selected(original),async(text,args)=>{calls.push({text,args});await Promise.resolve();scrubFailure(failure);},async()=>{}),error=>{rejection=error;return sourceFailure(error)&&error.sql_state==='42501';});
          assert.equal(privateFailureRecords.get(rejection),failure);assert.equal(Object.hasOwn(rejection,'cause'),false);assert.equal(Object.hasOwn(rejection,'detail'),false);
          assert.equal(rejection.message,'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED');assert.deepEqual(calls,[{text:fixedSql,args:['public','records',exactRaw]}]);assert.ok(readers.at(-1).stream.closed);
        });
        console.log(JSON.stringify({selector:'--immutable-fixed-row-consumer-source-only',count:cases.length,cases,status:'PASS_NEW_FIXED_ROW_SOURCE_PROTOCOL_ONLY',
          limits:'Actual signed unit archive/no-follow reader/internal consumer and error scrubber; recording SQL/context ports are NOT SQL owner admission, freshness, INSERT, rollback or activation proof.',actual_SQL:'NOT_RUN',resources:{SQL_connections:0,listeners:0,JVMs:0}}));
      }else{
      // Only direct-DML expectations below changed for the new fixed port;
      // these historical cases are NOT replayed by this qualification.
      await run('mixed signed SOURCE public auth storage rows use original TEXT and private original remains retained',async()=>{
        const ordinaryTables=['auth','storage'].map(schema=>({schema,name:'original_data',primaryKey:['id'],columns,data:wire}));
        const archive=make({ordinaryTables}),original=sourceOf(archive),recorded=[];
        for(const table of original.selection.databaseTables.filter(table=>table.schema_name!=='custodial_release_identity')){
          const count=await consume(archive,original,table,async(text,args)=>{recorded.push({text,args});},async()=>{});
          assert.equal(String(count),table.row_count);
        }
        assert.equal(recorded.length,3);for(const entry of recorded){assert.equal(entry.args[2],raw);assert.equal(entry.text,'select custodial_dr.insert_immutable_ordinary_row($1::text,$2::text,$3::text)');}
        assert.deepEqual(recorded.map(x=>x.args.slice(0,2)),[['public','records'],['auth','original_data'],['storage','original_data']]);
        assert.deepEqual(await bytes(reader(archive,'custodial_release_identity',privateRow.name)),wire);
      });
      await run('mixed original generated and identity projection matches shipping ordinary INSERT recipe',async()=>{
        const archive=make({changeCatalog:catalog=>{catalog[0].columns[0].identity='a';catalog[0].columns[1].generated='s';}}),original=sourceOf(archive),calls=[];
        await consume(archive,original,selected(original),async(text,args)=>calls.push({text,args}),async()=>{});
        assert.deepEqual(calls,[{text:'select custodial_dr.insert_immutable_ordinary_row($1::text,$2::text,$3::text)',args:['public','records',raw]}]);
      });
      await run('mixed historical release bootstrap consumes authenticated EOF but never replaces target authority',async()=>{
        const archive=make({ordinaryTables:[{schema:'public',name:'release_deployment_manifest',primaryKey:['id'],columns,data:wire}]}),original=sourceOf(archive);let calls=0,checks=0;
        assert.equal(await consume(archive,original,selected(original,'public','release_deployment_manifest'),async()=>{calls++;},async()=>{checks++;}),1);
        assert.equal(calls,0);assert.equal(checks,3);assert.ok(readers.at(-1).stream.closed);await readers.at(-1).verified;
      });
      await run('mixed insertion failure preserves original failure and closes owned reader without finish or retry',async()=>{
        const archive=make(),original=sourceOf(archive),failure=new Error('SYNTHETIC_RECORDING_INSERT_REFUSAL');let calls=0;
        await assert.rejects(()=>consume(archive,original,selected(original),async()=>{calls++;throw failure;},async()=>{}),error=>error===failure);
        assert.equal(calls,1);assert.ok(readers.at(-1).stream.closed);
      });
      await run('mixed closed SOURCE during awaited ordinary INSERT refuses despite recorded original row',async()=>{
        const archive=make(),original=sourceOf(archive);let calls=0;
        await assert.rejects(()=>consume(archive,original,selected(original),async()=>{calls++;await Promise.resolve();archive.cleanup();},async()=>{}),sourceFailure);
        assert.equal(calls,1);assert.ok(readers.at(-1).stream.closed);
      });
      await run('mixed changed recording context after INSERT prevents consumer completion',async()=>{
        const archive=make(),original=sourceOf(archive),failure=new Error('SYNTHETIC_CONTEXT_REFUSAL_NOT_SQL_AUTHORITY');let calls=0,checks=0;
        await assert.rejects(()=>consume(archive,original,selected(original),async()=>{calls++;},async()=>{if(++checks===2)throw failure;}),error=>error===failure);
        assert.equal(calls,1);assert.equal(checks,2);assert.ok(readers.at(-1).stream.closed);
      });
      await run('mixed partial original row count cannot finish after consumed EOF',async()=>{
        const archive=make({data:Buffer.alloc(0),privateTables:[{...privateRow,data:Buffer.alloc(0)}],declaredRows:1,changeCatalog:catalog=>{catalog[0].row_count='1';}}),original=sourceOf(archive);let calls=0;
        await assert.rejects(()=>consume(archive,original,selected(original),async()=>{calls++;},async()=>{}),sourceFailure);
        assert.equal(calls,0);assert.ok(readers.at(-1).stream.closed);
      });
      assert.ok(cases.length>0,'Unknown/empty mixed case selector');
      console.log(JSON.stringify({selector:'--immutable-mixed-consumer-source-only',focused_case:mixedCase??null,count:cases.length,cases,status:'PASS_NEW_MIXED_SOURCE_ROW_CONSUMER_ONLY',
        limits:'Actual signed unit archive/private no-follow reader and shipping internal TEXT loop; unconnected recording SQL/context callbacks are protocol ONLY, not owner admission, target freshness, guarded SQL, rollback or activation.',
        actual_SQL:'NOT_RUN',resources:{SQL_connections:0,listeners:0,JVMs:0}}));
      }
    }else if(ownerContextOnly){
      const {readVerifiedPrivateImportSource:sourceOf,readVerifiedArchiveSourceBinding:bindingOf}=await import('./disaster-recovery-archive.mjs');
      const {stageVerifiedImmutablePrivateData:stage}=await import('./immutable-private-data-import.mjs');
      const {restoreIntentBinding}=await import('./disaster-recovery-crypto.mjs');
      const {default:pg}=await import('pg');
      const fields=items=>items.map(([name,data_type])=>({name,data_type,generated:'',identity:''}));
      const group={name:'group_original_creations',primaryKey:['creator_uuid','original_client_thread_id'],
        columns:fields([['creator_uuid','uuid'],['original_client_thread_id','text'],['group_uuid','uuid'],['original_tuple','jsonb']]),data:Buffer.alloc(0)};
      const employee={name:'employee_message_original_outcomes',primaryKey:['request_fingerprint'],
        columns:fields([['request_fingerprint','text'],['original_command','text'],['original_request','jsonb'],['outcome_json','jsonb'],['recorded_at','timestamp with time zone']]),data:Buffer.alloc(0)};
      const secret='SYNTHETIC_INDEPENDENT_RESTORE_INTENT_SOURCE_KEY_ONLY_0001';
      const client=()=>new pg.Client({host:'127.0.0.1',port:1,user:'SOURCE_UNUSED_NOT_CONNECTED',database:'SOURCE_UNUSED_NOT_CONNECTED',password:'SOURCE_ONLY',connectionTimeoutMillis:1});
      const envelopeFor=archive=>{const b=bindingOf(archive),intent={restore_id:'00000000-0000-4000-8000-000000000001',authority_generation:1,
        retry_of_restore_id:null,archive_digest:b.archive_digest,source_project_ref:b.project_ref,target_project_ref:b.project_ref,source_identity_sha256:b.source_identity_sha256,
        actor:'SYNTHETIC_SIGNED_RESTORE_SOURCE_ACTOR_ONLY',expires_at:new Date(Date.now()+60000).toISOString(),target_migration_head:'source-not-target-proof',target_release_identity:{source_only:true}};
        return {format:'memphis-zoo-production-restore-intent.v1',key_id:'source-intent',intent,signature:signBinding(restoreIntentBinding(intent),secret)};};
      const options=(db,archive,envelope=envelopeFor(archive))=>({db,verifiedArchive:archive,originalIntentEnvelope:envelope,intentVerifyKey:secret,intentVerifyKeyId:'source-intent'});
      const unsupported=error=>error.code==='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'&&error.outcome==='UNKNOWN'&&error.retry_safe===false;
      if(intentOwnerJoinOnly){
        const fresh=()=>{const archive=materialize(fixture({data:Buffer.alloc(0),privateTables:[employee,group]}));
          return {archive,db:client(),envelope:{...envelopeFor(archive),algorithm:'hmac-sha256'}};};
        await run('INTENT_OWNER_JOIN_NEW actual five-field producer reaches fixed owner-context request with same frozen intent',async()=>{
          const {archive,db,envelope}=fresh(),original=JSON.parse(JSON.stringify(envelope.intent));
          let pending;try{
            pending=stage(options(db,archive,envelope));pending.catch(()=>{});
            await new Promise(resolve=>setImmediate(resolve));
            assert.equal(db._connected,false);assert.equal(db.queryQueue.length,1);
            const submitted=db.queryQueue[0];
            assert.equal(submitted.text,'select custodial_dr.begin_immutable_private_import($1::uuid,$2::bigint,$3::text,$4::jsonb) as context');
            assert.deepEqual(submitted.values.slice(0,3),[original.restore_id,String(original.authority_generation),original.archive_digest]);
            const manifest=JSON.parse(submitted.values[3]);
            assert.equal(manifest.actor,original.actor);assert.equal(manifest.expires_at,original.expires_at);
            assert.deepEqual(manifest.target_release_identity,original.target_release_identity);
            envelope.intent.actor='CHANGED_WHILE_FIRST_QUERY_PENDING';envelope.intent.expires_at='2099-01-01T00:00:00Z';
            assert.deepEqual(JSON.parse(submitted.values[3]),manifest);
            // Settle this never-connected driver's real queued command; no
            // synthetic SQL response, network or owner admission is supplied.
            db._errorAllQueries(Object.assign(new Error('SOURCE_UNCONNECTED_DRIVER_CANCEL'),{code:'08003'}));
            await assert.rejects(()=>pending,error=>unsupported(error)&&error.sql_state==='08003');
            assert.equal(db.queryQueue.length,0);
          }finally{db._errorAllQueries(new Error('SOURCE_FIXTURE_CLOSED'));if(pending)await pending.catch(()=>{});await db.end();}
        });
        await run('INTENT_OWNER_JOIN_NEW changing expiry getter refuses before invocation or SQL',async()=>{
          const {archive,db,envelope}=fresh();let reads=0;
          Object.defineProperty(envelope.intent,'expires_at',{enumerable:true,get(){reads++;return reads===1?'2026-10-14T20:00:00Z':'2099-01-01T00:00:00Z';}});
          await assert.rejects(()=>stage(options(db,archive,envelope)),unsupported);
          assert.equal(reads,0);assert.equal(db.queryQueue.length,0);assert.equal(db._connected,false);await db.end();
        });
        await run('INTENT_OWNER_JOIN_NEW nested signed target accessors cannot select successor identity',async()=>{
          const {archive,db,envelope}=fresh();let reads=0;
          Object.defineProperty(envelope.intent.target_release_identity,'source_only',{enumerable:true,get(){reads++;return true;}});
          await assert.rejects(()=>stage(options(db,archive,envelope)),unsupported);
          assert.equal(reads,0);assert.equal(db.queryQueue.length,0);await db.end();
        });
        await run('INTENT_OWNER_JOIN_NEW actual CLI uses same capture before existing private import refusal and connection',async()=>{
          const source=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
          assert.ok(source.includes('const intent = captureVerifiedOriginalRestoreIntent(intentEnvelope, intentVerifyKey, intentVerifyKeyId);'));
          assert.ok(source.indexOf('captureVerifiedOriginalRestoreIntent(intentEnvelope')<source.indexOf('if (privateImportBlocker !== null)'));
          assert.ok(source.indexOf('if (privateImportBlocker !== null)')<source.indexOf('const db = new Client('));
          assert.equal(/verifyBinding\(restoreIntentBinding\(intentEnvelope/.test(source),false);
        });
      }
      await run('new private SOURCE manifest uses actual signed file ancestry not caller checksum projections',async()=>{
        const archive=materialize(fixture({data:Buffer.alloc(0),privateTables:[employee,group]})),before=sourceOf(archive);
        assert.ok(Object.isFrozen(before.privateDataMembers[0]));assert.equal(before.privateDataMembers.length,2);
        archive.checksumBytes.fill(0);archive.checksumPaths.clear();archive.summary.private_import_approved=true;
        assert.deepEqual(sourceOf(archive).privateDataMembers,before.privateDataMembers);
        for(const member of before.privateDataMembers)assert.equal(member.sha256,hash(Buffer.alloc(0)));
        assert.throws(()=>sourceOf({...archive,owner_verified:true}));
      });
      await run('fake query client and extra owner flag cannot reach any SQL context entry',async()=>{
        const archive=materialize(fixture({data:Buffer.alloc(0),privateTables:[employee,group]}));let calls=0;
        await assert.rejects(()=>stage(options({query:async()=>{calls++;return {owner:'postgres'};}},archive)),unsupported);
        const db=client();await assert.rejects(()=>stage({...options(db,archive),fresh_target:true}),unsupported);
        assert.equal(calls,0);assert.equal(db._connected,false);assert.equal(db.queryQueue.length,0);
      });
      await run('actual unconnected driver rejects altered original signed intent before query',async()=>{
        const archive=materialize(fixture({data:Buffer.alloc(0),privateTables:[employee,group]})),db=client(),envelope=envelopeFor(archive);
        envelope.intent.actor='CHANGED_SOURCE_ACTOR';await assert.rejects(()=>stage(options(db,archive,envelope)),unsupported);
        assert.equal(db._connected,false);assert.equal(db.queryQueue.length,0);
      });
      await run('unknown complete private catalog cannot silently fall through to known ledger importer',async()=>{
        const unknown={...group,name:'unreviewed_private_originals'},archive=materialize(fixture({data:Buffer.alloc(0),privateTables:[employee,group,unknown]})),db=client();
        assert.equal(sourceOf(archive).privateDataMembers.length,3);await assert.rejects(()=>stage(options(db,archive)),unsupported);
        assert.equal(db._connected,false);assert.equal(db.queryQueue.length,0);
      });
      await run('expired independent intent consumes refusal and cannot become same-source blind retry',async()=>{
        const archive=materialize(fixture({data:Buffer.alloc(0),privateTables:[employee,group]})),db=client(),envelope=envelopeFor(archive);
        envelope.intent.expires_at='2000-01-01T00:00:00.000Z';envelope.signature=signBinding(restoreIntentBinding(envelope.intent),secret);
        await assert.rejects(()=>stage(options(db,archive,envelope)),unsupported);
        await assert.rejects(()=>stage(options(db,archive,envelopeFor(archive))),unsupported);
        assert.equal(db._connected,false);assert.equal(db.queryQueue.length,0);
      });
      await run('proposal static owner transaction fence and exact staged-only guard contract not SQL execution',async()=>{
        const proposal=readFileSync(new URL('../proposals/immutable-private-owner-context.sql',import.meta.url),'utf8');
        for(const marker of ['session_user','current_user <> session_user','pg_backend_pid()','txid_current()',"l.mode='ExclusiveLock'",'l.granted',"ctl.state<>'PREPARING'",'custodial_dr.application_mutation_leases','IN ACCESS EXCLUSIVE MODE','count(*) FROM ONLY','immutable_import_matches_staged(TG_RELID,to_jsonb(NEW))','SECURITY INVOKER'])assert.ok(proposal.includes(marker));
        assert.equal(/SECURITY\s+DEFINER|DISABLE\s+TRIGGER|DISABLE\s+ROW\s+LEVEL|SET\s+ROLE|^\s*GRANT\b|session_replication_role\s*=\s*replica/im.test(proposal),false);
        const consumer=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
        assert.ok(consumer.indexOf('await data.verified')<consumer.indexOf("select custodial_dr.finish_immutable_private_import()"));
        assert.ok(consumer.includes('Reflect.apply(query,db'));assert.equal(/db\.query\(|commit|truncate/i.test(consumer.replace(/\/\/[^\n]*/g,'')),false);
        assert.ok(consumer.includes('privateFailures.set(error,cause)'));assert.equal(consumer.includes('new Error(code,{cause})'),false);
        const production=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
        assert.ok(production.indexOf('if (privateImportBlocker !== null)')<production.indexOf('const db = new Client('));
        assert.ok(production.includes('if (!prepared || !mutationFenceHeld)'));
      });
      console.log(JSON.stringify({selector:intentOwnerJoinOnly?'--immutable-intent-owner-join-only':ownerContextStaticOnly?'--immutable-owner-context-static-only':'--immutable-owner-context-source-only',count:cases.length,cases,status:'PASS_NEW_SOURCE_NEGATIVES_AND_STATIC_CONTRACT_ONLY',
        SQL_compile:'NOT_RUN',SQL_owner_or_freshness_or_guard_or_rollback:'NOT_RUN',private_import_activation:'UNSUPPORTED_UNQUALIFIED',resources:{SQL_connections:0,listeners:0,JVMs:0}}));
    }else if(immutableSourceOnly){
      const columns=fields=>fields.map(([name,data_type])=>({name,generated:'',identity:'',data_type}));
      const raw='{"creator_uuid":"00000000-0000-4000-8000-000000000001","original_client_thread_id":"retained-original","group_uuid":"00000000-0000-4000-8000-000000000002","original_tuple":{"schema":"custodial.group-original-creation.v1","created_by_user_id":"00000000-0000-4000-8000-000000000001","client_thread_id":"retained-original","title":"original","member_user_ids":["00000000-0000-4000-8000-000000000003","00000000-0000-4000-8000-000000000004"]}}';
      const group={name:'group_original_creations',primaryKey:['creator_uuid','original_client_thread_id'],
        columns:columns([['creator_uuid','uuid'],['original_client_thread_id','text'],['group_uuid','uuid'],['original_tuple','jsonb']]),data:Buffer.from(JSON.stringify(raw)+'\n')};
      const unknown={name:'unreviewed_private_originals',primaryKey:['id'],columns:columns([['id','text']]),data:Buffer.alloc(0)};
      const source=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
      const start=source.indexOf('const privateImportBlocker ='),end=source.indexOf('\n\nif (!apply)',start);
      assert.ok(start>=0&&end>start);
      const blocker=new Function('tableSelection',source.slice(start,end)+'\nreturn privateImportBlocker;');
      await run('authenticated full private catalog includes purged group data and unknown zero-row member but denies import',async()=>{
        const archive=materialize(fixture({data:Buffer.alloc(0),privateTables:[group,unknown]}));
        const plan=selectOriginal(archive);
        assert.deepEqual(plan.privateTables.map(t=>t.table_name),[group.name,unknown.name]);
        assert.equal(blocker(plan),'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED');
        assert.ok(Object.isFrozen(plan.privateTables[0].columns[0]));
        const result=reader(archive,'custodial_release_identity',group.name),guard=createRestoreRowUtf8Guard();
        const settled=pipeline(result.stream,guard);settled.catch(()=>{});const lines=createInterface({input:guard,crlfDelay:Infinity}),rows=[];
        try{for await(const line of lines)rows.push(decodeRestoreTableRowLine(line,result.table));await settled;await result.verified;assert.deepEqual(rows,[raw]);}
        finally{lines.close();guard.destroy();await settled.catch(()=>{});await result.close();}
        // Exact archived DATA consumption is not target freshness, restored
        // authority or a reason to reconstruct/re-publish its public group.
        assert.equal(blocker(plan),'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED');
      });
      await run('copied authority and caller fresh empty approval metadata cannot admit target writes',async()=>{
        const archive=materialize(fixture({data:Buffer.alloc(0),privateTables:[{...group,data:Buffer.alloc(0)}]}));
        assert.throws(()=>selectOriginal({...archive,fresh_target:true,guard_verified:true}));
        archive.summary.private_import_approved=true;archive.summary.fresh_target=true;
        const plan=selectOriginal(archive);assert.equal(plan.privateTables.length,1);assert.equal(blocker(plan),'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED');
        assert.ok(source.indexOf('if (privateImportBlocker !== null)')<source.indexOf('const db = new Client('));
      });
      await run('changed catalog and closed source refuse before selection or target connection',async()=>{
        const archive=materialize(fixture({data:Buffer.alloc(0),privateTables:[group]})),catalogPath=join(archive.directory,'inventory/table-catalog.json');
        renameSync(catalogPath,catalogPath+'.original');writeFileSync(catalogPath,readFileSync(catalogPath+'.original'));
        assert.throws(()=>selectOriginal(archive));archive.cleanup();assert.throws(()=>selectOriginal(archive));
      });
      await run('partial private DATA consumption is refused not commit and closes owned source',async()=>{
        const archive=materialize(fixture({data:Buffer.alloc(0),privateTables:[group]}));
        const plan=selectOriginal(archive),result=reader(archive,'custodial_release_identity',group.name);
        result.stream.read(1);await result.close();await assert.rejects(result.verified);
        assert.ok(result.stream.closed);assert.equal(blocker(plan),'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED');
      });
      console.log(JSON.stringify({selector:'--immutable-private-source-only',count:cases.length,cases,status:'PASS_SOURCE_ARCHIVE_PREREQUISITES_ONLY',
        private_import:'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED',actual_target_SQL:'NOT_RUN_NO_OWNING_IMPORT_CONTEXT',
        limits:'Synthetic signed archive/current no-follow private selection and preserved raw DATA only; no fresh-target/SQL rollback/authority/import proof.'}));
    }else{
    await run("real signed materializer selects private catalog and streams exact multi-chunk bytes", async () => {
      const raw = '{"id":9223372036854775807,"value":{"n":9007199254740993,"text":"' + "café🐾".repeat(18000) + '\\n","bytea":"\\\\x0011"}}';
      const source = fixture({ data: Buffer.from(JSON.stringify(raw) + "\r\n") }), archive = materialize(source), result = reader(archive);
      assert.deepEqual(Object.keys(result).sort(), ["close", "stream", "table", "verified"]);
      assert.ok(Object.isFrozen(result) && Object.isFrozen(result.table) && Object.isFrozen(result.table.columns[0]));
      let settled = false; result.verified.then(() => { settled = true; }); await Promise.resolve(); assert.equal(settled, false);
      archive.summary.source_identity.database_catalog_sha256 = "0".repeat(64);
      archive.summary.database_row_count = 0; archive.checksumPaths.clear(); archive.checksumBytes.fill(0); archive.archiveDigest = "0".repeat(64);
      assert.deepEqual(await bytes(result), source.data);
      assert.deepEqual(await result.verified, { data_file: "database/public.records.jsonl", sha256: hash(source.data), bytes: source.data.length });
      assert.ok(result.stream.closed); await result.close(); await result.close();
    });
    await run("legacy and encoded raw rows pass normal fatal UTF8/row decoder without integer normalization", async () => {
      const raw = '{"id":9223372036854775807,"value":{"integer":9007199254740993,"text":"first\\nsecond","bytea":"\\\\x0011"}}';
      for (const legacy of [true, false]) {
        const source = fixture({ legacy, data: Buffer.from((legacy ? raw : JSON.stringify(raw)) + "\n") });
        const result = reader(materialize(source)), guard = createRestoreRowUtf8Guard();
        const settled = pipeline(result.stream, guard); settled.catch(() => {});
        const lines = createInterface({ input: guard, crlfDelay: Infinity }), actual = [];
        try {
          for await (const line of lines) actual.push(decodeRestoreTableRowLine(line, result.table));
          await settled; await result.verified; assert.deepEqual(actual, [raw]);
        } finally { lines.close(); guard.destroy(); await settled.catch(() => {}); await result.close(); }
      }
    });
    await run("legitimate empty DATA verifies exact EOF and zero byte hash", async () => {
      const result = reader(materialize(fixture({ data: Buffer.alloc(0) })));
      assert.deepEqual(await bytes(result), Buffer.alloc(0));
      assert.equal((await result.verified).sha256, hash(Buffer.alloc(0))); await result.close();
    });
    await run("foreign table paths objects and missing or uncorroborated catalogs refuse before consumption", async () => {
      const archive = materialize(fixture());
      for (const args of [["public", "../records"], ["unknown", "records"], ["public", {}], [{ schema_name: "public", table_name: "records", verified: true }, undefined]])
        assert.throws(() => reader(archive, ...args));
      for (const options of [{ omitCatalog: true }, { identityHash: "0".repeat(64) },
        { changeCatalog: c => { c[0].data_encoding = "unknown"; } }, { changeCatalog: c => { c[0].data_file = "database/auth.records.jsonl"; } }])
        assert.throws(() => reader(materialize(fixture(options))));
    });
    await run("copied closed and path-rebound materializer objects cannot acquire a DATA FD", async () => {
      const archive = materialize(fixture());
      for (const fake of [null, {}, { ...archive }]) assert.throws(() => reader(fake));
      const directory = archive.directory; archive.directory = work; assert.throws(() => reader(archive));
      archive.directory = directory; archive.cleanup(); assert.throws(() => reader(archive));
    });
    await run("premature close without consumption settles refusal idempotently without unhandled rejection", async () => {
      const result = reader(materialize(fixture())); await result.close(); await result.close();
      await assert.rejects(result.verified, /closed|EOF/); assert.ok(result.stream.destroyed && result.stream.closed);
    });
    await run("partial consumer cancellation is not verified EOF", async () => {
      const result = reader(materialize(fixture({ data: Buffer.alloc(1024 * 1024, 0x20) })));
      for await (const chunk of result.stream) { assert.ok(chunk.length < 1024 * 1024); break; }
      await assert.rejects(result.verified); await result.close(); assert.ok(result.stream.closed);
    });
    await run("prefetched EOF with unread buffered bytes cannot settle successful consumption", async () => {
      const result = reader(materialize(fixture()));
      assert.equal(result.stream.read(1).length, 1);
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(result.stream.readableLength > 0); assert.equal(result.stream.readableEnded, false);
      result.stream.destroy(); await assert.rejects(result.verified, /EOF/); await result.close(); assert.ok(result.stream.closed);
    });
    await run("natural archive cleanup aborts owned unstarted and active readers and closes FDs", async () => {
      for (const started of [false, true]) {
        const archive = materialize(fixture({ data: Buffer.alloc(1024 * 1024, 0x20) })), result = reader(archive);
        if (started) {
          const iterator = result.stream[Symbol.asyncIterator](); await iterator.next(); archive.cleanup();
          await assert.rejects(iterator.next());
        } else archive.cleanup();
        await assert.rejects(result.verified); await result.close(); assert.ok(result.stream.closed);
        assert.equal(existsSync(archive.directory), false);
      }
    });
    await run("declared checksum mismatch and source symlink never materialize trusted DATA", async () => {
      assert.throws(() => materialize(fixture({ badChecksum: true })), /checksum/);
      assert.throws(() => materialize(fixture({ sourceSymlink: true })));
    });
    await run("permitted fixture name replacement and hardlink alias reject the original pinned FD", async () => {
      // Owned synthetic directories only, without chmod or a permission bypass.
      // This is lifecycle refusal, not a claim of protection against root/UID.
      for (const alias of [true, false]) {
        const archive = materialize(fixture()), result = reader(archive), path = join(archive.directory, "database/public.records.jsonl");
        if (alias) linkSync(path, path + ".alias");
        else { renameSync(path, path + ".original"); writeFileSync(path, readFileSync(path + ".original")); }
        await assert.rejects(bytes(result)); await assert.rejects(result.verified); await result.close(); assert.ok(result.stream.closed);
      }
    });
    await run("downstream UTF8 failure stays failed and reader abort settles without replacing decoder error", async () => {
      const source = fixture({ data: Buffer.from([0xc3, 0x28, 0x0a]) }), result = reader(materialize(source));
      const guard = createRestoreRowUtf8Guard(); guard.resume();
      await assert.rejects(pipeline(result.stream, guard), /UTF-8/);
      await result.close(); assert.ok(result.stream.closed);
      // Byte verification alone is not row validation or transaction acceptance.
      await result.verified.catch(() => {});
    });
    await run("caller stream error remains primary on verified and cleanup produces no unhandled rejection", async () => {
      const result = reader(materialize(fixture())), failure = new Error("synthetic consumer failed");
      result.stream.destroy(failure); await assert.rejects(result.verified, error => error === failure);
      await result.close(); assert.ok(result.stream.closed);
      await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(unhandled, []);
    });
    console.log(JSON.stringify({ selector: "--verified-table-data-only", status: "PASS_SOURCE_UNIT_CASES", count: cases.length, cases,
      limits: "Synthetic signed archive/host filesystem and streams only; no actual keys, target/SQL/transaction effects, private original import, initial admission or sameUID/root protection claim. Literal close/fsync failures not injected." }));
    }
  } finally {
    for (const result of readers) await result.close();
    for (const archive of snapshots) archive.cleanup();
    rmSync(work, { recursive: true, force: true }); process.off("unhandledRejection", observeUnhandled);
    if(textColumnsOnly||mixedConsumerOnly||selectionParsingOnly||mutationWitnessOnly){
      assert.equal(existsSync(work),false);
      for(const archive of snapshots)assert.equal(existsSync(archive.directory),false);
      for(const data of readers)assert.ok(data.stream.destroyed&&data.stream.closed);
      assert.deepEqual(unhandled,[]);
    }
  }
  process.exit(0);
}

// New section evidence cases only. Existing archive fixture HMAC strings are
// SYNTHETIC unit data, not approved initial-install/restore signing authority.
if (process.argv.includes("--schema-section-evidence-only") || process.argv.includes("--schema-section-sql-text-only")
    || process.argv.includes("--authenticated-source-binding-only")) {
  const textOnly = process.argv.includes("--schema-section-sql-text-only");
  const sourceOnly = process.argv.includes("--authenticated-source-binding-only");
  const codec = await import("./disaster-recovery-archive.mjs");
  const work = mkdtempSync(join(tmpdir(), "archive-section-evidence-test-"));
  const key = "disaster-recovery-archive-materialization-test-key-0001";
  const keyId = "archive-materialization-test-v1";
  const hash = value => createHash("sha256").update(value).digest("hex");
  const profiles = [
    { section: "pre-data", path: "inventory/application-schema-pre-data.sql" },
    { section: "post-data", path: "inventory/application-schema-post-data.sql" },
  ];
  const files = new Map(profiles.map(p => [p.path, `-- exact ${p.section} synthetic evidence\nSELECT 1;\n`]));
  const descriptor = (entries = files) => profiles.map(p => ({ ...p, sha256: hash(entries.get(p.path)) }));
  let ordinal = 0;
  const snapshots = [];
  function fixture({ rawFiles = files, sections = descriptor(rawFiles), omitDescriptor = false, missing = [], changed = {}, empty = [], format = "memphis-zoo-disaster-recovery.v4",
    identityOverride = undefined, projectRef = "abcdefghijklmnopqrst" } = {}) {
    const directory = join(work, `source-${ordinal++}`);
    mkdirSync(join(directory, "inventory"), { recursive: true, mode: 0o700 });
    const sourceIdentity = identityOverride !== undefined ? identityOverride : {
      backup_tool_commit: "a".repeat(40), backup_tool_tree: "b".repeat(40),
      ...(omitDescriptor ? {} : { application_schema_sections: sections }) };
    const summary = { ok: true, format, consistent_database_snapshot: true,
      project_ref: projectRef, source_identity: sourceIdentity };
    const entries = new Map([
      ["backup-summary.json", JSON.stringify(summary) + "\n"],
      ["inventory/application-schema.sql", "-- unchanged full schema fixture\n"],
      ...[...rawFiles].filter(([path]) => !missing.includes(path)).map(([path, bytes]) =>
        [path, empty.includes(path) ? "" : (changed[path] ?? bytes)]),
    ]);
    for (const [path, bytes] of entries) writeFileSync(join(directory, path), bytes);
    const sums = [...entries].map(([path, bytes]) => `${hash(bytes)}  ${path}`).join("\n") + "\n";
    writeFileSync(join(directory, "SHA256SUMS"), sums);
    const archiveDigest = hash(sums);
    writeFileSync(join(directory, "archive-signature.json"), JSON.stringify({
      format: "memphis-zoo-disaster-recovery-signature.v1", algorithm: "hmac-sha256", key_id: keyId,
      archive_digest: archiveDigest, signature: signBinding(archiveSignatureBinding({ archiveDigest,
        projectRef: summary.project_ref, sourceIdentity, archiveFormat: summary.format }), key),
    }));
    return directory;
  }
  function materialize(directory) {
    const snapshot = materializeVerifiedArchive({ sourceDir: directory, archiveVerifyKey: key,
      archiveVerifyKeyId: keyId });
    snapshots.push(snapshot);
    return snapshot;
  }
  const cases = [];
  const run = (name, body) => { body(); cases.push(name); };
  try {
    if (sourceOnly) {
      run("authenticated source projection exists independently of mutable public metadata", () => {
        assert.equal(typeof codec.readVerifiedArchiveSourceBinding, "function");
      });
      const project = archive => codec.readVerifiedArchiveSourceBinding(archive);
      run("pristine source summary and stable digest are exact deeply frozen data", () => {
        const identity = { backup_tool_commit: "a".repeat(40), backup_tool_tree: "b".repeat(40),
          release: { release_id: "original", nested: [{ value: null }, { value: "café" }], count: 3 } };
        const source = fixture({ omitDescriptor: true, identityOverride: identity }), archive = materialize(source);
        const result = project(archive), summary = JSON.parse(readFileSync(join(source, "backup-summary.json")));
        assert.deepEqual(Object.keys(result).sort(), ["archive_digest", "format", "project_ref", "source_identity", "source_identity_sha256", "summary"]);
        assert.deepEqual(result.summary, summary);
        assert.deepEqual(result.source_identity, identity);
        assert.equal(result.source_identity_sha256, hash(stableJson(identity)));
        assert.equal(result.archive_digest, hash(readFileSync(join(source, "SHA256SUMS"))));
        assert.equal(result.source_identity, result.summary.source_identity);
        assert.ok(Object.isFrozen(result) && Object.isFrozen(result.summary) && Object.isFrozen(result.source_identity.release.nested)
          && result.source_identity.release.nested.every(Object.isFrozen));
        assert.throws(() => { result.source_identity.release.nested[0].value = "foreign"; }, TypeError);
        assert.equal(Object.hasOwn(result.source_identity, "invented_missing_field"), false);
        for (const name of ["approved", "accepted", "initialization", "target", "signer", "authority_generation"]) assert.equal(Object.hasOwn(result, name), false);
      });
      run("public source/digest/checksum mutations cannot replace pristine authenticated values", () => {
        const source = fixture(), archive = materialize(source), before = project(archive);
        archive.summary.source_identity.backup_tool_commit = "0".repeat(40);
        archive.summary.source_identity.application_schema_sections.reverse();
        archive.summary.project_ref = "foreign";
        archive.archiveDigest = "0".repeat(64);
        archive.checksumBytes.fill(0);
        archive.checksumPaths.clear();
        writeFileSync(join(source, "backup-summary.json"), "unsigned source replacement");
        assert.deepEqual(project(archive), before);
        assert.equal(project(archive).source_identity.backup_tool_commit, "a".repeat(40));
      });
      run("legacy source projection preserves format and absent fields without manufacturing sections", () => {
        const archive = materialize(fixture({ omitDescriptor: true, format: "memphis-zoo-disaster-recovery.v3" }));
        const result = project(archive);
        assert.equal(result.format, "memphis-zoo-disaster-recovery.v3");
        assert.equal(Object.hasOwn(result.source_identity, "application_schema_sections"), false);
        for (const identityOverride of [null, [], "missing"]) {
          const malformed = materialize(fixture({ identityOverride, omitDescriptor: true }));
          assert.throws(() => project(malformed), /source/i);
        }
        assert.throws(() => project(materialize(fixture({ projectRef: "foreign", omitDescriptor: true }))), /source/i);
      });
      run("constructed copied closed and rebound contexts cannot project source identity", () => {
        const archive = materialize(fixture());
        for (const fake of [null, {}, { ...archive }, { summary: archive.summary, archiveDigest: archive.archiveDigest, verified: true }])
          assert.throws(() => project(fake), /snapshot/i);
        const directory = archive.directory; archive.directory = work;
        assert.throws(() => project(archive), /snapshot/i);
        archive.directory = directory; archive.cleanup();
        assert.throws(() => project(archive), /snapshot/i);
      });
      run("manifest summary and signature changes or identical-byte inode replacements refuse", () => {
        for (const file of ["SHA256SUMS", "backup-summary.json", "archive-signature.json"]) {
          for (const replace of [false, true]) {
            const archive = materialize(fixture()), path = join(archive.directory, file), bytes = readFileSync(path);
            if (replace) { renameSync(path, path + ".old"); writeFileSync(path, bytes); }
            else { chmodSync(path, 0o600); writeFileSync(path, Buffer.concat([bytes, Buffer.from("changed")])); }
            assert.throws(() => project(archive));
          }
        }
      });
      run("source control aliases symlinks and root substitution refuse", () => {
        for (const symlink of [false, true]) {
          const archive = materialize(fixture()), path = join(archive.directory, "SHA256SUMS"), alias = join(work, "source-control-alias");
          if (symlink) { renameSync(path, alias); symlinkSync(alias, path); }
          else linkSync(path, alias);
          try { assert.throws(() => project(archive)); }
          finally { rmSync(alias); }
        }
        const archive = materialize(fixture()), directory = archive.directory, saved = directory + ".owned";
        renameSync(directory, saved); mkdirSync(directory, { mode: 0o700 });
        try { assert.throws(() => project(archive), /snapshot/i); }
        finally { rmdirSync(directory); renameSync(saved, directory); }
      });
      run("new projection is captured after existing signature verification and normal v1 digest unchanged", () => {
        const source = fixture(), signaturePath = join(source, "archive-signature.json");
        const signature = JSON.parse(readFileSync(signaturePath)); signature.signature = "0".repeat(64);
        writeFileSync(signaturePath, JSON.stringify(signature));
        assert.throws(() => materialize(source), /signature/i);
        const issuer = readFileSync(new URL("./create-production-restore-intent.mjs", import.meta.url), "utf8");
        assert.ok(issuer.includes('update(stableJson(summary.source_identity)).digest("hex")'));
        assert.equal(issuer.includes("readVerifiedArchiveSourceBinding"), false);
      });
    } else if (textOnly) {
      run("live authenticated SQL reader exists instead of paths-only consumption", () => {
        assert.equal(typeof codec.readVerifiedApplicationSchemaSectionSql, "function");
      });
      const read = archive => codec.readVerifiedApplicationSchemaSectionSql(archive);
      run("ordered immutable exact UTF8 SQL preserves BOM Unicode CRLF and whitespace", () => {
        const rawFiles = new Map([
          [profiles[0].path, Buffer.from("\ufeff-- café 🐾\r\nSELECT 'a\\b';\n\t")],
          [profiles[1].path, Buffer.from("  -- original post data\nDO $body$ BEGIN\n  NULL;\nEND $body$;\r\n")],
        ]);
        const archive = materialize(fixture({ rawFiles })), result = read(archive);
        assert.ok(Object.isFrozen(result) && result.every(Object.isFrozen));
        assert.deepEqual(result.map(({ section, path, sha256 }) => ({ section, path, sha256 })), descriptor(rawFiles));
        result.forEach(record => {
          assert.deepEqual(Object.keys(record).sort(), ["path", "section", "sha256", "sql"]);
          assert.deepEqual(Buffer.from(record.sql, "utf8"), rawFiles.get(record.path));
          assert.throws(() => { record.sql = "replacement"; }, TypeError);
        });
      });
      run("strict streaming UTF8 preserves multibyte text across hash read boundary", () => {
        const text = "--" + "x".repeat(1024 * 1024 - 4) + "🐾\nSELECT 'café';\r\n";
        const rawFiles = new Map(files); rawFiles.set(profiles[0].path, text);
        const archive = materialize(fixture({ rawFiles }));
        assert.equal(read(archive)[0].sql, text);
      });
      run("signed invalid overlong surrogate and truncated UTF8 bytes refuse without replacement", () => {
        for (const bytes of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf0, 0x9f]]) {
          const rawFiles = new Map(files); rawFiles.set(profiles[1].path, Buffer.from(bytes));
          const archive = materialize(fixture({ rawFiles }));
          assert.deepEqual(codec.selectVerifiedApplicationSchemaSections(archive), descriptor(rawFiles),
            "Existing byte evidence selection does not silently become a SQL decoder");
          assert.throws(() => read(archive), /UTF-8/i);
        }
      });
      run("reader uses only private snapshot originals not source/public metadata", () => {
        const source = fixture(), archive = materialize(source);
        writeFileSync(join(source, profiles[0].path), "unsigned source edit\n");
        archive.summary.source_identity.application_schema_sections = [{ sql: "adopt me" }];
        archive.checksumPaths.clear();
        const result = read(archive);
        assert.equal(result[0].sql, files.get(profiles[0].path));
        archive.cleanup();
        assert.equal(result[0].sql, files.get(profiles[0].path), "Detached exact strings remain facts, not a live execution permit");
        assert.throws(() => read(archive), /snapshot/i);
      });
      run("legacy fabricated copied closed and rebound context cannot read SQL", () => {
        const archive = materialize(fixture());
        for (const fake of [null, {}, { ...archive }, { directory: archive.directory, verified: true }])
          assert.throws(() => read(fake), /snapshot/i);
        const directory = archive.directory;
        archive.directory = work;
        assert.throws(() => read(archive), /snapshot/i);
        archive.directory = directory;
        const legacy = materialize(fixture({ omitDescriptor: true }));
        assert.throws(() => read(legacy), /section/i);
        archive.cleanup();
        assert.throws(() => read(archive), /snapshot/i);
      });
      run("changed replaced symlinked and aliased copied file cannot return SQL", () => {
        for (const action of ["mutate", "replace", "symlink", "alias"]) {
          const archive = materialize(fixture()), path = join(archive.directory, profiles[0].path);
          const alias = join(work, "text-reader-alias");
          if (action === "mutate") { chmodSync(path, 0o600); writeFileSync(path, "changed SQL\n"); }
          if (action === "replace") { renameSync(path, path + ".old"); writeFileSync(path, files.get(profiles[0].path)); }
          if (action === "symlink") { rmSync(path); symlinkSync(join(archive.directory, profiles[1].path), path); }
          if (action === "alias") linkSync(path, alias);
          try { assert.throws(() => read(archive)); }
          finally { if (existsSync(alias)) rmSync(alias); }
        }
      });
      run("changed or symlinked snapshot root cannot return SQL", () => {
        for (const link of [false, true]) {
          const archive = materialize(fixture()), directory = archive.directory, saved = directory + ".owned";
          renameSync(directory, saved);
          if (link) symlinkSync(saved, directory); else mkdirSync(directory, { mode: 0o700 });
          try { assert.throws(() => read(archive)); }
          finally { if (link) rmSync(directory); else rmdirSync(directory); renameSync(saved, directory); }
        }
      });
      run("SQL reader is evidence only with no importer or v1 intent wiring", () => {
        const source = readFileSync(new URL("./production-restore.mjs", import.meta.url), "utf8");
        assert.ok(source.includes("PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED"));
        assert.equal(source.includes("readVerifiedApplicationSchemaSectionSql"), false);
      });
    } else {
    run("signed descriptor referencing absent checksum/file refuses", () => {
      assert.throws(() => materialize(fixture({ missing: [profiles[1].path] })), /section/i);
    });
    if (!process.argv.includes("--baseline-missing-section-refusal")) {
      run("actual verified exact ordered files select immutable evidence", () => {
        const snapshot = materialize(fixture());
        const selected = codec.selectVerifiedApplicationSchemaSections(snapshot);
        assert.deepEqual(selected, descriptor());
        assert.ok(Object.isFrozen(selected) && selected.every(Object.isFrozen));
        for (const record of selected) assert.equal(hash(readFileSync(join(snapshot.directory, record.path))), record.sha256);
        assert.deepEqual(Object.keys(selected[0]).sort(), ["path", "section", "sha256"]);
        assert.equal(readFileSync(join(snapshot.directory, "inventory/application-schema.sql"), "utf8"), "-- unchanged full schema fixture\n");
      });
      run("legacy absent descriptor preserves materialization but explicit section selection refuses", () => {
        for (const format of ["memphis-zoo-disaster-recovery.v3", "memphis-zoo-disaster-recovery.v4"]) {
          const snapshot = materialize(fixture({ omitDescriptor: true, format }));
          assert.equal(readFileSync(join(snapshot.directory, "inventory/application-schema.sql"), "utf8"), "-- unchanged full schema fixture\n");
          assert.throws(() => codec.selectVerifiedApplicationSchemaSections(snapshot), /section/i);
        }
        assert.throws(() => materialize(fixture({ format: "memphis-zoo-disaster-recovery.v3" })), /section/i);
      });
      run("null wrong types missing extra and duplicate records refuse", () => {
        for (const sections of [null, {}, "", [], descriptor().slice(0, 1), [...descriptor(), descriptor()[0]],
          [descriptor()[0], descriptor()[0]], descriptor().map(p => ({ ...p, authorized: true })),
          descriptor().map(({ section, sha256 }) => ({ section, sha256 })),
          descriptor().map(p => ({ ...p, sha256: 1 })), descriptor().map(p => ({ ...p, section: null }))])
          assert.throws(() => materialize(fixture({ sections })), /section/i);
      });
      run("reordered swapped alias foreign and duplicate paths refuse without normalization", () => {
        const variants = [descriptor().reverse(), [descriptor()[0], { ...descriptor()[1], path: profiles[0].path }],
          descriptor().map(p => ({ ...p, path: p.path.replace("inventory/", "inventory/./") })),
          descriptor().map(p => ({ ...p, path: "/" + p.path })),
          descriptor().map(p => ({ ...p, path: p.path.replace("inventory/", "inventory//") })),
          descriptor().map(p => ({ ...p, path: "inventory/application-schema.sql" })),
          descriptor().map(p => ({ ...p, section: p.section.toUpperCase() }))];
        for (const sections of variants) assert.throws(() => materialize(fixture({ sections })), /section/i);
      });
      run("malformed uppercase and declared-versus-actual hash conflicts refuse", () => {
        for (const sha256 of ["", "f".repeat(63), "G".repeat(64), descriptor()[0].sha256.toUpperCase(), "0".repeat(64)])
          assert.throws(() => materialize(fixture({ sections: [{ ...descriptor()[0], sha256 }, descriptor()[1]] })), /section/i);
        assert.throws(() => materialize(fixture({ changed: { [profiles[0].path]: "different authenticated file\n" } })), /section/i);
        assert.throws(() => materialize(fixture({ empty: [profiles[0].path], sections:
          [{ ...descriptor()[0], sha256: hash("") }, descriptor()[1]] })), /section/i);
      });
      run("source checksum corruption and symlink cannot become section evidence", () => {
        const changed = fixture();
        writeFileSync(join(changed, profiles[0].path), "unsigned replacement\n");
        assert.throws(() => materialize(changed), /checksum/i);
        const linked = fixture();
        rmSync(join(linked, profiles[1].path));
        symlinkSync(join(linked, profiles[0].path), join(linked, profiles[1].path));
        assert.throws(() => materialize(linked));
      });
      run("source post-copy mutation and public metadata do not replace authenticated section originals", () => {
        const source = fixture(), snapshot = materialize(source);
        writeFileSync(join(source, profiles[0].path), "changed source after snapshot\n");
        snapshot.summary.source_identity.application_schema_sections = [{ authorized: true }];
        snapshot.checksumPaths.clear();
        assert.deepEqual(codec.selectVerifiedApplicationSchemaSections(snapshot), descriptor());
      });
      run("constructed copied expired and path-rebound snapshot cannot select evidence", () => {
        const snapshot = materialize(fixture());
        for (const fake of [null, {}, { ...snapshot }, { directory: snapshot.directory, summary: snapshot.summary, checksumPaths: snapshot.checksumPaths }])
          assert.throws(() => codec.selectVerifiedApplicationSchemaSections(fake), /snapshot/i);
        const directory = snapshot.directory;
        snapshot.directory = work;
        assert.throws(() => codec.selectVerifiedApplicationSchemaSections(snapshot), /snapshot/i);
        snapshot.directory = directory;
        snapshot.cleanup();
        assert.throws(() => codec.selectVerifiedApplicationSchemaSections(snapshot), /snapshot/i);
      });
      run("copied file mutation replacement and symlink refuse rather than adopt", () => {
        for (const action of ["mutate", "replace", "symlink"]) {
          const snapshot = materialize(fixture()), path = join(snapshot.directory, profiles[0].path);
          if (action === "mutate") { chmodSync(path, 0o600); writeFileSync(path, "mutated snapshot\n"); }
          if (action === "replace") { renameSync(path, path + ".old"); writeFileSync(path, files.get(profiles[0].path)); }
          if (action === "symlink") { rmSync(path); symlinkSync(join(snapshot.directory, profiles[1].path), path); }
          assert.throws(() => codec.selectVerifiedApplicationSchemaSections(snapshot), /snapshot|section|link/i);
        }
      });
      run("snapshot root replacement and hardlink alias refuse", () => {
        const snapshot = materialize(fixture()), directory = snapshot.directory, saved = directory + ".original";
        renameSync(directory, saved);
        mkdirSync(directory, { mode: 0o700 });
        try { assert.throws(() => codec.selectVerifiedApplicationSchemaSections(snapshot), /snapshot directory/i); }
        finally { rmdirSync(directory); renameSync(saved, directory); }
        const path = join(directory, profiles[0].path), alias = join(work, "snapshot-link");
        linkSync(path, alias);
        try { assert.throws(() => codec.selectVerifiedApplicationSchemaSections(snapshot), /aliased/i); }
        finally { rmSync(alias); }
      });
      run("new section evidence does not change private importer or v1 target guards", () => {
        const source = readFileSync(new URL("./production-restore.mjs", import.meta.url), "utf8");
        assert.ok(source.includes("PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED"));
        assert.ok(source.indexOf("if (privateImportBlocker !== null)") < source.indexOf("const db = new Client("));
        assert.equal(source.includes("selectVerifiedApplicationSchemaSections"), false);
      });
    }
    }
  } finally {
    for (const snapshot of snapshots) snapshot.cleanup();
    rmSync(work, { recursive: true, force: true });
  }
  assert.equal(existsSync(work), false);
  for (const snapshot of snapshots) assert.equal(existsSync(snapshot.directory), false);
  console.log(JSON.stringify({ selector: sourceOnly ? "--authenticated-source-binding-only" : textOnly ? "--schema-section-sql-text-only" : "--schema-section-evidence-only", status: "PASS_SYNTHETIC_AUTHENTICATED_SNAPSHOT_EVIDENCE_ONLY",
    count: cases.length, cases, owned_fixture_cleanup_verified: true,
    limits: "Existing SYNTHETIC unit HMAC fixture strings and local files only; no real archive, approved signer, SQL, capture, target admission or private DATA restore." }));
  process.exit(0);
}

// New representation cases only; no old selection/archive/intent/signing
// groups, SQL, actual archive, key or temp-file fixture is invoked.
if (process.argv.includes("--private-original-restore-wire-only")) {
  const cases=[];
  const run=async(name,body)=>{await body();cases.push(name);};
  const metadata=(names,encoding=postgresJsonTextLineEncoding)=>({schema_name:"public",table_name:"records",
    primary_key:[],columns:names.map(name=>({name,generated:"",identity:"",data_type:"jsonb"})),row_count:"1",
    data_file:"database/public.records.jsonl",...(encoding===undefined?{}:{data_encoding:encoding})});
  const legacy=names=>{const table=metadata(names);delete table.data_encoding;return table;};
  const raw='{"id":9223372036854775807,"payload":{"unsafe":9007199254740993,"min":-9223372036854775808,"precise":12345678901234567890.123456789,"exponent":1.00000000000000000000001e+100}}';
  await run("new max-BIGINT unsafe integer and nested number tokens remain exact",()=>{
    assert.equal(postgresJsonTextLineEncoding,"postgres-json-text-line.v1");
    assert.equal(decodeRestoreTableRowLine(JSON.stringify(raw),metadata(["id","payload"])),raw);
    assert.notEqual(JSON.stringify(JSON.parse(raw)),raw,"Synthetic case must actually exercise lossy JS numbers");
  });
  await run("legacy V4 original object line never reserialized",()=>{
    const original=` \t${raw}  `;
    assert.equal(decodeRestoreTableRowLine(original,legacy(["id","payload"])),original);
    const previouslyRounded='{"id":9007199254740992}';
    assert.equal(decodeRestoreTableRowLine(previouslyRounded,legacy(["id"])),previouslyRounded,
      "The consumer cannot invent precision already lost by an old producer");
  });
  await run("nested JSON text bytea Unicode and multiline whitespace preserved",()=>{
    const original='{\n  "id": 9223372036854775807,\n  "payload": { "a": 9007199254740993, "a": 2 },\n  "text": "café 🐾 \\n \\"quoted\\"",\n  "binary": "\\\\xdeadbeef0001"\n}\t';
    assert.equal(decodeRestoreTableRowLine(JSON.stringify(original),metadata(["id","payload","text","binary"])),original);
  });
  await run("outer encoding decoded once without decoding JSON-looking text",()=>{
    const original='{"text":"{\\"id\\":9007199254740993}","id":9007199254740993}';
    assert.equal(decodeRestoreTableRowLine(JSON.stringify(original),metadata(["text","id"])),original);
    assert.throws(()=>decodeRestoreTableRowLine(JSON.stringify(JSON.stringify(original)),metadata(["text","id"])));
    assert.throws(()=>decodeRestoreTableRowLine(JSON.stringify(original),legacy(["text","id"])));
    assert.throws(()=>decodeRestoreTableRowLine(original,metadata(["text","id"])));
  });
  await run("exact original metadata includes generated columns",()=>{
    const table=metadata(["id","stored"]);table.columns[1].generated="s";
    assert.equal(decodeRestoreTableRowLine('"{\\"id\\":9223372036854775807,\\"stored\\":9007199254740993}"',table),
      '{"id":9223372036854775807,"stored":9007199254740993}');
    for(const bad of['{"id":1}','{"id":1,"stored":2,"approval":true}','{}'])
      assert.throws(()=>decodeRestoreTableRowLine(JSON.stringify(bad),table));
  });
  await run("duplicate and escaped duplicate original row columns refuse",()=>{
    for(const original of['{"id":1,"id":2}','{"id":1,"\\u0069d":2}']){
      assert.throws(()=>decodeRestoreTableRowLine(JSON.stringify(original),metadata(["id"])));
      assert.throws(()=>decodeRestoreTableRowLine(original,legacy(["id"])));
    }
  });
  await run("malformed scalar empty and wrong-envelope rows refuse",()=>{
    for(const line of["",'""','"null"','"[]"','"1"','"true"','"{} trailing"',"null","[]","1","true",'"{\\"id\\":}"'])
      assert.throws(()=>decodeRestoreTableRowLine(line,metadata(["id"])));
    assert.throws(()=>decodeRestoreTableRowLine(Buffer.from(raw),metadata(["id","payload"])));
    assert.throws(()=>decodeRestoreTableRowLine(JSON.stringify('{"id":"'+String.fromCharCode(0xd800)+'"}'),metadata(["id"])));
  });
  await run("known marker selected and every unsupported marker refuses early",()=>{
    const catalog=[metadata(["id"]),{...metadata(["id"]),schema_name:"auth",data_file:"database/auth.records.jsonl"},
      {...metadata(["id"]),schema_name:"storage",data_file:"database/storage.records.jsonl"}];
    const summary={format:"memphis-zoo-disaster-recovery.v4",backed_up_schemas:["public","auth","storage"],table_count:3,database_row_count:3};
    const input={summary,catalog,checksumPaths:new Set(catalog.map(table=>table.data_file))};
    assert.equal(selectVerifiedRestoreTables(input).databaseTables[0].data_encoding,postgresJsonTextLineEncoding);
    for(const bad of[null,"",false,1,{},"postgres-json-text-line.v2","legacy-object"]){
      assert.throws(()=>selectVerifiedRestoreTables({...input,catalog:[{...catalog[0],data_encoding:bad},...catalog.slice(1)]}));
      assert.throws(()=>decodeRestoreTableRowLine(JSON.stringify(raw),{...metadata(["id","payload"]),data_encoding:bad}));
    }
  });
  const consume=async chunks=>{
    const source=Readable.from(chunks),guard=createRestoreRowUtf8Guard();
    const settled=pipeline(source,guard);settled.catch(()=>{});
    const lines=createInterface({input:guard,crlfDelay:Infinity});
    const result=[];
    try {for await(const line of lines)result.push(decodeRestoreTableRowLine(line,metadata(["id","payload"])));await settled;return result;}
    finally {lines.close();source.destroy();guard.destroy();await settled.catch(()=>{});}
  };
  await run("normal streamed JSONL survives arbitrary UTF8 chunk boundaries",async()=>{
    const original='{\n"id":9223372036854775807,"payload":{"text":"café 🐾","unsafe":9007199254740993}\n}';
    const bytes=Buffer.from(JSON.stringify(original)+"\n"+JSON.stringify(raw)+"\n");
    assert.deepEqual(await consume([...bytes].map(byte=>Buffer.from([byte]))),[original,raw]);
  });
  await run("invalid and truncated UTF8 refuse instead of replacement",async()=>{
    const head=Buffer.from('"{\\"id\\":1,\\"payload\\":\\"');
    const tail=Buffer.from('\\"}"\n');
    await assert.rejects(consume([head,Buffer.from([0xc0]),tail]),/UTF-8/);
    await assert.rejects(consume([head,Buffer.from([0xf0,0x9f])]),/UTF-8/);
  });
  await run("actual owning SQL parameter is decoded raw and private blocker unchanged",()=>{
    const source=readFileSync(new URL("./production-restore.mjs",import.meta.url),"utf8");
    assert.ok(source.includes("const rawRowText = decodeRestoreTableRowLine(line, table);"));
    assert.ok(source.includes("await db.query(insert, [rawRowText]);"));
    assert.ok(source.includes("json_populate_record(null::${target},$1::json)"));
    assert.ok(source.includes("pipeline(rowStream, utf8Guard)"));
    assert.ok(source.includes("await wireSettled"));
    assert.equal(source.includes("JSON.stringify(JSON.parse(line))"),false);
    assert.ok(source.indexOf("if (privateImportBlocker !== null)")<source.indexOf("const db = new Client("));
    assert.ok(source.includes("PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED"));
    assert.equal(source.includes("disable trigger"),false);
  });
  console.log(JSON.stringify({selector:"--private-original-restore-wire-only",status:"PASS_PURE_SOURCE_CASES",count:cases.length,cases,
    limits:"Synthetic raw PostgreSQL-like text and in-memory streams only; no real archive/key/SQL, signed authority or private DATA import qualification."}));
  process.exit(0);
}

// Newly affected structural table selection only. This branch exits BEFORE
// old archive materialization/signature/subprocess fixtures or temp creation.
// Synthetic summary/catalog declarations are NOT authenticated archives.
if (process.argv.includes("--private-original-restore-selection-only") || process.argv.includes("--declared-empty-storage-selection-only")) {
  const emptyStorageOnly = process.argv.includes("--declared-empty-storage-selection-only");
  const selectedCase = process.argv.find(arg=>arg.startsWith("--restore-selection-case="))?.slice("--restore-selection-case=".length);
  const cases=[];
  const run=(name,body)=>{
    if (emptyStorageOnly && !name.startsWith("EMPTY_STORAGE_NEW ")) return;
    if (!emptyStorageOnly && name.startsWith("EMPTY_STORAGE_NEW ")) return;
    if (emptyStorageOnly && selectedCase && selectedCase !== name) return;
    body();cases.push(name);
  };
  const table=(schema_name,table_name,row_count="1")=>({schema_name,table_name,primary_key:["id"],
    columns:[{name:"id",generated:"",identity:"",data_type:"text"}],row_count,
    data_file:`database/${schema_name}.${table_name}.jsonl`});
  const catalog=[table("public","records"),table("auth","sessions"),table("storage","objects"),
    table("custodial_release_identity","group_original_creations")];
  const summary={format:"memphis-zoo-disaster-recovery.v4",backed_up_schemas:["public","auth","storage","custodial_release_identity"],
    table_count:4,database_row_count:4};
  const input=(extra={})=>({summary,catalog,checksumPaths:new Set(catalog.map(row=>row.data_file)),...extra});
  const emptyStorageCatalog=catalog.filter(row=>row.schema_name!=="storage");
  const emptyStorageSummary={...summary,table_count:3,database_row_count:3};
  const emptyStorageInput=(extra={})=>input({catalog:emptyStorageCatalog,summary:emptyStorageSummary,
    checksumPaths:new Set(emptyStorageCatalog.map(row=>row.data_file)),...extra});
  const producerScope = emptyStorageOnly ? await import("./production-backup-pg-dump-command.mjs") : null;
  run("EMPTY_STORAGE_NEW declared empty Storage agrees with normal producer in both restore modes",()=>{
    const before=JSON.stringify(emptyStorageInput());
    producerScope.requireProductionBackupDataScope(summary.backed_up_schemas.map(schema_name=>({schema_name,usage_allowed:true})),
      [{table_name:catalog[3].table_name,relation_kind:"r",is_partition:false}],emptyStorageCatalog);
    for (const databaseOnly of [false,true]) {
      const plan=selectVerifiedRestoreTables(emptyStorageInput({databaseOnly}));
      assert.deepEqual(plan.databaseTables,emptyStorageCatalog);
      assert.deepEqual(plan.storageTables,[]);
      assert.deepEqual(plan.privateTables,[catalog[3]]);
      assert.equal(plan.catalogRows,3);
      assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.databaseTables) && Object.isFrozen(plan.storageTables));
    }
    assert.equal(JSON.stringify(emptyStorageInput()),before);
    assert.deepEqual(emptyStorageSummary.backed_up_schemas,summary.backed_up_schemas);
  });
  run("EMPTY_STORAGE_NEW undeclared foreign and missing non-Storage schema scope still refuses",()=>{
    for (const backed_up_schemas of [summary.backed_up_schemas.filter(schema=>schema!=="storage"),
      summary.backed_up_schemas.filter(schema=>schema!=="custodial_release_identity"),[...summary.backed_up_schemas,"foreign"],
      [...summary.backed_up_schemas,"storage"]])
      assert.throws(()=>selectVerifiedRestoreTables(emptyStorageInput({summary:{...emptyStorageSummary,backed_up_schemas}})));
    const foreign=[...emptyStorageCatalog,table("foreign","records")];
    assert.throws(()=>selectVerifiedRestoreTables(emptyStorageInput({catalog:foreign,
      summary:{...emptyStorageSummary,table_count:4,database_row_count:4},checksumPaths:new Set(foreign.map(row=>row.data_file))})));
    for (const schema of ["public","auth","custodial_release_identity"]) {
      const missing=emptyStorageCatalog.filter(row=>row.schema_name!==schema);
      assert.throws(()=>selectVerifiedRestoreTables(emptyStorageInput({catalog:missing,
        summary:{...emptyStorageSummary,table_count:2,database_row_count:2},checksumPaths:new Set(missing.map(row=>row.data_file))})));
    }
  });
  run("EMPTY_STORAGE_NEW contradictory signed table row and per-table counts still refuse",()=>{
    for (const bad of [{table_count:4},{table_count:"3"},{database_row_count:4},{database_row_count:2},{database_row_count:"3"}])
      assert.throws(()=>selectVerifiedRestoreTables(emptyStorageInput({summary:{...emptyStorageSummary,...bad}})));
    for (const row_count of ["2","01",1,"-1","9007199254740992"])
      assert.throws(()=>selectVerifiedRestoreTables(emptyStorageInput({catalog:[{...emptyStorageCatalog[0],row_count},...emptyStorageCatalog.slice(1)]})));
  });
  run("EMPTY_STORAGE_NEW every actual table still needs its exact checksummed member",()=>{
    for (const missing of emptyStorageCatalog)
      assert.throws(()=>selectVerifiedRestoreTables(emptyStorageInput({checksumPaths:new Set(emptyStorageCatalog.filter(row=>row!==missing).map(row=>row.data_file))})));
    for (const data_file of ["database/storage.fake.jsonl",catalog[0].data_file,"inventory/table-catalog.json"])
      assert.throws(()=>selectVerifiedRestoreTables(emptyStorageInput({catalog:[...emptyStorageCatalog.slice(0,2),{...catalog[3],data_file}]})));
    assert.throws(()=>selectVerifiedRestoreTables(emptyStorageInput({catalog:emptyStorageCatalog.slice(0,2)})));
  });
  run("EMPTY_STORAGE_NEW zero-row members and exact columns primary keys remain intact",()=>{
    const zeroCatalog=emptyStorageCatalog.map(row=>({...row,row_count:"0"}));
    const zero=selectVerifiedRestoreTables(emptyStorageInput({catalog:zeroCatalog,summary:{...emptyStorageSummary,database_row_count:0}}));
    assert.deepEqual(zero.databaseTables,zeroCatalog);
    assert.strictEqual(zero.privateTables[0],zeroCatalog[2]);
    for (const bad of [{columns:[]},{primary_key:["missing"]},{primary_key:["id","id"]},
      {columns:[catalog[3].columns[0],catalog[3].columns[0]]},{data_encoding:"unsupported"}])
      assert.throws(()=>selectVerifiedRestoreTables(emptyStorageInput({catalog:[...emptyStorageCatalog.slice(0,2),{...catalog[3],...bad}]})));
  });
  run("full restore selects private DATA and leaves Storage API-owned",()=>{
    const before=JSON.stringify(catalog);
    const plan=selectVerifiedRestoreTables(input());
    assert.deepEqual(plan.databaseTables.map(row=>row.schema_name),["public","auth","custodial_release_identity"]);
    assert.strictEqual(plan.privateTables[0],catalog[3]);
    assert.deepEqual(plan.storageTables,[catalog[2]]);
    assert.equal(plan.catalogRows,4);
    assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.databaseTables) && Object.isFrozen(plan.privateTables));
    assert.equal(JSON.stringify(catalog),before);
  });
  run("database-only preserves existing Storage SQL selection",()=>{
    const plan=selectVerifiedRestoreTables(input({databaseOnly:true}));
    assert.deepEqual(plan.databaseTables,catalog);
    assert.throws(()=>selectVerifiedRestoreTables(input({databaseOnly:"true"})));
  });
  run("complete legacy three-schema archives preserve mode behavior",()=>{
    const legacyCatalog=catalog.slice(0,3),legacy={...summary,backed_up_schemas:summary.backed_up_schemas.slice(0,3),table_count:3,database_row_count:3};
    const checksumPaths=new Set(legacyCatalog.map(table=>table.data_file));
    assert.throws(()=>selectVerifiedRestoreTables(input({catalog:legacyCatalog,summary:legacy}))); // Retained private checksum is not a complete legacy archive.
    const plan=selectVerifiedRestoreTables(input({catalog:legacyCatalog,summary:legacy,checksumPaths}));
    assert.equal(plan.privateTables.length,0);
    assert.deepEqual(plan.databaseTables,legacyCatalog.slice(0,2));
    assert.deepEqual(selectVerifiedRestoreTables(input({catalog:legacyCatalog,summary:legacy,checksumPaths,databaseOnly:true})).databaseTables,legacyCatalog);
  });
  run("control arbitrary undeclared or missing schema coverage refuses",()=>{
    for(const schemas of[["public","auth","storage","custodial_dr"],["public","auth","storage","foreign"],
      ["public","auth","storage","storage"],["public","auth"],summary.backed_up_schemas.slice(0,3)])
      assert.throws(()=>selectVerifiedRestoreTables(input({summary:{...summary,backed_up_schemas:schemas}})));
    assert.throws(()=>selectVerifiedRestoreTables(input({catalog:catalog.slice(0,3),summary:{...summary,table_count:3,database_row_count:3}})));
    const foreign=[...catalog.slice(0,3),table("custodial_dr","restore_control")];
    assert.throws(()=>selectVerifiedRestoreTables(input({catalog:foreign})));
    assert.throws(()=>selectVerifiedRestoreTables(input({summary:{...summary,backed_up_schemas:undefined}})));
  });
  run("exact signed table and row totals refuse contradictory declarations",()=>{
    for(const bad of[{table_count:3},{table_count:"4"},{database_row_count:3},{database_row_count:"4"},
      {database_row_count:-1},{database_row_count:9007199254740992}])
      assert.throws(()=>selectVerifiedRestoreTables(input({summary:{...summary,...bad}})));
    for(const row_count of[1,"01","-1","9007199254740992",null])
      assert.throws(()=>selectVerifiedRestoreTables(input({catalog:[...catalog.slice(0,3),{...catalog[3],row_count}]})));
  });
  run("duplicate identities aliases and missing signed files refuse",()=>{
    assert.throws(()=>selectVerifiedRestoreTables(input({catalog:[...catalog.slice(0,3),catalog[0]]})));
    assert.throws(()=>selectVerifiedRestoreTables(input({catalog:[...catalog.slice(0,3),{...catalog[3],data_file:catalog[0].data_file}]})));
    assert.throws(()=>selectVerifiedRestoreTables(input({catalog:[...catalog.slice(0,3),{...catalog[3],data_file:"inventory/table-catalog.json"}]})));
    assert.throws(()=>selectVerifiedRestoreTables(input({checksumPaths:new Set(catalog.slice(0,3).map(row=>row.data_file))})));
    assert.throws(()=>selectVerifiedRestoreTables(input({checksumPaths:[...catalog.map(row=>row.data_file)]})));
  });
  run("malformed columns keys and path-bearing identifiers refuse",()=>{
    for(const bad of[{columns:[]},{columns:[catalog[3].columns[0],catalog[3].columns[0]]},
      {columns:[{...catalog[3].columns[0],generated:true}]},{columns:[{...catalog[3].columns[0],identity:false}]},
      {primary_key:["missing"]},{primary_key:["id","id"]},{table_name:"../original"}])
      assert.throws(()=>selectVerifiedRestoreTables(input({catalog:[...catalog.slice(0,3),{...catalog[3],...bad}]})));
  });
  run("zero-row private archive still selects its immutable target",()=>{
    const zero=selectVerifiedRestoreTables(input({catalog:[...catalog.slice(0,3),{...catalog[3],row_count:"0"}],
      summary:{...summary,database_row_count:3}}));
    assert.equal(zero.privateTables.length,1);
    assert.equal(zero.databaseTables.length,3);
  });
  run("caller approval fields do not remove the private import blocker",()=>{
    const plan=selectVerifiedRestoreTables(input({summary:{...summary,private_import_approved:true,restore_authorized:true}}));
    assert.equal(plan.privateTables.length,1);
    assert.equal(Object.hasOwn(plan,"authorized"),false);
    assert.equal(Object.hasOwn(plan,"accepted"),false);
    assert.throws(()=>selectVerifiedRestoreTables(input({summary:{...summary,format:"memphis-zoo-disaster-recovery.v3"}})));
  });
  run("owning caller validates signed coverage and refuses before effects",()=>{
    const source=readFileSync(new URL("./production-restore.mjs",import.meta.url),"utf8");
    const selection=source.indexOf("? selectVerifiedRestoreTables({summary,catalog,checksumPaths,databaseOnly})");
    assert.ok(selection>source.indexOf("if (catalogDigest !== summary.source_identity.database_catalog_sha256)"));
    assert.ok(source.includes("tableSelection?.privateTables.length"));
    const refusal=source.indexOf("if (privateImportBlocker !== null && !freshPrivateDatabase)");
    const originalIntent=source.indexOf("captureVerifiedOriginalRestoreIntent(intentEnvelope, intentVerifyKey, intentVerifyKeyId)");
    assert.ok(originalIntent>0 && refusal>originalIntent);
    assert.ok(source.includes("const freshPrivateDatabase = databaseOnly && privateImportBlocker !== null;"));
    assert.ok(refusal<source.indexOf("const db = new Client("));
    assert.ok(refusal<source.indexOf('restorePhase = "pause_admission"'));
    assert.ok(refusal<source.indexOf("truncate ${databaseTables"));
    assert.ok(source.includes("const databaseTables = tableSelection.databaseTables;"));
    assert.ok(source.includes("restore_compatible: archiveAdmission.restore_compatible && privateImportBlocker === null"));
    assert.equal(source.includes("const databaseTables = catalog.filter"),false);
    assert.equal(source.includes("private_import_approved"),false);
    assert.equal(source.includes("disable trigger"),false);
    assert.ok(source.includes("set local session_replication_role = replica"));
  });
  if (emptyStorageOnly) assert.equal(cases.length,selectedCase?1:5,"Selected new empty-Storage cases must execute, never silently pass zero cases.");
  console.log(JSON.stringify({selector:emptyStorageOnly?"--declared-empty-storage-selection-only":"--private-original-restore-selection-only",status:"PASS_PURE_SOURCE_CASES",count:cases.length,cases,
    limits:"Synthetic declarations and source wiring only; not authenticated archive/intent, live restore or immutable ledger import qualification."}));
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), "disaster-recovery-archive-test-"));
const key = "disaster-recovery-archive-materialization-test-key-0001";
const keyId = "archive-materialization-test-v1";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function writeArchive(directory) {
  mkdirSync(join(directory, "inventory"), { recursive: true, mode: 0o700 });
  const summary = {
    ok: true,
    format: "memphis-zoo-disaster-recovery.v4",
    consistent_database_snapshot: true,
    project_ref: "abcdefghijklmnopqrst",
    source_identity: { backup_tool_commit: "a".repeat(40), backup_tool_tree: "b".repeat(40) },
  };
  writeFileSync(join(directory, "backup-summary.json"), `${JSON.stringify(summary)}\n`);
  writeFileSync(join(directory, "inventory", "proof.json"), "{\"proof\":\"signed original\"}\n");
  const checksumBytes = Buffer.from([
    `${sha256(readFileSync(join(directory, "backup-summary.json")))}  backup-summary.json`,
    `${sha256(readFileSync(join(directory, "inventory", "proof.json")))}  inventory/proof.json`,
  ].join("\n") + "\n");
  writeFileSync(join(directory, "SHA256SUMS"), checksumBytes);
  const archiveDigest = sha256(checksumBytes);
  writeFileSync(join(directory, "archive-signature.json"), `${JSON.stringify({
    format: "memphis-zoo-disaster-recovery-signature.v1",
    algorithm: "hmac-sha256",
    key_id: keyId,
    archive_digest: archiveDigest,
    signature: signBinding(archiveSignatureBinding({
      archiveDigest,
      projectRef: summary.project_ref,
      sourceIdentity: summary.source_identity,
      archiveFormat: summary.format,
    }), key),
  })}\n`);
}

function writeRestoreIntentArchive(directory, format, objects = [], objectFiles = new Map()) {
  mkdirSync(join(directory, "inventory"), { recursive: true, mode: 0o700 });
  mkdirSync(join(directory, "storage", "objects"), { recursive: true, mode: 0o700 });
  const summary = {
    ok: true,
    format,
    consistent_database_snapshot: true,
    project_ref: "abcdefghijklmnopqrst",
    source_identity: { backup_tool_commit: "a".repeat(40), backup_tool_tree: "b".repeat(40) },
  };
  const entries = new Map([
    ["backup-summary.json", `${JSON.stringify(summary)}\n`],
    ["inventory/table-catalog.json", "[]\n"],
    ["inventory/storage-buckets.json", "[]\n"],
    ["inventory/storage-objects.json", `${JSON.stringify(objects)}\n`],
    ...objectFiles,
  ]);
  for (const [relativePath, bytes] of entries) {
    mkdirSync(join(directory, relativePath, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, relativePath), bytes);
  }
  const checksumBytes = Buffer.from([...entries].sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath]) => `${sha256(readFileSync(join(directory, relativePath)))}  ${relativePath}`)
    .join("\n") + "\n");
  writeFileSync(join(directory, "SHA256SUMS"), checksumBytes);
  const archiveDigest = sha256(checksumBytes);
  writeFileSync(join(directory, "archive-signature.json"), `${JSON.stringify({
    format: "memphis-zoo-disaster-recovery-signature.v1",
    algorithm: "hmac-sha256",
    key_id: keyId,
    archive_digest: archiveDigest,
    signature: signBinding(archiveSignatureBinding({
      archiveDigest,
      projectRef: summary.project_ref,
      sourceIdentity: summary.source_identity,
      archiveFormat: summary.format,
    }), key),
  })}\n`);
}

try {
  assert.deepEqual(restoreArchiveAdmission("memphis-zoo-disaster-recovery.v3"), {
    archive_format: "memphis-zoo-disaster-recovery.v3",
    restore_compatible: false,
    historical_verification_only: true,
  });
  assert.throws(() => restoreArchiveAdmission("memphis-zoo-disaster-recovery.v3", { apply: true }),
    /v4 disaster-recovery archive/i, "a signed v3 archive may be inspected but cannot reach destructive restore or reconciliation");
  assert.equal(restoreArchiveAdmission("memphis-zoo-disaster-recovery.v4", { apply: true }).restore_compatible, true);
  const intentEnvironment = {
    ...process.env,
    SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
    SUPABASE_DB_URL: "postgresql://should-not-connect.invalid:5432/test",
    RESTORE_NAMED_ACTOR: "archive admission test operator",
    RESTORE_INTENT_SIGNING_KEY: "independent-restore-intent-test-key-0000000001",
    RESTORE_INTENT_SIGNING_KEY_ID: "intent-admission-test-v1",
    RESTORE_ARCHIVE_VERIFY_KEY: key,
    RESTORE_ARCHIVE_VERIFY_KEY_ID: keyId,
  };
  const v3IntentSource = join(work, "v3-intent-source");
  writeRestoreIntentArchive(v3IntentSource, "memphis-zoo-disaster-recovery.v3");
  const v3IntentRun = spawnSync(process.execPath, [new URL("./create-production-restore-intent.mjs", import.meta.url).pathname], {
    env: { ...intentEnvironment, RESTORE_SOURCE_DIR: v3IntentSource }, encoding: "utf8",
  });
  assert.notEqual(v3IntentRun.status, 0);
  assert.equal(v3IntentRun.stdout, "", "a historical v3 archive must not emit signed restore authority");
  assert.match(v3IntentRun.stderr, /archive signature verification failed/i);
  assert.doesNotMatch(v3IntentRun.stderr, /ENOTFOUND|ECONNREFUSED|should-not-connect/i,
    "v3 rejection must happen before the target database connection is attempted");

  const malformedV4IntentSource = join(work, "malformed-v4-intent-source");
  const malformedBytes = Buffer.from("malformed-v4-owner-proof");
  const malformedFile = "storage/objects/malformed-owner-proof.bin";
  writeRestoreIntentArchive(malformedV4IntentSource, "memphis-zoo-disaster-recovery.v4", [{
    id: "legacy-wrapper-id", bucket_id: "private", name: "malformed-owner-proof.bin", file: malformedFile,
    size_bytes: malformedBytes.length, sha256: sha256(malformedBytes), metadata: { size: malformedBytes.length },
    user_metadata: null, version: "legacy-version", created_at: "2026-08-27T00:00:00Z", updated_at: "2026-08-27T00:00:00Z",
  }], new Map([[malformedFile, malformedBytes]]));
  const malformedV4IntentRun = spawnSync(process.execPath, [new URL("./create-production-restore-intent.mjs", import.meta.url).pathname], {
    env: { ...intentEnvironment, RESTORE_SOURCE_DIR: malformedV4IntentSource }, encoding: "utf8",
  });
  assert.notEqual(malformedV4IntentRun.status, 0);
  assert.equal(malformedV4IntentRun.stdout, "", "a v3-shaped object relabeled as v4 must not emit signed restore authority");
  assert.match(malformedV4IntentRun.stderr, /complete database_row/i);
  assert.doesNotMatch(malformedV4IntentRun.stderr, /ENOTFOUND|ECONNREFUSED|should-not-connect/i,
    "malformed v4 Storage schema rejection must happen before target database connection");

  const aliasV4IntentSource = join(work, "alias-v4-intent-source");
  const aliasBytes = Buffer.from("checksummed non-storage control bytes\n");
  const aliasRow = {
    id: "alias-object-id", bucket_id: "private", name: "alias-proof.bin",
    owner_id: "employee-1", owner: "employee-1", metadata: { size: aliasBytes.length }, user_metadata: null,
    version: "alias-version", created_at: "2026-08-27T00:00:00+00:00", updated_at: "2026-08-27T00:00:00+00:00",
    last_accessed_at: "2026-08-27T00:00:00+00:00",
  };
  writeRestoreIntentArchive(aliasV4IntentSource, "memphis-zoo-disaster-recovery.v4", [{
    id: aliasRow.id, bucket_id: aliasRow.bucket_id, name: aliasRow.name, file: "inventory/proof.json",
    size_bytes: aliasBytes.length, sha256: sha256(aliasBytes), metadata: aliasRow.metadata,
    user_metadata: aliasRow.user_metadata, version: aliasRow.version,
    created_at: aliasRow.created_at, updated_at: aliasRow.updated_at, database_row: aliasRow,
  }], new Map([["inventory/proof.json", aliasBytes]]));
  const aliasV4IntentRun = spawnSync(process.execPath, [new URL("./create-production-restore-intent.mjs", import.meta.url).pathname], {
    env: { ...intentEnvironment, RESTORE_SOURCE_DIR: aliasV4IntentSource }, encoding: "utf8",
  });
  assert.notEqual(aliasV4IntentRun.status, 0);
  assert.equal(aliasV4IntentRun.stdout, "", "a checksummed control file alias must not emit signed restore authority");
  assert.match(aliasV4IntentRun.stderr, /deterministic producer archive path/i);
  assert.doesNotMatch(aliasV4IntentRun.stderr, /ENOTFOUND|ECONNREFUSED|should-not-connect/i,
    "Storage file-path substitution must fail before target database connection");

  const numericOwnerV4IntentSource = join(work, "numeric-owner-v4-intent-source");
  const numericOwnerBytes = Buffer.from("numeric-owner-object-bytes\n");
  const numericOwnerName = "numeric-owner-proof.bin";
  const numericOwnerFile = `storage/objects/${sha256(`private\0${numericOwnerName}`)}.bin`;
  const numericOwnerRow = {
    id: "numeric-owner-object-id", bucket_id: "private", name: numericOwnerName,
    owner_id: 123, owner: 123, metadata: { size: numericOwnerBytes.length }, user_metadata: null,
    version: "numeric-owner-version", created_at: "2026-08-27T00:00:00+00:00", updated_at: "2026-08-27T00:00:00+00:00",
    last_accessed_at: "2026-08-27T00:00:00+00:00",
  };
  writeRestoreIntentArchive(numericOwnerV4IntentSource, "memphis-zoo-disaster-recovery.v4", [{
    id: numericOwnerRow.id, bucket_id: numericOwnerRow.bucket_id, name: numericOwnerRow.name, file: numericOwnerFile,
    size_bytes: numericOwnerBytes.length, sha256: sha256(numericOwnerBytes), metadata: numericOwnerRow.metadata,
    user_metadata: numericOwnerRow.user_metadata, version: numericOwnerRow.version,
    created_at: numericOwnerRow.created_at, updated_at: numericOwnerRow.updated_at, database_row: numericOwnerRow,
  }], new Map([[numericOwnerFile, numericOwnerBytes]]));
  const numericOwnerV4IntentRun = spawnSync(process.execPath, [new URL("./create-production-restore-intent.mjs", import.meta.url).pathname], {
    env: { ...intentEnvironment, RESTORE_SOURCE_DIR: numericOwnerV4IntentSource }, encoding: "utf8",
  });
  assert.notEqual(numericOwnerV4IntentRun.status, 0);
  assert.equal(numericOwnerV4IntentRun.stdout, "", "numeric owner fields must not emit signed restore authority");
  assert.match(numericOwnerV4IntentRun.stderr, /owner fields must be null or nonblank strings/i);
  assert.doesNotMatch(numericOwnerV4IntentRun.stderr, /ENOTFOUND|ECONNREFUSED|should-not-connect/i,
    "numeric owner rejection must happen before target database connection");

  for (const [label, invalidTimestamp] of [
    ["zero", "0"],
    ["informal", "Aug 27 2026"],
    ["date-only", "2026-08-27"],
    ["zero-fraction", "2026-08-27T00:00:00.0+00:00"],
    ["trailing-fraction-zero", "2026-08-27T00:00:00.123400+00:00"],
    ["negative-zero-offset", "2026-08-27T00:00:00-00:00"],
  ]) {
    const timestampV4IntentSource = join(work, `${label}-timestamp-v4-intent-source`);
    const timestampBytes = Buffer.from(`${label}-timestamp-object-bytes\n`);
    const timestampName = `${label}-timestamp-proof.bin`;
    const timestampFile = `storage/objects/${sha256(`private\0${timestampName}`)}.bin`;
    const timestampRow = {
      id: `${label}-timestamp-object-id`, bucket_id: "private", name: timestampName,
      owner_id: "employee-1", owner: "employee-1", metadata: { size: timestampBytes.length }, user_metadata: null,
      version: `${label}-timestamp-version`, created_at: "2026-08-27T00:00:00+00:00", updated_at: invalidTimestamp,
      last_accessed_at: "2026-08-27T00:00:00+00:00",
    };
    writeRestoreIntentArchive(timestampV4IntentSource, "memphis-zoo-disaster-recovery.v4", [{
      id: timestampRow.id, bucket_id: timestampRow.bucket_id, name: timestampRow.name, file: timestampFile,
      size_bytes: timestampBytes.length, sha256: sha256(timestampBytes), metadata: timestampRow.metadata,
      user_metadata: timestampRow.user_metadata, version: timestampRow.version,
      created_at: timestampRow.created_at, updated_at: timestampRow.updated_at, database_row: timestampRow,
    }], new Map([[timestampFile, timestampBytes]]));
    const timestampV4IntentRun = spawnSync(process.execPath, [new URL("./create-production-restore-intent.mjs", import.meta.url).pathname], {
      env: { ...intentEnvironment, RESTORE_SOURCE_DIR: timestampV4IntentSource }, encoding: "utf8",
    });
    assert.notEqual(timestampV4IntentRun.status, 0);
    assert.equal(timestampV4IntentRun.stdout, "", `${label} non-producer timestamp must not emit signed restore authority`);
    assert.match(timestampV4IntentRun.stderr, /PostgreSQL row_to_json timestamp/i);
    assert.doesNotMatch(timestampV4IntentRun.stderr, /ENOTFOUND|ECONNREFUSED|should-not-connect/i,
      `${label} non-producer timestamp must fail before target database connection`);
  }
  const source = join(work, "source");
  writeArchive(source);
  const verified = materializeVerifiedArchive({
    sourceDir: source,
    archiveVerifyKey: key,
    archiveVerifyKeyId: keyId,
    supportedFormats: ["memphis-zoo-disaster-recovery.v4"],
    requiredEntries: ["backup-summary.json", "inventory/proof.json"],
  });
  writeFileSync(join(source, "inventory", "proof.json"), "{\"proof\":\"replaced after verification\"}\n");
  assert.equal(readFileSync(join(verified.directory, "inventory", "proof.json"), "utf8"), "{\"proof\":\"signed original\"}\n",
    "all restore consumers must read the private verified snapshot after source replacement");
  verified.cleanup();

  const symlinkSource = join(work, "symlink-source");
  const outside = join(work, "outside");
  writeArchive(symlinkSource);
  mkdirSync(outside, { mode: 0o700 });
  writeFileSync(join(outside, "proof.json"), "{\"proof\":\"signed original\"}\n");
  rmSync(join(symlinkSource, "inventory"), { recursive: true });
  symlinkSync(outside, join(symlinkSource, "inventory"), "dir");
  assert.throws(() => materializeVerifiedArchive({
    sourceDir: symlinkSource,
    archiveVerifyKey: key,
    archiveVerifyKeyId: keyId,
    requiredEntries: ["backup-summary.json", "inventory/proof.json"],
  }), /ELOOP|not a directory/i, "an intermediate archive symlink must be rejected before any evidence is trusted");
  console.log("DISASTER_RECOVERY_ARCHIVE_TESTS_PASS");
} finally {
  rmSync(work, { recursive: true, force: true });
}
