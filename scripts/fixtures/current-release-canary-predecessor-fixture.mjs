import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Fixed synthetic transaction challenges, never a generic SQL/production route.
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const FINAL='20261003220000_current_release_authority_completion.sql';
const IMAGE='sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const OLD='09812c2615f1f9176eadd54bfd4f60395648ea75f2cad0ebf1a6cb458f900aac';
const LIVE='23cb9bb81091860d7e5bd6b629db2f4f385994bcdbdbf7776392128cd9b570ef';
const CLOCK_ALIAS='custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean)';
const CLOCK='public.'+CLOCK_ALIAS;
const digest=b=>createHash('sha256').update(b).digest('hex');
const DOCKER=['--host','unix:///var/run/docker.sock'];
function keys(value,expected){assert.ok(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),[...expected].sort());}
function command(args,input){
 return spawnSync('docker',[...DOCKER,...args],{input,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024,
  env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
}
function primaryMigrationError(stderr){
 if(typeof stderr!=='string')return '';
 const line=stderr.split(/\r?\n/).find(value=>/^ERROR:\s/.test(value));
 return line?line.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,512):'';
}
function succeeded(result,label,{migrationControl=false}={}){
 assert.equal(result.error,undefined,label);
 // Only the fixed, hash-bound positive final-migration control may expose its
 // first primary ERROR line. Other SQL/inspect/setup failures keep finite labels.
 const primary=migrationControl&&result.status!==0?primaryMigrationError(result.stderr):'';
 assert.equal(result.status,0,primary?label+': '+primary:label);return result.stdout.trim();
}
function inspect(target){
 const list=JSON.parse(succeeded(command(['inspect','--type','container',target.name]),'owned target inspect'));
 assert.equal(list.length,1);const x=list[0];
 assert.equal(x.Name,'/'+target.name);assert.equal(x.Id,target.id);assert.equal(x.Image,target.image);
 assert.equal(x.State.Running,true);assert.equal(x.HostConfig.NetworkMode,'none');
 assert.deepEqual(x.HostConfig.PortBindings||{},{});
 assert.deepEqual(Object.keys(x.NetworkSettings.Networks),['none']);
 assert.ok(Object.values(x.NetworkSettings.Ports||{}).every(v=>v===null));
 assert.equal(x.Config.Labels['org.memphiszoo.custodial.fixture'],'synthetic');
 assert.equal(x.Config.Labels['org.memphiszoo.custodial.owner'],'/root');
 assert.equal(x.Config.Labels['org.memphiszoo.custodial.fixture-id'],target.fixture_id);
}
const SNAPSHOT=`select jsonb_build_object(
 'inventory_count',(select count(*) from public.custodial_release_authority_restore_inventory),
 'inventory_sha256',(select encode(extensions.digest(convert_to(string_agg(to_jsonb(i)::text,E'\\n'
   order by i.object_kind,i.object_identity),'UTF8'),'sha256'),'hex')
   from public.custodial_release_authority_restore_inventory i),
 'feedback_stored',(select definition_sha256 from public.custodial_release_authority_restore_inventory
   where object_kind='relation' and object_identity='public.system_feedback_email_intents'),
 'feedback_live',public.static_weekly_digest_text(public.custodial_release_authority_current_relation_definition('public.system_feedback_email_intents')),
 'immutable',(select tgenabled::text from pg_trigger
   where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   and tgname='trg_custodial_release_authority_restore_inventory_immutable'));`;

export function verifyCurrentReleaseCanaryPredecessor(input){
 keys(input,['target','migration']);const {target,migration}=input;
 keys(target,['name','id','image','fixture_id','database']);keys(migration,['file','sha256']);
 assert.match(target.name,/^mz_schema_rebuild_[a-zA-Z0-9_]+$/);assert.match(target.id,/^[a-f0-9]{64}$/);
 assert.equal(target.image,IMAGE);assert.equal(target.database,'postgres');
 assert.match(target.fixture_id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.equal(migration.file,FINAL);assert.match(migration.sha256,/^[a-f0-9]{64}$/);
 const bytes=readFileSync(resolve(ROOT,'supabase/migrations',FINAL));assert.equal(digest(bytes),migration.sha256);
 const source=bytes.toString();assert.equal([...source.matchAll(/^begin;$/gm)].length,1);
 assert.equal([...source.matchAll(/^commit;$/gm)].length,1);assert.match(source,/\ncommit;\s*$/);
 assert.ok(source.includes(OLD)&&source.includes(LIVE),'exact pinned Feedback predecessors');
 // The only outer transaction boundary is moved into this test transaction.
 // Any raised exception terminates psql and connection-close rolls back ALL DDL.
 const body=source.replace(/^begin;$/m,'').replace(/^commit;\s*$/m,'');
 inspect(target);
 const args=['exec','-i',target.id,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse','-U','supabase_admin','-d','postgres'];
 const run=sql=>command(args,'set client_min_messages=warning;set statement_timeout=60000;set lock_timeout=5000;\n'+sql);
 const snapshot=()=>JSON.parse(succeeded(run(SNAPSHOT),'snapshot query'));
  const before=snapshot();assert.equal(before.feedback_stored,OLD);assert.equal(before.feedback_live,LIVE);
  assert.equal(before.immutable,'O');assert.ok(Number.isSafeInteger(before.inventory_count)&&before.inventory_count>0);
 const functionPreimage=JSON.parse(succeeded(run(`select jsonb_build_object('count',count(*),'exact',bool_and(
   definition_sha256=public.static_weekly_digest_text(definition_sql)
   and definition_sql=pg_get_functiondef('public.static_weekly_sch022_work_witness(date,jsonb)'::regprocedure)))
   from public.custodial_release_authority_restore_inventory
   where object_kind='function' and case when object_kind='function' then to_regprocedure(object_identity) end
     ='public.static_weekly_sch022_work_witness(date,jsonb)'::regprocedure;`),'required function preimage'));
 assert.ok(functionPreimage.count>0);assert.equal(functionPreimage.exact,true,'no preexisting function fault credit');
 const clockSnapshot=()=>JSON.parse(succeeded(run(`select jsonb_build_object(
  'count',count(*),'qualified_count',count(*) filter(where object_identity='${CLOCK}'),
  'exact',bool_and(definition_sha256=public.static_weekly_digest_text(definition_sql)
   and definition_sql=public.custodial_release_authority_current_grant_definition(object_identity)),
  'live_sha256',public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition('${CLOCK}')),
  'function_sha256',public.static_weekly_digest_text(pg_get_functiondef('${CLOCK}'::regprocedure)),
  'anon_execute',has_function_privilege('anon','${CLOCK}','EXECUTE'))
  from public.custodial_release_authority_restore_inventory where object_kind='grant'
   and case when object_kind='grant' and position('(' in object_identity)>0
    then to_regprocedure(object_identity) end='${CLOCK}'::regprocedure;`),'exact clock grant snapshot'));
 const clockBefore=clockSnapshot();assert.equal(clockBefore.count,1);assert.equal(clockBefore.qualified_count,1);
 assert.equal(clockBefore.exact,true,'no preexisting clock grant fault credit');assert.equal(clockBefore.anon_execute,false);
 assert.match(clockBefore.live_sha256,/^[a-f0-9]{64}$/);assert.match(clockBefore.function_sha256,/^[a-f0-9]{64}$/);
 const rollbackExact=label=>{assert.deepEqual(snapshot(),before,label);assert.deepEqual(clockSnapshot(),clockBefore,label+' clock grant/function');};
 const off='alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;';
 const on='alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;';
 // This one fixed additional alias resolves to the exact same function. Its
 // grant SQL deliberately uses its own spelling, just as the owning renderer does.
 const validAliasSetup=off+`do $alias$ declare ord integer;definition text;begin
  if to_regprocedure('${CLOCK_ALIAS}') is distinct from '${CLOCK}'::regprocedure
   or exists(select 1 from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity='${CLOCK_ALIAS}')
   then raise exception 'clock grant alias setup identity changed';end if;
  definition:=public.custodial_release_authority_current_grant_definition('${CLOCK_ALIAS}');
  if definition is null or definition=public.custodial_release_authority_current_grant_definition('${CLOCK}')
   then raise exception 'clock grant alias setup serialization unchanged';end if;
  select n into strict ord from generate_series(900001,999998) n
   where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(ord,'grant','${CLOCK_ALIAS}',definition,public.static_weekly_digest_text(definition));
  if (select count(*) from public.custodial_release_authority_restore_inventory where object_kind='grant'
    and object_identity in('${CLOCK}','${CLOCK_ALIAS}') and definition_sha256=public.static_weekly_digest_text(definition_sql)
    and definition_sql=public.custodial_release_authority_current_grant_definition(object_identity))<>2
   then raise exception 'clock grant alias setup was not exact';end if;
 end $alias$;`+on;
 // A valid second alias must pass the WHOLE final migration first, not merely
 // be insertable. Roll back the successful control before injecting corruption.
 succeeded(run('begin;'+validAliasSetup+'\n'+body+'\nrollback;'),'valid clock grant alias final migration control',{migrationControl:true});
 rollbackExact('valid clock grant alias control rollback');
 const clockGrantReason='Current release required grant recovery drift: '+CLOCK_ALIAS;
 const cases=[
  {id:'captured_feedback_digest_changed',setup:off+"update public.custodial_release_authority_restore_inventory set definition_sha256=repeat('0',64) where object_kind='relation' and object_identity='public.system_feedback_email_intents';"+on,
   reason:'Feedback relation captured predecessor changed'},
  {id:'live_feedback_shape_changed',setup:'alter table public.system_feedback_email_intents add column current_recovery_unapproved_probe boolean;',
   reason:'Feedback relation current predecessor changed'},
  {id:'inventory_immutability_missing',setup:off,reason:'Current release recovery inventory immutability unavailable'},
  {id:'later_surface_failure_rolls_back_feedback_rebind',setup:off+
   "update public.custodial_release_authority_restore_inventory set definition_sha256=repeat('0',64) where object_kind='function' and case when object_kind='function' then to_regprocedure(object_identity) end='public.static_weekly_sch022_work_witness(date,jsonb)'::regprocedure;"+on,
   reason:'Current release required function recovery drift: static_weekly_sch022_work_witness(date,jsonb)'},
  {id:'captured_clock_grant_digest_changed',setup:off+
   `update public.custodial_release_authority_restore_inventory set definition_sha256=repeat('0',64) where object_kind='grant' and object_identity='${CLOCK}';`+on,
   reason:clockGrantReason},
  {id:'live_clock_grant_changed',setup:`grant execute on function ${CLOCK} to anon;
   do $live$ begin if not has_function_privilege('anon','${CLOCK}','EXECUTE') then raise exception 'clock live grant setup absent';end if;end $live$;`,
   reason:clockGrantReason},
  {id:'second_equivalent_clock_grant_alias_corrupted',setup:validAliasSetup+off+
   // Keep the preferred unqualified alias correct. Corrupt the other exact-OID
   // row so selecting only one good canonical alias cannot earn a pass.
   `update public.custodial_release_authority_restore_inventory set definition_sha256=repeat('0',64) where object_kind='grant' and object_identity='${CLOCK}';`+on,
   reason:clockGrantReason}
 ];
 const results=[];
 for(const c of cases){
  // First prove that the fault itself is executable, then roll it back. An
  // unrelated setup error must not masquerade as the intended rejection.
  succeeded(run('begin;'+c.setup+'rollback;'),'fault setup '+c.id);
  rollbackExact('fault setup rollback '+c.id);
  const result=run('begin;'+c.setup+'\n'+body+'\nrollback;');
  assert.equal(result.error,undefined,'no timeout/spawn failure '+c.id);
  assert.notEqual(result.status,0,'migration must reject '+c.id);
  assert.ok(result.stderr.includes('ERROR:  '+c.reason),'exact migration rejection '+c.id);
  rollbackExact('complete predecessor rollback '+c.id);
  results.push({id:c.id,rejected:true,expected_reason:c.reason,rollback_exact:true});
 }
 inspect(target);assert.equal(digest(readFileSync(resolve(ROOT,'supabase/migrations',FINAL))),migration.sha256);
 const receipt={schema:'custodial.current-release-canary-predecessor-receipt.v1',status:'PASS',checks:7,
  engine_executed:true,synthetic:true,production:false,target,migration,
  source_sha256:digest(readFileSync(fileURLToPath(import.meta.url))),predecessor:before,
  cases:results,successful_final_migration_applied:false,authority_configured:false,container_retained:true};
 return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try {assert.equal(process.argv.length,2);const b=readFileSync(0);assert.ok(b.length<4096);
  console.log(JSON.stringify(verifyCurrentReleaseCanaryPredecessor(JSON.parse(b.toString()))));
 }catch(error){console.error(JSON.stringify({schema:'custodial.current-release-canary-predecessor-failure.v1',status:'FAIL',reason:String(error.message),release_admission:false}));process.exitCode=1;}
}
