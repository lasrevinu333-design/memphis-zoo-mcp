-- Deployed migration history snapshot: 20260715043547 revoke_trigger_function_public_execute_20260715

revoke all on function public.prevent_duplicate_daily_schedule_assignment() from public, anon, authenticated;
grant execute on function public.prevent_duplicate_daily_schedule_assignment() to service_role, postgres;
