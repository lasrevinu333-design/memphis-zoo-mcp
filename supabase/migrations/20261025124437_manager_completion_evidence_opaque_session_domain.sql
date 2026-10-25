-- NEW prospective forward Source: after original291 and separately pending292.
-- Same RPC identity/permissions; only its opaque-session maximum changes128 to200.
-- Original291 bytes are immutable. This file has NOT been executed or adopted.
BEGIN;
SET LOCAL search_path=pg_catalog,public,extensions;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE manager_evidence_domain_proc_before ON COMMIT DROP AS
 SELECT p.oid,to_jsonb(p) AS full_row FROM pg_proc p
 WHERE p.oid='public.custodial_manager_completion_evidence(uuid,text,text)'::regprocedure;
CREATE TEMP TABLE manager_evidence_domain_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $before$
DECLARE actual_source text;target_count integer;
BEGIN
 SELECT p.prosrc INTO STRICT actual_source FROM pg_proc p
 WHERE p.oid='public.custodial_manager_completion_evidence(uuid,text,text)'::regprocedure;
 IF actual_source IS DISTINCT FROM $original_prosrc$
declare s public.sessions%rowtype; r public.completion_responses%rowtype;
 v_catalog jsonb; v_digest text; v_native boolean:=false;
 v_issue boolean; v_issue_known boolean:=false; v_work text; v_class text; v_raw_issue_count integer:=0;
 v_open integer:=0; v_work_order integer:=0; v_fixed integer:=0; v_legacy_closed integer:=0; v_total integer:=0;
 v_tickets jsonb:='[]'::jsonb; v_follow_up text;
