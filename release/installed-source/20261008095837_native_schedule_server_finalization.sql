-- Exact existing postgres NEW-creator equivalence; canonical bodies/other-role revocations unchanged.
-- Persist the closed SCHEDULE wire from its immutable accepted SOURCE only.
-- No job producer, provider attempt/send, native qualification or route is
-- activated. Both first finalization and original replay have no send right.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';


-- BEGIN FINITE NEW-CREATOR PROFILE 106
DO $creator_pre$ BEGIN
 IF current_user<>'postgres' OR session_user<>current_user
  OR current_setting('custodial.deployment_project_ref',true) IS DISTINCT FROM 'rqquvtjdmugpigbndmne'
  OR current_setting('session_replication_role')<>'origin'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.custodial_release_authority_restore_inventory'::regclass AND relowner='postgres'::regrole)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR to_regclass('pg_temp.custodial_creator_acl_106_before') IS NOT NULL
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['public.employee_native_schedule_finalizations']::text[]) x WHERE to_regclass(x) IS NOT NULL)
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_receipt_binding','custodial_native_schedule_finalization_guard','custodial_native_schedule_finalize_at','custodial_native_schedule_finalize','custodial_native_schedule_finalization_status']::text[]))
  OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
   CROSS JOIN LATERAL(SELECT regexp_replace(i.object_identity,'[[:space:]"]','','g') identity) clean
   WHERE (i.object_kind IN('function','grant') AND EXISTS(SELECT 1 FROM unnest(ARRAY['custodial_native_schedule_receipt_binding','custodial_native_schedule_finalization_guard','custodial_native_schedule_finalize_at','custodial_native_schedule_finalize','custodial_native_schedule_finalization_status']::text[]) name
    WHERE split_part(clean.identity,'(',1)=ANY(ARRAY[name,'public.'||name])))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['public.employee_native_schedule_finalizations']::text[]) relation
     WHERE starts_with(clean.identity,relation) OR starts_with(clean.identity,substr(relation,8)))) THEN
  RAISE EXCEPTION 'Finite creator Source106 original owner/new-object boundary changed';
 END IF;
