-- Ordinary cleaning notes are not maintenance reports.  Earlier compatibility
-- logic treated any top-level `notes` value as an implicit issue and created a
-- false OPEN ticket.  Preserve generic notes as context only when an explicit
-- maintenance signal is present.
create or replace function public.create_maintenance_tickets_from_response(
  p_completion_response_id uuid,
  p_session_id uuid,
  p_location_id uuid,
  p_reported_by_employee_id uuid,
  p_device_id uuid,
  p_reported_at timestamptz,
  p_response_json jsonb
) returns integer
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_issue_array jsonb;
  v_item jsonb;
  v_issue_summary text;
  v_issue_category text;
  v_fixture_type text;
  v_fixture_identifier text;
  v_out_of_order boolean;
  v_location_code text;
  v_location_name text;
  v_reporter_name text;
  v_count integer := 0;
  v_top_level_out_of_order boolean := (
    lower(coalesce(
      p_response_json->>'out_of_order',
      p_response_json->>'outOfOrder',
      p_response_json->>'place_out_of_order',
      p_response_json->>'placeOutOfOrder',
      p_response_json->>'out_of_order_signed',
      p_response_json->>'outOfOrderSigned',
      'false'
    )) in ('true','t','1','yes','y','on')
  );
  v_top_level_fixture_identifier text := coalesce(
    p_response_json->>'fixture_identifier',
    p_response_json->>'fixtureIdentifier',
    p_response_json->>'out_of_order_details',
    p_response_json->>'outOfOrderDetails',
    p_response_json->>'stall',
    p_response_json->>'stall_number',
    p_response_json->>'stallNumber',
    p_response_json->>'urinal',
    p_response_json->>'urinal_number',
    p_response_json->>'urinalNumber'
  );
  v_explicit_issue_notes text := coalesce(
    p_response_json->>'maintenance_notes',
    p_response_json->>'maintenanceNotes',
    p_response_json->>'issue_notes',
    p_response_json->>'issueNotes'
  );
  v_top_level_notes text := coalesce(
    v_explicit_issue_notes,
    p_response_json->>'notes',
    p_response_json->>'note'
  );
  v_has_explicit_issue boolean := (
    lower(coalesce(
      p_response_json->>'has_maintenance_issue',
      p_response_json->>'hasMaintenanceIssue',
      p_response_json->>'maintenance_issue',
      p_response_json->>'maintenanceIssue',
      'false'
    )) in ('true','t','1','yes','y','on')
  );
