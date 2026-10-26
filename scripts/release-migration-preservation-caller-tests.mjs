import assert from 'node:assert/strict';
import {runTargetCaptureStep,AUTHORITY_IDENTITY158_SOURCE_FILE,AUTHORITY_IDENTITY158_CANONICAL_SHA256,AUTHORITY_IDENTITY158_FORWARD_SHA256,AUTHORITY_IDENTITY158_METADATA_SQL} from './release-migration-target-refusal.mjs';
import {readFileSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';

// Execute the complete maintained caller with recording dependencies. No SQL,
// Docker, keys, network, or database constructor from production is executed.
const original=readFileSync(new URL('./apply-release-migration-plan.mjs',import.meta.url),'utf8');
const executable=original.replace(/^#!.*\n/,'').replace(/^import\s[\s\S]*?;\s*$/gm,'')
 .replaceAll('import.meta.url',JSON.stringify(new URL('./apply-release-migration-plan.mjs',import.meta.url).href));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const stableJson=JSON.stringify;
const sha=v=>createHash('sha256').update(v).digest('hex');
const digest=v=>sha(stableJson(v));
let checks=0;
async function fixture({target=true,fail=null,length=160,rehearsal=true}={}){
 const events=[],logs=[],failError=Error('UNIT_'+fail),before={cron_jobs:[],tables:[{original:true}]},after={cron_jobs:[],tables:[{candidate:true}]};
 const ledger=[{version:'20250101000000',name:'original',statements:['ORIGINAL']}];
 const pending=Array.from({length},(_,i)=>{const version=String(20260101000000+i);return{order:i+1,file:version+'_unit.sql',source_migration_version:version,phase:'unit',sha256:'b'.repeat(64)};});
 const newLedger=[...ledger,...pending.map(x=>({version:x.source_migration_version,name:x.phase,statements:['begin;\nUNIT_'+x.order+'\ncommit;\n']}))];
 const counts=c=>Object.fromEntries(Object.entries(c).map(([k,v])=>[k,v.length]));
 const state={project_ref:'rqquvtjdmugpigbndmne',pending_migrations:pending,target:{pending_migration_count:length,production_ledger_count:length+1,source_migration_version:pending.at(-1).source_migration_version,canonical_source_schema_fingerprint:digest(after),expected_catalog_counts:counts(after)},observed_production:{catalog_privilege_fingerprint:digest(before),catalog_counts:counts(before),production_ledger_count:1,ledger_head:ledger[0].version,source_migration_name:'original',outlook_event_sync_table_present:false}};
 const env={SUPABASE_DB_URL:'postgres://postgres@127.0.0.1/mz_schema_rebuild_unit',SUPABASE_PROJECT_REF:state.project_ref,RELEASE_MIGRATION_CONFIRM_PROJECT_REF:state.project_ref,RELEASE_MIGRATION_NAMED_ACTOR:'UNIT_ACTOR',RELEASE_MIGRATION_APPLY:'true',RELEASE_MIGRATION_REHEARSAL:String(rehearsal),RELEASE_MIGRATION_TARGET_CAPTURE:String(target),RELEASE_MIGRATION_CANDIDATE_COMMIT:'c'.repeat(40),RELEASE_MIGRATION_CANDIDATE_TREE:'d'.repeat(40),RELEASE_MIGRATION_SOURCE_LEDGER_SHA256:digest(ledger),RUNNER_TEMP:'/UNIT'};
 let rolled=false,connected=false,catalogReads=0,ledgerReads=0,migrations=0;
 const capture={state,archive:{cleanup(){events.push('captureArchiveCleanup');}},source_ledger_sha256:digest(ledger),assertSourceCurrent(){events.push('sourceCurrent');},target:{unit:true},output:'/UNIT/receipt',archive_digest:'e'.repeat(64)};
 class Client{
  async connect(){events.push('connect');if(fail==='connect')throw failError;connected=true;}
  async end(){events.push('end');}
  async query(sql,args){
   assert.equal(connected,true,'no query can be queued before successful connect');const s=sql.trim();events.push(s);
   if(s==='rollback'){rolled=true;return{rows:[]};}
   if(s.includes('select current_user actor'))return{rows:[{actor:'postgres',original_actor:'postgres',database_owner:'postgres',superuser:false,bypassrls:true,cron_active:'off',cron_database:'unit',database_name:'unit'}]};
   if(s.startsWith('select format('))return{rows:[{table_name:'public.unit'}],rowCount:1};
   if(s==='select current_database() database_name')return{rows:[{database_name:'unit'}]};
   if(s==='select version::text,name::text,statements from supabase_migrations.schema_migrations order by version'){
    ledgerReads++;events.push('ledgerRead');let rows=rolled||ledgerReads===1?ledger:newLedger;
    if(fail==='ledger'&&!rolled&&ledgerReads>1)rows=rows.slice(0,-1);
    if(fail==='rollbackLedger'&&rolled)rows=[];
    return{rows,rowCount:rows.length};
   }
   if(s.startsWith("select to_regclass('public.events_app_outlook_sync')"))return{rows:[{present:false}]};
   if(s.startsWith('UNIT_')){migrations++;events.push('migration:'+migrations);if(fail==='migration'&&migrations===3)throw failError;return{rows:[]};}
   if(s.startsWith('insert into supabase_migrations.schema_migrations'))return{rows:[]};
   if(s.startsWith('begin ')||s.startsWith('set local ')||s.startsWith('select pg_advisory_xact_lock(')||s.startsWith('lock table ')||s.startsWith("select set_config('custodial.deployment_project_ref'"))return{rows:[]};
   if(s.includes('from pg_proc p join pg_namespace')||s.includes('from pg_class c join pg_namespace')||s.includes('select nspname schema_name'))return{rows:[]};
   if(s==='commit'){events.push('COMMITTED');return{rows:[]};}
   assert.fail('Unexpected caller query: '+s);
  }
 }
 const dependencies={assertReleaseWorkflowSource:()=>{events.push('targetSourcePreflight');},createHash,resolve,basename,pg:{Client},process:{env},console:{log:x=>{events.push('stdout');logs.push(JSON.parse(x));}},
  readFileSync:()=>JSON.stringify(state),stableJson,stableJsonFileSha256:digest,
  resolveReleaseMigrationSource:(_r,item)=>({sql:'begin;\nUNIT_'+item.order+'\ncommit;\n'}),releaseMigrationPlanIdentity:p=>p.map(x=>x.order),
  prepareTargetCapture:()=>capture,writeTargetCapture:(_p,value)=>{events.push('successReceipt');logs.push(value);},writeTargetCaptureRefusal:(_p,value)=>{events.push('refusalReceipt');logs.push(value);},
  runTargetCaptureStep:async({run,onRefusal})=>{try{return await run();}catch(e){onRefusal({unit:true});throw e;}},
  captureCatalogFromSnapshot:async()=>{catalogReads++;events.push('catalogRead');if(fail==='sourceCatalog'&&catalogReads===1)return after;if(rolled)return fail==='rollbackCatalog'?after:before;return catalogReads===1?before:after;},
  fingerprintSchemaCatalog:c=>({fingerprint:fail==='targetCatalog'&&c.tables[0].candidate===true?'0'.repeat(64):digest(c)}),
  openIsolatedPreservationArchive:()=>{events.push('openArchive');if(fail==='archive')throw failError;return{archive:{unitArchive:true},close(){events.push('preservationArchiveClose');}};},
  prepareIsolatedReleaseDataPreservation:async args=>{events.push('snapshot');assert.deepEqual(args.sourceCatalog,before);assert.equal(args.plan.length,160);assert.equal(args.verifiedArchive.unitArchive,true);if(fail==='snapshot')throw failError;return{verify:async()=>{events.push('verify');if(fail==='verify')throw failError;return{unitPreserved:true};}};},
  releaseMigrationAuthorizationBinding:()=>{},requireSigningKey:()=>{},verifyBinding:()=>false,validateAuthorizationRehearsalProvenance:()=>{},TASK_LOCAL_PROVENANCE_KIND:'unit',TASK_LOCAL_RUNNER_PATH:'unit'};
 let error;try{await new AsyncFunction(...Object.keys(dependencies),executable)(...Object.values(dependencies));}catch(e){error=e;}
 return{events,logs,error,migrations};
}
const before=(r,a,b)=>assert.ok(r.events.indexOf(a)>=0&&r.events.indexOf(a)<r.events.indexOf(b),a+' before '+b);
const absent=(r,...names)=>names.forEach(n=>assert.equal(r.events.includes(n),false,n+' absent'));
async function check(name,fn){await fn();checks++;}
await check('160 target capture snapshots and verifies within locks before postcatalog, rolls back and reads source before publication',async()=>{
 const r=await fixture();assert.ifError(r.error);assert.equal(r.migrations,160);before(r,'openArchive','connect');before(r,'ledgerRead','snapshot');before(r,'snapshot','migration:1');before(r,'migration:160','verify');before(r,'verify','rollback');before(r,'rollback','successReceipt');
 const publish=r.events.indexOf('successReceipt');assert.ok(r.events.lastIndexOf('ledgerRead',publish)>r.events.indexOf('rollback'));assert.ok(r.events.lastIndexOf('catalogRead',publish)>r.events.indexOf('rollback'));assert.equal(r.logs.find(x=>x.scope==='target_preparation').source_data_preservation.unitPreserved,true);absent(r,'COMMITTED','refusalReceipt');before(r,'end','preservationArchiveClose');before(r,'preservationArchiveClose','captureArchiveCleanup');
});
await check('160 ordinary isolated rehearsal verifies before its existing disposable commit and prints receipt afterward',async()=>{const r=await fixture({target:false});assert.ifError(r.error);before(r,'snapshot','migration:1');before(r,'migration:160','verify');before(r,'verify','COMMITTED');before(r,'COMMITTED','stdout');assert.equal(r.logs[0].source_data_preservation.unitPreserved,true);absent(r,'successReceipt','refusalReceipt','captureArchiveCleanup');});
for(const target of [true,false])for(const fail of ['archive','connect','sourceCatalog','snapshot','migration','ledger','verify',...(!target?['targetCatalog']:[])])await check('failure '+fail+' target='+target+' never commits or publishes success',async()=>{
 const r=await fixture({target,fail});assert.ok(r.error,JSON.stringify({target,fail,events:r.events.slice(-15)}));absent(r,'COMMITTED','successReceipt','stdout');assert.ok(r.events.includes('end'));if(fail!=='archive')assert.ok(r.events.includes('preservationArchiveClose'));if(['archive','connect'].includes(fail))absent(r,'rollback','ledgerRead','catalogRead');
 if(['archive','connect','sourceCatalog','snapshot'].includes(fail))assert.equal(r.migrations,0);
 if(['archive','connect','sourceCatalog','snapshot','migration','ledger'].includes(fail))absent(r,'verify');
 if(fail!=='migration')absent(r,'refusalReceipt');else if(target){before(r,'rollback','refusalReceipt');assert.ok(r.events.lastIndexOf('ledgerRead')<r.events.indexOf('refusalReceipt'));}
});
for(const fail of ['rollbackLedger','rollbackCatalog'])await check('target source readback '+fail+' refuses metadata publication',async()=>{const r=await fixture({fail});assert.ok(r.error);absent(r,'successReceipt','refusalReceipt','COMMITTED','stdout');});
await check('older isolated non160 path does not borrow new archive or checker authority',async()=>{const r=await fixture({target:false,length:2});assert.ifError(r.error);absent(r,'openArchive','snapshot','verify');assert.ok(r.events.includes('COMMITTED'));assert.equal(Object.hasOwn(r.logs[0],'source_data_preservation'),false);});

// Exercise the actual fixed refusal dispatcher with recording metadata only.
// The original migration failure is always rethrown; no database is opened.
const identity158Migration=()=>({order:158,file:AUTHORITY_IDENTITY158_SOURCE_FILE,sha256:AUTHORITY_IDENTITY158_FORWARD_SHA256,
 forward_source:{schema:'custodial.production-forward-source-binding.v1',profile:'existing-postgres-owner',
  canonical_sha256:AUTHORITY_IDENTITY158_CANONICAL_SHA256,file:'release/production-forward-source/'+AUTHORITY_IDENTITY158_SOURCE_FILE,sha256:AUTHORITY_IDENTITY158_FORWARD_SHA256}});
const identity158Metadata=()=>({actor:'postgres',original_actor:'postgres',replication_role:'origin',transaction_read_only:'off',
 deployment_project_ref:'rqquvtjdmugpigbndmne',database_owner:'postgres',actor_superuser:false,actor_bypassrls:true,
 inventory_count:'7312',inventory_selfhash_mismatches:'0',inventory_tuple_digest_sha256:'a'.repeat(64),
 inventory_group_counts:[{object_kind:'function',rows:'7312'}],exact_named_ALWAYS_guard_count:'1',
 named_guard_metadata:[{trigger_oid:'42',trigger_name:'trg_custodial_release_authority_restore_inventory_immutable',enabled:'A',internal:false}],
 inventory_relation_metadata:{owner_name:'postgres',relation_kind:'r'}});
async function identity158Case({migration=identity158Migration(),metadata=identity158Metadata(),readFails=false,target=true}={}){
 const events=[],original=Object.assign(Error('ORIGINAL158_COMPOSITE_REFUSAL'),{code:'P0001'});let diagnostic;
 const db={async query(sql){events.push(sql);if(sql===AUTHORITY_IDENTITY158_METADATA_SQL){if(readFails)throw Object.assign(Error('READ_FAILURE'),{code:'UNIT_READ_FAILURE'});return{rows:[metadata]};}
  assert.ok(['savepoint custodial_target_migration_step','rollback to savepoint custodial_target_migration_step','set local search_path=pg_catalog,public,extensions','release savepoint custodial_target_migration_step'].includes(sql));return{rows:[]};}};
 let thrown;try{await runTargetCaptureStep({db,migration,targetCapture:target,run:async()=>{events.push('originalRun');throw original;},onRefusal:x=>{events.push('refusal');diagnostic=x;}});}catch(error){thrown=error;}
 assert.equal(thrown,original);return{events,diagnostic};
}
await check('fixed158 metadata observes each composite clause separately after savepoint rollback and preserves originalfailure',async()=>{
 const metadata=identity158Metadata();metadata.inventory_count='7313';const r=await identity158Case({metadata});const d=r.diagnostic.authority_identity158;
 assert.deepEqual(d.failed_boundary_predicates,['inventory_count']);assert.equal(d.observed_inventory_guard_metadata,metadata);
 assert.ok(r.events.indexOf('rollback to savepoint custodial_target_migration_step')<r.events.indexOf(AUTHORITY_IDENTITY158_METADATA_SQL));assert.equal(d.canonical_or_production_authority,false);
});
await check('fixed158 O guard failure stays separate from exact7312 count',async()=>{const metadata=identity158Metadata();metadata.exact_named_ALWAYS_guard_count='0';metadata.named_guard_metadata[0].enabled='O';const d=(await identity158Case({metadata})).diagnostic.authority_identity158;assert.deepEqual(d.failed_boundary_predicates,['exact_named_ALWAYS_guard_count']);assert.equal(d.observed_inventory_guard_metadata.named_guard_metadata[0].enabled,'O')});
await check('fixed158 both failures remain visible without accepting any new count',async()=>{const metadata=identity158Metadata();metadata.inventory_count='7313';metadata.exact_named_ALWAYS_guard_count='0';const d=(await identity158Case({metadata})).diagnostic.authority_identity158;assert.deepEqual(d.failed_boundary_predicates,['inventory_count','exact_named_ALWAYS_guard_count']);assert.equal(d.composite_at_preserved_boundary_passes,false)});
await check('fixed158 boundary match does not claim actualfailedDO predicate or dismiss originalerror',async()=>{const d=(await identity158Case()).diagnostic.authority_identity158;assert.equal(d.composite_at_preserved_boundary_passes,true);assert.equal(d.actual_failing_DO_local_predicate,'UNKNOWN');assert.equal(d.canonical_or_production_authority,false)});
for(const [name,edit]of [['wrongorder',m=>{m.order=157}],['wrongexecutedSHA',m=>{m.sha256='0'.repeat(64)}],['wrongcanonicalSHA',m=>{m.forward_source.canonical_sha256='0'.repeat(64)}],['missingforwardbinding',m=>{delete m.forward_source}]])await check('fixed158 '+name+' refuses metadata selection but rethrows originalfailure',async()=>{const migration=identity158Migration();edit(migration);const r=await identity158Case({migration});assert.equal(r.events.includes(AUTHORITY_IDENTITY158_METADATA_SQL),false);assert.equal(r.diagnostic.metadata_read_failed,true);assert.equal(r.diagnostic.sqlstate,'P0001')});
await check('fixed158 metadata readfailure cannot mask originalmigrationfailure',async()=>{const r=await identity158Case({readFails:true});assert.equal(r.diagnostic.metadata_read_failed,true);assert.equal(r.diagnostic.code,'UNIT_READ_FAILURE');assert.equal(r.diagnostic.sqlstate,'P0001')});
await check('non-target caller remains unchanged and never reads158 metadata',async()=>{const r=await identity158Case({target:false});assert.deepEqual(r.events,['originalRun']);assert.equal(r.diagnostic,undefined)});
await check('fixed158 metadata query has no arbitraryparameters/businessrows/definition execution',async()=>{assert.match(AUTHORITY_IDENTITY158_METADATA_SQL,/from public\.custodial_release_authority_restore_inventory/);assert.doesNotMatch(AUTHORITY_IDENTITY158_METADATA_SQL,/\b(?:insert|update|delete|alter|drop|execute|call)\b/i);assert.doesNotMatch(AUTHORITY_IDENTITY158_METADATA_SQL,/\$[0-9]/);assert.match(AUTHORITY_IDENTITY158_METADATA_SQL,/tgenabled='A'/);assert.match(AUTHORITY_IDENTITY158_METADATA_SQL,/inventory_selfhash_mismatches/)});

console.log(JSON.stringify({status:'PASS_RECORDING_CALLER_ONLY',checks,caller_sha256:sha(original),actual_SQL:false,production:false}));
