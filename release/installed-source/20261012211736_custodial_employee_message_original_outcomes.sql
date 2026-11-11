begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- UNAPPLIED source: one internal original-outcome store, not a new API grant.
create table custodial_release_identity.employee_message_original_outcomes(
 request_fingerprint text primary key check(request_fingerprint ~ '^[a-f0-9]{64}$'),
 original_command text not null check(original_command in
  ('employee_message_original_send','employee_message_original_read','employee_message_original_delete')),
 original_request jsonb not null check(jsonb_typeof(original_request)='object' and octet_length(original_request::text)<=32768),
 outcome_json jsonb not null check(jsonb_typeof(outcome_json)='object'),
 recorded_at timestamptz not null default statement_timestamp()
);
alter table custodial_release_identity.employee_message_original_outcomes enable row level security;
alter table custodial_release_identity.employee_message_original_outcomes force row level security;
revoke all on custodial_release_identity.employee_message_original_outcomes from public,anon,authenticated,service_role,custodial_application_reader;
create trigger employee_message_original_outcomes_immutable before update or delete
 on custodial_release_identity.employee_message_original_outcomes for each row
 execute function public.custodial_feedback_triage_immutable();
alter table custodial_release_identity.employee_message_original_outcomes enable always trigger employee_message_original_outcomes_immutable;
create or replace function public.app_apply_operational_command(
  p_command text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_command text := nullif(btrim(coalesce(p_command, '')), '');
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_id uuid;
  v_original_kind text;
  v_query_only boolean;
  v_original_payload jsonb;
  v_current jsonb;
  v_original_fingerprint text;
  v_original_result jsonb;
  v_original_outcome jsonb;
  v_original_target text;
  v_allowed text[];
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception using errcode='22023', message='operational command payload must be an object';
  end if;

  -- Only the EXISTING service-only dispatcher may reach this closed family.
  -- Payload selectors are not authentication; the normal HTTP credential
  -- boundary precedes this RPC. Current DB owner identity is locked here too.
  if v_command in ('employee_message_original_send','employee_message_original_read',
      'employee_message_original_delete','employee_message_original_outcome') then
    v_query_only:=v_command='employee_message_original_outcome';
    v_original_kind:=case when v_query_only then v_payload->>'original_command' else v_command end;
    if v_original_kind not in ('employee_message_original_send','employee_message_original_read','employee_message_original_delete')
      or v_original_kind is null then raise exception using errcode='22023',message='Unknown original Messenger command'; end if;
    v_original_payload:=case when v_query_only then v_payload-'original_command' else v_payload end;
    v_allowed:=array['device_id','expected_employee_id','expected_credential_id','expected_assignment_epoch',
      'user_id','thread_id','credential_token_hash'];
    v_allowed:=v_allowed||case v_original_kind
      when 'employee_message_original_send' then array['body','message_type','metadata_json','client_message_id']
      when 'employee_message_original_read' then array['through_message_id']
      else array['operation_id'] end;
    if (select array_agg(k order by k) from jsonb_object_keys(v_original_payload) k)
        is distinct from (select array_agg(k order by k) from unnest(v_allowed) k)
      or octet_length(v_original_payload::text)>32768
      or jsonb_typeof(v_original_payload->'device_id') is distinct from 'string'
      or v_original_payload->>'device_id' !~ '^[A-Z0-9_-]{1,64}$'
      or jsonb_typeof(v_original_payload->'expected_assignment_epoch') is distinct from 'string'
      or v_original_payload->>'expected_assignment_epoch' !~ '^[1-9][0-9]{0,15}$'
      or (v_original_payload->>'expected_assignment_epoch')::numeric>9007199254740991
      or jsonb_typeof(v_original_payload->'credential_token_hash') is distinct from 'string'
      or v_original_payload->>'credential_token_hash' !~ '^[a-f0-9]{64}$'
      then raise exception using errcode='22023',message='Closed original Messenger request required'; end if;
    foreach v_original_target in array array['expected_employee_id','expected_credential_id','user_id','thread_id'] loop
      if jsonb_typeof(v_original_payload->v_original_target) is distinct from 'string'
        or v_original_payload->>v_original_target !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
        then raise exception using errcode='22023',message='Canonical original Messenger identity required'; end if;
    end loop;
    if not v_query_only then
      -- No HTTP/provider call occurs while these short DB locks are held.
      -- Updates to assignment, credential revocation, employee or sender block.
      perform d.id from public.devices d join public.device_auth_credentials c on c.device_id=d.id
        join public.employees e on e.id=d.assigned_employee_id join public.msg_users u on u.employee_id=e.id
        join public.msg_device_assignments mda on mda.device_identifier=d.device_id and mda.msg_user_id=u.id and mda.is_active
        where d.device_id=v_original_payload->>'device_id' and d.active and e.active and u.is_active and u.role='employee'
          and d.assigned_employee_id=(v_original_payload->>'expected_employee_id')::uuid
          and d.assignment_epoch=(v_original_payload->>'expected_assignment_epoch')::bigint
          and c.credential_id=(v_original_payload->>'expected_credential_id')::uuid
          and c.token_hash=v_original_payload->>'credential_token_hash'
          and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>clock_timestamp()
          and u.id=(v_original_payload->>'user_id')::uuid
        for update of d,c,e,u,mda;
      if not found then raise exception using errcode='42501',message='Original Messenger actor is no longer current'; end if;
    end if;
    select jsonb_build_object('device_pk',d.id,'device_id',d.device_id,'employee_id',e.id,
        'credential_id',c.credential_id,'assignment_epoch',d.assignment_epoch::text,'user_id',u.id)
      into v_current
      from public.devices d join public.device_auth_credentials c on c.device_id=d.id
      join public.employees e on e.id=d.assigned_employee_id join public.msg_users u on u.employee_id=e.id
      join public.msg_device_assignments mda on mda.device_identifier=d.device_id and mda.msg_user_id=u.id and mda.is_active
      where d.device_id=v_original_payload->>'device_id' and d.active and e.active and u.is_active and u.role='employee'
        and d.assigned_employee_id=(v_original_payload->>'expected_employee_id')::uuid
        and d.assignment_epoch=(v_original_payload->>'expected_assignment_epoch')::bigint
        and c.credential_id=(v_original_payload->>'expected_credential_id')::uuid
        and c.token_hash=v_original_payload->>'credential_token_hash'
        and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>clock_timestamp()
        and u.id=(v_original_payload->>'user_id')::uuid;
    if v_current is null then raise exception using errcode='42501',message='Original Messenger actor is no longer current'; end if;
    v_original_fingerprint:=public.static_weekly_digest_text(v_original_kind||E'\n'||v_original_payload::text);
    if not v_query_only then perform pg_advisory_xact_lock(hashtextextended(v_original_fingerprint,0)); end if;
    select outcome_json into v_original_outcome from custodial_release_identity.employee_message_original_outcomes
      where request_fingerprint=v_original_fingerprint and original_command=v_original_kind
        and original_request=v_original_payload;
    if v_original_outcome is not null then return v_original_outcome; end if;
    if v_query_only then return jsonb_build_object('schema','custodial.employee-original-message-outcome.v1',
      'state','ORIGINAL_OUTCOME_NOT_FOUND_UNKNOWN','request_fingerprint',v_original_fingerprint,
      'original_command',v_original_kind,'original_actor',v_current,'original_outcome_recorded',false,
      'resend_allowed',false,'inventory_acknowledged',false,'finalizer_allowed',false,'key_removal',false); end if;
    if v_original_kind='employee_message_original_send' then
      if jsonb_typeof(v_original_payload->'body') is distinct from 'string'
        or jsonb_typeof(v_original_payload->'message_type') is distinct from 'string'
        or v_original_payload->>'message_type'<>'text'
        or jsonb_typeof(v_original_payload->'metadata_json') is distinct from 'object'
        or jsonb_typeof(v_original_payload->'client_message_id') is distinct from 'string'
        or length(v_original_payload->>'client_message_id') not between 1 and 200
        then raise exception using errcode='22023',message='Exact original send body required'; end if;
      v_original_result:=to_jsonb(public.msg_send_message((v_original_payload->>'thread_id')::uuid,
        (v_original_payload->>'user_id')::uuid,v_original_payload->>'body','text',
        v_original_payload->'metadata_json',v_original_payload->>'client_message_id'));
    elsif v_original_kind='employee_message_original_read' then
      if jsonb_typeof(v_original_payload->'through_message_id') is distinct from 'string'
        or v_original_payload->>'through_message_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
        then raise exception using errcode='22023',message='Original read horizon required'; end if;
      v_original_result:=jsonb_build_object('marked',public.msg_mark_thread_read_through(
        (v_original_payload->>'thread_id')::uuid,(v_original_payload->>'user_id')::uuid,
        (v_original_payload->>'through_message_id')::uuid),
        'thread_id',v_original_payload->>'thread_id','user_id',v_original_payload->>'user_id',
        'through_message_id',v_original_payload->>'through_message_id');
    else
      if jsonb_typeof(v_original_payload->'operation_id') is distinct from 'string'
        or v_original_payload->>'operation_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
        then raise exception using errcode='22023',message='Original deletion operation required'; end if;
      v_original_result:=public.msg_delete_thread((v_original_payload->>'thread_id')::uuid,
        (v_original_payload->>'user_id')::uuid,(v_original_payload->>'operation_id')::uuid);
      if v_original_result->'ok' is distinct from 'true'::jsonb or v_original_result->'deleted' is distinct from 'true'::jsonb
        or v_original_result->>'thread_id'<>v_original_payload->>'thread_id'
        or v_original_result->>'operation_id'<>v_original_payload->>'operation_id'
        or v_original_result->>'deletion_scope'<>'user'
        then raise exception using errcode='22023',message='Original deletion was not confirmed'; end if;
    end if;
    if not exists(select 1 from public.device_auth_credentials c
      where c.credential_id=(v_original_payload->>'expected_credential_id')::uuid
        and c.revoked_at is null and c.expires_at>clock_timestamp()
        and c.token_hash=v_original_payload->>'credential_token_hash') then
      -- Any effect from the nested RPC rolls back in this same transaction.
      raise exception using errcode='42501',message='Original Messenger credential expired before its outcome';
    end if;
    v_original_outcome:=jsonb_build_object('schema','custodial.employee-original-message-outcome.v1',
      'state','ORIGINAL_TRANSACTION_OUTCOME_RECORDED','request_fingerprint',v_original_fingerprint,
      'original_command',v_original_kind,'original_actor',v_current,'original_outcome_recorded',true,
      'original_request',v_original_payload-'credential_token_hash','result',v_original_result,
      'recorded_at',statement_timestamp(),'inventory_acknowledged',false,'finalizer_allowed',false,'key_removal',false);
    insert into custodial_release_identity.employee_message_original_outcomes
      (request_fingerprint,original_command,original_request,outcome_json)
      values(v_original_fingerprint,v_original_kind,v_original_payload,v_original_outcome);
    return v_original_outcome;
  end if;

  if v_command = 'public_rate_limit' then
    if coalesce(v_payload->>'bucket_key','') !~ '^[0-9a-f]{64}$' or length(coalesce(v_payload->>'scope','')) not between 1 and 80 then
      raise exception using errcode='22023', message='bounded rate-limit key and scope are required';
    end if;
    insert into public.public_submission_rate_limits(bucket_key,scope,window_started_at,request_count,updated_at)
    values(v_payload->>'bucket_key',v_payload->>'scope',now(),1,now())
    on conflict(bucket_key) do update set
      scope=excluded.scope,
      window_started_at=case when public.public_submission_rate_limits.window_started_at <= now()-interval '60 seconds' then now() else public.public_submission_rate_limits.window_started_at end,
      request_count=case when public.public_submission_rate_limits.window_started_at <= now()-interval '60 seconds' then 1 else public.public_submission_rate_limits.request_count+1 end,
      updated_at=now();
    return jsonb_build_object('ok',true);
  elsif v_command = 'attendance_state_upsert' then
    if nullif(v_payload->>'fetched_at','') is null or not isfinite((v_payload->>'fetched_at')::timestamptz) then
      raise exception using errcode='22023',message='visitor observation requires a finite source timestamp';
    end if;
    if (v_payload->>'fetched_at')::timestamptz < statement_timestamp()-interval '1 hour'
      or (v_payload->>'fetched_at')::timestamptz > statement_timestamp()+interval '60 seconds' then
      raise exception using errcode='22023',message='visitor observation requires a current source timestamp';
    end if;
    insert into public.current_attendance_state(id,attendance,last_year,planned,yesterday,yesterday_plan,source,fetched_at,updated_at)
    values(1,(v_payload->>'attendance')::integer,nullif(v_payload->>'last_year','')::integer,nullif(v_payload->>'planned','')::integer,
      nullif(v_payload->>'yesterday','')::integer,nullif(v_payload->>'yesterday_plan','')::integer,nullif(v_payload->>'source',''),
      nullif(v_payload->>'fetched_at','')::timestamptz,now())
    on conflict(id) do update set attendance=excluded.attendance,last_year=excluded.last_year,planned=excluded.planned,
      yesterday=excluded.yesterday,yesterday_plan=excluded.yesterday_plan,source=excluded.source,fetched_at=excluded.fetched_at,updated_at=now()
    where public.current_attendance_state.fetched_at is null
      or not isfinite(public.current_attendance_state.fetched_at)
      -- The conflicting row may have committed after this statement began.
      -- Classify poison when that row is considered, not with a stale start time.
      or public.current_attendance_state.fetched_at>clock_timestamp()+interval '60 seconds'
      or excluded.fetched_at>public.current_attendance_state.fetched_at
      or (excluded.fetched_at=public.current_attendance_state.fetched_at
        and row(excluded.attendance,excluded.last_year,excluded.planned,excluded.yesterday,excluded.yesterday_plan,excluded.source)
          is not distinct from row(public.current_attendance_state.attendance,public.current_attendance_state.last_year,
            public.current_attendance_state.planned,public.current_attendance_state.yesterday,
            public.current_attendance_state.yesterday_plan,public.current_attendance_state.source));
    if not found then
      raise exception using errcode='23514',message='visitor observation is older than or conflicts with the saved source version';
    end if;
    return jsonb_build_object('ok',true);
  elsif v_command = 'guest_report_create' then
    insert into public.guest_cleanliness_reports(
      id,operation_id,request_fingerprint,location_code,location_name,issue_type,severity,notes,status,marketing_review_status,notification_status,metadata_json
    ) values(
      (v_payload->>'id')::uuid,(v_payload->>'operation_id')::uuid,v_payload->>'request_fingerprint',v_payload->>'location_code',
      nullif(v_payload->>'location_name',''),v_payload->>'issue_type',v_payload->>'severity',nullif(v_payload->>'notes',''),
      'pending_marketing_review','pending','awaiting_marketing_review',coalesce(v_payload->'metadata_json','{}'::jsonb)
    ) on conflict(operation_id) do nothing;
    return jsonb_build_object('ok',true);
  elsif v_command = 'guest_report_notification' then
    update public.guest_cleanliness_reports set
      notification_status=v_payload->>'notification_status', notified_employee_user_id=nullif(v_payload->>'notified_employee_user_id','')::uuid,
      notified_ops_count=coalesce((v_payload->>'notified_ops_count')::integer,0),
      dispatched_at=case when coalesce((v_payload->>'delivered_count')::integer,0)>0 then now() else dispatched_at end,
      metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('notification_errors',coalesce(v_payload->'notification_errors','[]'::jsonb))
    where id=(v_payload->>'id')::uuid;
    return jsonb_build_object('ok',true);
  elsif v_command = 'guest_report_review' then
    if v_payload->>'action' = 'approve' then
      update public.guest_cleanliness_reports set marketing_review_status='approved',marketing_reviewed_at=now(),
        marketing_reviewed_by=v_payload->>'actor',marketing_review_notes=nullif(v_payload->>'notes',''),status='open',notification_status='pending'
      where id=(v_payload->>'id')::uuid and status='pending_marketing_review' and marketing_review_status='pending';
      insert into public.operational_notification_jobs(job_key,job_type,source_id,payload_json)
      select 'guest-report:'||id::text,'guest_cleanliness_report',id,jsonb_build_object('operation_id',operation_id,'marketing_approved',true)
      from public.guest_cleanliness_reports where id=(v_payload->>'id')::uuid and status='open' and marketing_review_status='approved'
      on conflict(job_key) do nothing;
    elsif v_payload->>'action' = 'reject' then
      update public.guest_cleanliness_reports set marketing_review_status='rejected',marketing_reviewed_at=now(),
        marketing_reviewed_by=v_payload->>'actor',marketing_review_notes=nullif(v_payload->>'notes',''),status='rejected',resolved_at=now(),
        resolved_by=v_payload->>'actor',notification_status='not_dispatched'
      where id=(v_payload->>'id')::uuid and status='pending_marketing_review' and marketing_review_status='pending';
    else
      raise exception using errcode='22023', message='guest report review action is unsupported';
    end if;
    return jsonb_build_object('ok',true);
  elsif v_command = 'guest_report_resolve' then
    update public.guest_cleanliness_reports set status='resolved',resolved_at=now(),resolved_by=v_payload->>'actor',
      metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('resolution_notes',nullif(v_payload->>'notes',''))
    where id=(v_payload->>'id')::uuid and status='open' and marketing_review_status='approved';
    return jsonb_build_object('ok',true);
  elsif v_command = 'feedback_legacy_image_migration' then
    update public.system_feedback_items set metadata_json=coalesce(v_payload->'metadata_json','{}'::jsonb),updated_at=now()
    where id=(v_payload->>'id')::uuid and metadata_json->'image_attachment'->>'data_url' is not null;
    update public.system_feedback_legacy_image_backups set migrated_at=now(),storage_bucket=v_payload->>'storage_bucket',storage_path=v_payload->>'storage_path'
    where feedback_id=(v_payload->>'id')::uuid;
    return jsonb_build_object('ok',true);
  elsif v_command = 'feedback_create' then
    insert into public.system_feedback_items(id,operation_id,request_fingerprint,category,priority,message,submitted_by,hub_context,device_id,page_url,summary,metadata_json)
    values((v_payload->>'id')::uuid,(v_payload->>'operation_id')::uuid,v_payload->>'request_fingerprint',v_payload->>'category',
      v_payload->>'priority',v_payload->>'message',nullif(v_payload->>'submitted_by',''),v_payload->>'hub_context',nullif(v_payload->>'device_id',''),
      nullif(v_payload->>'page_url',''),v_payload->>'summary',coalesce(v_payload->'metadata_json','{}'::jsonb))
    on conflict(operation_id) do nothing;
    return jsonb_build_object('ok',true);
  elsif v_command = 'feedback_notification' then
    update public.system_feedback_items set notification_status=v_payload->>'notification_status',
      notified_ops_count=coalesce(notified_ops_count,0)+coalesce((v_payload->>'notified_ops_count')::integer,0),last_feedback_reminder_at=now(),
      feedback_reminder_count=coalesce(feedback_reminder_count,0)+coalesce((v_payload->>'reminder_increment')::integer,0),updated_at=now(),
      metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('notification_errors',coalesce(v_payload->'notification_errors','[]'::jsonb))
    where id=(v_payload->>'id')::uuid;
    return jsonb_build_object('ok',true);
  elsif v_command = 'feedback_status' then
    update public.system_feedback_items set status=v_payload->>'status',
      acknowledged_at=case when v_payload->>'status'='acknowledged' then now() else acknowledged_at end,
      acknowledged_by=case when v_payload->>'status'='acknowledged' then v_payload->>'actor' else acknowledged_by end,
      updated_at=now(),metadata_json=coalesce(metadata_json,'{}'::jsonb)||coalesce(v_payload->'metadata_patch','{}'::jsonb)
    where id=(v_payload->>'id')::uuid and status not in ('closed','resolved');
    return jsonb_build_object('ok',true);
  elsif v_command = 'feedback_reminder_exhausted' then
    update public.system_feedback_items set status='reminder_exhausted',updated_at=now(),
      metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('reminder_exhausted_reason',v_payload->>'reason')
    where id=(v_payload->>'id')::uuid and status not in ('acknowledged','resolved','closed');
    return jsonb_build_object('ok',true);
  elsif v_command = 'feedback_dashboard_only' then
    update public.system_feedback_items set notification_status='dashboard_only',notified_ops_count=0,updated_at=now(),
      metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('notification_delivery','dashboard_only')
    where id=(v_payload->>'id')::uuid;
    return jsonb_build_object('ok',true);
  end if;
  raise exception using errcode='22023', message='unsupported bounded operational command';
end
$function$;

-- Existing dispatcher owner/signature/ACL remain unchanged. No new EXECUTE or
-- table privilege is granted to any runtime role; direct ledger reads deny.
-- Register only the fresh source-defined ledger, through the existing eleven
-- kind recovery machinery. No data/role/schema recapture or row mutation.
set local search_path=pg_catalog,public,extensions;
lock table public.custodial_release_authority_restore_inventory in access exclusive mode;
create temp table message_recovery_before on commit drop as
 select * from public.custodial_release_authority_restore_inventory;
create temp table message_surface_before on commit drop as
 select oid,proowner,proacl,pg_get_functiondef(oid) definition from pg_proc
 where oid='public.custodial_release_canary_authority_surface()'::regprocedure;
do $predecessor$
declare ledger regclass:='custodial_release_identity.employee_message_original_outcomes'::regclass;
begin
 if exists(select 1 from message_recovery_before where definition_sha256 is distinct from public.static_weekly_digest_text(definition_sql))
  or not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A')
  or (select count(*) from message_recovery_before where object_kind='function' and object_identity like '%(%'
    and to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
    and definition_sql=(select definition from message_surface_before))<>1
  or (select count(*) from message_recovery_before where object_kind='function'
    and object_identity='public.app_apply_operational_command(text,jsonb)')<>1
  or not exists(select 1 from pg_class where oid=ledger and relkind='r' and relpersistence='p'
    and relowner=(select oid from pg_roles where rolname=current_user) and relrowsecurity and relforcerowsecurity
    and relowner=(select proowner from pg_proc where oid='public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)'::regprocedure))
  or not exists(select 1 from message_recovery_before where object_kind='function' and object_identity like '%(%'
    and to_regprocedure(object_identity)='public.custodial_feedback_triage_immutable()'::regprocedure
    and definition_sql=pg_get_functiondef('public.custodial_feedback_triage_immutable()'::regprocedure))
  or (select array_agg(attname::text order by attnum) from pg_attribute where attrelid=ledger and attnum>0 and not attisdropped)
    is distinct from array['request_fingerprint','original_command','original_request','outcome_json','recorded_at']::text[]
  or (select array_agg(atttypid order by attnum) from pg_attribute where attrelid=ledger and attnum>0 and not attisdropped)
    is distinct from array['text'::regtype::oid,'text'::regtype::oid,'jsonb'::regtype::oid,'jsonb'::regtype::oid,'timestamptz'::regtype::oid]
  or exists(select 1 from pg_attribute where attrelid=ledger and attnum>0 and not attisdropped
    and (not attnotnull or attacl is not null or attidentity<>'' or attgenerated<>''))
  or exists(select 1 from pg_policy where polrelid=ledger)
  or exists(select 1 from pg_class r cross join lateral aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) a
    where r.oid=ledger and a.grantee<>r.relowner)
  or (select count(*) from pg_constraint where conrelid=ledger)<>5
  or exists(select 1 from pg_constraint where conrelid=ledger and (not convalidated or contype not in('p','c')
    or conname not in('employee_message_original_outcomes_pkey','employee_message_original_outcomes_request_fingerprint_check',
      'employee_message_original_outcomes_original_command_check','employee_message_original_outcomes_original_request_check',
      'employee_message_original_outcomes_outcome_json_check')))
  or (select count(*) from pg_trigger where tgrelid=ledger and not tgisinternal)<>1
  or not exists(select 1 from pg_trigger where tgrelid=ledger and not tgisinternal
    and tgname='employee_message_original_outcomes_immutable' and tgenabled='A' and tgtype=27
    and tgfoid='public.custodial_feedback_triage_immutable()'::regprocedure and tgqual is null and octet_length(tgargs)=0)
  or exists(select 1 from pg_index i where i.indrelid=ledger
    and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid))
 then raise exception 'Original Messenger exact private ledger recovery predecessor changed';end if;
