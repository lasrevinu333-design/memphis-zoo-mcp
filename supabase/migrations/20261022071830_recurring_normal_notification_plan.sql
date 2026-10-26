begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.custodial_release_authority_restore_inventory in exclusive mode;
create temporary table v27_inventory_before on commit drop as table public.custodial_release_authority_restore_inventory;
create temporary table v27_surface_before on commit drop as
 select pg_get_functiondef(oid) definition,proacl acl,proowner owner from pg_proc
 where oid='public.custodial_release_canary_authority_surface()'::regprocedure;
create temporary table v27_inventory_guard_before on commit drop as
 select tgenabled from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
 and tgname='trg_custodial_release_authority_restore_inventory_immutable';
do $predecessor$ begin
 if (select count(*) from v27_inventory_guard_before)<>1 or
  (select tgenabled from v27_inventory_guard_before) not in ('O','A') then
  raise exception 'normal notification plan inventory guard unavailable';end if;
end $predecessor$;

create table public.static_weekly_recurring_notification_plan_reads(
 plan_read_id uuid primary key default gen_random_uuid(),
 service_date date not null,
 device_id uuid not null references public.devices(id) on delete restrict,
 credential_id uuid not null references public.device_auth_credentials(credential_id) on delete restrict,
 employee_id uuid not null references public.employees(id) on delete restrict,
 assignment_epoch bigint not null check(assignment_epoch between 1 and 9007199254740991),
 intent_id uuid not null,target_type text not null check(target_type in ('SCHEDULE','BLOCKED_RECURRING_AUTHORITY')),
 authority_revision bigint not null check(authority_revision between 1 and 9007199254740991),
 target_digest text not null check(target_digest~'^[a-f0-9]{64}$'),rendered_digest text not null check(rendered_digest~'^[a-f0-9]{64}$'),
 backend_principal jsonb not null check(jsonb_typeof(backend_principal)='object'),
 semantic_digest text not null check(semantic_digest~'^[a-f0-9]{64}$'),
 plan_body jsonb not null check(jsonb_typeof(plan_body)='object' and octet_length(plan_body::text)<=196608),
 issued_at timestamptz not null,valid_until timestamptz not null,
 check(isfinite(issued_at) and isfinite(valid_until) and issued_at<valid_until)
);
alter table public.static_weekly_recurring_notification_plan_reads enable row level security;
alter table public.static_weekly_recurring_notification_plan_reads force row level security;
revoke all on public.static_weekly_recurring_notification_plan_reads from public,anon,authenticated,service_role,
 static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
create trigger trg_recurring_notification_plan_reads_immutable before update or delete on public.static_weekly_recurring_notification_plan_reads
 for each row execute function public.static_weekly_reject_update_delete();
alter table public.static_weekly_recurring_notification_plan_reads enable always trigger trg_recurring_notification_plan_reads_immutable;
-- The existing disaster-restore DDL event trigger attaches this fence to
-- new public tables. Verify its exact normal identity/mode; never replace it.
do $actual_restore_fence$ begin
 if (select count(*) from pg_trigger where tgrelid='public.static_weekly_recurring_notification_plan_reads'::regclass
  and tgname='custodial_disaster_restore_mutation_fence' and tgfoid='custodial_dr.guard_application_mutation()'::regprocedure
  and tgenabled in ('O','A') and tgtype=62 and tgnargs=0 and tgqual is null and not tgisinternal)<>1 then
  raise exception 'normal notification plan actual restore fence unavailable';end if;
end $actual_restore_fence$;

-- Transactions that actually change ANY selected plan source retain SHARED
-- custody until commit, including future inserts/deletes/TRUNCATE. This is a
-- lock only: no epoch/history/data writes and no across-HTTP/browser lease.
create function public.static_weekly_v27_notification_plan_source_write_fence()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog as $fence$
begin
 perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('custodial-recurring-normal-plan-source-fence-v1',0));
 return null;
end $fence$;
revoke all on function public.static_weekly_v27_notification_plan_source_write_fence()
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
-- A managed migration role can inherit an extra function EXECUTE default.
-- Strip only the actual nonowner ACL on THIS new private trigger function;
-- keep the fixed revokes above and strict owner-only runtime check unchanged.
-- CASCADE follows only this function's dependent grant chain, never other ACLs.
do $private_fence_acl$
declare f oid:='public.static_weekly_v27_notification_plan_source_write_fence()'::regprocedure;
 owner_id oid;entry record;entries integer;grantees integer;
begin
 select proowner into strict owner_id from pg_proc where oid=f;
 if owner_id<>current_user::regrole then raise exception 'normal notification plan fence owner differs';end if;
 select count(*),count(distinct a.grantee) into entries,grantees
  from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid=f and a.grantee<>owner_id;
 if entries>32 or grantees>16 or exists(
  select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.oid=f and a.grantee<>owner_id and
    (a.privilege_type<>'EXECUTE' or (a.grantee<>0 and not exists(select 1 from pg_roles r where r.oid=a.grantee)))) then
  raise exception 'normal notification plan fence ACL shape unavailable';end if;
 for entry in select a.grantee,a.grantor,a.privilege_type,a.is_grantable,
   case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end grantee_name,
   pg_get_userbyid(a.grantor) grantor_name
  from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid=f and a.grantee<>owner_id order by a.grantee,a.grantor,a.privilege_type loop
  raise notice 'NORMAL_PLAN_PRIVATE_FENCE_REVOKED_ACL %',jsonb_build_object(
   'grantee_oid',entry.grantee,'grantee_name',entry.grantee_name,'grantor_oid',entry.grantor,
   'grantor_name',entry.grantor_name,'privilege',entry.privilege_type,'grantable',entry.is_grantable);
 end loop;
 for entry in select distinct a.grantee,case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end grantee_name
  from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid=f and a.grantee<>owner_id order by a.grantee loop
  if entry.grantee=0 then
   revoke all on function public.static_weekly_v27_notification_plan_source_write_fence() from public cascade;
  else
   execute format('revoke all on function public.static_weekly_v27_notification_plan_source_write_fence() from %I cascade',entry.grantee_name);
  end if;
 end loop;
 if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid=f and a.grantee<>owner_id) then raise exception 'normal notification plan fence retained nonowner ACL';end if;
end $private_fence_acl$;
do $source_triggers$
declare name text;
begin
 foreach name in array array['public.completion_responses','public.coverage_templates','public.custodial_dated_activations','public.custodial_dated_occurrences','public.custodial_dated_publications','public.custodial_employee_device_assignment_history','public.custodial_offline_actor_contexts','public.custodial_offline_reconciliation_records','public.custodial_offline_scan_event_evidence','public.custodial_offline_submission_proofs','public.daily_group_assignments','public.daily_schedule_assignments','public.daily_work_roster','public.device_auth_credentials','public.device_notification_acknowledgements','public.devices','public.employee_native_lunch_dispatch_attempts','public.employee_native_push_delivery_receipts','public.employee_native_push_generations','public.employee_push_registrations','public.employee_shift_templates','public.employees','public.location_group_memberships','public.location_group_workload_settings','public.location_groups','public.locations','public.msg_device_assignments','public.msg_users','public.operating_hours','public.operational_notification_jobs','public.sessions','public.static_weekly_authority_source_documents','public.static_weekly_contractor_capacity_registrations','public.static_weekly_recurring_application_intents','public.static_weekly_recurring_application_receipts','public.static_weekly_recurring_invalidations','public.static_weekly_recurring_publication_bindings','public.static_weekly_recurring_terminal_intents','public.static_weekly_recurring_terminal_receipts','public.static_weekly_staffing_absence_cancellations','public.static_weekly_staffing_absences','public.system_settings','public.weekly_roster_slot_incumbencies','public.weekly_roster_slot_incumbency_closures','public.weekly_roster_slot_staffing_states','public.weekly_roster_slots','public.weekly_schedule_command_receipts','public.weekly_schedule_compiled_projections','public.weekly_schedule_exception_commands','public.weekly_schedule_lunch_documents','public.weekly_schedule_occurrences','public.weekly_schedule_publications','public.weekly_schedule_versions']::text[] loop
  if to_regclass(name) is null then raise exception 'normal notification plan source missing: %',name;end if;
  execute format('create trigger custodial_recurring_notification_plan_source_fence before insert or update or delete or truncate on %s for each statement execute function public.static_weekly_v27_notification_plan_source_write_fence()',name);
  execute format('alter table %s enable always trigger custodial_recurring_notification_plan_source_fence',name);
 end loop;
