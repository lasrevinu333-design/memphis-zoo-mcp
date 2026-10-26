-- SOURCE-ONLY guarded forward installer; Main promotion/native qualification NOT_RUN.
-- Frozen backend e99ee88f5677fa0c08858d3b462245a8a2372349, canonical287.
-- The embedded component is byte-identical SHA256:
-- 4ea18401e4ad65411933e7e17b84275dcf8b46732dde4f8ac953b38d004e3066.
-- No pattern approval, history seeding, new public API or positive privilege grant.
-- One original-owner transaction; an exception aborts replacement/registration
-- AND restores the original ALWAYS state. No catch/continue or second apply.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;

DO $pending_original_actor$
DECLARE r record;
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'
  OR current_setting('session_replication_role')<>'origin'
  OR current_setting('transaction_read_only')<>'off'
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.custodial_release_authority_restore_inventory')
   AND relowner='supabase_admin'::regrole AND relkind='r' AND relpersistence='p')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Pending normal installer original owner/context unavailable';END IF;
 -- Pin the existing serializer/fence Source before invoking it. These hashes
 -- come from the retained native catalog, not a surviving target definition.
 FOR r IN SELECT * FROM(VALUES
 ('public.custodial_begin_application_mutation()','4b535f49f3f47962639f002ff00fc7abaf410627b29950684a1e33052fd875e0'),
 ('public.custodial_release_authority_current_grant_definition(text)','6ea419b77106cde9611a2091e52552116607e192f961f1a88b3b591633245907'),
 ('public.custodial_release_authority_reset_grants(text)','408782638a49d5b2adac3bbdc4c3cc0b2ecb22b631a509ece950f408b8f4bf86'),
 ('public.static_weekly_digest_text(text)','5337ef6187e2febb0668f1350092fa49de3258317ae19537317a889900a0e1c3')
 ) fixed(identity,definition_sha) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.identity)
   AND p.proowner='supabase_admin'::regrole
   AND encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex')=r.definition_sha)
  THEN RAISE EXCEPTION 'Pending fixed original serializer/fence Source differs';END IF;
 END LOOP;
END $pending_original_actor$;
-- Established order: normal application fence -> weekly authority -> inventory.
SELECT public.custodial_begin_application_mutation();
SELECT pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE pending_install_targets(
 rank integer PRIMARY KEY,identity text UNIQUE NOT NULL,body_sha text NOT NULL,definition_sha text NOT NULL,
 result_type text NOT NULL,language_name text NOT NULL,volatility text NOT NULL,argument_names text[] NOT NULL
) ON COMMIT DROP;
-- Explicit creation/recovery dependency order, not alphabetical slot allocation.
-- In particular SQL summary depends on exception_set; applied_summary on summary.
INSERT INTO pending_install_targets VALUES
 (1,'static_weekly_pending_context(uuid,uuid)','21e2c398f8c7fd017c66ee0ef775db428656c3b0a83ede9aa9b5a4b09ecec60f','aa5962f017f61cd2713033b5bb28bf70d4f521c17fd1bb0c27a971c8b04fbeec','jsonb','plpgsql','v',ARRAY['p_operation','p_manager']::text[]),
 (2,'static_weekly_pending_original_exception_set(uuid,date,uuid)','393212f183f9313a0878bddfc2e264f4b9a3d63a51f96079ed1748f1564494c2','568183788a0f7e52be9f3d8232445b6d42549b93254e311dcd906642a191f01e','jsonb','sql','s',ARRAY['p_publication_id','p_week_start','p_operation']::text[]),
 (3,'static_weekly_pending_exception_set(uuid,uuid,date,date)','d3c6103f00be0a04720edb6ede5a1eeafbbc8360278927673582ef260564c90a','0c65eae618a04b336ffc447acb953344505b38625c007244898adc75e078f51b','jsonb','plpgsql','v',ARRAY['p_operation','p_publication','p_week','p_day']::text[]),
 (4,'static_weekly_pending_summary(uuid,uuid,date,date)','031df9084a4ef4407a4b2347d88e8cfa98ae2875ddbc26a6bb9e31e54b9d4a75','19e41ac3a82c3029071e6f317fcd0c7a490a46ba5510e5399d16591201fcba07','jsonb','sql','v',ARRAY['p_operation','p_publication','p_week','p_day']::text[]),
 (5,'static_weekly_pending_applied_summary(uuid,uuid,date,date)','202f5e6963b3a842563cd15c9e27b5d506fcc4720d3e3099148a126f0373d274','dfba6b1519454cd6993729b2c130de986377f7feacb96d5acfee51d97bd7cecc','jsonb','sql','v',ARRAY['p_operation','p_publication','p_week','p_day']::text[]),
 (6,'static_weekly_pending_day_source(uuid,uuid,date,date)','64b83c62e7e22091cdf0da0f31daf3d7fc6901b11b942d6c10c92fb6ad58ad19','714239365cbdeeb582301f7ac75a35137a44c92735d75db2fa08cd127dd5801d','jsonb','plpgsql','v',ARRAY['p_operation','p_publication','p_week','p_day']::text[]),
 (7,'static_weekly_pending_effective_work(uuid,date,uuid,date,jsonb)','42e91396db67382edc09940b6d281e8abf9ce23a6cc365bf06bbcfc17c7d104a','cb078339e0610bf3cfe6816bc783f7753ff3c2c838f30b32f1fe6896aa6cad15','jsonb','plpgsql','v',ARRAY['p_operation','p_day','p_publication','p_week','p_source']::text[]),
 (8,'static_weekly_pending_assert_day(uuid,jsonb,uuid,date,jsonb)','ca43797cabafb49105ec83d7156cbf4c5719e57f043efdceda6a78931e24c319','60d5d2a18c997688eb103015891051670f0f3362bd0d907a1d6b1287513cf4e2','jsonb','plpgsql','v',ARRAY['p_operation','p_envelope','p_publication_id','p_week','p_exceptions']::text[]),
 (9,'static_weekly_pending_assert_projection(uuid,uuid,jsonb)','f251412d224a693f4b8fb6e783bd742feb70f6756b577788694a86fc1e88f87a','357ac0648dd992ebdb09d923fdb7265fdc6513e422288ef6347d3e1214a77c7c','jsonb','plpgsql','v',ARRAY['p_operation','p_manager','p_envelope']::text[]),
 (10,'static_weekly_pending_lunch_base(uuid,jsonb,jsonb,uuid,date)','195ac3beb00edf980f3d0c0cd01479fe4388270ad217c1bfd9d1e16fc25b6e40','e3c738626bdfcca7beca4f645bece45e2f2d62e1b397ec4cee82b1ae5e2049bd','void','plpgsql','v',ARRAY['p_projection_id','p_document','p_envelope','p_publication','p_week']::text[]),
 (11,'static_weekly_pending_lunch_derivation(uuid,jsonb,jsonb,uuid,date,uuid)','c7f7734b862721bcff4131fb1fa44372fd067a2e54ea1af5b79f92629c9a049f','8b2ce782a659a35535487f2785fa2f52f045f8771186d125f3b91bd32c9b67ef','void','plpgsql','v',ARRAY['p_projection','p_document','p_envelope','p_publication','p_week','p_operation']::text[]),
 (12,'static_weekly_pending_assert_lunch(uuid,uuid,uuid,date,jsonb,jsonb)','4cd110773f9ef6dba70d882e9f1bf8ae3cf346aa6b811d0406fed6935670647e','a34dd5e4b7bc163b48d57d8f791b03a09e1238e15f911d3770b10cdcde7429a8','void','plpgsql','v',ARRAY['p_operation','p_manager','p_publication','p_week','p_envelope','p_document']::text[]),
 (13,'static_weekly_pending_assert_payload(uuid,uuid,jsonb)','d215e08cc2bf7fc9199175d33d780aec39df0f6e68080f41d720ffdc7e1969d3','3cd46f205ccfef0d64c5cbe1b826117d462608aabcbbdf358fc9a911463e29af','jsonb','plpgsql','v',ARRAY['p_operation','p_manager','p_payload']::text[]),
 (14,'static_weekly_pending_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','8014f5a26a05632840c667c53d6fa1e15a3eb9b9d646ed5cf2faea9e1302c458','760dddee264ecfbf0b2b0faf594dc65cdc1195642b00c46c49cfbe38600a99d2','jsonb','plpgsql','v',ARRAY['p_publication_id','p_service_date','p_exception_set_digest','p_compiler_version','p_objective','p_metrics','p_replay_digest','p_assignments','p_expected_revision','p_actor_manager_id','p_actor_manager_name','p_idempotency_key']::text[]);
CREATE TEMP TABLE pending_install_predecessors(
 identity text PRIMARY KEY,definition_sha text NOT NULL,body_sha text NOT NULL,
 function_order integer,grant_definition text,grant_order integer,nonowner_roles text[] NOT NULL,dated boolean NOT NULL
) ON COMMIT DROP;
INSERT INTO pending_install_predecessors VALUES
 ('static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)','ce53bb72254bc08d06f326a488e6371a0fe88d60e94ba43a6433a943f47416ce','89a466f0bffde02f63c64ff0d7c72abe3604bd2c63d8305be48571fbe54ea956',100251,'select public.custodial_release_authority_reset_grants(''static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)''); grant execute on function static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid) to postgres; grant execute on function static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid) to static_weekly_control_plane;',950083,ARRAY['postgres','static_weekly_control_plane']::text[],false),
 ('static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)','67d3ac9c85cef5acd5f4285dadddcb2bc14381878d169be4dcb3b7acf941a592','edf3169446972f40fe8db0e88f303ec4d77924fd7cfb2ac8a6ade959af159c5f',100255,'select public.custodial_release_authority_reset_grants(''static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)''); grant execute on function static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid) to postgres; grant execute on function static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid) to static_weekly_control_plane;',950084,ARRAY['postgres','static_weekly_control_plane']::text[],false),
 ('static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)','7a4f03e2280960dd18f897762630eefd387373fdabc45cb1f363d16999153f7f','8e49cc5b4a319978b4193bfcf35ec40e54d0311e21e6961c06419cc390311a15',100257,'select public.custodial_release_authority_reset_grants(''static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)''); grant execute on function static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid) to postgres;',950086,ARRAY['postgres']::text[],false),
 ('static_weekly_compiler_exception_set(uuid,date)','85db993fb76b2bd098a0581c44f474c6990576252d1e2f5928555899b8cab212','53bd75e28b947dc643fc711b3684be7e1cdc651fccab2a6cb13aedc5b8ef0529',100254,NULL,NULL,ARRAY['postgres']::text[],false),
 ('static_weekly_assert_approved_dated_projection(jsonb,uuid,date,jsonb)','e482463acc95faa07f37599b6dbcf04421636fb4eb65831eb3a28aed0ea18b2d','b5fa8207cc41f61af72637a58977064da43b74e18a6cb5d4dfdf0143af44d863',100593,'select public.custodial_release_authority_reset_grants(''static_weekly_assert_approved_dated_projection(jsonb,uuid,date,jsonb)'');',900426,ARRAY[]::text[],true),
 ('static_weekly_approved_dated_effective_work(uuid,date,jsonb)','d275e6e6bfa7de98679a168b5da859c09c610bffe5eabd1f045bc542deb300f2','334e48f0f65374b90809c372e841db57986446b73a59f7d00f9f665918971905',100589,'select public.custodial_release_authority_reset_grants(''static_weekly_approved_dated_effective_work(uuid,date,jsonb)'');',900422,ARRAY[]::text[],true),
 ('static_weekly_assert_approved_dated_lunch(uuid,jsonb)','0b4e2901d794ff4caebad02dedc994f741cee44a47de2c0173ae2bfdc72a6e1b','9534c73ba4914f38e0e02dfbe002ef31d39679409a7143e314899aa02a2ffea1',100592,'select public.custodial_release_authority_reset_grants(''static_weekly_assert_approved_dated_lunch(uuid,jsonb)'');',900425,ARRAY[]::text[],true),
 ('static_weekly_v8_assert_lunch_document(uuid,jsonb)','ccbd7327fbf7efef472379adddbd66d9270971a00af9309ede34d0258352226c','4394b8c94dbfe298f673e0c593ebd0191d79ff01617b16e03d5fc0e4e361e1bf',100187,'select public.custodial_release_authority_reset_grants(''static_weekly_v8_assert_lunch_document(uuid,jsonb)''); grant execute on function static_weekly_v8_assert_lunch_document(uuid,jsonb) to postgres; grant execute on function static_weekly_v8_assert_lunch_document(uuid,jsonb) to static_weekly_control_plane;',950010,ARRAY['postgres','static_weekly_control_plane']::text[],false),
 ('static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','9fe00673753e54ba9690d523e8229eb538402b640fd58df9e4a1e89e58443744','c38d665aff22a47b0eee8158bc234973eba3bc098a188477c6467548a100c796',100207,'select public.custodial_release_authority_reset_grants(''public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)''); grant execute on function static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text) to postgres;',950028,ARRAY['postgres']::text[],false);
