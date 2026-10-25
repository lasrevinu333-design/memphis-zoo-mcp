import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';
import {resolveReleaseMigrationSource} from './production-forward-source.mjs';
import {readVerifiedArchiveSourceBinding,readVerifiedRestoreTableSelection,readVerifiedMigrationTargetCaptureSource,postgresTextColumnsLineEncoding} from './disaster-recovery-archive.mjs';
const {Client}=pg,originalQuery=Client.prototype.query;
const sha=x=>createHash('sha256').update(x).digest('hex');
const EXCEPTIONS=new Set(['custodial_release_authority_restore_inventory','system_settings','events_app_events','events_app_event_history']);
const SETTINGS=Object.freeze([
 ['restroom_due_soon_minutes','75','Restroom due-soon interval after completed cleaning'],
 ['restroom_overdue_minutes','90','Restroom overdue interval after completed cleaning'],
 ['exhibit_due_soon_minutes','195','Exhibit due-soon interval after completed cleaning'],
 ['exhibit_overdue_minutes','210','Exhibit overdue interval after completed cleaning'],
]);
export const NATIVE_TEXT_PRESERVATION_SETTINGS=Object.freeze([
 ['extra_float_digits','3'],['datestyle','ISO, YMD'],['timezone','UTC'],['intervalstyle','postgres'],['bytea_output','hex'],['row_security','off'],
]);
const ident=s=>'"'+String(s).replaceAll('"','""')+'"';
const literal=s=>"E'"+String(s).replaceAll('\\','\\\\').replaceAll("'","''")+"'";
const target=t=>ident(t.schema)+'.'+ident(t.name);
// The maintained ordinary restore renderer uses this exact all-columns-as-TEXT
// representation. It preserves NULL, json text, numeric, bytea and arrays.
export const nativeTextColumnProjection=(names,alias)=>`pg_catalog.json_object(ARRAY[${names.map(literal).join(',')}]::pg_catalog.text[],`
 +`ARRAY[${names.map(name=>`${alias}.${ident(name)}::pg_catalog.text`).join(',')}]::pg_catalog.text[])::pg_catalog.text`;
