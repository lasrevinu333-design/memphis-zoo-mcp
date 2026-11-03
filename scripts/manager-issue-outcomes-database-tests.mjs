import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const container = String(process.env.ISSUE_OUTCOMES_TEST_CONTAINER || '');
if (!/^mz_schema_rebuild_[A-Za-z0-9_]+$/.test(container)) {
  throw new Error('ISSUE_OUTCOMES_TEST_CONTAINER must name an owned disposable schema-rebuild container.');
}
const secret = 'issue-disposable-secret-20261002-123';
const manager = '00000000-0000-4000-8000-000000000001';
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(statement, { failure = false } = {}) {
  const result = spawnSync('docker', ['exec', container, 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1',
    '-U', 'supabase_admin', '-d', 'postgres', '-c', statement], { encoding: 'utf8' });
  assert.equal(result.status === 0, !failure, result.stderr || result.stdout);
  return (failure ? result.stderr : result.stdout).trim();
}
const call = (ticket, outcome, reference = 'NULL', actor = manager) =>
  `select public.custodial_set_maintenance_ticket_outcome('${ticket}'::uuid,${q(outcome)},` +
  `'${actor}'::uuid,${reference},NULL,${q(secret)});`;

sql(`update public.custodial_backend_execution_config
  set execution_secret_digest=encode(extensions.digest(convert_to(${q(secret)},'UTF8'),'sha256'),'hex'),enabled=true
  where config_key=true;`);
const oldIdentity = 'public.custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)';
const newIdentity = 'public.custodial_set_maintenance_ticket_outcome(uuid,text,uuid,text,text,text)';
const queueIdentity = 'public.custodial_manager_open_problems(uuid,integer,text)';
for (const identity of [newIdentity, queueIdentity]) {
  assert.equal(sql(`select has_function_privilege('service_role',${q(identity)}::regprocedure,'EXECUTE');`), 't');
  for (const role of ['anon', 'authenticated']) {
    assert.equal(sql(`select has_function_privilege(${q(role)},${q(identity)}::regprocedure,'EXECUTE');`), 'f');
    assert.match(sql(`begin; set local role ${role}; select ${identity.slice(0, identity.indexOf('('))}(` +
      `${identity===newIdentity ? "gen_random_uuid(),'mark_fixed',gen_random_uuid(),NULL,NULL" : 'gen_random_uuid(),10'},${q(secret)}); rollback;`,
    { failure: true }), /permission denied for function/i);
  }
}
assert.equal(sql(`select has_function_privilege('service_role',${q(oldIdentity)}::regprocedure,'EXECUTE');`), 'f');
for (const privilege of ['SELECT','INSERT','UPDATE','DELETE']) {
  assert.equal(sql(`select has_table_privilege('service_role','public.maintenance_ticket_outcome_history',${q(privilege)});`),'f');
}
assert.match(sql(`begin; set local role service_role;
  select public.custodial_close_maintenance_ticket_authoritative(gen_random_uuid(),'forged',NULL,${q(secret)}); rollback;`,
{ failure: true }), /permission denied for function/i);