end $predecessor$;
create temp table message_recovery_objects(
 bucket integer not null,priority integer not null,kind text not null,identity text not null,definition text not null,
 primary key(kind,identity)
) on commit drop;
insert into message_recovery_objects
 select 1000,0,'relation','custodial_release_identity.employee_message_original_outcomes',
  public.custodial_release_authority_current_relation_definition('custodial_release_identity.employee_message_original_outcomes')
 union all select 300000,0,'column_set','custodial_release_identity.employee_message_original_outcomes',
  public.custodial_release_authority_current_column_set_definition('custodial_release_identity.employee_message_original_outcomes')
 union all select 400000,0,'relation_state','custodial_release_identity.employee_message_original_outcomes',
  public.custodial_release_authority_current_relation_state_definition('custodial_release_identity.employee_message_original_outcomes')
 union all select 900000,0,'grant','custodial_release_identity.employee_message_original_outcomes',
  public.custodial_release_authority_current_grant_definition('custodial_release_identity.employee_message_original_outcomes');
insert into message_recovery_objects
 select 200000,a.attnum,'column','custodial_release_identity.employee_message_original_outcomes:'||a.attname,
  public.custodial_release_authority_current_column_definition('custodial_release_identity.employee_message_original_outcomes:'||a.attname)
 from pg_attribute a where a.attrelid='custodial_release_identity.employee_message_original_outcomes'::regclass
  and a.attnum>0 and not a.attisdropped;
