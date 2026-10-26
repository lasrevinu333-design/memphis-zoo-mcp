// Fresh-target Source initialization for the immutable-original recovery flow.
// The caller owns its normal authenticated connection, transaction and BOTH
// global fences. This function never begins, commits, resumes or retries one.
import assert from 'node:assert/strict';
import {types,isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {prepareVerifiedImmutableBootstrapSource,assertVerifiedImmutableBootstrapSource} from './immutable-private-source-bootstrap.mjs';
import {reconcileVerifiedImmutableBootstrapAcls} from './immutable-private-source-acl.mjs';
import {postgresJsonTextLineEncoding,postgresTextColumnsLineEncoding} from './disaster-recovery-archive.mjs';
import {restoreCronJobs,verifyRestoredCronJobs,normalizedCronJobs} from './disaster-recovery-cron.mjs';

const Client=pg.Client,nativeQuery=Client.prototype.query,attempted=new WeakSet();
const sha=value=>createHash('sha256').update(value).digest('hex');
const schemas=['public','auth','storage','custodial_release_identity'];
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const native=client=>client&&typeof client==='object'&&!types.isProxy(client)
 &&Object.getPrototypeOf(client)===Client.prototype&&!Object.hasOwn(client,'query')&&Client.prototype.query===nativeQuery;
const contextSql=`select current_user actor,session_user session_actor,current_database() database,
 (select oid::text from pg_catalog.pg_database where datname=current_database()) database_oid,
 pg_backend_pid() backend_pid,txid_current()::text transaction_id,
 current_setting('transaction_read_only') readonly,current_setting('session_replication_role') replication,
 current_setting('row_security') row_security,
 current_setting('search_path') search_path,
 (select pg_get_userbyid(datdba) from pg_catalog.pg_database where datname=current_database()) database_owner,
 (select pg_get_userbyid(nspowner) from pg_catalog.pg_namespace where nspname='custodial_dr') dr_owner,
 (select count(*)::int from pg_catalog.pg_class where oid in(
  to_regclass('custodial_dr.restore_control'),to_regclass('custodial_dr.restore_manifests'),
  to_regclass('custodial_dr.application_mutation_leases'),
  to_regclass('custodial_release_identity.group_original_creations'),
  to_regclass('custodial_release_identity.employee_message_original_outcomes'))
  and relkind='r' and relowner=(select oid from pg_catalog.pg_roles where rolname=current_user)) original_owned_relations,
 (select count(*)::int from custodial_dr.application_mutation_leases) active_leases,
 (select count(*)::int from unnest(array['memphis-zoo-application-mutation-admission','memphis-zoo-application-mutation-fence']) f(name)
  where exists(select 1 from pg_catalog.pg_locks l where l.locktype='advisory' and l.pid=pg_backend_pid()
   and l.database=(select oid from pg_catalog.pg_database where datname=current_database()) and l.granted and l.mode='ExclusiveLock'
   and l.classid=((hashtextextended(f.name,0)>>32)&4294967295)::oid
   and l.objid=(hashtextextended(f.name,0)&4294967295)::oid and l.objsubid=1)) held_fences`;

function unwrapSource(statement){
 if(statement.sourcePath==='proposals/immutable-original-employee-push-authority-restore.sql'){
  // This reviewed DO-only Source must stay inside the original transaction.
  assert.equal(statement.sourceSha256,'2b8c5dad21a56d6132688a998ab3ae3df78584686c8b2f4fdd7baf7bbafd527d');
  assert.equal(sha(statement.sql),statement.sourceSha256);
  return statement.sql;
 }
 if(statement.sourcePath==='proposals/immutable-original-manager-push-restore.sql'){
  // This one newly admitted wrapper is fixed program Source, never caller SQL.
  assert.equal(statement.sourceSha256,'2a9dd3a1050d0f7e7714abdd8feeb4259eea54287c68ffacd787b9072a9f7f9d');
  assert.equal(sha(statement.sql),statement.sourceSha256);
 }
 const outer=['proposals/immutable-private-owner-context.sql','proposals/immutable-original-employee-restore.sql',
  'proposals/immutable-original-device-boundary-restore.sql','proposals/immutable-original-authority-reconciliation.sql',
  'proposals/immutable-original-manager-push-restore.sql'].includes(statement.sourcePath);
 if(!outer)return statement.sql;
 const begin=statement.sourcePath==='proposals/immutable-private-owner-context.sql'?'\nBEGIN;':'\nBEGIN;\n';
 assert.equal(statement.sql.split(begin).length,2);assert.match(statement.sql,/\nCOMMIT;\s*$/);
 // Only the fixed Source's declared outer wrapper is omitted. Its owner,
 // predecessor, RLS/ACL, ALWAYS and currentness checks are not rewritten.
 return statement.sql.replace(begin,'\n').replace(/\nCOMMIT;\s*$/,'\n');
}

export async function initializeVerifiedImmutableFreshSource({db,verifiedArchive}={}){
 if(!native(db)||attempted.has(db))throw new Error('Original fresh Source initializer is unavailable.');
 attempted.add(db); // No second attempt on a connection with an uncertain write.
 const source=await prepareVerifiedImmutableBootstrapSource(verifiedArchive);
 let originalContext;
 const checkSource=()=>{assert.ok(native(db));assertVerifiedImmutableBootstrapSource(source,verifiedArchive);};
 const readContext=async()=>{
  checkSource();const result=await Reflect.apply(nativeQuery,db,[contextSql]);checkSource();
  assert.equal(result.rowCount,1);const row=result.rows[0];
  assert.equal(row.actor,'supabase_admin');assert.equal(row.session_actor,row.actor);assert.equal(row.readonly,'off');
  assert.equal(row.replication,'origin');assert.equal(row.row_security,'off');assert.equal(row.search_path,'pg_catalog');
  assert.equal(row.database_owner,'postgres');assert.equal(row.dr_owner,'postgres');
  assert.equal(row.original_owned_relations,5);assert.equal(row.active_leases,0);assert.equal(row.held_fences,2);
  assert.equal(typeof row.database_oid,'string');assert.match(row.database_oid,/^[1-9][0-9]{0,9}(?![\s\S])/);
  assert.ok(BigInt(row.database_oid)<=4294967295n);assert.ok(Number.isInteger(row.backend_pid)&&row.backend_pid>0);
  assert.equal(typeof row.transaction_id,'string');assert.match(row.transaction_id,/^[1-9][0-9]{0,18}(?![\s\S])/);
  if(originalContext)assert.deepEqual(row,originalContext,'Original Source owner/transaction/fence changed');
  return row;
 };
 originalContext=Object.freeze(await readContext());
 await readContext(); // Autocommit has a different xid; refuse before effects.
 const query=async(sql,params=[])=>{await readContext();checkSource();const result=await Reflect.apply(nativeQuery,db,[sql,params]);
  checkSource();await readContext();return result;};
 const inventory=name=>JSON.parse(source.inventory['inventory/'+name]);
 // Only the two fixed original metadata members, selected by the same signed
 // catalog. These helpers return DATA and never create the later import ctx.
 const metadataCatalog=inventory('table-catalog.json');
 const metadataRecord=(name,expression)=>{
  assert.ok(['release_deployment_manifest','custodial_release_authority_restore_inventory'].includes(name));
  assert.ok(['$1::json','e.image'].includes(expression));
  const matches=metadataCatalog.filter(table=>table.schema_name==='public'&&table.table_name===name);
  assert.equal(matches.length,1);
  const encoding=matches[0].data_encoding;
  assert.ok(encoding===postgresJsonTextLineEncoding||encoding===postgresTextColumnsLineEncoding);
  return encoding===postgresTextColumnsLineEncoding
   ?`custodial_dr.immutable_import_text_record(null::public.${name},(${expression})::text)`
   :`pg_catalog.json_populate_record(null::public.${name},${expression})`;
 };
 const relations=inventory('original-relations.json');assert.ok(Array.isArray(relations)&&relations.length>0);
 const actual=(await query(`select n.nspname schema_name,c.relname table_name,c.relkind::text relation_kind,c.relispartition is_partition,
  pg_get_userbyid(c.relowner) owner_name,c.relrowsecurity,c.relforcerowsecurity
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname=any($1::text[]) and c.relkind in('r','p','f') order by n.nspname,c.relname`,[schemas])).rows;
 assert.deepEqual(actual,relations,'Fresh Source target has a missing, extra or changed original relation');
 const counterParallelSafety=await query(`select proparallel::text counter_parallel_safety
  from pg_catalog.pg_proc where oid='pg_catalog.txid_current()'::pg_catalog.regprocedure`);
 assert.equal(counterParallelSafety.rowCount,1);
 assert.deepEqual(counterParallelSafety.rows,[{counter_parallel_safety:'u'}],
  'Original transaction-bound counters must execute outside parallel workers');
 const countParameters=[],countNames=new Set();
 const countParts=relations.map((row,index)=>{
  assert.ok(schemas.includes(row.schema_name)&&row.relation_kind==='r'&&row.is_partition===false);
  assert.equal(typeof row.table_name,'string');assert.ok(row.table_name.length>0&&!row.table_name.includes('\0'));
  assert.ok(Buffer.byteLength(row.table_name,'utf8')<=63);
  assert.equal(Buffer.from(row.table_name,'utf8').toString('utf8'),row.table_name);
  const name=JSON.stringify([row.schema_name,row.table_name]);
  assert.ok(!countNames.has(name),'Duplicate original relation count');countNames.add(name);
  countParameters.push(row.schema_name,row.table_name);
  // Actual xid is both a currentness witness and the builtin parallel-unsafe
  // boundary. No settings or locks are changed to force serial execution.
  return 'select $'+(countParameters.length-1)+'::text schema_name,$'+countParameters.length
   +'::text table_name,count(*)::text row_count,pg_catalog.txid_current()::text transaction_id,'
   +index+'::integer original_ordinal from ONLY '+quote(row.schema_name)+'.'+quote(row.table_name);
 });
 // row_security=off still refuses hidden-row reads. One guarded await counts
 // EVERY exact original table; zero is never inferred from filtered rows.
 const counts=await query('select schema_name,table_name,row_count,transaction_id from ('
  +countParts.join(' UNION ALL ')+') original_counts order by original_ordinal',countParameters);
 assert.equal(counts.rowCount,relations.length);assert.ok(Array.isArray(counts.rows));
 assert.equal(counts.rows.length,relations.length);
 for(let index=0;index<relations.length;index++){
  const row=counts.rows[index];assert.ok(row&&typeof row==='object'&&!types.isProxy(row)
   &&Object.getPrototypeOf(row)===Object.prototype,'Closed original table count required');
  const descriptors=Object.getOwnPropertyDescriptors(row),keys=['schema_name','table_name','row_count','transaction_id'];
  assert.deepEqual(Reflect.ownKeys(descriptors).sort(),keys.slice().sort());
  const values=Object.fromEntries(keys.map(key=>{
   const field=descriptors[key];assert.ok(Object.hasOwn(field,'value')&&field.enumerable,'Count accessors refused');
   return [key,field.value];
  }));
  assert.deepEqual({schema_name:values.schema_name,table_name:values.table_name,transaction_id:values.transaction_id},
   {schema_name:relations[index].schema_name,table_name:relations[index].table_name,transaction_id:originalContext.transaction_id},
   'Fresh Source count membership/order/original transaction differs');
  assert.equal(values.row_count,'0','Fresh Source target contains original application DATA');
 }
 const before=(await query(`select (select count(*)::int from custodial_dr.restore_control) controls,
  (select count(*)::int from custodial_dr.restore_manifests) manifests,
  (select count(*)::int from custodial_dr.restore_events) events,
  (select count(*)::int from supabase_migrations.schema_migrations) migrations,
  (select count(*)::int from cron.job) jobs,
  to_regclass('custodial_dr.immutable_private_import_context')::text existing_import`)).rows[0];
 assert.deepEqual(before,{controls:0,manifests:0,events:0,migrations:0,jobs:0,existing_import:null});
 await query('insert into custodial_dr.restore_control(singleton) values(true)');
 const acl=await reconcileVerifiedImmutableBootstrapAcls(db,source,verifiedArchive);await readContext();
 const recipeIdentities=Object.freeze(source.recipes.map(recipe=>recipe.identity));
 assert.equal(recipeIdentities.length,25);assert.equal(new Set(recipeIdentities).size,25);
 // One fresh, ordered native catalog read per side, never a cached verdict.
 // LEFT JOIN retains a missing overload as a refused row rather than omitting it.
 const readRecipeCatalog=async()=>{
  const result=await query(`select i.ordinality::int ordinal,p.oid::regprocedure::text identity,
   pg_get_functiondef(p.oid) definition,p.prosrc,pg_get_userbyid(p.proowner) owner
   from unnest($1::text[]) with ordinality i(identity,ordinality)
   left join pg_catalog.pg_proc p on p.oid=to_regprocedure(i.identity) and p.prokind='f'
   order by i.ordinality`,[recipeIdentities]);
  assert.equal(result.rowCount,25);assert.equal(result.rows.length,25);
  assert.equal(new Set(result.rows.map(row=>row.identity)).size,25);
  for(const [index,row] of result.rows.entries()){
   assert.deepEqual(Object.keys(row).sort(),['definition','identity','ordinal','owner','prosrc']);
   assert.equal(row.ordinal,index+1);assert.equal(row.identity,recipeIdentities[index]);
   assert.equal(typeof row.definition,'string');assert.equal(typeof row.prosrc,'string');
  }
  return result.rows;
 };
 const originalRecipes=await readRecipeCatalog();
 for(const [index,recipe] of source.recipes.entries()){
  const original=originalRecipes[index];assert.equal(original.owner,'supabase_admin');
  assert.equal(original.definition,recipe.before);assert.equal(sha(original.prosrc),recipe.beforeBodyHash);
 }
 for(const statement of source.statements)await query(unwrapSource(statement));
 // The base proposal installs its original INSERT-only guard. Apply ONLY
 // the pinned complete successor recipe after the private six-effect scope
 // exists and before the first original import seals target_shape. Existing
 // owner/ACL/definer/config and the normal fence remain unchanged.
 const applicationGuard=source.recipes.find(recipe=>recipe.identity==='custodial_dr.guard_application_mutation()');
 assert.ok(applicationGuard);await query(applicationGuard.after);
 const installedRecipes=await readRecipeCatalog();
 for(const [index,recipe] of source.recipes.entries()){
  const installed=installedRecipes[index];assert.equal(installed.owner,'supabase_admin');
  assert.equal(installed.definition,recipe.after);assert.equal(sha(installed.prosrc),recipe.afterBodyHash);
 }
 await query('select custodial_dr.immutable_import_owner_fence()');
 // V2's Source-only precheck cannot normalize native columns in JavaScript.
 // Compare the COMPLETE actual decoded row before any bootstrap DATA write.
 // This JSON view verifies release metadata only; exact typed DATA remains
 // the original text member, restored/compared through the native v2 codec.
 if(metadataCatalog.find(table=>table.schema_name==='public'&&table.table_name==='release_deployment_manifest').data_encoding===postgresTextColumnsLineEncoding){
  const observed=(await query(`select pg_catalog.row_to_json(r)::text original_row
   from ${metadataRecord('release_deployment_manifest','$1::json')} r`,[source.releaseRows[0]])).rows;
  assert.equal(observed.length,1);
  assert.deepEqual(JSON.parse(observed[0].original_row),source.sourceBinding.source_identity.release);
 }
 const ledgerRaw=source.inventory['inventory/migration-ledger.json'],ledger=inventory('migration-ledger.json');
 assert.ok(Array.isArray(ledger));
 const migrations=await query(`insert into supabase_migrations.schema_migrations(version,name,statements)
  select r.version,r.name,r.statements
  from pg_catalog.json_array_elements($1::json) with ordinality e(image,ordinality)
  cross join lateral pg_catalog.json_populate_record(null::supabase_migrations.schema_migrations,e.image) r
  order by e.ordinality`,[ledgerRaw]);
 assert.equal(migrations.rowCount,ledger.length);
 // Restore signed cron rows AND their transactional default counter before
 // the owning caller pauses the original generation. The guarded query-only
 // port keeps Source/native owner/xid/two-fence checks around EVERY await;
 // it neither shadows db.query nor grants later effect authority.
 const cronRaw=source.inventory['inventory/cron-jobs.json'],cron=inventory('cron-jobs.json');assert.ok(Array.isArray(cron));
 const sourceDatabase=source.sourceBinding.summary.database_snapshot?.database_name;
 assert.equal(typeof sourceDatabase,'string');assert.ok(sourceDatabase.length>0&&!sourceDatabase.includes('\0'));
 assert.ok(Buffer.byteLength(sourceDatabase,'utf8')<=63);
 assert.equal(Buffer.from(sourceDatabase,'utf8').toString('utf8'),sourceDatabase);
 const cronControl=(await query(`select authority_generation::text generation,mutations_paused,state,restore_id
  from custodial_dr.restore_control where singleton`)).rows;
 assert.deepEqual(cronControl,[{generation:'0',mutations_paused:false,state:'READY',restore_id:null}]);
 const cronPort=Object.freeze({query});
 const restoredCron=await restoreCronJobs(cronPort,cron,{sourceDatabase});
 checkSource();await readContext();
 assert.equal(restoredCron.target_database,originalContext.database);
 const expectedCron=normalizedCronJobs(cron,{sourceDatabase,targetDatabase:originalContext.database});
 assert.ok(isDeepStrictEqual(restoredCron.expected,expectedCron),'Original mapped cron inventory differs');
 assert.equal(restoredCron.differences.length,0,'Original restored cron state differs');
 const verifiedCron=await verifyRestoredCronJobs(cronPort,cron,{sourceDatabase});
 checkSource();await readContext();
 assert.equal(verifiedCron.target_database,originalContext.database);
 assert.ok(isDeepStrictEqual(verifiedCron.expected,expectedCron),'Original mapped cron inventory differs');
 assert.equal(verifiedCron.differences.length,0,'Original verified cron state differs');
 const cronExpectedRaw=JSON.stringify(expectedCron); // Closed TEXT/boolean/safe port fields; BIGINT IDs remain TEXT.
 await query(`insert into public.release_deployment_manifest select * from ${metadataRecord('release_deployment_manifest','$1::json')}`,[source.releaseRows[0]]);
 const expected=`with original as(select value image,ordinality from json_array_elements($1::json) with ordinality),
  expected as(select case when image->>'object_kind'='function' and $2::jsonb ? (image->>'object_identity')
   then jsonb_set(jsonb_set(image::jsonb,'{definition_sql}',$2::jsonb->(image->>'object_identity')->'definition_sql'),
    '{definition_sha256}',$2::jsonb->(image->>'object_identity')->'definition_sha256')::json
   else image end image,ordinality from original)`;
 const args=['['+source.registryRows.join(',')+']',JSON.stringify(source.registrySource)];
 const inserted=await query(expected+` insert into public.custodial_release_authority_restore_inventory
  select r.* from expected e cross join lateral ${metadataRecord('custodial_release_authority_restore_inventory','e.image')} r order by e.ordinality`,args);
 assert.equal(inserted.rowCount,source.registryRows.length);
 const compared=(await query(expected+` select count(*)::int n from expected e
  left join public.custodial_release_authority_restore_inventory t on t.inventory_id=(e.image->>'inventory_id')::uuid
  where t.inventory_id is null or to_jsonb(t) is distinct from to_jsonb(${metadataRecord('custodial_release_authority_restore_inventory','e.image')})`,args)).rows;
 assert.deepEqual(compared,[{n:0}]);
 const metadataCounts=(await query(`select
  (select count(*)::int from public.release_deployment_manifest) releases,
  (select count(*)::int from public.custodial_release_authority_restore_inventory) registry,
  (select count(*)::int from cron.job) jobs`)).rows[0];
 assert.deepEqual(metadataCounts,{releases:1,registry:source.registryRows.length,jobs:cron.length});
 const releaseRows=(await query(`select count(*)::int n from public.release_deployment_manifest t
  where to_jsonb(t)=to_jsonb(${metadataRecord('release_deployment_manifest','$1::json')})`,[source.releaseRows[0]])).rows;
 assert.deepEqual(releaseRows,[{n:1}]);
 const restoredLedger=(await query(`select version::text,name::text,statements from supabase_migrations.schema_migrations
  order by array_position($1::text[],version::text)`,[ledger.map(row=>row.version)])).rows;
 assert.deepEqual(restoredLedger,ledger);
 const cronCompared=(await query(`with expected as(select to_jsonb(r) image from json_array_elements($1::json) e(image)
  cross join lateral json_populate_record(null::cron.job,e.image) r),actual as(select to_jsonb(j) image from cron.job j),
  mismatch as((select image from expected except all select image from actual) union all
    (select image from actual except all select image from expected)) select count(*)::int n from mismatch`,[cronExpectedRaw])).rows;
 assert.deepEqual(cronCompared,[{n:0}]);
 const control=(await query(`select authority_generation::text generation,mutations_paused,state,restore_id
  from custodial_dr.restore_control where singleton`)).rows;
 assert.deepEqual(control,[{generation:'0',mutations_paused:false,state:'READY',restore_id:null}]);
 // The exact two newly pinned Source statements extend, rather than relax,
 // the former nine-statement installer. Observe all six private identities
 // on the actual native target before reporting the initialized contract.
 const authority=(await query(`select p.oid::regprocedure::text identity,pg_get_userbyid(p.proowner) owner,
  p.prosecdef,p.proparallel,p.proconfig,
  exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where a.grantee<>p.proowner) nonowner_execute
  from pg_catalog.pg_proc p where p.oid in(
   'custodial_dr.immutable_original_authority_scope_guard()'::regprocedure,
   'custodial_dr.immutable_original_authority_scope_shape()'::regprocedure,
   'custodial_dr.immutable_original_authority_snapshot(bigint)'::regprocedure,
   'custodial_dr.immutable_original_authority_guard_matches(oid,text)'::regprocedure,
   'custodial_dr.reconcile_committed_immutable_original_authority(oid,integer,bigint,uuid,bigint,text,bigint)'::regprocedure,
   'custodial_dr.read_committed_immutable_original_authority(oid,integer,bigint,uuid,bigint,text,bigint)'::regprocedure)
  order by p.oid::regprocedure::text`)).rows;
 assert.equal(authority.length,6);assert.equal(new Set(authority.map(row=>row.identity)).size,6);
 for(const row of authority){assert.equal(row.owner,originalContext.actor);assert.equal(row.prosecdef,false);
  assert.equal(row.proparallel,'u');assert.deepEqual(row.proconfig,['search_path=pg_catalog, pg_temp']);assert.equal(row.nonowner_execute,false);}
 assert.equal(source.statements.length,13);
 checkSource();await readContext();
 return Object.freeze({schema:'custodial.immutable-private-source-initialized.v1',database_oid:originalContext.database_oid,
  backend_pid:originalContext.backend_pid,transaction_id:originalContext.transaction_id,guard_recipes:source.recipes.length,
  source_statements:source.statements.length,authority_scope_functions:authority.length,registry_rows:source.registryRows.length,acl,
  initialized_source_only:true,transaction_authority:false,restore_complete:false,admission_resumed:false});
}
