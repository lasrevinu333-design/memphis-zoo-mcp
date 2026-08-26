-- Static weekly is the sole current schedule authority. Preserve historical
-- daily rows for audit/rollback, but reject every legacy writer once a date is
-- governed by a recurring publication. The old rolling cron is retired; the
-- retained window helper is compatibility-only for explicitly ungoverned
-- dates and reports current static-weekly dates without mutating shadow tables.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $preflight$
declare
  relation_identity text;
begin
  if to_regprocedure('public.static_weekly_v6_schedule_authority_state(date)') is null
     or to_regprocedure('public.sch_ensure_schedule_window(date,integer,text)') is null then
    raise exception 'static-weekly and legacy window authority must both exist before cutover retirement';
  end if;

  foreach relation_identity in array array[
    'public.daily_schedule_assignments',
    'public.daily_work_roster',
    'public.daily_group_assignments',
    'public.daily_absence_overrides'
  ] loop
    if to_regclass(relation_identity) is null then
      raise exception 'legacy schedule relation % is missing', relation_identity;
    end if;
  end loop;

  if to_regnamespace('cron') is null
     or to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is null
     or (select count(*) from cron.job where jobname='mz-rolling-schedule-window-ready') <> 1 then
    raise exception 'the exact legacy rolling schedule cron is unavailable or ambiguous';
  end if;

  if to_regclass('public.custodial_release_authority_restore_inventory') is null
     or to_regprocedure('public.custodial_release_authority_current_grant_definition(text)') is null then
    raise exception 'release recovery inventory authority is unavailable';
  end if;
end
$preflight$;

create or replace function public.static_weekly_reject_legacy_daily_schedule_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_payload jsonb;
  v_date date;
  v_dates date[] := array[]::date[];
  v_authority record;
begin
  if tg_op <> 'INSERT' then
    v_payload := to_jsonb(old);
    v_date := case tg_table_name
      when 'daily_schedule_assignments' then nullif(v_payload->>'service_date','')::date
      when 'daily_work_roster' then nullif(v_payload->>'service_date','')::date
      when 'daily_group_assignments' then nullif(v_payload->>'assignment_date','')::date
      when 'daily_absence_overrides' then nullif(v_payload->>'absence_date','')::date
      else null
    end;
    if v_date is not null then v_dates := array_append(v_dates,v_date); end if;
  end if;

  if tg_op <> 'DELETE' then
    v_payload := to_jsonb(new);
    v_date := case tg_table_name
      when 'daily_schedule_assignments' then nullif(v_payload->>'service_date','')::date
      when 'daily_work_roster' then nullif(v_payload->>'service_date','')::date
      when 'daily_group_assignments' then nullif(v_payload->>'assignment_date','')::date
      when 'daily_absence_overrides' then nullif(v_payload->>'absence_date','')::date
      else null
    end;
    if v_date is not null and not v_date=any(v_dates) then
      v_dates := array_append(v_dates,v_date);
    end if;
  end if;

  if cardinality(v_dates)=0 then
    raise exception using errcode='22023',
      message='legacy schedule write did not identify one service date';
  end if;

  foreach v_date in array v_dates loop
    select * into strict v_authority
    from public.static_weekly_v6_schedule_authority_state(v_date);
    if v_authority.governed then
      raise exception using errcode='55000',
        message='legacy daily schedule writes are retired for static-weekly governed dates',
        detail='service_date='||v_date::text||'; projection_status='||v_authority.projection_status,
        hint='Use the static-weekly append-only dated-change control plane.';
    end if;
  end loop;

  if tg_op='DELETE' then return old; end if;
  return new;
end
$function$;

revoke all on function public.static_weekly_reject_legacy_daily_schedule_write()
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;

comment on function public.static_weekly_reject_legacy_daily_schedule_write() is
  'Fail-closed trigger boundary preventing every legacy daily schedule writer from mutating a static-weekly governed date.';

do $install_legacy_write_fences$
declare
  relation_identity text;
  trigger_name text;
begin
  for relation_identity,trigger_name in values
    ('public.daily_schedule_assignments','trg_static_weekly_fence_daily_schedule_assignments'),
    ('public.daily_work_roster','trg_static_weekly_fence_daily_work_roster'),
    ('public.daily_group_assignments','trg_static_weekly_fence_daily_group_assignments'),
    ('public.daily_absence_overrides','trg_static_weekly_fence_daily_absence_overrides')
  loop
    execute format('drop trigger if exists %I on %s',trigger_name,relation_identity);
    execute format(
      'create trigger %I before insert or update or delete on %s for each row execute function public.static_weekly_reject_legacy_daily_schedule_write()',
      trigger_name,relation_identity
    );
  end loop;
end
$install_legacy_write_fences$;

