BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Main CLI-generated filename; RPC-only lookup of an immutable original,
-- never a replay of the triage writer.
-- A narrow definer is required because the existing FORCE-RLS receipt table
-- has no direct server-role SELECT grant. Preserve that boundary. The fixed
-- server route verifies the signed current session/device before and after
-- this call; SQL independently checks its current named manager/credential.
CREATE FUNCTION public.custodial_feedback_triage_receipt(
 p_request uuid,p_manager uuid,p_credential uuid,p_feedback uuid,p_action text,p_expected_version text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE
 original public.system_feedback_triage_receipts%ROWTYPE;
 manager public.ops_manager_managers%ROWTYPE;
 credential public.ops_manager_trusted_devices%ROWTYPE;
 accepted_text text; accepted_instant timestamptz;
 unknown_result CONSTANT jsonb := '{"ok":true,"outcome":"UNKNOWN","retry_safe":false}'::jsonb;
BEGIN
 IF p_request IS NULL OR p_manager IS NULL OR p_credential IS NULL OR p_feedback IS NULL
  OR p_action IS NULL OR p_action NOT IN ('acknowledged','resolved','closed')
  OR p_expected_version IS NULL OR length(p_expected_version)<>64
  OR p_expected_version!~'^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING errcode='22023',message='Exact original Feedback command required';END IF;

 -- Share locks prevent a concurrent revocation/change from slipping between
 -- authorization and the bounded read. They never lock or mutate feedback.
 SELECT * INTO manager FROM public.ops_manager_managers m WHERE m.manager_id=p_manager
  AND m.active IS TRUE AND m.revoked_at IS NULL AND m.is_system_principal IS FALSE
  AND nullif(btrim(m.display_name),'') IS NOT NULL
  AND m.roles&&ARRAY['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[] FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='Current named manager required';END IF;
 SELECT * INTO credential FROM public.ops_manager_trusted_devices d WHERE d.credential_id=p_credential
  AND d.manager_id=manager.manager_id AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp()
  AND d.created_at<=clock_timestamp() AND d.max_access_level='full_access'
  AND nullif(btrim(d.device_id),'') IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='Current full-access manager credential required';END IF;

 -- A foreign request never returns its stored command. No current feedback
 -- projection, caller echo, advisory writer lock, or inferred no-effect result.
 SELECT * INTO original FROM public.system_feedback_triage_receipts r
 WHERE r.request_id=p_request AND r.manager_id=p_manager AND r.credential_id=p_credential
  AND r.feedback_id=p_feedback AND r.action=p_action AND r.expected_version=p_expected_version;
 IF NOT FOUND THEN RETURN unknown_result;END IF;

 IF jsonb_typeof(original.receipt) IS DISTINCT FROM 'object'
  OR (SELECT count(*) FROM jsonb_object_keys(original.receipt))<>7
  OR NOT(original.receipt ?& ARRAY['request_id','feedback_id','status','triage_version',
    'actor_manager_id','actor_credential_id','accepted_at'])
  OR EXISTS(SELECT 1 FROM jsonb_each(original.receipt) entry WHERE jsonb_typeof(entry.value)<>'string')
  OR original.receipt->>'request_id' IS DISTINCT FROM original.request_id::text
  OR original.receipt->>'feedback_id' IS DISTINCT FROM original.feedback_id::text
  OR original.receipt->>'status' IS DISTINCT FROM original.action
  OR original.receipt->>'actor_manager_id' IS DISTINCT FROM original.manager_id::text
  OR original.receipt->>'actor_credential_id' IS DISTINCT FROM original.credential_id::text
  OR length(original.receipt->>'triage_version')<>64
  OR original.receipt->>'triage_version'!~'^[a-f0-9]{64}$'
  OR original.receipt->>'triage_version'=original.expected_version THEN RETURN unknown_result;END IF;

 -- Preserve the persisted timestamp bytes, including SQL microseconds. A
 -- genuine Gregorian date and exact civil time must match the stored instant;
 -- no current-clock cutoff, repaired date, or reconstructed acceptance value.
 accepted_text:=original.receipt->>'accepted_at';
 IF accepted_text!~'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
  OR right(accepted_text,1) IN (chr(10),chr(13),chr(8232),chr(8233)) THEN RETURN unknown_result;END IF;
 BEGIN
  PERFORM make_date(substring(accepted_text,1,4)::integer,substring(accepted_text,6,2)::integer,
    substring(accepted_text,9,2)::integer);
  accepted_instant:=accepted_text::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN unknown_result;
 END;
 IF accepted_instant IS DISTINCT FROM original.accepted_at THEN RETURN unknown_result;END IF;
 IF credential.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION USING errcode='42501',message='Current full-access manager credential required';END IF;
 RETURN jsonb_build_object('ok',true,'outcome','APPLIED','retry_safe',false,
  'command',jsonb_build_object('request_id',original.request_id,'feedback_id',original.feedback_id,
    'status',original.action,'expected_version',original.expected_version,
    'expected_manager_id',original.manager_id,'expected_credential_id',original.credential_id),
  'receipt',original.receipt);
END $fn$;

REVOKE ALL ON FUNCTION public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)
 FROM PUBLIC,postgres,anon,authenticated,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,service_role;
GRANT EXECUTE ON FUNCTION public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text) TO service_role;

-- Abort rather than silently inherit a different owner or broad default ACL.
DO $acl$
DECLARE target regprocedure:='public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)'::regprocedure;
BEGIN
 IF (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM
    (SELECT proowner FROM pg_proc WHERE oid='public.custodial_feedback_triage(uuid,uuid,uuid,uuid,text,text)'::regprocedure)
  OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=target AND (a.grantee NOT IN (p.proowner,'service_role'::regrole::oid)
      OR (a.grantee='service_role'::regrole::oid AND a.is_grantable)))
  OR NOT has_function_privilege('service_role',target,'EXECUTE') THEN
  RAISE EXCEPTION 'Feedback original reader exact owner/EXECUTE boundary changed';END IF;
END $acl$;
COMMIT;
