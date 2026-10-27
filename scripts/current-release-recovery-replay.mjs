import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {constants,closeSync,fsyncSync,lstatSync,openSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertRequiredMembership,localRecoverySource,RECOVERY_KINDS,requiredMembershipQuery,validateRecoveryManifest} from './current-release-recovery-probe.mjs';
import {captureSchemaCatalog,fingerprintSchemaCatalog,stableSchemaJson} from './schema-fingerprint-catalog.mjs';

// Root supplies an owned empty fixture. This module never starts a container,
// discovers a production endpoint, writes canonical source or adopts a catalog.
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const FILES=['scripts/current-release-recovery-replay.mjs','scripts/current-release-recovery-replay-contract-tests.mjs'];
export const OFFICIAL_FIXTURE='scripts/static-weekly-splash-season-official-path-tests.mjs';
export const PREDECESSOR_FIXTURE='scripts/fixtures/current-release-canary-predecessor-fixture.mjs';
const PREDECESSOR_REASONS={
  captured_feedback_digest_changed:'Feedback relation captured predecessor changed',
  live_feedback_shape_changed:'Feedback relation current predecessor changed',
  inventory_immutability_missing:'Current release recovery inventory immutability unavailable',
  later_surface_failure_rolls_back_feedback_rebind:'Current release required function recovery drift: static_weekly_sch022_work_witness(date,jsonb)',
  captured_clock_grant_digest_changed:'Current release required grant recovery drift: custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean)',
  live_clock_grant_changed:'Current release required grant recovery drift: custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean)',
  second_equivalent_clock_grant_alias_corrupted:'Current release required grant recovery drift: custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean)',
  captured_serialized_grant_canary_changed:'Current grant serialization captured predecessor changed: custodial_release_canary_authority_surface()',
  captured_serialized_grant_incumbency_changed:'Current grant serialization captured predecessor changed: public.static_weekly_v3_assert_draft_incumbency(uuid)',
  captured_serialized_grant_hydrate_changed:'Current grant serialization captured predecessor changed: public.static_weekly_v4_hydrate_compiler_source(jsonb,date)',
  captured_serialized_grant_materialize_changed:'Current grant serialization captured predecessor changed: public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)',
  captured_serialized_grant_schedule_base_changed:'Current grant serialization captured predecessor changed: public.static_weekly_v6_read_schedule_segments_dated_base(date)',
  captured_serialized_grant_lunch_base_changed:'Current grant serialization captured predecessor changed: public.static_weekly_v8_read_lunch_segments_dated_base(date)',
  live_serialized_private_grant_changed:'Current grant serialization live predecessor changed: public.static_weekly_v3_assert_draft_incumbency(uuid)',
  serialized_reset_redirected_with_recomputed_digest:'Current grant serialization captured predecessor changed: public.static_weekly_v3_assert_draft_incumbency(uuid)',
  second_equivalent_serialized_grant_alias_corrupted:'Current grant serialization captured alias changed: static_weekly_v3_assert_draft_incumbency(uuid)',
  later_surface_failure_rolls_back_all_six_grants:'Current release required function recovery drift: static_weekly_sch022_work_witness(date,jsonb)',
  event_column_order_ownership_changed:'Current Event column order captured scope changed',
  event_column_definition_digest_changed:'Current Event column order definition changed: public.events_app_events:start_instant_utc',
  later_surface_failure_rolls_back_column_canonicalization:'Current release required function recovery drift: static_weekly_sch022_work_witness(date,jsonb)'
};
const PREDECESSOR_CASES=Object.keys(PREDECESSOR_REASONS);
// The 216 challenge remains immediately before its original forward migration.
// Only this exact source successor pair may follow it; arbitrary newer SQL is
// not treated as another final migration or accepted by a count-only bump.
export const RECOVERY_FORWARD_218=Object.freeze([
  {file:'20261003220000_current_release_authority_completion.sql',sha256:'33ca9d153233441b542d62e0f76d1ffa3b07788cf7e9fccd0c4b993b719abb27'},
  {file:'20261003230000_static_weekly_named_handoff_derivation.sql',sha256:'ef4c6fc1183002af23797b5ac226660a3b1c2b85f3a543df75c1afa61d8fd500'},
  {file:'20261004000000_native_provider_event_decision_lookup.sql',sha256:'ab4e6eb848bd214f8616fb52f094829786df9a9a81d2eb8d00d247b1f28e52fd'}
]);
const FORWARD_NATIVE_ID='public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)';
const FORWARD_NAMED_ID='public.static_weekly_v9_assert_shift_end_derivation(jsonb)';
const FORWARD_CANARY_ID='custodial_release_canary_authority_surface()';
const FORWARD_NAMED_OLD_SHA='1d76c69cc34df8ffb18d9b07711da15c1dfed8c44c7f9b5fed5e5e8b63d93e85';
const FORWARD_NAMED_GRANT_SHA='6c98e2028e3b34c63a955250a5669ff7747deaca0fd10b893af6aab885167788';
const FORWARD_CANARY_OLD_SHA='661cd2a5aecc83d0244920466b161b6fc52d22143074a037148660abed351471';
const FORWARD_CANARY_GRANT_SHA='b7d461eda320ec386b55ce3490063e09848a83723999acdd741e83cad0460498';
const RECOVERY_216_PREFIX_SHA='5d529ec0c3edac509ae4fc77817600b9024366fd43a3963f2551a5835523fa99';
export const RECOVERY_MESSAGE_219=Object.freeze({
  file:'20261003121757_employee_message_source_admission.sql',
  sha256:'20ff06f8c0c5e82814189e1e2969b928ffa48eb1181098a73156962dc9ac1e7f'
});
const RECOVERY_219_SHA='4795b9525622e1512005f85ae1c5994971dccc3d54a987a743bdcfef8bf9ce32';
const RECOVERY_218_SHA='24503cfe852d7668ac94744b2f9ed21d8d2556906b917c7016e0f6c2d3b8d7a1';
export function recoveryForwardProfile(migrations,predecessor){
  const tail=migrations?.slice(-3);
  // Explicit current profile never falls back to the historical fixture path.
  if(migrations?.length===219){
    if(hash(canon(migrations))===RECOVERY_219_SHA &&
        canon(migrations[205])===canon(RECOVERY_MESSAGE_219) &&
        hash(canon(migrations.filter(x=>x.file!==RECOVERY_MESSAGE_219.file)))===RECOVERY_218_SHA &&
        canon(tail)===canon(RECOVERY_FORWARD_218) &&
        canon(predecessor)===canon(RECOVERY_FORWARD_218[0]))return 'EXACT_MESSAGE_219';
    throw new Error('final_migration_position');
  }
  if(canon(migrations?.at(-1))===canon(RECOVERY_FORWARD_218[0]) &&
      canon(predecessor)===canon(RECOVERY_FORWARD_218[0]))return 'HISTORICAL_216';
  if(migrations?.length===218 && hash(canon(migrations.slice(0,216)))===RECOVERY_216_PREFIX_SHA &&
      canon(tail)===canon(RECOVERY_FORWARD_218) &&
      canon(predecessor)===canon(RECOVERY_FORWARD_218[0]))return 'EXACT_FORWARD_218';
  throw new Error('final_migration_position');
}
function assertForwardMembership(rows,predecessorCount,surface){
  must(rows.length===predecessorCount+2,'normal_inventory_forward_count');
  const only=(kind,identity)=>{const matches=rows.filter(x=>x.kind===kind&&x.identity===identity);must(matches.length===1,'normal_inventory_forward_identity');return matches[0]};
  const named=only('function',FORWARD_NAMED_ID),namedGrant=only('grant',FORWARD_NAMED_ID);
  must(named.sha256!==FORWARD_NAMED_OLD_SHA&&namedGrant.sha256===FORWARD_NAMED_GRANT_SHA,'normal_inventory_forward_named');
  const native=only('function',FORWARD_NATIVE_ID),nativeGrant=only('grant',FORWARD_NATIVE_ID);
  const canary=only('function',FORWARD_CANARY_ID),canaryGrant=only('grant',FORWARD_CANARY_ID);
  must(canary.sha256!==FORWARD_CANARY_OLD_SHA&&canaryGrant.sha256===FORWARD_CANARY_GRANT_SHA,
    'normal_inventory_forward_canary');
  if(surface)for(const kind of ['function','grant'])must(surface.filter(x=>x.kind===kind&&x.identity===FORWARD_NATIVE_ID).length===1,
    'normal_inventory_forward_surface');
  return {native,nativeGrant,canary};
}
function assertForwardNormalInventory(rows,predecessorCount){
  const {native,nativeGrant,canary}=assertForwardMembership(rows,predecessorCount);
  must(native.definition_sql.includes('custodial_native_provider_event_decisions(')&&
    nativeGrant.definition_sql.startsWith(`select public.custodial_release_authority_reset_grants('${FORWARD_NATIVE_ID}'); `),
    'normal_inventory_forward_native');
  same([...nativeGrant.definition_sql.matchAll(/\bgrant execute on function [^;]+ to ([a-z_]+);/g)].map(x=>x[1]),
    ['postgres','service_role'],'normal_inventory_forward_native');
  for(const kind of ['function','grant'])must(canary.definition_sql.includes(
    `('${kind}','${FORWARD_NATIVE_ID}','`),'normal_inventory_forward_surface');
}
function assertForwardPreimage(rows,predecessorCount){
  must(Array.isArray(rows)&&rows.length===predecessorCount,'forward_preimage_count');
  const expected=[
    ['function',FORWARD_NAMED_ID,100201,FORWARD_NAMED_OLD_SHA],
    ['grant',FORWARD_NAMED_ID,950022,FORWARD_NAMED_GRANT_SHA],
    ['function',FORWARD_CANARY_ID,100071,FORWARD_CANARY_OLD_SHA],
    ['grant',FORWARD_CANARY_ID,1000073,FORWARD_CANARY_GRANT_SHA]
  ];
  // Older captured objects can legitimately share restore_order. The full
  // (kind, identity) key is unique; only newly allocated orders use the global
  // occupied-order set in the forward migration and delta check below.
  must(new Set(rows.map(key)).size===rows.length,'forward_preimage_unique');
  for(const [kind,identity,order,sha256] of expected){const found=rows.filter(x=>x.kind===kind&&x.identity===identity);
    must(found.length===1&&found[0].order===order&&found[0].sha256===sha256,'forward_preimage_source');}
  must(rows.every(x=>x.identity!==FORWARD_NATIVE_ID),'forward_preimage_native_absent');
}
function assertForwardDelta(before,after,beforeSurface,afterSurface){
  must(before.length+2===after.length,'forward_delta_count');
  const prior=new Map(before.map(x=>[key(x),x])),final=new Map(after.map(x=>[key(x),x]));
  must(prior.size===before.length&&final.size===after.length,'forward_delta_unique');
  const changed=new Set([key({kind:'function',identity:FORWARD_NAMED_ID}),key({kind:'function',identity:FORWARD_CANARY_ID})]);
  for(const [identity,row] of prior){const now=final.get(identity);must(now&&now.order===row.order,'forward_delta_member_order');
    must(changed.has(identity)?now.sha256!==row.sha256:now.sha256===row.sha256,'forward_delta_unrelated_definition');}
  const additions=after.filter(x=>!prior.has(key(x))).map(x=>({kind:x.kind,identity:x.identity}));
  same(sort(additions),sort([{kind:'function',identity:FORWARD_NATIVE_ID},{kind:'grant',identity:FORWARD_NATIVE_ID}]),'forward_delta_added_members');
  for(const [kind,bucket] of [['function',100000],['grant',900000]]){
    const used=new Set(before.map(x=>x.order));let first=bucket+1;while(used.has(first)&&first<bucket+99999)first++;
    must(final.get(key({kind,identity:FORWARD_NATIVE_ID}))?.order===first,'forward_delta_free_order');
  }
  const originalSurface=new Set(beforeSurface.map(key)),finalSurface=new Set(afterSurface.map(key));
  must(originalSurface.size===beforeSurface.length&&finalSurface.size===afterSurface.length,'forward_delta_surface_unique');
  for(const identity of originalSurface)must(finalSurface.has(identity),'forward_delta_surface_preserved');
  const surfaceAdditions=afterSurface.filter(x=>!originalSurface.has(key(x)));
  same(sort(surfaceAdditions),sort([{kind:'function',identity:FORWARD_NATIVE_ID},{kind:'grant',identity:FORWARD_NATIVE_ID}]),'forward_delta_surface_added');
}
export const DEFAULT_EXCEPTIONS=Object.freeze({
  '20260718083100_reconstruct_public_grant_hardening.sql':'ed9aac28cb07f3565f3289d15d67458297222910ac44b1a77e8b5ae71b4c59c3',
  '20260729150527_audit_defense_in_depth_hardening.sql':'420157f3073a3ea1b0055fc6e6246374a9babf2db576cda3bc4272a01e27cc4f',
  '20260815160613_normalize_managed_production_schema_security.sql':'fcc15cab9a3c492f9958d91643e5c88f88f0917b31a3507d340c6fab67cb011a'
});
const INPUT_PINS=Object.freeze({
  'scripts/native-target-source-database-tests.mjs':'6f4fc7e3e28554abedfb11c8a2f79aef00c3c88ca127a6dd46799d21a215f6bf',
  'scripts/schema-fingerprint-catalog.mjs':'6fed4619b8db241a8b346861e028a2c0f933299622b1b8d934b2c3c193506794',
  'scripts/completion-taxonomy-database-tests.mjs':'e4fac36778571c306bf1740c766015ca7b1a804b191e910979c5d392a8c1ac56',
  'scripts/feedback-delivery-status-database-tests.mjs':'3f4261c6f2dc829bf0d4120d3a23a81af54eeb73dcd01c93d801a05f1bf25556'
});
export const SEED_TABLES=Object.freeze(['public.completion_responses','public.devices','public.employees','public.locations','public.maintenance_tickets','public.ops_manager_managers','public.sessions','public.system_feedback_email_intents','public.system_feedback_items']);
const HEX=/^[0-9a-f]{64}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SEED_KEYS=['manager','employee','device','location','session','completion','completion_operation','work_ticket','feedback','feedback_operation'];
const hash=x=>createHash('sha256').update(x).digest('hex');
const canon=x=>JSON.stringify(stableSchemaJson(x));
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
const key=x=>JSON.stringify([x.kind,x.identity]);
const sort=rows=>[...rows].sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0);
const must=(x,code)=>{if(!x)throw new Error(code)};
const same=(a,b,code)=>must(canon(a)===canon(b),code);
const shape=(x,keys,code)=>{must(x&&typeof x==='object'&&!Array.isArray(x),code);same(Object.keys(x).sort(),[...keys].sort(),code)};
const json=(text,code)=>{try{return JSON.parse(text)}catch{throw new Error(code)}};
const DOCKER=['--host','unix:///var/run/docker.sock'];
const DEFAULT_SQL="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole);";
const REVOKE_SQL=['postgres','supabase_admin'].flatMap(owner=>['',' in schema public'].map(scope=>`alter default privileges for role ${owner}${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner}${scope} revoke all on sequences from public,anon,authenticated,service_role;`)).join('\n');
const EMPTY_SQL="select jsonb_build_object('relations',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),'types',(select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public'));";
const INVENTORY_SQL="select coalesce(jsonb_agg(jsonb_build_object('kind',object_kind,'identity',object_identity,'sha256',definition_sha256,'order',restore_order)),'[]'::jsonb) from public.custodial_release_authority_restore_inventory;";
const SURFACE_SQL="select coalesce(jsonb_agg(jsonb_build_object('kind',object_kind,'identity',object_identity)),'[]'::jsonb) from public.custodial_release_canary_authority_surface();";