end $source_triggers$;

-- No lock upgrade or blocking source/authority/principal wait under exclusive.
-- Opposite-order ordinary writers are admitted only after this short SQL RPC
-- releases; any pre-existing writer or explicit row lock causes refusal.
create function public.static_weekly_v27_lock_notification_plan_sources()
returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $locks$
declare name text;t record;
begin
 perform public.custodial_begin_application_mutation(); -- Existing DR SHARED, before source-exclusive.
 if not exists(select 1 from pg_proc p where p.oid='public.static_weekly_v27_notification_plan_source_write_fence()'::regprocedure
  and p.prosecdef and p.provolatile='v' and p.prorettype='trigger'::regtype and p.proowner=current_user::regrole
  and p.proconfig=array['search_path=pg_catalog'] and p.prosrc=$guard_source$
begin
 perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('custodial-recurring-normal-plan-source-fence-v1',0));
 return null;
end $guard_source$
  and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner)) then
  raise exception 'normal notification plan source fence implementation unavailable' using errcode='55000',
   detail=(select jsonb_build_object(
    'diagnostic_schema','custodial.normal-plan-source-fence-predicates.v1',
    'owner_matches_current',p.proowner=current_user::regrole,
    'owner',pg_get_userbyid(p.proowner),'current_user',current_user,
    'security_definer',p.prosecdef,'volatile',p.provolatile='v','returns_trigger',p.prorettype='trigger'::regtype,
    'config_matches',p.proconfig=array['search_path=pg_catalog'],
    'config_count',coalesce(cardinality(p.proconfig),0),
    'body_matches',p.prosrc=$diagnostic_guard_source$
begin
 perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('custodial-recurring-normal-plan-source-fence-v1',0));
 return null;
end $diagnostic_guard_source$,
    'body_md5',md5(p.prosrc),'body_bytes',octet_length(p.prosrc),
    'nonowner_acl_count',(select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner),
    'acl_count',(select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))
   )::text from pg_proc p where p.oid='public.static_weekly_v27_notification_plan_source_write_fence()'::regprocedure);end if;
 -- These auxiliary old-v24 propagation sources are not full-plan sources.
 -- Pre-admit their relation modes without waiting, BEFORE source-exclusive.
 -- SRE excludes old v10 INSERT/UPDATE transactions; it does not exclude pure
 -- SELECT FOR UPDATE. Exact intent/FK rows are separately SHARE NOWAIT below.
 lock table only public.static_weekly_schedule_application_intents,
  public.static_weekly_schedule_application_receipts,public.static_weekly_staffing_commands
  in share row exclusive mode nowait;
 foreach name in array array['public.completion_responses','public.coverage_templates','public.custodial_dated_activations','public.custodial_dated_occurrences','public.custodial_dated_publications','public.custodial_employee_device_assignment_history','public.custodial_offline_actor_contexts','public.custodial_offline_reconciliation_records','public.custodial_offline_scan_event_evidence','public.custodial_offline_submission_proofs','public.daily_group_assignments','public.daily_schedule_assignments','public.daily_work_roster','public.device_auth_credentials','public.device_notification_acknowledgements','public.devices','public.employee_native_lunch_dispatch_attempts','public.employee_native_push_delivery_receipts','public.employee_native_push_generations','public.employee_push_registrations','public.employee_shift_templates','public.employees','public.location_group_memberships','public.location_group_workload_settings','public.location_groups','public.locations','public.msg_device_assignments','public.msg_users','public.operating_hours','public.operational_notification_jobs','public.sessions','public.static_weekly_authority_source_documents','public.static_weekly_contractor_capacity_registrations','public.static_weekly_recurring_application_intents','public.static_weekly_recurring_application_receipts','public.static_weekly_recurring_invalidations','public.static_weekly_recurring_publication_bindings','public.static_weekly_recurring_terminal_intents','public.static_weekly_recurring_terminal_receipts','public.static_weekly_staffing_absence_cancellations','public.static_weekly_staffing_absences','public.system_settings','public.weekly_roster_slot_incumbencies','public.weekly_roster_slot_incumbency_closures','public.weekly_roster_slot_staffing_states','public.weekly_roster_slots','public.weekly_schedule_command_receipts','public.weekly_schedule_compiled_projections','public.weekly_schedule_exception_commands','public.weekly_schedule_lunch_documents','public.weekly_schedule_occurrences','public.weekly_schedule_publications','public.weekly_schedule_versions']::text[] loop
  execute format('lock table only %s in row exclusive mode nowait',name);
  select g.tgtype,g.tgenabled,g.tgfoid,g.tgqual,g.tgnargs,g.tgisinternal into t
   from pg_trigger g where g.tgrelid=to_regclass(name) and g.tgname='custodial_recurring_notification_plan_source_fence';
  if not found or t.tgtype<>62 or t.tgenabled<>'A' or t.tgisinternal or t.tgqual is not null or t.tgnargs<>0
   or t.tgfoid<>'public.static_weekly_v27_notification_plan_source_write_fence()'::regprocedure then
   raise exception 'normal notification plan source fence unavailable' using errcode='55000';end if;
 end loop;
 if not pg_try_advisory_xact_lock(hashtextextended('custodial-recurring-normal-plan-source-fence-v1',0)) then
  raise exception 'normal notification plan source busy' using errcode='40001';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0)) then
  raise exception 'normal notification plan authority busy' using errcode='40001';end if;
end $locks$;
revoke all on function public.static_weekly_v27_lock_notification_plan_sources()
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

create function public.static_weekly_v27_notification_plan_backend_principal(p_device uuid,p_credential uuid,p_employee uuid,p_epoch bigint)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $principal$
declare d public.devices%rowtype;c public.device_auth_credentials%rowtype;e public.employees%rowtype;
begin
 select * into strict d from public.devices where id=p_device for share nowait;
 select * into strict c from public.device_auth_credentials where credential_id=p_credential for share nowait;
 select * into strict e from public.employees where id=p_employee for share nowait;
 if d.active is not true or e.active is not true or d.assigned_employee_id is distinct from p_employee
  or d.assignment_epoch is distinct from p_epoch or c.device_id is distinct from p_device
  or c.confirmed_at is null or c.revoked_at is not null or c.expires_at<=clock_timestamp() then
  raise exception 'current notification plan backend principal required' using errcode='42501';end if;
 return jsonb_build_object('binding_scope','EXACT_BACKEND_CREDENTIAL_DEVICE_EMPLOYEE_EPOCH_CONFIRMATION_NOT_NATIVE_INSTALLATION_IDENTITY',
  'device_pk',d.id,'canonical_device_id',d.device_id,'employee_id',e.id,'credential_id',c.credential_id,'assignment_epoch',d.assignment_epoch::text,
  'credential_created_at',c.created_at,'credential_confirmed_at',c.confirmed_at,'credential_expires_at',c.expires_at,
  'credential_metadata_digest',public.static_weekly_digest_jsonb(c.metadata_json));
