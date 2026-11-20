-- CLI-created 20261002072822; parent reserved180000, combined canary190000.
-- Guarded LOCATION-only prerequisite. No sender/route/clock-profile activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Sorted ASCII keys, UTF8, JSON string escaping; jsonb::text is NOT this wire.
create function public.custodial_native_location_canonical(p_data jsonb)
returns text language plpgsql immutable set search_path=pg_catalog,public as $fn$
declare result text;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or exists(
  select 1 from jsonb_each(p_data) e where jsonb_typeof(e.value)<>'string' or e.key !~ '^[a-z][a-z0-9_]*$')
 then raise exception 'native location flat string object required';end if;
 select '{'||coalesce(string_agg(to_json(key)::text||':'||to_json(value)::text,',' order by key collate "C"),'')||'}'
 into result from jsonb_each_text(p_data);
 return result;
end $fn$;

alter table public.employee_native_push_delivery_receipts
 add column native_generation_id uuid references public.employee_native_push_generations(generation_id),
 add column native_payload jsonb,
 add column native_payload_sha256 text,
 add column native_valid_until timestamptz;
alter table public.employee_native_push_delivery_receipts add constraint native_location_payload_binding check (
 (native_generation_id is null and native_payload is null and native_payload_sha256 is null and native_valid_until is null)
 or (native_generation_id is not null and native_payload is not null and native_payload_sha256 is not null and native_valid_until is not null
  and native_payload_sha256 ~ '^[0-9a-f]{64}$' and isfinite(native_valid_until) and native_valid_until>prepared_at
  and native_payload->>'schema'='custodial.native-location-payload.v2'
  and native_payload->>'generation_id'=native_generation_id::text
  and native_payload->>'receipt_job_id'=job_id::text
  and native_payload->>'receipt_credential_id'=credential_id::text
  and native_payload->>'receipt_assignment_epoch'=assignment_epoch::text
  and native_payload->>'token_digest'=token_hash
  and native_payload->>'location_id'=source_id::text
  and native_payload->>'reservation_at'=to_char(prepared_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  and native_payload->>'valid_until'=to_char(native_valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  and native_payload->>'content_sha256'=native_payload_sha256
  and native_payload_sha256=public.static_weekly_digest_text(public.custodial_native_location_canonical(native_payload-'content_sha256'))
  and octet_length(public.custodial_native_location_canonical(native_payload))<=3500) is true);
create index employee_native_location_generation on public.employee_native_push_delivery_receipts(native_generation_id)
 where native_generation_id is not null;

-- Legacy release/record cannot delete/rewrite a new protected reservation.
-- Dedicated exact-outcome/inventory integration is deliberately a later gate.
create function public.custodial_native_location_receipt_guard()
returns trigger language plpgsql set search_path=pg_catalog,public as $fn$
begin
 if old.native_generation_id is not null and (tg_op='DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then
  raise exception 'native location reservation immutable; exact outcome owner required' using errcode='23514';
 end if;
 if tg_op='DELETE' then return old;end if;
 if old.native_generation_id is null and new.native_generation_id is not null then
  raise exception 'historical receipt cannot acquire fabricated native lineage' using errcode='23514';
 end if;
 return new;
end $fn$;
create trigger trg_native_location_receipt_guard before update or delete on public.employee_native_push_delivery_receipts
 for each row execute function public.custodial_native_location_receipt_guard();
alter table public.employee_native_push_delivery_receipts enable always trigger trg_native_location_receipt_guard;

-- Private implementation seam: NULL means fresh server clock after locks. Only
-- postgres-owned synthetic tests may supply a fixed clock; no runtime role can.
create function public.custodial_native_location_reserve_at(p_job uuid,p_lease uuid,p_expected jsonb,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare d public.devices%rowtype;c public.device_auth_credentials%rowtype;r public.employee_push_registrations%rowtype;
 g public.employee_native_push_generations%rowtype;j public.operational_notification_jobs%rowtype;
 prior public.employee_native_push_delivery_receipts%rowtype;a record;v record;
 at_time timestamptz;until_time timestamptz;coverage_end timestamptz;day_end timestamptz;
 service_date date;data jsonb;wire text;digest text;field text;authority_count integer;employee_name text;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_lease is null or jsonb_typeof(p_expected) is distinct from 'object'
  or (select array_agg(key order by key) from jsonb_object_keys(p_expected) key) is distinct from
   array['assignment_epoch','credential_id','device_id','employee_id','generation_id','principal_digest','registration_id','token_digest']
  or exists(select 1 from jsonb_each(p_expected) e where jsonb_typeof(e.value)<>'string')
 then raise exception 'exact native location recipient required' using errcode='22023';end if;
 foreach field in array array['credential_id','employee_id','generation_id','registration_id'] loop
  if p_expected->>field !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'invalid native location UUID';end if;
 end loop;
 if p_expected->>'assignment_epoch' !~ '^[1-9][0-9]{0,15}$'
  or (p_expected->>'assignment_epoch')::numeric>9007199254740991
  or p_expected->>'principal_digest' !~ '^[0-9a-f]{64}$' or p_expected->>'token_digest' !~ '^[0-9a-f]{64}$'
  or p_expected->>'device_id' !~ '^KIOSK_(0[2-9]|10)$' then raise exception 'invalid native location principal';end if;
 -- Same schedule fence as publication, then native registration lock order.
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select d0.* into d from public.devices d0 join public.device_auth_credentials c0 on c0.device_id=d0.id
  where c0.credential_id=(p_expected->>'credential_id')::uuid for update of d0;
 select * into c from public.device_auth_credentials where credential_id=(p_expected->>'credential_id')::uuid for update;
 select display_name into employee_name from public.employees where id=d.assigned_employee_id for share;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for update;
 select * into r from public.employee_push_registrations where registration_id=(p_expected->>'registration_id')::uuid;
 select * into g from public.employee_native_push_generations where generation_id=(p_expected->>'generation_id')::uuid for update;
 select * into j from public.operational_notification_jobs where job_id=p_job for update;
 at_time:=coalesce(p_test_at,clock_timestamp());service_date:=public.sch_service_date(at_time);
 if not isfinite(at_time) or d.id is null or d.active is not true or d.device_id is distinct from p_expected->>'device_id'
  or d.assigned_employee_id::text is distinct from p_expected->>'employee_id' or d.assignment_epoch::text is distinct from p_expected->>'assignment_epoch'
  or c.device_id is distinct from d.id or c.confirmed_at is null or c.revoked_at is not null or c.expires_at<=at_time
  or not exists(select 1 from public.employees where id=d.assigned_employee_id and active and employee_code ~ '^EMP[0-9]+$')
  or r.registration_id is null or r.device_id is distinct from d.id or r.credential_id is distinct from c.credential_id
  or r.employee_id is distinct from d.assigned_employee_id or r.assignment_epoch is distinct from d.assignment_epoch
  or r.platform is distinct from 'android' or r.active is not true or r.revoked_at is not null
  or r.token_hash is distinct from p_expected->>'token_digest'
  or public.static_weekly_digest_text(r.fcm_token) is distinct from r.token_hash
  or g.generation_id is null or g.registration_id is distinct from r.registration_id or g.device_id is distinct from d.id
  or g.device_identifier is distinct from d.device_id or g.credential_id is distinct from c.credential_id
  or g.employee_id is distinct from d.assigned_employee_id or g.assignment_epoch is distinct from d.assignment_epoch
  or g.principal_digest is distinct from p_expected->>'principal_digest' or g.token_digest is distinct from r.token_hash
  or g.revoked_at is not null or g.dispatch_retired_at is not null or g.activated_at>at_time then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_location_recipient_superseded');end if;
 if j.job_id is null or j.job_type is distinct from 'employee_native_push' or j.status is distinct from 'leased'
  or j.lease_token is distinct from p_lease or j.leased_until is null or j.leased_until<=at_time
  or j.payload_json->>'credential_id' is distinct from c.credential_id::text
  or j.payload_json->>'employee_id' is distinct from d.assigned_employee_id::text
  or j.payload_json->>'device_id' is distinct from d.id::text
  or j.payload_json->>'device_identifier' is distinct from d.device_id
  or j.payload_json->>'assignment_epoch' is distinct from d.assignment_epoch::text
  or j.payload_json#>>'{data_json,kind}' is distinct from 'employee_location_status'
  or (j.payload_json#>'{data_json,test_delivery}') is not null then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_location_job_superseded');end if;
 if coalesce((public.mz_validate_employee_location_reminder(p_job,p_lease,at_time)->>'current')::boolean,false) is not true then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_location_authority_superseded');end if;
 -- Derive content from current owning readers, not arbitrary queued data/title.
 select count(*) into authority_count from public.custodial_operational_location_assignments(service_date) x
  where x.location_id=j.source_id and x.assigned_employee_id=d.assigned_employee_id and x.assignment_status='ASSIGNED'
   and x.projection_status='current' and x.projection_id::text=j.payload_json#>>'{data_json,projection_id}'
   and x.publication_id::text=j.payload_json#>>'{data_json,publication_id}'
   and x.coverage_start<=(at_time at time zone 'America/Chicago')::time and x.coverage_end>(at_time at time zone 'America/Chicago')::time;
 if authority_count<>1 then return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_location_authority_ambiguous');end if;
 select x.*,s.source_id,s.source_digest into strict a from public.custodial_operational_location_assignments(service_date) x
  join public.weekly_schedule_versions version on version.version_id=x.version_id
  join public.weekly_schedule_publications publication on publication.publication_id=x.publication_id and publication.version_id=version.version_id
  join public.static_weekly_authority_source_documents s on s.source_id=version.authority_source_id
  where x.location_id=j.source_id and x.assigned_employee_id=d.assigned_employee_id and x.assignment_status='ASSIGNED'
   and x.projection_status='current' and x.projection_id::text=j.payload_json#>>'{data_json,projection_id}'
   and x.publication_id::text=j.payload_json#>>'{data_json,publication_id}'
   and x.coverage_start<=(at_time at time zone 'America/Chicago')::time and x.coverage_end>(at_time at time zone 'America/Chicago')::time;
 select * into strict v from public.mz_location_reminder_candidates(service_date,at_time) x where x.location_id=j.source_id;
 if j.job_key is distinct from 'employee-location-push:'||v.notification_key||':projection:'||a.projection_id::text||':'||c.credential_id::text then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_location_occurrence_key_superseded');end if;
 if a.authority_source not in ('static_weekly_projection','static_weekly_lunch_coverage') or a.occurrence_id is null
  or a.source_digest !~ '^[0-9a-f]{64}$' or a.location_code !~ '^[A-Z0-9._:-]{1,100}$' then raise exception 'unsupported exact native location authority';end if;
 coverage_end:=(service_date+a.coverage_end) at time zone 'America/Chicago';
 day_end:=((service_date+1)::timestamp+make_interval(hours=>public.get_setting_int('operational_day_start_hour',4))) at time zone 'America/Chicago';
 until_time:=least(coverage_end,day_end,c.expires_at,case when v.status_code='due_soon' then v.overdue_at
  else v.overdue_at+(floor(extract(epoch from at_time-v.overdue_at)/300)+1)*interval '5 minutes' end);
 if until_time<=at_time then return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_location_expired');end if;
 select * into prior from public.employee_native_push_delivery_receipts where job_id=p_job for update;
 if prior.job_id is not null then
  if prior.native_generation_id is distinct from g.generation_id or prior.registration_id<>r.registration_id
   or prior.credential_id<>c.credential_id or prior.assignment_epoch<>d.assignment_epoch or prior.token_hash<>g.token_digest
   or prior.job_key<>j.job_key or prior.source_id<>j.source_id or prior.native_valid_until<=at_time
   or prior.native_payload->>'projection_id' is distinct from a.projection_id::text
   or prior.native_payload->>'publication_id' is distinct from a.publication_id::text
   or prior.native_payload->>'version_id' is distinct from a.version_id::text
   or prior.native_payload->>'occurrence_id' is distinct from a.occurrence_id::text
   or prior.native_payload->>'authority_source_id' is distinct from a.source_id::text
   or prior.native_payload->>'authority_source_digest' is distinct from a.source_digest
   or prior.native_payload->>'authority_source' is distinct from a.authority_source
   or prior.native_payload->>'notification_key' is distinct from v.notification_key||':projection:'||a.projection_id::text then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_location_original_reservation_conflict');end if;
  return jsonb_build_object('current',true,'dispatch_authorized',false,'replayed',true,'delivery_outcome_unknown',true,
   'reason','native_location_outcome_unknown_no_resend','payload',prior.native_payload,
   'wire',public.custodial_native_location_canonical(prior.native_payload));
 end if;
 data:=jsonb_build_object('schema','custodial.native-location-payload.v2','kind','employee_location_status','notification_type','location_status',
  'generation_id',g.generation_id::text,'principal_digest',g.principal_digest,'token_digest',g.token_digest,
  'receipt_job_id',j.job_id::text,'receipt_credential_id',c.credential_id::text,'receipt_employee_id',d.assigned_employee_id::text,
  'receipt_device_id',d.device_id,'receipt_assignment_epoch',d.assignment_epoch::text,
  'notification_key',v.notification_key||':projection:'||a.projection_id::text,
  'reservation_at',to_char(at_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'valid_until',to_char(until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'title',a.location_name||case when v.status_code='overdue' then ' is overdue' else ' is due soon' end,
  'body',employee_name||', '||a.location_name||case when v.status_code='overdue' then ' on your assigned route is overdue and needs attention now.' else ' on your assigned route is due soon for a check.' end,
  'channel_id',case when v.status_code='overdue' then 'employee-overdue' else 'employee-due-soon' end,
  'route','employee-schedule.html?hub=employee&highlight='||a.location_code,'service_date',service_date::text,
  'reminder_contract','verified-visit-reminders.v2','cleaned_at',to_char(v.cleaned_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'cycle_base_at',to_char(v.cycle_base_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'cycle_base_evidence',v.cycle_base_evidence,
  'due_soon_at',to_char(v.due_soon_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'overdue_at',to_char(v.overdue_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'status_code',v.status_code,
  'location_id',a.location_id::text,'location_code',a.location_code,'location_name',a.location_name,'form_type',a.form_type,
  'group_code',coalesce(a.group_code,''),'group_name',coalesce(a.group_name,''),'projection_id',a.projection_id::text,
  'publication_id',a.publication_id::text,'version_id',a.version_id::text,'occurrence_id',a.occurrence_id::text,
  'authority_source',a.authority_source,'authority_source_id',a.source_id::text,'authority_source_digest',a.source_digest,
  'coverage_end_at',to_char(coverage_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'operational_end_at',to_char(day_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 -- Conservative UTF8 byte bounds also satisfy native UTF16 character bounds.
 -- Refuse unsupported source text BEFORE creating an immutable reservation;
 -- never truncate authoritative names or leave a permanently undecodable row.
 if exists(select 1 from jsonb_each_text(data) e where octet_length(e.value)>case
   when e.key in ('title','location_name','group_name') then 180
   when e.key in ('location_code','group_code') then 100
   when e.key='notification_key' then 240 else 1000 end
   or regexp_replace(e.value,E'[\\n\\r\\t]','','g') ~ '[[:cntrl:]]'
   or (e.key in ('title','location_name','group_name','group_code') and e.value ~ '[[:cntrl:]]')) then
  raise exception 'native location source text unsupported; no truncation';end if;
 digest:=public.static_weekly_digest_text(public.custodial_native_location_canonical(data));
 data:=data||jsonb_build_object('content_sha256',digest);wire:=public.custodial_native_location_canonical(data);
 if octet_length(wire)>3500 then raise exception 'native location payload too large; no truncation';end if;
 insert into public.employee_native_push_delivery_receipts(job_id,job_key,source_id,lease_token,credential_id,assignment_epoch,
  registration_id,token_hash,prepared_at,native_generation_id,native_payload,native_payload_sha256,native_valid_until)
 values(j.job_id,j.job_key,j.source_id,p_lease,c.credential_id,d.assignment_epoch,r.registration_id,g.token_digest,at_time,g.generation_id,data,digest,until_time);
 return jsonb_build_object('current',true,'dispatch_authorized',true,'replayed',false,'delivery_outcome_unknown',false,'payload',data,'wire',wire);
end $fn$;

create function public.custodial_native_location_reserve(p_job uuid,p_lease uuid,p_expected jsonb)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_location_reserve_at(p_job,p_lease,p_expected,null);
$fn$;
do $acl$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'custodial_native_location_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823',f);
 end loop;
end $acl$;
grant execute on function public.custodial_native_location_reserve(uuid,uuid,jsonb) to service_role;

-- Exact changed relation metadata and new functions/trigger only. Root owns the
-- combined canary enumeration in190000; no unrelated function recapture here.
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$ declare obj record;next_order integer;relation_name text:='public.employee_native_push_delivery_receipts';begin
 for obj in with funcs as (select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'custodial_native_location_%'),objects as (
  select 1000 bucket,'relation'::text kind,relation_name identity,public.custodial_release_authority_current_relation_definition(relation_name) definition
  union all select 100000,'function',oid::regprocedure::text,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',relation_name||':'||attname,public.custodial_release_authority_current_column_definition(relation_name||':'||attname)
   from pg_attribute where attrelid=relation_name::regclass and attnum>0 and not attisdropped and attname in ('native_generation_id','native_payload','native_payload_sha256','native_valid_until')
  union all select 300000,'column_set',relation_name,public.custodial_release_authority_current_column_set_definition(relation_name)
  union all select 500000,'constraint',relation_name||':'||conname,public.custodial_release_authority_current_constraint_definition(relation_name||':'||conname)
   from pg_constraint where conrelid=relation_name::regclass and conname in ('native_location_payload_binding','employee_native_push_delivery_receipts_native_generation_id_fkey')
  union all select 600000,'index','public.employee_native_location_generation',public.custodial_release_authority_current_index_definition('public.employee_native_location_generation')
  union all select 700000,'trigger',relation_name||'.trg_native_location_receipt_guard',
   'drop trigger if exists trg_native_location_receipt_guard on '||relation_name||'; '||pg_get_triggerdef(t.oid,true)||'; alter table '||relation_name||' enable always trigger trg_native_location_receipt_guard;'
   from pg_trigger t where t.tgrelid=relation_name::regclass and t.tgname='trg_native_location_receipt_guard'
  union all select 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing native location recovery %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
    then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory where restore_order>=obj.bucket and restore_order<obj.bucket+100000;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
