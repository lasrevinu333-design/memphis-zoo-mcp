
      select distinct on (receipt.location_id)
        receipt.location_id, context.native_completed_at as latest_verified_check_at,
        employee.display_name as latest_verified_checker_name,
        session.session_uuid as latest_verified_check_session_uuid,
        response.client_completion_id as latest_verified_check_completion_id
      from public.custodial_offline_reconciliation_records receipt
      join public.custodial_offline_actor_contexts context on context.context_id=receipt.context_id
      join public.sessions session on session.id=receipt.session_id
      join public.completion_responses response on response.id=receipt.completion_response_id
      join public.employees employee on employee.id=session.employee_id
      where receipt.state='committed' and context.status='committed' and session.status='closed'
        and receipt.occurrence_id=context.occurrence_id
        and receipt.occurrence_fingerprint=context.occurrence_fingerprint
        and receipt.credential_id=context.credential_id
        and receipt.location_id=session.location_id and context.location_id=session.location_id
        and response.location_id=session.location_id and response.session_id=session.id
        and context.client_session_id=session.client_session_id
        and receipt.client_session_id=session.client_session_id
        and receipt.client_completion_id=response.client_completion_id
        and receipt.original_employee_id=session.employee_id and context.employee_id=session.employee_id
        and receipt.device_id=session.device_id and context.device_id=session.device_id
        and response.device_id=session.device_id and response.submitted_by_employee_id=session.employee_id
        and response.response_json->>'work_result'='checked_no_cleaning_needed'
        and response.response_json->'services_performed'='[]'::jsonb
        and receipt.payload_json->'response_json'=response.response_json
        and context.native_start_attestation_version='custodial-native-start.v1'
        and context.native_scan_entry_id is not null
        and context.native_completion_attestation_version='custodial-native-completion.v2'
        and context.native_completion_attestation_sha256 ~ '^[0-9a-f]{64}$'
        and context.native_finish_scan_entry_id is not null
        and context.native_finish_scan_entry_id<>context.native_scan_entry_id
        and context.started_at=session.started_at and context.native_completed_at=session.ended_at
        and context.native_completed_at>context.started_at
        and context.native_completed_at>=public.operational_day_start(now())
        and context.native_completed_at<=now() and isfinite(context.native_completed_at)
        and exists (
          select 1 from public.custodial_offline_scan_event_evidence evidence
          where evidence.context_id=context.context_id
            and evidence.reconciliation_id=receipt.reconciliation_id
            and evidence.session_id=session.id
            and lower(evidence.client_event_id)=context.native_finish_scan_entry_id::text
            and evidence.event_payload->>'event_type'='scan_finish'
            and evidence.event_payload->>'result'='ok'
            and evidence.event_payload#>>'{payload_json,entry_source}'='native-nfc'
            and evidence.event_payload->>'scanned_at'=
              public.custodial_canonical_utc_millis(context.native_completed_at)
        )
      order by receipt.location_id, context.native_completed_at desc, receipt.reconciliation_id desc
