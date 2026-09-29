-- Correct captured recovery definitions after the GPS and recurring additions.
-- Keep all prior migration bytes, business rows, authority checks and history.
-- The backend invokes the SECURITY DEFINER tool wrapper, not the GPS helper.
-- Only that wrapper retains service-role EXECUTE; the internal implementation
-- must not remain a separately callable writer to scan_events.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;

-- Refuse to seal a different implementation or a changed wrapper boundary.
do $preflight$
declare candidate record;actual text;
begin
 for candidate in select * from (values
  ('public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)',
   '7fa82fecdbafc4f2da58fc2996cdda75b8949a793846dc6fb6d54518be01a706'),
  ('public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)',
   '2e2e6b4765cb956956b79d048bf2b8b4f13b33791dd0cde456abbee70f97801d')
 ) expected(signature,digest) loop
  select encode(extensions.digest(convert_to(pg_get_functiondef(candidate.signature::regprocedure),'UTF8'),'sha256'),'hex') into actual;
  if actual is distinct from candidate.digest then raise exception 'recovery closure predecessor changed: %',candidate.signature;end if;
  if not (select p.prosecdef from pg_proc p where p.oid=candidate.signature::regprocedure) then
   raise exception 'GPS definer boundary changed';end if;
 end loop;
 if not has_function_privilege('service_role','public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)','EXECUTE')
  or has_function_privilege('anon','public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)','EXECUTE')
  or has_function_privilege('authenticated','public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)','EXECUTE') then
  raise exception 'existing GPS tool privilege boundary changed';end if;
 if (select count(*) from pg_attribute where attrelid='public.location_proximity_settings'::regclass
    and attname in ('authority_radius_m','authority_surveyed_at') and attnum>0 and not attisdropped and not attnotnull)<>2 then
  raise exception 'required exact-location GPS columns are absent or changed';end if;
 if not exists(select 1 from pg_constraint where conrelid='public.location_proximity_settings'::regclass
    and conname='location_proximity_authority_radius_bound' and convalidated) then
  raise exception 'GPS radius constraint is not present and validated';end if;
end $preflight$;

revoke execute on function public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)
 from service_role;

-- The source installation function is idempotent and covers every public
-- application table. Reconcile the fences explicitly before capturing their
-- exact definitions: an isolated restore may not have fired the DDL event
-- trigger while recreating the pending recurring tables.
select custodial_dr.install_application_mutation_fences();

lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $capture$
declare obj record;definition text;existing_id uuid;next_order integer;affected integer;
 trigger_count integer:=0;fence_count integer:=0;existing_count integer:=0;added_count integer:=0;