create or replace function public.sch_ensure_schedule_window(
  p_start_date date default public.sch_service_date(now()),
  p_days integer default 14,
  p_reason text default 'scheduled_rolling_window_readiness'
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_start date := coalesce(p_start_date,public.sch_service_date(now()));
  v_days integer := greatest(1,least(coalesce(p_days,14),31));
  v_offset integer;
  v_date date;
  v_result jsonb;
  v_audit jsonb;
  v_authority record;
  v_results jsonb := '[]'::jsonb;
  v_ready integer := 0;
  v_failed integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('schedule-window:'||v_start::text||':'||v_days::text,0));

  for v_offset in 0..(v_days-1) loop
    v_date := v_start+v_offset;
    begin
      select * into strict v_authority
      from public.static_weekly_v6_schedule_authority_state(v_date);

      if v_authority.governed then
        if v_authority.projection_status='current' then
          v_ready := v_ready+1;
          v_results := v_results||jsonb_build_array(jsonb_build_object(
            'service_date',v_date,
            'ok',true,
            'authority_source',v_authority.authority_source,
            'projection_status',v_authority.projection_status,
            'publication_id',v_authority.publication_id,
            'projection_id',v_authority.projection_id,
            'legacy_mutation_skipped',true
          ));
        else
          v_failed := v_failed+1;
          v_results := v_results||jsonb_build_array(jsonb_build_object(
            'service_date',v_date,
            'ok',false,
            'authority_source',v_authority.authority_source,
            'projection_status',v_authority.projection_status,
            'error','static_weekly_projection_not_current',
            'legacy_mutation_skipped',true
          ));
        end if;
        continue;
      end if;

      v_result := public.sch_ensure_daily_schedule(
        v_date,
        coalesce(nullif(btrim(p_reason),''),'scheduled_rolling_window_readiness')
      );
      v_audit := public.sch_audit_schedule_day(v_date);
      if coalesce((v_audit->>'ok')::boolean,false) then
        v_ready := v_ready+1;
        v_results := v_results||jsonb_build_array(jsonb_build_object(
          'service_date',v_date,'ok',true,'authority_source','legacy_daily_schedule',
          'result',v_result,'audit',v_audit
        ));
      else
        v_failed := v_failed+1;
        v_results := v_results||jsonb_build_array(jsonb_build_object(
          'service_date',v_date,'ok',false,'authority_source','legacy_daily_schedule',
          'error','schedule_audit_failed','result',v_result,'audit',v_audit
        ));
      end if;
    exception when others then
      v_failed := v_failed+1;
      v_results := v_results||jsonb_build_array(jsonb_build_object(
        'service_date',v_date,'ok',false,'error',sqlerrm
      ));
    end;
  end loop;

  insert into public.schedule_automation_runs(
    automation_key,service_date,status,result_json,created_at,updated_at
  ) values (
    'rolling_schedule_window_ready',v_start,
    case when v_failed=0 then 'completed' else 'failed' end,
    jsonb_build_object(
      'start_date',v_start,'days',v_days,'reason',p_reason,
      'ready_days',v_ready,'failed_days',v_failed,'results',v_results
    ),now(),now()
  ) on conflict(automation_key,service_date) do update set
    status=excluded.status,result_json=excluded.result_json,updated_at=now();

  return jsonb_build_object(
    'ok',v_failed=0,'start_date',v_start,'days',v_days,
    'ready_days',v_ready,'failed_days',v_failed,'results',v_results
  );
end
$function$;

comment on function public.sch_ensure_schedule_window(date,integer,text) is
  'Retired rolling helper: reports static-weekly governed dates without mutation and generates only explicitly ungoverned legacy dates.';

do $disable_legacy_rolling_cron$
declare v_job_id bigint;
begin
  select jobid into strict v_job_id
  from cron.job where jobname='mz-rolling-schedule-window-ready';
  perform cron.alter_job(v_job_id,null,null,null,null,false);
end
$disable_legacy_rolling_cron$;

-- Bind the fail-closed functions and all four table triggers into release
-- recovery so a release rollback cannot silently resurrect legacy writers.
alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $capture_legacy_writer_retirement_functions$
declare
  identity text;
  canonical_identity text;
  definition text;
  grant_definition text;
  next_order integer;
