-- Catalog only for exact already-approved repair recovery dependencies.
select jsonb_build_object(
 'inventory_guard',(select jsonb_build_object('enabled',tgenabled,'identity',tgname)
  from pg_trigger where tgrelid=to_regclass('public.custodial_release_authority_restore_inventory')
  and tgname='trg_custodial_release_authority_restore_inventory_immutable'),
 'recovery_helpers',(select jsonb_agg(jsonb_build_object('signature',signature,'present',to_regprocedure(signature) is not null))
 from (values('public.custodial_release_authority_current_grant_definition(text)'),
 ('public.custodial_release_authority_current_view_definition(text)'),('public.static_weekly_digest_text(text)'),
 ('public.custodial_release_canary_authority_surface()')) expected(signature)),
 'affected_inventory',(select jsonb_agg(jsonb_build_object('kind',object_kind,'identity',object_identity,
 'definition_sha256',definition_sha256,'stored_digest_matches',definition_sha256=public.static_weekly_digest_text(definition_sql)))
 from public.custodial_release_authority_restore_inventory where object_identity in(
 'public.v_location_dashboard_status','public.custodial_release_canary_authority_surface()','custodial_release_canary_authority_surface()',
 'public.operational_day_start(timestamp with time zone)','operational_day_start(timestamp with time zone)',
 'public.get_setting_int(text,integer)','get_setting_int(text,integer)')));
