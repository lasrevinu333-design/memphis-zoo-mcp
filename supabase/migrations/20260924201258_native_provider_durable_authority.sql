-- New unapplied provider foundation. No historical lineage backfill or client table access.
-- Typed HTTP attestation and provider-only fresh clock response admission remain separate
-- implementation gates; this migration alone is not delivery/release readiness.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create function public.custodial_native_provider_app_valid(a jsonb)
returns boolean language sql immutable set search_path=pg_catalog,public as $fn$
 select case when jsonb_typeof(a)='object' then
  (select array_agg(k order by k) from jsonb_object_keys(a) k)=array['build_id','package_name','version_code','version_name']
  and a->'package_name'='"org.memphiszoo.custodial"'::jsonb
  and jsonb_typeof(a->'version_name')='string' and length(a->>'version_name') between 1 and 64
  and a->>'version_name'=btrim(a->>'version_name') and a->>'version_name' !~ '[[:cntrl:]]'
  and jsonb_typeof(a->'build_id')='string' and a->>'build_id' ~ '^[A-Za-z0-9._-]{1,200}$'
  and a->>'build_id' ~ '[.]custodial[.][0-9a-f]{12}$'
  and jsonb_typeof(a->'version_code')='number' and a->>'version_code' ~ '^[1-9][0-9]{0,9}$'
  and (a->>'version_code')::numeric between 1 and 2100000000
 else false end;
$fn$;

create table public.employee_native_push_generations (
 generation_id uuid primary key,
 operation_id uuid not null unique,
 registration_id uuid not null references public.employee_push_registrations(registration_id),
 device_id uuid not null references public.devices(id),
 device_identifier text not null,
 credential_id uuid not null references public.device_auth_credentials(credential_id),
 employee_id uuid not null references public.employees(id),
 assignment_epoch bigint not null check(assignment_epoch between 1 and 9007199254740991),
 principal_digest text not null check(principal_digest ~ '^[0-9a-f]{64}$'),
 token_digest text not null check(token_digest ~ '^[0-9a-f]{64}$'),
 native_app jsonb not null check(public.custodial_native_provider_app_valid(native_app) is true),
 request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
 first_native_request_id uuid not null unique,
 first_attestation_digest text not null check(first_attestation_digest ~ '^[0-9a-f]{64}$'),
 activated_at timestamptz not null check(isfinite(activated_at)),
 prior_generation_id uuid references public.employee_native_push_generations(generation_id),
 prior_dispatch_retired_at timestamptz,
 dispatch_retired_at timestamptz,
 revoked_at timestamptz,
 constraint native_provider_prior_boundary check(
  (prior_generation_id is null and prior_dispatch_retired_at is null)
  or (prior_generation_id is not null and prior_dispatch_retired_at is not null and prior_generation_id<>generation_id and prior_dispatch_retired_at=activated_at)),
 constraint native_provider_retirement_boundary check(dispatch_retired_at is null or (isfinite(dispatch_retired_at) and dispatch_retired_at>=activated_at)),
 constraint native_provider_revocation_boundary check(revoked_at is null or (isfinite(revoked_at) and dispatch_retired_at is not null and revoked_at>=dispatch_retired_at))
);
create unique index employee_native_push_one_active_device on public.employee_native_push_generations(device_id)
 where dispatch_retired_at is null and revoked_at is null;
create index employee_native_push_generation_registration on public.employee_native_push_generations(registration_id);
create index employee_native_push_generation_credential on public.employee_native_push_generations(credential_id);
create index employee_native_push_generation_employee on public.employee_native_push_generations(employee_id);
create index employee_native_push_generation_prior on public.employee_native_push_generations(prior_generation_id) where prior_generation_id is not null;
alter table public.employee_native_push_generations enable row level security;
alter table public.employee_native_push_generations force row level security;
revoke all on public.employee_native_push_generations from public,anon,authenticated,service_role,
 static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