insert into message_recovery_objects
 select 500000,0,'constraint','custodial_release_identity.employee_message_original_outcomes:'||c.conname,
  public.custodial_release_authority_current_constraint_definition('custodial_release_identity.employee_message_original_outcomes:'||c.conname)
 from pg_constraint c where c.conrelid='custodial_release_identity.employee_message_original_outcomes'::regclass;
-- PK-owned index is recreated by its exact constraint, not DROPped separately.
insert into message_recovery_objects
 select 700000,0,'trigger','custodial_release_identity.employee_message_original_outcomes.'||t.tgname,
  'drop trigger if exists '||quote_ident(t.tgname)||' on custodial_release_identity.employee_message_original_outcomes; '
   ||pg_get_triggerdef(t.oid,true)||'; alter table custodial_release_identity.employee_message_original_outcomes enable always trigger '
   ||quote_ident(t.tgname)||';'
 from pg_trigger t where t.tgrelid='custodial_release_identity.employee_message_original_outcomes'::regclass and not t.tgisinternal;
do $scope$ begin
 if (select count(*) from message_recovery_objects)<>15
  or exists(select 1 from message_recovery_objects n join message_recovery_before old on old.object_kind=n.kind and old.object_identity=n.identity)
  or exists(select 1 from public.custodial_release_canary_authority_surface() old join message_recovery_objects n
    on old.object_kind=n.kind and old.object_identity=n.identity)
 then raise exception 'Original Messenger recovery registration was not absent or exact';end if;
