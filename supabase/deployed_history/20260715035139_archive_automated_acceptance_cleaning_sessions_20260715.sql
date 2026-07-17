-- Deployed migration history snapshot: 20260715035139 archive_automated_acceptance_cleaning_sessions_20260715

create table if not exists archive.removed_operational_test_rows (
  archive_id uuid primary key default gen_random_uuid(),
  removal_batch text not null,
  source_table text not null,
  source_id text null,
  row_json jsonb not null,
  archived_at timestamptz not null default now(),
  archived_by text not null default 'approved_foundation_repair'
);

revoke all on table archive.removed_operational_test_rows from public, anon, authenticated;
grant select, insert on table archive.removed_operational_test_rows to service_role;

insert into archive.removed_operational_test_rows(removal_batch,source_table,source_id,row_json)
select 'acceptance_sessions_20260715','public.sessions',s.id::text,to_jsonb(s)
from public.sessions s
where s.id in ('4551d98e-f345-4291-a1c5-8c433b76075f'::uuid,'ed9d88f0-a39e-442c-9469-24c6abed1c3e'::uuid)
and not exists (
  select 1 from archive.removed_operational_test_rows a
  where a.removal_batch='acceptance_sessions_20260715' and a.source_table='public.sessions' and a.source_id=s.id::text
);

insert into archive.removed_operational_test_rows(removal_batch,source_table,source_id,row_json)
select 'acceptance_sessions_20260715','public.completion_responses',cr.id::text,to_jsonb(cr)
from public.completion_responses cr
where cr.session_id in ('4551d98e-f345-4291-a1c5-8c433b76075f'::uuid,'ed9d88f0-a39e-442c-9469-24c6abed1c3e'::uuid)
and not exists (
  select 1 from archive.removed_operational_test_rows a
  where a.removal_batch='acceptance_sessions_20260715' and a.source_table='public.completion_responses' and a.source_id=cr.id::text
);

insert into archive.removed_operational_test_rows(removal_batch,source_table,source_id,row_json)
select 'acceptance_sessions_20260715','public.scan_events',se.id::text,to_jsonb(se)
from public.scan_events se
where se.session_id in ('4551d98e-f345-4291-a1c5-8c433b76075f'::uuid,'ed9d88f0-a39e-442c-9469-24c6abed1c3e'::uuid)
   or se.payload_json->>'session_uuid' in ('e0bd1497-e99d-4927-879f-07ed06324aef','da8a85b1-a64e-4bc3-b15a-761fec01e1f9')
   or se.payload_json->>'client_session_id' in ('bdd55add-2c27-472d-9ab5-1edce3fd2761','ac0b948e-6223-441a-b264-d131900b8819')
on conflict do nothing;

insert into archive.removed_operational_test_rows(removal_batch,source_table,source_id,row_json)
select 'acceptance_sessions_20260715','public.session_events',ev.id::text,to_jsonb(ev)
from public.session_events ev
where ev.session_id in ('4551d98e-f345-4291-a1c5-8c433b76075f'::uuid,'ed9d88f0-a39e-442c-9469-24c6abed1c3e'::uuid)
and not exists (
  select 1 from archive.removed_operational_test_rows a
  where a.removal_batch='acceptance_sessions_20260715' and a.source_table='public.session_events' and a.source_id=ev.id::text
);

insert into archive.removed_operational_test_rows(removal_batch,source_table,source_id,row_json)
select 'acceptance_sessions_20260715','public.maintenance_tickets',mt.id::text,to_jsonb(mt)
from public.maintenance_tickets mt
where mt.session_id in ('4551d98e-f345-4291-a1c5-8c433b76075f'::uuid,'ed9d88f0-a39e-442c-9469-24c6abed1c3e'::uuid)
   or mt.completion_response_id in (
     select id from public.completion_responses
     where session_id in ('4551d98e-f345-4291-a1c5-8c433b76075f'::uuid,'ed9d88f0-a39e-442c-9469-24c6abed1c3e'::uuid)
   )
and not exists (
  select 1 from archive.removed_operational_test_rows a
  where a.removal_batch='acceptance_sessions_20260715' and a.source_table='public.maintenance_tickets' and a.source_id=mt.id::text
);
