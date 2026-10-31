-- ROOT-OWNED DISPOSABLE DATABASE ONLY. All fixture state rolls back.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE security_generation_checks(label text PRIMARY KEY);
DO $fixture$
DECLARE names jsonb;claimed uuid;owner_id uuid;current_generation bigint;reply jsonb;
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
 IF custodial_leadership_private.session_view(reg) IS NULL THEN RAISE EXCEPTION 'Baseline active session prerequisite failed';END IF;
 UPDATE custodial_dr.restore_control SET authority_generation=current_generation+1,mutations_paused=true,
 state='VERIFYING',restore_id=restore WHERE singleton;
 INSERT INTO custodial_dr.restore_manifests(restore_id,authority_generation,archive_digest,authority_invalidated)
 VALUES(restore,current_generation+1,repeat('3',64),true);
 reply:=custodial_leadership_private.runtime('session',jsonb_build_object('token_hash',repeat('1',64),'browser_hash',repeat('2',64)));
 IF reply->'data'->>'registrationId' IS DISTINCT FROM reg::text THEN RAISE EXCEPTION 'Baseline conditional old-cookie problem no longer reproduces';END IF;
 INSERT INTO security_generation_checks VALUES('REPRODUCED: same old opaque-cookie row accepted despite advanced protected generation and legacy completion flag');
END $fixture$;
SELECT jsonb_build_object('suite','leadership-restore-generation-original-repro','status','CONDITIONAL_DEFECT_REPRODUCED_SYNTHETIC_ONLY','checks',jsonb_agg(label)) FROM security_generation_checks;
ROLLBACK;
