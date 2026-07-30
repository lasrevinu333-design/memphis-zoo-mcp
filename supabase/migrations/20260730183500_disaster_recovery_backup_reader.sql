-- Dedicated least-privilege login for the scheduled disaster-recovery snapshot.
-- The password is provisioned separately so credentials never enter migration history.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'memphis_zoo_backup') then
    create role memphis_zoo_backup
      login
      inherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      bypassrls
      connection limit 2;
  else
    alter role memphis_zoo_backup
      login
      inherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      bypassrls
      connection limit 2;
  end if;
end
$$;

grant pg_read_all_data to memphis_zoo_backup;
alter role memphis_zoo_backup set default_transaction_read_only = on;

comment on role memphis_zoo_backup is
  'Read-only, RLS-bypassing login used solely by the encrypted disaster-recovery backup workflow.';
