-- STAGING PROPOSAL ONLY; Main owns canonical successor/provenance integration.
-- F06 owner decision: registration lasts until revoked or browser storage is lost.
-- F07 conditional anti-resurrection repair. No policy/PIN activation or restore.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $predecessor$
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT p.proowner FROM pg_proc p WHERE p.oid='custodial_leadership_private.session_view(uuid)'::regprocedure)
    IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
  THEN RAISE EXCEPTION 'Maintained privileged owner required' USING ERRCODE='42501';END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('custodial_leadership_private.session_view(uuid)'::regprocedure))
   IS DISTINCT FROM '9f009ef3449f4b5f1cb197a0262e8cd0e86de0dc0adb7e90c73b122b4e977869'
  THEN RAISE EXCEPTION 'Leadership session_view predecessor differs';END IF;
 IF NOT EXISTS(SELECT 1 FROM custodial_dr.restore_control WHERE singleton)
  THEN RAISE EXCEPTION 'Protected restore generation unavailable';END IF;
END $predecessor$;

-- No DEFAULT: replaying an old row must never bind it to today's generation.
ALTER TABLE custodial_leadership_private.registrations ADD COLUMN authority_generation bigint
 CHECK(authority_generation>=0);
-- Only a never-restored generation-zero database can safely identify legacy rows.
-- At any later generation an unbound row stays unbound and cannot authenticate.
UPDATE custodial_leadership_private.registrations SET authority_generation=0
 WHERE EXISTS(SELECT 1 FROM custodial_dr.restore_control WHERE singleton AND authority_generation=0
  AND NOT mutations_paused AND state='READY')
 AND NOT EXISTS(SELECT 1 FROM custodial_dr.restore_manifests);

-- Preserve finite historical revoked rows; all normal new enrollments below
-- are explicitly nonexpiring, not merely assigned another large finite TTL.
DO $lifetime_constraint$
DECLARE original_name text;matches integer;
BEGIN
 SELECT count(*),min(conname) INTO matches,original_name FROM pg_constraint
 WHERE conrelid='custodial_leadership_private.registrations'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%expires_at%' AND pg_get_constraintdef(oid) LIKE '%enrolled_at%'
 AND pg_get_constraintdef(oid) LIKE '%365 days%';
 IF matches<>1 THEN RAISE EXCEPTION 'Registration lifetime constraint predecessor differs';END IF;
 EXECUTE format('ALTER TABLE custodial_leadership_private.registrations DROP CONSTRAINT %I',original_name);
END $lifetime_constraint$;
ALTER TABLE custodial_leadership_private.registrations ADD CONSTRAINT registrations_expiration_policy
 CHECK(expires_at>enrolled_at AND (expires_at='infinity'::timestamptz OR expires_at<=enrolled_at+interval '365 days'));
-- The new owner policy removes routine expiry of existing unrevoked current-
-- generation registrations. It never changes revocation or restores a generation.
UPDATE custodial_leadership_private.registrations r SET expires_at='infinity'::timestamptz
 WHERE r.revoked_at IS NULL AND EXISTS(SELECT 1 FROM custodial_dr.restore_control c WHERE c.singleton
 AND c.authority_generation=r.authority_generation AND NOT c.mutations_paused AND c.state IN('READY','COMPLETE'));

CREATE FUNCTION custodial_leadership_private.bind_registration_generation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $bind$
DECLARE generation bigint;
BEGIN
 SELECT authority_generation INTO generation FROM custodial_dr.restore_control
  WHERE singleton AND NOT mutations_paused AND state IN('READY','COMPLETE') FOR SHARE;
 IF generation IS NULL THEN RAISE EXCEPTION 'Current registration generation unavailable' USING ERRCODE='55000';END IF;
 IF NEW.authority_generation IS NOT NULL AND NEW.authority_generation IS DISTINCT FROM generation
  THEN RAISE EXCEPTION 'Registration generation mismatch' USING ERRCODE='42501';END IF;
 NEW.authority_generation:=generation;
 RETURN NEW;
