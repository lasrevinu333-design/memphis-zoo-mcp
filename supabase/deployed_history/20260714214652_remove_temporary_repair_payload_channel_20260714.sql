-- Deployed migration history snapshot: 20260714214652 remove_temporary_repair_payload_channel_20260714

drop function if exists public.temporary_upload_repair_payload(text,text,text);
drop table if exists public.repair_payloads;