begin
  foreach identity in array array[
    'public.static_weekly_reject_legacy_daily_schedule_write()',
    'public.sch_ensure_schedule_window(date,integer,text)'
  ] loop
    canonical_identity:=to_regprocedure(identity)::text;
    definition:=pg_get_functiondef(to_regprocedure(identity));
    if definition is null then raise exception 'required legacy writer retirement function % is missing',identity; end if;

    if exists(select 1 from public.custodial_release_authority_restore_inventory
              where object_kind='function' and object_identity=canonical_identity) then
      update public.custodial_release_authority_restore_inventory
         set definition_sql=definition,
             definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
             captured_at=statement_timestamp()
       where object_kind='function' and object_identity=canonical_identity;
    else
      select coalesce(max(restore_order),100000)+1 into next_order
      from public.custodial_release_authority_restore_inventory where object_kind='function';
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values (
        next_order,'function',canonical_identity,definition,
        encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
      );
    end if;

    grant_definition:=public.custodial_release_authority_current_grant_definition(canonical_identity);
    if exists(select 1 from public.custodial_release_authority_restore_inventory
              where object_kind='grant' and object_identity=canonical_identity) then
      update public.custodial_release_authority_restore_inventory
         set definition_sql=grant_definition,
             definition_sha256=encode(extensions.digest(convert_to(grant_definition,'UTF8'),'sha256'),'hex'),
             captured_at=statement_timestamp()
       where object_kind='grant' and object_identity=canonical_identity;
    else
      select coalesce(max(restore_order),1000000)+1 into next_order
      from public.custodial_release_authority_restore_inventory where object_kind='grant';
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values (
        next_order,'grant',canonical_identity,grant_definition,
        encode(extensions.digest(convert_to(grant_definition,'UTF8'),'sha256'),'hex')
      );
    end if;
  end loop;
end
$capture_legacy_writer_retirement_functions$;

do $capture_legacy_writer_retirement_triggers$
declare
  trigger_row record;
  identity text;
  definition text;
  next_order integer;
begin
  for trigger_row in
    select t.oid,t.tgname,c.relname,n.nspname,t.tgenabled
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and t.tgname in (
        'trg_static_weekly_fence_daily_schedule_assignments',
        'trg_static_weekly_fence_daily_work_roster',
        'trg_static_weekly_fence_daily_group_assignments',
        'trg_static_weekly_fence_daily_absence_overrides'
      )
      and not t.tgisinternal
    order by c.relname,t.tgname
  loop
    identity:=quote_ident(trigger_row.nspname)||'.'||quote_ident(trigger_row.relname)||'.'||quote_ident(trigger_row.tgname);
    definition:='drop trigger if exists '||quote_ident(trigger_row.tgname)||' on '
      ||quote_ident(trigger_row.nspname)||'.'||quote_ident(trigger_row.relname)||'; '
      ||pg_get_triggerdef(trigger_row.oid,true)||'; alter table '
      ||quote_ident(trigger_row.nspname)||'.'||quote_ident(trigger_row.relname)||' '
      ||case trigger_row.tgenabled when 'O' then 'enable' when 'D' then 'disable'
          when 'R' then 'enable replica' when 'A' then 'enable always' end
      ||' trigger '||quote_ident(trigger_row.tgname)||';';

    if exists(select 1 from public.custodial_release_authority_restore_inventory
              where object_kind='trigger' and object_identity=identity) then
      update public.custodial_release_authority_restore_inventory
         set definition_sql=definition,
             definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
             captured_at=statement_timestamp()
       where object_kind='trigger' and object_identity=identity;
    else
      select coalesce(max(restore_order),700000)+1 into next_order
      from public.custodial_release_authority_restore_inventory where object_kind='trigger';
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values (
        next_order,'trigger',identity,definition,
        encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
      );
    end if;
  end loop;
end
$capture_legacy_writer_retirement_triggers$;

alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $postflight$
begin
  if (select count(*) from cron.job
      where jobname='mz-rolling-schedule-window-ready' and active=false) <> 1 then
    raise exception 'legacy rolling schedule cron was not retired';
  end if;

  if (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and not t.tgisinternal
        and t.tgname like 'trg_static_weekly_fence_daily_%' and t.tgenabled='O') <> 4 then
    raise exception 'legacy daily schedule write fences are incomplete';
  end if;

  if has_function_privilege('public','public.static_weekly_reject_legacy_daily_schedule_write()','EXECUTE')
     or has_function_privilege('anon','public.static_weekly_reject_legacy_daily_schedule_write()','EXECUTE')
     or has_function_privilege('authenticated','public.static_weekly_reject_legacy_daily_schedule_write()','EXECUTE')
     or has_function_privilege('service_role','public.static_weekly_reject_legacy_daily_schedule_write()','EXECUTE') then
    raise exception 'legacy daily schedule write fence is directly executable';
  end if;

  if (select count(*) from public.custodial_release_authority_restore_inventory
      where object_kind='trigger' and object_identity like 'public.daily%.trg_static_weekly_fence_daily_%') <> 4
     or (select count(*) from public.custodial_release_authority_restore_inventory
         where object_kind='function' and object_identity in (
           'static_weekly_reject_legacy_daily_schedule_write()',
           'sch_ensure_schedule_window(date,integer,text)'
         )) <> 2 then
    raise exception 'legacy writer retirement is absent from release recovery';
  end if;

  if exists(select 1 from public.custodial_release_authority_restore_inventory
            where definition_sha256<>encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex')) then
    raise exception 'legacy writer retirement release inventory digest mismatch';
  end if;
end
$postflight$;

commit;