// Exact renderer definitions independently captured by the source-bound NORMAL
// 216 catalog (7273e86b...). These are NOT learned from the target under test.
export const NORMAL_RENDERER_PINS=Object.freeze(Object.fromEntries(Object.entries({
  column:'cb75ddb8fcc66de2f6d46ad279b8b3a40ec1aaab1595ca672ec5f2868da7430d',
  column_set:'68fb07358e10890bed08cfabebed3f3649fd9df67952109052cc9725c442cc61',
  constraint:'4d5e7bdd3eab00cc7f9568eb7d6770d72c95fa5b5c49ae42ed2fbd666b9a511c',
  grant:'6ea419b77106cde9611a2091e52552116607e192f961f1a88b3b591633245907',
  index:'d223214b359ac36dace8f7f1576aad2298041f417d585f2920f39ff7caf851af',
  policy:'0dac2e05f9a23770f1874fb19f9bfe8fdae5e56e95fe652ae981437e1c3c91c0',
  relation:'a9f77828c5917b95f5dea85ee46bed6ef6581e203cb468a7f15647b59fd7f125',
  relation_state:'a35b953cc1f03f29b3f282802a20d2dbc6251467ce58a92758951fea8a3770d1',
  view:'e8635f9f0e09849b6b1e3ce1c2c71168f3a51dc5ea3b3d0e8acf1709903950ef'
}).map(([kind,sha256])=>['public.custodial_release_authority_current_'+kind+'_definition(text)',sha256])));
// Deliberately the same eleven-kind live rendering contract as the probe.
// Stored SQL is evidence only; this path NEVER executes it or repairs drift.
const NORMAL_LIVE=`case i.object_kind
 when 'function' then pg_get_functiondef(to_regprocedure(i.object_identity))
 when 'relation' then public.custodial_release_authority_current_relation_definition(i.object_identity)
 when 'column' then public.custodial_release_authority_current_column_definition(i.object_identity)
 when 'column_set' then public.custodial_release_authority_current_column_set_definition(i.object_identity)
 when 'constraint' then public.custodial_release_authority_current_constraint_definition(i.object_identity)
 when 'index' then public.custodial_release_authority_current_index_definition(i.object_identity)
 when 'policy' then public.custodial_release_authority_current_policy_definition(i.object_identity)
 when 'relation_state' then public.custodial_release_authority_current_relation_state_definition(i.object_identity)
 when 'grant' then public.custodial_release_authority_current_grant_definition(i.object_identity)
 when 'view' then public.custodial_release_authority_current_view_definition(i.object_identity)
 when 'trigger' then (select 'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'; '||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' '||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end||' trigger '||quote_ident(t.tgname)||';'
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal)
 else null end`;