END $creator_pre$;
CREATE TEMP TABLE custodial_creator_acl_106_before(class text NOT NULL,signature text PRIMARY KEY,object_oid oid NOT NULL,owner_oid oid NOT NULL,owner_acl jsonb NOT NULL,definition_md5 text) ON COMMIT DROP;
-- END FINITE NEW-CREATOR PROFILE 106
CREATE FUNCTION public.custodial_native_schedule_receipt_binding(
 p jsonb,p_job uuid,p_source uuid,p_credential uuid,p_epoch bigint,p_generation uuid,
 p_token text,p_at timestamptz,p_until timestamptz,p_sha text
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE keys text[];field text;source_from timestamptz;source_until timestamptz;
BEGIN
 IF p IS NULL OR p_job IS NULL OR p_source IS NULL OR p_credential IS NULL OR p_epoch IS NULL
  OR p_generation IS NULL OR p_token IS NULL OR p_at IS NULL OR p_until IS NULL OR p_sha IS NULL
  OR jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 SELECT array_agg(key ORDER BY key COLLATE "C") INTO keys FROM jsonb_object_keys(p) key;
 IF keys IS DISTINCT FROM ARRAY['assignment_occurrence_id','body','boundary_local','channel_id','content_sha256',
  'generation_id','kind','notification_key','notification_type','principal_digest','projection_id','publication_id',
  'receipt_assignment_epoch','receipt_credential_id','receipt_device_id','receipt_employee_id','receipt_job_id',
  'reservation_at','route','schema','server_source_sha256','service_date','source_operation_id','source_reservation_id',
  'source_revision','source_valid_from','source_valid_until','source_window_sha256','title','token_digest','valid_until','version_id']
  OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string')
  OR EXISTS(SELECT 1 FROM jsonb_each_text(p) e WHERE e.value='' OR e.value~'[[:cntrl:]]'
   OR octet_length(e.value)>CASE WHEN e.key='title' THEN 180 WHEN e.key='notification_key' THEN 240 ELSE 1000 END)
  OR p->>'schema'<>'custodial.native-schedule-payload.v1' OR p->>'kind'<>'employee_schedule_ownership'
  OR p->>'notification_type'<>'schedule_ownership' OR p->>'channel_id'<>'employee-schedule-ownership'
  OR p->>'route'<>'employee-schedule.html?hub=employee' OR p->>'boundary_local'<>'09:45'
  OR p->>'generation_id'<>p_generation::text OR p->>'receipt_job_id'<>p_job::text
  OR p->>'source_reservation_id'<>p_source::text OR p->>'receipt_credential_id'<>p_credential::text
  OR p->>'receipt_assignment_epoch'<>p_epoch::text OR p_epoch<1 OR p_epoch>9007199254740991
  OR p->>'token_digest'<>p_token OR p->>'content_sha256'<>p_sha
  OR p->>'receipt_device_id' !~ '^KIOSK_(0[2-9]|10)$'
  OR p->>'source_revision' !~ '^[1-9][0-9]{0,15}$' OR (p->>'source_revision')::numeric>9007199254740991
  OR p->>'notification_key'<>'schedule-ownership:'||(p->>'service_date')||':'||(p->>'receipt_employee_id')||':09:45'
  THEN RETURN false;END IF;
 FOREACH field IN ARRAY ARRAY['generation_id','receipt_job_id','receipt_credential_id','receipt_employee_id',
  'source_reservation_id','source_operation_id','projection_id','publication_id','version_id','assignment_occurrence_id'] LOOP
  IF p->>field !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RETURN false;END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['principal_digest','token_digest','content_sha256','source_window_sha256','server_source_sha256'] LOOP
  IF p->>field !~ '^[0-9a-f]{64}$' THEN RETURN false;END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['source_valid_from','source_valid_until','reservation_at','valid_until'] LOOP
  IF p->>field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
   OR p->>field<>public.custodial_native_location_utc((p->>field)::timestamptz) THEN RETURN false;END IF;
 END LOOP;
 source_from:=(p->>'source_valid_from')::timestamptz;source_until:=(p->>'source_valid_until')::timestamptz;
 RETURN isfinite(p_at) AND isfinite(p_until) AND source_from<=p_at AND p_at<p_until AND p_until<=source_until
  AND p->>'reservation_at'=public.custodial_native_location_utc(p_at)
  AND p->>'valid_until'=public.custodial_native_location_utc(p_until)
  AND (source_from AT TIME ZONE 'America/Chicago')::date::text=p->>'service_date'
  AND (source_from AT TIME ZONE 'America/Chicago')::time=time '09:45'
  AND p_sha=public.static_weekly_digest_text(public.custodial_native_location_canonical(p-'content_sha256'))
  AND octet_length(public.custodial_native_location_canonical(p))<=3500;
EXCEPTION WHEN data_exception THEN RETURN false;
END $fn$;

-- Retain the complete existing LOCATION/LUNCH check expression as a branch;
-- only the separate closed SCHEDULE branch is added. Fail on recovery drift.
DO $binding$ DECLARE definition text;expression text;BEGIN
 definition:=public.custodial_release_authority_current_constraint_definition(
  'public.employee_native_push_delivery_receipts:native_location_payload_binding');
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory
  WHERE object_kind='constraint' AND object_identity='public.employee_native_push_delivery_receipts:native_location_payload_binding'
   AND definition_sql=definition AND definition_sha256=public.static_weekly_digest_text(definition)) THEN
  RAISE EXCEPTION 'SCHEDULE prior receipt constraint/recovery binding changed';END IF;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint
  WHERE conrelid='public.employee_native_push_delivery_receipts'::regclass AND conname='native_location_payload_binding';
 expression:=substring(definition FROM '^CHECK \((.*)\)$');
 IF expression IS NULL THEN RAISE EXCEPTION 'SCHEDULE receipt CHECK envelope changed';END IF;
 ALTER TABLE public.employee_native_push_delivery_receipts DROP CONSTRAINT native_location_payload_binding;
 EXECUTE 'ALTER TABLE public.employee_native_push_delivery_receipts ADD CONSTRAINT native_location_payload_binding CHECK (('
  ||expression||') OR public.custodial_native_schedule_receipt_binding(native_payload,job_id,source_id,credential_id,
   assignment_epoch,native_generation_id,token_hash,prepared_at,native_valid_until,native_payload_sha256) IS TRUE)';
END $binding$;

CREATE TABLE public.employee_native_schedule_finalizations (
 source_reservation_id uuid PRIMARY KEY REFERENCES public.employee_native_schedule_source_reservations(reservation_id),
 job_id uuid NOT NULL UNIQUE REFERENCES public.employee_native_push_delivery_receipts(job_id),
 source_window_sha256 text NOT NULL CHECK(source_window_sha256~'^[0-9a-f]{64}$'),
 content_sha256 text NOT NULL CHECK(content_sha256~'^[0-9a-f]{64}$'),
 finalized_at timestamptz NOT NULL CHECK(isfinite(finalized_at)),
 valid_until timestamptz NOT NULL CHECK(isfinite(valid_until) AND valid_until>finalized_at)
);
ALTER TABLE public.employee_native_schedule_finalizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_native_schedule_finalizations FORCE ROW LEVEL SECURITY;

