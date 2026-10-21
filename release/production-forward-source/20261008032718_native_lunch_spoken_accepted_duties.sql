-- Exact existing postgres NEW-creator equivalence; canonical bodies/other-role revocations unchanged.
-- Unapplied source correction: speak ONLY the accepted lunch owner and actual
-- scheduled end/duration, then point to the schedule. Areas stay on that page.
-- Eric's NO-SPOKEN-AREAS correction supersedes the earlier area-list wording.
-- No new dispatch authority, timer, ownership, lunch policy or cadence.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $predecessor$ begin
 if public.static_weekly_digest_text(pg_get_functiondef('public.custodial_native_lunch_reserve_at(uuid,uuid,jsonb,timestamptz)'::regprocedure))
  is distinct from '9b9c2c7d6fec1f94670a93060c40bd64534ca4b3979b991437b637862d31730d'
  or public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure))
  is distinct from '1baa9c516b9e0032ce556c103f863d850ab0624b93712f0273813f5046743aa9' then
  raise exception 'lunch speech exact predecessor changed';end if;
end $predecessor$;

-- Private formatter. The reservation owner already holds the schedule/device/
-- generation/job locks. Read immutable accepted snapshots, not mutable names or
-- a caller's speech text; acquire no further locks after the final clock sample.

-- BEGIN FINITE NEW-CREATOR PROFILE 101
DO $creator_pre$ BEGIN
 IF current_user<>'postgres' OR session_user<>current_user
  OR current_setting('custodial.deployment_project_ref',true) IS DISTINCT FROM 'rqquvtjdmugpigbndmne'
  OR current_setting('session_replication_role')<>'origin'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.custodial_release_authority_restore_inventory'::regclass AND relowner='postgres'::regrole)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR to_regclass('pg_temp.custodial_creator_acl_101_before') IS NOT NULL
  OR EXISTS(SELECT 1 FROM unnest(ARRAY[]::text[]) x WHERE to_regclass(x) IS NOT NULL)
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_lunch_spoken_body']::text[]))
  OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
   CROSS JOIN LATERAL(SELECT regexp_replace(i.object_identity,'[[:space:]"]','','g') identity) clean
   WHERE (i.object_kind IN('function','grant') AND EXISTS(SELECT 1 FROM unnest(ARRAY['custodial_native_lunch_spoken_body']::text[]) name
    WHERE split_part(clean.identity,'(',1)=ANY(ARRAY[name,'public.'||name])))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY[]::text[]) relation
     WHERE starts_with(clean.identity,relation) OR starts_with(clean.identity,substr(relation,8)))) THEN
  RAISE EXCEPTION 'Finite creator Source101 original owner/new-object boundary changed';
 END IF;
END $creator_pre$;
CREATE TEMP TABLE custodial_creator_acl_101_before(class text NOT NULL,signature text PRIMARY KEY,object_oid oid NOT NULL,owner_oid oid NOT NULL,owner_acl jsonb NOT NULL,definition_md5 text) ON COMMIT DROP;
-- END FINITE NEW-CREATOR PROFILE 101
create function public.custodial_native_lunch_spoken_body(
 p_projection uuid,p_document_identity text,p_loan_id text,p_coverer uuid,p_event text
) returns text language plpgsql stable security invoker
set search_path=pg_catalog,public as $fn$
declare doc public.weekly_schedule_lunch_documents%rowtype;
 projection public.weekly_schedule_compiled_projections%rowtype;
 loan jsonb;owner_name text;coverer_name text;coverer_slot text;body text;
 end_label text;duration_minutes numeric;duration_label text;matches integer;
