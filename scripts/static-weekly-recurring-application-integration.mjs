import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {compileStaticWeeklyScheduleIsolated} from '../src/static-weekly-schedule-compiler-runtime.js';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {testRecurringFinalization} from './static-weekly-recurring-finalization-integration.mjs';

// Actual SQL, real compiler and official lunch in the existing uncommittable
// parent transaction. No invented parent receipt, live phone or delivery PASS.
export async function testRecurringApplicationTargets({client,managerId,managerName,confirmationKey,publicationId,week,check}) {
 const id=n=>`91000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const q=async(sql,args=[])=>(await client.query(sql,args)).rows[0]?.result;
 const rpc=(name,args=[])=>q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
 const rev=()=>q('select current_revision::int as result from public.static_weekly_schedule_control where singleton');
 const reject=async(label,work,pattern)=>{await client.query('savepoint application_reject');
  try{await assert.rejects(work,pattern,label);check(label,true,true);}finally{await client.query('rollback to savepoint application_reject');}};
 const reconcile=(date=week)=>rpc('static_weekly_v22_reconcile_recurring_application_date',[date]);
 const roles=['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'];
 const tables=['static_weekly_recurring_application_intents','static_weekly_recurring_application_receipts'];
 const functions=(await client.query("select oid::regprocedure::text signature from pg_proc where pronamespace='public'::regnamespace and starts_with(proname,'static_weekly_v22_') order by proname")).rows;
 check('application exact helper inventory',functions.length,4);
 for(const {signature} of functions)for(const role of roles)
  check('application helper private '+role+' '+signature,await q('select has_function_privilege($1,$2,\'EXECUTE\') as result',[role,signature]),false);
 for(const table of tables){
  check('application FORCE RLS '+table,await q('select relrowsecurity and relforcerowsecurity as result from pg_class where oid=$1::regclass',['public.'+table]),true);
  for(const role of roles)await reject('application table denied '+role+' '+table,async()=>{
   await client.query('set local role '+role);await client.query('select * from public.'+table);},/permission denied/);
 }
 const beforeRevision=await rev();
 await client.query('savepoint application_proof');
 let evidence;
 try {
  await reject('targets cannot precede usable exact projection',()=>reconcile(),/projection is unavailable/);
  await client.query('set local role static_weekly_control_plane');
  const source=await rpc('static_weekly_v3_read_publication_source',[publicationId,week]);
  const raw=source.compiler_input;
  const input={serviceDate:week,timezone:raw.timezone||'America/Chicago',slots:raw.slots,proximity:raw.proximity,exceptions:source.exceptions||[],versions:[raw.version]};
  if(process.env.STATIC_WEEKLY_RECURRING_PROJECTION_INPUT)
   writeFileSync(process.env.STATIC_WEEKLY_RECURRING_PROJECTION_INPUT,JSON.stringify({classification:'ISOLATED_SYNTHETIC_SQL_READBACK',source,input},null,2)+'\n',{flag:'wx'});
  let failure=null,pending=Promise.resolve();
  const timer=setInterval(()=>{pending=pending.then(()=>client.query('select 1')).catch(e=>{failure||=e;});},10000);
  timer.unref();let projection;
  try{const result=await compileStaticWeeklyScheduleIsolated(input);
   console.log('RECURRING_EXECUTION_COMPILER_RESULT',JSON.stringify({status:result.status,publicationAuthority:result.publicationAuthority,fatal:result.fatal,verifier:result.verifier?.ok,reviewWork:result.reviewWork?.length}));
   assert.equal(result.status,'FEASIBLE','actual recurring SQL readback must compile to feasible execution');
   assert.equal(result.publicationAuthority,'ACCEPTABLE');assert.equal(result.verifier?.ok,true);
   projection=createStaticWeeklyProjectionWithLunchRpcInput({result,publicationId,
    expectedRevision:beforeRevision,actor:{managerId,managerName,idempotencyKey:`recurring:${managerId}:${confirmationKey}:projection:${week}`}});
  }finally{clearInterval(timer);await pending;}
  if(failure)throw failure;
  const materialized=await rpc('static_weekly_v3_materialize_projection',[projection.publicationId,projection.serviceDate,
   projection.exceptionSetDigest,projection.compilerVersion,projection.objective,projection.metrics,projection.replayDigest,
   projection.envelope,projection.expectedRevision,managerId,projection.idempotencyKey]);
  await client.query('reset role');
  await reject('usable projection without lunch cannot issue targets',()=>reconcile(),/lunch companion is unavailable/);
  await client.query('set local role static_weekly_control_plane');
  const lunch=await rpc('static_weekly_v8_materialize_lunch_document',[materialized.data.projection_id,projection.lunchDocument,managerId]);
  await client.query('reset role');
  check('actual recurring lunch is exact persisted companion',[lunch.persistence_status,lunch.projection_id,lunch.document_identity],
   ['PERSISTED',materialized.data.projection_id,projection.lunchDocument.document_identity]);
  const count=await reconcile();assert.ok(count>=6);check('affected existing employees have explicit no-device targets',
   await q('select count(*)::int as result from public.static_weekly_recurring_application_intents where device_id is null'),count);
  check('target reconciliation retry creates no duplicate',await reconcile(),0);
  const people=(await client.query('select distinct employee_id from public.static_weekly_recurring_application_intents order by employee_id')).rows.map(x=>x.employee_id);
  const employee=people[0],device=id(1),credential=id(2),rotated=id(3);
  await client.query("insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values($1,'RECURRING-APPLICATION-TEST','Synthetic application phone',true,$2,1)",[device,employee]);
  const addCredential=(c,hash)=>client.query("insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at) values($1,$2,$3,'Synthetic application phone',statement_timestamp(),statement_timestamp()+interval '1 day')",[c,device,hash]);
  await addCredential(credential,'a'.repeat(64));
  const read=(cred=credential,emp=employee,epoch=1)=>rpc('static_weekly_v22_read_recurring_application_target',[week,device,cred,emp,epoch]);
  check('new current principal stays pending before reconciliation',(await read()).applicationStatus,'PENDING_TARGET_RECONCILIATION');
  check('current assigned principal gets one target',await reconcile(),1);
  const target=await read();
  check('current target starts pending',target.applicationStatus,'PENDING');
  check('target exact authority identities',[target.target.targetType,target.target.publicationId,target.target.projectionId,target.target.lunchDocumentIdentity],
   ['SCHEDULE',publicationId,materialized.data.projection_id,lunch.document_identity]);
  check('view text parses to exact render object',JSON.parse(target.viewJsonText),target.view);
  check('raw PostgreSQL JSON text hashes identically in Node',createHash('sha256').update(target.viewJsonText).digest('hex'),target.viewDigest);
  check('target hashes actual database JSON bytes',target.targetDigest,await rpc('static_weekly_digest_jsonb',[target.target]));
  check('view contains no current window or cleaning clock fields',Object.keys(target.view).sort(),
   ['schema','service_date','employee_id','employee_name','publication_id','projection_id','projection_status','full_day','shift','raw_items'].sort());
  const day=await rpc('static_weekly_v5_read_employee_day',[week,employee,week+'T18:00:00Z']);
  check('render retains exact official regular and lunch responsibility rows',target.view.raw_items,day.all_items);
  check('render retains exact shift',target.view.shift,day.shift);
  for(const [label,cred,emp,epoch] of [['credential',id(9),employee,1],['employee',credential,people[1],1],['epoch',credential,employee,2]])
   await reject('application rejects wrong '+label,()=>read(cred,emp,epoch),/exact current terminal schedule principal/);
  const at=await q('select clock_timestamp()::text as result');
  const args=[target.intentId,device,credential,employee,1,target.target.authorityRevision,target.targetDigest,target.viewDigest,at];
  const ack=(a=args)=>rpc('static_weekly_v22_ack_recurring_application_target',a);
  for(const [label,index,value] of [['rendered bytes',7,'f'.repeat(64)],['target',6,'f'.repeat(64)],['revision',5,0],['past time',8,'2000-01-01T00:00:00Z'],['future time',8,'2099-01-01T00:00:00Z'],['nonfinite time',8,'infinity']]){
   const hostile=[...args];hostile[index]=value;
   await reject('application ACK rejects '+label,()=>ack(hostile),/exact principal target rendered-view revision and time/);
  }
  const receipt=await ack();
  check('ACK explicitly does not infer current authority',receipt.currentAuthorityNotInferred,true);
  check('exact immutable ACK retry',await ack(),receipt);
  const changed=[...args];changed[8]=await q("select (clock_timestamp()+interval '1 second')::text as result");
  await reject('different retry cannot rewrite applied time',()=>ack(changed),/different receipt/);
  check('reader requires exact target ACK before applied',(await read()).applicationStatus,'DEVICE_REPORTED_APPLIED');
  await client.query('savepoint changed_render');
  await client.query("update public.employees set display_name=display_name||' changed' where id=$1",[employee]);
  await reject('same authority cannot silently reuse changed display bytes',()=>reconcile(),/render changed without a new exact authority identity/);
  await client.query('rollback to savepoint changed_render');
  await client.query('savepoint inactive_principal');
  await client.query('update public.employees set active=false where id=$1',[employee]);
  await reject('inactive person cannot read new usable schedule',()=>read(),/active employee principal/);
  await reject('inactive person cannot acknowledge new usable schedule',()=>ack(),/active employee principal/);
  await client.query('rollback to savepoint inactive_principal');
  await client.query("update public.device_auth_credentials set revoked_at=statement_timestamp(),revoked_reason='Synthetic rotation' where credential_id=$1",[credential]);
  await addCredential(rotated,'b'.repeat(64));
  await reject('revoked credential cannot read',()=>read(),/exact current terminal schedule principal/);
  await reject('revoked credential cannot ACK',()=>ack(),/exact current terminal schedule principal/);
  check('rotated credential does not inherit old ACK',(await read(rotated)).applicationStatus,'PENDING_TARGET_RECONCILIATION');
  check('rotation creates one new exact target',await reconcile(),1);
  const rotatedTarget=await read(rotated);
  check('rotation preserves identical schedule bytes',rotatedTarget.viewJsonText,target.viewJsonText);
  check('rotated target remains pending',rotatedTarget.applicationStatus,'PENDING');
  const finalization=process.env.STATIC_WEEKLY_TEST_RECURRING_FINALIZATION==='1'
   ? await testRecurringFinalization({client,managerId,confirmationKey,publicationId,projectionId:materialized.data.projection_id,week,check}) : null;
  const blocked=await rpc('static_weekly_v19_invalidate_recurring_range',[managerId,id(4),publicationId,week,null,'ROSTER_DEPENDENCY_CHANGED','c'.repeat(64),await rev()]);
  await reconcile();
  const terminal=await read(rotated);
  check('terminal wins over earlier usable schedule',[terminal.target.targetType,terminal.target.invalidationId,terminal.applicationStatus],
   ['BLOCKED_RECURRING_AUTHORITY',blocked.invalidationId,'PENDING']);
  check('terminal never exposes old usable render view',Object.hasOwn(terminal,'view'),false);
  for(const table of tables)await reject('application history immutable '+table,()=>client.query('delete from public.'+table),/immutable|append-only/);
  for(const {signature} of functions){
   const recovery=(await client.query("select object_kind,definition_sql from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure order by restore_order",[signature])).rows;
   check('exact application recovery inventory '+signature,recovery.map(x=>x.object_kind),['function','grant']);
   check('exact application function bytes '+signature,recovery[0].definition_sql,await q('select pg_get_functiondef($1::regprocedure) as result',[signature]));
  }
  const signature='public.static_weekly_v22_read_recurring_application_target(date,uuid,uuid,uuid,bigint)';
  const recovery=(await client.query("select definition_sql from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure order by restore_order",[signature])).rows;
  await client.query('drop function '+signature);for(const row of recovery)await client.query(row.definition_sql);
  check('recovered reader still returns exact terminal winner',(await read(rotated)).target,terminal.target);
  check('recovered reader retains denied runtime callers',await q('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') as result',[signature]),false);
  evidence={status:'PASS',scope:'actual SQL private schedule targets, real compiler/lunch, exact view bytes, principal rotation, terminal precedence, ACK and recovery; rolled back',
   sourcePublicationId:publicationId,projectionId:materialized.data.projection_id,initialNoDeviceCount:count,finalization,production:false,phoneAcceptance:false};
 }finally{await client.query('rollback to savepoint application_proof');}
 check('application proof rollback restores prior revision',await rev(),beforeRevision);
 for(const table of tables)check('application proof rollback removes '+table,await q('select count(*)::int as result from public.'+table),0);
 return evidence;
}
