-- Canonical contractor handout capabilities. No legacy employee/capacity map.
-- Additive only: old token/history rows remain unchanged.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
create table public.static_weekly_coverall_access_links(
 link_id uuid not null,
 token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),
 binding jsonb not null check(jsonb_typeof(binding)='object'),
 source_id uuid references public.static_weekly_authority_source_documents(source_id),
 source_digest text check(source_digest~'^[a-f0-9]{64}$'),
 manager_id uuid not null references public.ops_manager_managers(manager_id),
 credential_id uuid not null references public.ops_manager_trusted_devices(credential_id),
 device_id text not null, session_access text not null check(session_access in('full_access','read_only')),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 revoked_at timestamptz,revoked_by uuid references public.ops_manager_managers(manager_id),
 primary key(manager_id,link_id),
 check(expires_at>created_at and expires_at<=created_at+interval '7 days'),
 check(revoked_at is not null or (source_id is not null and source_digest is not null))
);
alter table public.static_weekly_coverall_access_links enable row level security;
alter table public.static_weekly_coverall_access_links force row level security;
revoke all on public.static_weekly_coverall_access_links from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

create function public.static_weekly_assert_coverall_link_basis(p_binding jsonb,p_source uuid default null,p_digest text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a record;src jsonb;source_row record;doc jsonb;projection record;day date;revision bigint;
begin
 perform public.static_weekly_v3_assert_control_plane();
 if not exists(select 1 from custodial_dr.restore_control where singleton and mutations_paused is false and state in('READY','COMPLETE')) then
  raise exception using errcode='55000',message='Canonical CoverAll authority is unavailable during restore';end if;
 perform public.static_weekly_assert_exact_object(p_binding,
  array['schema','week_start','service_date','capacity_id','publication_id','projection_id','authority_revision','replay_digest','lunch_document_identity','document_digest'],
  array['schema','week_start','service_date','capacity_id','publication_id','projection_id','authority_revision','replay_digest','lunch_document_identity','document_digest'],'canonical CoverAll binding');
 if (p_binding->>'schema'='custodial.coverall-canonical-binding.v1'
  and p_binding->>'service_date'~'^\d{4}-\d{2}-\d{2}$' and p_binding->>'week_start'~'^\d{4}-\d{2}-\d{2}$'
  and p_binding->>'capacity_id'~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  and p_binding->>'publication_id'~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  and p_binding->>'projection_id'~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  and jsonb_typeof(p_binding->'authority_revision')='number' and p_binding->>'authority_revision'~'^(0|[1-9][0-9]*)$'
  and p_binding->>'replay_digest'~'^[a-f0-9]{64}$' and p_binding->>'lunch_document_identity'~'^[a-f0-9]{64}$'
  and p_binding->>'document_digest'~'^[a-f0-9]{64}$') is not true then
  raise exception using errcode='22023',message='Exact canonical CoverAll binding required';end if;
 day:=(p_binding->>'service_date')::date;
 if not isfinite(day) or day-(extract(isodow from day)::integer-1)<>(p_binding->>'week_start')::date then
  raise exception using errcode='22023',message='Exact canonical CoverAll week/date required';end if;
 select current_revision into strict revision from public.static_weekly_schedule_control where singleton;
 select * into a from public.static_weekly_v6_schedule_authority_state(day);
 select * into projection from public.weekly_schedule_compiled_projections where projection_id=(p_binding->>'projection_id')::uuid;
 if a.governed is not true or a.projection_status is distinct from 'current'
  or a.projection_id::text is distinct from p_binding->>'projection_id'
  or a.publication_id::text is distinct from p_binding->>'publication_id'
  or revision is distinct from (p_binding->>'authority_revision')::bigint
  or projection.replay_digest is distinct from p_binding->>'replay_digest' then
  raise exception using errcode='40001',message='Canonical CoverAll schedule changed';end if;
 select s.* into source_row from public.weekly_schedule_versions v
  join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id
  where v.version_id=a.version_id;
 if source_row.source_id is null or source_row.active is not true or source_row.retired_at is not null
  or source_row.source_digest is distinct from public.static_weekly_digest_jsonb(source_row.canonical_source)
  or (p_source is not null and source_row.source_id is distinct from p_source)
  or (p_digest is not null and source_row.source_digest is distinct from p_digest) then
  raise exception using errcode='40001',message='Canonical CoverAll source changed';end if;
 doc:=public.static_weekly_v8_read_lunch_document(day);
 if doc->>'persistence_status' is distinct from 'PERSISTED'
  or doc->>'projection_id' is distinct from p_binding->>'projection_id'
  or doc->>'document_identity' is distinct from p_binding->>'lunch_document_identity' then
  raise exception using errcode='40001',message='Canonical CoverAll lunch changed';end if;
 src:=public.static_weekly_v3_read_publication_source(a.publication_id,day);
 if not exists(select 1 from jsonb_array_elements(src#>'{compiler_input,slots}') s
   where s->>'id'=p_binding->>'capacity_id' and s->'contractorCapacity'='true'::jsonb)
  or not exists(select 1 from jsonb_array_elements(src->'exceptions') e
   where e->>'type'='cover_all' and e->>'serviceDate'=day::text
    and e#>>'{payload,availability,slotId}'=p_binding->>'capacity_id') then
  raise exception using errcode='40001',message='Canonical CoverAll capacity is not accepted for this date';end if;
 return jsonb_build_object('source_id',source_row.source_id,'source_digest',source_row.source_digest);
end $fn$;

create function public.static_weekly_issue_coverall_link(
 p_manager uuid,p_credential uuid,p_device text,p_access text,p_link uuid,p_token_hash text,p_binding jsonb,p_ttl integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare actor jsonb;basis jsonb;created timestamptz;expires timestamptz;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 if p_link is null or coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$' or p_ttl is null or p_ttl not between 1 and 168 then
  raise exception using errcode='22023',message='Bounded canonical CoverAll issuance required';end if;
 basis:=public.static_weekly_assert_coverall_link_basis(p_binding);
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 created:=clock_timestamp();expires:=created+make_interval(hours=>p_ttl);
 -- The once-only request ID is scoped to the server-derived issuing manager.
 -- Another manager may use/revoke the same nonsecret UUID without interference.
 insert into public.static_weekly_coverall_access_links(link_id,token_hash,binding,source_id,source_digest,manager_id,credential_id,device_id,session_access,created_at,expires_at)
 values(p_link,p_token_hash,p_binding,(basis->>'source_id')::uuid,basis->>'source_digest',p_manager,p_credential,p_device,p_access,created,expires);
 return jsonb_build_object('link_id',p_link,'expires_at',expires);
end $fn$;

create function public.static_weekly_read_coverall_link(p_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare link public.static_weekly_coverall_access_links%rowtype;actor jsonb;manager_name text;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 if coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$' then raise exception using errcode='42501',message='CoverAll link unavailable';end if;
 select * into link from public.static_weekly_coverall_access_links where token_hash=p_token_hash for share;
 if not found or link.revoked_at is not null or link.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='CoverAll link unavailable';end if;
 actor:=public.custodial_action_actor_v1(link.manager_id,link.credential_id,link.device_id,link.session_access,'manage_coverall');
 perform public.static_weekly_assert_coverall_link_basis(link.binding,link.source_id,link.source_digest);
 if link.expires_at<=clock_timestamp() then raise exception using errcode='42501',message='CoverAll link unavailable';end if;
 actor:=public.custodial_action_actor_v1(link.manager_id,link.credential_id,link.device_id,link.session_access,'manage_coverall');
 select display_name into strict manager_name from public.ops_manager_managers where manager_id=link.manager_id;
 if link.expires_at<=clock_timestamp() then raise exception using errcode='42501',message='CoverAll link unavailable';end if;
 return jsonb_build_object('schema','custodial.coverall-canonical-access.v1','binding',link.binding,
  'issuing_manager',jsonb_build_object('managerId',link.manager_id,'managerName',manager_name));
end $fn$;

create function public.static_weekly_revoke_coverall_link(p_manager uuid,p_credential uuid,p_device text,p_access text,p_link uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare actor jsonb;link public.static_weekly_coverall_access_links%rowtype;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 select * into link from public.static_weekly_coverall_access_links where manager_id=p_manager and link_id=p_link for update;
 -- Capture FOUND before rechecking current credential after a possible row wait.
 if found then
  actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 else
  actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
  -- Durable nonsecret tombstone settles an unknown issuance and prevents a
  -- delayed original POST from creating this request after revocation ACK.
  insert into public.static_weekly_coverall_access_links(link_id,token_hash,binding,manager_id,credential_id,device_id,session_access,created_at,expires_at,revoked_at,revoked_by)
   values(p_link,public.static_weekly_digest_text('revoked-coverall-request:'||p_manager::text||':'||p_link::text),'{}'::jsonb,p_manager,p_credential,p_device,p_access,
    statement_timestamp(),statement_timestamp()+interval '1 second',statement_timestamp(),p_manager);
  return jsonb_build_object('link_id',p_link,'revoked',true);
 end if;
 -- Revocation is exact issuer scope. Cross-issuer administrative revocation
 -- requires a separate explicit issuer context, never a guessed request ID.
 update public.static_weekly_coverall_access_links set revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_by=coalesce(revoked_by,p_manager) where manager_id=p_manager and link_id=p_link;
 return jsonb_build_object('link_id',p_link,'revoked',true);
end $fn$;
revoke all on function public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text),public.static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer),public.static_weekly_read_coverall_link(text),public.static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
grant execute on function public.static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer),public.static_weekly_read_coverall_link(text),public.static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid) to static_weekly_control_plane;
-- Explicit dependency-closed recovery membership for ONLY this new capability
-- relation and its four routines. Existing captured objects stay byte-identical
-- except the canary surface definition expanded by these exact new roots.
select custodial_dr.install_application_mutation_fences();
lock table public.custodial_release_authority_restore_inventory in access exclusive mode;
create temp table coverall_link_recovery_before on commit drop as table public.custodial_release_authority_restore_inventory;
create temp table coverall_link_new_recovery(bucket integer,kind text,identity text,definition text,primary key(kind,identity)) on commit drop;
do $capture_new$
declare rel text:='public.static_weekly_coverall_access_links';rid oid:=rel::regclass;
 sig text;obj record;surface text;roots text;next_order integer;surface_before text;affected integer;
begin
 if (select array_agg(attname::text order by attname) from pg_attribute where attrelid=rid and attnum>0 and not attisdropped)
  is distinct from array['binding','created_at','credential_id','device_id','expires_at','link_id','manager_id','revoked_at','revoked_by','session_access','source_digest','source_id','token_hash']::text[] then
  raise exception 'Canonical CoverAll recovery column set changed';end if;
 insert into coverall_link_new_recovery values
  (1000,'relation',rel,public.custodial_release_authority_current_relation_definition(rel)),
  (300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)),
  (400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)),
  (900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel));
 insert into coverall_link_new_recovery
  select 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname)
  from pg_attribute where attrelid=rid and attnum>0 and not attisdropped;
 insert into coverall_link_new_recovery
  select 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
  from pg_constraint where conrelid=rid;
 insert into coverall_link_new_recovery
  select 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
  from pg_index i where indrelid=rid and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid);
 insert into coverall_link_new_recovery
  select 700000,'trigger',rel||'.'||quote_ident(tgname),
   'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '||pg_get_triggerdef(oid,true)||'; alter table '||rel||' '
    ||case tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
    ||' trigger '||quote_ident(tgname)||';'
  from pg_trigger where tgrelid=rid and not tgisinternal;
 insert into coverall_link_new_recovery
  select 800000,'policy',rel||':'||polname,public.custodial_release_authority_current_policy_definition(rel||':'||polname)
  from pg_policy where polrelid=rid;
 if not exists(select 1 from coverall_link_new_recovery where kind='trigger') then
  raise exception 'Canonical CoverAll mutation fence was not installed';end if;
 foreach sig in array array[
  'public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)',
  'public.static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer)',
  'public.static_weekly_read_coverall_link(text)',
  'public.static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid)'
 ] loop
  insert into coverall_link_new_recovery values
   (100000,'function',sig::regprocedure::text,pg_get_functiondef(sig::regprocedure)),
   (1000000,'grant',sig::regprocedure::text,public.custodial_release_authority_current_grant_definition(sig::regprocedure::text));
 end loop;
 if exists(select 1 from coverall_link_new_recovery where definition is null or definition='') then
  raise exception 'Canonical CoverAll recovery renderer missing';end if;
 if exists(select 1 from coverall_link_new_recovery n join public.custodial_release_authority_restore_inventory i
   on i.object_kind=n.kind and i.object_identity=n.identity) then
  raise exception 'Unexpected prior canonical CoverAll recovery membership';end if;
 surface_before:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (select count(*) from public.custodial_release_authority_restore_inventory
   where case when object_kind='function' then to_regprocedure(object_identity) else null end='public.custodial_release_canary_authority_surface()'::regprocedure
    and definition_sql=surface_before and definition_sha256=public.static_weekly_digest_text(surface_before))<>1 then
  raise exception 'Exact prior canary recovery definition unavailable';end if;
 -- Retain every existing surface row/body. The already established source
 -- function has one VALUES insertion seam, never a generic function waiver.
 if length(surface_before)-length(replace(surface_before,'  values',''))<>length('  values') then
  raise exception 'Exact canary VALUES predecessor changed';end if;
 select string_agg(format('(%L,%L,%L),',kind,identity,'canonical capacity-bound private handout; no legacy employee mapping'),E'\n ' order by bucket,kind,identity)
 into roots from coverall_link_new_recovery where kind in('relation','column_set','relation_state','function','grant');
 surface:=replace(surface_before,'  values','  values'||E'\n '||roots);
 execute surface;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from coverall_link_new_recovery order by bucket,kind,identity loop
  -- Maintained bounded first-unused allocation tolerates existing high
  -- sentinel rows without moving any preserved restore order.
  select n into next_order from generate_series(obj.bucket+1,
   case when obj.bucket=1000 then 99999 else obj.bucket+99999 end) n
   where not exists(select 1 from public.custodial_release_authority_restore_inventory i where i.restore_order=n)
   order by n limit 1;
  if next_order is null then raise exception 'Canonical CoverAll recovery bucket exhausted: kind=% bucket=%',obj.kind,obj.bucket;end if;
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 end loop;
 update public.custodial_release_authority_restore_inventory
  set definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
   definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),captured_at=statement_timestamp()
  where case when object_kind='function' then to_regprocedure(object_identity) else null end='public.custodial_release_canary_authority_surface()'::regprocedure;
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Exact canary recovery row changed';end if;
 alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
 if exists(select 1 from coverall_link_new_recovery n left join public.custodial_release_authority_restore_inventory i
   on i.object_kind=n.kind and i.object_identity=n.identity
   where i.definition_sql is distinct from n.definition or i.definition_sha256 is distinct from public.static_weekly_digest_text(n.definition)) then
  raise exception 'Canonical CoverAll recovery readback mismatch';end if;
 if exists(select b.* from coverall_link_recovery_before b where not(case when b.object_kind='function' then to_regprocedure(b.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure else false end)
   except select * from public.custodial_release_authority_restore_inventory)
  or exists(select i.* from public.custodial_release_authority_restore_inventory i
   where not(case when i.object_kind='function' then to_regprocedure(i.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure else false end)
    and not exists(select 1 from coverall_link_new_recovery n where i.object_kind=n.kind and i.object_identity=n.identity)
   except select * from coverall_link_recovery_before) then
  raise exception 'Unrelated recovery inventory changed';end if;
 if exists(select 1 from coverall_link_new_recovery n where n.kind in('relation','column_set','relation_state','function','grant')
   and not exists(select 1 from public.custodial_release_canary_authority_surface() s where s.object_kind=n.kind and s.object_identity=n.identity)) then
  raise exception 'Canonical CoverAll canary roots incomplete';end if;
end $capture_new$;
commit;
