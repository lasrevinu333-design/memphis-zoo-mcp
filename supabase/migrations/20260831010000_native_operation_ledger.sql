begin;

create table public.native_operation_receipts (
  operation_id text primary key,
  operation_type text not null check (operation_type in ('START','FINISH','SUPPORT_REQUEST')),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  raw_request_bytes bytea not null,
  receipt_bytes bytea not null,
  receipt_sha256 text not null check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_server_digest text not null,
  server_effect_id text not null,
  employee_id uuid not null references public.employees(id),
  device_id uuid not null references public.devices(id),
  credential_epoch bigint not null check (credential_epoch >= 0),
  accepted_at_epoch_ms bigint not null check (accepted_at_epoch_ms > 0),
  created_at timestamptz not null default now(),
  check (octet_length(raw_request_bytes) between 1 and 262144),
  check (octet_length(receipt_bytes) between 1 and 1048576),
  unique (server_effect_id)
);

comment on table public.native_operation_receipts is
  'Immutable canonical receipts for exact-byte native employee operations. Server-only authority.';

create index native_operation_receipts_device_created_idx
  on public.native_operation_receipts(device_id, created_at desc);
create index native_operation_receipts_employee_created_idx
  on public.native_operation_receipts(employee_id, created_at desc);

alter table public.native_operation_receipts enable row level security;
alter table public.native_operation_receipts force row level security;

revoke all on table public.native_operation_receipts from public;
revoke all on table public.native_operation_receipts from anon;
revoke all on table public.native_operation_receipts from authenticated;
grant select, insert on table public.native_operation_receipts to service_role;

create or replace function public.reject_native_operation_receipt_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'native_operation_receipts rows are immutable';
end;
$function$;

revoke all on function public.reject_native_operation_receipt_mutation() from public;
revoke all on function public.reject_native_operation_receipt_mutation() from anon;
revoke all on function public.reject_native_operation_receipt_mutation() from authenticated;

create trigger native_operation_receipts_no_update
before update on public.native_operation_receipts
for each row execute function public.reject_native_operation_receipt_mutation();

create trigger native_operation_receipts_no_delete
before delete on public.native_operation_receipts
for each row execute function public.reject_native_operation_receipt_mutation();

commit;
