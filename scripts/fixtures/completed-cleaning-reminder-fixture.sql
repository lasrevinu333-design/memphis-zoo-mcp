-- Synthetic isolated dependencies, NOT production data or full schema admission.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table public.system_settings(setting_key text primary key,setting_value jsonb not null,description text,updated_at timestamptz not null default now());
create table public.devices(id uuid primary key,device_id text,assigned_employee_id uuid,assignment_epoch bigint,active boolean);
create table public.employees(id uuid primary key,active boolean);
create table public.device_auth_credentials(credential_id uuid primary key,device_id uuid,confirmed_at timestamptz,revoked_at timestamptz,expires_at timestamptz);
create table public.employee_push_registrations(credential_id uuid,employee_id uuid,device_id uuid,assignment_epoch bigint,active boolean,revoked_at timestamptz);
create table public.operational_notification_jobs(job_id uuid primary key default gen_random_uuid(),job_key text not null unique,job_type text,source_id uuid,available_at timestamptz,payload_json jsonb,status text default 'pending',completed_at timestamptz,last_error text,updated_at timestamptz,lease_token uuid,leased_until timestamptz);
create table public.employee_native_push_delivery_receipts(job_id uuid primary key references public.operational_notification_jobs,delivery_state text,provider_message_id text,delivered_at timestamptz);
create table public.device_notification_acknowledgements(device_identifier text,notification_key text,acknowledged_at timestamptz,displayed_at timestamptz,opened_at timestamptz);
create table public.fixture_location_truth(location_id uuid primary key,form_type text,operational_day_start timestamptz,latest_completed_at timestamptz,open_session_status text,status_code text);
create view public.v_location_dashboard_status as select * from public.fixture_location_truth;
create table public.fixture_assignments(service_date date,assigned_employee_id uuid,assignment_status text,coverage_start time,coverage_end time,location_group_id uuid,group_code text,group_name text,location_id uuid,location_code text,location_name text,form_type text);
create function public.custodial_operational_location_assignments(date) returns setof public.fixture_assignments language sql stable as $$select * from public.fixture_assignments where service_date=$1$$;
create function public.sch_service_date(timestamptz) returns date language sql immutable as $$select (($1 at time zone 'America/Chicago')-interval '4 hours')::date$$;
create table public.custodial_release_authority_restore_inventory(restore_order integer unique,object_kind text,object_identity text,definition_sql text,definition_sha256 text,captured_at timestamptz default now(),primary key(object_kind,object_identity));
create function public.fixture_inventory_immutable() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
create trigger trg_custodial_release_authority_restore_inventory_immutable before insert or update or delete on public.custodial_release_authority_restore_inventory for each row execute function public.fixture_inventory_immutable();
create function public.custodial_release_authority_current_grant_definition(text) returns text language sql as $$select format('revoke all on function %s from public,anon,authenticated; grant execute on function %s to postgres,service_role;',$1,$1)$$;