export const NORMAL_INVENTORY_SQL=`begin isolation level repeatable read read only;
set local search_path=pg_catalog,public;
with live_rows as materialized (
 select i.object_kind,i.object_identity,i.restore_order,i.definition_sql,i.definition_sha256,${NORMAL_LIVE} as live_sql
 from public.custodial_release_authority_restore_inventory i
)
select jsonb_build_object(
 'count',(select count(*) from public.custodial_release_authority_restore_inventory),
 'metadata',(select coalesce(jsonb_agg(jsonb_build_object('kind',object_kind,'identity',object_identity,'order',restore_order,'sha256',definition_sha256)),'[]'::jsonb) from public.custodial_release_authority_restore_inventory),
 'renderers',(select jsonb_agg(jsonb_build_object('identity',identity,'sha256',encode(extensions.digest(convert_to(pg_get_functiondef(to_regprocedure(identity)),'UTF8'),'sha256'),'hex'))) from (values ${Object.keys(NORMAL_RENDERER_PINS).map(identity=>'('+q(identity)+')').join(',')}) r(identity)),
 'rows',(select coalesce(jsonb_agg(jsonb_build_object('kind',object_kind,'identity',object_identity,'order',restore_order,'definition_sql',definition_sql,'sha256',definition_sha256,
   'stored_sha256',encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex'),'live_sql',live_sql,'live_sha256',encode(extensions.digest(convert_to(live_sql,'UTF8'),'sha256'),'hex'))),'[]'::jsonb) from live_rows));
commit;`;