begin
 if p_projection is null or p_coverer is null or p_event is null or p_event not in ('start','end')
  or coalesce(p_document_identity,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_loan_id,'') !~ '^[0-9a-f]{64}$' then
  raise exception 'exact accepted lunch speech source required' using errcode='22023';end if;
 select * into doc from public.weekly_schedule_lunch_documents where projection_id=p_projection;
 select * into projection from public.weekly_schedule_compiled_projections where projection_id=p_projection;
 if doc.projection_id is null or projection.projection_id is null
  or doc.document_identity is distinct from p_document_identity then
  raise exception 'lunch speech document superseded' using errcode='22023';end if;
 perform public.static_weekly_v8_assert_lunch_document(p_projection,doc.document_json);
 select value into strict loan from jsonb_array_elements(doc.document_json->'loans') value
  where value->>'loan_id'=p_loan_id and value->>'status'='PLANNED';
 select count(*),min(value->>'incumbentName') into matches,owner_name
  from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') value
  where value->>'serviceDate'=loan->>'service_date'
   and value->>'slotId'=loan->>'normal_owner_slot_id'
   and value->>'incumbentPersonId'=loan->>'normal_owner_person_id' and value->>'status'='working';
 if matches<>1 then raise exception 'lunch speech owner identity ambiguous' using errcode='22023';end if;
 select count(*),min(a->>'incumbentName'),min(a->>'slotId') into matches,coverer_name,coverer_slot
  from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') a
  where a->>'serviceDate'=loan->>'service_date' and a->>'incumbentPersonId'=p_coverer::text
   and a->>'status'='working' and (loan->'helper_slot_ids') ? (a->>'slotId');
 if matches<>1 or not exists(select 1 from jsonb_array_elements(doc.document_json->'notification_intents') i
  where i->>'loan_id'=p_loan_id and i->>'event'=p_event and i->>'coverer_slot_id'=coverer_slot
   and i->>'service_date'=loan->>'service_date') then
  raise exception 'lunch speech recipient or intent ambiguous' using errcode='22023';end if;
 if owner_name is null or coverer_name is null or btrim(owner_name)='' or btrim(coverer_name)=''
  or octet_length(owner_name)>180 or octet_length(coverer_name)>180
  or owner_name ~ '[[:cntrl:]]' or coverer_name ~ '[[:cntrl:]]' then
  raise exception 'accepted lunch speech name missing or unsupported' using errcode='22023';end if;
 -- The full accepted-document validator above STILL validates borrowed areas,
 -- partial windows, restrictions and check-only/on-call policy. Do not speak or
 -- copy area labels into audio. The current Schedule retains those facts.
 duration_minutes:=extract(epoch from ((loan->>'coverage_end')::time-(loan->>'coverage_start')::time))/60;
 if duration_minutes<=0 or duration_minutes<>trunc(duration_minutes) then
  raise exception 'accepted lunch speech duration unsupported' using errcode='22023';end if;
 duration_label:=trunc(duration_minutes)::integer::text||case when duration_minutes=1 then ' minute' else ' minutes' end;
 end_label:=to_char(date '2000-01-01'+(loan->>'coverage_end')::time,'FMHH12:MI AM');
 body:=case p_event when 'start' then 'You are on lunch coverage now for ' else 'Your scheduled lunch coverage for ' end
  ||owner_name||case p_event when 'start' then ' until ' else ' ended at ' end
  ||end_label||' Memphis time. Scheduled duration: '||duration_label
  ||'. Please see your schedule page for your updated assignments.';
 if octet_length(body)>1000 or body ~ '[[:cntrl:]]' then
  raise exception 'native lunch source text unsupported; no truncation' using errcode='22023';end if;
 return body;
end $fn$;

