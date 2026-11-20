-- SINGLE CLI-ALLOCATED TWELVE-COMPONENT SUCCESSOR. UNQUALIFIED / UNAPPLIED / NOT CANONICAL.
BEGIN;
-- Original-owner prelude, staged only; no execution or release admission.
-- Inside this one outer transaction before the exact twelve guarded product bodies.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
DO $main_predecessors$
BEGIN
  IF current_user IS DISTINCT FROM session_user OR current_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'Maintained migration owner required'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('custodial_leadership_private.execute(text,jsonb)'::regprocedure)) NOT IN ('9bb0130bf1be532752ee00bd889620cf6654c98b7f9bbcc7c287402983a7830e') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: custodial_leadership_private.execute(text,jsonb)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('custodial_leadership_private.session_view(uuid)'::regprocedure)) NOT IN ('9f009ef3449f4b5f1cb197a0262e8cd0e86de0dc0adb7e90c73b122b4e977869') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: custodial_leadership_private.session_view(uuid)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_native_alert_finalize_at(uuid,uuid,uuid,jsonb,jsonb,timestamp with time zone)'::regprocedure)) NOT IN ('758cfabe33b62e2ca018cf1170a15df5348a1519fd570dfdc2557613e23a411f') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.custodial_native_alert_finalize_at(uuid,uuid,uuid,jsonb,jsonb,timestamp with time zone)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_native_alert_prepare_at(uuid,uuid,jsonb,timestamp with time zone)'::regprocedure)) NOT IN ('1661a4a12fbe965408318183cc7e201dd7645ed099c261fa9066a1b9bb0ef2d3') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.custodial_native_alert_prepare_at(uuid,uuid,jsonb,timestamp with time zone)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_ops_manager_notification_binding_is_current(uuid,uuid,uuid,text,timestamp with time zone)'::regprocedure)) NOT IN ('36a3872576fb454f06c2554c1016e52934160a2616e81f59c8b1368d411ac076') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.custodial_ops_manager_notification_binding_is_current(uuid,uuid,uuid,text,timestamp with time zone)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_ops_manager_notification_recipient_is_current(uuid,uuid,timestamp with time zone)'::regprocedure)) NOT IN ('07d38482c35e838b1eae875f40d5929aaaef09ab4b81a9a47cbe5ea209a98f7c') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.custodial_ops_manager_notification_recipient_is_current(uuid,uuid,timestamp with time zone)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)) NOT IN ('05ac362f1bf7cd08cf895e3ea6c8a6cbe09c7db9d22f558629cbfe4fa12f2b51','b8e42250d6601cfef46f117be8545d64e22355502a3fff50d380588ad3312c71') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.custodial_release_canary_authority_surface()'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)'::regprocedure)) NOT IN ('7fa82fecdbafc4f2da58fc2996cdda75b8949a793846dc6fb6d54518be01a706') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.events_app_validate_scope_venue()'::regprocedure)) NOT IN ('aa399a485ed888cc45798ea401c3c5c6b04a7ea1fdeb743885089319593a2d6c') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.events_app_validate_scope_venue()'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.msg_is_runtime_user(uuid)'::regprocedure)) NOT IN ('1bd4f8312c0833e2f63d01e1887dd1b8b7146c7ef28eddb5f8fc1378b28ab4a9') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.msg_is_runtime_user(uuid)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)'::regprocedure)) NOT IN ('f18600be783af50bb5b57f2eb407f3cdf68a8c9e3c1b4cedbc76b257b8c4d66f') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.ops_manager_enqueue_lunch_delivery_failure(uuid,timestamp with time zone)'::regprocedure)) NOT IN ('37ed473fd7a78dc8dc0bbfb05e6f84f443572857a0952a555e324253c924a666') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.ops_manager_enqueue_lunch_delivery_failure(uuid,timestamp with time zone)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.ops_manager_enqueue_message_push()'::regprocedure)) NOT IN ('f813902e7e102d4180f2789384562583602461f93cbbf5d6e34f48df57e884fb') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.ops_manager_enqueue_message_push()'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.ops_manager_enqueue_scheduled_notifications(timestamp with time zone)'::regprocedure)) NOT IN ('ee84bba4a77fe4c7ac99eaecf90dc7dcec2ec4aba5df98c6bb9375ff9327758f') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.ops_manager_enqueue_scheduled_notifications(timestamp with time zone)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)'::regprocedure)) NOT IN ('7df67b9a0a6b5733725ab0c81e5a93c2ce93c68e7380c3668e1b6af70b8447d8') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.ops_manager_notification_job_is_current(uuid,uuid,uuid,text)'::regprocedure)) NOT IN ('e862170f1f47a1bea76a48743618b58710fdd16a659411f8765deb41e65863c1') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.ops_manager_notification_job_is_current(uuid,uuid,uuid,text)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.ops_manager_notification_validate_owner()'::regprocedure)) NOT IN ('c51dd11eb1a98774e84e7e22bebc807f2f31baae91e2803d68092349fe7a5212') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.ops_manager_notification_validate_owner()'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)'::regprocedure)) NOT IN ('8e1ffa8adf87c39a2c962df7b953da486af83eedf00af825d7e62854cbf118c2') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer)'::regprocedure)) NOT IN ('a82d3a2e5821b36a2cb80e3eaecc4df503ff7aa0f878944b41338a26689fbdf5') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_read_coverall_link(text)'::regprocedure)) NOT IN ('841918af58380ed198947762f11d406dc170eff1573bf15dc93b171d1692ecb4') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.static_weekly_read_coverall_link(text)'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid)'::regprocedure)) NOT IN ('8d10f705d1cd8c9616ce197344f480396fbfb63fb285e70e5b0fe7649df08423') THEN RAISE EXCEPTION 'Exact source303 recovery predecessor differs: public.static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid)'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='custodial_leadership_private' AND p.proname='bind_registration_generation') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: custodial_leadership_private.bind_registration_generation'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='custodial_leadership_private' AND p.proname='coverall_link_issuer') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: custodial_leadership_private.coverall_link_issuer'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='custodial_leadership_private' AND p.proname='ensure_messaging_account') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: custodial_leadership_private.ensure_messaging_account'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='custodial_leadership_private' AND p.proname='messaging_account_active') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: custodial_leadership_private.messaging_account_active'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='custodial_leadership_private' AND p.proname='notification_credential') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: custodial_leadership_private.notification_credential'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='custodial_leadership_private' AND p.proname='record_operation_v1') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: custodial_leadership_private.record_operation_v1'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='custodial_leadership_messaging_operation_v1') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: public.custodial_leadership_messaging_operation_v1'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='custodial_leadership_record_operation_v1') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: public.custodial_leadership_record_operation_v1'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='custodial_named_record_operation_v1') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: public.custodial_named_record_operation_v1'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='custodial_native_alert_utf8_prefix') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: public.custodial_native_alert_utf8_prefix'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='custodial_ops_manager_message_push_is_current') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: public.custodial_ops_manager_message_push_is_current'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='msg_broadcast_operation_v1') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: public.msg_broadcast_operation_v1'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='msg_custodial_cohort_message_actor_v1') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: public.msg_custodial_cohort_message_actor_v1'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='ops_manager_notification_bind_credential') THEN RAISE EXCEPTION 'New sealed-repair function identity already exists: public.ops_manager_notification_bind_credential'; END IF;
  IF to_regclass('custodial_leadership_private.messaging_message_bindings') IS NOT NULL THEN RAISE EXCEPTION 'New sealed-repair relation already exists: custodial_leadership_private.messaging_message_bindings'; END IF;
  IF to_regclass('public.msg_broadcast_request_receipts') IS NOT NULL THEN RAISE EXCEPTION 'New sealed-repair relation already exists: public.msg_broadcast_request_receipts'; END IF;
  IF to_regclass('public.ops_manager_notification_credentials') IS NOT NULL THEN RAISE EXCEPTION 'New sealed-repair relation already exists: public.ops_manager_notification_credentials'; END IF;
  IF to_regclass('custodial_leadership_private.registrations') IS NULL THEN RAISE EXCEPTION 'Original sealed-repair relation missing: custodial_leadership_private.registrations'; END IF;
  IF to_regclass('public.msg_users') IS NULL THEN RAISE EXCEPTION 'Original sealed-repair relation missing: public.msg_users'; END IF;
  IF to_regclass('public.ops_manager_notification_preferences') IS NULL THEN RAISE EXCEPTION 'Original sealed-repair relation missing: public.ops_manager_notification_preferences'; END IF;
  IF to_regclass('public.ops_manager_notification_queue') IS NULL THEN RAISE EXCEPTION 'Original sealed-repair relation missing: public.ops_manager_notification_queue'; END IF;
  IF to_regclass('public.ops_manager_notification_state') IS NULL THEN RAISE EXCEPTION 'Original sealed-repair relation missing: public.ops_manager_notification_state'; END IF;
  IF to_regclass('public.ops_manager_push_devices') IS NULL THEN RAISE EXCEPTION 'Original sealed-repair relation missing: public.ops_manager_push_devices'; END IF;
  IF to_regclass('public.static_weekly_coverall_access_links') IS NULL THEN RAISE EXCEPTION 'Original sealed-repair relation missing: public.static_weekly_coverall_access_links'; END IF;
  IF EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface() WHERE object_kind='constraint' AND object_identity='custodial_leadership_private.registrations:registrations_check')
  THEN RAISE EXCEPTION 'Unexpected old registration constraint canary root'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'::regprocedure)) IS DISTINCT FROM '9882aee1324bec65acfaf5252c8d876a13f06f250cd194620dfd8e0b25deceb5' THEN RAISE EXCEPTION 'Exact source303 Event reminder compatibility predecessor differs'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_finish_manual_recurring_normal(uuid,uuid,jsonb,text)'::regprocedure)) IS DISTINCT FROM '90e0041bf54c53a04117e3dd8d89e272c291e7f94ed431261f7f823389098e15' THEN RAISE EXCEPTION 'Exact recurring-lifetime source303 predecessor differs'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_materialize_manual_repeat(jsonb,text,uuid,text,text)'::regprocedure)) IS DISTINCT FROM '27adb55afccf85093df87036e44097efa69e3d9d6c5aa953a89b688f7ba5f4cd' THEN RAISE EXCEPTION 'Exact recurring-lifetime source303 predecessor differs'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_manual_repeat_components(uuid,date)'::regprocedure)) IS DISTINCT FROM '01d1b47593688a3d586e5c90e6bfdc4c49eb613b41645010001126401b9360e6' THEN RAISE EXCEPTION 'Exact recurring-lifetime source303 predecessor differs'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_manual_repeat_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure)) IS DISTINCT FROM 'add0c554df14ce9330c4d4beeddb4a46cd872d7b81a1abb6a9fb30bb019abf4e' THEN RAISE EXCEPTION 'Exact recurring-lifetime source303 predecessor differs'; END IF;
  IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)'::regprocedure)) IS DISTINCT FROM 'f4a3666025be5a3fde272282e8edd8b1ed4ac07e20ca41fadad4339a916e438d' THEN RAISE EXCEPTION 'Exact source303 staffing-stage predecessor differs'; END IF;
END $main_predecessors$;
CREATE TEMP TABLE main_sealed_repair_removed_constraint_before ON COMMIT DROP AS
 SELECT 'custodial_leadership_private.registrations:registrations_check'::text AS identity,
 public.custodial_release_authority_current_constraint_definition('custodial_leadership_private.registrations:registrations_check') AS definition;
DO $main_old_constraint$
BEGIN
 IF (SELECT definition IS NULL OR definition='' FROM main_sealed_repair_removed_constraint_before)
 OR (SELECT count(*)>1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='constraint' AND object_identity='custodial_leadership_private.registrations:registrations_check')
 OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i JOIN main_sealed_repair_removed_constraint_before b ON i.object_kind='constraint' AND i.object_identity=b.identity
 WHERE i.definition_sql IS DISTINCT FROM b.definition OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(b.definition))
 THEN RAISE EXCEPTION 'Exact removed-constraint recovery predecessor differs'; END IF;
END $main_old_constraint$;
-- Preserve exact metadata and actual SQL SHA256 without retaining duplicate DDL bodies.
CREATE TEMP TABLE main_sealed_repair_inventory_before ON COMMIT DROP AS
 SELECT restore_order,object_kind,object_identity,definition_sha256,captured_at,
 public.static_weekly_digest_text(definition_sql) AS actual_definition_sha256
 FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE main_sealed_repair_original_functions ON COMMIT DROP AS
SELECT p.oid,p.proowner,p.proacl FROM pg_proc p WHERE p.oid=ANY(ARRAY[
 'custodial_leadership_private.execute(text,jsonb)'::regprocedure,
 'custodial_leadership_private.session_view(uuid)'::regprocedure,
 'public.custodial_native_alert_finalize_at(uuid,uuid,uuid,jsonb,jsonb,timestamp with time zone)'::regprocedure,
 'public.custodial_native_alert_prepare_at(uuid,uuid,jsonb,timestamp with time zone)'::regprocedure,
 'public.custodial_ops_manager_notification_binding_is_current(uuid,uuid,uuid,text,timestamp with time zone)'::regprocedure,
 'public.custodial_ops_manager_notification_recipient_is_current(uuid,uuid,timestamp with time zone)'::regprocedure,
 'public.custodial_release_canary_authority_surface()'::regprocedure,
 'public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)'::regprocedure,
 'public.events_app_validate_scope_venue()'::regprocedure,
 'public.msg_is_runtime_user(uuid)'::regprocedure,
 'public.mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)'::regprocedure,
 'public.ops_manager_enqueue_lunch_delivery_failure(uuid,timestamp with time zone)'::regprocedure,
 'public.ops_manager_enqueue_message_push()'::regprocedure,
 'public.ops_manager_enqueue_scheduled_notifications(timestamp with time zone)'::regprocedure,
 'public.ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)'::regprocedure,
 'public.ops_manager_notification_job_is_current(uuid,uuid,uuid,text)'::regprocedure,
 'public.ops_manager_notification_validate_owner()'::regprocedure,
 'public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)'::regprocedure,
 'public.static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer)'::regprocedure,
 'public.static_weekly_read_coverall_link(text)'::regprocedure,
 'public.static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid)'::regprocedure
,
 'public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'::regprocedure
,
 'public.static_weekly_finish_manual_recurring_normal(uuid,uuid,jsonb,text)'::regprocedure,
 'public.static_weekly_materialize_manual_repeat(jsonb,text,uuid,text,text)'::regprocedure,
 'public.static_weekly_manual_repeat_components(uuid,date)'::regprocedure,
 'public.static_weekly_manual_repeat_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure,
 'public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)'::regprocedure
]);
-- No canonical SQL/provenance or inventory mutation occurs in this preparation alone.


-- EXACT GUARDED COMPONENT 1 F01_messenger SOURCE 20d01ff37038308ef96611ffc8e35413a3d7ffa03897d8b29deb42408374b800
DO $predecessor$
BEGIN
 IF public.static_weekly_digest_text(pg_get_functiondef('public.msg_is_runtime_user(uuid)'::regprocedure)) IS DISTINCT FROM '1bd4f8312c0833e2f63d01e1887dd1b8b7146c7ef28eddb5f8fc1378b28ab4a9' THEN
  RAISE EXCEPTION 'F01 predecessor differs: public.msg_is_runtime_user(uuid)';
 END IF;
END $predecessor$;

-- Main-owned guarded successor fragment. Selected-name inboxes are new identities;
-- ops_manager_id remains NULL and verified named history is never adopted.
alter table public.msg_users add column custodial_cohort_manager_id uuid references public.ops_manager_managers(manager_id);
alter table public.msg_users add column custodial_claimed_account_id uuid references public.ops_manager_managers(manager_id);
alter table public.msg_users add constraint msg_users_custodial_cohort_identity_check check (
 (custodial_cohort_manager_id is null and custodial_claimed_account_id is null)
 or (custodial_cohort_manager_id is not null and custodial_claimed_account_id is not null
     and custodial_cohort_manager_id<>custodial_claimed_account_id and ops_manager_id is null and employee_id is null and role='manager'));
create unique index msg_users_custodial_cohort_account on public.msg_users(custodial_cohort_manager_id,custodial_claimed_account_id)
 where custodial_cohort_manager_id is not null;

