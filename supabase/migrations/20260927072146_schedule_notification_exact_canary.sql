-- F07-R1: only an exact JSON boolean true is a manager test notification.
-- Forward-only; preserve the existing API/ACL and all publication/ACK locks.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $correction$
declare
 signature text:='public.mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamptz)';
 definition text;prior_grants text;
 old_predicate text:=$old$coalesce(v_job.payload_json#>>'{data_json,test_delivery}','false')='false'$old$;
 new_predicate text:=$new$(v_job.payload_json#>'{data_json,test_delivery}') is distinct from 'true'::jsonb$new$;
 changed integer;
begin
 definition:=pg_get_functiondef(signature::regprocedure);
 prior_grants:=public.custodial_release_authority_current_grant_definition((signature::regprocedure)::text);
 if length(definition)-length(replace(definition,old_predicate,''))<>length(old_predicate) then
  raise exception 'exact canary predecessor seam changed';
 end if;
 execute replace(definition,old_predicate,new_predicate);
 if public.custodial_release_authority_current_grant_definition((signature::regprocedure)::text) is distinct from prior_grants then
  raise exception 'exact canary correction changed API privileges';
 end if;
 definition:=pg_get_functiondef(signature::regprocedure);
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 update public.custodial_release_authority_restore_inventory
  set definition_sql=definition,definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
  where object_kind='function' and object_identity like '%(%' and to_regprocedure(object_identity)=signature::regprocedure;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'expected one exact canary recovery function';end if;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $correction$;
commit;