DO $creator_table_before$ DECLARE identity text;c record;BEGIN
 FOREACH identity IN ARRAY ARRAY['public.employee_native_schedule_finalizations']::text[] LOOP
  SELECT p.oid,p.relowner,p.relacl,p.relkind,p.relpersistence,p.relrowsecurity,p.relforcerowsecurity INTO STRICT c FROM pg_class p WHERE p.oid=to_regclass(identity);
  IF c.relowner<>'postgres'::regrole OR c.relkind<>'r' OR c.relpersistence<>'p' OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
   OR EXISTS(SELECT 1 FROM (SELECT DISTINCT privilege_type privilege FROM aclexplode(acldefault('r',c.relowner))) creator_privileges
    WHERE NOT has_table_privilege(current_user,c.oid,privilege)
     OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner AND a.privilege_type=privilege))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner AND(a.grantor<>c.relowner OR a.is_grantable)) THEN
   RAISE EXCEPTION 'Finite creator Source106 new relation owner ordinary privileges unavailable';END IF;
  INSERT INTO pg_temp.custodial_creator_acl_106_before VALUES('relation',identity,c.oid,c.relowner,(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner),NULL);
 END LOOP;
END $creator_table_before$;
REVOKE ALL ON TABLE public.employee_native_schedule_finalizations FROM PUBLIC,anon,authenticated,service_role,
 static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
CREATE FUNCTION public.custodial_native_schedule_finalization_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE s public.employee_native_schedule_source_reservations%rowtype;
 r public.employee_native_push_delivery_receipts%rowtype;j public.operational_notification_jobs%rowtype;content jsonb;expected jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'original SCHEDULE finalization immutable' USING errcode='23514';END IF;
 SELECT * INTO s FROM public.employee_native_schedule_source_reservations WHERE reservation_id=NEW.source_reservation_id;
 SELECT * INTO r FROM public.employee_native_push_delivery_receipts WHERE job_id=NEW.job_id;
 IF s.reservation_id IS NULL OR r.job_id IS NULL THEN
  RAISE EXCEPTION 'SCHEDULE source/receipt missing' USING errcode='23514';END IF;
 SELECT * INTO j FROM public.operational_notification_jobs WHERE job_id=NEW.job_id;
 content:=public.custodial_native_schedule_content_source_at(s.operation_id,s.employee_id,s.generation_id,r.prepared_at);
 expected:=(content->'candidate')-'schema'-'employee_id';
 IF s.reservation_id IS NULL OR r.job_id IS NULL OR content->>'status' IS DISTINCT FROM 'CONTENT_CURRENT_SOURCE_ONLY'
  OR r.source_id IS DISTINCT FROM s.reservation_id OR r.native_generation_id IS DISTINCT FROM s.generation_id
  OR r.prepared_at<s.reserved_at OR r.prepared_at IS DISTINCT FROM NEW.finalized_at
  OR r.native_valid_until IS DISTINCT FROM NEW.valid_until OR r.native_valid_until IS DISTINCT FROM s.valid_until
  OR r.native_payload_sha256 IS DISTINCT FROM NEW.content_sha256 OR s.source_window_sha256 IS DISTINCT FROM NEW.source_window_sha256
  OR r.native_payload->>'receipt_employee_id' IS DISTINCT FROM s.employee_id::text
  OR r.native_payload->>'receipt_device_id' IS DISTINCT FROM s.source_window#>>'{recipient,device_identifier}'
  OR r.credential_id::text IS DISTINCT FROM s.source_window#>>'{recipient,credential_id}'
  OR r.assignment_epoch::text IS DISTINCT FROM s.source_window#>>'{recipient,assignment_epoch}'
  OR r.native_payload->>'principal_digest' IS DISTINCT FROM s.source_window#>>'{recipient,principal_digest}'
  OR r.token_hash IS DISTINCT FROM s.source_window#>>'{recipient,token_digest}'
  OR j.job_id IS NULL OR j.job_type IS DISTINCT FROM 'employee_native_push' OR j.source_id IS DISTINCT FROM s.reservation_id
  OR j.job_key IS DISTINCT FROM 'employee-schedule-push:'||s.reservation_id::text||':'||r.credential_id::text
  OR r.job_key IS DISTINCT FROM j.job_key OR r.lease_token IS DISTINCT FROM j.lease_token
  OR r.registration_id IS DISTINCT FROM (SELECT registration_id FROM public.employee_native_push_generations WHERE generation_id=s.generation_id)
  OR (r.native_payload-ARRAY['schema','principal_digest','token_digest','receipt_job_id','receipt_credential_id',
   'receipt_employee_id','receipt_device_id','receipt_assignment_epoch','reservation_at','valid_until','content_sha256']) IS DISTINCT FROM expected
  OR public.custodial_native_schedule_receipt_binding(r.native_payload,r.job_id,r.source_id,r.credential_id,r.assignment_epoch,
   r.native_generation_id,r.token_hash,r.prepared_at,r.native_valid_until,r.native_payload_sha256) IS NOT TRUE THEN
  RAISE EXCEPTION 'SCHEDULE finalization not bound to original source and receipt' USING errcode='23514';END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER trg_native_schedule_finalization_guard BEFORE INSERT OR UPDATE OR DELETE ON public.employee_native_schedule_finalizations
 FOR EACH ROW EXECUTE FUNCTION public.custodial_native_schedule_finalization_guard();
