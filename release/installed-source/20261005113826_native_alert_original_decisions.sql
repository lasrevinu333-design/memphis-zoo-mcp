-- Forward-only original Event/Message receipt lookup. No new delivery or
-- admission permission, new grants, business-source currentness or data rewrite.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
do $patch$
declare definition text;prior_definition text;prior_acl text;old text;replacement text;
 identity text:='public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)';
 changed integer;
begin
 select pg_get_functiondef(p.oid) into definition from pg_proc p where p.oid=identity::regprocedure
  and public.static_weekly_digest_text(p.prosrc)='2b01e10266c272e6b591950a2fee8d8b47094a3911baa59e01c363cca21abf72';
 if definition is null then raise exception 'Alert decision source predecessor changed';end if;
 prior_definition:=definition;
 prior_acl:=public.custodial_release_authority_current_grant_definition(identity);
 if (select count(*) from public.custodial_release_authority_restore_inventory
  where object_kind='function' and to_regprocedure(object_identity)=identity::regprocedure
   and definition_sql=definition and definition_sha256=public.static_weekly_digest_text(definition))<>1
  or (select count(*) from public.custodial_release_authority_restore_inventory
   where object_kind='grant' and object_identity like '%(%' and to_regprocedure(object_identity)=identity::regprocedure
    and definition_sql=prior_acl and definition_sha256=public.static_weekly_digest_text(prior_acl))<>1 then
  raise exception 'Alert decision recovery predecessor changed';end if;
 old:=$old$prior public.employee_native_provider_events%rowtype;$old$;
 replacement:=$new$prior public.employee_native_provider_events%rowtype;
 alert public.employee_native_alert_finalizations%rowtype;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'Alert decision declaration seam changed';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$select * into current_g from public.employee_native_push_generations where generation_id=(requester->>'current_generation_id')::uuid;$old$;
 replacement:=$new$perform 1 from public.employee_native_alert_finalizations where job_id in
  (select (x->>'receipt_job_id')::uuid from jsonb_array_elements(p_body->'events') x) order by job_id for share;
 select * into current_g from public.employee_native_push_generations where generation_id=(requester->>'current_generation_id')::uuid;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'Alert decision lock seam changed';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$payload:=r.native_payload;
   original_ok:=g.generation_id is not null$old$;
 replacement:=$new$select * into alert from public.employee_native_alert_finalizations where job_id=(e->>'receipt_job_id')::uuid;
   payload:=case when alert.job_id is not null then alert.payload else r.native_payload end;
   if alert.job_id is not null then
    original_ok:=public.custodial_native_alert_event_binding(alert.job_id,e,c.credential_id,at_time);
   else
   original_ok:=g.generation_id is not null$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'Alert decision original seam changed';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$(payload->>'schema'='custodial.native-provider-payload.v1' and payload->>'kind'='employee_lunch_coverage'));$old$;
 replacement:=old||E'\n   end if;';
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'Alert decision legacy seam changed';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$prior.job_id=r.job_id$old$;
 replacement:=$new$prior.job_id=(e->>'receipt_job_id')::uuid$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'Alert decision owning job seam changed';end if;
 definition:=replace(definition,old,replacement);
 execute definition;
 if public.custodial_release_authority_current_grant_definition(identity) is distinct from prior_acl then
  raise exception 'Alert decision ACL changed';end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 update public.custodial_release_authority_restore_inventory
  set definition_sql=pg_get_functiondef(identity::regprocedure),
   definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(identity::regprocedure)),
   captured_at=statement_timestamp()
  where object_kind='function' and to_regprocedure(object_identity)=identity::regprocedure
   and definition_sql=prior_definition and definition_sha256=public.static_weekly_digest_text(prior_definition);
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Alert decision recovery update count changed';end if;
 alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
end $patch$;

-- Add the three earlier inventory/event helpers to the canary's explicit
-- source membership. Their definitions/ACLs must already match captured birth
-- recovery; never learn the intended list from surviving inventory rows.
do $surface$
declare surface text;prior_acl text;additions text:='';obj record;definition text;updated integer;
begin
 surface:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 prior_acl:=public.custodial_release_authority_current_grant_definition('custodial_release_canary_authority_surface()');
 if (length(surface)-length(replace(surface,'  values','')))/length('  values')<>1
  or (select count(*) from public.custodial_release_authority_restore_inventory
   where object_kind='function' and to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
    and definition_sql=surface and definition_sha256=public.static_weekly_digest_text(surface))<>1 then
  raise exception 'Alert helper surface predecessor changed';end if;
 for obj in select k.kind,f.identity::regprocedure::text identity from (values
  ('public.custodial_native_alert_source_live(uuid,timestamptz)'),
  ('public.custodial_native_provider_original_tuple(uuid)'),
  ('public.custodial_native_alert_event_binding(uuid,jsonb,uuid,timestamptz)')) f(identity)
  cross join (values ('function'),('grant')) k(kind) order by k.kind,f.identity loop
  definition:=case obj.kind when 'function' then pg_get_functiondef(obj.identity::regprocedure)
   else public.custodial_release_authority_current_grant_definition(obj.identity) end;
  if (select count(*) from public.custodial_release_authority_restore_inventory i
   where i.object_kind=obj.kind and i.object_identity like '%(%' and to_regprocedure(i.object_identity)=obj.identity::regprocedure
    and i.definition_sql=definition and i.definition_sha256=public.static_weekly_digest_text(definition))<>1
   or exists(select 1 from public.custodial_release_canary_authority_surface() s where s.object_kind=obj.kind
    and s.object_identity like '%(%' and to_regprocedure(s.object_identity)=obj.identity::regprocedure) then
   raise exception 'Alert helper recovery or surface membership changed';end if;
  additions:=additions||format('    (%L,%L,%L),',obj.kind,obj.identity,'native alert receipt authority')||E'\n';
 end loop;
 execute replace(surface,'  values',E'  values\n'||additions);
 if public.custodial_release_authority_current_grant_definition('custodial_release_canary_authority_surface()') is distinct from prior_acl then
  raise exception 'Alert helper surface ACL changed';end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 update public.custodial_release_authority_restore_inventory
  set definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
   definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),captured_at=statement_timestamp()
  where object_kind='function' and to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   and definition_sql=surface and definition_sha256=public.static_weekly_digest_text(surface);
 get diagnostics updated=row_count;
 if updated<>1 then raise exception 'Alert helper surface recovery identity changed';end if;
 alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
end $surface$;
commit;