begin
 perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
 if p_manager_id is null or p_session_uuid is null or length(p_session_uuid)=0 or length(p_session_uuid)>128
   or not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id
    and m.active=true and m.revoked_at is null and m.is_system_principal=false
    and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]) then
  raise exception using errcode='42501',message='active named manager authority is required';
 end if;
 select * into s from public.sessions where session_uuid=p_session_uuid;
 if not found then raise exception using errcode='P0002',message='cleaning session was not found'; end if;
 select * into r from public.completion_responses where session_id=s.id;
 if not found then
  return jsonb_build_object('session_id',s.id,'session_uuid',s.session_uuid,
   'location_id',s.location_id,'employee_id',s.employee_id,'device_id',s.device_id,
   'started_at',s.started_at,'ended_at',s.ended_at,
   'session_status',s.status,'completion_recorded',false,'classification','no_completion_record',
   'inspection_evaluation','not_performed_by_this_reader');
 end if;
 select c.catalog_json,c.catalog_sha256 into v_catalog,v_digest from public.custodial_completion_taxonomy_versions c
  where c.version=r.response_json#>>'{taxonomy,version}';
 select exists(
  select 1 from public.custodial_offline_reconciliation_records receipt
  join public.custodial_offline_actor_contexts context on context.context_id=receipt.context_id
  where receipt.completion_response_id=r.id and receipt.session_id=s.id
   and receipt.state='committed' and context.status='committed' and s.status='closed'
   and receipt.occurrence_id=context.occurrence_id and receipt.occurrence_fingerprint=context.occurrence_fingerprint
   and receipt.credential_id=context.credential_id and receipt.location_id=s.location_id
   and context.location_id=s.location_id and r.location_id=s.location_id
   and context.client_session_id=s.client_session_id and receipt.client_session_id=s.client_session_id
   and receipt.client_completion_id=r.client_completion_id and receipt.original_employee_id=s.employee_id
   and context.employee_id=s.employee_id and receipt.device_id=s.device_id and context.device_id=s.device_id
   and r.device_id=s.device_id and r.submitted_by_employee_id=s.employee_id
   and receipt.payload_json->'response_json'=r.response_json
   and context.native_start_attestation_version='custodial-native-start.v1'
   and context.native_scan_entry_id is not null
   and context.native_completion_attestation_version='custodial-native-completion.v2'
   and context.native_completion_attestation_sha256 ~ '^[0-9a-f]{64}$'
   and context.native_finish_scan_entry_id is not null
   and context.native_finish_scan_entry_id<>context.native_scan_entry_id
   and context.started_at=s.started_at and context.native_completed_at=s.ended_at
   and context.native_completed_at>context.started_at and context.native_completed_at<=statement_timestamp()
   and exists(select 1 from public.custodial_offline_scan_event_evidence evidence
    where evidence.context_id=context.context_id and evidence.reconciliation_id=receipt.reconciliation_id
      and evidence.session_id=s.id and lower(evidence.client_event_id)=context.native_finish_scan_entry_id::text
      and evidence.event_payload->>'event_type'='scan_finish'
      and evidence.event_payload->>'result'='ok'
      and evidence.event_payload#>>'{payload_json,entry_source}'='native-nfc'
      and evidence.event_payload->>'scanned_at'=public.custodial_canonical_utc_millis(context.native_completed_at))
 ) into v_native;
 select count(*),count(*) filter(where t.status='open'),
  count(*) filter(where t.resolution_outcome='work_order_sent'),
  count(*) filter(where t.resolution_outcome='mark_fixed'),
  count(*) filter(where t.status='closed' and t.resolution_outcome is null),
  coalesce(jsonb_agg(jsonb_build_object('ticket_id',t.id,'status',t.status,
   'resolution_outcome',t.resolution_outcome,'external_work_order_reference',t.external_work_order_reference,
   'resolution_actor_manager_id',t.resolution_actor_manager_id,'closed_at',t.closed_at,
   'issue_summary',t.issue_summary) order by t.reported_at,t.id) filter(where t.id is not null),'[]'::jsonb)
 into v_total,v_open,v_work_order,v_fixed,v_legacy_closed,v_tickets
 from public.maintenance_tickets t where t.completion_response_id=r.id and t.issue_source='completion_form';
 if jsonb_typeof(r.response_json->'attention_needed')='boolean' then
  v_issue_known:=true; v_issue:=(r.response_json->>'attention_needed')::boolean;
 end if;
 if jsonb_typeof(r.response_json->'maintenance_issues_found')='array' then
  v_raw_issue_count:=jsonb_array_length(r.response_json->'maintenance_issues_found');
 end if;
 if v_raw_issue_count=0 and (lower(coalesce(r.response_json->>'out_of_order_signed','')) in ('yes','true')
    or nullif(btrim(coalesce(r.response_json->>'out_of_order_details','')),'') is not null) then
  v_raw_issue_count:=1;
 end if;
 if v_total>0 or v_raw_issue_count>0
    or lower(coalesce(r.response_json->>'out_of_order_signed','')) in ('yes','true')
    or nullif(btrim(coalesce(r.response_json->>'out_of_order_details','')),'') is not null then
  v_issue_known:=true; v_issue:=true;
 end if;
 v_work:=r.response_json->>'work_result';
 if not v_issue_known then v_follow_up:='unknown';
 elsif not v_issue then v_follow_up:='none_reported';
 elsif v_total>0 and v_fixed=v_total and v_raw_issue_count>0 and v_total>=v_raw_issue_count
  then v_follow_up:='linked_tickets_marked_fixed_coverage_unverified';
 else v_follow_up:='required_or_unresolved';
 end if;
 if not v_native then v_class:='historical_or_unverified_completion';
 elsif v_work='checked_no_cleaning_needed' then v_class:='checked_only';
 elsif v_work not in ('full','details') or v_work is null then v_class:='unknown';
 elsif v_follow_up='none_reported' then v_class:='cleaned_no_issues_reported';
 elsif v_follow_up='linked_tickets_marked_fixed_coverage_unverified'
  then v_class:='cleaned_linked_tickets_marked_fixed_coverage_unverified';
 elsif v_follow_up='required_or_unresolved' then v_class:='cleaned_follow_up_required';
 else v_class:='cleaned_issue_state_unknown';
 end if;
 return jsonb_build_object('session_id',s.id,'session_uuid',s.session_uuid,'session_status',s.status,
  'location_id',s.location_id,'employee_id',s.employee_id,'device_id',s.device_id,
  'started_at',s.started_at,'ended_at',s.ended_at,
  'completion_recorded',true,'completion_response_id',r.id,'client_completion_id',r.client_completion_id,
  'submitted_at',r.submitted_at,'original_response',r.response_json,
  'taxonomy_version',r.response_json#>>'{taxonomy,version}',
  'taxonomy_digest',r.response_json#>>'{taxonomy,digest}',
  'taxonomy_status',case when not (r.response_json ? 'taxonomy') then 'unversioned_historical_or_protected_draft'
   when v_catalog is null or v_digest is distinct from r.response_json#>>'{taxonomy,digest}' then 'metadata_unverified_legacy'
   else 'versioned_current_catalog' end,
  'catalog_digest',v_digest,'catalog',v_catalog,
  'native_exact_receipt_admitted',v_native,'work_result',v_work,'issue_reported',case when v_issue_known then to_jsonb(v_issue) else 'null'::jsonb end,
  'linked_completion_tickets',v_tickets,'linked_ticket_count',v_total,'linked_open_count',v_open,
  'linked_work_order_sent_count',v_work_order,'linked_mark_fixed_count',v_fixed,
  'linked_legacy_closed_unknown_count',v_legacy_closed,'raw_reported_issue_count',v_raw_issue_count,
  'linked_issue_count_shortfall',greatest(v_raw_issue_count-v_total,0),'follow_up',v_follow_up,
  'classification',v_class,'inspection_evaluation','not_performed_by_this_reader');