ALTER TABLE public.employee_native_schedule_finalizations ENABLE ALWAYS TRIGGER trg_native_schedule_finalization_guard;

CREATE FUNCTION public.custodial_native_schedule_finalize_at(p_job uuid,p_lease uuid,p_source uuid,p_expected jsonb,p_test_at timestamptz)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE d public.devices%rowtype;c public.device_auth_credentials%rowtype;r public.employee_push_registrations%rowtype;
 g public.employee_native_push_generations%rowtype;j public.operational_notification_jobs%rowtype;
 s public.employee_native_schedule_source_reservations%rowtype;prior public.employee_native_schedule_finalizations%rowtype;
 receipt public.employee_native_push_delivery_receipts%rowtype;at_time timestamptz;content jsonb;expected jsonb;data jsonb;digest text;field text;
BEGIN
 PERFORM public.custodial_begin_application_mutation();
 IF p_job IS NULL OR p_lease IS NULL OR p_source IS NULL OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object'
  OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(p_expected) key) IS DISTINCT FROM
   ARRAY['assignment_epoch','credential_id','device_id','employee_id','generation_id','principal_digest','registration_id','token_digest']
  OR EXISTS(SELECT 1 FROM jsonb_each(p_expected) e WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string')
  OR (p_test_at IS NOT NULL AND NOT isfinite(p_test_at)) THEN
  RAISE EXCEPTION 'exact SCHEDULE finalization job/source/recipient required' USING errcode='22023';END IF;
 FOREACH field IN ARRAY ARRAY['credential_id','employee_id','generation_id','registration_id'] LOOP
  IF p_expected->>field !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'invalid SCHEDULE recipient UUID' USING errcode='22023';END IF;
 END LOOP;
 IF p_expected->>'assignment_epoch' !~ '^[1-9][0-9]{0,15}$' OR (p_expected->>'assignment_epoch')::numeric>9007199254740991
  OR p_expected->>'device_id' !~ '^KIOSK_(0[2-9]|10)$' OR p_expected->>'principal_digest' !~ '^[0-9a-f]{64}$'
  OR p_expected->>'token_digest' !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'invalid SCHEDULE recipient binding' USING errcode='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT d0.* INTO d FROM public.devices d0 JOIN public.device_auth_credentials c0 ON c0.device_id=d0.id
  WHERE c0.credential_id=(p_expected->>'credential_id')::uuid FOR UPDATE OF d0;
 SELECT * INTO c FROM public.device_auth_credentials WHERE credential_id=(p_expected->>'credential_id')::uuid FOR UPDATE;
 PERFORM 1 FROM public.employees WHERE id=d.assigned_employee_id FOR SHARE;
 PERFORM 1 FROM public.employee_push_registrations WHERE device_id=d.id ORDER BY registration_id FOR UPDATE;
 SELECT * INTO r FROM public.employee_push_registrations WHERE registration_id=(p_expected->>'registration_id')::uuid;
 SELECT * INTO g FROM public.employee_native_push_generations WHERE generation_id=(p_expected->>'generation_id')::uuid FOR UPDATE;
 SELECT * INTO j FROM public.operational_notification_jobs WHERE job_id=p_job FOR UPDATE;
 SELECT * INTO s FROM public.employee_native_schedule_source_reservations WHERE reservation_id=p_source FOR UPDATE;
 SELECT * INTO prior FROM public.employee_native_schedule_finalizations WHERE source_reservation_id=p_source FOR UPDATE;
 at_time:=coalesce(p_test_at,clock_timestamp());
 -- Original readback works after expiry/rotation without granting a new send.
 IF prior.job_id IS NOT NULL THEN
  SELECT * INTO receipt FROM public.employee_native_push_delivery_receipts WHERE job_id=prior.job_id;
  expected:=jsonb_build_object('assignment_epoch',receipt.assignment_epoch::text,'credential_id',receipt.credential_id::text,
   'device_id',receipt.native_payload->>'receipt_device_id','employee_id',receipt.native_payload->>'receipt_employee_id',
   'generation_id',receipt.native_generation_id::text,'principal_digest',receipt.native_payload->>'principal_digest',
   'registration_id',receipt.registration_id::text,'token_digest',receipt.token_hash);
  IF prior.job_id IS DISTINCT FROM p_job OR receipt.lease_token IS DISTINCT FROM p_lease OR expected IS DISTINCT FROM p_expected THEN
   RETURN jsonb_build_object('schema','custodial.native-schedule-finalization.v1','status','ORIGINAL_FINALIZATION_CONFLICT',
    'finalized',false,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,'payload',null,'wire',null);END IF;
  RETURN jsonb_build_object('schema','custodial.native-schedule-finalization.v1','status','ORIGINAL_FINALIZATION_RETAINED',
   'finalized',true,'replayed',true,'dispatch_authorized',false,'delivery_admitted',false,'payload',receipt.native_payload,
   'wire',public.custodial_native_location_canonical(receipt.native_payload));
 END IF;
 IF s.reservation_id IS NULL THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-finalization.v1','status','SOURCE_OR_JOB_SUPERSEDED',
   'finalized',false,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,'payload',null,'wire',null);END IF;
 content:=public.custodial_native_schedule_content_source_at(s.operation_id,s.employee_id,s.generation_id,at_time);
 expected:=jsonb_build_object('assignment_epoch',d.assignment_epoch::text,'credential_id',c.credential_id::text,
  'device_id',d.device_id,'employee_id',d.assigned_employee_id::text,'generation_id',g.generation_id::text,
  'principal_digest',g.principal_digest,'registration_id',r.registration_id::text,'token_digest',g.token_digest);
 IF NOT isfinite(at_time) OR d.id IS NULL OR c.credential_id IS NULL OR r.registration_id IS NULL OR g.generation_id IS NULL
  OR s.reservation_id IS NULL OR expected IS DISTINCT FROM p_expected
  OR g.registration_id IS DISTINCT FROM r.registration_id OR g.credential_id IS DISTINCT FROM c.credential_id
  OR g.device_id IS DISTINCT FROM d.id OR r.device_id IS DISTINCT FROM d.id OR r.credential_id IS DISTINCT FROM c.credential_id
  OR s.generation_id IS DISTINCT FROM g.generation_id OR s.employee_id IS DISTINCT FROM d.assigned_employee_id
  OR content->>'status' IS DISTINCT FROM 'CONTENT_CURRENT_SOURCE_ONLY'
  OR j.job_id IS NULL OR j.job_type IS DISTINCT FROM 'employee_native_push' OR j.status IS DISTINCT FROM 'leased'
  OR j.lease_token IS DISTINCT FROM p_lease OR j.leased_until IS NULL OR j.leased_until<=at_time
  OR j.source_id IS DISTINCT FROM p_source
  OR j.job_key IS DISTINCT FROM 'employee-schedule-push:'||p_source::text||':'||c.credential_id::text
  OR j.payload_json IS DISTINCT FROM jsonb_build_object('credential_id',c.credential_id::text,'device_id',d.id::text,
   'device_identifier',d.device_id,'employee_id',d.assigned_employee_id::text,'assignment_epoch',d.assignment_epoch::text,
   'data_json',jsonb_build_object('kind','employee_schedule_ownership','source_reservation_id',p_source::text))
  OR EXISTS(SELECT 1 FROM public.employee_native_push_delivery_receipts WHERE job_id=p_job) THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-finalization.v1','status','SOURCE_OR_JOB_SUPERSEDED',
   'finalized',false,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,'payload',null,'wire',null);END IF;
 -- Current source enforces all credential, generation, active staff, token,
 -- registration and schedule predicates under the locks held above.
 data:=((content->'candidate')-'employee_id')||jsonb_build_object('schema','custodial.native-schedule-payload.v1',
  'principal_digest',g.principal_digest,'token_digest',g.token_digest,'receipt_job_id',p_job::text,
  'receipt_credential_id',c.credential_id::text,'receipt_employee_id',s.employee_id::text,'receipt_device_id',d.device_id,
  'receipt_assignment_epoch',d.assignment_epoch::text,'reservation_at',public.custodial_native_location_utc(at_time),
  'valid_until',public.custodial_native_location_utc(s.valid_until));
 digest:=public.static_weekly_digest_text(public.custodial_native_location_canonical(data));
 data:=data||jsonb_build_object('content_sha256',digest);
 IF public.custodial_native_schedule_receipt_binding(data,p_job,p_source,c.credential_id,d.assignment_epoch,
  g.generation_id,g.token_digest,at_time,s.valid_until,digest) IS NOT TRUE THEN
  RAISE EXCEPTION 'SCHEDULE closed wire invalid; no truncation' USING errcode='22023';END IF;
 INSERT INTO public.employee_native_push_delivery_receipts(job_id,job_key,source_id,lease_token,credential_id,assignment_epoch,
  registration_id,token_hash,prepared_at,native_generation_id,native_payload,native_payload_sha256,native_valid_until)
 VALUES(p_job,j.job_key,p_source,p_lease,c.credential_id,d.assignment_epoch,r.registration_id,g.token_digest,at_time,g.generation_id,data,digest,s.valid_until);
 INSERT INTO public.employee_native_schedule_finalizations(source_reservation_id,job_id,source_window_sha256,content_sha256,finalized_at,valid_until)
 VALUES(p_source,p_job,s.source_window_sha256,digest,at_time,s.valid_until);
 RETURN jsonb_build_object('schema','custodial.native-schedule-finalization.v1','status','FINALIZED_NATIVE_UNQUALIFIED',
  'finalized',true,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,'payload',data,
  'wire',public.custodial_native_location_canonical(data));
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb)
 RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.custodial_native_schedule_finalize_at($1,$2,$3,$4,null);
