#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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

const ericId=(await sql("select manager_id from public.ops_manager_managers where system_key='eric_custodial_manager';")).split("\n").at(-1);
assert.match(ericId,/^[0-9a-f-]{36}$/i);
const ericCredential=randomUUID();
await sql(`insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at,metadata_json) values ('${ericCredential}'::uuid,'gemini-db-eric','Gemini DB Eric','${"a".repeat(64)}','full_access','${ericId}'::uuid,now()+interval '1 day','{"test":true}'::jsonb);`);
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
await sql(`insert into public.gemini_console_attachments(attachment_id,conversation_id,manager_id,storage_path,original_filename,mime_type,extension,size_bytes,sha256) values ('${attachmentId}'::uuid,'${conversation}'::uuid,'${ericId}'::uuid,'test/path','evidence.txt','text/plain','.txt',4,'${"b".repeat(64)}');`);
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

const ordinaryId=randomUUID();const ordinaryCredential=randomUUID();const ordinaryConversation=randomUUID();
await sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,metadata_json) values ('${ordinaryId}'::uuid,'Disposable Ordinary Manager',array['OPS_MANAGER'],true,'{"test":true}'::jsonb); insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at,metadata_json) values ('${ordinaryCredential}'::uuid,'gemini-db-ordinary','Gemini DB Ordinary','${"e".repeat(64)}','full_access','${ordinaryId}'::uuid,now()+interval '1 day','{"test":true}'::jsonb); insert into public.gemini_console_conversations(conversation_id,owner_manager_id,title) values ('${ordinaryConversation}'::uuid,'${ordinaryId}'::uuid,'Ordinary fixture');`);
const ordinaryAudit=await json(`public.gemini_console_begin_turn('${ordinaryConversation}'::uuid,'${ordinaryId}'::uuid,'${randomUUID()}'::uuid,'Audit disposable fixture','{}'::uuid[],'${randomUUID()}'::uuid)`);
const ordinaryPlan=await json(`public.gemini_console_complete_turn('${ordinaryAudit.user_message.message_id}'::uuid,'Ordinary manager plan','google_gemini','fixture','${randomUUID()}'::uuid,'{}'::jsonb)`);
const ordinaryProposal=randomUUID();await sql(`insert into public.gemini_console_repair_proposals(proposal_id,conversation_id,source_message_id,proposed_by_manager_id,plan_sha256,plan_text,repair_kind) values ('${ordinaryProposal}'::uuid,'${ordinaryConversation}'::uuid,'${ordinaryPlan.message_id}'::uuid,'${ordinaryId}'::uuid,'${"f".repeat(64)}','Ordinary plan','acceptance_probe');`);
const ordinaryAuthClient=randomUUID();const ordinaryAuth=await json(`public.gemini_console_begin_turn('${ordinaryConversation}'::uuid,'${ordinaryId}'::uuid,'${ordinaryAuthClient}'::uuid,'Fix it.','{}'::uuid[],'${randomUUID()}'::uuid)`);
await fails(`public.gemini_console_authorize_repair('${ordinaryProposal}'::uuid,'${ordinaryId}'::uuid,'${ordinaryCredential}'::uuid,'${ordinaryAuth.user_message.message_id}'::uuid,'${ordinaryAuthClient}'::uuid,'fixture','fixture','fixture','${"0".repeat(64)}','${randomUUID()}'::uuid)`,/Custodial Manager authorization is required/i);

const evidence=await json(`(select jsonb_build_object('tables',(select count(*) from information_schema.tables where table_schema='public' and table_name like 'gemini_console_%'),'anon_table_privileges',(select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema='public' and table_name like 'gemini_console_%'),'active_hash_indexes',(select count(*) from pg_indexes where schemaname='public' and indexname='idx_gemini_console_attachments_active_hash'),'binary_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name like 'gemini_console_%' and data_type='bytea'),'repair_events',(select count(*) from public.gemini_console_repair_job_events)) )`);
assert.equal(Number(evidence.tables),6);assert.equal(Number(evidence.anon_table_privileges),0);assert.equal(Number(evidence.active_hash_indexes),1);assert.equal(Number(evidence.binary_columns),0);assert.equal(Number(evidence.repair_events),1);
assert.equal(await sql(`select count(*) from public.gemini_console_messages where body=${literal("Fix it.")} and metadata_json->>'source'='direct_authenticated_user';`),"2");

console.log(JSON.stringify({ok:true,concurrent_requests:10,logical_user_rows:1,logical_assistant_rows:1,replay_deduplicated:true,attachment_transaction:true,custodial_manager_authorization:true,ordinary_manager_denied:true,private_server_only_tables:true},null,2));