begin
  select l.location_code, l.location_name
    into v_location_code, v_location_name
  from public.locations l
  where l.id = p_location_id
  limit 1;

  select e.display_name
    into v_reporter_name
  from public.employees e
  where e.id = p_reported_by_employee_id
  limit 1;

  delete from public.maintenance_tickets mt
  where mt.completion_response_id = p_completion_response_id
    and mt.issue_source = 'completion_form'
    and mt.status = 'open';

  v_issue_array := case
    when jsonb_typeof(p_response_json->'maintenance_issues') = 'array' then p_response_json->'maintenance_issues'
    when jsonb_typeof(p_response_json->'maintenanceIssues') = 'array' then p_response_json->'maintenanceIssues'
    when jsonb_typeof(p_response_json->'maintenance_issue_checks') = 'array' then p_response_json->'maintenance_issue_checks'
    when jsonb_typeof(p_response_json->'maintenanceIssueChecks') = 'array' then p_response_json->'maintenanceIssueChecks'
    when jsonb_typeof(p_response_json->'checked_maintenance_issues') = 'array' then p_response_json->'checked_maintenance_issues'
    when jsonb_typeof(p_response_json->'checkedMaintenanceIssues') = 'array' then p_response_json->'checkedMaintenanceIssues'
    when jsonb_typeof(p_response_json->'maintenance_issues_found') = 'array' then p_response_json->'maintenance_issues_found'
    when jsonb_typeof(p_response_json->'maintenanceIssuesFound') = 'array' then p_response_json->'maintenanceIssuesFound'
    when jsonb_typeof(p_response_json->'maintenance_issue_found') = 'array' then p_response_json->'maintenance_issue_found'
    when jsonb_typeof(p_response_json->'issues') = 'array' then p_response_json->'issues'
    when jsonb_typeof(p_response_json->'maintenance') = 'array' then p_response_json->'maintenance'
    else null
  end;

  if v_issue_array is null
     and (v_has_explicit_issue or v_explicit_issue_notes is not null or v_top_level_out_of_order) then
    v_issue_array := jsonb_build_array(
      jsonb_build_object(
        'label', coalesce(v_explicit_issue_notes, v_top_level_notes, 'Maintenance issue reported'),
        'fixture_identifier', v_top_level_fixture_identifier,
        'out_of_order', v_top_level_out_of_order,
        'raw_response', p_response_json
      )
    );
  end if;

  if v_issue_array is null or jsonb_array_length(v_issue_array) = 0 then
    return 0;
  end if;

  for v_item in select value from jsonb_array_elements(v_issue_array)
  loop
    if jsonb_typeof(v_item) = 'string' then
      v_issue_summary := trim(both '"' from v_item::text);
      if lower(v_issue_summary) in ('other maintenance issue found', 'other') and v_top_level_notes is not null then
        v_issue_summary := 'Other maintenance issue: ' || v_top_level_notes;
      end if;
      v_issue_category := trim(both '"' from v_item::text);
      v_fixture_type := case
        when lower(v_issue_summary) like '%toilet%' then 'toilet'
        when lower(v_issue_summary) like '%urinal%' then 'urinal'
        else null
      end;
      v_fixture_identifier := v_top_level_fixture_identifier;
      v_out_of_order := v_top_level_out_of_order;
    else
      v_issue_summary := coalesce(
        v_item->>'label', v_item->>'issue', v_item->>'issue_label',
        v_item->>'issueLabel', v_item->>'name', v_item->>'value',
        v_item->>'description', v_item->>'maintenance_issue',
        v_item->>'maintenanceIssue', 'Maintenance issue reported'
      );
      if lower(v_issue_summary) in ('other maintenance issue found', 'other') and v_top_level_notes is not null then
        v_issue_summary := 'Other maintenance issue: ' || v_top_level_notes;
      end if;
      v_issue_category := coalesce(
        v_item->>'category', v_item->>'issue_category',
        v_item->>'issueCategory', v_issue_summary
      );
      v_fixture_type := coalesce(
        v_item->>'fixture_type', v_item->>'fixtureType',
        case
          when lower(v_issue_summary) like '%toilet%' then 'toilet'
          when lower(v_issue_summary) like '%urinal%' then 'urinal'
          else null
        end
      );
      v_fixture_identifier := coalesce(
        v_item->>'fixture_identifier', v_item->>'fixtureIdentifier',
        v_item->>'stall', v_item->>'stall_number', v_item->>'stallNumber',
        v_item->>'urinal', v_item->>'urinal_number', v_item->>'urinalNumber',
        v_top_level_fixture_identifier
      );
      v_out_of_order := (
        lower(coalesce(
          v_item->>'out_of_order', v_item->>'outOfOrder',
          v_item->>'place_out_of_order', v_item->>'placeOutOfOrder',
          v_item->>'out_of_order_signed', v_item->>'outOfOrderSigned',
          case when v_top_level_out_of_order then 'true' else 'false' end
        )) in ('true','t','1','yes','y','on')
      );
    end if;

    insert into public.maintenance_tickets (
      completion_response_id, session_id, location_id,
      reported_by_employee_id, device_id, issue_source, status,
      issue_summary, issue_category, fixture_type, fixture_identifier,
      out_of_order, issue_payload, location_code_snapshot,
      location_name_snapshot, reporter_name_snapshot, reported_at
    ) values (
      p_completion_response_id, p_session_id, p_location_id,
      p_reported_by_employee_id, p_device_id, 'completion_form', 'open',
      left(coalesce(v_issue_summary, 'Maintenance issue reported'), 500),
      left(v_issue_category, 200), left(v_fixture_type, 100),
      left(v_fixture_identifier, 100), coalesce(v_out_of_order, false),
      jsonb_build_object(
        'raw_item', v_item,
        'top_level_note', v_top_level_notes,
        'top_level_fixture_identifier', v_top_level_fixture_identifier,
        'top_level_out_of_order', v_top_level_out_of_order
      ),
      v_location_code, v_location_name, v_reporter_name,
      coalesce(p_reported_at, now())
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.create_maintenance_tickets_from_response(uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb)
  is 'Creates completion-form tickets only from explicit maintenance signals; ordinary cleaning notes remain notes.';
