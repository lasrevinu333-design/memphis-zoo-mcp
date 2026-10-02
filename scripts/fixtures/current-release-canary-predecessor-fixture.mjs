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
const digest=b=>createHash('sha256').update(b).digest('hex');
const DOCKER=['--host','unix:///var/run/docker.sock'];
function keys(value,expected){assert.ok(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),[...expected].sort());}
function command(args,input){
 return spawnSync('docker',[...DOCKER,...args],{input,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024,
  env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
}
function succeeded(result,label){assert.equal(result.error,undefined,label);assert.equal(result.status,0,label);return result.stdout.trim();}
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
 const args=['exec','-i',target.id,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'];
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
 const off='alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;';
 const on='alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;';
 const cases=[
  {id:'captured_feedback_digest_changed',setup:off+"update public.custodial_release_authority_restore_inventory set definition_sha256=repeat('0',64) where object_kind='relation' and object_identity='public.system_feedback_email_intents';"+on,
   reason:'Feedback relation captured predecessor changed'},
  {id:'live_feedback_shape_changed',setup:'alter table public.system_feedback_email_intents add column current_recovery_unapproved_probe boolean;',
   reason:'Feedback relation current predecessor changed'},
  {id:'inventory_immutability_missing',setup:off,reason:'Current release recovery inventory immutability unavailable'},
  {id:'later_surface_failure_rolls_back_feedback_rebind',setup:off+
   "update public.custodial_release_authority_restore_inventory set definition_sha256=repeat('0',64) where object_kind='function' and case when object_kind='function' then to_regprocedure(object_identity) end='public.static_weekly_sch022_work_witness(date,jsonb)'::regprocedure;"+on,
   reason:'Current release required function recovery drift: static_weekly_sch022_work_witness(date,jsonb)'}
 ];
 const results=[];
 for(const c of cases){
  // First prove that the fault itself is executable, then roll it back. An
  // unrelated setup error must not masquerade as the intended rejection.
  succeeded(run('begin;'+c.setup+'rollback;'),'fault setup '+c.id);
  assert.deepEqual(snapshot(),before,'fault setup rollback '+c.id);
  const result=run('begin;'+c.setup+'\n'+body+'\nrollback;');
  assert.equal(result.error,undefined,'no timeout/spawn failure '+c.id);
  assert.notEqual(result.status,0,'migration must reject '+c.id);
  assert.ok(result.stderr.includes('ERROR:  '+c.reason),'exact migration rejection '+c.id);
  assert.deepEqual(snapshot(),before,'complete predecessor rollback '+c.id);
  results.push({id:c.id,rejected:true,expected_reason:c.reason,rollback_exact:true});
 }
 inspect(target);assert.equal(digest(readFileSync(resolve(ROOT,'supabase/migrations',FINAL))),migration.sha256);
 const receipt={schema:'custodial.current-release-canary-predecessor-receipt.v1',status:'PASS',checks:4,
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