$fn$;
CREATE FUNCTION public.custodial_native_schedule_finalization_status(p_source uuid,p_employee uuid,p_generation uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE r public.employee_native_push_delivery_receipts%rowtype;BEGIN
 IF p_source IS NULL OR p_employee IS NULL OR p_generation IS NULL THEN
  RAISE EXCEPTION 'exact SCHEDULE original status actor required' USING errcode='22023';END IF;
 SELECT r0.* INTO r FROM public.employee_native_schedule_finalizations f
  JOIN public.employee_native_schedule_source_reservations s ON s.reservation_id=f.source_reservation_id
  JOIN public.employee_native_push_delivery_receipts r0 ON r0.job_id=f.job_id
  WHERE f.source_reservation_id=p_source AND s.employee_id=p_employee AND s.generation_id=p_generation;
 RETURN jsonb_build_object('schema','custodial.native-schedule-finalization-status.v1','finalized',r.job_id IS NOT NULL,
  'dispatch_authorized',false,'delivery_admitted',false,'payload',r.native_payload);
END $fn$;
-- The generic LOCATION outcome owner must not accept a fabricated provider
-- result for a final wire that has never acquired a dispatch attempt.
DO $outcome$ DECLARE fn regprocedure:='public.custodial_native_location_outcome_at(jsonb,jsonb,timestamptz)'::regprocedure;
 definition text;acl aclitem[];needle text:=$old$ select * into g from public.employee_native_push_generations where generation_id=receipt.native_generation_id;$old$;BEGIN
 definition:=pg_get_functiondef(fn);SELECT proacl INTO acl FROM pg_proc WHERE oid=fn;
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
  AND to_regprocedure(object_identity)=fn AND definition_sql=definition AND definition_sha256=public.static_weekly_digest_text(definition))
  OR (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'SCHEDULE original outcome/recovery seam changed';END IF;
 EXECUTE replace(definition,needle,$new$ IF receipt.native_payload->>'schema'='custodial.native-schedule-payload.v1' THEN
  RAISE EXCEPTION 'SCHEDULE dispatch/outcome not admitted' USING errcode='42501';END IF;
$new$||needle);
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN
  RAISE EXCEPTION 'SCHEDULE outcome permissions changed';END IF;
END $outcome$;

DO $creator_function_before$ DECLARE spec record;p record;BEGIN
 FOR spec IN SELECT * FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_receipt_binding(jsonb,uuid,uuid,uuid,bigint,uuid,text,timestamptz,timestamptz,text)","name":"custodial_native_schedule_receipt_binding","body_md5":"289b4b38d8655070dce45edbec1e8d40","argument_names":["p","p_job","p_source","p_credential","p_epoch","p_generation","p_token","p_at","p_until","p_sha"],"returns":"boolean","language":"plpgsql","security_definer":false,"volatility":"i","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_finalization_guard()","name":"custodial_native_schedule_finalization_guard","body_md5":"9af6c6980e3e95cb77ea78d827ab9aae","argument_names":null,"returns":"trigger","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_finalize_at(uuid,uuid,uuid,jsonb,timestamptz)","name":"custodial_native_schedule_finalize_at","body_md5":"add3fadc1b5b4b6adbd5e81b05679a68","argument_names":["p_job","p_lease","p_source","p_expected","p_test_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb)","name":"custodial_native_schedule_finalize","body_md5":"c680eabababb89a2f7857bd544dc23a7","argument_names":null,"returns":"jsonb","language":"sql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]},{"signature":"public.custodial_native_schedule_finalization_status(uuid,uuid,uuid)","name":"custodial_native_schedule_finalization_status","body_md5":"33c3f5882cfa61aec21172e8f649b731","argument_names":["p_source","p_employee","p_generation"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
  AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) LOOP
  SELECT f.*,l.lanname INTO STRICT p FROM pg_proc f JOIN pg_language l ON l.oid=f.prolang WHERE f.oid=to_regprocedure(spec.signature) AND f.pronamespace='public'::regnamespace;
  IF p.proowner<>'postgres'::regrole OR p.proname<>spec.name OR md5(p.prosrc)<>spec.body_md5
   OR p.proargnames IS DISTINCT FROM spec.argument_names OR pg_get_function_result(p.oid)<>spec.returns OR p.lanname<>spec.language
   OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility OR p.proconfig IS DISTINCT FROM spec.config
   OR p.prokind<>'f' OR p.proretset OR p.provariadic<>0 OR p.pronargdefaults<>0 OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
   OR NOT has_function_privilege(current_user,p.oid,'EXECUTE')
   OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND a.privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND(a.grantor<>p.proowner OR a.is_grantable)) THEN
   RAISE EXCEPTION 'Finite creator Source106 new routine owner/body/ordinary EXECUTE unavailable';END IF;
  INSERT INTO pg_temp.custodial_creator_acl_106_before VALUES('function',spec.signature,p.oid,p.proowner,(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner),md5(pg_get_functiondef(p.oid)));
 END LOOP;