begin
 -- Preserve each existing row's identity and replay position. New GPS columns
 -- and their bound constraint are independently recoverable, not only present
 -- in the table CREATE statement. The measurement core precedes the evaluator,
 -- and the evaluator precedes its SQL wrapper in the function bucket.
 for obj in select * from (values
  (1000,'relation','public.location_proximity_settings','e312e08a5c6bb2a538bb2f13fd128418c7eae110164ca6e10fec80f94ebd381a'),
  (200000,'column','public.location_proximity_settings:authority_radius_m','e398ac13f5b5c2f63f9e01aac69b97404485d3566dfdc9c8c92a320a7b076d58'),
  (200000,'column','public.location_proximity_settings:authority_surveyed_at','6e5342f29d3f8ba0e30959e99e1d41e1228277bf66c7c3b88bdfe32677b1520c'),
  (300000,'column_set','public.location_proximity_settings','6f7832f1d0dbce4ec3df23353ef40a740d4a9dae738fd19d651ba6180fec1734'),
  (500000,'constraint','public.location_proximity_settings:location_proximity_authority_radius_bound','f1492a175e016d528c744c5a81e605b040fbd131484563d65347bae78eac86c0')
 ) wanted(bucket,kind,identity,expected_digest) order by bucket,identity loop
  definition:=case obj.kind
   when 'relation' then public.custodial_release_authority_current_relation_definition(obj.identity)
   when 'column' then public.custodial_release_authority_current_column_definition(obj.identity)
   when 'column_set' then public.custodial_release_authority_current_column_set_definition(obj.identity)
   when 'constraint' then public.custodial_release_authority_current_constraint_definition(obj.identity) end;
  if definition is null then raise exception 'missing required recovery object %',obj.identity;end if;
  if public.static_weekly_digest_text(definition) is distinct from obj.expected_digest then
   raise exception 'refusing to capture changed GPS structure: %',obj.identity;end if;
  select inventory_id into existing_id from public.custodial_release_authority_restore_inventory
   where object_kind=obj.kind and object_identity=obj.identity;
  if found then
   update public.custodial_release_authority_restore_inventory set definition_sql=definition,
    definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp() where inventory_id=existing_id;
   existing_count:=existing_count+1;
  else
   select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<obj.bucket+100000;
   if next_order>=obj.bucket+100000 then raise exception 'recovery bucket exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,definition,public.static_weekly_digest_text(definition));
   added_count:=added_count+1;
  end if;
 end loop;
 if existing_count+added_count<>5 then raise exception 'GPS structural inventory incomplete';end if;

 for obj in select * from (values
  ('public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)'::text,1),
  ('public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)'::text,2)
 ) wanted(signature,ordinal) order by ordinal loop
  -- Use the identity which the health renderer will actually receive.
  for definition in select pg_get_functiondef(obj.signature::regprocedure) loop
   select inventory_id into existing_id from public.custodial_release_authority_restore_inventory
    where object_kind='function' and object_identity like '%(%' and to_regprocedure(object_identity)=obj.signature::regprocedure;
   if found then
    update public.custodial_release_authority_restore_inventory set definition_sql=definition,
     definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp() where inventory_id=existing_id;
   else
    select coalesce(max(restore_order),100000)+1 into next_order from public.custodial_release_authority_restore_inventory
     where restore_order>=100000 and restore_order<200000;
    if next_order>=200000 then raise exception 'function recovery bucket exhausted';end if;
    insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
     values(next_order,'function',obj.signature::regprocedure::text,definition,public.static_weekly_digest_text(definition));
   end if;
  end loop;
  select inventory_id into existing_id from public.custodial_release_authority_restore_inventory
   where object_kind='grant' and object_identity like '%(%' and to_regprocedure(object_identity)=obj.signature::regprocedure;
  if found then
   select public.custodial_release_authority_current_grant_definition(object_identity) into definition
    from public.custodial_release_authority_restore_inventory where inventory_id=existing_id;
   update public.custodial_release_authority_restore_inventory set definition_sql=definition,
    definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp() where inventory_id=existing_id;
  else
   definition:=public.custodial_release_authority_current_grant_definition(obj.signature::regprocedure::text);
   if definition is null then raise exception 'GPS grant capture missing';end if;
   select coalesce(max(restore_order),1000000)+1 into next_order from public.custodial_release_authority_restore_inventory
    where object_kind='grant' and restore_order>=1000000;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,'grant',obj.signature::regprocedure::text,definition,public.static_weekly_digest_text(definition));
  end if;
 end loop;

 -- Disaster-restore fences were installed after the recurring-table captures.
 -- Admit only the ten exact live fence definitions missing from the inventory;
 -- the full 21-trigger pass below still verifies every digest and enabled state.
 for obj in select w.identity,w.expected_digest,t.tgenabled,
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'; '
    ||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' '
    ||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
    ||' trigger '||quote_ident(t.tgname)||';' as actual_definition
  from (values
   ('public.static_weekly_recurring_acceptance_proofs.custodial_disaster_restore_mutation_fence','0bb8b9a720b5cc9d3538b373df4dd6f6219233e6f99007a1cced57adfd8f84a2'),
   ('public.static_weekly_recurring_application_intents.custodial_disaster_restore_mutation_fence','6111dc891f51deecd432ffae0807e4944f1ceb5472ac973abb1f838f30174457'),
   ('public.static_weekly_recurring_application_receipts.custodial_disaster_restore_mutation_fence','b88ce24eb48a19eee7aeb4a7361c6701bd6060c2c5a43c426928566b6584c4f5'),
   ('public.static_weekly_recurring_dependency_changes.custodial_disaster_restore_mutation_fence','165b3eba32e22fe7303d6d2fe7c6e45923436959b598c3fe1f3c36cb8ce47c63'),
   ('public.static_weekly_recurring_dependency_checks.custodial_disaster_restore_mutation_fence','c52840433a75e989804a80b578052df4133ccf1c79ec3b1bbb98c70dc733e9d4'),
   ('public.static_weekly_recurring_invalidated_principals.custodial_disaster_restore_mutation_fence','479aa8bc06f0059fb9e4808b4a44d1d07f6d1098f6e16cfd5307a7b933ae6faf'),
   ('public.static_weekly_recurring_invalidations.custodial_disaster_restore_mutation_fence','1c67c62f769162aa919acb9e1a05db1369fdeb2f6caff27630c314e0b0659044'),
   ('public.static_weekly_recurring_publication_bindings.custodial_disaster_restore_mutation_fence','84a75a477b3e3cded660922fd84dca687b878c39172f98a7aee2ccc25e37a1f8'),
   ('public.static_weekly_recurring_terminal_intents.custodial_disaster_restore_mutation_fence','a27e95125b9f7994596c5625c440fd0f21333c6081b824094fa6051d95f82e8d'),
   ('public.static_weekly_recurring_terminal_receipts.custodial_disaster_restore_mutation_fence','458793a4447d73635de8d1de733d899fec6871b897c8d177d9508db7e837d927')
  ) w(identity,expected_digest)
  join pg_trigger t on not t.tgisinternal and t.tgname='custodial_disaster_restore_mutation_fence'
  join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where w.identity=quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'.'||quote_ident(t.tgname)
  order by w.identity loop
  if obj.tgenabled<>'O' or public.static_weekly_digest_text(obj.actual_definition) is distinct from obj.expected_digest then
   raise exception 'refusing changed recurring restore fence: %',obj.identity;end if;
  select inventory_id into existing_id from public.custodial_release_authority_restore_inventory
   where object_kind='trigger' and object_identity=obj.identity;
  if not found then
   select coalesce(max(restore_order),700000)+1 into next_order
    from public.custodial_release_authority_restore_inventory where restore_order>=700000 and restore_order<800000;
   if next_order>=800000 then raise exception 'trigger recovery bucket exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,'trigger',obj.identity,obj.actual_definition,public.static_weekly_digest_text(obj.actual_definition));
  end if;
  fence_count:=fence_count+1;
 end loop;
 if fence_count<>10 then raise exception 'expected ten exact recurring restore fences, found %',fence_count;end if;

 -- The newer recurring-table captures omitted the explicit trigger state
 -- suffix required by health and recovery. Capture exactly these 21 triggers
 -- with the same serializer used by the unchanged authority health function.
 for obj in select i.inventory_id,i.object_identity,t.tgenabled,w.expected_digest,
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'; '
    ||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' '
    ||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
    ||' trigger '||quote_ident(t.tgname)||';' as actual_definition
  from public.custodial_release_authority_restore_inventory i
  join (values ('public.static_weekly_recurring_acceptance_proofs.custodial_disaster_restore_mutation_fence','0bb8b9a720b5cc9d3538b373df4dd6f6219233e6f99007a1cced57adfd8f84a2'),('public.static_weekly_recurring_acceptance_proofs.trg_recurring_acceptance_immutable','410955458169cb0507608ae6e13ae1a48e69eb368becaa3530863aec034c0cab'),('public.static_weekly_recurring_application_intents.custodial_disaster_restore_mutation_fence','6111dc891f51deecd432ffae0807e4944f1ceb5472ac973abb1f838f30174457'),('public.static_weekly_recurring_application_intents.trg_recurring_application_immutable','f61fd200fda88ce3448396236a49e7a03c7d32cc331bbbcccbce689514609ae5'),('public.static_weekly_recurring_application_receipts.custodial_disaster_restore_mutation_fence','b88ce24eb48a19eee7aeb4a7361c6701bd6060c2c5a43c426928566b6584c4f5'),('public.static_weekly_recurring_application_receipts.trg_recurring_application_immutable','d7bcdd22f35b887955a7f03e47585ef0b098893efc5ba57d154f658e292304ad'),('public.static_weekly_recurring_dependency_changes.custodial_disaster_restore_mutation_fence','165b3eba32e22fe7303d6d2fe7c6e45923436959b598c3fe1f3c36cb8ce47c63'),('public.static_weekly_recurring_dependency_changes.trg_recurring_dependency_complete','e375eb422f58d35101c9ccd5796c1be308248cb1445d9d1c2fb20c9fc6bbc64b'),('public.static_weekly_recurring_dependency_changes.trg_recurring_dependency_immutable','3b514fb4344863d67bb4df2f04ab3c97ddb5ceef43dd4451ba02c5d5a29ce27d'),('public.static_weekly_recurring_dependency_checks.custodial_disaster_restore_mutation_fence','c52840433a75e989804a80b578052df4133ccf1c79ec3b1bbb98c70dc733e9d4'),('public.static_weekly_recurring_dependency_checks.trg_recurring_dependency_immutable','4974e31c0d87940cd15225568c6e22ab9af07787d600af4057f667d298cef582'),('public.static_weekly_recurring_invalidated_principals.custodial_disaster_restore_mutation_fence','479aa8bc06f0059fb9e4808b4a44d1d07f6d1098f6e16cfd5307a7b933ae6faf'),('public.static_weekly_recurring_invalidated_principals.trg_recurring_terminal_immutable','b080a202a54f43e11b8bbf3a1e974ad11233d44b5354634e70df2ade5c8367a9'),('public.static_weekly_recurring_invalidations.custodial_disaster_restore_mutation_fence','1c67c62f769162aa919acb9e1a05db1369fdeb2f6caff27630c314e0b0659044'),('public.static_weekly_recurring_invalidations.trg_recurring_terminal_immutable','1254e8795743b7e7f9612c1a79f0c6ca8626a7485dec09a39675991625a933f5'),('public.static_weekly_recurring_publication_bindings.custodial_disaster_restore_mutation_fence','84a75a477b3e3cded660922fd84dca687b878c39172f98a7aee2ccc25e37a1f8'),('public.static_weekly_recurring_publication_bindings.trg_recurring_publication_binding_immutable','6bfe1c079c59b027c43af9b82662c7383c61cbeb8978d8de4e294ecb87ada8d4'),('public.static_weekly_recurring_terminal_intents.custodial_disaster_restore_mutation_fence','a27e95125b9f7994596c5625c440fd0f21333c6081b824094fa6051d95f82e8d'),('public.static_weekly_recurring_terminal_intents.trg_recurring_terminal_immutable','18303dcad0a25b9ca9ad6279cd360923927a39cd7d59333803d2ca1c0a40bf1c'),('public.static_weekly_recurring_terminal_receipts.custodial_disaster_restore_mutation_fence','458793a4447d73635de8d1de733d899fec6871b897c8d177d9508db7e837d927'),('public.static_weekly_recurring_terminal_receipts.trg_recurring_terminal_immutable','09f1e3249d27fb4404767f430a49fcd30dedcae7aed6d2e9d37484ca58b84848')) w(identity,expected_digest) on w.identity=i.object_identity
  join pg_trigger t on not t.tgisinternal
  join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where i.object_kind='trigger' and i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'.'||quote_ident(t.tgname)
   and quote_ident(n.nspname)||'.'||quote_ident(c.relname)=any(array['public.static_weekly_recurring_publication_bindings','public.static_weekly_recurring_invalidated_principals','public.static_weekly_recurring_invalidations','public.static_weekly_recurring_terminal_intents','public.static_weekly_recurring_terminal_receipts','public.static_weekly_recurring_dependency_changes','public.static_weekly_recurring_dependency_checks','public.static_weekly_recurring_application_intents','public.static_weekly_recurring_application_receipts','public.static_weekly_recurring_acceptance_proofs'])
  order by i.restore_order loop
  if obj.tgenabled<>'O' then raise exception 'recurring trigger unexpectedly disabled or changed: %',obj.object_identity;end if;
  if public.static_weekly_digest_text(obj.actual_definition) is distinct from obj.expected_digest then
   raise exception 'refusing to capture changed recurring trigger: %',obj.object_identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.actual_definition,
   definition_sha256=public.static_weekly_digest_text(obj.actual_definition),captured_at=statement_timestamp()
   where inventory_id=obj.inventory_id;
  trigger_count:=trigger_count+1;
 end loop;
 if trigger_count<>21 then raise exception 'expected exactly 21 recurring trigger bindings, found %',trigger_count;end if;

 -- Do not change the identity/ACL of the private inventory enumerator. Its
 -- captured reset-grants argument must use its actual stored identity too.
 select inventory_id into strict existing_id from public.custodial_release_authority_restore_inventory
  where object_kind='grant' and object_identity like '%(%'
   and to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure;
 select public.custodial_release_authority_current_grant_definition(object_identity) into definition
  from public.custodial_release_authority_restore_inventory where inventory_id=existing_id;
 if not exists(select 1 from public.custodial_release_authority_restore_inventory i where i.inventory_id=existing_id
   and (i.definition_sql=definition or replace(i.definition_sql,
    'custodial_release_authority_reset_grants('||quote_literal('public.'||i.object_identity)||')',
    'custodial_release_authority_reset_grants('||quote_literal(i.object_identity)||')')=definition)) then
  raise exception 'canary surface ACL changed beyond identity rendering';end if;
 update public.custodial_release_authority_restore_inventory set definition_sql=definition,
  definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp() where inventory_id=existing_id;
end $capture$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
