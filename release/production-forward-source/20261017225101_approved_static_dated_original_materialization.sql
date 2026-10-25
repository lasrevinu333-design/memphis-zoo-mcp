-- Finite existing-postgres-owner grant metadata compatibility.
-- Canonical SQL remains immutable; no live grant or owner change.
-- Actual six87 metadata SHA256 e325b15106c3c3fddad162a46d35236886672117f3a13e77614cb1bbe1d97005.
-- Install only the eight PRIVATE approved dated routines; no public capability.
-- Source proposal ef4931306432a6f5079c0ccbbd2f4273ea379b03ec704bcbfc42f9655910faa2
-- is embedded below, with ONLY the two authorized exact sink seam whitespace
-- corrections. Embedded bytes SHA256:
-- bcb3797ef0a029059a8000bd53294ca3573ad68c4110b64ae6fe551ba066bece.
-- The lunch CASE grouping correction is already included in that proposal.
-- No receipt, operational history, approved template or original DATA is seeded.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
-- Same normal application fence -> fixed weekly authority queue lock order.
SELECT public.custodial_begin_application_mutation();
SELECT pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
do $production_forward_original_owner$
begin
 if current_user<>'postgres' OR session_user<>current_user
  OR current_setting('custodial.deployment_project_ref',true) IS DISTINCT FROM 'rqquvtjdmugpigbndmne'
  OR current_setting('session_replication_role')<>'origin'
  OR current_setting('transaction_read_only')<>'off'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.custodial_release_authority_restore_inventory')
   AND relowner='postgres'::regrole AND relkind='r' AND relpersistence='p')
 then raise exception using errcode='42501',message='Exact production postgres original owner/project/normal mutation context required';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.custodial_release_authority_current_grant_definition(text)')
  and p.proowner='postgres'::regrole and not p.prosecdef and p.provolatile='s'
  and p.proconfig=array['search_path=pg_catalog, public']::text[]
  and md5(p.prosrc)='a0326680c69ee3c233bb495a6ff7c9f6' and md5(pg_get_functiondef(p.oid))='a1071b529d6ae4bd747b7a4195b90a6d')
 then raise exception 'Exact original postgres grant serializer required';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.custodial_release_canary_authority_surface()')
  and p.proowner='postgres'::regrole and p.prokind='f' and not p.prosecdef and p.provolatile='i'
  and p.proconfig=array['search_path=pg_catalog, public']::text[]
  and (select jsonb_agg(jsonb_build_object('grantee',coalesce(r.rolname,'PUBLIC'),'grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable)
   order by coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles r on r.oid=a.grantee) = '[{"grantee":"PUBLIC","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"service_role","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb)
 then raise exception 'Exact existing postgres canary owner and named ACL required';end if;
end $production_forward_original_owner$;

-- BEGIN FINITE EXISTING POSTGRES SOURCE152 HELPER GRANT PROFILE
DO $dated_helper_owner_profile$
DECLARE spec record;p record;
BEGIN
 IF current_user<>'postgres' OR session_user<>current_user
  OR current_setting('custodial.deployment_project_ref',true) IS DISTINCT FROM 'rqquvtjdmugpigbndmne'
  OR current_setting('session_replication_role')<>'origin' OR current_setting('transaction_read_only')<>'off'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.custodial_release_authority_restore_inventory'::regclass
   AND relowner='postgres'::regrole AND relkind='r' AND relpersistence='p')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A' AND tgtype=27 AND NOT tgisinternal
   AND tgfoid='public.custodial_reject_release_authority_inventory_mutation()'::regprocedure)
 THEN RAISE EXCEPTION 'Approved dated exact normal postgres helper owner context changed';END IF;
 FOR spec IN SELECT * FROM jsonb_to_recordset($dated_helper_specs$[{"identity":"static_weekly_compiler_exception_set(uuid,date)","public_identity":"public.static_weekly_compiler_exception_set(uuid,date)","body_sha256":"53bd75e28b947dc643fc711b3684be7e1cdc651fccab2a6cb13aedc5b8ef0529","definition_sha256":"85db993fb76b2bd098a0581c44f474c6990576252d1e2f5928555899b8cab212","body_md5":"9a0da514351a45ca4d6c833e5b39bd04","definition_md5":"8da5d21a3ad12577457390367f02fa7e","restore_order":100255,"grant_sql":"select public.custodial_release_authority_reset_grants('static_weekly_compiler_exception_set(uuid,date)');","grant_sha256":"33b08761a92ee41164aa15127e76e17390aecd088655fba28facde99c9b46236"},{"identity":"static_weekly_accepted_exception_set(uuid,date)","public_identity":"public.static_weekly_accepted_exception_set(uuid,date)","body_sha256":"9d05dcedabab2212f6abc73ccecf1a6ebd2f6f71fb56e482f2a03511e3c74290","definition_sha256":"8ce1e49beaf770567bd3468be0b28aea370e5930ce2138e1597eb90668e348d7","body_md5":"e66d9f8b3e1a08aa681f2de8df34b562","definition_md5":"8ccc93ee140e4911f920223460fe97d5","restore_order":100253,"grant_sql":"select public.custodial_release_authority_reset_grants('static_weekly_accepted_exception_set(uuid,date)');","grant_sha256":"7726510b8129c4e59778db1dc250291875ca4ff1e6c3d69551e5c4ed633811b2"}]$dated_helper_specs$::jsonb)
  AS x(identity text,public_identity text,body_sha256 text,definition_sha256 text,body_md5 text,definition_md5 text,restore_order integer,grant_sql text,grant_sha256 text) LOOP
  SELECT f.*,l.lanname INTO STRICT p FROM pg_proc f JOIN pg_language l ON l.oid=f.prolang
   WHERE f.oid=to_regprocedure(spec.public_identity) AND f.pronamespace='public'::regnamespace;
  IF to_regprocedure(spec.identity) IS DISTINCT FROM p.oid OR p.proowner<>'postgres'::regrole OR p.prokind<>'f'
   OR p.lanname<>'sql' OR NOT p.prosecdef OR p.provolatile<>'s'
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
   OR p.proargnames IS DISTINCT FROM ARRAY['p_publication_id','p_week_start']::text[]
   OR pg_get_function_identity_arguments(p.oid)<>'p_publication_id uuid, p_week_start date'
   OR pg_get_function_result(p.oid)<>'jsonb' OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
   OR p.provariadic<>0 OR p.pronargdefaults<>0
   OR md5(p.prosrc) IS DISTINCT FROM spec.body_md5 OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM spec.definition_md5
   OR public.static_weekly_digest_text(p.prosrc) IS DISTINCT FROM spec.body_sha256
   OR public.static_weekly_digest_text(pg_get_functiondef(p.oid)) IS DISTINCT FROM spec.definition_sha256
   OR p.proacl IS NULL OR (SELECT count(*) FROM aclexplode(p.proacl))<>1
   OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a
    WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR EXISTS(SELECT 1 FROM(VALUES ('postgres',true),('anon',false),('authenticated',false),('service_role',false),('custodial_application_reader',false),('static_weekly_control_plane',false),('static_weekly_release_operator',false),('static_weekly_runtime_20260823',false)) expected(role_name,may_execute)
    LEFT JOIN pg_roles r ON r.rolname=expected.role_name
    WHERE r.oid IS NULL OR has_function_privilege(r.oid,p.oid,'EXECUTE') IS DISTINCT FROM expected.may_execute)
   OR public.custodial_release_authority_current_grant_definition(spec.identity) IS DISTINCT FROM spec.grant_sql
   OR public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(spec.identity)) IS DISTINCT FROM spec.grant_sha256
   OR (SELECT count(*) FROM public.custodial_release_authority_restore_inventory i
    WHERE CASE WHEN i.object_kind IN('function','grant') AND position('(' in i.object_identity)>0 THEN to_regprocedure(i.object_identity) END=p.oid)<>1
   OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
    WHERE i.object_kind='function' AND i.object_identity=spec.identity AND i.restore_order=spec.restore_order
     AND i.definition_sql=pg_get_functiondef(p.oid) AND i.definition_sha256=spec.definition_sha256)
  THEN RAISE EXCEPTION 'Approved dated exact PUBLIC helper body owner ACL effective rights or recovery tuple changed';END IF;
 END LOOP;
END $dated_helper_owner_profile$;
-- END FINITE EXISTING POSTGRES SOURCE152 HELPER GRANT PROFILE

CREATE TEMP TABLE approved_dated_install_targets(
 identity text PRIMARY KEY,body_sha256 text NOT NULL,return_type text NOT NULL,
 volatility text NOT NULL,argument_names text[] NOT NULL
) ON COMMIT DROP;
INSERT INTO approved_dated_install_targets VALUES
 ('public.static_weekly_approved_dated_assert_window(jsonb,text)','1277d85ad1e5d9809db75f3bad7ff1bd7fe587c1830cae113921f79367a523fc','void','i',ARRAY['p_value','p_label' ]::text[]),
 ('public.static_weekly_approved_dated_effective_availability(jsonb,text,date,jsonb)','16987eaeec865b5e6d8ee681961c0b68900a97f13252913e56068f871096a47e','jsonb','i',ARRAY['p_base','p_slot','p_date','p_exceptions' ]::text[]),
 ('public.static_weekly_approved_dated_effective_work(uuid,date,jsonb)','334e48f0f65374b90809c372e841db57986446b73a59f7d00f9f665918971905','jsonb','v',ARRAY['p_publication','p_week','p_source' ]::text[]),
 ('public.static_weekly_approved_dated_assert_closing(jsonb,jsonb,jsonb,jsonb,jsonb,date)','39b572db355359e93636b76e35e6e5d8fd7596fad522c5d56fc100ead5e581b1','jsonb','v',ARRAY['p_closing','p_baseline','p_approved','p_config','p_mapping','p_date' ]::text[]),
 ('public.static_weekly_assert_approved_dated_projection(jsonb,uuid,date,jsonb)','b5fa8207cc41f61af72637a58977064da43b74e18a6cb5d4dfdf0143af44d863','jsonb','v',ARRAY['p_envelope','p_publication_id','p_week','p_exceptions' ]::text[]),
 ('public.static_weekly_assert_approved_dated_lunch(uuid,jsonb)','9534c73ba4914f38e0e02dfbe002ef31d39679409a7143e314899aa02a2ffea1','void','v',ARRAY['p_projection','p_document' ]::text[]),
 ('public.static_weekly_approved_dated_materialize_projection(uuid,uuid,date,text,bigint,bigint,text,jsonb)','8f80d652fcd5bcea3393ff44a6e05cb8d2afd8f07646a4d0e569d36b1757e58b','jsonb','v',ARRAY['p_manager','p_publication','p_service_date','p_template_id','p_expected_revision','p_generation','p_preview_digest','p_feasibility' ]::text[]),
 ('public.static_weekly_approved_dated_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','27225837e92518276dcb4600ced6a6873931fc400660ca66a389abfc226bc004','jsonb','v',ARRAY['p_publication_id','p_service_date','p_exception_set_digest','p_compiler_version','p_objective','p_metrics','p_replay_digest','p_assignments','p_expected_revision','p_actor_manager_id','p_actor_manager_name','p_idempotency_key' ]::text[]);

-- Independently bound canonical Source, not new expected definitions captured
-- from the target. The basis hash is the exact 285 substitution over the
-- original f3ca2f96 body; every other predecessor is unchanged canonical Source.
CREATE TEMP TABLE approved_dated_install_prerequisites(
 identity text PRIMARY KEY,body_sha256 text NOT NULL,definition_sha256 text NOT NULL
) ON COMMIT DROP;
INSERT INTO approved_dated_install_prerequisites VALUES
 ('static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)','37a13984afc1f4bb6ad00d1d9dcd5daa1909ab2c662a3a3dc288a45e2f7c8ae1','b37945e14e5f804f4bbde542115bd017f8c7e64b909933658d8a23ec6979a9e9'),
 ('public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','c38d665aff22a47b0eee8158bc234973eba3bc098a188477c6467548a100c796','9fe00673753e54ba9690d523e8229eb538402b640fd58df9e4a1e89e58443744'),
 ('static_weekly_compiler_exception_set(uuid,date)','53bd75e28b947dc643fc711b3684be7e1cdc651fccab2a6cb13aedc5b8ef0529','85db993fb76b2bd098a0581c44f474c6990576252d1e2f5928555899b8cab212'),
 ('static_weekly_v8_assert_lunch_document(uuid,jsonb)','4394b8c94dbfe298f673e0c593ebd0191d79ff01617b16e03d5fc0e4e361e1bf','ccbd7327fbf7efef472379adddbd66d9270971a00af9309ede34d0258352226c'),
 ('public.static_weekly_v9_assert_shift_end_derivation(jsonb)','4103a51da57475879011be2e7395b60fc805ba2a93f5576756e23915fc224b0d','1bbd6764f54ffedbaf43a91ff9a40109f6e91ee98be33a18dc2558d62dfef758'),
 ('public.static_weekly_v15_read_recurring_generation()','77ec0481e225b816f4bac470d4322f88a3e24a39476d9a41341f8ce696af0786','4dd3deadb56d6ca78713b2b1a512c07dbde0500fcbc03bb3a8f4af07d9a1f39d'),
 ('public.static_weekly_read_approved_template_basis(uuid, uuid, date, text, text, bigint)','4ab78a7a026e24b9bde6a3d107693c311d75176ebce8acfad6e775f67ec569ac','6a49be1e7eff52461dceb8b466e515a58123eee94af65d84b09dc04c64e5bae0'),
 ('public.static_weekly_v3_read_publication_source(uuid,date)','1396c1d79a712e91255503a570b6eb3d167ddf66ba6f8f2752c33bb5c2d5e617','0dc40bf2dbc508c032d92a8c4b084e28f1aa30cdbcde0e27af2bf7b8659a1e55'),
 ('static_weekly_accepted_exception_set(uuid,date)','9d05dcedabab2212f6abc73ccecf1a6ebd2f6f71fb56e482f2a03511e3c74290','8ce1e49beaf770567bd3468be0b28aea370e5930ce2138e1597eb90668e348d7'),
 ('public.static_weekly_assert_projection_envelope_attested(jsonb,uuid,date,jsonb)','47ff43db1f280d3c797b8c12d9a1a9f735c11c8354df431a061d9e636b040720','9240febc892ece185741d7a441f372fc20801077ea45f3652b1cb13d26481855');

CREATE TEMP TABLE approved_dated_inventory_before ON COMMIT DROP AS
 TABLE public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE approved_dated_surface_before ON COMMIT DROP AS
 SELECT p.*,pg_get_functiondef(p.oid) AS definition_sql FROM pg_proc p
 WHERE p.oid='public.custodial_release_canary_authority_surface()'::regprocedure;
CREATE TEMP TABLE approved_dated_functions_before ON COMMIT DROP AS
 SELECT p.oid,p.proowner,p.proacl,pg_get_functiondef(p.oid) AS definition_sql
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN('public','custodial_dr') AND p.prokind='f';
CREATE TEMP TABLE approved_dated_inventory_trigger_before ON COMMIT DROP AS
 SELECT t.oid,t.tgfoid,t.tgtype,t.tgenabled,t.tgattr,t.tgnargs,t.tgargs,t.tgqual::text AS tgqual,
  pg_get_triggerdef(t.oid,true) AS definition_sql
 FROM pg_trigger t
 WHERE t.tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND t.tgname='trg_custodial_release_authority_restore_inventory_immutable' AND NOT t.tgisinternal;

DO $dated_install_predecessor$
DECLARE actor oid:=(SELECT oid FROM pg_roles WHERE rolname=current_user);surface text;dependency record;
BEGIN
 SELECT definition_sql INTO STRICT surface FROM approved_dated_surface_before;
 IF current_user<>session_user
  OR (SELECT relowner FROM pg_class WHERE oid='public.custodial_release_authority_restore_inventory'::regclass)<>actor
  OR (SELECT proowner FROM approved_dated_surface_before)<>actor
  OR (SELECT count(*) FROM approved_dated_install_targets)<>8
  OR EXISTS(SELECT 1 FROM approved_dated_install_targets WHERE to_regprocedure(identity) IS NOT NULL)
  OR EXISTS(SELECT 1 FROM approved_dated_inventory_before
   WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR (length(surface)-length(replace(surface,'  values','')))/length('  values')<>1
  OR (SELECT count(*) FROM approved_dated_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=surface AND definition_sha256=public.static_weekly_digest_text(surface))<>1
  OR (SELECT count(*) FROM approved_dated_inventory_before WHERE object_kind='grant' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)<>1
  -- Original inventory label is unqualified; its sealed reset literal is not.
  -- Pin that one representation, never normalize or rewrite the original row.
  OR NOT EXISTS(SELECT 1 FROM approved_dated_inventory_before WHERE object_kind='grant'
   AND object_identity='custodial_release_canary_authority_surface()' AND restore_order=1000073
   AND definition_sha256='75b379980842ea961cf0ad8c5b6176c9ff736caecb5d30a566e65afc53d02594'
   AND definition_sql=public.custodial_release_authority_current_grant_definition('public.custodial_release_canary_authority_surface()'))
  OR (SELECT count(*) FROM approved_dated_inventory_trigger_before)<>1
  OR NOT EXISTS(SELECT 1 FROM approved_dated_inventory_trigger_before
   WHERE tgtype=27 AND tgenabled='A' AND tgnargs=0 AND octet_length(tgargs)=0 AND tgqual IS NULL
    AND tgattr::text='' AND tgfoid='public.custodial_reject_release_authority_inventory_mutation()'::regprocedure)
 THEN RAISE EXCEPTION 'Approved dated exact Source owner canary inventory or ALWAYS predecessor differs';END IF;
 FOR dependency IN SELECT * FROM approved_dated_install_prerequisites LOOP
  IF to_regprocedure(dependency.identity) IS NULL
   OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(dependency.identity) AND p.proowner=actor
    AND public.static_weekly_digest_text(p.prosrc)=dependency.body_sha256
    AND public.static_weekly_digest_text(pg_get_functiondef(p.oid))=dependency.definition_sha256)
   OR (SELECT count(*) FROM approved_dated_inventory_before i WHERE i.object_kind='function' AND i.object_identity LIKE '%(%'
    AND to_regprocedure(i.object_identity)=to_regprocedure(dependency.identity)
    AND i.definition_sql=pg_get_functiondef(to_regprocedure(dependency.identity))
    AND i.definition_sha256=dependency.definition_sha256)<>1
   -- These two original helper registrations contain FUNCTION rows only.
   -- Require their exact GRANT-row absence AND fixed live postgres-only ACL;
   -- never treat missing recovery metadata as an optional dependency.
   OR (CASE WHEN dependency.identity IN('static_weekly_compiler_exception_set(uuid,date)',
     'static_weekly_accepted_exception_set(uuid,date)') THEN
    EXISTS(SELECT 1 FROM approved_dated_inventory_before i WHERE i.object_kind='grant' AND i.object_identity LIKE '%(%'
     AND to_regprocedure(i.object_identity)=to_regprocedure(dependency.identity))
    OR public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(dependency.identity))
     IS DISTINCT FROM (CASE dependency.identity
      WHEN 'static_weekly_compiler_exception_set(uuid,date)' THEN '33b08761a92ee41164aa15127e76e17390aecd088655fba28facde99c9b46236'
      WHEN 'static_weekly_accepted_exception_set(uuid,date)' THEN '7726510b8129c4e59778db1dc250291875ca4ff1e6c3d69551e5c4ed633811b2'
     END)
    OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE p.oid=to_regprocedure(dependency.identity) AND a.grantee<>p.proowner AND a.grantor<>p.proowner)
   ELSE (SELECT count(*) FROM approved_dated_inventory_before i WHERE i.object_kind='grant' AND i.object_identity LIKE '%(%'
    AND to_regprocedure(i.object_identity)=to_regprocedure(dependency.identity)
    AND i.definition_sql=public.custodial_release_authority_current_grant_definition(i.object_identity))<>1 END)
  THEN RAISE EXCEPTION 'Approved dated fixed registered Source dependency differs';END IF;
 END LOOP;
 -- The original confirmation relation stays private and append-only. Its
 -- binding routine/dispatcher remain owned by the preceding migration.
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.static_weekly_approved_template_confirmations'::regclass
   AND relowner=actor AND relrowsecurity AND relforcerowsecurity)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.static_weekly_approved_template_confirmations'::regclass
   AND tgname='approved_confirmation_immutable' AND tgtype=27 AND tgenabled='A' AND NOT tgisinternal
   AND tgfoid='public.static_weekly_reject_update_delete()'::regprocedure AND tgnargs=0 AND tgqual IS NULL)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.static_weekly_approved_template_confirmations'::regclass
   AND tgname='approved_confirmation_no_truncate' AND tgtype=34 AND tgenabled='A' AND NOT tgisinternal
   AND tgfoid='public.static_weekly_reject_update_delete()'::regprocedure AND tgnargs=0 AND tgqual IS NULL)
 THEN RAISE EXCEPTION 'Approved dated original confirmation private Source prerequisites differ';END IF;
END $dated_install_predecessor$;

-- BEGIN EXACT APPROVED DATED SOURCE (only authorized sink-literal whitespace)
-- Cumulative replacement of the dependency-held v1 proposal; not a migration.
-- Original publication/baseline/history and all ordinary validators stay intact.
-- Independent dated validation precedes the private copied relational sink.
-- Accepted work commands are reconstructed from the immutable command ledger,
-- never from Events preview/held facts. Availability-only closing has an
-- independent selected proof below, including accepted partial intervals;
-- work-changing closing and CoverAll remain
-- unsupported profiles. A changed physical domain still needs an approved
-- compatible template at the existing producer; this SQL cannot invent one.
-- Main owns dispatcher, confirmation ledger, registration, transaction and ACL admission.

