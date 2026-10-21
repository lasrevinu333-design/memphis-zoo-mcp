-- Business-level one-attempt/outcome ledger. No native qualification,
-- sender, worker activation or handset delivery is enabled by this migration.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE FUNCTION public.custodial_native_schedule_attempt_binding(p_job uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE r public.employee_native_push_delivery_receipts%rowtype;f public.employee_native_schedule_finalizations%rowtype;
BEGIN
 SELECT * INTO r FROM public.employee_native_push_delivery_receipts WHERE job_id=p_job;
 SELECT * INTO f FROM public.employee_native_schedule_finalizations WHERE job_id=p_job;
 IF r.job_id IS NULL OR f.job_id IS NULL OR r.source_id IS DISTINCT FROM f.source_reservation_id
  OR r.native_payload_sha256 IS DISTINCT FROM f.content_sha256
  OR public.custodial_native_schedule_receipt_binding(r.native_payload,r.job_id,r.source_id,r.credential_id,r.assignment_epoch,
   r.native_generation_id,r.token_hash,r.prepared_at,r.native_valid_until,r.native_payload_sha256) IS NOT TRUE THEN
  RAISE EXCEPTION 'exact original SCHEDULE finalization required' USING errcode='42501';END IF;
 RETURN jsonb_build_object('receipt_job_id',r.job_id::text,'lease_token',r.lease_token::text,
  'registration_id',r.registration_id::text,'generation_id',r.native_generation_id::text,
  'reservation_at',public.custodial_native_location_utc(r.prepared_at),'content_sha256',r.native_payload_sha256,
  'token_digest',r.token_hash,'principal_digest',r.native_payload->>'principal_digest',
  'receipt_credential_id',r.credential_id::text,'receipt_assignment_epoch',r.assignment_epoch::text,
  'receipt_employee_id',r.native_payload->>'receipt_employee_id','receipt_device_id',r.native_payload->>'receipt_device_id',
  'source_reservation_id',f.source_reservation_id::text);
END $fn$;
CREATE TABLE public.employee_native_schedule_dispatch_attempts(
 job_id uuid PRIMARY KEY REFERENCES public.employee_native_schedule_finalizations(job_id),
 source_reservation_id uuid NOT NULL UNIQUE REFERENCES public.employee_native_schedule_source_reservations(reservation_id),
 attempt_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 outcome_operation_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 attempt_reserved_at timestamptz NOT NULL CHECK(isfinite(attempt_reserved_at)),
 binding jsonb NOT NULL CHECK(jsonb_typeof(binding)='object'),
 CHECK(attempt_id<>outcome_operation_id)
);
CREATE TABLE public.employee_native_schedule_outcomes(
 job_id uuid PRIMARY KEY REFERENCES public.employee_native_schedule_dispatch_attempts(job_id),
 operation_id uuid NOT NULL UNIQUE,
 binding jsonb NOT NULL CHECK(jsonb_typeof(binding)='object'),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at))
);
CREATE FUNCTION public.custodial_native_schedule_evidence_valid(p jsonb)
 RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(p) key)
  IS DISTINCT FROM ARRAY['error_code','operation_id','outcome','provider_message_id']
  OR jsonb_typeof(p->'operation_id') IS DISTINCT FROM 'string' OR p->>'operation_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  OR jsonb_typeof(p->'outcome') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
 IF p->>'outcome'='provider_accepted' THEN
  RETURN p->'error_code'='null'::jsonb AND jsonb_typeof(p->'provider_message_id')='string'
   AND length(p->>'provider_message_id') BETWEEN 1 AND 1000
   AND p->>'provider_message_id'=btrim(p->>'provider_message_id') AND p->>'provider_message_id' !~ '[[:cntrl:]]';
 END IF;
 RETURN p->>'outcome' IN('known_nonacceptance','delivery_outcome_unknown') AND p->'provider_message_id'='null'::jsonb
  AND jsonb_typeof(p->'error_code')='string' AND p->>'error_code'~'^[a-z][a-z0-9_]{0,99}$';
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_attempt_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE r public.employee_native_push_delivery_receipts%rowtype;j public.operational_notification_jobs%rowtype;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SCHEDULE attempt immutable' USING errcode='23514';END IF;
 SELECT * INTO r FROM public.employee_native_push_delivery_receipts WHERE job_id=NEW.job_id;
 SELECT * INTO j FROM public.operational_notification_jobs WHERE job_id=NEW.job_id;
 IF NEW.binding IS DISTINCT FROM public.custodial_native_schedule_attempt_binding(NEW.job_id)
  OR NEW.source_reservation_id IS DISTINCT FROM r.source_id OR NEW.attempt_reserved_at<r.prepared_at
  OR NEW.attempt_reserved_at>=r.native_valid_until OR j.status IS DISTINCT FROM 'leased'
  OR j.lease_token IS DISTINCT FROM r.lease_token OR j.leased_until IS NULL OR j.leased_until<=NEW.attempt_reserved_at
  OR public.custodial_native_schedule_live(NEW.job_id,r.native_payload,NEW.attempt_reserved_at) IS NOT TRUE THEN
  RAISE EXCEPTION 'SCHEDULE attempt not current original leased source' USING errcode='23514';END IF;
 RETURN NEW;
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_outcome_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a public.employee_native_schedule_dispatch_attempts%rowtype;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SCHEDULE outcome immutable' USING errcode='23514';END IF;
 SELECT * INTO a FROM public.employee_native_schedule_dispatch_attempts WHERE job_id=NEW.job_id;
 IF a.job_id IS NULL OR NEW.operation_id IS DISTINCT FROM a.outcome_operation_id OR NEW.binding IS DISTINCT FROM a.binding
  OR NEW.binding IS DISTINCT FROM public.custodial_native_schedule_attempt_binding(NEW.job_id)
  OR NEW.recorded_at<a.attempt_reserved_at OR public.custodial_native_schedule_evidence_valid(NEW.evidence) IS NOT TRUE
  OR NEW.evidence->>'operation_id' IS DISTINCT FROM NEW.operation_id::text THEN
  RAISE EXCEPTION 'SCHEDULE outcome not exact original attempt' USING errcode='23514';END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER trg_native_schedule_attempt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.employee_native_schedule_dispatch_attempts
 FOR EACH ROW EXECUTE FUNCTION public.custodial_native_schedule_attempt_guard();
