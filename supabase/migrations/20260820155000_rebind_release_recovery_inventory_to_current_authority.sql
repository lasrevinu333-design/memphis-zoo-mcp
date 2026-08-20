-- Bind release recovery to the complete current authority after the append-only
-- identity and late-GPS corrections. Recovery must never roll the live schema
-- backward to an earlier captured session shape or function body.

begin;

do $release_inventory_preflight$
begin
  if to_regclass('public.custodial_release_authority_restore_inventory') is null
     or to_regprocedure('public.custodial_release_authority_current_relation_definition(text)') is null
     or to_regprocedure('public.custodial_release_authority_current_grant_definition(text)') is null then
    raise exception 'release authority inventory helpers are unavailable';
  end if;
  if exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and a.attnum>0
      and not a.attisdropped
      and a.attacl is not null
  ) then
    raise exception 'explicit authority-column grants require reviewed reconciliation before release capture';
  end if;
end
$release_inventory_preflight$;

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

delete from public.custodial_release_authority_restore_inventory;

with recursive authority_relations as (
  select c.oid,n.nspname,c.relname
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and (
    c.relname like 'custodial_%'
    or c.relname like '%notification%'
    or c.relname like '%push%'
    or c.relname in (
      'devices','locations','device_auth_credentials','sessions','completion_responses',
      'maintenance_tickets','scan_events','employee_push_registrations',
      'employee_native_push_delivery_receipts','event_push_instances',
      'events_app_events','operational_notification_jobs'
    )
    or quote_ident(n.nspname)||'.'||quote_ident(c.relname) in (
      select s.object_identity
      from public.custodial_release_canary_authority_surface() s
      where s.object_kind='relation'
    )
  )
  union
  select peer.oid,pn.nspname,peer.relname
  from authority_relations r
  join pg_constraint fk on fk.contype='f' and (fk.conrelid=r.oid or fk.confrelid=r.oid)
  join pg_class peer on peer.oid=case when fk.conrelid=r.oid then fk.confrelid else fk.conrelid end
  join pg_namespace pn on pn.oid=peer.relnamespace
  where pn.nspname='public' and peer.relkind in ('r','p')
), authority_functions as (
  select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (
    p.proname like 'custodial_%'
    or p.proname like '%notification%'
    or p.proname like '%push%'
    or p.proname in (
      'create_maintenance_tickets_from_response','resolve_scan_location_code',
      'static_weekly_reject_update_delete','tool_get_device_rollback_readiness',
      'tool_get_offline_scan_authority_snapshot','tool_start_offline_occurrence',
      'tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative',
      'mz_resolve_employee_push_delivery','mz_record_employee_push_delivery',
      'mz_claim_employee_event_push_delivery','mz_record_employee_event_push_delivery',
      'mz_register_employee_push','mz_mark_employee_event_opened',
      'mz_enqueue_employee_event_pushes','mz_enqueue_employee_location_pushes',
      'mz_get_employee_native_push_delivery_receipt','mz_prepare_employee_native_push_delivery',
      'mz_record_employee_native_push_delivery','finish_operational_notification_job',
      'finish_operational_notification_job_terminal'
    )
    or p.oid::regprocedure::text in (
      select s.object_identity
      from public.custodial_release_canary_authority_surface() s
      where s.object_kind='function'
    )
  )
  union
  select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args
  from pg_trigger t
  join authority_relations r on r.oid=t.tgrelid
  join pg_proc p on p.oid=t.tgfoid
  join pg_namespace n on n.oid=p.pronamespace
  where not t.tgisinternal and n.nspname='public'
), inventory_rows as (
  select 1000+row_number() over(order by r.relname)::integer restore_order,
    'relation'::text object_kind,
    quote_ident(r.nspname)||'.'||quote_ident(r.relname) object_identity,
    public.custodial_release_authority_current_relation_definition(
      quote_ident(r.nspname)||'.'||quote_ident(r.relname)
    ) definition_sql
  from authority_relations r
  union all
  select 100000+row_number() over(order by proname,args)::integer,'function',
    oid::regprocedure::text,pg_get_functiondef(oid)
  from authority_functions
  union all
  select 200000+row_number() over(order by r.relname,a.attname)::integer,'column',
    quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||a.attname,
    public.custodial_release_authority_current_column_definition(
      quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||a.attname
    )
  from authority_relations r
  join pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped
  union all
  select 300000+row_number() over(order by r.relname)::integer,'column_set',
    quote_ident(r.nspname)||'.'||quote_ident(r.relname),
    public.custodial_release_authority_current_column_set_definition(
      quote_ident(r.nspname)||'.'||quote_ident(r.relname)
    )
  from authority_relations r
  union all
  select 400000+row_number() over(order by r.relname)::integer,'relation_state',
    quote_ident(r.nspname)||'.'||quote_ident(r.relname),
    public.custodial_release_authority_current_relation_state_definition(
      quote_ident(r.nspname)||'.'||quote_ident(r.relname)
    )
  from authority_relations r
  union all
  select 500000+row_number() over(
      order by case c.contype when 'p' then 1 when 'u' then 2 when 'f' then 3 else 4 end,
        r.relname,c.conname
    )::integer,
    'constraint',quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||c.conname,
    public.custodial_release_authority_current_constraint_definition(
      quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||c.conname
    )
  from pg_constraint c
  join authority_relations r on r.oid=c.conrelid
  union all
  select 600000+row_number() over(order by r.relname,i.relname)::integer,'index',
    quote_ident(ns.nspname)||'.'||quote_ident(i.relname),
    public.custodial_release_authority_current_index_definition(
      quote_ident(ns.nspname)||'.'||quote_ident(i.relname)
    )
  from pg_index ix
  join authority_relations r on r.oid=ix.indrelid
  join pg_class i on i.oid=ix.indexrelid
  join pg_namespace ns on ns.oid=i.relnamespace
  where not exists(select 1 from pg_constraint c where c.conindid=ix.indexrelid)
  union all
  select 700000+row_number() over(order by r.relname,t.tgname)::integer,'trigger',
    quote_ident(r.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname),
    'drop trigger if exists '||quote_ident(t.tgname)||' on '
      ||quote_ident(r.nspname)||'.'||quote_ident(r.relname)||'; '
      ||pg_get_triggerdef(t.oid,true)||'; alter table '
      ||quote_ident(r.nspname)||'.'||quote_ident(r.relname)||' '
      ||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable'
          when 'R' then 'enable replica' when 'A' then 'enable always' end
      ||' trigger '||quote_ident(t.tgname)||';'
  from pg_trigger t
  join authority_relations r on r.oid=t.tgrelid
  where not t.tgisinternal
  union all
  select 800000+row_number() over(order by r.relname,p.polname)::integer,'policy',
    quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||p.polname,
    public.custodial_release_authority_current_policy_definition(
      quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||p.polname
    )
  from pg_policy p
  join authority_relations r on r.oid=p.polrelid
  union all
  select 900000+row_number() over(order by nspname,relname)::integer,'grant',
    quote_ident(nspname)||'.'||quote_ident(relname),
    public.custodial_release_authority_current_grant_definition(
      quote_ident(nspname)||'.'||quote_ident(relname)
    )
  from authority_relations
)
insert into public.custodial_release_authority_restore_inventory(
  restore_order,object_kind,object_identity,definition_sql,definition_sha256
)
select restore_order,object_kind,object_identity,definition_sql,
  encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex')
