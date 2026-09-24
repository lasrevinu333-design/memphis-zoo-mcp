-- Current authenticated legacy installation observation; never historical enrollment
-- or frozen-work successor authority. The v1 receipt and predecessor RPCs stay unchanged.
begin;
create table public.custodial_activation_legacy_lineage_bindings (
 binding_id uuid primary key default gen_random_uuid(),
 activation_operation_id uuid not null unique references public.custodial_assigned_activation_operations(operation_id),
 binding_kind text not null check(binding_kind in ('confirmed_enrollment_operation','authenticated_legacy_installation_observation')),
 device_id uuid not null references public.devices(id),
 authenticated_credential_id uuid not null references public.device_auth_credentials(credential_id),
 installation_binding_sha256 text not null check(installation_binding_sha256 ~ '^[0-9a-f]{64}$'),
 source_enrollment_operation_id uuid references public.device_auth_enrollment_operations(operation_id),
 current_recovery_operation_id uuid references public.device_auth_enrollment_operations(operation_id),
 expected_employee_id uuid not null references public.employees(id),
 expected_assignment_epoch bigint not null check(expected_assignment_epoch between 1 and 9007199254740991),
 native_request_id uuid not null unique,
 native_request_attestation_sha256 text not null check(native_request_attestation_sha256 ~ '^[0-9a-f]{64}$'),
 observed_at timestamptz not null default clock_timestamp(),
 constraint legacy_binding_kind_authority check(
  (binding_kind='confirmed_enrollment_operation' and source_enrollment_operation_id is not null and current_recovery_operation_id is null)
  or (binding_kind='authenticated_legacy_installation_observation' and source_enrollment_operation_id is null
   and (current_recovery_operation_id is null or current_recovery_operation_id=activation_operation_id)))
);
alter table public.custodial_activation_legacy_lineage_bindings enable row level security;
alter table public.custodial_activation_legacy_lineage_bindings force row level security;
revoke all on public.custodial_activation_legacy_lineage_bindings from public,anon,authenticated,service_role,
 static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

create function public.custodial_legacy_activation_guard()
 returns trigger language plpgsql set search_path=pg_catalog,public as $fn$
begin raise exception 'legacy installation observations are immutable'; end $fn$;
create trigger trg_custodial_legacy_activation_guard before update or delete
 on public.custodial_activation_legacy_lineage_bindings for each row execute function public.custodial_legacy_activation_guard();

