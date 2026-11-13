import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const container=String(process.env.OCTOBER_RECOVERY_TEST_CONTAINER||'');
if(!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container))throw Error('Owned disposable test container required');
const migration=readFileSync(new URL('../supabase/migrations/20261002120000_october_dated_recovery_inventory_rebind.sql',import.meta.url),'utf8');
const body=migration.replace(/^begin;$/m,'').replace(/commit;\s*$/,'');
const afterOnly=process.argv.includes('--after-only');
const expected=[
  [
    "function",
    "mz_location_reminder_candidates(date,timestamp with time zone)"
  ],
  [
    "grant",
    "static_weekly_v8_read_lunch_segments(date)"
  ],
  [
    "trigger",
    "public.custodial_dated_activations.custodial_disaster_restore_mutation_fence"
  ],
  [
    "trigger",
    "public.custodial_dated_activations.dated_activation_immutable"
  ],
  [
    "trigger",
    "public.custodial_dated_occurrences.custodial_disaster_restore_mutation_fence"
  ],
  [
    "trigger",
    "public.custodial_dated_occurrences.dated_occurrence_immutable"
  ],
  [
    "trigger",
    "public.custodial_dated_publications.custodial_disaster_restore_mutation_fence"
  ],
  [
    "trigger",
    "public.custodial_dated_publications.dated_publication_complete"
  ],
  [
    "trigger",
    "public.custodial_dated_publications.dated_publication_immutable"
  ],
  [
    "trigger",
    "public.custodial_dated_receipts.custodial_disaster_restore_mutation_fence"
  ],
  [
    "trigger",
    "public.custodial_dated_receipts.dated_receipt_immutable"
  ],
  [
    "view",
    "public.v_location_dashboard_status"
  ],
  [
    "view",
    "public.v_memphis_area_schedule"
  ],
  [
    "view",
    "public.v_restroom_check_timers"
  ]
];
const secret='october-recovery-local-fixture-20261002-0123456789';
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
let checks=0;
function sql(input,{fail=false}={}){
 const r=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input,encoding:'utf8',maxBuffer:16*1024*1024});
 assert.equal(r.status===0,!fail,r.stderr||r.stdout);checks++;
 return fail?r.stderr:r.stdout.trim();
}
const inventory=()=>JSON.parse(sql("select jsonb_agg(jsonb_build_array(object_kind,object_identity,definition_sha256) order by object_kind,object_identity)::text from public.custodial_release_authority_restore_inventory;"));
const protectedTables=['sessions','completion_responses','custodial_dated_publications','custodial_dated_occurrences','custodial_dated_activations','custodial_dated_receipts','custodial_place_versions'];
const protectedState=()=>protectedTables.map(t=>[t,sql("select md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) from public."+t+" t;")]);
const faults=[
 ['reminder body',`do $fault$ begin execute replace(pg_get_functiondef('public.mz_location_reminder_candidates(date,timestamptz)'::regprocedure),'public.mz_verified_location_reminder_cycle(status.location_id,','public.mz_verified_visit_reminder_cycle(');end $fault$;`],
 ['trigger state',"alter table public.custodial_dated_activations disable trigger dated_activation_immutable;"],
 ['view state',"alter view public.v_memphis_area_schedule set (security_barrier=true);"],
 ['lunch grant',"grant execute on function public.static_weekly_v8_read_lunch_segments(date) to service_role;"],
 ['captured history',`alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 update public.custodial_release_authority_restore_inventory set definition_sha256=repeat('0',64) where object_kind='function' and object_identity='mz_location_reminder_candidates(date,timestamp with time zone)';
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;`]
];
const before=inventory(), dataBefore=protectedState();
if(!afterOnly){
 for(const [label,fault] of faults){
  const error=sql('begin; set local search_path=pg_catalog,public,extensions;'+fault+'\n'+body+'\nrollback;',{fail:true});
  assert.match(error,/October recovery (live|captured) predecessor changed/,'fault must reject '+label);checks++;
  assert.deepEqual(inventory(),before,'failed repair must be atomic: '+label);checks++;
 }
 sql(migration);
 const after=inventory();
 const beforeByIdentity=new Map(before.map(r=>[JSON.stringify(r.slice(0,2)),r[2]]));
 const changed=after.filter(r=>r[2]!==beforeByIdentity.get(JSON.stringify(r.slice(0,2)))).map(r=>r.slice(0,2));
 assert.deepEqual(changed.sort(),[...expected].sort(),'only the 14 exact captured records change');checks++;
 assert.equal(after.length,before.length,'no history row removed or duplicated');checks++;
}
sql("update public.custodial_backend_execution_config set execution_secret_digest=encode(extensions.digest(convert_to("+q(secret)+",'UTF8'),'sha256'),'hex'),enabled=true where config_key=true;");
const health=()=>JSON.parse(sql("select public.custodial_backend_authority_health("+q(secret)+")::text;"));
assert.equal(health().ok,true,'full existing authority health');checks++;
assert.deepEqual(protectedState(),dataBefore,'protected application data retained');checks++;
assert.equal(sql("select tgenabled from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable';"),'O');checks++;
const identities=expected.map(([kind,id])=>'('+q(kind)+','+q(id)+')').join(',');
const repair=`do $restore$ declare r record;begin for r in select definition_sql from public.custodial_release_authority_restore_inventory where (object_kind,object_identity) in (${identities}) order by restore_order loop execute r.definition_sql;end loop;end $restore$;`;
// Exercise captured recovery after real catalog faults, then roll back each
// disposable challenge. Health must fail BEFORE repair and pass AFTER repair.
for(const [label,fault] of faults.slice(0,4)){
 const result=sql('begin;set local search_path=pg_catalog,public,extensions;'+fault+
  " select public.custodial_backend_authority_health("+q(secret)+")->>'ok';"+repair+
  " select public.custodial_backend_authority_health("+q(secret)+")->>'ok';rollback;");
 assert.deepEqual(result.split('\n').filter(x=>x==='true'||x==='false'),['false','true'],'stored recovery must detect and repair '+label);checks++;
}
for(const role of ['anon','authenticated','service_role','static_weekly_control_plane']){
 assert.equal(sql("select has_function_privilege("+q(role)+",'public.static_weekly_v8_read_lunch_segments(date)','EXECUTE');"),'f','lunch reader remains denied '+role);checks++;
}
assert.equal(sql("select has_function_privilege('custodial_application_reader','public.static_weekly_v8_read_lunch_segments(date)','EXECUTE');"),'t');checks++;
assert.equal(sql("select bool_and(definition_sql=pg_get_functiondef('public.mz_location_reminder_candidates(date,timestamptz)'::regprocedure)) from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(object_identity)='public.mz_location_reminder_candidates(date,timestamptz)'::regprocedure;"),'t','all historical identity spellings restore the current reminder');checks++;
assert.deepEqual(protectedState(),dataBefore);checks++;
assert.equal(health().ok,true);checks++;
console.log(JSON.stringify({ok:true,mode:afterOnly?'after-only':'predecessor-and-repair',checks,scope_records:14,authority_health:true,protected_data_unchanged:true,container}));