const tableKey=t=>t.schema+'.'+t.name;
export function loadOriginal235PreservationSource(backendRoot){
 const file=join(backendRoot,'release/production-data-preservation/original-235.json'),raw=fs.readFileSync(file);
 assert.equal(sha(raw),'feff8c1f9b4187cd15e0d35a091cd2d277defc1e7d8363227c44eb7d51708a44');
 const m=JSON.parse(raw);assert.equal(m.schema,'custodial.original235-data-preservation-source.v1');
 assert.equal(m.project_ref,'rqquvtjdmugpigbndmne');assert.equal(m.production_authorized,false);
 assert.equal(m.tables.length,182);assert.equal(m.plan.length,157);assert.equal(new Set(m.tables.map(tableKey)).size,182);
 assert.ok(m.tables.every(t=>t.schema==='public'&&t.columns.length>0&&new Set(t.columns).size===t.columns.length));
 assert.equal(m.tables.filter(t=>!EXCEPTIONS.has(t.name)).length,178);return m;
}
export function validateOriginal235PreservationPlan(backendRoot,plan){
 const manifest=loadOriginal235PreservationSource(backendRoot);
 assert.equal(plan.length,157);
 for(let i=0;i<plan.length;i++){
  const expected=manifest.plan[i],item=plan[i];assert.equal(item.order,expected.order);assert.equal(item.file,expected.file);
  const source=resolveReleaseMigrationSource(backendRoot,item);assert.equal(source.canonical_sha256,expected.canonical_sha256);
  if(Object.hasOwn(item,'sql'))assert.equal(item.sql,source.sql);
 }
 return manifest;
}
// The existing authenticated archive reader owns ALL original table metadata.
// A detached census, caller DTO or row payload cannot replace this capability.
export function readOriginal217PreservationScope({backendRoot,verifiedArchive}){
 const manifest=loadOriginal235PreservationSource(backendRoot);
 const binding=readVerifiedArchiveSourceBinding(verifiedArchive);
 const selection=readVerifiedRestoreTableSelection(verifiedArchive,{databaseOnly:true});
 const source=readVerifiedMigrationTargetCaptureSource(verifiedArchive);
 assert.equal(source.sourceBinding,binding);assert.equal(binding.summary.project_ref,manifest.project_ref);
 assert.equal(fingerprintSchemaCatalog(source.catalog).fingerprint,manifest.source_catalog_fingerprint);
 assert.equal(source.ledger.length,manifest.source_ledger_count);assert.equal(source.ledger.at(-1).version,manifest.source_ledger_head);
 assert.equal(selection.databaseTables.length,217);assert.equal(selection.privateTables.length,0);assert.equal(selection.storageTables.length,8);
 assert.equal(selection.databaseTables.filter(t=>t.schema_name==='auth').length,27);
 assert.ok(selection.databaseTables.every(t=>t.data_encoding===postgresTextColumnsLineEncoding));
 const tables=Object.freeze(selection.databaseTables.map(t=>Object.freeze({schema:t.schema_name,name:t.table_name,columns:Object.freeze(t.columns.map(c=>c.name))})));
 const publicTables=tables.filter(t=>t.schema==='public');assert.equal(publicTables.length,182);
 for(const original of manifest.tables)assert.deepEqual(publicTables.find(t=>tableKey(t)===tableKey(original)),original);
 const assertCurrent=()=>{
  assert.equal(readVerifiedArchiveSourceBinding(verifiedArchive),binding);
  assert.equal(readVerifiedRestoreTableSelection(verifiedArchive,{databaseOnly:true}),selection);
  assert.equal(readVerifiedMigrationTargetCaptureSource(verifiedArchive).sourceBinding,binding);
 };
 assertCurrent();return Object.freeze({manifest,tables,assertCurrent});
}
const hashes=alias=>`pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(pg_catalog.encode(extensions.digest(pg_catalog.convert_to(${alias}.image,'UTF8'),'sha256'),'hex'),'' order by ${alias}.image collate pg_catalog."C"),''),'UTF8'),'sha256'),'hex')`;
export function compileOriginalTableComparison(t){
 assert.ok(t&&['public','auth','storage'].includes(t.schema)&&typeof t.name==='string'&&Array.isArray(t.columns)&&t.columns.length);
 assert.ok(!(t.schema==='public'&&['custodial_release_authority_restore_inventory','events_app_events'].includes(t.name)),'explicit separate predicate proof required');
 const key=literal(tableKey(t)),keys=SETTINGS.map(x=>literal(x[0])).join(',');
 const beforeFilter=t.schema==='public'&&t.name==='system_settings'?` and image::pg_catalog.json->>'setting_key' <> all(array[${keys}]::text[])`:'';
 const afterFilter=t.schema==='public'&&t.name==='system_settings'?` where r.setting_key <> all(array[${keys}]::text[])`:'';
 return `with expected as materialized(select image from pg_temp.custodial_release_preservation_before where relation=${key}${beforeFilter}),
 actual as materialized(select ${nativeTextColumnProjection(t.columns,'r')} collate pg_catalog."C" image from only ${target(t)} r${afterFilter}),
 missing as(select image from expected except all select image from actual),extra as(select image from actual except all select image from expected)
 select (select count(*)::text from expected) before_rows,(select count(*)::text from actual) after_rows,
 (select count(*)::text from missing) missing_rows,(select count(*)::text from extra) extra_rows,
 (select ${hashes('e')} from expected e) before_sha256,(select ${hashes('a')} from actual a) after_sha256`;
}
const PROFILE=`select pg_backend_pid()::text pid,current_user actor,session_user original_actor,current_database() database,
 (select datdba::regrole::text from pg_database where datname=current_database()) database_owner,
 (select rolsuper from pg_roles where rolname=current_user) superuser,(select rolbypassrls from pg_roles where rolname=current_user) bypassrls,
 current_setting('transaction_read_only') read_only,current_setting('transaction_isolation') isolation,
 current_setting('session_replication_role') replication,current_setting('cron.launch_active_jobs') cron_active,
 current_setting('cron.database_name') cron_database,current_setting('TimeZone') timezone,
 transaction_timestamp()::text transaction_time,
 exists(select 1 from pg_locks l where l.pid=pg_backend_pid() and l.locktype='advisory' and l.granted and l.mode='ExclusiveLock'
 and l.objsubid=1 and l.classid::bigint=((hashtextextended('memphis-zoo-application-mutation-fence',0)>>32)&4294967295)
 and l.objid::bigint=(hashtextextended('memphis-zoo-application-mutation-fence',0)&4294967295)) fence_held`;
