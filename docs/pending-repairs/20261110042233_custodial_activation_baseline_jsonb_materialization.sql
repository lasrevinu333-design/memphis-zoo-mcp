-- Narrow diagnostic repair. Exact live predecessor only; no schedule activation.
-- Compute the insertion's immutable full snapshot digest once and reuse it in
-- the receipt. Original replay still hashes once; all validation/conflict order,
-- full stored JSONB, authority metadata and operation deadlines are retained.
begin;
set local lock_timeout='5s';
set local statement_timeout='40s';

do $baseline_materialization$
declare
 identity text:='public.static_weekly_manual_store_initial_baseline(uuid,text,jsonb)';
 predecessor text:='05c3a7ed26461506dd28e36c355d14e9ca0636d67d816271dab2f9d66699d448';
 original text;changed text;actual text;before_owner oid;before_acl aclitem[];
 before_security boolean;before_volatility "char";before_strict boolean;before_config text[];
 count_changed integer;seams jsonb;seam record;inverse text;
begin
 original:=pg_get_functiondef(to_regprocedure(identity));
 if public.static_weekly_digest_text(original) is distinct from predecessor then
  raise exception 'Exact activation baseline predecessor differs';end if;
 select proowner,proacl,prosecdef,provolatile,proisstrict,proconfig
 into strict before_owner,before_acl,before_security,before_volatility,before_strict,before_config
 from pg_proc where oid=to_regprocedure(identity);
 if before_owner is distinct from 'postgres'::regrole::oid
  or before_acl::text is distinct from '{postgres=X/postgres}' or not before_security
  or before_volatility is distinct from 'v' or before_strict
  or before_config is distinct from array['search_path=pg_catalog, public'] then
  raise exception 'Activation baseline owner metadata differs';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A') then
  raise exception 'Activation baseline recovery guard is not ALWAYS';end if;
 if (select count(*) from public.custodial_release_authority_restore_inventory
  where object_kind='function' and to_regprocedure(object_identity)=to_regprocedure(identity))<>1
  or not exists(select 1 from public.custodial_release_authority_restore_inventory
   where object_kind='function' and restore_order=100614 and to_regprocedure(object_identity)=to_regprocedure(identity)
    and definition_sql=original and definition_sha256=predecessor) then
  raise exception 'Exact activation baseline recovery predecessor differs';end if;
 changed:=original;
 seams:=(select jsonb_agg(jsonb_build_object('n',n,'before',before_text,'after',after_text) order by n) from (values
 (1,$before$date date;$before$,$after$date date;snapshot_identity text;$after$),
 (2,$before$ else
  insert into public.static_weekly_approved_initial_baselines$before$,$after$ else
  snapshot_identity:=public.static_weekly_digest_jsonb(p_feasibility);
  insert into public.static_weekly_approved_initial_baselines$after$),
 (3,$before$values(p_source_id,p_template_id,date,p_feasibility,public.static_weekly_digest_jsonb(p_feasibility));$before$,$after$values(p_source_id,p_template_id,date,p_feasibility,snapshot_identity);$after$),
 (4,$before$'snapshotDigest',public.static_weekly_digest_jsonb(p_feasibility),'published'$before$,$after$'snapshotDigest',coalesce(snapshot_identity,public.static_weekly_digest_jsonb(p_feasibility)),'published'$after$)
 ) changes(n,before_text,after_text));
 for seam in select value from jsonb_array_elements(seams) loop
  if length(changed)-length(replace(changed,seam.value->>'before',''))<>length(seam.value->>'before') then
   raise exception 'Exact activation baseline snapshot seam differs: %',seam.value->>'n';end if;
  changed:=replace(changed,seam.value->>'before',seam.value->>'after');
 end loop;
 inverse:=changed;
 for seam in select value from jsonb_array_elements(seams) order by (value->>'n')::integer desc loop
  inverse:=replace(inverse,seam.value->>'after',seam.value->>'before');
 end loop;
 if inverse is distinct from original then
  raise exception 'Activation baseline change is not exactly reversible';end if;
 execute changed;
 actual:=pg_get_functiondef(to_regprocedure(identity));
 if actual is distinct from changed or exists(select 1 from pg_proc where oid=to_regprocedure(identity)
  and (proowner is distinct from before_owner or proacl is distinct from before_acl
   or prosecdef is distinct from before_security or provolatile is distinct from before_volatility
   or proisstrict is distinct from before_strict or proconfig is distinct from before_config)) then
  raise exception 'Activation baseline definition or authority changed unexpectedly';end if;

 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 update public.custodial_release_authority_restore_inventory set definition_sql=actual,
  definition_sha256=public.static_weekly_digest_text(actual),captured_at=statement_timestamp()
 where object_kind='function' and restore_order=100614 and to_regprocedure(object_identity)=to_regprocedure(identity)
  and definition_sql=original and definition_sha256=predecessor;
 get diagnostics count_changed=row_count;
 if count_changed<>1 then raise exception 'Activation baseline exact recovery update failed';end if;
 alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
 if not exists(select 1 from public.custodial_release_authority_restore_inventory
  where object_kind='function' and restore_order=100614 and to_regprocedure(object_identity)=to_regprocedure(identity)
   and definition_sql=pg_get_functiondef(to_regprocedure(identity))
   and definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(to_regprocedure(identity))))
  or not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A') then
  raise exception 'Activation baseline recovery readback differs';end if;
end $baseline_materialization$;
commit;
