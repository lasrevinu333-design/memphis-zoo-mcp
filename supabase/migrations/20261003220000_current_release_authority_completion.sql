-- CLI-created 20261002191014; forward ordered after the owned 03210000
-- seasonal safeguard and 03211000 source retention. No applied migration or
-- protected data is rewritten.
-- The source-derived Feedback relation omission was reproduced in the exact
-- isolated 214-migration replay. Both captured and intended catalog hashes
-- are pinned: this is NOT permission to recapture arbitrary live drift.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;

do $feedback_relation$
declare
  captured record;
  current_definition text;
  current_digest text;
  changed integer;
begin
  if not exists(select 1 from pg_trigger
    where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
      and tgname='trg_custodial_release_authority_restore_inventory_immutable'
      and tgenabled='O') then
    raise exception 'Current release recovery inventory immutability unavailable';
  end if;
  select definition_sql,definition_sha256 into strict captured
    from public.custodial_release_authority_restore_inventory
    where object_kind='relation' and object_identity='public.system_feedback_email_intents';
  if captured.definition_sha256 is distinct from '09812c2615f1f9176eadd54bfd4f60395648ea75f2cad0ebf1a6cb458f900aac'
    or public.static_weekly_digest_text(captured.definition_sql) is distinct from
      '09812c2615f1f9176eadd54bfd4f60395648ea75f2cad0ebf1a6cb458f900aac' then
    raise exception 'Feedback relation captured predecessor changed';
  end if;
  current_definition:=public.custodial_release_authority_current_relation_definition('public.system_feedback_email_intents');
  current_digest:=public.static_weekly_digest_text(current_definition);
  if current_digest is distinct from '23cb9bb81091860d7e5bd6b629db2f4f385994bcdbdbf7776392128cd9b570ef' then
    raise exception 'Feedback relation current predecessor changed';
  end if;
  alter table public.custodial_release_authority_restore_inventory
    disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  update public.custodial_release_authority_restore_inventory
    set definition_sql=current_definition,definition_sha256=current_digest,captured_at=statement_timestamp()
    where object_kind='relation' and object_identity='public.system_feedback_email_intents'
      and definition_sha256='09812c2615f1f9176eadd54bfd4f60395648ea75f2cad0ebf1a6cb458f900aac';
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Feedback relation recovery scope changed';end if;
  alter table public.custodial_release_authority_restore_inventory
    enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $feedback_relation$;


-- Independently named current-module membership, derived from the reviewed
-- post187 source declarations, not from whichever inventory rows happen to
-- exist at runtime. Listing private helpers does not grant their execution.
-- Includes the exact integrated seasonal safeguard and its acceptance fences.
do $current_surface$
declare
  wanted record;
  canonical_identity text;
  expected_definition text;
  callable boolean;
  prior_definition text;
  next_definition text;
  prior_grant text;
  additions text:='';
  obj_oid oid;
  matched integer;
  updated integer;
