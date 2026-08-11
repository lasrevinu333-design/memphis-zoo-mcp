-- I2 three-HIGH foundation correction.
--
-- The I1 compiler/verifier remains the scheduling authority.  This migration
-- repairs the earliest I2 persistence seam: an independently verified adapter
-- now signs the complete canonical document/envelope with a deployment-owned
-- HMAC key that PostgreSQL verifies from its private configuration row.  A
-- public JSON digest remains useful for deterministic replay only; it is not
-- accepted as provenance.
begin;

create table if not exists public.static_weekly_authority_attestation_config (
  singleton boolean primary key default true check(singleton),
  hmac_secret text,
  enabled boolean not null default false,
  configured_at timestamptz,
  configured_by text,
  check ((enabled=false and hmac_secret is null) or (enabled=true and length(hmac_secret)>=32))
);
insert into public.static_weekly_authority_attestation_config(singleton,enabled)
values(true,false) on conflict(singleton) do nothing;

-- This follows the existing backend-execution configuration boundary: release
-- ownership configures a non-committed secret after migration, application
-- workers receive only the matching environment value, and service_role has no
-- read or configuration privilege.  The HMAC key is intentionally not a GUC:
-- an untrusted session can set arbitrary custom GUC values.
create or replace function public.static_weekly_configure_authority_attestation_key(
  p_hmac_secret text,p_configured_by text default 'release-owner'
) returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if length(coalesce(p_hmac_secret,''))<32 then
    raise exception using errcode='22023',message='static weekly authority attestation key must contain at least 32 characters';
  end if;
  insert into public.static_weekly_authority_attestation_config(singleton,hmac_secret,enabled,configured_at,configured_by)
  values(true,p_hmac_secret,true,statement_timestamp(),left(coalesce(nullif(btrim(p_configured_by),''),'release-owner'),200))
  on conflict(singleton) do update set hmac_secret=excluded.hmac_secret,enabled=true,configured_at=excluded.configured_at,configured_by=excluded.configured_by;
end
$function$;

create or replace function public.static_weekly_authority_hmac(p_scope text,p_payload jsonb)
returns text language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_secret text; v_enabled boolean; v_schema text; v_hmac text;
begin
  select hmac_secret,enabled into v_secret,v_enabled from public.static_weekly_authority_attestation_config where singleton=true;
  if v_enabled is not true or length(coalesce(v_secret,''))<32 then
    raise exception using errcode='42501',message='static weekly authority attestation boundary is not configured';
  end if;
  select n.nspname into v_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
  if v_schema not in ('extensions','public') then raise exception using errcode='55000',message='pgcrypto must be installed in extensions or public'; end if;
  execute format('select encode(%I.hmac(convert_to($1,''UTF8''),convert_to($2,''UTF8''),''sha256''),''hex'')',v_schema)
    into v_hmac using p_scope||E'\n'||p_payload::text,v_secret;
  return v_hmac;
end
$function$;