-- Private helper: same fence and lock order as the unchanged v1 activation path.
-- A terminal observation is usable only while the same current credential and
-- assignment still authenticate; it never follows a predecessor/successor edge.
create function public.custodial_legacy_activation_context(p_operation uuid,p_device uuid,p_credential uuid,p_token_hash text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare d public.devices%rowtype; a public.custodial_assigned_activation_operations%rowtype;
 c public.device_auth_credentials%rowtype; e public.device_auth_enrollment_operations%rowtype;
 original uuid; recovery uuid; kind text:='authenticated_legacy_installation_observation';
begin
 perform public.custodial_begin_application_mutation();
 if p_operation is null or p_device is null or p_credential is null then raise exception 'exact legacy activation identity required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('custodial-enrollment-operation:'||p_operation::text,0));
 select * into strict d from public.devices where id=p_device for update;
 perform public.custodial_activation_expire_device(p_device);
 select * into strict a from public.custodial_assigned_activation_operations where operation_id=p_operation for update;
 select * into c from public.device_auth_credentials where credential_id=p_credential and device_id=p_device
  and token_hash=p_token_hash and confirmed_at is not null and revoked_at is null and expires_at>now() for update;
 if c.credential_id is null or a.device_id is distinct from p_device or d.active is not true
  or a.expected_employee_id is distinct from d.assigned_employee_id or a.expected_assignment_epoch is distinct from d.assignment_epoch
  or not exists(select 1 from public.employees where id=d.assigned_employee_id and active and employee_code ~ '^EMP[0-9]+$')
  then raise exception using errcode='42501',message='current exact assigned legacy credential required'; end if;
 if a.state not in ('prepared','delivered','delivery_unknown','native_active','not_required') or a.claimant_credential_id is null
  then raise exception 'legacy activation is not pending or accepted'; end if;
 select * into e from public.device_auth_enrollment_operations where operation_id=p_operation;
 if e.operation_id is not null then
  if e.device_id is distinct from p_device or e.credential_id is distinct from p_credential
   or e.flow<>'recovery' or e.status<>'confirmed' or e.enrollment_id is distinct from a.enrollment_id
   then raise exception 'legacy recovery requires exact confirmed replacement'; end if;
  recovery:=p_operation;
 else
  if c.created_at>=a.requested_at or not exists(select 1 from public.device_auth_enrollment_codes
    where enrollment_id=a.enrollment_id and consumed_at is null)
   then raise exception 'legacy healthy activation must retain an existing credential'; end if;
  -- Only the exact current credential metadata may point to original proof.
  -- Merely finding a nearby enrollment for the device is not authority.
  select operation_id into original from public.device_auth_enrollment_operations
   where operation_id::text=c.metadata_json->>'enrollment_operation_id'
    and device_id=p_device and credential_id=p_credential and flow='enrollment' and status='confirmed';
  if original is not null then kind:='confirmed_enrollment_operation'; end if;
 end if;
 return jsonb_build_object('binding_kind',kind,'activation_operation_id',p_operation,'device_id',d.device_id,
  'credential_id',p_credential,'source_enrollment_operation_id',original,'current_recovery_operation_id',recovery,
  'employee_id',a.expected_employee_id,'assignment_epoch',a.expected_assignment_epoch,'state',a.state);
end $fn$;

create function public.custodial_legacy_activation_binding_json(p_row public.custodial_activation_legacy_lineage_bindings)
 returns jsonb language sql stable set search_path=pg_catalog,public as $fn$
 select jsonb_build_object('schema_version','custodial-legacy-lineage-binding.v1','binding_id',p_row.binding_id,
  'binding_kind',p_row.binding_kind,'activation_operation_id',p_row.activation_operation_id,
  'device_id',(select device_id from public.devices where id=p_row.device_id),
  'credential_id',p_row.authenticated_credential_id,'installation_binding_sha256',p_row.installation_binding_sha256,
  'source_enrollment_operation_id',p_row.source_enrollment_operation_id,'current_recovery_operation_id',p_row.current_recovery_operation_id,
  'employee_id',p_row.expected_employee_id,'assignment_epoch',p_row.expected_assignment_epoch,
  'server_observed_at',to_char(p_row.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
$fn$;

create function public.custodial_legacy_activation_bind(p_operation uuid,p_device uuid,p_credential uuid,p_token_hash text,
 p_installation_digest text,p_native_request uuid,p_attestation_digest text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare authority jsonb; b public.custodial_activation_legacy_lineage_bindings%rowtype;
begin
 authority:=public.custodial_legacy_activation_context(p_operation,p_device,p_credential,p_token_hash);
 if p_installation_digest is null or p_installation_digest !~ '^[0-9a-f]{64}$' or p_native_request is null
  or p_attestation_digest is null or p_attestation_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'exact native installation attestation required'; end if;
 select * into b from public.custodial_activation_legacy_lineage_bindings where activation_operation_id=p_operation;
 if b.binding_id is not null then
  if (b.device_id,b.authenticated_credential_id,b.installation_binding_sha256,b.binding_kind,b.source_enrollment_operation_id,
    b.current_recovery_operation_id,b.expected_employee_id,b.expected_assignment_epoch)
   is distinct from (p_device,p_credential,p_installation_digest,authority->>'binding_kind',
    (authority->>'source_enrollment_operation_id')::uuid,(authority->>'current_recovery_operation_id')::uuid,
    (authority->>'employee_id')::uuid,(authority->>'assignment_epoch')::bigint)
   then raise exception 'legacy installation binding conflict'; end if;
  return public.custodial_legacy_activation_binding_json(b);
 end if;
 if authority->>'state' not in ('prepared','delivered','delivery_unknown')
  then raise exception 'cannot create legacy binding for terminal operation'; end if;
 insert into public.custodial_activation_legacy_lineage_bindings(activation_operation_id,binding_kind,device_id,
  authenticated_credential_id,installation_binding_sha256,source_enrollment_operation_id,current_recovery_operation_id,
  expected_employee_id,expected_assignment_epoch,native_request_id,native_request_attestation_sha256)
 values(p_operation,authority->>'binding_kind',p_device,p_credential,p_installation_digest,
  (authority->>'source_enrollment_operation_id')::uuid,(authority->>'current_recovery_operation_id')::uuid,
  (authority->>'employee_id')::uuid,(authority->>'assignment_epoch')::bigint,p_native_request,p_attestation_digest)
 returning * into b;
 return public.custodial_legacy_activation_binding_json(b);
end $fn$;

create function public.custodial_legacy_activation_result(p_operation uuid,p_device uuid,p_credential uuid,p_token_hash text,p_receipt jsonb)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare authority jsonb; a public.custodial_assigned_activation_operations%rowtype;
 b public.custodial_activation_legacy_lineage_bindings%rowtype; outcome text; recovery boolean;
begin
 authority:=public.custodial_legacy_activation_context(p_operation,p_device,p_credential,p_token_hash);
 select * into strict a from public.custodial_assigned_activation_operations where operation_id=p_operation;
 select * into strict b from public.custodial_activation_legacy_lineage_bindings where activation_operation_id=p_operation;
 if (b.device_id,b.authenticated_credential_id,b.binding_kind,b.source_enrollment_operation_id,b.current_recovery_operation_id,
    b.expected_employee_id,b.expected_assignment_epoch) is distinct from
   (p_device,p_credential,authority->>'binding_kind',(authority->>'source_enrollment_operation_id')::uuid,
    (authority->>'current_recovery_operation_id')::uuid,(authority->>'employee_id')::uuid,(authority->>'assignment_epoch')::bigint)
  then raise exception 'current legacy binding authority conflict'; end if;
 recovery:=b.current_recovery_operation_id is not null;
 outcome:=case when recovery then 'native_active' else 'not_required' end;
 if p_receipt is null or jsonb_typeof(p_receipt)<>'object' or pg_column_size(p_receipt)>2048
  or (select count(*) from jsonb_object_keys(p_receipt))<>11
  or p_receipt->>'operation_id' is distinct from p_operation::text
  or p_receipt->>'device_id' is distinct from authority->>'device_id'
  or p_receipt->>'credential_id' is distinct from p_credential::text
  or p_receipt->>'outcome' is distinct from (case when recovery then 'active' else 'not_required' end)
  or p_receipt->'changed' is distinct from to_jsonb(recovery)
  or p_receipt->>'transition' is distinct from (case when recovery then 'confirmed_recovery' else 'healthy_no_change' end)
  or p_receipt->>'journal_schema' is distinct from 'native-assigned-activation-legacy.v1'
  or coalesce(p_receipt->>'journal_binding_sha256','') !~ '^[0-9a-f]{64}$'
  or p_receipt->>'legacy_binding_id' is distinct from b.binding_id::text
  or p_receipt->>'legacy_binding_kind' is distinct from b.binding_kind
  or p_receipt->>'installation_binding_sha256' is distinct from b.installation_binding_sha256
  then raise exception 'exact bounded legacy native receipt required'; end if;
 if a.state in ('native_active','not_required') then
  if a.native_receipt is distinct from p_receipt or a.state<>outcome then raise exception 'legacy terminal receipt conflict'; end if;
 else
  update public.device_auth_enrollment_codes set revoked_at=coalesce(revoked_at,now())
   where enrollment_id=a.enrollment_id and consumed_at is null;
  update public.custodial_assigned_activation_operations set state=outcome,state_version=state_version+1,
   native_receipt=p_receipt,terminal_at=now(),token_envelope=null,last_error_code=null
   where operation_id=p_operation returning * into a;
 end if;
 -- SHA of exact stored jsonb receipt is server-owned terminal identity, not
 -- native journal digest. The HTTPS response includes the exact receipt too.
 return jsonb_build_object('status',public.custodial_activation_public_status(a),
  'binding',public.custodial_legacy_activation_binding_json(b),
  'activation_receipt_sha256',public.static_weekly_digest_text(a.native_receipt::text));
end $fn$;

do $acl$
declare f regprocedure;
begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and starts_with(p.proname,'custodial_legacy_activation_')
 loop execute format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',f); end loop;
end $acl$;
grant execute on function public.custodial_legacy_activation_bind(uuid,uuid,uuid,text,text,uuid,text),
 public.custodial_legacy_activation_result(uuid,uuid,uuid,text,jsonb) to service_role;
do $surface$
declare d text; additions text;
begin
 d:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (length(d)-length(replace(d,'  values','')))/length('  values')<>1 then raise exception 'activation canary surface seam missing'; end if;
 -- Definition bytes must be identical in a clean replay and the atomic release
 -- transaction. Catalog scan/OID order is not a stable source identity.
 select string_agg(format('(%L,%L,%L),','function',p.oid::regprocedure::text,'current legacy installation observation'),E'\n'
  order by p.proname,pg_get_function_identity_arguments(p.oid)) into additions
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and starts_with(p.proname,'custodial_legacy_activation_');
 additions:=additions||E'\n'||format('(%L,%L,%L),','relation','public.custodial_activation_legacy_lineage_bindings','private legacy installation binding')
  ||E'\n'||format('(%L,%L,%L),','trigger','public.custodial_activation_legacy_lineage_bindings.trg_custodial_legacy_activation_guard','immutable current legacy observation')
  ||E'\n'||format('(%L,%L,%L),','trigger','public.custodial_activation_legacy_lineage_bindings.custodial_disaster_restore_mutation_fence','pause activation writes during disaster restore');
 execute replace(d,'  values','  values'||E'\n'||additions);
end $surface$;

alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record; next_order integer; relation_name text:='public.custodial_activation_legacy_lineage_bindings';
begin
 for obj in with funcs as (
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
   (starts_with(p.proname,'custodial_legacy_activation_') or p.oid in (
    'public.custodial_release_canary_authority_surface()'::regprocedure))
 ), objects as (
  select 1000 bucket,'relation'::text kind,relation_name identity,
   public.custodial_release_authority_current_relation_definition(relation_name) definition
  union all select 100000,'function',oid::regprocedure::text,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',relation_name||':'||attname,
   public.custodial_release_authority_current_column_definition(relation_name||':'||attname)
   from pg_attribute where attrelid=relation_name::regclass and attnum>0 and not attisdropped
  union all select 300000,'column_set',relation_name,public.custodial_release_authority_current_column_set_definition(relation_name)
  union all select 400000,'relation_state',relation_name,public.custodial_release_authority_current_relation_state_definition(relation_name)
  union all select 500000,'constraint',relation_name||':'||conname,
   public.custodial_release_authority_current_constraint_definition(relation_name||':'||conname)
   from pg_constraint where conrelid=relation_name::regclass
  union all select 600000,'index','public.'||quote_ident(ci.relname),
   public.custodial_release_authority_current_index_definition('public.'||quote_ident(ci.relname))
   from pg_index i join pg_class ci on ci.oid=i.indexrelid
   where i.indrelid=relation_name::regclass and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
  union all select 700000,'trigger',quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname),
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'; '
    ||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||' '
    ||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
    ||' trigger '||quote_ident(t.tgname)||';'
   from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace
   where not t.tgisinternal and t.tgrelid=relation_name::regclass
  union all select 900000,'grant',relation_name,public.custodial_release_authority_current_grant_definition(relation_name)
  union all select 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing activation recovery object %',obj.identity; end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or
    case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
     then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
   insert into public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
