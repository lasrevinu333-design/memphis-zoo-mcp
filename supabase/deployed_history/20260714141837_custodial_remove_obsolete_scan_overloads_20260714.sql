-- Deployed migration history snapshot: 20260714141837 custodial_remove_obsolete_scan_overloads_20260714

drop function if exists public.complete_session(text,jsonb,text,text);
drop function if exists public.start_session(text,text,text);
drop function if exists public.record_scan_event(text,text,text,text,text,jsonb);
