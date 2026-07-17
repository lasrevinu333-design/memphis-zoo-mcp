-- Deployed migration history snapshot: 20260715041327 lock_moxie_private_tables_20260715

do $do$
declare
  v_table text;
  v_policy record;
  v_tables text[] := array[
    'annie_chat_state',
    'annie_contacts',
    'annie_deliverables',
    'annie_log_notes',
    'annie_log_reminders',
    'annie_log_suggested_reminders',
    'annie_suggested_contacts'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'Required Moxie private table public.% does not exist', v_table;
    end if;

    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', v_table);

    for v_policy in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = v_table
    loop
      execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_table);
    end loop;

    execute format(
      'comment on table public.%I is %L',
      v_table,
      'Moxie private application data. Direct public, anon, and authenticated access is prohibited. The trusted backend service role is the only application data plane.'
    );
  end loop;
end
$do$;

revoke usage on schema public from public;
grant usage on schema public to anon, authenticated, service_role;

comment on schema public is 'Memphis Zoo application schema. Moxie private annie_* legacy tables are server-only despite their historical public-schema names.';
