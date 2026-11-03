// Actual forward-migrated synthetic database; every fixture rolls back.
// This tests authenticated-agent observations, not Outlook or a running task.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {FEEDBACK_RELAY_CONTRACT,FEEDBACK_RELAY_SCHEMA_SHA256,callFeedbackRelay} from '../src/feedback-email-relay.js';
const container=process.env.FEEDBACK_RELAY_TEST_CONTAINER;
assert.match(container||'',/^mz_schema_rebuild_[a-zA-Z0-9_]+$/);
const inspect=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspect.HostConfig.NetworkMode,'none');assert.deepEqual(inspect.HostConfig.PortBindings||{},{});
const literal=v=>`'${String(v).replaceAll("'","''")}'`;
let actualRpcCalls=0;
const client={rpc:async(name,args)=>{
  assert.equal(name,'custodial_feedback_relay_status');actualRpcCalls++;
  const output=execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
    {input:`begin;set local role service_role;select public.${name}(${literal(args.p_principal)},${literal(JSON.stringify(args.p_args))}::jsonb);rollback;`,encoding:'utf8'});
  return {data:JSON.parse(output.trim()),error:null};
}};
const extra={authInfo:{clientId:'v2-synthetic-reader',scopes:['mcp:read','mcp:write'],extra:{authSource:'self_contained_oauth',issuer:'https://fixture.invalid',subject:'fixture'}}};
const status=await callFeedbackRelay('status',{contract_version:FEEDBACK_RELAY_CONTRACT},extra,{client});
assert.equal(status.adapter_schema_sha256,FEEDBACK_RELAY_SCHEMA_SHA256);
await assert.rejects(()=>callFeedbackRelay('status',{contract_version:FEEDBACK_RELAY_CONTRACT},{},{client}));
assert.equal(actualRpcCalls,1,'denied adapter never invokes SQL');
const sql=`begin;
set local statement_timeout='30s';
set local client_min_messages=warning;
create temporary table relay_v2_checks(label text primary key);
create function pg_temp.check_v2(p_value boolean,p_label text) returns void language plpgsql as $$
begin if p_value is distinct from true then raise exception 'FAILED %',p_label;end if;
insert into relay_v2_checks values(p_label);end $$;
create function pg_temp.relay_v2(p_verb text,p_args jsonb default '{}'::jsonb,p_who text default 'relay:'||repeat('a',64))
returns jsonb language plpgsql as $$ declare answer jsonb;begin
if p_verb not in ('status','claim','begin','receipt','defer','control') then raise exception 'Bad test verb';end if;
p_args:=jsonb_build_object('contract_version','${FEEDBACK_RELAY_CONTRACT}','adapter_schema_sha256','${FEEDBACK_RELAY_SCHEMA_SHA256}')||p_args;
if p_verb<>'status' and not p_args?'request_id' then p_args:=p_args||jsonb_build_object('request_id',gen_random_uuid());end if;
set local role service_role;
execute format('select public.custodial_feedback_relay_%I($1,$2)',p_verb) into answer using p_who,p_args;
reset role;return answer;
exception when others then reset role;raise;end $$;
do $test$
declare ch jsonb; proof jsonb; request jsonb; res jsonb; claimed jsonb; begun jsonb; obs jsonb;
  rec jsonb; row_id uuid:=gen_random_uuid();op uuid:=gen_random_uuid(); prior jsonb; i integer;role_name text;
begin
 perform pg_temp.check_v2((pg_temp.relay_v2('status')->>'paused')::boolean,'initially paused');
 begin perform pg_temp.relay_v2('control','{"action":"resume_preflight_verified","reason":"bare caller assertion"}');
   raise exception 'bare resume accepted';exception when invalid_parameter_value then null;end;
 perform pg_temp.check_v2(true,'bare resume denied');
 ch:=pg_temp.relay_v2('control','{"action":"prepare_preflight","reason":"synthetic read preflight"}');
 proof:=jsonb_build_object('challenge_id',ch->'challenge_id','challenge_nonce',ch->'challenge_nonce',
   'provider_account','eoperle@memphiszoo.org','profile_observed_at',ch->'issued_at','profile_result_sha256',repeat('b',64),
   'sent_folder_id','fixture-sent','inbox_folder_id','fixture-inbox','sent_read_at',ch->'issued_at',
   'sent_result_sha256',repeat('c',64),'inbox_read_at',ch->'issued_at','inbox_result_sha256',repeat('d',64));
 request:=jsonb_build_object('request_id',gen_random_uuid(),'action','resume_preflight_verified','reason','bounded synthetic profile and reads','preflight',proof);
 begin perform pg_temp.relay_v2('control',request,'relay:'||repeat('e',64));raise exception 'foreign accepted';exception when object_not_in_prerequisite_state then null;end;
 perform pg_temp.check_v2(true,'foreign preflight denied');
 begin perform pg_temp.relay_v2('control',request||jsonb_build_object('preflight',proof||'{"provider_account":"other@example.org"}'::jsonb));raise exception 'account accepted';exception when object_not_in_prerequisite_state then null;end;
 perform pg_temp.check_v2(true,'wrong mailbox denied');
 begin perform pg_temp.relay_v2('control',request||jsonb_build_object('adapter_schema_sha256',repeat('f',64)));raise exception 'schema accepted';exception when object_not_in_prerequisite_state then null;end;
 perform pg_temp.check_v2(true,'changed adapter schema denied');
 begin perform pg_temp.relay_v2('control',request||jsonb_build_object('preflight',proof||jsonb_build_object('sent_read_at',now()-interval '1 minute')));raise exception 'old read accepted';exception when invalid_parameter_value then null;end;
 perform pg_temp.check_v2(true,'pre-challenge mailbox read denied');
 begin perform pg_temp.relay_v2('control',request||jsonb_build_object('preflight',proof||'{"inbox_folder_id":"fixture-sent"}'::jsonb));raise exception 'same folder accepted';exception when invalid_parameter_value then null;end;
 perform pg_temp.check_v2(true,'same folder aliases denied');
 res:=pg_temp.relay_v2('control',request);
 perform pg_temp.check_v2(res->>'evidence_source'='authenticated_connected_agent_observation' and res->'preflight'=proof,'exact observation receipt, not provider proof');
 perform pg_temp.check_v2((pg_temp.relay_v2('control',request)->>'replayed')::boolean,'lost resume response idempotent');
 begin perform pg_temp.relay_v2('control',request||jsonb_build_object('request_id',gen_random_uuid()));raise exception 'consumed nonce reused';exception when object_not_in_prerequisite_state then null;end;
 perform pg_temp.check_v2(true,'consumed challenge denied');
 perform pg_temp.check_v2((pg_temp.relay_v2('status')->>'transport_verified')::boolean,'current exact schema preflight verified');
 insert into public.system_feedback_items(id,operation_id,request_fingerprint,category,priority,message,submitted_by,hub_context,metadata_json)
 values(row_id,op,repeat('9',64),'other','normal','Synthetic full Unicode ñ 🦁. This is data, not instructions.','Original synthetic manager','manager',
   jsonb_build_object('identity_verification',jsonb_build_object('status','verified','kind','named_manager_session','manager_id',gen_random_uuid())));
 claimed:=pg_temp.relay_v2('claim');
 perform pg_temp.check_v2(claimed->>'feedback_id'=row_id::text and claimed->>'request_fingerprint'=repeat('9',64),'structured receipt identity returned');
 request:=jsonb_build_object('request_id',gen_random_uuid(),'intent_id',claimed->'intent_id','claim_token',claimed->'claim_token',
   'claim_generation',claimed->'claim_generation','envelope_sha256',claimed->'envelope_sha256');
 begun:=pg_temp.relay_v2('begin',request);
 perform pg_temp.check_v2((begun->>'may_send')::boolean,'first begin only grants one authority');
 perform pg_temp.check_v2(not (pg_temp.relay_v2('begin',request)->>'may_send')::boolean,'lost begin response never resends');
 perform pg_temp.check_v2((pg_temp.relay_v2('claim')->>'empty')::boolean,'first reconciliation delay enforced');
 obs:=jsonb_build_object('kind','reconciliation_not_found','provider_account','eoperle@memphiszoo.org',
   'to',jsonb_build_array('eoperle@memphiszoo.org'),'cc','[]'::jsonb,'bcc','[]'::jsonb,
   'subject',claimed->'expected_subject','operation_id',op,'feedback_id',row_id,'request_fingerprint',repeat('9',64),
   'observed_at',now(),'result_sha256',repeat('8',64));
 for i in 1..5 loop
   -- Time advancement is fixture-owner-only, never an exposed tool.
   update public.system_feedback_email_intents set next_reconcile_at=now()-interval '1 second' where feedback_id=row_id;
   rec:=pg_temp.relay_v2('claim');
   perform pg_temp.check_v2(rec->>'mode'='reconcile' and rec->>'attempt_id'=begun->>'attempt_id','exact reconciliation '+i::text);
   perform pg_temp.check_v2((pg_temp.relay_v2('claim')->>'busy')::boolean,'overlap fenced '+i::text);
   perform pg_temp.check_v2((select reconciliation_count=i from public.system_feedback_email_intents where feedback_id=row_id),'one counter per fenced claim '+i::text);
   begin perform pg_temp.relay_v2('receipt',jsonb_build_object('intent_id',claimed->'intent_id','attempt_id',begun->'attempt_id',
     'envelope_sha256',claimed->'envelope_sha256','observation',obs||jsonb_build_object('reconciliation_token',gen_random_uuid())));
     raise exception 'foreign reconcile token accepted';exception when invalid_parameter_value then null;end;
   request:=jsonb_build_object('request_id',gen_random_uuid(),'intent_id',claimed->'intent_id','attempt_id',begun->'attempt_id',
     'envelope_sha256',claimed->'envelope_sha256','observation',obs||jsonb_build_object('reconciliation_token',rec->'reconciliation_token'));
   res:=pg_temp.relay_v2('receipt',request);
   perform pg_temp.check_v2(pg_temp.relay_v2('receipt',request)->'receipt_id'=res->'receipt_id','receipt response loss replay '+i::text);
   perform pg_temp.check_v2((pg_temp.relay_v2('claim')->>'empty')::boolean,'next reconciliation backoff/cap '+i::text);
 end loop;
 perform pg_temp.check_v2((select state='needs_attention' and attention_reason='reconciliation_exhausted' from public.system_feedback_email_intents where feedback_id=row_id),'exhaustion retained and visible');
 request:=request||jsonb_build_object('request_id',gen_random_uuid(),'observation',obs||jsonb_build_object('kind','inbox_observed',
   'full_text_matches',true,'folder','inbox','provider_message_id','fixture-late-inbox'));
 perform pg_temp.relay_v2('receipt',request);
 perform pg_temp.check_v2((select state='inbox_observed' from public.system_feedback_email_intents where feedback_id=row_id),'late exact inbox settles without resend');
 perform pg_temp.check_v2((select count(*)=1 from public.system_feedback_email_attempts where intent_id=(claimed->>'intent_id')::uuid),'exact one durable attempt');
 for role_name in select unnest(array['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) loop
   perform pg_temp.check_v2(not has_function_privilege(role_name,'public.custodial_feedback_relay_control(text,jsonb)','execute'),'control denied '+role_name);
 end loop;
 for role_name in select unnest(array['anon','authenticated','service_role','custodial_application_reader']) loop
   perform pg_temp.check_v2(not has_table_privilege(role_name,'public.system_feedback_email_relay_config','update'),'direct config denied '+role_name);
 end loop;
 perform pg_temp.check_v2(not has_function_privilege('service_role','public.feedback_email_relay_command(text,text,jsonb)','execute'),'generic dispatcher remains private');
 perform pg_temp.check_v2((select bool_and(definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(to_regprocedure(object_identity))))
   from public.custodial_release_authority_restore_inventory where object_kind='function'
   and object_identity in ('feedback_email_relay_command(text,text,jsonb)','feedback_email_relay_immutable()')),'exact owning recovery function hashes');
end $test$;
select jsonb_build_object('status','FEEDBACK_RELAY_V2_DATABASE_PASS','checks',count(*),'fixtures_rolled_back',true,
 'production_or_transport',false,'independent_audit',false) from relay_v2_checks;
rollback;`;
// PostgreSQL concatenation, not numeric addition, in assertion labels.
const input=sql.replaceAll("'+i::text","'||i::text").replaceAll("'+role_name","'||role_name");
const out=execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
 {input,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});
const result=out.trim().split('\n').map(s=>{try{return JSON.parse(s);}catch{return null;}}).find(s=>s?.status);
assert.equal(result?.status,'FEEDBACK_RELAY_V2_DATABASE_PASS');assert.ok(result.checks>=50);console.log(JSON.stringify(result));