CREATE TRIGGER trg_native_schedule_outcome_guard BEFORE INSERT OR UPDATE OR DELETE ON public.employee_native_schedule_outcomes
 FOR EACH ROW EXECUTE FUNCTION public.custodial_native_schedule_outcome_guard();
ALTER TABLE public.employee_native_schedule_dispatch_attempts ENABLE ALWAYS TRIGGER trg_native_schedule_attempt_guard;
ALTER TABLE public.employee_native_schedule_outcomes ENABLE ALWAYS TRIGGER trg_native_schedule_outcome_guard;
ALTER TABLE public.employee_native_schedule_dispatch_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_native_schedule_dispatch_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.employee_native_schedule_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_native_schedule_outcomes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_native_schedule_dispatch_attempts,public.employee_native_schedule_outcomes FROM PUBLIC,postgres,anon,
 authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;

CREATE FUNCTION public.custodial_native_schedule_dispatch_prepare_at(p_job uuid,p_lease uuid,p_source uuid,p_expected jsonb,p_test_at timestamptz)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v jsonb;r public.employee_native_push_delivery_receipts%rowtype;a public.employee_native_schedule_dispatch_attempts%rowtype;
 j public.operational_notification_jobs%rowtype;at_time timestamptz;ttl bigint;
BEGIN
 -- The exact existing finalizer owns actor/source/publication locks. Its
 -- original replay is NOT fresh authority; revalidate after those locks.
 v:=public.custodial_native_schedule_finalize_at(p_job,p_lease,p_source,p_expected,p_test_at);
 IF v->'finalized' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-dispatch.v1','dispatch_authorized',false,
   'delivery_admitted',false,'replayed',false,'reason','SOURCE_OR_JOB_SUPERSEDED','attempt',null);END IF;
 SELECT * INTO a FROM public.employee_native_schedule_dispatch_attempts WHERE job_id=p_job FOR UPDATE;
 IF a.job_id IS NOT NULL THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-dispatch.v1','dispatch_authorized',false,
   'delivery_admitted',false,'replayed',true,'reason','ORIGINAL_ATTEMPT_RETAINED','attempt',null);END IF;
 SELECT * INTO r FROM public.employee_native_push_delivery_receipts WHERE job_id=p_job FOR UPDATE;
 SELECT * INTO j FROM public.operational_notification_jobs WHERE job_id=p_job FOR UPDATE;
 at_time:=coalesce(p_test_at,clock_timestamp());
 ttl:=least(2419200,floor(extract(epoch from r.native_valid_until-at_time))::bigint);
 IF NOT isfinite(at_time) OR ttl<=0 OR j.status IS DISTINCT FROM 'leased' OR j.lease_token IS DISTINCT FROM p_lease
  OR j.leased_until IS NULL OR j.leased_until<=at_time OR at_time<r.prepared_at
  OR public.custodial_native_schedule_live(p_job,r.native_payload,at_time) IS NOT TRUE THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-dispatch.v1','dispatch_authorized',false,
   'delivery_admitted',false,'replayed',false,'reason','SOURCE_OR_JOB_SUPERSEDED','attempt',null);END IF;
 INSERT INTO public.employee_native_schedule_dispatch_attempts(job_id,source_reservation_id,attempt_reserved_at,binding)
 VALUES(p_job,p_source,at_time,public.custodial_native_schedule_attempt_binding(p_job)) RETURNING * INTO a;
 RETURN jsonb_build_object('schema','custodial.native-schedule-dispatch.v1','dispatch_authorized',true,
  'delivery_admitted',false,'replayed',false,'reason',null,'attempt',jsonb_build_object('attempt_id',a.attempt_id::text,
   'outcome_operation_id',a.outcome_operation_id::text,'attempt_reserved_at',public.custodial_native_location_utc(a.attempt_reserved_at),
   'binding',a.binding,'payload',r.native_payload,'wire',public.custodial_native_location_canonical(r.native_payload),'ttl_seconds',ttl));
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_dispatch_prepare(uuid,uuid,uuid,jsonb)
 RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.custodial_native_schedule_dispatch_prepare_at($1,$2,$3,$4,null);