from inventory_rows;

with recursive authority_relations as (
  select c.oid,n.nspname,c.relname
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and (
    c.relname like 'custodial_%'
    or c.relname like '%notification%'
    or c.relname like '%push%'
    or c.relname in (
      'devices','locations','device_auth_credentials','sessions','completion_responses',
      'maintenance_tickets','scan_events','employee_push_registrations',
      'employee_native_push_delivery_receipts','event_push_instances',
      'events_app_events','operational_notification_jobs'
    )
    or quote_ident(n.nspname)||'.'||quote_ident(c.relname) in (
      select s.object_identity
      from public.custodial_release_canary_authority_surface() s
      where s.object_kind='relation'
    )
  )
  union
  select peer.oid,pn.nspname,peer.relname
  from authority_relations r
  join pg_constraint fk on fk.contype='f' and (fk.conrelid=r.oid or fk.confrelid=r.oid)
  join pg_class peer on peer.oid=case when fk.conrelid=r.oid then fk.confrelid else fk.conrelid end
  join pg_namespace pn on pn.oid=peer.relnamespace
  where pn.nspname='public' and peer.relkind in ('r','p')
), authority_functions as (
  select p.oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (
    p.proname like 'custodial_%'
    or p.proname like '%notification%'
    or p.proname like '%push%'
    or p.proname in (
      'create_maintenance_tickets_from_response','resolve_scan_location_code',
      'static_weekly_reject_update_delete','tool_get_device_rollback_readiness',
      'tool_get_offline_scan_authority_snapshot','tool_start_offline_occurrence',
      'tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative',
      'mz_resolve_employee_push_delivery','mz_record_employee_push_delivery',
      'mz_claim_employee_event_push_delivery','mz_record_employee_event_push_delivery',
      'mz_register_employee_push','mz_mark_employee_event_opened',
      'mz_enqueue_employee_event_pushes','mz_enqueue_employee_location_pushes',
      'mz_get_employee_native_push_delivery_receipt','mz_prepare_employee_native_push_delivery',
      'mz_record_employee_native_push_delivery','finish_operational_notification_job',
      'finish_operational_notification_job_terminal'
    )
    or p.oid::regprocedure::text in (
      select s.object_identity
      from public.custodial_release_canary_authority_surface() s
      where s.object_kind='function'
    )
  )
  union
  select p.oid
  from pg_trigger t
  join authority_relations r on r.oid=t.tgrelid
  join pg_proc p on p.oid=t.tgfoid
  join pg_namespace n on n.oid=p.pronamespace
  where not t.tgisinternal and n.nspname='public'
  union
  select i.oid
  from public.custodial_terminal_writer_inventory i
  where i.mutates_terminal_truth or i.delegates_alternate_terminal_authority
  union
  select p.oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'run_application_write','run_sql_write','run_sql_migration','force_close_session',
    'tool_force_close_session','purge_closed_scan_history_before',
    'tool_purge_closed_scan_history_before'
  )
)
insert into public.custodial_release_authority_restore_inventory(
  restore_order,object_kind,object_identity,definition_sql,definition_sha256
)
select 1000000+row_number() over(order by function_identity),'grant',function_identity,
  grant_sql,encode(extensions.digest(convert_to(grant_sql,'UTF8'),'sha256'),'hex')
