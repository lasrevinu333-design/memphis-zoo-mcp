-- Separate held successor for two existing recovery objects and the sole
-- command using the old two-column conflict arbiter. No work row is rewritten.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
SET LOCAL search_path=pg_catalog,public;
SELECT custodial_dr.acquire_application_mutation_fence();
LOCK TABLE public.custodial_release_authority_restore_inventory,
 public.device_auth_credentials,public.custodial_offline_reconciliation_outbox IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
 IF current_user<>'postgres' OR session_user<>current_user OR current_setting('session_replication_role')<>'origin'
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A'
   AND tgfoid='public.custodial_reject_release_authority_inventory_mutation()'::regprocedure)
  OR NOT EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtname='custodial_dr_guard_application_ddl'
   AND evtfoid='custodial_dr.guard_application_ddl()'::regprocedure AND evtenabled IN('A','O'))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='custodial_disaster_restore_mutation_fence' AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgenabled IN('A','O'))
 THEN RAISE EXCEPTION 'Original guarded catalog required';END IF;
END $guard$;
DO $changes$
DECLARE first_index constant text:='public.idx_device_auth_credentials_one_active_per_device';
  notice_constraint constant text:='public.custodial_offline_reconciliation_outbox:custodial_offline_reconciliat_reconciliation_id_notificatio_key';
  notice_function constant regprocedure:='public.custodial_enqueue_offline_reconciliation_notification(uuid)'::regprocedure;
  item record;prior text;after_sql text;rewritten text;saved public.custodial_release_authority_restore_inventory%rowtype;
BEGIN
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 FOR item IN SELECT * FROM (VALUES
  ('index',first_index,'b172032326bb31631b4b6c47a13e87cbcdeac22f544389c2c2b1d3138a49c042'),
  ('constraint',notice_constraint,'a5d68632a8e30f7d3d5a8cec30884a2c758f2200ebd36666235134088b9e37ee'),
  ('function','custodial_enqueue_offline_reconciliation_notification(uuid)','da2f76c6fdd968691fb9e407619bbfcf2c94c65167eebd89f93b4709b16cfd0c')
 ) x(kind,identity,prior_sha) LOOP
  SELECT * INTO STRICT saved FROM public.custodial_release_authority_restore_inventory WHERE object_kind=item.kind AND object_identity=item.identity;
  prior:=CASE item.kind WHEN 'index' THEN public.custodial_release_authority_current_index_definition(first_index)
    WHEN 'constraint' THEN public.custodial_release_authority_current_constraint_definition(notice_constraint)
    ELSE pg_get_functiondef(notice_function) END;
  IF saved.definition_sql IS DISTINCT FROM prior OR saved.definition_sha256 IS DISTINCT FROM item.prior_sha
    OR public.static_weekly_digest_text(prior) IS DISTINCT FROM item.prior_sha THEN RAISE EXCEPTION 'Unexpected original for %',item.identity;END IF;
  CASE item.kind WHEN 'index' THEN
   DROP INDEX public.idx_device_auth_credentials_one_active_per_device;
   CREATE UNIQUE INDEX idx_device_auth_credentials_one_active_per_device ON public.device_auth_credentials(device_id)
    WHERE revoked_at IS NULL AND NOT(metadata_json ? 'retained_original_enrollment');
   after_sql:=public.custodial_release_authority_current_index_definition(first_index);
   rewritten:=replace(prior,'WHERE (revoked_at IS NULL);',$new$WHERE ((revoked_at IS NULL) AND (NOT (metadata_json ? 'retained_original_enrollment'::text)));$new$);
  WHEN 'constraint' THEN
   ALTER TABLE public.custodial_offline_reconciliation_outbox DROP CONSTRAINT custodial_offline_reconciliat_reconciliation_id_notificatio_key,
    ADD CONSTRAINT custodial_offline_reconciliat_reconciliation_id_notificatio_key UNIQUE NULLS NOT DISTINCT(reconciliation_id,notification_kind,disposition_id);
   after_sql:=public.custodial_release_authority_current_constraint_definition(notice_constraint);
   rewritten:=replace(prior,'UNIQUE (reconciliation_id, notification_kind)','UNIQUE NULLS NOT DISTINCT (reconciliation_id, notification_kind, disposition_id)');
  ELSE
   rewritten:=replace(prior,'on conflict (reconciliation_id, notification_kind) do nothing','on conflict (reconciliation_id, notification_kind, disposition_id) do nothing');
   EXECUTE rewritten;after_sql:=pg_get_functiondef(notice_function);
  END CASE;
  IF rewritten=prior OR rewritten IS DISTINCT FROM after_sql THEN RAISE EXCEPTION 'Unexpected successor for %: %',item.identity,after_sql;END IF;
  UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=after_sql,definition_sha256=public.static_weekly_digest_text(after_sql),captured_at=statement_timestamp()
   WHERE inventory_id=saved.inventory_id AND definition_sha256=item.prior_sha;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lost recovery row for %',item.identity;END IF;
 END LOOP;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
END $changes$;
COMMIT;
