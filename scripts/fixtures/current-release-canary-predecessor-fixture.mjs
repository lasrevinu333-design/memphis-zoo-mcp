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
// Independently pinned from root's UNVALIDATED NORMAL216 observation a21f8d6f.
// These are six fixed serialization corrections, never arbitrary recapture.
const SERIALIZED_GRANTS=[
 ['canary','custodial_release_canary_authority_surface()','public.custodial_release_canary_authority_surface()',1000073,'a843e6ab1177177e039163a3d520b95d6552de8105474a48e390b25302692f48','b7d461eda320ec386b55ce3490063e09848a83723999acdd741e83cad0460498'],
 ['incumbency','public.static_weekly_v3_assert_draft_incumbency(uuid)','static_weekly_v3_assert_draft_incumbency(uuid)',1000199,'d6f202a5c174036cf978cebd88e2274f5b54039dedf614f4808086701cb8305a','8f5efab4cf9957046185fc19bf9bfb23be3c48900e414f9422be0e05baaba1ca'],
 ['hydrate','public.static_weekly_v4_hydrate_compiler_source(jsonb,date)','static_weekly_v4_hydrate_compiler_source(jsonb,date)',1000198,'57b252cee39b5f763518cb957528a6fea8eabae017351f0a4c7483d62df9598a','cd7d80e0f473c00254a875badd84ec701b370489bd1eb64dbe568b72784e08af'],
 ['materialize','public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)',950028,'cfea7c5bfcf61a00e64b56e38e1c98f93d7a973c373205b89bc3b708aad0902b','419abb490483777437126a3593d601da11e9d3db32b777e21be802291a97ce6b'],
 ['schedule_base','public.static_weekly_v6_read_schedule_segments_dated_base(date)','static_weekly_v6_read_schedule_segments_dated_base(date)',950168,'4bbcbf22890a56bb56ff4d05a6ba7c95bbac648b755b22291267589d8261aabd','6161a03a11c95bbe898fc4b27ae54d9ba3e66eade32fc5fc29e3b75da1f85201'],
 ['lunch_base','public.static_weekly_v8_read_lunch_segments_dated_base(date)','static_weekly_v8_read_lunch_segments_dated_base(date)',950170,'8eb43bf71ab7c0bcb60bbf818bd54d77d43a4163fcfa19a4f3962948a7ad3f80','a38bf3e78db3a49335dd315a33ad98605deeea8638c8d6596a7bc82402795b41']
].map(([key,identity,reset,order,prior,current])=>({key,identity,reset,order,prior,current}));
const PRIVATE_GRANT=SERIALIZED_GRANTS[1],PRIVATE_ALIAS=PRIVATE_GRANT.reset;
const EVENT_COLUMNS=[
 ['start_instant_utc','106a679f7e85be9e039b7f6f07c223f81d1041868318a025d650524970945c7c'],
 ['end_instant_utc','47396e92efba0a4cbb9ab0526e727a3f029fe33452aefdda467c97b7f3e2c732'],
 ['superseded_by_event_id','ae183c23db1033315fe196d68acbda9677198f6cc01be57c8c6a04fdb7703293'],
 ['superseded_at','6d31d29fd9bbd6cd61dafd1254ee7a589a37a2b363eb478f59e0592743f4abc5'],
 ['superseded_by_manager_id','08e535a928adfa5aa4a102c36dff168ad3702da9592236d7ec6d459d521636f0'],
 ['supersession_request_digest','85d1ad1a2143ca04759614e7912688650eb80335e22f2877cafc073386c77df0']
].map(([name,sha256],i)=>({identity:'public.events_app_events:'+name,order:202130+i,sha256}));
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const SIX_VALUES=SERIALIZED_GRANTS.map(p=>`(${quote(p.identity)},${quote(p.reset)})`).join(',');
const COLUMN_IDENTITIES=EVENT_COLUMNS.map(p=>quote(p.identity)).join(',');
const COLUMN_ROWS=`select jsonb_build_object('range_occupants',(select count(*) from public.custodial_release_authority_restore_inventory where restore_order between 202130 and 202135),
 'rows',coalesce(jsonb_agg(jsonb_build_object('identity',i.object_identity,'order',i.restore_order,'stored',i.definition_sha256,
 'computed',public.static_weekly_digest_text(i.definition_sql),
 'live',public.static_weekly_digest_text(public.custodial_release_authority_current_column_definition(i.object_identity)),
 'preserved_sha256',public.static_weekly_digest_text((to_jsonb(i)-'restore_order')::text)) order by i.object_identity),'[]'::jsonb))
 from public.custodial_release_authority_restore_inventory i where object_kind='column' and object_identity in (${COLUMN_IDENTITIES})`;
