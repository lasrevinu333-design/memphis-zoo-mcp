begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
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
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception using errcode='22023', message='operational command payload must be an object';
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

-- Aggregate visitor counts only. Manager mutation authorization is unchanged.
create policy custodial_reader_current_visitor_attendance
on public.current_attendance_state for select
to custodial_application_reader using (id=1);

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare identity text:='public.current_attendance_state:custodial_reader_current_visitor_attendance';
  definition text; next_order integer;
begin
  definition:=public.custodial_release_authority_current_policy_definition(identity);
  if definition is null then raise exception 'visitor attendance reader policy missing'; end if;
  if exists(select 1 from public.custodial_release_authority_restore_inventory
    where object_kind='policy' and object_identity=identity) then
    raise exception 'visitor attendance reader recovery policy already exists';
  end if;
  select coalesce(max(restore_order),800000)+1 into next_order
    from public.custodial_release_authority_restore_inventory
    where restore_order>=800000 and restore_order<900000;
  insert into public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
  values(next_order,'policy',identity,definition,public.static_weekly_digest_text(definition));
  identity:='public.app_apply_operational_command(text,jsonb)';
  definition:=pg_get_functiondef(to_regprocedure(identity));
  update public.custodial_release_authority_restore_inventory
    set definition_sql=definition,definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
    where object_kind='function' and object_identity=identity;
  if not found then
    select coalesce(max(restore_order),100000)+1 into next_order
      from public.custodial_release_authority_restore_inventory where restore_order>=100000 and restore_order<200000;
    insert into public.custodial_release_authority_restore_inventory
      (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
      values(next_order,'function',identity,definition,public.static_weekly_digest_text(definition));
  end if;
  definition:=public.custodial_release_authority_current_grant_definition(identity);
  update public.custodial_release_authority_restore_inventory
    set definition_sql=definition,definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
    where object_kind='grant' and object_identity=identity;
  if not found then
    select coalesce(max(restore_order),900000)+1 into next_order
      from public.custodial_release_authority_restore_inventory where restore_order>=900000 and restore_order<1000000;
    insert into public.custodial_release_authority_restore_inventory
      (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
      values(next_order,'grant',identity,definition,public.static_weekly_digest_text(definition));
  end if;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
