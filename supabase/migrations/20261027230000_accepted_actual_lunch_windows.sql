-- PROPOSAL ONLY: accepted actual lunch windows; no historical migration edits.
-- Retains exact accepted projection/lunch equality, positive window/shift,
-- unknown-lunch refusal, helper cardinality, role/credential and stale guards.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $actual$ declare p record; body text; begin
 for p in select * from (values
  ('public.static_weekly_v8_assert_lunch_document(uuid,jsonb)','if end_time-start_time<>interval ''1 hour'' then raise exception ''lunch must last exactly one hour''; end if;','if end_time<=start_time then raise exception ''accepted lunch end must follow its start''; end if;'),
  ('public.static_weekly_assert_exception_payload(text,date,time,time,uuid,uuid,jsonb,uuid)','p_exception_type=''lunch'' and p_ends_at-p_starts_at=interval ''1 hour''','p_exception_type=''lunch'' and p_ends_at>p_starts_at'),
  ('public.custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','end_text::time-start_text::time<>interval ''1 hour''','end_text::time<=start_text::time'),
  ('public.custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','Only the actual one-hour lunch accompanying dated CoverAll capacity is delegated','Only the actual positive lunch window within dated CoverAll capacity is delegated'),
  ('public.custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','lunch_end-lunch_start<>interval ''1 hour''','lunch_end<=lunch_start'),
  ('public.custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','CoverAll lunch must be one hour within the recorded shift','CoverAll lunch must be a positive actual window within the recorded shift'),
  ('public.custodial_native_lunch_live(uuid,jsonb,timestamptz)','
  or (intent->>''event''=''start'' and ends_at>scheduled+interval ''1 hour'') then return false;end if;',' then return false;end if;')
 ) v(identity,old_seam,new_seam) loop
  body:=pg_get_functiondef(to_regprocedure(p.identity));
  if body is null or length(body)-length(replace(body,p.old_seam,''))<>length(p.old_seam) then
   raise exception 'Exact actual-lunch predecessor mismatch: %',p.identity;
  end if;
  execute replace(body,p.old_seam,p.new_seam);
 end loop;
end $actual$;
-- CREATE OR REPLACE preserves existing ACLs; retain canary-recovery fullbodies.
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$ declare identity text; body text; changed integer; begin
 foreach identity in array array[
  'public.static_weekly_v8_assert_lunch_document(uuid,jsonb)',
  'public.static_weekly_assert_exception_payload(text,date,time,time,uuid,uuid,jsonb,uuid)',
  'public.custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)',
  'public.custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)',
  'public.custodial_native_lunch_live(uuid,jsonb,timestamptz)'
 ] loop
  body:=pg_get_functiondef(to_regprocedure(identity));
  update public.custodial_release_authority_restore_inventory i
   set definition_sql=body,definition_sha256=public.static_weekly_digest_text(body),captured_at=statement_timestamp()
   where case when i.object_kind='function' then to_regprocedure(i.object_identity) else null end=to_regprocedure(identity);
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Exact actual-lunch recovery function missing/duplicated: %',identity;end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