const SIX_ROWS=`select coalesce(jsonb_agg(jsonb_build_object('identity',i.object_identity,'order',i.restore_order,
 'stored',i.definition_sha256,'computed',public.static_weekly_digest_text(i.definition_sql),
 'live',public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(i.object_identity)),
 'same_oid',to_regprocedure(i.object_identity)=to_regprocedure(w.old_reset),
 'function_sha256',case when i.object_identity='custodial_release_canary_authority_surface()' then null
  else public.static_weekly_digest_text(pg_get_functiondef(to_regprocedure(i.object_identity))) end)
 order by i.object_identity),'[]'::jsonb)
 from public.custodial_release_authority_restore_inventory i join (values ${SIX_VALUES}) w(identity,old_reset)
 on i.object_kind='grant' and i.object_identity=w.identity`;
const POSITIVE_STATE=`select jsonb_build_object('six',(${SIX_ROWS}),'columns',(${COLUMN_ROWS}),
 'count',(select count(*) from public.custodial_release_authority_restore_inventory),
 'identity_order_sha256',(select public.static_weekly_digest_text(string_agg(jsonb_build_array(object_kind,object_identity,restore_order)::text,E'\\n' order by object_kind,object_identity)) from public.custodial_release_authority_restore_inventory where not (object_kind='column' and object_identity in (${COLUMN_IDENTITIES}))),
 'other_rows_sha256',(select public.static_weekly_digest_text(string_agg(to_jsonb(i)::text,E'\\n' order by object_kind,object_identity))
  from public.custodial_release_authority_restore_inventory i where not (
   (object_kind='grant' and object_identity in (${SERIALIZED_GRANTS.map(p=>quote(p.identity)).join(',')}))
   or (object_kind='column' and object_identity in (${COLUMN_IDENTITIES}))
   or (object_kind='relation' and object_identity='public.system_feedback_email_intents')
   or (object_kind='function' and case when object_kind='function' then to_regprocedure(object_identity) end='public.custodial_release_canary_authority_surface()'::regprocedure))),
 'feedback_stored',(select definition_sha256 from public.custodial_release_authority_restore_inventory where object_kind='relation' and object_identity='public.system_feedback_email_intents'),
 'immutable',(select tgenabled::text from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable'));`;
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
 for(const p of SERIALIZED_GRANTS)assert.ok(source.includes(p.identity)&&source.includes(p.reset)&&source.includes(p.prior)&&source.includes(p.current),'exact six grant correction source pins');
 for(const p of EVENT_COLUMNS)assert.ok(source.includes(p.identity)&&source.includes(p.sha256),'exact six column source pins');
 assert.ok(source.indexOf('end $feedback_relation$;')<source.indexOf('do $grant_serialization$')&&source.indexOf('end $grant_serialization$;')<source.indexOf('do $current_surface$'),'six-grant transaction chronology');
 assert.ok(source.indexOf('end $grant_serialization$;')<source.indexOf('do $event_column_order$')&&source.indexOf('end $event_column_order$;')<source.indexOf('do $current_surface$'),'Event column order transaction chronology');
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
 const sixSnapshot=()=>JSON.parse(succeeded(run(SIX_ROWS+';'),'six exact grant preimage'));
 const sixBefore=sixSnapshot();
 function assertSix(rows,{corrected=false}={}){
  assert.equal(rows.length,6,'exact six grant rows');
  assert.deepEqual(rows.map(r=>r.identity).sort(),SERIALIZED_GRANTS.map(p=>p.identity).sort(),'six exact grant identity set');
  for(const p of SERIALIZED_GRANTS){const r=rows.find(r=>r.identity===p.identity);assert.equal(r.order,p.order);assert.equal(r.same_oid,true);
   assert.equal(r.stored,corrected?p.current:p.prior);assert.equal(r.computed,r.stored);assert.equal(r.live,p.current);
   if(p.key==='canary')assert.equal(r.function_sha256,null);else assert.match(r.function_sha256,/^[a-f0-9]{64}$/);
  }
 }
 assertSix(sixBefore);
 const columnSnapshot=()=>JSON.parse(succeeded(run(COLUMN_ROWS+';'),'six Event column preimage'));
 const columnsBefore=columnSnapshot();
 function assertColumns(observed,{corrected=false}={}){
  assert.equal(observed.range_occupants,6);assert.equal(observed.rows.length,6);
  assert.deepEqual(observed.rows.map(r=>r.identity).sort(),EVENT_COLUMNS.map(p=>p.identity).sort());
  assert.deepEqual(observed.rows.map(r=>r.order).sort((a,b)=>a-b),[202130,202131,202132,202133,202134,202135]);
  for(const p of EVENT_COLUMNS){const r=observed.rows.find(r=>r.identity===p.identity);if(corrected)assert.equal(r.order,p.order);
   assert.equal(r.stored,p.sha256);assert.equal(r.computed,p.sha256);assert.equal(r.live,p.sha256);assert.match(r.preserved_sha256,/^[a-f0-9]{64}$/);
  }
 }
 assertColumns(columnsBefore);
 const rollbackExact=label=>{assert.deepEqual(snapshot(),before,label);assert.deepEqual(clockSnapshot(),clockBefore,label+' clock grant/function');assert.deepEqual(sixSnapshot(),sixBefore,label+' all six live/stored grants/functions');assert.deepEqual(columnSnapshot(),columnsBefore,label+' all original column orders');};
 function positiveSixControl(label,setup,{permutedColumns=false}={}){
  const text=succeeded(run('begin;'+setup+'\n'+POSITIVE_STATE+'\n'+body+'\n'+POSITIVE_STATE+'\nrollback;'),label,{migrationControl:true});
  const states=text.split('\n').filter(Boolean).map(row=>JSON.parse(row));assert.equal(states.length,2,'before and after positive control state');
  const [initial,completed]=states;assertSix(initial.six);assertSix(completed.six,{corrected:true});
  assertColumns(initial.columns);assertColumns(completed.columns,{corrected:true});
  if(permutedColumns)assert.ok(initial.columns.rows.some(r=>r.order!==EVENT_COLUMNS.find(p=>p.identity===r.identity).order),'positive actually exercised column permutation');
  assert.equal(initial.count,before.inventory_count+1,'exact one legitimate alias added for positive control');
  for(const state of states)for(const field of ['identity_order_sha256','other_rows_sha256'])assert.match(state[field],/^[a-f0-9]{64}$/);
  assert.equal(completed.count,initial.count);assert.equal(completed.identity_order_sha256,initial.identity_order_sha256);
  assert.equal(completed.other_rows_sha256,initial.other_rows_sha256,'no unrelated recovery row mutation');
  assert.equal(initial.feedback_stored,OLD);assert.equal(completed.feedback_stored,LIVE);assert.equal(initial.immutable,'O');assert.equal(completed.immutable,'O');
  for(const row of completed.six){const original=initial.six.find(x=>x.identity===row.identity);assert.equal(row.live,original.live,'no live grant change');assert.equal(row.function_sha256,original.function_sha256,'no private function body change');}
  for(const row of completed.columns.rows)assert.equal(row.preserved_sha256,initial.columns.rows.find(r=>r.identity===row.identity).preserved_sha256,'column metadata except order unchanged');
  rollbackExact(label+' complete rollback');
 }
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
 positiveSixControl('valid clock grant alias final migration control',validAliasSetup);
 const privateAliasSetup=off+`do $alias$ declare ord integer;definition text;begin
  if to_regprocedure('${PRIVATE_ALIAS}') is distinct from '${PRIVATE_GRANT.identity}'::regprocedure
   or exists(select 1 from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity='${PRIVATE_ALIAS}')
   then raise exception 'private grant alias setup identity changed';end if;
  definition:=public.custodial_release_authority_current_grant_definition('${PRIVATE_ALIAS}');
  if definition is null then raise exception 'private grant alias definition absent';end if;
  select n into strict ord from generate_series(900001,999998) n where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(ord,'grant','${PRIVATE_ALIAS}',definition,public.static_weekly_digest_text(definition));
  if not exists(select 1 from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity='${PRIVATE_ALIAS}'
   and definition_sql=public.custodial_release_authority_current_grant_definition(object_identity)
   and definition_sha256=public.static_weekly_digest_text(definition_sql)) then raise exception 'private alias setup not exact';end if;
 end $alias$;`+on;
 const permutedColumns=off+`update public.custodial_release_authority_restore_inventory i set restore_order=w.expected_order
  from (values ${EVENT_COLUMNS.map(p=>`(${quote(p.identity)},${404265-p.order})`).join(',')}) w(identity,expected_order)
  where i.object_kind='column' and i.object_identity=w.identity;`+on;
 positiveSixControl('valid six-grant private alias final migration control',privateAliasSetup+permutedColumns,{permutedColumns:true});
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
   reason:clockGrantReason},
 ...SERIALIZED_GRANTS.map(p=>({id:'captured_serialized_grant_'+p.key+'_changed',setup:off+
   `update public.custodial_release_authority_restore_inventory set definition_sha256=repeat('0',64) where object_kind='grant' and object_identity=${quote(p.identity)};`+on,
   reason:'Current grant serialization captured predecessor changed: '+p.identity})),
 {id:'live_serialized_private_grant_changed',setup:`grant execute on function ${PRIVATE_GRANT.identity} to anon;
   do $live$ begin if not has_function_privilege('anon','${PRIVATE_GRANT.identity}','EXECUTE') then raise exception 'private live grant fault absent';end if;end $live$;`,
   reason:'Current grant serialization live predecessor changed: '+PRIVATE_GRANT.identity},
 {id:'serialized_reset_redirected_with_recomputed_digest',setup:off+
   `do $redirect$ begin if to_regprocedure('${PRIVATE_ALIAS}')='${CLOCK}'::regprocedure then raise exception 'redirect fault target not distinct';end if;end $redirect$;
   update public.custodial_release_authority_restore_inventory
    set definition_sql=replace(definition_sql,quote_literal('${PRIVATE_ALIAS}'),quote_literal('${CLOCK}')),
        definition_sha256=public.static_weekly_digest_text(replace(definition_sql,quote_literal('${PRIVATE_ALIAS}'),quote_literal('${CLOCK}')))
    where object_kind='grant' and object_identity='${PRIVATE_GRANT.identity}';`+on,
   reason:'Current grant serialization captured predecessor changed: '+PRIVATE_GRANT.identity},
 {id:'second_equivalent_serialized_grant_alias_corrupted',setup:privateAliasSetup+off+
   `update public.custodial_release_authority_restore_inventory set definition_sha256=repeat('0',64) where object_kind='grant' and object_identity='${PRIVATE_ALIAS}';`+on,
   reason:'Current grant serialization captured alias changed: '+PRIVATE_ALIAS},
 {id:'later_surface_failure_rolls_back_all_six_grants',setup:off+
   "update public.custodial_release_authority_restore_inventory set definition_sha256=repeat('0',64) where object_kind='function' and case when object_kind='function' then to_regprocedure(object_identity) end='public.static_weekly_sch022_work_witness(date,jsonb)'::regprocedure;"+on,
   reason:'Current release required function recovery drift: static_weekly_sch022_work_witness(date,jsonb)'},
 {id:'event_column_order_ownership_changed',setup:off+
   `update public.custodial_release_authority_restore_inventory set restore_order=202130 where object_kind='grant' and object_identity='${CLOCK}';`+on,
   reason:'Current Event column order captured scope changed'},
 {id:'event_column_definition_digest_changed',setup:off+
   `update public.custodial_release_authority_restore_inventory set definition_sha256=repeat('0',64) where object_kind='column' and object_identity='public.events_app_events:start_instant_utc';`+on,
   reason:'Current Event column order definition changed: public.events_app_events:start_instant_utc'},
 {id:'later_surface_failure_rolls_back_column_canonicalization',setup:permutedColumns+off+
   "update public.custodial_release_authority_restore_inventory set definition_sha256=repeat('0',64) where object_kind='function' and case when object_kind='function' then to_regprocedure(object_identity) end='public.static_weekly_sch022_work_witness(date,jsonb)'::regprocedure;"+on,
   reason:'Current release required function recovery drift: static_weekly_sch022_work_witness(date,jsonb)'}
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
 assert.equal(results.length,20,'seven original plus ten grant and three column-order challenges');
 const receipt={schema:'custodial.current-release-canary-predecessor-receipt.v1',status:'PASS',checks:20,
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