create function custodial_leadership_private.messaging_account_active(p_cohort uuid,p_account uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $fn$
 select exists(select 1 from custodial_leadership_private.policy p
 join public.ops_manager_managers m on m.manager_id=p.cohort_principal_id
 where p.singleton and p.enabled and p.cohort_principal_id=p_cohort and m.active and m.revoked_at is null and m.is_system_principal
 and exists(select 1 from jsonb_array_elements(custodial_leadership_private.approved_names()) n where n->>'accountId'=p_account::text))
$fn$;
revoke all on function custodial_leadership_private.messaging_account_active(uuid,uuid) from public,anon,authenticated,service_role,static_weekly_control_plane,custodial_application_reader;

create or replace function public.msg_is_runtime_user(p_user_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public,extensions as $fn$
 select exists(select 1 from public.msg_users mu
 left join public.employees e on e.id=mu.employee_id
 left join public.ops_manager_managers om on om.manager_id=mu.ops_manager_id
 where mu.id=p_user_id and mu.is_active and (
  (mu.role='bot' and lower(btrim(mu.display_name))='memphis')
  or (mu.role in ('manager','ops','ops_manager','operations_manager') and mu.employee_id is null and (
   (mu.custodial_cohort_manager_id is not null and mu.ops_manager_id is null
    and custodial_leadership_private.messaging_account_active(mu.custodial_cohort_manager_id,mu.custodial_claimed_account_id))
   or (mu.custodial_cohort_manager_id is null and (mu.ops_manager_id is null
    or (om.manager_id is not null and om.active and om.revoked_at is null and not om.is_system_principal)))))
  or (mu.role='employee' and e.id is not null and e.active and coalesce(e.employee_code,'')~'^EMP[0-9]+'
   and exists(select 1 from public.msg_device_assignments a where a.msg_user_id=mu.id and a.is_active))))
$fn$;

create function custodial_leadership_private.ensure_messaging_account(p_cohort uuid,p_account uuid,p_name text)
returns public.msg_users language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare u public.msg_users%rowtype;label text;
begin
 if not custodial_leadership_private.messaging_account_active(p_cohort,p_account) then raise exception 'Current approved cohort account required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('custodial-messenger:'||p_cohort::text||':'||p_account::text,0));
 select * into u from public.msg_users where custodial_cohort_manager_id=p_cohort and custodial_claimed_account_id=p_account;
 label:=p_name||' (shared PIN)';
 if exists(select 1 from public.msg_users other where other.display_name=label and (u.id is null or other.id<>u.id)) then label:=label||' ['||p_account::text||']';end if;
 if u.id is null then
  -- Lossless ordered UUID pair: 79 characters in the retained source303
  -- identity-key alphabet/length. Never reuse a verified named identity key.
  insert into public.msg_users(display_name,role,is_active,messaging_identity_key,custodial_cohort_manager_id,custodial_claimed_account_id)
  values(label,'manager',true,'custodial_pin_'||replace(p_cohort::text,'-','')||'_'||replace(p_account::text,'-',''),p_cohort,p_account) returning * into u;
 else
  update public.msg_users set display_name=label,is_active=true where id=u.id returning * into u;
 end if;
 return u;
end $fn$;
revoke all on function custodial_leadership_private.ensure_messaging_account(uuid,uuid,text) from public,anon,authenticated,service_role,static_weekly_control_plane,custodial_application_reader;

create table custodial_leadership_private.messaging_message_bindings(
 message_id uuid primary key references public.msg_messages(id) on delete cascade,
 msg_user_id uuid not null references public.msg_users(id),
 registration_id uuid not null references custodial_leadership_private.registrations(registration_id),
 cohort_principal_id uuid not null,claimed_account_id uuid not null,policy_version integer not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table custodial_leadership_private.messaging_message_bindings enable row level security;
revoke all on custodial_leadership_private.messaging_message_bindings from public,anon,authenticated,service_role,static_weekly_control_plane,custodial_application_reader;

create function public.custodial_leadership_messaging_operation_v1(
 p_manager_id uuid,p_credential_id uuid,p_device_id text,p_action text,p_input jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare actor jsonb;u public.msg_users%rowtype;member jsonb;m public.msg_messages%rowtype;metadata jsonb;binding custodial_leadership_private.messaging_message_bindings%rowtype;
begin
 perform public.static_weekly_v3_assert_control_plane();
 actor:=custodial_leadership_private.require_context(p_manager_id,'custodialManagementAdmin');
 if actor->>'actor_kind' is distinct from 'CUSTODIAL_LEADERSHIP_COHORT' or actor->'owner' is distinct from 'false'::jsonb
 or actor->>'identity_assurance' is distinct from 'SELF_ASSERTED_NAME' or actor->'individual_identity_verified' is distinct from 'false'::jsonb
 or actor->>'credential_id' is distinct from p_credential_id::text or actor->>'device_id' is distinct from p_device_id then
  raise exception 'Original cohort Messenger actor required' using errcode='42501';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>32768 then raise exception 'Bounded Messenger input required' using errcode='22023';end if;
 if p_action='identity' then
  if p_input<>'{}'::jsonb then raise exception 'Identity input must be empty' using errcode='22023';end if;
  -- Provision the approved directory consistently so every selected name is
  -- addressable, independently of whether that name has opened Messenger yet.
  for member in select * from jsonb_array_elements(custodial_leadership_private.approved_names()) loop
   perform custodial_leadership_private.ensure_messaging_account(p_manager_id,(member->>'accountId')::uuid,member->>'displayName');
  end loop;
 else
  if p_action is distinct from 'send' then raise exception 'Unsupported Messenger action' using errcode='22023';end if;
 end if;
 u:=custodial_leadership_private.ensure_messaging_account(p_manager_id,(actor->>'claimed_account_id')::uuid,actor->>'claimed_name');
 if p_action='identity' then return jsonb_build_object('schema','custodial.cohort-messenger-identity.v1','msg_user_id',u.id,'role','manager',
  'display_name',u.display_name,'claimed_name',actor->>'claimed_name','ops_manager_id',null,
  'custodial_cohort_manager_id',p_manager_id,'custodial_claimed_account_id',actor->>'claimed_account_id',
  'identity_assurance','SELF_ASSERTED_NAME','individual_identity_verified',false);end if;
 if (select array_agg(key order by key) from jsonb_object_keys(p_input) key) is distinct from array['body','client_message_id','message_type','metadata_json','thread_id']
 or p_input->>'message_type' is distinct from 'text' or jsonb_typeof(p_input->'body') is distinct from 'string'
 or length(btrim(p_input->>'body')) not between 1 and 2000 or jsonb_typeof(p_input->'client_message_id') is distinct from 'string'
 or length(p_input->>'client_message_id') not between 1 and 200 or p_input->>'client_message_id'<>btrim(p_input->>'client_message_id')
 or jsonb_typeof(p_input->'metadata_json') is distinct from 'object' or octet_length((p_input->'metadata_json')::text)>8192 then
  raise exception 'Invalid original message payload' using errcode='22023';end if;
 if not exists(select 1 from public.msg_thread_participants p join public.msg_threads t on t.id=p.thread_id
  where p.thread_id=(p_input->>'thread_id')::uuid and p.user_id=u.id and p.left_at is null and t.is_active
   and t.system_key is distinct from 'ops_manager_shared_chat_v1') then raise exception 'Current inbox participation required' using errcode='42501';end if;
 metadata:=((p_input->'metadata_json')-'authenticated_ops_manager_id'::text-'custodial_cohort_actor'::text)
  ||jsonb_build_object('device_id',p_device_id,'custodial_cohort_actor',jsonb_build_object('schema','custodial.cohort-message-actor.v1',
   'cohort_principal_id',p_manager_id,'claimed_account_id',actor->>'claimed_account_id','registration_id',p_credential_id,
   'identity_assurance','SELF_ASSERTED_NAME','individual_identity_verified',false));
 m:=public.msg_send_message((p_input->>'thread_id')::uuid,u.id,p_input->>'body','text',metadata,p_input->>'client_message_id');
 insert into custodial_leadership_private.messaging_message_bindings(message_id,msg_user_id,registration_id,cohort_principal_id,claimed_account_id,policy_version)
 values(m.id,u.id,p_credential_id,p_manager_id,(actor->>'claimed_account_id')::uuid,(actor->>'policy_version')::integer) on conflict(message_id) do nothing;
 select * into binding from custodial_leadership_private.messaging_message_bindings where message_id=m.id;
 if binding.msg_user_id<>u.id or binding.registration_id<>p_credential_id or binding.cohort_principal_id<>p_manager_id
 or binding.claimed_account_id<>(actor->>'claimed_account_id')::uuid then raise exception 'Original message actor conflicts' using errcode='23505';end if;
 -- The named audit field remains NULL. Cohort provenance lives in its typed
 -- private binding and authoritative message metadata, never a claimed login.
 update public.msg_message_audit set sender_ops_manager_id=null,sender_user_id=u.id,sender_display_name=u.display_name,sender_role='manager' where message_id=m.id;
 return to_jsonb(m);
end $fn$;
revoke all on function public.custodial_leadership_messaging_operation_v1(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator;
grant execute on function public.custodial_leadership_messaging_operation_v1(uuid,uuid,text,text,jsonb) to static_weekly_control_plane;

-- Read-only, current authorization for a queued Memphis message. The message
-- ID is sourced from the durable operational job, never a client role assertion.
create function public.msg_custodial_cohort_message_actor_v1(p_message_id uuid,p_user_id uuid,p_device_id text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare b custodial_leadership_private.messaging_message_bindings%rowtype;v jsonb;u public.msg_users%rowtype;
begin
 select binding.* into b from custodial_leadership_private.messaging_message_bindings binding
 join public.msg_messages m on m.id=binding.message_id join public.msg_threads t on t.id=m.thread_id
 where m.id=p_message_id and m.sender_user_id=p_user_id and not m.is_deleted and t.is_active
 and exists(select 1 from public.msg_thread_participants p where p.thread_id=t.id and p.user_id=p_user_id and p.left_at is null);
 if b.message_id is null or b.msg_user_id<>p_user_id then return null;end if;
 v:=custodial_leadership_private.session_view(b.registration_id);
 select * into u from public.msg_users where id=p_user_id and is_active;
 if v is null or u.id is null or u.ops_manager_id is not null or v->>'browserId' is distinct from p_device_id
 or v#>>'{cohort,principalId}' is distinct from b.cohort_principal_id::text
 or v#>>'{claimedAccount,accountId}' is distinct from b.claimed_account_id::text
 or (v#>>'{cohort,policyVersion}')::integer is distinct from b.policy_version
 or u.custodial_cohort_manager_id is distinct from b.cohort_principal_id
 or u.custodial_claimed_account_id is distinct from b.claimed_account_id
 or not (v#>'{cohort,permissions}' ? 'custodialManagementAdmin') then return null;end if;
 return jsonb_build_object('schema','custodial.cohort-messenger-actor.v1','msg_user_id',u.id,'source_message_id',p_message_id,
  'role','manager','identity_assurance','SELF_ASSERTED_NAME','individual_identity_verified',false,'owner',false,
  'custodial_cohort_manager_id',b.cohort_principal_id,'custodial_claimed_account_id',b.claimed_account_id);
end $fn$;
revoke all on function public.msg_custodial_cohort_message_actor_v1(uuid,uuid,text) from public,anon,authenticated,static_weekly_control_plane,static_weekly_release_operator;
grant execute on function public.msg_custodial_cohort_message_actor_v1(uuid,uuid,text) to service_role,custodial_application_reader;



-- EXACT GUARDED COMPONENT 2 F18_broadcast SOURCE d3efd971579a7674f28089a6fea56465c6acbbd597b3c3747c5343b7a0a55012
-- Successor fragment for Main integration; never alters a historical migration.
-- A request receipt and its effects commit atomically. The key is supplied by
-- the original caller, scoped to the server-derived sender, never generated here.
create table public.msg_broadcast_request_receipts (
  sender_user_id uuid not null,
  client_broadcast_id text not null check (length(client_broadcast_id) between 1 and 200 and client_broadcast_id = btrim(client_broadcast_id)),
  request_title text,
  request_body text not null,
  result jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (sender_user_id, client_broadcast_id)
);
alter table public.msg_broadcast_request_receipts enable row level security;
revoke all on public.msg_broadcast_request_receipts from public, anon, authenticated, service_role;

create function public.msg_broadcast_operation_v1(
  p_sender_user_id uuid, p_client_broadcast_id text, p_title text, p_body text, p_read_only boolean default false
) returns table(thread_id uuid, broadcast_id uuid, message_id uuid, recipient_count integer)
language plpgsql security definer set search_path to pg_catalog, public
as $function$
declare
  v_receipt public.msg_broadcast_request_receipts%rowtype;
  v_result jsonb;
begin
  if p_sender_user_id is null or not exists (
    select 1 from public.msg_users u where u.id=p_sender_user_id and u.is_active and u.role in ('manager','admin')
  ) then raise exception 'Manager role required.' using errcode='42501'; end if;
  if p_client_broadcast_id is null or length(p_client_broadcast_id) not between 1 and 200
     or p_client_broadcast_id <> btrim(p_client_broadcast_id) then
    raise exception 'A stable client_broadcast_id is required.' using errcode='22023';
  end if;
  if p_body is null or btrim(p_body)='' or length(btrim(p_body))>2000 then
    raise exception 'Broadcast body must contain 1–2000 characters.' using errcode='22023';
  end if;
  if p_read_only is null then raise exception 'Read-only mode is required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('msg-broadcast:'||p_sender_user_id::text||':'||p_client_broadcast_id,0));
  select r.* into v_receipt from public.msg_broadcast_request_receipts r
    where r.sender_user_id=p_sender_user_id and r.client_broadcast_id=p_client_broadcast_id;
  if found then
    if v_receipt.request_title is distinct from p_title or v_receipt.request_body is distinct from p_body then
      raise exception 'Client broadcast ID already belongs to a different payload.' using errcode='23505';
    end if;
    v_result := v_receipt.result;
  elsif p_read_only then
    return;
  else
    select to_jsonb(outcome) into strict v_result from public.msg_send_broadcast(p_sender_user_id,p_title,p_body) outcome;
    insert into public.msg_broadcast_request_receipts(sender_user_id,client_broadcast_id,request_title,request_body,result)
      values(p_sender_user_id,p_client_broadcast_id,p_title,p_body,v_result);
  end if;
  return query select (v_result->>'thread_id')::uuid,(v_result->>'broadcast_id')::uuid,
    (v_result->>'message_id')::uuid,(v_result->>'recipient_count')::integer;
end
$function$;
revoke all on function public.msg_broadcast_operation_v1(uuid,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.msg_broadcast_operation_v1(uuid,text,text,text,boolean) to service_role;



-- EXACT GUARDED COMPONENT 3 F06_F07_lifetime_generation SOURCE ad503c00b946142cb97727f0f9b141f8401972f365590c0e561de007489c735e
-- STAGING PROPOSAL ONLY; Main owns canonical successor/provenance integration.
-- F06 owner decision: registration lasts until revoked or browser storage is lost.
-- F07 conditional anti-resurrection repair. No policy/PIN activation or restore.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $predecessor$
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT p.proowner FROM pg_proc p WHERE p.oid='custodial_leadership_private.session_view(uuid)'::regprocedure)
    IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
  THEN RAISE EXCEPTION 'Maintained privileged owner required' USING ERRCODE='42501';END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('custodial_leadership_private.session_view(uuid)'::regprocedure))
   IS DISTINCT FROM '9f009ef3449f4b5f1cb197a0262e8cd0e86de0dc0adb7e90c73b122b4e977869'
  THEN RAISE EXCEPTION 'Leadership session_view predecessor differs';END IF;
 IF NOT EXISTS(SELECT 1 FROM custodial_dr.restore_control WHERE singleton)
  THEN RAISE EXCEPTION 'Protected restore generation unavailable';END IF;
END $predecessor$;

-- No DEFAULT: replaying an old row must never bind it to today's generation.
ALTER TABLE custodial_leadership_private.registrations ADD COLUMN authority_generation bigint
 CHECK(authority_generation>=0);
-- Only a never-restored generation-zero database can safely identify legacy rows.
-- At any later generation an unbound row stays unbound and cannot authenticate.
UPDATE custodial_leadership_private.registrations SET authority_generation=0
 WHERE EXISTS(SELECT 1 FROM custodial_dr.restore_control WHERE singleton AND authority_generation=0
  AND NOT mutations_paused AND state='READY')
 AND NOT EXISTS(SELECT 1 FROM custodial_dr.restore_manifests);

-- Preserve finite historical revoked rows; all normal new enrollments below
-- are explicitly nonexpiring, not merely assigned another large finite TTL.
DO $lifetime_constraint$
DECLARE original_name text;matches integer;
BEGIN
 SELECT count(*),min(conname) INTO matches,original_name FROM pg_constraint
 WHERE conrelid='custodial_leadership_private.registrations'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%expires_at%' AND pg_get_constraintdef(oid) LIKE '%enrolled_at%'
 AND pg_get_constraintdef(oid) LIKE '%365 days%';
 IF matches<>1 THEN RAISE EXCEPTION 'Registration lifetime constraint predecessor differs';END IF;
 EXECUTE format('ALTER TABLE custodial_leadership_private.registrations DROP CONSTRAINT %I',original_name);
END $lifetime_constraint$;
ALTER TABLE custodial_leadership_private.registrations ADD CONSTRAINT registrations_expiration_policy
 CHECK(expires_at>enrolled_at AND (expires_at='infinity'::timestamptz OR expires_at<=enrolled_at+interval '365 days'));
-- The new owner policy removes routine expiry of existing unrevoked current-
-- generation registrations. It never changes revocation or restores a generation.
UPDATE custodial_leadership_private.registrations r SET expires_at='infinity'::timestamptz
 WHERE r.revoked_at IS NULL AND EXISTS(SELECT 1 FROM custodial_dr.restore_control c WHERE c.singleton
 AND c.authority_generation=r.authority_generation AND NOT c.mutations_paused AND c.state IN('READY','COMPLETE'));

CREATE FUNCTION custodial_leadership_private.bind_registration_generation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $bind$
DECLARE generation bigint;
BEGIN
 SELECT authority_generation INTO generation FROM custodial_dr.restore_control
  WHERE singleton AND NOT mutations_paused AND state IN('READY','COMPLETE') FOR SHARE;
 IF generation IS NULL THEN RAISE EXCEPTION 'Current registration generation unavailable' USING ERRCODE='55000';END IF;
 IF NEW.authority_generation IS NOT NULL AND NEW.authority_generation IS DISTINCT FROM generation
  THEN RAISE EXCEPTION 'Registration generation mismatch' USING ERRCODE='42501';END IF;
 NEW.authority_generation:=generation;
 RETURN NEW;
END $bind$;
ALTER FUNCTION custodial_leadership_private.bind_registration_generation() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION custodial_leadership_private.bind_registration_generation()
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
CREATE TRIGGER custodial_leadership_registration_generation BEFORE INSERT
 ON custodial_leadership_private.registrations FOR EACH ROW
 EXECUTE FUNCTION custodial_leadership_private.bind_registration_generation();

-- Exact retained source303 execute definition, rechecked on the owning DB.
-- Change only the registration INSERT's lifetime, never the enrollment PIN.
DO $registration_lifetime$
DECLARE definition text;old_fragment text:=$old$stamp,stamp+interval '365 days') RETURNING * INTO r;$old$;
BEGIN
 definition:=pg_get_functiondef('custodial_leadership_private.execute(text,jsonb)'::regprocedure);
 IF public.static_weekly_digest_text(definition) IS DISTINCT FROM '9bb0130bf1be532752ee00bd889620cf6654c98b7f9bbcc7c287402983a7830e'
 OR (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Leadership execute lifetime predecessor differs';END IF;
 EXECUTE replace(definition,old_fragment,$new$stamp,'infinity'::timestamptz) RETURNING * INTO r;$new$);
END $registration_lifetime$;

CREATE OR REPLACE FUNCTION custodial_leadership_private.session_view(p_registration uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $session$
DECLARE r custodial_leadership_private.registrations%rowtype;p custodial_leadership_private.policy%rowtype;
 names jsonb;chosen jsonb;contact jsonb;
BEGIN
 SELECT * INTO r FROM custodial_leadership_private.registrations WHERE registration_id=p_registration;
 SELECT * INTO p FROM custodial_leadership_private.policy WHERE singleton;
 IF NOT EXISTS(SELECT 1 FROM custodial_dr.restore_control control WHERE control.singleton
    AND control.authority_generation=r.authority_generation AND NOT control.mutations_paused
    AND control.state IN('READY','COMPLETE')) THEN RETURN NULL;END IF;
 IF NOT p.enabled OR r.registration_id IS NULL OR r.revoked_at IS NOT NULL OR r.expires_at<=clock_timestamp()
  OR r.cohort_principal_id IS DISTINCT FROM p.cohort_principal_id
  OR NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.manager_id=p.cohort_principal_id AND m.active AND m.revoked_at IS NULL AND m.is_system_principal=true)
  THEN RETURN NULL;END IF;
 names:=custodial_leadership_private.approved_names();
 SELECT n INTO chosen FROM jsonb_array_elements(names) n WHERE n->>'accountId'=r.claimed_account_id::text;
 IF chosen IS NULL OR r.claimed_account_id=p.cohort_principal_id THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('email',v.email,'verifiedAt',v.verified_at) INTO contact
  FROM custodial_leadership_private.verified_contacts v WHERE v.account_id=r.claimed_account_id AND v.verified_at<=clock_timestamp();
 RETURN jsonb_build_object('registrationId',r.registration_id,'browserId',r.browser_id,'credentialExpiresAt',CASE WHEN r.expires_at='infinity'::timestamptz THEN NULL ELSE to_jsonb(r.expires_at) END,
  'registrationLifetime',CASE WHEN r.expires_at='infinity'::timestamptz THEN 'UNTIL_REVOKED' ELSE NULL END,'csrfBinding',r.browser_hash,'claimedAccount',chosen||jsonb_build_object('contact',contact),
  'cohort',jsonb_build_object('principalId',p.cohort_principal_id,'policyVersion',p.policy_version,'securityEpoch',p.security_epoch,'permissions',to_jsonb(p.permissions)));
END $session$;

-- CREATE OR REPLACE retains existing owner/ACL. No new public RPC or table grant.


-- EXACT GUARDED COMPONENT 4 F05_notification_domain SOURCE 771760da2e7aede0d9c21446e7aa5744e9d9d95cedbb3cfacb28ae0b5009ddcf
-- STAGING ONLY. Main owns canonical integration. F05 genuine typed credentials.
-- Requires F01 selected-name msg_users columns; never creates legacy trust rows.
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';
DO $predecessor$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
 OR (SELECT proowner FROM pg_proc WHERE oid='public.ops_manager_notification_validate_owner()'::regprocedure)
 IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 THEN RAISE EXCEPTION 'Maintained privileged notification owner required';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.msg_users'::regclass
 AND attname='custodial_claimed_account_id' AND NOT attisdropped)
 OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.msg_users'::regclass
 AND attname='custodial_cohort_manager_id' AND NOT attisdropped)
 THEN RAISE EXCEPTION 'Selected-name Messenger authority predecessor required';END IF;
 IF strpos(pg_get_functiondef('public.ops_manager_notification_validate_owner()'::regprocedure),'from public.ops_manager_trusted_devices')=0
 THEN RAISE EXCEPTION 'Notification owner predecessor differs';END IF;
END $predecessor$;

CREATE TABLE public.ops_manager_notification_credentials(
 credential_id uuid PRIMARY KEY,
 credential_kind text NOT NULL CHECK(credential_kind IN('NAMED_TRUSTED_DEVICE','CUSTODIAL_LEADERSHIP_REGISTRATION')),
 trusted_credential_id uuid UNIQUE REFERENCES public.ops_manager_trusted_devices(credential_id) ON DELETE CASCADE,
 leadership_registration_id uuid UNIQUE REFERENCES custodial_leadership_private.registrations(registration_id) ON DELETE CASCADE,
 CHECK((credential_kind='NAMED_TRUSTED_DEVICE' AND trusted_credential_id IS NOT NULL AND trusted_credential_id=credential_id AND leadership_registration_id IS NULL)
 OR(credential_kind='CUSTODIAL_LEADERSHIP_REGISTRATION' AND leadership_registration_id IS NOT NULL AND leadership_registration_id=credential_id AND trusted_credential_id IS NULL))
);
ALTER TABLE public.ops_manager_notification_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_manager_notification_credentials FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_manager_notification_credentials FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,custodial_application_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ops_manager_notification_credentials TO postgres;
INSERT INTO public.ops_manager_notification_credentials(credential_id,credential_kind,trusted_credential_id)
 SELECT credential_id,'NAMED_TRUSTED_DEVICE',credential_id FROM (
 SELECT credential_id FROM public.ops_manager_notification_preferences UNION
 SELECT credential_id FROM public.ops_manager_push_devices UNION
 SELECT credential_id FROM public.ops_manager_notification_queue UNION
 SELECT credential_id FROM public.ops_manager_notification_state) existing;
DO $typed_foreign_keys$
DECLARE target text;original_name text;matches integer;
BEGIN
 FOREACH target IN ARRAY ARRAY['ops_manager_notification_preferences','ops_manager_push_devices','ops_manager_notification_queue','ops_manager_notification_state'] LOOP
 SELECT count(*),min(c.conname) INTO matches,original_name FROM pg_constraint c
 WHERE c.conrelid=('public.'||target)::regclass AND c.contype='f'
 AND c.confrelid='public.ops_manager_trusted_devices'::regclass
 AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='credential_id')]::smallint[];
 IF matches<>1 THEN RAISE EXCEPTION 'Notification FK predecessor differs: %',target;END IF;
 EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',target,original_name);
 EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY(credential_id) REFERENCES public.ops_manager_notification_credentials(credential_id) ON DELETE CASCADE',target,original_name);
 END LOOP;
END $typed_foreign_keys$;

-- No public/service-role EXECUTE or private-table privilege. This is called only
-- by the existing maintained owner functions/triggers and never returns secrets.
CREATE FUNCTION custodial_leadership_private.notification_credential(p_credential uuid,p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $credential$
DECLARE legacy public.ops_manager_trusted_devices%rowtype;view jsonb;has_registration boolean;
BEGIN
 IF p_credential IS NULL OR p_now IS NULL OR NOT isfinite(p_now) THEN RETURN NULL;END IF;
 SELECT * INTO legacy FROM public.ops_manager_trusted_devices WHERE credential_id=p_credential;
 SELECT EXISTS(SELECT 1 FROM custodial_leadership_private.registrations WHERE registration_id=p_credential) INTO has_registration;
 IF legacy.credential_id IS NOT NULL AND has_registration THEN RETURN NULL;END IF;
 IF has_registration THEN
  view:=custodial_leadership_private.session_view(p_credential);
  IF view IS NULL THEN RETURN NULL;END IF;
  RETURN jsonb_build_object('kind','CUSTODIAL_LEADERSHIP_REGISTRATION','managerId',view->'cohort'->>'principalId',
   'claimedAccountId',view->'claimedAccount'->>'accountId','deviceId',view->>'browserId');
 END IF;
 IF legacy.credential_id IS NULL OR legacy.revoked_at IS NOT NULL OR legacy.expires_at<=p_now
 OR NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.manager_id=legacy.manager_id
 AND m.active AND m.revoked_at IS NULL AND m.is_system_principal=false) THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('kind','NAMED_TRUSTED_DEVICE','managerId',legacy.manager_id,'claimedAccountId',legacy.manager_id,'deviceId',legacy.device_id);
END $credential$;
REVOKE ALL ON FUNCTION custodial_leadership_private.notification_credential(uuid,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

CREATE FUNCTION public.ops_manager_notification_bind_credential()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $bind$
DECLARE authority jsonb;bound public.ops_manager_notification_credentials%rowtype;
BEGIN
 authority:=custodial_leadership_private.notification_credential(NEW.credential_id);
 IF authority IS NULL OR (TG_TABLE_NAME<>'ops_manager_notification_state'
 AND authority->>'managerId' IS DISTINCT FROM to_jsonb(NEW)->>'manager_id')
 THEN RAISE EXCEPTION 'Current typed manager notification credential required' USING ERRCODE='23514';END IF;
 INSERT INTO public.ops_manager_notification_credentials(credential_id,credential_kind,trusted_credential_id,leadership_registration_id)
 VALUES(NEW.credential_id,authority->>'kind',CASE WHEN authority->>'kind'='NAMED_TRUSTED_DEVICE' THEN NEW.credential_id ELSE NULL END,
 CASE WHEN authority->>'kind'='CUSTODIAL_LEADERSHIP_REGISTRATION' THEN NEW.credential_id ELSE NULL END)
 ON CONFLICT(credential_id) DO NOTHING;
 SELECT * INTO bound FROM public.ops_manager_notification_credentials WHERE credential_id=NEW.credential_id;
 IF bound.credential_kind IS DISTINCT FROM authority->>'kind' THEN RAISE EXCEPTION 'Notification credential domain mismatch' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $bind$;
REVOKE ALL ON FUNCTION public.ops_manager_notification_bind_credential() FROM PUBLIC,anon,authenticated,service_role;
DO $bind_triggers$ DECLARE target text;BEGIN
 FOREACH target IN ARRAY ARRAY['ops_manager_notification_preferences','ops_manager_push_devices','ops_manager_notification_queue'] LOOP
 EXECUTE format('CREATE TRIGGER a_notification_bind_credential BEFORE INSERT OR UPDATE OF credential_id,manager_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ops_manager_notification_bind_credential()',target);
 END LOOP;
 CREATE TRIGGER a_notification_bind_credential BEFORE INSERT OR UPDATE OF credential_id ON public.ops_manager_notification_state
 FOR EACH ROW EXECUTE FUNCTION public.ops_manager_notification_bind_credential();
END $bind_triggers$;

CREATE OR REPLACE FUNCTION public.ops_manager_notification_validate_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $owner$
DECLARE authority jsonb;
BEGIN
 -- Revocation must remain possible after authority becomes stale, including
 -- the existing restore invalidation. It cannot resurrect or reassign a row.
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='ops_manager_push_devices' THEN
  IF NOT NEW.enabled AND NEW.revoked_at IS NOT NULL AND NEW.credential_id=OLD.credential_id AND NEW.manager_id=OLD.manager_id
  AND NEW.device_id=OLD.device_id AND NEW.fcm_token=OLD.fcm_token THEN NEW.updated_at:=now();RETURN NEW;END IF;
 END IF;
 authority:=custodial_leadership_private.notification_credential(NEW.credential_id);
 IF authority IS NULL OR authority->>'managerId' IS DISTINCT FROM NEW.manager_id::text
 OR(TG_TABLE_NAME='ops_manager_push_devices' AND authority->>'kind'='CUSTODIAL_LEADERSHIP_REGISTRATION'
 AND authority->>'deviceId' IS DISTINCT FROM to_jsonb(NEW)->>'device_id')
 THEN RAISE EXCEPTION 'Notification record must belong to its current typed manager credential' USING ERRCODE='23514';END IF;
 NEW.updated_at:=now();RETURN NEW;
END $owner$;

CREATE OR REPLACE FUNCTION public.custodial_ops_manager_notification_recipient_is_current(p_credential_id uuid,p_manager_id uuid,p_now timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $recipient$
 SELECT EXISTS(SELECT 1 FROM public.ops_manager_push_devices pd
 JOIN public.ops_manager_notification_credentials c USING(credential_id)
 WHERE pd.credential_id=p_credential_id AND pd.manager_id=p_manager_id AND pd.enabled AND pd.revoked_at IS NULL
 AND custodial_leadership_private.notification_credential(pd.credential_id,p_now)->>'kind'=c.credential_kind
 AND custodial_leadership_private.notification_credential(pd.credential_id,p_now)->>'managerId'=pd.manager_id::text);
$recipient$;
CREATE OR REPLACE FUNCTION public.custodial_ops_manager_notification_binding_is_current(
 p_push_device_id uuid,p_credential_id uuid,p_manager_id uuid,p_fcm_token_sha256 text,p_now timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $binding$
 SELECT EXISTS(SELECT 1 FROM public.ops_manager_push_devices pd WHERE pd.push_device_id=p_push_device_id
 AND pd.credential_id=p_credential_id AND pd.manager_id=p_manager_id
 AND encode(extensions.digest(convert_to(pd.fcm_token,'UTF8'),'sha256'),'hex')=p_fcm_token_sha256
 AND public.custodial_ops_manager_notification_recipient_is_current(pd.credential_id,pd.manager_id,p_now));
$binding$;

-- Existing durable dispatch/job leases and original-notification truth checks
-- call the two functions above; their lease/content/idempotency logic is unchanged.
CREATE OR REPLACE FUNCTION public.ops_manager_enqueue_message_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $message$
BEGIN
 IF NEW.is_deleted=true THEN RETURN NEW;END IF;
 INSERT INTO public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,source_id,title,body,data_json)
 SELECT 'manager-message:'||NEW.id::text||':'||pd.credential_id::text,pd.credential_id,pd.manager_id,'message',NEW.id,
 left(coalesce(nullif(sender.display_name,''),'Memphis Zoo Ops'),180),
 left(coalesce(nullif(regexp_replace(NEW.body,'[[:space:]]+',' ','g'),''),'New message'),1000),
 jsonb_build_object('kind','message','thread_id',NEW.thread_id::text,'message_id',NEW.id::text,
 'route','messages-chatscope.html?thread_id='||NEW.thread_id::text,'sender_name',coalesce(sender.display_name,'Memphis Zoo Ops'),'thread_title',coalesce(t.title,'Conversation'))
 FROM public.msg_thread_participants participant JOIN public.msg_users recipient ON recipient.id=participant.user_id
 JOIN public.ops_manager_push_devices pd ON pd.manager_id=coalesce(recipient.custodial_cohort_manager_id,recipient.ops_manager_id)
 CROSS JOIN LATERAL (SELECT custodial_leadership_private.notification_credential(pd.credential_id) authority) current_credential
 LEFT JOIN public.ops_manager_notification_preferences pref ON pref.credential_id=pd.credential_id
 LEFT JOIN public.msg_users sender ON sender.id=NEW.sender_user_id LEFT JOIN public.msg_threads t ON t.id=NEW.thread_id
 WHERE participant.thread_id=NEW.thread_id AND participant.left_at IS NULL AND participant.user_id<>NEW.sender_user_id
 AND pd.enabled AND pd.revoked_at IS NULL AND coalesce(pref.messages_enabled,true)
 AND current_credential.authority->>'managerId'=pd.manager_id::text
 AND ((current_credential.authority->>'kind'='NAMED_TRUSTED_DEVICE' AND recipient.ops_manager_id=pd.manager_id
       AND recipient.custodial_cohort_manager_id IS NULL AND recipient.custodial_claimed_account_id IS NULL)
 OR (current_credential.authority->>'kind'='CUSTODIAL_LEADERSHIP_REGISTRATION' AND recipient.ops_manager_id IS NULL
     AND recipient.custodial_cohort_manager_id=pd.manager_id
     AND recipient.custodial_claimed_account_id::text=current_credential.authority->>'claimedAccountId'))
 ON CONFLICT(job_key) DO NOTHING;
 RETURN NEW;
END $message$;

-- Recheck the selected inbox at the actual pre-send boundary. A changed
-- registration claim, removed participant, disabled preference or deleted message
-- cannot inherit a queue row produced for another selected-name inbox.
CREATE FUNCTION public.custodial_ops_manager_message_push_is_current(p_queue_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $message_current$
 SELECT EXISTS(SELECT 1 FROM public.ops_manager_notification_queue q
 WHERE q.queue_id=p_queue_id AND (q.notification_type<>'message' OR EXISTS(
 SELECT 1 FROM public.msg_messages message JOIN public.msg_thread_participants participant ON participant.thread_id=message.thread_id
 JOIN public.msg_users recipient ON recipient.id=participant.user_id
 LEFT JOIN public.ops_manager_notification_preferences pref ON pref.credential_id=q.credential_id
 CROSS JOIN LATERAL (SELECT custodial_leadership_private.notification_credential(q.credential_id) authority) current_credential
 WHERE message.id=q.source_id AND NOT message.is_deleted AND participant.left_at IS NULL
 AND participant.user_id<>message.sender_user_id AND recipient.is_active AND coalesce(pref.messages_enabled,true)
 AND current_credential.authority->>'managerId'=q.manager_id::text
 AND ((current_credential.authority->>'kind'='NAMED_TRUSTED_DEVICE' AND recipient.ops_manager_id=q.manager_id
       AND recipient.custodial_cohort_manager_id IS NULL AND recipient.custodial_claimed_account_id IS NULL)
 OR(current_credential.authority->>'kind'='CUSTODIAL_LEADERSHIP_REGISTRATION' AND recipient.ops_manager_id IS NULL
    AND recipient.custodial_cohort_manager_id=q.manager_id
    AND recipient.custodial_claimed_account_id::text=current_credential.authority->>'claimedAccountId')))));
$message_current$;
REVOKE ALL ON FUNCTION public.custodial_ops_manager_message_push_is_current(uuid)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,custodial_application_reader;

CREATE OR REPLACE FUNCTION public.ops_manager_notification_job_is_current(
 p_queue_id uuid,p_lease_token uuid,p_push_device_id uuid,p_fcm_token_sha256 text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $job$
 SELECT EXISTS(SELECT 1 FROM public.ops_manager_notification_queue q
 WHERE q.queue_id=p_queue_id AND q.status='leased' AND q.lease_token=p_lease_token AND q.leased_until>=now()
 AND public.custodial_ops_manager_notification_binding_is_current(p_push_device_id,q.credential_id,q.manager_id,p_fcm_token_sha256,now())
 AND public.custodial_ops_manager_message_push_is_current(q.queue_id)
 AND (q.notification_type<>'event_digest' OR public.app_event_manager_digest_is_current(q.data_json,now()))
 AND (q.notification_type<>'location_digest' OR public.custodial_ops_manager_location_digest_is_current(q.credential_id,q.data_json->>'location_fingerprint')));
$job$;
DO $finish_current$
DECLARE definition text;old_fragment text:='v_job_current:=v_recipient_current;';
BEGIN
 definition:=pg_get_functiondef('public.ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)'::regprocedure);
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 OR strpos(definition,'public.app_event_manager_digest_is_current')=0 THEN RAISE EXCEPTION 'Manager finish recipient predecessor differs';END IF;
 EXECUTE replace(definition,old_fragment,'v_job_current:=v_recipient_current AND public.custodial_ops_manager_message_push_is_current(v_row.queue_id);');
END $finish_current$;

-- Change only the authenticated recipient query, preserving current Event,
-- location, reminder, durable queue and operational-failure projection logic.
DO $scheduled$
DECLARE definition text;old_fragment text;new_fragment text;
BEGIN
 definition:=pg_get_functiondef('public.ops_manager_enqueue_scheduled_notifications(timestamptz)'::regprocedure);
 old_fragment:='join public.ops_manager_trusted_devices td on td.credential_id=pd.credential_id and td.manager_id=pd.manager_id join public.ops_manager_managers m on m.manager_id=pd.manager_id';
 new_fragment:='join public.ops_manager_notification_credentials nc on nc.credential_id=pd.credential_id';
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 OR (length(definition)-length(replace(definition,'and td.revoked_at is null and td.expires_at>p_now and m.active=true and m.revoked_at is null and m.is_system_principal=false','')))/length('and td.revoked_at is null and td.expires_at>p_now and m.active=true and m.revoked_at is null and m.is_system_principal=false')<>1
 THEN RAISE EXCEPTION 'Scheduled notification recipient predecessor differs';END IF;
 definition:=replace(definition,old_fragment,new_fragment);
 definition:=replace(definition,'and td.revoked_at is null and td.expires_at>p_now and m.active=true and m.revoked_at is null and m.is_system_principal=false',
 'and public.custodial_ops_manager_notification_recipient_is_current(pd.credential_id,pd.manager_id,p_now)');
 EXECUTE definition;
 definition:=pg_get_functiondef('public.ops_manager_enqueue_lunch_delivery_failure(uuid,timestamptz)'::regprocedure);
 old_fragment:=$old$join public.ops_manager_trusted_devices td
    on td.credential_id=pd.credential_id and td.manager_id=pd.manager_id
  join public.ops_manager_managers manager on manager.manager_id=pd.manager_id$old$;
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 OR strpos(definition,'and manager.is_system_principal=false')=0 THEN RAISE EXCEPTION 'Lunch failure recipient predecessor differs';END IF;
 definition:=replace(definition,old_fragment,'join public.ops_manager_notification_credentials nc on nc.credential_id=pd.credential_id');
 definition:=replace(definition,$old$and td.revoked_at is null and td.expires_at>p_now
    and manager.active=true and manager.revoked_at is null
    and manager.is_system_principal=false$old$,
 'and public.custodial_ops_manager_notification_recipient_is_current(pd.credential_id,pd.manager_id,p_now)');
 IF strpos(definition,'td.')>0 OR strpos(definition,'manager.is_system_principal')>0 THEN RAISE EXCEPTION 'Lunch recipient replacement incomplete';END IF;
 EXECUTE definition;
END $scheduled$;


-- EXACT GUARDED COMPONENT 5 operations SOURCE da6dd35c20b2d676f45fb21be0269fb612713cb361f8f5937bd503ca0fcba89a
-- REVIEWABLE PROPOSAL ONLY: Main owns canonical successor identity and inventory/canary provenance.
-- No historical migration is edited. Requires root-owned isolated verification.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)'::regprocedure)) IS DISTINCT FROM '7fa82fecdbafc4f2da58fc2996cdda75b8949a793846dc6fb6d54518be01a706' THEN RAISE EXCEPTION 'operations predecessor changed: public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)'; END IF; END $guard$;

DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)'::regprocedure)) IS DISTINCT FROM 'f18600be783af50bb5b57f2eb407f3cdf68a8c9e3c1b4cedbc76b257b8c4d66f' THEN RAISE EXCEPTION 'operations predecessor changed: public.mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)'; END IF; END $guard$;

DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_native_alert_prepare_at(uuid,uuid,jsonb,timestamptz)'::regprocedure)) IS DISTINCT FROM '1661a4a12fbe965408318183cc7e201dd7645ed099c261fa9066a1b9bb0ef2d3' THEN RAISE EXCEPTION 'operations predecessor changed: public.custodial_native_alert_prepare_at(uuid,uuid,jsonb,timestamptz)'; END IF; END $guard$;

DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_native_alert_finalize_at(uuid,uuid,uuid,jsonb,jsonb,timestamptz)'::regprocedure)) IS DISTINCT FROM '758cfabe33b62e2ca018cf1170a15df5348a1519fd570dfdc2557613e23a411f' THEN RAISE EXCEPTION 'operations predecessor changed: public.custodial_native_alert_finalize_at(uuid,uuid,uuid,jsonb,jsonb,timestamptz)'; END IF; END $guard$;

DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_viewdef('public.v_cleaning_performance_comparison'::regclass,true)) IS DISTINCT FROM '16884f0336717be3e2b48f0a442cd503182039053a7e9c0f39da0ad635158aa0' THEN RAISE EXCEPTION 'operations predecessor changed: public.v_cleaning_performance_comparison'; END IF; END $guard$;

DO $guard$ BEGIN IF to_regprocedure('public.custodial_native_alert_utf8_prefix(text,integer)') IS NOT NULL THEN RAISE EXCEPTION 'native prefix identity already exists';END IF;END $guard$;

CREATE FUNCTION public.custodial_native_alert_utf8_prefix(p_value text,p_max_bytes integer)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $prefix$
declare result text;
begin
 if p_max_bytes<0 or p_max_bytes>1000 then raise exception 'native preview byte budget invalid' using errcode='22023';end if;
 result:=left(p_value,p_max_bytes);
 while octet_length(result)>p_max_bytes loop result:=left(result,length(result)-1);end loop;
 return result;
end $prefix$;
REVOKE ALL ON FUNCTION public.custodial_native_alert_utf8_prefix(text,integer) FROM public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.evaluate_location_proximity_v2(p_location_code text, p_device_identifier text, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric DEFAULT NULL::numeric, p_session_uuid text DEFAULT NULL::text, p_client_event_id text DEFAULT NULL::text, p_correlation_id text DEFAULT NULL::text, p_observed_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_session_key text:=nullif(btrim(coalesce(p_session_uuid,'')),'');
  v_session_state text;
  v_session public.sessions%rowtype;
  v_device public.devices%rowtype;
  v_result jsonb;
  v_location_code text;
  v_target_lat numeric;
  v_target_lon numeric;
  v_radius numeric;
  v_surveyed_at timestamptz;
  v_confidence text;
  v_source text;
  v_distance numeric;
  v_uncertainty numeric;
  v_result_code text;
  v_authoritative boolean:=false;
  v_scope text:='advisory_uncalibrated';
  v_event_id uuid;
  v_event_count integer;
begin
  -- Advisory GPS can never create work authority. Settle rejected telemetry
  -- without persisting coordinates or blocking a separate cleaning command.
  if v_session_key is null then
    return jsonb_build_object('ok',true,'result','gps_session_unavailable',
      'authoritative',false,'authority_scope','advisory_no_active_session','scan_event_id',null);
  end if;
  select s.* into v_session from public.sessions s
    join public.locations l on l.id=s.location_id and l.active=true
    where s.session_uuid=v_session_key
      and l.location_code=public.resolve_scan_location_code(p_location_code)
    for share of s;
  select d.* into v_device from public.devices d
    where d.id=v_session.device_id and d.active=true and (
      upper(btrim(d.device_id))=upper(btrim(coalesce(p_device_identifier,'')))
      or exists(select 1 from public.device_aliases a where a.canonical_device_id=d.id
        and a.active=true and upper(btrim(a.alias_identifier))=upper(btrim(coalesce(p_device_identifier,'')))))
    for share of d;
  if v_session.id is null or v_device.id is null then
    raise exception using errcode='23503', message='Session does not belong to this device and location';
  end if;
  v_session_state:=v_session.status;
  if v_session.status<>'active' or v_session.ended_at is not null then
    return jsonb_build_object('ok',true,'result','post_session','authoritative',false,
      'authority_scope','post_session_advisory','session_state',v_session_state,'scan_event_id',null);
  end if;
  if v_session.employee_id is distinct from v_device.assigned_employee_id
    or v_session.assignment_epoch_snapshot is null
    or v_session.assignment_epoch_snapshot is distinct from v_device.assignment_epoch then
    return jsonb_build_object('ok',true,'result','gps_original_actor_unavailable','authoritative',false,
      'authority_scope','advisory_original_actor_unavailable','scan_event_id',null);
  end if;
  if p_observed_at is null or not isfinite(p_observed_at)
    or v_session.started_at is null or not isfinite(v_session.started_at)
    or p_observed_at<v_session.started_at or p_observed_at>clock_timestamp() then
    return jsonb_build_object('ok',true,'result','gps_timestamp_unavailable','authoritative',false,
      'authority_scope','advisory_outside_active_interval','scan_event_id',null);
  end if;

  v_location_code:=public.resolve_scan_location_code(p_location_code);
  if v_location_code is null then
    raise exception using errcode='23503', message='Active scanned location was not found';
  end if;
  -- The measurement core historically substitutes clock_timestamp() for NULL.
  -- Settle an old queued reading as unavailable without a status/event write;
  -- an arrival time is not a phone capture time. This keeps saved cleaning
  -- actions moving and does not reject or defer a cleaning submission.
  if p_observed_at is null then
    return jsonb_build_object('ok',true,'result','gps_timestamp_unavailable',
      'authoritative',false,'authority_scope','advisory_missing_capture_time',
      'scan_event_id',null);
  end if;
  select lp.latitude,lp.longitude,lp.authority_radius_m,lp.authority_surveyed_at,
         lp.coordinate_confidence,lp.coordinate_source
    into v_target_lat,v_target_lon,v_radius,v_surveyed_at,v_confidence,v_source
  from public.locations l
  join public.location_proximity_settings lp on lp.location_id=l.id
  where l.active=true and l.location_code=v_location_code and lp.active=true
    and lp.latitude is not null and lp.longitude is not null
  order by lp.updated_at desc
  limit 1
  for share of lp;

  v_result:=public.custodial_evaluate_location_proximity_v2_measurement(
    p_location_code,p_device_identifier,p_latitude,p_longitude,p_accuracy_m,
    p_session_uuid,p_client_event_id,p_correlation_id,p_observed_at
  );

  v_result_code:=coalesce(v_result->>'result','gps_unavailable');
  if v_target_lat is not null and v_target_lon is not null
     and v_radius is not null and v_surveyed_at is not null and v_surveyed_at<=clock_timestamp()
     and lower(btrim(coalesce(v_confidence,'')))='surveyed'
     and nullif(btrim(coalesce(v_source,'')),'') is not null then
    v_scope:='surveyed_location_radius';
    -- The core has already checked observation age, accuracy and motion. Its
    -- global-radius near/away/boundary result is replaced using the surveyed
    -- exact location and radius; terminal session handling remains below.
    if v_result_code in ('near','away','boundary_uncertain') then
      v_distance:=6371000 * 2 * asin(sqrt(
        power(sin(radians((p_latitude-v_target_lat)::double precision)/2),2)
        + cos(radians(v_target_lat::double precision))*cos(radians(p_latitude::double precision))
        * power(sin(radians((p_longitude-v_target_lon)::double precision)/2),2)
      ));
      v_uncertainty:=greatest(
        greatest(5,public.get_setting_int('gps_boundary_hysteresis_m',15)),
        least(greatest(coalesce(p_accuracy_m,0),0),greatest(25,public.get_setting_int('gps_max_accuracy_m',100)))
      );
      if abs(v_distance-v_radius)<=v_uncertainty then
        v_result_code:='boundary_uncertain';
      elsif v_distance<v_radius then
        v_result_code:='near';
        v_authoritative:=true;
      else
        v_result_code:='away';
        v_authoritative:=true;
      end if;
    end if;
  elsif v_result_code in ('near','away','boundary_uncertain') then
    v_result_code:='location_uncalibrated';
  end if;

  if v_session_state is not null and v_session_state not in ('active','pending_submit') then
    v_result_code:='post_session';
    v_authoritative:=false;
    v_scope:='post_session_advisory';
  end if;

  v_event_id:=nullif(v_result->>'scan_event_id','')::uuid;
  -- A repeated client event ID may refer to an earlier, different reading.
  -- Never rewrite that evidence or return a new authoritative claim for it.
  update public.scan_events se
     set result=v_result_code,
         notes=case
           when v_result_code='near' then 'Phone is within the surveyed scanned-location radius.'
           when v_result_code='away' then 'Phone is outside the surveyed scanned-location radius.'
           when v_result_code='location_uncalibrated' then 'GPS estimate is advisory; the scanned location has no surveyed coordinate and radius.'
           when v_result_code='post_session' then 'GPS arrived after the cleaning was no longer active; advisory evidence only.'
           else se.notes end,
         payload_json=coalesce(se.payload_json,'{}'::jsonb) || jsonb_build_object(
           'authoritative',v_authoritative,'authority_scope',v_scope,
           'evidence_scope',case when v_scope='post_session_advisory' then 'post_session_advisory' else 'active_work_advisory' end,
           'session_state',v_session_state,
           'original_employee_id',v_session.employee_id,
           'original_assignment_epoch',v_session.assignment_epoch_snapshot,
           'allowed_radius_m',case when v_scope='surveyed_location_radius' then v_radius else null end,
           'coordinate_source',case when v_scope='surveyed_location_radius' then v_source else se.payload_json->>'coordinate_source' end,
           'surveyed_at',v_surveyed_at
         )
  where se.id=v_event_id
    and se.event_type='work_position_check'
    and se.location_code=v_result->>'location_code'
    and se.device_identifier=v_result->>'device_id'
    and se.session_id is not distinct from (
      select s.id from public.sessions s where s.session_uuid=v_result->>'session_uuid' limit 1
    )
    and (se.payload_json->>'observed_at')::timestamptz=p_observed_at
    and se.payload_json->>'correlation_id' is not distinct from p_correlation_id
    and (se.payload_json->>'client_latitude')::numeric is not distinct from p_latitude
    and (se.payload_json->>'client_longitude')::numeric is not distinct from p_longitude
    and (se.payload_json->>'accuracy_m')::numeric is not distinct from p_accuracy_m;
  get diagnostics v_event_count=row_count;
  if v_event_count<>1 then
    v_result_code:='gps_duplicate_event';
    v_authoritative:=false;
    v_scope:='advisory_duplicate_event';
  end if;

  update public.device_location_proximity_status gps
     set result=v_result_code,
         badge_color=case when v_result_code='near' then 'green' when v_result_code='away' then 'red' else 'amber' end,
         allowed_radius_m=case when v_scope='surveyed_location_radius' then v_radius else gps.allowed_radius_m end,
         metadata_json=coalesce(gps.metadata_json,'{}'::jsonb) || jsonb_build_object(
           'authoritative',v_authoritative,'authority_scope',v_scope,
           'evidence_scope',case when v_scope='post_session_advisory' then 'post_session_advisory' else 'active_work_advisory' end,
           'session_state',v_session_state,
           'original_employee_id',v_session.employee_id,
           'original_assignment_epoch',v_session.assignment_epoch_snapshot,
           'surveyed_at',v_surveyed_at
         )
  where gps.device_id=(select d.id from public.devices d where d.device_id=v_result->>'device_id' limit 1)
    and gps.location_id=(select l.id from public.locations l where l.location_code=v_result->>'location_code' limit 1)
    and gps.session_uuid=coalesce(v_result->>'session_uuid','')
    and gps.evaluated_at=(v_result->>'evaluated_at')::timestamptz;

  return v_result || jsonb_build_object(
    'result',v_result_code,
    'authoritative',v_authoritative,
    'authority_scope',v_scope,
    'evidence_scope',case when v_scope='post_session_advisory' then 'post_session_advisory' else 'active_work_advisory' end,
    'session_state',v_session_state,
           'original_employee_id',v_session.employee_id,
           'original_assignment_epoch',v_session.assignment_epoch_snapshot,
    'badge_color',case when v_result_code='near' then 'green' when v_result_code='away' then 'red' else 'amber' end,
    'allowed_radius_m',case when v_scope='surveyed_location_radius' then v_radius else null end,
    'surveyed_at',v_surveyed_at
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.mz_employee_event_push_current_projection(p_job_id uuid, p_lease_token uuid, p_instance_id uuid, p_credential_id uuid, p_assignment_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_job public.operational_notification_jobs%rowtype;
  v_instance public.event_push_instances%rowtype;
  v_event public.events_app_events%rowtype;
  v_employee public.employees%rowtype;
  v_place jsonb;
begin
  if p_job_id is null or p_lease_token is null or p_instance_id is null
    or p_credential_id is null or p_assignment_epoch is null or p_assignment_epoch<1 then
    raise exception using errcode='22023',message='exact leased Event delivery identity is required';
  end if;
  select * into v_job from public.operational_notification_jobs where job_id=p_job_id;
  select * into v_instance from public.event_push_instances where instance_id=p_instance_id;
  if v_job.job_id is null or v_job.job_type<>'employee_event_push'
    or v_job.source_id<>p_instance_id or v_job.status<>'leased'
    or v_job.lease_token is distinct from p_lease_token
    or v_job.leased_until is null or v_job.leased_until<=statement_timestamp()
    or v_instance.instance_id is null or v_instance.state<>'leased'
    or v_instance.dispatch_job_id is distinct from p_job_id
    or v_instance.dispatch_lease_token is distinct from p_lease_token
    or v_instance.credential_id is distinct from p_credential_id
    or v_instance.assignment_epoch is distinct from p_assignment_epoch
    or v_job.payload_json->>'employee_id' is distinct from v_instance.employee_id::text
    or v_job.payload_json->>'event_id' is distinct from v_instance.event_id::text
    or v_job.payload_json->>'notification_key' is distinct from v_instance.notification_key
    or not exists(
      select 1 from public.devices d
      join public.device_auth_credentials c on c.device_id=d.id
        and c.credential_id=v_instance.credential_id
      join public.employee_push_registrations r on r.device_id=d.id
        and r.credential_id=c.credential_id
      where d.id=v_instance.device_id and d.active=true
        and d.assigned_employee_id=v_instance.employee_id
        and d.assignment_epoch=v_instance.assignment_epoch
        and c.confirmed_at is not null and c.revoked_at is null
        and c.expires_at>statement_timestamp()
        and r.registration_id=v_instance.dispatch_registration_id
        and r.employee_id=v_instance.employee_id
        and r.assignment_epoch=v_instance.assignment_epoch
        and r.token_hash=v_instance.dispatch_token_hash
        and r.active=true and r.revoked_at is null) then
    return jsonb_build_object('current',false,'reason','event_delivery_identity_superseded');
  end if;
  select * into v_event from public.events_app_events where id=v_instance.event_id;
  select * into v_employee from public.employees where id=v_instance.employee_id and active=true;
  if v_event.id is null or v_employee.id is null
    or v_event.revision<>v_instance.event_revision or v_event.status<>'SCHEDULED'
    or coalesce(v_event.needs_review,false) or v_event.event_scope='UNKNOWN'
    or v_event.cancelled_at is not null or v_event.archived_at is not null
    or v_event.start_instant_utc is null or v_event.end_instant_utc is null
    or not isfinite(v_event.start_instant_utc) or not isfinite(v_event.end_instant_utc)
    or v_event.end_instant_utc<=v_event.start_instant_utc
    or v_event.end_instant_utc<=statement_timestamp()
    or not exists(select 1 from public.mz_event_reminder_schedule(
      v_event.id,v_event.revision,v_instance.employee_id,v_instance.notification_kind) schedule
      where schedule.scheduled_for=v_instance.scheduled_for) then
    return jsonb_build_object('current',false,'reason','event_or_recipient_superseded');
  end if;
  v_place:=public.app_event_place_authority(to_jsonb(v_event),statement_timestamp());
  if (v_place->>'admissible')::boolean is not true then
    return jsonb_build_object('current',false,'reason','event_place_needs_review');
  end if;
  return jsonb_build_object('current',true,'event_id',v_event.id,
    'event_revision',v_event.revision,'instance_id',v_instance.instance_id,
    'notification_key',v_instance.notification_key,
    'employee_id',v_employee.id,'employee_name',v_employee.display_name,
    'event_name',v_event.event_name,
    'display_location',coalesce(nullif(v_place->>'primary_display_name',''),v_event.display_location),
    'event_date',v_event.event_date,'start_time',v_event.start_time,
    'end_time',v_event.end_time,'start_instant_utc',v_event.start_instant_utc,
    'end_instant_utc',v_event.end_instant_utc,
    'attendee_count',v_event.attendee_count,
    'custodial_note_codes',v_event.custodial_note_codes,
    'custodial_public_notes',v_event.custodial_public_notes,
    'place_authority',v_place->>'capability_authority');
end $function$;

CREATE OR REPLACE FUNCTION public.custodial_native_alert_prepare_at(p_job uuid, p_lease uuid, p_expected jsonb, p_test_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare target jsonb;j public.operational_notification_jobs%rowtype;i public.event_push_instances%rowtype;
 prep public.employee_native_alert_preparations%rowtype;claim jsonb;projection jsonb;
 at_time timestamptz;until_time timestamptz;revision text;kind text;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_lease is null or jsonb_typeof(p_expected) is distinct from 'object' then
  raise exception 'exact alert preparation required' using errcode='22023';end if;
 target:=public.custodial_native_alert_target_at(p_job,p_lease,p_test_at);
 if target->'current' is distinct from 'true'::jsonb or target->'expected' is distinct from p_expected then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_target_superseded');end if;
 select * into j from public.operational_notification_jobs where job_id=p_job for update;
 at_time:=coalesce(p_test_at,clock_timestamp());kind:=target->>'kind';
 until_time:=least(j.leased_until,(select expires_at from public.device_auth_credentials
  where credential_id=(p_expected->>'credential_id')::uuid));
 select * into prep from public.employee_native_alert_preparations where job_id=p_job for update;
 if prep.job_id is not null then
  if prep.lease_token is distinct from p_lease or prep.expected is distinct from p_expected
   or prep.alert_kind is distinct from kind or prep.prepared_until<=at_time then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_preparation_superseded');end if;
  return jsonb_build_object('schema','custodial.native-alert-preparation.v1','current',true,
   'dispatch_authorized',false,'prepared_id',prep.preparation_id,'job_id',p_job,'lease_token',p_lease,
   'kind',kind,'expected',prep.expected,'source_revision',prep.source_revision,
   'source_projection',prep.source_projection,
   'prepared_until',public.custodial_native_location_utc(prep.prepared_until));
 end if;
 if kind='EVENT' then
  select * into i from public.event_push_instances where instance_id=j.source_id for update;
  claim:=public.mz_claim_employee_event_push_delivery(p_job,p_lease,i.instance_id,
   (p_expected->>'credential_id')::uuid,i.assignment_epoch,(p_expected->>'registration_id')::uuid,
   p_expected->>'token_digest',at_time);
  if claim->'dispatch_authorized' is distinct from 'true'::jsonb then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_event_claim_unavailable');end if;
  projection:=public.mz_employee_event_push_current_projection(p_job,p_lease,i.instance_id,
   (p_expected->>'credential_id')::uuid,i.assignment_epoch);
  if projection->'current' is distinct from 'true'::jsonb then
   raise exception 'native Event projection unavailable after claim' using errcode='42501';end if;
  until_time:=least(until_time,(projection->>'end_instant_utc')::timestamptz);
  projection:=projection||jsonb_build_object('notification_kind',i.notification_kind,'service_date',i.service_date::text);
  revision:=public.static_weekly_digest_jsonb(projection);
 elsif kind='MESSAGE' then
  claim:=public.mz_prepare_employee_native_push_delivery(p_job,p_lease,
   (p_expected->>'credential_id')::uuid,(p_expected->>'assignment_epoch')::bigint,
   (p_expected->>'registration_id')::uuid,p_expected->>'token_digest',at_time);
  if claim->'dispatch_authorized' is distinct from 'true'::jsonb
   or jsonb_typeof(claim->'message_projection') is distinct from 'object' then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_message_source_unavailable');end if;
  projection:=claim->'message_projection';revision:=projection->>'source_revision';
 else raise exception 'native alert kind unavailable' using errcode='22023';end if;
 if not isfinite(at_time) or until_time<=at_time+interval '1 second'
  or revision !~ '^[0-9a-f]{64}$' then
  raise exception 'native alert preparation window or source unavailable' using errcode='42501';end if;
 insert into public.employee_native_alert_preparations(job_id,lease_token,alert_kind,expected,
  source_projection,source_revision,prepared_at,prepared_until)
 values(p_job,p_lease,kind,p_expected,projection,revision,at_time,until_time) returning * into prep;
 return jsonb_build_object('schema','custodial.native-alert-preparation.v1','current',true,
  'dispatch_authorized',false,'prepared_id',prep.preparation_id,'job_id',p_job,'lease_token',p_lease,
  'kind',kind,'expected',prep.expected,'source_revision',prep.source_revision,
  'source_projection',prep.source_projection,
  'prepared_until',public.custodial_native_location_utc(prep.prepared_until));
end $function$;

CREATE OR REPLACE FUNCTION public.custodial_native_alert_finalize_at(p_job uuid, p_lease uuid, p_prepared uuid, p_expected jsonb, p_candidate jsonb, p_test_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare target jsonb;prep public.employee_native_alert_preparations%rowtype;
 prior public.employee_native_alert_finalizations%rowtype;j public.operational_notification_jobs%rowtype;
 c public.device_auth_credentials%rowtype;i public.event_push_instances%rowtype;
 projection jsonb;at_time timestamptz;until_time timestamptz;data jsonb;
 required_keys text[];ttl integer;row_out public.employee_native_alert_finalizations%rowtype;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_lease is null or p_prepared is null
  or jsonb_typeof(p_expected) is distinct from 'object'
  or jsonb_typeof(p_candidate) is distinct from 'object' then
  raise exception 'exact native alert finalize request required' using errcode='22023';end if;
 target:=public.custodial_native_alert_target_at(p_job,p_lease,p_test_at);
 if target->'current' is distinct from 'true'::jsonb or target->'expected' is distinct from p_expected then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_target_superseded');end if;
 select * into j from public.operational_notification_jobs where job_id=p_job for update;
 select * into prep from public.employee_native_alert_preparations where job_id=p_job for update;
 at_time:=coalesce(p_test_at,clock_timestamp());
 if prep.job_id is null or prep.preparation_id<>p_prepared or prep.lease_token<>p_lease
  or prep.expected is distinct from p_expected or prep.alert_kind is distinct from target->>'kind'
  or prep.prepared_until<=at_time or j.leased_until<=at_time then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_preparation_superseded');end if;
 select * into prior from public.employee_native_alert_finalizations where job_id=p_job for update;
 if prior.job_id is not null then
  return jsonb_build_object('current',true,'dispatch_authorized',false,
   'delivery_outcome_unknown',true,'reason','native_alert_original_finalization_no_resend');end if;
 select * into c from public.device_auth_credentials where credential_id=(p_expected->>'credential_id')::uuid for update;
 until_time:=least(prep.prepared_until,j.leased_until,c.expires_at);
 if c.credential_id is null or c.revoked_at is not null or c.expires_at<=at_time then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_credential_superseded');end if;
 if prep.alert_kind='EVENT' then
  select * into i from public.event_push_instances where instance_id=j.source_id for update;
  projection:=public.mz_employee_event_push_current_projection(p_job,p_lease,i.instance_id,c.credential_id,i.assignment_epoch);
  if projection->'current' is distinct from 'true'::jsonb then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_event_source_superseded');end if;
  projection:=projection||jsonb_build_object('notification_kind',i.notification_kind,'service_date',i.service_date::text);
  until_time:=least(until_time,(projection->>'end_instant_utc')::timestamptz);
  required_keys:=array['body','channel_id','event_id','event_revision','instance_id','kind',
   'notification_key','notification_kind','notification_type','recipient_device_uuid','route',
   'schema','service_date','source_revision','title'];
 else
  if not public.custodial_native_alert_message_current(p_job,prep.source_projection,at_time) then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_message_source_superseded');end if;
  projection:=prep.source_projection;
  required_keys:=array['body','channel_id','kind','message_id','notification_key','notification_type',
   'recipient_user_id','route','schema','source_revision','thread_id','title'];
 end if;
 if projection is distinct from prep.source_projection
  or (prep.alert_kind='EVENT' and public.static_weekly_digest_jsonb(projection) is distinct from prep.source_revision)
  or (prep.alert_kind='MESSAGE' and projection->>'source_revision' is distinct from prep.source_revision)
  or until_time<=at_time+interval '1 second' then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_source_or_window_superseded');end if;
 if (select array_agg(key order by key collate "C") from jsonb_object_keys(p_candidate) key) is distinct from required_keys
  or exists(select 1 from jsonb_each(p_candidate) e where jsonb_typeof(e.value)<>'string')
  or octet_length(p_candidate->>'title') not between 1 and 180
  or octet_length(p_candidate->>'body') not between 1 and 1000
  or p_candidate->>'source_revision' is distinct from prep.source_revision
  or p_candidate->>'kind' is distinct from (case prep.alert_kind when 'EVENT' then 'employee_event' else 'employee_message' end)
  or p_candidate->>'notification_type' is distinct from lower(prep.alert_kind)
  or p_candidate->>'channel_id' is distinct from (case prep.alert_kind when 'EVENT' then 'employee-events' else 'employee-messages' end)
  or p_candidate->>'schema' is distinct from (case prep.alert_kind when 'EVENT' then 'custodial.native-event-payload.v1'
   else 'custodial.native-message-payload.v1' end) then
  raise exception 'native alert content candidate invalid' using errcode='22023';end if;
 if prep.alert_kind='EVENT' then
  if coalesce(projection->>'employee_name','')=''
   or coalesce(projection->>'event_name','')=''
   or coalesce(projection->>'display_location','')=''
   or p_candidate->>'event_id' is distinct from projection->>'event_id'
   or p_candidate->>'instance_id' is distinct from projection->>'instance_id'
   or p_candidate->>'event_revision' is distinct from projection->>'event_revision'
   or p_candidate->>'recipient_device_uuid' is distinct from p_expected->>'device_uuid'
   or p_candidate->>'notification_kind' is distinct from projection->>'notification_kind'
   or p_candidate->>'service_date' is distinct from projection->>'service_date'
   or p_candidate->>'notification_key' is distinct from projection->>'notification_key'
   or p_candidate->>'route' is distinct from 'events.html?hub=employee&event_id='||(projection->>'event_id')
   or p_candidate->>'title' is distinct from 'Memphis Zoo event reminder'
   or position((case when octet_length(projection->>'employee_name')<=120 then projection->>'employee_name' else public.custodial_native_alert_utf8_prefix(projection->>'employee_name',117)||'…' end) in p_candidate->>'body')=0
   or position((case when octet_length(projection->>'event_name')<=180 then projection->>'event_name' else public.custodial_native_alert_utf8_prefix(projection->>'event_name',177)||'…' end) in p_candidate->>'body')=0
   or position((case when octet_length(projection->>'display_location')<=240 then projection->>'display_location' else public.custodial_native_alert_utf8_prefix(projection->>'display_location',237)||'…' end) in p_candidate->>'body')=0 then
   raise exception 'native Event content not bound to current source' using errcode='42501';end if;
 else
  if p_candidate->>'message_id' is distinct from projection->>'message_id'
   or p_candidate->>'thread_id' is distinct from projection->>'thread_id'
   or p_candidate->>'recipient_user_id' is distinct from projection->>'recipient_user_id'
   or p_candidate->>'notification_key' is distinct from 'message:'||j.source_id::text
   or p_candidate->>'route' is distinct from 'messages.html?hub=employee&thread_id='||(projection->>'thread_id')
   or p_candidate->>'title' is distinct from public.custodial_native_alert_utf8_prefix(projection#>>'{payload,title}',180)
   or p_candidate->>'body' is distinct from public.custodial_native_alert_utf8_prefix(projection#>>'{payload,body}',1000) then
   raise exception 'native Message content not bound to current source' using errcode='42501';end if;
 end if;
 if exists(select 1 from jsonb_each_text(p_candidate) e where e.value~'[[:cntrl:]]') then
  raise exception 'native alert content contains controls' using errcode='22023';end if;
 data:=p_candidate||jsonb_build_object('generation_id',p_expected->>'generation_id',
  'principal_digest',p_expected->>'principal_digest','token_digest',p_expected->>'token_digest',
  'receipt_job_id',p_job::text,'receipt_credential_id',p_expected->>'credential_id',
  'receipt_employee_id',p_expected->>'employee_id','receipt_device_id',p_expected->>'device_id',
  'receipt_assignment_epoch',p_expected->>'assignment_epoch',
  'reservation_at',public.custodial_native_location_utc(at_time),
  'valid_until',public.custodial_native_location_utc(until_time));
 if prep.alert_kind='MESSAGE' then
  data:=data||jsonb_build_object('service_date',public.sch_service_date(at_time)::text);end if;
 data:=data||jsonb_build_object('content_sha256',
  public.static_weekly_digest_text(public.custodial_native_location_canonical(data)));
 if octet_length(public.custodial_native_location_canonical(data))>3500 then
  raise exception 'native alert closed wire too large' using errcode='22023';end if;
 insert into public.employee_native_alert_finalizations(job_id,preparation_id,alert_kind,source_revision,
  payload,content_sha256,finalized_at,valid_until)
 values(p_job,p_prepared,prep.alert_kind,prep.source_revision,data,data->>'content_sha256',at_time,until_time)
 returning * into row_out;
 ttl:=least(2419200,floor(extract(epoch from until_time-at_time))::integer);
 return jsonb_build_object('schema','custodial.native-alert-dispatch.v1','dispatch_authorized',true,
  'reservation',jsonb_build_object('current',true,'replayed',false,'delivery_outcome_unknown',false,
   'dispatch_authorized',true,'payload',data,'wire',public.custodial_native_location_canonical(data)),
  'attempt_id',row_out.attempt_id,'outcome_operation_id',row_out.outcome_operation_id,'ttl_seconds',ttl);
end $function$;

CREATE OR REPLACE VIEW public.v_cleaning_performance_comparison WITH (security_invoker=true) AS
 WITH facts AS (
         SELECT v_cleaning_session_facts.session_id,
            v_cleaning_session_facts.session_uuid,
            v_cleaning_session_facts.client_session_id,
            v_cleaning_session_facts.status,
            v_cleaning_session_facts.location_id,
            v_cleaning_session_facts.location_code,
            v_cleaning_session_facts.location_name,
            v_cleaning_session_facts.location_type,
            v_cleaning_session_facts.employee_id,
            v_cleaning_session_facts.employee_code,
            v_cleaning_session_facts.employee_name,
            v_cleaning_session_facts.device_id,
            v_cleaning_session_facts.device_identifier,
            v_cleaning_session_facts.started_at,
            v_cleaning_session_facts.ended_at,
            v_cleaning_session_facts.duration_minutes,
            v_cleaning_session_facts.duration_display,
            v_cleaning_session_facts.completion_source,
            v_cleaning_session_facts.completion_response_id,
            v_cleaning_session_facts.completion_submitted_at,
            v_cleaning_session_facts.services_performed,
            v_cleaning_session_facts.cleaning_note,
            v_cleaning_session_facts.maintenance_ticket_count,
            v_cleaning_session_facts.open_maintenance_ticket_count,
            v_cleaning_session_facts.maintenance_issue_categories,
            v_cleaning_session_facts.maintenance_fixture_identifiers,
            v_cleaning_session_facts.inspection_count,
            v_cleaning_session_facts.inspection_score_total,
            v_cleaning_session_facts.average_inspection_score,
            v_cleaning_session_facts.inspection_pass_count,
            v_cleaning_session_facts.latest_inspection_score,
            v_cleaning_session_facts.latest_inspection_passed,
            v_cleaning_session_facts.latest_inspected_at,
            v_cleaning_session_facts.latest_inspection_notes
           FROM v_cleaning_session_facts
          WHERE v_cleaning_session_facts.status = 'closed'::text AND v_cleaning_session_facts.duration_minutes IS NOT NULL AND v_cleaning_session_facts.duration_minutes >= 0 AND EXISTS (SELECT 1 FROM unnest(v_cleaning_session_facts.services_performed) AS performed(service) WHERE nullif(btrim(performed.service),'') IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM public.completion_responses response WHERE response.id=v_cleaning_session_facts.completion_response_id AND response.response_json->>'work_result'='checked_no_cleaning_needed')
        ), employee_location AS (
         SELECT facts.employee_id,
            facts.employee_code,
            facts.employee_name,
            facts.location_id,
            facts.location_code,
            facts.location_name,
            count(*)::integer AS cleaning_count,
            round(avg(facts.duration_minutes), 1) AS average_duration_minutes,
            round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (facts.duration_minutes::double precision))::numeric, 1) AS median_duration_minutes,
            round(percentile_cont(0.9::double precision) WITHIN GROUP (ORDER BY (facts.duration_minutes::double precision))::numeric, 1) AS p90_duration_minutes,
            min(facts.duration_minutes) AS minimum_duration_minutes,
            max(facts.duration_minutes) AS maximum_duration_minutes,
            count(*) FILTER (WHERE facts.started_at >= (now() - '30 days'::interval))::integer AS cleanings_last_30_days,
            round(avg(facts.duration_minutes) FILTER (WHERE facts.started_at >= (now() - '30 days'::interval)), 1) AS average_duration_last_30_days,
            sum(facts.maintenance_ticket_count)::integer AS maintenance_ticket_count,
            round(sum(facts.maintenance_ticket_count)::numeric / NULLIF(count(*), 0)::numeric, 2) AS maintenance_tickets_per_cleaning,
            sum(facts.inspection_count)::integer AS inspection_count,
            round(sum(facts.inspection_score_total) / NULLIF(sum(facts.inspection_count), 0)::numeric, 1) AS average_inspection_score,
            round(100.0 * sum(facts.inspection_pass_count)::numeric / NULLIF(sum(facts.inspection_count), 0)::numeric, 1) AS inspection_pass_rate_pct,
            max(facts.started_at) AS latest_cleaning_at
           FROM facts
          GROUP BY facts.employee_id, facts.employee_code, facts.employee_name, facts.location_id, facts.location_code, facts.location_name
        ), location_baseline AS (
         SELECT facts.location_id,
            round(avg(facts.duration_minutes), 1) AS location_average_duration_minutes,
            round(sum(facts.inspection_score_total) / NULLIF(sum(facts.inspection_count), 0)::numeric, 1) AS location_average_inspection_score
           FROM facts
          GROUP BY facts.location_id
        )
 SELECT el.employee_id,
    el.employee_code,
    el.employee_name,
    el.location_id,
    el.location_code,
    el.location_name,
    el.cleaning_count,
    el.average_duration_minutes,
    el.median_duration_minutes,
    el.p90_duration_minutes,
    el.minimum_duration_minutes,
    el.maximum_duration_minutes,
    el.cleanings_last_30_days,
    el.average_duration_last_30_days,
    el.maintenance_ticket_count,
    el.maintenance_tickets_per_cleaning,
    el.inspection_count,
    el.average_inspection_score,
    el.inspection_pass_rate_pct,
    el.latest_cleaning_at,
    lb.location_average_duration_minutes,
    round(el.average_duration_minutes - lb.location_average_duration_minutes, 1) AS duration_delta_from_location_minutes,
    lb.location_average_inspection_score,
    round(el.average_inspection_score - lb.location_average_inspection_score, 1) AS inspection_score_delta_from_location
   FROM employee_location el
     JOIN location_baseline lb ON lb.location_id = el.location_id;

-- Inventory/canary successor binding deliberately remains Main-owned; this proposal alone is not release admissible.


-- EXACT GUARDED COMPONENT 6 Q07_offsite SOURCE 05b0a977cea36410fbde5deafdb38d5c6bc711b18ee94e6cc2238d5389a4748d
-- APPROVED Q07 successor proposal. Main owns canonical migration and recovery binding.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=pg_catalog,public;
DO $guard$ BEGIN
 IF public.static_weekly_digest_text(pg_get_functiondef('public.events_app_validate_scope_venue()'::regprocedure)) IS DISTINCT FROM 'aa399a485ed888cc45798ea401c3c5c6b04a7ea1fdeb743885089319593a2d6c' THEN
  RAISE EXCEPTION 'OFFSITE scope trigger predecessor changed';END IF;
 IF (SELECT count(*) FROM public.location_groups WHERE group_code='OFFSITE'
  AND offsite=true AND active=false AND eligible_event_scope=true
  AND eligible_custodial_coverage=false AND eligible_staffing_assignment=false)<>1 THEN
  RAISE EXCEPTION 'Existing event-only OFFSITE classification unavailable';END IF;
END $guard$;
UPDATE public.location_groups SET group_name='Off campus event',updated_at=statement_timestamp()
 WHERE group_code='OFFSITE' AND offsite=true AND active=false
  AND eligible_event_scope=true AND eligible_custodial_coverage=false AND eligible_staffing_assignment=false;
CREATE OR REPLACE FUNCTION public.events_app_validate_scope_venue()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_scope text;
  v_zoo_venue public.event_venues%rowtype;
  v_primary public.event_venues%rowtype;
  v_bad_count integer;
  v_offsite_group public.location_groups%rowtype;
begin
  v_scope := upper(replace(btrim(coalesce(new.event_scope, 'UNKNOWN')), '-', '_'));
  if v_scope in ('ZOO', 'ZOO_FOOTPRINT') then
    v_scope := 'ZOO_WIDE';
  elsif v_scope in ('SINGLE') then
    v_scope := 'SINGLE_VENUE';
  elsif v_scope in ('MULTI', 'MULTIPLE', 'MULTIPLE_VENUES') then
    v_scope := 'MULTI_VENUE';
  elsif v_scope = 'OFF_SITE' then
    v_scope := 'OFFSITE';
  end if;

  if v_scope not in ('ZOO_WIDE', 'SINGLE_VENUE', 'MULTI_VENUE', 'OFFSITE', 'UNKNOWN') then
    raise exception 'Invalid event scope %', new.event_scope using errcode = '23514';
  end if;

  new.event_scope := v_scope;
  new.event_timezone := coalesce(nullif(btrim(new.event_timezone), ''), 'America/Chicago');
  if new.event_timezone <> 'America/Chicago' then
    raise exception 'event_timezone must be America/Chicago' using errcode = '23514';
  end if;
  new.venue_ids := coalesce(new.venue_ids, '{}'::uuid[]);
  new.coverage_location_ids := coalesce(new.coverage_location_ids, '{}'::uuid[]);
  new.staffing_area_ids := coalesce(new.staffing_area_ids, '{}'::uuid[]);
  new.display_location := nullif(btrim(coalesce(new.display_location, '')), '');

  if new.parser_confidence is not null and new.parser_confidence not in ('high', 'medium', 'low') then
    raise exception 'parser_confidence must be high, medium, or low' using errcode = '23514';
  end if;

  if v_scope = 'ZOO_WIDE' then
    select * into v_zoo_venue
    from public.event_venues
    where venue_code = 'ZOO_FOOTPRINT' and active = true
    limit 1;
    if v_zoo_venue.id is null then
      raise exception 'Zoo Footprint venue is not configured' using errcode = '23514';
    end if;
    new.primary_venue_id := v_zoo_venue.id;
    new.venue_ids := array[v_zoo_venue.id]::uuid[];
    new.location_group_id := v_zoo_venue.location_group_id;
    new.display_location := 'Zoo Footprint';
    new.needs_review := false;
  elsif v_scope = 'SINGLE_VENUE' then
    if new.primary_venue_id is null then
      raise exception 'SINGLE_VENUE events require one eligible event venue' using errcode = '23514';
    end if;
    select * into v_primary
    from public.event_venues
    where id = new.primary_venue_id and active = true
    limit 1;
    if v_primary.id is null or v_primary.eligible_event_venue is not true or v_primary.event_scope = 'ZOO_WIDE' then
      raise exception 'Selected event venue is not eligible as a primary event venue' using errcode = '23514';
    end if;
    if not (new.primary_venue_id = any(new.venue_ids)) then
      new.venue_ids := array_prepend(new.primary_venue_id, new.venue_ids);
    end if;
    new.location_group_id := coalesce(v_primary.location_group_id, new.location_group_id);
    new.display_location := coalesce(new.display_location, v_primary.display_name);
    new.needs_review := false;
  elsif v_scope = 'MULTI_VENUE' then
    if coalesce(array_length(new.venue_ids, 1), 0) < 2 then
      raise exception 'MULTI_VENUE events require at least two eligible event venues' using errcode = '23514';
    end if;
    select count(*) into v_bad_count
    from unnest(new.venue_ids) as selected(venue_id)
    left join public.event_venues ev on ev.id = selected.venue_id and ev.active = true
    where ev.id is null or ev.eligible_event_venue is not true or ev.event_scope = 'ZOO_WIDE';
    if v_bad_count > 0 then
      raise exception 'MULTI_VENUE events contain an ineligible venue' using errcode = '23514';
    end if;
    if new.primary_venue_id is null or not (new.primary_venue_id = any(new.venue_ids)) then
      new.primary_venue_id := new.venue_ids[1];
    end if;
    select * into v_primary from public.event_venues where id = new.primary_venue_id limit 1;
    new.location_group_id := coalesce(v_primary.location_group_id, new.location_group_id);
    new.display_location := coalesce(
      new.display_location,
      (
        select string_agg(ev.display_name, ', ' order by ev.display_name)
        from public.event_venues ev
        where ev.id = any(new.venue_ids)
      )
    );
    new.needs_review := false;
  elsif v_scope = 'OFFSITE' then
    -- Approved event-only classification, never a Zoo cleaning/staffing area.
    select * into v_offsite_group from public.location_groups
      where group_code='OFFSITE' and group_name='Off campus event'
        and offsite=true and active=false and eligible_event_scope=true
        and eligible_custodial_coverage=false and eligible_staffing_assignment=false;
    if v_offsite_group.id is null then
      raise exception 'Off campus event classification is unavailable' using errcode='23514';
    end if;
    if new.location_group_id is not null and new.location_group_id<>v_offsite_group.id then
      raise exception 'OFFSITE event requires Off campus event classification' using errcode='23514';
    end if;
    if cardinality(new.coverage_location_ids)<>0 or cardinality(new.staffing_area_ids)<>0 then
      raise exception 'OFFSITE event cannot allocate Zoo cleaning or staffing areas' using errcode='23514';
    end if;
    if (new.primary_venue_id is not null and not exists(select 1 from public.event_venues
          where id=new.primary_venue_id and event_scope='OFFSITE' and active=true))
      or exists(select 1 from unnest(new.venue_ids) selected(id)
        left join public.event_venues ev on ev.id=selected.id
        where ev.id is null or ev.event_scope<>'OFFSITE' or ev.active is not true) then
      raise exception 'OFFSITE event cannot claim a Zoo venue' using errcode='23514';
    end if;
    new.location_group_id := v_offsite_group.id;
    new.display_location := coalesce(new.display_location, 'Off campus event');
    new.needs_review := false;
  else
    new.needs_review := true;
    new.display_location := coalesce(new.display_location, 'Needs Review');
  end if;

  select count(*) into v_bad_count
  from unnest(new.coverage_location_ids) as selected(location_group_id)
  left join public.location_groups lg on lg.id = selected.location_group_id
  where lg.id is null or lg.eligible_custodial_coverage is not true;
  if v_bad_count > 0 then
    raise exception 'coverage_location_ids contains an ineligible custodial coverage location' using errcode = '23514';
  end if;

  select count(*) into v_bad_count
  from unnest(new.staffing_area_ids) as selected(location_group_id)
  left join public.location_groups lg on lg.id = selected.location_group_id
  where lg.id is null or lg.eligible_staffing_assignment is not true;
  if v_bad_count > 0 then
    raise exception 'staffing_area_ids contains an ineligible staffing location' using errcode = '23514';
  end if;

  if new.event_scope <> 'UNKNOWN' and exists (
    select 1
    from public.location_groups lg
    where lg.id = new.location_group_id
      and lg.eligible_event_venue is not true
      and lg.eligible_event_scope is not true
      and (lg.public_restroom is true or lg.staff_restroom is true or lg.group_name ilike '%restroom%' or lg.group_code ilike '%RESTROOM%')
  ) then
    raise exception 'Restroom/custodial coverage locations cannot be saved as primary event venues' using errcode = '23514';
  end if;

  return new;
end;
$function$;
-- Exact recovery-inventory successor binding remains Main-owned. No new privilege.


-- EXACT GUARDED COMPONENT 7 F25_F26_records SOURCE 981ba5559bec5c7f0a62c5f8ff7d1d416c1fde3201d7b6f58f0038b319413b79
-- Staged completed-record/read projection successor. Main allocates canonical identity.
-- No historical definition/grant is changed; named/cohort wrappers independently authorize.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
DO $predecessors$ BEGIN
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_append_session_correction(uuid,uuid,uuid,text,text,uuid,uuid,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM '1fb800111fa8c6f72d4f0fac47ec3d27eb4600d9b843f8e99e98de5d5d190892' THEN RAISE EXCEPTION 'Record predecessor differs: custodial_append_session_correction'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_manager_open_problems(uuid,integer,text)'::regprocedure)) IS DISTINCT FROM 'd4acd3e3e7b7219aca9b1222ac31efb95522739b090ab51f3887efcb698e8e7d' THEN RAISE EXCEPTION 'Record predecessor differs: custodial_manager_open_problems'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_manager_get_session_truth(uuid,uuid,text)'::regprocedure)) IS DISTINCT FROM '4a6ce83a52c607df1544be726a7f7b0a6b4710465cd7355fd47c73fabbde9e73' THEN RAISE EXCEPTION 'Record predecessor differs: custodial_manager_get_session_truth'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_action_actor_v1(uuid,uuid,text,text,text)'::regprocedure)) IS DISTINCT FROM '95ae99a83afdd36703f4bbe439856cd43c774f0662751d1ef8ab38728dc6c872' THEN RAISE EXCEPTION 'Record predecessor differs: custodial_action_actor_v1'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_leadership_bind_verified_request(uuid,uuid,uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'f194815b5f6a7b7fd5772df7ed94d6e0c42545ddce5a63b7a0ba436f036a598a' THEN RAISE EXCEPTION 'Record predecessor differs: static_weekly_leadership_bind_verified_request'; END IF;
END $predecessors$;

CREATE FUNCTION custodial_leadership_private.record_operation_v1(p_actor jsonb,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions
AS $record$
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
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR octet_length(p_input::text)>16384 THEN
  RAISE EXCEPTION 'Bounded typed record input required' USING ERRCODE='22023';END IF;
 IF p_action='choices' THEN
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
END $record$;
REVOKE ALL ON FUNCTION custodial_leadership_private.record_operation_v1(jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE FUNCTION public.custodial_named_record_operation_v1(p_manager_id uuid,p_backend_execution_secret text,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $named$
DECLARE actor jsonb;
BEGIN
 PERFORM public.custodial_require_backend_execution_secret(p_backend_execution_secret);
 SELECT jsonb_build_object('actor_kind','NAMED_MANAGER','manager_id',m.manager_id,'manager_name',m.display_name)
 INTO actor FROM public.ops_manager_managers m WHERE m.manager_id=p_manager_id AND m.active=true AND m.revoked_at IS NULL
  AND m.is_system_principal=false AND m.roles && ARRAY['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[];
 IF actor IS NULL THEN RAISE EXCEPTION 'Active named manager required' USING ERRCODE='42501';END IF;
 RETURN custodial_leadership_private.record_operation_v1(actor,p_action,p_input);
END $named$;
REVOKE ALL ON FUNCTION public.custodial_named_record_operation_v1(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_named_record_operation_v1(uuid,text,text,jsonb) TO service_role;

CREATE FUNCTION public.custodial_leadership_record_operation_v1(p_manager_id uuid,p_credential_id uuid,p_device_id text,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $cohort$
DECLARE actor jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,'full_access',CASE WHEN p_action='correct' THEN 'write' ELSE 'read' END);
 IF actor->>'actor_kind' IS DISTINCT FROM 'CUSTODIAL_LEADERSHIP_COHORT' OR actor->'owner' IS DISTINCT FROM 'false'::jsonb
  OR actor->>'identity_assurance' IS DISTINCT FROM 'SELF_ASSERTED_NAME' OR actor->'individual_identity_verified' IS DISTINCT FROM 'false'::jsonb
  OR actor->>'manager_id' IS DISTINCT FROM p_manager_id::text OR actor->>'credential_id' IS DISTINCT FROM p_credential_id::text
  OR actor->>'device_id' IS DISTINCT FROM p_device_id OR actor->>'request_id' IS NULL THEN
  RAISE EXCEPTION 'Authenticated original cohort context required' USING ERRCODE='42501';END IF;
 RETURN custodial_leadership_private.record_operation_v1(actor,p_action,p_input);
END $cohort$;
REVOKE ALL ON FUNCTION public.custodial_leadership_record_operation_v1(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_leadership_record_operation_v1(uuid,uuid,text,text,jsonb) TO static_weekly_control_plane;


-- EXACT GUARDED COMPONENT 8 F09_period SOURCE e019f18f08e129490b11abf20479fe0c93efdbac58c87896c5d0aa540b8c7d59
-- Proposed successor component for Main integration. Historical303 unchanged.
-- Period validation only: existing function/owner/ACL and link history retained.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $repair$
declare target oid:='public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)'::regprocedure;
 before_acl aclitem[];before_owner oid;definition text;old_fragment text;new_fragment text;before_grants text;
begin
 select proacl,proowner into before_acl,before_owner from pg_proc where oid=target;
 if public.static_weekly_digest_text((select prosrc from pg_proc where oid=target))<>'7d2cbac0277e28a917d5ad28dd3d18a21586bb5b8a674c9371b5748097081a07' then
  raise exception 'Unexpected canonical CoverAll period validator predecessor';end if;
 before_grants:=public.custodial_release_authority_current_grant_definition('public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)');
 definition:=pg_get_functiondef(target);
 old_fragment:=$old$if not isfinite(day) or day-(extract(isodow from day)::integer-1)<>(p_binding->>'week_start')::date then$old$;
 new_fragment:=$new$if not isfinite(day) or not isfinite((p_binding->>'week_start')::date)
  or day<(p_binding->>'week_start')::date or day>(p_binding->>'week_start')::date+6 then$new$;
 if length(definition)-length(replace(definition,old_fragment,''))<>length(old_fragment) then raise exception 'Unexpected CoverAll date guard';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$or projection.replay_digest is distinct from p_binding->>'replay_digest' then$old$;
 new_fragment:=$new$or projection.replay_digest is distinct from p_binding->>'replay_digest'
  or projection.week_start is distinct from (p_binding->>'week_start')::date
  or projection.week_end is distinct from (p_binding->>'week_start')::date+6 then$new$;
 if length(definition)-length(replace(definition,old_fragment,''))<>length(old_fragment) then raise exception 'Unexpected CoverAll accepted projection guard';end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select proacl from pg_proc where oid=target) is distinct from before_acl
  or (select proowner from pg_proc where oid=target) is distinct from before_owner
  or public.custodial_release_authority_current_grant_definition('public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)') is distinct from before_grants then
  raise exception 'CoverAll period repair changed authority';end if;
end $repair$;
lock table public.custodial_release_authority_restore_inventory in access exclusive mode;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $inventory$
declare definition text:=pg_get_functiondef('public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)'::regprocedure);changed integer;
begin
 update public.custodial_release_authority_restore_inventory set definition_sql=definition,
  definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
 where case when object_kind='function' then to_regprocedure(object_identity) end='public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)'::regprocedure;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Exact existing CoverAll function recovery row required';end if;
end $inventory$;
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;


-- EXACT GUARDED COMPONENT 9 F09_cohort SOURCE 5c37122db81d2c0f94045f0035fab142816848b3b33de953cec9efad07c391ca
-- Proposed guarded successor component; Main owns canonical integration.
-- Legacy named credentials keep their original FK and actor checks. Cohort
-- links reference real registrations; public-token reads never bind or invent
-- a signed manager request. Run after coverall-accepted-period.sql.
set local lock_timeout='5s';set local statement_timeout='30s';
lock table public.custodial_release_authority_restore_inventory in access exclusive mode;
create temporary table coverall_cohort_recovery_before on commit drop as table public.custodial_release_authority_restore_inventory;
create temporary table coverall_cohort_function_before on commit drop as
 select oid,proowner,proacl from pg_proc where oid=any(array[
 'public.static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer)'::regprocedure,
 'public.static_weekly_read_coverall_link(text)'::regprocedure,
 'public.static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid)'::regprocedure]);
do $predecessors$
begin
 if public.static_weekly_digest_text((select prosrc from pg_proc where oid='public.static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer)'::regprocedure))<>'a05e7a46783523470e0d540cc6d9a8164a8b1f9a0d9529e5b94195cd15493b71' then raise exception 'Unexpected issue CoverAll predecessor';end if;
 if public.static_weekly_digest_text((select prosrc from pg_proc where oid='public.static_weekly_read_coverall_link(text)'::regprocedure))<>'925646046ac270fab1967e2030f83dcb50e1bc208319a8c19b5a5bafd014b554' then raise exception 'Unexpected read CoverAll predecessor';end if;
 if public.static_weekly_digest_text((select prosrc from pg_proc where oid='public.static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid)'::regprocedure))<>'e53d4b2049983a2d3d4adc2280fc45947dacbc9f39fd02e3d21cd050d6decb94' then raise exception 'Unexpected revoke CoverAll predecessor';end if;
 if exists(select 1 from coverall_cohort_function_before b where
  (select count(*) from public.custodial_release_authority_restore_inventory i where case when i.object_kind='function' then to_regprocedure(i.object_identity) end=b.oid and i.definition_sql=pg_get_functiondef(b.oid)
   and i.definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(b.oid)))<>1) then
  raise exception 'Exact prior CoverAll recovery definitions required';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='static_weekly_coverall_access_links' and column_name like 'cohort_%')
  or to_regprocedure('custodial_leadership_private.coverall_link_issuer(uuid,uuid,text,text,uuid,uuid,integer,integer)') is not null then
  raise exception 'Unexpected CoverAll cohort successor state';end if;
end $predecessors$;
alter table public.static_weekly_coverall_access_links
 alter column credential_id drop not null,
 add column cohort_registration_id uuid references custodial_leadership_private.registrations(registration_id),
 add column cohort_claimed_account_id uuid references public.ops_manager_managers(manager_id),
 add column cohort_policy_version integer,
 add column cohort_security_epoch integer,
 add column cohort_request_id uuid,
 add column cohort_revoked_registration_id uuid references custodial_leadership_private.registrations(registration_id),
 add column cohort_revoked_claimed_account_id uuid references public.ops_manager_managers(manager_id),
 add column cohort_revoked_request_id uuid,
 add constraint coverall_exact_credential_kind check(
  (credential_id is not null and cohort_registration_id is null and cohort_claimed_account_id is null
   and cohort_policy_version is null and cohort_security_epoch is null and cohort_request_id is null)
  or (credential_id is null and cohort_registration_id is not null and cohort_claimed_account_id is not null
   and cohort_policy_version is not null and cohort_policy_version>0
   and cohort_security_epoch is not null and cohort_security_epoch>0 and cohort_request_id is not null
   and session_access='full_access')),
 add constraint coverall_exact_revocation_actor check(
  (cohort_revoked_registration_id is null and cohort_revoked_claimed_account_id is null and cohort_revoked_request_id is null)
  or (revoked_at is not null and cohort_revoked_registration_id is not null and cohort_revoked_claimed_account_id is not null
   and cohort_revoked_request_id is not null));

create function custodial_leadership_private.coverall_link_issuer(
 p_manager uuid,p_credential uuid,p_device text,p_access text,p_registration uuid,p_claim uuid,p_policy integer,p_epoch integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $issuer$
declare actor jsonb;view jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 if p_registration is null then
  -- Preserve the exact named-manager permission/revocation semantics.
  actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
  return jsonb_build_object('managerId',p_manager,'managerName',actor->>'manager_name');
 end if;
 view:=custodial_leadership_private.session_view(p_registration);
 if p_credential is not null or p_access is distinct from 'full_access' or view is null
  or view->>'registrationId' is distinct from p_registration::text
  or view->>'browserId' is distinct from p_device
  or view#>>'{cohort,principalId}' is distinct from p_manager::text
  or view#>>'{claimedAccount,accountId}' is distinct from p_claim::text
  or (view#>>'{cohort,policyVersion}')::integer is distinct from p_policy
  or (view#>>'{cohort,securityEpoch}')::integer is distinct from p_epoch
  or (view#>'{cohort,permissions}' ? 'custodialManagementAdmin') is not true then
  raise exception using errcode='42501',message='CoverAll original cohort credential changed or was revoked';end if;
 return jsonb_build_object('managerId',p_manager,'managerName','Custodial leadership cohort',
  'actorKind','CUSTODIAL_LEADERSHIP_COHORT','identityAssurance','SELF_ASSERTED_NAME','individualIdentityVerified',false,
  'claimedAccountId',p_claim,'claimedName',view#>>'{claimedAccount,displayName}');
end $issuer$;
revoke all on function custodial_leadership_private.coverall_link_issuer(uuid,uuid,text,text,uuid,uuid,integer,integer)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

create or replace function public.static_weekly_issue_coverall_link(
 p_manager uuid,p_credential uuid,p_device text,p_access text,p_link uuid,p_token_hash text,p_binding jsonb,p_ttl integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare actor jsonb;basis jsonb;created timestamptz;expires timestamptz;view jsonb;registration uuid;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 if p_link is null or coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$' or p_ttl is null or p_ttl not between 1 and 168 then
  raise exception using errcode='22023',message='Bounded canonical CoverAll issuance required';end if;
 basis:=public.static_weekly_assert_coverall_link_basis(p_binding);
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 if actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' then
  registration:=p_credential;view:=custodial_leadership_private.session_view(registration);
  perform custodial_leadership_private.coverall_link_issuer(p_manager,null,p_device,p_access,registration,
   (actor->>'claimed_account_id')::uuid,(actor->>'policy_version')::integer,(view#>>'{cohort,securityEpoch}')::integer);
 end if;
 created:=clock_timestamp();expires:=created+make_interval(hours=>p_ttl);
 -- The once-only request ID is scoped to the server-derived issuing manager.
 -- Another manager may use/revoke the same nonsecret UUID without interference.
 insert into public.static_weekly_coverall_access_links(link_id,token_hash,binding,source_id,source_digest,manager_id,credential_id,device_id,session_access,created_at,expires_at,cohort_registration_id,cohort_claimed_account_id,cohort_policy_version,cohort_security_epoch,cohort_request_id)
 values(p_link,p_token_hash,p_binding,(basis->>'source_id')::uuid,basis->>'source_digest',p_manager,case when registration is null then p_credential end,p_device,p_access,created,expires,
  registration,case when registration is not null then (actor->>'claimed_account_id')::uuid end,
  case when registration is not null then (actor->>'policy_version')::integer end,
  case when registration is not null then (view#>>'{cohort,securityEpoch}')::integer end,
  case when registration is not null then (actor->>'request_id')::uuid end);
 return jsonb_build_object('link_id',p_link,'expires_at',expires);
end $fn$;

create or replace function public.static_weekly_read_coverall_link(p_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare link public.static_weekly_coverall_access_links%rowtype;issuer jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 if coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$' then raise exception using errcode='42501',message='CoverAll link unavailable';end if;
 select * into link from public.static_weekly_coverall_access_links where token_hash=p_token_hash for share;
 if not found or link.revoked_at is not null or link.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='CoverAll link unavailable';end if;
 issuer:=custodial_leadership_private.coverall_link_issuer(link.manager_id,link.credential_id,link.device_id,link.session_access,
  link.cohort_registration_id,link.cohort_claimed_account_id,link.cohort_policy_version,link.cohort_security_epoch);
 perform public.static_weekly_assert_coverall_link_basis(link.binding,link.source_id,link.source_digest);
 if link.expires_at<=clock_timestamp() then raise exception using errcode='42501',message='CoverAll link unavailable';end if;
 issuer:=custodial_leadership_private.coverall_link_issuer(link.manager_id,link.credential_id,link.device_id,link.session_access,
  link.cohort_registration_id,link.cohort_claimed_account_id,link.cohort_policy_version,link.cohort_security_epoch);
 if link.expires_at<=clock_timestamp() then raise exception using errcode='42501',message='CoverAll link unavailable';end if;
 return jsonb_build_object('schema','custodial.coverall-canonical-access.v1','binding',link.binding,
  'issuing_manager',issuer);
end $fn$;

create or replace function public.static_weekly_revoke_coverall_link(p_manager uuid,p_credential uuid,p_device text,p_access text,p_link uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare actor jsonb;link public.static_weekly_coverall_access_links%rowtype;view jsonb;registration uuid;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 select * into link from public.static_weekly_coverall_access_links where manager_id=p_manager and link_id=p_link for update;
 -- Capture FOUND before rechecking current credential after a possible row wait.
 if found then
  actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 else
  actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
  if actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' then
   registration:=p_credential;view:=custodial_leadership_private.session_view(registration);
   perform custodial_leadership_private.coverall_link_issuer(p_manager,null,p_device,p_access,registration,
    (actor->>'claimed_account_id')::uuid,(actor->>'policy_version')::integer,(view#>>'{cohort,securityEpoch}')::integer);
  end if;
  -- Durable nonsecret tombstone settles an unknown issuance and prevents a
  -- delayed original POST from creating this request after revocation ACK.
  insert into public.static_weekly_coverall_access_links(link_id,token_hash,binding,manager_id,credential_id,device_id,session_access,created_at,expires_at,revoked_at,revoked_by,cohort_registration_id,cohort_claimed_account_id,cohort_policy_version,cohort_security_epoch,cohort_request_id,cohort_revoked_registration_id,cohort_revoked_claimed_account_id,cohort_revoked_request_id)
   values(p_link,public.static_weekly_digest_text('revoked-coverall-request:'||p_manager::text||':'||p_link::text),'{}'::jsonb,p_manager,case when registration is null then p_credential end,p_device,p_access,
    statement_timestamp(),statement_timestamp()+interval '1 second',statement_timestamp(),p_manager,
    registration,case when registration is not null then (actor->>'claimed_account_id')::uuid end,
    case when registration is not null then (actor->>'policy_version')::integer end,
    case when registration is not null then (view#>>'{cohort,securityEpoch}')::integer end,
    case when registration is not null then (actor->>'request_id')::uuid end,
    registration,case when registration is not null then (actor->>'claimed_account_id')::uuid end,
    case when registration is not null then (actor->>'request_id')::uuid end);
  return jsonb_build_object('link_id',p_link,'revoked',true);
 end if;
 -- Revocation is exact issuer scope. Cross-issuer administrative revocation
 -- requires a separate explicit issuer context, never a guessed request ID.
 update public.static_weekly_coverall_access_links set revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_by=coalesce(revoked_by,p_manager),
  cohort_revoked_registration_id=case when revoked_at is null and actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' then p_credential else cohort_revoked_registration_id end,
  cohort_revoked_claimed_account_id=case when revoked_at is null and actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' then (actor->>'claimed_account_id')::uuid else cohort_revoked_claimed_account_id end,
  cohort_revoked_request_id=case when revoked_at is null and actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' then (actor->>'request_id')::uuid else cohort_revoked_request_id end
  where manager_id=p_manager and link_id=p_link;
 return jsonb_build_object('link_id',p_link,'revoked',true);
end $fn$;

do $authority_unchanged$
begin
 if exists(select 1 from coverall_cohort_function_before b join pg_proc p using(oid)
  where p.proowner is distinct from b.proowner or p.proacl is distinct from b.proacl) then
  raise exception 'CoverAll cohort successor changed existing function authority';end if;
 if has_function_privilege('static_weekly_control_plane','custodial_leadership_private.coverall_link_issuer(uuid,uuid,text,text,uuid,uuid,integer,integer)','EXECUTE') then
  raise exception 'Private CoverAll issuer resolver unexpectedly exposed';end if;
end $authority_unchanged$;
-- Bounded recovery closure follows in this same transaction.

create temporary table coverall_cohort_recovery(bucket integer,kind text,identity text,definition text,primary key(kind,identity)) on commit drop;
do $recovery$
declare rel text:='public.static_weekly_coverall_access_links';rid oid:=rel::regclass;
 sig text;obj record;next_order integer;surface_before text;surface text;new_roots text;affected integer;
begin
 insert into coverall_cohort_recovery values
  (1000,'relation',rel,public.custodial_release_authority_current_relation_definition(rel)),
  (300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)),
  (400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)),
  (900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel));
 insert into coverall_cohort_recovery select 200000,'column',rel||':'||attname,
  public.custodial_release_authority_current_column_definition(rel||':'||attname)
  from pg_attribute where attrelid=rid and attnum>0 and not attisdropped;
 insert into coverall_cohort_recovery select 500000,'constraint',rel||':'||conname,
  public.custodial_release_authority_current_constraint_definition(rel||':'||conname) from pg_constraint where conrelid=rid;
 foreach sig in array array[
  'public.static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer)',
  'public.static_weekly_read_coverall_link(text)',
  'public.static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid)',
  'custodial_leadership_private.coverall_link_issuer(uuid,uuid,text,text,uuid,uuid,integer,integer)'
 ] loop
  insert into coverall_cohort_recovery values
   (100000,'function',sig::regprocedure::text,pg_get_functiondef(sig::regprocedure)),
   (1000000,'grant',sig::regprocedure::text,public.custodial_release_authority_current_grant_definition(sig::regprocedure::text));
 end loop;
 if exists(select 1 from coverall_cohort_recovery where definition is null or definition='') then raise exception 'CoverAll recovery renderer unavailable';end if;
 surface_before:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (select count(*) from public.custodial_release_authority_restore_inventory
  where case when object_kind='function' then to_regprocedure(object_identity) end='public.custodial_release_canary_authority_surface()'::regprocedure
   and definition_sql=surface_before and definition_sha256=public.static_weekly_digest_text(surface_before))<>1 then
  raise exception 'Exact prior canary recovery definition required';end if;
 if length(surface_before)-length(replace(surface_before,'  values',''))<>length('  values') then raise exception 'Exact canary VALUES seam changed';end if;
 select string_agg(format('(%L,%L,%L),',kind,identity,'typed original CoverAll credential; cohort name remains self-asserted'),E'\n ' order by bucket,kind,identity)
 into new_roots from coverall_cohort_recovery where kind in('function','grant')
  and identity='custodial_leadership_private.coverall_link_issuer(uuid,uuid,text,text,uuid,uuid,integer,integer)';
 if new_roots is null then raise exception 'Private CoverAll recovery roots missing';end if;
 surface:=replace(surface_before,'  values','  values'||E'\n '||new_roots);execute surface;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from coverall_cohort_recovery order by bucket,kind,identity loop
  if exists(select 1 from public.custodial_release_authority_restore_inventory where object_kind=obj.kind and object_identity=obj.identity) then
   update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
    definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
    where object_kind=obj.kind and object_identity=obj.identity and definition_sql is distinct from obj.definition;
  else
   select n into next_order from generate_series(obj.bucket+1,case when obj.bucket=1000 then 99999 else obj.bucket+99999 end) n
    where not exists(select 1 from public.custodial_release_authority_restore_inventory i where i.restore_order=n) order by n limit 1;
   if next_order is null then raise exception 'CoverAll recovery bucket exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
 update public.custodial_release_authority_restore_inventory set
  definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),captured_at=statement_timestamp()
  where case when object_kind='function' then to_regprocedure(object_identity) end='public.custodial_release_canary_authority_surface()'::regprocedure;
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Exact canary recovery row required';end if;
 alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
 if exists(select 1 from coverall_cohort_recovery n left join public.custodial_release_authority_restore_inventory i
  on i.object_kind=n.kind and i.object_identity=n.identity where i.definition_sql is distinct from n.definition
   or i.definition_sha256 is distinct from public.static_weekly_digest_text(n.definition)) then raise exception 'CoverAll recovery readback mismatch';end if;
 if exists(select b.* from coverall_cohort_recovery_before b
   where not exists(select 1 from coverall_cohort_recovery n where n.kind=b.object_kind and n.identity=b.object_identity)
   and not(case when b.object_kind='function' then to_regprocedure(b.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure else false end)
   except select * from public.custodial_release_authority_restore_inventory) then raise exception 'Unrelated recovery membership changed';end if;
 if exists(select 1 from coverall_cohort_recovery n where n.kind in('relation','column_set','relation_state','function','grant')
  and not exists(select 1 from public.custodial_release_canary_authority_surface() s where s.object_kind=n.kind and s.object_identity=n.identity)) then raise exception 'CoverAll recovery canary roots missing';end if;
end $recovery$;


-- EXACT GUARDED COMPONENT 10 native_event_manual_compatibility SOURCE c6ba8af4b4ede6f63cbcc359669b9f2528c5bc7c8087328d98dc520ba6b40379
-- F15/F16 integration dependency: compatibility with the already admitted native manual projection format.
-- REVIEWABLE SUCCESSOR ONLY. Main owns canonical identity/recovery guard binding.
-- No historical migrations, stored source, approval records or eligibility policy change.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=pg_catalog,public;
DO $guard$ BEGIN
 IF public.static_weekly_digest_text(pg_get_functiondef('public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'::regprocedure))
  IS DISTINCT FROM '9882aee1324bec65acfaf5252c8d876a13f06f250cd194620dfd8e0b25deceb5' THEN
  RAISE EXCEPTION 'native Event manual-format predecessor changed';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.mz_event_reminder_schedule_candidate(p_record jsonb, p_employee_id uuid, p_notification_kind text)
 RETURNS TABLE(reminder_date date, scheduled_for timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with event as materialized (
    select e.*,e.event_date-offsets.days_before as reminder_date
    from jsonb_populate_record(null::public.events_app_events,p_record) e
    join public.employees employee on employee.id=p_employee_id and employee.active=true
    cross join (values('three_days_before',3),('two_days_before',2),('shift_plus_15',0)) offsets(kind,days_before)
    where e.status='SCHEDULED' and coalesce(e.needs_review,false)=false
      and e.archived_at is null and e.cancelled_at is null and offsets.kind=p_notification_kind
      and (coalesce(e.audience_scope,'assigned_location')<>'specific_employees'
        or p_employee_id=any(coalesce(e.audience_employee_ids,'{}'::uuid[])))
  ), dates as (
    select event_date as service_date from event
    union select event.reminder_date from event
  ), roster as materialized (
    select dates.service_date,authority.governed,authority.projection_status,
      r.employee_id,r.slot_id,r.active,r.shift_start,
      count(*) over(partition by dates.service_date) as identity_count,
      projection.projection_envelope,
      -- Native admitted manual rows omit the redundant incumbentSlotId alias.
      -- This predicate is format compatibility inside the exact current join;
      -- it is never independent publication or source admission authority.
      /* native_event_manual_format_begin */
      coalesce((
        authority.governed is true and authority.projection_status='current'
        and projection.projection_id=authority.projection_id
        and projection.publication_id=authority.publication_id
        and projection.version_id=authority.version_id
        and projection.compiler_version='approved-manual-period-v1'
        and projection.projection_envelope->'adapter'=
          '{"schema":"custodial.approved-manual-period-database-adapter.v1","version":"approved-manual-period-v1"}'::jsonb
        and projection.projection_envelope->>'compiler_version'='approved-manual-period-v1'
        and projection.projection_envelope#>>'{authority,schema}'='custodial.approved-manual-period-projection-authority.v1'
        and projection.projection_envelope#>'{authority,sourcePublicationId}'=to_jsonb(authority.publication_id::text)
        and projection.projection_envelope#>'{authority,sourceVersionId}'=to_jsonb(authority.version_id::text)
        and projection.projection_envelope#>'{authority,frameStart}'=to_jsonb(projection.week_start::text)
        and projection.projection_envelope#>'{authority,frameEnd}'=to_jsonb(projection.week_end::text)
        and projection.projection_envelope->'week_start'=to_jsonb(projection.week_start::text)
        and projection.projection_envelope->'week_end'=to_jsonb(projection.week_end::text)
        and projection.projection_envelope->'service_date'=to_jsonb(projection.week_start::text)
        and projection.week_end=projection.week_start+6
        and dates.service_date between projection.week_start and projection.week_end
        and projection.projection_envelope#>'{authority,normalSourceChanged}'='false'::jsonb
        and projection.projection_envelope#>'{authority,objectiveSolverRerun}'='false'::jsonb
        and projection.authority_digest ~ '^[0-9a-f]{64}$'
        and projection.projection_envelope->'authority_digest'=to_jsonb(projection.authority_digest)
      ),false)
      /* native_event_manual_format_end */ as native_manual_projection,
      staffing.staffing_state as explicit_staffing_state
    from dates
    cross join lateral public.static_weekly_v6_schedule_authority_state(dates.service_date) authority
    cross join lateral public.static_weekly_v6_read_roster(dates.service_date) r
    left join public.weekly_schedule_compiled_projections projection
      on projection.projection_id=authority.projection_id and projection.projection_id=r.projection_id
     and projection.publication_id=authority.publication_id and projection.version_id=authority.version_id
    left join lateral (
      select state.staffing_state
      from public.weekly_roster_slot_staffing_states state
      where state.slot_id=r.slot_id and state.effective_start<=dates.service_date
      order by state.effective_start desc,state.authority_revision desc limit 1
    ) staffing on true
    where r.employee_id=p_employee_id
      and (not authority.governed or authority.projection_status='current')
  ), resolved as materialized (
    select r.service_date,r.governed,r.active,r.identity_count,r.explicit_staffing_state,
      r.slot_id,r.employee_id,r.shift_start as legacy_shift_start,r.native_manual_projection,
      availability.entry,availability.match_count,classification.slot,classification.match_count as slot_count
    from roster r
    left join lateral (
      select (jsonb_agg(item.value)->0) as entry,count(*) as match_count
      from jsonb_array_elements(case
        when jsonb_typeof(r.projection_envelope#>'{authority,projectionAvailability}')='array'
          then r.projection_envelope#>'{authority,projectionAvailability}' else '[]'::jsonb end) item(value)
      where item.value->>'serviceDate'=r.service_date::text
        and (item.value->>'slotId'=r.slot_id::text or item.value->>'incumbentPersonId'=r.employee_id::text)
    ) availability on true
    left join lateral (
      select (jsonb_agg(item.value)->0) as slot,count(*) as match_count
      from jsonb_array_elements(case
        when jsonb_typeof(r.projection_envelope#>'{authority,compilerInput,slots}')='array'
          then r.projection_envelope#>'{authority,compilerInput,slots}' else '[]'::jsonb end) item(value)
      where item.value->>'id'=r.slot_id::text
    ) classification on true
  ), workdays as materialized (
    select r.service_date,r.governed,
      case when r.governed then (r.entry#>>'{shift,start}')::time
        else r.legacy_shift_start::time end as shift_start,
      case when r.governed then (r.entry#>>'{shift,end}')::time else null::time end as shift_end,
      case when r.governed then coalesce(r.entry->'blockedWindows','[]'::jsonb) else '[]'::jsonb end as blocked_windows,
      case when r.governed then coalesce((r.slot->>'contractorCapacity')::boolean,false) else false end as contractor_capacity
    from resolved r
    where /* native_event_workday_predicate_begin */
      r.identity_count=1 and case when not r.governed then r.active=true else
      r.match_count=1 and r.slot_count=1
      and coalesce(r.explicit_staffing_state,'working')='working'
      and jsonb_typeof(r.entry)='object'
      and r.entry->>'slotId'=r.slot_id::text
      and (r.entry->>'incumbentSlotId'=r.slot_id::text
        or (r.native_manual_projection is true and not(r.entry ? 'incumbentSlotId')))
      and r.entry->>'incumbentPersonId'=r.employee_id::text
      and r.entry->'dayOfWeek'=to_jsonb(extract(dow from r.service_date)::integer)
      and r.entry->>'status'='working'
      and jsonb_typeof(r.entry->'shift')='object'
      and jsonb_typeof(r.entry#>'{shift,start}')='string'
      and jsonb_typeof(r.entry#>'{shift,end}')='string'
      and (r.entry#>>'{shift,start}') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and (r.entry#>>'{shift,end}') ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
      and (r.entry#>>'{shift,start}') < (r.entry#>>'{shift,end}')
      and (not(r.slot ? 'contractorCapacity') or jsonb_typeof(r.slot->'contractorCapacity')='boolean')
      and (not(r.entry ? 'blockedWindows') or jsonb_typeof(r.entry->'blockedWindows')='array')
      and not exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(r.entry->'blockedWindows')='array'
          then r.entry->'blockedWindows' else '[]'::jsonb end) blocked(value)
        where jsonb_typeof(blocked.value) is distinct from 'object'
          or jsonb_typeof(blocked.value->'start') is distinct from 'string'
          or jsonb_typeof(blocked.value->'end') is distinct from 'string'
          or coalesce(blocked.value->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          or coalesce(blocked.value->>'end','') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
          or (blocked.value->>'start') >= (blocked.value->>'end')
      ) end
      /* native_event_workday_predicate_end */
  ), eligible_workdays as materialized (
    select day.* from workdays day
    where not day.governed or exists (
      select 1 from (
        select day.shift_start as available_at
        union select (blocked.value->>'end')::time
        from jsonb_array_elements(day.blocked_windows) blocked(value)
      ) boundary
      where boundary.available_at>=day.shift_start and boundary.available_at<day.shift_end
        and not exists (
          select 1 from jsonb_array_elements(day.blocked_windows) blocked(value)
          where boundary.available_at>=(blocked.value->>'start')::time
            and boundary.available_at<(blocked.value->>'end')::time
        )
    )
  ), candidate as (
    select e.*,reminder_day.shift_start,reminder_day.shift_end,reminder_day.blocked_windows,
      reminder_day.governed as reminder_governed,
      e.reminder_date+reminder_day.shift_start+interval '15 minutes' as local_scheduled_for
    from event e
    join eligible_workdays event_day on event_day.service_date=e.event_date
    join eligible_workdays reminder_day on reminder_day.service_date=e.reminder_date
    where (coalesce(e.audience_scope,'assigned_location')='specific_employees'
        and p_employee_id=any(coalesce(e.audience_employee_ids,'{}'::uuid[])))
      or coalesce(e.audience_scope,'assigned_location')='all_working_employees'
      or (coalesce(e.audience_scope,'assigned_location')='assigned_location' and case when event_day.governed then
        not event_day.contractor_capacity and exists (
          select 1 from public.static_weekly_v6_read_schedule_segments(e.event_date) segment
          where segment.location_group_id=e.location_group_id and segment.assigned_employee_id=p_employee_id
            and segment.owner_type='EMPLOYEE' and segment.status='ASSIGNED'
        ) else exists (
          select 1 from public.daily_group_assignments legacy
          where legacy.assignment_date=e.event_date and legacy.location_group_id=e.location_group_id
            and legacy.assigned_employee_id=p_employee_id and legacy.active=true and legacy.is_coverall=false
        ) end)
  )
  select candidate.reminder_date,candidate.local_scheduled_for at time zone 'America/Chicago'
  from candidate
  where not candidate.reminder_governed or (
    candidate.local_scheduled_for < candidate.reminder_date+candidate.shift_end
    and not exists (
      select 1 from jsonb_array_elements(candidate.blocked_windows) blocked(value)
      where candidate.local_scheduled_for >= candidate.reminder_date+(blocked.value->>'start')::time
        and candidate.local_scheduled_for < candidate.reminder_date+(blocked.value->>'end')::time
    )
  )
$function$;


-- EXACT GUARDED COMPONENT 11 manual_repeat_memory_and_typed_response SOURCE 6f81d465acab8533c5a861c8ee571255d2ac48f782e8eec69a47522eb4a53294
-- PRE-CANONICAL INTERNAL QUALIFICATION COMPONENT, not release acceptance.
-- Same four exact product postimages as failed aef6; only the recovery
-- predecessor contract is corrected to observed exact absence for all four.
-- Preserve the ENTIRE existing recovery inventory and canary unchanged.
-- Main MUST complete final40-name canonical enrollment/binding in its
-- original-owner prelude snapshot -> FINAL binding before canonical/release
-- acceptance. This component neither captures nor enrolls recovery objects.
-- No changed resource limit, historical migration, source guard or schedule.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE manual_repeat_lifetime_targets(identity text PRIMARY KEY,definition text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE manual_repeat_recovery_witness ON COMMIT DROP AS SELECT
 (SELECT public.static_weekly_digest_text(string_agg(public.static_weekly_digest_text(to_jsonb(i)::text),E'\n' ORDER BY i.inventory_id))
  FROM public.custodial_release_authority_restore_inventory i) AS inventory_digest,
 (SELECT count(*) FROM public.custodial_release_authority_restore_inventory) AS inventory_rows,
 public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)) AS canary_definition_digest,
 (SELECT public.static_weekly_digest_text(to_jsonb(p)::text) FROM pg_proc p
  WHERE p.oid='public.custodial_release_canary_authority_surface()'::regprocedure) AS canary_metadata_digest,
 (SELECT public.static_weekly_digest_jsonb(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.object_kind,s.object_identity,s.purpose),'[]'::jsonb))
  FROM public.custodial_release_canary_authority_surface() s) AS canary_roots_digest;
DO $lifetime$
DECLARE item jsonb;edit jsonb;original text;changed text;inverse text;target oid;
 before_owner oid;before_acl aclitem[];before_grants text;
BEGIN
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
 THEN RAISE EXCEPTION 'Exact ALWAYS recovery guard required';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements($changes$[
  {
    "name": "static_weekly_finish_manual_recurring_normal",
    "identity": "public.static_weekly_finish_manual_recurring_normal(uuid,uuid,jsonb,text)",
    "beforeSha256": "90e0041bf54c53a04117e3dd8d89e272c291e7f94ed431261f7f823389098e15",
    "afterSha256": "57174a2b1ea56528099e3eae2aa8832f6f0c3cc3c32d4888bfb41363877c5165",
    "replacements": [
      {
        "old": " r:=public.static_weekly_materialize_manual_repeat(p_reference,p_digest,a.credential_id,a.device_id,a.session_access);",
        "new": " -- Reference and employment vector checks above have consumed this copy.\n a.repeat_basis:=NULL;\n r:=public.static_weekly_materialize_manual_repeat(p_reference,p_digest,a.credential_id,a.device_id,a.session_access);"
      }
    ]
  },
  {
    "name": "static_weekly_materialize_manual_repeat",
    "identity": "public.static_weekly_materialize_manual_repeat(jsonb,text,uuid,text,text)",
    "beforeSha256": "27adb55afccf85093df87036e44097efa69e3d9d6c5aa953a89b688f7ba5f4cd",
    "afterSha256": "eaa30f710b32b9daf94b5f1150d7ce418a36d2b64d785c11221b1047eff00bb0",
    "replacements": [
      {
        "old": " PERFORM public.custodial_begin_application_mutation();\n components:=public.static_weekly_manual_repeat_components((basis->>'sourceId')::uuid,frame);",
        "new": " -- All full basis/reference/employment checks above are complete. Retain\n -- only the exact scalar fields read by the unchanged receipt below.\n basis:=jsonb_build_object('sourceId',basis->'sourceId','frameStart',basis->'frameStart','frameEnd',basis->'frameEnd');\n expected:=NULL;vector:=NULL;reasons:=NULL;employee:=NULL;v_day:=NULL;\n PERFORM public.custodial_begin_application_mutation();\n components:=public.static_weekly_manual_repeat_components((basis->>'sourceId')::uuid,frame);"
      },
      {
        "old": " projection:=components->'projection';\n PERFORM public.static_weekly_manual_assert_lunch_lineage",
        "new": " projection:=components->'projection';\n -- The complete lunch remains; do not also retain a second projection copy.\n components:=components-'projection';\n PERFORM public.static_weekly_manual_assert_lunch_lineage"
      },
      {
        "old": " IF materialized->'ok' IS DISTINCT FROM 'true'::jsonb OR materialized->>'revision' IS NULL OR lunch->>'persistence_status' IS DISTINCT FROM 'PERSISTED' THEN RAISE EXCEPTION 'Native repeated period/lunch did not persist'; END IF;",
        "new": " -- The native producer returns static_weekly_response_json, not an `ok`\n -- wrapper. Bind its exact shape, digest and actual immutable receipt/rows.\n PERFORM public.static_weekly_assert_exact_object(materialized,\n  ARRAY['operation','revision','content_digest','request_digest','data','output_digest'],\n  ARRAY['operation','revision','content_digest','request_digest','data','output_digest'],'normal repeat native response');\n PERFORM public.static_weekly_assert_exact_object(materialized->'data',\n  ARRAY['projection_id','publication_id','week_start','week_end','replay_digest'],\n  ARRAY['projection_id','publication_id','week_start','week_end','replay_digest'],'normal repeat native response data');\n IF materialized->>'operation' IS DISTINCT FROM 'materialize_projection'\n  OR jsonb_typeof(materialized->'revision') IS DISTINCT FROM 'number'\n  OR (materialized->>'revision')::bigint<=revision\n  OR (materialized->>'revision')::bigint IS DISTINCT FROM(SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton)\n  OR materialized#>>'{data,publication_id}' IS DISTINCT FROM publication::text\n  OR materialized#>>'{data,week_start}' IS DISTINCT FROM frame::text\n  OR materialized#>>'{data,week_end}' IS DISTINCT FROM (frame+6)::text\n  OR coalesce(materialized->>'content_digest','')!~'^[a-f0-9]{64}$'\n  OR coalesce(materialized->>'request_digest','')!~'^[a-f0-9]{64}$'\n  OR materialized->>'output_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(materialized-'output_digest')\n  OR lunch->>'persistence_status' IS DISTINCT FROM 'PERSISTED'\n  OR lunch->>'projection_id' IS DISTINCT FROM materialized#>>'{data,projection_id}'\n  OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_command_receipts command_receipt\n   JOIN public.weekly_schedule_compiled_projections stored_projection\n    ON stored_projection.projection_id::text=materialized#>>'{data,projection_id}'\n   JOIN public.weekly_schedule_lunch_documents stored_lunch USING(projection_id)\n   WHERE command_receipt.actor_manager_id=manager AND command_receipt.idempotency_key=request::text||':normal-period'\n    AND command_receipt.command_type='materialize_projection' AND command_receipt.expected_revision=revision\n    AND command_receipt.request_digest=materialized->>'request_digest'\n    AND command_receipt.content_digest=materialized->>'content_digest'\n    AND command_receipt.response_digest=materialized->>'output_digest' AND command_receipt.response_json=materialized\n    AND stored_projection.publication_id=publication AND stored_projection.week_start=frame AND stored_projection.week_end=frame+6\n    AND stored_projection.compiler_version='approved-manual-repeat-v1'\n    AND stored_projection.replay_digest=materialized#>>'{data,replay_digest}'\n    AND stored_lunch.document_identity=lunch->>'document_identity')\n THEN RAISE EXCEPTION 'Native repeated period/lunch did not persist';END IF;"
      }
    ]
  },
  {
    "name": "static_weekly_manual_repeat_components",
    "identity": "public.static_weekly_manual_repeat_components(uuid,date)",
    "beforeSha256": "01d1b47593688a3d586e5c90e6bfdc4c49eb613b41645010001126401b9360e6",
    "afterSha256": "6cf42446e79ace87729a88338109b82342a9f09c206cc079c0b18791ce579778",
    "replacements": [
      {
        "old": " projection:=projection-'database_projection_identity';",
        "new": " -- Each removed field is replaced in the immediately following expression.\n -- One deletion avoids copying the obsolete authority and assignment arrays.\n projection:=projection-ARRAY['database_projection_identity','authority','assignments'];"
      },
      {
        "old": " lunch:=lunch-'document_identity';",
        "new": " -- The new projection now owns these exact transposed values.\n authority:=NULL;input:=NULL;overlay_input:=NULL;availability:=NULL;\n lunch:=lunch-'document_identity';"
      },
      {
        "old": " lunch:=lunch-ARRAY['base_authority_digest','base_replay_digest','document_identity'];",
        "new": " -- The new lunch document now owns these exact arrays and identifiers.\n loans:=NULL;responsibilities:=NULL;intents:=NULL;loan_keys:=NULL;\n lunch:=lunch-ARRAY['base_authority_digest','base_replay_digest','document_identity'];"
      },
      {
        "old": " replay_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('projectionAssignments',rows,'lunchDocument',lunch));",
        "new": " replay_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('projectionAssignments',rows,'lunchDocument',lunch));\n rows:=NULL;"
      }
    ]
  },
  {
    "name": "static_weekly_manual_repeat_materialize_projection",
    "identity": "public.static_weekly_manual_repeat_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)",
    "beforeSha256": "add0c554df14ce9330c4d4beeddb4a46cd872d7b81a1abb6a9fb30bb019abf4e",
    "afterSha256": "16db921f27ff1627ef42172f5290878500c6c4cc6c9b4f40fd74829e9fc7ac24",
    "replacements": [
      {
        "old": "v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock",
        "new": "v_request_digest:=public.static_weekly_digest_jsonb(v_request);\n  -- Digest the full unchanged request before replay lookup, then release its\n  -- projection copy while the exact native validator reconstructs expected rows.\n  v_request:=NULL;\n  perform pg_advisory_xact_lock"
      },
      {
        "old": "  v_response:=public.static_weekly_response_json('materialize_projection'",
        "new": "  -- Inputs are unchanged; reconstruct the same full canonical request for\n  -- the existing immutable receipt, without retaining it through validation.\n  v_request:=jsonb_build_object('operation','materialize_projection','publication_id',p_publication_id,'service_date',p_service_date,'exception_set_digest',p_exception_set_digest,'compiler_version',p_compiler_version,'objective',p_objective,'metrics',p_metrics,'replay_digest',p_replay_digest,'projection_envelope',p_assignments,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name);\n  v_response:=public.static_weekly_response_json('materialize_projection'"
      }
    ]
  }
]$changes$::jsonb) LOOP
  target:=to_regprocedure(item->>'identity');
  IF target IS NULL THEN RAISE EXCEPTION 'Recurring lifetime predecessor missing';END IF;
  original:=pg_get_functiondef(target);
  IF public.static_weekly_digest_text(original) IS DISTINCT FROM item->>'beforeSha256'
  THEN RAISE EXCEPTION 'Recurring lifetime predecessor changed: %',item->>'identity';END IF;
  SELECT proowner,proacl INTO STRICT before_owner,before_acl FROM pg_proc WHERE oid=target;
  before_grants:=public.custodial_release_authority_current_grant_definition(item->>'identity');
  -- Actual canonical303 predecessor has NONE of these function/grant
  -- aliases or canary roots. Do not accept already/partly enrolled variants.
  IF EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory
    WHERE CASE WHEN object_kind IN('function','grant') AND position('(' IN object_identity)>0
     THEN to_regprocedure(object_identity) END=target)
   OR EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface()
    WHERE CASE WHEN object_kind IN('function','grant') AND position('(' IN object_identity)>0
     THEN to_regprocedure(object_identity) END=target)
  THEN RAISE EXCEPTION 'Exact absence of recurring recovery membership and canary roots required';END IF;
  changed:=original;
  FOR edit IN SELECT value FROM jsonb_array_elements(item->'replacements') LOOP
   IF length(changed)-length(replace(changed,edit->>'old',''))<>length(edit->>'old')
   THEN RAISE EXCEPTION 'Recurring lifetime seam missing or repeated';END IF;
   changed:=replace(changed,edit->>'old',edit->>'new');
  END LOOP;
  inverse:=changed;
  FOR edit IN SELECT value FROM jsonb_array_elements(item->'replacements') WITH ORDINALITY x(value,n) ORDER BY n DESC LOOP
   IF length(inverse)-length(replace(inverse,edit->>'new',''))<>length(edit->>'new')
   THEN RAISE EXCEPTION 'Recurring lifetime inverse seam differs';END IF;
   inverse:=replace(inverse,edit->>'new',edit->>'old');
  END LOOP;
  IF inverse IS DISTINCT FROM original OR public.static_weekly_digest_text(changed) IS DISTINCT FROM item->>'afterSha256'
  THEN RAISE EXCEPTION 'Recurring lifetime full inverse/postimage differs';END IF;
  EXECUTE changed;
  IF pg_get_functiondef(target) IS DISTINCT FROM changed
   OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM before_owner
   OR (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM before_acl
   OR public.custodial_release_authority_current_grant_definition(item->>'identity') IS DISTINCT FROM before_grants
  THEN RAISE EXCEPTION 'Recurring lifetime owner/ACL/postimage changed';END IF;
  INSERT INTO manual_repeat_lifetime_targets VALUES(item->>'identity',changed);
 END LOOP;
END $lifetime$;
DO $recovery_preserved$
DECLARE r record;
BEGIN
 IF (SELECT count(*) FROM manual_repeat_lifetime_targets)<>4 THEN RAISE EXCEPTION 'Exactly four existing recurring functions required';END IF;
 IF EXISTS(SELECT * FROM manual_repeat_recovery_witness EXCEPT SELECT
 (SELECT public.static_weekly_digest_text(string_agg(public.static_weekly_digest_text(to_jsonb(i)::text),E'\n' ORDER BY i.inventory_id))
  FROM public.custodial_release_authority_restore_inventory i) AS inventory_digest,
 (SELECT count(*) FROM public.custodial_release_authority_restore_inventory) AS inventory_rows,
 public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)) AS canary_definition_digest,
 (SELECT public.static_weekly_digest_text(to_jsonb(p)::text) FROM pg_proc p
  WHERE p.oid='public.custodial_release_canary_authority_surface()'::regprocedure) AS canary_metadata_digest,
 (SELECT public.static_weekly_digest_jsonb(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.object_kind,s.object_identity,s.purpose),'[]'::jsonb))
  FROM public.custodial_release_canary_authority_surface() s) AS canary_roots_digest)
 THEN RAISE EXCEPTION 'Entire recovery inventory or canary changed during pre-canonical qualification';END IF;
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
 THEN RAISE EXCEPTION 'Exact ALWAYS recovery guard required throughout';END IF;
 FOR r IN SELECT * FROM manual_repeat_lifetime_targets LOOP
  IF pg_get_functiondef(to_regprocedure(r.identity)) IS DISTINCT FROM r.definition
  THEN RAISE EXCEPTION 'Final recurring postimage changed';END IF;
 END LOOP;
END $recovery_preserved$;


-- EXACT GUARDED COMPONENT 12 staffing_single_projection_validation SOURCE ef624a73ee8545a12661b9ce58530f63de120fc433b92e1e6e6dd710cf000348
-- PRE-CANONICAL internal qualification component; Main owns final binding.
-- Remove only duplicate projection validation at the owning staging call site.
-- Same payload predicates and unchanged late projection+lunch validator; no
-- new helper/grants, deadline change, optimizer change or normal-plan rewrite.
-- Main MUST bind the updated existing v10 stage function in its atomic final
-- canonical/recovery closure. Existing inventory/canary stay entirely unchanged.
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE staffing_validation_recovery_before ON COMMIT DROP AS SELECT
 (SELECT public.static_weekly_digest_text(string_agg(public.static_weekly_digest_text(to_jsonb(i)::text),E'\n' ORDER BY i.inventory_id))
  FROM public.custodial_release_authority_restore_inventory i) AS inventory_digest,
 (SELECT count(*) FROM public.custodial_release_authority_restore_inventory) AS inventory_rows,
 public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)) AS canary_definition_digest,
 (SELECT public.static_weekly_digest_text(to_jsonb(p)::text) FROM pg_proc p
  WHERE p.oid='public.custodial_release_canary_authority_surface()'::regprocedure) AS canary_metadata_digest,
 (SELECT public.static_weekly_digest_jsonb(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.object_kind,s.object_identity,s.purpose),'[]'::jsonb))
  FROM public.custodial_release_canary_authority_surface() s) AS canary_roots_digest;
DO $single_validation$
DECLARE item jsonb;target oid:='public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)'::regprocedure;
 original text;changed text;before_metadata jsonb;before_grants text;
 old_seam text:=$old$  PERFORM public.static_weekly_pending_assert_payload(p_operation_id,p_manager_id,v_pending.payload);$old$;
 new_seam text:=$new$  -- Keep the exact twelve-field transport/context checks here. The unchanged
  -- paired lunch validator below performs the full projection validation once,
  -- after lunch selection and before any candidate insert or PREPARED transition.
  DECLARE p_operation uuid:=p_operation_id;p_manager uuid:=p_manager_id;p_payload jsonb:=v_pending.payload;
   ctx jsonb;week date;publication uuid;
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
  END;$new$;
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM current_user::regrole
 THEN RAISE EXCEPTION 'Actual maintained staging function owner required';END IF;
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
 THEN RAISE EXCEPTION 'Exact ALWAYS recovery guard required';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements($guards$[
  {
    "identity": "public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)",
    "sha256": "f4a3666025be5a3fde272282e8edd8b1ed4ac07e20ca41fadad4339a916e438d"
  },
  {
    "identity": "public.static_weekly_pending_assert_payload(uuid,uuid,jsonb)",
    "sha256": "3cd46f205ccfef0d64c5cbe1b826117d462608aabcbbdf358fc9a911463e29af"
  },
  {
    "identity": "public.static_weekly_pending_assert_lunch(uuid,uuid,uuid,date,jsonb,jsonb)",
    "sha256": "f369414eb5a37e371e3064058394a7c7734932196c5e512739646a6197c85b58"
  },
  {
    "identity": "public.static_weekly_pending_assert_projection(uuid,uuid,jsonb)",
    "sha256": "601588840d94bc7d36601887b1980481090f16c2c27aace5b0905337ee55f987"
  }
]$guards$::jsonb) LOOP
  IF to_regprocedure(item->>'identity') IS NULL
   OR public.static_weekly_digest_text(pg_get_functiondef(to_regprocedure(item->>'identity'))) IS DISTINCT FROM item->>'sha256'
  THEN RAISE EXCEPTION 'Exact staging/payload/lunch/projection predecessor differs: %',item->>'identity';END IF;
 END LOOP;
 original:=pg_get_functiondef(target);
 SELECT to_jsonb(p)-'prosrc' INTO STRICT before_metadata FROM pg_proc p WHERE oid=target;
 before_grants:=public.custodial_release_authority_current_grant_definition(target::regprocedure::text);
 IF length(original)-length(replace(original,old_seam,''))<>length(old_seam)
 THEN RAISE EXCEPTION 'Single duplicate staging validation seam required';END IF;
 changed:=replace(original,old_seam,new_seam);
 IF length(changed)-length(replace(changed,new_seam,''))<>length(new_seam)
  OR replace(changed,new_seam,old_seam) IS DISTINCT FROM original
  OR public.static_weekly_digest_text(changed) IS DISTINCT FROM '889455a6388f4365d87d04e238fef2169beb0417985916b42626eee976ac9b1c'
 THEN RAISE EXCEPTION 'Staging single-validation inverse/postimage differs';END IF;
 EXECUTE changed;
 IF pg_get_functiondef(target) IS DISTINCT FROM changed
  OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM before_metadata
  OR public.custodial_release_authority_current_grant_definition(target::regprocedure::text) IS DISTINCT FROM before_grants
 THEN RAISE EXCEPTION 'Staging single-validation postimage/owner/ACL changed';END IF;
 -- All independently callable helpers remain exact and fully validating.
 FOR item IN SELECT value FROM jsonb_array_elements($helpers$[
  {
    "identity": "public.static_weekly_pending_assert_payload(uuid,uuid,jsonb)",
    "sha256": "3cd46f205ccfef0d64c5cbe1b826117d462608aabcbbdf358fc9a911463e29af"
  },
  {
    "identity": "public.static_weekly_pending_assert_lunch(uuid,uuid,uuid,date,jsonb,jsonb)",
    "sha256": "f369414eb5a37e371e3064058394a7c7734932196c5e512739646a6197c85b58"
  },
  {
    "identity": "public.static_weekly_pending_assert_projection(uuid,uuid,jsonb)",
    "sha256": "601588840d94bc7d36601887b1980481090f16c2c27aace5b0905337ee55f987"
  }
]$helpers$::jsonb) LOOP
  IF public.static_weekly_digest_text(pg_get_functiondef(to_regprocedure(item->>'identity'))) IS DISTINCT FROM item->>'sha256'
  THEN RAISE EXCEPTION 'Independent pending helper changed';END IF;
 END LOOP;
 IF EXISTS(SELECT * FROM staffing_validation_recovery_before EXCEPT SELECT
 (SELECT public.static_weekly_digest_text(string_agg(public.static_weekly_digest_text(to_jsonb(i)::text),E'\n' ORDER BY i.inventory_id))
  FROM public.custodial_release_authority_restore_inventory i) AS inventory_digest,
 (SELECT count(*) FROM public.custodial_release_authority_restore_inventory) AS inventory_rows,
 public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)) AS canary_definition_digest,
 (SELECT public.static_weekly_digest_text(to_jsonb(p)::text) FROM pg_proc p
  WHERE p.oid='public.custodial_release_canary_authority_surface()'::regprocedure) AS canary_metadata_digest,
 (SELECT public.static_weekly_digest_jsonb(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.object_kind,s.object_identity,s.purpose),'[]'::jsonb))
  FROM public.custodial_release_canary_authority_surface() s) AS canary_roots_digest)
 THEN RAISE EXCEPTION 'Existing recovery inventory/canary changed during pre-canonical qualification';END IF;
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
 THEN RAISE EXCEPTION 'Exact ALWAYS recovery guard required throughout';END IF;
END $single_validation$;

-- Final recovery binding, staged only; no execution or release admission.
-- Requires the original-owner prelude and exact twelve product bodies in this transaction.
SELECT custodial_dr.install_application_mutation_fences();
CREATE TEMP TABLE main_sealed_repair_recovery_rows(
 bucket integer NOT NULL,kind text NOT NULL,identity text NOT NULL,definition text NOT NULL,
 PRIMARY KEY(kind,identity)) ON COMMIT DROP;
DO $main_recovery$
DECLARE rel text;rid oid;obj record;fn record;function_identity_text text;function_definition_text text;surface text;roots text;next_order integer;changed integer;
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES ('public','static_weekly_v10_stage_staffing_command'),('public','static_weekly_finish_manual_recurring_normal'),('public','static_weekly_materialize_manual_repeat'),('public','static_weekly_manual_repeat_components'),('public','static_weekly_manual_repeat_materialize_projection'),
('public','mz_event_reminder_schedule_candidate'),
('custodial_leadership_private','bind_registration_generation'),
('custodial_leadership_private','coverall_link_issuer'),
('custodial_leadership_private','ensure_messaging_account'),
('custodial_leadership_private','execute'),
('custodial_leadership_private','messaging_account_active'),
('custodial_leadership_private','notification_credential'),
('custodial_leadership_private','record_operation_v1'),
('custodial_leadership_private','session_view'),
('public','custodial_leadership_messaging_operation_v1'),
('public','custodial_leadership_record_operation_v1'),
('public','custodial_named_record_operation_v1'),
('public','custodial_native_alert_finalize_at'),
('public','custodial_native_alert_prepare_at'),
('public','custodial_native_alert_utf8_prefix'),
('public','custodial_ops_manager_message_push_is_current'),
('public','custodial_ops_manager_notification_binding_is_current'),
('public','custodial_ops_manager_notification_recipient_is_current'),
('public','custodial_release_canary_authority_surface'),
('public','evaluate_location_proximity_v2'),
('public','events_app_validate_scope_venue'),
('public','msg_broadcast_operation_v1'),
('public','msg_custodial_cohort_message_actor_v1'),
('public','msg_is_runtime_user'),
('public','mz_employee_event_push_current_projection'),
('public','ops_manager_enqueue_lunch_delivery_failure'),
('public','ops_manager_enqueue_message_push'),
('public','ops_manager_enqueue_scheduled_notifications'),
('public','ops_manager_finish_notification_job'),
('public','ops_manager_notification_bind_credential'),
('public','ops_manager_notification_job_is_current'),
('public','ops_manager_notification_validate_owner'),
('public','static_weekly_assert_coverall_link_basis'),
('public','static_weekly_issue_coverall_link'),
('public','static_weekly_read_coverall_link'),
('public','static_weekly_revoke_coverall_link')) selected(schema_name,function_name)
  LEFT JOIN pg_namespace n ON n.nspname=selected.schema_name
  LEFT JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=selected.function_name
  GROUP BY selected.schema_name,selected.function_name HAVING count(p.oid)<>1)
 THEN RAISE EXCEPTION 'Exact sealed-repair function count differs'; END IF;
 -- CREATE OR REPLACE must retain all original function owners and ACLs.
 IF EXISTS(SELECT 1 FROM main_sealed_repair_original_functions b LEFT JOIN pg_proc p ON p.oid=b.oid
  WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner OR p.proacl IS DISTINCT FROM b.proacl)
 THEN RAISE EXCEPTION 'Existing function authority changed in sealed repair';END IF;
 FOREACH rel IN ARRAY ARRAY['custodial_leadership_private.messaging_message_bindings','custodial_leadership_private.registrations','public.msg_broadcast_request_receipts','public.msg_users','public.ops_manager_notification_credentials','public.ops_manager_notification_preferences','public.ops_manager_notification_queue','public.ops_manager_notification_state','public.ops_manager_push_devices','public.static_weekly_coverall_access_links'] LOOP
  rid:=rel::regclass;
  INSERT INTO main_sealed_repair_recovery_rows VALUES
   (1000,'relation',rel,public.custodial_release_authority_current_relation_definition(rel)),
   (300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)),
   (400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)),
   (900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel));
  INSERT INTO main_sealed_repair_recovery_rows SELECT 200000,'column',rel||':'||attname,
   public.custodial_release_authority_current_column_definition(rel||':'||attname)
   FROM pg_attribute WHERE attrelid=rid AND attnum>0 AND NOT attisdropped;
  INSERT INTO main_sealed_repair_recovery_rows SELECT 500000,'constraint',rel||':'||conname,
   public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
   FROM pg_constraint WHERE conrelid=rid;
  INSERT INTO main_sealed_repair_recovery_rows SELECT 600000,'index',indexrelid::regclass::text,
   public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
   FROM pg_index i WHERE indrelid=rid AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid);
  INSERT INTO main_sealed_repair_recovery_rows SELECT 700000,'trigger',rel||'.'||quote_ident(tgname),
   'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '||pg_get_triggerdef(oid,true)||'; alter table '||rel||' '
    ||CASE tgenabled WHEN 'O' THEN 'enable' WHEN 'D' THEN 'disable' WHEN 'R' THEN 'enable replica' WHEN 'A' THEN 'enable always' END
    ||' trigger '||quote_ident(tgname)||';' FROM pg_trigger WHERE tgrelid=rid AND NOT tgisinternal;
  INSERT INTO main_sealed_repair_recovery_rows SELECT 800000,'policy',rel||':'||polname,
   public.custodial_release_authority_current_policy_definition(rel||':'||polname)
   FROM pg_policy WHERE polrelid=rid;
 END LOOP;
 FOR fn IN SELECT n.nspname,p.proname,p.oid FROM (VALUES ('public','static_weekly_v10_stage_staffing_command'),('public','static_weekly_finish_manual_recurring_normal'),('public','static_weekly_materialize_manual_repeat'),('public','static_weekly_manual_repeat_components'),('public','static_weekly_manual_repeat_materialize_projection'),
('public','mz_event_reminder_schedule_candidate'),
('custodial_leadership_private','bind_registration_generation'),
('custodial_leadership_private','coverall_link_issuer'),
('custodial_leadership_private','ensure_messaging_account'),
('custodial_leadership_private','execute'),
('custodial_leadership_private','messaging_account_active'),
('custodial_leadership_private','notification_credential'),
('custodial_leadership_private','record_operation_v1'),
('custodial_leadership_private','session_view'),
('public','custodial_leadership_messaging_operation_v1'),
('public','custodial_leadership_record_operation_v1'),
('public','custodial_named_record_operation_v1'),
('public','custodial_native_alert_finalize_at'),
('public','custodial_native_alert_prepare_at'),
('public','custodial_native_alert_utf8_prefix'),
('public','custodial_ops_manager_message_push_is_current'),
('public','custodial_ops_manager_notification_binding_is_current'),
('public','custodial_ops_manager_notification_recipient_is_current'),
('public','custodial_release_canary_authority_surface'),
('public','evaluate_location_proximity_v2'),
('public','events_app_validate_scope_venue'),
('public','msg_broadcast_operation_v1'),
('public','msg_custodial_cohort_message_actor_v1'),
('public','msg_is_runtime_user'),
('public','mz_employee_event_push_current_projection'),
('public','ops_manager_enqueue_lunch_delivery_failure'),
('public','ops_manager_enqueue_message_push'),
('public','ops_manager_enqueue_scheduled_notifications'),
('public','ops_manager_finish_notification_job'),
('public','ops_manager_notification_bind_credential'),
('public','ops_manager_notification_job_is_current'),
('public','ops_manager_notification_validate_owner'),
('public','static_weekly_assert_coverall_link_basis'),
('public','static_weekly_issue_coverall_link'),
('public','static_weekly_read_coverall_link'),
('public','static_weekly_revoke_coverall_link')) selected(schema_name,function_name)
  JOIN pg_namespace n ON n.nspname=selected.schema_name JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=selected.function_name LOOP
  function_identity_text:=fn.oid::regprocedure::text;function_definition_text:=pg_get_functiondef(fn.oid);
  -- Preserve existing identity spellings; do not delete historical aliases.
  changed:=0;
  FOR obj IN SELECT i.object_identity FROM public.custodial_release_authority_restore_inventory i
   WHERE CASE WHEN i.object_kind='function' THEN to_regprocedure(i.object_identity)=fn.oid ELSE false END LOOP
   INSERT INTO main_sealed_repair_recovery_rows VALUES(100000,'function',obj.object_identity,function_definition_text);changed:=changed+1;
  END LOOP;
  IF changed=0 THEN INSERT INTO main_sealed_repair_recovery_rows VALUES(100000,'function',function_identity_text,function_definition_text);END IF;
  changed:=0;
  FOR obj IN SELECT i.object_identity FROM public.custodial_release_authority_restore_inventory i
   WHERE CASE WHEN i.object_kind='grant' AND position('(' IN i.object_identity)>0 THEN to_regprocedure(i.object_identity)=fn.oid ELSE false END LOOP
   INSERT INTO main_sealed_repair_recovery_rows VALUES(1000000,'grant',obj.object_identity,
    public.custodial_release_authority_current_grant_definition(obj.object_identity));changed:=changed+1;
  END LOOP;
  IF changed=0 THEN INSERT INTO main_sealed_repair_recovery_rows VALUES(1000000,'grant',function_identity_text,
   public.custodial_release_authority_current_grant_definition(function_identity_text));END IF;
 END LOOP;
 INSERT INTO main_sealed_repair_recovery_rows VALUES(800000,'view','public.v_cleaning_performance_comparison',
  public.custodial_release_authority_current_view_definition('public.v_cleaning_performance_comparison'));
 IF EXISTS(SELECT 1 FROM main_sealed_repair_recovery_rows WHERE definition IS NULL OR definition='')
 THEN RAISE EXCEPTION 'Sealed repair recovery renderer unavailable';END IF;
 -- The only removed constraint identity belongs to the approved lifetime change.
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='custodial_leadership_private.registrations'::regclass AND conname='registrations_check')
 THEN RAISE EXCEPTION 'Old finite registration constraint unexpectedly survives';END IF;
 -- Enroll exact new roots only; pre-existing canary values remain literal.
 surface:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF length(surface)-length(replace(surface,'  values',''))<>length('  values') THEN RAISE EXCEPTION 'Sealed repair canary VALUES seam changed';END IF;
 SELECT string_agg(format('(%L,%L,%L),',n.kind,n.identity,'approved sealed repair dependency; existing schedules preserved'),E'\n ' ORDER BY n.bucket,n.kind,n.identity)
 INTO roots FROM main_sealed_repair_recovery_rows n
 WHERE n.kind IN('relation','column_set','relation_state','function','constraint','grant','view')
 AND NOT EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface() s WHERE s.object_kind=n.kind AND s.object_identity=n.identity);
 IF roots IS NOT NULL THEN EXECUTE replace(surface,'  values','  values'||E'\n '||roots);END IF;
 -- Rendering after modification binds the actual platform-specific canary.
 UPDATE main_sealed_repair_recovery_rows SET definition=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)
 WHERE CASE WHEN kind='function' THEN to_regprocedure(identity)='public.custodial_release_canary_authority_surface()'::regprocedure ELSE false END;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 DELETE FROM public.custodial_release_authority_restore_inventory WHERE object_kind='constraint'
 AND object_identity='custodial_leadership_private.registrations:registrations_check';
 FOR obj IN SELECT * FROM main_sealed_repair_recovery_rows ORDER BY bucket,kind,identity LOOP
  UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   WHERE object_kind=obj.kind AND object_identity=obj.identity;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed>1 THEN RAISE EXCEPTION 'Duplicated recovery identity';END IF;
  IF changed=0 THEN
   SELECT n INTO next_order FROM generate_series(obj.bucket+1,CASE WHEN obj.bucket=1000 THEN 99999 ELSE obj.bucket+99999 END) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.restore_order=n) ORDER BY n LIMIT 1;
   IF next_order IS NULL THEN RAISE EXCEPTION 'Sealed repair recovery bucket exhausted';END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  END IF;
 END LOOP;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 IF EXISTS(SELECT 1 FROM main_sealed_repair_recovery_rows n LEFT JOIN public.custodial_release_authority_restore_inventory i
  ON i.object_kind=n.kind AND i.object_identity=n.identity WHERE i.object_identity IS NULL
  OR i.definition_sql IS DISTINCT FROM n.definition OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(n.definition))
 THEN RAISE EXCEPTION 'Sealed repair recovery readback differs';END IF;
 IF EXISTS(SELECT * FROM main_sealed_repair_inventory_before b
  WHERE NOT EXISTS(SELECT 1 FROM main_sealed_repair_recovery_rows n WHERE n.kind=b.object_kind AND n.identity=b.object_identity)
  AND NOT(b.object_kind='constraint' AND b.object_identity='custodial_leadership_private.registrations:registrations_check')
  EXCEPT SELECT restore_order,object_kind,object_identity,definition_sha256,captured_at,
   public.static_weekly_digest_text(definition_sql) FROM public.custodial_release_authority_restore_inventory)
 THEN RAISE EXCEPTION 'Unrelated recovery history changed';END IF;
 IF EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
  WHERE NOT EXISTS(SELECT 1 FROM main_sealed_repair_inventory_before b WHERE b.object_kind=i.object_kind AND b.object_identity=i.object_identity)
  AND NOT EXISTS(SELECT 1 FROM main_sealed_repair_recovery_rows n WHERE n.kind=i.object_kind AND n.identity=i.object_identity))
 THEN RAISE EXCEPTION 'Unexpected unrelated recovery membership added'; END IF;
END $main_recovery$;
-- No COMMIT here. Main's final allocated atomic successor owns that boundary.

COMMIT;
