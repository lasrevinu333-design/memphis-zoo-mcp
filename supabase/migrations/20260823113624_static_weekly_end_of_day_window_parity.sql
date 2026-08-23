-- Keep the portable model, control plane, and database on one local-time
-- contract. Exact 24:00 is the end of the current service day and is valid
-- only as a window end; no window may start at or continue beyond it.
begin;

create or replace function public.static_weekly_v3_assert_window(p_value jsonb,p_label text)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_start_minutes integer;
  v_end_minutes integer;
begin
  perform public.static_weekly_assert_exact_object(p_value,array['start','end'],array['start','end'],p_label);
  perform public.static_weekly_v3_assert_text(p_value->'start',p_label||' start',5);
  perform public.static_weekly_v3_assert_text(p_value->'end',p_label||' end',5);
  if p_value->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or (p_value->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and p_value->>'end' is distinct from '24:00') then
    raise exception using errcode='23514',message=format('%s endpoints must be HH:MM local time with 24:00 permitted only as the end of day',p_label);
  end if;
  v_start_minutes:=substring(p_value->>'start' from 1 for 2)::integer*60+substring(p_value->>'start' from 4 for 2)::integer;
  v_end_minutes:=case when p_value->>'end'='24:00' then 1440 else substring(p_value->>'end' from 1 for 2)::integer*60+substring(p_value->>'end' from 4 for 2)::integer end;
  if v_start_minutes>=v_end_minutes then
    raise exception using errcode='23514',message=format('%s must be an ordered nonempty local window',p_label);
  end if;
end
$function$;

revoke all on function public.static_weekly_v3_assert_window(jsonb,text)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

comment on function public.static_weekly_v3_assert_window(jsonb,text) is
'Validates one same-service-day local window; exact 24:00 is accepted only as its terminal endpoint.';

commit;
