-- Additive current-source recovery binding after frozen actual current308 R006.
-- Exact local predecessor; no production, release or historical304 admission.
-- Product routines, owners, privileges and original migration bytes are preserved.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SET LOCAL search_path=pg_catalog,public;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
DO $predecessor$
DECLARE inventory_expected constant text:='b22da535ee80c2a64bda0c67e802ce28d28ecfbd6af87ef0a2d92eceafea735b';
 canary_expected constant text:='8ebc65a54c07ba66bb85cc27e3fb7dad39f26033ccbb02d6175979cbaed2b0ac'; actual text;
BEGIN
 IF inventory_expected!~'^[0-9a-f]{64}$' OR canary_expected!~'^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Unqualified draft: actual current308 predecessor pins not bound';END IF;
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin') THEN
  RAISE EXCEPTION 'Maintained migration owner required';END IF;
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A' THEN
  RAISE EXCEPTION 'Original ALWAYS recovery guard required';END IF;
 SELECT public.static_weekly_digest_text(string_agg(restore_order::text||E'\n'||object_kind||E'\n'||object_identity||E'\n'||definition_sha256||E'\n'||public.static_weekly_digest_text(definition_sql),E'\n---\n' ORDER BY object_kind COLLATE "C",object_identity COLLATE "C"))
 INTO actual FROM public.custodial_release_authority_restore_inventory;
 IF actual IS DISTINCT FROM inventory_expected THEN RAISE EXCEPTION 'Exact measured current308 recovery predecessor differs';END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)) IS DISTINCT FROM canary_expected THEN
  RAISE EXCEPTION 'Exact measured current308 canary predecessor differs';END IF;
 IF EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE d.defaclnamespace IN(0,'public'::regnamespace) AND d.defaclobjtype IN('r','S')
   AND a.grantee IN(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)) THEN
  RAISE EXCEPTION 'No API table/sequence defaults required';END IF;
