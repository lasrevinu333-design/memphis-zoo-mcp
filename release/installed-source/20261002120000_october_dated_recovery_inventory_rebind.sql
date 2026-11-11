-- Finite existing-postgres-owner adapter for canonical October recovery repair.
-- Canonical SQL SHA256 3ba81c38118b4b56543d2f89135bbdb7a6652c700c78b5dedcf898b3e60f6000.
-- Genuine235 rollback-only capture39624811696, metadata SHA256
-- 8429ad8a64a8a73bc9c4d739b7a2d6f6770b381466603f59972a726d41df865a.
-- The single nonowner lunch grantee avoids physical role-OID ordering inputs.
-- Only14 existing recovery rows are repaired; routines/views/ACLs are untouched.
-- Forward repair of the exact October dated-consumer recovery serialization.
-- Source predecessors: 20261001130750, 20261001152633, 20261001161831.
-- Nine trigger captures omitted enable state; three views omitted canonical
-- ownership/options. The pg_catalog-only capture missed an unqualified reminder
-- identity, and the lunch ACL used a different spelling of its stored identity.
-- Pin BOTH the old captured bytes and the intended live bytes. Do not silently
-- approve catalog drift, change product definitions/grants, or delete history.
-- CLI created 20261002061347; ordered 120000 after concurrently owned 100000/110000.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
do $production_forward_original_owner$
begin
 if current_user<>'postgres' OR session_user<>current_user
  OR current_setting('custodial.deployment_project_ref',true) IS DISTINCT FROM 'rqquvtjdmugpigbndmne'
  OR current_setting('session_replication_role')<>'origin'
  OR current_setting('transaction_read_only')<>'off'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.custodial_release_authority_restore_inventory')
   AND relowner='postgres'::regrole AND relkind='r' AND relpersistence='p')
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='custodial_application_reader' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls)
 then raise exception using errcode='42501',message='Exact production postgres original owner/project/normal mutation context required';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.static_weekly_v8_read_lunch_segments(date)')
  and p.proowner='postgres'::regrole and p.prokind='f' and p.prosecdef and p.provolatile='s'
  and p.proconfig=array['search_path=pg_catalog, public']::text[]
  and md5(p.prosrc)='f9678f74c6b0c1dcaf4b0f279ec5152b'
  and md5(pg_get_functiondef(p.oid))='d4b7a24952d52ce9ba23470ef233447b'
  and (select jsonb_agg(jsonb_build_object('grantee',coalesce(r.rolname,'PUBLIC'),'grantor',a.grantor::regrole::text,
   'privilege',a.privilege_type,'grantable',a.is_grantable) order by coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable)
   from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles r on r.oid=a.grantee)
   = '[{"grantee":"custodial_application_reader","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb)
 then raise exception 'Exact existing lunch function owner/body/ACL required';end if;
 if exists(select 1 from (values('public.v_location_dashboard_status'),('public.v_memphis_area_schedule'),('public.v_restroom_check_timers')) wanted(identity)
  left join pg_class c on c.oid=to_regclass(wanted.identity)
  where c.oid is null or c.relkind<>'v' or c.relowner<>'postgres'::regrole or c.reloptions is not null)
 then raise exception 'Exact existing three view owners/options required';end if;
