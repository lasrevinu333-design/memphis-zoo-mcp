-- Existing RPCs and full original UUID constraint on fixture rows.
ALTER TABLE custodial_offline_reconciliation_records ADD CONSTRAINT custodial_offline_reconciliation_client_completion_id_uuid
 CHECK(client_completion_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
INSERT INTO custodial_backend_execution_config(config_key,execution_secret_digest,enabled)
 VALUES(true,static_weekly_digest_text(repeat('x',32)),true);
SELECT fixture_assert(custodial_quarantine_malformed_scan_http(repeat('a',64),gen_random_uuid()::text,82,repeat('x',32))->>'status'='quarantined','Malformed authenticated body recorded');
SELECT fixture_assert((custodial_quarantine_malformed_scan_http(repeat('a',64),gen_random_uuid()::text,82,repeat('x',32))->>'replayed')::boolean,'Digest-bound original replay');
SELECT fixture_assert(count(*)=1 AND bool_and(payload_fingerprint=repeat('a',64)), 'One bounded quarantine original') FROM custodial_offline_reconciliation_records;
SELECT fixture_assert(count(*)=1,'One quarantine notice') FROM custodial_offline_reconciliation_outbox;
SELECT fixture_reject($q$insert into custodial_offline_reconciliation_records(client_completion_id) values('bad-completion')$q$,'client_completion_id_uuid');

-- Two accepted time windows must pass independently. Identical and overlapping
-- submits retain the original global duplicate and typed-conflict rules.
INSERT INTO weekly_schedule_slot_availability(version_id,day_of_week,slot_id,availability_state) VALUES('21000000-0000-4000-8000-000000000001',2,'21000000-0000-4000-8000-000000000002','working');
CREATE FUNCTION fixture_partial(time,time) RETURNS void LANGUAGE sql AS $$select static_weekly_assert_exception_payload('partial_absence','2026-10-06',$1,$2,'21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000003','{"slotId":"21000000-0000-4000-8000-000000000002"}',null)$$;
SELECT fixture_partial('09:50','10:00');
INSERT INTO weekly_schedule_exception_commands(exception_id,publication_id,base_version_id,service_date,exception_type,starts_at,ends_at,payload_json,payload_digest)
 SELECT gen_random_uuid(),'21000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000001','2026-10-06','partial_absence','09:50','10:00',v,static_weekly_digest_jsonb(v) from (select '{"slotId":"21000000-0000-4000-8000-000000000002"}'::jsonb v) a;
SELECT fixture_partial('10:05','10:10');
SELECT fixture_reject($q$select fixture_partial('09:50','10:00')$q$,'duplicate semantic');
SELECT fixture_reject($q$select fixture_partial('09:55','10:02')$q$,'window');
SELECT 'Disjoint second partial absence passes, duplicate and overlap refused';

-- Two settled jobs use the original operational writer and original manager
-- enqueuer. The fixture supplies the recipient's current-cohort decision.
CREATE OR REPLACE FUNCTION custodial_ops_manager_notification_recipient_is_current(p_credential_id uuid,p_manager_id uuid,p_now timestamptz default now()) RETURNS boolean LANGUAGE sql STABLE AS $$ select p_credential_id='33000000-0000-4000-8000-000000000001' $$;
INSERT INTO ops_manager_push_devices(credential_id,manager_id,enabled) VALUES('33000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000002',true);
INSERT INTO ops_manager_notification_credentials(credential_id,credential_kind) VALUES('33000000-0000-4000-8000-000000000001','fixture');
INSERT INTO operational_notification_jobs(job_id,job_key,job_type,status,lease_token,attempts,max_attempts,payload_json)
SELECT ('33000000-0000-4000-8000-00000000000'||v)::uuid,'synthetic-lunch-'||v,'employee_native_push','leased','33000000-0000-4000-8000-000000000009',v-2,2,'{"data_json":{"kind":"employee_lunch_coverage","notification_type":"lunch_coverage","event":"start"}}' FROM generate_series(3,4)v;
SELECT fixture_assert((finish_operational_notification_job('33000000-0000-4000-8000-000000000003','33000000-0000-4000-8000-000000000009',false)).status='pending','Earlier preparation failure remains retryable');
SELECT fixture_assert(count(*)=0,'No premature manager alert') FROM ops_manager_notification_queue;
SELECT fixture_assert((finish_operational_notification_job('33000000-0000-4000-8000-000000000004','33000000-0000-4000-8000-000000000009',false)).status='dead','Final retry is terminal');
SELECT ops_manager_enqueue_lunch_delivery_failure('33000000-0000-4000-8000-000000000004',now());
SELECT fixture_assert(count(*)=1 AND bool_and(data_json->>'device_receipt_status'='not_evaluated'),'One manager notice on final preparation failure with unchanged handset evidence') FROM ops_manager_notification_queue;

INSERT INTO system_feedback_email_relay_config(singleton,paused) VALUES(true,true);
INSERT INTO system_feedback_items(id) SELECT ('44000000-0000-4000-8000-00000000000'||i)::uuid FROM generate_series(1,5)i;
INSERT INTO system_feedback_email_intents(id,feedback_id,state,feedback_snapshot,attachment_verification_state)
 SELECT ('45000000-0000-4000-8000-00000000000'||i)::uuid,('44000000-0000-4000-8000-00000000000'||i)::uuid,state,'{"image_attachment":{"name":"fixture.png"}}',v FROM (VALUES (1,'queued','unverified'),(2,'claimed','pending'),(3,'inbox_observed','verified'),(4,'needs_attention','blocked'),(5,'claimed','verified'))s(i,state,v);
INSERT INTO system_feedback_email_receipts(intent_id,observation) VALUES('45000000-0000-4000-8000-000000000003','{"kind":"inbox_observed"}');
SELECT fixture_assert(count(*) FILTER(WHERE (r->>'protected_attachment_pending')::boolean)=2 AND
 bool_or(r->>'evidence_state'='inbox_observed' AND NOT(r->>'protected_attachment_pending')::boolean),'Feedback protected attachment count, verified Inbox and terminal attention')
 FROM jsonb_array_elements(custodial_feedback_delivery_status(array(select id from system_feedback_items))) r;
SELECT fixture_assert(feedback_email_relay_command('relay:'||repeat('b',64),'status',jsonb_build_object('contract_version','custodial-feedback-relay.v2','adapter_schema_sha256',repeat('c',64)))->>'protected_attachment_pending'='2','Relay counts only outstanding unverified attachments');