end $original_prosrc$ THEN
  RAISE EXCEPTION 'manager evidence exact original128 Source changed'; END IF;
 IF (SELECT count(*) FROM manager_evidence_domain_proc_before)<>1
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND NOT tgisinternal AND tgenabled='A')
 OR EXISTS(SELECT 1 FROM manager_evidence_domain_inventory_before
  WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql)) THEN
  RAISE EXCEPTION 'manager evidence recovery predecessor changed'; END IF;
 SELECT count(*) INTO target_count FROM manager_evidence_domain_inventory_before
 WHERE object_kind='function' AND object_identity LIKE '%(%'
  AND to_regprocedure(object_identity)='public.custodial_manager_completion_evidence(uuid,text,text)'::regprocedure;
 IF target_count<>1 OR EXISTS(SELECT 1 FROM manager_evidence_domain_inventory_before
  WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_manager_completion_evidence(uuid,text,text)'::regprocedure
   AND definition_sql IS DISTINCT FROM pg_get_functiondef('public.custodial_manager_completion_evidence(uuid,text,text)'::regprocedure)) THEN
  RAISE EXCEPTION 'manager evidence one exact existing recovery slot required'; END IF;
 IF NOT has_function_privilege('service_role','public.custodial_manager_completion_evidence(uuid,text,text)','EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public.custodial_manager_completion_evidence(uuid,text,text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE')
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']) AS role_names(role_name)
  WHERE has_function_privilege(role_name,'public.custodial_manager_completion_evidence(uuid,text,text)','EXECUTE')) THEN
  RAISE EXCEPTION 'manager evidence original explicit access boundary changed'; END IF;