END $predecessor$;
CREATE TEMP TABLE q309_expected_mismatches(kind text,identity text,stored_sha256 text,live_sha256 text,PRIMARY KEY(kind,identity)) ON COMMIT DROP;
INSERT INTO q309_expected_mismatches VALUES
('column','public.custodial_offline_reconciliation_outbox:reconciliation_id','6acb15657cceb3b32478659010548a26f63b8973d9c5c7c44b10b75b31c3d8c1','2b99eaa22fee39a7aeb683cd268eb8b0959d443044bc17834b3c204b885a466c'),
('column_set','public.custodial_offline_reconciliation_outbox','f585d877d1b4f82f89c708eaefe8a6d5f78758f88fe494aad9bfdb0e2a98530c','f53e62237e377924766eca80db8abcfd4726c17f77c87f37aae25fba1cb7df80'),
('constraint','public.custodial_offline_reconciliation_outbox:custodial_offline_reconciliation_outbox_notification_kind_check','4221cfc1c8ba4c839b9700a34bcaf7920f8bc2a8e0acabfcf2ed91a75c6da626','63714ffee189080db10c45347492673db4d9d91a74714669ca202ea28145ccfe'),
('function','capture_system_feedback_email_intent()','88cd48d0f88921c54db35fb1aab538563055c688603262af21dd3507cb5f9c35','ff5e533b61ec6bae4a6b8ba418cffb1a528d1fc56a0838400a60289c1b50fc77'),
('function','custodial_action_actor_v1(uuid,uuid,text,text,text)','c3953e8993ef86cba598973e36bc0dc34bd393dda0bca2dfc398bf97b5fd412a','95ae99a83afdd36703f4bbe439856cd43c774f0662751d1ef8ab38728dc6c872'),
('function','custodial_claim_offline_reconciliation_notification_recipients(uuid,text,uuid,jsonb,text)','b375f7889c415e8176229dacb631eac26ecda812cc29c38e99b68c908e631549','6a090ab7e1cee957e38456208f34c61526ac7ba399444a8280d64163da97a4c4'),
('function','custodial_leadership_private.record_operation_v1(jsonb,text,jsonb)','1483b360a49c661c97e53d27756f62e3dc45a4c435e101605185f718e2e83c88','e82c5955d2483cd8896f9248c3c189178d2b7fde76d3b927e4af7a2d12516854'),
('function','custodial_leadership_record_operation_v1(uuid,uuid,text,text,jsonb)','57f33a5fca39a6ad35ce827615c8c9d799c1cda7067325dc1f73d203b0dffcaf','d66e87a35b3ed757c413a26228283689e077d80cd8f8da049a4f0ca2bb514377'),
('function','custodial_manager_completion_evidence(uuid,text,text)','fa84ea9975f52cb156dd5383b20548c78dfdfc497ec553f27a4a0efed3812ac1','ef4af3f85d530b0a05680ad786a7519dc4ac6d8bb49b6a5c533d1cec1424d390'),
('function','custodial_native_lunch_live(uuid,jsonb,timestamp with time zone)','accd2ed108271bb48dd0f2ddeac0d7fa6943d73fbb53d5358f331bce342418b0','da3acd9c5f3d16be6f1d91879718554a8dd81d534aeecf0813d2f83a1ab0535e'),
('function','custodial_native_target_source_at(text,uuid,uuid,uuid,timestamp with time zone)','120ab6c2021600529e79265da97aeefdf28d3265df032ff1c4edd63c2cee9d9e','7a2821e947ccec13cc97e3bf78437cc5d7676d5cd1212df604282e30e4394d77'),
('function','device_auth_consume_enrollment_operation(uuid,text,uuid,text,text,uuid,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,jsonb)','895521d65cd3b6e025c0cef0b33cb1b8cc3bd71e103cb2f8ed5ab4db0f3f6094','799de0abf1bc517010ad866e4c883e90469bf039c7b0c92128f6585e520c542e'),
('function','expire_stale_open_sessions(timestamp with time zone)','97070694ca30316cf8bea79af865a45a5296846e4f4b0c4f4e8b74ff08c7534c','771a186cde92b9a0cd364202b4c5669f0819100252563624a885732c74f8eb2a'),
('function','mz_enqueue_employee_lunch_coverage_pushes(timestamp with time zone)','50347b4c4db3433b2febbc2876b1585b8cacddfdcd1d5beac066ee309d8d7467','7050c232edad3a8444a6cfa797b143e7b9f56aa81ee76d8ed3700421a36a274b'),
('function','public.custodial_v12_guard_protected_device()','ff340a30703f1fe222b8813ea045a8ab14ffbff7632f5cc143599071d4a2cf5f','6d57a44bc68cf3f92f25d5700fe961efce339f882599afc2024d73dfcf1bea6b'),
('function','public.static_weekly_v22_ack_recurring_application_target(uuid,uuid,uuid,uuid,bigint,bigint,text,text,timestamp with time zone)','12b247915de07ae32eee0209b82ce2c30d7470dbc16184f4cc7f3b5e30b3d6d9','7e0ac56b4236d135d290e3853b4e784ab530e0bc3a4e0f146ff8727773a02175'),
('function','public.static_weekly_v22_read_recurring_application_target(date,uuid,uuid,uuid,bigint)','a2d04f831cce37de5bd503adea6e648f8b99545e24c111a74c9b0764807990da','0cc16424dd3b111469d18808e33a9fc05a2c39e2d87ebef5c40e1e3283cfe0a7'),
('function','public.static_weekly_v22_reconcile_recurring_application_date(date)','fbe23313ab9e85fea04e6901f8367f0051ba9ba550840e4e31c203aaae2ff4d2','54a0778d62ccea3ec42ea8a1770ec42c1488420b93adcee51b85f056c0cac790'),
('function','public.static_weekly_v24_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamp with time zone)','6a07f3cbb6d04adf6f93045a90ef1917a057b4dbcf52530db311e459dbecc89b','bf00c7c7952193dfdbe03472f3ddff733c5cbc77f1777fae8184ef44a4664bf8'),
('function','public.static_weekly_v24_read_device_schedule_delivery(date,uuid,uuid,uuid,bigint)','063b3b106479fc656269ad0729e119d480e65dcac72c6c311dbbfdd65cfe7a38','836a8ae3fa6922373d66ba91cc675a0cd0886c8828690ce4415e343336c69007'),
('function','public.static_weekly_v25_read_current_recurring_delivery(date,uuid)','3bf65a972869ff81372ad3f3952daace5739a139985f685a5b368bbdaaa602d7','c2cf0da085cff2ac50fdc31df3bb5cb928252b68ae14f7bcda5ba5188f8af631'),
('function','public.static_weekly_v27_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamp with time zone)','faa0f55d4896f4363000c5953a2fef8caa864d5db77902a9bf047071d55f3ff2','b0727c271838961e2bc2e9c0a3d7c711c5a9d892f8c7e4dbd71626259d443dc8'),
('function','public.static_weekly_v27_notification_plan_at(date,uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone)','59ae64a1a55284bd5348e2ec7fb6cb607f39123d30cba7969ef9f75d17b2fcf1','6cb15415e12b312bdf20276fc74dd26751d660e0691b0d8015f1457440f53e98'),
('function','public.static_weekly_v27_original_native_bindings(jsonb,timestamp with time zone)','2489f1e64dce5c28470d053425b34d5fa5bbd4ef630f827f2ec1e0e557bfc6e4','87c33fbb9cb51f6fe7da034adebea239fa99242e8cb0d5a69ca3ea92fc3ba4ee'),
('function','static_weekly_accepted_exception_set(uuid,date)','8ce1e49beaf770567bd3468be0b28aea370e5930ce2138e1597eb90668e348d7','773163ee06fbccba59596d5a0eb5b40ecb25495b197872de3fae0c5ff02264d9'),
('function','static_weekly_capacity_assert_projection_owner(jsonb,uuid,jsonb)','a7af1913ce3b2301d75fa0559db96e820484bcf0da9867ce0e4acfb586450d0e','c4fb8a3810ab9a779d79d011ce2ad486a8ccc4031c3d019dfd277f2583225932'),
('function','static_weekly_compiler_exception_set(uuid,date)','85db993fb76b2bd098a0581c44f474c6990576252d1e2f5928555899b8cab212','2286a3d9ddc5107a5699875cc3a27a02fd6de3901fdc0479880cab73baeca494'),
('function','static_weekly_pending_assert_lunch(uuid,uuid,uuid,date,jsonb,jsonb)','a34dd5e4b7bc163b48d57d8f791b03a09e1238e15f911d3770b10cdcde7429a8','f369414eb5a37e371e3064058394a7c7734932196c5e512739646a6197c85b58'),
('function','static_weekly_pending_assert_projection(uuid,uuid,jsonb)','357ac0648dd992ebdb09d923fdb7265fdc6513e422288ef6347d3e1214a77c7c','601588840d94bc7d36601887b1980481090f16c2c27aace5b0905337ee55f987'),
('function','static_weekly_pending_exception_set(uuid,uuid,date,date)','0c65eae618a04b336ffc447acb953344505b38625c007244898adc75e078f51b','76c8124adb07062ecd7cf95592215383ea837048733055d9496a0e3fe9b05bc2'),
('function','static_weekly_pending_original_exception_set(uuid,date,uuid)','568183788a0f7e52be9f3d8232445b6d42549b93254e311dcd906642a191f01e','dd03577075d47b8e7d751ed2b6b8e577abe809675f655f59e30db44cd4cc455c'),
('function','static_weekly_v10_read_staffing_command(uuid,uuid)','63b11b296de897e97990f404dc7800c90bc0c269978606cc764a7d51c53a11fc','a42058840724610b796b63ae7eeb3a27e1f3248298068cc3cc2f7570ed993f95'),
('function','static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)','7e7512b39c2dad6f6f5306b2c98b273a035e4d1b84f3f67b2972a6944bca7b3b','dfb1b6c77fac33a98989903476169fdf5ec425677a836e8f1d83d5fba2e1e496'),
('function','static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)','65428e05a6e6da354e5d73b45a09ecf47ba07ab37a2eac6d42627f776c305daa','3453d848ffccd041d10d140b81c3f5fac04d25941f003875c13d5d27a82c697e'),
('function','static_weekly_v5_read_employee_day_single_location_base(date,uuid,timestamp with time zone)','25faf446ca1ec9ee0f295f0114617eafc565cfd9f19ff41a3a8bde845fa6da38','242caba9fbe188e9bdc635a4b27475e81efa25d0fc523fa33457c701b694cb87'),
('function','static_weekly_v8_assert_lunch_document(uuid,jsonb)','632692af300fbb6610b2f56077535568859cf47f7829ef5d20901a37466d25c7','f6aef114ba8759123d9907a24088da7500dfb5ffc7c5384cef720375838a1b4a'),
('function','static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)','b37945e14e5f804f4bbde542115bd017f8c7e64b909933658d8a23ec6979a9e9','7a95af194dc0bf9a69ed26e737d748ee4144960f0d23dcea93ac11624aafb95a'),
('function','static_weekly_v8_read_lunch_document(date)','8e19ebff428a4883e35acd09d50986228f6efea9b12ade4450da0c53aeb327d0','b15fe4047739f187438c3081128ff49f8c81e3a63c6e0c12c9a0efdb9685ce15'),
('relation','public.custodial_offline_reconciliation_outbox','f0df2989becf9a4221ab98097165290cdeccc1e7f8a4a9e054830a82bd6079c9','44003c86ddc601a5860e8142d6d5772b26b267134c52fa408e82e4f5453d9bc8');
DO $actual_mismatches$
BEGIN
 IF (SELECT count(*) FROM q309_expected_mismatches)<>39 OR EXISTS(
 SELECT 1 FROM q309_expected_mismatches e LEFT JOIN public.custodial_release_authority_restore_inventory i
 ON i.object_kind=e.kind AND i.object_identity=e.identity
 WHERE i.definition_sha256 IS DISTINCT FROM e.stored_sha256 OR public.static_weekly_digest_text(i.definition_sql) IS DISTINCT FROM e.stored_sha256
 OR public.static_weekly_digest_text(CASE e.kind
 WHEN 'function' THEN pg_get_functiondef(to_regprocedure(e.identity))
 WHEN 'relation' THEN public.custodial_release_authority_current_relation_definition(e.identity)
 WHEN 'column' THEN public.custodial_release_authority_current_column_definition(e.identity)
 WHEN 'column_set' THEN public.custodial_release_authority_current_column_set_definition(e.identity)
 WHEN 'constraint' THEN public.custodial_release_authority_current_constraint_definition(e.identity)
 END) IS DISTINCT FROM e.live_sha256) THEN RAISE EXCEPTION 'Exact measured39 current recovery discrepancies differ';END IF;