create function public.custodial_native_provider_generation_guard()
returns trigger language plpgsql set search_path=pg_catalog,public as $fn$
begin
 if tg_op='DELETE' then raise exception 'native provider generation history is retained'; end if;
 if (to_jsonb(new)-array['dispatch_retired_at','revoked_at']) is distinct from
    (to_jsonb(old)-array['dispatch_retired_at','revoked_at'])
  or (old.dispatch_retired_at is not null and new.dispatch_retired_at is distinct from old.dispatch_retired_at)
  or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
 then raise exception 'native provider generation binding is immutable'; end if;
 return new;
end $fn$;
create trigger trg_native_provider_generation_guard before update or delete on public.employee_native_push_generations
 for each row execute function public.custodial_native_provider_generation_guard();
alter table public.employee_native_push_generations enable always trigger trg_native_provider_generation_guard;

-- Legacy registration remains usable for nonprotected senders, but a changed token,
-- recipient or active state can never leave the old protected generation dispatchable.
create function public.custodial_native_provider_registration_changed()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare at_time timestamptz:=clock_timestamp(); foreign_binding boolean;
begin
 foreign_binding := (new.device_id,new.credential_id,new.employee_id,new.assignment_epoch,new.platform)
  is distinct from (old.device_id,old.credential_id,old.employee_id,old.assignment_epoch,old.platform)
  or ((new.active is not true or new.revoked_at is not null) and new.revoked_reason is distinct from 'token_rotated');
 if foreign_binding or new.active is not true or new.revoked_at is not null
  or new.token_hash is distinct from old.token_hash or new.fcm_token is distinct from old.fcm_token then
  update public.employee_native_push_generations set dispatch_retired_at=coalesce(dispatch_retired_at,at_time),
   revoked_at=case when foreign_binding then coalesce(revoked_at,at_time) else revoked_at end
   where registration_id=old.registration_id and revoked_at is null;
 end if;
 return new;
end $fn$;
create trigger trg_native_provider_registration_changed after update on public.employee_push_registrations
 for each row execute function public.custodial_native_provider_registration_changed();