$fn$;
CREATE FUNCTION public.custodial_native_schedule_dispatch_status(p_job uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a public.employee_native_schedule_dispatch_attempts%rowtype;o public.employee_native_schedule_outcomes%rowtype;
BEGIN
 IF p_job IS NULL THEN RAISE EXCEPTION 'exact original SCHEDULE job required' USING errcode='22023';END IF;
 SELECT * INTO a FROM public.employee_native_schedule_dispatch_attempts WHERE job_id=p_job;
 SELECT * INTO o FROM public.employee_native_schedule_outcomes WHERE job_id=p_job;
 RETURN jsonb_build_object('schema','custodial.native-schedule-dispatch-status.v1','attempted',a.job_id IS NOT NULL,
  'dispatch_authorized',false,'delivery_admitted',false,'attempt',CASE WHEN a.job_id IS NOT NULL THEN jsonb_build_object(
   'attempt_id',a.attempt_id::text,'outcome_operation_id',a.outcome_operation_id::text,
   'attempt_reserved_at',public.custodial_native_location_utc(a.attempt_reserved_at),'binding',a.binding,
   'provider_outcome',coalesce(o.evidence->>'outcome','prepared'),'evidence',o.evidence,
   'server_received_at',CASE WHEN o.job_id IS NOT NULL THEN public.custodial_native_location_utc(o.recorded_at) ELSE null END) ELSE null END);
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_outcome_at(p_binding jsonb,p_evidence jsonb,p_test_at timestamptz)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a public.employee_native_schedule_dispatch_attempts%rowtype;o public.employee_native_schedule_outcomes%rowtype;
 at_time timestamptz;replay boolean:=false;
BEGIN
 PERFORM public.custodial_begin_application_mutation();
 IF jsonb_typeof(p_binding) IS DISTINCT FROM 'object' OR p_binding->>'receipt_job_id' IS NULL
  OR p_binding->>'receipt_job_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  OR public.custodial_native_schedule_evidence_valid(p_evidence) IS NOT TRUE
  OR (p_test_at IS NOT NULL AND NOT isfinite(p_test_at)) THEN
  RAISE EXCEPTION 'exact original SCHEDULE binding/evidence required' USING errcode='22023';END IF;
 SELECT * INTO a FROM public.employee_native_schedule_dispatch_attempts WHERE job_id=(p_binding->>'receipt_job_id')::uuid FOR UPDATE;
 IF a.job_id IS NULL OR a.binding IS DISTINCT FROM p_binding OR p_evidence->>'operation_id' IS DISTINCT FROM a.outcome_operation_id::text THEN
  RAISE EXCEPTION 'original SCHEDULE attempt binding/operation required' USING errcode='42501';END IF;
 SELECT * INTO o FROM public.employee_native_schedule_outcomes WHERE job_id=a.job_id FOR UPDATE;
 IF o.job_id IS NOT NULL THEN
  IF o.binding IS DISTINCT FROM p_binding OR o.evidence IS DISTINCT FROM p_evidence THEN
   RAISE EXCEPTION 'original SCHEDULE outcome conflict; no resend' USING errcode='23505';END IF;
  replay:=true;
 ELSE
  at_time:=coalesce(p_test_at,clock_timestamp());
  IF at_time<a.attempt_reserved_at THEN RAISE EXCEPTION 'outcome precedes original SCHEDULE attempt' USING errcode='22023';END IF;
  INSERT INTO public.employee_native_schedule_outcomes(job_id,operation_id,binding,evidence,recorded_at)
  VALUES(a.job_id,a.outcome_operation_id,p_binding,p_evidence,at_time) RETURNING * INTO o;
 END IF;
 RETURN jsonb_build_object('schema','custodial.native-schedule-outcome-receipt.v1','binding',a.binding,'evidence',o.evidence,
  'server_received_at',public.custodial_native_location_utc(o.recorded_at),'replayed',replay,
  'dispatch_authorized',false,'delivery_admitted',false);
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_outcome(jsonb,jsonb)
 RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.custodial_native_schedule_outcome_at($1,$2,null);
$fn$;
DO $acl$ DECLARE f regprocedure;rel text;BEGIN
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'custodial_native_schedule_attempt_binding','custodial_native_schedule_evidence_valid','custodial_native_schedule_attempt_guard',
  'custodial_native_schedule_outcome_guard','custodial_native_schedule_dispatch_prepare_at','custodial_native_schedule_dispatch_prepare',
  'custodial_native_schedule_dispatch_status','custodial_native_schedule_outcome_at','custodial_native_schedule_outcome') LOOP
  EXECUTE format('revoke all on function %s from public,postgres,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823',f);
 END LOOP;
 FOREACH rel IN ARRAY ARRAY['public.employee_native_schedule_dispatch_attempts','public.employee_native_schedule_outcomes'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=rel::regclass AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled='O') THEN
   RAISE EXCEPTION 'SCHEDULE attempt/outcome restore fence missing';END IF;
 END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION public.custodial_native_schedule_dispatch_prepare(uuid,uuid,uuid,jsonb),
 public.custodial_native_schedule_dispatch_status(uuid),public.custodial_native_schedule_outcome(jsonb,jsonb) TO service_role;
