-- Deployed migration history snapshot: 20260714120020 expand_session_completion_source_contract_20260714

alter table public.sessions
  drop constraint if exists sessions_completion_source_check;

alter table public.sessions
  add constraint sessions_completion_source_check
  check (
    completion_source is null
    or completion_source in (
      'kiosk_form',
      'admin',
      'repair',
      'system',
      'incident_recovery',
      'system_timeout_cancelled'
    )
  );
