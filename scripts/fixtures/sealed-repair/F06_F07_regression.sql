-- ROOT-OWNED DISPOSABLE DATABASE ONLY. All fixture state rolls back.
-- V3 preserves the failed V2 evidence. No reviewed/deployed release is invented;
-- successful resume is outside this fixture. The existing release gate must refuse it.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE security_generation_checks(label text PRIMARY KEY);
DO $fixture$
DECLARE names jsonb;claimed uuid;owner_id uuid;current_generation bigint;reply jsonb;enrolled jsonb;enrolled_id uuid;deployed_count integer;
 reg uuid:='f0700000-0000-4000-8000-000000000002';
 cohort uuid:='f0700000-0000-4000-8000-000000000001';
 restore uuid:='f0700000-0000-4000-8000-000000000003';
BEGIN
 INSERT INTO public.ops_manager_managers(display_name,system_key,roles)
 SELECT 'Synthetic generation registry '||n,key,ARRAY['OPS_MANAGER']::text[]
 FROM (VALUES(1,'eric_mckenney_facilities_maintenance_manager'),(2,'haley_lejman_water_quality_manager'),
 (3,'brandy_gull_horticulture_manager'),(4,'jennifer_sheffield_director_operations'),
 (5,'annie_feist_operations_admin'),(6,'eric_custodial_manager')) v(n,key)
 WHERE NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.system_key=v.key);
 names:=custodial_leadership_private.approved_names();
 IF names IS NULL THEN RAISE EXCEPTION 'Six-name registry prerequisite failed';END IF;
 claimed:=(names->0->>'accountId')::uuid;owner_id:=(names->5->>'accountId')::uuid;
 INSERT INTO public.ops_manager_managers(manager_id,display_name,system_key,roles,is_system_principal)
 VALUES(cohort,'Synthetic generation cohort','synthetic_security_generation_cohort',ARRAY['OPS_MANAGER'],true);
 UPDATE custodial_leadership_private.policy SET enabled=true,cohort_principal_id=cohort,policy_version=1,
 permissions=ARRAY['custodial.read','custodial.edit','custodialManagementAdmin'],approved_by=owner_id,
 approved_at=clock_timestamp(),approval_ref=restore WHERE singleton;
 SELECT authority_generation INTO current_generation FROM custodial_dr.restore_control
 WHERE singleton AND NOT mutations_paused AND state IN('READY','COMPLETE');
 IF current_generation IS NULL THEN RAISE EXCEPTION 'Owned fixture requires ready protected control';END IF;
 INSERT INTO custodial_leadership_private.registrations(registration_id,token_hash,browser_hash,
 claimed_account_id,cohort_principal_id,enrollment_policy_version,enrolled_at,expires_at)
 VALUES(reg,repeat('1',64),repeat('2',64),claimed,cohort,1,clock_timestamp(),clock_timestamp()+interval '1 hour');
 IF (SELECT authority_generation FROM custodial_leadership_private.registrations WHERE registration_id=reg)
 IS DISTINCT FROM current_generation THEN RAISE EXCEPTION 'New registration not bound';END IF;
 INSERT INTO security_generation_checks VALUES('normal enrollment insert binds protected current generation');
 IF custodial_leadership_private.session_view(reg) IS NULL THEN RAISE EXCEPTION 'Current registration denied';END IF;
 INSERT INTO security_generation_checks VALUES('current registration accepted');
 -- Exercise the actual enrollment INSERT after the owner-approved lifetime edit.
 INSERT INTO custodial_leadership_private.pin_versions(pin_version,state,verifier,activated_at,expires_at,approval_ref)
 VALUES('f0700000-0000-4000-8000-000000000050','ACTIVE',
 jsonb_build_object('algorithm','scrypt-hmac-sha256-v1','salt',repeat('a',64),'digest',repeat('b',64)),
 transaction_timestamp(),transaction_timestamp()+interval '720 hours',restore);
 INSERT INTO custodial_leadership_private.challenges(challenge_hash,browser_hash,pin_version,policy_version,created_at,expires_at)
 VALUES(repeat('a',64),repeat('b',64),'f0700000-0000-4000-8000-000000000050',1,transaction_timestamp(),transaction_timestamp()+interval '5 minutes');
 enrolled:=custodial_leadership_private.execute('enroll',jsonb_build_object('source_hash',repeat('a',64),'browser_hash',repeat('b',64),
 'account_key',repeat('c',64),'challenge_hash',repeat('a',64),'new_browser_hash',repeat('c',64),'token_hash',repeat('d',64),'claimed_account_id',claimed));
 enrolled_id:=(enrolled->'data'->>'registrationId')::uuid;
 IF enrolled_id IS NULL OR enrolled->'data'->>'registrationLifetime' IS DISTINCT FROM 'UNTIL_REVOKED'
 OR enrolled->'data'->'credentialExpiresAt' IS DISTINCT FROM 'null'::jsonb
 OR NOT EXISTS(SELECT 1 FROM custodial_leadership_private.registrations WHERE registration_id=enrolled_id AND expires_at='infinity'::timestamptz)
 THEN RAISE EXCEPTION 'Actual enrollment is not explicitly nonexpiring';END IF;
 INSERT INTO security_generation_checks VALUES('actual enrollment INSERT stores infinity and returns explicit UNTIL_REVOKED null expiry');
 UPDATE custodial_leadership_private.registrations SET enrolled_at=clock_timestamp()-interval '20 years' WHERE registration_id=enrolled_id;
 IF custodial_leadership_private.session_view(enrolled_id) IS NULL THEN RAISE EXCEPTION 'Routine registration age expiry remains';END IF;
 INSERT INTO security_generation_checks VALUES('twenty-year registration age remains valid in same current generation');
 UPDATE custodial_leadership_private.pin_versions SET state='RETIRED' WHERE pin_version='f0700000-0000-4000-8000-000000000050';
 reply:=custodial_leadership_private.runtime('session',jsonb_build_object('token_hash',repeat('d',64),'browser_hash',repeat('c',64)));
 IF reply->'data'->>'registrationId' IS DISTINCT FROM enrolled_id::text THEN RAISE EXCEPTION 'PIN retirement ended remembered registration';END IF;
 INSERT INTO security_generation_checks VALUES('retiring enrollment PIN preserves remembered opaque-cookie registration');

 reply:=custodial_leadership_private.runtime('session',jsonb_build_object('token_hash',repeat('1',64),'browser_hash',repeat('2',64)));
 IF reply->'data'->>'registrationId' IS DISTINCT FROM reg::text THEN RAISE EXCEPTION 'Opaque-cookie session readback failed';END IF;
 INSERT INTO security_generation_checks VALUES('opaque-cookie runtime session reaches actual generation-checked reader');
 UPDATE custodial_leadership_private.registrations SET revoked_at=clock_timestamp() WHERE registration_id=reg;
 IF custodial_leadership_private.session_view(reg) IS NOT NULL THEN RAISE EXCEPTION 'Revocation bypass';END IF;
 INSERT INTO security_generation_checks VALUES('revoked current generation denied');
 -- Simulate an old backup row replacing its later revocation, not a real restore.
 UPDATE custodial_leadership_private.registrations SET revoked_at=NULL WHERE registration_id=reg;
 UPDATE custodial_leadership_private.registrations SET authority_generation=NULL WHERE registration_id=reg;
 IF custodial_leadership_private.session_view(reg) IS NOT NULL THEN RAISE EXCEPTION 'Missing row generation accepted';END IF;
 INSERT INTO security_generation_checks VALUES('unbound old-schema row denied while original control is ready and unpaused');
 UPDATE custodial_leadership_private.registrations SET authority_generation=current_generation+2 WHERE registration_id=reg;
 IF custodial_leadership_private.session_view(reg) IS NOT NULL THEN RAISE EXCEPTION 'Future generation accepted';END IF;
 INSERT INTO security_generation_checks VALUES('future generation denied while original control is ready and unpaused');
 UPDATE custodial_leadership_private.registrations SET authority_generation=current_generation WHERE registration_id=reg;
 IF custodial_leadership_private.session_view(reg) IS NULL THEN RAISE EXCEPTION 'Original same-generation positive control failed';END IF;
 INSERT INTO security_generation_checks VALUES('same-generation positive control restored without changing protected control or resuming');
 -- A new current-generation registration works in the original ready state.
 INSERT INTO custodial_leadership_private.registrations(registration_id,token_hash,browser_hash,claimed_account_id,cohort_principal_id,enrollment_policy_version,expires_at)
 VALUES('f0700000-0000-4000-8000-000000000004',repeat('6',64),repeat('7',64),claimed,cohort,1,clock_timestamp()+interval '1 hour');
 IF custodial_leadership_private.session_view('f0700000-0000-4000-8000-000000000004') IS NULL THEN RAISE EXCEPTION 'Fresh registration denied';END IF;
 INSERT INTO security_generation_checks VALUES('new current generation registration accepted');
 UPDATE custodial_dr.restore_control SET authority_generation=current_generation+1,mutations_paused=true,
 state='VERIFYING',restore_id=restore WHERE singleton;
 INSERT INTO custodial_dr.restore_manifests(restore_id,authority_generation,archive_digest,authority_invalidated)
 VALUES(restore,current_generation+1,repeat('3',64),true);
 IF NOT (SELECT authority_invalidated FROM custodial_dr.restore_manifests WHERE restore_id=restore)
 OR custodial_leadership_private.session_view(reg) IS NOT NULL THEN RAISE EXCEPTION 'Legacy completion flag revived old row';END IF;
 INSERT INTO security_generation_checks VALUES('old restored row denied while old six-step completion flag is true');
 reply:=custodial_leadership_private.runtime('session',jsonb_build_object('token_hash',repeat('1',64),'browser_hash',repeat('2',64)));
 IF reply->'data' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Old cookie minted fresh session';END IF;
 INSERT INTO security_generation_checks VALUES('old opaque cookie cannot mint a new session after generation advance');
 BEGIN
  INSERT INTO custodial_leadership_private.registrations(token_hash,browser_hash,claimed_account_id,cohort_principal_id,enrollment_policy_version,expires_at)
  VALUES(repeat('4',64),repeat('5',64),claimed,cohort,1,clock_timestamp()+interval '1 hour');
  RAISE EXCEPTION 'Paused enrollment unexpectedly accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 INSERT INTO security_generation_checks VALUES('enrollment fails closed while restore paused');
 -- This owned fixture has no deployed/reviewed release identity. Exercise the
 -- real ALWAYS resume guard and retain its pause rather than inventing a release.
 SELECT count(*) INTO deployed_count FROM public.release_deployment_manifest WHERE status='deployed';
 IF deployed_count<>0 THEN RAISE EXCEPTION 'Fixture requires the original no-deployed-identity boundary, found %',deployed_count;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='custodial_dr.restore_control'::regclass
  AND tgname='trg_require_single_release_on_resume' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Original ALWAYS resume guard must remain enabled';END IF;
 BEGIN
  UPDATE custodial_dr.restore_control SET mutations_paused=false,state='COMPLETE' WHERE singleton;
  RAISE EXCEPTION 'Missing deployed release unexpectedly permitted resume' USING ERRCODE='P0708';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM IS DISTINCT FROM 'release reconciliation requires exactly one deployed identity, found 0' THEN RAISE;END IF;
 END;
 INSERT INTO security_generation_checks VALUES('actual ALWAYS resume guard refuses zero deployed identities without fake release evidence');
 IF NOT EXISTS(SELECT 1 FROM custodial_dr.restore_control WHERE singleton AND mutations_paused
  AND state='VERIFYING' AND authority_generation=current_generation+1 AND restore_id=restore)
 OR custodial_leadership_private.session_view(reg) IS NOT NULL
 THEN RAISE EXCEPTION 'Refused resume failed to preserve pause and old registration denial';END IF;
 INSERT INTO security_generation_checks VALUES('refused resume preserves protected pause and denial of restored old registration');
 DELETE FROM custodial_dr.restore_control WHERE singleton;
 IF custodial_leadership_private.session_view('f0700000-0000-4000-8000-000000000004') IS NOT NULL THEN RAISE EXCEPTION 'Missing protected singleton accepted';END IF;
 INSERT INTO security_generation_checks VALUES('missing protected generation fails closed');
 BEGIN
  INSERT INTO custodial_leadership_private.registrations(token_hash,browser_hash,claimed_account_id,cohort_principal_id,enrollment_policy_version,expires_at)
  VALUES(repeat('8',64),repeat('9',64),claimed,cohort,1,clock_timestamp()+interval '1 hour');
  RAISE EXCEPTION 'Missing control enrollment unexpectedly accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 INSERT INTO security_generation_checks VALUES('missing protected generation cannot bind new enrollment');
 IF has_function_privilege('service_role','custodial_leadership_private.session_view(uuid)','EXECUTE')
 OR has_table_privilege('service_role','custodial_leadership_private.registrations','SELECT')
 OR has_table_privilege('static_weekly_control_plane','custodial_dr.restore_control','UPDATE')
 THEN RAISE EXCEPTION 'Private generation authority grant widened';END IF;
 INSERT INTO security_generation_checks VALUES('private reader and protected generation grants stay denied');
END $fixture$;
SELECT jsonb_build_object('suite','leadership-registration-lifetime-generation-v3','passed',count(*),'checks',jsonb_agg(label ORDER BY label),'resume_coverage','REAL_RESUME_DENIED_WITH_NO_DEPLOYED_IDENTITY','successful_resume','UNTESTED_REQUIRES_GENUINE_RELEASE_GATE') FROM security_generation_checks;
ROLLBACK;