function validateNormalInventory(observed){
  shape(observed,['count','metadata','renderers','rows'],'normal_inventory_shape');
  must(Number.isSafeInteger(observed.count)&&observed.count>0&&observed.count<=20000,'normal_inventory_count');
  must(Array.isArray(observed.rows)&&Array.isArray(observed.metadata)&&observed.rows.length===observed.count&&observed.metadata.length===observed.count,'normal_inventory_count');
  must(Array.isArray(observed.renderers)&&observed.renderers.length===Object.keys(NORMAL_RENDERER_PINS).length,'normal_renderer_count');
  for(const row of observed.renderers){shape(row,['identity','sha256'],'normal_renderer_shape');must(typeof row.identity==='string'&&typeof row.sha256==='string','normal_renderer_shape')}
  same([...observed.renderers].sort((a,b)=>a.identity<b.identity?-1:1),Object.entries(NORMAL_RENDERER_PINS).map(([identity,sha256])=>({identity,sha256})),'normal_renderer_source');
  const validIdentity=row=>{
    must(RECOVERY_KINDS.includes(row.kind)&&typeof row.identity==='string'&&row.identity.length>0&&row.identity.length<=500&&!/[\r\n\0]/.test(row.identity),'normal_inventory_identity');
    must(Number.isSafeInteger(row.order)&&row.order>0,'normal_inventory_order');must(typeof row.sha256==='string'&&HEX.test(row.sha256),'normal_inventory_hash');
  };
  for(const row of observed.metadata){shape(row,['kind','identity','order','sha256'],'normal_inventory_metadata');validIdentity(row)}
  for(const row of observed.rows){
    shape(row,['kind','identity','order','definition_sql','sha256','stored_sha256','live_sql','live_sha256'],'normal_inventory_row');validIdentity(row);
    for(const name of ['definition_sql','live_sql'])must(typeof row[name]==='string'&&row[name].length>0&&!row[name].includes('\0')&&Buffer.byteLength(row[name],'utf8')<=4*1024*1024,'normal_inventory_sql');
    for(const name of ['stored_sha256','live_sha256'])must(typeof row[name]==='string'&&HEX.test(row[name]),'normal_inventory_hash');
    must(hash(row.definition_sql)===row.stored_sha256&&hash(row.live_sql)===row.live_sha256,'normal_inventory_computed_hash');
    must(row.sha256===row.stored_sha256&&row.sha256===row.live_sha256&&row.definition_sql===row.live_sql,'normal_inventory_live_integrity');
  }
  must(new Set(observed.rows.map(key)).size===observed.count&&new Set(observed.metadata.map(key)).size===observed.count,'normal_inventory_duplicate');
  const rows=sort(observed.rows),metadata=sort(observed.metadata);
  same(rows.map(({kind,identity,order,sha256})=>({kind,identity,order,sha256})),metadata,'normal_inventory_membership');
  same([...new Set(rows.map(row=>row.kind))].sort(),RECOVERY_KINDS,'normal_inventory_all_kinds');
  return {rows,metadata,renderers:Object.entries(NORMAL_RENDERER_PINS).map(([identity,sha256])=>({identity,sha256}))};
}

export function validateReplayPlan(m){
  shape(m,['schema','stage','lane','synthetic','production','target','source','runner_files','official_fixture','predecessor_fixture','output_dir','required_surface','protected_relations','seed','cleanup_lease','prepared','probe_manifest'],'plan_shape');
  must(m.schema==='custodial.current-recovery-replay-plan.v1'&&m.synthetic===true&&m.production===false,'synthetic_plan_required');
  must(['prepare','verify'].includes(m.stage)&&['normal','no-auto'].includes(m.lane)&&!(m.stage==='verify'&&m.lane==='normal'),'lane_stage');
  shape(m.target,['name','id','image','fixture_id','database'],'target_shape');
  must(/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(m.target.name)&&HEX.test(m.target.id)&&/^sha256:[0-9a-f]{64}$/.test(m.target.image)&&UUID.test(m.target.fixture_id)&&m.target.fixture_id[14]==='4'&&m.target.database==='postgres','target_identity');
  must(isAbsolute(m.output_dir)&&resolve(m.output_dir)===m.output_dir,'output_directory');
  same(m.runner_files?.map(x=>x.file),FILES,'runner_file_set');
  for(const x of m.runner_files){shape(x,['file','sha256'],'runner_file');must(HEX.test(x.sha256),'runner_hash')}
  shape(m.cleanup_lease,['owner','container_id','fixture_id','remove_on_terminal','retain_on_prepared'],'cleanup_lease');
  same(m.cleanup_lease,{owner:'/root',container_id:m.target.id,fixture_id:m.target.fixture_id,remove_on_terminal:true,retain_on_prepared:true},'cleanup_lease_binding');
  must(Array.isArray(m.required_surface)&&m.required_surface.length>0,'literal_required_surface');
  for(const row of m.required_surface){shape(row,['kind','identity'],'required_surface_shape');must(RECOVERY_KINDS.includes(row.kind)&&typeof row.identity==='string'&&row.identity.length>0&&row.identity.length<=500&&!/[\r\n\0]/.test(row.identity),'required_identity')}
  same(sort(m.required_surface),m.required_surface,'required_order');must(new Set(m.required_surface.map(key)).size===m.required_surface.length,'required_duplicate');
  must(Array.isArray(m.protected_relations)&&m.protected_relations.every(x=>/^public\.[a-z][a-z0-9_]{0,62}$/.test(x)&&!/custodial_(backend_execution_config|release_canary_|release_authority_)/.test(x)),'protected_relations');
  same(m.protected_relations,[...new Set(m.protected_relations)].sort(),'protected_order');
  for(const table of SEED_TABLES)must(m.protected_relations.includes(table),'seed_protection_required');
  shape(m.seed,SEED_KEYS,'seed_shape');must(Object.values(m.seed).every(x=>UUID.test(x))&&new Set(Object.values(m.seed)).size===SEED_KEYS.length,'seed_identity');
  if(m.lane==='no-auto'){shape(m.official_fixture,['file','sha256'],'official_fixture');must(m.official_fixture.file===OFFICIAL_FIXTURE&&HEX.test(m.official_fixture.sha256),'official_fixture_pin')}
  else must(m.official_fixture===null,'normal_catalog_only');
  shape(m.predecessor_fixture,['file','sha256','migration'],'predecessor_fixture');
  must(m.predecessor_fixture.file===PREDECESSOR_FIXTURE&&HEX.test(m.predecessor_fixture.sha256),'predecessor_source_pin');
  shape(m.predecessor_fixture.migration,['file','sha256'],'predecessor_migration');
  must(m.predecessor_fixture.migration.file==='20261003220000_current_release_authority_completion.sql'&&HEX.test(m.predecessor_fixture.migration.sha256),'predecessor_migration_identity');
  const profile=recoveryForwardProfile(m.source?.migrations,m.predecessor_fixture.migration);
  if(profile!=='HISTORICAL_216')same(m.source.migrations.slice(-3),RECOVERY_FORWARD_218,'forward_migration_suffix');
  if(m.stage==='prepare')must(m.prepared===null&&m.probe_manifest===null,'prepare_never_adopts_manifest');
  else{
    shape(m.prepared,['file','sha256'],'prepared_reference');must(m.prepared.file==='no-auto-prepare-receipt.json'&&HEX.test(m.prepared.sha256),'prepared_reference');
    validateRecoveryManifest(m.probe_manifest);
    same(m.probe_manifest.target,m.target,'probe_target');same(m.probe_manifest.source,m.source,'probe_source');
    same(m.probe_manifest.required_surface,m.required_surface,'probe_required_surface');
    same(m.probe_manifest.protected_rows.map(x=>x.relation),m.protected_relations,'probe_protected_scope');
    must(m.probe_manifest.manager_id===m.seed.manager,'probe_original_manager');
  }
  return m;
}

export function localReplaySource(root=ROOT,sourceReader=localRecoverySource){
  for(const [path,digest] of Object.entries(INPUT_PINS))must(hash(readFileSync(join(root,path)))===digest,'reused_source_pin');
  for(const [file,digest] of Object.entries(DEFAULT_EXCEPTIONS))must(hash(readFileSync(join(root,'supabase/migrations',file)))===digest,'default_exception_source_pin');
  return {source:sourceReader(root),runner_files:FILES.map(file=>({file,sha256:hash(readFileSync(join(root,file)))}))};
}