from (
  select p.oid::regprocedure::text function_identity,
    public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text) grant_sql
  from pg_proc p
  join authority_functions f on f.oid=p.oid
) function_grants;

alter table public.custodial_release_authority_bootstrap_definitions
  disable trigger trg_custodial_release_authority_bootstrap_definitions_immutable;

update public.custodial_release_authority_bootstrap_definitions
set function_definition=pg_get_functiondef(
      'public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)'::regprocedure
    ),
    definition_sha256=encode(
      extensions.digest(
        convert_to(
          pg_get_functiondef(
            'public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)'::regprocedure
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    captured_at=statement_timestamp()
where bootstrap_key=true;

alter table public.custodial_release_authority_bootstrap_definitions
  enable trigger trg_custodial_release_authority_bootstrap_definitions_immutable;

-- The inventory is captured while its own mutation guard is temporarily
-- disabled. Bind the recovery row to the final enabled state, not that
-- migration-only intermediate state.
update public.custodial_release_authority_restore_inventory i
set definition_sql = 'drop trigger if exists trg_custodial_release_authority_restore_inventory_immutable on public.custodial_release_authority_restore_inventory; '
      ||pg_get_triggerdef(t.oid,true)
      ||'; alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;',
    definition_sha256 = encode(
      extensions.digest(
        convert_to(
          'drop trigger if exists trg_custodial_release_authority_restore_inventory_immutable on public.custodial_release_authority_restore_inventory; '
            ||pg_get_triggerdef(t.oid,true)
            ||'; alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    captured_at=statement_timestamp()
from pg_trigger t
where i.object_kind='trigger'
  and i.object_identity='public.custodial_release_authority_restore_inventory.trg_custodial_release_authority_restore_inventory_immutable'
  and t.tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and t.tgname='trg_custodial_release_authority_restore_inventory_immutable'
  and not t.tgisinternal;

alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $release_inventory_postflight$
begin
  if exists (
    select 1
    from public.custodial_release_authority_restore_inventory
    where definition_sha256 <> encode(
      extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex'
    )
  ) then
    raise exception 'release authority inventory digest mismatch';
  end if;
  if exists (
    select 1
    from public.custodial_release_authority_restore_inventory
    where object_kind in ('function','grant')
      and object_identity='run_sql_readonly(text)'
  ) then
    raise exception 'retired owner SQL proxy entered the exact release inventory';
  end if;
  if not exists (
    select 1
    from public.custodial_release_authority_restore_inventory
    where object_kind='column'
      and object_identity='public.sessions:employee_name_snapshot'
  ) or not exists (
    select 1
    from public.custodial_release_authority_restore_inventory
    where object_kind='relation'
      and object_identity='public.custodial_session_corrections'
  ) then
    raise exception 'append-only cleaning identity is absent from exact release recovery';
  end if;
end
$release_inventory_postflight$;

commit;
