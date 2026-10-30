-- Receive a compact reference to the already admitted fixed snapshot. Rebuild
-- the original envelope on the server and run every original identity check.
-- This changes neither the accepted snapshot nor any function privilege.
begin;
do $compact_initial$
declare identity text:='public.static_weekly_materialize_approved_initial_baseline(uuid,uuid,date,bigint,bigint,text,jsonb)';
 body text;needle text;replacement text;before_acl text;before_owner oid;
begin
 body:=pg_get_functiondef(to_regprocedure(identity));
 if md5(body) is distinct from 'a0995bf368a7ff040f2a8df6f91b83a3' then
  raise exception 'compact initial confirmation requires the exact unchanged predecessor';end if;
 before_acl:=public.custodial_release_authority_current_grant_definition(identity);
 select proowner into strict before_owner from pg_proc where oid=to_regprocedure(identity);
 needle:=$old$ select * into strict baseline from public.static_weekly_approved_initial_baselines where source_id=p_source_id;$old$;
 replacement:=needle||$new$
 if p_envelope->>'schema'='custodial.approved-static-initial-materialization.compact.v1' then
  perform public.static_weekly_assert_exact_object(p_envelope,
   array['schema','managerId','sourceId','effectiveStart','expectedRevision','generation','templateCatalogDigest','feasibilityDigest','previewDigest','request'],
   array['schema','managerId','sourceId','effectiveStart','expectedRevision','generation','templateCatalogDigest','feasibilityDigest','previewDigest','request'],
   'compact initial confirmation');
  if p_envelope->>'feasibilityDigest' is distinct from baseline.feasibility->>'digest' then
   raise exception using errcode='23514',message='compact initial confirmation snapshot digest changed';end if;
  -- The basis above verifies the immutable snapshot and its catalog/source.
  -- Reconstruct the SAME full v1 envelope; its original preview digest, full
  -- feasibility equality, actor, revision, generation and request checks below
  -- remain the admission boundary for both old and compact callers.
  p_envelope:=(p_envelope-'feasibilityDigest')||jsonb_build_object(
   'schema','custodial.approved-static-initial-materialization.v1','feasibility',baseline.feasibility);
 end if;
$new$;
 if length(body)-length(replace(body,needle,''))<>length(needle) then
  raise exception 'compact initial confirmation predecessor binding differs';end if;
 execute replace(body,needle,replacement);
 if public.custodial_release_authority_current_grant_definition(identity) is distinct from before_acl
  or (select proowner from pg_proc where oid=to_regprocedure(identity)) is distinct from before_owner then
  raise exception 'compact initial confirmation changed owner or ACL';end if;
 if (select tgenabled from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable') is distinct from 'A' then
  raise exception 'compact initial confirmation requires the ALWAYS recovery guard';end if;
end $compact_initial$;
do $direct_baseline$
declare identity text:='public.static_weekly_approved_initial_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)';
 body text;needle text;replacement text;before_acl text;before_owner oid;
begin
 body:=pg_get_functiondef(to_regprocedure(identity));
 if md5(body) is distinct from '619aa4e9670cc43627a1e9197d4ce5b2' then
  raise exception 'direct initial assignment links require the exact unchanged predecessor';end if;
 before_acl:=public.custodial_release_authority_current_grant_definition(identity);
 select proowner into strict before_owner from pg_proc where oid=to_regprocedure(identity);
 needle:=$old$ if p_assignments#>>'{authority,schema}'='custodial.approved-static-authority.v1'
    and (v_work->>'overlayWork') is distinct from 'true' then$old$;
 replacement:=$new$ if p_assignments#>>'{authority,schema}'='custodial.approved-static-authority.v1'
    and jsonb_typeof(p_assignments#>'{authority,shiftEndDerivation}')='object'
    and (v_work->>'overlayWork') is distinct from 'true' then$new$;
 -- Derived snapshots still require the exact parent chain. A fixed manual
 -- snapshot without derivation uses the existing exact work/day/version join
 -- and the existing mandatory non-null baseline link check immediately below.
 if length(body)-length(replace(body,needle,''))<>length(needle) then
  raise exception 'direct initial assignment link predecessor differs';end if;
 execute replace(body,needle,replacement);
 if public.custodial_release_authority_current_grant_definition(identity) is distinct from before_acl
  or (select proowner from pg_proc where oid=to_regprocedure(identity)) is distinct from before_owner then
  raise exception 'direct initial assignment links changed owner or ACL';end if;
end $direct_baseline$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare identity text;definition text;changed integer;
begin
 for identity in select unnest(array[
  'public.static_weekly_materialize_approved_initial_baseline(uuid,uuid,date,bigint,bigint,text,jsonb)',
  'public.static_weekly_approved_initial_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)']) loop
 definition:=pg_get_functiondef(to_regprocedure(identity));
 update public.custodial_release_authority_restore_inventory set definition_sql=definition,
  definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
 where object_kind='function' and to_regprocedure(object_identity)=to_regprocedure(identity);
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'compact initial confirmation recovery row missing/duplicated';end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