end $principal$;
revoke all on function public.static_weekly_v27_notification_plan_backend_principal(uuid,uuid,uuid,bigint)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

-- Read-only, target-bound complete CURRENT requirements. This neither enqueues
-- nor reserves/sends any job. Future intent descriptors are retained separately;
-- a finite sample/current poll is never represented as complete future history.
-- Read ONLY an existing immutable native original reservation. This never
-- reserves, leases, sends, creates a job, adopts unknown history or exports the
-- native payload/receipt secret/FCM token. Caller already owns the exact53-source
-- short transaction fence. Business live helpers are read-only MVCC predicates.
create function public.static_weekly_v27_original_native_bindings(p_body jsonb,p_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $bindings$
declare effect jsonb;normal_data jsonb;payload jsonb;entry jsonb;entries jsonb:='[]'::jsonb;
 original record;matches integer;kind text;field text;fields text[];seen text[]:='{}'::text[];counted integer:=0;
 unavailable jsonb:=jsonb_build_object('schema','custodial.recurring-original-native-delivery-bindings.v1','state','UNAVAILABLE','entries','[]'::jsonb);
begin
 if p_at is null or not isfinite(p_at) or jsonb_typeof(p_body->'required_effects') is distinct from 'array'
  or jsonb_array_length(p_body->'required_effects') not between 1 and 1024 then return unavailable;end if;
 for effect in select value from jsonb_array_elements(p_body->'required_effects') loop
  counted:=counted+1;normal_data:=case effect->>'origin' when 'FULL_ACCEPTED_LUNCH_DOCUMENT' then effect#>'{notification,data}'
   when 'EXHAUSTIVE_NORMAL_CURRENT_LOCATION_CYCLES' then effect->'data' else null end;
  kind:=normal_data->>'kind';
  if kind not in ('employee_lunch_coverage','employee_location_status') or kind is null
   or effect->>'notification_key' is null or effect->>'notification_key'=any(seen)
   or normal_data->>'notification_key' is distinct from effect->>'notification_key'
   or normal_data->>'service_date' is distinct from p_body->>'service_date'
   or normal_data->>'receipt_employee_id' is distinct from p_body->>'employee_id'
   or normal_data->>'receipt_credential_id' is distinct from p_body->>'credential_id'
   or normal_data->>'receipt_device_id' is distinct from p_body->>'canonical_device_id'
   or normal_data->>'receipt_assignment_epoch' is distinct from p_body->>'assignment_epoch' then return unavailable;end if;
  seen:=array_append(seen,effect->>'notification_key');matches:=0;
  for original in
   select receipt.*,generation.principal_digest as original_principal_digest
   from public.employee_native_push_delivery_receipts receipt
   join public.operational_notification_jobs job on job.job_id=receipt.job_id and job.job_key=receipt.job_key
   join public.employee_native_push_generations generation on generation.generation_id=receipt.native_generation_id
    and generation.registration_id=receipt.registration_id
   join public.employee_push_registrations registration on registration.registration_id=generation.registration_id
   where receipt.credential_id=(p_body->>'credential_id')::uuid and receipt.assignment_epoch=(p_body->>'assignment_epoch')::bigint
    and generation.device_id=(p_body->>'device_pk')::uuid and generation.credential_id=receipt.credential_id
    and generation.employee_id=(p_body->>'employee_id')::uuid and generation.assignment_epoch=receipt.assignment_epoch
    and generation.device_identifier=p_body->>'canonical_device_id' and generation.revoked_at is null
    and generation.activated_at<=receipt.prepared_at
    and (generation.dispatch_retired_at is null or receipt.prepared_at<=generation.dispatch_retired_at)
    and registration.device_id=generation.device_id and registration.credential_id=generation.credential_id
    and registration.employee_id=generation.employee_id and registration.assignment_epoch=generation.assignment_epoch
    and registration.platform='android' and registration.provider='fcm'
    and job.job_type='employee_native_push' and job.payload_json#>'{data_json,test_delivery}' is null
    and job.payload_json#>>'{data_json,kind}'=kind
    and job.payload_json->>'credential_id'=p_body->>'credential_id'
    and job.payload_json->>'employee_id'=p_body->>'employee_id'
    and job.payload_json->>'device_id'=p_body->>'device_pk'
    and job.payload_json->>'device_identifier'=p_body->>'canonical_device_id'
    and job.payload_json->>'assignment_epoch'=p_body->>'assignment_epoch'
    and receipt.native_payload is not null and receipt.native_payload_sha256~'^[a-f0-9]{64}$'
    and receipt.native_valid_until>p_at and receipt.prepared_at<=p_at
    and receipt.native_payload->>'notification_key'=effect->>'notification_key'
    and receipt.native_payload->>'kind'=kind and receipt.native_payload->>'service_date'=p_body->>'service_date'
    and receipt.native_payload->>'receipt_employee_id'=p_body->>'employee_id'
    and receipt.native_payload->>'receipt_credential_id'=p_body->>'credential_id'
    and receipt.native_payload->>'receipt_device_id'=p_body->>'canonical_device_id'
    and receipt.native_payload->>'receipt_assignment_epoch'=p_body->>'assignment_epoch'
    and receipt.native_payload->>'receipt_job_id'=receipt.job_id::text
    and receipt.native_payload->>'generation_id'=generation.generation_id::text
    and receipt.native_payload->>'principal_digest'=generation.principal_digest
    and receipt.native_payload->>'token_digest'=generation.token_digest and receipt.token_hash=generation.token_digest
    and receipt.native_payload->>'content_sha256'=receipt.native_payload_sha256
    and receipt.native_payload_sha256=public.static_weekly_digest_text(public.custodial_native_location_canonical(receipt.native_payload-'content_sha256'))
    and receipt.native_payload->>'reservation_at'=public.custodial_native_location_utc(receipt.prepared_at)
    and receipt.native_payload->>'valid_until'=public.custodial_native_location_utc(receipt.native_valid_until)
    and octet_length(public.custodial_native_location_canonical(receipt.native_payload))<=3500
    and case kind when 'employee_lunch_coverage' then
     exists(select 1 from public.employee_native_lunch_dispatch_attempts attempt where attempt.job_id=receipt.job_id)
      and public.custodial_native_lunch_live(receipt.job_id,receipt.native_payload,p_at)
     else public.custodial_native_location_live(receipt.job_id,receipt.native_payload,p_at) end
   order by receipt.job_id limit 2 loop
   matches:=matches+1;payload:=original.native_payload;
   -- Do not equate native location spoken words with normal renderer wording.
   -- Bind the original native audio source separately, but require exact
   -- nonsecret semantic key/principal/current accepted source correspondence.
   fields:=case kind when 'employee_lunch_coverage' then
    array['notification_key','kind','service_date','loan_id','event','scheduled_time','scheduled_at','coverer_slot_id','projection_id','document_identity','route']
    else array['notification_key','kind','service_date','location_id','location_code','location_name','form_type','group_code','group_name','status_code','projection_id','publication_id'] end;
   foreach field in array fields loop
    if payload->>field is distinct from normal_data->>field then return unavailable;end if;
   end loop;
   entry:=jsonb_build_object('notification_key',payload->>'notification_key','receipt_job_id',original.job_id::text,
    'generation_id',original.native_generation_id::text,'registration_id',original.registration_id::text,
    'principal_digest',original.original_principal_digest,'token_digest',original.token_hash,
    'reservation_at',public.custodial_native_location_utc(original.prepared_at),
    'valid_until',public.custodial_native_location_utc(original.native_valid_until),'content_sha256',original.native_payload_sha256,
    'native_kind',kind,'audio_origin','ORIGINAL_NATIVE_JOB','speech_sha256',public.static_weekly_digest_text(payload->>'body'));
  end loop;
  if matches<>1 then return unavailable;end if;
  entries:=entries||jsonb_build_array(entry);
 end loop;
 if counted<>jsonb_array_length(entries) then return unavailable;end if;
 entry:=jsonb_build_object('schema','custodial.recurring-original-native-delivery-bindings.v1','state','ORIGINAL_NATIVE_RESERVATIONS','entries',entries);
 if octet_length(entry::text)>196608 then raise exception 'original native binding bound exceeded' using errcode='54000';end if;
 return entry;
end $bindings$;
revoke all on function public.static_weekly_v27_original_native_bindings(jsonb,timestamptz)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
-- Strip inherited EXECUTE only on this NEW private helper, never a global ACL.
do $private_bindings_acl$
declare f oid:='public.static_weekly_v27_original_native_bindings(jsonb,timestamptz)'::regprocedure;owner_id oid;entry record;n integer;
begin
 select proowner into strict owner_id from pg_proc where oid=f;
 if owner_id<>current_user::regrole then raise exception 'original native binding helper owner differs';end if;
 select count(*) into n from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=f and a.grantee<>owner_id;
 if n>32 then raise exception 'original native binding ACL bound unavailable';end if;
 for entry in select distinct a.grantee from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=f and a.grantee<>owner_id loop
  if entry.grantee=0 then revoke all on function public.static_weekly_v27_original_native_bindings(jsonb,timestamptz) from public cascade;
  else execute format('revoke all on function public.static_weekly_v27_original_native_bindings(jsonb,timestamptz) from %I cascade',pg_get_userbyid(entry.grantee));end if;
 end loop;
 if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=f and a.grantee<>owner_id)then
  raise exception 'original native binding helper retained nonowner ACL';end if;