DO $creator_function_before$ DECLARE spec record;p record;BEGIN
 FOR spec IN SELECT * FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)","name":"custodial_native_lunch_spoken_body","body_md5":"8c3f11053950082f270d68e2347a543a","argument_names":["p_projection","p_document_identity","p_loan_id","p_coverer","p_event"],"returns":"text","language":"plpgsql","security_definer":false,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]}]$creator_specs$::jsonb)
  AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) LOOP
  SELECT f.*,l.lanname INTO STRICT p FROM pg_proc f JOIN pg_language l ON l.oid=f.prolang WHERE f.oid=to_regprocedure(spec.signature) AND f.pronamespace='public'::regnamespace;
  IF p.proowner<>'postgres'::regrole OR p.proname<>spec.name OR md5(p.prosrc)<>spec.body_md5
   OR p.proargnames IS DISTINCT FROM spec.argument_names OR pg_get_function_result(p.oid)<>spec.returns OR p.lanname<>spec.language
   OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility OR p.proconfig IS DISTINCT FROM spec.config
   OR p.prokind<>'f' OR p.proretset OR p.provariadic<>0 OR p.pronargdefaults<>0 OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
   OR NOT has_function_privilege(current_user,p.oid,'EXECUTE')
   OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND a.privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND(a.grantor<>p.proowner OR a.is_grantable)) THEN
   RAISE EXCEPTION 'Finite creator Source101 new routine owner/body/ordinary EXECUTE unavailable';END IF;
  INSERT INTO pg_temp.custodial_creator_acl_101_before VALUES('function',spec.signature,p.oid,p.proowner,(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner),md5(pg_get_functiondef(p.oid)));
 END LOOP;
END $creator_function_before$;
revoke all on function public.custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)
 from public,anon,authenticated,service_role,static_weekly_control_plane,
 custodial_application_reader,static_weekly_release_operator;
DO $creator_before_capture$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_lunch_spoken_body']::text[]))<>1
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_101_before)<>1 THEN
  RAISE EXCEPTION 'Finite creator Source101 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_101_before LOOP
  IF before.class='relation' THEN
   SELECT * INTO STRICT c FROM pg_class WHERE oid=to_regclass(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner);
   IF c.oid<>before.object_oid OR c.relowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     CROSS JOIN aclexplode(acldefault('r',c.relowner)) ordinary WHERE has_table_privilege(role,c.oid,ordinary.privilege_type))
    OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled='O' AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgtype=62 AND NOT tgisinternal)
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source101 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source101 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)","name":"custodial_native_lunch_spoken_body","body_md5":"8c3f11053950082f270d68e2347a543a","argument_names":["p_projection","p_document_identity","p_loan_id","p_coverer","p_event"],"returns":"text","language":"plpgsql","security_definer":false,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source101 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_before_capture$;


