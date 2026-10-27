import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createOctoberDatedPostgresStore} from '../../src/static-weekly-dated-transition-postgres.js';
import {createOctoberDatedMaterializationController} from '../../src/static-weekly-dated-transition-materialization.js';
const q=x=>`'${String(x).replaceAll("'","''")}'`;
const fence='memphis-zoo-application-mutation-fence';
const authority='memphis-static-weekly-authority';
async function waitForAdvisory(query,pid){
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){const r=await query('select wait_event from pg_stat_activity where pid=$1',[pid]);if(r.rows[0]?.wait_event==='advisory')return;await new Promise(r=>setTimeout(r,30));}
 throw Error('bounded fixture did not reach advisory wait');
}
// A real restore-style exclusive fence owner competes with the actual adapter.
// No snapshot/truncate/generation change or production restore is performed.
export async function withRestoreFence({pool,query,operation,check,label}){
 const restore=await pool.connect();let actor,pid;
 const database={async connect(){const c=await pool.connect();pid=c.processID;return c;}};
 try{
  await restore.query('begin');await restore.query("set local lock_timeout='700ms'");
  await restore.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[fence]);
  actor=operation(database);const outcome=actor.then(value=>({value}),error=>({error}));
  const deadline=Date.now()+5000;while(!pid&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.ok(pid);
  await waitForAdvisory(query,pid);
  await restore.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[authority]);
  await restore.query('select employee_code from public.employees limit 1 for update');
  check('actual two-session restore fence precedes authority/source '+label,()=>{});
  await restore.query('rollback');
  const result=await outcome;if(result.error)throw result.error;return result.value;
 }finally{
  await restore.query('rollback').catch(()=>{});restore.release();
  // Releasing the exclusive fence unblocks the exact actor before fixture exit.
  if(actor)await actor.catch(()=>{});
 }
}
export async function correctWebAuthority({sql,query,read,pool,controller,plan,manager,rev,preview,accepted,check}){
 const employee=plan.rosterSlots.find(r=>r.personId),slot=plan.rosterSlots.find(r=>!r.personId)||employee;
 const digest=async()=> (await query('select static_weekly_digest_jsonb(custodial_dated_dependencies($1::jsonb)) digest',[JSON.stringify(plan)])).rows[0].digest;
 const failures={};
 for(const [kind,table,key,id,column] of [['employee','employees','id',employee.personId,'employee_code'],['slot','weekly_roster_slots','slot_id',slot.slotId,'slot_code']]){
  const client=await pool.connect();try{
   await client.query('begin');const before=(await client.query('select static_weekly_digest_jsonb(custodial_dated_dependencies($1::jsonb)) digest',[JSON.stringify(plan)])).rows[0].digest;
   if(kind==='slot'){
    await assert.rejects(()=>client.query(`update public.${table} set ${column}=${column}||'_web_drift' where ${key}=$1`,[id]),e=>e.code==='23514'&&e.message.includes('append-only'));
    failures[kind]={ordinaryMutationDenied:'23514',appendOnlyBoundaryPreserved:true};
    check('F5 slot-code ordinary drift prevented by existing append-only trigger',()=>{});
    continue;
   }
   await client.query(`update public.${table} set ${column}=${column}||'_web_drift' where ${key}=$1`,[id]);
   const after=(await client.query('select static_weekly_digest_jsonb(custodial_dated_dependencies($1::jsonb)) digest',[JSON.stringify(plan)])).rows[0].digest;
   const roster=(await client.query("select * from public.static_weekly_v6_read_roster(date '2026-10-01') where slot_id=$1",[kind==='employee'?employee.slotId:slot.slotId])).rows[0];
   assert.equal(before,after);assert.ok(roster[column].endsWith('_web_drift'));assert.equal(roster.projection_status,'current');
   failures[kind]={digestUnchanged:true,liveOutputChanged:true,projectionStatus:roster.projection_status};
  }finally{await client.query('rollback');client.release();}
 }
 check('F5 reproduced: live mutable employee code escapes the old dependency digest',()=>{});
 const allowed=()=>query("select p.proname,jsonb_agg(coalesce(r.rolname::text,'PUBLIC') order by coalesce(r.rolname::text,'PUBLIC')) roles from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid=a.grantee where p.oid in('public.static_weekly_v5_read_employee_day(date,uuid,timestamptz)'::regprocedure,'public.static_weekly_v27_read_home_time_facts(date,uuid,uuid,uuid)'::regprocedure) and a.privilege_type='EXECUTE' and a.grantee<>p.proowner group by p.proname order by p.proname");
 const priorAcl=(await allowed()).rows;assert.ok(priorAcl.every(r=>r.roles.includes('static_weekly_control_plane')));failures.readerGrants=priorAcl;
 check('F6 reproduced: employee/Home readers unnecessarily executable by writer role',()=>{});
 // Reproduce the old adapter's lock inversion using its exact preserved bytes.
 const source=fs.readFileSync(new URL('./dated-postgres-before-web.txt',import.meta.url),'utf8').replace(/from '(\.\/[^']+)'/g,(_m,p)=>`from '${new URL('../../src/'+p.slice(2),import.meta.url).href}'`);
 const {createOctoberDatedPostgresStore:beforeStore}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const restore=await pool.connect();let actor,pid;
 try{
  await restore.query('begin');await restore.query("set local lock_timeout='500ms'");await restore.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[fence]);
  actor=beforeStore({plan,database:{async connect(){const c=await pool.connect();pid=c.processID;return c;}}}).transaction(async tx=>{await tx.snapshot(manager.managerId,plan.effectiveStart,plan.effectiveEndExclusive);await tx.stage(plan);});
  const outcome=actor.then(value=>({value}),error=>({error}));
  const deadline=Date.now()+5000;while(!pid&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.ok(pid);await waitForAdvisory(query,pid);
  await assert.rejects(()=>restore.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[authority]),e=>e.code==='55P03');
  failures.restoreOrder={oldActorWaitsForFenceWhileHoldingAuthority:true,restoreAuthorityLockTimedOut:true};
  await restore.query('rollback');const result=await outcome;assert.ok(result.error);
  check('F2 reproduced: real exclusive restore owner cannot drain old authority-first transaction',()=>{});
 }finally{await restore.query('rollback').catch(()=>{});restore.release();if(actor)await actor.catch(()=>{});}
 if(process.env.DATED_POSTGRES_EVIDENCE_DIR)fs.writeFileSync(process.env.DATED_POSTGRES_EVIDENCE_DIR+'/web-authority-fail-before.json',JSON.stringify(failures,null,2)+'\n');
 await sql(fs.readFileSync(new URL('../../supabase/migrations/20261001161831_october_dated_review_authority_corrections.sql',import.meta.url),'utf8'));
 // postgres is the retained privileged administration grant, not an application caller.
 const roles=(await allowed()).rows;check('exact minimum runtime reader ACL set plus retained privileged postgres grant after correction',()=>{assert.equal(roles.length,2);for(const r of roles)assert.deepEqual(r.roles,['custodial_application_reader','postgres','service_role']);});
 const oldStale=await read("select * from public.static_weekly_v6_schedule_authority_state(date '2026-10-01')");
 check('expanded digest invalidates historical incomplete dependency attestation',()=>assert.equal(oldStale[0].projection_status,'stale_dated_dependency'));
 // An actual authorized append-only rollback/new fixture publication binds the
 // strengthened digest. Never edit a prior receipt or publication to bless it.
 const oldRows=(await query('select to_jsonb(p) value from public.custodial_dated_publications p order by publication_id')).rows;
 await controller.rollback({manager,expectedRevision:accepted.revision,idempotencyKey:'web-baseline-withdraw',publicationId:accepted.publicationId,projectionId:accepted.projectionId});
 rev=accepted.revision+1;preview=await controller.preview({manager,expectedRevision:rev});
 accepted=await controller.confirm({manager,expectedRevision:rev,idempotencyKey:'sql-october-one',previewDigest:preview.previewDigest});
 check('strengthened publication preserves exact immutable baseline history',()=>{});
 for(const row of oldRows){const actual=(await query('select to_jsonb(p) value from public.custodial_dated_publications p where publication_id=$1',[row.value.publication_id])).rows[0].value;assert.deepEqual(actual,row.value);}
 const originalDigest=await digest();
 for(const [kind,table,key,id,column] of [['employee','employees','id',employee.personId,'employee_code'],['slot','weekly_roster_slots','slot_id',slot.slotId,'slot_code']]){
  const client=await pool.connect();try{
   await client.query('begin');
   if(kind==='slot'){
    await assert.rejects(()=>client.query(`update public.${table} set ${column}=${column}||'_web_drift' where ${key}=$1`,[id]),e=>e.code==='23514'&&e.message.includes('append-only'));
    check('actual slot-code mutation guard retained after digest correction',()=>{});
    continue;
   }
   await client.query(`update public.${table} set ${column}=${column}||'_web_drift' where ${key}=$1`,[id]);
   const changed=(await client.query('select static_weekly_digest_jsonb(custodial_dated_dependencies($1::jsonb)) digest',[JSON.stringify(plan)])).rows[0].digest;assert.notEqual(changed,originalDigest);
   await client.query('set local role custodial_application_reader');
   const state=(await client.query("select * from public.static_weekly_v6_schedule_authority_state(date '2026-10-01')")).rows[0];
   const roster=(await client.query("select * from public.static_weekly_v6_read_roster(date '2026-10-01')")).rows;
   check('actual emitted-code drift marks stale and refuses roster '+kind,()=>{assert.equal(state.projection_status,'stale_dated_dependency');assert.equal(roster.length,0);});
  }finally{await client.query('rollback');client.release();}
  assert.equal(await digest(),originalDigest);
 }
 const immutable=async()=> (await query("select jsonb_build_object('publications',(select jsonb_agg(p order by publication_id) from public.custodial_dated_publications p),'activations',(select jsonb_agg(a order by authority_revision) from public.custodial_dated_activations a),'receipts',(select jsonb_agg(r order by operation_key) from public.custodial_dated_receipts r)) value")).rows[0].value;
 const request={manager,expectedRevision:rev,idempotencyKey:'sql-october-one',previewDigest:preview.previewDigest};
 const beforeRetry=await immutable();await sql(`update public.employees set active=false where id=${q(employee.personId)};`);
 try{
  const retried=await controller.confirm(request);check('actual immutable exact retry succeeds after invalid current employee dependency',()=>{assert.equal(retried.replayed,true);assert.equal(retried.publicationId,accepted.publicationId);});
  await assert.rejects(()=>controller.confirm({...request,idempotencyKey:'web-new-key-drift'}));checksPush(check,'new operation still refuses invalid dependencies');
  await assert.rejects(()=>controller.confirm({...request,expectedRevision:rev+1}),/idempotency conflict/);checksPush(check,'same-key changed request rejected before drift admission');
  await sql(`update public.ops_manager_managers set active=false where manager_id=${q(manager.managerId)};`);
  await assert.rejects(()=>controller.confirm(request));checksPush(check,'actual revoked named manager cannot retrieve accepted retry');
 }finally{await sql(`update public.employees set active=true where id=${q(employee.personId)};update public.ops_manager_managers set active=true where manager_id=${q(manager.managerId)};`);}
 assert.deepEqual(await immutable(),beforeRetry);check('drift/revocation retries leave all immutable history unchanged',()=>{});
 const fencedRetry=await withRestoreFence({pool,query,check,label:'confirm',operation:database=>createOctoberDatedMaterializationController({plan,store:createOctoberDatedPostgresStore({database,plan})}).confirm(request)});
 assert.equal(fencedRetry.replayed,true);
 // Replaying precise captured definitions and ACLs must preserve contract.
 const recovery=(await query("select object_kind,object_identity,definition_sql,to_regprocedure(object_identity)::oid oid,case when object_kind='function' then pg_get_functiondef(to_regprocedure(object_identity)) else public.custodial_release_authority_current_grant_definition(object_identity) end current_definition from public.custodial_release_authority_restore_inventory where object_kind in('function','grant') and object_identity like any(array['%custodial_dated_control(%','%custodial_dated_dependencies(%','%static_weekly_v5_read_employee_day(%','%static_weekly_v27_read_home_time_facts(%']) order by restore_order")).rows;
 // Retain baseline inventory aliases. Every semantic object must have both
 // kinds and EVERY captured alias must contain the exact current definition.
 check('all four corrected authority/reader functions and every exact ACL alias recaptured',()=>{
  assert.equal(new Set(recovery.map(r=>r.oid)).size,4);
  for(const oid of new Set(recovery.map(r=>r.oid)))assert.deepEqual([...new Set(recovery.filter(r=>r.oid===oid).map(r=>r.object_kind))].sort(),['function','grant']);
  for(const r of recovery)assert.equal(r.definition_sql,r.current_definition,r.object_identity);
 });
 if(process.env.DATED_POSTGRES_EVIDENCE_DIR)fs.writeFileSync(process.env.DATED_POSTGRES_EVIDENCE_DIR+'/web-authority-recovery.json',JSON.stringify(recovery,null,2)+'\n');
 await sql(recovery.map(r=>r.definition_sql+';').join('\n'));
 const recoveredRoles=(await allowed()).rows;
 check('exact recovery replay preserves minimum reader role sets',()=>assert.deepEqual(recoveredRoles,roles));
 assert.equal(await digest(),originalDigest);
 return {rev,preview,accepted};
}
function checksPush(check,label){check(label,()=>{});}