CREATE FUNCTION public.static_weekly_approved_dated_assert_window(p_value jsonb,p_label text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $window$
BEGIN
 PERFORM public.static_weekly_v3_assert_window(p_value-'startMinute'-'endMinute',p_label);
 IF (p_value ? 'startMinute') IS DISTINCT FROM (p_value ? 'endMinute')
  OR (p_value ? 'startMinute' AND (p_value->'startMinute' IS DISTINCT FROM to_jsonb(extract(epoch FROM (p_value->>'start')::time)::integer/60)
   OR p_value->'endMinute' IS DISTINCT FROM to_jsonb(extract(epoch FROM (p_value->>'end')::time)::integer/60)))
 THEN RAISE EXCEPTION 'Dated derived minute endpoints differ from original civil time';END IF;
END $window$;

CREATE FUNCTION public.static_weekly_approved_dated_effective_availability(
 p_base jsonb,p_slot text,p_date date,p_exceptions jsonb
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $availability$
DECLARE result jsonb:=p_base;e jsonb;w jsonb;
BEGIN
 FOR e IN SELECT value FROM jsonb_array_elements(p_exceptions) WITH ORDINALITY t(value,n)
  WHERE value->>'serviceDate'=p_date::text AND value#>>'{payload,slotId}'=p_slot ORDER BY n LOOP
  CASE e->>'type'
   WHEN 'pto','daily_absence' THEN
    IF e->'window' IS NOT NULL THEN RAISE EXCEPTION 'Full-day absence window differs';END IF;
    result:=result||'{"status":"absent","blockedWindows":[{"start":"00:00","end":"23:59"}]}'::jsonb;
   WHEN 'partial_absence' THEN
    w:=e->'window';PERFORM public.static_weekly_v3_assert_window(w,'dated partial absence');
    w:=w||jsonb_build_object('startMinute',extract(epoch FROM (w->>'start')::time)::integer/60,
     'endMinute',extract(epoch FROM (w->>'end')::time)::integer/60);
    result:=result||jsonb_build_object('blockedWindows',coalesce(result->'blockedWindows','[]'::jsonb)||jsonb_build_array(w));
   WHEN 'lunch' THEN
    w:=e->'window';PERFORM public.static_weekly_v3_assert_window(w,'dated lunch');
    result:=result||jsonb_build_object('lunch',w||jsonb_build_object(
     'startMinute',extract(epoch FROM (w->>'start')::time)::integer/60,'endMinute',extract(epoch FROM (w->>'end')::time)::integer/60));
   WHEN 'shift_override' THEN
    w:=e#>'{payload,shift}';PERFORM public.static_weekly_v3_assert_window(w,'dated shift');
    IF e#>>'{payload,status}' NOT IN('working','absent','unavailable') THEN RAISE EXCEPTION 'Dated shift status differs';END IF;
    result:=result||jsonb_build_object('status',e#>'{payload,status}','shift',w||jsonb_build_object(
     'startMinute',extract(epoch FROM (w->>'start')::time)::integer/60,'endMinute',extract(epoch FROM (w->>'end')::time)::integer/60));
   ELSE RAISE EXCEPTION USING ERRCODE='0A000',MESSAGE='Unqualified approved dated exception profile';
  END CASE;
 END LOOP;
 RETURN result;
END $availability$;

-- PRIVATE derived DATA, not an admission API. The projection validator first
-- verifies the raw mapped Source and complete original exception set. This
-- helper rereads that set and every work-changing command's relational origin.
-- It never changes Source, command history, a publication or an owner mapping.
CREATE FUNCTION public.static_weekly_approved_dated_effective_work(
 p_publication uuid,p_week date,p_source jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $effective_work$
DECLARE result jsonb;accepted jsonb;e jsonb;payload jsonb;item jsonb;patch jsonb;prior jsonb;merged jsonb;locations jsonb;
 command public.weekly_schedule_exception_commands%rowtype;current_revision bigint;day integer;idx integer;key text;locks jsonb:='{}';
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 IF p_publication IS NULL OR p_week IS NULL OR NOT isfinite(p_week) OR extract(isodow FROM p_week)<>1
  OR p_source#>>'{version,publicationId}' IS DISTINCT FROM p_publication::text
  OR jsonb_typeof(p_source#>'{version,assignments}') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_source#>'{version,assignments}') NOT BETWEEN 1 AND 4096
 THEN RAISE EXCEPTION 'Dated effective work original bounded Source differs';END IF;
 accepted:=public.static_weekly_compiler_exception_set(p_publication,p_week);
 IF p_source->'exceptions' IS DISTINCT FROM accepted THEN RAISE EXCEPTION 'Dated effective work original exceptions differ';END IF;
 SELECT c.current_revision INTO STRICT current_revision FROM public.static_weekly_schedule_control c WHERE c.singleton;
 SELECT jsonb_agg(w||jsonb_build_object('_datedOverlayWork',false,'_datedCancelled',false,
  '_datedManualLock',NULL) ORDER BY n) INTO result
  FROM jsonb_array_elements(p_source#>'{version,assignments}') WITH ORDINALITY x(w,n);
 -- The native source producer orders by service date, immutable revision, ID.
 -- Within each day this is the compiler's original exception order.
 FOR e IN SELECT value FROM jsonb_array_elements(accepted) WITH ORDINALITY x(value,n) ORDER BY n LOOP
  IF e->>'type' NOT IN('event_impact','manager_correction','nine_forty_five_rebalance') THEN CONTINUE;END IF;
  SELECT * INTO STRICT command FROM public.weekly_schedule_exception_commands c
   WHERE c.exception_id::text=e->>'id' AND c.publication_id=p_publication
    AND c.base_version_id::text=p_source#>>'{version,id}' AND c.service_date::text=e->>'serviceDate'
    AND NOT EXISTS(SELECT 1 FROM public.weekly_schedule_exception_commands r WHERE r.reverses_exception_id=c.exception_id);
  IF e->>'status' IS DISTINCT FROM 'accepted' OR e->>'type' IS DISTINCT FROM command.exception_type
   OR e->'payload' IS DISTINCT FROM command.payload_json OR e->>'payloadDigest' IS DISTINCT FROM command.payload_digest
   OR command.payload_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(command.payload_json)
   OR e->>'actorId' IS DISTINCT FROM command.actor_manager_id::text
   OR e->>'idempotencyKey' IS DISTINCT FROM command.idempotency_key
   OR e->'expectedRevision' IS DISTINCT FROM to_jsonb(command.expected_revision)
   OR e->'sequence' IS DISTINCT FROM to_jsonb(command.authority_revision)
   OR command.authority_revision<>command.expected_revision+1 OR command.authority_revision>current_revision
   OR command.starts_at IS NOT NULL OR command.ends_at IS NOT NULL
   OR command.service_date NOT BETWEEN p_week AND p_week+6
  THEN RAISE EXCEPTION 'Dated effective work accepted command provenance differs';END IF;
  payload:=command.payload_json;day:=extract(dow FROM command.service_date)::integer;
  IF command.exception_type IN('manager_correction','nine_forty_five_rebalance') THEN
   PERFORM public.static_weekly_assert_exact_object(payload,ARRAY['locks'],ARRAY['locks'],'dated original locks');
   IF jsonb_typeof(payload->'locks') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'locks')=0
   THEN RAISE EXCEPTION 'Dated original locks are empty';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(payload->'locks') LOOP
    PERFORM public.static_weekly_assert_exact_object(item,ARRAY['workId','slotId'],ARRAY['workId','slotId'],'dated original lock');
    PERFORM public.static_weekly_v3_assert_text(item->'workId','dated original lock work',160);
    PERFORM public.static_weekly_v3_assert_uuid(item->'slotId','dated original lock slot');
    key:=day::text||':'||(item->>'workId');
    IF locks ? key OR NOT public.static_weekly_exception_work_exists(command.base_version_id,command.service_date,item->>'workId')
     OR NOT public.static_weekly_exception_slot_exists(command.base_version_id,command.service_date,item->>'slotId',true)
    THEN RAISE EXCEPTION 'Dated original lock duplicate or target differs';END IF;
    locks:=locks||jsonb_build_object(key,item->'slotId');
   END LOOP;
  ELSE
   PERFORM public.static_weekly_assert_exact_object(payload,ARRAY['removeWorkIds','patchWork','addWork'],
    ARRAY['removeWorkIds','patchWork','addWork'],'dated original event command');
   PERFORM public.static_weekly_v3_assert_string_array(payload->'removeWorkIds','dated event removals',true,160);
   IF jsonb_typeof(payload->'patchWork') IS DISTINCT FROM 'array' OR jsonb_typeof(payload->'addWork') IS DISTINCT FROM 'array'
    OR jsonb_array_length(payload->'removeWorkIds')+jsonb_array_length(payload->'patchWork')+jsonb_array_length(payload->'addWork')=0
   THEN RAISE EXCEPTION 'Dated original event command arrays differ';END IF;
   IF EXISTS(SELECT 1 FROM(
    SELECT value#>>'{}' id FROM jsonb_array_elements(payload->'removeWorkIds')
    UNION ALL SELECT value->>'workId' FROM jsonb_array_elements(payload->'patchWork')
    UNION ALL SELECT value->>'workId' FROM jsonb_array_elements(payload->'addWork')) targets
    GROUP BY id HAVING id IS NULL OR count(*)<>1)
   THEN RAISE EXCEPTION 'Dated original event duplicate or overlapping target differs';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(payload->'removeWorkIds') LOOP
    IF NOT public.static_weekly_exception_work_exists(command.base_version_id,command.service_date,item#>>'{}')
    THEN RAISE EXCEPTION 'Dated event removed original target differs';END IF;
    SELECT coalesce(jsonb_agg(CASE WHEN w->>'dayOfWeek'=day::text AND w->'workId'=item
     THEN w||'{"_datedCancelled":true}'::jsonb ELSE w END ORDER BY n),'[]') INTO result
     FROM jsonb_array_elements(result) WITH ORDINALITY x(w,n);
   END LOOP;
   FOR patch IN SELECT value FROM jsonb_array_elements(payload->'patchWork') LOOP
    PERFORM public.static_weekly_v3_assert_work_payload(patch,false);
    IF NOT public.static_weekly_exception_work_exists(command.base_version_id,command.service_date,patch->>'workId')
    THEN RAISE EXCEPTION 'Dated event patched original target differs';END IF;
    SELECT (n-1)::integer,w INTO STRICT idx,prior FROM jsonb_array_elements(result) WITH ORDINALITY x(w,n)
     WHERE w->>'dayOfWeek'=day::text AND w->'workId'=patch->'workId';
    merged:=prior||patch;
    -- Exactly applyException's location-sensitive physical-member rule.
    IF NOT(patch ? 'includedLocations') AND patch->'locationId' IS DISTINCT FROM prior->'locationId'
    THEN merged:=merged-'includedLocations';END IF;
    IF coalesce(merged->>'serviceMode','scan_tracked')='scan_tracked' THEN
     locations:=coalesce(merged->'includedLocations',jsonb_build_array(jsonb_build_object(
      'locationId',merged->'locationId','locationNameSnapshot',merged->'locationNameSnapshot')));
    ELSE locations:=merged->'includedLocations';END IF;
    -- This normal native payload validator also checks exact member identities,
    -- service mode, finite effort/windows/qualifications and provenance.
    PERFORM public.static_weekly_v3_assert_work_payload(patch||jsonb_build_object(
     'serviceMode',coalesce(merged->'serviceMode','"scan_tracked"'::jsonb),'includedLocations',locations),false);
    result:=jsonb_set(result,ARRAY[idx::text],merged||jsonb_build_object('includedLocations',locations));
   END LOOP;
   FOR item IN SELECT value FROM jsonb_array_elements(payload->'addWork') LOOP
    PERFORM public.static_weekly_v3_assert_work_payload(item,true);
    IF item->>'dayOfWeek'<>day::text OR EXISTS(SELECT 1 FROM jsonb_array_elements(result) w
      WHERE w->>'dayOfWeek'=day::text AND w->'workId'=item->'workId')
     OR NOT public.static_weekly_exception_slot_exists(command.base_version_id,command.service_date,item->>'originSlotId',false)
    THEN RAISE EXCEPTION 'Dated event added original identity or date differs';END IF;
    locations:=coalesce(item->'includedLocations',jsonb_build_array(jsonb_build_object(
     'locationId',item->'locationId','locationNameSnapshot',item->'locationNameSnapshot')));
    result:=result||jsonb_build_array(item||jsonb_build_object('ownerSlotId',item->'originSlotId',
     'serviceMode',coalesce(item->'serviceMode','"scan_tracked"'::jsonb),'includedLocations',locations,
     '_datedOverlayWork',true,'_datedCancelled',false,'_datedManualLock',NULL));
   END LOOP;
  END IF;
  IF jsonb_array_length(result)>4096 THEN RAISE EXCEPTION 'Dated effective work bound exceeded';END IF;
 END LOOP;
 -- Regrouping is not permission to lose an accepted manual target. A command
 -- targeting work later cancelled by an accepted event still has its exact
 -- original state row here, just as the compiler retains it before filtering.
 IF EXISTS(SELECT 1 FROM jsonb_each(locks) l WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(result) w WHERE (w->>'dayOfWeek')||':'||(w->>'workId')=l.key))
 THEN RAISE EXCEPTION 'Dated accepted lock lost its exact mapped work target';END IF;
 SELECT coalesce(jsonb_agg(w||jsonb_build_object('_datedManualLock',locks->((w->>'dayOfWeek')||':'||(w->>'workId')))
  ORDER BY (w->>'dayOfWeek')::integer,w->>'workId' COLLATE "C"),'[]') INTO result
  FROM jsonb_array_elements(result) w WHERE w->'_datedCancelled'='false'::jsonb;
 IF (SELECT count(*) FROM jsonb_array_elements(result))<>
  (SELECT count(DISTINCT (w->>'dayOfWeek',w->>'workId')) FROM jsonb_array_elements(result) w)
 THEN RAISE EXCEPTION 'Dated effective duplicate work differs';END IF;
 IF accepted IS DISTINCT FROM public.static_weekly_compiler_exception_set(p_publication,p_week)
  OR current_revision IS DISTINCT FROM(SELECT c.current_revision FROM public.static_weekly_schedule_control c WHERE c.singleton)
 THEN RAISE EXCEPTION 'Dated effective work current original Source changed';END IF;
 RETURN result;
END $effective_work$;

-- DATED selected-day validator. Original ordinary v9 is called ONLY for the
-- ORIGINAL native baseline/ordinary proof, never for mapped parent lineage.
CREATE FUNCTION public.static_weekly_approved_dated_assert_closing(
 p_closing jsonb,p_baseline jsonb,p_approved jsonb,p_config jsonb,p_mapping jsonb,p_date date
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $closing$
DECLARE selected jsonb:=p_closing->'selected';pre jsonb;policy jsonb:=p_baseline#>'{version,shiftEndContinuityPolicy}';
 positions jsonb:='{}';anchors jsonb:='{}';units jsonb:='{}';expected jsonb:='[]';refs jsonb:='[]';availability_rows jsonb:='[]';
 named_refs jsonb:='[]';handoffs jsonb:='[]';opens jsonb:='[]';links jsonb:='{}';chains jsonb:='[]';
 slot jsonb;a jsonb;base_a jsonb;inc jsonb;cfg jsonb;parent jsonb;m jsonb;ref jsonb;u jsonb;segment jsonb;candidate jsonb;
 physical jsonb;original jsonb;effective jsonb;named jsonb;old_owner text;next_owner text;work_id text;id text;day integer:=extract(dow FROM p_date)::integer;
 at_time text;final_time text;root_end text;is_open boolean;boundary record;unit_row record;ranked record;allocation record;
 role_map jsonb:='{}';normal jsonb:='[]';declared jsonb;remaining integer;budget numeric;duration integer;minutes integer;
 location_count integer;sample_count integer;used_named text[]:='{}';seen text[]:='{}';
 partial_active boolean;nominal_units jsonb;interval_units jsonb;loads jsonb;span jsonb;last_segment jsonb;
 interval_boundary record;from_time text;to_time text;desired_owner text;original_owner text;flexible boolean;weight numeric;
BEGIN
 PERFORM public.static_weekly_assert_exact_object(p_closing,
  ARRAY['schema','selected','mappedInput','originalReceipt','originalDerivedInput'],
  ARRAY['schema','selected','mappedInput','originalReceipt','originalDerivedInput'],'dated closing wrapper');
 PERFORM public.static_weekly_assert_exact_object(selected,
  ARRAY['schema','operationDate','dayOfWeek','originalWeekSourceDigest','currentWeekSourceDigest','approvedTemplateSourceDigest','ownerConfigDigest','parentReferences','selectedAssignments','selectedAvailability','appliedExceptions','parentChains','namedHandoffReferences','continuity','handoffs','openResponsibilities','effectiveInput'],
  ARRAY['schema','operationDate','dayOfWeek','originalWeekSourceDigest','currentWeekSourceDigest','approvedTemplateSourceDigest','ownerConfigDigest','parentReferences','selectedAssignments','selectedAvailability','appliedExceptions','parentChains','namedHandoffReferences','continuity','handoffs','openResponsibilities','effectiveInput'],'dated closing selected DATA');
 pre:=jsonb_set(p_baseline,'{exceptions}',p_closing#>'{mappedInput,exceptions}',true);
 IF p_closing->>'schema' IS DISTINCT FROM 'custodial.approved-static-dated-closing.v1'
  OR selected->>'schema' IS DISTINCT FROM 'custodial.approved-dated-mapped-shift-end-derivation.v1'
  OR selected->>'operationDate' IS DISTINCT FROM p_date::text OR selected->'dayOfWeek' IS DISTINCT FROM to_jsonb(day)
  OR selected->>'originalWeekSourceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(pre)
  OR selected->>'currentWeekSourceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(pre)
  OR selected->>'approvedTemplateSourceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(p_approved)
  OR selected->>'ownerConfigDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(p_config)
  OR p_approved#>'{version,shiftEndContinuityPolicy}' IS DISTINCT FROM policy
  OR p_approved->'proximity' IS DISTINCT FROM p_baseline->'proximity'
  OR p_approved->'exceptions' IS DISTINCT FROM '[]'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(pre->'exceptions') e WHERE e->>'serviceDate'=p_date::text
   AND e->>'type' NOT IN('pto','daily_absence','partial_absence','shift_override','lunch'))
 THEN RAISE EXCEPTION 'Dated typed closing original Source or supported availability scope differs';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e->'id','type',e->'type','serviceDate',e->'serviceDate',
  'payloadDigest',e->'payloadDigest') ORDER BY n),'[]') INTO declared
  FROM jsonb_array_elements(pre->'exceptions') WITH ORDINALITY x(e,n) WHERE e->>'serviceDate'=p_date::text;
 IF selected->'appliedExceptions' IS DISTINCT FROM declared THEN RAISE EXCEPTION 'Dated closing accepted applied commands differ';END IF;
 -- Exactly the native original input; do not pass mappedInput to v9.
 PERFORM public.static_weekly_v9_assert_shift_end_derivation(jsonb_build_object(
  'compilerInput',p_baseline,'overlayCompilerInput',p_closing->'originalDerivedInput',
  'shiftEndDerivation',p_closing->'originalReceipt',
  'derivedBaselineDigest',public.static_weekly_digest_jsonb(p_closing->'originalDerivedInput')));
 IF jsonb_typeof(selected->'selectedAssignments') IS DISTINCT FROM 'array'
  OR jsonb_array_length(selected->'selectedAssignments') NOT BETWEEN 1 AND 1024
  OR jsonb_typeof(selected->'parentReferences') IS DISTINCT FROM 'array'
  OR jsonb_typeof(selected->'parentChains') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Dated closing bounded arrays required';END IF;
 FOR slot IN SELECT value FROM jsonb_array_elements(p_baseline->'slots') LOOP
  SELECT value INTO base_a FROM jsonb_array_elements(p_baseline#>'{version,slotAvailability}')
   WHERE value->'slotId'=slot->'id' AND value->>'dayOfWeek'=day::text;
  IF base_a IS NULL THEN CONTINUE;END IF;
  IF NOT(base_a ? 'acceptedRoute') AND p_baseline#>ARRAY['version','acceptedRoutesBySlot',slot->>'id'] IS NOT NULL THEN
   base_a:=base_a||jsonb_build_object('acceptedRoute',p_baseline#>ARRAY['version','acceptedRoutesBySlot',slot->>'id']);END IF;
  a:=public.static_weekly_approved_dated_effective_availability(base_a,slot->>'id',p_date,pre->'exceptions');
  SELECT value INTO inc FROM jsonb_array_elements(slot->'incumbencies')
   WHERE (value->>'effectiveStart')::date<=p_date AND (value->>'effectiveEnd' IS NULL OR p_date<(value->>'effectiveEnd')::date);
  IF (SELECT count(*) FROM jsonb_array_elements(slot->'incumbencies') WHERE (value->>'effectiveStart')::date<=p_date
    AND (value->>'effectiveEnd' IS NULL OR p_date<(value->>'effectiveEnd')::date))>1
  THEN RAISE EXCEPTION 'Dated closing actual incumbent is ambiguous';END IF;
  availability_rows:=availability_rows||jsonb_build_array(jsonb_build_object('slotId',slot->'id','personId',inc->'personId',
   'vacant',inc IS NULL,'availability',a));
  IF a->>'status' NOT IN('working','vacant_unfilled') THEN CONTINUE;END IF;
  SELECT value INTO STRICT cfg FROM jsonb_each(p_config->'slots') WHERE value->'slotId'=slot->'id';
  PERFORM public.static_weekly_approved_dated_assert_window(a->'shift','closing shift');
  PERFORM public.static_weekly_approved_dated_assert_window(a->'lunch','closing lunch');
  IF coalesce(slot->'contractorCapacity','false'::jsonb)<>'false'::jsonb
   OR (inc IS NULL) IS DISTINCT FROM (a->>'status'='vacant_unfilled')
   OR (inc IS NULL AND (cfg->'vacancy' IS DISTINCT FROM 'true'::jsonb OR cfg->>'personId' IS NOT NULL))
   OR (inc IS NOT NULL AND (cfg->'vacancy'='true'::jsonb OR cfg->'personId' IS DISTINCT FROM inc->'personId'))
   OR NOT(cfg->'workDays' @> jsonb_build_array(day))
   OR base_a->'shift' IS DISTINCT FROM jsonb_build_object('start',coalesce(cfg#>ARRAY['shiftByDay',day::text,'0'],cfg#>'{shift,0}'),
    'end',coalesce(cfg#>ARRAY['shiftByDay',day::text,'1'],cfg#>'{shift,1}'))
   OR base_a->'lunch' IS DISTINCT FROM jsonb_build_object('start',coalesce(cfg#>ARRAY['lunchByDay',day::text,'0'],cfg#>'{lunch,0}'),
    'end',coalesce(cfg#>ARRAY['lunchByDay',day::text,'1'],cfg#>'{lunch,1}'))
  THEN RAISE EXCEPTION 'Dated closing current incumbent config shift lunch differs';END IF;
  positions:=positions||jsonb_build_object(slot->>'id',jsonb_build_object('availability',a,'config',cfg,'personId',inc->'personId','vacant',inc IS NULL));
 END LOOP;
 IF EXISTS((SELECT value FROM jsonb_array_elements(availability_rows) EXCEPT ALL SELECT value FROM jsonb_array_elements(selected->'selectedAvailability'))
  UNION ALL(SELECT value FROM jsonb_array_elements(selected->'selectedAvailability') EXCEPT ALL SELECT value FROM jsonb_array_elements(availability_rows)))
 THEN RAISE EXCEPTION 'Dated closing selected availability is not actual original day';END IF;
 SELECT max(value#>>'{availability,shift,end}') INTO final_time FROM jsonb_each(positions) WHERE value->'vacant'='false'::jsonb;
 IF final_time IS NULL OR final_time<='09:45' THEN RAISE EXCEPTION 'Dated closing real staffed boundary missing';END IF;
 FOR parent IN SELECT value FROM jsonb_array_elements(p_approved#>'{version,assignments}') WHERE value->>'dayOfWeek'=day::text LOOP
  SELECT value INTO STRICT m FROM jsonb_array_elements(p_mapping->'slotMapping') WHERE value->'patternSlotId'=parent->'ownerSlotId';
  original:=parent;parent:=jsonb_set(parent,'{ownerSlotId}',m->'actualSlotId');
  a:=positions#>ARRAY[m->>'actualSlotId','availability'];cfg:=positions#>ARRAY[m->>'actualSlotId','config'];
  IF a IS NULL OR positions#>ARRAY[m->>'actualSlotId','personId'] IS DISTINCT FROM m->'actualPersonId'
   OR positions#>ARRAY[m->>'actualSlotId','vacant']<>'false'::jsonb
   OR parent#>>'{window,start}'<a#>>'{shift,start}' OR parent#>>'{window,end}'>a#>>'{shift,end}'
   OR (parent#>>'{window,start}'='09:45' AND parent#>'{window,end}' IS DISTINCT FROM a#>'{shift,end}')
   OR NOT(a->'qualifications' @> parent->'requiredQualifications')
   OR parent->'restrictedSlotIds' ? (m->>'actualSlotId')
   OR coalesce(cfg->'hardForbiddenFamilies','[]'::jsonb) ? (parent->>'locationCodeSnapshot')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(parent->'includedLocations') l WHERE a->'restrictions' ? (l->>'locationId'))
   OR (parent->'manualLock'='true'::jsonb AND m->'actualSlotId' IS DISTINCT FROM original->'ownerSlotId')
  THEN RAISE EXCEPTION 'Dated closing mapped parent actual eligibility differs';END IF;
  ref:=jsonb_build_object('dayOfWeek',day,'parentWorkId',parent->'workId','originalParent',original,'mappedParent',parent,
   'originalOwnerSlotId',original->'ownerSlotId','mappedOwnerSlotId',m->'actualSlotId','currentPersonId',m->'actualPersonId');
  refs:=refs||jsonb_build_array(ref);role_map:=role_map||jsonb_build_object(original->>'ownerSlotId',m->'actualSlotId');
  IF parent#>>'{window,start}'='09:45' THEN
   IF NOT(policy->'weights' ? (parent->>'locationCodeSnapshot')) OR position(':handoff:' in parent->>'workId')>0 OR position(':open:' in parent->>'workId')>0
   THEN RAISE EXCEPTION 'Dated closing immutable parent policy weight or identity differs';END IF;
   normal:=normal||jsonb_build_array(parent);
   parent:=jsonb_set(parent,'{window,end}',to_jsonb(least(parent#>>'{window,end}',final_time)));
  END IF;
  IF units ? (parent->>'workId') THEN RAISE EXCEPTION 'Dated closing duplicate parent';END IF;
  units:=units||jsonb_build_object(parent->>'workId',jsonb_build_object('parent',parent,'owner',parent->'ownerSlotId','segments',jsonb_build_array(parent)));
 END LOOP;
 IF jsonb_array_length(refs)=0 OR EXISTS((SELECT value FROM jsonb_array_elements(refs) EXCEPT ALL SELECT value FROM jsonb_array_elements(selected->'parentReferences'))
  UNION ALL(SELECT value FROM jsonb_array_elements(selected->'parentReferences') EXCEPT ALL SELECT value FROM jsonb_array_elements(refs)))
 THEN RAISE EXCEPTION 'Dated closing exact native catalog parent references differ';END IF;
 FOR id,a IN SELECT key,value FROM jsonb_each(positions) LOOP
  SELECT coalesce(jsonb_agg(l->'locationId'),'[]') INTO declared FROM jsonb_array_elements(normal) w
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_array_length(w->'includedLocations')>0 THEN w->'includedLocations'
    ELSE jsonb_build_array(jsonb_build_object('locationId',w->'locationId')) END) l WHERE w->>'ownerSlotId'=id;
  IF jsonb_array_length(declared)=0 AND a#>>'{availability,acceptedRouteAnchorLocationId}' IS NOT NULL
  THEN declared:=jsonb_build_array(a#>'{availability,acceptedRouteAnchorLocationId}');END IF;
  anchors:=anchors||jsonb_build_object(id,declared);
 END LOOP;
 FOR named IN SELECT value FROM jsonb_array_elements(coalesce(policy->'namedHandoffs','[]'::jsonb)) WHERE value->>'dayOfWeek'=day::text LOOP
  named_refs:=named_refs||jsonb_build_array(jsonb_build_object('originalHandoff',named,
   'mappedFromSlotId',coalesce(role_map->(named->>'fromSlotId'),named->'fromSlotId'),
   'mappedToSlotId',coalesce(role_map->(named->>'toSlotId'),named->'toSlotId')));
 END LOOP;
 -- Activation comes only from actual accepted commands and native availability,
 -- never a supplied mode/coverage flag. The closed schema above already rejects
 -- the unresolved producer variant before any relational or lunch write.
 partial_active:=EXISTS(SELECT 1 FROM jsonb_array_elements(pre->'exceptions') e WHERE e->>'serviceDate'=p_date::text
  AND e->>'type'='partial_absence') AND EXISTS(SELECT 1 FROM jsonb_each(positions) p
   CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.value#>'{availability,blockedWindows}','[]')) b
   CROSS JOIN LATERAL jsonb_array_elements(p_approved#>'{version,assignments}') w
   WHERE p.value->'vacant'='false'::jsonb AND w->>'dayOfWeek'=day::text
    AND b->>'start'<CASE WHEN w#>>'{window,start}'='09:45' THEN final_time ELSE w#>>'{window,end}' END
    AND w#>>'{window,start}'<b->>'end'
    AND b->>'start'<p.value#>>'{availability,shift,end}' AND p.value#>>'{availability,shift,start}'<b->>'end')
 ;
 -- With partial intervals this first traversal constructs NORMAL nominal
 -- shift-end references only. It ignores blocked windows for those references,
 -- never for emitted work; there is no vacant fallback on the partial path.
 FOR boundary IN SELECT DISTINCT value#>>'{availability,shift,end}' end_boundary FROM jsonb_each(positions)
  WHERE value#>>'{availability,shift,end}'<final_time ORDER BY end_boundary LOOP
  at_time:=boundary.end_boundary;
  FOR unit_row IN SELECT key FROM jsonb_each(units)
   WHERE value#>>'{parent,window,start}'='09:45' AND positions#>>ARRAY[value->>'owner','availability','shift','end']=at_time
   ORDER BY key COLLATE "C" LOOP
   u:=units->unit_row.key;parent:=u->'parent';old_owner:=u->>'owner';candidate:=NULL;is_open:=false;
   SELECT value INTO named FROM jsonb_array_elements(named_refs)
    WHERE value#>>'{originalHandoff,locationCode}'=parent->>'locationCodeSnapshot' AND value#>>'{originalHandoff,at}'=at_time;
   IF named IS NOT NULL AND named->>'mappedFromSlotId'<>old_owner THEN RAISE EXCEPTION 'Dated closing named source differs';END IF;
   -- Same directed proximity -> already-held weighted load -> stable position
   -- ordering. No candidate row, distance, load or availability is caller DATA.
   FOR remaining IN 0..(CASE WHEN partial_active THEN 0 ELSE 1 END) LOOP
    SELECT q.* INTO ranked FROM(
     SELECT p.key,p.value,
      (SELECT max(nearest) FROM(
       SELECT min(CASE WHEN anchor#>>'{}'=loc->>'locationId' THEN 0 ELSE
        (SELECT (edge->>'minutes')::numeric FROM jsonb_array_elements(p_baseline->'proximity') edge
         WHERE edge->'verified'='true'::jsonb AND edge->>'fromLocationId'=anchor#>>'{}'
          AND edge->>'toLocationId'=loc->>'locationId' LIMIT 1) END) nearest
       FROM jsonb_array_elements(parent->'includedLocations') loc CROSS JOIN LATERAL jsonb_array_elements(anchors->p.key) anchor
       GROUP BY loc) distances HAVING count(nearest)=jsonb_array_length(parent->'includedLocations')) distance,
      (SELECT coalesce(sum(coalesce((policy#>>ARRAY['weights',value#>>'{parent,locationCodeSnapshot}'])::numeric,1)),0)
       FROM jsonb_each(units) WHERE value->>'owner'=p.key
        AND (NOT partial_active OR value#>>'{parent,window,start}'='09:45')) load
     FROM jsonb_each(positions) p WHERE p.value->'vacant'=to_jsonb(remaining=1)
      AND p.value#>>'{availability,shift,start}'<=at_time AND at_time<p.value#>>'{availability,shift,end}'
      AND NOT(p.value#>>'{availability,lunch,start}'<=at_time AND at_time<p.value#>>'{availability,lunch,end}')
      AND (partial_active OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p.value#>'{availability,blockedWindows}','[]')) b WHERE b->>'start'<=at_time AND at_time<b->>'end'))
      AND NOT(coalesce(p.value#>'{config,hardForbiddenFamilies}','[]') ? (parent->>'locationCodeSnapshot'))
      AND (p.value->>'personId' NOT IN('3da709bb-2223-4e15-8e3a-db02e3f32e97','cd97111e-cfa0-4228-b4d7-401bc7a5ac13','30ec85e0-a579-45a8-9c27-c164e77a9190')
       OR p.value->>'personId' IS NULL OR p.value#>'{config,normalAssignmentFamilies}' ? (parent->>'locationCodeSnapshot'))
      AND NOT(parent->'restrictedSlotIds' ? p.key)
      AND p.value#>'{availability,qualifications}' @> parent->'requiredQualifications'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parent->'includedLocations') l WHERE p.value#>'{availability,restrictions}' ? (l->>'locationId'))
    ) q WHERE q.distance IS NOT NULL AND (named IS NULL OR (remaining=0 AND q.key=named->>'mappedToSlotId'))
     ORDER BY q.distance,q.load,q.key COLLATE "C" LIMIT 1;
    IF FOUND THEN candidate:=jsonb_build_object('slotId',ranked.key,'distance',ranked.distance);is_open:=remaining=1;EXIT;END IF;
   END LOOP;
   IF candidate IS NULL THEN RAISE EXCEPTION 'Dated closing no eligible actual on-duty owner';END IF;
   IF named IS NOT NULL THEN
    -- The exact original named endpoint chooses within the SAME independently
    -- eligible real-employee universe, never by a caller receipt/boolean.
    IF is_open OR named->>'mappedFromSlotId'<>old_owner OR named->'mappedToSlotId' IS DISTINCT FROM candidate->'slotId'
    THEN RAISE EXCEPTION 'Dated closing named current endpoint differs from eligible fixed selection';END IF;
    used_named:=array_append(used_named,(named->'originalHandoff')::text);
   END IF;
   next_owner:=candidate->>'slotId';
   work_id:=(parent->>'workId')||':'||CASE WHEN is_open THEN 'open' ELSE 'handoff' END||':'||at_time||':'||next_owner;
   segment:=parent||jsonb_build_object('workId',work_id,'ownerSlotId',next_owner,'originSlotId',next_owner,
    'window',jsonb_build_object('start',at_time,'end',least(positions#>>ARRAY[next_owner,'availability','shift','end'],final_time)));
   u:=u||jsonb_build_object('owner',next_owner,'segments',(u->'segments')||jsonb_build_array(segment));
   units:=jsonb_set(units,ARRAY[unit_row.key],u);
   declared:=jsonb_build_object('day',day,'at',at_time,'workId',work_id,'fromSlotId',old_owner,'toSlotId',next_owner,
    'locationCode',parent->'locationCodeSnapshot','locationIds',(SELECT jsonb_agg(l->'locationId') FROM jsonb_array_elements(parent->'includedLocations') l),
    'directedProximityMinutes',candidate->'distance','fromVacantPosition',positions#>ARRAY[old_owner,'vacant']);
   IF is_open THEN opens:=opens||jsonb_build_array(declared||jsonb_build_object('status','OPEN','personId',NULL,'reason','no_eligible_real_on_duty_custodian'));
   ELSE handoffs:=handoffs||jsonb_build_array(declared);END IF;
  END LOOP;
 END LOOP;
 IF partial_active THEN
  nominal_units:=units;interval_units:='{}';handoffs:='[]';opens:='[]';used_named:=ARRAY[]::text[];
  -- Rebuild from immutable mapped parents, not from the supplied selected plan
  -- nor from nominal spans. Fixed/reminder visits remain one whole appointment.
  FOR ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
   parent:=ref->'mappedParent';
   IF parent#>>'{window,start}'='09:45' THEN parent:=jsonb_set(parent,'{window,end}',to_jsonb(final_time));END IF;
   interval_units:=interval_units||jsonb_build_object(parent->>'workId',jsonb_build_object(
    'parent',parent,'owner',parent->'ownerSlotId','segments','[]'::jsonb,
    'flexible',parent->>'schedulingMode'='flexible_coverage_ownership' AND parent->>'serviceMode'<>'reminder_only'));
  END LOOP;
  -- Every boundary is derived from actual parents/shifts/lunches/accepted
  -- blocked windows/named policy. Lexical ordering is exact canonical HH:MM.
  FOR interval_boundary IN WITH bounds(t) AS(
   SELECT value#>>'{parent,window,start}' FROM jsonb_each(interval_units)
   UNION SELECT value#>>'{parent,window,end}' FROM jsonb_each(interval_units)
   UNION SELECT value#>>'{availability,shift,start}' FROM jsonb_each(positions)
   UNION SELECT value#>>'{availability,shift,end}' FROM jsonb_each(positions)
   UNION SELECT value#>>'{availability,lunch,start}' FROM jsonb_each(positions)
   UNION SELECT value#>>'{availability,lunch,end}' FROM jsonb_each(positions)
   UNION SELECT b->>'start' FROM jsonb_each(positions) p CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.value#>'{availability,blockedWindows}','[]')) b
   UNION SELECT b->>'end' FROM jsonb_each(positions) p CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.value#>'{availability,blockedWindows}','[]')) b
   UNION SELECT value#>>'{originalHandoff,at}' FROM jsonb_array_elements(named_refs)
  ),pairs AS(SELECT t start_time,lead(t) OVER(ORDER BY t COLLATE "C") end_time FROM bounds)
   SELECT * FROM pairs WHERE end_time IS NOT NULL ORDER BY start_time COLLATE "C" LOOP
   -- Dynamic weighted ownership before this actual interval. Updating this
   -- private map after each stable parent matches the deterministic policy.
   SELECT coalesce(jsonb_object_agg(p.key,coalesce((SELECT sum(coalesce(
    (policy#>>ARRAY['weights',x.value#>>'{parent,locationCodeSnapshot}'])::numeric,1)) FROM jsonb_each(interval_units) x
    WHERE x.value->>'owner'=p.key AND x.value#>>'{parent,window,start}'<=interval_boundary.start_time
     AND interval_boundary.end_time<=x.value#>>'{parent,window,end}'),0)),'{}') INTO loads
    FROM jsonb_each(positions) p WHERE p.value->'vacant'='false'::jsonb;
   FOR unit_row IN SELECT key FROM jsonb_each(interval_units)
    WHERE value#>>'{parent,window,start}'<=interval_boundary.start_time
     AND interval_boundary.end_time<=value#>>'{parent,window,end}' ORDER BY key COLLATE "C" LOOP
    u:=interval_units->unit_row.key;parent:=u->'parent';flexible:=(u->>'flexible')::boolean;
    IF NOT flexible AND jsonb_array_length(u->'segments')>0 THEN CONTINUE;END IF;
    from_time:=CASE WHEN flexible THEN interval_boundary.start_time ELSE parent#>>'{window,start}' END;
    to_time:=CASE WHEN flexible THEN interval_boundary.end_time ELSE parent#>>'{window,end}' END;
    old_owner:=u->>'owner';original_owner:=parent->>'ownerSlotId';desired_owner:=original_owner;
    IF parent#>>'{window,start}'='09:45' THEN
     SELECT value INTO span FROM jsonb_array_elements(nominal_units#>ARRAY[unit_row.key,'segments'])
      WHERE value#>>'{window,start}'<=from_time AND to_time<=value#>>'{window,end}';
     IF span IS NOT NULL THEN desired_owner:=span->>'ownerSlotId';END IF;
    END IF;
    SELECT value INTO named FROM jsonb_array_elements(named_refs)
     WHERE parent#>>'{window,start}'='09:45'
      AND value#>>'{originalHandoff,locationCode}'=parent->>'locationCodeSnapshot'
      AND value#>>'{originalHandoff,at}'=interval_boundary.start_time;
    IF named IS NOT NULL AND named->>'mappedFromSlotId' IS DISTINCT FROM old_owner
    THEN RAISE EXCEPTION 'Dated partial named actual source differs';END IF;
    -- Rank only actual nonvacant current employees over the ENTIRE requested
    -- interval. A borrowed interval/fixed visit may not overlap protected lunch.
    SELECT q.* INTO ranked FROM(
     SELECT p.key,
      (SELECT max(nearest) FROM(
       SELECT min(CASE WHEN anchor#>>'{}'=loc->>'locationId' THEN 0 ELSE
        (SELECT (edge->>'minutes')::numeric FROM jsonb_array_elements(p_baseline->'proximity') edge
         WHERE edge->'verified'='true'::jsonb AND edge->>'fromLocationId'=anchor#>>'{}'
          AND edge->>'toLocationId'=loc->>'locationId' LIMIT 1) END) nearest
       FROM jsonb_array_elements(CASE WHEN jsonb_array_length(parent->'includedLocations')>0 THEN parent->'includedLocations'
        ELSE jsonb_build_array(jsonb_build_object('locationId',parent->'locationId')) END) loc
       CROSS JOIN LATERAL jsonb_array_elements(anchors->p.key) anchor GROUP BY loc) distances
       HAVING count(nearest)=CASE WHEN jsonb_array_length(parent->'includedLocations')>0
        THEN jsonb_array_length(parent->'includedLocations') ELSE 1 END) distance,
      coalesce((loads->>p.key)::numeric,0) load
     FROM jsonb_each(positions) p WHERE p.value->'vacant'='false'::jsonb
      AND p.value#>>'{availability,shift,start}'<=from_time AND to_time<=p.value#>>'{availability,shift,end}'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p.value#>'{availability,blockedWindows}','[]')) b
       WHERE b->>'start'<to_time AND from_time<b->>'end')
      AND ((p.key=original_owner AND flexible) OR NOT(p.value#>>'{availability,lunch,start}'<to_time AND from_time<p.value#>>'{availability,lunch,end}'))
      AND NOT(coalesce(p.value#>'{config,hardForbiddenFamilies}','[]') ? (parent->>'locationCodeSnapshot'))
      AND (p.value->>'personId' NOT IN('3da709bb-2223-4e15-8e3a-db02e3f32e97','cd97111e-cfa0-4228-b4d7-401bc7a5ac13','30ec85e0-a579-45a8-9c27-c164e77a9190')
       OR p.value#>'{config,normalAssignmentFamilies}' ? (parent->>'locationCodeSnapshot'))
      AND NOT(parent->'restrictedSlotIds' ? p.key)
      AND p.value#>'{availability,qualifications}' @> parent->'requiredQualifications'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_array_length(parent->'includedLocations')>0 THEN parent->'includedLocations'
       ELSE jsonb_build_array(jsonb_build_object('locationId',parent->'locationId')) END) l WHERE p.value#>'{availability,restrictions}' ? (l->>'locationId'))
    ) q WHERE q.distance IS NOT NULL AND (named IS NULL OR q.key=named->>'mappedToSlotId')
     ORDER BY CASE WHEN q.key=desired_owner THEN 0 WHEN q.key=old_owner THEN 1 ELSE 2 END,q.distance,q.load,q.key COLLATE "C" LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dated partial interval has no eligible original or borrowed owner';END IF;
    next_owner:=ranked.key;
    IF parent->'manualLock'='true'::jsonb AND next_owner IS DISTINCT FROM original_owner
    THEN RAISE EXCEPTION 'Dated partial locked original owner is unavailable';END IF;
    IF named IS NOT NULL AND NOT((named->'originalHandoff')::text=ANY(used_named))
    THEN used_named:=array_append(used_named,(named->'originalHandoff')::text);END IF;
    declared:=u->'segments';last_segment:=declared->-1;
    IF last_segment IS NOT NULL AND last_segment->>'ownerSlotId'=next_owner AND last_segment#>>'{window,end}'=from_time THEN
     declared:=jsonb_set(declared,ARRAY[(jsonb_array_length(declared)-1)::text,'window','end'],to_jsonb(to_time));
    ELSE
     work_id:=CASE WHEN jsonb_array_length(declared)=0 THEN parent->>'workId'
      ELSE (parent->>'workId')||':handoff:'||from_time||':'||next_owner END;
     segment:=parent||jsonb_build_object('workId',work_id,'ownerSlotId',next_owner,
      'originSlotId',CASE WHEN jsonb_array_length(declared)=0 THEN parent->'originSlotId' ELSE to_jsonb(next_owner) END,
      'window',jsonb_build_object('start',from_time,'end',to_time));
     declared:=declared||jsonb_build_array(segment);
     IF next_owner<>old_owner THEN
      handoffs:=handoffs||jsonb_build_array(jsonb_build_object('day',day,'at',from_time,'workId',work_id,
       'fromSlotId',old_owner,'toSlotId',next_owner,'locationCode',parent->'locationCodeSnapshot',
       'locationIds',(SELECT jsonb_agg(l->'locationId') FROM jsonb_array_elements(CASE WHEN jsonb_array_length(parent->'includedLocations')>0 THEN parent->'includedLocations'
        ELSE jsonb_build_array(jsonb_build_object('locationId',parent->'locationId')) END) l),
       'directedProximityMinutes',ranked.distance,'fromVacantPosition',false));
     END IF;
    END IF;
    IF next_owner<>old_owner THEN
     weight:=coalesce((policy#>>ARRAY['weights',parent->>'locationCodeSnapshot'])::numeric,1);
     loads:=jsonb_set(loads,ARRAY[old_owner],to_jsonb(coalesce((loads->>old_owner)::numeric,0)-weight));
     loads:=jsonb_set(loads,ARRAY[next_owner],to_jsonb(coalesce((loads->>next_owner)::numeric,0)+weight));
    END IF;
    interval_units:=jsonb_set(interval_units,ARRAY[unit_row.key],u||jsonb_build_object('owner',next_owner,'segments',declared));
   END LOOP;
  END LOOP;
  units:=interval_units;
 END IF;
 IF cardinality(used_named)<>jsonb_array_length(named_refs) THEN RAISE EXCEPTION 'Dated closing named handoff not applied';END IF;
 FOR unit_row IN SELECT key,value FROM jsonb_each(units) LOOP
  u:=unit_row.value;parent:=u->'parent';declared:=u->'segments';
  IF jsonb_typeof(parent->'serviceEffortMinutes') IS DISTINCT FROM 'number'
   OR coalesce(parent->>'serviceEffortMinutes','')!~'^[1-9][0-9]*$'
   OR (parent->>'serviceEffortMinutes')::numeric>9007199254740991 OR jsonb_array_length(declared)=0
   OR (NOT coalesce((u->>'flexible')::boolean,true) AND jsonb_array_length(declared)<>1)
  THEN RAISE EXCEPTION 'Dated closing positive original integer budget or one-time visit differs';END IF;
  budget:=(parent->>'serviceEffortMinutes')::numeric;
  IF jsonb_array_length(declared)>1 THEN
   SELECT sum(extract(epoch FROM ((r#>>'{window,end}')::time-(r#>>'{window,start}')::time))/60)::integer INTO duration
    FROM jsonb_array_elements(declared) r;
   IF budget<jsonb_array_length(declared) OR duration<=0 THEN RAISE EXCEPTION 'Dated closing split budget invalid';END IF;
   SELECT budget-sum(1+floor((budget-jsonb_array_length(declared))*
    (extract(epoch FROM ((r#>>'{window,end}')::time-(r#>>'{window,start}')::time))/60)/duration))::integer INTO remaining FROM jsonb_array_elements(declared) r;
   FOR allocation IN SELECT n,r,1+floor((budget-jsonb_array_length(declared))*
     (extract(epoch FROM ((r#>>'{window,end}')::time-(r#>>'{window,start}')::time))/60)/duration) points,
    row_number() OVER(ORDER BY mod((budget-jsonb_array_length(declared))*(extract(epoch FROM ((r#>>'{window,end}')::time-(r#>>'{window,start}')::time))/60),duration) DESC,n) rank
    FROM jsonb_array_elements(declared) WITH ORDINALITY x(r,n) LOOP
    segment:=allocation.r||jsonb_build_object('serviceEffortMinutes',allocation.points+CASE WHEN allocation.rank<=remaining THEN 1 ELSE 0 END,
     'serviceEffortProvenance',(parent->>'serviceEffortProvenance')||';shift-split-preserves-budget');
    declared:=jsonb_set(declared,ARRAY[(allocation.n-1)::text],segment);
   END LOOP;
  END IF;
  root_end:=parent#>>'{window,start}';
  FOR segment IN SELECT value FROM jsonb_array_elements(declared) LOOP
   a:=positions#>ARRAY[segment->>'ownerSlotId','availability'];
   IF segment#>>'{window,start}' IS DISTINCT FROM root_end OR segment#>>'{window,start}'<a#>>'{shift,start}'
    OR segment#>>'{window,end}'>a#>>'{shift,end}' OR segment#>>'{window,start}'>=segment#>>'{window,end}'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(a->'blockedWindows','[]')) b
     WHERE b->>'start'<segment#>>'{window,end}' AND segment#>>'{window,start}'<b->>'end')
   THEN RAISE EXCEPTION 'Dated closing segment conflicts with actual accepted availability';END IF;
   root_end:=segment#>>'{window,end}';expected:=expected||jsonb_build_array(segment);
   links:=links||jsonb_build_object(day::text||':'||(segment->>'workId'),unit_row.key);
  END LOOP;
  IF parent#>>'{window,start}'='09:45' AND root_end<>final_time THEN RAISE EXCEPTION 'Dated closing chain misses real closing';END IF;
  IF partial_active AND root_end IS DISTINCT FROM parent#>>'{window,end}'
  THEN RAISE EXCEPTION 'Dated partial chain loses an original interval';END IF;
  IF (SELECT sum((r->>'serviceEffortMinutes')::numeric) FROM jsonb_array_elements(declared) r) IS DISTINCT FROM budget
  THEN RAISE EXCEPTION 'Dated closing exact positive integer budget differs';END IF;
  chains:=chains||jsonb_build_array(jsonb_build_object('dayOfWeek',day,'parentWorkId',unit_row.key,'segments',declared));
 END LOOP;
 SELECT count(DISTINCT l->>'locationId') INTO location_count FROM jsonb_array_elements(normal) w CROSS JOIN LATERAL jsonb_array_elements(w->'includedLocations') l;
 sample_count:=extract(epoch FROM final_time::time)::integer/60-585;
 IF EXISTS(SELECT 1 FROM generate_series(585,585+sample_count-1) t(minute) CROSS JOIN LATERAL(
   SELECT l->>'locationId' id FROM jsonb_array_elements(normal) w CROSS JOIN LATERAL jsonb_array_elements(w->'includedLocations') l) locations
   WHERE (SELECT count(*) FROM jsonb_array_elements(expected) w CROSS JOIN LATERAL jsonb_array_elements(w->'includedLocations') l
    WHERE w->>'serviceMode'<>'reminder_only' AND w#>>'{window,start}'>='09:45' AND l->>'locationId'=locations.id
     AND extract(epoch FROM (w#>>'{window,start}')::time)/60<=t.minute AND t.minute<extract(epoch FROM (w#>>'{window,end}')::time)/60)<>1)
  OR EXISTS((SELECT value FROM jsonb_array_elements(expected) EXCEPT ALL SELECT value FROM jsonb_array_elements(selected->'selectedAssignments'))
   UNION ALL(SELECT value FROM jsonb_array_elements(selected->'selectedAssignments') EXCEPT ALL SELECT value FROM jsonb_array_elements(expected)))
  OR EXISTS((SELECT value FROM jsonb_array_elements(chains) EXCEPT ALL SELECT value FROM jsonb_array_elements(selected->'parentChains'))
   UNION ALL(SELECT value FROM jsonb_array_elements(selected->'parentChains') EXCEPT ALL SELECT value FROM jsonb_array_elements(chains)))
  OR selected->'continuity' IS DISTINCT FROM jsonb_build_object('staffedDeparture',final_time,'minuteSamples',sample_count,
   'locationMinuteChecks',sample_count*location_count,'coverageGaps',0,'duplicateLocations',0,'lunchScope','handoff eligibility only; independent lunch coverage derivation required')
  OR selected->'namedHandoffReferences' IS DISTINCT FROM named_refs OR selected->'handoffs' IS DISTINCT FROM handoffs OR selected->'openResponsibilities' IS DISTINCT FROM opens
 THEN RAISE EXCEPTION 'Dated closing independently reconstructed chain output differs';END IF;
 effective:=p_closing->'originalDerivedInput';
 SELECT jsonb_agg(w ORDER BY n) INTO declared FROM jsonb_array_elements(effective#>'{version,assignments}') WITH ORDINALITY x(w,n) WHERE w->>'dayOfWeek'<>day::text;
 effective:=jsonb_set(effective,'{version,assignments}',coalesce(declared,'[]')||expected);
 -- Effective selected DATA keeps the six RAW input days, separately from the
 -- actual six derived projection days returned above.
 IF selected->'effectiveInput'-'version' IS DISTINCT FROM pre-'version'
  OR (selected#>'{effectiveInput,version}')-'assignments' IS DISTINCT FROM (pre->'version')-'assignments'
  OR (SELECT jsonb_agg(w ORDER BY n) FROM jsonb_array_elements(selected#>'{effectiveInput,version,assignments}') WITH ORDINALITY x(w,n) WHERE w->>'dayOfWeek'<>day::text)
   IS DISTINCT FROM (SELECT jsonb_agg(w ORDER BY n) FROM jsonb_array_elements(pre#>'{version,assignments}') WITH ORDINALITY x(w,n) WHERE w->>'dayOfWeek'<>day::text)
  OR EXISTS((SELECT value FROM jsonb_array_elements(selected#>'{effectiveInput,version,assignments}') WHERE value->>'dayOfWeek'<>day::text
    EXCEPT ALL SELECT value FROM jsonb_array_elements(pre#>'{version,assignments}') WHERE value->>'dayOfWeek'<>day::text)
   UNION ALL(SELECT value FROM jsonb_array_elements(pre#>'{version,assignments}') WHERE value->>'dayOfWeek'<>day::text
    EXCEPT ALL SELECT value FROM jsonb_array_elements(selected#>'{effectiveInput,version,assignments}') WHERE value->>'dayOfWeek'<>day::text))
  OR EXISTS((SELECT value FROM jsonb_array_elements(selected#>'{effectiveInput,version,assignments}') WHERE value->>'dayOfWeek'=day::text
    EXCEPT ALL SELECT value FROM jsonb_array_elements(expected))
   UNION ALL(SELECT value FROM jsonb_array_elements(expected) EXCEPT ALL SELECT value FROM jsonb_array_elements(selected#>'{effectiveInput,version,assignments}') WHERE value->>'dayOfWeek'=day::text))
 THEN RAISE EXCEPTION 'Dated closing original six raw days or selected effective lineage differs';END IF;
 RETURN jsonb_build_object('effectiveInput',effective,'selectedParentLinks',links);
END $closing$;

CREATE FUNCTION public.static_weekly_assert_approved_dated_projection(
 p_envelope jsonb,p_publication_id uuid,p_week date,p_exceptions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $validation$
DECLARE authority jsonb:=p_envelope->'authority';source jsonb;live_source jsonb;approved_source jsonb;config jsonb;entry record;current_source record;
 expected_availability jsonb:='[]';expected_slots jsonb:='[]';expected_rows jsonb:='[]';expected_projection jsonb:='[]';
 slot jsonb;availability jsonb;incumbent jsonb;owner_config jsonb;work jsonb;normalized_work jsonb;person jsonb;owner_key text;
 roster jsonb:='[]';projection_availability jsonb;item jsonb;identity_key text;d date;day integer;baseline_person jsonb;
 productive numeric;effort numeric;duty numeric;v_source_id uuid;employee_count integer;working_count integer:=0;
 mapped_rows jsonb;mapping jsonb;role_availability jsonb;actual_availability jsonb;role_profile jsonb;actual_profile jsonb;
 route jsonb;stops jsonb;stop jsonb;nodes jsonb;node jsonb;previous_node jsonb;blocked jsonb;protected_windows jsonb;
 route_start text;route_provenance text;node_start integer;node_end integer;previous_end integer;shift_start integer;shift_end integer;
 block_start integer;block_end integer;cursor_minute integer;protected_minutes integer;travel integer;available_gap integer;
 committed_duty numeric;stop_effort numeric;stop_duration integer;route_count integer:=0;route_pass integer;baseline_travel integer;staged_stop_nodes jsonb;
 p_date date:=p_week;operation_date date;operation_day integer;raw_source jsonb;compiler_exceptions jsonb;
 baseline jsonb;candidate_version jsonb;original_rows jsonb;unaffected jsonb;expected_unaffected jsonb;physical_rows jsonb;
 assignment_links jsonb:='{}';original_assignment uuid;effective_work jsonb;effective_original jsonb;
 closing jsonb:=authority->'shiftEndDerivation';closing_result jsonb;closing_enabled boolean;parent_id text;raw_parent jsonb;is_open boolean;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 IF p_week IS NULL OR NOT isfinite(p_week) OR extract(isodow FROM p_week)<>1
  OR p_publication_id IS NULL OR jsonb_typeof(authority) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'Exact dated publication and Monday required';END IF;
 PERFORM public.static_weekly_assert_exact_object(authority,
  ARRAY['schema','effectiveDate','compilerInput','overlayCompilerInput','inputDigest','baselineInputDigest','derivedBaselineDigest','shiftEndDerivation','projectionAvailability','mapping','basisDigest','witnessDigest','solverInvoked','optimized','originalCompilerInput','originalWeekCompilerInput','weekDerivation','originalInputDigest','mappedBaselineInputDigest','originalPublicationId','originalVersionId','scopeDates','scopeDays','appliedExceptions'],
  ARRAY['schema','effectiveDate','compilerInput','overlayCompilerInput','inputDigest','baselineInputDigest','derivedBaselineDigest','shiftEndDerivation','projectionAvailability','mapping','basisDigest','witnessDigest','solverInvoked','optimized','originalCompilerInput','originalWeekCompilerInput','weekDerivation','originalInputDigest','mappedBaselineInputDigest','originalPublicationId','originalVersionId','scopeDates','scopeDays','appliedExceptions'],'approved dated authority');
 PERFORM public.static_weekly_assert_exact_object(p_envelope->'receipt',
  ARRAY['schema','feasibilityDigest','hardConstraintCount','hardConstraintDigest','independentDerivations','solverInvoked','optimized'],
  ARRAY['schema','feasibilityDigest','hardConstraintCount','hardConstraintDigest','independentDerivations','solverInvoked','optimized'],'approved dated receipt DATA');
 PERFORM public.static_weekly_assert_exact_object(p_envelope,
  ARRAY['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],
  ARRAY['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],'approved dated projection');
 IF jsonb_typeof(authority->'scopeDates') IS DISTINCT FROM 'array' OR jsonb_array_length(authority->'scopeDates')<>1
  OR jsonb_typeof(authority->'scopeDays') IS DISTINCT FROM 'array' OR jsonb_array_length(authority->'scopeDays')<>1
  OR coalesce(authority#>>'{scopeDates,0}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 THEN RAISE EXCEPTION 'Singleton dated operation scope required';END IF;
 operation_date:=(authority#>>'{scopeDates,0}')::date;operation_day:=extract(dow FROM operation_date)::integer;
 IF NOT isfinite(operation_date) OR operation_date NOT BETWEEN p_week AND p_week+6
  OR authority->'scopeDays' IS DISTINCT FROM jsonb_build_array(operation_day)
 THEN RAISE EXCEPTION 'Dated operation lies outside its original week';END IF;
 SELECT s.source_id,s.canonical_source,s.source_digest,v.draft_document,v.version_id INTO STRICT current_source
  FROM public.weekly_schedule_publications p JOIN public.weekly_schedule_versions v USING(version_id)
  JOIN public.static_weekly_authority_source_documents s ON s.source_id=v.authority_source_id
  WHERE p.publication_id=p_publication_id AND v.version_id=public.static_weekly_effective_version(p_week)
   AND v.version_id=public.static_weekly_effective_version(p_week+6) AND s.active AND s.retired_at IS NULL;
 v_source_id:=current_source.source_id;
 IF current_source.source_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(current_source.canonical_source)
 THEN RAISE EXCEPTION 'Dated registered Source differs';END IF;
 raw_source:=public.static_weekly_v3_read_publication_source(p_publication_id,p_week);
 live_source:=raw_source->'compiler_input';
 compiler_exceptions:=public.static_weekly_compiler_exception_set(p_publication_id,p_week);
 baseline:=authority->'compilerInput';closing_enabled:=live_source#>'{version,shiftEndContinuityPolicy}' IS NOT NULL;
 source:=CASE WHEN closing_enabled THEN closing->'mappedInput' ELSE authority->'overlayCompilerInput' END;
 IF jsonb_typeof(source->'slots') IS DISTINCT FROM 'array' OR jsonb_array_length(source->'slots') NOT BETWEEN 6 AND 32
  OR jsonb_typeof(source#>'{version,slotAvailability}') IS DISTINCT FROM 'array'
  OR jsonb_typeof(source#>'{version,assignments}') IS DISTINCT FROM 'array'
  OR jsonb_array_length(source#>'{version,assignments}') NOT BETWEEN 1 AND 4096
  OR (SELECT count(*) FROM jsonb_array_elements(source#>'{version,slotAvailability}'))<>7*jsonb_array_length(source->'slots')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(source->'slots') s CROSS JOIN generate_series(0,6) day(n)
   WHERE (SELECT count(*) FROM jsonb_array_elements(source#>'{version,slotAvailability}') a
    WHERE a->'slotId'=s->'id' AND a->'dayOfWeek'=to_jsonb(day.n))<>1)
 THEN RAISE EXCEPTION 'Dated bounded total seven-day slot Source required';END IF;
 IF p_exceptions IS DISTINCT FROM public.static_weekly_accepted_exception_set(p_publication_id,p_week)
  OR authority->'appliedExceptions' IS DISTINCT FROM p_exceptions OR p_envelope->'applied_exceptions' IS DISTINCT FROM p_exceptions
  OR authority->'originalCompilerInput' IS DISTINCT FROM jsonb_set(jsonb_set(live_source,'{serviceDate}',to_jsonb(operation_date::text),true),'{exceptions}',compiler_exceptions,true)
  OR authority->'originalWeekCompilerInput' IS DISTINCT FROM jsonb_set(CASE WHEN closing_enabled THEN closing->'originalDerivedInput' ELSE live_source END,'{exceptions}',compiler_exceptions,true)
  OR baseline IS DISTINCT FROM jsonb_set(live_source,'{exceptions}','[]'::jsonb,true)
  OR source->'exceptions' IS DISTINCT FROM compiler_exceptions
  OR source-'version'-'exceptions' IS DISTINCT FROM live_source-'version'-'exceptions'
  OR (source->'version')-'assignments' IS DISTINCT FROM (live_source->'version')-'assignments'
  OR authority->>'originalPublicationId' IS DISTINCT FROM p_publication_id::text
  OR authority->>'originalVersionId' IS DISTINCT FROM live_source#>>'{version,id}'
 THEN RAISE EXCEPTION 'Dated original Source publication version or complete exceptions differ';END IF;
 IF (closing_enabled AND closing->>'schema' IS DISTINCT FROM 'custodial.approved-static-dated-closing.v1')
  OR (NOT closing_enabled AND closing IS DISTINCT FROM 'null'::jsonb)
  OR source#>'{version,shiftEndDerivationApplied}' IS NOT NULL
 THEN RAISE EXCEPTION 'Dated closing requires its exact typed original/selected wrapper';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(compiler_exceptions) e
   WHERE e->>'type' NOT IN('pto','daily_absence','partial_absence','lunch','shift_override','event_impact','manager_correction','nine_forty_five_rebalance'))
 THEN RAISE EXCEPTION USING ERRCODE='0A000',MESSAGE='Unqualified approved dated work-changing exception profile';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(compiler_exceptions) e WHERE e->>'type' IN('pto','daily_absence')
  GROUP BY e->>'serviceDate',e#>>'{payload,slotId}' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'Dated duplicate full-day absence differs';END IF;
 SELECT c.owner_config INTO STRICT config FROM public.static_weekly_approved_template_source_configs c
  WHERE c.source_id=v_source_id AND c.config_digest=public.static_weekly_digest_jsonb(c.owner_config);
 IF config->>'schema' IS DISTINCT FROM 'custodial.owner-corrected-recurring-schedule.v2'
  OR jsonb_typeof(config->'slots') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Recurring typed owner configuration required';END IF;
 FOR owner_key,owner_config IN SELECT key,value FROM jsonb_each(config->'slots') LOOP
  IF owner_config ? 'normalAllowedFamilies' OR owner_config ? 'forbiddenFamilies'
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['normalAssignmentFamilies','hardForbiddenFamilies']) f
    WHERE owner_config ? f AND (jsonb_typeof(owner_config->f) IS DISTINCT FROM 'array'
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(owner_config->f) family WHERE jsonb_typeof(family)<>'string' OR family#>>'{}' !~ '^[A-Z0-9_]+$')
     OR (SELECT count(*) FROM jsonb_array_elements(owner_config->f))<>(SELECT count(DISTINCT family) FROM jsonb_array_elements(owner_config->f) family))) THEN
   RAISE EXCEPTION 'Recurring normal geography and hard exclusions require exact separate typed families';END IF;
  IF (owner_config->>'personId'='3da709bb-2223-4e15-8e3a-db02e3f32e97' AND (owner_key<>'KAREN' OR owner_config->>'slotId'<>'f22348e9-d4b9-5a7e-b8fd-d0d2c1ec534f'))
   OR (owner_config->>'personId'='cd97111e-cfa0-4228-b4d7-401bc7a5ac13' AND (owner_key<>'TAMMY' OR owner_config->>'slotId'<>'4a5a83ca-d297-5a30-8344-db08d05b978c'))
   OR (owner_config->>'personId'='30ec85e0-a579-45a8-9c27-c164e77a9190' AND (owner_key<>'KATHY' OR owner_config->>'slotId'<>'55e5939c-175c-5026-94fd-c4350d538922'))
   OR (owner_config->>'personId'='77d50e9a-6338-43b1-aed5-9f47d7129466' AND (owner_key<>'ALIJAH' OR owner_config->>'slotId'<>'36829381-70d7-521b-9f14-bad0af16ba87'
    OR owner_config->'hardForbiddenFamilies' IS DISTINCT FROM '["HERPETARIUM"]'::jsonb)) THEN
   RAISE EXCEPTION 'Recurring original personal geography identity or hard exclusion differs';END IF;
 END LOOP;

 SELECT * INTO STRICT entry FROM public.static_weekly_approved_template_catalog
  WHERE template_id=authority#>>'{mapping,templateId}' AND NOT EXISTS(
   SELECT 1 FROM public.static_weekly_approved_template_retirements r WHERE r.template_id=static_weekly_approved_template_catalog.template_id);
 IF entry.staffing_count NOT BETWEEN 6 AND 9 OR entry.owner_config IS DISTINCT FROM config
  OR entry.binding_json->>'patternAuthority' IS DISTINCT FROM 'OWNER_APPROVED_OPERATIONAL_PATTERN'
  OR entry.catalog_entry_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(jsonb_build_object(
   'template',entry.template_json,'binding',entry.binding_json,'ownerConfig',entry.owner_config,'approvalEvidence',entry.approval_evidence))
  OR authority#>>'{mapping,schema}' IS DISTINCT FROM 'custodial.approved-static-template-mapping.v1'
  OR authority#>>'{mapping,contract}' IS DISTINCT FROM 'FIXED_APPROVED_GEOMETRY_COMPATIBILITY_NOT_GLOBAL_OPTIMALITY'
  OR authority#>'{mapping,staffingCount}' IS DISTINCT FROM to_jsonb(entry.staffing_count)
  OR authority#>>'{mapping,serviceDate}' IS DISTINCT FROM operation_date::text
  OR authority#>'{mapping,scopeDays}' IS DISTINCT FROM jsonb_build_array(operation_day)
  OR authority#>'{mapping,solverInvoked}' IS DISTINCT FROM 'false'::jsonb
  OR authority#>'{mapping,admitted}' IS DISTINCT FROM 'false'::jsonb
  OR authority#>'{mapping,published}' IS DISTINCT FROM 'false'::jsonb
 THEN RAISE EXCEPTION 'Dated current approved template configuration or scope differs';END IF;
 approved_source:=entry.template_json->'source';
 IF jsonb_typeof(approved_source->'version') IS DISTINCT FROM 'object'
  OR approved_source->'exceptions' IS DISTINCT FROM '[]'::jsonb
  OR approved_source->'proximity' IS DISTINCT FROM live_source->'proximity'
  OR approved_source#>'{version,shiftEndContinuityPolicy}' IS DISTINCT FROM live_source#>'{version,shiftEndContinuityPolicy}'
  OR jsonb_typeof(authority#>'{mapping,slotMapping}') IS DISTINCT FROM 'array'
  OR jsonb_array_length(authority#>'{mapping,slotMapping}')<>entry.staffing_count
  OR jsonb_array_length(entry.template_json->'roleSlotIds')<>entry.staffing_count
  OR (SELECT count(DISTINCT r) FROM jsonb_array_elements(entry.template_json->'roleSlotIds') r)<>entry.staffing_count
  OR (SELECT count(DISTINCT m->>'patternSlotId') FROM jsonb_array_elements(authority#>'{mapping,slotMapping}') m)<>entry.staffing_count
  OR (SELECT count(DISTINCT m->>'actualSlotId') FROM jsonb_array_elements(authority#>'{mapping,slotMapping}') m)<>entry.staffing_count
  OR (SELECT count(DISTINCT m->>'actualPersonId') FROM jsonb_array_elements(authority#>'{mapping,slotMapping}') m)<>entry.staffing_count
 THEN RAISE EXCEPTION 'Dated bijection or original route policy differs';END IF;
 FOR mapping IN SELECT value FROM jsonb_array_elements(authority#>'{mapping,slotMapping}') LOOP
  PERFORM public.static_weekly_assert_exact_object(mapping,ARRAY['patternSlotId','actualSlotId','actualPersonId'],
   ARRAY['patternSlotId','actualSlotId','actualPersonId'],'dated role mapping');
  SELECT value INTO STRICT slot FROM jsonb_array_elements(live_source->'slots') WHERE value->'id'=mapping->'actualSlotId';
  SELECT value INTO STRICT incumbent FROM jsonb_array_elements(slot->'incumbencies')
   WHERE (value->>'effectiveStart')::date<=operation_date AND (value->>'effectiveEnd' IS NULL OR operation_date<(value->>'effectiveEnd')::date);
  IF NOT(entry.template_json->'roleSlotIds' ? (mapping->>'patternSlotId'))
   OR coalesce(slot->'contractorCapacity','false'::jsonb)<>'false'::jsonb
   OR incumbent->'personId' IS DISTINCT FROM mapping->'actualPersonId'
   OR NOT EXISTS(SELECT 1 FROM jsonb_each(config->'slots') c WHERE c.value->'slotId'=mapping->'actualSlotId'
    AND c.value->'personId'=mapping->'actualPersonId' AND c.value->'vacancy' IS DISTINCT FROM 'true'::jsonb)
  THEN RAISE EXCEPTION 'Dated role does not name actual operation-day employee';END IF;
  SELECT value INTO STRICT role_availability FROM jsonb_array_elements(approved_source#>'{version,slotAvailability}')
   WHERE value->'slotId'=mapping->'patternSlotId' AND value->>'dayOfWeek'=operation_day::text;
  SELECT value INTO STRICT actual_availability FROM jsonb_array_elements(live_source#>'{version,slotAvailability}')
   WHERE value->'slotId'=mapping->'actualSlotId' AND value->>'dayOfWeek'=operation_day::text;
  actual_availability:=public.static_weekly_approved_dated_effective_availability(actual_availability,mapping->>'actualSlotId',operation_date,compiler_exceptions);
  IF NOT(role_availability ? 'acceptedRoute') AND approved_source#>ARRAY['version','acceptedRoutesBySlot',mapping->>'patternSlotId'] IS NOT NULL THEN
   role_availability:=role_availability||jsonb_build_object('acceptedRoute',approved_source#>ARRAY['version','acceptedRoutesBySlot',mapping->>'patternSlotId']);END IF;
  IF NOT(actual_availability ? 'acceptedRoute') AND live_source#>ARRAY['version','acceptedRoutesBySlot',mapping->>'actualSlotId'] IS NOT NULL THEN
   actual_availability:=actual_availability||jsonb_build_object('acceptedRoute',live_source#>ARRAY['version','acceptedRoutesBySlot',mapping->>'actualSlotId']);END IF;
  SELECT jsonb_build_object('shift',a->'shift','lunch',a->'lunch','blocked',coalesce(a->'blockedWindows','[]'::jsonb),
   'service',coalesce(a->'maxServiceEffortMinutes',a->'maxLoadPoints'),'duty',coalesce(a->'maxDutyMinutes',a->'max_duty_minutes'),
   'route',a->'acceptedRoute','start',coalesce(a->'acceptedRouteStartLocationId',a->'acceptedRouteAnchorLocationId',a->'routeAnchorLocationId'),
   'stops',a->'acceptedRouteStops') INTO role_profile FROM(SELECT role_availability a)t;
  SELECT jsonb_build_object('shift',a->'shift','lunch',a->'lunch','blocked',coalesce(a->'blockedWindows','[]'::jsonb),
   'service',coalesce(a->'maxServiceEffortMinutes',a->'maxLoadPoints'),'duty',coalesce(a->'maxDutyMinutes',a->'max_duty_minutes'),
   'route',a->'acceptedRoute','start',coalesce(a->'acceptedRouteStartLocationId',a->'acceptedRouteAnchorLocationId',a->'routeAnchorLocationId'),
   'stops',a->'acceptedRouteStops') INTO actual_profile FROM(SELECT actual_availability a)t;
  IF role_profile IS DISTINCT FROM actual_profile OR actual_availability->>'status' IS DISTINCT FROM 'working'
  THEN RAISE EXCEPTION 'Dated current role availability route or duty profile differs';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(approved_source#>'{version,assignments}') w WHERE w->>'dayOfWeek'=operation_day::text
   AND (SELECT count(*) FROM jsonb_array_elements(authority#>'{mapping,slotMapping}') m WHERE m->'patternSlotId'=w->'ownerSlotId')<>1)
 THEN RAISE EXCEPTION 'Dated approved work has an unmapped role';END IF;
 SELECT coalesce(jsonb_agg(w ORDER BY (w->>'dayOfWeek')::integer,w->>'workId' COLLATE "C"),'[]') INTO original_rows
  FROM jsonb_array_elements(live_source#>'{version,assignments}') w WHERE w->>'dayOfWeek'<>operation_day::text;
 SELECT coalesce(jsonb_agg(w ORDER BY (w->>'dayOfWeek')::integer,w->>'workId' COLLATE "C"),'[]') INTO unaffected
  FROM jsonb_array_elements(source#>'{version,assignments}') w WHERE w->>'dayOfWeek'<>operation_day::text;
 SELECT coalesce(jsonb_agg(jsonb_set(w,'{ownerSlotId}',m->'actualSlotId') ORDER BY w->>'workId' COLLATE "C"),'[]') INTO mapped_rows
  FROM jsonb_array_elements(approved_source#>'{version,assignments}') w
  JOIN jsonb_array_elements(authority#>'{mapping,slotMapping}') m ON m->'patternSlotId'=w->'ownerSlotId' WHERE w->>'dayOfWeek'=operation_day::text;
 SELECT coalesce(jsonb_agg(w ORDER BY w->>'workId' COLLATE "C"),'[]') INTO expected_rows
  FROM jsonb_array_elements(source#>'{version,assignments}') w WHERE w->>'dayOfWeek'=operation_day::text;
 IF original_rows IS DISTINCT FROM unaffected OR mapped_rows IS DISTINCT FROM expected_rows OR jsonb_array_length(mapped_rows)=0
  OR (SELECT count(*) FROM jsonb_array_elements(source#>'{version,assignments}'))<>
   (SELECT count(DISTINCT (w->>'dayOfWeek',w->>'workId')) FROM jsonb_array_elements(source#>'{version,assignments}') w)
 THEN RAISE EXCEPTION 'Dated exact selected mapping or six unaffected day rows differ';END IF;
 effective_work:=public.static_weekly_approved_dated_effective_work(p_publication_id,p_week,source);
 effective_original:=public.static_weekly_approved_dated_effective_work(p_publication_id,p_week,
  jsonb_set(live_source,'{exceptions}',compiler_exceptions,true));
 IF EXISTS(WITH rows AS(
   SELECT 0 side,w FROM jsonb_array_elements(approved_source#>'{version,assignments}') w
   UNION ALL SELECT 1,w FROM jsonb_array_elements(live_source#>'{version,assignments}') w
  UNION ALL SELECT 2,w FROM jsonb_array_elements(current_source.canonical_source#>'{version,assignments}') w
  ), facts AS(SELECT side,w,jsonb_build_object('day',w->'dayOfWeek','family',w->'locationCodeSnapshot',
   'phase',CASE WHEN w#>>'{window,end}'='09:45' THEN '"morning"'::jsonb WHEN w#>>'{window,start}'='09:45' THEN '"equalized"'::jsonb ELSE w->'window' END,
   'mode',w->'serviceMode','scheduling',w->'schedulingMode','required',coalesce(w->'required','true'::jsonb),
   'priority',w->'priority','qualifications',w->'requiredQualifications','restrictions',w->'restrictions',
   'restrictedSlots',coalesce(w->'restrictedSlotIds','[]'::jsonb),'policy',w->'coveragePolicy','order',w->'coveragePolicyOrder') f FROM rows WHERE w->>'dayOfWeek'=operation_day::text),
  efforts AS(SELECT side,f,sum((w->>'serviceEffortMinutes')::numeric) effort FROM facts GROUP BY side,f),
  members AS(SELECT side,f,jsonb_agg(member ORDER BY member) members FROM facts CROSS JOIN LATERAL
   jsonb_array_elements(CASE WHEN jsonb_array_length(coalesce(w->'includedLocations','[]'::jsonb))>0 THEN w->'includedLocations'
    ELSE jsonb_build_array(jsonb_build_object('locationId',w->'locationId','locationNameSnapshot',w->'locationNameSnapshot')) END) member GROUP BY side,f),
  domain AS(SELECT side,f,effort,members FROM efforts JOIN members USING(side,f))
  (SELECT f,effort,members FROM domain WHERE side=0 EXCEPT ALL SELECT f,effort,members FROM domain WHERE side=1)
  UNION ALL(SELECT f,effort,members FROM domain WHERE side=1 EXCEPT ALL SELECT f,effort,members FROM domain WHERE side=0)
  UNION ALL(SELECT f,effort,members FROM domain WHERE side=1 EXCEPT ALL SELECT f,effort,members FROM domain WHERE side=2)
  UNION ALL(SELECT f,effort,members FROM domain WHERE side=2 EXCEPT ALL SELECT f,effort,members FROM domain WHERE side=1)) THEN
  RAISE EXCEPTION 'Dated approved physical responsibility multiset differs from current Source';END IF;
 -- The existing producer compares the approved physical domain against the
 -- EFFECTIVE current work, not just its raw baseline. Never let an event get
 -- dropped into a stale pattern; no hash or accepted-command label replaces
 -- this multiplicity/effort/eligibility check. A truly new domain needs an
 -- actual compatible approved producer/catalog entry before this can succeed.
 IF EXISTS(WITH rows AS(
   SELECT 0 side,w FROM jsonb_array_elements(approved_source#>'{version,assignments}') w
   UNION ALL SELECT 1,w FROM jsonb_array_elements(effective_original) w
   UNION ALL SELECT 2,w FROM jsonb_array_elements(effective_work) w
  ), facts AS(SELECT side,w,jsonb_build_object('day',w->'dayOfWeek','family',w->'locationCodeSnapshot',
   'phase',CASE WHEN w#>>'{window,end}'='09:45' THEN '"morning"'::jsonb WHEN w#>>'{window,start}'='09:45' THEN '"equalized"'::jsonb ELSE w->'window' END,
   'mode',w->'serviceMode','scheduling',w->'schedulingMode','required',coalesce(w->'required','true'::jsonb),
   'priority',w->'priority','qualifications',w->'requiredQualifications','restrictions',w->'restrictions',
   'restrictedSlots',coalesce(w->'restrictedSlotIds','[]'::jsonb),'policy',w->'coveragePolicy','order',w->'coveragePolicyOrder') f
   FROM rows WHERE w->>'dayOfWeek'=operation_day::text),
  efforts AS(SELECT side,f,sum((w->>'serviceEffortMinutes')::numeric) effort FROM facts GROUP BY side,f),
  members AS(SELECT side,f,jsonb_agg(member ORDER BY member) members FROM facts CROSS JOIN LATERAL
   jsonb_array_elements(CASE WHEN jsonb_array_length(coalesce(w->'includedLocations','[]'::jsonb))>0 THEN w->'includedLocations'
    ELSE jsonb_build_array(jsonb_build_object('locationId',w->'locationId','locationNameSnapshot',w->'locationNameSnapshot')) END) member GROUP BY side,f),
  domain AS(SELECT side,f,effort,members FROM efforts JOIN members USING(side,f))
  (SELECT f,effort,members FROM domain WHERE side=0 EXCEPT ALL SELECT f,effort,members FROM domain WHERE side=1)
  UNION ALL(SELECT f,effort,members FROM domain WHERE side=1 EXCEPT ALL SELECT f,effort,members FROM domain WHERE side=0)
  UNION ALL(SELECT f,effort,members FROM domain WHERE side=1 EXCEPT ALL SELECT f,effort,members FROM domain WHERE side=2)
  UNION ALL(SELECT f,effort,members FROM domain WHERE side=2 EXCEPT ALL SELECT f,effort,members FROM domain WHERE side=1))
 THEN RAISE EXCEPTION USING ERRCODE='0A000',MESSAGE='Dated accepted event requires a compatible approved physical domain';END IF;
 IF closing_enabled THEN
  closing_result:=public.static_weekly_approved_dated_assert_closing(closing,baseline,approved_source,config,authority->'mapping',operation_date);
  IF (authority->'overlayCompilerInput')-'version' IS DISTINCT FROM
    jsonb_set(closing_result->'effectiveInput','{exceptions}',compiler_exceptions,true)-'version'
   OR (authority#>'{overlayCompilerInput,version}')-'assignments' IS DISTINCT FROM (closing_result#>'{effectiveInput,version}')-'assignments'
   OR (SELECT jsonb_agg(w ORDER BY n) FROM jsonb_array_elements(authority#>'{overlayCompilerInput,version,assignments}') WITH ORDINALITY x(w,n) WHERE w->>'dayOfWeek'<>operation_day::text)
    IS DISTINCT FROM (SELECT jsonb_agg(w ORDER BY n) FROM jsonb_array_elements(closing#>'{originalDerivedInput,version,assignments}') WITH ORDINALITY x(w,n) WHERE w->>'dayOfWeek'<>operation_day::text)
   OR EXISTS((SELECT value FROM jsonb_array_elements(authority#>'{overlayCompilerInput,version,assignments}')
     EXCEPT ALL SELECT value FROM jsonb_array_elements(closing_result#>'{effectiveInput,version,assignments}'))
    UNION ALL(SELECT value FROM jsonb_array_elements(closing_result#>'{effectiveInput,version,assignments}')
     EXCEPT ALL SELECT value FROM jsonb_array_elements(authority#>'{overlayCompilerInput,version,assignments}')))
  THEN RAISE EXCEPTION 'Dated whole derived week differs from original six days plus selected chain';END IF;
  effective_work:=public.static_weekly_approved_dated_effective_work(p_publication_id,p_week,
   jsonb_set(closing_result->'effectiveInput','{exceptions}',compiler_exceptions,true));
  effective_original:=public.static_weekly_approved_dated_effective_work(p_publication_id,p_week,
   jsonb_set(closing->'originalDerivedInput','{exceptions}',compiler_exceptions,true));
 END IF;
 FOR availability IN SELECT value FROM jsonb_array_elements(source#>'{version,slotAvailability}') LOOP
  SELECT value INTO STRICT slot FROM jsonb_array_elements(source->'slots') WHERE value->>'id'=availability->>'slotId';
  IF NOT(availability ? 'acceptedRoute') AND source#>ARRAY['version','acceptedRoutesBySlot',slot->>'id'] IS NOT NULL THEN
   availability:=availability||jsonb_build_object('acceptedRoute',source#>ARRAY['version','acceptedRoutesBySlot',slot->>'id']);
  END IF;
  day:=(availability->>'dayOfWeek')::integer;d:=p_date+mod(day+6,7);
  availability:=public.static_weekly_approved_dated_effective_availability(availability,slot->>'id',d,compiler_exceptions);
  incumbent:=NULL;
  IF coalesce(slot->'contractorCapacity','false'::jsonb)='false'::jsonb THEN
   SELECT value INTO incumbent FROM jsonb_array_elements(slot->'incumbencies')
    WHERE (value->>'effectiveStart')::date<=d AND (value->>'effectiveEnd' IS NULL OR d<(value->>'effectiveEnd')::date);
   IF (SELECT count(*) FROM jsonb_array_elements(slot->'incumbencies')
     WHERE (value->>'effectiveStart')::date<=d AND (value->>'effectiveEnd' IS NULL OR d<(value->>'effectiveEnd')::date))>1 THEN
    RAISE EXCEPTION 'Dated dated incumbent is ambiguous';END IF;
  ELSIF availability->>'status'='working' THEN
   RAISE EXCEPTION 'Active contractor capacity is not an ordinary dated employee profile';END IF;
  projection_availability:=jsonb_build_object('dayOfWeek',day,'serviceDate',d::text)||availability||jsonb_build_object(
   'incumbentSlotId',slot->'id','incumbentSlotLabel',slot->'label',
   'incumbentPersonId',incumbent->'personId','incumbentName',incumbent->'displayName');
  IF slot->>'kind'='CONTRACTOR_CAPACITY' THEN
   IF slot->'capacityId' IS DISTINCT FROM slot->'id' OR slot->'incumbencies' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'Dated inactive capacity original identity differs';END IF;
   projection_availability:=projection_availability||jsonb_build_object('ownerKind','CONTRACTOR_CAPACITY','capacityId',slot->'id');
  END IF;
  expected_availability:=expected_availability||jsonb_build_array(projection_availability);
  roster:=roster||jsonb_build_array(projection_availability);
  IF coalesce(slot->'contractorCapacity','false'::jsonb)='true'::jsonb THEN CONTINUE;END IF;
  IF availability->>'status'='working' THEN
   working_count:=working_count+1;
   -- Only the selected day creates a new mapped employee choice. Preserve
   -- the six other days' actual dated snapshots, including prior/future
   -- incumbents; never reinterpret them as the operation-day employee.
   SELECT value INTO STRICT owner_config FROM jsonb_each(config->'slots')
    WHERE value->>'slotId'=slot->>'id' AND (d<>operation_date OR
     (value->>'personId'=incumbent->>'personId' AND value->'vacancy' IS DISTINCT FROM 'true'::jsonb));
   IF incumbent IS NULL OR (d=operation_date AND NOT EXISTS(SELECT 1 FROM public.employees e
    WHERE e.id=(incumbent->>'personId')::uuid AND e.active AND e.display_name=incumbent->>'displayName')) THEN
    RAISE EXCEPTION 'Dated mapped owner requires the exact active operation-day employee';END IF;
   PERFORM public.static_weekly_approved_dated_assert_window(availability->'shift','dated shift');
   PERFORM public.static_weekly_approved_dated_assert_window(availability->'lunch','dated lunch');
   -- Flexible responsibility is not an appointment. Fixed work and accepted
   -- stops instead share one independently reconstructed chronological route.
   route:=coalesce(availability->'acceptedRoute','{}'::jsonb);
   route_start:=coalesce(route->>'startLocationId',route->>'start_location_id',availability->>'acceptedRouteStartLocationId',
    availability->>'acceptedRouteAnchorLocationId',availability->>'routeAnchorLocationId');
   route_provenance:=coalesce(route->>'provenance',availability->>'acceptedRouteProvenance');
   stops:=coalesce(route->'stops',route->'existingStops',availability->'acceptedRouteStops','[]'::jsonb);
   IF jsonb_typeof(route) IS DISTINCT FROM 'object' OR jsonb_typeof(stops) IS DISTINCT FROM 'array'
    OR nullif(route_start,'') IS NULL OR nullif(route_provenance,'') IS NULL
    OR jsonb_typeof(coalesce(availability->'blockedWindows','[]'::jsonb)) IS DISTINCT FROM 'array'
    OR nullif(availability->>'productiveCapacityProvenance','') IS NULL
    OR nullif(availability->>'maxServiceEffortProvenance','') IS NULL
    OR nullif(availability->>'qualificationProvenance','') IS NULL
    OR nullif(availability->>'restrictionProvenance','') IS NULL
    OR jsonb_typeof(availability->'qualifications') IS DISTINCT FROM 'array'
    OR jsonb_typeof(availability->'restrictions') IS DISTINCT FROM 'array'
    OR availability#>>'{lunch,start}'<availability#>>'{shift,start}'
    OR availability#>>'{lunch,end}'>availability#>>'{shift,end}' THEN
    RAISE EXCEPTION 'Dated current duty route and eligibility provenance invalid';END IF;
   shift_start:=extract(epoch FROM (availability#>>'{shift,start}')::time)::integer/60;
   shift_end:=extract(epoch FROM (availability#>>'{shift,end}')::time)::integer/60;
   protected_windows:=coalesce(availability->'blockedWindows','[]'::jsonb)||jsonb_build_array(availability->'lunch');
   FOR blocked IN SELECT value FROM jsonb_array_elements(protected_windows) LOOP
    PERFORM public.static_weekly_approved_dated_assert_window(blocked,'dated protected interval');
   END LOOP;
   -- Union clipped lunch/blocked intervals: overlaps are not double charged.
   cursor_minute:=shift_start;protected_minutes:=0;
   FOR blocked IN SELECT value FROM jsonb_array_elements(protected_windows) ORDER BY value->>'start',value->>'end' LOOP
    block_start:=greatest(shift_start,extract(epoch FROM (blocked->>'start')::time)::integer/60);
    block_end:=least(shift_end,extract(epoch FROM (blocked->>'end')::time)::integer/60);
    IF block_end>greatest(cursor_minute,block_start) THEN
     protected_minutes:=protected_minutes+block_end-greatest(cursor_minute,block_start);cursor_minute:=block_end;
    END IF;
   END LOOP;
   productive:=shift_end-shift_start-protected_minutes;
   duty:=coalesce((availability->>'maxDutyMinutes')::numeric,(availability->>'max_duty_minutes')::numeric,productive);
   IF productive<=0 OR duty<=0 OR duty>productive OR duty<>trunc(duty)
    OR ((availability ? 'maxDutyMinutes' OR availability ? 'max_duty_minutes')
     AND nullif(coalesce(availability->>'maxDutyProvenance',availability->>'max_duty_provenance'),'') IS NULL)
    OR jsonb_typeof(availability->'maxServiceEffortMinutes') IS DISTINCT FROM 'number'
    OR (availability->>'maxServiceEffortMinutes')::numeric<=0
    OR (availability->>'maxServiceEffortMinutes')::numeric<>trunc((availability->>'maxServiceEffortMinutes')::numeric) THEN
    RAISE EXCEPTION 'Dated independent duty or workload capacity invalid';END IF;
   nodes:='[]'::jsonb;stop_effort:=0;committed_duty:=0;
   FOR stop IN SELECT value FROM jsonb_array_elements(stops) LOOP
    PERFORM public.static_weekly_v3_assert_window(stop->'window','dated accepted stop');
    node_start:=extract(epoch FROM (stop#>>'{window,start}')::time)::integer/60;
    node_end:=extract(epoch FROM (stop#>>'{window,end}')::time)::integer/60;
    stop_duration:=node_end-node_start;
    IF nullif(coalesce(stop->>'locationId',stop->>'location'),'') IS NULL
     OR nullif(coalesce(stop->>'provenance',route_provenance),'') IS NULL
     OR nullif(coalesce(stop->>'serviceEffortProvenance',stop->>'service_effort_provenance',stop->>'provenance',route_provenance),'') IS NULL
     OR node_start<shift_start OR node_end>shift_end
     OR coalesce((stop->>'serviceEffortMinutes')::numeric,(stop->>'service_effort_minutes')::numeric,stop_duration)<=0
     OR coalesce((stop->>'serviceEffortMinutes')::numeric,(stop->>'service_effort_minutes')::numeric,stop_duration)>stop_duration
     OR coalesce((stop->>'serviceEffortMinutes')::numeric,(stop->>'service_effort_minutes')::numeric,stop_duration)<>
      trunc(coalesce((stop->>'serviceEffortMinutes')::numeric,(stop->>'service_effort_minutes')::numeric,stop_duration)) THEN
     RAISE EXCEPTION 'Dated accepted stop window effort or provenance invalid';END IF;
    stop_effort:=stop_effort+coalesce((stop->>'serviceEffortMinutes')::numeric,(stop->>'service_effort_minutes')::numeric,stop_duration);
    nodes:=nodes||jsonb_build_array(jsonb_build_object('start',node_start,'end',node_end,'location',coalesce(stop->>'locationId',stop->>'location')));
   END LOOP;
   staged_stop_nodes:=nodes;
   FOR route_pass IN 1..2 LOOP
   nodes:=staged_stop_nodes;baseline_travel:=0;committed_duty:=0;
   IF route_pass=2 THEN
    FOR work IN SELECT value FROM jsonb_array_elements(effective_work)
     WHERE value->'ownerSlotId'=slot->'id' AND value->>'dayOfWeek'=day::text AND NOT(value ? 'schedulingMode') LOOP
     PERFORM public.static_weekly_v3_assert_window(work->'window','dated fixed appointment');
     nodes:=nodes||jsonb_build_array(jsonb_build_object('start',extract(epoch FROM (work#>>'{window,start}')::time)::integer/60,
      'end',extract(epoch FROM (work#>>'{window,end}')::time)::integer/60,'location',work->>'locationId'));
    END LOOP;
   END IF;
   previous_end:=shift_start;previous_node:=jsonb_build_object('location',route_start);
   FOR node IN SELECT value FROM jsonb_array_elements(nodes) ORDER BY (value->>'start')::integer,(value->>'end')::integer,value->>'location' COLLATE "C" LOOP
    node_start:=(node->>'start')::integer;node_end:=(node->>'end')::integer;
    IF node_start<previous_end OR node_start<shift_start OR node_end>shift_end
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(protected_windows) b
      WHERE extract(epoch FROM (b->>'start')::time)/60<node_end AND extract(epoch FROM (b->>'end')::time)/60>node_start) THEN
     RAISE EXCEPTION 'Dated fixed route overlaps another node lunch blocked interval or shift';END IF;
    travel:=NULL;
    IF previous_node->'location'=node->'location' THEN travel:=0;
    ELSE SELECT min((e->>'minutes')::integer) INTO travel FROM jsonb_array_elements(source->'proximity') e
     WHERE ((e->>'fromLocationId'=previous_node->>'location' AND e->>'toLocationId'=node->>'location')
      OR ((e->'bidirectional'='true'::jsonb OR e->'symmetric'='true'::jsonb)
       AND e->>'toLocationId'=previous_node->>'location' AND e->>'fromLocationId'=node->>'location'))
      AND e->'verified'='true'::jsonb AND jsonb_typeof(e->'minutes')='number'
      AND (e->>'minutes')::numeric>0 AND (e->>'minutes')::numeric=trunc((e->>'minutes')::numeric)
      AND nullif(e->>'provenance','') IS NOT NULL;
    END IF;
    cursor_minute:=previous_end;protected_minutes:=0;available_gap:=0;
    FOR blocked IN SELECT value FROM jsonb_array_elements(protected_windows) ORDER BY value->>'start',value->>'end' LOOP
     block_start:=greatest(previous_end,extract(epoch FROM (blocked->>'start')::time)::integer/60);
     block_end:=least(node_start,extract(epoch FROM (blocked->>'end')::time)::integer/60);
     IF block_end>block_start THEN
      available_gap:=greatest(available_gap,block_start-cursor_minute);
      protected_minutes:=protected_minutes+greatest(0,block_end-greatest(cursor_minute,block_start));
      cursor_minute:=greatest(cursor_minute,block_end);
     END IF;
    END LOOP;
    available_gap:=greatest(available_gap,node_start-cursor_minute);
    IF travel IS NULL OR (route_pass=1 AND node_start-previous_end<travel) OR (route_pass=2 AND available_gap<travel) THEN
     RAISE EXCEPTION 'Dated fixed route has no contiguous protected-safe directed transit';END IF;
    baseline_travel:=baseline_travel+travel;
    committed_duty:=committed_duty+node_end-node_start+travel+greatest(0,node_start-previous_end-travel-protected_minutes);
    previous_end:=node_end;previous_node:=node;
   END LOOP;
   IF route_pass=1 AND stop_effort+baseline_travel>productive THEN RAISE EXCEPTION 'Dated immutable accepted route baseline exceeds productive capacity';END IF;
   IF route_pass=2 AND committed_duty>duty THEN RAISE EXCEPTION 'Dated fixed service travel and committed waiting exceed duty capacity';END IF;
   END LOOP;
   route_count:=route_count+jsonb_array_length(stops);
   SELECT coalesce(sum((w->>'serviceEffortMinutes')::numeric),0) INTO effort
    FROM jsonb_array_elements(effective_work) w
    WHERE w->>'ownerSlotId'=slot->>'id' AND w->>'dayOfWeek'=day::text;
   IF effort+stop_effort>(availability->>'maxServiceEffortMinutes')::numeric THEN RAISE EXCEPTION 'Dated hard workload capacity including original stops exceeded';END IF;
  END IF;
 END LOOP;

 IF EXISTS((SELECT value FROM jsonb_array_elements(expected_availability) EXCEPT ALL SELECT value FROM jsonb_array_elements(authority->'projectionAvailability'))
  UNION ALL(SELECT value FROM jsonb_array_elements(authority->'projectionAvailability') EXCEPT ALL SELECT value FROM jsonb_array_elements(expected_availability)))
 THEN RAISE EXCEPTION 'Dated independently reconstructed full-week availability differs';END IF;
 SELECT count(*) INTO employee_count FROM jsonb_array_elements(roster) r WHERE r->>'serviceDate'=operation_date::text
  AND r->>'status'='working' AND r->>'incumbentPersonId' IS NOT NULL AND r->>'ownerKind' IS DISTINCT FROM 'CONTRACTOR_CAPACITY';
 IF employee_count<>entry.staffing_count OR EXISTS(SELECT 1 FROM jsonb_array_elements(roster) r
  WHERE r->>'serviceDate'=operation_date::text AND r->>'status'='working' AND r->>'incumbentPersonId' IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(authority#>'{mapping,slotMapping}') m
   WHERE m->'actualSlotId'=r->'slotId' AND m->'actualPersonId'=r->'incumbentPersonId'))
 THEN RAISE EXCEPTION 'Dated template must account for every current available operation-day employee';END IF;
 FOR work IN SELECT value FROM jsonb_array_elements(effective_work) LOOP
  day:=(work->>'dayOfWeek')::integer;
  SELECT value INTO STRICT person FROM jsonb_array_elements(roster) WHERE value->'slotId'=work->'ownerSlotId' AND value->>'dayOfWeek'=day::text;
  is_open:=closing_enabled AND person->>'status'='vacant_unfilled' AND person->>'incumbentPersonId' IS NULL
   AND position(':open:' in work->>'workId')>0;
  SELECT value INTO STRICT owner_config FROM jsonb_each(config->'slots') WHERE value->'slotId'=work->'ownerSlotId'
   AND (p_date+mod(day+6,7)<>operation_date OR value->'personId'=person->'incumbentPersonId'
    OR (is_open AND value->'vacancy'='true'::jsonb AND value->>'personId' IS NULL));
  PERFORM public.static_weekly_v3_assert_window(work->'window','dated independently derived work');
  IF (work ? 'schedulingMode' AND work->'schedulingMode' IS DISTINCT FROM '"flexible_coverage_ownership"'::jsonb)
   OR (NOT is_open AND (person->>'status' IS DISTINCT FROM 'working' OR person->>'incumbentPersonId' IS NULL))
   OR jsonb_typeof(work->'serviceEffortMinutes') IS DISTINCT FROM 'number'
   OR jsonb_typeof(work->'requiredQualifications') IS DISTINCT FROM 'array'
   OR jsonb_typeof(work->'restrictions') IS DISTINCT FROM 'array'
   OR nullif(work->>'qualificationProvenance','') IS NULL OR nullif(work->>'restrictionProvenance','') IS NULL
   OR (coalesce(work->'required','true'::jsonb) NOT IN('true'::jsonb,'false'::jsonb))
   OR (coalesce(work->'required','true'::jsonb)='true'::jsonb AND (jsonb_typeof(work->'priority') IS DISTINCT FROM 'number'
    OR (work->>'priority')::numeric<>trunc((work->>'priority')::numeric) OR nullif(work->>'priorityProvenance','') IS NULL))
   OR (work->>'serviceEffortMinutes')::numeric<=0 OR (work->>'serviceEffortMinutes')::numeric<>trunc((work->>'serviceEffortMinutes')::numeric)
   OR nullif(work->>'serviceEffortProvenance','') IS NULL
   OR (NOT(work ? 'schedulingMode') AND (work->>'serviceEffortMinutes')::numeric>
    extract(epoch FROM ((work#>>'{window,end}')::time-(work#>>'{window,start}')::time))/60)
   OR work#>>'{window,start}'<person#>>'{shift,start}' OR work#>>'{window,end}'>person#>>'{shift,end}'
   OR NOT(person->'qualifications' @> coalesce(work->'requiredQualifications','[]'::jsonb))
   OR coalesce(work->'restrictedSlotIds','[]'::jsonb) ? (work->>'ownerSlotId')
   OR coalesce(owner_config->'hardForbiddenFamilies','[]'::jsonb) ? (work->>'locationCodeSnapshot')
   OR (person->'restrictions') ? (work->>'locationId')
   OR (work->'_datedManualLock'<>'null'::jsonb AND work->'ownerSlotId' IS DISTINCT FROM work->'_datedManualLock')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(work->'includedLocations','[]'::jsonb)) l WHERE (person->'restrictions') ? (l->>'locationId')) THEN
   RAISE EXCEPTION 'Dated independent fixed owner eligibility or work window differs';END IF;
  route_start:=coalesce(person#>>'{acceptedRoute,startLocationId}',person#>>'{acceptedRoute,start_location_id}',person->>'acceptedRouteStartLocationId',
   person->>'acceptedRouteAnchorLocationId',person->>'routeAnchorLocationId');
  IF work->>'schedulingMode'='flexible_coverage_ownership' AND work->>'serviceMode'<>'reminder_only' AND route_start IS DISTINCT FROM work->>'locationId'
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source->'proximity') edge
    WHERE ((edge->>'fromLocationId'=route_start AND edge->>'toLocationId'=work->>'locationId')
     OR ((edge->'bidirectional'='true'::jsonb OR edge->'symmetric'='true'::jsonb) AND edge->>'toLocationId'=route_start AND edge->>'fromLocationId'=work->>'locationId'))
     AND edge->'verified'='true'::jsonb AND jsonb_typeof(edge->'minutes')='number'
     AND (edge->>'minutes')::numeric>=0 AND (edge->>'minutes')::numeric=trunc((edge->>'minutes')::numeric)
     AND nullif(edge->>'provenance','') IS NOT NULL) THEN
   RAISE EXCEPTION 'Dated fixed flexible area lacks exact verified directed geography';END IF;
  IF (person->>'incumbentPersonId',person->>'slotId') IN(
    ('3da709bb-2223-4e15-8e3a-db02e3f32e97','f22348e9-d4b9-5a7e-b8fd-d0d2c1ec534f'),
    ('cd97111e-cfa0-4228-b4d7-401bc7a5ac13','4a5a83ca-d297-5a30-8344-db08d05b978c'),
    ('30ec85e0-a579-45a8-9c27-c164e77a9190','55e5939c-175c-5026-94fd-c4350d538922'))
   AND NOT(coalesce(owner_config->'normalAssignmentFamilies','[]'::jsonb) ? (work->>'locationCodeSnapshot')) THEN
   RAISE EXCEPTION 'Dated original personal geography differs';END IF;
  SELECT value INTO baseline_person FROM jsonb_array_elements(roster) WHERE value->'slotId'=work->'originSlotId' AND value->>'dayOfWeek'=day::text;
  d:=p_date+mod(day+6,7);identity_key:=day::text||':'||(work->>'workId');
  IF is_open THEN work:=work||'{"required":false,"priority":0}'::jsonb;END IF;
  normalized_work:=jsonb_build_object('workId',work->'workId','dayOfWeek',day,'originSlotId',work->'originSlotId',
   'locationId',work->'locationId','locationCodeSnapshot',work->'locationCodeSnapshot','locationNameSnapshot',work->'locationNameSnapshot',
   'serviceMode',work->'serviceMode','includedLocations',work->'includedLocations','window',work->'window',
   'serviceEffortMinutes',work->'serviceEffortMinutes','serviceEffortProvenance',work->'serviceEffortProvenance',
   'priority',CASE WHEN work->'required'='false'::jsonb THEN '0'::jsonb ELSE work->'priority' END,
   'priorityProvenance',work->'priorityProvenance','required',coalesce(work->'required','true'::jsonb),
   'coveragePolicy',work->'coveragePolicy','bestEffortCoverage',coalesce(work->'required'='false'::jsonb,false) AND
    (coalesce(work->'coveragePolicy'='"best_effort"'::jsonb,false) OR coalesce(work->'bestEffortCoverage'='true'::jsonb,false)),
   'coveragePolicyOrder',CASE WHEN work->'required'='false'::jsonb AND
    (work->>'coveragePolicy'='best_effort' OR work->'bestEffortCoverage'='true'::jsonb) THEN coalesce(work->'coveragePolicyOrder','1'::jsonb) ELSE 'null'::jsonb END,
   'coveragePolicyProvenance',work->'coveragePolicyProvenance',
   'requiredQualifications',coalesce(work->'requiredQualifications','[]'::jsonb),'qualificationProvenance',work->'qualificationProvenance',
   'restrictions',coalesce(work->'restrictions','[]'::jsonb),'restrictionProvenance',work->'restrictionProvenance',
   'restrictedSlotIds',coalesce(work->'restrictedSlotIds','[]'::jsonb),'manualLock',work->'_datedManualLock'<>'null'::jsonb,
   'manualLockSlotId',work->'_datedManualLock','overlayWork',work->'_datedOverlayWork');
  expected_projection:=expected_projection||jsonb_build_array(jsonb_build_object('plan_work_id',identity_key,'work_id',work->'workId',
   'day_of_week',day,'service_date',d::text,'status',CASE WHEN is_open THEN 'open' ELSE 'assigned' END,'reason_code',CASE WHEN is_open THEN 'permitted_open' ELSE NULL END,
   'owner_slot_id',CASE WHEN is_open THEN NULL ELSE work->'ownerSlotId' END,'owner_person_id',person->'incumbentPersonId',
   'owner_digest',public.static_weekly_digest_jsonb(jsonb_build_object('planWorkId',identity_key,'slotId',CASE WHEN is_open THEN NULL ELSE work->'ownerSlotId' END,'personId',person->'incumbentPersonId','serviceDate',d::text)),
   'exact_owner_identity',public.static_weekly_digest_jsonb(jsonb_build_object('plan_work_id',identity_key,'service_date',d::text,
    'optimized_owner_slot_id',CASE WHEN is_open THEN NULL ELSE work->'ownerSlotId' END,'optimized_owner_person_id',person->'incumbentPersonId',
    'baseline_owner_slot_id',work->'originSlotId','baseline_owner_person_id',baseline_person->'incumbentPersonId')),
   'baseline_owner_slot_id',work->'originSlotId','baseline_owner_person_id',baseline_person->'incumbentPersonId','baseline_owner_name',baseline_person->'incumbentName',
   'original_actor_person_id',baseline_person->'incumbentPersonId','original_actor_name',baseline_person->'incumbentName',
   'optimized_owner_slot_id',CASE WHEN is_open THEN NULL ELSE work->'ownerSlotId' END,'optimized_owner_person_id',person->'incumbentPersonId','work_snapshot',normalized_work,
   'explanation',jsonb_build_object('contract','fixed_approved_pattern','hardConstraints','satisfied','reasons',CASE WHEN is_open THEN '[{"code":"permitted_open"}]'::jsonb ELSE '[]'::jsonb END)));
 END LOOP;

 IF EXISTS((SELECT value FROM jsonb_array_elements(expected_projection) EXCEPT ALL SELECT value FROM jsonb_array_elements(p_envelope->'assignments'))
  UNION ALL(SELECT value FROM jsonb_array_elements(p_envelope->'assignments') EXCEPT ALL SELECT value FROM jsonb_array_elements(expected_projection)))
  OR jsonb_array_length(expected_projection)=0 THEN RAISE EXCEPTION 'Dated exact independently derived relational rows differ';END IF;
 -- A work ID alone is not a physical parent. Keep actual stored links only
 -- for an exact original parent (owner substitution alone is allowed).
 -- Selected-day regrouping has NO fabricated one-to-one original assignment.
 FOR work IN SELECT value FROM jsonb_array_elements(effective_work) LOOP
  day:=(work->>'dayOfWeek')::integer;identity_key:=day::text||':'||(work->>'workId');original_assignment:=NULL;
  IF closing_enabled THEN
   IF day=operation_day THEN
    parent_id:=closing_result#>>ARRAY['selectedParentLinks',identity_key];
    SELECT value->'originalParent' INTO STRICT raw_parent FROM jsonb_array_elements(closing#>'{selected,parentReferences}')
     WHERE value->>'parentWorkId'=parent_id;
   ELSE
    SELECT c->>'parentWorkId' INTO STRICT parent_id FROM jsonb_array_elements(closing#>'{originalReceipt,parentChains}') c
     WHERE c->>'dayOfWeek'=day::text AND EXISTS(SELECT 1 FROM jsonb_array_elements(c->'segments') s WHERE s->'workId'=work->'workId');
    SELECT value INTO STRICT raw_parent FROM jsonb_array_elements(live_source#>'{version,assignments}')
     WHERE value->>'dayOfWeek'=day::text AND value->>'workId'=parent_id;
   END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(live_source#>'{version,assignments}') original
    WHERE original->>'dayOfWeek'=day::text AND original->>'workId'=parent_id AND original-'ownerSlotId'=raw_parent-'ownerSlotId') THEN
    SELECT assignment_id INTO STRICT original_assignment FROM public.weekly_schedule_slot_assignments
     WHERE version_id=current_source.version_id AND day_of_week=day AND work_id=parent_id;
   ELSIF day<>operation_day THEN RAISE EXCEPTION 'Dated closing unaffected original parent link differs';END IF;
  ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(effective_original) original
   WHERE original->'dayOfWeek'=work->'dayOfWeek' AND original->'workId'=work->'workId'
    AND original-'ownerSlotId'=work-'ownerSlotId') THEN
   -- An accepted event addition has an immutable command origin, not a
   -- fabricated stored baseline assignment; patches keep their actual parent.
   IF work->'_datedOverlayWork'='false'::jsonb THEN
    SELECT assignment_id INTO STRICT original_assignment FROM public.weekly_schedule_slot_assignments
     WHERE version_id=current_source.version_id AND day_of_week=day AND work_id=work->>'workId';
   END IF;
  ELSIF day<>operation_day THEN RAISE EXCEPTION 'Dated unaffected original parent link differs';END IF;
  assignment_links:=assignment_links||jsonb_build_object(identity_key,original_assignment);
 END LOOP;
 IF p_envelope->'adapter' IS DISTINCT FROM '{"schema":"custodial.approved-static-dated-adapter.v1","version":"approved-static-dated-v1"}'::jsonb
  OR p_envelope->>'service_date' IS DISTINCT FROM p_week::text OR p_envelope->>'week_start' IS DISTINCT FROM p_week::text
  OR p_envelope->>'week_end' IS DISTINCT FROM (p_week+6)::text
  OR p_envelope->>'compiler_version' IS DISTINCT FROM 'approved-static-dated-v1'
  OR p_envelope->'objective' IS DISTINCT FROM '{"contract":"FIXED_APPROVED_PATTERN_NOT_OPTIMALITY"}'::jsonb
  OR authority->>'schema' IS DISTINCT FROM 'custodial.approved-static-authority.v1'
  OR authority->>'effectiveDate' IS DISTINCT FROM p_week::text
  OR authority->'solverInvoked' IS DISTINCT FROM 'false'::jsonb OR authority->'optimized' IS DISTINCT FROM 'false'::jsonb
  OR authority ? 'optimizerResult'
  OR authority->>'baselineInputDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(baseline)
  OR authority->>'mappedBaselineInputDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(jsonb_set(source,'{exceptions}','[]'::jsonb))
  OR authority->>'derivedBaselineDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(CASE WHEN closing_enabled THEN closing->'originalDerivedInput' ELSE baseline END)
  OR authority->>'inputDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(source)
  OR authority->>'originalInputDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(authority->'originalWeekCompilerInput')
  OR p_envelope->>'authority_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(authority)
  OR p_envelope->>'database_projection_identity' IS DISTINCT FROM public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
  OR authority->'weekDerivation' IS DISTINCT FROM jsonb_build_object(
   'schema','custodial.approved-static-dated-week-derivation.v1','operationDate',operation_date::text,
   'weekStart',p_week::text,'weekEnd',(p_week+6)::text,'originalSourceDigest',public.static_weekly_digest_jsonb(authority->'originalCompilerInput'),
   'originalWeekInputDigest',authority->'originalInputDigest','mappedWeekInputDigest',authority->'inputDigest')
  OR p_envelope->'semantic_snapshot' IS DISTINCT FROM jsonb_build_object(
   'schema','custodial.approved-static-dated-projection-snapshot.v1','sourcePublicationId',p_publication_id::text,
   'sourceVersionId',live_source#>>'{version,id}','serviceDate',operation_date::text,'weekStart',p_week::text,'weekEnd',(p_week+6)::text,
   'sourceDigest',public.static_weekly_digest_jsonb(authority->'originalCompilerInput'),
   'feasibilityDigest',p_envelope#>'{receipt,feasibilityDigest}','original_baseline_digest',authority->'baselineInputDigest',
   'applied_exceptions_digest',public.static_weekly_digest_jsonb(p_exceptions))
  OR p_envelope#>>'{receipt,schema}' IS DISTINCT FROM 'custodial.approved-static-feasibility-receipt.v1'
  OR p_envelope#>'{receipt,independentDerivations}' IS DISTINCT FROM '2'::jsonb
  OR p_envelope#>'{receipt,solverInvoked}' IS DISTINCT FROM 'false'::jsonb OR p_envelope#>'{receipt,optimized}' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(p_envelope#>'{receipt,hardConstraintCount}') IS DISTINCT FROM 'number'
  OR (p_envelope#>>'{receipt,hardConstraintCount}')::numeric NOT BETWEEN jsonb_array_length(expected_projection) AND 100000
  OR (p_envelope#>>'{receipt,hardConstraintCount}')::numeric<>trunc((p_envelope#>>'{receipt,hardConstraintCount}')::numeric)
  OR p_envelope->'metrics' IS DISTINCT FROM jsonb_build_object('hardConstraints',p_envelope#>'{receipt,hardConstraintCount}','violations',0)
 THEN RAISE EXCEPTION 'Dated envelope identities or fixed semantics differ';END IF;
 RETURN jsonb_build_object('source_id',v_source_id,'projection_assignments',expected_projection,
  'assignment_links',assignment_links,'staffing_count',employee_count,'operation_date',operation_date,'version_id',current_source.version_id);
END $validation$;

-- Independently derive the existing lunch algorithm from the accepted rows.
-- Fixed closed ID preimages below use JSON string primitives, not a generic
-- JSON canonicalizer or a caller digest. No notification is enqueued here.
CREATE FUNCTION public.static_weekly_assert_approved_dated_lunch(p_projection uuid,p_document jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $lunch$
DECLARE projection public.weekly_schedule_compiled_projections%rowtype;source jsonb;loan jsonb;areas jsonb;effective_work jsonb;
 area jsonb;helper jsonb;target text;edge record;evidence jsonb;cost integer;costs jsonb;eligible text[];pair text[];
 best jsonb;states jsonb;next_states jsonb;state jsonb;candidate jsonb;old jsonb;mask integer;new_mask integer;i integer;j integer;k integer;
 required integer;helper_id text;selected text;expected_id text;area_text text;owners jsonb;responsibility jsonb;intent jsonb;
 expected_responsibilities jsonb:='[]';expected_notifications jsonb:='[]';pair_sets jsonb;pair_item jsonb;pair_count integer;
BEGIN
 PERFORM public.static_weekly_v8_assert_lunch_document(p_projection,p_document);
 SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_projection;
 source:=projection.projection_envelope#>'{authority,overlayCompilerInput}';
 effective_work:=public.static_weekly_approved_dated_effective_work(projection.publication_id,projection.week_start,source);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(projection.projection_envelope->'assignments') a
  WHERE a->>'plan_work_id'!~'^[ -~]+$')
 THEN RAISE EXCEPTION USING ERRCODE='0A000',MESSAGE='Unqualified dated lunch work identity collation';END IF;
 FOR loan IN SELECT value FROM jsonb_array_elements(p_document->'loans') LOOP
  -- The exact six primitive fields used by the existing lunch producer.
  expected_id:=public.static_weekly_digest_text('{"end":'||to_jsonb(loan->>'coverage_end')::text||
   ',"input":'||to_jsonb(projection.projection_envelope#>>'{authority,inputDigest}')::text||
   ',"ownerSlotId":'||to_jsonb(loan->>'normal_owner_slot_id')::text||
   ',"policy":"owner-20260921-two-nearby-full-hour-v1","serviceDate":'||to_jsonb(loan->>'service_date')::text||
   ',"start":'||to_jsonb(loan->>'coverage_start')::text||'}');
  IF loan->>'loan_id' IS DISTINCT FROM expected_id THEN RAISE EXCEPTION 'Dated original lunch loan identity differs';END IF;
  WITH RECURSIVE base AS(
   SELECT a,extract(epoch FROM greatest((a#>>'{work_snapshot,window,start}')::time,(loan->>'coverage_start')::time))::integer/60 s,
    extract(epoch FROM least((a#>>'{work_snapshot,window,end}')::time,(loan->>'coverage_end')::time))::integer/60 e
   FROM jsonb_array_elements(projection.projection_envelope->'assignments') a
   JOIN jsonb_array_elements(effective_work) w ON w->>'workId'=a->>'work_id' AND w->'dayOfWeek'=a->'day_of_week'
   WHERE a->>'service_date'=loan->>'service_date' AND a->'owner_slot_id'=loan->'normal_owner_slot_id'
    AND a->>'status'='assigned' AND w->>'schedulingMode'='flexible_coverage_ownership' AND w->>'serviceMode'<>'reminder_only'
    AND (a#>>'{work_snapshot,window,start}')::time<(loan->>'coverage_end')::time
    AND (loan->>'coverage_start')::time<(a#>>'{work_snapshot,window,end}')::time
  ), reach(root,key) AS(
   SELECT a->>'plan_work_id',a->>'plan_work_id' FROM base
   UNION SELECT reach.root,b.a->>'plan_work_id' FROM reach JOIN base x ON x.a->>'plan_work_id'=reach.key
   JOIN base b ON EXISTS(SELECT 1 FROM jsonb_array_elements(x.a#>'{work_snapshot,includedLocations}') l
    JOIN jsonb_array_elements(b.a#>'{work_snapshot,includedLocations}') r ON l->'locationId'=r->'locationId')
  ), groups AS(SELECT key,min(root COLLATE "C") root FROM reach GROUP BY key), parts AS(
   SELECT root,jsonb_agg(a ORDER BY a->>'plan_work_id' COLLATE "C") rows,
    '['||string_agg('{"end":'||e::text||',"start":'||s::text||',"work":'||to_jsonb(a->>'plan_work_id')::text||'}',',' ORDER BY a->>'plan_work_id' COLLATE "C")||']' preimage,
    jsonb_agg(jsonb_build_object('planWorkId',a->'plan_work_id','workId',a->'work_id','serviceMode',a#>'{work_snapshot,serviceMode}',
     'window',jsonb_build_object('start',to_char(time '00:00'+make_interval(mins=>s),'HH24:MI'),
      'end',to_char(time '00:00'+make_interval(mins=>e),'HH24:MI')),'includedLocations',a#>'{work_snapshot,includedLocations}')
     ORDER BY a->>'plan_work_id' COLLATE "C") segments
   FROM base JOIN groups ON key=a->>'plan_work_id' GROUP BY root
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('areaId',public.static_weekly_digest_text(preimage),'rows',rows,'segments',segments,
    'targets',(SELECT jsonb_agg(loc ORDER BY loc#>>'{}' COLLATE "C") FROM(
      SELECT DISTINCT a#>'{work_snapshot,locationId}' loc FROM jsonb_array_elements(rows) a)t))
    ORDER BY public.static_weekly_digest_text(preimage) COLLATE "C"),'[]') INTO areas FROM parts;
  IF jsonb_array_length(areas)>128 THEN RAISE EXCEPTION 'Dated lunch area bound exceeded';END IF;
  costs:='{}'::jsonb;
  FOR area IN SELECT value FROM jsonb_array_elements(areas) LOOP
   FOR helper IN SELECT value FROM jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}')
    WHERE value->>'serviceDate'=loan->>'service_date' AND value->>'status'='working'
     AND value->>'incumbentPersonId' IS NOT NULL AND value->'slotId'<>loan->'normal_owner_slot_id'
     AND (value#>>'{shift,start}')::time<=(loan->>'coverage_start')::time AND (value#>>'{shift,end}')::time>=(loan->>'coverage_end')::time
     AND NOT((value#>>'{lunch,start}')::time<(loan->>'coverage_end')::time AND (loan->>'coverage_start')::time<(value#>>'{lunch,end}')::time)
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(value->'blockedWindows','[]'::jsonb)) b
      WHERE (b->>'start')::time<(loan->>'coverage_end')::time AND (loan->>'coverage_start')::time<(b->>'end')::time)
    ORDER BY value->>'slotId' COLLATE "C" LOOP
    helper_id:=helper->>'slotId';
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(area->'rows') a
     WHERE NOT(helper->'qualifications' @> a#>'{work_snapshot,requiredQualifications}')
      OR a#>'{work_snapshot,restrictedSlotIds}' ? helper_id
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(a#>'{work_snapshot,includedLocations}') l WHERE helper->'restrictions' ? (l->>'locationId')))
    THEN CONTINUE;END IF;
    evidence:='[]'::jsonb;cost:=0;
    FOR target IN SELECT jsonb_array_elements_text(area->'targets') LOOP
     SELECT from_id,minutes,provenance INTO edge FROM(
      SELECT a#>>'{work_snapshot,locationId}' from_id,0 minutes,'same_normal_assigned_area'::text provenance
      FROM jsonb_array_elements(projection.projection_envelope->'assignments') a
      JOIN jsonb_array_elements(effective_work) w ON w->>'workId'=a->>'work_id' AND w->'dayOfWeek'=a->'day_of_week'
      WHERE a->>'service_date'=loan->>'service_date' AND a->>'owner_slot_id'=helper_id AND a->>'status'='assigned'
       AND w->>'schedulingMode'='flexible_coverage_ownership' AND w->>'serviceMode'<>'reminder_only'
       AND (a#>>'{work_snapshot,window,start}')::time<(loan->>'coverage_end')::time AND (loan->>'coverage_start')::time<(a#>>'{work_snapshot,window,end}')::time
       AND a#>>'{work_snapshot,locationId}'=target
      UNION ALL
      SELECT a#>>'{work_snapshot,locationId}',(e->>'minutes')::integer,e->>'provenance'
      FROM jsonb_array_elements(projection.projection_envelope->'assignments') a
      JOIN jsonb_array_elements(effective_work) w ON w->>'workId'=a->>'work_id' AND w->'dayOfWeek'=a->'day_of_week'
      JOIN jsonb_array_elements(source->'proximity') e ON
       ((e->>'fromLocationId'=a#>>'{work_snapshot,locationId}' AND e->>'toLocationId'=target)
        OR ((e->'bidirectional'='true'::jsonb OR e->'symmetric'='true'::jsonb) AND e->>'toLocationId'=a#>>'{work_snapshot,locationId}' AND e->>'fromLocationId'=target))
      WHERE a->>'service_date'=loan->>'service_date' AND a->>'owner_slot_id'=helper_id AND a->>'status'='assigned'
       AND w->>'schedulingMode'='flexible_coverage_ownership' AND w->>'serviceMode'<>'reminder_only'
       AND (a#>>'{work_snapshot,window,start}')::time<(loan->>'coverage_end')::time AND (loan->>'coverage_start')::time<(a#>>'{work_snapshot,window,end}')::time
       AND e->'verified'='true'::jsonb AND jsonb_typeof(e->'minutes')='number' AND (e->>'minutes')::numeric BETWEEN 1 AND 1440
       AND (e->>'minutes')::numeric=trunc((e->>'minutes')::numeric) AND nullif(e->>'provenance','') IS NOT NULL
     ) options ORDER BY minutes,from_id COLLATE "C",provenance COLLATE "C" LIMIT 1;
     IF NOT FOUND THEN evidence:=NULL;EXIT;END IF;
     cost:=greatest(cost,edge.minutes);evidence:=evidence||jsonb_build_array(jsonb_build_object(
      'fromLocationId',edge.from_id,'toLocationId',target,'minutes',edge.minutes,'provenance',edge.provenance));
    END LOOP;
    IF evidence IS NOT NULL THEN
     IF NOT(costs ? (area->>'areaId')) THEN costs:=costs||jsonb_build_object(area->>'areaId','{}'::jsonb);END IF;
     costs:=jsonb_set(costs,ARRAY[area->>'areaId',helper_id],jsonb_build_object('cost',cost,'evidence',evidence));
    END IF;
   END LOOP;
  END LOOP;
  SELECT array_agg(id ORDER BY id COLLATE "C") INTO eligible FROM(
   SELECT DISTINCT h.key id FROM jsonb_each(costs) a CROSS JOIN LATERAL jsonb_each(a.value) h)t;
  IF jsonb_array_length(areas)=0 THEN
   IF loan->>'status' IS DISTINCT FROM 'NO_AREAS' OR loan->'helper_slot_ids' IS DISTINCT FROM '[]'::jsonb
    OR loan->'total_distance_minutes' IS DISTINCT FROM '0'::jsonb OR loan->'fallback' IS DISTINCT FROM 'null'::jsonb
    OR loan->'reason' IS DISTINCT FROM 'null'::jsonb
   THEN RAISE EXCEPTION 'Dated no-area lunch result differs';END IF;CONTINUE;
  END IF;
  required:=least(2,coalesce(cardinality(eligible),0));
  IF required=0 OR jsonb_array_length(areas)<required THEN RAISE EXCEPTION 'Dated lunch has no complete eligible partition';END IF;
  pair_sets:='[]'::jsonb;
  IF required=1 THEN pair_sets:=jsonb_build_array(to_jsonb(eligible));
  ELSE FOR i IN 1..cardinality(eligible)-1 LOOP FOR j IN i+1..cardinality(eligible) LOOP
   pair_sets:=pair_sets||jsonb_build_array(to_jsonb(ARRAY[eligible[i],eligible[j]]));END LOOP;END LOOP;END IF;
  best:=NULL;
  FOR pair_item IN SELECT value FROM jsonb_array_elements(pair_sets) LOOP
   SELECT array_agg(value ORDER BY n) INTO pair FROM jsonb_array_elements_text(pair_item) WITH ORDINALITY t(value,n);
   states:='{"0":{"cost":0,"owners":[]}}'::jsonb;
   FOR area IN SELECT value FROM jsonb_array_elements(areas) LOOP
    next_states:='{}'::jsonb;
    FOR mask IN 0..(1<<required)-1 LOOP
     state:=states->mask::text;IF state IS NULL THEN CONTINUE;END IF;
     FOR k IN 1..required LOOP
      IF costs#>ARRAY[area->>'areaId',pair[k]] IS NULL THEN CONTINUE;END IF;
      new_mask:=mask | (1<<(k-1));candidate:=jsonb_build_object('cost',(state->>'cost')::integer+
       (costs#>>ARRAY[area->>'areaId',pair[k],'cost'])::integer,'owners',state->'owners'||jsonb_build_array(pair[k]));
      old:=next_states->new_mask::text;
      IF old IS NULL OR (candidate->>'cost')::integer<(old->>'cost')::integer
       OR ((candidate->>'cost')::integer=(old->>'cost')::integer AND (candidate->'owners')::text COLLATE "C"<(old->'owners')::text COLLATE "C")
      THEN next_states:=jsonb_set(next_states,ARRAY[new_mask::text],candidate);END IF;
     END LOOP;
    END LOOP;
    states:=next_states;
   END LOOP;
   candidate:=states->((1<<required)-1)::text;
   IF candidate IS NOT NULL AND (best IS NULL OR (candidate->>'cost')::integer<(best->>'cost')::integer
    OR ((candidate->>'cost')::integer=(best->>'cost')::integer AND (candidate->'owners')::text COLLATE "C"<(best->'owners')::text COLLATE "C"))
   THEN best:=candidate||jsonb_build_object('pair',pair_item);END IF;
  END LOOP;
  IF best IS NULL OR loan->>'status' IS DISTINCT FROM 'PLANNED' OR loan->'helper_slot_ids' IS DISTINCT FROM best->'pair'
   OR loan->'total_distance_minutes' IS DISTINCT FROM best->'cost'
   OR loan->'reason' IS DISTINCT FROM 'null'::jsonb
   OR loan->'fallback' IS DISTINCT FROM (CASE WHEN required=1 THEN '"only_one_eligible_custodian"'::jsonb ELSE 'null'::jsonb END)
  THEN RAISE EXCEPTION 'Dated deterministic original lunch helper partition differs';END IF;
  i:=0;
  FOR area IN SELECT value FROM jsonb_array_elements(areas) LOOP
   selected:=best#>>ARRAY['owners',i::text];i:=i+1;
   expected_id:=public.static_weekly_digest_text('{"areaId":'||to_jsonb(area->>'areaId')::text||',"covererSlotId":'||to_jsonb(selected)::text||',"loanId":'||to_jsonb(loan->>'loan_id')::text||'}');
   SELECT value INTO STRICT responsibility FROM jsonb_array_elements(p_document->'responsibilities') r(value)
    WHERE value->>'responsibility_id'=expected_id;
   IF responsibility->>'loan_id' IS DISTINCT FROM loan->>'loan_id' OR responsibility->>'coverer_slot_id' IS DISTINCT FROM selected
    OR responsibility->'segments' IS DISTINCT FROM area->'segments'
    OR responsibility->'proximity_evidence' IS DISTINCT FROM costs#>ARRAY[area->>'areaId',selected,'evidence']
   THEN RAISE EXCEPTION 'Dated exact original lunch area responsibility or directed evidence differs';END IF;
   expected_responsibilities:=expected_responsibilities||jsonb_build_array(expected_id);
  END LOOP;
 END LOOP;
 FOR intent IN SELECT value FROM jsonb_array_elements(p_document->'notification_intents') LOOP
  expected_id:=public.static_weekly_digest_text('{"event":'||to_jsonb(intent->>'event')::text||',"loanId":'||to_jsonb(intent->>'loan_id')::text||',"slot":'||to_jsonb(intent->>'coverer_slot_id')::text||'}');
  IF intent->>'notification_key' IS DISTINCT FROM expected_id THEN RAISE EXCEPTION 'Dated original lunch notification identity differs';END IF;
 END LOOP;
 IF EXISTS((SELECT value FROM jsonb_array_elements(expected_responsibilities) EXCEPT ALL SELECT value->'responsibility_id' FROM jsonb_array_elements(p_document->'responsibilities'))
  UNION ALL(SELECT value->'responsibility_id' FROM jsonb_array_elements(p_document->'responsibilities') EXCEPT ALL SELECT value FROM jsonb_array_elements(expected_responsibilities)))
 THEN RAISE EXCEPTION 'Dated complete original lunch responsibilities differ';END IF;
END $lunch$;

-- Copy only the existing projection sink. No create/publish/draft/version path.
-- Retain actor/revision/idempotence/occurrence constraints. Only a private,
-- locally recomputed semantic row/link set can admit dated regrouping.
DO $dated_sink$
DECLARE target regprocedure:='public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure;
 original text;changed text;inverse text;needle text;replacement text;seam record;
BEGIN
 original:=pg_get_functiondef(target);
 IF current_user<>session_user OR (SELECT proowner FROM pg_proc WHERE oid=target)<>current_user::regrole
  OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='function'
   AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=target AND i.definition_sql=original
   AND i.definition_sha256=public.static_weekly_digest_text(original))
  OR to_regprocedure('public.static_weekly_approved_dated_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)') IS NOT NULL
 THEN RAISE EXCEPTION 'Dated sink exact registered predecessor or owner differs';END IF;
 changed:=replace(original,'FUNCTION public.static_weekly_v2_materialize_projection(','FUNCTION public.static_weekly_approved_dated_projection_sink(');
 IF changed=original THEN RAISE EXCEPTION 'Dated sink function header differs';END IF;
 FOR seam IN SELECT * FROM(VALUES
  ('declare v_request jsonb;','declare v_dated_validation jsonb; v_request jsonb;'),
  ('perform public.static_weekly_assert_projection_envelope_attested(p_assignments,p_publication_id,p_service_date,v_exception_set);',
   'v_dated_validation:=public.static_weekly_assert_approved_dated_projection(p_assignments,p_publication_id,p_service_date,v_exception_set);'),
  ($old$select * into v_assignment from public.weekly_schedule_slot_assignments
   where version_id=v_publication.version_id and day_of_week=(v_item->>'day_of_week')::smallint and work_id=v_item->>'work_id';$old$,
   $new$select * into v_assignment from public.weekly_schedule_slot_assignments where assignment_id=nullif(v_dated_validation#>>ARRAY['assignment_links',v_item->>'plan_work_id'],'')::uuid;$new$),
  ($old$if v_assignment.assignment_id is null and (v_work->>'overlayWork') is distinct from 'true' then raise exception using errcode='23514',message='active baseline work must retain its stored baseline assignment link'; end if;$old$,
   $new$if v_assignment.assignment_id is null and not exists(select 1 from jsonb_array_elements(v_dated_validation->'projection_assignments') original where original=v_item) then raise exception using errcode='23514',message='dated work lacks its independently derived original physical lineage'; end if;$new$)
 ) fixed(before_sql,after_sql) LOOP
  IF (length(changed)-length(replace(changed,seam.before_sql,'')))/length(seam.before_sql)<>1
  THEN RAISE EXCEPTION 'Dated exact private semantic sink seam differs';END IF;
  changed:=replace(changed,seam.before_sql,seam.after_sql);
 END LOOP;
 needle:=$old$p_assignments#>>'{authority,schema}'='memphis-zoo.static-weekly-authority.v4'$old$;
 replacement:=$new$p_assignments#>>'{authority,schema}'='custodial.approved-static-authority.v1'$new$;
 IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Dated parent seam differs';END IF;
 changed:=replace(changed,needle,replacement);
 IF (length(changed)-length(replace(changed,'SECURITY DEFINER','')))/length('SECURITY DEFINER')<>1 THEN RAISE EXCEPTION 'Dated sink execution ownership seam differs';END IF;
 changed:=replace(changed,'SECURITY DEFINER','SECURITY INVOKER');
 inverse:=replace(changed,'FUNCTION public.static_weekly_approved_dated_projection_sink(','FUNCTION public.static_weekly_v2_materialize_projection(');
 FOR seam IN SELECT * FROM(VALUES
  ('declare v_request jsonb;','declare v_dated_validation jsonb; v_request jsonb;'),
  ('perform public.static_weekly_assert_projection_envelope_attested(p_assignments,p_publication_id,p_service_date,v_exception_set);',
   'v_dated_validation:=public.static_weekly_assert_approved_dated_projection(p_assignments,p_publication_id,p_service_date,v_exception_set);'),
  ($old$select * into v_assignment from public.weekly_schedule_slot_assignments
   where version_id=v_publication.version_id and day_of_week=(v_item->>'day_of_week')::smallint and work_id=v_item->>'work_id';$old$,
   $new$select * into v_assignment from public.weekly_schedule_slot_assignments where assignment_id=nullif(v_dated_validation#>>ARRAY['assignment_links',v_item->>'plan_work_id'],'')::uuid;$new$),
  ($old$if v_assignment.assignment_id is null and (v_work->>'overlayWork') is distinct from 'true' then raise exception using errcode='23514',message='active baseline work must retain its stored baseline assignment link'; end if;$old$,
   $new$if v_assignment.assignment_id is null and not exists(select 1 from jsonb_array_elements(v_dated_validation->'projection_assignments') original where original=v_item) then raise exception using errcode='23514',message='dated work lacks its independently derived original physical lineage'; end if;$new$)
 ) fixed(before_sql,after_sql) LOOP
  inverse:=replace(inverse,seam.after_sql,seam.before_sql);
 END LOOP;
 inverse:=replace(inverse,$new$p_assignments#>>'{authority,schema}'='custodial.approved-static-authority.v1'$new$,$old$p_assignments#>>'{authority,schema}'='memphis-zoo.static-weekly-authority.v4'$old$);
 inverse:=replace(inverse,'SECURITY INVOKER','SECURITY DEFINER');
 IF inverse IS DISTINCT FROM original THEN RAISE EXCEPTION 'Dated sink unrelated Source changed';END IF;
 EXECUTE changed;
END $dated_sink$;

CREATE FUNCTION public.static_weekly_approved_dated_materialize_projection(
 p_manager uuid,p_publication uuid,p_service_date date,p_template_id text,
 p_expected_revision bigint,p_generation bigint,p_preview_digest text,p_feasibility jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $dated$
DECLARE
 actor jsonb;basis jsonb;source_row jsonb;current_source jsonb;candidate jsonb;
 dated jsonb;projection jsonb;authority jsonb;lunch jsonb;
 publication public.weekly_schedule_publications%rowtype;
 entry public.static_weekly_approved_template_catalog%rowtype;
 v_week_start date;operation_day integer;actual_revision bigint;actual_generation bigint;
 materialized jsonb;accepted_lunch jsonb;v_projection_id uuid;new_revision bigint;checked jsonb;
 original_version jsonb;candidate_version jsonb;original_unaffected jsonb;candidate_unaffected jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 actor:=public.static_weekly_v3_manager_actor(p_manager);
 IF p_manager IS NULL OR p_publication IS NULL OR p_service_date IS NULL OR NOT isfinite(p_service_date)
  OR p_template_id IS NULL OR length(p_template_id) NOT BETWEEN 1 AND 160
  OR p_template_id IS DISTINCT FROM btrim(p_template_id)
  OR p_expected_revision IS NULL OR p_generation IS NULL
  OR p_expected_revision NOT BETWEEN 0 AND 9007199254740991 OR p_generation NOT BETWEEN 0 AND 9007199254740991
  OR p_preview_digest IS NULL OR length(p_preview_digest)<>64 OR p_preview_digest!~'^[0-9a-f]{64}$'
  OR jsonb_typeof(p_feasibility) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Exact approved dated original command required';END IF;
 PERFORM public.static_weekly_assert_exact_object(p_feasibility,
  ARRAY['schema','contract','mapping','sourceDigest','currentSourceDigest','candidateSource','assignments','projectionAssignments','lunchDocument','baseAuthorityDigest','baseReplayDigest','compilerInput','overlayCompilerInput','baselineAssignments','slotAvailability','projectionAvailability','shiftEndDerivation','derivedBaselineDigest','baselineInputDigest','inputDigest','basisDigest','hardConstraintDigest','hardConstraintCount','witnessDigest','lunch','solverInvoked','optimized','publicationAuthority','digest','datedAbsence'],
  ARRAY['schema','contract','mapping','sourceDigest','currentSourceDigest','candidateSource','assignments','projectionAssignments','lunchDocument','baseAuthorityDigest','baseReplayDigest','compilerInput','overlayCompilerInput','baselineAssignments','slotAvailability','projectionAvailability','shiftEndDerivation','derivedBaselineDigest','baselineInputDigest','inputDigest','basisDigest','hardConstraintDigest','hardConstraintCount','witnessDigest','lunch','solverInvoked','optimized','publicationAuthority','digest','datedAbsence'],'approved dated feasibility DATA');
 v_week_start:=p_service_date-(extract(isodow FROM p_service_date)::integer-1);
 operation_day:=extract(dow FROM p_service_date)::integer;

 -- Actual current Source acquisition is already Monday-based. Do not infer
 -- employment, exceptions, template admission or publication from caller DATA.
 basis:=public.static_weekly_read_approved_template_basis(
  p_manager,p_publication,p_service_date,'DATED_ABSENCE',p_template_id,p_expected_revision);
 SELECT * INTO STRICT publication FROM public.weekly_schedule_publications
  WHERE publication_id=p_publication FOR SHARE;
 SELECT * INTO STRICT entry FROM public.static_weekly_approved_template_catalog
  WHERE template_id=p_template_id FOR SHARE;
 SELECT current_revision INTO STRICT actual_revision FROM public.static_weekly_schedule_control WHERE singleton;
 actual_generation:=public.static_weekly_v15_read_recurring_generation();
 source_row:=public.static_weekly_v3_read_publication_source(p_publication,v_week_start);
 current_source:=jsonb_set(jsonb_set(source_row->'compiler_input','{serviceDate}',
  to_jsonb(p_service_date::text),true),'{exceptions}',source_row->'exceptions',true);
 IF basis->>'schema' IS DISTINCT FROM 'custodial.approved-static-template-basis.v1'
  OR basis->>'publicationId' IS DISTINCT FROM p_publication::text
  OR basis->>'serviceDate' IS DISTINCT FROM p_service_date::text
  OR basis->>'kind' IS DISTINCT FROM 'DATED_ABSENCE'
  OR basis->'authorityRevision' IS DISTINCT FROM to_jsonb(p_expected_revision)
  OR basis->'generation' IS DISTINCT FROM to_jsonb(p_generation)
  OR actual_revision IS DISTINCT FROM p_expected_revision OR actual_generation IS DISTINCT FROM p_generation
  OR basis->'currentSource' IS DISTINCT FROM current_source
  OR source_row->>'publication_id' IS DISTINCT FROM p_publication::text
  OR source_row->>'version_id' IS DISTINCT FROM publication.version_id::text
  OR public.static_weekly_effective_version(v_week_start) IS DISTINCT FROM publication.version_id
  OR public.static_weekly_effective_version(v_week_start+6) IS DISTINCT FROM publication.version_id
  OR entry.owner_config IS DISTINCT FROM basis->'ownerConfig'
  OR entry.catalog_entry_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(jsonb_build_object(
    'template',entry.template_json,'binding',entry.binding_json,'ownerConfig',entry.owner_config,'approvalEvidence',entry.approval_evidence))
  OR basis->'templates' IS DISTINCT FROM jsonb_build_array(entry.template_json)
  OR basis->'admittedBindings' IS DISTINCT FROM jsonb_build_array(entry.binding_json)
  OR EXISTS(SELECT 1 FROM public.static_weekly_approved_template_retirements WHERE template_id=p_template_id)
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Approved dated current actor Source template revision or generation differs';END IF;

 dated:=p_feasibility->'datedAbsence';projection:=dated->'projection';
 authority:=projection->'authority';lunch:=dated->'lunchDocument';candidate:=p_feasibility->'candidateSource';
 PERFORM public.static_weekly_assert_exact_object(dated,
  ARRAY['schema','sourcePublicationId','sourceVersionId','serviceDate','scopeDates','scopeDays','projection','lunchDocument'],
  ARRAY['schema','sourcePublicationId','sourceVersionId','serviceDate','scopeDates','scopeDays','projection','lunchDocument'],'approved dated original scope');
 IF p_feasibility->>'schema' IS DISTINCT FROM 'custodial.approved-static-feasibility.v1'
  OR p_feasibility->'solverInvoked' IS DISTINCT FROM 'false'::jsonb
  OR p_feasibility->'optimized' IS DISTINCT FROM 'false'::jsonb
  OR p_feasibility->>'publicationAuthority' IS DISTINCT FROM 'NOT_PUBLISHED'
  OR p_feasibility->>'digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(p_feasibility-'digest'-'datedAbsence')
  OR p_feasibility ?| ARRAY['initialBaseline','recurringStaffing']
  OR p_feasibility#>>'{mapping,templateId}' IS DISTINCT FROM p_template_id
  OR p_feasibility#>>'{mapping,templateDigest}' IS DISTINCT FROM entry.binding_json->>'sourceDigest'
  OR p_feasibility#>>'{mapping,serviceDate}' IS DISTINCT FROM p_service_date::text
  OR p_feasibility#>'{mapping,scopeDays}' IS DISTINCT FROM jsonb_build_array(operation_day)
  OR dated->>'schema' IS DISTINCT FROM 'custodial.approved-static-dated-absence.v1'
  OR dated->>'sourcePublicationId' IS DISTINCT FROM p_publication::text
  OR dated->>'sourceVersionId' IS DISTINCT FROM current_source#>>'{version,id}'
  OR dated->>'serviceDate' IS DISTINCT FROM p_service_date::text
  OR dated->'scopeDates' IS DISTINCT FROM jsonb_build_array(p_service_date::text)
  OR dated->'scopeDays' IS DISTINCT FROM jsonb_build_array(operation_day)
  OR jsonb_typeof(projection) IS DISTINCT FROM 'object' OR jsonb_typeof(authority) IS DISTINCT FROM 'object'
  OR projection#>>'{adapter,schema}' IS DISTINCT FROM 'custodial.approved-static-dated-adapter.v1'
  OR projection->>'compiler_version' IS DISTINCT FROM 'approved-static-dated-v1'
  OR projection->>'service_date' IS DISTINCT FROM v_week_start::text
  OR projection->>'week_start' IS DISTINCT FROM v_week_start::text
  OR projection->>'week_end' IS DISTINCT FROM (v_week_start+6)::text
  OR authority->>'schema' IS DISTINCT FROM 'custodial.approved-static-authority.v1'
  OR authority->'originalCompilerInput' IS DISTINCT FROM current_source
  OR authority->>'originalPublicationId' IS DISTINCT FROM p_publication::text
  OR authority->>'originalVersionId' IS DISTINCT FROM current_source#>>'{version,id}'
  OR authority->'scopeDates' IS DISTINCT FROM dated->'scopeDates'
  OR authority->'scopeDays' IS DISTINCT FROM dated->'scopeDays'
  OR authority->>'effectiveDate' IS DISTINCT FROM v_week_start::text
  OR authority#>>'{weekDerivation,operationDate}' IS DISTINCT FROM p_service_date::text
  OR authority#>>'{weekDerivation,weekStart}' IS DISTINCT FROM v_week_start::text
  OR authority#>>'{weekDerivation,weekEnd}' IS DISTINCT FROM (v_week_start+6)::text
  OR authority#>>'{weekDerivation,originalSourceDigest}' IS DISTINCT FROM public.static_weekly_digest_jsonb(current_source)
  OR projection->>'authority_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(authority)
  OR projection->>'database_projection_identity' IS DISTINCT FROM public.static_weekly_digest_jsonb(projection-'database_projection_identity')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Approved dated original operation and complete weekly projection bindings differ';END IF;

 -- Compare untouched RAW Source, not a Monday representative-person roster.
 -- The current producer supplies one effective version. Unknown multi-version
 -- raw shapes remain unsupported here rather than selecting a caller version.
 original_version:=current_source->'version';candidate_version:=candidate->'version';
 IF jsonb_typeof(original_version) IS DISTINCT FROM 'object'
  OR jsonb_typeof(candidate_version) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION USING ERRCODE='0A000',MESSAGE='Approved dated raw effective version shape unsupported';END IF;
 IF candidate-'version' IS DISTINCT FROM current_source-'version'
  OR candidate_version-'assignments' IS DISTINCT FROM original_version-'assignments'
  OR jsonb_typeof(original_version->'id') IS DISTINCT FROM 'string' OR coalesce(original_version->>'id','')=''
  OR jsonb_typeof(original_version->'assignments') IS DISTINCT FROM 'array'
  OR jsonb_typeof(candidate_version->'assignments') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Approved dated mapping changed original Source outside dated work';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(original_version->'assignments') r
     WHERE jsonb_typeof(r->'dayOfWeek') IS DISTINCT FROM 'number' OR (r->>'dayOfWeek')!~'^[0-6]$')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(candidate_version->'assignments') r
     WHERE jsonb_typeof(r->'dayOfWeek') IS DISTINCT FROM 'number' OR (r->>'dayOfWeek')!~'^[0-6]$')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Approved dated work day shape differs';END IF;
 SELECT coalesce(jsonb_agg(r ORDER BY ordinal),'[]'::jsonb) INTO original_unaffected
  FROM jsonb_array_elements(original_version->'assignments') WITH ORDINALITY t(r,ordinal)
  WHERE r->'dayOfWeek' IS DISTINCT FROM to_jsonb(operation_day);
 SELECT coalesce(jsonb_agg(r ORDER BY ordinal),'[]'::jsonb) INTO candidate_unaffected
  FROM jsonb_array_elements(candidate_version->'assignments') WITH ORDINALITY t(r,ordinal)
  WHERE r->'dayOfWeek' IS DISTINCT FROM to_jsonb(operation_day);
 IF original_unaffected IS DISTINCT FROM candidate_unaffected
  OR candidate->'exceptions' IS DISTINCT FROM current_source->'exceptions'
  OR projection->'assignments' IS DISTINCT FROM p_feasibility->'projectionAssignments'
  OR projection->'applied_exceptions' IS DISTINCT FROM authority->'appliedExceptions'
  OR jsonb_typeof(projection->'assignments') IS DISTINCT FROM 'array'
  OR jsonb_array_length(projection->'assignments')=0
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Approved dated unaffected days or existing exceptions changed';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(projection->'assignments') r
    WHERE (r->>'service_date'=ANY(ARRAY(SELECT (v_week_start+d)::text FROM generate_series(0,6) d))) IS NOT TRUE)
  OR EXISTS(SELECT 1 FROM generate_series(0,6) d WHERE NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(projection->'assignments') r WHERE r->>'service_date'=(v_week_start+d)::text))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Approved dated projection must retain every original week day';END IF;
 IF jsonb_typeof(lunch) IS DISTINCT FROM 'object'
  OR lunch->>'schema' IS DISTINCT FROM 'memphis-zoo.static-weekly-lunch-authority-document.v1'
  OR lunch->>'week_start' IS DISTINCT FROM v_week_start::text
  OR lunch->>'persistence_authority' IS DISTINCT FROM 'NOT_PERSISTED'
  OR lunch->>'base_authority_digest' IS DISTINCT FROM projection->>'authority_digest'
  OR lunch->>'base_replay_digest' IS DISTINCT FROM projection->>'replay_digest'
  OR lunch->>'document_identity' IS DISTINCT FROM public.static_weekly_digest_jsonb(lunch-'document_identity')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Approved dated full week lunch identity differs';END IF;

 -- Recheck actual pinned inputs; no inferred capability escapes this preflight.
 IF public.static_weekly_v3_manager_actor(p_manager) IS DISTINCT FROM actor
  OR (SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton) IS DISTINCT FROM p_expected_revision
  OR public.static_weekly_v15_read_recurring_generation() IS DISTINCT FROM p_generation
  OR public.static_weekly_read_approved_template_basis(p_manager,p_publication,p_service_date,
    'DATED_ABSENCE',p_template_id,p_expected_revision) IS DISTINCT FROM basis
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Approved dated original inputs changed during preflight';END IF;

 -- Independent validation, not a hash receipt, admits the compatible path.
 checked:=public.static_weekly_assert_approved_dated_projection(projection,p_publication,v_week_start,
  public.static_weekly_accepted_exception_set(p_publication,v_week_start));
 IF projection->>'replay_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(jsonb_build_object(
   'projectionAssignments',p_feasibility->'projectionAssignments','lunch',p_feasibility->'lunch'))
  OR authority->'mapping' IS DISTINCT FROM p_feasibility->'mapping'
  OR authority->'overlayCompilerInput' IS DISTINCT FROM p_feasibility->'overlayCompilerInput'
  OR authority->'projectionAvailability' IS DISTINCT FROM p_feasibility->'projectionAvailability'
  OR p_feasibility->'compilerInput' IS DISTINCT FROM jsonb_set(CASE WHEN authority#>>'{shiftEndDerivation,schema}'='custodial.approved-static-dated-closing.v1'
   THEN authority#>'{shiftEndDerivation,mappedInput}' ELSE authority->'overlayCompilerInput' END,'{exceptions}','[]'::jsonb)
  OR p_feasibility->'inputDigest' IS DISTINCT FROM authority->'inputDigest'
  OR p_feasibility->'baselineInputDigest' IS DISTINCT FROM authority->'mappedBaselineInputDigest'
  OR p_feasibility->'derivedBaselineDigest' IS DISTINCT FROM authority->'mappedBaselineInputDigest'
  OR projection#>>'{receipt,feasibilityDigest}' IS DISTINCT FROM p_feasibility->>'digest'
 THEN RAISE EXCEPTION 'Dated feasibility and independently checked projection differ';END IF;
 PERFORM public.custodial_begin_application_mutation();
 materialized:=public.static_weekly_approved_dated_projection_sink(p_publication,v_week_start,
  public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(p_publication,v_week_start)),
  projection->>'compiler_version',projection->'objective',projection->'metrics',projection->>'replay_digest',projection,
  p_expected_revision,p_manager,actor->>'manager_name',p_preview_digest||':dated-projection');
 v_projection_id:=(materialized#>>'{data,projection_id}')::uuid;new_revision:=(materialized->>'revision')::bigint;
 PERFORM public.static_weekly_assert_approved_dated_lunch(v_projection_id,lunch);
 accepted_lunch:=public.static_weekly_v8_materialize_lunch_document(v_projection_id,lunch,p_manager);
 IF accepted_lunch->>'persistence_status' IS DISTINCT FROM 'PERSISTED'
  OR accepted_lunch->>'document_identity' IS DISTINCT FROM lunch->>'document_identity'
  OR new_revision IS NULL OR new_revision<=p_expected_revision
  OR public.static_weekly_v3_manager_actor(p_manager) IS DISTINCT FROM actor
  OR (SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton) IS DISTINCT FROM new_revision
  OR public.static_weekly_v15_read_recurring_generation() IS DISTINCT FROM p_generation
  OR public.static_weekly_compiler_exception_set(p_publication,v_week_start) IS DISTINCT FROM basis#>'{currentSource,exceptions}'
  OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections p
   JOIN public.weekly_schedule_lunch_documents l USING(projection_id)
   WHERE p.projection_id=v_projection_id AND p.publication_id=p_publication AND p.version_id=publication.version_id
    AND p.week_start=v_week_start AND p.week_end=v_week_start+6 AND p.projection_envelope=projection
    AND p.compiled_by_manager_id=p_manager AND l.accepted_by_manager_id=p_manager AND l.document_json=lunch)
 THEN RAISE EXCEPTION 'Dated original relational projection lunch or final currentness differs';END IF;
 PERFORM public.static_weekly_assert_approved_dated_projection(projection,p_publication,v_week_start,
  public.static_weekly_accepted_exception_set(p_publication,v_week_start));
 -- DATA for Main's same-transaction original receipt, never a new publication.
 RETURN jsonb_build_object('schema','custodial.approved-static-confirmation.v1','status','PERSISTED_CURRENT',
  'ok',true,'persistence_status','PERSISTED','source_id',checked->'source_id','publication_id',p_publication,
  'projection_id',v_projection_id,'authority_revision',new_revision,'revision',new_revision,
  'feasibility_digest',p_feasibility->>'digest','lunch_document_identity',accepted_lunch->>'document_identity',
  'previewDigest',p_preview_digest,'solverInvoked',false);
END $dated$;

REVOKE ALL ON FUNCTION public.static_weekly_approved_dated_assert_window(jsonb,text),
 public.static_weekly_approved_dated_effective_availability(jsonb,text,date,jsonb),
 public.static_weekly_approved_dated_effective_work(uuid,date,jsonb),
 public.static_weekly_approved_dated_assert_closing(jsonb,jsonb,jsonb,jsonb,jsonb,date),
 public.static_weekly_assert_approved_dated_projection(jsonb,uuid,date,jsonb),
 public.static_weekly_assert_approved_dated_lunch(uuid,jsonb),
 public.static_weekly_approved_dated_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text),
 public.static_weekly_approved_dated_materialize_projection(uuid,uuid,date,text,bigint,bigint,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,
 static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;

-- Same closed managed-default cleanup as the sealed private recurring helpers;
-- no owner/default-policy changes and no positive EXECUTE grant.
DO $dated_private_acl$
DECLARE routine regprocedure;
BEGIN
 FOR routine IN SELECT oid::regprocedure FROM pg_proc WHERE oid IN(
  'public.static_weekly_approved_dated_assert_window(jsonb,text)'::regprocedure,
  'public.static_weekly_approved_dated_effective_availability(jsonb,text,date,jsonb)'::regprocedure,
  'public.static_weekly_approved_dated_effective_work(uuid,date,jsonb)'::regprocedure,
  'public.static_weekly_approved_dated_assert_closing(jsonb,jsonb,jsonb,jsonb,jsonb,date)'::regprocedure,
  'public.static_weekly_assert_approved_dated_projection(jsonb,uuid,date,jsonb)'::regprocedure,
  'public.static_weekly_assert_approved_dated_lunch(uuid,jsonb)'::regprocedure,
  'public.static_weekly_approved_dated_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure,
  'public.static_weekly_approved_dated_materialize_projection(uuid,uuid,date,text,bigint,bigint,text,jsonb)'::regprocedure) LOOP
  IF (SELECT proowner FROM pg_proc WHERE oid=routine)<>current_user::regrole
   OR (SELECT prosecdef FROM pg_proc WHERE oid=routine)
  THEN RAISE EXCEPTION 'Dated private helper owner or invoker mode differs';END IF;
  IF (SELECT proowner FROM pg_proc WHERE oid=routine)<>'postgres'::regrole THEN
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM postgres',routine);END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid=routine AND a.grantee<>p.proowner)
  THEN RAISE EXCEPTION 'Dated private helper has unexpected nonowner EXECUTE';END IF;
 END LOOP;
END $dated_private_acl$;

-- END EXACT APPROVED DATED SOURCE

-- Check the independently pinned eight bodies/attributes and exact owner-only
-- ACLs BEFORE serializing any new recovery definition. No surviving helper,
-- caller hash or captured survivor can become an expected implementation.
DO $dated_installed_source$
DECLARE actor oid:=(SELECT oid FROM pg_roles WHERE rolname=current_user);item record;routine record;
BEGIN
 FOR item IN SELECT * FROM approved_dated_install_targets LOOP
  SELECT p.*,l.lanname INTO STRICT routine FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=to_regprocedure(item.identity);
  IF routine.proowner<>actor OR routine.prosecdef OR routine.lanname<>'plpgsql' OR routine.prokind<>'f'
   OR routine.prorettype<>item.return_type::regtype OR routine.proretset
   OR routine.provolatile::text<>item.volatility OR routine.proparallel<>'u'
   OR routine.proisstrict OR routine.proleakproof OR routine.provariadic<>0 OR routine.pronargdefaults<>0
   OR routine.proargmodes IS NOT NULL OR routine.proallargtypes IS NOT NULL
   OR routine.proargnames IS DISTINCT FROM item.argument_names
   OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
   OR public.static_weekly_digest_text(routine.prosrc) IS DISTINCT FROM item.body_sha256
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) a
    WHERE a.grantee<>routine.proowner OR a.privilege_type<>'EXECUTE' OR a.grantor<>routine.proowner)
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader',
    'static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) denied(role_name)
    WHERE has_function_privilege(role_name,to_regprocedure(item.identity),'EXECUTE'))
  THEN RAISE EXCEPTION 'Approved dated exact private body attributes owner or EXECUTE differs';END IF;
 END LOOP;
END $dated_installed_source$;

-- Exact normal serializers and actual regprocedure spelling, with an explicit
-- reset-only grant definition for EVERY private function (not a missing row).
CREATE TEMP TABLE approved_dated_objects ON COMMIT DROP AS
 WITH funcs AS(SELECT to_regprocedure(identity) AS oid FROM approved_dated_install_targets)
 SELECT 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
 UNION ALL SELECT 900000,'grant',oid::regprocedure::text,
  public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) FROM funcs;
DO $dated_objects$
BEGIN
 IF (SELECT count(*) FROM approved_dated_objects)<>16
  OR (SELECT count(*) FROM approved_dated_objects WHERE kind='function')<>8
  OR (SELECT count(*) FROM approved_dated_objects WHERE kind='grant')<>8
  OR EXISTS(SELECT 1 FROM approved_dated_objects WHERE definition IS NULL OR definition='')
  OR EXISTS(SELECT kind,identity FROM approved_dated_objects GROUP BY kind,identity HAVING count(*)<>1)
  OR EXISTS(SELECT 1 FROM approved_dated_objects WHERE kind='grant'
   AND definition IS DISTINCT FROM 'select public.custodial_release_authority_reset_grants('||quote_literal(identity)||');')
  OR EXISTS(SELECT 1 FROM approved_dated_inventory_before old JOIN approved_dated_objects x ON x.kind=old.object_kind
   AND old.object_identity LIKE '%(%' AND to_regprocedure(old.object_identity)=to_regprocedure(x.identity))
  OR EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface() old JOIN approved_dated_objects x
   ON old.object_kind=x.kind AND old.object_identity LIKE '%(%'
    AND to_regprocedure(old.object_identity)=to_regprocedure(x.identity))
 THEN RAISE EXCEPTION 'Approved dated finite private recovery declaration differs';END IF;
END $dated_objects$;

DO $dated_surface$
DECLARE original text;patched text;entries text;
BEGIN
 SELECT definition_sql INTO STRICT original FROM approved_dated_surface_before;
 SELECT string_agg('('||quote_literal(kind)||','||quote_literal(identity)||','
  ||quote_literal('private independently checked approved dated original materialization; no public capability')||'),',E'\n'
  ORDER BY kind,identity) INTO entries FROM approved_dated_objects;
 patched:=replace(original,'  values','  values'||E'\n'||entries);
 IF patched IS NOT DISTINCT FROM original
  OR replace(patched,'  values'||E'\n'||entries,'  values') IS DISTINCT FROM original
 THEN RAISE EXCEPTION 'Approved dated canary finite extension is not exactly reversible';END IF;
 EXECUTE patched;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched
  OR EXISTS(SELECT 1 FROM approved_dated_surface_before old JOIN pg_proc p ON p.oid=old.oid
   WHERE ROW(p.proowner,p.proacl,p.proconfig,p.prolang,p.provolatile,p.proparallel,p.prosecdef,p.prorettype,
    p.proargtypes,p.proallargtypes,p.proargmodes,p.proargnames,p.proisstrict,p.proleakproof)
    IS DISTINCT FROM ROW(old.proowner,old.proacl,old.proconfig,old.prolang,old.provolatile,old.proparallel,
     old.prosecdef,old.prorettype,old.proargtypes,old.proallargtypes,old.proargmodes,old.proargnames,old.proisstrict,old.proleakproof))
  OR EXISTS(SELECT 1 FROM approved_dated_objects x WHERE (SELECT count(*) FROM public.custodial_release_canary_authority_surface() s
   WHERE s.object_kind=x.kind AND s.object_identity=x.identity)<>1)
 THEN RAISE EXCEPTION 'Approved dated exact canary extension owner ACL or attributes differ';END IF;
END $dated_surface$;

-- Sole NORMAL Source-catalog UPDATE exception: this already captured canary
-- FUNCTION row only. No operational/private DATA trigger is disabled or used.
-- Exclusive inventory lock + fixed predecessor comparisons fence this block;
-- the immutable inventory guard is restored ALWAYS before final checks/commit.
ALTER TABLE public.custodial_release_authority_restore_inventory
 DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $dated_recovery$
DECLARE obj record;next_order integer;changed integer;
BEGIN
 UPDATE public.custodial_release_authority_restore_inventory i SET
  definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),
  captured_at=statement_timestamp()
 WHERE i.object_kind='function' AND i.object_identity LIKE '%(%'
  AND to_regprocedure(i.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
  AND EXISTS(SELECT 1 FROM approved_dated_inventory_before old WHERE old.inventory_id=i.inventory_id
   AND ROW(i.restore_order,i.object_kind,i.object_identity,i.definition_sql,i.definition_sha256,i.captured_at)
    IS NOT DISTINCT FROM ROW(old.restore_order,old.object_kind,old.object_identity,old.definition_sql,old.definition_sha256,old.captured_at))
  AND i.definition_sql=(SELECT definition_sql FROM approved_dated_surface_before);
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Approved dated exact canary inventory predecessor differs';END IF;
 FOR obj IN SELECT * FROM approved_dated_objects ORDER BY bucket,identity LOOP
  SELECT n INTO next_order FROM generate_series(obj.bucket+1,obj.bucket+99998) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n)
   ORDER BY n LIMIT 1;
  IF next_order IS NULL THEN RAISE EXCEPTION 'Approved dated finite recovery order exhausted';END IF;
  INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 END LOOP;
END $dated_recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory
 ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;

DO $dated_scope$
DECLARE item record;
BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM approved_dated_inventory_before)+16
  OR EXISTS(SELECT old.* FROM approved_dated_inventory_before old
   WHERE NOT(old.object_kind='function' AND old.object_identity LIKE '%(%'
    AND to_regprocedure(old.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT live.* FROM public.custodial_release_authority_restore_inventory live
   WHERE NOT(live.object_kind='function' AND live.object_identity LIKE '%(%'
    AND to_regprocedure(live.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
    AND NOT EXISTS(SELECT 1 FROM approved_dated_objects x WHERE x.kind=live.object_kind AND x.identity=live.object_identity)
   EXCEPT SELECT * FROM approved_dated_inventory_before)
  OR (SELECT count(*) FROM public.custodial_release_authority_restore_inventory i JOIN approved_dated_inventory_before old
   ON old.inventory_id=i.inventory_id WHERE i.object_kind='function' AND i.object_identity LIKE '%(%'
    AND to_regprocedure(i.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
    AND ROW(i.restore_order,i.object_kind,i.object_identity) IS NOT DISTINCT FROM ROW(old.restore_order,old.object_kind,old.object_identity)
    AND i.definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)
    AND i.definition_sha256=public.static_weekly_digest_text(i.definition_sql))<>1
  OR EXISTS(SELECT 1 FROM approved_dated_objects x LEFT JOIN public.custodial_release_authority_restore_inventory i
   ON x.kind=i.object_kind AND x.identity=i.object_identity
   WHERE i.definition_sql IS DISTINCT FROM x.definition OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(x.definition))
  OR EXISTS(SELECT 1 FROM approved_dated_functions_before old LEFT JOIN pg_proc p ON p.oid=old.oid
   WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM old.proowner OR p.proacl IS DISTINCT FROM old.proacl
    OR (old.oid<>'public.custodial_release_canary_authority_surface()'::regprocedure
     AND pg_get_functiondef(p.oid) IS DISTINCT FROM old.definition_sql))
  OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN('public','custodial_dr') AND p.prokind='f')<>(SELECT count(*) FROM approved_dated_functions_before)+8
  OR (SELECT count(*) FROM approved_dated_inventory_trigger_before old JOIN pg_trigger t ON t.oid=old.oid
   WHERE ROW(t.tgfoid,t.tgtype,t.tgenabled,t.tgattr,t.tgnargs,t.tgargs,t.tgqual::text)
    IS NOT DISTINCT FROM ROW(old.tgfoid,old.tgtype,old.tgenabled,old.tgattr,old.tgnargs,old.tgargs,old.tgqual)
    AND t.tgenabled='A' AND pg_get_triggerdef(t.oid,true)=old.definition_sql)<>1
 THEN RAISE EXCEPTION 'Approved dated unrelated inventory Source ACL owner or final ALWAYS state changed';END IF;
 -- Final actual readback after registration. No grant/owner can drift between
 -- the first private check and the normal transaction's COMMIT boundary.
 FOR item IN SELECT * FROM approved_dated_install_targets LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(item.identity)
    AND p.proowner=(SELECT proowner FROM approved_dated_surface_before) AND NOT p.prosecdef
    AND public.static_weekly_digest_text(p.prosrc)=item.body_sha256)
   OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=to_regprocedure(item.identity) AND a.grantee<>p.proowner)
   OR public.custodial_release_authority_current_grant_definition(to_regprocedure(item.identity)::text)
    IS DISTINCT FROM 'select public.custodial_release_authority_reset_grants('||quote_literal(to_regprocedure(item.identity)::text)||');'
  THEN RAISE EXCEPTION 'Approved dated final private Source readback differs';END IF;
 END LOOP;
END $dated_scope$;
COMMIT;
