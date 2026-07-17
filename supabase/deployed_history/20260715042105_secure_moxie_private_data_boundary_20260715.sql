-- Deployed migration history snapshot: 20260715042105 secure_moxie_private_data_boundary_20260715

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
    for v_policy in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = v_table
    loop
      execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_table);
    end loop;

    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', v_table);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      'moxie_service_role_only_' || v_table,
      v_table
    );
  end loop;
end
$do$;

comment on table public.annie_chat_state is 'Moxie-private chat state. Direct anonymous/authenticated access is forbidden; only the server-side Moxie module may use the service role.';
comment on table public.annie_contacts is 'Moxie-private contacts. Not part of Memphis operational AI context.';
comment on table public.annie_deliverables is 'Moxie-private deliverables. Not part of Memphis operational AI context.';
comment on table public.annie_log_notes is 'Moxie-private notes. Not part of Memphis operational AI context.';
comment on table public.annie_log_reminders is 'Moxie-private reminders. Not part of Memphis operational AI context.';
comment on table public.annie_log_suggested_reminders is 'Moxie-private suggested reminders. Not part of Memphis operational AI context.';
comment on table public.annie_suggested_contacts is 'Moxie-private suggested contacts. Not part of Memphis operational AI context.';
