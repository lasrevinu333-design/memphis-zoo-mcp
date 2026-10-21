#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync=promisify(execFile);
const container=String(process.env.GEMINI_CONSOLE_TEST_DOCKER_CONTAINER||"").trim();
const database=String(process.env.GEMINI_CONSOLE_TEST_DATABASE||"postgres").trim();
if(!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)||!/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database))throw new Error("A disposable schema-rebuild database is required.");

async function sql(statement){
  const {stdout}=await execFileAsync("docker",["exec",container,"psql","-v","ON_ERROR_STOP=1","-At","-U","supabase_admin","-d",database,"-c",statement],{maxBuffer:16*1024*1024});
  return stdout.trim();
}
async function json(expression){const output=await sql(`select (${expression})::text;`);return JSON.parse(output.split("\n").at(-1));}
async function fails(expression,pattern){let failure=null;try{await sql(`select (${expression})::text;`);}catch(error){failure=error;}assert.ok(failure,"query must fail");assert.match(String(failure.stderr||failure.message),pattern);}
const literal=(value)=>`'${String(value).replaceAll("'","''")}'`;

if(process.argv.includes("--original-preservation-only")){
  const remainingOnly=process.argv.includes('--remaining-after-correlation');
  // This selector deliberately bypasses the historical foundation/repair
  // cases. Main supplies the disposable container after applying source269.
  const roleSql=statement=>sql(`set role service_role; ${statement}`);
  const roleJson=async expression=>JSON.parse((await roleSql(`select (${expression})::text;`)).split("\n").at(-1));
  const roleFails=async(expression,pattern)=>{let error;
    try{await roleJson(expression);}catch(caught){error=caught;}
    assert.ok(error,"original operation must refuse");assert.match(String(error.stderr||error.message),pattern);
  };
  const sourceFns=[
    "public.gemini_console_begin_turn(uuid,uuid,uuid,text,uuid[],uuid)",
    "public.gemini_console_complete_turn(uuid,text,text,text,uuid,jsonb)",
  ];
  const acl=()=>json(`(select jsonb_agg(jsonb_build_object(
    'identity',p.oid::regprocedure::text,'owner',p.proowner::regrole::text,
    'acl',coalesce(p.proacl::text,''),'source_sha256',public.static_weekly_digest_text(p.prosrc),
    'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),
    'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
    'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'inventory_function_sha256',(select i.definition_sha256 from public.custodial_release_authority_restore_inventory i
      where i.object_kind='function' and i.object_identity like '%(%' and to_regprocedure(i.object_identity)=p.oid),
    'inventory_grant_sha256',(select i.definition_sha256 from public.custodial_release_authority_restore_inventory i
      where i.object_kind='grant' and i.object_identity like '%(%' and to_regprocedure(i.object_identity)=p.oid)
    ) order by p.oid::regprocedure::text) from pg_proc p where p.oid in
    (${sourceFns.map(name=>`${literal(name)}::regprocedure`).join(',')}))`);
  const scope=()=>sql(`select public.static_weekly_digest_text(coalesce(string_agg(
    object_kind||'|'||object_identity||'|'||definition_sha256,E'\\n' order by object_kind,object_identity),''))
    from public.custodial_release_authority_restore_inventory;`);
  const beforeAcl=await acl(),beforeScope=await scope();
  assert.equal(beforeAcl.length,2);
  for(const item of beforeAcl){assert.equal(item.service_execute,true);assert.equal(item.anon_execute,false);
    assert.equal(item.authenticated_execute,false);assert.equal(item.inventory_function_sha256,null);
    assert.equal(item.inventory_grant_sha256,null);}
  const manager=(await sql("select manager_id from public.ops_manager_managers where system_key='eric_custodial_manager';")).split("\n").at(-1);
  assert.match(manager,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  const conversation=randomUUID(),client=randomUUID(),correlation=randomUUID(),attachments=[randomUUID(),randomUUID()];
  const body="Original two-attachment message; preserve exact order";
  await sql(`insert into public.gemini_console_conversations(conversation_id,owner_manager_id,title)
    values (${literal(conversation)}::uuid,${literal(manager)}::uuid,'Original-preservation fixture');`);
  for(const [index,id] of attachments.entries())await sql(`insert into public.gemini_console_attachments
    (attachment_id,conversation_id,manager_id,storage_path,original_filename,mime_type,extension,size_bytes,sha256)
    values (${literal(id)}::uuid,${literal(conversation)}::uuid,${literal(manager)}::uuid,
    ${literal(`original-preservation/${id}`)},${literal(`evidence-${index}.txt`)},'text/plain','.txt',4,
    ${literal(index===0?'a'.repeat(64):'b'.repeat(64))});`);
  const array=ids=>ids.length?`array[${ids.map(id=>id===null?'null::uuid':`${literal(id)}::uuid`).join(',')}]::uuid[]`:"'{}'::uuid[]";
  const begin=(id=client,corr=correlation,ids=attachments,text=body,owner=manager,target=conversation)=>
    `public.gemini_console_begin_turn(${literal(target)}::uuid,${literal(owner)}::uuid,
      ${literal(id)}::uuid,${literal(text)},${array(ids)},${literal(corr)}::uuid)`;
  const metadata={fixture:"original-preservation-only"};
  const complete=(userId,reply="Original assistant response",provider="google_gemini",model="fixture-model",corr=correlation,meta=metadata)=>
    `public.gemini_console_complete_turn(${literal(userId)}::uuid,${literal(reply)},${literal(provider)},
      ${literal(model)},${literal(corr)}::uuid,${literal(JSON.stringify(meta))}::jsonb)`;
  const rows=(target=conversation)=>json(`(select coalesce(jsonb_agg(to_jsonb(m) order by m.message_id),'[]'::jsonb)
    from public.gemini_console_messages m where m.conversation_id=${literal(target)}::uuid)`);
  const rowHash=async target=>createHash('sha256').update(JSON.stringify(await rows(target))).digest('hex');
  const negativeHashes={};let reachedRemaining=false;
  const refusedUnchanged=async(label,expression,pattern,target=conversation)=>{
    if(remainingOnly&&!reachedRemaining){if(label==='changed completion correlation')reachedRemaining=true;else return;}
    const before=await rowHash(target);await roleFails(expression,pattern);
    const after=await rowHash(target);negativeHashes[label]={before,after};
    assert.equal(after,before,`${label} changed a full persisted message row`);};

  const [first,second]=await Promise.all([roleJson(begin()),roleJson(begin())]);
  assert.equal([first,second].filter(result=>result.inserted).length,1);
  assert.equal([first,second].filter(result=>result.claimed).length,1);
  assert.equal(first.user_message.message_id,second.user_message.message_id);
  assert.equal(first.user_message.correlation_id,correlation);
  assert.deepEqual(first.user_message.metadata_json.original_attachment_ids,attachments);
  assert.equal(first.user_message.metadata_json.original_client_time_policy,'LOCAL_DISPLAY_METADATA_NOT_SERVER_AUTHORITY');
  const userId=first.user_message.message_id;
  const [completedOne,completedTwo]=await Promise.all([roleJson(complete(userId)),roleJson(complete(userId))]);
  assert.deepEqual(completedOne,completedTwo,"concurrent identical completions must reuse one persisted assistant");
  assert.equal(completedOne.response_to_message_id,userId);
  const acceptedRows=await rows();assert.equal(acceptedRows.length,2);
  assert.equal(acceptedRows.filter(row=>row.role==='user'&&row.state==='completed').length,1);
  assert.equal(acceptedRows.filter(row=>row.role==='assistant'&&row.state==='completed').length,1);
  const acceptedHash=await rowHash(),replayed=await roleJson(begin());
  assert.equal(replayed.claimed,false);assert.deepEqual(replayed.assistant_message,completedOne);
  assert.deepEqual(await roleJson(complete(userId)),completedOne);
  assert.equal(await rowHash(),acceptedHash,"same original replay altered completed rows or timestamps");

  await refusedUnchanged('wrong correlation',begin(client,randomUUID()),/original message request identity|conflict/i);
  await refusedUnchanged('wrong body',begin(client,correlation,attachments,'changed original body'),/conflict/i);
  await refusedUnchanged('reordered attachments',begin(client,correlation,[...attachments].reverse()),/original message request identity|conflict/i);
  await refusedUnchanged('extra attachment',begin(client,correlation,[...attachments,randomUUID()]),/original message request identity|conflict/i);
  await refusedUnchanged('duplicate attachment',begin(randomUUID(),randomUUID(),[attachments[0],attachments[0]]),/distinct and bounded/i);
  await refusedUnchanged('null attachment',begin(randomUUID(),randomUUID(),[attachments[0],null]),/distinct and bounded/i);
  await refusedUnchanged('more than eight attachments',begin(randomUUID(),randomUUID(),Array.from({length:9},()=>randomUUID())),/distinct and bounded/i);
  for(const [label,expression] of [
    ['changed completion body',complete(userId,'replacement reply')],
    ['changed provider',complete(userId,undefined,'other_provider')],
    ['changed model',complete(userId,undefined,undefined,'other-model')],
    ['changed metadata',complete(userId,undefined,undefined,undefined,correlation,{fixture:'rewritten'})],
    ['changed completion correlation',complete(userId,undefined,undefined,undefined,randomUUID())],
  ])await refusedUnchanged(label,expression,label==='changed completion correlation'
    ? /original turn identity or manager authority changed/i : /original completed turn conflicts/i);

  // Fixture-only historical shape: create through the normal RPC, then remove
  // only the new metadata keys to model a pre-269 row. Do not backfill it.
  const legacyId=randomUUID(),legacyCorr=randomUUID();
  await roleJson(begin(legacyId,legacyCorr,[],"Historical legacy fixture"));
  await sql(`update public.gemini_console_messages set metadata_json='{"source":"direct_authenticated_user"}'::jsonb
    where manager_id=${literal(manager)}::uuid and client_message_id=${literal(legacyId)}::uuid;`);
  await refusedUnchanged('legacy metadata',begin(legacyId,legacyCorr,[],"Historical legacy fixture"),/original message request identity|conflict/i);
  assert.deepEqual(await json(`(select metadata_json from public.gemini_console_messages
    where manager_id=${literal(manager)}::uuid and client_message_id=${literal(legacyId)}::uuid)`),
    {source:'direct_authenticated_user'});

  for(const state of ['failed','cancelled']){
    const failedId=randomUUID(),failedCorr=randomUUID(),started=await roleJson(begin(failedId,failedCorr,[],`${state} fixture`));
    await roleJson(`public.gemini_console_fail_turn(${literal(started.user_message.message_id)}::uuid,
      ${literal(state)},'fixture_stop','Original request retained')`);
    await refusedUnchanged(`${state} original completion`,complete(started.user_message.message_id,'late reply',undefined,undefined,failedCorr),/not generating/i);
  }

  const revokedManager=randomUUID(),revokedConversation=randomUUID(),revokedClient=randomUUID(),revokedCorr=randomUUID();
  await sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,metadata_json)
    values (${literal(revokedManager)}::uuid,'Disposable revoked original manager',array['OPS_MANAGER'],true,'{"test":true}'::jsonb);
    insert into public.gemini_console_conversations(conversation_id,owner_manager_id,title)
    values (${literal(revokedConversation)}::uuid,${literal(revokedManager)}::uuid,'Revoked fixture');`);
  const revokedStart=await roleJson(begin(revokedClient,revokedCorr,[],"Revoked manager fixture",revokedManager,revokedConversation));
  await sql(`update public.ops_manager_managers set active=false where manager_id=${literal(revokedManager)}::uuid;`);
  await refusedUnchanged('revoked manager completion',complete(revokedStart.user_message.message_id,'late reply',undefined,undefined,revokedCorr),/manager authority changed/i,revokedConversation);
  await refusedUnchanged('revoked manager begin',begin(randomUUID(),randomUUID(),[],"new after revocation",revokedManager,revokedConversation),/active manager not found/i,revokedConversation);
  const deniedBefore=await rowHash();
  let denied;try{await sql(`set role authenticated; select ${begin(randomUUID(),randomUUID(),[],"denied caller")}::text;`);}catch(error){denied=error;}
  assert.ok(denied,"authenticated caller must have no RPC execution");
  assert.match(String(denied.stderr||denied.message),/permission denied/i);
  const deniedAfter=await rowHash();negativeHashes['denied caller']={before:deniedBefore,after:deniedAfter};
  assert.equal(deniedAfter,deniedBefore,"denied caller changed a persisted message row");
  assert.deepEqual(await acl(),beforeAcl,"two RPC ACL/owner/definition/recovery pins changed");
  assert.equal(await scope(),beforeScope,"unrelated or target recovery inventory scope changed during fixture");
  console.log(JSON.stringify({ok:true,selector:'original-preservation-only',role:'service_role',
    two_identical_begins_one_user:true,two_identical_completions_one_assistant:true,
    completed_rows_sha256:acceptedHash,final_rows_sha256:await rowHash(),negative_full_row_hashes:negativeHashes,
    rejected_originals_unchanged:true,legacy_unchanged:true,acl_and_recovery_scope_unchanged:true,
    external_provider:false,real_manager_browser:false}));
}else{
const ericId=(await sql("select manager_id from public.ops_manager_managers where system_key='eric_custodial_manager';")).split("\n").at(-1);
assert.match(ericId,/^[0-9a-f-]{36}$/i);
const ericCredential=randomUUID();
const ericTokenHash=randomUUID().replaceAll("-","").repeat(2);
await sql(`insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at,metadata_json) values ('${ericCredential}'::uuid,'gemini-db-eric-${ericCredential}','Gemini DB Eric','${ericTokenHash}','full_access','${ericId}'::uuid,now()+interval '1 day','{"test":true}'::jsonb);`);
const conversation=randomUUID();
await sql(`insert into public.gemini_console_conversations(conversation_id,owner_manager_id,title) values ('${conversation}'::uuid,'${ericId}'::uuid,'Concurrency fixture');`);

const clientId=randomUUID();const correlations=Array.from({length:10},()=>randomUUID());
const starts=await Promise.all(correlations.map(correlation=>json(`public.gemini_console_begin_turn('${conversation}'::uuid,'${ericId}'::uuid,'${clientId}'::uuid,'One durable logical message','{}'::uuid[],'${correlation}'::uuid)`)));
assert.equal(starts.filter(row=>row.inserted).length,1,"exactly one user row is inserted");
assert.equal(starts.filter(row=>row.claimed).length,1,"exactly one request claims generation");
assert.equal(new Set(starts.map(row=>row.user_message.message_id)).size,1,"all retries resolve to one logical message");
const userMessageId=starts[0].user_message.message_id;
const assistant=await json(`public.gemini_console_complete_turn('${userMessageId}'::uuid,'One durable response','google_gemini','fixture-model','${randomUUID()}'::uuid,'{"test":true}'::jsonb)`);
assert.equal(assistant.response_to_message_id,userMessageId);
const replay=await json(`public.gemini_console_begin_turn('${conversation}'::uuid,'${ericId}'::uuid,'${clientId}'::uuid,'One durable logical message','{}'::uuid[],'${randomUUID()}'::uuid)`);
assert.equal(replay.claimed,false);assert.equal(replay.assistant_message.message_id,assistant.message_id);
assert.equal(await sql(`select count(*) from public.gemini_console_messages where conversation_id='${conversation}'::uuid;`),"2");
await fails(`public.gemini_console_begin_turn('${conversation}'::uuid,'${ericId}'::uuid,'${clientId}'::uuid,'Conflicting body','{}'::uuid[],'${randomUUID()}'::uuid)`,/conflicts with another logical message/i);

const attachmentId=randomUUID();
await sql(`insert into public.gemini_console_attachments(attachment_id,conversation_id,manager_id,storage_path,original_filename,mime_type,extension,size_bytes,sha256) values ('${attachmentId}'::uuid,'${conversation}'::uuid,'${ericId}'::uuid,'test/${attachmentId}','evidence.txt','text/plain','.txt',4,'${"b".repeat(64)}');`);
const attachmentClient=randomUUID();const attachmentTurn=await json(`public.gemini_console_begin_turn('${conversation}'::uuid,'${ericId}'::uuid,'${attachmentClient}'::uuid,'Use attached evidence',array['${attachmentId}'::uuid],'${randomUUID()}'::uuid)`);
assert.equal(attachmentTurn.claimed,true);
assert.equal(await sql(`select status||':'||(message_id is not null)::text from public.gemini_console_attachments where attachment_id='${attachmentId}'::uuid;`),"attached:true");

const auditClient=randomUUID();const auditTurn=await json(`public.gemini_console_begin_turn('${conversation}'::uuid,'${ericId}'::uuid,'${auditClient}'::uuid,'Audit disposable gemini repair workflow fixture','{}'::uuid[],'${randomUUID()}'::uuid)`);
const auditAssistant=await json(`public.gemini_console_complete_turn('${auditTurn.user_message.message_id}'::uuid,'Verified disposable plan','google_gemini','fixture-model','${randomUUID()}'::uuid,'{}'::jsonb)`);
const proposalId=randomUUID();
await sql(`insert into public.gemini_console_repair_proposals(proposal_id,conversation_id,source_message_id,proposed_by_manager_id,plan_sha256,plan_text,repair_kind) values ('${proposalId}'::uuid,'${conversation}'::uuid,'${auditAssistant.message_id}'::uuid,'${ericId}'::uuid,'${"c".repeat(64)}','Verified disposable plan','acceptance_probe');`);
const authorizationClient=randomUUID();const authorization=await json(`public.gemini_console_begin_turn('${conversation}'::uuid,'${ericId}'::uuid,'${authorizationClient}'::uuid,'Fix it.','{}'::uuid[],'${randomUUID()}'::uuid)`);
const job=await json(`public.gemini_console_authorize_repair('${proposalId}'::uuid,'${ericId}'::uuid,'${ericCredential}'::uuid,'${authorization.user_message.message_id}'::uuid,'${authorizationClient}'::uuid,'fixture-release','fixture-backend','fixture-frontend','${"d".repeat(64)}','${randomUUID()}'::uuid)`);
assert.equal(job.execution_mode,"acceptance_probe");assert.equal(job.status,"completed");assert.equal(job.test_evidence[0].result,"pass");assert.equal(job.rollback_evidence[0].result,"pass");

await json(`public.gemini_console_worker_heartbeat('db-test-worker',true,'{"protocol":"gemini-controlled-repair.v1"}'::jsonb,'fixture-release','${"1".repeat(40)}')`);
const controlledAudit=await json(`public.gemini_console_begin_turn('${conversation}'::uuid,'${ericId}'::uuid,'${randomUUID()}'::uuid,'Audit controlled repair worker fixture','{}'::uuid[],'${randomUUID()}'::uuid)`);
const controlledAssistant=await json(`public.gemini_console_complete_turn('${controlledAudit.user_message.message_id}'::uuid,'Controlled repair plan','google_gemini','fixture-model','${randomUUID()}'::uuid,'{}'::jsonb)`);
const controlledProposal=randomUUID();
await sql(`insert into public.gemini_console_repair_proposals(proposal_id,conversation_id,source_message_id,proposed_by_manager_id,plan_revision,plan_sha256,plan_text,repair_kind) values ('${controlledProposal}'::uuid,'${conversation}'::uuid,'${controlledAssistant.message_id}'::uuid,'${ericId}'::uuid,2,'${"2".repeat(64)}','Controlled repair plan','controlled_source_repair');`);
const controlledAuthClient=randomUUID();
const controlledAuth=await json(`public.gemini_console_begin_turn('${conversation}'::uuid,'${ericId}'::uuid,'${controlledAuthClient}'::uuid,'Fix it.','{}'::uuid[],'${randomUUID()}'::uuid)`);
const controlledJob=await json(`public.gemini_console_authorize_repair('${controlledProposal}'::uuid,'${ericId}'::uuid,'${ericCredential}'::uuid,'${controlledAuth.user_message.message_id}'::uuid,'${controlledAuthClient}'::uuid,'fixture-release','${"1".repeat(40)}','${"3".repeat(40)}','${"4".repeat(64)}','${randomUUID()}'::uuid)`);
assert.equal(controlledJob.execution_mode,"controlled_worker");assert.equal(controlledJob.status,"authorized");
const claimed=await json(`(select to_jsonb(j) from public.gemini_console_claim_repair_jobs('db-test-worker',1,300) j limit 1)`);
assert.equal(claimed.repair_job_id,controlledJob.repair_job_id);assert.equal(claimed.status,"backing_up");assert.equal(claimed.attempt_count,1);
await fails(`public.gemini_console_finish_repair_job('${claimed.repair_job_id}'::uuid,'${claimed.lease_token}'::uuid,'completed',null,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,null,null)`,/completed repair requires test and verification evidence/i);
const backedUp=await json(`public.gemini_console_record_repair_backup('${claimed.repair_job_id}'::uuid,'${claimed.lease_token}'::uuid,'backup://db-test','{"sha256_verified":true}'::jsonb)`);
assert.equal(backedUp.status,"repairing");assert.equal(backedUp.backup_reference,"backup://db-test");
const finishedJob=await json(`public.gemini_console_finish_repair_job('${claimed.repair_job_id}'::uuid,'${claimed.lease_token}'::uuid,'completed','audit3/db-test','["fixture.js"]'::jsonb,'[{"result":"pass"}]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[{"result":"pass"}]'::jsonb,'[{"result":"available"}]'::jsonb,null,null)`);
assert.equal(finishedJob.status,"completed");assert.equal(finishedJob.lease_token,null);assert.equal(finishedJob.test_evidence[0].result,"pass");

const ordinaryId=randomUUID();const ordinaryCredential=randomUUID();const ordinaryConversation=randomUUID();
const ordinaryTokenHash=randomUUID().replaceAll("-","").repeat(2);
await sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,metadata_json) values ('${ordinaryId}'::uuid,'Disposable Ordinary Manager',array['OPS_MANAGER'],true,'{"test":true}'::jsonb); insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at,metadata_json) values ('${ordinaryCredential}'::uuid,'gemini-db-ordinary-${ordinaryCredential}','Gemini DB Ordinary','${ordinaryTokenHash}','full_access','${ordinaryId}'::uuid,now()+interval '1 day','{"test":true}'::jsonb); insert into public.gemini_console_conversations(conversation_id,owner_manager_id,title) values ('${ordinaryConversation}'::uuid,'${ordinaryId}'::uuid,'Ordinary fixture');`);
const ordinaryAudit=await json(`public.gemini_console_begin_turn('${ordinaryConversation}'::uuid,'${ordinaryId}'::uuid,'${randomUUID()}'::uuid,'Audit disposable fixture','{}'::uuid[],'${randomUUID()}'::uuid)`);
const ordinaryPlan=await json(`public.gemini_console_complete_turn('${ordinaryAudit.user_message.message_id}'::uuid,'Ordinary manager plan','google_gemini','fixture','${randomUUID()}'::uuid,'{}'::jsonb)`);
const ordinaryProposal=randomUUID();await sql(`insert into public.gemini_console_repair_proposals(proposal_id,conversation_id,source_message_id,proposed_by_manager_id,plan_sha256,plan_text,repair_kind) values ('${ordinaryProposal}'::uuid,'${ordinaryConversation}'::uuid,'${ordinaryPlan.message_id}'::uuid,'${ordinaryId}'::uuid,'${"f".repeat(64)}','Ordinary plan','acceptance_probe');`);
const ordinaryAuthClient=randomUUID();const ordinaryAuth=await json(`public.gemini_console_begin_turn('${ordinaryConversation}'::uuid,'${ordinaryId}'::uuid,'${ordinaryAuthClient}'::uuid,'Fix it.','{}'::uuid[],'${randomUUID()}'::uuid)`);
await fails(`public.gemini_console_authorize_repair('${ordinaryProposal}'::uuid,'${ordinaryId}'::uuid,'${ordinaryCredential}'::uuid,'${ordinaryAuth.user_message.message_id}'::uuid,'${ordinaryAuthClient}'::uuid,'fixture','fixture','fixture','${"0".repeat(64)}','${randomUUID()}'::uuid)`,/Custodial Manager authorization is required/i);