const nodeIO={
  source:root=>localReplaySource(root),read:path=>{const s=lstatSync(path);must(s.isFile()&&!s.isSymbolicLink(),'regular_input_required');return readFileSync(path)},
  outputDirectory(path){const s=lstatSync(path);must(s.isDirectory()&&!s.isSymbolicLink()&&realpathSync(path)===path&&s.uid===process.getuid()&&(s.mode&0o077)===0,'private_output_directory')},
  write(path,bytes){let fd,dir;try{fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_WRONLY,0o600);writeFileSync(fd,bytes);fsyncSync(fd);dir=openSync(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);fsyncSync(dir)}finally{if(fd!==undefined)closeSync(fd);if(dir!==undefined)closeSync(dir)}},
  run(command,args,{input,signal,timeout_ms=120000}={}){return new Promise((done,reject)=>{
    let stdout='',stderr='',settled=false;const child=spawn(command,args,{cwd:ROOT,env:{PATH:process.env.PATH,LANG:'C.UTF-8'},detached:true,stdio:['pipe','pipe','pipe']});
    const kill=()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}};
    const timer=setTimeout(kill,timeout_ms);
    const abort=()=>kill();signal?.addEventListener('abort',abort,{once:true});
    for(const [stream,name] of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.setEncoding('utf8').on('data',chunk=>{if(name==='stdout')stdout+=chunk;else stderr+=chunk;if(stdout.length+stderr.length>64*1024*1024)kill()});
    child.once('error',error=>{if(!settled){settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new Error('subprocess_spawn_failed'))}});
    child.once('close',(status)=>{if(!settled){settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);done({status:Number.isInteger(status)?status:-1,stdout,stderr})}});
    child.stdin.on('error',()=>{});child.stdin.end(input);if(signal?.aborted)kill();
  })}
};

function seedSQL(m){
  const s=m.seed,suffix=m.target.fixture_id.replaceAll('-','').slice(0,16),code='RECOVERY_'+suffix;
  const response={form_type:'restroom',work_result:'details',attention_needed:false,services_performed:['Synthetic protected custom work'],maintenance_issues_found:[],note:'Synthetic historical protected draft; NOT verified cleaning'};
  const identity={identity_verification:{status:'verified',kind:'named_manager_session',manager_id:s.manager}};
  return `begin;
insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values(${q(s.manager)},'Synthetic Recovery Manager',array['OPS_MANAGER','DIRECTOR'],true,false);
insert into public.employees(id,employee_code,display_name,active,role) values(${q(s.employee)},${q(code)},'Synthetic Recovery Employee',true,'staff');
insert into public.locations(id,location_code,location_name,location_type,form_type,active) values(${q(s.location)},${q(code)},'Synthetic Protected Restroom','restroom','restroom',true);
insert into public.devices(id,device_id,device_name,active,assigned_employee_id) values(${q(s.device)},${q(code)},'Synthetic Recovery Device',true,${q(s.employee)});
insert into public.sessions(id,session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at) values(${q(s.session)},${q(s.session)},${q(s.session)},${q(s.location)},${q(s.employee)},${q(s.device)},'active',now()-interval '10 minutes');
insert into public.completion_responses(id,session_id,location_id,submitted_by_employee_id,device_id,response_json,client_completion_id) values(${q(s.completion)},${q(s.session)},${q(s.location)},${q(s.employee)},${q(s.device)},${q(JSON.stringify(response))}::jsonb,${q(s.completion_operation)});
insert into public.maintenance_tickets(id,location_id,issue_source,status,issue_summary) values(${q(s.work_ticket)},${q(s.location)},'manager_report','open','Synthetic pending protected work');
insert into public.system_feedback_items(id,operation_id,request_fingerprint,category,priority,message,submitted_by,hub_context,metadata_json) values(${q(s.feedback)},${q(s.feedback_operation)},repeat('9',64),'other','normal','Synthetic protected feedback ñ','Synthetic Recovery Manager','manager',${q(JSON.stringify(identity))}::jsonb);
commit;`;
}

function assertProbeReceipt(r,m,fake){
  const expected=m.probe_manifest;
  must(r.schema==='custodial.current-release-recovery-probe-receipt.v1'&&r.engine_executed===!fake&&r.execution===(fake?'FAKE_SUBPROCESS_UNIT_ONLY':'OWNED_SYNTHETIC_ENGINE')&&r.production===false&&r.release_admission===false,'probe_execution_scope');
  same(r.source,m.source,'probe_receipt_source');must(r.manifest_sha256===hash(canon(expected)),'probe_manifest_receipt');
  same(r.required_surface,m.required_surface,'probe_original_requirements');must(r.required_surface_sha256===hash(canon(m.required_surface)),'probe_requirement_digest');
  shape(r.required_membership,['before','after'],'probe_required_membership');
  for(const rows of [r.required_membership.before,r.required_membership.after])assertRequiredMembership(m.required_surface,expected.surface,expected.inventory,rows);
  same(r.target,{name:m.target.name,id:m.target.id,image:m.target.image,network:'none',fixture_id:m.target.fixture_id},'probe_receipt_target');
  must(r.inventory_count===expected.inventory.length&&r.inventory_sha256===hash(canon(expected.inventory))&&r.surface_count===expected.surface.length&&r.restored_objects===expected.inventory.length&&r.canary_left_paused===true&&r.automatic_grants_absent===true,'probe_restore_receipt');
  same(r.protected_rows,expected.protected_rows,'probe_protected_receipt');
  for(const h of [r.health_before,r.health_after]){
    must(h?.ok===true&&h.authority==='offline-authority.v5'&&h.canonical_objects_expected===expected.inventory.length&&h.canary_surface_objects_expected===expected.surface.length,'probe_health');
    same(Object.keys(h.checks||{}).sort(),expected.health_checks,'probe_health_checks');must(Object.values(h.checks).every(x=>x===true),'probe_health_checks');
    for(const k of ['missing_objects','mismatched_objects','surface_missing_objects','surface_uncovered_objects'])same(h[k],[],'probe_health_findings');
  }
  same(r.rollback_faults,[...expected.faults.map(x=>({...x,fault:'captured_digest_mismatch',rollback_readback:true})),{...expected.omitted_surface,fault:'required_surface_inventory_omission',rollback_readback:true}],'probe_rollback_receipts');
  must(Array.isArray(r.controls)&&r.controls.length===2,'probe_controls');
  for(const [i,c] of r.controls.entries()){
    must(c.manager_id===m.seed.manager&&UUID.test(c.request_id)&&UUID.test(c.audit_id)&&c.device_identifier==='KIOSK_08'&&c.action===(i===0?'pause_canary':'restore_authority')&&c.reason==='synthetic current-source recovery probe','probe_original_control');
    same(c.authoritative_health,{ok:false,scope:'current-source-synthetic'},'probe_original_control');
    same(c.result,{device_identifier:'KIOSK_08',canary_paused:true,restored_objects:i===0?0:expected.inventory.length},'probe_original_control');
  }
  const denied=['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'];
  same(r.caller_checks,{intended_health_role:'service_role',denied_configuration_roles:denied,denied_health_roles:denied.filter(x=>x!=='service_role'),wrong_health_proof_denied:true},'probe_caller_receipts');
}