-- This JSON is the original immutable registration binding, not new clock authority.
create function public.custodial_native_provider_generation_json(g public.employee_native_push_generations,replayed boolean)
returns jsonb language sql volatile set search_path=pg_catalog,public as $fn$
 select jsonb_build_object('schema','custodial.native-provider-registration.v1','operation_id',g.operation_id,
  'generation_id',g.generation_id,'registration_id',g.registration_id,'principal_digest',g.principal_digest,
  'token_digest',g.token_digest,'device_id',g.device_identifier,'credential_id',g.credential_id,'employee_id',g.employee_id,
  'assignment_epoch',g.assignment_epoch,'native_app',g.native_app,
  'activated_at',to_char(g.activated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'prior_generation_id',g.prior_generation_id,
  'prior_dispatch_retired_at',to_char(g.prior_dispatch_retired_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'server_now',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'admitted_state','ACTIVE','replayed',replayed);
$fn$;

-- Service-only SQL boundary behind the future four exact native-attested HTTP routes.
-- p_credential_hash is verified existing Device credential hash, never FCM token digest.
create function public.custodial_native_provider_registration(p_credential uuid,p_credential_hash text,
 p_native_request uuid,p_attestation_digest text,p_body jsonb,p_status boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $fn$
declare d public.devices%rowtype; c public.device_auth_credentials%rowtype;
 r public.employee_push_registrations%rowtype; g public.employee_native_push_generations%rowtype;
 prior public.employee_native_push_generations%rowtype; expected_keys text[]; fingerprint text; at_time timestamptz;
 operation uuid; generation uuid; token text;
begin
 perform public.custodial_begin_application_mutation();
 if p_status is null or p_native_request is null or p_attestation_digest is null
  or p_attestation_digest !~ '^[0-9a-f]{64}$' or p_credential is null or p_credential_hash is null
  or p_credential_hash !~ '^[0-9a-f]{64}$' or p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>65536
 then raise exception using errcode='22023',message='exact bounded native provider request required'; end if;
 expected_keys:=array['assignment_epoch','credential_id','device_id','employee_id','generation_id','native_app','operation_id','principal_digest','schema','token_digest'];
 if not p_status then expected_keys:=array_append(expected_keys,'token'); end if;
 if (select array_agg(k order by k) from jsonb_object_keys(p_body) k) is distinct from
   (select array_agg(k order by k) from unnest(expected_keys) k)
  or p_body->>'schema' is distinct from (case when p_status then 'custodial.native-provider-status.v1' else 'custodial.native-provider-register.v1' end)
  or p_body->>'credential_id' is distinct from p_credential::text
  or coalesce(p_body->>'operation_id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or coalesce(p_body->>'generation_id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or coalesce(p_body->>'employee_id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or coalesce(p_body->>'principal_digest','') !~ '^[0-9a-f]{64}$'
  or coalesce(p_body->>'token_digest','') !~ '^[0-9a-f]{64}$'
  or jsonb_typeof(p_body->'assignment_epoch') is distinct from 'number'
  or coalesce(p_body->>'assignment_epoch','') !~ '^[1-9][0-9]{0,15}$'
  or public.custodial_native_provider_app_valid(p_body->'native_app') is not true
 then raise exception using errcode='22023',message='native provider request binding invalid'; end if;
 if (p_body->>'assignment_epoch')::numeric>9007199254740991 then raise exception 'native provider epoch out of range'; end if;
 for token in select unnest(array['schema','operation_id','generation_id','credential_id','device_id','employee_id','principal_digest','token_digest']) loop
  if jsonb_typeof(p_body->token) is distinct from 'string' then raise exception 'native provider string field required'; end if;
 end loop;
 if not p_status then
  token:=p_body->>'token';
  if jsonb_typeof(p_body->'token') is distinct from 'string' or octet_length(token) not between 20 and 4096
   or token ~ '[[:cntrl:]]' or encode(extensions.digest(convert_to(token,'UTF8'),'sha256'),'hex') is distinct from p_body->>'token_digest'
  then raise exception 'native provider token binding invalid'; end if;
 end if;
 operation:=(p_body->>'operation_id')::uuid; generation:=(p_body->>'generation_id')::uuid;
 fingerprint:=public.static_weekly_digest_text((p_body-array['schema','token'])::text);
 -- Device, registration, generation order; never hold this transaction across FCM.
 select d0.* into d from public.devices d0 join public.device_auth_credentials c0 on c0.device_id=d0.id
  where c0.credential_id=p_credential for update of d0;
 select * into c from public.device_auth_credentials where credential_id=p_credential for update;
 if d.id is null or d.active is not true or c.device_id is distinct from d.id or c.token_hash is distinct from p_credential_hash
  or c.confirmed_at is null or c.revoked_at is not null or c.expires_at<=clock_timestamp()
  or d.device_id is distinct from p_body->>'device_id' or d.assigned_employee_id::text is distinct from p_body->>'employee_id'
  or d.assignment_epoch is distinct from (p_body->>'assignment_epoch')::bigint
  or not exists(select 1 from public.employees where id=d.assigned_employee_id and active and employee_code ~ '^EMP[0-9]+$')
 then raise exception using errcode='42501',message='current assigned native provider credential required'; end if;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for update;
 select * into g from public.employee_native_push_generations where operation_id=operation for update;
 if g.generation_id is not null then
  if g.generation_id<>generation or g.request_fingerprint<>fingerprint or g.device_id<>d.id
   then raise exception using errcode='23505',message='native provider original operation binding conflict'; end if;
  return public.custodial_native_provider_generation_json(g,true);
 end if;
 if p_status then raise exception using errcode='P0002',message='native provider original operation unknown'; end if;
 select * into prior from public.employee_native_push_generations where device_id=d.id
  and dispatch_retired_at is null and revoked_at is null for update;
 at_time:=clock_timestamp();
 if prior.generation_id is not null then
  update public.employee_native_push_generations set dispatch_retired_at=at_time where generation_id=prior.generation_id;
 end if;
 r:=public.mz_register_employee_push(p_credential,token,p_body->>'token_digest','android',
  p_body#>>'{native_app,version_name}',p_body#>>'{native_app,build_id}');
 insert into public.employee_native_push_generations(generation_id,operation_id,registration_id,device_id,device_identifier,
  credential_id,employee_id,assignment_epoch,principal_digest,token_digest,native_app,request_fingerprint,
  first_native_request_id,first_attestation_digest,activated_at,prior_generation_id,prior_dispatch_retired_at)
 values(generation,operation,r.registration_id,d.id,d.device_id,p_credential,d.assigned_employee_id,d.assignment_epoch,
  p_body->>'principal_digest',p_body->>'token_digest',p_body->'native_app',fingerprint,p_native_request,p_attestation_digest,at_time,
  prior.generation_id,case when prior.generation_id is not null then at_time end) returning * into g;
 return public.custodial_native_provider_generation_json(g,false);
end $fn$;

do $acl$ declare f regprocedure; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and starts_with(p.proname,'custodial_native_provider_') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',f);
 end loop;
end $acl$;
grant execute on function public.custodial_native_provider_registration(uuid,text,uuid,text,jsonb,boolean) to service_role;

do $surface$ declare d text; additions text; begin
 d:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (length(d)-length(replace(d,'  values','')))/length('  values')<>1 then raise exception 'native provider canary seam missing'; end if;
 select string_agg(format('(%L,%L,%L),','function',p.oid::regprocedure::text,'native provider generation authority'),E'\n'
  order by p.proname,pg_get_function_identity_arguments(p.oid)) into additions
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and starts_with(p.proname,'custodial_native_provider_');
 additions:=additions||E'\n'||$rows$('relation','public.employee_native_push_generations','private provider generations'),
 ('trigger','public.employee_native_push_generations.trg_native_provider_generation_guard','immutable provider binding'),
 ('trigger','public.employee_native_push_generations.custodial_disaster_restore_mutation_fence','provider restore fence'),
 ('trigger','public.employee_push_registrations.trg_native_provider_registration_changed','legacy provider invalidation'),
 $rows$;
 execute replace(d,'  values','  values'||E'\n'||additions);
end $surface$;

alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$ declare obj record; next_order integer; relation_name text:='public.employee_native_push_generations'; begin
 for obj in with funcs as (
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
   (starts_with(p.proname,'custodial_native_provider_') or p.oid='public.custodial_release_canary_authority_surface()'::regprocedure)
 ), objects as (
  select 1000 bucket,'relation'::text kind,relation_name identity,public.custodial_release_authority_current_relation_definition(relation_name) definition
  union all select 100000,'function',oid::regprocedure::text,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',relation_name||':'||attname,public.custodial_release_authority_current_column_definition(relation_name||':'||attname)
   from pg_attribute where attrelid=relation_name::regclass and attnum>0 and not attisdropped
  union all select 300000,'column_set',relation_name,public.custodial_release_authority_current_column_set_definition(relation_name)
  union all select 400000,'relation_state',relation_name,public.custodial_release_authority_current_relation_state_definition(relation_name)
  union all select 500000,'constraint',relation_name||':'||conname,public.custodial_release_authority_current_constraint_definition(relation_name||':'||conname)
   from pg_constraint where conrelid=relation_name::regclass
  union all select 600000,'index','public.'||quote_ident(ci.relname),public.custodial_release_authority_current_index_definition('public.'||quote_ident(ci.relname))
   from pg_index i join pg_class ci on ci.oid=i.indexrelid where i.indrelid=relation_name::regclass
    and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
  union all select 700000,'trigger',quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname),
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'; '
   ||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||' '
   ||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
   ||' trigger '||quote_ident(t.tgname)||';'
   from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace
   where not t.tgisinternal and (t.tgrelid=relation_name::regclass or
    (t.tgrelid='public.employee_push_registrations'::regclass and t.tgname='trg_native_provider_registration_changed'))
  union all select 900000,'grant',relation_name,public.custodial_release_authority_current_grant_definition(relation_name)
  union all select 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing native provider recovery object %',obj.identity; end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or
    case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
     then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