end $scope$;
alter table public.custodial_release_authority_restore_inventory
 disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare identity text:='public.app_apply_operational_command(text,jsonb)'; definition text;
 o record;next_order integer;limit_order integer;changed integer;before text;after text;additions text:='';
 surface regprocedure:='public.custodial_release_canary_authority_surface()'::regprocedure;
begin
 definition:=pg_get_functiondef(to_regprocedure(identity));
 update public.custodial_release_authority_restore_inventory
  set definition_sql=definition,definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
  where object_kind='function' and object_identity=identity;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Existing operational dispatcher recovery identity missing';end if;
 for o in select n.* from message_recovery_objects n order by n.bucket,n.priority,n.kind,n.identity loop
  -- Relation declarations must remain below the function dependency bucket.
  limit_order:=case when o.bucket=1000 then 100000 else o.bucket+100000 end;
  select candidate into next_order from generate_series(o.bucket,limit_order-1) candidate
   where not exists(select 1 from public.custodial_release_authority_restore_inventory i where i.restore_order=candidate)
   order by candidate limit 1;
  if next_order is null or next_order<o.bucket or next_order>=limit_order
   then raise exception 'Original Messenger recovery bucket exhausted';end if;
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(next_order,o.kind,o.identity,o.definition,public.static_weekly_digest_text(o.definition));
  additions:=additions||format(E'    (%L,%L,%L),\n',o.kind,o.identity,'exact source268 private original Messenger ledger');
 end loop;
 select s.definition into strict before from message_surface_before s;
 if (length(before)-length(replace(before,'  values','')))/length('  values')<>1 then
  raise exception 'Original Messenger exact canary VALUES predecessor changed';end if;
 after:=replace(before,'  values',E'  values\n'||additions);execute after;
 if pg_get_functiondef(surface) is distinct from after
  or (select proowner from pg_proc where oid=surface) is distinct from (select proowner from message_surface_before)
  or (select proacl from pg_proc where oid=surface) is distinct from (select proacl from message_surface_before)
 then raise exception 'Original Messenger canary owner/ACL/source changed';end if;
 update public.custodial_release_authority_restore_inventory set definition_sql=after,
  definition_sha256=public.static_weekly_digest_text(after),captured_at=statement_timestamp()
  where object_kind='function' and object_identity like '%(%' and to_regprocedure(object_identity)=surface
   and definition_sql=before and definition_sha256=public.static_weekly_digest_text(before);
 get diagnostics changed=row_count;if changed<>1 then raise exception 'Original Messenger exact canary recovery identity missing';end if;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory
 enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
