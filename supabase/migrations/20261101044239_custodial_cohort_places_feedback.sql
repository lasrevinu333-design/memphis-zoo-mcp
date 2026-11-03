-- Frozen solo audit F001/F002. Original named APIs and historical bytes preserved.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN

IF encode(extensions.digest(convert_to(pg_get_functiondef('public.capture_system_feedback_email_intent()'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM '88cd48d0f88921c54db35fb1aab538563055c688603262af21dd3507cb5f9c35' THEN RAISE EXCEPTION 'Cohort repair predecessor changed: capture_system_feedback_email_intent'; END IF;

IF encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_place_command(uuid,uuid,uuid,integer,text,timestamp with time zone,jsonb,text)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM 'ff1d449cdcfe241b4a3072cf16bd3136337cdda99cb7a57a7995eca1b71a143b' THEN RAISE EXCEPTION 'Cohort repair predecessor changed: custodial_place_command'; END IF;

IF encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_place_preview(uuid,timestamp with time zone)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM '0471bbc7736914abb7739e77428c1317ff77df0894a8c2dddb84cb30618fb267' THEN RAISE EXCEPTION 'Cohort repair predecessor changed: custodial_place_preview'; END IF;

IF encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_place_bridge_preview(uuid,text,uuid,text,uuid,timestamp with time zone,text)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM 'b6cc7dbc573fb27d514bf5172c0b971b4dea1cc9b31b8eacc54f695cdd884539' THEN RAISE EXCEPTION 'Cohort repair predecessor changed: custodial_place_bridge_preview'; END IF;

IF encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_place_bridge_confirm(uuid,uuid,uuid)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM 'ee30c09b6d93fda2458f2b833c109e1a16eb1d763ab7243d6e8da49ca11ac4ac' THEN RAISE EXCEPTION 'Cohort repair predecessor changed: custodial_place_bridge_confirm'; END IF;

IF encode(extensions.digest(convert_to(pg_get_functiondef('public.place_source_apply(uuid,uuid,uuid,timestamp with time zone)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM '3c563fba97d2766af4d4eb9a5efc30787fcc90546a4172a9d3ca4a25639cac65' THEN RAISE EXCEPTION 'Cohort repair predecessor changed: place_source_apply'; END IF;

IF encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_place_source_preview(uuid,text,uuid,text,jsonb,timestamp with time zone,text)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM '7cf11d98927eb7733d60e6aa57b554d036f5a5d7835f2cb93deccbfed2684f02' THEN RAISE EXCEPTION 'Cohort repair predecessor changed: custodial_place_source_preview'; END IF;

IF encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_place_source_confirm(uuid,uuid,uuid)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM 'a76b3aea04901564ac56ccc40292ce19abe3222b4e9320628a7fb1179d8c57f2' THEN RAISE EXCEPTION 'Cohort repair predecessor changed: custodial_place_source_confirm'; END IF;

IF encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_feedback_triage(uuid,uuid,uuid,uuid,text,text)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM '63dc4ae31192a20fba26eefe5e3f0bc01fe3c880017ccc5a441e75a1e55dfcc5' THEN RAISE EXCEPTION 'Cohort repair predecessor changed: custodial_feedback_triage'; END IF;

IF encode(extensions.digest(convert_to(pg_get_functiondef('custodial_leadership_private.record_operation_v1(jsonb,text,jsonb)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM 'b6468e209d2327f9c107d562b45c4dbc97a59620157847171bc384c910a6398b' THEN RAISE EXCEPTION 'Cohort repair predecessor changed: record_operation_v1'; END IF;

IF encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_leadership_record_operation_v1(uuid,uuid,text,text,jsonb)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM '57f33a5fca39a6ad35ce827615c8c9d799c1cda7067325dc1f73d203b0dffcaf' THEN RAISE EXCEPTION 'Cohort repair predecessor changed: custodial_leadership_record_operation_v1'; END IF;

IF encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM '85f210d504f8c779e1dd5ee3061240299b5c343a0901b30c065f504e05ad4f99' THEN RAISE EXCEPTION 'Cohort repair predecessor changed: custodial_feedback_triage_receipt'; END IF;

END $guard$;

CREATE FUNCTION custodial_leadership_private.assert_scoped_cohort_actor_v1(p_actor jsonb,p_manager uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $f$
DECLARE live jsonb;
BEGIN
 IF p_actor->>'actor_kind' IS DISTINCT FROM 'CUSTODIAL_LEADERSHIP_COHORT' OR p_actor->'owner' IS DISTINCT FROM 'false'::jsonb
 OR p_actor->>'identity_assurance' IS DISTINCT FROM 'SELF_ASSERTED_NAME' OR p_actor->'individual_identity_verified' IS DISTINCT FROM 'false'::jsonb
 OR p_actor->>'manager_id' IS DISTINCT FROM p_manager::text OR p_actor->>'request_id' IS NULL THEN
 RAISE EXCEPTION 'Original cohort actor required' USING ERRCODE='42501';END IF;
 live:=public.custodial_action_actor_v1(p_manager,(p_actor->>'credential_id')::uuid,p_actor->>'device_id','full_access','read');
 IF live->>'request_id' IS DISTINCT FROM p_actor->>'request_id' OR live->>'claimed_account_id' IS DISTINCT FROM p_actor->>'claimed_account_id'
 OR live->>'credential_id' IS DISTINCT FROM p_actor->>'credential_id' OR live->>'device_id' IS DISTINCT FROM p_actor->>'device_id'
 OR live->>'policy_version' IS DISTINCT FROM p_actor->>'policy_version' THEN RAISE EXCEPTION 'Current original cohort context required' USING ERRCODE='42501';END IF;
END $f$;

REVOKE ALL ON FUNCTION custodial_leadership_private.assert_scoped_cohort_actor_v1(jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE FUNCTION custodial_leadership_private.custodial_place_command_cohort_v1(p_actor jsonb, p_request uuid, p_manager uuid, p_place uuid, p_expected_revision integer, p_action text, p_effective_at timestamp with time zone, p_payload jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare old public.custodial_place_versions%rowtype; replay public.custodial_place_versions%rowtype;
 state jsonb; args_hash text; at_time timestamptz:=coalesce(p_effective_at,statement_timestamp());
 code text; physical uuid; names jsonb; allowed text[]; item record;
begin
 PERFORM custodial_leadership_private.assert_scoped_cohort_actor_v1(p_actor,p_manager);
 if p_request is null or p_place is null or p_expected_revision is null or p_expected_revision<0
  or p_action is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500
  or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>32768 then
  raise exception using errcode='22023',message='Invalid place command';
 end if;
 allowed:=case p_action when 'add' then array['canonical_code','display_name','aliases','cleaning_mode','event_eligible','physical_location_id']
  when 'rename' then array['display_name'] when 'aliases' then array['aliases']
  when 'deactivate' then array[]::text[] when 'reactivate' then array[]::text[]
  when 'merge' then array['target_place_id'] when 'reclassify' then array['cleaning_mode','event_eligible']
  when 'reverse' then array[]::text[] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_payload) k where not k=any(allowed)) then
  raise exception using errcode='22023',message='Unknown place action or fields';
 end if;
 args_hash:=encode(extensions.digest(convert_to(jsonb_build_array(p_manager,p_place,p_expected_revision,p_action,p_effective_at,p_payload,p_reason)::text,'UTF8'),'sha256'),'hex');
 perform 1 from public.custodial_place_control where singleton for update;
 select * into replay from public.custodial_place_versions where request_id=p_request;
 if found then
  if replay.argument_sha256<>args_hash then raise exception using errcode='23505',message='Place request identity conflict'; end if;
  return replay.snapshot||jsonb_build_object('place_id',replay.place_id,'revision',replay.revision,
   'effective_at',replay.effective_at,'actor_manager_id',replay.actor_manager_id,'replayed',true);
 end if;
 if at_time<statement_timestamp() then raise exception using errcode='22023',message='Place changes cannot rewrite past effective history'; end if;
 select * into old from public.custodial_place_versions where place_id=p_place order by revision desc limit 1;
 if coalesce(old.revision,0)<>p_expected_revision then raise exception using errcode='40001',message='Place revision changed; preview again'; end if;
 if old.effective_at>at_time then raise exception using errcode='22023',message='Place effective dates must be appended monotonically'; end if;
 if p_action='add' then
  if old.revision is not null or p_expected_revision<>0 then raise exception using errcode='23505',message='Canonical place already exists'; end if;
  code:=p_payload->>'canonical_code'; physical:=(p_payload->>'physical_location_id')::uuid;
  insert into public.custodial_places(place_id,canonical_code,physical_location_id) values(p_place,code,physical);
  state:=jsonb_build_object('display_name',p_payload->>'display_name','aliases',coalesce(p_payload->'aliases','[]'::jsonb),
   'active',true,'cleaning_mode',coalesce(p_payload->>'cleaning_mode','NEVER_CLEAN'),
   'event_eligible',coalesce(p_payload->'event_eligible','false'::jsonb),'merged_into',null);
 else
  if old.revision is null then raise exception using errcode='22023',message='Unknown canonical place'; end if;
  select canonical_code,physical_location_id into code,physical from public.custodial_places where place_id=p_place;
  state:=old.snapshot;
  if state->>'merged_into' is not null and p_action<>'reverse' then raise exception using errcode='23514',message='Reverse the merge before editing its source'; end if;
  case p_action
   when 'rename' then state:=jsonb_set(state,'{display_name}',coalesce(p_payload->'display_name','null'::jsonb));
   when 'aliases' then state:=jsonb_set(state,'{aliases}',coalesce(p_payload->'aliases','null'::jsonb));
   when 'deactivate' then state:=jsonb_set(state,'{active}','false'::jsonb);
   when 'reactivate' then state:=jsonb_set(state,'{active}','true'::jsonb);
   when 'reclassify' then
    if not (p_payload ? 'cleaning_mode' or p_payload ? 'event_eligible') then raise exception 'Classification change required'; end if;
    state:=state||p_payload;
   when 'merge' then
    if physical is not null then raise exception using errcode='55000',message='Physical-place merge needs a verified tag/schedule cutover preview'; end if;
    if (p_payload->>'target_place_id')::uuid=p_place
      or public.place_lifecycle_root((p_payload->>'target_place_id')::uuid,at_time) is null then
     raise exception using errcode='23514',message='Merge requires another active canonical target';
    end if;
    state:=state||jsonb_build_object('active',false,'merged_into',(p_payload->>'target_place_id')::uuid);
   when 'reverse' then
    if old.revision=1 then state:=state||jsonb_build_object('active',false,'merged_into',null);
    else select snapshot into state from public.custodial_place_versions where place_id=p_place and revision=old.revision-1; end if;
   else raise exception 'Unsupported place command';
  end case;
 end if;
 if jsonb_typeof(state->'display_name') is distinct from 'string' or length(btrim(state->>'display_name')) not between 1 and 200
   or public.place_lifecycle_normalize(state->>'display_name')=''
   or jsonb_typeof(state->'aliases') is distinct from 'array' or jsonb_array_length(state->'aliases')>128
   or coalesce(state->>'cleaning_mode','') not in ('SCAN_TRACKED','REMINDER_ONLY','NEVER_CLEAN')
   or jsonb_typeof(state->'event_eligible') is distinct from 'boolean' then
  raise exception using errcode='22023',message='Invalid name, aliases or independent classification';
 end if;
 if exists(select 1 from jsonb_array_elements(state->'aliases') a where jsonb_typeof(a)<>'string'
   or length(btrim(a#>>'{}')) not between 1 and 200 or public.place_lifecycle_normalize(a#>>'{}')='') then
  raise exception using errcode='22023',message='Aliases must be bounded explicit text';
 end if;
 if state->>'cleaning_mode'='SCAN_TRACKED' and physical is null then
  raise exception using errcode='23514',message='SCAN_TRACKED needs an explicitly mapped physical location';
 end if;
 if code='STINGRAYS' and (state->>'cleaning_mode'<>'NEVER_CLEAN' or state->>'event_eligible'<>'true'
   or physical is not null or state->>'merged_into' is not null) then
  raise exception using errcode='23514',message='Stingrays remains event-eligible NEVER_CLEAN';
 end if;
 -- Every name remains an explicit historical alias. No fuzzy match remaps data.
 select jsonb_agg(name order by name) into names from (
  select distinct value name from jsonb_array_elements_text(state->'aliases')
  union select state->>'display_name' union select old.snapshot->>'display_name' where old.snapshot is not null
 ) n where name is not null;
 if jsonb_array_length(names)>128 then raise exception using errcode='22023',message='Aliases including retained names must remain bounded'; end if;
 state:=jsonb_set(state,'{aliases}',names);
 insert into public.custodial_place_versions(place_id,revision,request_id,actor_manager_id,action,reason,effective_at,argument_sha256,snapshot)
  values(p_place,coalesce(old.revision,0)+1,p_request,p_manager,p_action,p_reason,at_time,args_hash,state);
 perform public.place_lifecycle_assert_aliases(at_time);
 return state||jsonb_build_object('place_id',p_place,'revision',coalesce(old.revision,0)+1,'effective_at',at_time,'actor_manager_id',p_manager);
end;
$function$
;

REVOKE ALL ON FUNCTION custodial_leadership_private.custodial_place_command_cohort_v1(jsonb,uuid,uuid,uuid,integer,text,timestamp with time zone,jsonb,text) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE FUNCTION custodial_leadership_private.custodial_place_preview_cohort_v1(p_actor jsonb, p_manager uuid, p_at timestamp with time zone DEFAULT statement_timestamp())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare places jsonb;
begin
 PERFORM custodial_leadership_private.assert_scoped_cohort_actor_v1(p_actor,p_manager);
 if p_at is null then raise exception using errcode='22023',message='Place preview time required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('place_id',p.place_id,'canonical_code',p.canonical_code,
  'physical_location_id',p.physical_location_id,'latest_revision',v.revision,
  'latest_effective_at',v.effective_at,'latest_snapshot',v.snapshot,
  'effective_snapshot',public.place_lifecycle_snapshot(p.place_id,p_at)) order by p.canonical_code),'[]'::jsonb)
 into places from public.custodial_places p cross join lateral
  (select revision,effective_at,snapshot from public.custodial_place_versions where place_id=p.place_id order by revision desc limit 1) v;
 return jsonb_build_object('as_of',p_at,'places',places,'legacy_consumer_cutover',false);
end;
$function$
;

REVOKE ALL ON FUNCTION custodial_leadership_private.custodial_place_preview_cohort_v1(jsonb,uuid,timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE FUNCTION custodial_leadership_private.custodial_place_bridge_preview_cohort_v1(p_actor jsonb, p_manager uuid, p_legacy_kind text, p_legacy_id uuid, p_action text, p_target uuid, p_effective_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare source jsonb;sha text;old public.custodial_place_bridge_versions%rowtype;prior public.custodial_place_bridge_versions%rowtype;
 target uuid;active_state boolean;head jsonb;proposal jsonb;overlay jsonb;id uuid:=gen_random_uuid();clock timestamptz:=statement_timestamp();at_time timestamptz:=coalesce(p_effective_at,clock);
begin
 PERFORM custodial_leadership_private.assert_scoped_cohort_actor_v1(p_actor,p_manager);
 if p_legacy_kind is distinct from 'event_venue' then raise exception using errcode='55000',message='Physical/group bridge cutover is not implemented; all member identities remain untouched';end if;
 if p_legacy_id is null or p_action not in('map','deactivate','reactivate','reverse') or p_action is null
  or p_reason is null or length(btrim(p_reason)) not between 1 and 500 or not isfinite(at_time) or at_time<clock then raise exception using errcode='22023',message='Invalid bridge preview';end if;
 perform 1 from public.custodial_place_control where singleton for update;
 source:=public.place_bridge_source();if octet_length(source::text)>1048576 then raise exception using errcode='54000',message='Catalog exceeds bounded bridge source manifest';end if;
 if not exists(select 1 from public.event_venues venue where venue.id=p_legacy_id) then raise exception using errcode='22023',message='Unknown legacy venue UUID';end if;
 sha:=public.place_bridge_sha(source);
 select * into old from public.custodial_place_bridge_versions where legacy_kind=p_legacy_kind and legacy_id=p_legacy_id order by revision desc limit 1;
 if old.effective_at>at_time then raise exception using errcode='22023',message='Bridge effective timeline must be appended monotonically';end if;
 if p_action='map' then target:=p_target;active_state:=true;
 else
  if old.revision is null or p_target is not null then raise exception using errcode='22023',message='Existing bridge required; target is selected only by map';end if;
  target:=old.place_id;active_state:=p_action='reactivate';
  if p_action='reverse' and old.revision>1 then
   select * into prior from public.custodial_place_bridge_versions where legacy_kind=p_legacy_kind and legacy_id=p_legacy_id and revision=old.revision-1;
   target:=prior.place_id;active_state:=prior.active;
  end if;
 end if;
 select snapshot||jsonb_build_object('revision',revision,'effective_at',effective_at) into head from public.custodial_place_versions where place_id=target order by revision desc limit 1;
 if head is null then raise exception using errcode='22023',message='Explicit existing canonical target required';end if;
 proposal:=jsonb_build_object('legacy_kind',p_legacy_kind,'legacy_id',p_legacy_id,'action',p_action,'place_id',target,'active',active_state,
  'reason',p_reason,'requested_effective_at',p_effective_at,'expected_bridge_revision',coalesce(old.revision,0),
  'expected_canonical_revision',head->'revision','source_sha256',sha,'revision',coalesce(old.revision,0)+1);
 overlay:=public.place_bridge_overlay(at_time,proposal);
 if active_state and not exists(select 1 from jsonb_array_elements(overlay->'venues') x where x->>'venue_id'=p_legacy_id::text and x->>'mapping_status'='MAPPED') then
  raise exception using errcode='23514',message='Target or alias conflict requires review; no bridge preview is confirmable';end if;
 -- Preserve complete source inputs in immutable preview; no reference/history payload.
 proposal:=proposal||jsonb_build_object('source_snapshot',source,'current_effective_bridge',
  (select to_jsonb(x)-'receipt' from public.custodial_place_bridge_versions x where legacy_kind=p_legacy_kind and legacy_id=p_legacy_id and effective_at<=clock order by effective_at desc,revision desc limit 1),
  'latest_bridge',case when old.revision is not null then to_jsonb(old)-'receipt' else null end,'canonical_latest',head,
  'canonical_effective',public.place_lifecycle_snapshot(target,clock),'proposed_overlay',overlay);
 insert into public.custodial_place_bridge_previews values(id,p_manager,clock,clock+interval '10 minutes',proposal,public.place_bridge_sha(proposal));
 return jsonb_build_object('preview_id',id,'actor_manager_id',p_manager,'created_at',clock,'expires_at',clock+interval '10 minutes','proposal',proposal,'proposal_sha256',public.place_bridge_sha(proposal),'legacy_rows_mutated',false);
end $function$
;

REVOKE ALL ON FUNCTION custodial_leadership_private.custodial_place_bridge_preview_cohort_v1(jsonb,uuid,text,uuid,text,uuid,timestamp with time zone,text) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE FUNCTION custodial_leadership_private.custodial_place_bridge_confirm_cohort_v1(p_actor jsonb, p_request uuid, p_manager uuid, p_preview uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare view public.custodial_place_bridge_previews%rowtype;replay public.custodial_place_bridge_versions%rowtype;
 prop jsonb;source jsonb;overlay jsonb;rev integer;canonical_rev integer;at_time timestamptz;old_time timestamptz;receipt jsonb;
begin
 PERFORM custodial_leadership_private.assert_scoped_cohort_actor_v1(p_actor,p_manager);
 if p_request is null or p_preview is null then raise exception using errcode='22023',message='Stable request and original preview required';end if;
 perform 1 from public.custodial_place_control where singleton for update;
 select * into replay from public.custodial_place_bridge_versions where request_id=p_request;
 if found then
  if replay.actor_manager_id<>p_manager or replay.preview_id<>p_preview then raise exception using errcode='23505',message='Bridge request identity conflict';end if;
  return replay.receipt||jsonb_build_object('replayed',true);
 end if;
 select * into view from public.custodial_place_bridge_previews where preview_id=p_preview;
 if not found or view.actor_manager_id<>p_manager then raise exception using errcode='42501',message='Original manager preview required';end if;
 if view.expires_at<=clock_timestamp() then raise exception using errcode='40001',message='Bridge preview expired; review a fresh preview';end if;
 prop:=view.proposal;
 -- Fixed order, after the shared Place singleton: fence catalog write phantoms.
 lock table public.event_area_aliases,public.event_venues,public.location_group_aliases,public.location_group_memberships,public.location_groups,public.locations in share mode;
 if view.expires_at<=clock_timestamp() then raise exception using errcode='40001',message='Bridge preview expired while waiting; review again';end if;
 source:=public.place_bridge_source();
 if public.place_bridge_sha(source)<>prop->>'source_sha256' then raise exception using errcode='40001',message='Legacy catalog source changed; review again';end if;
 select revision,effective_at into rev,old_time from public.custodial_place_bridge_versions where legacy_kind=prop->>'legacy_kind' and legacy_id=(prop->>'legacy_id')::uuid order by revision desc limit 1;
 if coalesce(rev,0)<>(prop->>'expected_bridge_revision')::integer then raise exception using errcode='40001',message='Bridge revision changed';end if;
 select revision into canonical_rev from public.custodial_place_versions where place_id=(prop->>'place_id')::uuid order by revision desc limit 1;
 if canonical_rev is distinct from (prop->>'expected_canonical_revision')::integer then raise exception using errcode='40001',message='Canonical target changed';end if;
 at_time:=coalesce((prop->>'requested_effective_at')::timestamptz,clock_timestamp());
 if not isfinite(at_time) or at_time<clock_timestamp() and prop->>'requested_effective_at' is not null or old_time>at_time then raise exception using errcode='40001',message='Planned effective time elapsed or timeline changed';end if;
 overlay:=public.place_bridge_overlay(at_time,prop);
 if prop->'active'='true'::jsonb and not exists(select 1 from jsonb_array_elements(overlay->'venues') x where x->>'venue_id'=prop->>'legacy_id' and x->>'mapping_status'='MAPPED') then
  raise exception using errcode='23514',message='Current target or aliases require review';end if;
 receipt:=jsonb_build_object('request_id',p_request,'preview_id',p_preview,'actor_manager_id',p_manager,'legacy_rows_mutated',false,
  'data',jsonb_build_object('legacy_kind',prop->>'legacy_kind','legacy_id',prop->>'legacy_id','place_id',prop->>'place_id','revision',coalesce(rev,0)+1,
   'active',prop->'active','effective_at',at_time,'source_sha256',prop->>'source_sha256','action',prop->>'action'));
 insert into public.custodial_place_bridge_versions(legacy_kind,legacy_id,revision,place_id,active,effective_at,actor_manager_id,request_id,preview_id,action,reason,source_sha256,receipt)
 values(prop->>'legacy_kind',(prop->>'legacy_id')::uuid,coalesce(rev,0)+1,(prop->>'place_id')::uuid,(prop->>'active')::boolean,at_time,p_manager,p_request,p_preview,prop->>'action',prop->>'reason',prop->>'source_sha256',receipt);
 return receipt;
end $function$
;

REVOKE ALL ON FUNCTION custodial_leadership_private.custodial_place_bridge_confirm_cohort_v1(jsonb,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE FUNCTION custodial_leadership_private.place_source_apply_cohort_v1(p_actor jsonb, p_request uuid, p_manager uuid, p_preview uuid, p_at timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v public.custodial_place_source_previews%rowtype;a public.custodial_place_source_admissions%rowtype;p jsonb;rev integer;targetrev integer;
begin
 PERFORM custodial_leadership_private.assert_scoped_cohort_actor_v1(p_actor,p_manager);
 select * into v from public.custodial_place_source_previews where preview_id=p_preview;
 select * into a from public.custodial_place_source_admissions where request_id=p_request;
 p:=v.proposal;
 if v.actor_manager_id is distinct from p_manager or a.actor_manager_id is distinct from p_manager or a.preview_id is distinct from p_preview
  or a.transaction_id is distinct from txid_current() or a.argument_sha256 is distinct from public.place_bridge_sha(jsonb_build_array(p_request,p_manager,p_preview,p_at,p))
  or a.source_sha256 is distinct from public.place_bridge_sha(public.place_source_manifest())
  or a.dependency_sha256 is distinct from public.place_bridge_sha(public.place_source_dependencies()) then raise exception using errcode='42501',message='Private current-transaction full-argument admission required';end if;
 select max(revision) into rev from public.custodial_place_versions where place_id=(p->>'place_id')::uuid;
 select max(revision) into targetrev from public.custodial_place_versions where place_id=(p->>'target_place_id')::uuid;
 if coalesce(rev,0)<>a.source_head or coalesce(targetrev,0)<>a.target_head then raise exception using errcode='40001',message='Canonical source/target heads changed';end if;
 if p->>'action' in('add','enroll') then
  if p->>'action'='add' then
   if p->>'legacy_kind'='physical_location' then
    insert into public.locations(id,location_code,location_name,location_type,active) values((p->>'legacy_id')::uuid,p->'payload'->>'legacy_code',p->'canonical_snapshot'->>'display_name',p->'payload'->>'location_type',false);
   else
    insert into public.location_groups(id,group_code,group_name,active) values((p->>'legacy_id')::uuid,p->'payload'->>'legacy_code',p->'canonical_snapshot'->>'display_name',false);
    -- Legacy membership has UNIQUE(location_id). Proposed full members remain
    -- private setup metadata; no physical member is stolen from its group.
   end if;
  end if;
  insert into public.custodial_places(place_id,canonical_code,physical_location_id) values((p->>'place_id')::uuid,p->>'canonical_code',
   case when p->>'legacy_kind'='physical_location' then (p->>'legacy_id')::uuid else null end);
 end if;
 insert into public.custodial_place_versions(place_id,revision,request_id,actor_manager_id,action,reason,effective_at,argument_sha256,snapshot)
  values((p->>'place_id')::uuid,coalesce(rev,0)+1,p_request,p_manager,'source_'||(p->>'action'),p->>'reason',p_at,a.argument_sha256,p->'canonical_snapshot');
 perform public.place_lifecycle_assert_aliases(p_at);return coalesce(rev,0)+1;
end $function$
;

REVOKE ALL ON FUNCTION custodial_leadership_private.place_source_apply_cohort_v1(jsonb,uuid,uuid,uuid,timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE FUNCTION custodial_leadership_private.custodial_place_source_preview_cohort_v1(p_actor jsonb, p_manager uuid, p_kind text, p_id uuid, p_action text, p_payload jsonb, p_effective_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
<<source_preview>>
declare clock timestamptz:=statement_timestamp();at_time timestamptz:=coalesce(p_effective_at,clock);id uuid:=coalesce(p_id,gen_random_uuid());pid uuid;
 old public.custodial_place_source_versions%rowtype;prior public.custodial_place_source_versions%rowtype;
 raw jsonb;state jsonb;desired jsonb;source jsonb;deps jsonb;proposal jsonb;preview uuid:=gen_random_uuid();
 head integer:=0;target_head integer:=0;target uuid;target_state jsonb;allowed text[];members jsonb;names jsonb;code text;item record;check_at timestamptz;candidate_root uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 PERFORM custodial_leadership_private.assert_scoped_cohort_actor_v1(p_actor,p_manager);perform public.place_source_locks();
 if p_kind not in('physical_location','location_group') or p_kind is null or p_action is null
  or p_reason is null or length(btrim(p_reason)) not between 1 and 500 or p_payload is null or jsonb_typeof(p_payload)<>'object'
  or octet_length(p_payload::text)>32768 or not isfinite(at_time) or at_time<clock then raise exception using errcode='22023',message='Invalid operational metadata preview';end if;
 allowed:=case p_action when 'enroll' then array['canonical_code','display_name','aliases','cleaning_mode','event_eligible','metadata']
  when 'add' then array['canonical_code','legacy_code','display_name','aliases','cleaning_mode','event_eligible','location_type','member_location_ids','metadata']
  when 'rename' then array['display_name'] when 'aliases' then array['aliases']
  when 'reclassify' then array['cleaning_mode','event_eligible','metadata'] when 'memberships' then array['member_location_ids']
  when 'merge' then array['target_legacy_id'] when 'deactivate' then array[]::text[] when 'reactivate' then array[]::text[] when 'reverse' then array[]::text[] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_payload) k where not k=any(allowed)) then raise exception using errcode='22023',message='Unknown metadata action or fields';end if;
 raw:=public.place_source_row(p_kind,id);
 select * into old from public.custodial_place_source_versions where legacy_kind=p_kind and legacy_id=id order by revision desc limit 1;
 if p_action='add' then
  if p_id is not null or raw is not null then raise exception using errcode='22023',message='New UUID is server-issued only';end if;
  code:=p_payload->>'legacy_code';
  if code is null or code !~ '^[A-Z][A-Z0-9_]{0,79}$' then raise exception using errcode='22023',message='Explicit stable legacy code required';end if;
  if p_kind='physical_location' and exists(select 1 from public.locations where location_code=code)
   or p_kind='location_group' and exists(select 1 from public.location_groups where group_code=code) then raise exception using errcode='23505',message='Legacy stable code already exists';end if;
  if p_kind='physical_location' and (p_payload->>'location_type') not in('restroom','exhibit') or p_kind='physical_location' and p_payload->>'location_type' is null then raise exception using errcode='22023',message='Supported physical location type required';end if;
  if p_kind='physical_location' and p_payload ? 'member_location_ids' then raise exception using errcode='22023',message='A physical identity is not a group';end if;
 elsif p_id is null or raw is null then raise exception using errcode='22023',message='Explicit existing legacy UUID required';end if;
 if p_action in('add','enroll') then
  if old.revision is not null then raise exception using errcode='23505',message='Legacy identity already enrolled';end if;
  if p_kind='physical_location' and exists(select 1 from public.custodial_places where physical_location_id=id) then raise exception using errcode='55000',message='Existing canonical physical binding needs separate explicit reconciliation';end if;
  pid:=gen_random_uuid();state:=jsonb_build_object('display_name',p_payload->>'display_name','aliases',coalesce(p_payload->'aliases','[]'::jsonb),'active',true,
   'cleaning_mode',p_payload->>'cleaning_mode','event_eligible',p_payload->'event_eligible','merged_into',null);
  members:=case when p_kind='physical_location' then jsonb_build_array(id) when p_action='add' then coalesce(p_payload->'member_location_ids','[]'::jsonb)
   else coalesce((select jsonb_agg(m.location_id order by m.location_id) from public.location_group_memberships m where m.location_group_id=source_preview.id),'[]'::jsonb) end;
  desired:=jsonb_build_object('setup_pending',p_action='add','member_location_ids',members,'metadata',coalesce(p_payload->'metadata','{}'::jsonb),'merged_legacy_id',null);
 else
  if old.revision is null then raise exception using errcode='55000',message='Enroll exact existing UUID before lifecycle changes';end if;
  pid:=old.place_id;
  select revision,snapshot into head,state from public.custodial_place_versions where place_id=pid order by revision desc limit 1;
  if head<>old.canonical_revision then raise exception using errcode='40001',message='Canonical source changed outside bridge; explicit reconciliation required';end if;
  desired:=old.snapshot;
  if state->>'merged_into' is not null and p_action<>'reverse' then raise exception using errcode='23514',message='Reverse logical merge before editing its source';end if;
  case p_action
   when 'rename' then state:=state||jsonb_build_object('display_name',p_payload->'display_name');
   when 'aliases' then state:=state||jsonb_build_object('aliases',p_payload->'aliases');
   when 'deactivate' then state:=state||'{"active":false}'::jsonb;
   when 'reactivate' then state:=state||'{"active":true}'::jsonb;
   when 'reclassify' then
    if not(p_payload ? 'cleaning_mode' or p_payload ? 'event_eligible' or p_payload ? 'metadata') then raise exception using errcode='22023',message='Classification change required';end if;
    state:=state||(p_payload-'metadata');if p_payload ? 'metadata' then desired:=desired||jsonb_build_object('metadata',p_payload->'metadata');end if;
   when 'memberships' then
    if p_kind<>'location_group' or not(p_payload ? 'member_location_ids') then raise exception using errcode='22023',message='Explicit complete group member UUID list required';end if;
    desired:=desired||jsonb_build_object('member_location_ids',p_payload->'member_location_ids');
   when 'merge' then
    select place_id,canonical_revision into target,target_head from public.custodial_place_source_versions where legacy_kind=p_kind and legacy_id=(p_payload->>'target_legacy_id')::uuid order by revision desc limit 1;
    select snapshot into target_state from public.custodial_place_versions where place_id=target and revision=target_head and effective_at<=at_time;
    if target is null or target=pid or target_state is null or target_state->'active'<>'true'::jsonb or target_state->>'merged_into' is not null
     or target_state->>'cleaning_mode' is distinct from state->>'cleaning_mode'
     or exists(select 1 from public.custodial_place_versions where place_id=target and revision>target_head)
     or public.place_bridge_sha(public.place_source_row(p_kind,(p_payload->>'target_legacy_id')::uuid)) is distinct from
      (select source_row_sha256 from public.custodial_place_source_versions where legacy_kind=p_kind and legacy_id=(p_payload->>'target_legacy_id')::uuid order by revision desc limit 1) then
     raise exception using errcode='23514',message='Logical merge requires current compatible same-namespace target';end if;
    state:=state||jsonb_build_object('active',false,'merged_into',target);
    desired:=desired||jsonb_build_object('merged_legacy_id',p_payload->>'target_legacy_id');
   when 'reverse' then
    if old.revision=1 then state:=state||'{"active":false,"merged_into":null}'::jsonb;desired:=desired||'{"merged_legacy_id":null}'::jsonb;
    else
     select * into prior from public.custodial_place_source_versions where legacy_kind=p_kind and legacy_id=id and revision=old.revision-1;
     select snapshot into state from public.custodial_place_versions where place_id=pid and revision=prior.canonical_revision;desired:=prior.snapshot;
    end if;
  end case;
 end if;
 if old.effective_at>at_time then raise exception using errcode='22023',message='Append after latest planned source effective time';end if;
 code:=coalesce(p_payload->>'canonical_code',(select canonical_code from public.custodial_places where place_id=pid));
 if code is null or code !~ '^[A-Z][A-Z0-9_]{0,79}$' or code='STINGRAYS' then raise exception using errcode='22023',message='Valid distinct canonical code required; Stingrays remains event-only';end if;
 if p_action in('add','enroll') and exists(select 1 from public.custodial_places where canonical_code=code) then raise exception using errcode='23505',message='Canonical stable code already exists';end if;
 if jsonb_typeof(state->'display_name') is distinct from 'string' or length(btrim(state->>'display_name')) not between 1 and 200
  or public.place_lifecycle_normalize(state->>'display_name')='' or jsonb_typeof(state->'aliases') is distinct from 'array' or jsonb_array_length(state->'aliases')>128
  or coalesce(state->>'cleaning_mode','') not in('SCAN_TRACKED','REMINDER_ONLY','NEVER_CLEAN') or jsonb_typeof(state->'event_eligible') is distinct from 'boolean'
  or exists(select 1 from jsonb_array_elements(state->'aliases') a where jsonb_typeof(a)<>'string' or length(btrim(a#>>'{}')) not between 1 and 200 or public.place_lifecycle_normalize(a#>>'{}')='') then raise exception using errcode='22023',message='Invalid name/aliases/independent classification';end if;
 select jsonb_agg(name order by name) into names from(select distinct value name from jsonb_array_elements_text(state->'aliases') union select state->>'display_name'
  union select snapshot->>'display_name' from public.custodial_place_versions where place_id=pid) n;
 if jsonb_array_length(names)>128 then raise exception using errcode='22023',message='Retained name aliases exceed bound';end if;state:=state||jsonb_build_object('aliases',names);
 candidate_root:=case when state->>'merged_into' is not null then (state->>'merged_into')::uuid when state->'active'='true'::jsonb then pid else null end;
 if candidate_root is not null then
  for check_at in select at_time union select effective_at from public.custodial_place_versions where effective_at>=at_time loop
   if exists(select 1 from public.custodial_places x cross join lateral public.place_lifecycle_snapshot(x.place_id,check_at) other
    cross join lateral jsonb_array_elements_text(other->'aliases') a cross join lateral jsonb_array_elements_text(names) proposed
    where x.place_id<>pid and public.place_lifecycle_root(x.place_id,check_at) is not null
     and public.place_lifecycle_root(x.place_id,check_at)<>candidate_root and public.place_lifecycle_normalize(a.value)=public.place_lifecycle_normalize(proposed.value)) then
    raise exception using errcode='23514',message='Proposed alias conflicts in current/future canonical timeline';end if;
  end loop;
 end if;
 members:=desired->'member_location_ids';
 if jsonb_typeof(members) is distinct from 'array' or jsonb_array_length(members)>256
  or exists(select 1 from jsonb_array_elements(members) m where jsonb_typeof(m)<>'string')
  or (select count(distinct value) from jsonb_array_elements_text(members))<>jsonb_array_length(members) then raise exception using errcode='22023',message='Distinct explicit member UUID array required';end if;
 if p_kind='location_group' and exists(select 1 from jsonb_array_elements_text(members) m where not exists(select 1 from public.locations l where l.id=m.value::uuid)) then raise exception using errcode='22023',message='Unknown physical member UUID';end if;
 if state->>'cleaning_mode'='SCAN_TRACKED' and jsonb_array_length(members)=0 then raise exception using errcode='23514',message='SCAN_TRACKED group requires actual physical members';end if;
 if jsonb_typeof(desired->'metadata') is distinct from 'object' or exists(select 1 from jsonb_object_keys(desired->'metadata') k where k not in('coordinates','schedule_eligible','staffing_eligible','public_restroom','staff_restroom','exhibit','restaurant','administrative','zoo_wide','offsite')) then raise exception using errcode='22023',message='Unknown place metadata fields';end if;
 for item in select key,value from jsonb_each(desired->'metadata') where key<>'coordinates' loop
  if jsonb_typeof(item.value)<>'boolean' then raise exception using errcode='22023',message='Independent capabilities must be explicit booleans';end if;
 end loop;
 if desired->'metadata' ? 'coordinates' and desired->'metadata'->'coordinates'<>'null'::jsonb then
  if jsonb_typeof(desired->'metadata'->'coordinates')<>'object' or exists(select 1 from jsonb_object_keys(desired->'metadata'->'coordinates') k where k not in('latitude','longitude'))
   or jsonb_typeof(desired->'metadata'->'coordinates'->'latitude') is distinct from 'number' or jsonb_typeof(desired->'metadata'->'coordinates'->'longitude') is distinct from 'number'
   or (desired->'metadata'->'coordinates'->>'latitude')::numeric not between -90 and 90 or (desired->'metadata'->'coordinates'->>'longitude')::numeric not between -180 and 180 then raise exception using errcode='22023',message='Explicit bounded coordinates required';end if;
 end if;
 source:=public.place_source_manifest();deps:=public.place_source_dependencies();
 if octet_length(source::text)+octet_length(deps::text)>2097152 then raise exception using errcode='54000',message='Source/dependency manifest exceeds bounded preview';end if;
 proposal:=jsonb_build_object('legacy_kind',p_kind,'legacy_id',id,'place_id',pid,'action',p_action,'payload',p_payload,'reason',p_reason,'requested_effective_at',p_effective_at,
  'expected_revision',coalesce(old.revision,0),'expected_canonical_revision',head,'target_place_id',target,'expected_target_revision',target_head,'canonical_code',code,
  'source_sha256',public.place_bridge_sha(source),'dependency_sha256',public.place_bridge_sha(deps),'raw_legacy',raw,'desired_snapshot',desired,'canonical_snapshot',state,
  'current_effective',public.place_lifecycle_snapshot(pid,clock),'latest_effective_at',old.effective_at,'operational_cutover',false,
  'requires_explicit_republish',p_action not in('rename','aliases','enroll'),'protected_finish_uses_original_route',true,
  'dependency_inventory',deps);
 insert into public.custodial_place_source_previews values(preview,p_manager,clock,clock+interval '10 minutes',proposal,public.place_bridge_sha(proposal));
 return jsonb_build_object('preview_id',preview,'actor_manager_id',p_manager,'created_at',clock,'expires_at',clock+interval '10 minutes','proposal_sha256',public.place_bridge_sha(proposal),'proposal',proposal);
end $function$
;

REVOKE ALL ON FUNCTION custodial_leadership_private.custodial_place_source_preview_cohort_v1(jsonb,uuid,text,uuid,text,jsonb,timestamp with time zone,text) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE FUNCTION custodial_leadership_private.custodial_place_source_confirm_cohort_v1(p_actor jsonb, p_request uuid, p_manager uuid, p_preview uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v public.custodial_place_source_previews%rowtype;r public.custodial_place_source_versions%rowtype;p jsonb;rev integer;head integer;targethead integer;at_time timestamptz;receipt jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));PERFORM custodial_leadership_private.assert_scoped_cohort_actor_v1(p_actor,p_manager);perform public.place_source_locks();
 if p_request is null or p_preview is null then raise exception using errcode='22023',message='Stable request/original preview required';end if;
 select * into r from public.custodial_place_source_versions where request_id=p_request;
 if found then
  if r.actor_manager_id<>p_manager or r.preview_id<>p_preview then raise exception using errcode='23505',message='Source request identity conflict';end if;return r.receipt||'{"replayed":true}'::jsonb;
 end if;
 select * into v from public.custodial_place_source_previews where preview_id=p_preview;
 if not found or v.actor_manager_id<>p_manager then raise exception using errcode='42501',message='Original manager preview required';end if;
 if v.expires_at<=clock_timestamp() then raise exception using errcode='40001',message='Source preview expired';end if;p:=v.proposal;
 if v.proposal_sha256<>public.place_bridge_sha(p) or p->>'source_sha256'<>public.place_bridge_sha(public.place_source_manifest())
  or p->>'dependency_sha256'<>public.place_bridge_sha(public.place_source_dependencies()) then raise exception using errcode='40001',message='Source/dependencies changed; review again';end if;
 select max(revision) into rev from public.custodial_place_source_versions where legacy_kind=p->>'legacy_kind' and legacy_id=(p->>'legacy_id')::uuid;
 select max(revision) into head from public.custodial_place_versions where place_id=(p->>'place_id')::uuid;
 select max(revision) into targethead from public.custodial_place_versions where place_id=(p->>'target_place_id')::uuid;
 if coalesce(rev,0)<>(p->>'expected_revision')::integer or coalesce(head,0)<>(p->>'expected_canonical_revision')::integer or coalesce(targethead,0)<>(p->>'expected_target_revision')::integer then raise exception using errcode='40001',message='Source/target revision changed';end if;
 at_time:=coalesce((p->>'requested_effective_at')::timestamptz,clock_timestamp());
 if not isfinite(at_time) or (p->>'requested_effective_at' is not null and at_time<clock_timestamp()) then raise exception using errcode='40001',message='Planned effective time elapsed';end if;
 insert into public.custodial_place_source_admissions values(p_request,p_preview,txid_current(),p_manager,public.place_bridge_sha(jsonb_build_array(p_request,p_manager,p_preview,at_time,p)),p->>'source_sha256',p->>'dependency_sha256',coalesce(head,0),coalesce(targethead,0));
 head:=custodial_leadership_private.place_source_apply_cohort_v1(p_actor,p_request,p_manager,p_preview,at_time);
 receipt:=jsonb_build_object('request_id',p_request,'preview_id',p_preview,'actor_manager_id',p_manager,'operational_cutover',false,
  'data',jsonb_build_object('legacy_kind',p->>'legacy_kind','legacy_id',p->>'legacy_id','place_id',p->>'place_id','revision',coalesce(rev,0)+1,'canonical_revision',head,
   'action',p->>'action','effective_at',at_time,'source_sha256',p->>'source_sha256','dependency_sha256',p->>'dependency_sha256','proposal_sha256',v.proposal_sha256,
   'setup_pending',p->'desired_snapshot'->'setup_pending','requires_explicit_republish',p->'requires_explicit_republish','protected_finish_uses_original_route',true));
 insert into public.custodial_place_source_versions(legacy_kind,legacy_id,revision,place_id,effective_at,request_id,preview_id,actor_manager_id,canonical_revision,action,reason,source_row_sha256,snapshot,receipt)
 values(p->>'legacy_kind',(p->>'legacy_id')::uuid,coalesce(rev,0)+1,(p->>'place_id')::uuid,at_time,p_request,p_preview,p_manager,head,p->>'action',p->>'reason',
  public.place_bridge_sha(public.place_source_row(p->>'legacy_kind',(p->>'legacy_id')::uuid)),p->'desired_snapshot',receipt);
 return receipt;
end $function$
;

REVOKE ALL ON FUNCTION custodial_leadership_private.custodial_place_source_confirm_cohort_v1(jsonb,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE FUNCTION custodial_leadership_private.place_operation_v1(p_actor jsonb,p_wire jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $f$
DECLARE a text:=p_wire->>'action';i jsonb:=p_wire->'input';m uuid:=(p_actor->>'manager_id')::uuid;keys text[];v jsonb;
BEGIN
 PERFORM custodial_leadership_private.assert_scoped_cohort_actor_v1(p_actor,m);
 IF jsonb_typeof(p_wire) IS DISTINCT FROM 'object' OR (p_wire-ARRAY['action','input'])<>'{}'::jsonb OR jsonb_typeof(i) IS DISTINCT FROM 'object' OR octet_length(p_wire::text)>65536 THEN RAISE EXCEPTION 'Typed place operation required' USING ERRCODE='22023';END IF;
 keys:=CASE a WHEN 'preview' THEN ARRAY['as_of'] WHEN 'command' THEN ARRAY['request_id','place_id','expected_revision','action','effective_at','payload','reason'] WHEN 'bridge_preview' THEN ARRAY['legacy_kind','legacy_id','action','target_place_id','effective_at','reason'] WHEN 'source_preview' THEN ARRAY['legacy_kind','legacy_id','action','payload','effective_at','reason'] WHEN 'bridge_confirm' THEN ARRAY['request_id','preview_id'] WHEN 'source_confirm' THEN ARRAY['request_id','preview_id'] END;
 IF keys IS NULL OR (i-keys)<>'{}'::jsonb OR (a<>'preview' AND NOT(i ?& keys)) THEN RAISE EXCEPTION 'Exact place fields required' USING ERRCODE='22023';END IF;
 IF a='preview' THEN RETURN custodial_leadership_private.custodial_place_preview_cohort_v1(p_actor,m,coalesce((i->>'as_of')::timestamptz,statement_timestamp()));
 ELSIF a='command' THEN v:=custodial_leadership_private.custodial_place_command_cohort_v1(p_actor,(i->>'request_id')::uuid,m,(i->>'place_id')::uuid,(i->>'expected_revision')::integer,i->>'action',(i->>'effective_at')::timestamptz,i->'payload',i->>'reason');
 ELSIF a='bridge_preview' THEN v:=custodial_leadership_private.custodial_place_bridge_preview_cohort_v1(p_actor,m,i->>'legacy_kind',(i->>'legacy_id')::uuid,i->>'action',(i->>'target_place_id')::uuid,(i->>'effective_at')::timestamptz,i->>'reason');
 ELSIF a='bridge_confirm' THEN v:=custodial_leadership_private.custodial_place_bridge_confirm_cohort_v1(p_actor,(i->>'request_id')::uuid,m,(i->>'preview_id')::uuid);
 ELSIF a='source_preview' THEN v:=custodial_leadership_private.custodial_place_source_preview_cohort_v1(p_actor,m,i->>'legacy_kind',(i->>'legacy_id')::uuid,i->>'action',i->'payload',(i->>'effective_at')::timestamptz,i->>'reason');
 ELSE v:=custodial_leadership_private.custodial_place_source_confirm_cohort_v1(p_actor,(i->>'request_id')::uuid,m,(i->>'preview_id')::uuid);END IF;
 INSERT INTO public.ops_manager_auth_events(credential_id,device_id,event_type,success,detail_json) VALUES(NULL,p_actor->>'device_id','cohort_place_operation',true,jsonb_build_object('action',a,'actor',p_actor,'result',v));
 RETURN v;
END $f$;

REVOKE ALL ON FUNCTION custodial_leadership_private.place_operation_v1(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE TABLE custodial_leadership_private.feedback_triage_receipts_v1(
 request_id uuid PRIMARY KEY,feedback_id uuid NOT NULL REFERENCES public.system_feedback_items(id) ON DELETE RESTRICT,
 registration_id uuid NOT NULL REFERENCES custodial_leadership_private.registrations(registration_id) ON DELETE RESTRICT,
 actor jsonb NOT NULL CHECK(jsonb_typeof(actor)='object'),command jsonb NOT NULL CHECK(jsonb_typeof(command)='object'),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),accepted_at timestamptz NOT NULL);
ALTER TABLE custodial_leadership_private.feedback_triage_receipts_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodial_leadership_private.feedback_triage_receipts_v1 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE custodial_leadership_private.feedback_triage_receipts_v1 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
CREATE TRIGGER feedback_triage_cohort_immutable BEFORE UPDATE OR DELETE ON custodial_leadership_private.feedback_triage_receipts_v1 FOR EACH ROW EXECUTE FUNCTION public.custodial_feedback_triage_immutable();
ALTER TABLE custodial_leadership_private.feedback_triage_receipts_v1 ENABLE ALWAYS TRIGGER feedback_triage_cohort_immutable;


CREATE FUNCTION custodial_leadership_private.feedback_request_collision_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $f$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('feedback-triage:'||NEW.request_id::text,0));
 IF EXISTS(SELECT 1 FROM custodial_leadership_private.feedback_triage_receipts_v1 WHERE request_id=NEW.request_id) THEN RAISE EXCEPTION 'Feedback request identity conflict' USING ERRCODE='40001';END IF;RETURN NEW;
END $f$;

REVOKE ALL ON FUNCTION custodial_leadership_private.feedback_request_collision_v1() FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE TRIGGER feedback_named_cohort_request_collision BEFORE INSERT ON public.system_feedback_triage_receipts FOR EACH ROW EXECUTE FUNCTION custodial_leadership_private.feedback_request_collision_v1();

CREATE FUNCTION custodial_leadership_private.feedback_operation_v1(p_actor jsonb,p_action text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $f$
DECLARE m uuid:=(p_actor->>'manager_id')::uuid;c uuid:=(p_actor->>'credential_id')::uuid;q uuid;fid uuid;act text;ver text;
 old custodial_leadership_private.feedback_triage_receipts_v1%rowtype;item public.system_feedback_items%rowtype;r jsonb;at_time timestamptz;label text;
 unknown_result CONSTANT jsonb:='{"ok":true,"outcome":"UNKNOWN","retry_safe":false}'::jsonb;
BEGIN
 PERFORM custodial_leadership_private.assert_scoped_cohort_actor_v1(p_actor,m);
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR NOT(p_input ?& ARRAY['request_id','feedback_id','status','expected_version','expected_manager_id','expected_credential_id'])
 OR (p_input-ARRAY['request_id','feedback_id','status','expected_version','expected_manager_id','expected_credential_id'])<>'{}'::jsonb
 OR p_input->>'expected_manager_id' IS DISTINCT FROM m::text OR p_input->>'expected_credential_id' IS DISTINCT FROM c::text
 OR EXISTS(SELECT 1 FROM jsonb_each(p_input) v WHERE jsonb_typeof(v.value)<>'string') THEN RAISE EXCEPTION 'Exact cohort Feedback command required' USING ERRCODE='22023';END IF;
 q:=(p_input->>'request_id')::uuid;fid:=(p_input->>'feedback_id')::uuid;act:=p_input->>'status';ver:=p_input->>'expected_version';
 IF q IS NULL OR fid IS NULL OR act NOT IN ('acknowledged','resolved','closed') OR ver!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Exact Feedback command required' USING ERRCODE='22023';END IF;
 IF p_action='feedback_triage_status' THEN
  SELECT * INTO old FROM custodial_leadership_private.feedback_triage_receipts_v1 WHERE request_id=q AND registration_id=c AND feedback_id=fid AND command=p_input AND actor->>'claimed_account_id'=p_actor->>'claimed_account_id';
  IF NOT FOUND THEN RETURN unknown_result;END IF;
  IF jsonb_typeof(old.receipt) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(old.receipt))<>7
   OR NOT(old.receipt ?& ARRAY['request_id','feedback_id','status','triage_version','actor_manager_id','actor_credential_id','accepted_at'])
   OR EXISTS(SELECT 1 FROM jsonb_each(old.receipt) v WHERE jsonb_typeof(v.value)<>'string')
   OR old.receipt->>'request_id' IS DISTINCT FROM q::text OR old.receipt->>'feedback_id' IS DISTINCT FROM fid::text
   OR old.receipt->>'status' IS DISTINCT FROM act OR old.receipt->>'actor_manager_id' IS DISTINCT FROM m::text OR old.receipt->>'actor_credential_id' IS DISTINCT FROM c::text
   OR old.receipt->>'triage_version'!~'^[a-f0-9]{64}$' OR old.receipt->>'triage_version'=ver THEN RETURN unknown_result;END IF;
  BEGIN IF (old.receipt->>'accepted_at')::timestamptz IS DISTINCT FROM old.accepted_at THEN RETURN unknown_result;END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN unknown_result;END;
  RETURN jsonb_build_object('ok',true,'outcome','APPLIED','retry_safe',false,'command',old.command,'receipt',old.receipt);
 ELSIF p_action<>'feedback_triage' THEN RAISE EXCEPTION 'Unknown Feedback action' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('feedback-triage:'||q::text,0));
 SELECT * INTO old FROM custodial_leadership_private.feedback_triage_receipts_v1 WHERE request_id=q;
 IF FOUND THEN
  IF old.command IS DISTINCT FROM p_input OR old.registration_id<>c OR old.actor->>'claimed_account_id' IS DISTINCT FROM p_actor->>'claimed_account_id' THEN RAISE EXCEPTION 'Feedback request identity conflict' USING ERRCODE='40001';END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,'receipt',old.receipt);
 END IF;
 IF EXISTS(SELECT 1 FROM public.system_feedback_triage_receipts WHERE request_id=q) THEN RAISE EXCEPTION 'Feedback request identity conflict' USING ERRCODE='40001';END IF;
 SELECT * INTO item FROM public.system_feedback_items WHERE id=fid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Feedback item unavailable' USING ERRCODE='P0002';END IF;
 IF public.custodial_feedback_triage_version(item.status,item.updated_at)<>ver OR item.status='closed' OR item.status=act OR (item.status='resolved' AND act<>'closed') THEN RAISE EXCEPTION 'Feedback changed; refresh before new action' USING ERRCODE='40001';END IF;
 at_time:=clock_timestamp();label:=(p_actor->>'claimed_name')||' (shared PIN; self-asserted)';
 IF nullif(btrim(label),'') IS NULL THEN RAISE EXCEPTION 'Original actor label required' USING ERRCODE='42501';END IF;
 UPDATE public.system_feedback_items SET status=act,updated_at=at_time,acknowledged_at=CASE WHEN act='acknowledged' THEN at_time ELSE acknowledged_at END,
 acknowledged_by=CASE WHEN act='acknowledged' THEN label ELSE acknowledged_by END,
 metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('status_changed_via','manager_feedback_inbox','status_changed_by',label,'status_changed_manager_id',m,'status_changed_credential_id',c,'status_changed_actor',p_actor)
 WHERE id=fid RETURNING * INTO item;
 r:=jsonb_build_object('request_id',q,'feedback_id',fid,'status',act,'triage_version',public.custodial_feedback_triage_version(item.status,item.updated_at),'actor_manager_id',m,'actor_credential_id',c,'accepted_at',at_time);
 INSERT INTO custodial_leadership_private.feedback_triage_receipts_v1 VALUES(q,fid,c,p_actor,p_input,r,at_time);
 INSERT INTO public.ops_manager_auth_events(credential_id,device_id,event_type,success,detail_json) VALUES(NULL,p_actor->>'device_id','cohort_feedback_triage',true,jsonb_build_object('actor',p_actor,'receipt',r));
 RETURN jsonb_build_object('ok',true,'replayed',false,'receipt',r);
END $f$;

REVOKE ALL ON FUNCTION custodial_leadership_private.feedback_operation_v1(jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE FUNCTION custodial_leadership_private.valid_feedback_cohort_identity_v1(a jsonb,p_device text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $f$
BEGIN
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR a->>'status' IS DISTINCT FROM 'verified_cohort' OR a->>'kind' IS DISTINCT FROM 'custodial_leadership_cohort'
 OR a->>'identity_assurance' IS DISTINCT FROM 'SELF_ASSERTED_NAME' OR a->'individual_identity_verified' IS DISTINCT FROM 'false'::jsonb
 OR lower(a->>'device_id') IS DISTINCT FROM lower(p_device) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM custodial_leadership_private.policy p JOIN custodial_leadership_private.registrations r ON r.cohort_principal_id=p.cohort_principal_id
 JOIN public.ops_manager_managers m ON m.manager_id=p.cohort_principal_id
 CROSS JOIN LATERAL jsonb_array_elements(custodial_leadership_private.approved_names()) names
 WHERE p.singleton AND p.enabled AND 'custodialManagementAdmin'=ANY(p.permissions) AND m.active AND m.revoked_at IS NULL AND m.is_system_principal
 AND r.registration_id=(a->>'credential_id')::uuid AND r.browser_id=(a->>'device_id')::uuid AND r.cohort_principal_id=(a->>'manager_id')::uuid
 AND r.claimed_account_id=(a->>'claimed_account_id')::uuid AND r.revoked_at IS NULL AND r.expires_at>clock_timestamp()
 AND names->>'accountId'=r.claimed_account_id::text AND names->>'displayName'=a->>'claimed_name');
 EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $f$;

REVOKE ALL ON FUNCTION custodial_leadership_private.valid_feedback_cohort_identity_v1(jsonb,text) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE OR REPLACE FUNCTION public.capture_system_feedback_email_intent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_actor jsonb := new.metadata_json->'identity_verification';
  v_image jsonb := new.metadata_json->'image_attachment';
  v_snapshot jsonb;
  v_subject text;
  v_text text;
  v_link text;
  v_envelope jsonb;
begin
  -- The old public/anonymous submission path remains saved for manager review,
  -- but is never enrolled for email. Only the authenticated employee/manager
  -- path may create a relay intent.
  if new.hub_context not in ('employee', 'manager') then
    return new;
  end if;

  if NOT (new.hub_context='manager' AND custodial_leadership_private.valid_feedback_cohort_identity_v1(v_actor,new.device_id)) AND (jsonb_typeof(v_actor) is distinct from 'object'
     or v_actor->>'status' is distinct from 'verified'
     or (new.hub_context = 'employee' and (
       v_actor->>'kind' is distinct from 'enrolled_employee_device'
       or coalesce(v_actor->>'employee_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or nullif(btrim(v_actor->>'credential_id'), '') is null
       or upper(coalesce(v_actor->>'device_id', '')) is distinct from upper(coalesce(new.device_id, ''))
     ))
     or (new.hub_context = 'manager' and (
       v_actor->>'kind' is distinct from 'named_manager_session'
       or coalesce(v_actor->>'manager_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     ))
     or nullif(btrim(new.submitted_by), '') is null) then
    raise exception using errcode = '23514',
      message = 'Verified feedback identity is required before email intent capture';
  end if;

  if v_image is not null and jsonb_typeof(v_image) <> 'null' then
    -- This is a manager-authenticated application page, not a signed Storage
    -- URL. A later claim must verify the protected object and exact reader.
    v_link := 'https://memphis-zoo-mcp.onrender.com/system-feedback.html?hub=manager&feedback=' || new.id::text;
  end if;

  v_snapshot := jsonb_build_object(
    'feedback_id', new.id,
    'operation_id', new.operation_id,
    'request_fingerprint', new.request_fingerprint,
    'category', new.category,
    'priority', new.priority,
    'message', new.message,
    'submitted_by', new.submitted_by,
    'hub_context', new.hub_context,
    'device_id', new.device_id,
    'created_at', new.created_at,
    'image_attachment', v_image
  );
  v_subject := 'Memphis Zoo Program Feedback [' || new.operation_id::text || ']';
  v_text := 'Memphis Zoo Program Feedback' || E'\n'
    || 'Operation ID: ' || new.operation_id::text || E'\n'
    || 'Request fingerprint: ' || new.request_fingerprint || E'\n'
    || 'Feedback ID: ' || new.id::text || E'\n'
    || 'Submitted by: ' || new.submitted_by || E'\n'
    || 'Source: ' || new.hub_context || E'\n'
    || 'Category: ' || new.category || E'\n'
    || 'Priority: ' || new.priority || E'\n'
    || case when v_link is not null then 'Private image: ' || v_link || E'\n' else '' end
    || E'\nMessage (verbatim):\n' || new.message;
  v_envelope := jsonb_build_object(
    'contract_version', 'custodial-feedback-relay.v1',
    'provider', 'outlook',
    'provider_account', 'eoperle@memphiszoo.org',
    'to', jsonb_build_array('eoperle@memphiszoo.org'),
    'cc', '[]'::jsonb,
    'bcc', '[]'::jsonb,
    'subject', v_subject,
    'text_content', v_text,
    'save_to_sent_items', true
  );

  insert into public.system_feedback_email_intents(
    feedback_id, operation_id, request_fingerprint, original_actor,
    feedback_snapshot, email_subject, email_text, envelope_sha256
  ) values (
    new.id, new.operation_id, new.request_fingerprint, v_actor,
    v_snapshot, v_subject, v_text,
    encode(extensions.digest(convert_to(v_envelope::text, 'UTF8'), 'sha256'), 'hex')
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION custodial_leadership_private.record_operation_v1(p_actor jsonb, p_action text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
 p_operation_id uuid;p_session_id uuid;p_manager_id uuid;p_reason text;
 p_corrected_employee_id uuid;p_corrected_location_id uuid;p_corrected_device_id uuid;
 p_corrected_started_at timestamptz;p_corrected_ended_at timestamptz;
 v_fingerprint text;v_existing public.custodial_session_corrections%rowtype;v_current record;
 v_manager_name text;v_employee record;v_location record;v_device record;
 v_employee_id uuid;v_location_id uuid;v_device_id uuid;v_started_at timestamptz;v_ended_at timestamptz;
 v_changed_fields text[];v_inserted public.custodial_session_corrections%rowtype;
 v_result jsonb;v_limit integer;v_key text;v_status text;v_session_uuid text;v_current_correction uuid;
BEGIN
 IF p_actor->>'manager_id' IS NULL OR (p_actor->>'actor_kind' IN ('NAMED_MANAGER','CUSTODIAL_LEADERSHIP_COHORT')) IS NOT TRUE THEN
  RAISE EXCEPTION 'Authorized record actor required' USING ERRCODE='42501'; END IF;
 p_manager_id:=(p_actor->>'manager_id')::uuid;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR octet_length(p_input::text)>(CASE WHEN p_action='place_operation' THEN 65536 ELSE 16384 END) THEN
  RAISE EXCEPTION 'Bounded typed record input required' USING ERRCODE='22023';END IF;
 IF p_action='place_operation' THEN RETURN custodial_leadership_private.place_operation_v1(p_actor,p_input);
 ELSIF p_action IN ('feedback_triage','feedback_triage_status') THEN RETURN custodial_leadership_private.feedback_operation_v1(p_actor,p_action,p_input);
 ELSIF p_action='completion_evidence' THEN
  IF NOT(p_input ? 'session_uuid') OR (p_input-ARRAY['session_uuid'])<>'{}'::jsonb
   OR jsonb_typeof(p_input->'session_uuid') IS DISTINCT FROM 'string'
   OR length(p_input->>'session_uuid') NOT BETWEEN 1 AND 200
   OR btrim(p_input->>'session_uuid') IS DISTINCT FROM p_input->>'session_uuid' THEN
   RAISE EXCEPTION 'Exact completion session identity required' USING ERRCODE='22023';END IF;
  RETURN custodial_leadership_private.completion_evidence_v1(p_input->>'session_uuid');
 ELSIF p_action='choices' THEN
  IF p_input<>'{}'::jsonb THEN RAISE EXCEPTION 'No choices parameters allowed' USING ERRCODE='22023';END IF;
  IF (SELECT count(*) FROM public.employees)>5000 OR (SELECT count(*) FROM public.locations)>5000 OR (SELECT count(*) FROM public.devices)>5000 THEN
   RAISE EXCEPTION 'Complete bounded choices unavailable' USING ERRCODE='54000';END IF;
  RETURN jsonb_build_object(
   'employees',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',display_name) ORDER BY display_name,id),'[]'::jsonb) FROM public.employees),
   'locations',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',location_name||' ('||location_code||')') ORDER BY location_name,id),'[]'::jsonb) FROM public.locations),
   'devices',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',device_name||' ('||device_id||')') ORDER BY device_name,id),'[]'::jsonb) FROM public.devices));
 ELSIF p_action='open_problems' THEN
  IF NOT(p_input ? 'limit') OR (p_input-ARRAY['limit'])<>'{}'::jsonb OR jsonb_typeof(p_input->'limit') IS DISTINCT FROM 'number'
   OR (p_input->>'limit')!~'^[0-9]+$' THEN RAISE EXCEPTION 'Integer problem limit required' USING ERRCODE='22023';END IF;
  v_limit:=(p_input->>'limit')::integer;IF v_limit<1 OR v_limit>200 THEN RAISE EXCEPTION 'Problem limit out of bounds' USING ERRCODE='22023';END IF;
  with items as (
    select 'maintenance'::text as source, t.id::text as source_id,
      case when t.issue_source='completion_form' then 'Cleaning issue / maintenance reminder'
        else 'Maintenance reminder' end as source_label,
      coalesce(t.location_name_snapshot,l.location_name,t.location_code_snapshot,l.location_code) as location,
      t.issue_summary as summary,t.reported_at as observed_at,'open'::text as status,
      t.issue_source as source_detail
    from public.maintenance_tickets t left join public.locations l on l.id=t.location_id
    where t.status='open'
    union all
    select 'guest'::text,g.id::text,'Approved guest issue'::text,
      coalesce(g.location_name,g.location_code),g.issue_type,g.submitted_at,'open'::text,g.severity
    from public.guest_cleanliness_reports g
    where g.status='open' and g.marketing_review_status='approved'
      and exists(select 1 from public.system_settings s where s.setting_key='guest_issues_feature_approved'
        and s.setting_value='true'::jsonb)
    union all
    select 'saved_work'::text,r.reconciliation_id::text,'Protected saved work needs review'::text,
      coalesce(l.location_name,l.location_code,'Location not available'),
      'Protected work requires manager review'::text,r.created_at,
      'quarantined'::text,'offline_reconciliation'::text
    from public.custodial_offline_reconciliation_records r
    left join public.locations l on l.id=r.location_id
    where r.state='quarantined' and not exists (
      select 1 from public.custodial_offline_reconciliation_dispositions d
      where d.reconciliation_id=r.reconciliation_id and d.disposition='superseded_by_new_occurrence'
    )
  ), bounded as (
    select * from items order by observed_at desc nulls last,source,source_id limit v_limit
  )
  select jsonb_build_object('total',(select count(*) from items),
    'items',coalesce(jsonb_agg(to_jsonb(b) order by b.observed_at desc nulls last,b.source,b.source_id),'[]'::jsonb))
    into v_result from bounded b;
  RETURN v_result||jsonb_build_object('schema','custodial.open-problems.v1','generated_at',clock_timestamp());
 ELSIF p_action='truth' THEN
  IF NOT(p_input ? 'session_id') OR (p_input-ARRAY['session_id'])<>'{}'::jsonb OR jsonb_typeof(p_input->'session_id') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Session identity required' USING ERRCODE='22023';END IF;
  SELECT to_jsonb(v) INTO v_result FROM public.v_custodial_cleaning_session_truth v WHERE v.session_id=(p_input->>'session_id')::uuid;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Cleaning session not found' USING ERRCODE='P0002';END IF;RETURN v_result;
 ELSIF p_action='correction_outcome' THEN
  IF NOT(p_input ?& ARRAY['session_id','operation_id']) OR (p_input-ARRAY['session_id','operation_id'])<>'{}'::jsonb
   OR jsonb_typeof(p_input->'session_id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'operation_id') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Original operation and session required' USING ERRCODE='22023';END IF;
  p_session_id:=(p_input->>'session_id')::uuid;p_operation_id:=(p_input->>'operation_id')::uuid;
  SELECT * INTO v_existing FROM public.custodial_session_corrections WHERE operation_id=p_operation_id AND session_id=p_session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('found',false,'operation_id',p_operation_id,'session_id',p_session_id);END IF;
  RETURN jsonb_build_object('found',true,'correction_id',v_existing.correction_id,'session_id',v_existing.session_id,
   'operation_id',v_existing.operation_id,'replayed',true,'changed_fields',v_existing.changed_fields,'created_at',v_existing.created_at,
   'actor_manager_id',v_existing.corrected_by_manager_id,'actor_name',v_existing.corrected_by_manager_name_snapshot,'reason',v_existing.reason);
 ELSIF p_action IS DISTINCT FROM 'correct' THEN RAISE EXCEPTION 'Record action unsupported' USING ERRCODE='22023';END IF;
 IF NOT(p_input ?& ARRAY['session_id','operation_id','reason','expected_correction_id','expected_session_uuid'])
  OR (p_input-ARRAY['session_id','operation_id','reason','expected_correction_id','expected_session_uuid','corrected_employee_id','corrected_location_id','corrected_device_id','corrected_started_at','corrected_ended_at'])<>'{}'::jsonb
  OR jsonb_typeof(p_input->'session_id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'operation_id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'expected_session_uuid') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_input->'expected_correction_id') NOT IN ('string','null')
  OR length(p_input->>'expected_session_uuid') NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'Typed correction and preview marker required' USING ERRCODE='22023';END IF;
 FOREACH v_key IN ARRAY ARRAY['corrected_employee_id','corrected_location_id','corrected_device_id','corrected_started_at','corrected_ended_at'] LOOP
  IF p_input ? v_key AND jsonb_typeof(p_input->v_key) NOT IN ('string','null') THEN RAISE EXCEPTION 'Typed correction fact required' USING ERRCODE='22023';END IF;
  IF v_key LIKE '%_at' AND p_input->>v_key IS NOT NULL AND (p_input->>v_key)!~'^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,6})?)?(Z|[+-]\d\d:\d\d)$' THEN
   RAISE EXCEPTION 'Explicit timestamp offset required' USING ERRCODE='22023';END IF;
 END LOOP;
 p_session_id:=(p_input->>'session_id')::uuid;p_operation_id:=(p_input->>'operation_id')::uuid;
 p_reason:=btrim(p_input->>'reason');IF length(p_reason) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Correction reason required' USING ERRCODE='22023';END IF;
 p_corrected_employee_id:=(p_input->>'corrected_employee_id')::uuid;p_corrected_location_id:=(p_input->>'corrected_location_id')::uuid;p_corrected_device_id:=(p_input->>'corrected_device_id')::uuid;
 p_corrected_started_at:=(p_input->>'corrected_started_at')::timestamptz;p_corrected_ended_at:=(p_input->>'corrected_ended_at')::timestamptz;
 v_manager_name:=CASE WHEN p_actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' THEN (p_actor->>'claimed_name')||' (shared PIN; self-asserted)' ELSE p_actor->>'manager_name' END;
 IF nullif(btrim(v_manager_name),'') IS NULL THEN RAISE EXCEPTION 'Original actor label required' USING ERRCODE='42501';END IF;
 v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('actor_kind',p_actor->>'actor_kind','manager_id',p_manager_id,
  'claimed_account_id',p_actor->>'claimed_account_id','operation_id',p_operation_id,'session_id',p_session_id,'reason',p_reason,
  'expected_session_uuid',p_input->>'expected_session_uuid','expected_correction_id',(p_input->>'expected_correction_id')::uuid,
  'employee_id',p_corrected_employee_id,'location_id',p_corrected_location_id,'device_id',p_corrected_device_id,
  'started_at',p_corrected_started_at,'ended_at',p_corrected_ended_at)::text,'UTF8'),'sha256'),'hex');
 -- Serialize the original operation before inspecting its durable result.
 PERFORM pg_advisory_xact_lock(hashtextextended('custodial.record.operation:'||p_operation_id::text,0));
 SELECT * INTO v_existing FROM public.custodial_session_corrections WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN RAISE EXCEPTION 'Correction operation payload differs' USING ERRCODE='40901';END IF;
  RETURN jsonb_build_object('correction_id',v_existing.correction_id,'session_id',v_existing.session_id,'operation_id',v_existing.operation_id,
   'replayed',true,'changed_fields',v_existing.changed_fields,'created_at',v_existing.created_at);
 END IF;
 -- Lock first, then use a new statement snapshot to read the latest correction.
 SELECT s.status,s.session_uuid INTO v_status,v_session_uuid FROM public.sessions s WHERE s.id=p_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cleaning session not found' USING ERRCODE='P0002';END IF;
 IF v_status IS DISTINCT FROM 'closed' THEN RAISE EXCEPTION 'Only completed records can be corrected here' USING ERRCODE='40901';END IF;
 SELECT v.current_employee_id employee_id,v.current_location_id location_id,v.current_device_id device_id,
  v.current_started_at started_at,v.current_ended_at ended_at,v.correction_id INTO v_current
 FROM public.v_custodial_cleaning_session_truth v WHERE v.session_id=p_session_id;
 IF v_current.ended_at IS NULL OR v_session_uuid IS DISTINCT FROM p_input->>'expected_session_uuid'
  OR v_current.correction_id IS DISTINCT FROM (p_input->>'expected_correction_id')::uuid THEN
  RAISE EXCEPTION 'Correction preview no longer matches completed record' USING ERRCODE='40901';END IF;
  v_employee_id := coalesce(p_corrected_employee_id,v_current.employee_id);
  v_location_id := coalesce(p_corrected_location_id,v_current.location_id);
  v_device_id := coalesce(p_corrected_device_id,v_current.device_id);
  v_started_at := coalesce(p_corrected_started_at,v_current.started_at);
  v_ended_at := coalesce(p_corrected_ended_at,v_current.ended_at);

  v_changed_fields := array_remove(array[
    case when v_employee_id is distinct from v_current.employee_id then 'employee' end,
    case when v_location_id is distinct from v_current.location_id then 'location' end,
    case when v_device_id is distinct from v_current.device_id then 'device' end,
    case when v_started_at is distinct from v_current.started_at then 'started_at' end,
    case when v_ended_at is distinct from v_current.ended_at then 'ended_at' end
  ],null);
  if cardinality(v_changed_fields) = 0 then
    raise exception using errcode='22023', message='Correction must change at least one manager-visible fact';
  end if;
  if v_ended_at is not null and v_ended_at < v_started_at then
    raise exception using errcode='22023', message='Corrected cleaning end time cannot precede its start time';
  end if;

  select e.id,e.display_name into v_employee from public.employees e where e.id = v_employee_id;
  select l.id,l.location_code,l.location_name into v_location from public.locations l where l.id = v_location_id;
  select d.id,d.device_id,d.device_name,d.assignment_epoch into v_device from public.devices d where d.id = v_device_id;
  if v_employee.id is null or v_location.id is null or v_device.id is null then
    raise exception using errcode='23503', message='Corrected employee, location, and phone must exist';
  end if;

  insert into public.custodial_session_corrections(
    operation_id,request_fingerprint,session_id,corrected_by_manager_id,corrected_by_manager_name_snapshot,
    reason,changed_fields,effective_employee_id,effective_employee_name_snapshot,effective_location_id,
    effective_location_code_snapshot,effective_location_name_snapshot,effective_device_id,
    effective_device_identifier_snapshot,effective_device_name_snapshot,effective_assignment_epoch_snapshot,
    effective_started_at,effective_ended_at
  ) values (
    p_operation_id,v_fingerprint,p_session_id,p_manager_id,v_manager_name,btrim(p_reason),v_changed_fields,
    v_employee.id,v_employee.display_name,v_location.id,v_location.location_code,v_location.location_name,
    v_device.id,v_device.device_id,v_device.device_name,v_device.assignment_epoch,v_started_at,v_ended_at
  ) returning * into v_inserted;

  INSERT INTO public.ops_manager_auth_events(credential_id,device_id,event_type,success,detail_json)
   VALUES(NULL,p_actor->>'device_id','cleaning_record_correction_recorded',true,jsonb_build_object('correction_id',v_inserted.correction_id,'operation_id',p_operation_id,'session_id',p_session_id,'actor',p_actor));
  return jsonb_build_object('correction_id',v_inserted.correction_id,'session_id',v_inserted.session_id,
    'operation_id',v_inserted.operation_id,'replayed',false,'changed_fields',v_inserted.changed_fields,
    'created_at',v_inserted.created_at);
END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_leadership_record_operation_v1(p_manager_id uuid, p_credential_id uuid, p_device_id text, p_action text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE actor jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,'full_access',CASE WHEN p_action IN ('correct','feedback_triage') OR (p_action='place_operation' AND p_input->>'action'<>'preview') THEN 'write' ELSE 'read' END);
 IF actor->>'actor_kind' IS DISTINCT FROM 'CUSTODIAL_LEADERSHIP_COHORT' OR actor->'owner' IS DISTINCT FROM 'false'::jsonb
  OR actor->>'identity_assurance' IS DISTINCT FROM 'SELF_ASSERTED_NAME' OR actor->'individual_identity_verified' IS DISTINCT FROM 'false'::jsonb
  OR actor->>'manager_id' IS DISTINCT FROM p_manager_id::text OR actor->>'credential_id' IS DISTINCT FROM p_credential_id::text
  OR actor->>'device_id' IS DISTINCT FROM p_device_id OR actor->>'request_id' IS NULL THEN
  RAISE EXCEPTION 'Authenticated original cohort context required' USING ERRCODE='42501';END IF;
 RETURN custodial_leadership_private.record_operation_v1(actor,p_action,p_input);
END $function$
;

DO $owners$ DECLARE o name;f text;BEGIN SELECT pg_get_userbyid(proowner) INTO o FROM pg_proc WHERE oid='custodial_leadership_private.record_operation_v1(jsonb,text,jsonb)'::regprocedure;

FOREACH f IN ARRAY ARRAY['custodial_leadership_private.assert_scoped_cohort_actor_v1(jsonb,uuid)','custodial_leadership_private.custodial_place_command_cohort_v1(jsonb,uuid,uuid,uuid,integer,text,timestamp with time zone,jsonb,text)','custodial_leadership_private.custodial_place_preview_cohort_v1(jsonb,uuid,timestamp with time zone)','custodial_leadership_private.custodial_place_bridge_preview_cohort_v1(jsonb,uuid,text,uuid,text,uuid,timestamp with time zone,text)','custodial_leadership_private.custodial_place_bridge_confirm_cohort_v1(jsonb,uuid,uuid,uuid)','custodial_leadership_private.place_source_apply_cohort_v1(jsonb,uuid,uuid,uuid,timestamp with time zone)','custodial_leadership_private.custodial_place_source_preview_cohort_v1(jsonb,uuid,text,uuid,text,jsonb,timestamp with time zone,text)','custodial_leadership_private.custodial_place_source_confirm_cohort_v1(jsonb,uuid,uuid,uuid)','custodial_leadership_private.place_operation_v1(jsonb,jsonb)','custodial_leadership_private.feedback_request_collision_v1()','custodial_leadership_private.feedback_operation_v1(jsonb,text,jsonb)','custodial_leadership_private.valid_feedback_cohort_identity_v1(jsonb,text)'] LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO %I',f,o);END LOOP;

EXECUTE format('ALTER TABLE custodial_leadership_private.feedback_triage_receipts_v1 OWNER TO %I',o);END $owners$;
COMMIT;