export async function runRecoveryReplay(plan,{root=ROOT,io=nodeIO,signal}={}){
  const m=validateReplayPlan(plan),fake=io!==nodeIO,stage=m.lane+'-'+m.stage,artifacts=[];
  const forwardProfile=recoveryForwardProfile(m.source.migrations,m.predecessor_fixture.migration);
  let leased=false,retain=false,outputReady=false,phase='preflight',pending_control=null,predecessorInventoryCount=null,forwardPreimage=null,forwardSurfacePreimage=null;
  const write=(name,data)=>{must(/^[a-z0-9_.-]+$/.test(name),'artifact_name');const bytes=typeof data==='string'?data:JSON.stringify(data,null,2)+'\n';io.write(join(m.output_dir,name),bytes);const item={file:name,sha256:hash(bytes)};artifacts.push(item);return item};
  const checkSignal=()=>must(!signal?.aborted,'aborted');
  async function run(command,args,input,{cleanup=false,timeout_ms=120000}={}){if(!cleanup)checkSignal();const r=await io.run(command,args,{input,signal:cleanup?undefined:signal,timeout_ms});must(r&&Number.isInteger(r.status)&&typeof r.stdout==='string'&&typeof r.stderr==='string','subprocess_shape');return r}
  async function inspect({cleanup=false}={}){const r=await run('docker',[...DOCKER,'inspect','--type','container',m.target.id],undefined,{cleanup});must(r.status===0,'target_inspect_failed');const rows=json(r.stdout,'target_inspect_json');must(Array.isArray(rows)&&rows.length===1,'one_target');const x=rows[0];
    must(x.Id===m.target.id&&x.Name==='/'+m.target.name&&x.Image===m.target.image&&(cleanup||x.State?.Running===true),'target_mismatch');
    must(x.HostConfig?.NetworkMode==='none'&&Object.keys(x.HostConfig.PortBindings||{}).length===0&&Object.values(x.NetworkSettings?.Ports||{}).every(v=>v===null)&&canon(Object.keys(x.NetworkSettings?.Networks||{}))==='["none"]','target_network');
    same(x.Config?.Labels&&Object.fromEntries(['fixture','owner','fixture-id'].map(k=>[k,x.Config.Labels['org.memphiszoo.custodial.'+k]])),{fixture:'synthetic',owner:'/root','fixture-id':m.target.fixture_id},'target_ownership');
  }
  async function sql(name,text,{rawLog=false}={}){phase=name;
    // Only the hash-verified migration caller below requests raw logs. TERSE
    // retains its primary rejection without DETAIL/HINT/CONTEXT; queries stay redacted.
    must(!rawLog||/^migration_\d{4,}$/.test(name),'migration_log_scope');
    const r=await run('docker',[...DOCKER,'exec','-i',m.target.id,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY='+(rawLog?'terse':'sqlstate'),'-U','supabase_admin','-d','postgres'],`/* current-replay:${name} */\nset standard_conforming_strings=on;set client_min_messages=warning;set statement_timeout=90000;set lock_timeout=5000;\n${text}`);
    if(rawLog)write(stage+'-'+name+'.log',r.stdout+r.stderr);must(r.status===0,'sql_'+name);return r.stdout.trim();}
  const query=async(name,text)=>json(await sql(name,text),'json_'+name);
  async function snapshots(){const rows=[];for(const table of m.protected_relations)rows.push(await query('snapshot_'+table.slice(7),`select jsonb_build_object('relation',${q(table)},'count',count(*),'sha256',encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),''),'UTF8'),'sha256'),'hex')) from ${table} r;`));return rows}
  async function catalog(name){let i=0;const values=await captureSchemaCatalog({query:async sql=>({rows:await query('catalog_'+name+'_'+(++i),`select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (${sql}) q;`)})});const captured=fingerprintSchemaCatalog(values);write(stage+'-'+name+'-catalog.json',{classification:m.lane==='normal'?'NORMAL_SOURCE_CATALOG_OBSERVATION':'NO_AUTO_SOURCE_CATALOG_OBSERVATION',...captured});return captured.fingerprint}
  async function cleanup(){await inspect({cleanup:true});const result=await run('docker',[...DOCKER,'rm','-f',m.target.id],undefined,{cleanup:true});must(result.status===0,'cleanup_remove_failed');const absent=await run('docker',[...DOCKER,'ps','-a','--no-trunc','--filter','id='+m.target.id,'--format','{{.ID}}'],undefined,{cleanup:true});must(absent.status===0&&absent.stdout.trim()==='','cleanup_not_confirmed');leased=false;write(stage+'-cleanup.json',{container_id:m.target.id,fixture_id:m.target.fixture_id,removed:true,engine_executed:!fake})}
  let result,error;
  try{
    same(io.source(root),{source:m.source,runner_files:m.runner_files},'source_manifest');
    must(m.output_dir!==resolve(root)&&!m.output_dir.startsWith(resolve(root)+'/'),'output_outside_candidate');
    io.outputDirectory(m.output_dir);outputReady=true;await inspect();
    if(m.lane==='no-auto')must(hash(io.read(join(root,OFFICIAL_FIXTURE)))===m.official_fixture.sha256,'official_fixture_changed');
    must(hash(io.read(join(root,PREDECESSOR_FIXTURE)))===m.predecessor_fixture.sha256,'predecessor_fixture_changed');
    if(m.stage==='prepare'){
      // No cleanup authority is adopted before empty-catalog admission. A
      // rejected nonempty target is never reset, truncated, or removed.
      same(await query('empty_catalog',EMPTY_SQL),{relations:0,functions:0,types:0},'empty_catalog_required');leased=true;
      write(stage+'-admission.json',{source:m.source,target:m.target,cleanup_lease:m.cleanup_lease,empty_catalog:true,engine_executed:!fake});
      if(m.lane==='no-auto')await sql('remove_initial_defaults',REVOKE_SQL);
      const replayed=[];
      for(const entry of m.source.migrations){
        const bytes=io.read(join(root,'supabase/migrations',entry.file));must(hash(bytes)===entry.sha256,'migration_changed');
        if(forwardProfile!=='HISTORICAL_216'&&entry.file===RECOVERY_FORWARD_218[1].file){
          same(replayed.at(-1),RECOVERY_FORWARD_218[0],'forward_preimage_position');
          forwardPreimage=sort(await query('forward_inventory_preimage',INVENTORY_SQL));
          forwardSurfacePreimage=sort(await query('forward_surface_preimage',SURFACE_SQL));
          assertForwardPreimage(forwardPreimage,predecessorInventoryCount);
          write(stage+'-forward-preimage.json',{inventory:forwardPreimage,surface:forwardSurfacePreimage,
            source:m.source,classification:'SOURCE_PREIMAGE_OBSERVED_NOT_ACCEPTED'});
        }
        if(m.lane==='no-auto')must(await sql('defaults_before_'+replayed.length,DEFAULT_SQL)==='0','defaults_before');
        if(entry.file===m.predecessor_fixture.migration.file){
          phase='predecessor_fixture';const pre=await run(process.execPath,[join(root,PREDECESSOR_FIXTURE)],JSON.stringify({target:m.target,migration:entry}),{timeout_ms:300000});
          write(stage+'-predecessor-fixture.log',pre.stdout+pre.stderr);must(pre.status===0,'predecessor_fixture_failed');
          const proof=json(pre.stdout.trim().split('\n').at(-1),'predecessor_receipt');
          shape(proof,['schema','status','checks','engine_executed','synthetic','production','target','migration','source_sha256','predecessor','cases','successful_final_migration_applied','authority_configured','container_retained'],'predecessor_receipt_shape');
          must(proof.schema==='custodial.current-release-canary-predecessor-receipt.v1'&&proof.status==='PASS'&&proof.checks===20&&proof.engine_executed===!fake&&proof.synthetic===true&&proof.production===false&&proof.successful_final_migration_applied===false&&proof.authority_configured===false&&proof.container_retained===true,'predecessor_receipt');
          same(proof.target,m.target,'predecessor_target');same(proof.migration,entry,'predecessor_migration');must(proof.source_sha256===m.predecessor_fixture.sha256,'predecessor_source_receipt');
          same(proof.cases?.map(x=>x.id),PREDECESSOR_CASES,'predecessor_cases');must(proof.cases.every(x=>x.rejected===true&&x.rollback_exact===true&&x.expected_reason===PREDECESSOR_REASONS[x.id]),'predecessor_rollback');
          must(proof.predecessor&&Number.isSafeInteger(proof.predecessor.inventory_count)&&proof.predecessor.inventory_count>0&&['inventory_sha256','feedback_stored','feedback_live'].every(k=>HEX.test(proof.predecessor[k]))&&proof.predecessor.immutable==='O','predecessor_preimage');
          predecessorInventoryCount=proof.predecessor.inventory_count;
        }
        await sql('migration_'+String(replayed.length).padStart(4,'0'),bytes.toString(),{rawLog:true});
        if(m.lane==='no-auto'&&await sql('defaults_after_'+replayed.length,DEFAULT_SQL)!=='0'){
          must(DEFAULT_EXCEPTIONS[entry.file]===entry.sha256&&!/create\s+(?:unlogged\s+)?table|create\s+sequence/i.test(bytes.toString()),'unexpected_default_grant_change');
          await sql('remove_known_defaults_'+replayed.length,REVOKE_SQL);must(await sql('defaults_rechecked_'+replayed.length,DEFAULT_SQL)==='0','defaults_recheck');
        }
        replayed.push(entry);
      }
      write(stage+'-ordered-replay.json',{source:m.source,replayed,automatic_grants_absent:m.lane==='no-auto',engine_executed:!fake});
      if(m.lane==='normal'){
        const fingerprint=await catalog('replayed');
        const query_sha256=hash(NORMAL_INVENTORY_SQL),observed=await query('normal_inventory',NORMAL_INVENTORY_SQL);
        // Preserve diagnostic source rows even when integrity validation fails.
        // This is explicitly unvalidated and never substitutes for a receipt.
        const raw_observation=write(stage+'-recovery-inventory-observed.json',{
          classification:'NORMAL_INVENTORY_UNVALIDATED_OBSERVATION',source:m.source,target:m.target,query_sha256,
          observed,engine_executed:!fake,independently_accepted:false,production:false,release_admission:false
        });
        const captured=validateNormalInventory(observed);
        // The fixed final03220000 updates definitions only. Keep its validated
        // transaction-predecessor count separate from the postmigration query.
        if(forwardProfile==='HISTORICAL_216')must(captured.rows.length===predecessorInventoryCount,'normal_inventory_predecessor_count');
        else{
          assertForwardNormalInventory(captured.rows,predecessorInventoryCount);
          const finalSurface=sort(await query('forward_surface_final',SURFACE_SQL));
          assertForwardDelta(forwardPreimage,captured.metadata,forwardSurfacePreimage,finalSurface);
          write(stage+'-forward-surface.json',finalSurface);
        }
        const inventory_sha256=hash(canon(captured.metadata));
        const recovery_inventory=write(stage+'-recovery-inventory.json',{
          schema:'custodial.normal-recovery-inventory-observation.v1',classification:'NORMAL_INVENTORY_OBSERVED_NOT_ACCEPTED',
          source:m.source,runner_files:m.runner_files,target:m.target,catalog_fingerprint:fingerprint,query_sha256,
          required_surface:m.required_surface,required_surface_sha256:hash(canon(m.required_surface)),
          count:captured.rows.length,predecessor_inventory_count:predecessorInventoryCount,inventory_sha256,raw_observation,...captured,
          engine_executed:!fake,execution:fake?'FAKE_SUBPROCESS_UNIT_ONLY':'OWNED_SYNTHETIC_ENGINE',
          authority_configured:false,independently_accepted:false,production:false,release_admission:false
        });
        result={status:'NORMAL_CATALOG_OBSERVED_NOT_ACCEPTED',fingerprint,recovery_inventory:{...recovery_inventory,count:captured.rows.length,inventory_sha256,query_sha256}};
      }
      else{
        phase='official_fixture';
        const code=`const {verifyStaticWeeklySplashSeasonOfficialPaths}=await import(${JSON.stringify(new URL('../'+OFFICIAL_FIXTURE,import.meta.url).href)});console.log(JSON.stringify(await verifyStaticWeeklySplashSeasonOfficialPaths({target:JSON.parse(process.argv[1])})));`;
        const official=await run(process.execPath,['--input-type=module','-e',code,JSON.stringify(m.target)],undefined,{timeout_ms:300000});
        write(stage+'-official-fixture.log',official.stdout+official.stderr);must(official.status===0,'official_fixture_failed');
        const officialReceipt=json(official.stdout.trim().split('\n').at(-1),'official_fixture_receipt');
        must(officialReceipt.status==='PASS'&&Number.isSafeInteger(officialReceipt.checks)&&officialReceipt.checks>0,'official_fixture_receipt');
        same(officialReceipt.target,{id:m.target.id,image:m.target.image,fixture_id:m.target.fixture_id,network:'none'},'official_fixture_target');
        must(officialReceipt.scope==='synthetic official dated exception and occurrence SCH022 paths'&&Array.isArray(officialReceipt.limitations),'official_fixture_scope');
        shape(officialReceipt.source,['publication_id','group_id','member_id','baseline_projection_id','accepted_projection_id','repaired_projection_id'],'official_fixture_source');
        must(Object.values(officialReceipt.source).every(x=>UUID.test(x)),'official_fixture_source');
        await sql('synthetic_seed',seedSQL(m));
        same(await query('seed_readback',`select jsonb_build_object('active_work',exists(select 1 from public.sessions where id=${q(m.seed.session)} and employee_id=${q(m.seed.employee)} and device_id=${q(m.seed.device)} and status='active'),'response',exists(select 1 from public.completion_responses where id=${q(m.seed.completion)} and session_id=${q(m.seed.session)} and client_completion_id=${q(m.seed.completion_operation)}),'work_ticket',exists(select 1 from public.maintenance_tickets where id=${q(m.seed.work_ticket)} and status='open'),'feedback',exists(select 1 from public.system_feedback_items f join public.system_feedback_email_intents i on i.feedback_id=f.id where f.id=${q(m.seed.feedback)} and f.operation_id=${q(m.seed.feedback_operation)} and i.state='queued' and i.attempt_id is null));`),{active_work:true,response:true,work_ticket:true,feedback:true},'seed_original_identity');
        const inventory=sort(await query('inventory_observed',INVENTORY_SQL)),surface=sort(await query('surface_observed',SURFACE_SQL));
        write(stage+'-observed-inventory.json',inventory);write(stage+'-observed-surface.json',surface);
        same([...new Set(inventory.map(x=>x.kind))].sort(),RECOVERY_KINDS,'all_inventory_kinds_required');
        if(forwardProfile!=='HISTORICAL_216'){
          assertForwardMembership(inventory,predecessorInventoryCount,surface);
          assertForwardDelta(forwardPreimage,inventory,forwardSurfacePreimage,surface);
        }
        const required_resolution=await query('required_membership',requiredMembershipQuery(m.required_surface,surface,inventory));
        write(stage+'-required-membership.json',{required:m.required_surface,required_sha256:hash(canon(m.required_surface)),resolution:required_resolution,independently_accepted:false});
        assertRequiredMembership(m.required_surface,surface,inventory,required_resolution);
        const protected_rows=await snapshots();write(stage+'-observed-protected.json',protected_rows);must(protected_rows.every((x,i)=>x.relation===m.protected_relations[i]&&Number.isSafeInteger(x.count)&&x.count>=0&&HEX.test(x.sha256)),'snapshot_shape');
        for(const table of SEED_TABLES)must(protected_rows.find(x=>x.relation===table)?.count>0,'seed_snapshot_populated');
        result={status:'OBSERVED_NOT_ACCEPTED',inventory,surface,protected_rows,required_surface:m.required_surface,required_surface_sha256:hash(canon(m.required_surface)),required_resolution,seed:m.seed,manager_id:m.seed.manager,official_receipt:officialReceipt,fingerprint:await catalog('prepared'),cleanup_lease:m.cleanup_lease};
      }
    }else{
      const bytes=io.read(join(m.output_dir,m.prepared.file));must(hash(bytes)===m.prepared.sha256,'prepared_hash');const prior=json(bytes.toString(),'prepared_json');
      must(prior.status==='OBSERVED_NOT_ACCEPTED'&&prior.stage==='no-auto-prepare'&&prior.engine_executed===!fake,'prepared_classification');
      same(prior.source,m.source,'prepared_source');same(prior.target,m.target,'prepared_target');same(prior.seed,m.seed,'prepared_seed');same(prior.required_surface,m.required_surface,'prepared_required');same(prior.cleanup_lease,m.cleanup_lease,'prepared_lease');
      must(prior.required_surface_sha256===hash(canon(m.required_surface)),'prepared_requirement_digest');
      assertRequiredMembership(m.required_surface,prior.surface,prior.inventory,prior.required_resolution);
      same(prior.runner_files,m.runner_files,'prepared_runner');same(prior.predecessor_fixture,m.predecessor_fixture,'prepared_predecessor');same(prior.official_fixture,m.official_fixture,'prepared_official_fixture');
      same(prior.inventory,m.probe_manifest.inventory,'independent_inventory_binding');same(prior.surface,m.probe_manifest.surface,'independent_surface_binding');same(prior.protected_rows,m.probe_manifest.protected_rows,'independent_protected_binding');
      leased=true;const protectedBefore=await snapshots();same(protectedBefore,m.probe_manifest.protected_rows,'prepared_rows_changed');
      const manifest=write(stage+'-root-bound-probe-manifest.json',m.probe_manifest);phase='probe';
      const proof=await run(process.execPath,[join(root,'scripts/current-release-recovery-probe.mjs'),'--manifest',join(m.output_dir,manifest.file)],undefined,{timeout_ms:900000});
      write(stage+'-probe.stdout.log',proof.stdout);write(stage+'-probe.stderr.log',proof.stderr);
      if(proof.status!==0){try{pending_control=JSON.parse(proof.stderr.trim()).pending_control||null}catch{}throw new Error('probe_failed')}
      const receipt=json(proof.stdout.trim(),'probe_receipt');assertProbeReceipt(receipt,m,fake);
      same(await snapshots(),protectedBefore,'post_probe_protected_rows');const fingerprint=await catalog('restored');must(fingerprint===prior.fingerprint,'restored_catalog_changed');
      result={status:'SYNTHETIC_PROBE_COMPLETED_NOT_RELEASE_ADMITTED',probe_receipt:receipt,fingerprint,protected_rows:protectedBefore};
    }
    await inspect();same(io.source(root),{source:m.source,runner_files:m.runner_files},'source_changed_during_run');checkSignal();
    result={schema:'custodial.current-recovery-replay-receipt.v1',...result,stage,source:m.source,runner_files:m.runner_files,target:m.target,required_surface:m.required_surface,required_surface_sha256:hash(canon(m.required_surface)),official_fixture:m.official_fixture,predecessor_fixture:m.predecessor_fixture,engine_executed:!fake,execution:fake?'FAKE_SUBPROCESS_UNIT_ONLY':'OWNED_SYNTHETIC_ENGINE',production:false,release_admission:false,artifacts:[...artifacts]};
    write(stage+'-receipt.json',result);retain=m.stage==='prepare'&&m.lane==='no-auto';
  }catch(caught){error=caught;if(outputReady)try{write(stage+'-failure-'+randomUUID()+'.json',{schema:'custodial.current-recovery-replay-failure.v1',code:/^[a-z0-9_]+$/.test(caught.message)?caught.message:'runner_failed',phase,target:m.target,source:m.source,engine_executed:!fake,pending_control,release_admission:false})}catch{}}
  finally{if(leased&&!retain){try{await cleanup()}catch(cleanupError){error=error||cleanupError;try{write(stage+'-cleanup-failure-'+randomUUID()+'.json',{code:'cleanup_not_confirmed',container_id:m.target.id,fixture_id:m.target.fixture_id,original_error:error.message,release_admission:false})}catch{}}}}
  if(error)throw error;return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const abort=new AbortController();const stop=()=>abort.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{must(process.argv.length===4&&process.argv[2]==='--plan','usage_local_plan_only');const path=process.argv[3];must(!/^[a-z]+:\/\//i.test(path),'plan_url_forbidden');const bytes=readFileSync(path);must(bytes.length<=8*1024*1024,'plan_size');console.log(JSON.stringify(await runRecoveryReplay(json(bytes.toString(),'plan_json'),{signal:abort.signal})));}
  catch(error){console.error(JSON.stringify({schema:'custodial.current-recovery-replay-cli-failure.v1',code:/^[a-z0-9_]+$/.test(error.message)?error.message:'runner_failed',release_admission:false}));process.exitCode=1}
  finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)}
}