// No route, signer, production mode or database constructor. The existing
// release caller already owns this exact isolated transaction and all locks.
export async function prepareIsolatedReleaseDataPreservation({client,backendRoot,sourceCatalog,plan,verifiedArchive}){
 const refuse=()=>{throw Object.assign(new Error('Exact isolated release-preservation transaction owner required.'),{code:'ISOLATED_PRESERVATION_OWNER_REQUIRED'});};
 const owner=()=>{
  if(!client||Object.getPrototypeOf(client)!==Client.prototype||Object.hasOwn(client,'query')||Client.prototype.query!==originalQuery
   ||client._connected!==true||client._ending!==false||client._txStatus!=='T'||client.readyForQuery!==true
   ||!['127.0.0.1','::1'].includes(client.connectionParameters.host)
   ||process.env.GITHUB_ACTIONS!=='true'||!/^\d+$/.test(process.env.GITHUB_RUN_ID||''))refuse();
 };
 owner();const query=async(sql,args=[])=>{owner();const r=await Reflect.apply(originalQuery,client,[sql,args]);owner();return r;};
 const {manifest,tables,assertCurrent}=readOriginal217PreservationScope({backendRoot,verifiedArchive});
 assert.equal(fingerprintSchemaCatalog(sourceCatalog).fingerprint,manifest.source_catalog_fingerprint);
 assert.deepEqual(sourceCatalog.tables.map(t=>t.schema_name+'.'+t.table_name).sort(),manifest.tables.map(tableKey).sort());
 validateOriginal235PreservationPlan(backendRoot,plan);
 const profile=(await query(PROFILE)).rows[0];
 if(profile.actor!=='postgres'||profile.original_actor!=='postgres'||profile.database_owner!=='postgres'
  ||profile.superuser!==false||profile.bypassrls!==true||profile.read_only!=='off'||profile.isolation!=='serializable'
  ||profile.replication!=='origin'||profile.cron_active!=='off'||profile.fence_held!==true
  ||profile.database!=='mz_schema_rebuild_'+process.env.GITHUB_RUN_ID||profile.cron_database!==profile.database)refuse();
 // Read locks use only existing SELECT authority. No role/owner/grant change.
 const nonpublic=tables.filter(t=>t.schema!=='public');
 const relationCensus=(await query(`select n.nspname schema,c.relname name,c.relkind::text kind,c.relispartition,
  has_schema_privilege(current_user,n.oid,'USAGE') usage,has_table_privilege(current_user,c.oid,'SELECT') readable
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in('public','auth','storage','custodial_release_identity') and c.relkind in('r','p','f')`)).rows;
 assert.deepEqual(relationCensus.map(tableKey).sort(),tables.map(tableKey).sort());
 for(const t of relationCensus){assert.equal(t.kind,'r');assert.equal(t.relispartition,false);
  assert.equal(t.usage,true,'Existing namespace USAGE required for '+tableKey(t));
  assert.equal(t.readable,true,'Existing SELECT required for '+tableKey(t));}
 await query('lock table '+nonpublic.map(t=>'only '+target(t)).join(',')+' in access share mode');
 const collision=(await query("select to_regclass('pg_temp.custodial_release_preservation_before') is not null or to_regclass('pg_temp.custodial_release_preservation_events') is not null occupied")).rows[0];assert.equal(collision.occupied,false);
 const metadata=(await query(`select c.oid::text relation_oid,n.nspname schema,c.relname name,a.attname column_name,a.attnum,
 a.atttypid::text type_oid,a.atttypmod,a.attcollation::text collation_oid,
 exists(select 1 from pg_locks l where l.pid=pg_backend_pid() and l.relation=c.oid and l.granted and l.mode=CASE WHEN n.nspname='public' THEN 'AccessExclusiveLock' ELSE 'AccessShareLock' END) locked
 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
 where n.nspname in('public','auth','storage') and c.relkind='r' and a.attnum>0 and not a.attisdropped order by n.nspname,c.relname,a.attnum`)).rows;
 const census=()=>metadata.filter(r=>tables.some(t=>t.schema===r.schema&&t.name===r.name));
 for(const t of tables){const rows=census().filter(r=>r.schema===t.schema&&r.name===t.name);assert.deepEqual(rows.map(r=>r.column_name),t.columns);assert.ok(rows.every(r=>r.locked===true));}
 await query('create temporary table custodial_release_preservation_before(relation text not null,image text collate pg_catalog."C" not null) on commit drop');
 // Native JSON here is only the precise Event CTE's own archive representation.
 // General business rows use the lossless all-fields-as-TEXT projection below.
 await query(`create temporary table custodial_release_preservation_events on commit drop as
 select e.id,to_jsonb(e) prior_record,((e.status='SCHEDULED' and (e.needs_review or e.event_scope='UNKNOWN')) is true) eligible,
 null::jsonb expected_record,null::jsonb current_record
 from only public.events_app_events e`);
 const captureClock=(await query('select clock_timestamp()::text at')).rows[0].at;
 async function textProfile(work){
  const saved=(await query('select '+NATIVE_TEXT_PRESERVATION_SETTINGS.map(([key])=>`current_setting(${literal(key)}) ${ident(key)}`).join(','))).rows[0];
  try{for(const [key,value]of NATIVE_TEXT_PRESERVATION_SETTINGS)await query('select set_config($1,$2,true)',[key,value]);return await work();}
  finally{for(const [key]of NATIVE_TEXT_PRESERVATION_SETTINGS)await query('select set_config($1,$2,true)',[key,saved[key]]);}
 }
 await textProfile(async()=>{for(const t of tables){if(t.schema==='public'&&t.name==='custodial_release_authority_restore_inventory')continue;
  await query(`insert into pg_temp.custodial_release_preservation_before(relation,image) select ${literal(tableKey(t))},${nativeTextColumnProjection(t.columns,'r')} from only ${target(t)} r`);
 }});
 let verified=false;
 return Object.freeze({async verify(){
  assert.equal(verified,false,'one existing transaction, no recapture/retry');verified=true;
  assertCurrent();const nowProfile=(await query(PROFILE)).rows[0];assert.deepEqual(nowProfile,profile,'same unchanged owner/profile/transaction/fence required');
  const originalEventColumns=manifest.tables.find(t=>t.name==='events_app_events').columns;
  const eventColumns=originalEventColumns.map(c=>'e.'+ident(c)).join(',');
  const changedEventFields="array['status','event_scope','needs_review','primary_venue_id','venue_ids','coverage_location_ids','staffing_area_ids','source_location_text','display_location','revision','event_timezone','updated_at']";
  // The canonical history JSON is sampled in the unchanged Source timezone.
  // Native TEXT comparisons are separately rendered under the restore profile.
  // These writes affect only this verifier's two disposable TEMP snapshots.
  await query(`update pg_temp.custodial_release_preservation_events b set expected_record=b.prior_record||jsonb_build_object('status','NEEDS_REVIEW','event_scope','UNKNOWN','needs_review',true,'primary_venue_id',null,
    'venue_ids','[]'::jsonb,'coverage_location_ids','[]'::jsonb,'staffing_area_ids','[]'::jsonb,
    'source_location_text',coalesce(nullif(btrim(b.prior_record->>'source_location_text'),''),nullif(btrim(b.prior_record->>'display_location'),'Needs Review')),
    'display_location','Needs Review','revision',coalesce((b.prior_record->>'revision')::integer,1)+1,
    'event_timezone',coalesce(nullif(btrim(b.prior_record->>'event_timezone'),''),'America/Chicago'),
    'updated_at',transaction_timestamp())`);
  await query(`update pg_temp.custodial_release_preservation_events b set current_record=to_jsonb(q)
   from only public.events_app_events e cross join lateral(select ${eventColumns}) q where e.id=b.id`);
  const eventResult=await textProfile(async()=>(await query(`with expected as materialized(select b.*,p.image prior_image
   from pg_temp.custodial_release_preservation_events b join pg_temp.custodial_release_preservation_before p
    on p.relation='public.events_app_events' and p.image::json->>'id'=b.id::text),
   actual as materialized(select e.id,b.current_record,${nativeTextColumnProjection(originalEventColumns,'e')} current_image
    from only public.events_app_events e left join pg_temp.custodial_release_preservation_events b on b.id=e.id),
   new_history as materialized(select h.* from only public.events_app_event_history h where not exists(
    select 1 from pg_temp.custodial_release_preservation_before b where b.relation='public.events_app_event_history' and b.image::json->>'id'=h.id::text)),
   matching as materialized(select b.id,h.id history_id from expected b join actual a using(id) join new_history h on h.event_id=b.id
    where b.eligible and a.current_record=b.expected_record and h.action='review_isolation' and h.actor='system migration'
    and h.reason='Legacy unresolved event moved out of scheduled delivery without deleting original evidence.'
    and h.previous_record=b.prior_record and h.new_record=a.current_record and h.actor_manager_id is null
    and h.created_at >= $1::timestamptz and h.created_at<=clock_timestamp())
   select (select count(*)::text from expected where eligible) eligible,
    (select count(*)::text from expected b full join actual a using(id) where b.id is null or a.id is null) changed_id_set,
    (select count(*)::text from expected b join actual a using(id) where not b.eligible and a.current_image is distinct from b.prior_image) unrelated_changed,
    (select count(*)::text from expected b join actual a using(id) where b.eligible
      and (a.current_image::jsonb-${changedEventFields}) is distinct from (b.prior_image::jsonb-${changedEventFields})) unrelated_column_changed,
    (select count(*)::text from expected b join actual a using(id) where b.eligible and a.current_record is distinct from b.expected_record) invalid_transformation,
    (select count(*)::text from expected b where b.eligible and (select count(*) from matching m where m.id=b.id)<>1) missing_exact_history,
    (select count(*)::text from new_history h where (select count(*) from matching m where m.history_id=h.id)<>1) unexpected_new_history,
    (select ${hashes('e')} from (select prior_image image from expected)e) before_sha256,
    (select ${hashes('a')} from (select current_image image from actual)a) after_sha256`,[captureClock])).rows[0]);
  for(const key of ['changed_id_set','unrelated_changed','unrelated_column_changed','invalid_transformation','missing_exact_history','unexpected_new_history'])assert.equal(eventResult[key],'0',key);
  const constants=SETTINGS.map(([key,value,description])=>`(${literal(key)},${literal(value)}::jsonb,${literal(description)})`).join(',');
  const settingsResult=(await query(`with expected(key,value,description) as(values${constants})
   select count(*) filter(where s.setting_key is null or s.setting_value is distinct from e.value or s.description is distinct from e.description
    or not(s.updated_at=transaction_timestamp() or s.updated_at between $1::timestamptz and clock_timestamp()))::text invalid
   from expected e left join public.system_settings s on s.setting_key=e.key`,[captureClock])).rows[0];assert.equal(settingsResult.invalid,'0');
  const settingsTable=manifest.tables.find(t=>t.name==='system_settings');
  const settingsKeys=SETTINGS.map(x=>literal(x[0])).join(',');
  const settingsDigest=await textProfile(async()=>(await query(`with expected as materialized(
   select image from pg_temp.custodial_release_preservation_before where relation='public.system_settings'
    and image::json->>'setting_key'=any(array[${settingsKeys}]::text[])),
   actual as materialized(select ${nativeTextColumnProjection(settingsTable.columns,'r')} collate pg_catalog."C" image
    from only public.system_settings r where r.setting_key=any(array[${settingsKeys}]::text[]))
   select (select count(*)::text from expected) before_rows,(select count(*)::text from actual) after_rows,
    (select ${hashes('e')} from expected e) before_sha256,(select ${hashes('a')} from actual a) after_sha256`)).rows[0]);
  assert.equal(settingsDigest.after_rows,'4');
  const relay=(await query(`select count(*)::text rows,count(*) filter(where singleton and paused and pause_reason='v2_preflight_required'
   and not exists(select 1 from jsonb_each(to_jsonb(c)-array['singleton','paused','pause_reason','updated_at']) x where x.value<>'null'::jsonb))::text expected
   from public.system_feedback_email_relay_config c`)).rows[0];assert.deepEqual(relay,{rows:'1',expected:'1'});
  for(const table of ['system_feedback_email_intents','system_feedback_email_attempts','system_feedback_email_receipts','system_feedback_email_relay_requests'])assert.equal((await query('select count(*)::text n from public.'+ident(table))).rows[0].n,'0','no migration-time relay data/send evidence');
  const results=[];
  await textProfile(async()=>{for(const t of tables){if(t.schema==='public'&&['custodial_release_authority_restore_inventory','events_app_events'].includes(t.name))continue;
   const row=(await query(compileOriginalTableComparison(t))).rows[0];assert.equal(row.missing_rows,'0',tableKey(t));
   if(!(t.schema==='public'&&t.name==='events_app_event_history'))assert.equal(row.extra_rows,'0',tableKey(t));
   results.push({table:tableKey(t),...row});
  }});
  const currentColumns=(await query(`select c.oid::text relation_oid,n.nspname schema,c.relname name,a.attname column_name,a.attnum,
   a.atttypid::text type_oid,a.atttypmod,a.attcollation::text collation_oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
   join pg_attribute a on a.attrelid=c.oid where n.nspname in('public','auth','storage') and c.relkind='r' and a.attnum>0 and not a.attisdropped`)).rows;
  for(const old of census()){const now=currentColumns.find(x=>x.schema===old.schema&&x.name===old.name&&x.column_name===old.column_name);assert.ok(now);const {locked,...before}=old;assert.deepEqual(now,before,'original relation/column/type identity changed');}
  assertCurrent();
  return Object.freeze({schema:'custodial.isolated-release-data-preservation.v1',scope:'ISOLATED_EXISTING157_TRANSACTION_DATA_PROOF',original_tables:217,original_public_tables:182,ordinary_public_tables:178,nonpublic_tables:35,nonpublic_exact_native_text:true,
   events:eventResult,four_settings_constants_verified:true,four_settings:settingsDigest,relay_paused_no_migration_time_send_evidence:true,
   recovery_metadata:'DELIBERATE_CANONICAL_GUARDED_REPAIRS_NOT_BUSINESS_EXEMPTION',tables:results,
   raw_values_exported:false,production_authorized:false,full_candidate_admission:false});
 }});
}
