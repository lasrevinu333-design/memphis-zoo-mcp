begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- The old exception validator checked only recurring working availability.
-- Contractor slots are deliberately unavailable until a dated manual capacity
-- command. Admit their explicit lunch only AFTER that exact command, in the
-- same manager transaction; never synthesize a lunch or alter the baseline.
do $correction$
declare d text; seam text:=$old$if p_starts_at is null or p_ends_at is null or not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_slot,true)$old$;
 replacement text:=$new$if p_starts_at is null or p_ends_at is null or not (
      public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_slot,true)
      or (p_exception_type='lunch' and p_ends_at-p_starts_at=interval '1 hour'
        and public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_slot,false)
        and exists(select 1 from public.weekly_schedule_versions v
          cross join lateral jsonb_array_elements(v.draft_document#>'{authority,compilerInput,slots}') slot
          where v.version_id=p_base_version_id and slot->>'id'=v_slot and slot->'contractorCapacity'='true'::jsonb)
        and exists(select 1 from public.weekly_schedule_exception_commands capacity
          where capacity.base_version_id=p_base_version_id and capacity.publication_id=p_publication_id
            and capacity.service_date=p_service_date and capacity.exception_type='cover_all'
            and capacity.payload_json#>>'{availability,slotId}'=v_slot
            and (capacity.payload_json#>>'{availability,shift,start}')::time<=p_starts_at
            and p_ends_at<=(capacity.payload_json#>>'{availability,shift,end}')::time
            and not exists(select 1 from public.weekly_schedule_exception_commands reversal
              where reversal.reverses_exception_id=capacity.exception_id))))$new$;
begin
 d:=pg_get_functiondef('public.static_weekly_assert_exception_payload(text,date,time,time,uuid,uuid,jsonb,uuid)'::regprocedure);
 if (length(d)-length(replace(d,seam,'')))/length(seam)<>1 then raise exception 'OC24 contractor lunch validator seam missing'; end if;
 execute replace(d,seam,replacement);
end $correction$;

-- The older validator was not independently in the canary surface. Include
-- its precise function/ACL now, without changing or expanding that ACL.
do $surface$
declare d text;
begin
 d:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (length(d)-length(replace(d,'  values','')))/length('  values')<>1 then raise exception 'OC24 lunch surface seam missing'; end if;
 execute replace(d,'  values','  values'||E'\n'||$row$('function','public.static_weekly_assert_exception_payload(text,date,time,time,uuid,uuid,jsonb,uuid)','OC24 actual dated contractor lunch'),
 $row$);
end $surface$;

-- No new runtime object/grant/table/sequence. Retain exact private execution
-- permissions while adding missing helper recovery and updating the surface.
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record; next_order integer;
begin
 for obj in with funcs as (
  select unnest(array['public.static_weekly_assert_exception_payload(text,date,time,time,uuid,uuid,jsonb,uuid)'::regprocedure::oid,
   'public.custodial_release_canary_authority_surface()'::regprocedure::oid]) oid
 ), objects as (
  select 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition from funcs
  union all select 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing OC24 lunch recovery object %',obj.identity; end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and object_identity like '%(%' and to_regprocedure(object_identity)=to_regprocedure(obj.identity);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<obj.bucket+100000;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