do $final$ begin
 if (select count(*) from public.custodial_release_authority_restore_inventory)<>(select count(*) from message_recovery_before)+15
  or exists(select old.* from message_recovery_before old where not(old.object_kind='function' and old.object_identity like '%(%'
    and to_regprocedure(old.object_identity) in('public.app_apply_operational_command(text,jsonb)'::regprocedure,
      'public.custodial_release_canary_authority_surface()'::regprocedure))
    except select * from public.custodial_release_authority_restore_inventory)
  or exists(select now.* from public.custodial_release_authority_restore_inventory now where not(now.object_kind='function' and now.object_identity like '%(%'
    and to_regprocedure(now.object_identity) in('public.app_apply_operational_command(text,jsonb)'::regprocedure,
      'public.custodial_release_canary_authority_surface()'::regprocedure))
    and not exists(select 1 from message_recovery_objects n where n.kind=now.object_kind and n.identity=now.object_identity)
    except select * from message_recovery_before)
  or exists(select 1 from message_recovery_objects n left join public.custodial_release_authority_restore_inventory i
    on i.object_kind=n.kind and i.object_identity=n.identity where i.inventory_id is null or i.definition_sql is distinct from n.definition
      or i.definition_sha256 is distinct from public.static_weekly_digest_text(n.definition))
  or exists(select 1 from message_recovery_objects n where (select count(*) from public.custodial_release_canary_authority_surface() s
    where s.object_kind=n.kind and s.object_identity=n.identity)<>1)
  or exists(select 1 from public.custodial_release_authority_restore_inventory where definition_sha256 is distinct from public.static_weekly_digest_text(definition_sql))
  or not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A')
 then raise exception 'Original Messenger unrelated recovery membership or ALWAYS guard changed';end if;
end $final$;
commit;