const evidence=await json(`(select jsonb_build_object('tables',(select count(*) from information_schema.tables where table_schema='public' and table_name like 'gemini_console_%'),'anon_table_privileges',(select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema='public' and table_name like 'gemini_console_%'),'active_hash_indexes',(select count(*) from pg_indexes where schemaname='public' and indexname='idx_gemini_console_attachments_active_hash'),'binary_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name like 'gemini_console_%' and data_type='bytea'),'repair_events',(select count(*) from public.gemini_console_repair_job_events e join public.gemini_console_repair_jobs j using(repair_job_id) where j.conversation_id='${conversation}'::uuid)) )`);
assert.equal(Number(evidence.tables),7);assert.equal(Number(evidence.anon_table_privileges),0);assert.equal(Number(evidence.active_hash_indexes),1);assert.equal(Number(evidence.binary_columns),0);assert.equal(Number(evidence.repair_events),4);
assert.equal(await sql(`select count(*) from public.gemini_console_messages where conversation_id='${conversation}'::uuid and body=${literal("Fix it.")} and metadata_json->>'source'='direct_authenticated_user';`),"2");
assert.equal(await sql(`select count(*) from public.gemini_console_messages where conversation_id='${ordinaryConversation}'::uuid and body=${literal("Fix it.")} and metadata_json->>'source'='direct_authenticated_user';`),"1");

console.log(JSON.stringify({ok:true,concurrent_requests:10,logical_user_rows:1,logical_assistant_rows:1,replay_deduplicated:true,attachment_transaction:true,custodial_manager_authorization:true,controlled_worker_claim_backup_finish:true,ordinary_manager_denied:true,private_server_only_tables:true},null,2));
}