-- Exact recovery closure: new internal relation, fields, constraints, state,
-- immutable/fence triggers, functions and explicit grants, no runtime policy.
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE schedule_attempt_inventory_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $canary$ DECLARE definition text;patched text;BEGIN
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
  AND object_identity='custodial_release_canary_authority_surface()' AND definition_sql=definition
  AND definition_sha256=public.static_weekly_digest_text(definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'SCHEDULE attempt/outcome captured canary/ALWAYS boundary changed';END IF;
 patched:=replace(definition,E'  values\n',E'  values\n'
  ||E'    (''relation'',''public.employee_native_schedule_outcomes'',''immutable original provider outcome; not handset delivery''),\n'
  ||E'    (''relation_state'',''public.employee_native_schedule_outcomes'',''RPC-only FORCE-RLS outcomes''),\n'
  ||E'    (''grant'',''public.employee_native_schedule_outcomes'',''no direct runtime outcome access''),\n'
  ||E'    (''function'',''custodial_native_schedule_dispatch_status(uuid)'',''original attempt/outcome readback; never resends''),\n'
  ||E'    (''function'',''custodial_native_schedule_outcome(jsonb,jsonb)'',''service-only original settlement; no successor mutation''),\n'
  ||E'    (''relation'',''public.employee_native_schedule_dispatch_attempts'',''immutable single business attempt; native qualification separate''),\n'
  ||E'    (''relation_state'',''public.employee_native_schedule_dispatch_attempts'',''RPC-only FORCE-RLS attempt original''),\n'
  ||E'    (''grant'',''public.employee_native_schedule_dispatch_attempts'',''no direct runtime source access''),\n'
  ||E'    (''function'',''custodial_native_schedule_dispatch_prepare(uuid,uuid,uuid,jsonb)'',''service-only business attempt; no runtime activation''),\n'
);
 IF patched=definition THEN RAISE EXCEPTION 'SCHEDULE attempt/outcome canary seam changed';END IF;EXECUTE patched;
END $canary$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 FOR obj IN WITH funcs AS(SELECT p.oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN(
  'custodial_native_schedule_attempt_binding','custodial_native_schedule_evidence_valid','custodial_native_schedule_attempt_guard','custodial_native_schedule_outcome_guard','custodial_native_schedule_dispatch_prepare_at','custodial_native_schedule_dispatch_prepare','custodial_native_schedule_dispatch_status','custodial_native_schedule_outcome_at','custodial_native_schedule_outcome','custodial_release_canary_authority_surface')),
 objects AS(
  SELECT 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
  UNION ALL SELECT 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) FROM funcs
  UNION ALL SELECT x.bucket,x.kind,x.identity,x.definition FROM unnest(array['public.employee_native_schedule_dispatch_attempts','public.employee_native_schedule_outcomes']) rel CROSS JOIN LATERAL(
   SELECT 1000 bucket,'relation'::text kind,rel identity,public.custodial_release_authority_current_relation_definition(rel) definition
   UNION ALL SELECT 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname)
    FROM pg_attribute WHERE attrelid=rel::regclass AND attnum>0 AND NOT attisdropped
   UNION ALL SELECT 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
   UNION ALL SELECT 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
   UNION ALL SELECT 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
    FROM pg_constraint WHERE conrelid=rel::regclass
   UNION ALL SELECT 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
    FROM pg_index i WHERE indrelid=rel::regclass AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid)
   UNION ALL SELECT 700000,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '
    ||pg_get_triggerdef(oid,true)||'; alter table '||rel||CASE WHEN tgenabled='A' THEN ' enable always trigger ' ELSE ' enable trigger ' END||quote_ident(tgname)||';'
    FROM pg_trigger WHERE tgrelid=rel::regclass AND NOT tgisinternal
   UNION ALL SELECT 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)) x)
 SELECT * FROM objects ORDER BY bucket,identity LOOP
  IF obj.definition IS NULL THEN RAISE EXCEPTION 'missing SCHEDULE attempt/outcome recovery object %',obj.identity;END IF;
  UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   WHERE object_kind=obj.kind AND(object_identity=obj.identity OR(obj.kind IN('function','grant') AND object_identity LIKE '%(%'
    AND obj.identity LIKE '%(%' AND to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  GET DIAGNOSTICS changed=row_count;IF changed>1 THEN RAISE EXCEPTION 'duplicate SCHEDULE attempt/outcome recovery %',obj.identity;END IF;
  IF changed=0 THEN SELECT n INTO next_order FROM generate_series(obj.bucket+1,CASE WHEN obj.bucket=1000 THEN 99998 ELSE obj.bucket+99998 END) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
   IF next_order IS NULL THEN RAISE EXCEPTION 'SCHEDULE attempt/outcome recovery order exhausted';END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));END IF;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF EXISTS(SELECT i.* FROM schedule_attempt_inventory_before i WHERE NOT(
   object_identity='custodial_release_canary_authority_surface()' AND object_kind IN('function','grant'))
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory) THEN
  RAISE EXCEPTION 'unrelated SCHEDULE attempt/outcome recovery row changed';END IF;
END $scope$;
COMMIT;