CREATE TEMP TABLE pending_install_wrappers(identity text PRIMARY KEY,body_sha text NOT NULL,definition_sha text NOT NULL) ON COMMIT DROP;
INSERT INTO pending_install_wrappers VALUES
 ('static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)','1e7cacbd85e217d6c24d006b72a499e730629cfbc4923b1db06faf3332424c77','a962268fdacc633c4b1542b54f5c7f361c4385f6e5c6acd3e53ebf3db3aba0a1'),
 ('static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)','fffc21b73be6078617436666a6b92649a1438d4eddabadd20bc5e664ee69f697','7e7512b39c2dad6f6f5306b2c98b273a035e4d1b84f3f67b2972a6944bca7b3b'),
 ('static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)','950d80592ecc5d6c0f34e35d6b8ac6d2c9e795871bd8d9ef323047bf89c43c64','65428e05a6e6da354e5d73b45a09ecf47ba07ab37a2eac6d42627f776c305daa');
CREATE TEMP TABLE pending_inventory_before ON COMMIT DROP AS TABLE public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE pending_functions_before ON COMMIT DROP AS
 SELECT p.*,pg_get_functiondef(p.oid) definition_sql,obj_description(p.oid,'pg_proc') original_comment
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','custodial_dr');
CREATE TEMP TABLE pending_catalog_before(kind text,identity oid,data jsonb) ON COMMIT DROP;
INSERT INTO pending_catalog_before
 SELECT 'class',c.oid,to_jsonb(c) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','custodial_dr')
 UNION ALL SELECT 'attribute',a.attrelid,to_jsonb(a) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','custodial_dr')
 UNION ALL SELECT 'trigger',t.oid,to_jsonb(t) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','custodial_dr')
 UNION ALL SELECT 'policy',p.oid,to_jsonb(p) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','custodial_dr')
 UNION ALL SELECT 'constraint',p.oid,to_jsonb(p) FROM pg_constraint p JOIN pg_namespace n ON n.oid=p.connamespace WHERE n.nspname IN('public','custodial_dr')
 UNION ALL SELECT 'namespace',n.oid,to_jsonb(n) FROM pg_namespace n WHERE n.nspname IN('public','custodial_dr')
 UNION ALL SELECT 'role',p.oid,to_jsonb(p) FROM pg_roles p
 UNION ALL SELECT 'membership',0::oid,to_jsonb(m) FROM pg_auth_members m
 UNION ALL SELECT 'default_acl',p.oid,to_jsonb(p) FROM pg_default_acl p;
CREATE TEMP TABLE pending_inventory_guard_before ON COMMIT DROP AS
 SELECT t.*,NULL::text canonical_definition FROM pg_trigger t WHERE t.tgrelid='public.custodial_release_authority_restore_inventory'::regclass;
CREATE TEMP TABLE pending_canary_rows_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_canary_authority_surface();
CREATE TEMP TABLE pending_order_plan(kind text,identity text,restore_order integer,PRIMARY KEY(kind,identity),UNIQUE(restore_order)) ON COMMIT DROP;
DO $pending_original_source$
DECLARE item record;p pg_proc;expected_grant text;source_path text:=current_setting('search_path');
 immutable_oid oid:='public.custodial_reject_release_authority_inventory_mutation()'::regprocedure;
 mutation_oid oid:='custodial_dr.guard_application_mutation()'::regprocedure;
 surface_oid oid:='public.custodial_release_canary_authority_surface()'::regprocedure;
 function_base integer;grant_base integer;min_grant integer;
BEGIN
 IF (SELECT count(*) FROM pending_install_targets)<>14 OR (SELECT count(*) FROM pending_install_predecessors)<>9
  OR (SELECT count(*) FROM pending_install_wrappers)<>3
  OR EXISTS(SELECT 1 FROM pg_proc surviving_proc JOIN pending_install_targets x
    ON surviving_proc.pronamespace='public'::regnamespace AND surviving_proc.proname=split_part(x.identity,'(',1))
  OR EXISTS(SELECT 1 FROM pending_inventory_before WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
 THEN RAISE EXCEPTION 'Pending exact finite Source/predecessor set differs or helper survivor exists';END IF;
 FOR item IN SELECT * FROM pending_install_predecessors LOOP
  SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure('public.'||item.identity);
  IF p.proowner<>'supabase_admin'::regrole OR p.prokind<>'f'
   OR public.static_weekly_digest_text(pg_get_functiondef(p.oid)) IS DISTINCT FROM item.definition_sha
   OR public.static_weekly_digest_text(p.prosrc) IS DISTINCT FROM item.body_sha
   OR (SELECT count(*) FROM pending_inventory_before i WHERE i.object_kind='function'
     AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=p.oid)<>1
   OR NOT EXISTS(SELECT 1 FROM pending_inventory_before i WHERE i.object_kind='function'
     AND i.object_identity=(CASE WHEN item.identity LIKE 'static_weekly_v2_materialize_projection(%' THEN 'public.'||item.identity ELSE item.identity END)
     AND i.restore_order=item.function_order AND i.definition_sql=pg_get_functiondef(p.oid) AND i.definition_sha256=item.definition_sha)
  THEN RAISE EXCEPTION 'Pending pinned original definition/body/recovery row differs';END IF;
  IF p.proacl IS NULL OR (SELECT count(*) FROM aclexplode(p.proacl))<>cardinality(item.nonowner_roles)+1
   OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable
    OR a.grantor<>p.proowner OR a.grantee<>p.proowner AND NOT EXISTS(
     SELECT 1 FROM unnest(item.nonowner_roles) role_name JOIN pg_roles r ON r.rolname=role_name WHERE r.oid=a.grantee))
   OR (SELECT count(DISTINCT grantee) FROM aclexplode(p.proacl))<>cardinality(item.nonowner_roles)+1
  THEN RAISE EXCEPTION 'Pending captured original owner/private ACL differs';END IF;
  expected_grant:=item.grant_definition;
  IF item.identity='static_weekly_compiler_exception_set(uuid,date)' THEN
   IF EXISTS(SELECT 1 FROM pending_inventory_before i WHERE i.object_kind='grant'
     AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=p.oid)
    OR public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(item.identity))
      IS DISTINCT FROM '5e045b2e87eeab69f63d6e165e816477b4d9b428dbf668ae381edbfbe8c995fb'
   THEN RAISE EXCEPTION 'Pending original compiler grant-row absence/ACL differs';END IF;
  ELSE
   IF (SELECT count(*) FROM pending_inventory_before i WHERE i.object_kind='grant'
     AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=p.oid)<>1
    OR NOT EXISTS(SELECT 1 FROM pending_inventory_before i WHERE i.object_kind='grant'
     AND i.restore_order=item.grant_order AND i.definition_sql=expected_grant
     AND i.definition_sha256=public.static_weekly_digest_text(expected_grant)
     AND i.object_identity=(CASE WHEN item.identity LIKE 'static_weekly_v2_materialize_projection(%' THEN 'public.'||item.identity ELSE item.identity END))
    OR public.custodial_release_authority_current_grant_definition(
      CASE WHEN item.identity LIKE 'static_weekly_v2_materialize_projection(%' THEN 'public.'||item.identity ELSE item.identity END)
      IS DISTINCT FROM expected_grant
   THEN RAISE EXCEPTION 'Pending pinned original grant recovery row differs';END IF;
  END IF;
 END LOOP;
 -- Fixed SAME-OID deparse profile, as canonical287. Restore Source path BEFORE
 -- ordinary Source lookup/mutation. Neither guard is replaced or weakened.
 PERFORM set_config('search_path','pg_catalog',true);
 UPDATE pg_temp.pending_inventory_guard_before t SET canonical_definition=pg_get_triggerdef(t.oid,true);
 PERFORM set_config('search_path',source_path,true);
 IF (SELECT count(*) FROM pending_inventory_guard_before WHERE NOT tgisinternal)<>2
  OR NOT EXISTS(SELECT 1 FROM pending_inventory_guard_before WHERE
   tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgfoid=immutable_oid
   AND tgtype=27 AND tgenabled='A' AND NOT tgisinternal AND tgnargs=0 AND octet_length(tgargs)=0
   AND tgqual IS NULL AND tgattr::text='' AND NOT tgdeferrable AND NOT tginitdeferred
   AND canonical_definition='CREATE TRIGGER trg_custodial_release_authority_restore_inventory_immutable BEFORE DELETE OR UPDATE ON public.custodial_release_authority_restore_inventory FOR EACH ROW EXECUTE FUNCTION public.custodial_reject_release_authority_inventory_mutation()')
  OR NOT EXISTS(SELECT 1 FROM pending_inventory_guard_before WHERE
   tgname='custodial_disaster_restore_mutation_fence' AND tgfoid=mutation_oid
   AND tgtype=62 AND tgenabled='O' AND NOT tgisinternal AND tgnargs=0 AND octet_length(tgargs)=0
   AND tgqual IS NULL AND tgattr::text='' AND NOT tgdeferrable AND NOT tginitdeferred
   AND canonical_definition='CREATE TRIGGER custodial_disaster_restore_mutation_fence BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON public.custodial_release_authority_restore_inventory FOR EACH STATEMENT EXECUTE FUNCTION custodial_dr.guard_application_mutation()')
  OR NOT EXISTS(SELECT 1 FROM pg_proc guard_proc WHERE guard_proc.oid=immutable_oid AND guard_proc.proowner='supabase_admin'::regrole
   AND NOT guard_proc.prosecdef AND guard_proc.prokind='f' AND guard_proc.pronargs=0 AND NOT guard_proc.proretset
   AND guard_proc.prorettype='trigger'::regtype AND guard_proc.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
   AND public.static_weekly_digest_text(pg_get_functiondef(guard_proc.oid))='7904db6a14a4c8d2b93cbe4d53ba34f68052e736d15f0a55323fa04c1fae76f6'
   AND public.static_weekly_digest_text(guard_proc.prosrc)='398375253665aa45da0a0d73329ae907605d83ac32b00702f34ce2b730dda80b')
  OR NOT EXISTS(SELECT 1 FROM pg_proc guard_proc WHERE guard_proc.oid=mutation_oid AND guard_proc.proowner='supabase_admin'::regrole
   AND guard_proc.prosecdef AND guard_proc.prokind='f' AND guard_proc.pronargs=0 AND NOT guard_proc.proretset
   AND guard_proc.prorettype='trigger'::regtype AND guard_proc.proconfig=ARRAY['search_path=pg_catalog, custodial_dr']::text[]
   AND public.static_weekly_digest_text(pg_get_functiondef(guard_proc.oid))='c951e5a94562536ef46ccd3bfc4c3dfc6df2a526f3fa75891604ca625cd7c8b7')
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.custodial_release_authority_restore_inventory'::regclass
   AND relowner='supabase_admin'::regrole AND relkind='r' AND relpersistence='p'
   AND NOT relrowsecurity AND NOT relforcerowsecurity AND NOT relhasrules
   AND NOT relispartition AND NOT relhassubclass)
  OR EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid='public.custodial_release_authority_restore_inventory'::regclass
    OR inhparent='public.custodial_release_authority_restore_inventory'::regclass)
 THEN RAISE EXCEPTION 'Pending exact original two inventory guards differ';END IF;
 FOR item IN SELECT immutable_oid oid,ARRAY['postgres']::text[] others UNION ALL SELECT mutation_oid,ARRAY[]::text[] LOOP
  SELECT * INTO STRICT p FROM pg_proc WHERE oid=item.oid;
  IF p.proacl IS NULL OR (SELECT count(*) FROM aclexplode(p.proacl))<>cardinality(item.others)+1
   OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantor<>p.proowner OR a.is_grantable
    OR a.privilege_type<>'EXECUTE' OR a.grantee<>p.proowner AND NOT EXISTS(
     SELECT 1 FROM unnest(item.others) role_name JOIN pg_roles r ON r.rolname=role_name WHERE r.oid=a.grantee))
   OR (SELECT count(DISTINCT grantee) FROM aclexplode(p.proacl))<>cardinality(item.others)+1
  THEN RAISE EXCEPTION 'Pending exact inventory guard original ACL differs';END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=surface_oid AND proowner='supabase_admin'::regrole
   AND public.static_weekly_digest_text(pg_get_functiondef(oid))='26a8cf48811fbf060136ddd94ef9d8dfe63a6bcb3cab0c158c61c45b178903d5')
  OR (SELECT count(*) FROM pending_inventory_before WHERE object_kind IN('function','grant')
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=surface_oid)<>2
  OR NOT EXISTS(SELECT 1 FROM pg_proc canary_proc WHERE canary_proc.oid=surface_oid AND canary_proc.proacl IS NOT NULL
   -- Original native grant row a843e6ab pins PUBLIC + postgres + service_role;
   -- the canary declaration reader is not one of the new private helpers.
   AND (SELECT count(*) FROM aclexplode(canary_proc.proacl))=4
   AND (SELECT count(DISTINCT grantee) FROM aclexplode(canary_proc.proacl))=4
   AND NOT EXISTS(SELECT 1 FROM aclexplode(canary_proc.proacl) a
    WHERE a.grantee NOT IN(canary_proc.proowner,0::oid,'postgres'::regrole,'service_role'::regrole) OR a.grantor<>canary_proc.proowner
      OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
  OR (SELECT count(*) FROM pending_inventory_before WHERE object_kind='function'
   AND object_identity='custodial_release_canary_authority_surface()' AND restore_order=100071
   AND definition_sql=pg_get_functiondef(surface_oid)
   AND definition_sha256='26a8cf48811fbf060136ddd94ef9d8dfe63a6bcb3cab0c158c61c45b178903d5')<>1
  OR (SELECT count(*) FROM pending_inventory_before WHERE object_kind='grant'
   AND object_identity='custodial_release_canary_authority_surface()' AND restore_order=1000073
   AND definition_sha256='a843e6ab1177177e039163a3d520b95d6552de8105474a48e390b25302692f48'
   AND definition_sql=public.custodial_release_authority_current_grant_definition('public.custodial_release_canary_authority_surface()'))<>1
  OR EXISTS(SELECT 1 FROM pending_canary_rows_before s JOIN pending_install_targets x
   ON s.object_kind IN('function','grant') AND s.object_identity LIKE '%(%'
    AND split_part(s.object_identity,'(',1) IN(split_part(x.identity,'(',1),'public.'||split_part(x.identity,'(',1)))
  OR EXISTS(SELECT 1 FROM pending_inventory_before s JOIN pending_install_targets x
   ON s.object_identity LIKE '%(%' AND split_part(s.object_identity,'(',1)
    IN(split_part(x.identity,'(',1),'public.'||split_part(x.identity,'(',1)))
 THEN RAISE EXCEPTION 'Pending exact canary/grant/recovery predecessor differs';END IF;
 -- Existing normal append-after-function / append-after-grant protocol
 -- (20261006211215), with explicit rank instead of arbitrary loop order.
 SELECT min(restore_order) INTO min_grant FROM pending_inventory_before WHERE object_kind='grant';
 -- Preserve interleaved original policy/other rows too. The native source
 -- has function800048 followed by policy800049; neither may be overwritten.
 -- Append after the COMPLETE original pre-grant phase, before its first grant.
 SELECT max(restore_order) INTO function_base FROM pending_inventory_before WHERE restore_order<min_grant;
 SELECT max(restore_order) INTO grant_base FROM pending_inventory_before WHERE object_kind='grant';
 IF function_base IS NULL OR grant_base IS NULL OR function_base::bigint+14>=min_grant
  OR function_base<(SELECT max(restore_order) FROM pending_inventory_before WHERE object_kind='function')
  OR grant_base::bigint+14>2147483647
 THEN RAISE EXCEPTION 'Pending normal dependency order has no closed function/grant tail';END IF;
 INSERT INTO pending_order_plan SELECT 'function',identity,function_base+rank FROM pending_install_targets
  UNION ALL SELECT 'grant',identity,grant_base+rank FROM pending_install_targets;
 IF EXISTS(SELECT 1 FROM pending_order_plan x JOIN pending_inventory_before i ON i.restore_order=x.restore_order)
 THEN RAISE EXCEPTION 'Pending fixed dependency-order tail collides';END IF;
END $pending_original_source$;

-- BEGIN BYTE-IDENTICAL REVIEWED COMPONENT
-- SOURCE-ONLY PROPOSAL. Not a migration, activation or callable approval API.
-- Existing runtime/worker join is mounted locally and its new child path ran;
-- SQL bodies/copy seams remain native NOT_RUN. Do not activate this draft.
-- Install only in Main's original-owner guarded schema transaction. No GRANT,
-- role/default-policy change, ordinary compiler label or solver attestation.
DO $pending_predecessors$
DECLARE r record;actual text;
BEGIN
 IF current_user<>session_user THEN RAISE EXCEPTION 'Pending installer original owner required';END IF;
 FOR r IN SELECT * FROM(VALUES
 ('public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)','89a466f0bffde02f63c64ff0d7c72abe3604bd2c63d8305be48571fbe54ea956'),
 ('public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)','edf3169446972f40fe8db0e88f303ec4d77924fd7cfb2ac8a6ade959af159c5f'),
 ('public.static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)','8e49cc5b4a319978b4193bfcf35ec40e54d0311e21e6961c06419cc390311a15'),
 ('public.static_weekly_compiler_exception_set(uuid,date)','53bd75e28b947dc643fc711b3684be7e1cdc651fccab2a6cb13aedc5b8ef0529'),
 ('public.static_weekly_assert_approved_dated_projection(jsonb,uuid,date,jsonb)','b5fa8207cc41f61af72637a58977064da43b74e18a6cb5d4dfdf0143af44d863'),
 ('public.static_weekly_approved_dated_effective_work(uuid,date,jsonb)','334e48f0f65374b90809c372e841db57986446b73a59f7d00f9f665918971905'),
 ('public.static_weekly_assert_approved_dated_lunch(uuid,jsonb)','9534c73ba4914f38e0e02dfbe002ef31d39679409a7143e314899aa02a2ffea1'),
 ('public.static_weekly_v8_assert_lunch_document(uuid,jsonb)','4394b8c94dbfe298f673e0c593ebd0191d79ff01617b16e03d5fc0e4e361e1bf'),
 ('public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','c38d665aff22a47b0eee8158bc234973eba3bc098a188477c6467548a100c796')
 ) x(identity,body_sha) LOOP
  IF to_regprocedure(r.identity) IS NULL THEN RAISE EXCEPTION 'Pending original Source dependency missing';END IF;
  actual:=pg_get_functiondef(to_regprocedure(r.identity));
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.identity) AND p.proowner=current_user::regrole
   AND public.static_weekly_digest_text(p.prosrc)=r.body_sha)
   OR (SELECT count(*) FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='function'
    AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=to_regprocedure(r.identity)
    AND i.definition_sql=actual AND i.definition_sha256=public.static_weekly_digest_text(actual))<>1
   -- This original helper has a registered FUNCTION but no GRANT row.
   -- Same exact native-qualified original ACL as the dated installer: require
   -- absent recovery row AND pinned live privileges/grantor, not a fallback.
   OR (CASE WHEN r.identity='public.static_weekly_compiler_exception_set(uuid,date)' THEN
    EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='grant'
     AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=to_regprocedure(r.identity))
    OR public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(
     'static_weekly_compiler_exception_set(uuid,date)'))
     IS DISTINCT FROM '5e045b2e87eeab69f63d6e165e816477b4d9b428dbf668ae381edbfbe8c995fb'
    OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE p.oid=to_regprocedure(r.identity) AND a.grantee<>p.proowner AND a.grantor<>p.proowner)
   ELSE (SELECT count(*) FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='grant'
    AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=to_regprocedure(r.identity)
    AND i.definition_sql=public.custodial_release_authority_current_grant_definition(i.object_identity))<>1 END)
  THEN RAISE EXCEPTION 'Pending exact original definition owner or ACL differs';END IF;
 END LOOP;