END $before$;
create or replace function public.custodial_manager_completion_evidence(
 p_manager_id uuid,p_session_uuid text,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare s public.sessions%rowtype; r public.completion_responses%rowtype;
 v_catalog jsonb; v_digest text; v_native boolean:=false;
 v_issue boolean; v_issue_known boolean:=false; v_work text; v_class text; v_raw_issue_count integer:=0;
 v_open integer:=0; v_work_order integer:=0; v_fixed integer:=0; v_legacy_closed integer:=0; v_total integer:=0;
 v_tickets jsonb:='[]'::jsonb; v_follow_up text;
begin
 perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
 if p_manager_id is null or p_session_uuid is null or length(p_session_uuid)=0 or length(p_session_uuid)>200
   or not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id
    and m.active=true and m.revoked_at is null and m.is_system_principal=false
    and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]) then
  raise exception using errcode='42501',message='active named manager authority is required';
 end if;
 select * into s from public.sessions where session_uuid=p_session_uuid;
 if not found then raise exception using errcode='P0002',message='cleaning session was not found'; end if;
 select * into r from public.completion_responses where session_id=s.id;
 if not found then
  return jsonb_build_object('session_id',s.id,'session_uuid',s.session_uuid,
   'location_id',s.location_id,'employee_id',s.employee_id,'device_id',s.device_id,
   'started_at',s.started_at,'ended_at',s.ended_at,
   'session_status',s.status,'completion_recorded',false,'classification','no_completion_record',
   'inspection_evaluation','not_performed_by_this_reader');
 end if;
 select c.catalog_json,c.catalog_sha256 into v_catalog,v_digest from public.custodial_completion_taxonomy_versions c
  where c.version=r.response_json#>>'{taxonomy,version}';
 select exists(
  select 1 from public.custodial_offline_reconciliation_records receipt
  join public.custodial_offline_actor_contexts context on context.context_id=receipt.context_id
  where receipt.completion_response_id=r.id and receipt.session_id=s.id
   and receipt.state='committed' and context.status='committed' and s.status='closed'
   and receipt.occurrence_id=context.occurrence_id and receipt.occurrence_fingerprint=context.occurrence_fingerprint
   and receipt.credential_id=context.credential_id and receipt.location_id=s.location_id
   and context.location_id=s.location_id and r.location_id=s.location_id
   and context.client_session_id=s.client_session_id and receipt.client_session_id=s.client_session_id
   and receipt.client_completion_id=r.client_completion_id and receipt.original_employee_id=s.employee_id
   and context.employee_id=s.employee_id and receipt.device_id=s.device_id and context.device_id=s.device_id
   and r.device_id=s.device_id and r.submitted_by_employee_id=s.employee_id
   and receipt.payload_json->'response_json'=r.response_json
   and context.native_start_attestation_version='custodial-native-start.v1'
   and context.native_scan_entry_id is not null
   and context.native_completion_attestation_version='custodial-native-completion.v2'
   and context.native_completion_attestation_sha256 ~ '^[0-9a-f]{64}$'
   and context.native_finish_scan_entry_id is not null
   and context.native_finish_scan_entry_id<>context.native_scan_entry_id
   and context.started_at=s.started_at and context.native_completed_at=s.ended_at
   and context.native_completed_at>context.started_at and context.native_completed_at<=statement_timestamp()
   and exists(select 1 from public.custodial_offline_scan_event_evidence evidence
    where evidence.context_id=context.context_id and evidence.reconciliation_id=receipt.reconciliation_id
      and evidence.session_id=s.id and lower(evidence.client_event_id)=context.native_finish_scan_entry_id::text
      and evidence.event_payload->>'event_type'='scan_finish'
      and evidence.event_payload->>'result'='ok'
      and evidence.event_payload#>>'{payload_json,entry_source}'='native-nfc'
      and evidence.event_payload->>'scanned_at'=public.custodial_canonical_utc_millis(context.native_completed_at))
 ) into v_native;
 select count(*),count(*) filter(where t.status='open'),
  count(*) filter(where t.resolution_outcome='work_order_sent'),
  count(*) filter(where t.resolution_outcome='mark_fixed'),
  count(*) filter(where t.status='closed' and t.resolution_outcome is null),
  coalesce(jsonb_agg(jsonb_build_object('ticket_id',t.id,'status',t.status,
   'resolution_outcome',t.resolution_outcome,'external_work_order_reference',t.external_work_order_reference,
   'resolution_actor_manager_id',t.resolution_actor_manager_id,'closed_at',t.closed_at,
   'issue_summary',t.issue_summary) order by t.reported_at,t.id) filter(where t.id is not null),'[]'::jsonb)
 into v_total,v_open,v_work_order,v_fixed,v_legacy_closed,v_tickets
 from public.maintenance_tickets t where t.completion_response_id=r.id and t.issue_source='completion_form';
 if jsonb_typeof(r.response_json->'attention_needed')='boolean' then
  v_issue_known:=true; v_issue:=(r.response_json->>'attention_needed')::boolean;
 end if;
 if jsonb_typeof(r.response_json->'maintenance_issues_found')='array' then
  v_raw_issue_count:=jsonb_array_length(r.response_json->'maintenance_issues_found');
 end if;
 if v_raw_issue_count=0 and (lower(coalesce(r.response_json->>'out_of_order_signed','')) in ('yes','true')
    or nullif(btrim(coalesce(r.response_json->>'out_of_order_details','')),'') is not null) then
  v_raw_issue_count:=1;
 end if;
 if v_total>0 or v_raw_issue_count>0
    or lower(coalesce(r.response_json->>'out_of_order_signed','')) in ('yes','true')
    or nullif(btrim(coalesce(r.response_json->>'out_of_order_details','')),'') is not null then
  v_issue_known:=true; v_issue:=true;
 end if;
 v_work:=r.response_json->>'work_result';
 if not v_issue_known then v_follow_up:='unknown';
 elsif not v_issue then v_follow_up:='none_reported';
 elsif v_total>0 and v_fixed=v_total and v_raw_issue_count>0 and v_total>=v_raw_issue_count
  then v_follow_up:='linked_tickets_marked_fixed_coverage_unverified';
 else v_follow_up:='required_or_unresolved';
 end if;
 if not v_native then v_class:='historical_or_unverified_completion';
 elsif v_work='checked_no_cleaning_needed' then v_class:='checked_only';
 elsif v_work not in ('full','details') or v_work is null then v_class:='unknown';
 elsif v_follow_up='none_reported' then v_class:='cleaned_no_issues_reported';
 elsif v_follow_up='linked_tickets_marked_fixed_coverage_unverified'
  then v_class:='cleaned_linked_tickets_marked_fixed_coverage_unverified';
 elsif v_follow_up='required_or_unresolved' then v_class:='cleaned_follow_up_required';
 else v_class:='cleaned_issue_state_unknown';
 end if;
 return jsonb_build_object('session_id',s.id,'session_uuid',s.session_uuid,'session_status',s.status,
  'location_id',s.location_id,'employee_id',s.employee_id,'device_id',s.device_id,
  'started_at',s.started_at,'ended_at',s.ended_at,
  'completion_recorded',true,'completion_response_id',r.id,'client_completion_id',r.client_completion_id,
  'submitted_at',r.submitted_at,'original_response',r.response_json,
  'taxonomy_version',r.response_json#>>'{taxonomy,version}',
  'taxonomy_digest',r.response_json#>>'{taxonomy,digest}',
  'taxonomy_status',case when not (r.response_json ? 'taxonomy') then 'unversioned_historical_or_protected_draft'
   when v_catalog is null or v_digest is distinct from r.response_json#>>'{taxonomy,digest}' then 'metadata_unverified_legacy'
   else 'versioned_current_catalog' end,
  'catalog_digest',v_digest,'catalog',v_catalog,
  'native_exact_receipt_admitted',v_native,'work_result',v_work,'issue_reported',case when v_issue_known then to_jsonb(v_issue) else 'null'::jsonb end,
  'linked_completion_tickets',v_tickets,'linked_ticket_count',v_total,'linked_open_count',v_open,
  'linked_work_order_sent_count',v_work_order,'linked_mark_fixed_count',v_fixed,
  'linked_legacy_closed_unknown_count',v_legacy_closed,'raw_reported_issue_count',v_raw_issue_count,
  'linked_issue_count_shortfall',greatest(v_raw_issue_count-v_total,0),'follow_up',v_follow_up,
  'classification',v_class,'inspection_evaluation','not_performed_by_this_reader');
