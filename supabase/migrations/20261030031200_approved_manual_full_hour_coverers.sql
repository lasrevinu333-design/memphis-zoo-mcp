-- Explicit full-hour policies may name one coverer even when others are
-- available. Legacy unplanned lunch partitioning retains its existing rule.
-- Change only the existing validator and its exact recovery definition.
begin;
do $named_coverers$
declare identity text:='public.static_weekly_v8_assert_lunch_document(uuid,jsonb)';
 body text;old text;new text;before_acl text;
begin
 before_acl:=public.custodial_release_authority_current_grant_definition(identity);
 body:=pg_get_functiondef(to_regprocedure(identity));
 if body is null or position('full_hour_policy' in body)=0 then
  raise exception 'named full-hour coverers require the source-bound full-hour predecessor';end if;
 old:=$old$  if ((loan->>'status'='NO_AREAS' and jsonb_array_length(loan->'helper_slot_ids')=0 and loan->'fallback'='null'::jsonb)
    or (loan->>'status'='PLANNED' and ((jsonb_array_length(loan->'helper_slot_ids')=2 and loan->'fallback'='null'::jsonb)
      or (jsonb_array_length(loan->'helper_slot_ids')=1 and loan->>'fallback'='only_one_eligible_custodian')))) is not true then
   raise exception 'lunch helper cardinality or fallback invalid'; end if;$old$;
 new:=$new$  if ((loan->>'status'='NO_AREAS' and jsonb_array_length(loan->'helper_slot_ids')=0 and loan->'fallback'='null'::jsonb)
    or (loan->>'status'='PLANNED' and (
      (full_hour and jsonb_array_length(loan->'helper_slot_ids') between 1 and 2
        and (loan->'fallback'='null'::jsonb or (jsonb_array_length(loan->'helper_slot_ids')=1 and loan->>'fallback'='only_one_eligible_custodian')))
      or (not full_hour and ((jsonb_array_length(loan->'helper_slot_ids')=2 and loan->'fallback'='null'::jsonb)
        or (jsonb_array_length(loan->'helper_slot_ids')=1 and loan->>'fallback'='only_one_eligible_custodian')))))) is not true then
   raise exception 'lunch helper cardinality or fallback invalid'; end if;$new$;
 if length(body)-length(replace(body,old,''))<>length(old) then
  raise exception 'named full-hour coverer cardinality predecessor differs';end if;
 body:=replace(body,old,new);
 old:=$old$   if planned_loan->'window' is distinct from jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end')
    then raise exception 'full lunch source window changed';end if;$old$;
 new:=$new$   if planned_loan->'window' is distinct from jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end')
    then raise exception 'full lunch source window changed';end if;
   if loan->'helper_slot_ids' is distinct from (
     select coalesce(jsonb_agg(coverer order by coverer collate "C"),'[]'::jsonb)
     from (select distinct area->>'covererSlotId' coverer
       from jsonb_array_elements(planned_loan->'areas') area) named)
    then raise exception 'full lunch source coverer set changed';end if;$new$;
 if length(body)-length(replace(body,old,''))<>length(old) then
  raise exception 'named full-hour coverer source-window predecessor differs';end if;
 execute replace(body,old,new);
 if public.custodial_release_authority_current_grant_definition(identity) is distinct from before_acl then
  raise exception 'named full-hour coverer validator ACL changed';end if;
 if (select tgenabled from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   and tgname='trg_custodial_release_authority_restore_inventory_immutable') is distinct from 'A' then
  raise exception 'named full-hour coverer recovery guard is not ALWAYS';end if;
end $named_coverers$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare identity text:='public.static_weekly_v8_assert_lunch_document(uuid,jsonb)';definition text;changed integer;
begin
 definition:=pg_get_functiondef(to_regprocedure(identity));
 update public.custodial_release_authority_restore_inventory i set definition_sql=definition,
  definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
 where i.object_kind='function' and to_regprocedure(i.object_identity)=to_regprocedure(identity);
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'named full-hour coverer exact recovery row missing/duplicated';end if;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
