-- Keep the same lock order even when the constrained backend RPC is invoked
-- directly, outside the HTTP adapter's already-correct outer lock. No new
-- callable privilege, authority writer, receipt or source admission is added.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $order$
declare signature text;definition text;
 actor text:='perform public.static_weekly_v3_manager_actor(p_manager_id);';
 authority_lock text:='perform pg_advisory_xact_lock(hashtextextended(''memphis-static-weekly-authority'',0));';
begin
 foreach signature in array array[
  'public.static_weekly_v13_begin_recurring_confirmation(uuid,uuid,date,bigint,text,uuid)',
  'public.static_weekly_v13_read_recurring_confirmation(uuid,uuid)',
  'public.static_weekly_v14_admit_recurring_source(uuid,uuid,jsonb,text)',
  'public.static_weekly_v18_bind_recurring_publication(uuid,uuid,uuid,bigint,jsonb)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if length(definition)-length(replace(definition,actor,''))<>length(actor)
   or length(definition)-length(replace(definition,authority_lock,''))<>length(authority_lock)
   or strpos(definition,actor)>=strpos(definition,authority_lock) then
   raise exception 'recurring common-lock correction seam changed %',signature;
  end if;
  definition:=replace(definition,authority_lock,'');
  execute replace(definition,actor,authority_lock||E'\n  '||actor);
 end loop;
end
$order$;

alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare signature text;definition text;changed int;
begin
 foreach signature in array array[
  'public.static_weekly_v13_begin_recurring_confirmation(uuid,uuid,date,bigint,text,uuid)',
  'public.static_weekly_v13_read_recurring_confirmation(uuid,uuid)',
  'public.static_weekly_v14_admit_recurring_source(uuid,uuid,jsonb,text)',
  'public.static_weekly_v18_bind_recurring_publication(uuid,uuid,uuid,bigint,jsonb)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  update public.custodial_release_authority_restore_inventory set definition_sql=definition,
   definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
   where object_kind='function' and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=signature::regprocedure;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'exact existing recurring function recovery entry required %',signature;end if;
 end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