create or replace function public.static_weekly_assert_authority_attestation(p_attestation jsonb,p_scope text,p_payload jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_expected text;
begin
  perform public.static_weekly_assert_exact_object(p_attestation,
    array['schema','key_id','scope','payload_digest','signature'],
    array['schema','key_id','scope','payload_digest','signature'],'authority attestation');
  if p_attestation->>'schema' is distinct from 'memphis-zoo.static-weekly-authority-attestation.v1'
    or p_attestation->>'key_id' is distinct from 'static-weekly-authority-hmac-v1'
    or p_attestation->>'scope' is distinct from p_scope
    or p_attestation->>'payload_digest' is distinct from public.static_weekly_digest_jsonb(p_payload)
    or coalesce(p_attestation->>'signature','') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='23514',message='complete keyed static weekly authority attestation is required';
  end if;
  v_expected:=public.static_weekly_authority_hmac(p_scope,p_payload);
  if p_attestation->>'signature' is distinct from v_expected then
    raise exception using errcode='23514',message='static weekly authority attestation does not bind the canonical semantic payload';
  end if;
end
$function$;

create or replace function public.static_weekly_document_attestation_payload(p_document jsonb)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $function$
  select jsonb_build_object('adapter',p_document->'adapter','authority',p_document->'authority','receipt',p_document->'receipt',
    'slot_availability',p_document->'slot_availability','assignments',p_document->'assignments',
    'objective_inputs',p_document->'objective_inputs','semantic_snapshot',p_document->'semantic_snapshot')
$function$;

create or replace function public.static_weekly_assert_document_attested(p_document jsonb,p_effective_start date,p_require_publishable boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_legacy jsonb; v_payload jsonb; v_snapshot jsonb;
begin
  perform public.static_weekly_assert_exact_object(p_document,
    array['adapter','authority','receipt','slot_availability','assignments','objective_inputs','validation','semantic_snapshot','attestation'],
    array['adapter','authority','receipt','slot_availability','assignments','objective_inputs','validation','semantic_snapshot','attestation'],'attested adapter document');
  v_payload:=public.static_weekly_document_attestation_payload(p_document);
  perform public.static_weekly_assert_authority_attestation(p_document->'attestation','recurring_document',v_payload);
  v_snapshot:=p_document->'semantic_snapshot';
  perform public.static_weekly_assert_exact_object(v_snapshot,
    array['schema','recurring_source','relational_slot_availability','relational_assignments'],
    array['schema','recurring_source','relational_slot_availability','relational_assignments'],'recurring semantic snapshot');
  if v_snapshot->>'schema' is distinct from 'memphis-zoo.static-weekly-recurring-semantic-snapshot.v1'
    or v_snapshot->'recurring_source' is distinct from p_document#>'{authority,compilerInput}'
    or v_snapshot->'relational_slot_availability' is distinct from p_document->'slot_availability'
    or v_snapshot->'relational_assignments' is distinct from p_document->'assignments'
    or p_document#>>'{validation,database_document_identity}' is distinct from public.static_weekly_digest_jsonb(v_payload) then
    raise exception using errcode='23514',message='attested recurring semantic snapshot and relational materialization must be exact';
  end if;
  -- Reuse the original I2 type/optimizer parity validator against its exact
  -- historical envelope shape.  The new snapshot and HMAC are checked before
  -- it, so no omitted semantic fact can be replaced by a recomputable digest.
  v_legacy:=p_document-'semantic_snapshot'-'attestation';
  v_legacy:=jsonb_set(v_legacy,'{validation,database_document_identity}',to_jsonb(public.static_weekly_document_identity(v_legacy)),true);
  perform public.static_weekly_assert_document(v_legacy,p_effective_start,p_require_publishable);
end
$function$;

create or replace function public.static_weekly_projection_attestation_payload(p_envelope jsonb)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $function$
  select p_envelope-'attestation'
$function$;

create or replace function public.static_weekly_assert_projection_envelope_attested(p_envelope jsonb,p_publication_id uuid,p_week_start date,p_exception_set jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_legacy jsonb; v_snapshot jsonb; v_document jsonb;
begin
  perform public.static_weekly_assert_exact_object(p_envelope,
    array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity','semantic_snapshot','attestation'],
    array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity','semantic_snapshot','attestation'],'attested projection envelope');
  perform public.static_weekly_assert_authority_attestation(p_envelope->'attestation','dated_projection',public.static_weekly_projection_attestation_payload(p_envelope));
  if p_envelope->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb((p_envelope-'attestation')-'database_projection_identity') then
    raise exception using errcode='23514',message='projection semantic identity must bind the complete attested envelope';
  end if;
  v_snapshot:=p_envelope->'semantic_snapshot';
  perform public.static_weekly_assert_exact_object(v_snapshot,
    array['schema','recurring_source','overlay_source','applied_exceptions','active_assignments'],
    array['schema','recurring_source','overlay_source','applied_exceptions','active_assignments'],'projection semantic snapshot');
  select draft_document into v_document from public.weekly_schedule_versions v join public.weekly_schedule_publications p on p.version_id=v.version_id where p.publication_id=p_publication_id;
  if v_snapshot->>'schema' is distinct from 'memphis-zoo.static-weekly-projection-semantic-snapshot.v1'
    or v_snapshot->'recurring_source' is distinct from p_envelope#>'{authority,compilerInput}'
    or v_snapshot->'recurring_source' is distinct from v_document#>'{semantic_snapshot,recurring_source}'
    or v_snapshot->'overlay_source' is distinct from p_envelope#>'{authority,overlayCompilerInput}'
    or v_snapshot->'applied_exceptions' is distinct from p_envelope->'applied_exceptions'
    or v_snapshot->'active_assignments' is distinct from p_envelope->'assignments' then
    raise exception using errcode='23514',message='attested projection semantic source, accepted recurring authority, overlays, and active work must be exact';
  end if;
  v_legacy:=p_envelope-'semantic_snapshot'-'attestation';
  v_legacy:=jsonb_set(v_legacy,'{database_projection_identity}',to_jsonb(public.static_weekly_digest_jsonb(v_legacy-'database_projection_identity')),true);
  perform public.static_weekly_assert_projection_envelope(v_legacy,p_publication_id,p_week_start,p_exception_set);
end
$function$;

create or replace function public.static_weekly_exception_slot_exists(p_version_id uuid,p_service_date date,p_slot_id text,p_require_working boolean default true)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $function$
  select exists(select 1 from public.weekly_schedule_slot_availability a where a.version_id=p_version_id
    and a.day_of_week=extract(dow from p_service_date)::smallint and a.slot_id::text=p_slot_id
    and (not p_require_working or a.availability_state='working'))
$function$;

create or replace function public.static_weekly_exception_work_exists(p_version_id uuid,p_service_date date,p_work_id text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $function$
  select exists(select 1 from public.weekly_schedule_slot_assignments a where a.version_id=p_version_id
    and a.day_of_week=extract(dow from p_service_date)::smallint and a.work_id=p_work_id)
$function$;

create or replace function public.static_weekly_assert_exception_payload(
  p_exception_type text,p_service_date date,p_starts_at time,p_ends_at time,p_base_version_id uuid,p_publication_id uuid,p_payload jsonb,p_reverses_exception_id uuid
) returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_slot text; v_target text; v_payload jsonb:=p_payload; v_lock jsonb; v_patch jsonb; v_add jsonb; v_ids text[]; v_existing jsonb;
begin
  if jsonb_typeof(v_payload) is distinct from 'object' then raise exception using errcode='23514',message='exception payload must be an exact object'; end if;
  if p_exception_type in ('pto','daily_absence') then
    perform public.static_weekly_assert_exact_object(v_payload,array['slotId'],array['slotId'],'full-day absence payload');
    v_slot:=v_payload->>'slotId';
    if p_starts_at is not null or p_ends_at is not null or not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_slot,true) then raise exception using errcode='23514',message='full-day absence requires one working roster slot and no partial window'; end if;
  elsif p_exception_type='partial_absence' then
    perform public.static_weekly_assert_exact_object(v_payload,array['slotId'],array['slotId'],'partial absence payload'); v_slot:=v_payload->>'slotId';
    if p_starts_at is null or p_ends_at is null or not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_slot,true) then raise exception using errcode='23514',message='partial absence requires one working roster slot and a complete window'; end if;
  elsif p_exception_type='shift_override' then
    perform public.static_weekly_assert_exact_object(v_payload,array['slotId','status','shift'],array['slotId','status','shift'],'shift override payload'); v_slot:=v_payload->>'slotId';
    perform public.static_weekly_assert_exact_object(v_payload->'shift',array['start','end'],array['start','end'],'shift override window');
    if p_starts_at is not null or p_ends_at is not null or v_payload->>'status' not in ('working','absent','unavailable') or not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_slot,false) then raise exception using errcode='23514',message='shift override requires one extant roster slot and exact replacement availability'; end if;
  elsif p_exception_type='cover_all' then
    perform public.static_weekly_assert_exact_object(v_payload,array['availability'],array['availability'],'coverall payload');
    perform public.static_weekly_assert_exact_object(v_payload->'availability',array['slotId','shift','productiveCapacityProvenance','maxServiceEffortMinutes','maxServiceEffortProvenance','qualifications','qualificationProvenance','restrictions','restrictionProvenance','acceptedRouteAnchorLocationId','acceptedRouteProvenance'],array['slotId','shift','productiveCapacityProvenance','maxServiceEffortMinutes','maxServiceEffortProvenance','qualifications','qualificationProvenance','restrictions','restrictionProvenance','acceptedRouteAnchorLocationId','acceptedRouteProvenance'],'coverall availability');
    perform public.static_weekly_assert_exact_object(v_payload#>'{availability,shift}',array['start','end'],array['start','end'],'coverall shift'); v_slot:=v_payload#>>'{availability,slotId}';
    if p_starts_at is not null or p_ends_at is not null or not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_slot,false) then raise exception using errcode='23514',message='coverall requires one extant roster slot and a complete availability replacement'; end if;
  elsif p_exception_type='lunch' then
    perform public.static_weekly_assert_exact_object(v_payload,array['slotId'],array['slotId'],'lunch payload'); v_slot:=v_payload->>'slotId';
    if p_starts_at is null or p_ends_at is null or not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_slot,true) then raise exception using errcode='23514',message='lunch requires one working roster slot and a complete window'; end if;
  elsif p_exception_type in ('nine_forty_five_rebalance','manager_correction') then
    perform public.static_weekly_assert_exact_object(v_payload,array['locks'],array['locks'],p_exception_type||' payload');
    if jsonb_typeof(v_payload->'locks') is distinct from 'array' or jsonb_array_length(v_payload->'locks')=0 or p_starts_at is not null or p_ends_at is not null then raise exception using errcode='23514',message='manager correction requires a nonempty exact lock set'; end if;
    for v_lock in select value from jsonb_array_elements(v_payload->'locks') loop
      perform public.static_weekly_assert_exact_object(v_lock,array['workId','slotId'],array['workId','slotId'],'manager correction lock');
      if not public.static_weekly_exception_work_exists(p_base_version_id,p_service_date,v_lock->>'workId') or not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_lock->>'slotId',true) then raise exception using errcode='23514',message='manager correction lock must target extant working work and slot identities'; end if;
    end loop;
    if (select count(*) from jsonb_array_elements(v_payload->'locks'))<>(select count(distinct value->>'workId') from jsonb_array_elements(v_payload->'locks')) then raise exception using errcode='23514',message='manager correction may not contain duplicate work targets'; end if;
    if exists(select 1 from public.weekly_schedule_exception_commands e cross join lateral jsonb_array_elements(coalesce(e.payload_json->'locks','[]'::jsonb)) l(value)
      where e.publication_id=p_publication_id and e.service_date=p_service_date and e.exception_type in ('nine_forty_five_rebalance','manager_correction')
        and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)
        and l.value->>'workId' in (select value->>'workId' from jsonb_array_elements(v_payload->'locks')) ) then raise exception using errcode='23514',message='manager correction may not duplicate or contradict an accepted lock target'; end if;
  elsif p_exception_type='event_impact' then
    perform public.static_weekly_assert_exact_object(v_payload,array['removeWorkIds','patchWork','addWork'],array['removeWorkIds','patchWork','addWork'],'event impact payload');
    if p_starts_at is not null or p_ends_at is not null or jsonb_typeof(v_payload->'removeWorkIds') is distinct from 'array' or jsonb_typeof(v_payload->'patchWork') is distinct from 'array' or jsonb_typeof(v_payload->'addWork') is distinct from 'array' or jsonb_array_length(v_payload->'removeWorkIds')+jsonb_array_length(v_payload->'patchWork')+jsonb_array_length(v_payload->'addWork')=0 then raise exception using errcode='23514',message='event impact requires a nonempty exact remove, patch, or add command'; end if;
    if exists(select 1 from jsonb_array_elements(v_payload->'removeWorkIds') x(value) where jsonb_typeof(x.value) is distinct from 'string' or nullif(btrim(x.value#>>'{}'),'') is null or not exists(select 1 from public.weekly_schedule_slot_assignments a where a.version_id=p_base_version_id and a.work_id=x.value#>>'{}')) or (select count(*) from jsonb_array_elements(v_payload->'removeWorkIds'))<>(select count(distinct value#>>'{}') from jsonb_array_elements(v_payload->'removeWorkIds')) then raise exception using errcode='23514',message='event removal targets must be unique extant nonblank work identities'; end if;
    for v_patch in select value from jsonb_array_elements(v_payload->'patchWork') loop
      perform public.static_weekly_assert_exact_object(v_patch,array['workId','locationId','locationCodeSnapshot','locationNameSnapshot','window','serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance'],array['workId','locationId','locationCodeSnapshot','locationNameSnapshot','window','serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance'],'event patch work');
      perform public.static_weekly_assert_exact_object(v_patch->'window',array['start','end'],array['start','end'],'event patch window');
      if not exists(select 1 from public.weekly_schedule_slot_assignments a where a.version_id=p_base_version_id and a.work_id=v_patch->>'workId') then raise exception using errcode='23514',message='event patch target must exist in the published recurring version'; end if;
    end loop;
    for v_add in select value from jsonb_array_elements(v_payload->'addWork') loop
      perform public.static_weekly_assert_exact_object(v_add,array['workId','dayOfWeek','originSlotId','locationId','locationCodeSnapshot','locationNameSnapshot','window','serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance'],array['workId','dayOfWeek','originSlotId','locationId','locationCodeSnapshot','locationNameSnapshot','window','serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance'],'event added work');
      perform public.static_weekly_assert_exact_object(v_add->'window',array['start','end'],array['start','end'],'event add window');
      if (v_add->>'dayOfWeek') !~ '^[0-6]$' or exists(select 1 from public.weekly_schedule_slot_assignments a where a.version_id=p_base_version_id and a.work_id=v_add->>'workId') then raise exception using errcode='23514',message='event add must introduce one new work identity in the published recurring version'; end if;
    end loop;
    select array_agg(value#>>'{}') into v_ids from jsonb_array_elements(v_payload->'removeWorkIds');
    if exists(select 1 from jsonb_array_elements(v_payload->'patchWork') x(value) where x.value->>'workId'=any(coalesce(v_ids,array[]::text[])))
      or exists(select 1 from jsonb_array_elements(v_payload->'addWork') x(value) where x.value->>'workId'=any(coalesce(v_ids,array[]::text[])))
      or (select count(*) from jsonb_array_elements(v_payload->'patchWork'))<>(select count(distinct value->>'workId') from jsonb_array_elements(v_payload->'patchWork'))
      or (select count(*) from jsonb_array_elements(v_payload->'addWork'))<>(select count(distinct value->>'workId') from jsonb_array_elements(v_payload->'addWork')) then raise exception using errcode='23514',message='event targets may not duplicate, overlap, or become semantic no-ops'; end if;
    if exists(
      with incoming as (
        select value#>>'{}' as work_id from jsonb_array_elements(v_payload->'removeWorkIds')
        union select value->>'workId' from jsonb_array_elements(v_payload->'patchWork')
        union select value->>'workId' from jsonb_array_elements(v_payload->'addWork')
      ), accepted as (
        select e.payload_json from public.weekly_schedule_exception_commands e
        where e.publication_id=p_publication_id and e.exception_type='event_impact'
          and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)
      ), prior_targets as (
        select value#>>'{}' as work_id from accepted,jsonb_array_elements(coalesce(payload_json->'removeWorkIds','[]'::jsonb))
        union select value->>'workId' from accepted,jsonb_array_elements(coalesce(payload_json->'patchWork','[]'::jsonb))
        union select value->>'workId' from accepted,jsonb_array_elements(coalesce(payload_json->'addWork','[]'::jsonb))
      ) select 1 from incoming join prior_targets using(work_id)
    ) then raise exception using errcode='23514',message='event target already has accepted active event semantics'; end if;
  elsif p_exception_type='reverse' then
    perform public.static_weekly_assert_exact_object(v_payload,array['reversesExceptionId'],array['reversesExceptionId'],'reverse payload');
    if p_starts_at is not null or p_ends_at is not null or v_payload->>'reversesExceptionId' is distinct from p_reverses_exception_id::text then raise exception using errcode='23514',message='reverse payload must exactly identify its one reversal target'; end if;
  else
    raise exception using errcode='23514',message='unsupported exception type';
  end if;
end
$function$;

create or replace function public.static_weekly_rollback_semantic_snapshot(p_document jsonb)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $function$
  select jsonb_set(
    jsonb_set(
      (p_document#>'{semantic_snapshot,recurring_source}')-'serviceDate'-'slots',
      '{version}',
      coalesce(p_document#>'{semantic_snapshot,recurring_source,version}','{}'::jsonb)-'id'-'publicationId'-'effectiveStart'-'effectiveEnd'-'status'-'contentDigest',true),
    '{slots}',
    coalesce((select jsonb_agg(jsonb_build_object('id',s.value->'id','label',s.value->'label') order by s.value->>'id')
      from jsonb_array_elements(coalesce(p_document#>'{semantic_snapshot,recurring_source,slots}','[]'::jsonb)) s(value)),'[]'::jsonb),true)
$function$;

create or replace function public.static_weekly_v2_create_draft(
  p_effective_start date,p_objective_version text,p_objective jsonb,p_input_provenance jsonb,p_document jsonb,
  p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_command uuid:=gen_random_uuid(); v_version uuid; v_content_digest text; v_revision bigint; v_response jsonb;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'create_draft');
  v_request:=jsonb_build_object('operation','create_draft','effective_start',p_effective_start,'objective_version',p_objective_version,'objective',p_objective,'input_provenance',p_input_provenance,'document',p_document,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  if p_effective_start is null or btrim(coalesce(p_objective_version,''))='' then raise exception using errcode='23514',message='complete draft command identity is required'; end if;
  perform public.static_weekly_assert_document_attested(p_document,p_effective_start,true);
  perform public.static_weekly_assert_exact_object(p_input_provenance,array['adapter_schema','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest'],array['adapter_schema','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest'],'draft input provenance');
  if jsonb_typeof(p_objective) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input_provenance) k(key) where jsonb_typeof(p_input_provenance->k.key) is distinct from 'string') or p_objective is distinct from p_document#>'{authority,optimizerResult,objective}' or p_objective_version is distinct from p_document#>>'{validation,compiler_version}' or p_input_provenance->>'adapter_schema' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1' or p_input_provenance->>'compiler_version' is distinct from p_document#>>'{validation,compiler_version}' or p_input_provenance->>'input_digest' is distinct from p_document#>>'{validation,input_digest}' or p_input_provenance->>'baseline_input_digest' is distinct from p_document#>>'{authority,baselineInputDigest}' or p_input_provenance->>'authority_digest' is distinct from p_document#>>'{validation,authority_digest}' or p_input_provenance->>'replay_digest' is distinct from p_document#>>'{validation,replay_digest}' then raise exception using errcode='23514',message='draft command may use only attested adapter-derived objective and provenance'; end if;
  begin v_version:=(p_document#>>'{authority,compilerInput,version,id}')::uuid; exception when others then raise exception using errcode='23514',message='compiler weekly version identity must be a canonical UUID'; end;
  v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('objective_version',p_objective_version,'objective',p_objective,'input_provenance',p_input_provenance,'document',p_document));
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'create_draft',p_actor_manager_id,p_actor_manager_name,v_command,v_content_digest);
  insert into public.weekly_schedule_versions(version_id,lifecycle_state,effective_start,objective_version,objective_json,input_provenance_json,draft_document,content_digest,created_by_manager_id,created_by_manager_name_snapshot) values(v_version,'draft',p_effective_start,p_objective_version,p_objective,p_input_provenance,p_document,v_content_digest,p_actor_manager_id,p_actor_manager_name);
  perform public.static_weekly_materialize_document(v_version,p_document,v_content_digest,p_actor_manager_id,p_actor_manager_name);
  v_response:=public.static_weekly_response_json('create_draft',v_revision,v_content_digest,v_request_digest,jsonb_build_object('version_id',v_version,'draft_revision',1,'effective_start',p_effective_start));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,'create_draft',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest); return v_response;
end
$function$;

create or replace function public.static_weekly_v2_update_draft(
  p_version_id uuid,p_document jsonb,p_objective jsonb,p_input_provenance jsonb,p_expected_draft_revision bigint,p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_version public.weekly_schedule_versions%rowtype; v_document_version_id uuid; v_command uuid:=gen_random_uuid(); v_content_digest text; v_revision bigint; v_response jsonb;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'update_draft');
  v_request:=jsonb_build_object('operation','update_draft','version_id',p_version_id,'document',p_document,'objective',p_objective,'input_provenance',p_input_provenance,'expected_draft_revision',p_expected_draft_revision,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name); v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key; if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  if p_version_id is null or p_expected_draft_revision is null or p_expected_draft_revision<1 then raise exception using errcode='23514',message='complete update draft identity is required'; end if;
  select * into v_version from public.weekly_schedule_versions where version_id=p_version_id and lifecycle_state='draft' and revision=p_expected_draft_revision for update; if not found then raise exception using errcode='40001',message='stale draft revision'; end if;
  perform public.static_weekly_assert_document_attested(p_document,v_version.effective_start,true); perform public.static_weekly_assert_exact_object(p_input_provenance,array['adapter_schema','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest'],array['adapter_schema','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest'],'update input provenance');
  begin v_document_version_id:=(p_document#>>'{authority,compilerInput,version,id}')::uuid; exception when others then raise exception using errcode='23514',message='compiler weekly version identity must be a canonical UUID'; end;
  if v_document_version_id is distinct from p_version_id then raise exception using errcode='23514',message='update document compiler version identity must exactly match p_version_id'; end if;
  if jsonb_typeof(p_objective) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input_provenance) k(key) where jsonb_typeof(p_input_provenance->k.key) is distinct from 'string') or p_objective is distinct from p_document#>'{authority,optimizerResult,objective}' or v_version.objective_version is distinct from p_document#>>'{validation,compiler_version}' or p_input_provenance->>'adapter_schema' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1' or p_input_provenance->>'compiler_version' is distinct from p_document#>>'{validation,compiler_version}' or p_input_provenance->>'input_digest' is distinct from p_document#>>'{validation,input_digest}' or p_input_provenance->>'baseline_input_digest' is distinct from p_document#>>'{authority,baselineInputDigest}' or p_input_provenance->>'authority_digest' is distinct from p_document#>>'{validation,authority_digest}' or p_input_provenance->>'replay_digest' is distinct from p_document#>>'{validation,replay_digest}' then raise exception using errcode='23514',message='update may use only attested adapter-derived objective and provenance'; end if;
  v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('version_id',p_version_id,'document',p_document,'objective',p_objective,'input_provenance',p_input_provenance)); v_revision:=public.static_weekly_advance_authority(p_expected_revision,'update_draft',p_actor_manager_id,p_actor_manager_name,v_command,v_content_digest); perform set_config('app.static_weekly_draft_write','on',true); update public.weekly_schedule_versions set draft_document=p_document,objective_json=p_objective,input_provenance_json=p_input_provenance,content_digest=v_content_digest,revision=revision+1 where version_id=p_version_id; perform public.static_weekly_materialize_document(p_version_id,p_document,v_content_digest,p_actor_manager_id,p_actor_manager_name);
  v_response:=public.static_weekly_response_json('update_draft',v_revision,v_content_digest,v_request_digest,jsonb_build_object('version_id',p_version_id,'draft_revision',p_expected_draft_revision+1)); insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,'update_draft',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest); return v_response;
end
$function$;

create or replace function public.static_weekly_v2_publish_draft(
  p_draft_version_id uuid,p_expected_draft_revision bigint,p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text,p_publication_kind text default 'publish',p_rollback_of_version_id uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_draft public.weekly_schedule_versions%rowtype; v_target public.weekly_schedule_versions%rowtype; v_command uuid:=gen_random_uuid(); v_publication uuid; v_revision bigint; v_version_number bigint; v_previous uuid; v_response jsonb; v_operation text;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'publish_draft');
  v_request:=jsonb_build_object('operation','publish_draft','draft_version_id',p_draft_version_id,'expected_draft_revision',p_expected_draft_revision,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name,'publication_kind',p_publication_kind,'rollback_of_version_id',p_rollback_of_version_id); v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key; if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  if p_draft_version_id is null or p_expected_draft_revision is null or p_expected_draft_revision<1 or p_publication_kind is null or p_publication_kind not in ('publish','supersede','rollback_compensation') then raise exception using errcode='23514',message='invalid publication kind'; end if;
  select * into v_draft from public.weekly_schedule_versions where version_id=p_draft_version_id and lifecycle_state='draft' and revision=p_expected_draft_revision for update; if not found then raise exception using errcode='40001',message='stale draft revision'; end if;
  perform public.static_weekly_assert_document_attested(v_draft.draft_document,v_draft.effective_start,true);
  if not exists(select 1 from public.weekly_schedule_slot_availability a where a.version_id=v_draft.version_id) or not exists(select 1 from public.weekly_schedule_slot_assignments a where a.version_id=v_draft.version_id) then raise exception using errcode='23514',message='document relational projection is incomplete'; end if;
  select version_id into v_previous from public.weekly_schedule_versions where lifecycle_state='published' order by effective_start desc,version_number desc limit 1;
  if v_previous is null then
    if p_publication_kind<>'publish' or p_rollback_of_version_id is not null then raise exception using errcode='23514',message='the first weekly authority publication must be labeled publish'; end if;
  else
    if v_draft.effective_start <= (select effective_start from public.weekly_schedule_versions where version_id=v_previous) then raise exception using errcode='23514',message='new authority must have a later effective start'; end if;
    if p_publication_kind='publish' then raise exception using errcode='23514',message='a later ordinary authority replacement must be labeled supersede'; end if;
    if p_publication_kind='supersede' and p_rollback_of_version_id is not null then raise exception using errcode='23514',message='supersede may not claim a rollback target'; end if;
  end if;
  if p_publication_kind='rollback_compensation' then
    select * into v_target from public.weekly_schedule_versions where version_id=p_rollback_of_version_id and lifecycle_state='published';
    if not found or p_rollback_of_version_id is null or public.static_weekly_rollback_semantic_snapshot(v_draft.draft_document) is distinct from public.static_weekly_rollback_semantic_snapshot(v_target.draft_document) then raise exception using errcode='23514',message='rollback compensation must restore the target recurring semantics with new version and effective-date identities'; end if;
  elsif p_rollback_of_version_id is not null then raise exception using errcode='23514',message='only rollback compensation accepts a rollback target'; end if;
  v_operation:=case p_publication_kind when 'rollback_compensation' then 'rollback' when 'supersede' then 'supersede' else 'publish' end; v_revision:=public.static_weekly_advance_authority(p_expected_revision,v_operation,p_actor_manager_id,p_actor_manager_name,v_command,v_draft.content_digest); select coalesce(max(version_number),0)+1 into v_version_number from public.weekly_schedule_versions where lifecycle_state='published';
  begin v_publication:=(v_draft.draft_document#>>'{authority,compilerInput,version,publicationId}')::uuid; exception when others then raise exception using errcode='23514',message='compiler publication identity must be a canonical UUID'; end;
  perform set_config('app.static_weekly_publish_write','on',true); update public.weekly_schedule_versions set version_number=v_version_number,lifecycle_state='published',publication_kind=p_publication_kind,rollback_of_version_id=p_rollback_of_version_id,published_by_manager_id=p_actor_manager_id,published_by_manager_name_snapshot=p_actor_manager_name,published_at=statement_timestamp() where version_id=v_draft.version_id;
  v_response:=public.static_weekly_response_json(v_operation,v_revision,v_draft.content_digest,v_request_digest,jsonb_build_object('version_id',v_draft.version_id,'version_number',v_version_number,'publication_id',v_publication,'effective_start',v_draft.effective_start,'replay_digest',v_draft.draft_document#>>'{validation,replay_digest}','rollback_of_version_id',p_rollback_of_version_id));
  insert into public.weekly_schedule_publications(publication_id,version_id,authority_revision,publication_kind,effective_start,prior_version_id,expected_revision,idempotency_key,actor_manager_id,actor_manager_name_snapshot,request_digest,replay_digest,content_digest,output_digest) values(v_publication,v_draft.version_id,v_revision,p_publication_kind,v_draft.effective_start,v_previous,p_expected_revision,p_idempotency_key,p_actor_manager_id,p_actor_manager_name,v_request_digest,v_draft.draft_document#>>'{validation,replay_digest}',v_draft.content_digest,v_response->>'output_digest');
  if v_previous is not null then insert into public.weekly_schedule_effective_range_closures(closed_version_id,closed_at_effective_date,superseding_version_id,publication_id,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(v_previous,v_draft.effective_start,v_draft.version_id,v_publication,p_actor_manager_id,p_actor_manager_name,v_draft.content_digest); end if;
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,v_operation,p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_draft.content_digest); return v_response;
end
$function$;

create or replace function public.static_weekly_v2_apply_exception(
  p_exception_type text,p_service_date date,p_starts_at time,p_ends_at time,p_base_version_id uuid,p_publication_id uuid,p_reason text,p_payload jsonb,p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text,p_reverses_exception_id uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_command uuid:=gen_random_uuid(); v_exception uuid:=gen_random_uuid(); v_payload jsonb:=coalesce(p_payload,'{}'::jsonb); v_payload_digest text; v_revision bigint; v_response jsonb; v_target public.weekly_schedule_exception_commands%rowtype; v_operation text;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'apply_exception');
  v_request:=jsonb_build_object('operation','apply_exception','exception_type',p_exception_type,'service_date',p_service_date,'starts_at',p_starts_at,'ends_at',p_ends_at,'base_version_id',p_base_version_id,'publication_id',p_publication_id,'reason',p_reason,'payload',v_payload,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name,'reverses_exception_id',p_reverses_exception_id); v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key; if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  if p_exception_type is null or p_exception_type not in ('pto','daily_absence','partial_absence','shift_override','cover_all','lunch','nine_forty_five_rebalance','event_impact','manager_correction','reverse') or p_service_date is null or p_base_version_id is null or p_publication_id is null or btrim(coalesce(p_reason,''))='' or jsonb_typeof(p_payload) is distinct from 'object' or ((p_starts_at is null)<>(p_ends_at is null)) or (p_starts_at is not null and p_starts_at>=p_ends_at) then raise exception using errcode='23514',message='complete exception semantic inputs are required'; end if;
  if not exists(select 1 from public.weekly_schedule_publications where publication_id=p_publication_id and version_id=p_base_version_id) or public.static_weekly_effective_version(p_service_date) is distinct from p_base_version_id then raise exception using errcode='23514',message='exception must bind its effective publication and version'; end if;
  if (p_exception_type='reverse') is distinct from (p_reverses_exception_id is not null) then raise exception using errcode='23514',message='reversal target coherence is required'; end if;
  perform public.static_weekly_assert_exception_payload(p_exception_type,p_service_date,p_starts_at,p_ends_at,p_base_version_id,p_publication_id,v_payload,p_reverses_exception_id);
  if p_exception_type='reverse' then select * into v_target from public.weekly_schedule_exception_commands where exception_id=p_reverses_exception_id; if not found or v_target.exception_type='reverse' or v_target.service_date is distinct from p_service_date or v_target.base_version_id is distinct from p_base_version_id or v_target.publication_id is distinct from p_publication_id or exists(select 1 from public.weekly_schedule_exception_commands where reverses_exception_id=p_reverses_exception_id) then raise exception using errcode='23514',message='reversal must target one compatible unreversed exception'; end if; end if;
  v_payload_digest:=public.static_weekly_digest_jsonb(v_payload); v_operation:=case when p_exception_type='reverse' then 'reverse_exception' else 'apply_exception' end; v_revision:=public.static_weekly_advance_authority(p_expected_revision,v_operation,p_actor_manager_id,p_actor_manager_name,v_command,v_payload_digest);
  insert into public.weekly_schedule_exception_commands(exception_id,authority_revision,exception_type,service_date,starts_at,ends_at,base_version_id,publication_id,reverses_exception_id,expected_revision,idempotency_key,actor_manager_id,actor_manager_name_snapshot,reason,payload_json,payload_digest) values(v_exception,v_revision,p_exception_type,p_service_date,p_starts_at,p_ends_at,p_base_version_id,p_publication_id,p_reverses_exception_id,p_expected_revision,p_idempotency_key,p_actor_manager_id,p_actor_manager_name,p_reason,v_payload,v_payload_digest);
  v_response:=public.static_weekly_response_json(v_operation,v_revision,v_payload_digest,v_request_digest,jsonb_build_object('exception_id',v_exception,'exception_type',p_exception_type,'service_date',p_service_date,'payload_digest',v_payload_digest,'sequence',v_revision)); insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,v_operation,p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_payload_digest); return v_response;
end
$function$;

create or replace function public.static_weekly_v2_materialize_projection(
  p_publication_id uuid,p_service_date date,p_exception_set_digest text,p_compiler_version text,p_objective jsonb,p_metrics jsonb,p_replay_digest text,p_assignments jsonb,p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_publication public.weekly_schedule_publications%rowtype; v_exception_set jsonb; v_exception_digest text; v_command uuid:=gen_random_uuid(); v_projection uuid:=gen_random_uuid(); v_revision bigint; v_content_digest text; v_response jsonb; v_item jsonb; v_assignment public.weekly_schedule_slot_assignments%rowtype; v_owner public.v_weekly_roster_slot_incumbency_ranges%rowtype; v_occurrence uuid; v_work jsonb;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'materialize_projection'); v_request:=jsonb_build_object('operation','materialize_projection','publication_id',p_publication_id,'service_date',p_service_date,'exception_set_digest',p_exception_set_digest,'compiler_version',p_compiler_version,'objective',p_objective,'metrics',p_metrics,'replay_digest',p_replay_digest,'projection_envelope',p_assignments,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name); v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key; if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  select * into v_publication from public.weekly_schedule_publications where publication_id=p_publication_id; if not found or p_service_date is null or public.static_weekly_effective_version(p_service_date) is distinct from v_publication.version_id then raise exception using errcode='23514',message='projection must bind an effective publication'; end if; if p_service_date is distinct from (select effective_start from public.weekly_schedule_versions where version_id=v_publication.version_id) then raise exception using errcode='23514',message='projection must materialize the deterministic compiler seven-day horizon from its authority start'; end if;
  v_exception_set:=public.static_weekly_accepted_exception_set(p_publication_id,p_service_date); v_exception_digest:=public.static_weekly_digest_jsonb(v_exception_set); if p_exception_set_digest is distinct from v_exception_digest or p_compiler_version is distinct from p_assignments->>'compiler_version' or p_objective is distinct from p_assignments->'objective' or p_metrics is distinct from p_assignments->'metrics' or p_replay_digest is distinct from p_assignments->>'replay_digest' then raise exception using errcode='23514',message='projection command identity must include exact compiler, objective, metrics, replay, and weekly exception authority'; end if;
  perform public.static_weekly_assert_projection_envelope_attested(p_assignments,p_publication_id,p_service_date,v_exception_set); if exists(select 1 from public.weekly_schedule_compiled_projections where publication_id=p_publication_id and week_start=p_service_date and exception_set_digest=v_exception_digest and compiler_version=p_compiler_version) then raise exception using errcode='23505',message='immutable projection already exists for this exact weekly authority'; end if;
  v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('publication_id',p_publication_id,'week_start',p_service_date,'exception_set_digest',v_exception_digest,'compiler_version',p_compiler_version,'objective',p_objective,'metrics',p_metrics,'replay_digest',p_replay_digest,'projection_envelope_identity',p_assignments->>'database_projection_identity','attestation',p_assignments->'attestation')); v_revision:=public.static_weekly_advance_authority(p_expected_revision,'materialize_projection',p_actor_manager_id,p_actor_manager_name,v_command,v_content_digest);
  insert into public.weekly_schedule_compiled_projections(projection_id,publication_id,version_id,week_start,week_end,exception_set_json,exception_set_digest,compiler_version,objective_json,metrics_json,replay_digest,authority_digest,receipt_json,projection_envelope,compiled_by_manager_id) values(v_projection,p_publication_id,v_publication.version_id,p_service_date,p_service_date+6,v_exception_set,v_exception_digest,p_compiler_version,p_objective,p_metrics,p_replay_digest,p_assignments->>'authority_digest',p_assignments->'receipt',p_assignments,p_actor_manager_id);
  for v_item in select value from jsonb_array_elements(p_assignments->'assignments') loop
    v_owner:=null; v_assignment:=null; v_work:=v_item->'work_snapshot'; select * into v_assignment from public.weekly_schedule_slot_assignments where version_id=v_publication.version_id and day_of_week=(v_item->>'day_of_week')::smallint and work_id=v_item->>'work_id'; if v_assignment.assignment_id is null and (v_work->>'overlayWork') is distinct from 'true' then raise exception using errcode='23514',message='active baseline work must retain its stored baseline assignment link'; end if;
    if upper(v_item->>'status')='ASSIGNED' then select * into v_owner from public.v_weekly_roster_slot_incumbency_ranges where slot_id=(v_item->>'owner_slot_id')::uuid and effective_start<=(v_item->>'service_date')::date and (effective_end is null or (v_item->>'service_date')::date<effective_end); if not found or v_owner.person_id::text is distinct from v_item->>'owner_person_id' then raise exception using errcode='23514',message='projection assigned owner lacks an effective dated incumbent',detail=format('slot=%s service_date=%s authoritative_person=%s supplied_person=%s',v_item->>'owner_slot_id',v_item->>'service_date',coalesce(v_owner.person_id::text,'none'),coalesce(v_item->>'owner_person_id','none')); end if; elsif upper(v_item->>'status') not in ('OPEN','REVIEW') or v_item->>'owner_slot_id' is not null or v_item->>'owner_person_id' is not null then raise exception using errcode='23514',message='open and review projection rows must have null owner facts'; end if;
    insert into public.weekly_schedule_occurrences(projection_id,publication_id,version_id,assignment_id,service_date,work_id,day_of_week,location_id,location_code_snapshot,location_name_snapshot,coverage_start,coverage_end,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,state,state_reason,original_actor_person_id,original_actor_name_snapshot,authority_facts_json,occurrence_digest) values(v_projection,p_publication_id,v_publication.version_id,v_assignment.assignment_id,(v_item->>'service_date')::date,v_item->>'work_id',(v_item->>'day_of_week')::smallint,nullif(v_work->>'locationId','')::uuid,coalesce(v_work->>'locationCodeSnapshot',v_item->>'work_id'),coalesce(v_work->>'locationNameSnapshot',v_item->>'work_id'),(v_work#>>'{window,start}')::time,(v_work#>>'{window,end}')::time,case when lower(v_item->>'status')='assigned' then (v_item->>'owner_slot_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then (select slot_label from public.weekly_roster_slots where slot_id=(v_item->>'owner_slot_id')::uuid) else null end,case when lower(v_item->>'status')='assigned' then (v_item->>'owner_person_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then v_owner.person_name_snapshot else null end,case lower(v_item->>'status') when 'assigned' then 'created' when 'open' then 'open' else 'review' end,v_item->>'reason_code',nullif(v_item->>'original_actor_person_id','')::uuid,nullif(v_item->>'original_actor_name',''),jsonb_build_object('baseline_owner_slot_id',v_item->>'baseline_owner_slot_id','baseline_owner_person_id',v_item->>'baseline_owner_person_id','baseline_owner_name',v_item->>'baseline_owner_name','original_actor_person_id',v_item->>'original_actor_person_id','original_actor_name',v_item->>'original_actor_name','optimized_owner_slot_id',v_item->>'optimized_owner_slot_id','optimized_owner_person_id',v_item->>'optimized_owner_person_id','actual_actor_person_id',v_item->>'actual_actor_person_id','work_snapshot',v_work),public.static_weekly_digest_jsonb(v_item)) returning occurrence_id into v_occurrence;
    insert into public.weekly_schedule_projection_assignments(projection_id,occurrence_id,work_id,status,reason_code,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,authority_facts_json,explanation_json,content_digest) values(v_projection,v_occurrence,v_item->>'work_id',lower(v_item->>'status'),v_item->>'reason_code',case when lower(v_item->>'status')='assigned' then (v_item->>'owner_slot_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then (select slot_label from public.weekly_roster_slots where slot_id=(v_item->>'owner_slot_id')::uuid) else null end,case when lower(v_item->>'status')='assigned' then (v_item->>'owner_person_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then v_owner.person_name_snapshot else null end,(select authority_facts_json from public.weekly_schedule_occurrences where occurrence_id=v_occurrence),coalesce(v_item->'explanation','{}'::jsonb),public.static_weekly_digest_jsonb(v_item));
  end loop;
  v_response:=public.static_weekly_response_json('materialize_projection',v_revision,v_content_digest,v_request_digest,jsonb_build_object('projection_id',v_projection,'publication_id',p_publication_id,'week_start',p_service_date,'week_end',p_service_date+6,'replay_digest',p_replay_digest)); insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,'materialize_projection',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest); return v_response;
end
$function$;

do $security$
declare proc record; r text;
begin
  alter table public.static_weekly_authority_attestation_config enable row level security;
  alter table public.static_weekly_authority_attestation_config force row level security;
  revoke all on table public.static_weekly_authority_attestation_config from public,anon,authenticated,service_role;
  for proc in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'static_weekly%' loop
    execute format('revoke all on function %s from public',proc.signature);
    foreach r in array array['anon','authenticated','service_role'] loop if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on function %s from %I',proc.signature,r); end if; end loop;
  end loop;
end
$security$;

grant execute on function public.static_weekly_v2_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text) to service_role;
grant execute on function public.static_weekly_v2_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text,text) to service_role;
grant execute on function public.static_weekly_v2_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid) to service_role;
grant execute on function public.static_weekly_v2_apply_exception(text,date,time,time,uuid,uuid,text,jsonb,bigint,uuid,text,text,uuid) to service_role;
grant execute on function public.static_weekly_v2_replace_incumbency(uuid,uuid,text,date,bigint,uuid,text,text) to service_role;
grant execute on function public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text) to service_role;

comment on table public.static_weekly_authority_attestation_config is 'Private deployment configuration. Configure STATIC_WEEKLY_AUTHORITY_ATTESTATION_SECRET through a privileged release path; never commit, expose, or grant this HMAC key to service_role.';
comment on function public.static_weekly_v2_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid) is 'Lifecycle: first publication is publish; later ordinary replacements are supersede; rollback_compensation restores a prior recurring semantic snapshot with a new version UUID, publication UUID, effective date, revision, audit identity, and immutable rollback link.';

commit;