end $fn$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$
DECLARE affected integer;
BEGIN
 UPDATE public.custodial_release_authority_restore_inventory
 SET definition_sql=pg_get_functiondef('public.custodial_manager_completion_evidence(uuid,text,text)'::regprocedure),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_manager_completion_evidence(uuid,text,text)'::regprocedure)),
  captured_at=statement_timestamp()
 WHERE object_kind='function' AND object_identity LIKE '%(%'
  AND to_regprocedure(object_identity)='public.custodial_manager_completion_evidence(uuid,text,text)'::regprocedure;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'manager evidence recovery slot cardinality changed'; END IF;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $after$
DECLARE actual_source text;
BEGIN
 SELECT p.prosrc INTO STRICT actual_source FROM pg_proc p
 WHERE p.oid='public.custodial_manager_completion_evidence(uuid,text,text)'::regprocedure;
 IF actual_source IS DISTINCT FROM $new_prosrc$
declare s public.sessions%rowtype; r public.completion_responses%rowtype;
 v_catalog jsonb; v_digest text; v_native boolean:=false;
 v_issue boolean; v_issue_known boolean:=false; v_work text; v_class text; v_raw_issue_count integer:=0;
 v_open integer:=0; v_work_order integer:=0; v_fixed integer:=0; v_legacy_closed integer:=0; v_total integer:=0;
 v_tickets jsonb:='[]'::jsonb; v_follow_up text;
