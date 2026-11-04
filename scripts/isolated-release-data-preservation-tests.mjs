import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import pg from 'pg';
import {loadOriginal235PreservationSource,validateOriginal235PreservationPlan,nativeTextColumnProjection,compileOriginalTableComparison,compileApprovedOffsiteComparison,NATIVE_TEXT_PRESERVATION_SETTINGS,prepareIsolatedReleaseDataPreservation,readOriginal217PreservationScope} from './isolated-release-data-preservation.mjs';
import {bindExistingPostgresForwardSources,productionForwardSourceManifest} from './production-forward-source.mjs';
import {readMigrationReplayPlan} from './migration-replay-order.mjs';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url)),read=f=>fs.readFileSync(join(root,f),'utf8');
let checks=0;const test=async(name,fn)=>{await fn();checks++;};
const manifest=loadOriginal235PreservationSource(root),module=read('scripts/isolated-release-data-preservation.mjs');
const restore=read('scripts/production-restore.mjs');
const begin=restore.indexOf('function nativeTextRestorePlan(table, actual) {'),end=restore.indexOf('\nasync function requireNativeTextRelationCensus()',begin);
assert.ok(begin>0&&end>begin);
const quoteIdentifier=x=>'"'+x.replaceAll('"','""')+'"';
const maintainedRenderer=vm.runInNewContext('('+restore.slice(begin,end)+')',{
 stableJson:JSON.stringify,quoteIdentifier,qualified:(s,t)=>quoteIdentifier(s)+'.'+quoteIdentifier(t),
});
await test('exact original235 public metadata census and four finite exceptions',()=>{
 assert.equal(manifest.tables.length,182);assert.equal(manifest.source_ledger_count,235);assert.equal(manifest.source_ledger_head,'20261021111917');
 assert.equal(manifest.canonical_source_count,294);assert.equal(manifest.production_authorized,false);
 assert.deepEqual(manifest.tables.find(x=>x.name==='system_settings').columns,['setting_key','setting_value','description','updated_at']);
 assert.deepEqual(manifest.tables.find(x=>x.name==='events_app_event_history').columns,['id','event_id','action','actor','reason','previous_record','new_record','created_at','actor_manager_id']);
});
const nonpublicFixture=JSON.parse(read('scripts/fixtures/original235-nonpublic-column-metadata.json'));
assert.equal(nonpublicFixture.scope,'SOURCE_METADATA_TEST_FIXTURE_NOT_ARCHIVE_AUTHORITY');assert.equal(nonpublicFixture.tables.length,35);
for(const table of [...manifest.tables,...nonpublicFixture.tables,{schema:'public',name:'quoted_fixture_only',columns:["single'quote",'double"quote','slash\\column','wide_numeric','json_text','array_bounds','null_value']}]){
 await test('projection byte-equal to actual maintained restore renderer '+table.name,()=>{
  const columns=table.columns.map(name=>({name,generated:false}));
  const original={schema_name:table.schema,table_name:table.name,columns,primary_key:[]};
  const actual={relation_kind:'r',is_partition:false,inheritance_count:'0',dropped_count:'0',columns,primary_key:[],casts:table.columns.map(name=>({name,supported_io:true,type_schema:'pg_catalog',type_name:'text'}))};
  const compiled=maintainedRenderer(original,actual),projection=/actual as materialized \(select ([\s\S]*?) collate pg_catalog\."C" image/.exec(compiled.compare)?.[1];
  assert.equal(nativeTextColumnProjection(table.columns,'r'),projection);
  assert.ok(!/jsonb|row_to_json|to_jsonb/.test(projection));
 });
}
await test('maintained ordinary restore canonical formatting is exactly retained and restored',()=>{
 for(const [key,value]of NATIVE_TEXT_PRESERVATION_SETTINGS){
  assert.ok(restore.toLowerCase().includes("set local "+key.toLowerCase()+" = "+(['extra_float_digits','row_security'].includes(key)?value:"'"+value.toLowerCase()+"'")));
 }
 assert.ok(module.includes('finally{for(const [key]of NATIVE_TEXT_PRESERVATION_SETTINGS)'));
 assert.ok(module.includes("await query('select set_config($1,$2,true)',[key,saved[key]])"));
});
const canonicalPlan=manifest.plan.map(x=>({order:x.order,file:x.file,source_migration_version:x.file.slice(0,14),sha256:x.canonical_sha256}));
const actualPlan=bindExistingPostgresForwardSources(root,canonicalPlan);
const current177=bindExistingPostgresForwardSources(root,readMigrationReplayPlan(root).files.slice(134).map((file,index)=>({
 order:index+1,file,phase:file.slice(15,-4),source_migration_version:file.slice(0,14),sha256:createHash('sha256').update(read('supabase/migrations/'+file)).digest('hex'),
})));
await test('exact closed311/177 plan preserves all original235 comparison obligations',()=>{
 assert.equal(current177.length,177);assert.deepEqual(validateOriginal235PreservationPlan(root,current177),manifest);
});
for(const mutation of [p=>p.at(-1).sha256='0'.repeat(64),p=>p.at(-1).phase='unknown',p=>p.at(-1).forward_source={},p=>p[160].sha256='0'.repeat(64),p=>p.push({...p.at(-1)})]){
 await test('compact preservation rejects changed tail, prefix, execution profile or extra migration',()=>{const p=structuredClone(current177);mutation(p);assert.throws(()=>validateOriginal235PreservationPlan(root,p));});
}
await test('all160 actual source inputs admitted through shipping dualhash resolver',()=>{
 validateOriginal235PreservationPlan(root,actualPlan);
 assert.deepEqual(actualPlan.filter(x=>x.forward_source).map(x=>x.order),canonicalPlan.filter(x=>productionForwardSourceManifest(root).migrations.some(m=>m.canonical_file===x.file)).map(x=>x.order));
});
for(const mutation of [p=>p.pop(),p=>p.reverse(),p=>p[0].sha256='0'.repeat(64),p=>p[154].forward_source.sha256='0'.repeat(64),p=>p[0].sql='select 1',p=>p[0].order=2]){
 await test('changed/missing/reordered/false executed source refused',()=>{const p=structuredClone(actualPlan);mutation(p);assert.throws(()=>validateOriginal235PreservationPlan(root,p));});
}
await test('ordinary native comparison uses exact original fields plus duplicate-sensitive EXCEPT ALL',()=>{
 const t=manifest.tables.find(t=>t.name==='device_auth_credentials'),s=compileOriginalTableComparison(t);
 assert.equal((s.match(/except all/g)||[]).length,2);assert.ok(s.includes(nativeTextColumnProjection(t.columns,'r')));assert.ok(s.includes('from only "public"."device_auth_credentials" r'));assert.ok(!s.includes('jsonb'));
});
await test('approved Q07 compares every native field and every row except the two explicit bounded changes',()=>{
 const t=manifest.tables.find(x=>x.name==='location_groups'),sql=compileApprovedOffsiteComparison(t);
 assert.equal((sql.match(/except all/g)||[]).length,2);
 for(const c of t.columns)assert.ok(sql.includes(c));
 for(const guard of ["source_eligible","current_eligible","invalid_transformation","r.group_name is distinct from 'Off campus event'","r.updated_at is null","r.updated_at=transaction_timestamp()","r.updated_at between $1::timestamptz and clock_timestamp()","raw_actual","before_sha256","after_sha256"])assert.ok(sql.includes(guard));
 assert.ok(!sql.includes('jsonb'),'Untouched values must retain lossless native TEXT');
 assert.throws(()=>compileApprovedOffsiteComparison({...t,schema:'auth'}));
 assert.throws(()=>compileApprovedOffsiteComparison({...t,columns:t.columns.slice(1)}));
 assert.ok(module.includes("plan.at(-1)?.file==='20261031225210_custodial_sealed_repairs_current_eight.sql'"));
 assert.ok(module.includes("plan.at(-1).sha256,'f4e3dc5be9a465e2099bd9b23488f99b3f9e4c1d9d969844b2fa06b1fbdc7a73'"));
 assert.ok(module.includes("assert.equal(row.source_eligible,'1');assert.equal(row.current_eligible,'1');assert.equal(row.invalid_transformation,'0')"));
 const ordinary=compileOriginalTableComparison(t);assert.ok(!ordinary.includes('Q07_APPROVED_MIGRATION_TIME'),'Historical plans keep their exact original row comparison');
});
await test('only four setting keys are excluded; no table-wide fallback',()=>{
 const s=compileOriginalTableComparison(manifest.tables.find(x=>x.name==='system_settings'));
 for(const key of ['restroom_due_soon_minutes','restroom_overdue_minutes','exhibit_due_soon_minutes','exhibit_overdue_minutes'])assert.equal(s.split(key).length-1,2);
 assert.ok(s.includes("image::pg_catalog.json->>'setting_key' <> all"));assert.ok(s.includes('where r.setting_key <> all'));
 for(const name of ['events_app_events','custodial_release_authority_restore_inventory'])assert.throws(()=>compileOriginalTableComparison(manifest.tables.find(x=>x.name===name)));
});
await test('four source setting constants/descriptions are literal exact canonical UPSERT values',()=>{
 const s=read('supabase/migrations/20260922070000_completed_cleaning_reminder_cycles.sql');
 const constants=/const SETTINGS=Object.freeze\(\[([\s\S]*?)\]\);/.exec(module)?.[1];assert.ok(constants);
 for(const match of constants.matchAll(/\['([^']*)','([^']*)','([^']*)'\]/g))assert.ok(s.includes("('"+match[1]+"','"+match[2]+"'::jsonb,'"+match[3]+"')"));
 assert.ok(s.includes('on conflict(setting_key) do update set setting_value=excluded.setting_value,\n description=excluded.description,updated_at=statement_timestamp()'));
});
await test('event eligibility and full old/new archive are coupled to exact canonical migration',()=>{
 const s=read('supabase/migrations/20261002060000_event_needs_review_isolation.sql');
 assert.ok(s.includes("e.status = 'SCHEDULED' and (e.needs_review or e.event_scope = 'UNKNOWN')"));
 assert.ok(module.includes("((e.status='SCHEDULED' and (e.needs_review or e.event_scope='UNKNOWN')) is true) eligible"));
 const reason='Legacy unresolved event moved out of scheduled delivery without deleting original evidence.';
 assert.ok(s.includes(reason)&&module.includes(reason));
 for(const f of ['status','event_scope','needs_review','primary_venue_id','venue_ids','coverage_location_ids','staffing_area_ids','source_location_text','display_location','revision','updated_at'])assert.ok(s.includes(f));
 for(const seam of ['h.previous_record=b.prior_record','h.new_record=a.current_record','h.actor_manager_id is null','missing_exact_history','unexpected_new_history','changed_id_set','unrelated_column_changed'])assert.ok(module.includes(seam));
 assert.ok(module.includes('where not b.eligible and a.current_image is distinct from b.prior_image'));
 assert.ok(module.includes('a.current_image::jsonb-${changedEventFields}'));
 assert.ok(module.includes("if(!(t.schema==='public'&&t.name==='events_app_event_history'))assert.equal(row.extra_rows,'0'"));
});
await test('existing event trigger effects remain explicit',()=>{
 const venue=read('supabase/migrations/20260718021910_event_input_console_scope_venue_taxonomy.sql');
 assert.ok(venue.includes("new.event_timezone := coalesce(nullif(btrim(new.event_timezone), ''), 'America/Chicago')"));
 assert.ok(module.includes("'event_timezone',coalesce(nullif(btrim(b.prior_record->>'event_timezone'),''),'America/Chicago')"));
 assert.ok(module.includes("'updated_at',transaction_timestamp()"));
 const baseline=read('supabase/migrations/00000000000000_production_baseline.sql');
 assert.ok(baseline.includes('NEW.updated_at = now()')||baseline.toLowerCase().includes('new.updated_at = now()')||baseline.toLowerCase().includes('new.updated_at := now()'));
});
await test('relay must remain closed without migration-time send or preflight evidence',()=>{
 assert.ok(read('supabase/migrations/20261002220000_feedback_relay_preflight_and_reconciliation.sql').includes("set paused=true,pause_reason='v2_preflight_required'"));
 assert.ok(module.includes("not exists(select 1 from jsonb_each(to_jsonb(c)-array['singleton','paused','pause_reason','updated_at'])"));
 for(const t of ['system_feedback_email_intents','system_feedback_email_attempts','system_feedback_email_receipts','system_feedback_email_relay_requests'])assert.ok(module.includes(t));
});
await test('owner guard refuses plain fake and disconnected real client before any query',async()=>{
 let calls=0;const fake={query(){calls++;throw new Error('must never execute');}};
 await assert.rejects(prepareIsolatedReleaseDataPreservation({client:fake}),{code:'ISOLATED_PRESERVATION_OWNER_REQUIRED'});
 const disconnected=new pg.Client({host:'127.0.0.1'});
 await assert.rejects(prepareIsolatedReleaseDataPreservation({client:disconnected}),{code:'ISOLATED_PRESERVATION_OWNER_REQUIRED'});assert.equal(calls,0);
});
await test('all217 scope requires the existing authenticated archive capability, not detached metadata',()=>{
 assert.throws(()=>readOriginal217PreservationScope({backendRoot:root,verifiedArchive:{sourceBinding:{summary:{table_count:217}},databaseTables:nonpublicFixture.tables}}));
 for(const seam of ['readVerifiedArchiveSourceBinding(verifiedArchive)','readVerifiedRestoreTableSelection(verifiedArchive,{databaseOnly:true})','readVerifiedMigrationTargetCaptureSource(verifiedArchive)','selection.databaseTables.length,expectedTables','selection.privateTables.length,0','selection.storageTables.length,expectedStorage',"t.schema_name==='auth').length,27",'postgresTextColumnsLineEncoding','assertCurrent();'])assert.ok(module.includes(seam));
 assert.ok(module.includes("in access share mode"));assert.ok(module.includes("ELSE 'AccessShareLock' END"));
 assert.ok(module.includes('nonpublic_tables:nonpublic.length,nonpublic_exact_native_text:true'));
});
await test('current signed archive includes both added storage relations in preservation scope',()=>{
 const begin=module.indexOf('export function readOriginal217PreservationScope('),end=module.indexOf('\nconst hashes=',begin);
 assert.ok(begin>=0&&end>begin);
 const encoding='FIXTURE_NATIVE_TEXT',verifiedArchive={};
 const binding={archive_digest:'f246930e213d8e9313db08b1d948ed5b1457a4ef0e40925a2ed2ebc7247e88c3',summary:{project_ref:manifest.project_ref,table_count:219}};
 const relations=[...manifest.tables,...nonpublicFixture.tables,
  {schema:'storage',name:'fixture_additional_storage_a',columns:['id']},{schema:'storage',name:'fixture_additional_storage_b',columns:['id']}];
 const databaseTables=relations.map(t=>({schema_name:t.schema,table_name:t.name,columns:t.columns.map(name=>({name})),data_encoding:encoding}));
 const selection={databaseTables,privateTables:[],storageTables:databaseTables.filter(t=>t.schema_name==='storage')};
 const source={sourceBinding:binding,catalog:{},ledger:Array.from({length:235},(_,i)=>({version:i===234?manifest.source_ledger_head:String(i)}))};
 const dependencies={
  assert,loadOriginal235PreservationSource:()=>manifest,readVerifiedArchiveSourceBinding:()=>binding,
  readVerifiedRestoreTableSelection:()=>selection,readVerifiedMigrationTargetCaptureSource:()=>source,
  fingerprintSchemaCatalog:()=>({fingerprint:manifest.source_catalog_fingerprint}),postgresTextColumnsLineEncoding:encoding,tableKey:t=>t.schema+'.'+t.name,
 };
 const scopeReader=vm.compileFunction('return ('+module.slice(begin,end).replace('export function','function')+')',Object.keys(dependencies))(...Object.values(dependencies));
 const scope=scopeReader({backendRoot:root,verifiedArchive});assert.equal(scope.tables.length,219);
 assert.equal(scope.tables.filter(t=>t.schema==='storage').length,10);scope.assertCurrent();
 assert.ok(scope.tables.some(t=>t.name==='fixture_additional_storage_b'));
 binding.archive_digest='0'.repeat(64);assert.throws(()=>scopeReader({backendRoot:root,verifiedArchive}));
 binding.archive_digest='f246930e213d8e9313db08b1d948ed5b1457a4ef0e40925a2ed2ebc7247e88c3';
 selection.databaseTables.pop();assert.throws(()=>scopeReader({backendRoot:root,verifiedArchive}));
});
await test('public exceptions cannot spill into a same-named nonpublic relation',()=>{
 for(const name of ['system_settings','events_app_event_history','events_app_events','custodial_release_authority_restore_inventory']){
  const sql=compileOriginalTableComparison({schema:'auth',name,columns:['id']});assert.ok(sql.includes('from only "auth".'));assert.ok(!sql.includes('where r.setting_key'));
 }
 assert.ok(module.includes("if(!(t.schema==='public'&&t.name==='events_app_event_history'))assert.equal(row.extra_rows"));
});
await test('no constructor/connection/transaction outcome/authority is added',()=>{
 for(const forbidden of [/new Client\(/,/\.connect\(/,/query\(['"]commit['"]/i,/query\(['"]rollback['"]/i,/\bgrant\s+(?:all|execute|select)\b/i,/process\.stdout/])assert.ok(!forbidden.test(module));
 for(const required of ["client._txStatus!=='T'","client.readyForQuery!==true","profile.actor!=='postgres'","profile.superuser!==false","profile.bypassrls!==true","profile.isolation!=='serializable'","profile.cron_active!=='off'","profile.fence_held!==true","assert.deepEqual(nowProfile,profile","assert.equal(verified,false"])assert.ok(module.includes(required));
 assert.ok(module.includes('raw_values_exported:false,production_authorized:false,full_candidate_admission:false'));
});
console.log(JSON.stringify({status:'PASS_SOURCE_ONLY',checks,actual_SQL:false,actual_populated_data:false,production_authorized:false,remaining:'Owning rollback-only genuine populated transaction qualification'}));
