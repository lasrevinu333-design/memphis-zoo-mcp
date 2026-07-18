#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync=promisify(execFile);
const container=String(process.env.SHARED_ENROLLMENT_TEST_DOCKER_CONTAINER||"").trim();
const database=String(process.env.SHARED_ENROLLMENT_TEST_DATABASE||"postgres").trim();
if(!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)||!/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database))throw new Error("A disposable schema-rebuild database is required.");

async function sql(statement){
  const {stdout}=await execFileAsync("docker",["exec",container,"psql","-v","ON_ERROR_STOP=1","-At","-U","supabase_admin","-d",database,"-c",statement],{maxBuffer:8*1024*1024});
  return stdout.trim();
}
async function json(statement){const output=await sql(`select (${statement})::text;`);return JSON.parse(output.split("\n").at(-1));}

const actorCredential=randomUUID();
const actorId=(await sql("select manager_id from public.ops_manager_managers where system_key='eric_custodial_manager';")).split("\n").at(-1);
assert.match(actorId,/^[0-9a-f-]{36}$/i);
await sql(`insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at,metadata_json) values ('${actorCredential}'::uuid,'database-test-eric','Database Test Eric','${"a".repeat(64)}','full_access','${actorId}'::uuid,now()+interval '1 day','{"test":true}'::jsonb);`);

const firstHash="b".repeat(64);
const first=await json(`public.ops_manager_create_shared_enrollment_window('${firstHash}','${actorId}'::uuid,'${actorCredential}'::uuid,'{"test":true}'::jsonb)`);
assert.equal(first.ok,true);
assert.equal(Date.parse(first.expires_at)-Date.parse(first.created_at),48*60*60*1000);

const requests=Array.from({length:10},(_,index)=>({credential:randomUUID(),device:`database-client-${index+1}`}));
const results=await Promise.all(requests.map(({credential,device},index)=>json(`public.ops_manager_consume_shared_enrollment_window('${firstHash}','${credential}'::uuid,'${device}','${device}','${String(index+2).padStart(64,"c").slice(-64)}',null,null,'Database Browser',now()+interval '30 days','{"test":true}'::jsonb)`)));
assert.equal(results.filter((result)=>result.ok).length,10,"all ten distinct browsers must enroll concurrently");
assert.equal(new Set(results.map((result)=>result.trusted_device.credential_id)).size,10);
assert.ok(results.every((result)=>JSON.stringify(result.manager.roles)==='["OPS_MANAGER"]'));
const state=await json(`(select jsonb_build_object('active_windows',count(*) filter(where status='active'),'enrollment_count',max(enrollment_count),'active_devices',(select count(*) from public.ops_manager_trusted_devices where shared_enrollment_window_id='${first.window_id}'::uuid and revoked_at is null)) from public.ops_manager_shared_enrollment_windows)`);
assert.equal(Number(state.active_windows),1);
assert.equal(Number(state.enrollment_count),10);
assert.equal(Number(state.active_devices),10);

const secondHash="d".repeat(64);
const second=await json(`public.ops_manager_create_shared_enrollment_window('${secondHash}','${actorId}'::uuid,'${actorCredential}'::uuid,'{"replacement_test":true}'::jsonb)`);
assert.equal(second.ok,true);
const oldAttempt=await json(`public.ops_manager_consume_shared_enrollment_window('${firstHash}','${randomUUID()}'::uuid,'old-hash-attempt','Old Hash','${"e".repeat(64)}',null,null,'Browser',now()+interval '30 days','{}'::jsonb)`);
assert.equal(oldAttempt.ok,false);
assert.equal(oldAttempt.reason,"invalid");
const replacement=await json(`public.ops_manager_consume_shared_enrollment_window('${secondHash}','${randomUUID()}'::uuid,'replacement-success','Replacement','${"f".repeat(64)}',null,null,'Browser',now()+interval '30 days','{}'::jsonb)`);
assert.equal(replacement.ok,true);
const disabled=await json(`public.ops_manager_disable_shared_enrollment_window('${second.window_id}'::uuid,'${actorId}'::uuid,'${actorCredential}'::uuid,'database_test_complete')`);
assert.equal(disabled.ok,true);
const disabledAttempt=await json(`public.ops_manager_consume_shared_enrollment_window('${secondHash}','${randomUUID()}'::uuid,'disabled-attempt','Disabled','${"1".repeat(64)}',null,null,'Browser',now()+interval '30 days','{}'::jsonb)`);
assert.equal(disabledAttempt.ok,false);
assert.equal(disabledAttempt.reason,"inactive");
assert.equal(await sql(`select revoked_at is null from public.ops_manager_trusted_devices where credential_id='${actorCredential}'::uuid;`),"t","Eric test authority must not be revoked");
assert.equal(await sql("select count(*) from information_schema.columns where table_schema='public' and table_name='ops_manager_shared_enrollment_windows' and column_name ilike '%plain%';"),"0");
assert.equal(await sql("select count(*) from pg_indexes where schemaname='public' and indexname in ('idx_ops_manager_shared_windows_manager','idx_ops_manager_shared_windows_created_by_manager','idx_ops_manager_shared_windows_created_by_credential','idx_ops_manager_shared_windows_disabled_by_manager','idx_ops_manager_shared_windows_disabled_by_credential','idx_ops_manager_shared_windows_replaced_by');"),"6","every shared-window audit foreign key must have a covering index");
console.log("MANAGER_SHARED_48_HOUR_DATABASE_CONCURRENCY_PASS");
