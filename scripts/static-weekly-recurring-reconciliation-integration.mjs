import assert from 'node:assert/strict';

// Real PostgreSQL and the real bound compiler fixture; every scenario is
// rolled back. No completed recurring confirmation or phone proof is implied.
export async function testRecurringDependencyReconciliation({client,managerId,publicationId,week,check}) {
 const q=async(sql,args=[])=>(await client.query(sql,args)).rows[0]?.result;
 const id=n=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const rev=()=>q('select current_revision::int as result from public.static_weekly_schedule_control where singleton');
 const addDate=n=>new Date(Date.parse(week+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 const reconcile=async(manager=managerId)=>{
  await client.query('set local role static_weekly_control_plane');
  const result=await q('select public.static_weekly_v21_reconcile_dependency_changes($1) as result',[manager]);
  await client.query('reset role');return result;
 };
 const counts=()=>q(`select jsonb_build_array(
  (select count(*) from public.static_weekly_recurring_dependency_changes),
  (select count(*) from public.static_weekly_recurring_dependency_checks),
  (select count(*) from public.static_weekly_recurring_invalidations),
  (select count(*) from public.static_weekly_recurring_terminal_intents)) as result`);
 const isolated=async(work)=>{await client.query('savepoint reconciliation_case');try{return await work();}
  finally{await client.query('rollback to savepoint reconciliation_case');}};
 const reject=async(label,work,pattern)=>{await client.query('savepoint reconciliation_reject');
  try{await assert.rejects(work,pattern,label);check(label,true,true);}finally{await client.query('rollback to savepoint reconciliation_reject');}};
 const binding=await q('select to_jsonb(b) as result from public.static_weekly_recurring_publication_bindings b where publication_id=$1',[publicationId]);
 const person=binding.dependency_snapshot.roster.find(r=>r.personId&&/^EMP\d+$/.test(r.employeeCode));
 const contractor=binding.dependency_snapshot.roster.find(r=>r.personId&&!/^EMP\d+$/.test(r.employeeCode));
 assert.ok(person&&contractor,'distinct actual custodian and bound contractor fixture identities');
 const initialCounts=await counts(),initialRevision=await rev();
 const today=await q('select public.sch_service_date(statement_timestamp())::text as result');
 const todayBefore=await q('select to_jsonb(s) as result from public.static_weekly_v6_schedule_authority_state($1) s',[today]);
 const tables=['static_weekly_recurring_dependency_changes','static_weekly_recurring_dependency_checks'];
 for(const table of tables){
  check('dependency tracking table FORCE RLS '+table,await q('select relrowsecurity and relforcerowsecurity as result from pg_class where oid=$1::regclass',['public.'+table]),true);
  for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'])
   await reject('dependency table direct caller denied '+role+' '+table,async()=>{await client.query('set local role '+role);await client.query('select * from public.'+table);},/permission denied/);
 }
 for(const role of ['anon','authenticated','service_role','static_weekly_release_operator','custodial_application_reader'])
  await reject('reconciliation RPC denied '+role,async()=>{await client.query('set local role '+role);await q('select public.static_weekly_v21_reconcile_dependency_changes($1) as result',[managerId]);},/permission denied/);
 await reject('reconciler rejects unknown named manager',()=>reconcile(id(999)),/manager/);
 await isolated(async()=>{
  await client.query("update public.employees set notes='Private note MUST NOT enter tracking' where id=$1",[person.personId]);
  check('unrelated private employee note creates no dependency work',await counts(),initialCounts);
  check('no-change reconcile leaves revision unchanged',(await reconcile()).authorityRevision,initialRevision);
 });
 await isolated(async()=>{
  await client.query("update public.employees set display_name=display_name||' corrected' where id=$1",[person.personId]);
  check('semantic staffing change tracked before reconciliation',(await counts())[0],initialCounts[0]+1);
  check('row trigger does not advance global revision during existing writer',await rev(),initialRevision);
  await reject('deferred commit guard rejects forgotten future validation',()=>client.query('set constraints trg_recurring_dependency_complete immediate'),/cannot commit without atomic future validity reconciliation/);
  const result=await reconcile();
  check('reconciliation advances future authority once',result.authorityRevision,initialRevision+1);
  check('reconciliation retains typed blocked winner',result.blockedPublications.map(r=>[r.publicationId,r.state,r.effectiveStart]),[[publicationId,'BLOCKED_RECURRING_AUTHORITY',week]]);
  check('no phone delivery fabricated',result.affectedPhonesUpdated,false);
  await client.query('set constraints trg_recurring_dependency_complete immediate');
  await client.query('set constraints trg_recurring_dependency_complete deferred');
  check('guard accepts same-transaction reconciliation',(await counts())[1],initialCounts[1]+1);
  const origin=await q('select to_jsonb(c) as result from public.static_weekly_recurring_dependency_changes c where owner_xid=pg_current_xact_id() order by generation desc limit 1');
  check('change provenance uses actual login identity',origin.origin_session_user,await q('select session_user::text as result'));
  check('whitelisted change contains no private employee notes',Object.hasOwn(origin.after_json,'notes'),false);
  check('current day authority is not cleared by future invalidation',await q('select to_jsonb(s) as result from public.static_weekly_v6_schedule_authority_state($1) s',[today]),todayBefore);
  check('blocked winner never falls back to prior schedule',(await q('select to_jsonb(s) as result from public.static_weekly_v6_schedule_authority_state($1) s',[week])).projection_status,'blocked_recurring_authority');
  await client.query('set local role static_weekly_control_plane');
  const managerRead=await q('select public.static_weekly_v3_read_manager_snapshot($1) as result',[week]);
  await client.query('reset role');
  check('manager reads same blocked winning publication',[managerRead.projection_status,managerRead.current_publication.publication_id],['blocked_recurring_authority',publicationId]);
  check('manager cannot show old assignments as usable coverage',[managerRead.latest_projection,managerRead.assignments,managerRead.recurring_repair_required],[null,[],true]);
  check('manager retains exact invalidation evidence',managerRead.recurring_invalidations,result.blockedPublications);
  const repeat=await reconcile();
  check('repeated reconciliation adds no invalidation/revision',[repeat.processedChangeCount,repeat.authorityRevision,repeat.invalidations],[0,initialRevision+1,[]]);
  check('retry returns current blocked state',repeat.blockedPublications,result.blockedPublications);
  await client.query("update public.employees set display_name=display_name||' second correction' where id=$1",[person.personId]);
  const next=await reconcile();
  check('already terminal range is not given another fake revision',next.authorityRevision,initialRevision+1);
  check('existing terminal range remains explicit',next.invalidations[0].existing,true);
  check('accepted publication binding remains immutable',await q('select to_jsonb(b) as result from public.static_weekly_recurring_publication_bindings b where publication_id=$1',[publicationId]),binding);
  await reject('dependency check immutable even for owner',()=>client.query("update public.static_weekly_recurring_dependency_checks set result_digest=repeat('a',64)"),/immutable|append-only/);
 });
 await isolated(async()=>{
  // The source has a symbolic contractor incumbent, not an employee record.
  // Prove that fact and create the disposable record explicitly; a zero-row
  // UPDATE cannot be used as evidence about any row trigger.
  check('contractor source placeholder initially has no employee',contractor.employeeExists,false);
  const inserted=await client.query("insert into public.employees(id,employee_code,display_name,active,role) values($1,'COVERALL_RECONCILIATION_TEST','Synthetic bound contractor',true,'staff')",[contractor.personId]);
  check('actual bound contractor employee inserted',inserted.rowCount,1);
  const updated=await client.query("update public.employees set display_name=display_name||' corrected' where id=$1",[contractor.personId]);
  check('contractor change actually affected a row',updated.rowCount,1);
  check('roster-bound non-EMP insert and update are dependencies',(await counts())[0],initialCounts[0]+2);
  const result=await reconcile();
  check('bound contractor identity correction invalidates future authority',result.blockedPublications.length,1);
  await client.query('set constraints trg_recurring_dependency_complete immediate');
 });
 await isolated(async()=>{
  await client.query("insert into public.employees(id,employee_code,display_name,active,role) values($1,'EMP981','Synthetic unassigned employee',true,'staff')",[id(1)]);
  const result=await reconcile();
  check('unassigned person does not invalidate unrelated future pattern',[result.processedChangeCount,result.invalidations,result.authorityRevision],[1,[],initialRevision]);
  await client.query('set constraints trg_recurring_dependency_complete immediate');
 });
 await isolated(async()=>{
  const secondManager=id(2),replacement=id(3),incumbency=id(4),start=addDate(16);
  await client.query("insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,'Synthetic second reconciliation manager',array['CUSTODIAL_MANAGER'],true,false)",[secondManager]);
  await client.query("insert into public.employees(id,employee_code,display_name,active,role) values($1,'EMP982','Synthetic future replacement',true,'staff')",[replacement]);
  await client.query("insert into public.weekly_roster_slot_incumbencies(incumbency_id,slot_id,person_id,person_name_snapshot,effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values($1,$2,$3,'Synthetic future replacement',$4,$5,'Synthetic second reconciliation manager',repeat('b',64))",[incumbency,person.slotId,replacement,start,secondManager]);
  const changedRevision=await q("select public.static_weekly_advance_authority($1,'replace_incumbency',$2,'Synthetic second reconciliation manager',$3,repeat('a',64))::int as result",[initialRevision,secondManager,id(5)]);
  await client.query("insert into public.weekly_roster_slot_incumbency_closures(closed_incumbency_id,replacement_incumbency_id,closed_at_effective_date,authority_revision,actor_manager_id,actor_manager_name_snapshot,content_digest) values($1,$2,$3,$4,$5,'Synthetic second reconciliation manager',repeat('a',64))",[person.incumbencyId,incumbency,start,changedRevision,secondManager]);
  check('initial week unchanged before a known later replacement',await q('select public.static_weekly_v21_first_changed_dependency_date($1,$2)::text as result',[publicationId,week]),null);
  const result=await reconcile(secondManager);
  check('later-week boundary invalidates from exact first changed day',result.blockedPublications.map(r=>r.effectiveStart),[start]);
  check('later change does not revoke first unaffected week',(await q('select to_jsonb(s) as result from public.static_weekly_v6_schedule_authority_state($1) s',[week])).projection_status==='blocked_recurring_authority',false);
  await client.query('set local role static_weekly_control_plane');
  const laterRead=await q('select public.static_weekly_v3_read_manager_snapshot($1) as result',[addDate(14)]);
  await client.query('reset role');
  check('manager week catches a terminal boundary after Monday',laterRead.recurring_invalidations.map(r=>r.effectiveStart),[start]);
  check('second authorized manager owns reconciliation not original writer impersonation',await q('select bool_and(processed_by_manager_id=$1) as result from public.static_weekly_recurring_dependency_checks',[secondManager]),true);
  check('one later invalidation follows existing mutation revision',result.authorityRevision,changedRevision+1);
  await client.query('set constraints trg_recurring_dependency_complete immediate');
 });
 await isolated(async()=>{
  await client.query('update public.static_weekly_authority_source_documents set active=false,retired_at=statement_timestamp() where source_id=$1',[binding.source_id]);
  const result=await reconcile();
  check('retired source invalidates its future authority',result.blockedPublications.length,1);
  check('retirement reason retained',await q('select reason_code as result from public.static_weekly_recurring_invalidations where publication_id=$1',[publicationId]),'SOURCE_RETIRED');
  const bytes=await q("select after_json->>'canonical_source_digest' as result from public.static_weekly_recurring_dependency_changes where origin_table='static_weekly_authority_source_documents' order by generation desc limit 1");
  check('source mutation retains exact source content hash only',bytes,binding.source_digest);
 });
 const functions=(await client.query("select oid::regprocedure::text as signature from pg_proc where pronamespace='public'::regnamespace and (proname like 'static_weekly_v21_%' or proname in ('static_weekly_v15_advance_recurring_generation','static_weekly_v3_read_manager_snapshot')) order by proname")).rows;
 for(const {signature} of functions){
  check('exact function recovery definition '+signature,await q("select definition_sql=pg_get_functiondef($1::regprocedure) as result from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure",[signature]),true);
 }
 await isolated(async()=>{
  const signature='public.static_weekly_v21_reconcile_dependency_changes(uuid)';
  const recovery=(await client.query("select object_kind,definition_sql from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure order by restore_order",[signature])).rows;
  check('typed reconciler definition and ACL recoverable',recovery.map(r=>r.object_kind),['function','grant']);
  await client.query('drop function '+signature);for(const row of recovery)await client.query(row.definition_sql);
  check('restored typed reconciler works with constrained role',(await reconcile()).authorityRevision,initialRevision);
  check('restored typed reconciler still denies service role',await q("select has_function_privilege('service_role',$1,'EXECUTE') as result",[signature]),false);
 });
 check('rollback removes every dependency change/check/terminal target',await counts(),initialCounts);
 check('rollback restores authority revision',await rev(),initialRevision);
 return {scope:'actual bound-source semantic mutation, deferred guard, constrained reconciliation, later-date invalidation, rollback and function recovery',production:false,physicalAcceptance:false};
}
