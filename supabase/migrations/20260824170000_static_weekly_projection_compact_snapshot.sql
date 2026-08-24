-- Keep the dated projection proof exact while removing three redundant JSON
-- copies from every materialization request.  The prior v1 snapshot repeated
-- both compiler sources and all active assignments inside an envelope that
-- already carried those values.  Production-sized publication therefore
-- spent the complete statement budget copying and comparing redundant JSON.
begin;

create or replace function public.static_weekly_assert_projection_envelope_attested(
  p_envelope jsonb,p_publication_id uuid,p_week_start date,p_exception_set jsonb
) returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare
  v_legacy jsonb;
  v_snapshot jsonb;
  v_document jsonb;
  v_recurring_source_digest text;
  v_published_source_digest text;
  v_overlay_source_digest text;
begin
  perform public.static_weekly_assert_exact_object(
    p_envelope,
    array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity','semantic_snapshot','attestation'],
    array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity','semantic_snapshot','attestation'],
    'attested projection envelope'
  );
  perform public.static_weekly_assert_authority_attestation(
    p_envelope->'attestation','dated_projection',public.static_weekly_projection_attestation_payload(p_envelope)
  );
  if p_envelope->>'database_projection_identity' is distinct from
     public.static_weekly_digest_jsonb((p_envelope-'attestation')-'database_projection_identity') then
    raise exception using errcode='23514',message='projection semantic identity must bind the complete attested envelope';
  end if;

  v_snapshot:=p_envelope->'semantic_snapshot';
  perform public.static_weekly_assert_exact_object(
    v_snapshot,
    array['schema','recurring_source_digest','overlay_source_digest','applied_exceptions_digest','active_assignments_digest'],
    array['schema','recurring_source_digest','overlay_source_digest','applied_exceptions_digest','active_assignments_digest'],
    'projection semantic snapshot'
  );
  if exists(
    select 1
    from unnest(array['recurring_source_digest','overlay_source_digest','applied_exceptions_digest','active_assignments_digest']) field_name
    where jsonb_typeof(v_snapshot->field_name) is distinct from 'string'
       or coalesce(v_snapshot->>field_name,'') !~ '^[0-9a-f]{64}$'
  ) then
    raise exception using errcode='23514',message='projection semantic snapshot requires exact canonical SHA-256 identities';
  end if;

  select v.draft_document into v_document
  from public.weekly_schedule_versions v
  join public.weekly_schedule_publications p on p.version_id=v.version_id
  where p.publication_id=p_publication_id;
  if not found then
    raise exception using errcode='23514',message='projection publication is unknown';
  end if;

  v_recurring_source_digest:=public.static_weekly_digest_jsonb(
    public.static_weekly_v5_projection_source_identity(p_envelope#>'{authority,compilerInput}')
  );
  v_published_source_digest:=public.static_weekly_digest_jsonb(
    public.static_weekly_v5_projection_source_identity(v_document#>'{authority,compilerInput}')
  );
  v_overlay_source_digest:=public.static_weekly_digest_jsonb(
    public.static_weekly_v5_projection_source_identity(p_envelope#>'{authority,overlayCompilerInput}')
  );

  if v_snapshot->>'schema' is distinct from 'memphis-zoo.static-weekly-projection-semantic-snapshot.v2'
    or v_snapshot->>'recurring_source_digest' is distinct from v_recurring_source_digest
    or v_snapshot->>'recurring_source_digest' is distinct from v_published_source_digest
    or v_snapshot->>'overlay_source_digest' is distinct from v_overlay_source_digest
    or v_snapshot->>'applied_exceptions_digest' is distinct from public.static_weekly_digest_jsonb(p_envelope->'applied_exceptions')
    or v_snapshot->>'active_assignments_digest' is distinct from public.static_weekly_digest_jsonb(p_envelope->'assignments') then
    raise exception using errcode='23514',message='projection must bind stable recurring source, dated staffing and exceptions, and active assignments';
  end if;

  -- The established v4 validator still performs the complete structural,
  -- optimizer, work-snapshot, service-mode, and location checks.  Only the
  -- redundant semantic copies have been replaced by independently recomputed
  -- identities.
  v_legacy:=p_envelope-'semantic_snapshot'-'attestation';
  v_legacy:=jsonb_set(
    v_legacy,'{database_projection_identity}',
    to_jsonb(public.static_weekly_digest_jsonb(v_legacy-'database_projection_identity')),true
  );
  perform public.static_weekly_v4_assert_projection_envelope(
    v_legacy,p_publication_id,p_week_start,p_exception_set
  );
end
$function$;

revoke all on function public.static_weekly_assert_projection_envelope_attested(jsonb,uuid,date,jsonb)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

comment on function public.static_weekly_assert_projection_envelope_attested(jsonb,uuid,date,jsonb) is
'Validates one compact v2 dated-projection semantic snapshot by recomputing every source, exception, and active-assignment digest before the established complete structural validator runs.';

commit;
