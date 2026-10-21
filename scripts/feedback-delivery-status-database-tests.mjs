import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const container=process.env.FEEDBACK_STATUS_TEST_CONTAINER;
if(!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container||''))throw new Error('Exact owned isolated replay container required');
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');assert.equal(Object.keys(inspection.HostConfig.PortBindings||{}).length,0);
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const id=randomUUID(),pub=randomUUID(),image=randomUUID(),attempt=randomUUID(),principal=`relay:${'e'.repeat(64)}`;
const call=ids=>`public.custodial_feedback_delivery_status(array[${ids.map(v=>q(v)+'::uuid').join(',')}]::uuid[])`;
const fixture=(item,hub,attachment=false)=>`insert into public.system_feedback_items(id,operation_id,request_fingerprint,category,priority,message,submitted_by,hub_context,metadata_json)
values(${q(item)},${q(randomUUID())},repeat('a',64),'other','normal','Synthetic status test only','Synthetic Original Manager',${q(hub)},${q(JSON.stringify({identity_verification:{status:'verified',kind:'named_manager_session',manager_id:randomUUID()},...(attachment?{image_attachment:{storage_path:'private/preserved'}}:{})}))}::jsonb);`;
const sql=`begin;
${fixture(id,'manager')}${fixture(pub,'public')}${fixture(image,'manager',true)}
create temporary table saved_feedback as select to_jsonb(f) snapshot from public.system_feedback_items f;
create temporary table saved_intents as select to_jsonb(i)-array['state','attempt_id','possible_duplicate'] snapshot from public.system_feedback_email_intents i;
set local role service_role;select ${call([id,pub,image])};reset role;
do $$ begin
 if jsonb_array_length(${call([])})<>0 then raise exception 'empty list';end if;
 begin perform public.custodial_feedback_delivery_status(null);raise exception 'null accepted';exception when invalid_parameter_value then null;end;
 begin perform public.custodial_feedback_delivery_status(array[null]::uuid[]);raise exception 'null item accepted';exception when invalid_parameter_value then null;end;
 begin perform public.custodial_feedback_delivery_status(array_fill(${q(id)}::uuid,array[101]));raise exception 'large list accepted';exception when invalid_parameter_value then null;end;
end $$;
select ${call([randomUUID()])};
insert into public.system_feedback_email_attempts(id,intent_id,principal,envelope_sha256,claim_generation)
select ${q(attempt)},id,${q(principal)},envelope_sha256,1 from public.system_feedback_email_intents where feedback_id=${q(id)};
update public.system_feedback_email_intents set attempt_id=${q(attempt)},state='outcome_unknown' where feedback_id=${q(id)};
set local role service_role;select ${call([id])};reset role;
insert into public.system_feedback_email_receipts(intent_id,attempt_id,principal,observation)
select id,${q(attempt)},${q(principal)},'{"kind":"connector_accepted"}' from public.system_feedback_email_intents where feedback_id=${q(id)};
select ${call([id])};
insert into public.system_feedback_email_receipts(intent_id,attempt_id,principal,observation)
select id,${q(attempt)},${q(principal)},'{"kind":"sent_observed"}' from public.system_feedback_email_intents where feedback_id=${q(id)};
select ${call([id])};
insert into public.system_feedback_email_receipts(intent_id,attempt_id,principal,observation)
select id,${q(attempt)},${q(principal)},'{"kind":"inbox_observed"}' from public.system_feedback_email_intents where feedback_id=${q(id)};
update public.system_feedback_email_intents set state='needs_attention',possible_duplicate=true where feedback_id=${q(id)};
select ${call([id])};
do $$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823'] loop
  if has_function_privilege(role_name,'public.custodial_feedback_delivery_status(uuid[])','execute') then raise exception 'grant leak %',role_name;end if;
  execute format('set local role %I',role_name);
  begin perform ${call([id])};raise exception 'denied role succeeded';exception when insufficient_privilege then null;end;
  reset role;
 end loop;
 if exists((select snapshot from saved_feedback except select to_jsonb(f) from public.system_feedback_items f)
  union all (select to_jsonb(f) from public.system_feedback_items f except select snapshot from saved_feedback)) then raise exception 'feedback mutated';end if;
 if exists((select snapshot from saved_intents except select to_jsonb(i)-array['state','attempt_id','possible_duplicate'] from public.system_feedback_email_intents i)
  union all (select to_jsonb(i)-array['state','attempt_id','possible_duplicate'] from public.system_feedback_email_intents i except select snapshot from saved_intents)) then raise exception 'protected intent mutated';end if;
end $$;
drop function public.custodial_feedback_delivery_status(uuid[]);
do $$ declare ddl text; begin
 for ddl in select definition_sql from public.custodial_release_authority_restore_inventory
  where object_identity='custodial_feedback_delivery_status(uuid[])' and object_kind in ('function','grant') order by restore_order loop execute ddl;end loop;
 if not has_function_privilege('service_role','public.custodial_feedback_delivery_status(uuid[])','execute')
  or has_function_privilege('authenticated','public.custodial_feedback_delivery_status(uuid[])','execute') then raise exception 'restore grant mismatch';end if;
end $$;
set local role service_role;select ${call([id])};reset role;
rollback;`;
const output=execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:sql,encoding:'utf8',maxBuffer:4*1024*1024});
const rows=output.trim().split('\n').filter(line=>line.startsWith('[')).map(JSON.parse);
assert.equal(rows.length,7);
const initial=new Map(rows[0].map(r=>[r.feedback_id,r]));
assert.equal(initial.get(id).state,'queued');assert.equal(initial.get(id).evidence_state,'no_send_evidence');assert.equal(initial.get(id).relay_paused,true);
assert.equal(initial.get(pub).state,'not_enrolled');assert.equal(initial.get(image).protected_attachment_pending,true);assert.deepEqual(rows[1],[]);
assert.equal(rows[2][0].evidence_state,'outcome_unknown');assert.equal(rows[3][0].evidence_state,'connector_accepted');assert.equal(rows[4][0].evidence_state,'sent_observed');
for(const last of [rows[5][0],rows[6][0]]){assert.equal(last.evidence_state,'inbox_observed');assert.equal(last.needs_attention,true);assert.equal(last.possible_duplicate,true);}
assert.ok(rows.flat().every(r=>!('claim_token'in r)&&!('email_text'in r)&&!('original_actor'in r)));
console.log(JSON.stringify({status:'FEEDBACK_STATUS_DATABASE_PASS',readbackStates:7,deniedRoles:6,invalidInputCases:3,restoreChallenge:true,protectedDataPreserved:true,fixturesRolledBack:true,providerEvidence:'synthetic fixture only; no mail sent'}));