END $pending_predecessors$;

-- Actual ledger/actor/epoch determines phase; there is no submitted phase flag.
CREATE FUNCTION public.static_weekly_pending_context(p_operation uuid,p_manager uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $context$
DECLARE c public.static_weekly_staffing_commands%rowtype;a public.static_weekly_staffing_absences%rowtype;
 original public.static_weekly_staffing_commands%rowtype;actor jsonb;revision bigint;after_fact boolean:=false;target jsonb:=NULL;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 actor:=public.static_weekly_v3_manager_actor(p_manager);
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation FOR UPDATE;
 SELECT current_revision INTO STRICT revision FROM public.static_weekly_schedule_control WHERE singleton FOR SHARE;
 IF c.prepared_by_manager_id IS DISTINCT FROM p_manager OR c.state NOT IN('PREPARING','PREPARED')
  OR c.command_kind NOT IN('absence','cancel_absence') OR c.expected_revision NOT BETWEEN 0 AND 9007199254740990
  OR c.semantic_body IS DISTINCT FROM jsonb_build_object('absenceKind',c.absence_kind,'commandKind',c.command_kind,
   'employeeId',c.employee_id::text,'endDate',c.end_date::text,'startDate',c.start_date::text,'targetAbsenceId',c.target_absence_id)
  OR c.semantic_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(c.semantic_body)
  OR c.end_date<c.start_date OR c.end_date-c.start_date>=366 OR c.start_date<public.sch_service_date(statement_timestamp())
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Pending exact original command unavailable';END IF;
 IF c.command_kind='absence' THEN
  IF c.target_absence_id IS NOT NULL OR c.absence_kind NOT IN('daily_absence','pto','unavailable')
   OR NOT EXISTS(SELECT 1 FROM public.employees WHERE id=c.employee_id AND active) THEN RAISE EXCEPTION 'Pending employee or kind differs';END IF;
  SELECT * INTO a FROM public.static_weekly_staffing_absences WHERE absence_id=c.operation_id;
  IF FOUND THEN
   IF a.accepted_operation_id<>c.operation_id OR a.employee_id<>c.employee_id OR a.start_date<>c.start_date OR a.end_date<>c.end_date
    OR a.absence_kind<>c.absence_kind OR a.accepted_by_manager_id<>p_manager OR a.accepted_revision<>c.expected_revision+1
   THEN RAISE EXCEPTION 'Pending original accepted absence differs';END IF;
   after_fact:=true;
  END IF;
 ELSE
  IF c.absence_kind IS NOT NULL OR c.target_absence_id IS NULL THEN RAISE EXCEPTION 'Pending cancellation kind differs';END IF;
  SELECT * INTO STRICT a FROM public.static_weekly_staffing_absences WHERE absence_id=c.target_absence_id FOR SHARE;
  SELECT * INTO STRICT original FROM public.static_weekly_staffing_commands WHERE operation_id=a.accepted_operation_id FOR SHARE;
  IF a.absence_id<>a.accepted_operation_id OR a.employee_id<>c.employee_id OR c.start_date<>greatest(a.start_date,public.sch_service_date(statement_timestamp()))
   OR c.end_date<>a.end_date OR original.state<>'ACCEPTED' OR original.command_kind<>'absence'
   OR original.employee_id<>a.employee_id OR original.start_date<>a.start_date OR original.end_date<>a.end_date
   OR original.absence_kind<>a.absence_kind OR original.target_absence_id IS NOT NULL
   OR original.accepted_revision<>a.accepted_revision OR original.prepared_by_manager_id<>a.accepted_by_manager_id
   OR original.confirmed_by_manager_id<>a.accepted_by_manager_id
   OR original.semantic_digest<>public.static_weekly_digest_jsonb(original.semantic_body)
   OR original.semantic_body<>jsonb_build_object('absenceKind',a.absence_kind,'commandKind','absence','employeeId',a.employee_id::text,
    'endDate',a.end_date::text,'startDate',a.start_date::text,'targetAbsenceId',NULL)
   OR original.accepted_receipt->>'event' IS DISTINCT FROM 'ACCEPTED'
   OR original.accepted_receipt->>'operation_id' IS DISTINCT FROM original.operation_id::text
   OR original.accepted_receipt->>'semantic_digest' IS DISTINCT FROM original.semantic_digest
   OR original.accepted_receipt->>'authority_revision' IS DISTINCT FROM a.accepted_revision::text
  THEN RAISE EXCEPTION 'Pending original cancellation ledger differs';END IF;
  IF EXISTS(SELECT 1 FROM public.static_weekly_staffing_absence_cancellations x WHERE x.absence_id=a.absence_id
   AND (x.accepted_operation_id<>c.operation_id OR x.remaining_start_date<>c.start_date OR x.remaining_end_date<>c.end_date
    OR x.accepted_revision<>c.expected_revision+1 OR x.accepted_by_manager_id<>p_manager)) THEN RAISE EXCEPTION 'Pending target already cancelled or foreign';END IF;
  after_fact:=EXISTS(SELECT 1 FROM public.static_weekly_staffing_absence_cancellations WHERE absence_id=a.absence_id AND accepted_operation_id=c.operation_id);
  target:=jsonb_build_object('absenceId',a.absence_id,'employeeId',a.employee_id,'startDate',a.start_date,'endDate',a.end_date,
   'acceptedOperationId',a.accepted_operation_id,'status','accepted');
 END IF;
 IF after_fact THEN
  IF c.state<>'PREPARED' OR revision<>c.expected_revision+1
   OR current_setting('app.static_weekly_staffing_batch_operation',true) IS DISTINCT FROM c.operation_id::text
   OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_authority_revisions r WHERE r.authority_revision=revision
    AND r.command_id=c.operation_id AND r.operation='apply_staffing_command' AND r.actor_manager_id=p_manager)
  THEN RAISE EXCEPTION 'Pending original fact is outside its native acceptance transaction';END IF;
 ELSIF revision<>c.expected_revision THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Pending original revision changed';END IF;
 RETURN jsonb_build_object('originalCommand',jsonb_build_object('operationId',c.operation_id,'preparerId',c.prepared_by_manager_id,
  'semanticBody',c.semantic_body,'semanticDigest',c.semantic_digest,'expectedRevision',c.expected_revision,
  'currentServiceDate',public.sch_service_date(statement_timestamp()),'originalCancellationTarget',target),
  'afterFact',after_fact,'actor',actor);