END $actual_mismatches$;
CREATE TEMP TABLE q309_inventory_before ON COMMIT DROP AS TABLE public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE q309_surface_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_canary_authority_surface();
CREATE TEMP TABLE q309_expected_functions(schema_name text,function_name text,live_sha256 text,PRIMARY KEY(schema_name,function_name)) ON COMMIT DROP;
INSERT INTO q309_expected_functions VALUES
('custodial_leadership_private','assert_scoped_cohort_actor_v1','153ce6d62733fd0360066dc536433904bd1795789ba072155093b53500aeeb25'),
('custodial_leadership_private','completion_evidence_v1','a3c17a251d7f9cd6f97cd8ef2a4fb370f0c13f1ba13de0c4dea0f7a57bb906a9'),
('custodial_leadership_private','custodial_place_bridge_confirm_cohort_v1','fb69a1473276c069e5d3f8756625b4ae5374eb966b73b51d7c35081a2bae2b43'),
('custodial_leadership_private','custodial_place_bridge_preview_cohort_v1','27f397a056fda5d35196983790c88eacd16ab0f718d5adc8953294ebbba74f8e'),
('custodial_leadership_private','custodial_place_command_cohort_v1','799e5118c6550253498583d0d7f2b48d817fa42ee16a15689f32704c6dfdf165'),
('custodial_leadership_private','custodial_place_preview_cohort_v1','217f3d3c805fc17cd7a2f01bac8ec8ff8959a2c72ba287dd8c86c194129eb2dd'),
('custodial_leadership_private','custodial_place_source_confirm_cohort_v1','28f290c27cd958eb7bfb7f95273847a9c30b3995eebf61f951cd3c7201055b34'),
('custodial_leadership_private','custodial_place_source_preview_cohort_v1','0290fdde3f51fcd55fd8eb042b7421a2bf9053fcf3fe12f1391210e4c063d318'),
('custodial_leadership_private','feedback_operation_v1','23fb2d8ae705ed5b6885bc957e82ccc38e84bb93ce454994bed65c9f8f9d43d7'),
('custodial_leadership_private','feedback_request_collision_v1','876c0a875dab8ce6836c29fce2ecd2cf146b2f2577e32bff2db4f906bc493d68'),
('custodial_leadership_private','place_operation_v1','a6d5d97bb77a4989b41136d8228cd63918f581a615b8bfa2b5b108754ad4fb81'),
('custodial_leadership_private','place_source_apply_cohort_v1','3e24a7f4e5eadac6e1031cf00d3f577e5cf9e765da3fab5aa70b32189a352dac'),
('custodial_leadership_private','record_operation_v1','e82c5955d2483cd8896f9248c3c189178d2b7fde76d3b927e4af7a2d12516854'),
('custodial_leadership_private','unfinished_evidence_immutable_v1','86a3e124ce1ab83d6700cdb84354042ee97a229b00d057834f8a818ba63221b0'),
('custodial_leadership_private','unfinished_work_operation_v1','acae413379ed0c09b571058d0a546268e15e34e3004f683220929c8df2407d53'),
('custodial_leadership_private','valid_feedback_cohort_identity_v1','a39a0d2e98d572bced7116b9931ce72e6545390097ec1741028b33d559795c96'),
('public','capture_system_feedback_email_intent','ff5e533b61ec6bae4a6b8ba418cffb1a528d1fc56a0838400a60289c1b50fc77'),
('public','custodial_claim_offline_reconciliation_notification_recipients','6a090ab7e1cee957e38456208f34c61526ac7ba399444a8280d64163da97a4c4'),
('public','custodial_leadership_record_operation_v1','d66e87a35b3ed757c413a26228283689e077d80cd8f8da049a4f0ca2bb514377'),
('public','custodial_manager_completion_evidence','ef4af3f85d530b0a05680ad786a7519dc4ac6d8bb49b6a5c533d1cec1424d390'),
('public','custodial_record_local_enrollment_retention_v1','846bce965ae23580f213d546eb05449a077e7e3dc07a7483df0a0ef037addf7e'),
('public','custodial_unfinished_work_recipient_v1','b9eb8751750f73d8e8700d918a1b99b28c6c4537afc0fbad6ac92a0ba397fe02'),
('public','custodial_v12_guard_protected_device','6d57a44bc68cf3f92f25d5700fe961efce339f882599afc2024d73dfcf1bea6b'),
('public','device_auth_consume_enrollment_operation','799de0abf1bc517010ad866e4c883e90469bf039c7b0c92128f6585e520c542e'),
('public','expire_stale_open_sessions','771a186cde92b9a0cd364202b4c5669f0819100252563624a885732c74f8eb2a'),
('public','custodial_action_actor_v1','95ae99a83afdd36703f4bbe439856cd43c774f0662751d1ef8ab38728dc6c872'),
('public','custodial_native_lunch_live','da3acd9c5f3d16be6f1d91879718554a8dd81d534aeecf0813d2f83a1ab0535e'),
('public','custodial_native_target_source_at','7a2821e947ccec13cc97e3bf78437cc5d7676d5cd1212df604282e30e4394d77'),
('public','mz_enqueue_employee_lunch_coverage_pushes','7050c232edad3a8444a6cfa797b143e7b9f56aa81ee76d8ed3700421a36a274b'),
('public','static_weekly_v22_ack_recurring_application_target','7e0ac56b4236d135d290e3853b4e784ab530e0bc3a4e0f146ff8727773a02175'),
('public','static_weekly_v22_read_recurring_application_target','0cc16424dd3b111469d18808e33a9fc05a2c39e2d87ebef5c40e1e3283cfe0a7'),
('public','static_weekly_v22_reconcile_recurring_application_date','54a0778d62ccea3ec42ea8a1770ec42c1488420b93adcee51b85f056c0cac790'),
('public','static_weekly_v24_ack_device_schedule_delivery','bf00c7c7952193dfdbe03472f3ddff733c5cbc77f1777fae8184ef44a4664bf8'),
('public','static_weekly_v24_read_device_schedule_delivery','836a8ae3fa6922373d66ba91cc675a0cd0886c8828690ce4415e343336c69007'),
('public','static_weekly_v25_read_current_recurring_delivery','c2cf0da085cff2ac50fdc31df3bb5cb928252b68ae14f7bcda5ba5188f8af631'),
('public','static_weekly_v27_ack_device_schedule_delivery','b0727c271838961e2bc2e9c0a3d7c711c5a9d892f8c7e4dbd71626259d443dc8'),
('public','static_weekly_v27_notification_plan_at','6cb15415e12b312bdf20276fc74dd26751d660e0691b0d8015f1457440f53e98'),
('public','static_weekly_v27_original_native_bindings','87c33fbb9cb51f6fe7da034adebea239fa99242e8cb0d5a69ca3ea92fc3ba4ee'),
('public','static_weekly_accepted_exception_set','773163ee06fbccba59596d5a0eb5b40ecb25495b197872de3fae0c5ff02264d9'),
('public','static_weekly_capacity_assert_projection_owner','c4fb8a3810ab9a779d79d011ce2ad486a8ccc4031c3d019dfd277f2583225932'),
('public','static_weekly_compiler_exception_set','2286a3d9ddc5107a5699875cc3a27a02fd6de3901fdc0479880cab73baeca494'),
('public','static_weekly_pending_assert_lunch','f369414eb5a37e371e3064058394a7c7734932196c5e512739646a6197c85b58'),
('public','static_weekly_pending_assert_projection','601588840d94bc7d36601887b1980481090f16c2c27aace5b0905337ee55f987'),
('public','static_weekly_pending_exception_set','76c8124adb07062ecd7cf95592215383ea837048733055d9496a0e3fe9b05bc2'),
('public','static_weekly_pending_original_exception_set','dd03577075d47b8e7d751ed2b6b8e577abe809675f655f59e30db44cd4cc455c'),
('public','static_weekly_v10_read_staffing_command','a42058840724610b796b63ae7eeb3a27e1f3248298068cc3cc2f7570ed993f95'),
('public','static_weekly_v11_accept_staffing_command','dfb1b6c77fac33a98989903476169fdf5ec425677a836e8f1d83d5fba2e1e496'),
('public','static_weekly_v11_staged_projection_digest_matches','3453d848ffccd041d10d140b81c3f5fac04d25941f003875c13d5d27a82c697e'),
('public','static_weekly_v5_read_employee_day_single_location_base','242caba9fbe188e9bdc635a4b27475e81efa25d0fc523fa33457c701b694cb87'),
('public','static_weekly_v8_assert_lunch_document','f6aef114ba8759123d9907a24088da7500dfb5ffc7c5384cef720375838a1b4a'),
('public','static_weekly_v8_materialize_lunch_document','7a95af194dc0bf9a69ed26e737d748ee4144960f0d23dcea93ac11624aafb95a'),
('public','static_weekly_v8_read_lunch_document','b15fe4047739f187438c3081128ff49f8c81e3a63c6e0c12c9a0efdb9685ce15');
CREATE TEMP TABLE q309_original_functions ON COMMIT DROP AS
 SELECT p.oid,p.proowner,p.proacl FROM q309_expected_functions e JOIN pg_namespace n ON n.nspname=e.schema_name
 JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=e.function_name
 UNION ALL SELECT p.oid,p.proowner,p.proacl FROM pg_proc p WHERE p.oid='public.custodial_release_canary_authority_surface()'::regprocedure;