END $creator_function_before$;
DO $acl$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN('custodial_native_schedule_receipt_binding','custodial_native_schedule_finalization_guard',
   'custodial_native_schedule_finalize_at','custodial_native_schedule_finalize','custodial_native_schedule_finalization_status') LOOP
  EXECUTE format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823',f);
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.employee_native_schedule_finalizations'::regclass
  AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled='O') THEN
  RAISE EXCEPTION 'SCHEDULE finalization restore mutation fence missing';END IF;
END $acl$;
GRANT EXECUTE ON FUNCTION public.custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb),
 public.custodial_native_schedule_finalization_status(uuid,uuid,uuid) TO service_role;
DO $creator_before_capture$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_receipt_binding','custodial_native_schedule_finalization_guard','custodial_native_schedule_finalize_at','custodial_native_schedule_finalize','custodial_native_schedule_finalization_status']::text[]))<>5
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_106_before)<>6 THEN
  RAISE EXCEPTION 'Finite creator Source106 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_106_before LOOP
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
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[{"relation":"public.employee_native_schedule_finalizations","name":"trg_native_schedule_finalization_guard","function":"public.custodial_native_schedule_finalization_guard()","type":31,"enabled":"A"}]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source106 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source106 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_receipt_binding(jsonb,uuid,uuid,uuid,bigint,uuid,text,timestamptz,timestamptz,text)","name":"custodial_native_schedule_receipt_binding","body_md5":"289b4b38d8655070dce45edbec1e8d40","argument_names":["p","p_job","p_source","p_credential","p_epoch","p_generation","p_token","p_at","p_until","p_sha"],"returns":"boolean","language":"plpgsql","security_definer":false,"volatility":"i","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_finalization_guard()","name":"custodial_native_schedule_finalization_guard","body_md5":"9af6c6980e3e95cb77ea78d827ab9aae","argument_names":null,"returns":"trigger","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_finalize_at(uuid,uuid,uuid,jsonb,timestamptz)","name":"custodial_native_schedule_finalize_at","body_md5":"add3fadc1b5b4b6adbd5e81b05679a68","argument_names":["p_job","p_lease","p_source","p_expected","p_test_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb)","name":"custodial_native_schedule_finalize","body_md5":"c680eabababb89a2f7857bd544dc23a7","argument_names":null,"returns":"jsonb","language":"sql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]},{"signature":"public.custodial_native_schedule_finalization_status(uuid,uuid,uuid)","name":"custodial_native_schedule_finalization_status","body_md5":"33c3f5882cfa61aec21172e8f649b731","argument_names":["p_source","p_employee","p_generation"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source106 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_before_capture$;


-- Exact recovery closure: new internal relation, fields, constraints, state,
-- immutable/fence triggers, functions and explicit grants, no runtime policy.
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE schedule_finalize_inventory_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $canary$ DECLARE definition text;patched text;BEGIN
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
  AND object_identity='custodial_release_canary_authority_surface()' AND definition_sql=definition
  AND definition_sha256=public.static_weekly_digest_text(definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'SCHEDULE finalization captured canary/ALWAYS boundary changed';END IF;
 patched:=replace(definition,E'  values\n',E'  values\n'
  ||E'    (''relation'',''public.employee_native_schedule_finalizations'',''immutable09:45 final wire; no send''),\n'
  ||E'    (''relation_state'',''public.employee_native_schedule_finalizations'',''RPC-only FORCE-RLS final original''),\n'
  ||E'    (''grant'',''public.employee_native_schedule_finalizations'',''no direct runtime finalization access''),\n'
  ||E'    (''function'',''custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb)'',''service-only finalization; no send''),\n'
  ||E'    (''function'',''custodial_native_schedule_finalization_status(uuid,uuid,uuid)'',''exact original wire readback; no send''),\n');
 IF patched=definition THEN RAISE EXCEPTION 'SCHEDULE finalization canary seam changed';END IF;EXECUTE patched;
END $canary$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 FOR obj IN WITH funcs AS(SELECT p.oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN(
  'custodial_native_schedule_receipt_binding','custodial_native_schedule_finalization_guard','custodial_native_schedule_finalize_at',
  'custodial_native_schedule_finalize','custodial_native_schedule_finalization_status','custodial_release_canary_authority_surface',
  'custodial_native_location_outcome_at')),
 objects AS(
  SELECT 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
  UNION ALL SELECT 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) FROM funcs
  UNION ALL SELECT x.bucket,x.kind,x.identity,x.definition FROM unnest(array['public.employee_native_schedule_finalizations']) rel CROSS JOIN LATERAL(
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
 SELECT * FROM objects UNION ALL SELECT 500000,'constraint',
  'public.employee_native_push_delivery_receipts:native_location_payload_binding',
  public.custodial_release_authority_current_constraint_definition('public.employee_native_push_delivery_receipts:native_location_payload_binding')
 ORDER BY bucket,identity LOOP
  IF obj.definition IS NULL THEN RAISE EXCEPTION 'missing SCHEDULE finalization recovery object %',obj.identity;END IF;
  UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   WHERE object_kind=obj.kind AND(object_identity=obj.identity OR(obj.kind IN('function','grant') AND object_identity LIKE '%(%'
    AND obj.identity LIKE '%(%' AND to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  GET DIAGNOSTICS changed=row_count;IF changed>1 THEN RAISE EXCEPTION 'duplicate SCHEDULE finalization recovery %',obj.identity;END IF;
  IF changed=0 THEN SELECT n INTO next_order FROM generate_series(obj.bucket+1,CASE WHEN obj.bucket=1000 THEN 99998 ELSE obj.bucket+99998 END) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
   IF next_order IS NULL THEN RAISE EXCEPTION 'SCHEDULE finalization recovery order exhausted';END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));END IF;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF EXISTS(SELECT i.* FROM schedule_finalize_inventory_before i WHERE NOT(
   (object_identity='custodial_release_canary_authority_surface()' AND object_kind IN('function','grant'))
   OR (object_identity LIKE 'custodial_native_location_outcome_at(%' AND object_kind IN('function','grant'))
   OR (object_identity='public.employee_native_push_delivery_receipts:native_location_payload_binding' AND object_kind='constraint'))
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory) THEN
  RAISE EXCEPTION 'unrelated SCHEDULE finalization recovery row changed';END IF;
END $scope$;

DO $creator_after$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_receipt_binding','custodial_native_schedule_finalization_guard','custodial_native_schedule_finalize_at','custodial_native_schedule_finalize','custodial_native_schedule_finalization_status']::text[]))<>5
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_106_before)<>6 THEN
  RAISE EXCEPTION 'Finite creator Source106 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_106_before LOOP
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
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[{"relation":"public.employee_native_schedule_finalizations","name":"trg_native_schedule_finalization_guard","function":"public.custodial_native_schedule_finalization_guard()","type":31,"enabled":"A"}]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source106 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source106 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_receipt_binding(jsonb,uuid,uuid,uuid,bigint,uuid,text,timestamptz,timestamptz,text)","name":"custodial_native_schedule_receipt_binding","body_md5":"289b4b38d8655070dce45edbec1e8d40","argument_names":["p","p_job","p_source","p_credential","p_epoch","p_generation","p_token","p_at","p_until","p_sha"],"returns":"boolean","language":"plpgsql","security_definer":false,"volatility":"i","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_finalization_guard()","name":"custodial_native_schedule_finalization_guard","body_md5":"9af6c6980e3e95cb77ea78d827ab9aae","argument_names":null,"returns":"trigger","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_finalize_at(uuid,uuid,uuid,jsonb,timestamptz)","name":"custodial_native_schedule_finalize_at","body_md5":"add3fadc1b5b4b6adbd5e81b05679a68","argument_names":["p_job","p_lease","p_source","p_expected","p_test_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb)","name":"custodial_native_schedule_finalize","body_md5":"c680eabababb89a2f7857bd544dc23a7","argument_names":null,"returns":"jsonb","language":"sql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]},{"signature":"public.custodial_native_schedule_finalization_status(uuid,uuid,uuid)","name":"custodial_native_schedule_finalization_status","body_md5":"33c3f5882cfa61aec21172e8f649b731","argument_names":["p_source","p_employee","p_generation"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source106 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_after$;
COMMIT;
