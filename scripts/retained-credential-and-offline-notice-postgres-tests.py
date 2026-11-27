"""Exercise additive uniqueness changes on synthetic records using the original command functions."""
from pathlib import Path
import runpy
src=runpy.run_path(str(Path(__file__).parent/'fixtures/operational-schedule-postgres.py'))
root=src['root'];sql=src['blank_schema']();inv=src['inv'];catalog=src['catalog']
for index in ['idx_device_auth_credentials_one_active_per_device','uq_custodial_offline_disposition_notification']:
    sql+=next(r['definition'] for r in catalog['indexes'] if r['index_name']==index)+';\n'
for t in ('public.idx_device_auth_credentials_one_active_per_device','public.custodial_offline_reconciliation_outbox:custodial_offline_reconciliat_reconciliation_id_notificatio_key','custodial_enqueue_offline_reconciliation_notification(uuid)'):
    r=next(r for r in inv if r['object_identity']==t and r['object_kind'] in ('function','index','constraint'));expr={'index':'public.custodial_release_authority_current_index_definition','constraint':'public.custodial_release_authority_current_constraint_definition','function':'pg_get_functiondef'}[r['object_kind']]
    cast='::regprocedure' if r['object_kind']=='function' else ''
    sql+=f"""insert into custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256) values({r['restore_order']},'{r['object_kind']}','{t}',{expr}('{t}'{cast}),'{r['definition_sha256']}');"""
retention=next((root/'supabase/migrations').glob('20261102010000_*')).read_text()
sql+=retention[retention.index('DO $consumer$'):retention.index('DO $owner$')]
sql+=(root/'proposals/retained-credentials-and-offline-notices.sql').read_text()
sql+="""
insert into custodial_backend_execution_config(config_key,execution_secret_digest,enabled) values(true,static_weekly_digest_text(repeat('x',32)),true);
insert into ops_manager_managers(manager_id,roles,active) values('55000000-0000-4000-8000-000000000001',array['DIRECTOR'],true);
insert into custodial_offline_reconciliation_records(reconciliation_id,client_session_id,client_completion_id,state,payload_fingerprint)
 values('55000000-0000-4000-8000-000000000002','fixture','55000000-0000-4000-8000-000000000006','quarantined',repeat('a',64));
select custodial_enqueue_offline_reconciliation_notification('55000000-0000-4000-8000-000000000002');
select custodial_enqueue_offline_reconciliation_notification('55000000-0000-4000-8000-000000000002');
create function fixture_decision(decision text,id uuid) returns jsonb language sql as $$select custodial_manager_dispose_offline_reconciliation('55000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000002',decision,'synthetic manager review',id,repeat('x',32))$$;
select fixture_assert((fixture_decision('reviewed','55000000-0000-4000-8000-000000000003')->>'replayed')='false','Original review saved');
select fixture_assert((fixture_decision('retained_for_recovery','55000000-0000-4000-8000-000000000004')->>'replayed')='false','Distinct retention follow-up saved');
select fixture_assert((fixture_decision('reviewed','55000000-0000-4000-8000-000000000003')->>'replayed')='true','First decision replays');
select fixture_assert((fixture_decision('retained_for_recovery','55000000-0000-4000-8000-000000000004')->>'replayed')='true','Second decision replays');
select fixture_assert(count(*)=3 and count(distinct disposition_id)=2,'One quarantine and two independent manager notices') from custodial_offline_reconciliation_outbox;
select fixture_assert(count(*)=2,'Both decision audits remain') from custodial_offline_reconciliation_audits;
insert into devices(id,device_id,active,assigned_employee_id,assignment_epoch) values('66000000-0000-4000-8000-000000000001','KIOSK_08',true,'66000000-0000-4000-8000-000000000007',4);
insert into device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at,metadata_json)
 values('66000000-0000-4000-8000-000000000002','66000000-0000-4000-8000-000000000001',repeat('b',64),now(),now()+interval '1 day','{}');
-- This synthetic row represents the previous owner's authenticated preservation receipt.
update device_auth_credentials set metadata_json='{"retained_original_enrollment":{"realm_id":"66000000-0000-4000-8000-000000000004"}}' where credential_id='66000000-0000-4000-8000-000000000002';
update devices set assigned_employee_id='66000000-0000-4000-8000-000000000008',assignment_epoch=5 where device_id='KIOSK_08';
insert into device_auth_enrollment_codes(enrollment_id,device_id,code_hash,expires_at,failed_attempts) values('66000000-0000-4000-8000-000000000005','66000000-0000-4000-8000-000000000001',repeat('c',64),now()+interval '30 minutes',0);
create function fixture_enroll() returns jsonb language sql as $$select device_auth_consume_enrollment_operation('66000000-0000-4000-8000-000000000011','enrollment','66000000-0000-4000-8000-000000000001',repeat('c',64),repeat('d',64),'66000000-0000-4000-8000-000000000003',repeat('e',64),'fixture',now()+interval '1 day',repeat('Z',32),repeat('W',12),repeat('V',16),now()+interval '10 minutes','fixture')$$;
select fixture_assert((fixture_enroll()->>'ok')='true','Supported successor enrollment commits');
select fixture_assert((fixture_enroll()->>'ok')='true','Same enrollment operation resumes');
select fixture_assert(count(*)=2 and count(*) filter(where revoked_at is null and metadata_json ? 'retained_original_enrollment')=1
 and count(*) filter(where revoked_at is null and not(metadata_json ? 'retained_original_enrollment'))=1,'Original remains recoverable alongside exactly one ordinary credential') from device_auth_credentials;
select fixture_reject($q$insert into device_auth_credentials(credential_id,device_id,token_hash,metadata_json) values(gen_random_uuid(),'66000000-0000-4000-8000-000000000001',repeat('f',64),'{}')$q$,'idx_device_auth_credentials_one_active_per_device');
"""
src['run_pg'](sql)