-- Only the new-reservation body changes. In particular, the preceding original
-- receipt replay/conflict branch and all later live/size/hash checks stay exact.
do $patch$ declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.custodial_native_lunch_reserve_at(uuid,uuid,jsonb,timestamptz)'::regprocedure);
 old:=$old$'body',case source#>>'{source,event}' when 'start' then 'Your temporary lunch coverage has started. Open My Schedule for borrowed areas.'
   else 'Your temporary lunch coverage has ended. Your normal assignments remain unchanged.' end,$old$;
 replacement:=$new$'body',public.custodial_native_lunch_spoken_body(j.source_id,source#>>'{source,source_digest}',
   source#>>'{source,loan_id}',(p_expected->>'employee_id')::uuid,source#>>'{source,event}'),$new$;
 if definition is null or (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
  raise exception 'exact original lunch body patch point absent or ambiguous';end if;
 execute replace(definition,old,replacement);
end $patch$;

-- Both changed definitions and their unchanged/private EXECUTE decisions are
-- bound into the existing recovery inventory. No new table, sequence or API.
lock table public.custodial_release_authority_restore_inventory in access exclusive mode;
create temp table lunch_speech_inventory_before on commit drop as
 select * from public.custodial_release_authority_restore_inventory;
do $canary$ declare definition text;patched text;begin
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if public.static_weekly_digest_text(definition)<>'1baa9c516b9e0032ce556c103f863d850ab0624b93712f0273813f5046743aa9'
  or not exists(select 1 from public.custodial_release_authority_restore_inventory
   where object_kind='function' and object_identity='custodial_release_canary_authority_surface()'
    and definition_sql=definition and definition_sha256=public.static_weekly_digest_text(definition))
  or not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A') then
  raise exception 'lunch speech captured canary/ALWAYS guard changed';end if;
 patched:=replace(definition,E'  values\n',E'  values\n'
  ||E'    (''function'',''custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)'',''accepted lunch spoken content''),\n'
  ||E'    (''grant'',''custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)'',''accepted lunch spoken content''),\n');
 if patched=definition then raise exception 'lunch speech canary seam missing';end if;
 execute patched;
 if pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) is distinct from patched then
  raise exception 'lunch speech canary serialization changed';end if;
end $canary$;
alter table public.custodial_release_authority_restore_inventory
 disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$ declare obj record;next_order integer;changed integer;begin
 for obj in with funcs as (
  select p.oid from pg_proc p where p.oid in (
   'public.custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)'::regprocedure,
   'public.custodial_native_lunch_reserve_at(uuid,uuid,jsonb,timestamptz)'::regprocedure,
   'public.custodial_release_canary_authority_surface()'::regprocedure)
 ),objects as (
  select 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition from funcs
  union all select 900000,'grant',oid::regprocedure::text,
   public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing lunch speech recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or
    (object_identity like '%(%' and to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  get diagnostics changed=row_count;
  if changed>1 then raise exception 'duplicate lunch speech recovery object %',obj.identity;end if;
  if changed=0 then
   select n into next_order from generate_series(obj.bucket+1,obj.bucket+99998) n
    where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n)
    order by n limit 1;
   if next_order is null then raise exception 'lunch speech recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory
 enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
do $scope$ begin
 if exists(select i.* from lunch_speech_inventory_before i
   where not (case when object_kind in ('function','grant') and object_identity like '%(%'
    then to_regprocedure(object_identity) else null end in (
    'public.custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)'::regprocedure,
    'public.custodial_native_lunch_reserve_at(uuid,uuid,jsonb,timestamptz)'::regprocedure,
    'public.custodial_release_canary_authority_surface()'::regprocedure) is true)
   except select * from public.custodial_release_authority_restore_inventory)
  or exists(select i.* from public.custodial_release_authority_restore_inventory i
   where not (case when object_kind in ('function','grant') and object_identity like '%(%'
    then to_regprocedure(object_identity) else null end in (
    'public.custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)'::regprocedure,
    'public.custodial_native_lunch_reserve_at(uuid,uuid,jsonb,timestamptz)'::regprocedure,
    'public.custodial_release_canary_authority_surface()'::regprocedure) is true)
   except select * from lunch_speech_inventory_before) then
  raise exception 'unrelated lunch speech inventory changed';end if;
 if (select count(*) from public.custodial_release_canary_authority_surface()
  where object_identity='custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)'
   and object_kind in ('function','grant'))<>2
  or not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A') then
  raise exception 'lunch speech exact canary/ALWAYS readback changed';end if;
end $scope$;

DO $creator_after$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_lunch_spoken_body']::text[]))<>1
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_101_before)<>1 THEN
  RAISE EXCEPTION 'Finite creator Source101 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_101_before LOOP
  IF before.class='relation' THEN
   SELECT * INTO STRICT c FROM pg_class WHERE oid=to_regclass(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner);
   IF c.oid<>before.object_oid OR c.relowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     CROSS JOIN aclexplode(acldefault('r',c.relowner)) ordinary WHERE has_table_privilege(role,c.oid,ordinary.privilege_type))
    OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled='O' AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgtype=62 AND NOT tgisinternal)
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source101 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source101 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)","name":"custodial_native_lunch_spoken_body","body_md5":"8c3f11053950082f270d68e2347a543a","argument_names":["p_projection","p_document_identity","p_loan_id","p_coverer","p_event"],"returns":"text","language":"plpgsql","security_definer":false,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source101 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_after$;
commit;