begin
  prior_definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
  prior_grant:=public.custodial_release_authority_current_grant_definition('custodial_release_canary_authority_surface()');
  if prior_definition is null or prior_grant is null
    or (length(prior_definition)-length(replace(prior_definition,'  values','')))/length('  values')<>1 then
    raise exception 'Current release surface predecessor seam changed';
  end if;
  if exists(select 1 from public.custodial_release_authority_restore_inventory i
    where i.object_kind='function'
      and case when i.object_kind='function' then to_regprocedure(i.object_identity) end
        ='public.custodial_release_canary_authority_surface()'::regprocedure
      and (i.definition_sql is distinct from prior_definition
        or i.definition_sha256 is distinct from public.static_weekly_digest_text(prior_definition))) then
    raise exception 'Current release captured surface predecessor changed';
  end if;
  select count(*) into matched from public.custodial_release_authority_restore_inventory
    where object_kind='function'
      and case when object_kind='function' then to_regprocedure(object_identity) end
        ='public.custodial_release_canary_authority_surface()'::regprocedure;
  if matched<1 then raise exception 'Current release surface recovery binding missing';end if;
  for wanted in with source_members(kind,identity,source_file) as (values
      ('relation','public.static_weekly_sch022_staffing_witnesses','20261003210000_static_weekly_splash_season_gate.sql'),
      ('column_set','public.static_weekly_sch022_staffing_witnesses','20261003210000_static_weekly_splash_season_gate.sql'),
      ('relation_state','public.static_weekly_sch022_staffing_witnesses','20261003210000_static_weekly_splash_season_gate.sql'),
      ('function','static_weekly_sch022_work_witness(date,jsonb)','20261003211000_static_weekly_splash_source_retention.sql'),
      ('function','static_weekly_sch022_retained_member_referenced(uuid)','20261003211000_static_weekly_splash_source_retention.sql'),
      ('function','static_weekly_sch022_membership_identity_guard()','20261003211000_static_weekly_splash_source_retention.sql'),
      ('function','static_weekly_sch022_group_identity_guard()','20261003211000_static_weekly_splash_source_retention.sql'),
      ('trigger','public.location_group_memberships.trg_static_weekly_sch022_membership_identity_guard','20261003211000_static_weekly_splash_source_retention.sql'),
      ('trigger','public.location_groups.trg_static_weekly_sch022_group_identity_guard','20261003211000_static_weekly_splash_source_retention.sql'),
      ('function','static_weekly_sch022_preview_witness(date,jsonb,uuid)','20261003210000_static_weekly_splash_season_gate.sql'),
      ('function','static_weekly_sch022_normalize_work(uuid,text,jsonb)','20261003210000_static_weekly_splash_season_gate.sql'),
      ('function','static_weekly_sch022_publication_gate()','20261003210000_static_weekly_splash_season_gate.sql'),
      ('function','static_weekly_sch022_exception_gate()','20261003210000_static_weekly_splash_season_gate.sql'),
      ('function','static_weekly_sch022_occurrence_gate()','20261003210000_static_weekly_splash_season_gate.sql'),
      ('function','static_weekly_sch022_projection_work(jsonb)','20261003210000_static_weekly_splash_season_gate.sql'),
      ('function','static_weekly_sch022_candidate_witness(jsonb)','20261003210000_static_weekly_splash_season_gate.sql'),
      ('function','static_weekly_sch022_preview_staffing_witness(jsonb,uuid)','20261003210000_static_weekly_splash_season_gate.sql'),
      ('function','static_weekly_sch022_staged_witness(uuid)','20261003210000_static_weekly_splash_season_gate.sql'),
      ('function','static_weekly_sch022_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid,text)','20261003210000_static_weekly_splash_season_gate.sql'),
      ('function','static_weekly_sch022_staffing_accept_gate()','20261003210000_static_weekly_splash_season_gate.sql'),
      ('trigger','public.weekly_schedule_publications.trg_static_weekly_sch022_publication_gate','20261003210000_static_weekly_splash_season_gate.sql'),
      ('trigger','public.weekly_schedule_exception_commands.trg_static_weekly_sch022_exception_gate','20261003210000_static_weekly_splash_season_gate.sql'),
      ('trigger','public.weekly_schedule_occurrences.trg_static_weekly_sch022_occurrence_gate','20261003210000_static_weekly_splash_season_gate.sql'),
      ('trigger','public.static_weekly_staffing_commands.trg_static_weekly_sch022_staffing_accept_gate','20261003210000_static_weekly_splash_season_gate.sql'),
      ('trigger','public.static_weekly_sch022_staffing_witnesses.trg_static_weekly_sch022_staffing_witness_immutable','20261003210000_static_weekly_splash_season_gate.sql'),
      ('constraint','public.employee_native_push_delivery_receipts:native_location_payload_binding','20261003194000_native_lunch_delivery.sql'),
      ('trigger','public.employee_native_lunch_dispatch_attempts.trg_native_lunch_dispatch_immutable','20261003194000_native_lunch_delivery.sql'),
      ('trigger','public.custodial_completion_taxonomy_versions.custodial_completion_taxonomy_immutable','20261003120000_completion_taxonomy_evidence.sql'),
      ('trigger','public.completion_responses.custodial_completion_taxonomy_response_guard','20261003120000_completion_taxonomy_evidence.sql'),
      ('relation','public.custodial_place_bridge_previews','20261002160000_place_event_venue_bridge.sql'),
      ('relation','public.custodial_place_bridge_versions','20261002160000_place_event_venue_bridge.sql'),
      ('relation','public.events_app_transition_receipts','20261002170000_event_cancellation_cas_restore.sql'),
      ('relation','public.custodial_place_source_previews','20261002200000_place_operational_metadata_bridge.sql'),
      ('relation','public.custodial_place_source_versions','20261002200000_place_operational_metadata_bridge.sql'),
      ('relation','public.custodial_place_source_admissions','20261002200000_place_operational_metadata_bridge.sql'),
      ('relation','public.employee_native_location_outcomes','20261003010000_native_location_lifecycle.sql'),
      ('relation','public.employee_native_location_inventory_scans','20261003010000_native_location_lifecycle.sql'),
      ('relation','public.custodial_place_operational_previews','20261003030000_place_operational_name_adoption.sql'),
      ('relation','public.custodial_place_operational_commands','20261003030000_place_operational_name_adoption.sql'),
      ('relation','public.custodial_place_operational_receipts','20261003030000_place_operational_name_adoption.sql'),
      ('relation','public.employee_native_provider_events','20261003050000_native_provider_events.sql'),
      ('relation','public.employee_native_provider_event_requests','20261003050000_native_provider_events.sql'),
      ('relation','public.system_feedback_triage_receipts','20261003070000_feedback_triage_receipts.sql'),
      ('relation','public.employee_native_location_dispatch_attempts','20261003080000_native_location_dispatch_and_ack.sql'),
      ('relation','public.employee_native_location_ack_projections','20261003080000_native_location_dispatch_and_ack.sql'),
      ('relation','public.custodial_completion_taxonomy_versions','20261003120000_completion_taxonomy_evidence.sql'),
      ('relation','public.static_weekly_contractor_capacity_registrations','20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
      ('relation','public.static_weekly_capacity_source_previews','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('relation','public.static_weekly_capacity_source_commands','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('relation','public.static_weekly_capacity_source_receipts','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('relation','public.employee_native_lunch_dispatch_attempts','20261003194000_native_lunch_delivery.sql'),
      ('column_set','public.custodial_place_bridge_previews','20261002160000_place_event_venue_bridge.sql'),
      ('column_set','public.custodial_place_bridge_versions','20261002160000_place_event_venue_bridge.sql'),
      ('column_set','public.events_app_transition_receipts','20261002170000_event_cancellation_cas_restore.sql'),
      ('column_set','public.custodial_place_source_previews','20261002200000_place_operational_metadata_bridge.sql'),
      ('column_set','public.custodial_place_source_versions','20261002200000_place_operational_metadata_bridge.sql'),
      ('column_set','public.custodial_place_source_admissions','20261002200000_place_operational_metadata_bridge.sql'),
      ('column_set','public.employee_native_location_outcomes','20261003010000_native_location_lifecycle.sql'),
      ('column_set','public.employee_native_location_inventory_scans','20261003010000_native_location_lifecycle.sql'),
      ('column_set','public.custodial_place_operational_previews','20261003030000_place_operational_name_adoption.sql'),
      ('column_set','public.custodial_place_operational_commands','20261003030000_place_operational_name_adoption.sql'),
      ('column_set','public.custodial_place_operational_receipts','20261003030000_place_operational_name_adoption.sql'),
      ('column_set','public.employee_native_provider_events','20261003050000_native_provider_events.sql'),
      ('column_set','public.employee_native_provider_event_requests','20261003050000_native_provider_events.sql'),
      ('column_set','public.system_feedback_triage_receipts','20261003070000_feedback_triage_receipts.sql'),
      ('column_set','public.employee_native_location_dispatch_attempts','20261003080000_native_location_dispatch_and_ack.sql'),
      ('column_set','public.employee_native_location_ack_projections','20261003080000_native_location_dispatch_and_ack.sql'),
      ('column_set','public.custodial_completion_taxonomy_versions','20261003120000_completion_taxonomy_evidence.sql'),
      ('column_set','public.static_weekly_contractor_capacity_registrations','20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
      ('column_set','public.static_weekly_capacity_source_previews','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('column_set','public.static_weekly_capacity_source_commands','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('column_set','public.static_weekly_capacity_source_receipts','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('column_set','public.employee_native_lunch_dispatch_attempts','20261003194000_native_lunch_delivery.sql'),
      ('relation_state','public.custodial_place_bridge_previews','20261002160000_place_event_venue_bridge.sql'),
      ('relation_state','public.custodial_place_bridge_versions','20261002160000_place_event_venue_bridge.sql'),
      ('relation_state','public.events_app_transition_receipts','20261002170000_event_cancellation_cas_restore.sql'),
      ('relation_state','public.custodial_place_source_previews','20261002200000_place_operational_metadata_bridge.sql'),
      ('relation_state','public.custodial_place_source_versions','20261002200000_place_operational_metadata_bridge.sql'),
      ('relation_state','public.custodial_place_source_admissions','20261002200000_place_operational_metadata_bridge.sql'),
      ('relation_state','public.employee_native_location_outcomes','20261003010000_native_location_lifecycle.sql'),
      ('relation_state','public.employee_native_location_inventory_scans','20261003010000_native_location_lifecycle.sql'),
      ('relation_state','public.custodial_place_operational_previews','20261003030000_place_operational_name_adoption.sql'),
      ('relation_state','public.custodial_place_operational_commands','20261003030000_place_operational_name_adoption.sql'),
      ('relation_state','public.custodial_place_operational_receipts','20261003030000_place_operational_name_adoption.sql'),
      ('relation_state','public.employee_native_provider_events','20261003050000_native_provider_events.sql'),
      ('relation_state','public.employee_native_provider_event_requests','20261003050000_native_provider_events.sql'),
      ('relation_state','public.system_feedback_triage_receipts','20261003070000_feedback_triage_receipts.sql'),
      ('relation_state','public.employee_native_location_dispatch_attempts','20261003080000_native_location_dispatch_and_ack.sql'),
      ('relation_state','public.employee_native_location_ack_projections','20261003080000_native_location_dispatch_and_ack.sql'),
      ('relation_state','public.custodial_completion_taxonomy_versions','20261003120000_completion_taxonomy_evidence.sql'),
      ('relation_state','public.static_weekly_contractor_capacity_registrations','20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
      ('relation_state','public.static_weekly_capacity_source_previews','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('relation_state','public.static_weekly_capacity_source_commands','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('relation_state','public.static_weekly_capacity_source_receipts','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('relation_state','public.employee_native_lunch_dispatch_attempts','20261003194000_native_lunch_delivery.sql'),
      ('function','custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean)','20261002130000_native_provider_clock_transport.sql'),
      ('function','app_event_supersession_guard()','20261002140000_event_supersession_and_chicago_instants.sql'),
      ('function','app_replace_event_authoritative(uuid,integer,jsonb,uuid)','20261002140000_event_supersession_and_chicago_instants.sql'),
      ('function','custodial_feedback_delivery_status(uuid[])','20261002150000_feedback_delivery_readback.sql'),
      ('function','place_bridge_source()','20261002160000_place_event_venue_bridge.sql'),
      ('function','place_bridge_sha(jsonb)','20261002160000_place_event_venue_bridge.sql'),
      ('function','place_bridge_overlay(timestamp with time zone,jsonb)','20261002160000_place_event_venue_bridge.sql'),
      ('function','custodial_place_event_venue_overlay(timestamp with time zone)','20261002160000_place_event_venue_bridge.sql'),
      ('function','custodial_place_bridge_preview(uuid,text,uuid,text,uuid,timestamp with time zone,text)','20261002160000_place_event_venue_bridge.sql'),
      ('function','custodial_place_bridge_confirm(uuid,uuid,uuid)','20261002160000_place_event_venue_bridge.sql'),
      ('function','app_event_transition_receipt_immutable()','20261002170000_event_cancellation_cas_restore.sql'),
      ('function','app_event_cancellation_transition_guard()','20261002170000_event_cancellation_cas_restore.sql'),
      ('function','app_transition_event_cancellation(uuid,text,integer,uuid,uuid,text)','20261002170000_event_cancellation_cas_restore.sql'),
      ('function','custodial_native_location_canonical(jsonb)','20261002180000_native_provider_location_reservation.sql'),
      ('function','custodial_native_location_receipt_guard()','20261002180000_native_provider_location_reservation.sql'),
      ('function','custodial_native_location_reserve_at(uuid,uuid,jsonb,timestamp with time zone)','20261002180000_native_provider_location_reservation.sql'),
      ('function','custodial_native_location_reserve(uuid,uuid,jsonb)','20261002180000_native_provider_location_reservation.sql'),
      ('function','place_source_row(text,uuid)','20261002200000_place_operational_metadata_bridge.sql'),
      ('function','place_source_dependencies()','20261002200000_place_operational_metadata_bridge.sql'),
      ('function','place_source_manifest()','20261002200000_place_operational_metadata_bridge.sql'),
      ('function','place_source_locks()','20261002200000_place_operational_metadata_bridge.sql'),
      ('function','custodial_place_source_preview(uuid,text,uuid,text,jsonb,timestamp with time zone,text)','20261002200000_place_operational_metadata_bridge.sql'),
      ('function','place_source_apply(uuid,uuid,uuid,timestamp with time zone)','20261002200000_place_operational_metadata_bridge.sql'),
      ('function','custodial_place_source_confirm(uuid,uuid,uuid)','20261002200000_place_operational_metadata_bridge.sql'),
      ('function','custodial_place_source_overlay(timestamp with time zone)','20261002200000_place_operational_metadata_bridge.sql'),
      ('function','app_event_place_authority(jsonb,timestamp with time zone)','20261002210000_event_place_overlay_admission.sql'),
      ('function','app_event_place_admission_guard()','20261002210000_event_place_overlay_admission.sql'),
      ('function','mz_event_reminder_schedule(uuid,integer,uuid,text)','20261002210000_event_place_overlay_admission.sql'),
      ('function','feedback_email_relay_immutable()','20261002220000_feedback_relay_preflight_and_reconciliation.sql'),
      ('function','feedback_email_relay_command(text,text,jsonb)','20261002220000_feedback_relay_preflight_and_reconciliation.sql'),
      ('function','feedback_email_attachment_source_matches(uuid)','20261002230000_feedback_protected_attachment_admission.sql'),
      ('function','custodial_feedback_relay_attachment_internal(text,text,jsonb)','20261002230000_feedback_protected_attachment_admission.sql'),
      ('function','custodial_memphis_schedule_day(date)','20261003000000_memphis_current_schedule_day.sql'),
      ('function','custodial_native_location_utc(timestamp with time zone)','20261003010000_native_location_lifecycle.sql'),
      ('function','custodial_native_location_live(uuid,jsonb,timestamp with time zone)','20261003010000_native_location_lifecycle.sql'),
      ('function','custodial_native_location_target_at(uuid,uuid,timestamp with time zone)','20261003010000_native_location_lifecycle.sql'),
      ('function','custodial_native_location_target(uuid,uuid)','20261003010000_native_location_lifecycle.sql'),
      ('function','custodial_native_location_append_only()','20261003010000_native_location_lifecycle.sql'),
      ('function','custodial_native_location_outcome_at(jsonb,jsonb,timestamp with time zone)','20261003010000_native_location_lifecycle.sql'),
      ('function','custodial_native_location_outcome(jsonb,jsonb)','20261003010000_native_location_lifecycle.sql'),
      ('function','custodial_native_location_outcome_status(jsonb)','20261003010000_native_location_lifecycle.sql'),
      ('function','custodial_native_location_tuple(jsonb)','20261003010000_native_location_lifecycle.sql'),
      ('function','custodial_native_location_inventory_rows(uuid,text,jsonb,timestamp with time zone)','20261003010000_native_location_lifecycle.sql'),
      ('function','custodial_native_location_inventory_at(uuid,text,uuid,text,jsonb,timestamp with time zone)','20261003010000_native_location_lifecycle.sql'),
      ('function','custodial_native_location_inventory(uuid,text,uuid,text,jsonb)','20261003010000_native_location_lifecycle.sql'),
      ('function','place_operational_preview_document(public.custodial_place_operational_previews)','20261003030000_place_operational_name_adoption.sql'),
      ('function','custodial_place_operational_preview(uuid,uuid,date,bigint,jsonb,text)','20261003030000_place_operational_name_adoption.sql'),
      ('function','custodial_place_operational_status(uuid,uuid)','20261003030000_place_operational_name_adoption.sql'),
      ('function','custodial_place_operational_begin(uuid,uuid,uuid)','20261003030000_place_operational_name_adoption.sql'),
      ('function','place_operational_assert_source_use(uuid,uuid,text,text)','20261003030000_place_operational_name_adoption.sql'),
      ('function','place_operational_assert_unchanged_draft(uuid)','20261003030000_place_operational_name_adoption.sql'),
      ('function','custodial_place_operational_finalize(uuid,uuid,uuid,uuid)','20261003030000_place_operational_name_adoption.sql'),
      ('function','place_operational_require_receipt()','20261003030000_place_operational_name_adoption.sql'),
      ('function','place_operational_accepted_record(text,uuid,timestamp with time zone)','20261003030000_place_operational_name_adoption.sql'),
      ('function','place_operational_location_name(uuid,timestamp with time zone)','20261003030000_place_operational_name_adoption.sql'),
      ('function','place_operational_assert_accepted_names(uuid,date)','20261003030000_place_operational_name_adoption.sql'),
      ('function','custodial_native_provider_event_time(jsonb)','20261003050000_native_provider_events.sql'),
      ('function','custodial_native_provider_event_shape(jsonb)','20261003150000_native_provider_interval_protocol.sql'),
      ('function','custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamp with time zone)','20261003150000_native_provider_interval_protocol.sql'),
      ('function','custodial_native_provider_events(uuid,text,uuid,text,jsonb)','20261003150000_native_provider_interval_protocol.sql'),
      ('function','mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)','20261003060000_event_notification_current_projection.sql'),
      ('function','app_event_manager_digest_candidate(uuid,timestamp with time zone)','20261003060000_event_notification_current_projection.sql'),
      ('function','app_event_manager_digest_is_current(jsonb,timestamp with time zone)','20261003060000_event_notification_current_projection.sql'),
      ('function','ops_manager_notification_job_is_current(uuid,uuid,uuid,text)','20261003060000_event_notification_current_projection.sql'),
      ('function','custodial_feedback_triage_version(text,timestamp with time zone)','20261003070000_feedback_triage_receipts.sql'),
      ('function','custodial_feedback_triage_immutable()','20261003070000_feedback_triage_receipts.sql'),
      ('function','custodial_feedback_triage(uuid,uuid,uuid,uuid,text,text)','20261003070000_feedback_triage_receipts.sql'),
      ('function','custodial_native_location_dispatch_status(uuid)','20261003080000_native_location_dispatch_and_ack.sql'),
      ('function','custodial_native_location_dispatch_prepare_at(uuid,uuid,jsonb,timestamp with time zone)','20261003080000_native_location_dispatch_and_ack.sql'),
      ('function','custodial_native_location_dispatch_prepare(uuid,uuid,jsonb)','20261003080000_native_location_dispatch_and_ack.sql'),
      ('function','custodial_native_location_project_ack(uuid,timestamp with time zone)','20261003080000_native_location_dispatch_and_ack.sql'),
      ('function','custodial_completion_taxonomy_immutable()','20261003120000_completion_taxonomy_evidence.sql'),
      ('function','custodial_completion_assert_taxonomy(jsonb)','20261003120000_completion_taxonomy_evidence.sql'),
      ('function','custodial_completion_taxonomy_response_guard()','20261003120000_completion_taxonomy_evidence.sql'),
      ('function','custodial_completion_taxonomy_read(text)','20261003120000_completion_taxonomy_evidence.sql'),
      ('function','custodial_manager_completion_evidence(uuid,text,text)','20261003120000_completion_taxonomy_evidence.sql'),
      ('function','static_weekly_capacity_assert_shape(jsonb)','20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
      ('function','static_weekly_capacity_registered(jsonb)','20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
      ('function','static_weekly_capacity_accepted_slot(uuid,date,uuid)','20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
      ('function','static_weekly_capacity_assert_projection_owner(jsonb,uuid,jsonb)','20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
      ('function','static_weekly_capacity_assert_lunch_party(uuid,jsonb,text)','20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
      ('function','custodial_native_provider_interval_observation(jsonb,boolean)','20261003150000_native_provider_interval_protocol.sql'),
      ('function','custodial_native_provider_observation_order(jsonb,jsonb)','20261003150000_native_provider_interval_protocol.sql'),
      ('function','custodial_native_provider_inventory_clock_at(uuid,text,uuid,text,jsonb,timestamp with time zone,timestamp with time zone)','20261003150000_native_provider_interval_protocol.sql'),
      ('function','custodial_native_provider_inventory_clock(uuid,text,uuid,text,jsonb)','20261003150000_native_provider_interval_protocol.sql'),
      ('function','custodial_native_target_source_at(text,uuid,uuid,uuid,timestamp with time zone)','20261003170000_native_target_source_projection.sql'),
      ('function','custodial_native_target_source(text,uuid,uuid,uuid)','20261003170000_native_target_source_projection.sql'),
      ('function','static_weekly_capacity_source_locks()','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_capacity_source_basis(uuid,uuid,date,bigint)','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_capacity_source_legacy_reference(jsonb,text[])','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_capacity_source_candidate(jsonb,jsonb,date,uuid,uuid)','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_capacity_source_preview_document(public.static_weekly_capacity_source_previews)','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_capacity_source_order_equivalent(jsonb,jsonb)','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_capacity_source_preview(uuid,uuid,date,bigint,jsonb,text,jsonb)','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_capacity_source_status(uuid,uuid)','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_capacity_source_begin(uuid,uuid,uuid)','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_capacity_source_assert_use(uuid,uuid,text,text)','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_capacity_source_assert_unchanged_draft(uuid)','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_capacity_source_finalize(uuid,uuid,uuid,uuid)','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_capacity_source_require_receipt()','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_capacity_source_roster_visible(uuid,uuid)','20261003190000_static_weekly_capacity_current_source_bridge.sql'),
      ('function','static_weekly_coverall_event_brief_candidate(uuid,uuid,integer,uuid,date,uuid,bigint,text,text)','20261003193000_coverall_event_brief_private_reader.sql'),
      ('function','static_weekly_coverall_event_brief_candidates(uuid,uuid,date,uuid,bigint,text,text)','20261003193000_coverall_event_brief_private_reader.sql'),
      ('function','custodial_native_lunch_live(uuid,jsonb,timestamp with time zone)','20261003194000_native_lunch_delivery.sql'),
      ('function','custodial_native_lunch_target_at(uuid,uuid,timestamp with time zone)','20261003194000_native_lunch_delivery.sql'),
      ('function','custodial_native_lunch_target(uuid,uuid)','20261003194000_native_lunch_delivery.sql'),
      ('function','custodial_native_lunch_reserve_at(uuid,uuid,jsonb,timestamp with time zone)','20261003194000_native_lunch_delivery.sql'),
      ('function','custodial_native_lunch_reserve(uuid,uuid,jsonb)','20261003194000_native_lunch_delivery.sql'),
      ('function','custodial_native_lunch_dispatch_status(uuid)','20261003194000_native_lunch_delivery.sql'),
      ('function','custodial_native_lunch_dispatch_prepare_at(uuid,uuid,jsonb,timestamp with time zone)','20261003194000_native_lunch_delivery.sql'),
      ('function','custodial_native_lunch_dispatch_prepare(uuid,uuid,jsonb)','20261003194000_native_lunch_delivery.sql'),
      ('function','custodial_native_lunch_outcome_at(jsonb,jsonb,timestamp with time zone)','20261003194000_native_lunch_delivery.sql'),
      ('function','custodial_native_lunch_outcome(jsonb,jsonb)','20261003194000_native_lunch_delivery.sql'),
      ('function','custodial_native_lunch_outcome_status(jsonb)','20261003194000_native_lunch_delivery.sql')
    ) select * from source_members
      union all select 'grant',identity,source_file from source_members
        where kind in ('function','relation')
  loop
    canonical_identity:=wanted.identity;
    callable:=wanted.kind='function' or (wanted.kind='grant' and position('(' in wanted.identity)>0);
    if callable then
      obj_oid:=to_regprocedure(wanted.identity);
      if obj_oid is null then raise exception 'Current release required function absent: %',wanted.identity;end if;
      -- Grant restore SQL embeds its identity spelling verbatim. Resolve the
      -- captured alias first; a qualified identity and its unqualified alias
      -- name the same function, but are NOT byte-identical restore statements.
      -- Validate EVERY stored alias against its own current serialization,
      -- never recapture drift or select one good alias to hide another bad one.
      select i.object_identity into canonical_identity
        from public.custodial_release_authority_restore_inventory i
        where i.object_kind=wanted.kind
          and case when i.object_kind in ('function','grant') and position('(' in i.object_identity)>0
            then to_regprocedure(i.object_identity) end=obj_oid
        order by (i.object_identity=wanted.identity) desc,i.object_identity limit 1;
      expected_definition:=case when wanted.kind='function' then pg_get_functiondef(obj_oid)
        else public.custodial_release_authority_current_grant_definition(canonical_identity) end;
      if exists(select 1 from public.custodial_release_authority_restore_inventory i
        where i.object_kind=wanted.kind
          and case when i.object_kind in ('function','grant') and position('(' in i.object_identity)>0
            then to_regprocedure(i.object_identity) end=obj_oid
          and (i.definition_sql is distinct from case when wanted.kind='function' then expected_definition
                else public.custodial_release_authority_current_grant_definition(i.object_identity) end
            or i.definition_sha256 is distinct from public.static_weekly_digest_text(
              case when wanted.kind='function' then expected_definition
                else public.custodial_release_authority_current_grant_definition(i.object_identity) end))) then
        raise exception 'Current release required % recovery drift: %',wanted.kind,wanted.identity;
      end if;
    elsif wanted.kind='trigger' then
      select 'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'; '
        ||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' '
        ||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable'
          when 'R' then 'enable replica' when 'A' then 'enable always' end
        ||' trigger '||quote_ident(t.tgname)||';' into expected_definition
        from pg_trigger t join pg_class c on c.oid=t.tgrelid
        join pg_namespace n on n.oid=c.relnamespace
        where wanted.identity=quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'.'||quote_ident(t.tgname)
          and not t.tgisinternal;
    elsif wanted.kind='constraint' then
      expected_definition:=public.custodial_release_authority_current_constraint_definition(wanted.identity);
    elsif to_regclass(wanted.identity) is null then
      raise exception 'Current release required relation absent: %',wanted.identity;
    else
      expected_definition:=case wanted.kind
        when 'relation' then public.custodial_release_authority_current_relation_definition(wanted.identity)
        when 'column_set' then public.custodial_release_authority_current_column_set_definition(wanted.identity)
        when 'relation_state' then public.custodial_release_authority_current_relation_state_definition(wanted.identity)
        when 'grant' then public.custodial_release_authority_current_grant_definition(wanted.identity)
        end;
    end if;
    if canonical_identity is null or not exists(
      select 1 from public.custodial_release_authority_restore_inventory i
      where i.object_kind=wanted.kind and i.object_identity=canonical_identity
        and i.definition_sql=expected_definition
        and i.definition_sha256=public.static_weekly_digest_text(expected_definition)) then
      raise exception 'Current release required recovery membership absent or drifted: % %',wanted.kind,wanted.identity;
    end if;
    if not exists(select 1 from public.custodial_release_canary_authority_surface() s
      where s.object_kind=wanted.kind and
        (s.object_identity=canonical_identity or
          (case when callable and s.object_kind in ('function','grant') and position('(' in s.object_identity)>0
            then to_regprocedure(s.object_identity) end=obj_oid))) then
      additions:=additions||format(E'    (%L,%L,%L),\n',wanted.kind,canonical_identity,
        'current source: '||wanted.source_file);
    end if;
  end loop;
  if additions='' then raise exception 'Current release expected new surface membership absent';end if;
  execute replace(prior_definition,'  values',E'  values\n'||additions);
  next_definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
  if public.custodial_release_authority_current_grant_definition('custodial_release_canary_authority_surface()')
    is distinct from prior_grant then raise exception 'Current release surface ACL changed';end if;
  alter table public.custodial_release_authority_restore_inventory
    disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  update public.custodial_release_authority_restore_inventory
    set definition_sql=next_definition,definition_sha256=public.static_weekly_digest_text(next_definition),
      captured_at=statement_timestamp()
    where object_kind='function'
      and case when object_kind='function' then to_regprocedure(object_identity) end
        ='public.custodial_release_canary_authority_surface()'::regprocedure
      and definition_sql=prior_definition
      and definition_sha256=public.static_weekly_digest_text(prior_definition);
  get diagnostics updated=row_count;
  if updated<>matched then raise exception 'Current release surface recovery update count changed';end if;
  alter table public.custodial_release_authority_restore_inventory
    enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $current_surface$;

commit;