END $bind$;
ALTER FUNCTION custodial_leadership_private.bind_registration_generation() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION custodial_leadership_private.bind_registration_generation()
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
CREATE TRIGGER custodial_leadership_registration_generation BEFORE INSERT
 ON custodial_leadership_private.registrations FOR EACH ROW
 EXECUTE FUNCTION custodial_leadership_private.bind_registration_generation();

-- Exact retained source303 execute definition, rechecked on the owning DB.
-- Change only the registration INSERT's lifetime, never the enrollment PIN.
DO $registration_lifetime$
DECLARE definition text;old_fragment text:=$old$stamp,stamp+interval '365 days') RETURNING * INTO r;$old$;
BEGIN
 definition:=pg_get_functiondef('custodial_leadership_private.execute(text,jsonb)'::regprocedure);
 IF public.static_weekly_digest_text(definition) IS DISTINCT FROM '9bb0130bf1be532752ee00bd889620cf6654c98b7f9bbcc7c287402983a7830e'
 OR (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Leadership execute lifetime predecessor differs';END IF;
 EXECUTE replace(definition,old_fragment,$new$stamp,'infinity'::timestamptz) RETURNING * INTO r;$new$);
END $registration_lifetime$;

CREATE OR REPLACE FUNCTION custodial_leadership_private.session_view(p_registration uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $session$
DECLARE r custodial_leadership_private.registrations%rowtype;p custodial_leadership_private.policy%rowtype;
 names jsonb;chosen jsonb;contact jsonb;
BEGIN
 SELECT * INTO r FROM custodial_leadership_private.registrations WHERE registration_id=p_registration;
 SELECT * INTO p FROM custodial_leadership_private.policy WHERE singleton;
 IF NOT EXISTS(SELECT 1 FROM custodial_dr.restore_control control WHERE control.singleton
    AND control.authority_generation=r.authority_generation AND NOT control.mutations_paused
    AND control.state IN('READY','COMPLETE')) THEN RETURN NULL;END IF;
 IF NOT p.enabled OR r.registration_id IS NULL OR r.revoked_at IS NOT NULL OR r.expires_at<=clock_timestamp()
  OR r.cohort_principal_id IS DISTINCT FROM p.cohort_principal_id
  OR NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.manager_id=p.cohort_principal_id AND m.active AND m.revoked_at IS NULL AND m.is_system_principal=true)
  THEN RETURN NULL;END IF;
 names:=custodial_leadership_private.approved_names();
 SELECT n INTO chosen FROM jsonb_array_elements(names) n WHERE n->>'accountId'=r.claimed_account_id::text;
 IF chosen IS NULL OR r.claimed_account_id=p.cohort_principal_id THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('email',v.email,'verifiedAt',v.verified_at) INTO contact
  FROM custodial_leadership_private.verified_contacts v WHERE v.account_id=r.claimed_account_id AND v.verified_at<=clock_timestamp();
 RETURN jsonb_build_object('registrationId',r.registration_id,'browserId',r.browser_id,'credentialExpiresAt',CASE WHEN r.expires_at='infinity'::timestamptz THEN NULL ELSE to_jsonb(r.expires_at) END,
  'registrationLifetime',CASE WHEN r.expires_at='infinity'::timestamptz THEN 'UNTIL_REVOKED' ELSE NULL END,'csrfBinding',r.browser_hash,'claimedAccount',chosen||jsonb_build_object('contact',contact),
  'cohort',jsonb_build_object('principalId',p.cohort_principal_id,'policyVersion',p.policy_version,'securityEpoch',p.security_epoch,'permissions',to_jsonb(p.permissions)));
END $session$;

-- CREATE OR REPLACE retains existing owner/ACL. No new public RPC or table grant.
COMMIT;