end $private_bindings_acl$;

create function public.static_weekly_v27_notification_plan_at(
 p_date date,p_device uuid,p_credential uuid,p_employee uuid,p_epoch bigint,p_intent uuid,p_target_digest text,p_at timestamptz
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public as $fn$
declare
 at_time timestamptz:=p_at; delivery jsonb; target jsonb; a record;
 doc public.weekly_schedule_lunch_documents%rowtype; projection public.weekly_schedule_compiled_projections%rowtype;
 device public.devices%rowtype; person public.employees%rowtype; roster public.daily_work_roster%rowtype;
 n jsonb; loan jsonb; mapped jsonb; availability jsonb; candidate record; item jsonb;
 all_intents jsonb:='[]'; effects jsonb:='[]'; audio jsonb:='[]';
 expected jsonb; body jsonb; wire text; notification_state jsonb;
 scheduled timestamptz; ends_at timestamptz; expires timestamptz; boundary timestamptz;
 matches integer; total_intents integer:=0; total_locations integer:=0;
 role_name text; override_enabled boolean; silent boolean; reason text; kind text;
begin
 if at_time is null or not isfinite(at_time) or p_date is null or p_date is distinct from public.sch_service_date(at_time)
  or p_intent is null or coalesce(p_target_digest,'')!~'^[a-f0-9]{64}$'
  or p_epoch is null or p_epoch<1 or p_epoch>9007199254740991 then
  raise exception 'exact current recurring notification plan principal required' using errcode='22023';end if;
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 select * into strict device from public.devices where id=p_device;
 select * into strict person from public.employees where id=p_employee and active=true;
 if not exists(select 1 from public.device_auth_credentials c where c.credential_id=p_credential and c.device_id=p_device
  and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>at_time) then
  raise exception 'current notification plan credential expired' using errcode='42501';end if;
 delivery:=public.static_weekly_v22_read_recurring_application_target(p_date,p_device,p_credential,p_employee,p_epoch);
 target:=delivery->'target';
 if delivery->>'intentId' is distinct from p_intent::text or delivery->>'targetDigest' is distinct from p_target_digest
  or target->>'serviceDate' is distinct from p_date::text then
  raise exception 'recurring notification plan target superseded' using errcode='40001';end if;
 expires:=(p_date+1)::timestamp at time zone 'America/Chicago';
 select * into strict a from public.static_weekly_v6_schedule_authority_state(p_date);
 if target->>'targetType'='BLOCKED_RECURRING_AUTHORITY' then
  if a.projection_status is distinct from 'blocked_recurring_authority' then
   raise exception 'terminal notification plan authority differs' using errcode='40001';end if;
  kind:='AUTHENTICATED_BLOCKED_TARGET';
 elsif target->>'targetType'='SCHEDULE' then
  if a.projection_status is distinct from 'current' or a.projection_id::text is distinct from target->>'projectionId'
   or a.publication_id::text is distinct from target->>'publicationId'
   or a.projection_authority_revision::text is distinct from target->>'authorityRevision' then
   raise exception 'notification plan accepted authority differs' using errcode='40001';end if;
  select * into strict doc from public.weekly_schedule_lunch_documents where projection_id=a.projection_id;
  select * into strict projection from public.weekly_schedule_compiled_projections where projection_id=a.projection_id;
  if doc.document_identity is distinct from target->>'lunchDocumentIdentity' then
   raise exception 'notification plan lunch companion differs' using errcode='23514';end if;
  if jsonb_array_length(doc.document_json->'notification_intents')>16384
   or jsonb_array_length(doc.document_json->'responsibilities')>16384 then
   raise exception 'complete notification plan source bound exceeded' using errcode='54000';end if;
  perform public.static_weekly_v8_assert_lunch_document(doc.projection_id,doc.document_json);
  -- Exactly the normal device notification shift/override policy. A mapping
  -- role is observed from the same active normal device-user source, not from
  -- caller metadata or an inferred employee label.
  select lower(coalesce(mu.role,'')) into role_name from public.msg_device_assignments mda
   join public.msg_users mu on mu.id=mda.msg_user_id
   where mda.device_identifier=device.device_id and mda.is_active=true and mu.is_active=true
   order by mda.updated_at desc nulls last,mda.created_at desc nulls last limit 1;
  select * into roster from public.daily_work_roster r where r.service_date=p_date and r.employee_id=p_employee and r.active=true
   order by r.updated_at desc nulls last,r.created_at desc nulls last limit 1;
  select coalesce(setting_value='true'::jsonb,false) into override_enabled from public.system_settings
   where setting_key='off_shift_employee_notifications_override_enabled';
  override_enabled:=coalesce(override_enabled,false);
  if coalesce(role_name,'') in ('manager','bot','ops','ops_manager','operations_manager') then silent:=false;reason:='not_employee_device';
  elsif override_enabled then silent:=false;reason:='admin_overtime_override_enabled';
  elsif roster.id is null then silent:=true;reason:='no_active_roster_shift';
  elsif roster.shift_start is null or roster.shift_end is null then silent:=true;reason:='invalid_roster_shift_window';
  elsif (at_time at time zone 'America/Chicago') < p_date+roster.shift_start then silent:=true;reason:='scheduled_shift_not_started';
  elsif (at_time at time zone 'America/Chicago') >= p_date+roster.shift_end then silent:=true;reason:='scheduled_shift_ended';
  else silent:=false;reason:='on_shift';end if;
  notification_state:=jsonb_build_object('notifications_silent',silent,'silent_reason',reason,'override_enabled',override_enabled);
  foreach boundary in array array[(p_date+roster.shift_start) at time zone 'America/Chicago',(p_date+roster.shift_end) at time zone 'America/Chicago'] loop
   if boundary>at_time then expires:=least(expires,boundary);end if;
  end loop;
  -- Validate the whole accepted document before selecting this recipient. No
  -- truncated page or pre-existing job list can hide a required accepted intent.
  for n in select ni.value from jsonb_array_elements(doc.document_json->'notification_intents') ni(value)
   where ni.value->>'service_date'=p_date::text and exists(
    select 1 from jsonb_array_elements(doc.document_json->'responsibilities') rr(value)
     where rr.value->>'loan_id'=ni.value->>'loan_id' and rr.value->>'coverer_slot_id'=ni.value->>'coverer_slot_id'
      and rr.value->>'coverer_person_id'=p_employee::text)
   order by ni.value->>'scheduled_time',ni.value->>'notification_key' loop
   total_intents:=total_intents+1;if total_intents>1024 then raise exception 'complete notification plan bound exceeded' using errcode='54000';end if;
   select value into strict loan from jsonb_array_elements(doc.document_json->'loans') value
    where value->>'loan_id'=n->>'loan_id' and value->>'status'='PLANNED';
   select count(*) into matches from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') value
    where value->>'serviceDate'=p_date::text and value->>'slotId'=n->>'coverer_slot_id'
     and value->>'incumbentPersonId'=p_employee::text and value->>'status'='working';
   if matches<>1 then raise exception 'notification plan recipient availability ambiguous' using errcode='23514';end if;
   select value into strict availability from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') value
    where value->>'serviceDate'=p_date::text and value->>'slotId'=n->>'coverer_slot_id'
     and value->>'incumbentPersonId'=p_employee::text and value->>'status'='working';
   scheduled:=(p_date+(n->>'scheduled_time')::time) at time zone 'America/Chicago';
   ends_at:=(p_date+(case when n->>'event'='start' then loan->>'coverage_end' else availability#>>'{shift,end}' end)::time) at time zone 'America/Chicago';
   if ends_at is null or ends_at<=scheduled or n->>'event' not in ('start','end') then
    raise exception 'notification plan accepted interval unsupported' using errcode='23514';end if;
   if scheduled>at_time then expires:=least(expires,scheduled);end if;
   if ends_at>at_time then expires:=least(expires,ends_at);end if;
   all_intents:=all_intents||jsonb_build_array(jsonb_build_object('intent',n,'valid_from',public.custodial_native_location_utc(scheduled),
    'valid_until',public.custodial_native_location_utc(ends_at)));
   if not silent and scheduled<=at_time and at_time<ends_at and not exists(
    select 1 from public.device_notification_acknowledgements ack where upper(btrim(ack.device_identifier))=upper(btrim(device.device_id))
     and ack.notification_key=n->>'notification_key' and ack.credential_id=p_credential and ack.assignment_epoch=p_epoch
     and ack.employee_id=p_employee and ack.acknowledged_at is not null) then
    expected:=jsonb_build_object('kind','employee_lunch_coverage','notification_type','lunch_coverage',
     'notification_key',n->>'notification_key','service_date',p_date,'loan_id',n->>'loan_id','event',n->>'event',
     'scheduled_time',n->>'scheduled_time','scheduled_at',public.custodial_native_location_utc(scheduled),
     'valid_until',public.custodial_native_location_utc(ends_at),'coverer_slot_id',n->>'coverer_slot_id',
     'projection_id',a.projection_id,'document_identity',doc.document_identity,
     'receipt_employee_id',p_employee,'receipt_credential_id',p_credential,'receipt_device_id',device.device_id,'receipt_assignment_epoch',p_epoch::text,
     'route','employee-schedule.html?hub=employee');
    item:=jsonb_build_object('origin','FULL_ACCEPTED_LUNCH_DOCUMENT','notification_key',n->>'notification_key',
     'notification',jsonb_build_object('title',case n->>'event' when 'start' then 'Lunch coverage starts now' else 'Lunch coverage ended' end,
      'body',public.custodial_native_lunch_spoken_body(a.projection_id,doc.document_identity,n->>'loan_id',p_employee,n->>'event'),
      'data',expected),'required_audio',true);
    effects:=effects||jsonb_build_array(item);audio:=audio||jsonb_build_array(n->>'notification_key');
   end if;
  end loop;
  -- The same normal operational assignment + cycle source as the reminder
  -- route, but exhaustive for this exact employee/current accepted projection.
  -- No LIMIT: overflow refuses the WHOLE observation instead of empty/subset.
  for candidate in
   select distinct on (assignment.location_id) assignment.*,cycle.notification_key as cycle_key,
    cycle.status_code,cycle.due_soon_at,cycle.overdue_at
   from public.custodial_operational_location_assignments(p_date) assignment
   left join public.mz_location_reminder_candidates(p_date,at_time) cycle on cycle.location_id=assignment.location_id
   where assignment.assigned_employee_id=p_employee and assignment.assignment_status='ASSIGNED'
    and assignment.projection_status='current' and assignment.projection_id=a.projection_id
    and assignment.coverage_start <= (at_time at time zone 'America/Chicago')::time
    and (at_time at time zone 'America/Chicago')::time < assignment.coverage_end
   order by assignment.location_id,assignment.coverage_start,assignment.group_name,assignment.group_code loop
   total_locations:=total_locations+1;if total_locations>1024 then raise exception 'complete notification plan bound exceeded' using errcode='54000';end if;
   boundary:=(p_date+candidate.coverage_end) at time zone 'America/Chicago';if boundary>at_time then expires:=least(expires,boundary);end if;
   if candidate.due_soon_at>at_time then expires:=least(expires,candidate.due_soon_at);end if;
   if candidate.overdue_at>at_time then expires:=least(expires,candidate.overdue_at);end if;
   if not silent and candidate.status_code in ('due_soon','overdue') and not exists(
    select 1 from public.device_notification_acknowledgements ack where upper(btrim(ack.device_identifier))=upper(btrim(device.device_id))
     and ack.notification_key=candidate.cycle_key||':projection:'||a.projection_id::text and ack.credential_id=p_credential
     and ack.assignment_epoch=p_epoch and ack.employee_id=p_employee and ack.acknowledged_at is not null) then
    expected:=jsonb_build_object('kind','employee_location_status','notification_type','location_status',
     'notification_key',candidate.cycle_key||':projection:'||a.projection_id::text,'service_date',p_date,
     'device_id',device.device_id,'employee_id',p_employee,'employee_name',person.display_name,
     'projection_id',a.projection_id,'publication_id',a.publication_id,'schedule_authority_revision',a.projection_authority_revision::text,
     'location_id',candidate.location_id,'location_code',candidate.location_code,'location_name',candidate.location_name,
     'group_code',candidate.group_code,'group_name',candidate.group_name,'form_type',candidate.form_type,'status_code',candidate.status_code,
     'receipt_employee_id',p_employee,'receipt_credential_id',p_credential,'receipt_device_id',device.device_id,'receipt_assignment_epoch',p_epoch::text);
    effects:=effects||jsonb_build_array(jsonb_build_object('origin','EXHAUSTIVE_NORMAL_CURRENT_LOCATION_CYCLES',
     'notification_key',expected->>'notification_key','data',expected,'required_audio',true));
    audio:=audio||jsonb_build_array(expected->>'notification_key');
   end if;
  end loop;
  -- The ordinary candidate function omits not-yet-due rows. Sample the SAME
  -- underlying verified normal cycle for expiry only, so empty coverage cannot
  -- cross a first due threshold or the existing five-minute overdue repeat.
  select min(b.x) into boundary from public.custodial_operational_location_assignments(p_date) assignment
   join public.v_location_dashboard_status status on status.location_id=assignment.location_id
   cross join lateral public.mz_verified_location_reminder_cycle(status.location_id,status.form_type,status.latest_completed_at,
    public.mz_latest_verified_check(status.location_id,status.operational_day_start,at_time),at_time) cycle
   cross join lateral (values (cycle.due_soon_at),(cycle.overdue_at),
    (case when cycle.overdue_at<=at_time then cycle.overdue_at+make_interval(secs=>((cycle.repeat_index+1)*300)::double precision) else null end)) b(x)
   where assignment.assigned_employee_id=p_employee and assignment.assignment_status='ASSIGNED'
    and assignment.projection_status='current' and assignment.projection_id=a.projection_id
    and status.latest_completed_at>=status.operational_day_start and b.x>at_time;
  if boundary is not null then expires:=least(expires,boundary);end if;
  -- Include ALL future normal assignment boundaries, including locations not
  -- active in the loop above. Otherwise a currently-empty plan could outlive
  -- the next accepted work window and pretend no future transition exists.
  select min(x) into boundary from public.custodial_operational_location_assignments(p_date) assignment
   cross join lateral (values ((p_date+assignment.coverage_start) at time zone 'America/Chicago'),
    ((p_date+assignment.coverage_end) at time zone 'America/Chicago')) b(x)
   where assignment.assigned_employee_id=p_employee and assignment.assignment_status='ASSIGNED'
    and assignment.projection_status='current' and assignment.projection_id=a.projection_id and x>at_time;
  if boundary is not null then expires:=least(expires,boundary);end if;
  kind:='FULL_ACCEPTED_LUNCH_AND_EXHAUSTIVE_CURRENT_LOCATION_DERIVATION';
 else raise exception 'unsupported recurring notification plan target' using errcode='22023';end if;
 if expires<=at_time or jsonb_array_length(effects)>1024 then raise exception 'complete notification plan time/bound unsupported' using errcode='54000';end if;
 body:=jsonb_build_object('schema','custodial.recurring-current-notification-plan.v1','complete',true,'receipt_eligible',false,
  'scope','CURRENT_PRESENTATION_AND_FULL_EFFECTS_REQUIRED_BY_ACCEPTED_TARGET_NOT_FUTURE_ALARM_INVENTORY',
  'source',kind,'service_date',p_date,'intent_id',p_intent,'target_digest',p_target_digest,'target',target,
  'rendered_digest',case when target->>'targetType'='SCHEDULE' then target->>'viewDigest' else p_target_digest end,
  'device_pk',p_device,'canonical_device_id',device.device_id,'employee_id',p_employee,'credential_id',p_credential,'assignment_epoch',p_epoch::text,
  'observed_at',public.custodial_native_location_utc(at_time),'valid_until',public.custodial_native_location_utc(expires),
  'notification_state',coalesce(notification_state,jsonb_build_object('notifications_silent',true,'silent_reason','blocked_recurring_authority','override_enabled',false)),
  'accepted_lunch_intents',all_intents,'required_effects',effects,'required_audio',audio,
  'source_counts',jsonb_build_object('accepted_lunch_intents',total_intents,'current_assigned_locations',total_locations));
 -- EMPTY/BLOCKED v1 stays byte-contract compatible. Nonempty v2 MUST carry
 -- an explicit original-binding state; missing history is never empty proof.
 if jsonb_array_length(effects)>0 then
  body:=body||jsonb_build_object('schema','custodial.recurring-current-notification-plan.v2',
   'delivery_bindings',public.static_weekly_v27_original_native_bindings(body,at_time));
  if body#>>'{delivery_bindings,state}'='ORIGINAL_NATIVE_RESERVATIONS' then
   select min((value->>'valid_until')::timestamptz) into boundary
    from jsonb_array_elements(body#>'{delivery_bindings,entries}');
   expires:=least(expires,boundary);
   body:=jsonb_set(body,'{valid_until}',to_jsonb(public.custodial_native_location_utc(expires)));
  end if;
 end if;
 wire:=body::text;if octet_length(wire)>196608 then raise exception 'complete notification plan byte bound exceeded' using errcode='54000';end if;
 return jsonb_build_object('schema',case body->>'schema' when 'custodial.recurring-current-notification-plan.v2' then 'custodial.recurring-current-notification-plan-envelope.v2' else 'custodial.recurring-current-notification-plan-envelope.v1' end,'body',body,
  'bodyJsonText',wire,'bodyDigest',public.static_weekly_digest_text(wire));
end $fn$;

revoke all on function public.static_weekly_v27_notification_plan_at(date,uuid,uuid,uuid,bigint,uuid,text,timestamptz)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

create function public.static_weekly_v27_issue_recurring_notification_plan(
 p_date date,p_device uuid,p_credential uuid,p_employee uuid,p_epoch bigint,p_intent uuid,p_target_digest text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $issue$
declare envelope jsonb;body jsonb;principal jsonb;semantic text;wire text;token uuid:=gen_random_uuid();issued timestamptz;until_time timestamptz;
begin
 perform public.static_weekly_v27_lock_notification_plan_sources();
 principal:=public.static_weekly_v27_notification_plan_backend_principal(p_device,p_credential,p_employee,p_epoch);
 issued:=clock_timestamp();
 envelope:=public.static_weekly_v27_notification_plan_at(p_date,p_device,p_credential,p_employee,p_epoch,p_intent,p_target_digest,issued);
 body:=envelope->'body';until_time:=least((body->>'valid_until')::timestamptz,(principal->>'credential_expires_at')::timestamptz);
 body:=jsonb_set(body,'{valid_until}',to_jsonb(public.custodial_native_location_utc(until_time)))
  ||jsonb_build_object('backend_principal_digest',public.static_weekly_digest_jsonb(principal));
 semantic:=public.static_weekly_digest_jsonb(body-'observed_at');
 body:=body||jsonb_build_object('plan_read_id',token,'semantic_digest',semantic);
 if until_time<=clock_timestamp() then raise exception 'normal notification plan expired while issuing' using errcode='40001';end if;
 if (select count(*) from public.static_weekly_recurring_notification_plan_reads where service_date=p_date and credential_id=p_credential)>=16384 then
  raise exception 'normal notification plan daily read bound exceeded' using errcode='54000';end if;
 insert into public.static_weekly_recurring_notification_plan_reads(plan_read_id,service_date,device_id,credential_id,employee_id,assignment_epoch,
  intent_id,target_type,authority_revision,target_digest,rendered_digest,backend_principal,semantic_digest,plan_body,issued_at,valid_until)
 values(token,p_date,p_device,p_credential,p_employee,p_epoch,p_intent,body#>>'{target,targetType}',(body#>>'{target,authorityRevision}')::bigint,
  p_target_digest,body->>'rendered_digest',principal,semantic,body,issued,until_time);
 if until_time<=clock_timestamp() then raise exception 'normal notification plan expired while retaining' using errcode='40001';end if;
 wire:=body::text;return jsonb_build_object('schema',case body->>'schema' when 'custodial.recurring-current-notification-plan.v2' then 'custodial.recurring-current-notification-plan-envelope.v2' else 'custodial.recurring-current-notification-plan-envelope.v1' end,
  'body',body,'bodyJsonText',wire,'bodyDigest',public.static_weekly_digest_text(wire));
end $issue$;

create function public.static_weekly_v27_ack_device_schedule_delivery(
 p_plan_read uuid,p_intent uuid,p_device uuid,p_credential uuid,p_employee uuid,p_epoch bigint,
 p_target_type text,p_revision bigint,p_target_digest text,p_rendered_digest text,p_applied_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $ack$
declare original public.static_weekly_recurring_notification_plan_reads%rowtype;principal jsonb;current_plan jsonb;body jsonb;
 result jsonb;semantic text;at_time timestamptz;until_time timestamptz;locked record;
begin
 perform public.static_weekly_v27_lock_notification_plan_sources();
 principal:=public.static_weekly_v27_notification_plan_backend_principal(p_device,p_credential,p_employee,p_epoch);
 select * into strict original from public.static_weekly_recurring_notification_plan_reads where plan_read_id=p_plan_read;
 if original.intent_id is distinct from p_intent or original.device_id is distinct from p_device
  or original.credential_id is distinct from p_credential or original.employee_id is distinct from p_employee
  or original.assignment_epoch is distinct from p_epoch or original.target_type is distinct from p_target_type
  or original.authority_revision is distinct from p_revision or original.target_digest is distinct from p_target_digest
  or original.rendered_digest is distinct from p_rendered_digest or original.backend_principal is distinct from principal then
  raise exception 'exact issued notification plan read required' using errcode='42501';end if;
 -- A complete normal plan with unavailable original jobs is UI DATA only.
 -- It must never grant the same receipt through a header/token-only caller.
 if original.plan_body->>'schema'='custodial.recurring-current-notification-plan.v2'
  and (original.plan_body#>>'{delivery_bindings,state}' is distinct from 'ORIGINAL_NATIVE_RESERVATIONS'
   or case when jsonb_typeof(original.plan_body#>'{delivery_bindings,entries}')='array'
    then jsonb_array_length(original.plan_body#>'{delivery_bindings,entries}') else 0 end<>jsonb_array_length(original.plan_body->'required_effects')
   or jsonb_array_length(original.plan_body->'required_effects')<1) then
  raise exception 'issued original native bindings unavailable' using errcode='42501';end if;
 at_time:=clock_timestamp();if at_time>=original.valid_until then raise exception 'issued notification plan expired' using errcode='40001';end if;
 current_plan:=public.static_weekly_v27_notification_plan_at(original.service_date,p_device,p_credential,p_employee,p_epoch,p_intent,p_target_digest,at_time);
 body:=current_plan->'body';until_time:=least((body->>'valid_until')::timestamptz,(principal->>'credential_expires_at')::timestamptz);
 body:=jsonb_set(body,'{valid_until}',to_jsonb(public.custodial_native_location_utc(until_time)))
  ||jsonb_build_object('backend_principal_digest',public.static_weekly_digest_jsonb(principal));
 semantic:=public.static_weekly_digest_jsonb(body-'observed_at');
 -- Exact original job selection is separately bound/recompared. A future
 -- semantic-effect refactor must not silently omit native-original custody.
 if (body->'delivery_bindings') is distinct from (original.plan_body->'delivery_bindings')
  or (body->>'schema') is distinct from (original.plan_body->>'schema') then
  raise exception 'issued original native binding changed' using errcode='40001';end if;
 if semantic is distinct from original.semantic_digest or until_time is distinct from original.valid_until then
  raise exception 'issued notification plan source changed' using errcode='40001';end if;
 -- Old writer's explicit row locks and FK key-share probes are pre-admitted
 -- with NOWAIT, including pure row-locking transactions (ROW SHARE table mode).
 -- Source-exclusive prevents new recurring rows; auxiliary SRE prevents new
 -- dated intent/receipt rows. Any pre-existing conflicting row lock refuses.
 if p_target_type='SCHEDULE' then
  perform 1 from public.static_weekly_recurring_application_intents where intent_id=p_intent for share nowait;
  perform 1 from public.weekly_schedule_compiled_projections p
   join public.static_weekly_recurring_application_intents i on i.projection_id=p.projection_id
   where i.intent_id=p_intent for share of p nowait;
  for locked in select d.intent_id,d.projection_id
   from public.static_weekly_schedule_application_intents d
   join public.static_weekly_recurring_application_intents i on i.intent_id=p_intent
   join public.static_weekly_staffing_commands c on c.operation_id=d.operation_id and c.state='ACCEPTED'
   where d.service_date=i.service_date and d.employee_id=i.employee_id and d.device_id=i.device_id
    and d.credential_id=i.credential_id and d.assignment_epoch=i.assignment_epoch
    and d.authority_revision=i.authority_revision and d.publication_id=i.publication_id
    and d.projection_id=i.projection_id and d.lunch_document_identity=i.lunch_document_identity
    and not exists(select 1 from public.static_weekly_schedule_application_receipts r where r.intent_id=d.intent_id)
   order by d.intent_id for share of d nowait loop
   perform 1 from public.weekly_schedule_compiled_projections where projection_id=locked.projection_id for share nowait;
  end loop;
 else
  perform 1 from public.static_weekly_recurring_terminal_intents where intent_id=p_intent for share nowait;
 end if;
 result:=public.static_weekly_v24_ack_device_schedule_delivery(p_intent,p_device,p_credential,p_employee,p_epoch,
  p_target_type,p_revision,p_target_digest,p_rendered_digest,p_applied_at);
 -- All sources stay write-fenced until COMMIT. Fresh server time AFTER the
 -- original receipt writer is the final check; a failure rolls back its rows.
 if clock_timestamp()>=original.valid_until then raise exception 'issued notification plan expired during receipt' using errcode='40001';end if;
 return result;
end $ack$;
revoke all on function public.static_weekly_v27_issue_recurring_notification_plan(date,uuid,uuid,uuid,bigint,uuid,text),
 public.static_weekly_v27_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamptz)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v27_issue_recurring_notification_plan(date,uuid,uuid,uuid,bigint,uuid,text),
 public.static_weekly_v27_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamptz) to service_role;
-- No header-less alternate service RPC may create the same recurring receipt.
-- Already-recorded original outcomes remain on the separate unchanged v26 read.
revoke execute on function public.static_weekly_v24_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamptz) from service_role;

-- Finite recoverable surface: exact new functions/table/53 source trigger definitions,
-- plus only the old v24 grant changed above and existing canary extension.
create temporary table v27_objects on commit drop as
with funcs as(select oid,'public.'||oid::regprocedure::text identity from pg_proc
 where oid in (
  'public.static_weekly_v27_notification_plan_source_write_fence()'::regprocedure,
  'public.static_weekly_v27_lock_notification_plan_sources()'::regprocedure,
  'public.static_weekly_v27_notification_plan_backend_principal(uuid,uuid,uuid,bigint)'::regprocedure,
  'public.static_weekly_v27_original_native_bindings(jsonb,timestamptz)'::regprocedure,
  'public.static_weekly_v27_notification_plan_at(date,uuid,uuid,uuid,bigint,uuid,text,timestamptz)'::regprocedure,
  'public.static_weekly_v27_issue_recurring_notification_plan(date,uuid,uuid,uuid,bigint,uuid,text)'::regprocedure,
  'public.static_weekly_v27_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamptz)'::regprocedure)),
 rels as(select 'public.static_weekly_recurring_notification_plan_reads'::text rel),
 objects as(
 select 100000 bucket,0 priority,'function'::text kind,identity,pg_get_functiondef(oid) definition from funcs
 union all select 900000,0,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 union all select x.* from rels cross join lateral (
  select 1000 bucket,0 priority,'relation'::text kind,rel identity,public.custodial_release_authority_current_relation_definition(rel) definition
  union all select 200000,0,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname)
   from pg_attribute where attrelid=rel::regclass and attnum>0 and not attisdropped
  union all select 300000,0,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
  union all select 400000,0,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
  union all select 500000,case when contype='f' then 1 else 0 end,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
   from pg_constraint where conrelid=rel::regclass
  union all select 600000,0,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
   from pg_index i where indrelid=rel::regclass and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
  union all select 700000,0,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '
   ||pg_get_triggerdef(oid,true)||'; alter table '||rel||case tgenabled when 'A' then ' enable always trigger ' when 'R' then ' enable replica trigger ' when 'D' then ' disable trigger ' else ' enable trigger ' end||quote_ident(tgname)||';'
   from pg_trigger where tgrelid=rel::regclass and not tgisinternal
  union all select 800000,0,'policy',rel||':'||polname,public.custodial_release_authority_current_policy_definition(rel||':'||polname)
   from pg_policy where polrelid=rel::regclass
  union all select 900000,0,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)
 ) x
 union all select 700000,0,'trigger',g.tgrelid::regclass::text||'.'||g.tgname,
  'drop trigger if exists '||quote_ident(g.tgname)||' on '||g.tgrelid::regclass::text||'; '||pg_get_triggerdef(g.oid,true)
  ||'; alter table '||g.tgrelid::regclass::text||' enable always trigger '||quote_ident(g.tgname)||';'
  from pg_trigger g where g.tgname='custodial_recurring_notification_plan_source_fence'
  and g.tgfoid='public.static_weekly_v27_notification_plan_source_write_fence()'::regprocedure
) select * from objects;
do $objects$ begin
 if (select count(*) from v27_objects where kind='function')<>7
  or (select count(*) from v27_objects where kind='relation')<>1
  or (select count(*) from v27_objects where kind='trigger')<>55
  or exists(select 1 from v27_objects where definition is null)
  or exists(select 1 from v27_objects group by kind,identity having count(*)<>1)
  or exists(select 1 from v27_inventory_before i join v27_objects o on i.object_kind=o.kind and i.object_identity=o.identity)
 then raise exception 'normal notification plan finite recovery surface differs' using detail=jsonb_build_object(
  'counts',(select jsonb_object_agg(kind,n) from(select kind,count(*) n from v27_objects group by kind)x),
  'function_identities',(select jsonb_agg(identity order by identity) from v27_objects where kind='function'),
  'undefined',(select jsonb_agg(identity order by identity) from v27_objects where definition is null),
  'overlap',(select jsonb_agg(o.identity order by o.identity) from v27_inventory_before i join v27_objects o on i.object_kind=o.kind and i.object_identity=o.identity))::text;end if;
end $objects$;
do $surface$ declare original text;patched text;entries text;begin
 select definition into strict original from v27_surface_before;
 if length(original)-length(replace(original,'  values',''))<>length('  values') then
  raise exception 'normal notification plan canary seam differs';end if;
 select string_agg(format('(%L,%L,%L),',kind,identity,'complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),E'\n' order by kind,identity) into entries from v27_objects;
 patched:=replace(original,'  values','  values'||E'\n'||entries);execute patched;
 if pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) is distinct from patched
  or (select proacl from pg_proc where oid='public.custodial_release_canary_authority_surface()'::regprocedure) is distinct from (select acl from v27_surface_before)
  or (select proowner from pg_proc where oid='public.custodial_release_canary_authority_surface()'::regprocedure) is distinct from (select owner from v27_surface_before)
 then raise exception 'normal notification plan canary changed outside finite extension';end if;
end $surface$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$ declare obj record;n integer;changed integer;v_identity text;v_definition text;begin
 for obj in select * from v27_objects order by bucket,priority,identity loop
  select v into n from generate_series(obj.bucket+1,case when obj.bucket=1000 then 99998 else obj.bucket+99998 end) v
   where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=v) order by v limit 1;
  if n is null then raise exception 'normal notification plan recovery order exhausted';end if;
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(n,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 end loop;
 v_identity:='public.custodial_release_canary_authority_surface()';v_definition:=pg_get_functiondef(v_identity::regprocedure);
 update public.custodial_release_authority_restore_inventory set definition_sql=v_definition,
  definition_sha256=public.static_weekly_digest_text(v_definition),captured_at=statement_timestamp()
  where object_kind='function' and object_identity like '%(%' and to_regprocedure(object_identity)=v_identity::regprocedure
   and definition_sql=(select v.definition from v27_surface_before v);
 get diagnostics changed=row_count;if changed<>1 then raise exception 'normal plan exact canary predecessor differs';end if;
 v_identity:='public.static_weekly_v24_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamp with time zone)';
 v_definition:=public.custodial_release_authority_current_grant_definition(v_identity);
 update public.custodial_release_authority_restore_inventory set definition_sql=v_definition,
  definition_sha256=public.static_weekly_digest_text(v_definition),captured_at=statement_timestamp()
  where object_kind='grant' and object_identity like '%(%' and to_regprocedure(object_identity)=v_identity::regprocedure;
 get diagnostics changed=row_count;if changed<>1 then raise exception 'normal plan exact v24 grant predecessor differs';end if;
end $recovery$;
do $restore_inventory_mode$ begin
 if (select tgenabled from v27_inventory_guard_before)='A' then
  alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
 else
  alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
 end if;
end $restore_inventory_mode$;
do $scope$ begin
 if (select count(*) from public.custodial_release_authority_restore_inventory)<>(select count(*) from v27_inventory_before)+(select count(*) from v27_objects)
  or exists(select old.* from v27_inventory_before old where not(
   old.object_kind='function' and old.object_identity like '%(%' and to_regprocedure(old.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   or old.object_kind='grant' and old.object_identity like '%(%' and to_regprocedure(old.object_identity)='public.static_weekly_v24_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamptz)'::regprocedure)
   except select * from public.custodial_release_authority_restore_inventory)
  or exists(select 1 from v27_objects o left join public.custodial_release_authority_restore_inventory i on i.object_kind=o.kind and i.object_identity=o.identity
   where i.definition_sql is distinct from o.definition or i.definition_sha256 is distinct from public.static_weekly_digest_text(o.definition))
  or (select tgenabled from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   and tgname='trg_custodial_release_authority_restore_inventory_immutable') is distinct from (select tgenabled from v27_inventory_guard_before)
 then raise exception 'normal notification plan unrelated recovery bytes or mode changed';end if;
end $scope$;
commit;
