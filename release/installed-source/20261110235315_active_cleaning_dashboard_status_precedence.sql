-- Current active/pending work takes precedence over an earlier cleaning's timer.
-- Presentation only: retain every work row, timer threshold, view column and ACL.
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $repair$
DECLARE original text; corrected text;
BEGIN
 original:=pg_get_viewdef('public.v_location_dashboard_status'::regclass,true);
 IF public.static_weekly_digest_text(original) IS DISTINCT FROM '28e457f135e729622470f590d7a7c00b91db15e3ab0a904e5002ac6c3d0b6ad2' THEN
  RAISE EXCEPTION 'Dashboard status predecessor changed';
 END IF;
 corrected:=replace(original,$old$WHEN due_baseline_at IS NULL AND (open_session_status = ANY (ARRAY['active'::text, 'pending_submit'::text]))$old$,$new$WHEN (open_session_status = ANY (ARRAY['active'::text, 'pending_submit'::text]))$new$);
 IF corrected=original THEN RAISE EXCEPTION 'Dashboard status patch was not applied'; END IF;
 EXECUTE 'CREATE OR REPLACE VIEW public.v_location_dashboard_status AS '||corrected;
END
$repair$;
