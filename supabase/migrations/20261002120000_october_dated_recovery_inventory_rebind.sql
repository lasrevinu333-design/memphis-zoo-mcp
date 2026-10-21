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
  ('grant','static_weekly_v8_read_lunch_segments(date)','ce39f0b479bb17c93f32a7651b23cb2ebbeb8ee2ce6a62e7d40325165071fb60','9b70eb1011ac529432db1d7a1a9ba3e072fb5917eae318607b0545be6c1c9183'),
  ('trigger','public.custodial_dated_activations.custodial_disaster_restore_mutation_fence','5cf539d0f3a47f7757b19138ac5179cf278cc3fe8bbd2ac7b377f89ff7e51074','a765b9f24859782c8f212aa5c78485d719c8e69f4d51a16e411a4e96c37e97cc'),
  ('trigger','public.custodial_dated_activations.dated_activation_immutable','cbf665bb065f8cd7b282a2184bafc64f866b1a53d87e2e7f3879ddd2d71161c5','35bf9c666cd64675301e6ad18215ab7c00cff1a452a7b0e83f5a261a4ce11abb'),
  ('trigger','public.custodial_dated_occurrences.custodial_disaster_restore_mutation_fence','a9b52a9e2c22e24aeae6c9d4d409108504490a33795b845862ae0341d442194c','4cfc505cc6201dca7b4b3c4e0d453c291bb64e81087f4f6a7a777d799c00bc73'),
  ('trigger','public.custodial_dated_occurrences.dated_occurrence_immutable','871be6baabd508549d87c0b3260fc87b84d7658fc6cc35f5a6b0fdfe959a923e','c911df3330e52d28305c04f507d7ad78b091bffac72de54e36054a856704c258'),
  ('trigger','public.custodial_dated_publications.custodial_disaster_restore_mutation_fence','96abdd8b9f935ff31489f2d03d8efc618ee831bfaab5c2b500cfabc44123708b','7b2fa63f0cc780bbaf4050091c6b2ca0da204896bcd3b35dfbc15f16885e9c00'),
  ('trigger','public.custodial_dated_publications.dated_publication_complete','e7a5a7b131e88a83fbaf0834c0097aaba2a4fb0100551a35160a2886978e5f1e','77c80a3fc776cfdb71bc6af22e7e5636b7fcfae1bde5404c9cb8be01a36dc770'),
  ('trigger','public.custodial_dated_publications.dated_publication_immutable','f3720b7d517b1508f71d1925cbb676f9ca881dced493e20cbe994ce6bf0d64ca','c8dd7f7afd5c519700e45a7fd088b71573a0b0ec1410cd296a81ac521418c7b6'),
  ('trigger','public.custodial_dated_receipts.custodial_disaster_restore_mutation_fence','ad66643883f74c32fc47235c692b9ce90bdef1f3fd91b979fe8a7f6bddc71929','94aaa4d5b57d827f3f69b2a69c23b7fefa6ea4da5094d4f892c0af8babf7c34e'),
  ('trigger','public.custodial_dated_receipts.dated_receipt_immutable','33e96c3a693dc110a782c8a1fed7261df796e98fdce8de84952117527de46a4d','2729210b1d601b915b87f692516eac7b8845cb1a56fe5844c138f9d53b6d7436'),
  ('view','public.v_location_dashboard_status','d4345afd64fc8b56a82fde1c3a1734fdb23323bb1ff3c9e4d62c71b565d663e3','82dd00526da19bb7a8532da83a42d847a00f5c06c6d24ffe5a6342797c67b407'),
  ('view','public.v_memphis_area_schedule','f4ee18dba4aa566fbaf0394b817ad2686a02dba95fe84f84e78e2587a2403563','e13e853bf2653473553c62f20f286871393107509c11def746c9e371f2ddadd1'),
  ('view','public.v_restroom_check_timers','0d302a478de60aed9dd7af8d8cccfe72987cc9104a7c46cf1ecbe094412339cc','8dd302c13b6c138e49ebccb7fa548734d35d0d3bc64cf05c2ab3563b773b6fbd')
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
