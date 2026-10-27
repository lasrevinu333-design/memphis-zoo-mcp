import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {EXPECTED_NOTIFICATION_PLAN_SOURCE_RELATIONS,testIncumbencyClosureSourceBoundary} from './recurring-notification-incumbency-closure-tests.mjs';
import {seedNormalNotificationPlanFixture} from './fixtures/notification-plan-fixture.mjs';
import {testNotificationPlanHttp} from './recurring-notification-plan-http-tests.mjs';
import {testOriginalNativePlanBindings,testOriginalNativeSourceConflicts} from './recurring-notification-original-bindings-database-tests.mjs';
const phaseBudget=Number(process.env.NOTIFICATION_PLAN_SQL_PHASE_BUDGET_MS);
assert.ok(Number.isFinite(phaseBudget)&&phaseBudget>0&&phaseBudget<=90_000,'original supervised SQL phase budget required');
const sqlPhaseDeadline=performance.now()+phaseBudget-process.uptime()*1000;
const socket=process.env.NOTIFICATION_PLAN_TEST_SOCKET,container=process.env.NOTIFICATION_PLAN_TEST_CONTAINER;
assert.match(socket??'',/^\/tmp\/mz-notification-plan-[a-zA-Z0-9_-]+$/);assert.match(container??'',/^mz_schema_rebuild_notification_plan_[0-9]+$/);
const inspected=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:3000}))[0];
assert.equal(inspected.HostConfig.NetworkMode,'none');assert.equal(Object.keys(inspected.HostConfig.PortBindings??{}).length,0);
const pool=new Pool({host:socket,database:'postgres',user:'supabase_admin',password:'postgres',max:3,connectionTimeoutMillis:3000});
const clients=await Promise.all([pool.connect(),pool.connect(),pool.connect()]),[c,writer,reader]=clients;
let checks=0,lastSuccessfulCheck='NONE';const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;lastSuccessfulCheck=label;};
const issueArgs=f=>[f.serviceDate,f.device,f.credential,f.employee,f.epoch,f.intent,f.delivery.targetDigest];
const issue=async(client,f)=>{await client.query('set local role service_role');const value=(await client.query('select public.static_weekly_v27_issue_recurring_notification_plan($1,$2,$3,$4,$5,$6,$7) result',issueArgs(f))).rows[0].result;await client.query('reset role');return value;};
const guard=client=>client.query('select public.static_weekly_v27_lock_notification_plan_sources()');
async function failure(client,work,codes,label){await client.query('savepoint expected_refusal');try{let error;try{await work();}catch(e){error=e;}assert.ok(error,label);assert.ok(codes.includes(error.code),label+': '+error?.code);checks++;lastSuccessfulCheck=label;}finally{await client.query('rollback to savepoint expected_refusal');await client.query('release savepoint expected_refusal');}}
async function pair(work){await writer.query('begin');await reader.query('begin');try{await writer.query("set local statement_timeout='3000ms'");await reader.query("set local statement_timeout='3000ms'");await work();}finally{await reader.query('rollback');await writer.query('rollback');}}
try{
 const f=await seedNormalNotificationPlanFixture({client:c,container});
 await c.query('begin');await c.query("set local statement_timeout='10000ms'");
 const guards=(await c.query(`select n.nspname||'.'||c.relname name,g.tgenabled,g.tgtype from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where g.tgname='custodial_recurring_notification_plan_source_fence' and g.tgfoid='public.static_weekly_v27_notification_plan_source_write_fence()'::regprocedure order by n.nspname,c.relname`)).rows;
 eq(guards.map(g=>g.name),EXPECTED_NOTIFICATION_PLAN_SOURCE_RELATIONS,'exact sorted53 schema-qualified full read-source identities');eq(guards.every(g=>g.tgenabled==='A'&&g.tgtype===62),true,'all53 ALWAYS statement INSERT UPDATE DELETE TRUNCATE including replica');
 const privateFence=(await c.query(`select p.proowner=current_user::regrole owner_matches,
  not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner) only_owner
  from pg_proc p where p.oid='public.static_weekly_v27_notification_plan_source_write_fence()'::regprocedure`)).rows;
 eq(privateFence,[{owner_matches:true,only_owner:true}],'actual new trigger function retained only its owner ACL');
 for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'])
  eq((await c.query("select has_function_privilege($1,'public.static_weekly_v27_notification_plan_source_write_fence()','EXECUTE') value",[role])).rows[0].value,false,'no private trigger RPC execute '+role);
 const originalTarget=JSON.stringify(f.delivery.target),envelope=await issue(c,f),body=envelope.body;
 eq([body.complete,body.receipt_eligible,body.intent_id,body.target_digest],[true,false,f.intent,f.delivery.targetDigest],'actual current complete issue');
 eq(JSON.stringify(f.delivery.target),originalTarget,'normal target bytes unchanged');assert.match(body.plan_read_id,/^[a-f0-9-]{36}$/);checks++;
 eq(body.source_counts.accepted_lunch_intents,body.accepted_lunch_intents.length,'entire accepted recipient intent set retained');
 const key=[body.plan_read_id,f.intent,f.device,f.credential,f.employee,7,'SCHEDULE',f.delivery.target.authorityRevision,f.delivery.targetDigest,f.delivery.viewDigest];
 const applied=(await c.query("select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') value")).rows[0].value;
 const ack=async(params=key,at=applied)=>{await c.query('set local role service_role');const value=(await c.query('select public.static_weekly_v27_ack_device_schedule_delivery($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) result',[...params,at])).rows[0].result;await c.query('reset role');return value;};
 eq((await ack()).receipt.intentId,f.intent,'same exact old writer receipt semantics');
 const before=(await c.query('select to_jsonb(r) value from public.static_weekly_recurring_application_receipts r where intent_id=$1',[f.intent])).rows[0].value;
 await failure(c,()=>ack(key,new Date(Date.parse(applied)+1).toISOString()),['23505'],'different immutable receipt timestamp conflict');
 eq((await c.query('select to_jsonb(r) value from public.static_weekly_recurring_application_receipts r where intent_id=$1',[f.intent])).rows[0].value,before,'refused retimestamp keeps original row');
 for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader']){
  eq((await c.query("select has_function_privilege($1,'public.static_weekly_v24_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamptz)','EXECUTE') value",[role])).rows[0].value,false,'no alternate old RPC receipt grant '+role);
  eq((await c.query("select has_table_privilege($1,'public.static_weekly_recurring_notification_plan_reads','SELECT,INSERT,UPDATE,DELETE') value",[role])).rows[0].value,false,'no direct issued-row grant '+role);
 }
 await failure(c,()=>c.query("update public.static_weekly_recurring_notification_plan_reads set valid_until=valid_until+interval '1 hour' where plan_read_id=$1",[body.plan_read_id]),['23514'],'issued identity expiry immutable');
 await failure(c,()=>c.query('set local role service_role;select public.static_weekly_v24_ack_device_schedule_delivery(null,null,null,null,1,null,1,null,null,null)'),['42501'],'actual old service RPC execute denied');
 const http=await testNotificationPlanHttp({client:c,fixture:f,envelope,applied,check:eq});
 await c.query('rollback');
 // These clients observe committed normal fixture data. Race checks use real
 // row/table/advisory locks and real ALWAYS triggers, no timing success model.
 await pair(async()=>{await writer.query("insert into public.system_settings(setting_key,setting_value) values($1,'true')",['plan-phantom-'+randomUUID()]);await failure(reader,()=>guard(reader),['40001'],'pre-existing phantom insertion holds shared source guard');});
 await pair(async()=>{await guard(reader);await writer.query("set local lock_timeout='250ms'");await failure(writer,()=>writer.query("insert into public.system_settings(setting_key,setting_value) values($1,'true')",['plan-blocked-'+randomUUID()]),['55P03'],'future phantom insertion waits only outside reader and refuses bounded writer');});
 await pair(async()=>{await writer.query("select pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0))");await failure(reader,()=>guard(reader),['40001'],'opposite-order authority holder causes TRY refusal without upgrade wait');});
 await pair(async()=>{await writer.query('select 1 from public.device_auth_credentials where credential_id=$1 for update',[f.credential]);await failure(reader,()=>issue(reader,f),['55P03'],'pure ROW SHARE row-lock principal holder NOWAIT refuses');});
 await pair(async()=>{await writer.query('select 1 from public.static_weekly_recurring_application_intents where intent_id=$1 for update',[f.intent]);
  await failure(reader,async()=>{const env=await issue(reader,f);await reader.query('set local role service_role');await reader.query("select public.static_weekly_v27_ack_device_schedule_delivery($1,$2,$3,$4,$5,7,'SCHEDULE',$6,$7,$8,$9)",[env.body.plan_read_id,f.intent,f.device,f.credential,f.employee,f.delivery.target.authorityRevision,f.delivery.targetDigest,f.delivery.viewDigest,applied]);},['55P03'],'pure ROW SHARE old intent lock cannot wait inside original writer');});
 await pair(async()=>{await writer.query('select 1 from public.static_weekly_schedule_application_intents where intent_id=$1 for update',[f.datedIntent]);
  await failure(reader,async()=>{const env=await issue(reader,f);await reader.query('set local role service_role');await reader.query('select public.static_weekly_v27_ack_device_schedule_delivery($1,$2,$3,$4,$5,7,\'SCHEDULE\',$6,$7,$8,$9)',[env.body.plan_read_id,f.intent,f.device,f.credential,f.employee,f.delivery.target.authorityRevision,f.delivery.targetDigest,f.delivery.viewDigest,applied]);},['55P03'],'dated old v10 SELECT FOR UPDATE ROW SHARE holder NOWAIT refuses');});
 await pair(async()=>{await writer.query('lock table public.static_weekly_schedule_application_receipts in row exclusive mode');await failure(reader,()=>guard(reader),['55P03'],'pre-existing auxiliary old writer rejected before source-exclusive');});
 await pair(async()=>{await writer.query('alter table public.system_settings disable trigger custodial_recurring_notification_plan_source_fence');await failure(reader,()=>guard(reader),['55P03'],'uncommitted trigger DDL relation lock rejected before source-exclusive');});
 await c.query('begin');await c.query('alter table public.system_settings disable trigger custodial_recurring_notification_plan_source_fence');await failure(c,()=>guard(c),['55000'],'disabled trigger current catalog refuses');await c.query('rollback');
 await c.query('begin');await c.query('alter function public.static_weekly_v27_notification_plan_source_write_fence() security invoker');await failure(c,()=>guard(c),['55000'],'changed source trigger implementation unavailable');await c.query('rollback');
 await c.query('begin');await c.query('update public.device_auth_credentials set revoked_at=clock_timestamp() where credential_id=$1',[f.credential]);await failure(c,()=>issue(c,f),['42501'],'actual revoked credential refused without token issuance');await c.query('rollback');
 // Exact expired-after-writer rollback: this owned credential expiry supplies
 // real server expiry. A test-only AFTER INSERT callback delays this owned
 // disposable statement; no caller clock or source p_at can grant a receipt.
 await c.query('begin');await c.query("set local statement_timeout='10000ms'");
 const expiry=(await c.query("select public.sch_service_date(clock_timestamp()+interval '3 seconds')=public.sch_service_date(clock_timestamp()) same_day")).rows[0];
 assert.equal(expiry.same_day,true,'single-shot expiry fixture must not cross service midnight');
 const shortened=await c.query("update public.device_auth_credentials set expires_at=clock_timestamp()+interval '3 seconds' where credential_id=$1 and device_id=$2 returning credential_id",[f.credential,f.device]);
 assert.equal(shortened.rowCount,1,'only exact owned synthetic credential receives natural short expiry');
 const expiring=await issue(c,f);let entered=false;const notice=n=>{if(n.message==='V27_EXPIRY_TEST_ORIGINAL_WRITER_ENTERED')entered=true;};c.on('notice',notice);
 try{
  await c.query(`create function pg_temp.v27_expiry_test_writer() returns trigger language plpgsql as $test$begin
   raise notice 'V27_EXPIRY_TEST_ORIGINAL_WRITER_ENTERED';perform pg_sleep(4);return new;end $test$;
   create trigger v27_expiry_test_writer after insert on public.static_weekly_recurring_application_receipts
   for each row execute function pg_temp.v27_expiry_test_writer()`);
  const originalCounts=(await c.query('select (select count(*) from public.static_weekly_recurring_application_receipts)::int recurring,(select count(*) from public.static_weekly_schedule_application_receipts)::int dated')).rows[0];
  await c.query('savepoint expiry_after_writer');let refused;
  try{await c.query('set local role service_role');await c.query('select public.static_weekly_v27_ack_device_schedule_delivery($1,$2,$3,$4,$5,7,\'SCHEDULE\',$6,$7,$8,$9)',[expiring.body.plan_read_id,f.intent,f.device,f.credential,f.employee,f.delivery.target.authorityRevision,f.delivery.targetDigest,f.delivery.viewDigest,applied]);}catch(error){refused=error;}
  assert.equal(refused?.code,'40001');assert.match(refused?.message??'',/expired during receipt/);assert.equal(entered,true,'actual old writer reached its INSERT before expiry refusal');checks++;
  await c.query('rollback to savepoint expiry_after_writer');await c.query('release savepoint expiry_after_writer');
  eq((await c.query('select (select count(*) from public.static_weekly_recurring_application_receipts)::int recurring,(select count(*) from public.static_weekly_schedule_application_receipts)::int dated')).rows[0],originalCounts,'post-writer expiry rolls back ALL original receipt rows');
 }finally{c.off('notice',notice);await c.query('rollback');}
 // Original60 current SQL/HTTP/race/expiry assertions above remain. This
 // separate qualifier intentionally DOES NOT invoke the preserved known-failed
 // late genuine recurring-public phase (four-slot fixture/current-vs-future).
 const priorCurrentChecks=checks;assert.equal(priorCurrentChecks,60,'all original60 current checks must finish before new binding scope');
 assert.ok(performance.now()<sqlPhaseDeadline,'same original90 budget before original binding cases');
 let originalBindings;await c.query('begin');await c.query("set local statement_timeout='10000ms'");
 try{originalBindings=await testOriginalNativePlanBindings({client:c,fixture:f,check:eq});}finally{await c.query('rollback');}
 await testOriginalNativeSourceConflicts({writer,reader,check:eq});
 const priorBindingChecks=checks;assert.equal(priorBindingChecks,89,'all prior89 scoped checks must complete before source-fence/semantic contract');
 const closureBoundary=await testIncumbencyClosureSourceBoundary({client:c,writer,reader,fixture:f,check:eq,deadlineAt:sqlPhaseDeadline});
 assert.equal(checks,95,'all prior89 plus six specific-fence/semantic boundary checks');
 const recurringPublicApi={status:'SEPARATE_UNQUALIFIED',reason:'Preserved15/16 late genuine recurring-public fixture not applicable; proper full9 accepted-public route remains separate55 gate. No current recurring HTTP positive claimed.'};
 console.log(JSON.stringify({status:'PASS',checks,actualMigratedPostgres:true,actualCredentialHttp:http,recurringPublicApi,priorCurrentChecks,priorBindingChecks,originalBindings,closureBoundary,normalOfficialCompilerAndLunch:true,syntheticRecurringTargetBoundary:true,
  concurrency:'real phantom, opposite authority, pure row-lock principal+intent, auxiliary writer, trigger DDL/disable',scope:'isolated Source prototype; no native/full-installation/OS/audio proof; independent architecture audit required before integration'}));
}finally{console.error('NORMAL_PLAN_CHECK_PROGRESS '+JSON.stringify({countedChecksPassed:checks,lastSuccessfulCheck}));for(const client of clients){try{await client.query('rollback');}catch{}client.release();}await pool.end();}
