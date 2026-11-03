import assert from 'node:assert/strict';

// Real recurring publication from the production JS owner. Dated intents below
// are explicitly synthetic boundary fixtures, NOT a passed absence publication.
// All phone rows and fixture receipts are rolled back. No physical phone proof.
export async function testRecurringDelivery({pool,week,managerId,receipt,check}) {
 const client=await pool.connect(),id=n=>`93000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const q=async(sql,args=[])=>(await client.query(sql,args)).rows[0]?.result;
 const rpc=(name,args)=>q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
 const roles=['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'];
 const rejected=async(label,work,pattern)=>{await client.query('savepoint delivery_reject');
  try{await assert.rejects(work,pattern,label);check(label,true,true);}finally{await client.query('rollback to savepoint delivery_reject');}};
 try {
  await client.query('begin');await client.query("set local statement_timeout='120000ms'");
  const functions=(await client.query("select oid::regprocedure::text signature from pg_proc where pronamespace='public'::regnamespace and starts_with(proname,'static_weekly_v24_') order by proname")).rows;
  check('exact authenticated delivery boundary function inventory',functions.length,2);
  for(const {signature} of functions)for(const role of roles)check('delivery minimum grant '+role+' '+signature,
   await q("select has_function_privilege($1,$2,'EXECUTE') as result",[role,signature]),role==='service_role');
  const reportSignature='static_weekly_v25_read_current_recurring_delivery(date,uuid)';
  const report=async(date=week,actor=managerId)=>{await client.query('set local role static_weekly_control_plane');
   const result=await rpc('static_weekly_v25_read_current_recurring_delivery',[date,actor]);await client.query('reset role');return result;};
  for(const role of roles){
   check('current delivery report minimum grant '+role,await q("select has_function_privilege($1,$2,'EXECUTE') as result",[role,reportSignature]),role==='static_weekly_control_plane');
   if(role!=='static_weekly_control_plane')await rejected('actual current report caller denied '+role,async()=>{
    await client.query('set local role '+role);await rpc('static_weekly_v25_read_current_recurring_delivery',[week,managerId]);},/permission denied/);
  }
  await rejected('current delivery missing manager denied',()=>report(week,null),/manager/);
  await rejected('current delivery unregistered manager denied',()=>report(week,id(99)),/manager/);
  await rejected('current delivery infinite date denied',()=>report('infinity'),/finite service date/);
  const before=await report();
  check('no-device targets do not count as applied',before.affectedPhonesUpdated,false);
  check('initial current report has no fabricated receipts',before.reportedCount,0);
  check('initial report exposes all missing-device people',before.targets.every(x=>x.status==='NO_CURRENT_DEVICE'),true);
  const unavailable=await report('1900-01-01');
  check('empty unavailable report never passes',[unavailable.targets,unavailable.affectedPhonesUpdated,unavailable.allCurrentTargetsReported],[[],false,false]);
  const employee=await q('select employee_id as result from public.static_weekly_recurring_application_intents where operation_id=$1 and service_date=$2 order by employee_id limit 1',[receipt.operationId,week]);
  const device=id(1),credential=id(2),rotated=id(3);
  await client.query("insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values($1,'RECURRING-DELIVERY-TEST','Synthetic delivery phone',true,$2,1)",[device,employee]);
  const addCredential=(c,hash)=>client.query("insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at) values($1,$2,$3,'Synthetic delivery phone',statement_timestamp(),statement_timestamp()+interval '1 day')",[c,device,hash]);
  await addCredential(credential,'e'.repeat(64));
  const readArgs=[week,device,credential,employee,1];
  const read=async(args=readArgs)=>{await client.query('set local role service_role');
   const result=await rpc('static_weekly_v24_read_device_schedule_delivery',args);await client.query('reset role');return result;};
  for(const role of roles.filter(x=>x!=='service_role'))await rejected('actual delivery caller denied '+role,async()=>{
   await client.query('set local role '+role);await rpc('static_weekly_v24_read_device_schedule_delivery',readArgs);},/permission denied/);
  await rejected('delivery infinite date rejected',()=>read(['infinity',...readArgs.slice(1)]),/finite service date/);
  const result=await read(),target=result.delivery;
  const pendingReport=await report(),personRows=value=>value.targets.filter(row=>row.employeeId===employee);
  check('new phone replaces only the obsolete no-device presentation',personRows(pendingReport).map(x=>[x.deviceId,x.credentialId,x.status]),[[device,credential,'PENDING']]);
  check('report same current projection',pendingReport.currentAuthority.projectionId,receipt.projectionId);
  check('actual service read reconciles new current principal',result.mode,'RECURRING_SCHEDULE');
  check('new delivery current principal starts pending',target.applicationStatus,'PENDING');
  check('read no fabricated application receipt',await q('select count(*)::int as result from public.static_weekly_recurring_application_receipts'),0);
  const count=await q('select count(*)::int as result from public.static_weekly_recurring_application_intents');
  check('repeated read exact target',await read(),result);
  check('repeated read cannot create another target',await q('select count(*)::int as result from public.static_weekly_recurring_application_intents'),count);
  await rejected('delivery cannot expose private helper',async()=>{await client.query('set local role service_role');
   await rpc('static_weekly_v22_read_recurring_application_target',readArgs);},/permission denied/);
  // Explicit synthetic accepted-ledger/intent boundary fixture. Real dated
  // command acceptance has separate retained V13 evidence, not credited here.
  const datedCommand=id(4),datedIntent=id(5),mismatchedIntent=id(7),secondCommand=id(6);
  for(const command of [datedCommand,secondCommand])await client.query(`insert into public.static_weekly_staffing_commands
   (operation_id,command_kind,employee_id,start_date,end_date,absence_kind,semantic_body,semantic_digest,client_prepare_key,
    expected_revision,prepared_by_manager_id,state,accepted_revision,accepted_receipt,accepted_at,
    confirmation_key,confirmed_by_manager_id,authority_command_id)
   values($1,'absence',$2,$3,$3,'daily_absence','{"syntheticBoundaryFixture":true}',repeat('a',64),$1,$4,$5,'ACCEPTED',$4,
    '{"syntheticBoundaryFixture":true}',statement_timestamp(),$1,$5,$1)`,[command,employee,week,receipt.authorityRevision,managerId]);
  for(const [intent,command,revision] of [[datedIntent,datedCommand,receipt.authorityRevision],[mismatchedIntent,secondCommand,receipt.authorityRevision-1]])
   await client.query(`insert into public.static_weekly_schedule_application_intents
    (intent_id,operation_id,service_date,employee_id,device_id,credential_id,assignment_epoch,authority_revision,publication_id,projection_id,lunch_document_identity)
    values($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10)`,[intent,command,week,employee,device,credential,revision,receipt.publicationId,receipt.projectionId,receipt.lunchDocumentIdentity]);
  const at=await q('select clock_timestamp()::text as result');
  const ackArgs=[target.intentId,device,credential,employee,1,'SCHEDULE',target.target.authorityRevision,target.targetDigest,target.viewDigest,at];
  const ack=async(args=ackArgs)=>{await client.query('set local role service_role');const value=await rpc('static_weekly_v24_ack_device_schedule_delivery',args);await client.query('reset role');return value;};
  await rejected('wrong rendered bytes cannot bridge dated receipt',()=>ack([...ackArgs.slice(0,8),'f'.repeat(64),at]),/exact principal target rendered-view/);
  await client.query('savepoint bridge_failure');
  await client.query(`create function public.test_delivery_bridge_failure() returns trigger language plpgsql as $$begin raise exception 'injected dated receipt failure';end$$;
   create trigger test_delivery_bridge_failure before insert on public.static_weekly_schedule_application_receipts for each row execute function public.test_delivery_bridge_failure()`);
  await rejected('dated ACK failure rolls back recurring ACK too',()=>ack(),/injected dated receipt failure/);
  check('bridge failure leaves no recurring receipt',await q('select count(*)::int as result from public.static_weekly_recurring_application_receipts'),0);
  await client.query('rollback to savepoint bridge_failure');
  const accepted=await ack();check('delivery ACK never infers current authority',accepted.currentAuthorityNotInferred,true);
  check('exact typed ACK retry',await ack(),accepted);
  check('matching dated intent gets same actual applied evidence',await q('select rendered_digest as result from public.static_weekly_schedule_application_receipts where intent_id=$1',[datedIntent]),target.viewDigest);
  check('different revision never inherits applied receipt',await q('select count(*)::int as result from public.static_weekly_schedule_application_receipts where intent_id=$1',[mismatchedIntent]),0);
  check('current read follows exact receipt',(await read()).delivery.applicationStatus,'DEVICE_REPORTED_APPLIED');
  check('manager sees exact current device receipt',personRows(await report()).map(x=>[x.intentId,x.status,x.receiptId]),[[target.intentId,'DEVICE_REPORTED_APPLIED',accepted.receipt.receiptId]]);
  check('other absent phones still prevent all-updated',(await report()).affectedPhonesUpdated,false);
  await client.query("update public.device_auth_credentials set revoked_at=statement_timestamp(),revoked_reason='Synthetic delivery rotation' where credential_id=$1",[credential]);
  await addCredential(rotated,'f'.repeat(64));
  await rejected('revoked delivery principal cannot read',()=>read(),/exact current terminal schedule principal/);
  const rotatedRead=[week,device,rotated,employee,1],newDelivery=await read(rotatedRead);
  check('rotated credential reconciles without inheriting old receipt',newDelivery.delivery.applicationStatus,'PENDING');
  check('rotation preserves exact view bytes',newDelivery.delivery.viewJsonText,target.viewJsonText);
  const rotatedReport=await report();
  check('manager cannot inherit retired credential ACK',personRows(rotatedReport).map(x=>[x.credentialId,x.status,x.receiptId]),[[rotated,'PENDING',null]]);
  await client.query('savepoint delivery_no_phone');
  await client.query('update public.devices set active=false where id=$1',[device]);
  check('removed current phone becomes no-device not historical success',personRows(await report()).map(x=>[x.deviceId,x.status]),[[null,'NO_CURRENT_DEVICE']]);
  await client.query('rollback to savepoint delivery_no_phone');
  const revision=await q('select current_revision::int as result from public.static_weekly_schedule_control where singleton');
  const blocked=await rpc('static_weekly_v19_invalidate_recurring_range',[managerId,id(8),receipt.publicationId,week,null,'ROSTER_DEPENDENCY_CHANGED','c'.repeat(64),revision]);
  const terminal=await read(rotatedRead);
  check('terminal precedes all previous dated and usable targets',terminal.mode,'RECURRING_TERMINAL');
  check('terminal exact current invalidation',terminal.delivery.target.invalidationId,blocked.invalidationId);
  check('terminal contains no dated target or old usable view',[terminal.datedApplication,terminal.delivery.view??null],[null,null]);
  const terminalAt=await q('select clock_timestamp()::text as result');
  const terminalAck=await ack([terminal.delivery.intentId,device,rotated,employee,1,'BLOCKED_RECURRING_AUTHORITY',terminal.delivery.target.authorityRevision,
   terminal.delivery.targetDigest,terminal.delivery.targetDigest,terminalAt]);
  check('terminal ACK is blocked not applied coverage',terminalAck.receipt.applicationStatus,'DEVICE_REPORTED_BLOCKED');
  const blockedReport=await report();
  check('manager current report selects terminal not prior applied schedule',personRows(blockedReport).map(x=>[x.intentId,x.status]),[[terminal.delivery.intentId,'DEVICE_REPORTED_BLOCKED']]);
  check('terminal report is never updated replacement coverage',[blockedReport.mode,blockedReport.affectedPhonesUpdated,blockedReport.coverageReadinessNotInferred],['RECURRING_TERMINAL',false,true]);
  await client.query('savepoint delivery_inactive_person');
  await client.query('update public.employees set active=false where id=$1',[employee]);
  check('protected inactive original principal cannot count as applied',personRows(await report()).map(x=>[x.status,x.receiptId]),[['PROTECTED_PRINCIPAL_PENDING',null]]);
  await client.query('rollback to savepoint delivery_inactive_person');
  functions.push({signature:reportSignature});
  for(const {signature} of functions){
   const recovery=(await client.query("select object_kind,definition_sql from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure order by restore_order",[signature])).rows;
   check('delivery exact recovery objects '+signature,recovery.map(x=>x.object_kind),['function','grant']);
   check('delivery exact recovered function bytes '+signature,recovery[0].definition_sql,await q('select pg_get_functiondef($1::regprocedure) as result',[signature]));
   await client.query('drop function '+signature);for(const row of recovery)await client.query(row.definition_sql);
   check('restored delivery retains no anonymous grant '+signature,await q("select has_function_privilege('anon',$1,'EXECUTE') as result",[signature]),false);
  }
  check('recovered reader keeps terminal winner',(await read(rotatedRead)).delivery.target,terminal.delivery.target);
  check('recovered named-manager report keeps terminal pending semantics',(await report()).affectedPhonesUpdated,false);
  return{status:'PASS',scope:'actual service-role SQL typed delivery, exact principal/rotation/terminal/recovery; synthetic dated-intent bridge fixture and atomic failure rollback; no physical phone or dated-publication proof'};
 }finally{await client.query('rollback');client.release();}
}