const workOrderTicket = sql(`insert into public.maintenance_tickets(issue_source,issue_summary,location_code_snapshot)
  values('manager_reminder','Repair fixture','ISSUE-TEST-LOCATION') returning id;`).match(/[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0];
const fixedTicket = sql(`insert into public.maintenance_tickets(issue_source,issue_summary,location_code_snapshot)
  values('completion_form','Clean-up issue','ISSUE-TEST-LOCATION') returning id;`).match(/[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0];
assert.match(workOrderTicket || '', /^[0-9a-f-]{36}$/);
assert.match(fixedTicket || '', /^[0-9a-f-]{36}$/);
assert.equal(sql(`select issue_source from public.v_open_maintenance_tickets
  where ticket_id='${workOrderTicket}'::uuid;`),'manager_reminder');
const approvedGuest = sql(`insert into public.guest_cleanliness_reports(
  location_code,issue_type,severity,status,marketing_review_status)
  values('ISSUE-TEST-LOCATION','Guest fixture issue','normal','open','approved') returning id;`)
  .match(/[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0];
const pendingGuest = sql(`insert into public.guest_cleanliness_reports(
  location_code,issue_type,severity,status,marketing_review_status)
  values('ISSUE-TEST-LOCATION','Pending guest issue','normal','open','pending') returning id;`)
  .match(/[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0];
const savedWork = sql(`insert into public.custodial_offline_reconciliation_records(
  client_session_id,client_completion_id,payload_fingerprint,payload_json,state,quarantine_reason,result_json)
  values(gen_random_uuid()::text,gen_random_uuid()::text,repeat('a',64),
    '{"protected_test_secret":"do-not-project"}'::jsonb,'quarantined','private-reason-not-for-queue','{}'::jsonb)
  returning reconciliation_id;`).match(/[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0];
for (const id of [approvedGuest,pendingGuest,savedWork]) assert.match(id || '', /^[0-9a-f-]{36}$/);
for (const [outcome, ref] of [['work_order_sent', 'NULL'], ['mark_fixed', q('SPICE-123')]]) {
  assert.match(sql(`begin; set local role service_role; ${call(workOrderTicket,outcome,ref)} rollback;`, { failure: true }),
    /external work-order reference|cannot claim an external/i);
}
assert.match(sql(`begin; set local role service_role; ${call(workOrderTicket,'work_order_sent',q('SPICE-123'),'00000000-0000-4000-8000-000000000000')} rollback;`,
  { failure: true }), /active named manager authority/i);
const before = JSON.parse(sql(`begin; set local role service_role;
  select public.custodial_manager_open_problems('${manager}'::uuid,200,${q(secret)}); commit;`).split('\n').find((line) => line.startsWith('{')));
assert.ok(before.items.some((item) => item.source_id===workOrderTicket && item.source_detail==='manager_reminder'));
assert.ok(before.items.some((item) => item.source_id===fixedTicket && item.source_detail==='completion_form'));
assert.ok(before.items.some((item) => item.source_id===savedWork && item.source==='saved_work'));
assert.ok(!JSON.stringify(before).includes('do-not-project'), 'protected payload must not enter manager queue');
assert.ok(!JSON.stringify(before).includes('private-reason-not-for-queue'), 'protected review reason must stay in its source queue');
assert.ok(!before.items.some((item) => [approvedGuest,pendingGuest].includes(item.source_id)),
  'guest queue must remain dormant while owner feature flag is disabled');
const featureOn = JSON.parse(sql(`begin;
  update public.system_settings set setting_value='true'::jsonb where setting_key='guest_issues_feature_approved';
  select public.custodial_manager_open_problems('${manager}'::uuid,200,${q(secret)}); rollback;`)
  .split('\n').find((line) => line.startsWith('{')));
assert.ok(featureOn.items.some((item) => item.source_id===approvedGuest && item.source==='guest'));
assert.ok(!featureOn.items.some((item) => item.source_id===pendingGuest));
assert.match(sql(`begin; set local role service_role;
  select public.custodial_manager_open_problems('00000000-0000-4000-8000-000000000000'::uuid,10,${q(secret)}); rollback;`,
{ failure: true }), /active named manager authority/i);

for (const [ticket,outcome,reference] of [
  [workOrderTicket,'work_order_sent',q('SPICE-123')], [fixedTicket,'mark_fixed','NULL']]) {
  const receipt = JSON.parse(sql(`begin; set local role service_role; ${call(ticket,outcome,reference)} commit;`)
    .split('\n').find((line) => line.startsWith('{')));
  assert.equal(receipt.outcome,outcome);
  assert.equal(receipt.actor_manager_id,manager);
  assert.match(sql(`begin; set local role service_role; ${call(ticket,outcome,reference)} rollback;`,{failure:true}),
    /already has a closed outcome/i);
}
assert.equal(sql(`select count(*) from public.maintenance_ticket_outcome_history
  where ticket_id in ('${workOrderTicket}'::uuid,'${fixedTicket}'::uuid);`),'2');
assert.equal(sql(`select count(*) from public.maintenance_tickets
  where id='${workOrderTicket}'::uuid and status='closed' and resolution_outcome='work_order_sent'
    and external_work_order_reference='SPICE-123' and resolution_actor_manager_id='${manager}'::uuid;`),'1');
assert.equal(sql(`select count(*) from public.maintenance_tickets
  where id='${fixedTicket}'::uuid and status='closed' and resolution_outcome='mark_fixed'
    and external_work_order_reference is null and resolution_actor_manager_id='${manager}'::uuid;`),'1');
assert.match(sql(`update public.maintenance_ticket_outcome_history set notes='rewritten'
  where ticket_id='${workOrderTicket}'::uuid;`,{failure:true}),/append-only/i);
const after = JSON.parse(sql(`begin; set local role service_role;
  select public.custodial_manager_open_problems('${manager}'::uuid,200,${q(secret)}); commit;`).split('\n').find((line) => line.startsWith('{')));
assert.ok(!after.items.some((item) => [workOrderTicket,fixedTicket].includes(item.source_id)));

// Recovery inventory must retain the exact revoked old grant, new grants,
// append-only history, and manager projection definitions.
for (const [kind, identity, current] of [
  ['grant',oldIdentity,`public.custodial_release_authority_current_grant_definition(${q(oldIdentity)})`],
  ['grant',newIdentity,`public.custodial_release_authority_current_grant_definition(${q(newIdentity)})`],
  ['grant',queueIdentity,`public.custodial_release_authority_current_grant_definition(${q(queueIdentity)})`],
  ['relation','public.maintenance_ticket_outcome_history',
    "public.custodial_release_authority_current_relation_definition('public.maintenance_ticket_outcome_history')"],
  ['view','public.v_open_maintenance_tickets',
    "public.custodial_release_authority_current_view_definition('public.v_open_maintenance_tickets')"],
]) {
  assert.equal(sql(`select count(*) from public.custodial_release_authority_restore_inventory i
    where i.object_kind=${q(kind)} and ${kind==='grant' ? `to_regprocedure(i.object_identity)=to_regprocedure(${q(identity)})` : `i.object_identity=${q(identity)}`}
      and i.definition_sha256=public.static_weekly_digest_text(${current});`),'1', `${kind}:${identity}`);
}
assert.equal(sql(`select count(*) from public.custodial_terminal_writer_inventory i
  where i.application_callable and (i.mutates_terminal_truth or i.delegates_alternate_terminal_authority)
    and i.oid in ('${oldIdentity}'::regprocedure,'${newIdentity}'::regprocedure);`),'1');
const newGrantRestore = sql(`select definition_sql from public.custodial_release_authority_restore_inventory
  where object_kind='grant' and to_regprocedure(object_identity)='${newIdentity}'::regprocedure;`);
const oldGrantRestore = sql(`select definition_sql from public.custodial_release_authority_restore_inventory
  where object_kind='grant' and to_regprocedure(object_identity)='${oldIdentity}'::regprocedure;`);
sql(`revoke execute on function ${newIdentity} from service_role;`);
assert.equal(sql(`select has_function_privilege('service_role','${newIdentity}'::regprocedure,'EXECUTE');`),'f');
sql(newGrantRestore);
assert.equal(sql(`select has_function_privilege('service_role','${newIdentity}'::regprocedure,'EXECUTE');`),'t');
sql(`grant execute on function ${oldIdentity} to service_role;`);
assert.equal(sql(`select has_function_privilege('service_role','${oldIdentity}'::regprocedure,'EXECUTE');`),'t');
sql(oldGrantRestore);
assert.equal(sql(`select has_function_privilege('service_role','${oldIdentity}'::regprocedure,'EXECUTE');`),'f');
console.log(JSON.stringify({pass:true,container,denied_roles:['anon','authenticated'],old_writer:'denied',
  manager_actor:manager,outcomes:['work_order_sent','mark_fixed'],history_rows:2,queue_removal:'pass',
  recovery_inventory:'exact_for_issue_objects',grant_recovery:'old_denied_new_restored'}));