begin
 perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
 if p_manager_id is null or p_session_uuid is null or length(p_session_uuid)=0 or length(p_session_uuid)>200
   or not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id
    and m.active=true and m.revoked_at is null and m.is_system_principal=false
    and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]) then
  raise exception using errcode='42501',message='active named manager authority is required';
 end if;
 select * into s from public.sessions where session_uuid=p_session_uuid;
 if not found then raise exception using errcode='P0002',message='cleaning session was not found'; end if;
 select * into r from public.completion_responses where session_id=s.id;
 if not found then
  return jsonb_build_object('session_id',s.id,'session_uuid',s.session_uuid,
   'location_id',s.location_id,'employee_id',s.employee_id,'device_id',s.device_id,
   'started_at',s.started_at,'ended_at',s.ended_at,
   'session_status',s.status,'completion_recorded',false,'classification','no_completion_record',
   'inspection_evaluation','not_performed_by_this_reader');
 end if;
 select c.catalog_json,c.catalog_sha256 into v_catalog,v_digest from public.custodial_completion_taxonomy_versions c
  where c.version=r.response_json#>>'{taxonomy,version}';
 select exists(
  select 1 from public.custodial_offline_reconciliation_records receipt
  join public.custodial_offline_actor_contexts context on context.context_id=receipt.context_id
  where receipt.completion_response_id=r.id and receipt.session_id=s.id
   and receipt.state='committed' and context.status='committed' and s.status='closed'
   and receipt.occurrence_id=context.occurrence_id and receipt.occurrence_fingerprint=context.occurrence_fingerprint
   and receipt.credential_id=context.credential_id and receipt.location_id=s.location_id
   and context.location_id=s.location_id and r.location_id=s.location_id
   and context.client_session_id=s.client_session_id and receipt.client_session_id=s.client_session_id
   and receipt.client_completion_id=r.client_completion_id and receipt.original_employee_id=s.employee_id
   and context.employee_id=s.employee_id and receipt.device_id=s.device_id and context.device_id=s.device_id
   and r.device_id=s.device_id and r.submitted_by_employee_id=s.employee_id
   and receipt.payload_json->'response_json'=r.response_json
   and context.native_start_attestation_version='custodial-native-start.v1'
   and context.native_scan_entry_id is not null
   and context.native_completion_attestation_version='custodial-native-completion.v2'
   and context.native_completion_attestation_sha256 ~ '^[0-9a-f]{64}$'
   and context.native_finish_scan_entry_id is not null
   and context.native_finish_scan_entry_id<>context.native_scan_entry_id
   and context.started_at=s.started_at and context.native_completed_at=s.ended_at
   and context.native_completed_at>context.started_at and context.native_completed_at<=statement_timestamp()
   and exists(select 1 from public.custodial_offline_scan_event_evidence evidence
    where evidence.context_id=context.context_id and evidence.reconciliation_id=receipt.reconciliation_id
      and evidence.session_id=s.id and lower(evidence.client_event_id)=context.native_finish_scan_entry_id::text
      and evidence.event_payload->>'event_type'='scan_finish'
      and evidence.event_payload->>'result'='ok'
      and evidence.event_payload#>>'{payload_json,entry_source}'='native-nfc'
      and evidence.event_payload->>'scanned_at'=public.custodial_canonical_utc_millis(context.native_completed_at))
 ) into v_native;
 select count(*),count(*) filter(where t.status='open'),
  count(*) filter(where t.resolution_outcome='work_order_sent'),
  count(*) filter(where t.resolution_outcome='mark_fixed'),
  count(*) filter(where t.status='closed' and t.resolution_outcome is null),
  coalesce(jsonb_agg(jsonb_build_object('ticket_id',t.id,'status',t.status,
   'resolution_outcome',t.resolution_outcome,'external_work_order_reference',t.external_work_order_reference,
   'resolution_actor_manager_id',t.resolution_actor_manager_id,'closed_at',t.closed_at,
   'issue_summary',t.issue_summary) order by t.reported_at,t.id) filter(where t.id is not null),'[]'::jsonb)
 into v_total,v_open,v_work_order,v_fixed,v_legacy_closed,v_tickets
 from public.maintenance_tickets t where t.completion_response_id=r.id and t.issue_source='completion_form';
 if jsonb_typeof(r.response_json->'attention_needed')='boolean' then
  v_issue_known:=true; v_issue:=(r.response_json->>'attention_needed')::boolean;
 end if;
 if jsonb_typeof(r.response_json->'maintenance_issues_found')='array' then
  v_raw_issue_count:=jsonb_array_length(r.response_json->'maintenance_issues_found');
 end if;
 if v_raw_issue_count=0 and (lower(coalesce(r.response_json->>'out_of_order_signed','')) in ('yes','true')
    or nullif(btrim(coalesce(r.response_json->>'out_of_order_details','')),'') is not null) then
  v_raw_issue_count:=1;
 end if;
 if v_total>0 or v_raw_issue_count>0
    or lower(coalesce(r.response_json->>'out_of_order_signed','')) in ('yes','true')
    or nullif(btrim(coalesce(r.response_json->>'out_of_order_details','')),'') is not null then
  v_issue_known:=true; v_issue:=true;
 end if;
 v_work:=r.response_json->>'work_result';
 if not v_issue_known then v_follow_up:='unknown';
 elsif not v_issue then v_follow_up:='none_reported';
 elsif v_total>0 and v_fixed=v_total and v_raw_issue_count>0 and v_total>=v_raw_issue_count
  then v_follow_up:='linked_tickets_marked_fixed_coverage_unverified';
 else v_follow_up:='required_or_unresolved';
 end if;
 if not v_native then v_class:='historical_or_unverified_completion';
 elsif v_work='checked_no_cleaning_needed' then v_class:='checked_only';
 elsif v_work not in ('full','details') or v_work is null then v_class:='unknown';
 elsif v_follow_up='none_reported' then v_class:='cleaned_no_issues_reported';
 elsif v_follow_up='linked_tickets_marked_fixed_coverage_unverified'
  then v_class:='cleaned_linked_tickets_marked_fixed_coverage_unverified';
 elsif v_follow_up='required_or_unresolved' then v_class:='cleaned_follow_up_required';
 else v_class:='cleaned_issue_state_unknown';
 end if;
 return jsonb_build_object('session_id',s.id,'session_uuid',s.session_uuid,'session_status',s.status,
  'location_id',s.location_id,'employee_id',s.employee_id,'device_id',s.device_id,
  'started_at',s.started_at,'ended_at',s.ended_at,
  'completion_recorded',true,'completion_response_id',r.id,'client_completion_id',r.client_completion_id,
  'submitted_at',r.submitted_at,'original_response',r.response_json,
  'taxonomy_version',r.response_json#>>'{taxonomy,version}',
  'taxonomy_digest',r.response_json#>>'{taxonomy,digest}',
  'taxonomy_status',case when not (r.response_json ? 'taxonomy') then 'unversioned_historical_or_protected_draft'
   when v_catalog is null or v_digest is distinct from r.response_json#>>'{taxonomy,digest}' then 'metadata_unverified_legacy'
   else 'versioned_current_catalog' end,
  'catalog_digest',v_digest,'catalog',v_catalog,
  'native_exact_receipt_admitted',v_native,'work_result',v_work,'issue_reported',case when v_issue_known then to_jsonb(v_issue) else 'null'::jsonb end,
  'linked_completion_tickets',v_tickets,'linked_ticket_count',v_total,'linked_open_count',v_open,
  'linked_work_order_sent_count',v_work_order,'linked_mark_fixed_count',v_fixed,
  'linked_legacy_closed_unknown_count',v_legacy_closed,'raw_reported_issue_count',v_raw_issue_count,
  'linked_issue_count_shortfall',greatest(v_raw_issue_count-v_total,0),'follow_up',v_follow_up,
  'classification',v_class,'inspection_evaluation','not_performed_by_this_reader');
