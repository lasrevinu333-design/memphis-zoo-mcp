-- Deployed migration history snapshot: 20260715035431 isolate_moxie_private_data_from_memphis_clients_20260715

do $do$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array[
    'annie_chat_state',
    'annie_contacts',
    'annie_deliverables',
    'annie_log_notes',
    'annie_log_reminders',
    'annie_log_suggested_reminders',
    'annie_suggested_contacts'
  ]
  loop
    for v_policy in
      select policyname
      from pg_policies
      where schemaname='public' and tablename=v_table
    loop
      execute format('drop policy if exists %I on public.%I',v_policy.policyname,v_table);
    end loop;

    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated',v_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role',v_table);
  end loop;
end
$do$;

comment on table public.annie_chat_state is 'Moxie-private state. Backend service-role access only; Memphis clients and direct browser Supabase access are denied.';
comment on table public.annie_contacts is 'Moxie-private contacts. Backend service-role access only; Memphis clients and direct browser Supabase access are denied.';
comment on table public.annie_deliverables is 'Moxie-private deliverables. Backend service-role access only; Memphis clients and direct browser Supabase access are denied.';
comment on table public.annie_log_notes is 'Moxie-private notes. Backend service-role access only; Memphis clients and direct browser Supabase access are denied.';
comment on table public.annie_log_reminders is 'Moxie-private reminders. Backend service-role access only; Memphis clients and direct browser Supabase access are denied.';
comment on table public.annie_log_suggested_reminders is 'Moxie-private reminder suggestions. Backend service-role access only; Memphis clients and direct browser Supabase access are denied.';
comment on table public.annie_suggested_contacts is 'Moxie-private contact suggestions. Backend service-role access only; Memphis clients and direct browser Supabase access are denied.';