END $context$;

-- Copy the exact original accepted-exception reader, excluding ONLY this native
-- operation's own new fact (or its cancellation), to reconstruct the before-set.
DO $pending_exception_reader$
DECLARE original text;changed text;inverse text;needle text;replacement text;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_compiler_exception_set(uuid,date)'::regprocedure);
 IF to_regprocedure('public.static_weekly_pending_original_exception_set(uuid,date,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Pending reader exists';END IF;
 changed:=replace(original,'FUNCTION public.static_weekly_compiler_exception_set(p_publication_id uuid, p_week_start date)',
  'FUNCTION public.static_weekly_pending_original_exception_set(p_publication_id uuid, p_week_start date, p_operation uuid)');
 IF changed=original THEN RAISE EXCEPTION 'Pending reader exact header differs';END IF;
 needle:='where day.service_date between p_week_start and p_week_start+6';replacement:=needle||' and a.accepted_operation_id<>p_operation';
 IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending original absence seam differs';END IF;
 changed:=replace(changed,needle,replacement);
 needle:='where c.absence_id=a.absence_id';replacement:=needle||' and c.accepted_operation_id<>p_operation';
 IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending original cancellation seam differs';END IF;
 changed:=replace(changed,needle,replacement);changed:=replace(changed,'SECURITY DEFINER','SECURITY INVOKER');
 inverse:=replace(changed,'FUNCTION public.static_weekly_pending_original_exception_set(p_publication_id uuid, p_week_start date, p_operation uuid)',
  'FUNCTION public.static_weekly_compiler_exception_set(p_publication_id uuid, p_week_start date)');
 inverse:=replace(inverse,' and a.accepted_operation_id<>p_operation','');inverse:=replace(inverse,' and c.accepted_operation_id<>p_operation','');
 inverse:=replace(inverse,'SECURITY INVOKER','SECURITY DEFINER');
 IF inverse<>original THEN RAISE EXCEPTION 'Pending original reader inverse differs';END IF;EXECUTE changed;
END $pending_exception_reader$;

CREATE FUNCTION public.static_weekly_pending_exception_set(p_operation uuid,p_publication uuid,p_week date,p_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $exceptions$
DECLARE c public.static_weekly_staffing_commands%rowtype;ctx jsonb;result jsonb;d date;slot uuid;version uuid;row jsonb;
BEGIN
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 ctx:=public.static_weekly_pending_context(p_operation,c.prepared_by_manager_id);
 IF p_week IS NULL OR extract(isodow FROM p_week)<>1 OR p_week>c.end_date OR p_week+6<c.start_date
  OR p_day IS NOT NULL AND (p_day NOT BETWEEN greatest(p_week,c.start_date) AND least(p_week+6,c.end_date))
 THEN RAISE EXCEPTION 'Pending scope differs';END IF;
 SELECT version_id INTO STRICT version FROM public.weekly_schedule_publications WHERE publication_id=p_publication;
 IF public.static_weekly_effective_version(p_week)<>version OR public.static_weekly_effective_version(p_week+6)<>version
 THEN RAISE EXCEPTION 'Pending publication changed within week';END IF;
 result:=public.static_weekly_pending_original_exception_set(p_publication,p_week,p_operation);
 IF c.command_kind='cancel_absence' THEN
  SELECT coalesce(jsonb_agg(e ORDER BY n),'[]') INTO result FROM jsonb_array_elements(result) WITH ORDINALITY x(e,n)
   WHERE (e->>'staffingAbsenceId'=c.target_absence_id::text AND (e->>'serviceDate')::date BETWEEN c.start_date AND c.end_date
    AND (p_day IS NULL OR (e->>'serviceDate')::date=p_day)) IS NOT TRUE;
 ELSE
  FOR d IN SELECT generate_series(greatest(p_week,c.start_date),least(p_week+6,c.end_date),'1 day')::date LOOP
   IF p_day IS NOT NULL AND d<>p_day THEN CONTINUE;END IF;
   SELECT i.slot_id INTO STRICT slot FROM public.v_weekly_roster_slot_incumbency_ranges i WHERE i.person_id=c.employee_id
    AND i.effective_start<=d AND (i.effective_end IS NULL OR d<i.effective_end);
   row:=jsonb_build_object('id',c.operation_id::text||':'||d::text,'type',CASE WHEN c.absence_kind='pto' THEN 'pto' ELSE 'daily_absence' END,
    'serviceDate',d,'staffingAbsenceId',c.operation_id,'staffingAbsenceKind',c.absence_kind,'actorId',c.prepared_by_manager_id,
    'reason','Approved staffing unavailability','idempotencyKey','staffing:'||c.operation_id::text||':'||d::text,
    'expectedRevision',c.expected_revision,'payload',jsonb_build_object('slotId',slot),'baseVersionId',version,'publicationId',p_publication,
    'sequence',c.expected_revision+1+(d-c.start_date));
   -- No accepted/status flag is exported or trusted on this proposed fact.
   result:=result||jsonb_build_array(row);
  END LOOP;
 END IF;
 SELECT coalesce(jsonb_agg(e ORDER BY e->>'serviceDate',(e->>'sequence')::bigint,e->>'id' COLLATE "C"),'[]') INTO result FROM jsonb_array_elements(result) e;
 RETURN result;
END $exceptions$;
CREATE FUNCTION public.static_weekly_pending_summary(p_operation uuid,p_publication uuid,p_week date,p_day date)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $summary$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e->'id','type',e->'type','serviceDate',e->'serviceDate',
  'payloadDigest',coalesce(e->'payloadDigest',to_jsonb(public.static_weekly_digest_text(format('{"slotId":"%s"}',e#>>'{payload,slotId}'))))) ORDER BY n),'[]')
 FROM jsonb_array_elements(public.static_weekly_pending_exception_set(p_operation,p_publication,p_week,p_day)) WITH ORDINALITY x(e,n)
$summary$;
CREATE FUNCTION public.static_weekly_pending_applied_summary(p_operation uuid,p_publication uuid,p_week date,p_day date)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $applied$
 SELECT coalesce(jsonb_agg(e ORDER BY extract(dow FROM (e->>'serviceDate')::date),n),'[]')
 FROM jsonb_array_elements(public.static_weekly_pending_summary(p_operation,p_publication,p_week,p_day)) WITH ORDINALITY x(e,n)
$applied$;
CREATE FUNCTION public.static_weekly_pending_day_source(p_operation uuid,p_publication uuid,p_week date,p_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $source$
DECLARE source jsonb;exceptions jsonb;
BEGIN
 source:=public.static_weekly_v3_read_publication_source(p_publication,p_week);
 exceptions:=public.static_weekly_pending_exception_set(p_operation,p_publication,p_week,p_day);
 RETURN jsonb_set(jsonb_set(source,'{exceptions}',exceptions,true),'{compiler_input,exceptions}',exceptions,true);
END $source$;

-- Exact private copies: the ordinary/singleton definitions remain unchanged.
-- Only Source acquisition is replaced with the independently locked native
-- pending relation; every mapping/physical/interval/route/capacity check stays.
DO $pending_day_copies$
DECLARE r record;s record;original text;changed text;inverse text;
BEGIN
 FOR r IN SELECT * FROM(VALUES
  ('public.static_weekly_approved_dated_effective_work(uuid,date,jsonb)','static_weekly_approved_dated_effective_work',
   'static_weekly_pending_effective_work','p_operation uuid, p_day date, '),
  ('public.static_weekly_assert_approved_dated_projection(jsonb,uuid,date,jsonb)','static_weekly_assert_approved_dated_projection',
   'static_weekly_pending_assert_day','p_operation uuid, ')
 ) x(identity,old_name,new_name,prefix) LOOP
  original:=pg_get_functiondef(to_regprocedure(r.identity));
  IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=r.new_name) THEN RAISE EXCEPTION 'Pending private copy exists';END IF;
  changed:=replace(original,'FUNCTION public.'||r.old_name||'(','FUNCTION public.'||r.new_name||'('||r.prefix);
  IF changed=original THEN RAISE EXCEPTION 'Pending private copy header differs';END IF;
  FOR s IN SELECT * FROM(VALUES
   ('accepted:=public.static_weekly_compiler_exception_set(p_publication,p_week);',
    'accepted:=public.static_weekly_pending_exception_set(p_operation,p_publication,p_week,p_day);',r.old_name='static_weekly_approved_dated_effective_work'),
   ('raw_source:=public.static_weekly_v3_read_publication_source(p_publication_id,p_week);',
    'raw_source:=public.static_weekly_pending_day_source(p_operation,p_publication_id,p_week,operation_date);',r.old_name='static_weekly_assert_approved_dated_projection'),
   ('compiler_exceptions:=public.static_weekly_compiler_exception_set(p_publication_id,p_week);',
    'compiler_exceptions:=public.static_weekly_pending_exception_set(p_operation,p_publication_id,p_week,operation_date);',r.old_name='static_weekly_assert_approved_dated_projection'),
   ('public.static_weekly_accepted_exception_set(p_publication_id,p_week)',
    'public.static_weekly_pending_applied_summary(p_operation,p_publication_id,p_week,operation_date)',r.old_name='static_weekly_assert_approved_dated_projection'),
   ('public.static_weekly_approved_dated_effective_work(p_publication_id,p_week,',
    'public.static_weekly_pending_effective_work(p_operation,operation_date,p_publication_id,p_week,',r.old_name='static_weekly_assert_approved_dated_projection')
  ) fixed(before_sql,after_sql,apply) WHERE apply LOOP
   IF position(s.before_sql in changed)=0 THEN RAISE EXCEPTION 'Pending day exact Source seam differs';END IF;
   changed:=replace(changed,s.before_sql,s.after_sql);
  END LOOP;
  inverse:=replace(changed,'FUNCTION public.'||r.new_name||'('||r.prefix,'FUNCTION public.'||r.old_name||'(');
  FOR s IN SELECT * FROM(VALUES
   ('accepted:=public.static_weekly_compiler_exception_set(p_publication,p_week);',
    'accepted:=public.static_weekly_pending_exception_set(p_operation,p_publication,p_week,p_day);'),
   ('raw_source:=public.static_weekly_v3_read_publication_source(p_publication_id,p_week);',
    'raw_source:=public.static_weekly_pending_day_source(p_operation,p_publication_id,p_week,operation_date);'),
   ('compiler_exceptions:=public.static_weekly_compiler_exception_set(p_publication_id,p_week);',
    'compiler_exceptions:=public.static_weekly_pending_exception_set(p_operation,p_publication_id,p_week,operation_date);'),
   ('public.static_weekly_accepted_exception_set(p_publication_id,p_week)',
    'public.static_weekly_pending_applied_summary(p_operation,p_publication_id,p_week,operation_date)'),
   ('public.static_weekly_approved_dated_effective_work(p_publication_id,p_week,',
    'public.static_weekly_pending_effective_work(p_operation,operation_date,p_publication_id,p_week,')
  ) fixed(before_sql,after_sql) LOOP inverse:=replace(inverse,s.after_sql,s.before_sql);END LOOP;
  IF inverse IS DISTINCT FROM original THEN RAISE EXCEPTION 'Pending independent validator unrelated Source changed';END IF;
  EXECUTE changed;
 END LOOP;
END $pending_day_copies$;

CREATE FUNCTION public.static_weekly_pending_assert_projection(p_operation uuid,p_manager uuid,p_envelope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $projection$
DECLARE ctx jsonb;c public.static_weekly_staffing_commands%rowtype;snapshot jsonb;source jsonb;before_source jsonb;
 publication uuid;week date;date date;expected_dates jsonb;part jsonb;proof jsonb;first_projection jsonb;chosen jsonb;
 expected_rows jsonb:='[]';expected_availability jsonb:='[]';expected_work jsonb:='[]';links jsonb:='{}';item jsonb;
 basis jsonb;first_basis jsonb;summary jsonb;effective jsonb;actual jsonb;expected jsonb;
BEGIN
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 PERFORM public.static_weekly_assert_exact_object(p_envelope,
  ARRAY['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],
  ARRAY['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],'pending projection');
 snapshot:=p_envelope->'semantic_snapshot';
 PERFORM public.static_weekly_assert_exact_object(snapshot,
  ARRAY['schema','originalCommand','originalSource','scopeDates','weekStart','generation','templateCatalogDigest','templateInputsDigest','partitions'],
  ARRAY['schema','originalCommand','originalSource','scopeDates','weekStart','generation','templateCatalogDigest','templateInputsDigest','partitions'],'pending original snapshot');
 IF snapshot->>'schema' IS DISTINCT FROM 'custodial.approved-static-pending-staffing-projection-snapshot.v1'
  OR snapshot->'originalCommand' IS DISTINCT FROM ctx->'originalCommand'
  OR coalesce(snapshot->>'weekStart','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 THEN RAISE EXCEPTION 'Pending original tuple differs';END IF;
 week:=(snapshot->>'weekStart')::date;
 IF NOT isfinite(week) OR extract(isodow FROM week)<>1 OR week>c.end_date OR week+6<c.start_date THEN RAISE EXCEPTION 'Pending original week differs';END IF;
 publication:=(snapshot#>>'{originalSource,publication_id}')::uuid;
 source:=public.static_weekly_v3_read_publication_source(publication,week);
 before_source:=jsonb_set(jsonb_set(source,'{authority_revision}',to_jsonb(c.expected_revision),false),'{exceptions}',
  public.static_weekly_pending_original_exception_set(publication,week,p_operation),false);
 IF snapshot->'originalSource' IS DISTINCT FROM before_source OR public.static_weekly_effective_version(week+6)::text IS DISTINCT FROM source->>'version_id'
 THEN RAISE EXCEPTION 'Pending original accepted Source differs';END IF;
 SELECT jsonb_agg(d::date::text ORDER BY d) INTO expected_dates
  FROM generate_series(greatest(c.start_date,week),least(c.end_date,week+6),'1 day') d;
 IF snapshot->'scopeDates' IS DISTINCT FROM expected_dates OR jsonb_typeof(snapshot->'partitions') IS DISTINCT FROM 'array'
  OR jsonb_array_length(snapshot->'partitions')<>jsonb_array_length(expected_dates)
 THEN RAISE EXCEPTION 'Pending complete original day partitions required';END IF;
 FOR part IN SELECT value FROM jsonb_array_elements(snapshot->'partitions') WITH ORDINALITY x(value,n) ORDER BY n LOOP
  PERFORM public.static_weekly_assert_exact_object(part,ARRAY['serviceDate','projection'],ARRAY['serviceDate','projection'],'pending day partition');
  IF jsonb_typeof(part->'serviceDate') IS DISTINCT FROM 'string' OR NOT(expected_dates ? (part->>'serviceDate'))
   OR (SELECT count(*) FROM jsonb_array_elements(snapshot->'partitions') p WHERE p->'serviceDate'=part->'serviceDate')<>1
   OR part#>'{projection,authority,scopeDates}' IS DISTINCT FROM jsonb_build_array(part->'serviceDate')
  THEN RAISE EXCEPTION 'Pending duplicate or foreign day partition';END IF;
  date:=(part->>'serviceDate')::date;
  basis:=public.static_weekly_read_approved_template_basis(p_manager,publication,date,'DATED_ABSENCE',NULL,
   CASE WHEN (ctx->>'afterFact')::boolean THEN c.expected_revision+1 ELSE c.expected_revision END);
  IF first_basis IS NULL THEN first_basis:=basis;END IF;
  IF basis->'generation' IS DISTINCT FROM snapshot->'generation'
   OR basis->'templateCatalogDigest' IS DISTINCT FROM snapshot->'templateCatalogDigest'
   OR basis->'templateInputsDigest' IS DISTINCT FROM snapshot->'templateInputsDigest'
   OR basis->'ownerConfig' IS DISTINCT FROM first_basis->'ownerConfig'
  THEN RAISE EXCEPTION 'Pending approved catalog config or generation differs';END IF;
  summary:=public.static_weekly_pending_applied_summary(p_operation,publication,week,date);
  proof:=public.static_weekly_pending_assert_day(p_operation,part->'projection',publication,week,summary);
  IF first_projection IS NULL THEN first_projection:=part->'projection';END IF;
 END LOOP;
 -- Deterministic disjoint composition: one source for every changed day and
 -- the exact same original six-day rows for every component's unaffected day.
 FOR date IN SELECT generate_series(week,week+6,'1 day')::date LOOP
  SELECT value->'projection' INTO chosen FROM jsonb_array_elements(snapshot->'partitions') WHERE value->>'serviceDate'=date::text;
  IF NOT FOUND THEN
   chosen:=first_projection;
   FOR part IN SELECT value FROM jsonb_array_elements(snapshot->'partitions') LOOP
    SELECT coalesce(jsonb_agg(r ORDER BY n),'[]') INTO actual FROM jsonb_array_elements(part#>'{projection,assignments}') WITH ORDINALITY x(r,n) WHERE r->>'service_date'=date::text;
    SELECT coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected FROM jsonb_array_elements(chosen->'assignments') WITH ORDINALITY x(r,n) WHERE r->>'service_date'=date::text;
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Pending unaffected original day changed';END IF;
   END LOOP;
  END IF;
  proof:=public.static_weekly_pending_assert_day(p_operation,chosen,publication,week,
   public.static_weekly_pending_applied_summary(p_operation,publication,week,(chosen#>>'{authority,scopeDates,0}')::date));
  SELECT expected_rows||coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected_rows FROM jsonb_array_elements(chosen->'assignments') WITH ORDINALITY x(r,n) WHERE r->>'service_date'=date::text;
  FOR item IN SELECT value FROM jsonb_array_elements(chosen->'assignments') WHERE value->>'service_date'=date::text LOOP
   links:=links||jsonb_build_object(item->>'plan_work_id',proof#>ARRAY['assignment_links',item->>'plan_work_id']);
  END LOOP;
  SELECT expected_availability||coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected_availability
   FROM jsonb_array_elements(chosen#>'{authority,projectionAvailability}') WITH ORDINALITY x(r,n) WHERE r->>'serviceDate'=date::text;
  SELECT expected_work||coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected_work
   FROM jsonb_array_elements(chosen#>'{authority,overlayCompilerInput,version,assignments}') WITH ORDINALITY x(r,n) WHERE r->>'dayOfWeek'=extract(dow FROM date)::text;
 END LOOP;
 SELECT jsonb_agg(r ORDER BY (r->>'dayOfWeek')::integer,r->>'slotId' COLLATE "C") INTO expected_availability FROM jsonb_array_elements(expected_availability) r;
 SELECT jsonb_agg(r ORDER BY (r->>'dayOfWeek')::integer,r->>'workId' COLLATE "C") INTO expected_work FROM jsonb_array_elements(expected_work) r;
 effective:=jsonb_set(jsonb_set(first_projection#>'{authority,overlayCompilerInput}','{version,assignments}',expected_work,false),
  '{exceptions}',public.static_weekly_pending_exception_set(p_operation,publication,week,NULL),false);
 expected:=jsonb_build_object('schema','custodial.approved-static-pending-staffing-authority.v1','effectiveDate',week,
  'compilerInput',first_projection#>'{authority,compilerInput}','overlayCompilerInput',effective,
  'inputDigest',public.static_weekly_digest_jsonb(effective),'projectionAvailability',expected_availability,'solverInvoked',false,'optimized',false);
 IF p_envelope->'assignments' IS DISTINCT FROM expected_rows OR p_envelope->'authority' IS DISTINCT FROM expected
  OR p_envelope->>'authority_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(expected)
  OR p_envelope->>'database_projection_identity' IS DISTINCT FROM public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
  OR p_envelope->'adapter' IS DISTINCT FROM '{"schema":"custodial.approved-static-pending-staffing-adapter.v1","version":"approved-static-pending-staffing-v1"}'::jsonb
  OR p_envelope->>'compiler_version' IS DISTINCT FROM 'approved-static-pending-staffing-v1'
  OR p_envelope->>'week_start' IS DISTINCT FROM week::text OR p_envelope->>'service_date' IS DISTINCT FROM week::text
  OR p_envelope->>'week_end' IS DISTINCT FROM (week+6)::text
  OR p_envelope->'objective' IS DISTINCT FROM '{"contract":"FIXED_APPROVED_PENDING_STAFFING_NOT_OPTIMALITY"}'::jsonb
  OR p_envelope->'applied_exceptions' IS DISTINCT FROM public.static_weekly_pending_applied_summary(p_operation,publication,week,NULL)
 THEN RAISE EXCEPTION 'Pending merged exact week projection or original relation differs';END IF;
 PERFORM public.static_weekly_assert_exact_object(p_envelope->'receipt',
  ARRAY['schema','hardConstraintCount','hardConstraintDigest','solverInvoked','optimized'],
  ARRAY['schema','hardConstraintCount','hardConstraintDigest','solverInvoked','optimized'],'pending fixed feasibility DATA');
 IF p_envelope#>>'{receipt,schema}' IS DISTINCT FROM 'custodial.approved-static-pending-feasibility.v1'
  OR p_envelope#>'{receipt,solverInvoked}' IS DISTINCT FROM 'false'::jsonb OR p_envelope#>'{receipt,optimized}' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(p_envelope#>'{receipt,hardConstraintCount}') IS DISTINCT FROM 'number'
  OR (p_envelope#>>'{receipt,hardConstraintCount}')::numeric NOT BETWEEN jsonb_array_length(expected_rows) AND 100000
  OR (p_envelope#>>'{receipt,hardConstraintCount}')::numeric<>trunc((p_envelope#>>'{receipt,hardConstraintCount}')::numeric)
  OR coalesce(p_envelope#>>'{receipt,hardConstraintDigest}','')!~'^[0-9a-f]{64}$'
  OR coalesce(p_envelope->>'replay_digest','')!~'^[0-9a-f]{64}$'
  OR p_envelope->'metrics' IS DISTINCT FROM jsonb_build_object('hardConstraints',p_envelope#>'{receipt,hardConstraintCount}','violations',0)
 THEN RAISE EXCEPTION 'Pending fixed feasibility DATA malformed';END IF;
 IF (ctx->>'afterFact')::boolean AND public.static_weekly_pending_summary(p_operation,publication,week,NULL)
  IS DISTINCT FROM public.static_weekly_accepted_exception_set(publication,week)
 THEN RAISE EXCEPTION 'Pending original semantics did not become the exact accepted facts';END IF;
 IF public.static_weekly_pending_context(p_operation,p_manager) IS DISTINCT FROM ctx THEN RAISE EXCEPTION 'Pending native context changed';END IF;
 RETURN jsonb_build_object('assignment_links',links,'projection_assignments',expected_rows,'afterFact',ctx->'afterFact');
END $projection$;

-- These copies reuse the complete native lunch partition/eligibility/identity
-- derivation. The ephemeral row is DATA checked by pending_assert_projection,
-- never inserted into a table and never represented as persisted.
DO $pending_lunch_copies$
DECLARE r record;s record;original text;changed text;inverse text;
BEGIN
 FOR r IN SELECT * FROM(VALUES
  ('public.static_weekly_v8_assert_lunch_document(uuid,jsonb)','static_weekly_v8_assert_lunch_document',
   'static_weekly_pending_lunch_base','p_projection_id uuid, p_document jsonb',
   'p_projection_id uuid, p_document jsonb, p_envelope jsonb, p_publication uuid, p_week date'),
  ('public.static_weekly_assert_approved_dated_lunch(uuid,jsonb)','static_weekly_assert_approved_dated_lunch',
   'static_weekly_pending_lunch_derivation','p_projection uuid, p_document jsonb',
   'p_projection uuid, p_document jsonb, p_envelope jsonb, p_publication uuid, p_week date, p_operation uuid')
 ) x(identity,old_name,new_name,old_args,new_args) LOOP
  original:=pg_get_functiondef(to_regprocedure(r.identity));
  IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=r.new_name) THEN RAISE EXCEPTION 'Pending private lunch copy exists';END IF;
  changed:=replace(original,'FUNCTION public.'||r.old_name||'('||r.old_args||')','FUNCTION public.'||r.new_name||'('||r.new_args||')');
  IF changed=original THEN RAISE EXCEPTION 'Pending lunch exact header differs';END IF;
  FOR s IN SELECT * FROM(VALUES
   ('select * into projection from public.weekly_schedule_compiled_projections where projection_id=p_projection_id;'||chr(10)||' if not found then raise exception ''lunch projection is missing''; end if;',
    'projection.publication_id:=p_publication;projection.week_start:=p_week;projection.projection_envelope:=p_envelope;projection.authority_digest:=p_envelope->>''authority_digest'';projection.replay_digest:=p_envelope->>''replay_digest'';',
    r.old_name='static_weekly_v8_assert_lunch_document'),
   ('PERFORM public.static_weekly_v8_assert_lunch_document(p_projection,p_document);',
    'PERFORM public.static_weekly_pending_lunch_base(p_projection,p_document,p_envelope,p_publication,p_week);',
    r.old_name='static_weekly_assert_approved_dated_lunch'),
   ('SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_projection;',
    'projection.publication_id:=p_publication;projection.week_start:=p_week;projection.projection_envelope:=p_envelope;projection.authority_digest:=p_envelope->>''authority_digest'';projection.replay_digest:=p_envelope->>''replay_digest'';',
    r.old_name='static_weekly_assert_approved_dated_lunch'),
   ('public.static_weekly_approved_dated_effective_work(projection.publication_id,projection.week_start,source)',
    'public.static_weekly_pending_effective_work(p_operation,NULL,projection.publication_id,projection.week_start,source)',
    r.old_name='static_weekly_assert_approved_dated_lunch')
  ) fixed(before_sql,after_sql,apply) WHERE apply LOOP
   IF (length(changed)-length(replace(changed,s.before_sql,'')))/length(s.before_sql)<>1 THEN RAISE EXCEPTION 'Pending lunch exact Source seam differs';END IF;
   changed:=replace(changed,s.before_sql,s.after_sql);
  END LOOP;
  IF r.old_name='static_weekly_v8_assert_lunch_document' THEN
   IF (length(changed)-length(replace(changed,'SECURITY DEFINER','')))/length('SECURITY DEFINER')<>1 THEN RAISE EXCEPTION 'Pending lunch security predecessor differs';END IF;
   changed:=replace(changed,'SECURITY DEFINER','SECURITY INVOKER');
  END IF;
  inverse:=replace(changed,'FUNCTION public.'||r.new_name||'('||r.new_args||')','FUNCTION public.'||r.old_name||'('||r.old_args||')');
  IF r.old_name='static_weekly_v8_assert_lunch_document' THEN
   inverse:=replace(inverse,'projection.publication_id:=p_publication;projection.week_start:=p_week;projection.projection_envelope:=p_envelope;projection.authority_digest:=p_envelope->>''authority_digest'';projection.replay_digest:=p_envelope->>''replay_digest'';',
    'select * into projection from public.weekly_schedule_compiled_projections where projection_id=p_projection_id;'||chr(10)||' if not found then raise exception ''lunch projection is missing''; end if;');
   inverse:=replace(inverse,'SECURITY INVOKER','SECURITY DEFINER');
  ELSE
   inverse:=replace(inverse,'projection.publication_id:=p_publication;projection.week_start:=p_week;projection.projection_envelope:=p_envelope;projection.authority_digest:=p_envelope->>''authority_digest'';projection.replay_digest:=p_envelope->>''replay_digest'';',
    'SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_projection;');
   inverse:=replace(inverse,'PERFORM public.static_weekly_pending_lunch_base(p_projection,p_document,p_envelope,p_publication,p_week);',
    'PERFORM public.static_weekly_v8_assert_lunch_document(p_projection,p_document);');
   inverse:=replace(inverse,'public.static_weekly_pending_effective_work(p_operation,NULL,projection.publication_id,projection.week_start,source)',
    'public.static_weekly_approved_dated_effective_work(projection.publication_id,projection.week_start,source)');
  END IF;
  IF inverse IS DISTINCT FROM original THEN RAISE EXCEPTION 'Pending lunch unrelated original Source differs';END IF;
  EXECUTE changed;
 END LOOP;
END $pending_lunch_copies$;

CREATE FUNCTION public.static_weekly_pending_assert_lunch(p_operation uuid,p_manager uuid,p_publication uuid,p_week date,p_envelope jsonb,p_document jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $lunch$
BEGIN
 PERFORM public.static_weekly_pending_assert_projection(p_operation,p_manager,p_envelope);
 IF p_envelope#>>'{semantic_snapshot,originalSource,publication_id}' IS DISTINCT FROM p_publication::text
  OR p_envelope->>'week_start' IS DISTINCT FROM p_week::text THEN RAISE EXCEPTION 'Pending lunch original publication or week differs';END IF;
 IF p_envelope->>'replay_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(jsonb_build_object(
  'projectionAssignments',p_envelope->'assignments','lunchDocument',p_document-ARRAY['base_authority_digest','base_replay_digest','document_identity']))
 THEN RAISE EXCEPTION 'Pending complete merged lunch replay differs';END IF;
 PERFORM public.static_weekly_pending_lunch_derivation(NULL,p_document,p_envelope,p_publication,p_week,p_operation);
END $lunch$;

CREATE FUNCTION public.static_weekly_pending_assert_payload(p_operation uuid,p_manager uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $payload$
DECLARE ctx jsonb;result jsonb;week date;publication uuid;
BEGIN
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);
 PERFORM public.static_weekly_assert_exact_object(p_payload,
  ARRAY['actorManagerId','actorManagerName','compilerVersion','envelope','exceptionSetDigest','expectedRevision','idempotencyKey','metrics','objective','publicationId','replayDigest','serviceDate'],
  ARRAY['actorManagerId','actorManagerName','compilerVersion','envelope','exceptionSetDigest','expectedRevision','idempotencyKey','metrics','objective','publicationId','replayDigest','serviceDate'],'pending twelve-field transport');
 week:=(p_payload->>'serviceDate')::date;publication:=(p_payload->>'publicationId')::uuid;
 IF p_payload->>'actorManagerId' IS DISTINCT FROM p_manager::text OR p_payload->>'actorManagerName' IS DISTINCT FROM ctx#>>'{actor,manager_name}'
  OR p_payload->'expectedRevision' IS DISTINCT FROM ctx#>'{originalCommand,expectedRevision}'
  OR p_payload->>'idempotencyKey' IS DISTINCT FROM 'staffing:'||p_operation::text||':'||week::text
  OR p_payload->>'serviceDate' IS DISTINCT FROM p_payload#>>'{envelope,week_start}'
  OR p_payload->>'publicationId' IS DISTINCT FROM p_payload#>>'{envelope,semantic_snapshot,originalSource,publication_id}'
  OR p_payload->>'compilerVersion' IS DISTINCT FROM p_payload#>>'{envelope,compiler_version}'
  OR p_payload->'objective' IS DISTINCT FROM p_payload#>'{envelope,objective}'
  OR p_payload->'metrics' IS DISTINCT FROM p_payload#>'{envelope,metrics}'
  OR p_payload->>'replayDigest' IS DISTINCT FROM p_payload#>>'{envelope,replay_digest}'
  OR p_payload->>'exceptionSetDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(public.static_weekly_pending_summary(p_operation,publication,week,NULL))
 THEN RAISE EXCEPTION 'Pending transport original identity differs';END IF;
 result:=public.static_weekly_pending_assert_projection(p_operation,p_manager,p_payload->'envelope');
 RETURN result;
END $payload$;

-- Private sink copy. Original v2 and v3 ordinary routes remain byte-identical.
DO $pending_sink_copy$
DECLARE original text;changed text;inverse text;s record;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure);
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='static_weekly_pending_projection_sink')
 THEN RAISE EXCEPTION 'Pending private sink exists';END IF;
 changed:=replace(original,'FUNCTION public.static_weekly_v2_materialize_projection(','FUNCTION public.static_weekly_pending_projection_sink(');
 IF changed=original THEN RAISE EXCEPTION 'Pending exact sink header differs';END IF;
 FOR s IN SELECT * FROM(VALUES
  ('declare v_request jsonb;','declare v_pending_validation jsonb; v_request jsonb;'),
  ('perform public.static_weekly_assert_projection_envelope_attested(p_assignments,p_publication_id,p_service_date,v_exception_set);',
   'v_pending_validation:=public.static_weekly_pending_assert_projection((p_assignments#>>''{semantic_snapshot,originalCommand,operationId}'')::uuid,p_actor_manager_id,p_assignments); IF (v_pending_validation->>''afterFact'')::boolean IS NOT TRUE THEN RAISE EXCEPTION ''Pending sink requires actual original acceptance facts'';END IF;'),
  ($before$select * into v_assignment from public.weekly_schedule_slot_assignments
   where version_id=v_publication.version_id and day_of_week=(v_item->>'day_of_week')::smallint and work_id=v_item->>'work_id';$before$,
   $after$select * into v_assignment from public.weekly_schedule_slot_assignments where assignment_id=nullif(v_pending_validation#>>ARRAY['assignment_links',v_item->>'plan_work_id'],'')::uuid;$after$),
  ($before$if v_assignment.assignment_id is null and (v_work->>'overlayWork') is distinct from 'true' then raise exception using errcode='23514',message='active baseline work must retain its stored baseline assignment link'; end if;$before$,
   $after$if v_assignment.assignment_id is null and not exists(select 1 from jsonb_array_elements(v_pending_validation->'projection_assignments') r where r=v_item) then raise exception using errcode='23514',message='pending work lacks independently checked original lineage';end if;$after$),
  ($before$p_assignments#>>'{authority,schema}'='memphis-zoo.static-weekly-authority.v4'$before$,
   $after$p_assignments#>>'{authority,schema}'='custodial.approved-static-pending-staffing-authority.v1'$after$),
  ('SECURITY DEFINER','SECURITY INVOKER')
 ) fixed(before_sql,after_sql) LOOP
  IF (length(changed)-length(replace(changed,s.before_sql,'')))/length(s.before_sql)<>1 THEN RAISE EXCEPTION 'Pending exact sink Source seam differs';END IF;
  changed:=replace(changed,s.before_sql,s.after_sql);
 END LOOP;
 inverse:=replace(changed,'FUNCTION public.static_weekly_pending_projection_sink(','FUNCTION public.static_weekly_v2_materialize_projection(');
 FOR s IN SELECT * FROM(VALUES
  ('declare v_request jsonb;','declare v_pending_validation jsonb; v_request jsonb;'),
  ('perform public.static_weekly_assert_projection_envelope_attested(p_assignments,p_publication_id,p_service_date,v_exception_set);',
   'v_pending_validation:=public.static_weekly_pending_assert_projection((p_assignments#>>''{semantic_snapshot,originalCommand,operationId}'')::uuid,p_actor_manager_id,p_assignments); IF (v_pending_validation->>''afterFact'')::boolean IS NOT TRUE THEN RAISE EXCEPTION ''Pending sink requires actual original acceptance facts'';END IF;'),
  ($before$select * into v_assignment from public.weekly_schedule_slot_assignments
   where version_id=v_publication.version_id and day_of_week=(v_item->>'day_of_week')::smallint and work_id=v_item->>'work_id';$before$,
   $after$select * into v_assignment from public.weekly_schedule_slot_assignments where assignment_id=nullif(v_pending_validation#>>ARRAY['assignment_links',v_item->>'plan_work_id'],'')::uuid;$after$),
  ($before$if v_assignment.assignment_id is null and (v_work->>'overlayWork') is distinct from 'true' then raise exception using errcode='23514',message='active baseline work must retain its stored baseline assignment link'; end if;$before$,
   $after$if v_assignment.assignment_id is null and not exists(select 1 from jsonb_array_elements(v_pending_validation->'projection_assignments') r where r=v_item) then raise exception using errcode='23514',message='pending work lacks independently checked original lineage';end if;$after$),
  ($before$p_assignments#>>'{authority,schema}'='memphis-zoo.static-weekly-authority.v4'$before$,
   $after$p_assignments#>>'{authority,schema}'='custodial.approved-static-pending-staffing-authority.v1'$after$),
  ('SECURITY DEFINER','SECURITY INVOKER')
 ) fixed(before_sql,after_sql) LOOP inverse:=replace(inverse,s.after_sql,s.before_sql);END LOOP;
 IF inverse IS DISTINCT FROM original THEN RAISE EXCEPTION 'Pending sink unrelated Source differs';END IF;EXECUTE changed;
END $pending_sink_copy$;

-- Exact finite branch patches of existing entrypoints. No public new endpoint,
-- privilege, role switch, transaction boundary or ordinary behavior change.
DO $pending_staffing_boundaries$
DECLARE r record;s record;original text;changed text;inverse text;needle text;replacement text;accept_original text;accept_replacement text;
BEGIN
 FOR r IN SELECT * FROM(VALUES
  ('public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)','stage'),
  ('public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)','accept'),
  ('public.static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)','matcher')
 ) x(identity,kind) LOOP
  original:=pg_get_functiondef(to_regprocedure(r.identity));changed:=original;
  IF r.kind='stage' THEN
   needle:='declare actor jsonb;';replacement:='declare v_pending record;v_pending_lunch jsonb; actor jsonb;';
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending stage declaration differs';END IF;
   changed:=replace(changed,needle,replacement);
   needle:=' insert into public.static_weekly_staffing_staged_candidates(operation_id,candidate_kind,candidate_key,service_date,';
   replacement:=$stage$
 -- BEGIN PRIVATE ORIGINAL-PENDING APPROVED STAGE
 FOR v_pending IN SELECT item->'payload' payload,item->>'serviceDate' AS service_date_text FROM jsonb_array_elements(p_candidates) item
  WHERE item->>'candidateKind'='projection' AND item#>>'{payload,envelope,semantic_snapshot,schema}'='custodial.approved-static-pending-staffing-projection-snapshot.v1' LOOP
  IF v_pending.payload->>'serviceDate' IS DISTINCT FROM v_pending.service_date_text
   OR p_publication_vector->'expectedRevision' IS DISTINCT FROM to_jsonb(command.expected_revision)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_publication_vector->'weeks') w
    WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(w) k)=ARRAY['authorityRevision','publicationId','versionId','weekStart']::text[]
     AND w->>'weekStart'=v_pending.service_date_text AND w->'authorityRevision'=to_jsonb(command.expected_revision)
     AND w->'publicationId'=v_pending.payload->'publicationId'
     AND w->'versionId'=v_pending.payload#>'{envelope,semantic_snapshot,originalSource,version_id}')
  THEN RAISE EXCEPTION 'Pending original publication vector differs';END IF;
  PERFORM public.static_weekly_pending_assert_payload(p_operation_id,p_manager_id,v_pending.payload);
  SELECT item->'payload' INTO STRICT v_pending_lunch FROM jsonb_array_elements(p_candidates) item
   WHERE item->>'candidateKind'='lunch' AND item->>'serviceDate'=v_pending.service_date_text;
  PERFORM public.static_weekly_pending_assert_lunch(p_operation_id,p_manager_id,(v_pending.payload->>'publicationId')::uuid,
   v_pending.service_date_text::date,v_pending.payload->'envelope',v_pending_lunch);
 END LOOP;
 -- END PRIVATE ORIGINAL-PENDING APPROVED STAGE
$stage$||needle;
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending stage insert seam differs';END IF;
   changed:=replace(changed,needle,replacement);
   inverse:=replace(changed,replacement,needle);
   inverse:=replace(inverse,'declare v_pending record;v_pending_lunch jsonb; actor jsonb;','declare actor jsonb;');
  ELSIF r.kind='accept' THEN
   needle:='declare actor jsonb;';replacement:='declare v_pending_check jsonb; actor jsonb;';
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending accept declaration differs';END IF;
   changed:=replace(changed,needle,replacement);
   needle:=$original_projection$  v_signed_envelope:=jsonb_set(v_payload->'envelope','{attestation}',
   public.static_weekly_v3_issue_attestation('dated_projection',
    public.static_weekly_projection_attestation_payload(v_payload->'envelope')),true);
  select * into v_existing from public.weekly_schedule_compiled_projections p
   where p.publication_id=(v_payload->>'publicationId')::uuid
    and p.week_start=v_projection_candidate.service_date
    and p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(
     (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date))
    and p.compiler_version=v_payload->>'compilerVersion'
    and p.authority_digest=v_signed_envelope->>'authority_digest'
   order by p.compiled_at desc,p.projection_id desc limit 1;
  v_reused:=found;
  if v_reused then
   if (v_existing.projection_envelope-array['attestation','receipt','database_projection_identity']) is distinct from
      (v_signed_envelope-array['attestation','receipt','database_projection_identity']) then
    raise exception using errcode='23514',message='historical projection identity conflicts with the exact staged candidate';end if;
   v_projection:=v_existing.projection_id;
   v_command_id:=gen_random_uuid();
   v_request:=jsonb_build_object('operation','materialize_projection','publication_id',(v_payload->>'publicationId')::uuid,
    'service_date',v_projection_candidate.service_date,'exception_set_digest',v_existing.exception_set_digest,
    'compiler_version',v_existing.compiler_version,'objective',v_existing.objective_json,'metrics',v_existing.metrics_json,
    'replay_digest',v_existing.replay_digest,'projection_envelope',v_existing.projection_envelope,
    'expected_revision',command.expected_revision,'actor_manager_id',p_manager_id,'actor_manager_name',actor->>'manager_name');
   v_request_digest:=public.static_weekly_digest_jsonb(v_request);
   v_projection_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
    'publication_id',v_existing.publication_id,'week_start',v_existing.week_start,
    'exception_set_digest',v_existing.exception_set_digest,'compiler_version',v_existing.compiler_version,
    'objective',v_existing.objective_json,'metrics',v_existing.metrics_json,'replay_digest',v_existing.replay_digest,
    'projection_envelope_identity',v_existing.projection_envelope->>'database_projection_identity',
    'attestation',v_existing.projection_envelope->'attestation'));
   v_projection_receipt:=public.static_weekly_response_json('materialize_projection',v_revision,
    v_projection_content_digest,v_request_digest,jsonb_build_object('projection_id',v_projection,
     'publication_id',v_existing.publication_id,'week_start',v_existing.week_start,
     'week_end',v_existing.week_end,'replay_digest',v_existing.replay_digest));
   insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,
    command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
   values(v_command_id,p_manager_id,actor->>'manager_name','materialize_projection',v_payload->>'idempotencyKey',
    command.expected_revision,v_request_digest,v_request,v_projection_receipt,v_projection_receipt->>'output_digest',v_projection_content_digest);
  else
   v_projection_response:=public.static_weekly_v3_materialize_projection(
    (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date,v_payload->>'exceptionSetDigest',
    v_payload->>'compilerVersion',v_payload->'objective',v_payload->'metrics',v_payload->>'replayDigest',
    v_payload->'envelope',command.expected_revision,p_manager_id,v_payload->>'idempotencyKey');
   v_projection:=(v_projection_response#>>'{data,projection_id}')::uuid;
  end if;
$original_projection$;
   replacement:=$accept$
  -- BEGIN PRIVATE ORIGINAL-PENDING APPROVED ACCEPT
  IF v_payload#>>'{envelope,semantic_snapshot,schema}'='custodial.approved-static-pending-staffing-projection-snapshot.v1' THEN
   v_pending_check:=public.static_weekly_pending_assert_payload(command.operation_id,p_manager_id,v_payload);
   IF (v_pending_check->>'afterFact')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Pending original fact not accepted in this transaction';END IF;
   v_projection_response:=public.static_weekly_pending_projection_sink((v_payload->>'publicationId')::uuid,
    v_projection_candidate.service_date,v_payload->>'exceptionSetDigest',v_payload->>'compilerVersion',v_payload->'objective',
    v_payload->'metrics',v_payload->>'replayDigest',v_payload->'envelope',command.expected_revision,p_manager_id,
    actor->>'manager_name',v_payload->>'idempotencyKey');
   v_projection:=(v_projection_response#>>'{data,projection_id}')::uuid;
  ELSE
$accept$||needle||$accept$
  END IF;
  -- END PRIVATE ORIGINAL-PENDING APPROVED ACCEPT
$accept$;
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending exact normal accept segment differs';END IF;
   changed:=replace(changed,needle,replacement);
   accept_original:=needle;accept_replacement:=replacement;
   needle:='  perform public.static_weekly_v8_materialize_lunch_document(v_projection,v_lunch,p_manager_id);';
   replacement:=$accept_lunch$
  IF v_payload#>>'{envelope,semantic_snapshot,schema}'='custodial.approved-static-pending-staffing-projection-snapshot.v1' THEN
   PERFORM public.static_weekly_pending_assert_lunch(command.operation_id,p_manager_id,(v_payload->>'publicationId')::uuid,
    v_projection_candidate.service_date,v_payload->'envelope',v_lunch);
   IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections WHERE projection_id=v_projection
    AND projection_envelope=v_payload->'envelope' AND compiled_by_manager_id=p_manager_id) THEN RAISE EXCEPTION 'Pending exact persisted original projection differs';END IF;
  END IF;
$accept_lunch$||needle;
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending original lunch seam differs';END IF;
   changed:=replace(changed,needle,replacement);
   inverse:=replace(changed,replacement,needle);
   inverse:=replace(inverse,accept_replacement,accept_original);
   inverse:=replace(inverse,'declare v_pending_check jsonb; actor jsonb;','declare actor jsonb;');
  ELSE
   needle:='  signed_envelope:=jsonb_set(candidate.payload_json->''envelope'',''{attestation}'',';
   replacement:=$matcher$
  -- BEGIN PRIVATE ORIGINAL-PENDING BATCH DIGEST
  IF candidate.payload_json#>>'{envelope,semantic_snapshot,schema}'='custodial.approved-static-pending-staffing-projection-snapshot.v1' THEN
   PERFORM public.static_weekly_pending_assert_payload(p_operation_id,p_manager_id,candidate.payload_json);
   expected_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
    'publication_id',(candidate.payload_json->>'publicationId')::uuid,'week_start',(candidate.payload_json->>'serviceDate')::date,
    'exception_set_digest',candidate.payload_json->>'exceptionSetDigest','compiler_version',candidate.payload_json->>'compilerVersion',
    'objective',candidate.payload_json->'objective','metrics',candidate.payload_json->'metrics','replay_digest',candidate.payload_json->>'replayDigest',
    'projection_envelope_identity',candidate.payload_json#>>'{envelope,database_projection_identity}','attestation',NULL));
   IF expected_digest=p_content_digest THEN matches:=matches+1;END IF;
   CONTINUE;
  END IF;
  -- END PRIVATE ORIGINAL-PENDING BATCH DIGEST
$matcher$||needle;
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending normal digest matcher seam differs';END IF;
   changed:=replace(changed,needle,replacement);inverse:=replace(changed,replacement,needle);
  END IF;
  IF inverse IS DISTINCT FROM original THEN RAISE EXCEPTION 'Pending original entrypoint unrelated Source differs';END IF;
  EXECUTE changed;
 END LOOP;
END $pending_staffing_boundaries$;

-- New internals are owner-only. Existing entrypoint ACL/security/RLS/ALWAYS
-- and normal role membership are unchanged. No grants are introduced.
REVOKE ALL ON FUNCTION
 public.static_weekly_pending_context(uuid,uuid),
 public.static_weekly_pending_original_exception_set(uuid,date,uuid),
 public.static_weekly_pending_exception_set(uuid,uuid,date,date),
 public.static_weekly_pending_summary(uuid,uuid,date,date),
 public.static_weekly_pending_applied_summary(uuid,uuid,date,date),
 public.static_weekly_pending_day_source(uuid,uuid,date,date),
 public.static_weekly_pending_effective_work(uuid,date,uuid,date,jsonb),
 public.static_weekly_pending_assert_day(uuid,jsonb,uuid,date,jsonb),
 public.static_weekly_pending_assert_projection(uuid,uuid,jsonb),
 public.static_weekly_pending_lunch_base(uuid,jsonb,jsonb,uuid,date),
 public.static_weekly_pending_lunch_derivation(uuid,jsonb,jsonb,uuid,date,uuid),
 public.static_weekly_pending_assert_lunch(uuid,uuid,uuid,date,jsonb,jsonb),
 public.static_weekly_pending_assert_payload(uuid,uuid,jsonb),
 public.static_weekly_pending_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)
FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,
 static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823,postgres;
-- END BYTE-IDENTICAL REVIEWED COMPONENT


-- All new routines must match the independently Source-derived complete
-- canonical definitions, body hashes and closed private properties BEFORE
-- any recovery row can be serialized. Names alone prove nothing.
DO $pending_installed_source$
DECLARE x record;p pg_proc;lang text;old record;
BEGIN
 FOR x IN SELECT * FROM pending_install_targets ORDER BY rank LOOP
  SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure('public.'||x.identity);
  SELECT lanname INTO STRICT lang FROM pg_language WHERE oid=p.prolang;
  IF p.proowner<>'supabase_admin'::regrole OR p.prosecdef OR p.prokind<>'f'
   OR p.proretset OR p.prorettype<>to_regtype('pg_catalog.'||x.result_type)
   OR lang IS DISTINCT FROM x.language_name OR p.provolatile::text IS DISTINCT FROM x.volatility
   OR p.proparallel<>'u' OR p.proisstrict OR p.proleakproof OR p.provariadic<>0
   OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL OR p.proallargtypes IS NOT NULL
   OR p.proargmodes IS NOT NULL OR p.proargnames IS DISTINCT FROM x.argument_names
   OR p.pronargs<>cardinality(x.argument_names) OR p.prosupport<>0 OR p.prosqlbody IS NOT NULL
   OR p.procost<>100 OR p.prorows<>0 OR p.probin IS NOT NULL
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
   OR public.static_weekly_digest_text(p.prosrc) IS DISTINCT FROM x.body_sha
   OR public.static_weekly_digest_text(pg_get_functiondef(p.oid)) IS DISTINCT FROM x.definition_sha
   OR p.proacl IS NULL OR (SELECT count(*) FROM aclexplode(p.proacl))<>1
   OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner
    OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR public.custodial_release_authority_current_grant_definition(x.identity)
     IS DISTINCT FROM 'select public.custodial_release_authority_reset_grants('||quote_literal(x.identity)||');'
   OR (SELECT count(*) FROM pg_proc q WHERE q.pronamespace='public'::regnamespace
     AND q.proname=split_part(x.identity,'(',1))<>1
  THEN RAISE EXCEPTION 'Pending installed exact private Source signature/body/properties/ACL differs';END IF;
 END LOOP;
 FOR x IN SELECT * FROM pending_install_wrappers LOOP
  SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure('public.'||x.identity);
  SELECT * INTO STRICT old FROM pending_functions_before WHERE oid=p.oid;
  IF to_jsonb(p)-'prosrc' IS DISTINCT FROM to_jsonb(old)-ARRAY['definition_sql','original_comment','prosrc']
   OR obj_description(p.oid,'pg_proc') IS DISTINCT FROM old.original_comment
   OR public.static_weekly_digest_text(p.prosrc) IS DISTINCT FROM x.body_sha
   OR public.static_weekly_digest_text(pg_get_functiondef(p.oid)) IS DISTINCT FROM x.definition_sha
  THEN RAISE EXCEPTION 'Pending existing wrapper OID/owner/ACL/unrelated attributes or exact successor differs';END IF;
 END LOOP;
END $pending_installed_source$;

CREATE TEMP TABLE pending_new_objects ON COMMIT DROP AS
 SELECT 'function'::text kind,x.identity,pg_get_functiondef(to_regprocedure('public.'||x.identity)) definition_sql
 FROM pending_install_targets x
 UNION ALL SELECT 'grant',x.identity,'select public.custodial_release_authority_reset_grants('||quote_literal(x.identity)||');'
 FROM pending_install_targets x;
CREATE TEMP TABLE pending_changed_originals ON COMMIT DROP AS
 SELECT i.*,NULL::text successor_definition,NULL::text successor_sha,NULL::timestamptz registration_time
 FROM pending_inventory_before i WHERE i.object_kind='function' AND i.object_identity LIKE '%(%'
  AND (EXISTS(SELECT 1 FROM pending_install_wrappers w WHERE to_regprocedure('public.'||w.identity)=to_regprocedure(i.object_identity))
    OR to_regprocedure(i.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure);
CREATE TEMP TABLE pending_canary_successor(definition_sql text NOT NULL) ON COMMIT DROP;
DO $pending_canary_extension$
DECLARE original text;successor text;entries text;old record;p pg_proc;
BEGIN
 SELECT * INTO STRICT old FROM pending_functions_before
  WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;
 original:=old.definition_sql;
 IF public.static_weekly_digest_text(original)<>'26a8cf48811fbf060136ddd94ef9d8dfe63a6bcb3cab0c158c61c45b178903d5'
  OR (length(original)-length(replace(original,'  values','')))/length('  values')<>1
  OR (SELECT count(*) FROM pending_changed_originals)<>4
  OR (SELECT count(*) FROM pending_new_objects)<>28
  OR (SELECT count(*) FROM pending_new_objects WHERE kind='function')<>14
  OR (SELECT count(*) FROM pending_new_objects WHERE kind='grant')<>14
 THEN RAISE EXCEPTION 'Pending exact finite canary extension Source differs';END IF;
 SELECT string_agg('('||quote_literal(kind)||','||quote_literal(identity)||','||
  quote_literal('private independently checked approved pending staffing; no public capability')||'),',E'\n'
  ORDER BY kind,identity COLLATE "C") INTO entries FROM pending_new_objects;
 successor:=replace(original,'  values','  values'||E'\n'||entries);
 IF successor=original OR replace(successor,'  values'||E'\n'||entries,'  values') IS DISTINCT FROM original
 THEN RAISE EXCEPTION 'Pending finite canary inverse differs';END IF;
 EXECUTE successor;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=old.oid;
 IF pg_get_functiondef(p.oid) IS DISTINCT FROM successor
  OR to_jsonb(p)-'prosrc' IS DISTINCT FROM to_jsonb(old)-ARRAY['definition_sql','original_comment','prosrc']
  OR obj_description(p.oid,'pg_proc') IS DISTINCT FROM old.original_comment
 THEN RAISE EXCEPTION 'Pending canary extension changed original owner/ACL/attributes';END IF;
 INSERT INTO pending_canary_successor VALUES(successor);
 IF EXISTS(
  (SELECT * FROM pending_canary_rows_before
   EXCEPT ALL SELECT * FROM public.custodial_release_canary_authority_surface())
  UNION ALL
  (SELECT * FROM public.custodial_release_canary_authority_surface()
   EXCEPT ALL (SELECT * FROM pending_canary_rows_before UNION ALL
    SELECT kind,identity,'private independently checked approved pending staffing; no public capability'::text FROM pending_new_objects)))
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface())
    <>(SELECT count(*) FROM pending_canary_rows_before)+28
 THEN RAISE EXCEPTION 'Pending canary membership changed beyond exact declarations';END IF;
END $pending_canary_extension$;

UPDATE pending_changed_originals i SET successor_definition=pg_get_functiondef(to_regprocedure(i.object_identity)),
 successor_sha=public.static_weekly_digest_text(pg_get_functiondef(to_regprocedure(i.object_identity))),
 registration_time=statement_timestamp();
-- Sole metadata exception: same captured-owner protocol as canonical287.
-- Never disable the normal O application mutation statement fence.
ALTER TABLE public.custodial_release_authority_restore_inventory
 DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $pending_recovery_registration$
DECLARE r record;changed integer;
BEGIN
 FOR r IN SELECT * FROM pending_changed_originals ORDER BY restore_order LOOP
  UPDATE public.custodial_release_authority_restore_inventory i SET
   definition_sql=r.successor_definition,definition_sha256=r.successor_sha,captured_at=r.registration_time
   WHERE i.inventory_id=r.inventory_id AND to_jsonb(i) IS NOT DISTINCT FROM
    to_jsonb(r)-ARRAY['successor_definition','successor_sha','registration_time'];
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'Pending exact one-row original recovery update refused';END IF;
 END LOOP;
 INSERT INTO public.custodial_release_authority_restore_inventory
  (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
 SELECT o.restore_order,n.kind,n.identity,n.definition_sql,public.static_weekly_digest_text(n.definition_sql)
 FROM pending_new_objects n JOIN pending_order_plan o ON o.kind=n.kind AND o.identity=n.identity
 ORDER BY o.restore_order;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>28 THEN RAISE EXCEPTION 'Pending exact private recovery membership differs';END IF;
END $pending_recovery_registration$;
ALTER TABLE public.custodial_release_authority_restore_inventory
 ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;

-- Native JSONB below preserves native catalog scalar types; it is not
-- JavaScript-decoded metadata. Full duplicate-preserving inverse rowsets.
CREATE TEMP VIEW pending_catalog_current AS
 SELECT 'class',c.oid,to_jsonb(c) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','custodial_dr')
 UNION ALL SELECT 'attribute',a.attrelid,to_jsonb(a) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','custodial_dr')
 UNION ALL SELECT 'trigger',t.oid,to_jsonb(t) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','custodial_dr')
 UNION ALL SELECT 'policy',p.oid,to_jsonb(p) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','custodial_dr')
 UNION ALL SELECT 'constraint',p.oid,to_jsonb(p) FROM pg_constraint p JOIN pg_namespace n ON n.oid=p.connamespace WHERE n.nspname IN('public','custodial_dr')
 UNION ALL SELECT 'namespace',n.oid,to_jsonb(n) FROM pg_namespace n WHERE n.nspname IN('public','custodial_dr')
 UNION ALL SELECT 'role',p.oid,to_jsonb(p) FROM pg_roles p
 UNION ALL SELECT 'membership',0::oid,to_jsonb(m) FROM pg_auth_members m
 UNION ALL SELECT 'default_acl',p.oid,to_jsonb(p) FROM pg_default_acl p;
DO $pending_final_scope$
DECLARE x record;p pg_proc;old record;source_path text:=current_setting('search_path');actual text;
BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)
    <>(SELECT count(*) FROM pending_inventory_before)+28
  OR EXISTS(
   (SELECT i.* FROM pending_inventory_before i WHERE NOT EXISTS(SELECT 1 FROM pending_changed_originals c WHERE c.inventory_id=i.inventory_id)
    EXCEPT ALL SELECT * FROM public.custodial_release_authority_restore_inventory)
   UNION ALL
   (SELECT i.* FROM public.custodial_release_authority_restore_inventory i
    WHERE NOT EXISTS(SELECT 1 FROM pending_changed_originals c WHERE c.inventory_id=i.inventory_id)
     AND NOT EXISTS(SELECT 1 FROM pending_new_objects n WHERE n.kind=i.object_kind AND n.identity=i.object_identity)
    EXCEPT ALL SELECT * FROM pending_inventory_before))
  OR EXISTS(SELECT 1 FROM pending_changed_originals c LEFT JOIN public.custodial_release_authority_restore_inventory i
    ON i.inventory_id=c.inventory_id
   WHERE i.inventory_id IS NULL OR to_jsonb(i)-ARRAY['definition_sql','definition_sha256','captured_at']
      IS DISTINCT FROM to_jsonb(c)-ARRAY['definition_sql','definition_sha256','captured_at','successor_definition','successor_sha','registration_time']
    OR i.definition_sql IS DISTINCT FROM c.successor_definition OR i.definition_sha256 IS DISTINCT FROM c.successor_sha
    OR i.captured_at IS DISTINCT FROM c.registration_time)
  OR EXISTS(SELECT 1 FROM pending_new_objects n LEFT JOIN public.custodial_release_authority_restore_inventory i
    ON i.object_kind=n.kind AND i.object_identity=n.identity
    LEFT JOIN pending_order_plan o ON o.kind=n.kind AND o.identity=n.identity
   WHERE i.inventory_id IS NULL OR i.restore_order IS DISTINCT FROM o.restore_order
    OR i.definition_sql IS DISTINCT FROM n.definition_sql OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(n.definition_sql))
  OR EXISTS((TABLE pending_catalog_before EXCEPT ALL TABLE pending_catalog_current)
    UNION ALL (TABLE pending_catalog_current EXCEPT ALL TABLE pending_catalog_before))
  OR (SELECT count(*) FROM pg_proc catalog_proc JOIN pg_namespace n ON n.oid=catalog_proc.pronamespace WHERE n.nspname IN('public','custodial_dr'))
    <>(SELECT count(*) FROM pending_functions_before)+14
 THEN RAISE EXCEPTION 'Pending unrelated typed original inventory/security/catalog changed';END IF;
 FOR old IN SELECT * FROM pending_functions_before LOOP
  SELECT * INTO STRICT p FROM pg_proc WHERE oid=old.oid;
  IF obj_description(p.oid,'pg_proc') IS DISTINCT FROM old.original_comment
   OR to_jsonb(p)-(CASE WHEN EXISTS(SELECT 1 FROM pending_changed_originals c WHERE to_regprocedure(c.object_identity)=p.oid)
       THEN ARRAY['prosrc']::text[] ELSE ARRAY[]::text[] END)
     IS DISTINCT FROM to_jsonb(old)-(ARRAY['definition_sql','original_comment']::text[]||
      CASE WHEN EXISTS(SELECT 1 FROM pending_changed_originals c WHERE to_regprocedure(c.object_identity)=p.oid)
       THEN ARRAY['prosrc']::text[] ELSE ARRAY[]::text[] END)
  THEN RAISE EXCEPTION 'Pending original pg_proc OID/owner/ACL/body or attributes changed';END IF;
 END LOOP;
 -- Revalidate every actual private definition and reset-only recovery row
 -- after metadata writes, not just at the first creation.
 FOR x IN SELECT * FROM pending_install_targets LOOP
  SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure('public.'||x.identity);
  IF p.proowner<>'supabase_admin'::regrole OR p.prosecdef
   OR public.static_weekly_digest_text(pg_get_functiondef(p.oid)) IS DISTINCT FROM x.definition_sha
   OR public.static_weekly_digest_text(p.prosrc) IS DISTINCT FROM x.body_sha
   OR p.proacl IS NULL OR (SELECT count(*) FROM aclexplode(p.proacl))<>1
   OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner
     OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR public.custodial_release_authority_current_grant_definition(x.identity)
    IS DISTINCT FROM 'select public.custodial_release_authority_reset_grants('||quote_literal(x.identity)||');'
  THEN RAISE EXCEPTION 'Pending final private exact Source/ACL readback differs';END IF;
 END LOOP;
 FOR x IN SELECT * FROM pending_install_wrappers LOOP
  IF public.static_weekly_digest_text(pg_get_functiondef(to_regprocedure('public.'||x.identity))) IS DISTINCT FROM x.definition_sha
   OR public.static_weekly_digest_text((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.'||x.identity))) IS DISTINCT FROM x.body_sha
  THEN RAISE EXCEPTION 'Pending final original wrapper Source differs';END IF;
 END LOOP;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)
    IS DISTINCT FROM (SELECT definition_sql FROM pending_canary_successor)
 THEN RAISE EXCEPTION 'Pending final exact canary Source differs';END IF;
 PERFORM set_config('search_path','pg_catalog',true);
 FOR x IN SELECT * FROM pg_temp.pending_inventory_guard_before LOOP
  SELECT pg_get_triggerdef(t.oid,true) INTO STRICT actual FROM pg_trigger t WHERE t.oid=x.oid;
  IF actual IS DISTINCT FROM x.canonical_definition THEN RAISE EXCEPTION 'Pending original trigger deparse changed';END IF;
 END LOOP;
 PERFORM set_config('search_path',source_path,true);
 IF current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'
  OR current_setting('session_replication_role')<>'origin'
  OR current_setting('transaction_read_only')<>'off'
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled='O')
 THEN RAISE EXCEPTION 'Pending final original context/ALWAYS/normal fence differs';END IF;
END $pending_final_scope$;
COMMIT;