DO $source$
BEGIN
 IF EXISTS(SELECT 1 FROM q309_expected_functions e LEFT JOIN pg_namespace n ON n.nspname=e.schema_name
 LEFT JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=e.function_name GROUP BY e.schema_name,e.function_name HAVING count(p.oid)<>1)
 OR (SELECT count(*) FROM q309_original_functions)<>53 THEN RAISE EXCEPTION 'Exact current308 function membership differs';END IF;
 IF EXISTS(SELECT 1 FROM q309_expected_functions e JOIN pg_namespace n ON n.nspname=e.schema_name
 JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=e.function_name
 WHERE public.static_weekly_digest_text(pg_get_functiondef(p.oid)) IS DISTINCT FROM e.live_sha256) THEN
  RAISE EXCEPTION 'Exact current308 product function definition differs';END IF;
END $source$;
-- Private-table mutation fences are intentionally a separate qualification issue.
-- This binding migration preserves current product table/trigger semantics.
CREATE TEMP TABLE q309_rows(bucket integer NOT NULL,kind text NOT NULL,identity text NOT NULL,definition text NOT NULL,PRIMARY KEY(kind,identity)) ON COMMIT DROP;
DO $binding$
DECLARE rel text;rid oid;obj record;fn record;identity_text text;definition_text text;surface text;roots text;next_order integer;changed integer;
BEGIN
 FOREACH rel IN ARRAY ARRAY['custodial_leadership_private.feedback_triage_receipts_v1','custodial_leadership_private.unfinished_notices_v1','custodial_leadership_private.unfinished_clears_v1','custodial_employment.local_retained_enrollments_v1','public.system_feedback_triage_receipts','public.custodial_offline_reconciliation_outbox'] LOOP
  rid:=rel::regclass;
  INSERT INTO q309_rows VALUES
   (1000,'relation',rel,public.custodial_release_authority_current_relation_definition(rel)),
   (300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)),
   (400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)),
   (900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel));
  INSERT INTO q309_rows SELECT 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname)
   FROM pg_attribute WHERE attrelid=rid AND attnum>0 AND NOT attisdropped;
  INSERT INTO q309_rows SELECT 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
   FROM pg_constraint WHERE conrelid=rid;
  INSERT INTO q309_rows SELECT 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
   FROM pg_index i WHERE indrelid=rid AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid);
  INSERT INTO q309_rows SELECT 700000,'trigger',rel||'.'||quote_ident(tgname),
   'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '||pg_get_triggerdef(oid,true)||'; alter table '||rel||' '
    ||CASE tgenabled WHEN 'O' THEN 'enable' WHEN 'D' THEN 'disable' WHEN 'R' THEN 'enable replica' WHEN 'A' THEN 'enable always' END||' trigger '||quote_ident(tgname)||';'
   FROM pg_trigger WHERE tgrelid=rid AND NOT tgisinternal;
  INSERT INTO q309_rows SELECT 800000,'policy',rel||':'||polname,public.custodial_release_authority_current_policy_definition(rel||':'||polname)
   FROM pg_policy WHERE polrelid=rid;
 END LOOP;
 FOR fn IN SELECT oid FROM q309_original_functions LOOP
  identity_text:=fn.oid::regprocedure::text;definition_text:=pg_get_functiondef(fn.oid);
  changed:=0;
  FOR obj IN SELECT i.object_identity FROM public.custodial_release_authority_restore_inventory i
   WHERE CASE WHEN i.object_kind='function' THEN to_regprocedure(i.object_identity)=fn.oid ELSE false END LOOP
   INSERT INTO q309_rows VALUES(100000,'function',obj.object_identity,definition_text);changed:=changed+1;
  END LOOP;
  IF changed=0 THEN INSERT INTO q309_rows VALUES(100000,'function',identity_text,definition_text);END IF;
  changed:=0;
  FOR obj IN SELECT i.object_identity FROM public.custodial_release_authority_restore_inventory i
   WHERE CASE WHEN i.object_kind='grant' AND position('(' IN i.object_identity)>0 THEN to_regprocedure(i.object_identity)=fn.oid ELSE false END LOOP
   INSERT INTO q309_rows VALUES(1000000,'grant',obj.object_identity,public.custodial_release_authority_current_grant_definition(obj.object_identity));changed:=changed+1;
  END LOOP;
  IF changed=0 THEN INSERT INTO q309_rows VALUES(1000000,'grant',identity_text,public.custodial_release_authority_current_grant_definition(identity_text));END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM q309_rows WHERE definition IS NULL OR definition='') THEN RAISE EXCEPTION 'Current source recovery renderer unavailable';END IF;
 surface:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF length(surface)-length(replace(surface,'  values',''))<>length('  values') THEN RAISE EXCEPTION 'Original canary VALUES seam differs';END IF;
 SELECT string_agg(format('(%L,%L,%L),',n.kind,n.identity,'Current source recovery binding qualified after R006'),E'\n ' ORDER BY n.bucket,n.kind,n.identity)
 INTO roots FROM q309_rows n WHERE n.kind IN('relation','column_set','relation_state','function','constraint','grant','view')
 AND NOT EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface() s WHERE s.object_kind=n.kind AND s.object_identity=n.identity);
 IF roots IS NOT NULL THEN EXECUTE replace(surface,'  values','  values'||E'\n '||roots);END IF;
 UPDATE q309_rows SET definition=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)
 WHERE CASE WHEN kind='function' THEN to_regprocedure(identity)='public.custodial_release_canary_authority_surface()'::regprocedure ELSE false END;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 FOR obj IN SELECT * FROM q309_rows ORDER BY bucket,kind COLLATE "C",identity COLLATE "C" LOOP
  UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   WHERE object_kind=obj.kind AND object_identity=obj.identity;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed>1 THEN RAISE EXCEPTION 'Duplicate original recovery identity';END IF;
  IF changed=0 THEN
   SELECT n INTO next_order FROM generate_series(obj.bucket+1,CASE WHEN obj.bucket=1000 THEN 99999 ELSE obj.bucket+99999 END) n
    WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.restore_order=n) ORDER BY n LIMIT 1;
   IF next_order IS NULL THEN RAISE EXCEPTION 'Current recovery order bucket exhausted';END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  END IF;
 END LOOP;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 IF EXISTS(SELECT 1 FROM q309_rows n LEFT JOIN public.custodial_release_authority_restore_inventory i ON i.object_kind=n.kind AND i.object_identity=n.identity
  WHERE i.object_identity IS NULL OR i.definition_sql IS DISTINCT FROM n.definition OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(n.definition)) THEN
  RAISE EXCEPTION 'Current recovery binding readback differs';END IF;
 IF EXISTS(SELECT b.* FROM q309_inventory_before b WHERE NOT EXISTS(SELECT 1 FROM q309_rows n WHERE n.kind=b.object_kind AND n.identity=b.object_identity)
  EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory) OR EXISTS(
  SELECT i.* FROM public.custodial_release_authority_restore_inventory i WHERE NOT EXISTS(SELECT 1 FROM q309_rows n WHERE n.kind=i.object_kind AND n.identity=i.object_identity)
  EXCEPT SELECT * FROM q309_inventory_before) THEN RAISE EXCEPTION 'Unrelated recovery history changed';END IF;
 IF EXISTS(SELECT 1 FROM q309_inventory_before b JOIN public.custodial_release_authority_restore_inventory i USING(object_kind,object_identity)
  WHERE b.restore_order IS DISTINCT FROM i.restore_order) THEN RAISE EXCEPTION 'Existing restore order changed';END IF;
 IF EXISTS(SELECT * FROM q309_surface_before EXCEPT SELECT * FROM public.custodial_release_canary_authority_surface()) THEN
  RAISE EXCEPTION 'Original canary root tuple changed or removed';END IF;
 IF EXISTS(SELECT 1 FROM q309_rows n WHERE n.kind IN('relation','column_set','relation_state','function','constraint','grant','view')
  AND NOT EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface() s WHERE s.object_kind=n.kind AND s.object_identity=n.identity)) THEN
  RAISE EXCEPTION 'Required current canary root missing';END IF;
 IF EXISTS(SELECT 1 FROM q309_original_functions b LEFT JOIN pg_proc p ON p.oid=b.oid
  WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner OR p.proacl IS DISTINCT FROM b.proacl) THEN
  RAISE EXCEPTION 'Original routine owner or ACL changed';END IF;
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A' THEN RAISE EXCEPTION 'ALWAYS guard lost';END IF;
END $binding$;
COMMIT;
