-- Explicit optional-break choice for registered nonemployee capacity only.
-- Existing commands/employee lunch predicates and historical rows are intact.
begin;
do $patch$ declare body text;old text;new text;begin
 body:=pg_get_functiondef('public.static_weekly_assert_exception_payload(text,date,time without time zone,time without time zone,uuid,uuid,jsonb,uuid)'::regprocedure);
 old:=$s$array['slotId','shift','productiveCapacityProvenance','maxServiceEffortMinutes','maxServiceEffortProvenance','qualifications','qualificationProvenance','restrictions','restrictionProvenance','acceptedRouteAnchorLocationId','acceptedRouteProvenance'],'coverall availability');$s$;
 new:=$s$array['slotId','shift','productiveCapacityProvenance','maxServiceEffortMinutes','maxServiceEffortProvenance','qualifications','qualificationProvenance','restrictions','restrictionProvenance','acceptedRouteAnchorLocationId','acceptedRouteProvenance','breakChoice'],'coverall availability');
    if p_payload->'availability' ? 'breakChoice' then
      if p_payload#>'{availability,breakChoice}' is distinct from '"NONE"'::jsonb
       or not exists(select 1 from public.weekly_schedule_versions v
        cross join lateral jsonb_array_elements(v.draft_document#>'{authority,compilerInput,slots}') s
        where v.version_id=p_base_version_id and s->>'id'=p_payload#>>'{availability,slotId}'
         and s->>'kind'='CONTRACTOR_CAPACITY' and public.static_weekly_capacity_registered(s)) then
        raise exception using errcode='23514',message='Explicit no-break requires source-bound registered nonemployee capacity';
      end if;
    end if;$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected optional-break exact payload predecessor';end if;body:=replace(body,old,new);
 old:=$s$elsif p_exception_type in ('partial_absence','lunch') then$s$;
 new:=$s$elsif p_exception_type in ('partial_absence','lunch') then
    if p_exception_type='lunch' and exists(select 1 from public.weekly_schedule_exception_commands e
      where e.publication_id=p_publication_id and e.base_version_id=p_base_version_id and e.service_date=p_service_date
       and e.exception_type='cover_all' and e.payload_json#>>'{availability,slotId}'=p_payload->>'slotId'
       and e.payload_json#>>'{availability,breakChoice}'='NONE'
       and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)) then
      raise exception using errcode='23514',message='Explicit no-break conflicts with a lunch; reverse and replace the dated engagement';end if;$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected lunch conflict predecessor';end if;body:=replace(body,old,new);
 old:=$s$not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_lock->>'slotId',true)$s$;
 new:=$s$not (public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_lock->>'slotId',true)
       or exists(select 1 from public.weekly_schedule_versions v
        cross join lateral jsonb_array_elements(v.draft_document#>'{authority,compilerInput,slots}') s
        join public.weekly_schedule_exception_commands e on e.base_version_id=v.version_id
         and e.publication_id=p_publication_id and e.service_date=p_service_date and e.exception_type='cover_all'
         and e.payload_json#>>'{availability,slotId}'=s->>'id'
        where v.version_id=p_base_version_id and s->>'id'=v_lock->>'slotId'
         and s->>'kind'='CONTRACTOR_CAPACITY' and public.static_weekly_capacity_registered(s)
         and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)))$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected typed manual correction predecessor';end if;body:=replace(body,old,new);execute body;

 body:=pg_get_functiondef('public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)'::regprocedure);
 old:=$s$or v_child.request_canonical_json#>>'{payload,availability,slotId}' is distinct from v_operation->>'slotId'$s$;
 new:=$s$or v_child.request_canonical_json#>>'{payload,availability,slotId}' is distinct from v_operation->>'slotId'
         or v_child.request_canonical_json#>'{payload,availability,breakChoice}' is distinct from v_operation->'breakChoice'$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected optional-break receipt predecessor';end if;execute replace(body,old,new);

 body:=pg_get_functiondef('public.static_weekly_v8_assert_lunch_document(uuid,jsonb)'::regprocedure);
 old:=$s$where value->>'status'='working' and (nullif(value->>'incumbentPersonId','') is not null or value->>'ownerKind'='CONTRACTOR_CAPACITY');$s$;
 new:=$s$where value->>'status'='working' and (nullif(value->>'incumbentPersonId','') is not null or value->>'ownerKind'='CONTRACTOR_CAPACITY')
  and (value->>'ownerKind'='CONTRACTOR_CAPACITY' and value->>'breakChoice'='NONE' and value->'lunch'='null'::jsonb) is not true;$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected no-break loan inventory predecessor';end if;body:=replace(body,old,new);
 old:=$s$or (nullif(helper->>'incumbentPersonId','') is null and helper->>'ownerKind' is distinct from 'CONTRACTOR_CAPACITY') or helper#>>'{lunch,start}' is null
    or helper#>>'{lunch,end}' is null$s$;
 new:=$s$or (nullif(helper->>'incumbentPersonId','') is null and helper->>'ownerKind' is distinct from 'CONTRACTOR_CAPACITY')
    or ((helper#>>'{lunch,start}' is null or helper#>>'{lunch,end}' is null)
      and (helper->>'ownerKind'='CONTRACTOR_CAPACITY' and helper->>'breakChoice'='NONE' and helper->'lunch'='null'::jsonb) is not true)$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected no-break helper availability predecessor';end if;body:=replace(body,old,new);execute body;
end $patch$;

-- CREATE OR REPLACE retains each existing function's narrow ACL. Capture only
-- actual owning definition changes; no default grants or unrelated resets.
do $recovery$ declare obj record;changed integer;ord integer;begin
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select x.* from pg_proc p cross join lateral (
   select 800000 bucket,'function' kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition
   union all select 900000,'grant',p.oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text)) x
  where p.pronamespace='public'::regnamespace and p.proname in('static_weekly_assert_exception_payload','static_weekly_v4_begin_day_changes','static_weekly_v8_assert_lunch_document') loop
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and object_identity like '%(%' and to_regprocedure(object_identity)=to_regprocedure(obj.identity);
  get diagnostics changed=row_count;if changed>1 then raise exception 'Duplicate optional-break recovery function: %',obj.identity;end if;
  if changed=0 then
   select n into ord from generate_series(obj.bucket+1,obj.bucket+99999) n
    where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
   if ord is null then raise exception 'Optional-break recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;
commit;