end $production_forward_original_owner$;
do $repair$
declare expected record; captured record; current_definition text; actual_digest text; changed integer; total integer:=0;
begin
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
  raise exception 'October recovery inventory immutability unavailable';
 end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for expected in select * from (values
  ('function','mz_location_reminder_candidates(date,timestamp with time zone)','a29e4bb9c68ed13121917894e895683227783f5c99123dd511b87ce3f91dd707','ad5bf4abee1d732f8fc4503f12bfb2ad5924f46c8168e59c4c5557cc7ac1f949'),
  ('grant','static_weekly_v8_read_lunch_segments(date)','84cf34796a440846f43dbec81c2b31440ba76fa2458b77cfddc9703cc093c78a','9bb92929a459e401e86982ba7a7bc32210b4eeb56a088a48d58869e05e3b127a'),
  ('trigger','public.custodial_dated_activations.custodial_disaster_restore_mutation_fence','5cf539d0f3a47f7757b19138ac5179cf278cc3fe8bbd2ac7b377f89ff7e51074','a765b9f24859782c8f212aa5c78485d719c8e69f4d51a16e411a4e96c37e97cc'),
  ('trigger','public.custodial_dated_activations.dated_activation_immutable','cbf665bb065f8cd7b282a2184bafc64f866b1a53d87e2e7f3879ddd2d71161c5','35bf9c666cd64675301e6ad18215ab7c00cff1a452a7b0e83f5a261a4ce11abb'),
  ('trigger','public.custodial_dated_occurrences.custodial_disaster_restore_mutation_fence','a9b52a9e2c22e24aeae6c9d4d409108504490a33795b845862ae0341d442194c','4cfc505cc6201dca7b4b3c4e0d453c291bb64e81087f4f6a7a777d799c00bc73'),
  ('trigger','public.custodial_dated_occurrences.dated_occurrence_immutable','871be6baabd508549d87c0b3260fc87b84d7658fc6cc35f5a6b0fdfe959a923e','c911df3330e52d28305c04f507d7ad78b091bffac72de54e36054a856704c258'),
  ('trigger','public.custodial_dated_publications.custodial_disaster_restore_mutation_fence','96abdd8b9f935ff31489f2d03d8efc618ee831bfaab5c2b500cfabc44123708b','7b2fa63f0cc780bbaf4050091c6b2ca0da204896bcd3b35dfbc15f16885e9c00'),
  ('trigger','public.custodial_dated_publications.dated_publication_complete','e7a5a7b131e88a83fbaf0834c0097aaba2a4fb0100551a35160a2886978e5f1e','77c80a3fc776cfdb71bc6af22e7e5636b7fcfae1bde5404c9cb8be01a36dc770'),
  ('trigger','public.custodial_dated_publications.dated_publication_immutable','f3720b7d517b1508f71d1925cbb676f9ca881dced493e20cbe994ce6bf0d64ca','c8dd7f7afd5c519700e45a7fd088b71573a0b0ec1410cd296a81ac521418c7b6'),
  ('trigger','public.custodial_dated_receipts.custodial_disaster_restore_mutation_fence','ad66643883f74c32fc47235c692b9ce90bdef1f3fd91b979fe8a7f6bddc71929','94aaa4d5b57d827f3f69b2a69c23b7fefa6ea4da5094d4f892c0af8babf7c34e'),
  ('trigger','public.custodial_dated_receipts.dated_receipt_immutable','33e96c3a693dc110a782c8a1fed7261df796e98fdce8de84952117527de46a4d','2729210b1d601b915b87f692516eac7b8845cb1a56fe5844c138f9d53b6d7436'),
  ('view','public.v_location_dashboard_status','d4345afd64fc8b56a82fde1c3a1734fdb23323bb1ff3c9e4d62c71b565d663e3','3e3a20ec698ed6d69323635ef80c0adb9e382d2c8171e82ed6b89e75d926283f'),
  ('view','public.v_memphis_area_schedule','f4ee18dba4aa566fbaf0394b817ad2686a02dba95fe84f84e78e2587a2403563','a472a46cf414c5e4095fc824826c76a3c84a7fa4ce041b9a9bf19194304f8219'),
  ('view','public.v_restroom_check_timers','0d302a478de60aed9dd7af8d8cccfe72987cc9104a7c46cf1ecbe094412339cc','7a3f322a4d0ac8c6dca8e34fd3fb693e81a43c4fd34a71b7713406cc43976b5d')
 ) wanted(kind,identity,captured_digest,live_digest) loop
  select definition_sql,definition_sha256 into strict captured
   from public.custodial_release_authority_restore_inventory
   where object_kind=expected.kind and object_identity=expected.identity;
  if captured.definition_sha256 is distinct from expected.captured_digest
   or public.static_weekly_digest_text(captured.definition_sql) is distinct from expected.captured_digest then
   raise exception 'October recovery captured predecessor changed: %',expected.identity;
  end if;
  current_definition:=case expected.kind
   when 'function' then pg_get_functiondef(to_regprocedure(expected.identity))
   when 'view' then public.custodial_release_authority_current_view_definition(expected.identity)
   when 'grant' then public.custodial_release_authority_current_grant_definition(expected.identity)
   when 'trigger' then (select 'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'; '||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||' '||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end||' trigger '||quote_ident(t.tgname)||';'
    from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace
    where expected.identity=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal)
   end;
  actual_digest:=public.static_weekly_digest_text(current_definition);
  if actual_digest is distinct from expected.live_digest then
   raise exception 'October recovery live predecessor changed: %',expected.identity;
  end if;
  update public.custodial_release_authority_restore_inventory
   set definition_sql=current_definition,definition_sha256=actual_digest,captured_at=statement_timestamp()
   where object_kind=expected.kind and object_identity=expected.identity and definition_sha256=expected.captured_digest;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'October recovery row count changed: %',expected.identity; end if;
  total:=total+changed;
 end loop;
 if total<>14 then raise exception 'October recovery scope changed';end if;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end;
$repair$;
commit;
