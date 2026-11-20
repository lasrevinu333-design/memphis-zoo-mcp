-- MESSAGE source-currentness at the EXISTING leased dispatch boundary.
-- Actual CLI-created identity; latest prepare writer is 20260927072146.
-- No new function/grant/canary member, producer, speech/expiry policy or activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
do $repair$
declare sig text:='public.mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamptz)';
 prior text;next_definition text;prior_grant text;row record;n integer;
 old_decl text:='declare v_delivery jsonb; v_job public.operational_notification_jobs%rowtype; v_receipt public.employee_native_push_delivery_receipts%rowtype; v_reason text;';
 old_insert text:='  insert into public.employee_native_push_delivery_receipts(';
 old_return text:=$old$'already_recorded',false,'delivery_state','prepared','delivery_outcome_unknown',false,'prepared_at',v_receipt.prepared_at);$old$;
 addition text:=$message$  if (v_job.payload_json#>>'{data_json,kind}'='employee_message'
       or v_job.job_key like 'employee-message-push:%')
     and (v_job.payload_json#>'{data_json,test_delivery}') is distinct from 'true'::jsonb then
    -- Original prepared/delivered receipts returned above remain untouched.
    -- Keep existing schedule -> registration -> job ordering, then the same
    -- thread lock used by official read/ACK/delete/hide operations.
    declare
      v_message public.msg_messages%rowtype;
      v_thread public.msg_threads%rowtype;
      v_user public.msg_users%rowtype;
      v_message_receipt public.msg_receipts%rowtype;
      v_target record;v_thread_id uuid;v_now timestamptz:=statement_timestamp();
      v_payload jsonb;v_data jsonb;
    begin
      select d.id device_id,d.device_id device_identifier,d.assigned_employee_id employee_id,
       d.assignment_epoch,c.credential_id,c.expires_at credential_expires_at,r.registration_id,r.token_hash
      into v_target from public.devices d
      join public.device_auth_credentials c on c.device_id=d.id and c.credential_id=p_credential_id
      join public.employee_push_registrations r on r.device_id=d.id and r.credential_id=c.credential_id
      join public.employees e on e.id=d.assigned_employee_id and e.active is true
      where d.active is true and d.assignment_epoch=p_assignment_epoch
       and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>v_now
       and r.registration_id=p_registration_id and r.employee_id=d.assigned_employee_id
       and r.assignment_epoch=d.assignment_epoch and r.active is true and r.revoked_at is null
       and r.token_hash=p_token_hash
      for share of d,c,r,e;
      if not found then return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','message_recipient_superseded');end if;
      v_payload:=v_job.payload_json;v_data:=v_payload->'data_json';
      if jsonb_typeof(v_payload) is distinct from 'object' or jsonb_typeof(v_data) is distinct from 'object'
       or not(v_payload ?& array['credential_id','employee_id','device_id','device_identifier','assignment_epoch','channel_id','title','body','data_json'])
       or v_payload-array['credential_id','employee_id','device_id','device_identifier','assignment_epoch','channel_id','title','body','data_json']<>'{}'::jsonb
       or not(v_data ?& array['kind','notification_type','notification_key','thread_id','message_id','route','sender_name','thread_title'])
       or v_data-array['kind','notification_type','notification_key','thread_id','message_id','route','sender_name','thread_title']<>'{}'::jsonb
       or v_job.job_key is distinct from 'employee-message-push:'||v_job.source_id::text||':'||p_credential_id::text
       or v_payload->>'credential_id' is distinct from p_credential_id::text
       or v_payload->>'employee_id' is distinct from v_target.employee_id::text
       or v_payload->>'device_id' is distinct from v_target.device_id::text
       or v_payload->>'device_identifier' is distinct from v_target.device_identifier
       or jsonb_typeof(v_payload->'assignment_epoch') is distinct from 'number'
       or v_payload->>'assignment_epoch' is distinct from p_assignment_epoch::text
       or v_payload->>'channel_id' is distinct from 'employee-messages'
       or v_data->>'kind' is distinct from 'employee_message'
       or v_data->>'notification_type' is distinct from 'message'
       or v_data->>'message_id' is distinct from v_job.source_id::text
       or v_data->>'notification_key' is distinct from 'message:'||v_job.source_id::text then
       return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','message_source_binding_invalid');end if;
      select thread_id into v_thread_id from public.msg_messages where id=v_job.source_id;
      -- Official read/ACK/delete/hide mutators share the owning thread row lock.
      -- Read current facts after acquiring it; no stale pre-lock snapshot is used.
      select * into v_thread from public.msg_threads where id=v_thread_id for update;
      if v_thread.id is null or v_thread.is_active is not true
       or v_thread.system_key='ops_manager_shared_chat_v1' then
       return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','message_thread_stale');end if;
      select * into v_message from public.msg_messages where id=v_job.source_id for share;
      select * into v_user from public.msg_users
       where employee_id=v_target.employee_id and is_active is true for share;
      if v_message.id is null or v_user.id is null or v_message.thread_id is distinct from v_thread.id
       or v_message.is_deleted is not false or v_message.sender_user_id=v_user.id
       or v_message.sent_at is null or v_message.sent_at>v_now
       or v_data->>'thread_id' is distinct from v_thread.id::text
       or v_data->>'route' is distinct from 'messages.html?hub=employee&thread_id='||v_thread.id::text then
       return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','message_source_stale');end if;
      perform 1 from public.msg_thread_participants
       where thread_id=v_thread.id and user_id=v_user.id and left_at is null for share;
      if not found then return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','message_membership_stale');end if;
      select * into v_message_receipt from public.msg_receipts
       where message_id=v_message.id and user_id=v_user.id for share;
      if v_message_receipt.message_id is null or v_message_receipt.acknowledged_at is not null then
       return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','message_acknowledged_or_receipt_missing');end if;
      if exists(select 1 from public.msg_message_deletions where message_id=v_message.id and user_id=v_user.id)
       or exists(select 1 from public.msg_thread_visibility visibility
        where visibility.thread_id=v_thread.id and visibility.user_id=v_user.id
         and (visibility.device_identifier is null
          or upper(btrim(visibility.device_identifier))=upper(btrim(v_target.device_identifier)))
         and coalesce(v_message.sent_at,v_message.created_at)<=visibility.hidden_before) then
       return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','message_hidden');end if;
      -- Preserve the exact existing producer transformation; do not replace queued
      -- speech with new policy or current display names after a rename.
      if jsonb_typeof(v_payload->'body') is distinct from 'string'
       or v_payload->>'body' is distinct from left(coalesce(nullif(regexp_replace(v_message.body,'[[:space:]]+',' ','g'),''),'New message'),1000)
       or jsonb_typeof(v_payload->'title') is distinct from 'string'
       or jsonb_typeof(v_data->'sender_name') is distinct from 'string'
       or jsonb_typeof(v_data->'thread_title') is distinct from 'string'
       or coalesce(v_payload->>'title','')=''
       or v_payload->>'title' is distinct from v_data->>'sender_name' then
       return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','message_content_changed');end if;
      -- Lock waits must not extend the original lease/credential validity.
      v_now:=clock_timestamp();
      if v_job.leased_until<=v_now or v_target.credential_expires_at<=v_now then
       return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','message_lease_or_credential_expired');end if;
      v_message_projection:=jsonb_build_object(
       'schema','custodial.employee-message-admission.v1','job_id',v_job.job_id,'job_key',v_job.job_key,
       'lease_token',v_job.lease_token,'source_id',v_job.source_id,'message_id',v_message.id,'thread_id',v_thread.id,
       'recipient_user_id',v_user.id,'employee_id',v_target.employee_id,'device_id',v_target.device_id,
       'device_identifier',v_target.device_identifier,'credential_id',p_credential_id,'assignment_epoch',p_assignment_epoch,
       'registration_id',p_registration_id,'token_hash',p_token_hash,
       'logical_key','message:'||v_message.id::text||':recipient:'||v_user.id::text,
       'source_revision',public.static_weekly_digest_jsonb(jsonb_build_object('message_id',v_message.id,
        'thread_id',v_message.thread_id,'sender_user_id',v_message.sender_user_id,'sent_at',v_message.sent_at,
        'body',v_message.body,'metadata_json',v_message.metadata_json,'recipient_user_id',v_user.id)),
       'payload',v_payload);
    end;
  end if;
$message$;
begin
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
  raise exception 'MESSAGE recovery immutability changed';end if;
 prior:=pg_get_functiondef(sig::regprocedure);
 prior_grant:=public.custodial_release_authority_current_grant_definition((sig::regprocedure)::text);
 if public.static_weekly_digest_text(prior) is distinct from '33d72de69db3e6735bec2827642bea966b89920d4c7b7bf338d73b7aca907ff2'
  or prior_grant is null then raise exception 'MESSAGE prepare predecessor changed';end if;
 select count(*) into n from public.custodial_release_authority_restore_inventory i
  where i.object_kind='function' and case when position('(' in i.object_identity)>0 then to_regprocedure(i.object_identity) end=sig::regprocedure
   and i.definition_sql=prior and i.definition_sha256=public.static_weekly_digest_text(prior);
 if n<>1 or (select count(*) from public.custodial_release_authority_restore_inventory i
  where i.object_kind='function' and case when position('(' in i.object_identity)>0 then to_regprocedure(i.object_identity) end=sig::regprocedure)<>1 then
  raise exception 'MESSAGE prepare recovery predecessor changed';end if;
 for row in select * from public.custodial_release_authority_restore_inventory i where i.object_kind='grant'
  and case when position('(' in i.object_identity)>0 then to_regprocedure(i.object_identity) end=sig::regprocedure loop
  if row.definition_sql is distinct from public.custodial_release_authority_current_grant_definition(row.object_identity)
   or row.definition_sha256 is distinct from public.static_weekly_digest_text(row.definition_sql) then
   raise exception 'MESSAGE prepare captured ACL changed';end if;
 end loop;
 if not found then raise exception 'MESSAGE prepare ACL inventory missing';end if;
 foreach next_definition in array array[old_decl,old_insert,old_return] loop
  if length(prior)-length(replace(prior,next_definition,''))<>length(next_definition) then
   raise exception 'MESSAGE prepare exact seam changed';end if;
 end loop;
 next_definition:=replace(replace(replace(prior,old_decl,old_decl||' v_message_projection jsonb;'),
  old_insert,addition||old_insert),old_return,
  $new$'already_recorded',false,'delivery_state','prepared','delivery_outcome_unknown',false,'prepared_at',v_receipt.prepared_at)
    ||case when v_message_projection is null then '{}'::jsonb
      else jsonb_build_object('message_projection',v_message_projection) end;$new$);
 execute next_definition;
 if pg_get_functiondef(sig::regprocedure) is distinct from next_definition
  or public.custodial_release_authority_current_grant_definition((sig::regprocedure)::text) is distinct from prior_grant then
  raise exception 'MESSAGE prepare body or ACL delta changed';end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 update public.custodial_release_authority_restore_inventory i set definition_sql=next_definition,
  definition_sha256=public.static_weekly_digest_text(next_definition),captured_at=statement_timestamp()
  where i.object_kind='function' and case when position('(' in i.object_identity)>0 then to_regprocedure(i.object_identity) end=sig::regprocedure
   and i.definition_sql=prior and i.definition_sha256=public.static_weekly_digest_text(prior);
 get diagnostics n=row_count;if n<>1 then raise exception 'MESSAGE prepare recovery update count changed';end if;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $repair$;
commit;