end $new_prosrc$ THEN
  RAISE EXCEPTION 'manager evidence exact200 Source not installed'; END IF;
 IF (SELECT oid FROM manager_evidence_domain_proc_before) IS DISTINCT FROM 'public.custodial_manager_completion_evidence(uuid,text,text)'::regprocedure::oid
 OR EXISTS(SELECT 1 FROM manager_evidence_domain_proc_before old LEFT JOIN pg_proc now ON now.oid=old.oid
  WHERE (old.full_row-'prosrc') IS DISTINCT FROM (to_jsonb(now)-'prosrc')) THEN
  RAISE EXCEPTION 'manager evidence OID ownership permissions properties changed'; END IF;
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM manager_evidence_domain_inventory_before)
 OR EXISTS(SELECT 1 FROM manager_evidence_domain_inventory_before old FULL JOIN public.custodial_release_authority_restore_inventory now USING(inventory_id)
  WHERE CASE WHEN old.object_kind='function' AND old.object_identity LIKE '%(%'
    AND to_regprocedure(old.object_identity)='public.custodial_manager_completion_evidence(uuid,text,text)'::regprocedure
   THEN (to_jsonb(old)-ARRAY['definition_sql','definition_sha256','captured_at']) IS DISTINCT FROM (to_jsonb(now)-ARRAY['definition_sql','definition_sha256','captured_at'])
   ELSE to_jsonb(old) IS DISTINCT FROM to_jsonb(now) END)
 OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory
  WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND NOT tgisinternal AND tgenabled='A') THEN
  RAISE EXCEPTION 'manager evidence inventory identity unrelated rows or immutability changed'; END IF;
END $after$;
COMMIT;
