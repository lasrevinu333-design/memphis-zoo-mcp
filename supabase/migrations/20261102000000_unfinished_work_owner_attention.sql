-- Owner clarification: timed-out unfinished work needs Eric's attention and explicit clear.
-- Source-only follow-on; no production execution or native phone/key-removal admission.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
IF encode(extensions.digest(convert_to(pg_get_functiondef('public.expire_stale_open_sessions(timestamp with time zone)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM '97070694ca30316cf8bea79af865a45a5296846e4f4b0c4f4e8b74ff08c7534c' THEN RAISE EXCEPTION 'Unfinished work predecessor changed: public.expire_stale_open_sessions';END IF;
IF encode(extensions.digest(convert_to(pg_get_functiondef('custodial_leadership_private.record_operation_v1(jsonb,text,jsonb)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM '9a4d647811dce84bcd4e6c8d51bb3baa352af2ea5e01f7677dd73686580657ef' THEN RAISE EXCEPTION 'Unfinished work predecessor changed: custodial_leadership_private.record_operation_v1';END IF;
IF encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_leadership_record_operation_v1(uuid,uuid,text,text,jsonb)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM 'dee93b4352fe234c08faf9a8b6b1aaf28e4a79e66344739414cfaa8621c9b441' THEN RAISE EXCEPTION 'Unfinished work predecessor changed: public.custodial_leadership_record_operation_v1';END IF;
IF encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_claim_offline_reconciliation_notification_recipients(uuid,text,uuid,jsonb,text)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM 'b375f7889c415e8176229dacb631eac26ecda812cc29c38e99b68c908e631549' THEN RAISE EXCEPTION 'Unfinished work predecessor changed: public.custodial_claim_offline_reconciliation_notification_recipients';END IF;
END $guard$;
CREATE TABLE custodial_leadership_private.unfinished_notices_v1(
 notice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN('session','native_context')),
 source_id uuid NOT NULL,snapshot jsonb NOT NULL,deadline_at timestamptz NOT NULL,noticed_at timestamptz NOT NULL,
 UNIQUE(kind,source_id));
CREATE TABLE custodial_leadership_private.unfinished_clears_v1(
 operation_id uuid PRIMARY KEY,notice_id uuid NOT NULL UNIQUE REFERENCES custodial_leadership_private.unfinished_notices_v1(notice_id),
 actor jsonb NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE custodial_leadership_private.unfinished_notices_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodial_leadership_private.unfinished_clears_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON custodial_leadership_private.unfinished_notices_v1,custodial_leadership_private.unfinished_clears_v1 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
CREATE FUNCTION custodial_leadership_private.unfinished_evidence_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$ BEGIN RAISE EXCEPTION 'Unfinished-work evidence is append-only' USING ERRCODE='23514';END $f$;
REVOKE ALL ON FUNCTION custodial_leadership_private.unfinished_evidence_immutable_v1() FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON custodial_leadership_private.unfinished_notices_v1 FOR EACH ROW EXECUTE FUNCTION custodial_leadership_private.unfinished_evidence_immutable_v1();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON custodial_leadership_private.unfinished_notices_v1 FOR EACH STATEMENT EXECUTE FUNCTION custodial_leadership_private.unfinished_evidence_immutable_v1();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON custodial_leadership_private.unfinished_clears_v1 FOR EACH ROW EXECUTE FUNCTION custodial_leadership_private.unfinished_evidence_immutable_v1();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON custodial_leadership_private.unfinished_clears_v1 FOR EACH STATEMENT EXECUTE FUNCTION custodial_leadership_private.unfinished_evidence_immutable_v1();
ALTER TABLE public.custodial_offline_reconciliation_outbox ADD COLUMN unfinished_notice_id uuid REFERENCES custodial_leadership_private.unfinished_notices_v1(notice_id) ON DELETE RESTRICT;
ALTER TABLE public.custodial_offline_reconciliation_outbox ALTER COLUMN reconciliation_id DROP NOT NULL;
ALTER TABLE public.custodial_offline_reconciliation_outbox DROP CONSTRAINT custodial_offline_reconciliation_outbox_notification_kind_check;
ALTER TABLE public.custodial_offline_reconciliation_outbox ADD CONSTRAINT custodial_offline_reconciliation_outbox_notification_kind_check CHECK(notification_kind IN('offline_reconciliation_quarantine','offline_reconciliation_disposition','unfinished_work_timeout'));
ALTER TABLE public.custodial_offline_reconciliation_outbox ADD CONSTRAINT unfinished_notice_source_v1 CHECK(
 (notification_kind='unfinished_work_timeout' AND unfinished_notice_id IS NOT NULL AND reconciliation_id IS NULL AND disposition_id IS NULL)
 OR(notification_kind<>'unfinished_work_timeout' AND unfinished_notice_id IS NULL AND reconciliation_id IS NOT NULL));
CREATE UNIQUE INDEX unfinished_notice_outbox_v1 ON public.custodial_offline_reconciliation_outbox(unfinished_notice_id) WHERE unfinished_notice_id IS NOT NULL;

-- Deliver to the CURRENT selected-name cohort inbox, never the retired named
-- account or the shared cohort principal's pooled inbox.
CREATE FUNCTION public.custodial_unfinished_work_recipient_v1(p_backend_execution_secret text)
RETURNS TABLE(manager_id uuid,user_id uuid,system_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE m public.ops_manager_managers%rowtype;cohort uuid;u public.msg_users%rowtype;
BEGIN
 PERFORM public.custodial_require_backend_execution_secret(p_backend_execution_secret);
 SELECT * INTO m FROM public.ops_manager_managers z WHERE z.system_key='eric_custodial_manager' AND z.active AND z.revoked_at IS NULL AND NOT z.is_system_principal;
 SELECT cohort_principal_id INTO cohort FROM custodial_leadership_private.policy WHERE singleton AND enabled;
 IF m.manager_id IS NULL OR cohort IS NULL OR NOT custodial_leadership_private.messaging_account_active(cohort,m.manager_id) THEN RETURN;END IF;
 u:=custodial_leadership_private.ensure_messaging_account(cohort,m.manager_id,m.display_name);
 RETURN QUERY SELECT m.manager_id,u.id,m.system_key;
END $f$;
REVOKE ALL ON FUNCTION public.custodial_unfinished_work_recipient_v1(text) FROM PUBLIC,anon,authenticated,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_unfinished_work_recipient_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_stale_open_sessions(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $f$
DECLARE r record;n uuid;total integer:=0;minutes integer:=public.get_setting_int('stale_session_timeout_minutes',120);
BEGIN
 IF p_now IS NULL OR minutes<1 THEN RAISE EXCEPTION 'Valid existing timeout and clock required' USING ERRCODE='22023';END IF;
 FOR r IN
  SELECT 'session'::text kind,s.id source_id,coalesce(s.ended_at,s.started_at)+make_interval(mins=>minutes) deadline,
   jsonb_build_object('session_id',s.id,'session_uuid',s.session_uuid,'employee_id',s.employee_id,'device_id',s.device_id,'location_id',s.location_id,'started_at',s.started_at,'ended_at',s.ended_at,'status',s.status) snapshot
  FROM public.sessions s WHERE s.status IN('active','pending_submit') AND coalesce(s.ended_at,s.started_at)<=p_now-make_interval(mins=>minutes)
   AND NOT EXISTS(SELECT 1 FROM public.custodial_offline_actor_contexts c WHERE c.client_session_id=s.client_session_id AND c.status='activated')
  UNION ALL
  SELECT 'native_context',c.context_id,c.expires_at,jsonb_build_object('context_id',c.context_id,'occurrence_id',c.occurrence_id,'client_session_id',c.client_session_id,'employee_id',c.employee_id,'device_id',c.device_id,'location_id',c.location_id,'started_at',c.started_at,'expires_at',c.expires_at,'occurrence_fingerprint',c.occurrence_fingerprint)
  FROM public.custodial_offline_actor_contexts c JOIN public.custodial_offline_submission_proofs p ON p.context_id=c.context_id AND p.state='issued'
  WHERE c.status='activated' AND c.expires_at<=p_now
 LOOP
  n:=NULL;
  INSERT INTO custodial_leadership_private.unfinished_notices_v1(kind,source_id,snapshot,deadline_at,noticed_at)
   VALUES(r.kind,r.source_id,r.snapshot,r.deadline,p_now) ON CONFLICT(kind,source_id) DO NOTHING RETURNING notice_id INTO n;
  IF n IS NOT NULL THEN
   INSERT INTO public.custodial_offline_reconciliation_outbox(unfinished_notice_id,notification_key,notification_kind,payload_json,next_attempt_at)
    VALUES(n,'unfinished-work:'||n::text,'unfinished_work_timeout',jsonb_build_object('notice_id',n,'deadline_at',r.deadline,'attention_required',true,'action','Review unfinished work and explicitly clear it. Original work and history are preserved.','href','./unfinished-work.html'),now());
   total:=total+1;
  END IF;
 END LOOP;
 RETURN total;
END $f$;
COMMENT ON FUNCTION public.expire_stale_open_sessions(timestamptz) IS 'Records existing-timeout attention and queues Eric notice. No automatic clearing or completed-cleaning claim; explicit authenticated clear is required.';
REVOKE ALL ON FUNCTION public.expire_stale_open_sessions(timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_open_sessions(timestamptz) TO postgres;
CREATE FUNCTION custodial_leadership_private.unfinished_work_operation_v1(p_actor jsonb,p_action text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $f$
DECLARE m uuid;n custodial_leadership_private.unfinished_notices_v1%rowtype;old custodial_leadership_private.unfinished_clears_v1%rowtype;
 s public.sessions%rowtype;c public.custodial_offline_actor_contexts%rowtype;p public.custodial_offline_submission_proofs%rowtype;
 op uuid;reason text;result jsonb;sid uuid;items jsonb;v_limit integer;cleared boolean:=false;
BEGIN
 m:=(p_actor->>'manager_id')::uuid;
 IF p_actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' THEN
  PERFORM custodial_leadership_private.assert_scoped_cohort_actor_v1(p_actor,m);
  m:=(p_actor->>'claimed_account_id')::uuid;
 ELSIF p_actor->>'actor_kind' IS DISTINCT FROM 'NAMED_MANAGER' THEN RAISE EXCEPTION 'Authenticated Eric selection required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ops_manager_managers WHERE manager_id=m AND system_key='eric_custodial_manager' AND active AND revoked_at IS NULL AND is_system_principal=false) THEN
  RAISE EXCEPTION 'Current Eric custodial manager selection required' USING ERRCODE='42501';END IF;
 IF p_action='unfinished_work' THEN
  IF (p_input-ARRAY['limit'])<>'{}'::jsonb OR jsonb_typeof(p_input->'limit') IS DISTINCT FROM 'number' OR (p_input->>'limit')!~'^[0-9]+$' THEN RAISE EXCEPTION 'Bounded limit required' USING ERRCODE='22023';END IF;
  v_limit:=(p_input->>'limit')::integer;IF v_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Bounded limit required' USING ERRCODE='22023';END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('notice_id',x.notice_id,'kind',x.kind,'deadline_at',x.deadline_at,'noticed_at',x.noticed_at,'employee',coalesce(e.display_name,'Original employee unavailable'),'location',coalesce(l.location_name,'Original location unavailable'),'started_at',x.snapshot->>'started_at','attention_required',true) ORDER BY x.noticed_at,x.notice_id),'[]'::jsonb)
   INTO items FROM (SELECT * FROM custodial_leadership_private.unfinished_notices_v1 z WHERE NOT EXISTS(SELECT 1 FROM custodial_leadership_private.unfinished_clears_v1 q WHERE q.notice_id=z.notice_id) ORDER BY z.noticed_at,z.notice_id LIMIT v_limit+1) x
   LEFT JOIN public.employees e ON e.id=(x.snapshot->>'employee_id')::uuid LEFT JOIN public.locations l ON l.id=(x.snapshot->>'location_id')::uuid;
  RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) FROM jsonb_array_elements(items) WITH ORDINALITY WHERE ordinality<=v_limit),'truncated',jsonb_array_length(items)>v_limit,'limit',v_limit);
 END IF;
 IF p_action NOT IN('clear_unfinished_work','unfinished_work_outcome') OR NOT(p_input ?& ARRAY['notice_id','operation_id']) THEN RAISE EXCEPTION 'Exact unfinished work operation required' USING ERRCODE='22023';END IF;
 op:=(p_input->>'operation_id')::uuid;
 IF op IS NULL OR (p_input->>'notice_id') IS NULL THEN RAISE EXCEPTION 'Original operation identity required' USING ERRCODE='22023';END IF;
 SELECT * INTO n FROM custodial_leadership_private.unfinished_notices_v1 WHERE notice_id=(p_input->>'notice_id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unfinished work notice not found' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('custodial-unfinished-clear:'||op::text,0));
 SELECT * INTO old FROM custodial_leadership_private.unfinished_clears_v1 WHERE operation_id=op;
 IF p_action='unfinished_work_outcome' THEN
  IF (p_input-ARRAY['notice_id','operation_id'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Only original identities allowed' USING ERRCODE='22023';END IF;
  IF old.operation_id IS NULL THEN RETURN jsonb_build_object('found',false,'notice_id',n.notice_id,'operation_id',op);END IF;
  IF old.notice_id<>n.notice_id OR old.actor->>'claimed_account_id' IS DISTINCT FROM p_actor->>'claimed_account_id' OR old.actor->>'manager_id' IS DISTINCT FROM p_actor->>'manager_id' THEN RAISE EXCEPTION 'Original operation conflict' USING ERRCODE='23505';END IF;
  RETURN old.result||jsonb_build_object('found',true,'replayed',true);
 END IF;
 reason:=btrim(p_input->>'reason');
 IF (p_input-ARRAY['notice_id','operation_id','reason'])<>'{}'::jsonb OR reason IS NULL OR length(reason) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Explicit reason required' USING ERRCODE='22023';END IF;
 IF old.operation_id IS NOT NULL THEN
  IF old.notice_id<>n.notice_id OR old.reason<>reason OR old.actor->>'claimed_account_id' IS DISTINCT FROM p_actor->>'claimed_account_id' OR old.actor->>'manager_id' IS DISTINCT FROM p_actor->>'manager_id' THEN RAISE EXCEPTION 'Original operation conflict' USING ERRCODE='23505';END IF;
  RETURN old.result||jsonb_build_object('replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM custodial_leadership_private.unfinished_clears_v1 WHERE notice_id=n.notice_id) THEN RAISE EXCEPTION 'Notice already reconciled by another operation' USING ERRCODE='23505';END IF;
 IF n.kind='session' THEN
  SELECT * INTO s FROM public.sessions WHERE id=n.source_id FOR UPDATE;
  IF s.id IS NULL OR s.session_uuid IS DISTINCT FROM n.snapshot->>'session_uuid' OR s.started_at IS DISTINCT FROM (n.snapshot->>'started_at')::timestamptz OR s.employee_id IS DISTINCT FROM (n.snapshot->>'employee_id')::uuid OR s.device_id IS DISTINCT FROM (n.snapshot->>'device_id')::uuid OR s.location_id IS DISTINCT FROM (n.snapshot->>'location_id')::uuid THEN RAISE EXCEPTION 'Original work identity changed' USING ERRCODE='40001';END IF;
  sid:=s.id;
  IF s.status IN('active','pending_submit') THEN
   UPDATE public.sessions SET status='cancelled',ended_at=coalesce(ended_at,clock_timestamp()),completion_source=coalesce(completion_source,'admin'),updated_at=clock_timestamp() WHERE id=s.id;
   cleared:=true;
  ELSIF s.status NOT IN('closed','cancelled') THEN RAISE EXCEPTION 'Unsupported original work state' USING ERRCODE='40001';END IF;
 ELSE
  SELECT * INTO c FROM public.custodial_offline_actor_contexts WHERE context_id=n.source_id FOR UPDATE;
  SELECT * INTO p FROM public.custodial_offline_submission_proofs WHERE context_id=n.source_id FOR UPDATE;
  IF c.context_id IS NULL OR c.occurrence_fingerprint IS DISTINCT FROM n.snapshot->>'occurrence_fingerprint' OR c.expires_at IS DISTINCT FROM (n.snapshot->>'expires_at')::timestamptz OR c.client_session_id IS DISTINCT FROM n.snapshot->>'client_session_id' THEN RAISE EXCEPTION 'Original native work identity changed' USING ERRCODE='40001';END IF;
  IF c.status='activated' AND p.state='issued' THEN
   INSERT INTO public.sessions(session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at,ended_at,completion_source,created_at,updated_at)
    VALUES(c.client_session_id,c.client_session_id,c.location_id,c.employee_id,c.device_id,'cancelled',c.started_at,clock_timestamp(),'admin',c.created_at,clock_timestamp()) ON CONFLICT DO NOTHING RETURNING id INTO sid;
   IF sid IS NULL THEN RAISE EXCEPTION 'Original native occurrence already has a terminal record; review it before clearing' USING ERRCODE='40001';END IF;
   -- Same existing canonical-owner transition; browser and API roles have no direct helper access.
   PERFORM set_config('custodial.offline_expiry_transition','expire_stale_open_sessions',true);
   UPDATE public.custodial_offline_actor_contexts SET status='cancelled' WHERE context_id=c.context_id;
   UPDATE public.custodial_offline_submission_proofs SET state='quarantined',consumed_at=clock_timestamp() WHERE submission_id=p.submission_id;
   cleared:=true;
  ELSIF c.status IN('committed','cancelled','quarantined') THEN NULL;
  ELSE RAISE EXCEPTION 'Original native occurrence needs review before clearing' USING ERRCODE='40001';END IF;
 END IF;
 IF sid IS NOT NULL THEN INSERT INTO public.session_events(session_id,event_type,actor_type,actor_ref,details_json)
  VALUES(sid,'unfinished_work_explicitly_reconciled','manager',m::text,jsonb_build_object('notice_id',n.notice_id,'operation_id',op,'reason',reason,'actor',p_actor,'cancelled',cleared));END IF;
 result:=jsonb_build_object('notice_id',n.notice_id,'operation_id',op,'status',CASE WHEN cleared THEN 'cancelled_without_completion' ELSE 'already_terminal_acknowledged' END,'history_preserved',true,'phone_released',false,'key_removal',false,'replayed',false);
 INSERT INTO custodial_leadership_private.unfinished_clears_v1(operation_id,notice_id,actor,reason,result) VALUES(op,n.notice_id,p_actor,reason,result);
 RETURN result;
END $f$;
REVOKE ALL ON FUNCTION custodial_leadership_private.unfinished_work_operation_v1(jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE OR REPLACE FUNCTION custodial_leadership_private.record_operation_v1(p_actor jsonb, p_action text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
 p_operation_id uuid;p_session_id uuid;p_manager_id uuid;p_reason text;
 p_corrected_employee_id uuid;p_corrected_location_id uuid;p_corrected_device_id uuid;
 p_corrected_started_at timestamptz;p_corrected_ended_at timestamptz;
 v_fingerprint text;v_existing public.custodial_session_corrections%rowtype;v_current record;
 v_manager_name text;v_employee record;v_location record;v_device record;
 v_employee_id uuid;v_location_id uuid;v_device_id uuid;v_started_at timestamptz;v_ended_at timestamptz;
 v_changed_fields text[];v_inserted public.custodial_session_corrections%rowtype;
 v_result jsonb;v_limit integer;v_key text;v_status text;v_session_uuid text;v_current_correction uuid;
BEGIN
 IF p_actor->>'manager_id' IS NULL OR (p_actor->>'actor_kind' IN ('NAMED_MANAGER','CUSTODIAL_LEADERSHIP_COHORT')) IS NOT TRUE THEN
  RAISE EXCEPTION 'Authorized record actor required' USING ERRCODE='42501'; END IF;
 p_manager_id:=(p_actor->>'manager_id')::uuid;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR octet_length(p_input::text)>(CASE WHEN p_action='place_operation' THEN 65536 ELSE 16384 END) THEN
  RAISE EXCEPTION 'Bounded typed record input required' USING ERRCODE='22023';END IF;
 IF p_action IN('unfinished_work','clear_unfinished_work','unfinished_work_outcome') THEN RETURN custodial_leadership_private.unfinished_work_operation_v1(p_actor,p_action,p_input);
 ELSIF p_action='place_operation' THEN RETURN custodial_leadership_private.place_operation_v1(p_actor,p_input);
 ELSIF p_action IN ('feedback_triage','feedback_triage_status') THEN RETURN custodial_leadership_private.feedback_operation_v1(p_actor,p_action,p_input);
 ELSIF p_action='completion_evidence' THEN
  IF NOT(p_input ? 'session_uuid') OR (p_input-ARRAY['session_uuid'])<>'{}'::jsonb
   OR jsonb_typeof(p_input->'session_uuid') IS DISTINCT FROM 'string'
   OR length(p_input->>'session_uuid') NOT BETWEEN 1 AND 200
   OR btrim(p_input->>'session_uuid') IS DISTINCT FROM p_input->>'session_uuid' THEN
   RAISE EXCEPTION 'Exact completion session identity required' USING ERRCODE='22023';END IF;
  RETURN custodial_leadership_private.completion_evidence_v1(p_input->>'session_uuid');
 ELSIF p_action='choices' THEN
  IF p_input<>'{}'::jsonb THEN RAISE EXCEPTION 'No choices parameters allowed' USING ERRCODE='22023';END IF;
  IF (SELECT count(*) FROM public.employees)>5000 OR (SELECT count(*) FROM public.locations)>5000 OR (SELECT count(*) FROM public.devices)>5000 THEN
   RAISE EXCEPTION 'Complete bounded choices unavailable' USING ERRCODE='54000';END IF;
  RETURN jsonb_build_object(
   'employees',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',display_name) ORDER BY display_name,id),'[]'::jsonb) FROM public.employees),
   'locations',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',location_name||' ('||location_code||')') ORDER BY location_name,id),'[]'::jsonb) FROM public.locations),
   'devices',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',device_name||' ('||device_id||')') ORDER BY device_name,id),'[]'::jsonb) FROM public.devices));
 ELSIF p_action='open_problems' THEN
  IF NOT(p_input ? 'limit') OR (p_input-ARRAY['limit'])<>'{}'::jsonb OR jsonb_typeof(p_input->'limit') IS DISTINCT FROM 'number'
   OR (p_input->>'limit')!~'^[0-9]+$' THEN RAISE EXCEPTION 'Integer problem limit required' USING ERRCODE='22023';END IF;
  v_limit:=(p_input->>'limit')::integer;IF v_limit<1 OR v_limit>200 THEN RAISE EXCEPTION 'Problem limit out of bounds' USING ERRCODE='22023';END IF;
  with items as (
    select 'maintenance'::text as source, t.id::text as source_id,
      case when t.issue_source='completion_form' then 'Cleaning issue / maintenance reminder'
        else 'Maintenance reminder' end as source_label,
      coalesce(t.location_name_snapshot,l.location_name,t.location_code_snapshot,l.location_code) as location,
      t.issue_summary as summary,t.reported_at as observed_at,'open'::text as status,
      t.issue_source as source_detail
    from public.maintenance_tickets t left join public.locations l on l.id=t.location_id
    where t.status='open'
    union all
    select 'guest'::text,g.id::text,'Approved guest issue'::text,
      coalesce(g.location_name,g.location_code),g.issue_type,g.submitted_at,'open'::text,g.severity
    from public.guest_cleanliness_reports g
    where g.status='open' and g.marketing_review_status='approved'
      and exists(select 1 from public.system_settings s where s.setting_key='guest_issues_feature_approved'
        and s.setting_value='true'::jsonb)
    union all
    select 'saved_work'::text,r.reconciliation_id::text,'Protected saved work needs review'::text,
      coalesce(l.location_name,l.location_code,'Location not available'),
      'Protected work requires manager review'::text,r.created_at,
      'quarantined'::text,'offline_reconciliation'::text
    from public.custodial_offline_reconciliation_records r
    left join public.locations l on l.id=r.location_id
    where r.state='quarantined' and not exists (
      select 1 from public.custodial_offline_reconciliation_dispositions d
      where d.reconciliation_id=r.reconciliation_id and d.disposition='superseded_by_new_occurrence'
    )
  ), bounded as (
    select * from items order by observed_at desc nulls last,source,source_id limit v_limit
  )
  select jsonb_build_object('total',(select count(*) from items),
    'items',coalesce(jsonb_agg(to_jsonb(b) order by b.observed_at desc nulls last,b.source,b.source_id),'[]'::jsonb))
    into v_result from bounded b;
  RETURN v_result||jsonb_build_object('schema','custodial.open-problems.v1','generated_at',clock_timestamp());
 ELSIF p_action='truth' THEN
  IF NOT(p_input ? 'session_id') OR (p_input-ARRAY['session_id'])<>'{}'::jsonb OR jsonb_typeof(p_input->'session_id') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Session identity required' USING ERRCODE='22023';END IF;
  SELECT to_jsonb(v) INTO v_result FROM public.v_custodial_cleaning_session_truth v WHERE v.session_id=(p_input->>'session_id')::uuid;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Cleaning session not found' USING ERRCODE='P0002';END IF;RETURN v_result;
 ELSIF p_action='correction_outcome' THEN
  IF NOT(p_input ?& ARRAY['session_id','operation_id']) OR (p_input-ARRAY['session_id','operation_id'])<>'{}'::jsonb
   OR jsonb_typeof(p_input->'session_id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'operation_id') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Original operation and session required' USING ERRCODE='22023';END IF;
  p_session_id:=(p_input->>'session_id')::uuid;p_operation_id:=(p_input->>'operation_id')::uuid;
  SELECT * INTO v_existing FROM public.custodial_session_corrections WHERE operation_id=p_operation_id AND session_id=p_session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('found',false,'operation_id',p_operation_id,'session_id',p_session_id);END IF;
  RETURN jsonb_build_object('found',true,'correction_id',v_existing.correction_id,'session_id',v_existing.session_id,
   'operation_id',v_existing.operation_id,'replayed',true,'changed_fields',v_existing.changed_fields,'created_at',v_existing.created_at,
   'actor_manager_id',v_existing.corrected_by_manager_id,'actor_name',v_existing.corrected_by_manager_name_snapshot,'reason',v_existing.reason);
 ELSIF p_action IS DISTINCT FROM 'correct' THEN RAISE EXCEPTION 'Record action unsupported' USING ERRCODE='22023';END IF;
 IF NOT(p_input ?& ARRAY['session_id','operation_id','reason','expected_correction_id','expected_session_uuid'])
  OR (p_input-ARRAY['session_id','operation_id','reason','expected_correction_id','expected_session_uuid','corrected_employee_id','corrected_location_id','corrected_device_id','corrected_started_at','corrected_ended_at'])<>'{}'::jsonb
  OR jsonb_typeof(p_input->'session_id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'operation_id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'expected_session_uuid') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_input->'expected_correction_id') NOT IN ('string','null')
  OR length(p_input->>'expected_session_uuid') NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'Typed correction and preview marker required' USING ERRCODE='22023';END IF;
 FOREACH v_key IN ARRAY ARRAY['corrected_employee_id','corrected_location_id','corrected_device_id','corrected_started_at','corrected_ended_at'] LOOP
  IF p_input ? v_key AND jsonb_typeof(p_input->v_key) NOT IN ('string','null') THEN RAISE EXCEPTION 'Typed correction fact required' USING ERRCODE='22023';END IF;
  IF v_key LIKE '%_at' AND p_input->>v_key IS NOT NULL AND (p_input->>v_key)!~'^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,6})?)?(Z|[+-]\d\d:\d\d)$' THEN
   RAISE EXCEPTION 'Explicit timestamp offset required' USING ERRCODE='22023';END IF;
 END LOOP;
 p_session_id:=(p_input->>'session_id')::uuid;p_operation_id:=(p_input->>'operation_id')::uuid;
 p_reason:=btrim(p_input->>'reason');IF length(p_reason) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Correction reason required' USING ERRCODE='22023';END IF;
 p_corrected_employee_id:=(p_input->>'corrected_employee_id')::uuid;p_corrected_location_id:=(p_input->>'corrected_location_id')::uuid;p_corrected_device_id:=(p_input->>'corrected_device_id')::uuid;
 p_corrected_started_at:=(p_input->>'corrected_started_at')::timestamptz;p_corrected_ended_at:=(p_input->>'corrected_ended_at')::timestamptz;
 v_manager_name:=CASE WHEN p_actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' THEN (p_actor->>'claimed_name')||' (shared PIN; self-asserted)' ELSE p_actor->>'manager_name' END;
 IF nullif(btrim(v_manager_name),'') IS NULL THEN RAISE EXCEPTION 'Original actor label required' USING ERRCODE='42501';END IF;
 v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('actor_kind',p_actor->>'actor_kind','manager_id',p_manager_id,
  'claimed_account_id',p_actor->>'claimed_account_id','operation_id',p_operation_id,'session_id',p_session_id,'reason',p_reason,
  'expected_session_uuid',p_input->>'expected_session_uuid','expected_correction_id',(p_input->>'expected_correction_id')::uuid,
  'employee_id',p_corrected_employee_id,'location_id',p_corrected_location_id,'device_id',p_corrected_device_id,
  'started_at',p_corrected_started_at,'ended_at',p_corrected_ended_at)::text,'UTF8'),'sha256'),'hex');
 -- Serialize the original operation before inspecting its durable result.
 PERFORM pg_advisory_xact_lock(hashtextextended('custodial.record.operation:'||p_operation_id::text,0));
 SELECT * INTO v_existing FROM public.custodial_session_corrections WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN RAISE EXCEPTION 'Correction operation payload differs' USING ERRCODE='40901';END IF;
  RETURN jsonb_build_object('correction_id',v_existing.correction_id,'session_id',v_existing.session_id,'operation_id',v_existing.operation_id,
   'replayed',true,'changed_fields',v_existing.changed_fields,'created_at',v_existing.created_at);
 END IF;
 -- Lock first, then use a new statement snapshot to read the latest correction.
 SELECT s.status,s.session_uuid INTO v_status,v_session_uuid FROM public.sessions s WHERE s.id=p_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cleaning session not found' USING ERRCODE='P0002';END IF;
 IF v_status IS DISTINCT FROM 'closed' THEN RAISE EXCEPTION 'Only completed records can be corrected here' USING ERRCODE='40901';END IF;
 SELECT v.current_employee_id employee_id,v.current_location_id location_id,v.current_device_id device_id,
  v.current_started_at started_at,v.current_ended_at ended_at,v.correction_id INTO v_current
 FROM public.v_custodial_cleaning_session_truth v WHERE v.session_id=p_session_id;
 IF v_current.ended_at IS NULL OR v_session_uuid IS DISTINCT FROM p_input->>'expected_session_uuid'
  OR v_current.correction_id IS DISTINCT FROM (p_input->>'expected_correction_id')::uuid THEN
  RAISE EXCEPTION 'Correction preview no longer matches completed record' USING ERRCODE='40901';END IF;
  v_employee_id := coalesce(p_corrected_employee_id,v_current.employee_id);
  v_location_id := coalesce(p_corrected_location_id,v_current.location_id);
  v_device_id := coalesce(p_corrected_device_id,v_current.device_id);
  v_started_at := coalesce(p_corrected_started_at,v_current.started_at);
  v_ended_at := coalesce(p_corrected_ended_at,v_current.ended_at);

  v_changed_fields := array_remove(array[
    case when v_employee_id is distinct from v_current.employee_id then 'employee' end,
    case when v_location_id is distinct from v_current.location_id then 'location' end,
    case when v_device_id is distinct from v_current.device_id then 'device' end,
    case when v_started_at is distinct from v_current.started_at then 'started_at' end,
    case when v_ended_at is distinct from v_current.ended_at then 'ended_at' end
  ],null);
  if cardinality(v_changed_fields) = 0 then
    raise exception using errcode='22023', message='Correction must change at least one manager-visible fact';
  end if;
  if v_ended_at is not null and v_ended_at < v_started_at then
    raise exception using errcode='22023', message='Corrected cleaning end time cannot precede its start time';
  end if;

  select e.id,e.display_name into v_employee from public.employees e where e.id = v_employee_id;
  select l.id,l.location_code,l.location_name into v_location from public.locations l where l.id = v_location_id;
  select d.id,d.device_id,d.device_name,d.assignment_epoch into v_device from public.devices d where d.id = v_device_id;
  if v_employee.id is null or v_location.id is null or v_device.id is null then
    raise exception using errcode='23503', message='Corrected employee, location, and phone must exist';
  end if;

  insert into public.custodial_session_corrections(
    operation_id,request_fingerprint,session_id,corrected_by_manager_id,corrected_by_manager_name_snapshot,
    reason,changed_fields,effective_employee_id,effective_employee_name_snapshot,effective_location_id,
    effective_location_code_snapshot,effective_location_name_snapshot,effective_device_id,
    effective_device_identifier_snapshot,effective_device_name_snapshot,effective_assignment_epoch_snapshot,
    effective_started_at,effective_ended_at
  ) values (
    p_operation_id,v_fingerprint,p_session_id,p_manager_id,v_manager_name,btrim(p_reason),v_changed_fields,
    v_employee.id,v_employee.display_name,v_location.id,v_location.location_code,v_location.location_name,
    v_device.id,v_device.device_id,v_device.device_name,v_device.assignment_epoch,v_started_at,v_ended_at
  ) returning * into v_inserted;

  INSERT INTO public.ops_manager_auth_events(credential_id,device_id,event_type,success,detail_json)
   VALUES(NULL,p_actor->>'device_id','cleaning_record_correction_recorded',true,jsonb_build_object('correction_id',v_inserted.correction_id,'operation_id',p_operation_id,'session_id',p_session_id,'actor',p_actor));
  return jsonb_build_object('correction_id',v_inserted.correction_id,'session_id',v_inserted.session_id,
    'operation_id',v_inserted.operation_id,'replayed',false,'changed_fields',v_inserted.changed_fields,
    'created_at',v_inserted.created_at);
END $function$
;
CREATE OR REPLACE FUNCTION public.custodial_leadership_record_operation_v1(p_manager_id uuid, p_credential_id uuid, p_device_id text, p_action text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE actor jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,'full_access',CASE WHEN p_action IN ('correct','feedback_triage','clear_unfinished_work') OR (p_action='place_operation' AND p_input->>'action'<>'preview') THEN 'write' ELSE 'read' END);
 IF actor->>'actor_kind' IS DISTINCT FROM 'CUSTODIAL_LEADERSHIP_COHORT' OR actor->'owner' IS DISTINCT FROM 'false'::jsonb
  OR actor->>'identity_assurance' IS DISTINCT FROM 'SELF_ASSERTED_NAME' OR actor->'individual_identity_verified' IS DISTINCT FROM 'false'::jsonb
  OR actor->>'manager_id' IS DISTINCT FROM p_manager_id::text OR actor->>'credential_id' IS DISTINCT FROM p_credential_id::text
  OR actor->>'device_id' IS DISTINCT FROM p_device_id OR actor->>'request_id' IS NULL THEN
  RAISE EXCEPTION 'Authenticated original cohort context required' USING ERRCODE='42501';END IF;
 RETURN custodial_leadership_private.record_operation_v1(actor,p_action,p_input);
END $function$
;
CREATE OR REPLACE FUNCTION public.custodial_claim_offline_reconciliation_notification_recipients(p_outbox_id uuid, p_worker_id text, p_outbox_lease_token uuid, p_recipients jsonb, p_backend_execution_secret text)
 RETURNS TABLE(delivery_recipient_id uuid, manager_id uuid, recipient_user_id uuid, client_message_id text, notification_instance_key text, attempts integer, lease_token uuid, lease_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_outbox public.custodial_offline_reconciliation_outbox%rowtype;
  v_worker_id text := nullif(btrim(coalesce(p_worker_id,'')), '');
  v_expected integer;
  v_inserted integer;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_worker_id is null or length(v_worker_id)>200 or p_outbox_id is null then raise exception using errcode='22023',message='a bounded worker and notification identity are required'; end if;
  select * into v_outbox from public.custodial_offline_reconciliation_outbox where outbox_id=p_outbox_id for update;
  if v_outbox.outbox_id is null then raise exception using errcode='P0002',message='offline reconciliation notification was not found'; end if;
  if v_outbox.state<>'claimed' or v_outbox.claimed_by<>v_worker_id or v_outbox.lease_token is distinct from p_outbox_lease_token or v_outbox.lease_expires_at<=now() then
    raise exception using errcode='40901',message='notification claim is no longer owned by this worker';
  end if;
  if not exists(select 1 from public.custodial_offline_reconciliation_delivery_recipients where outbox_id=p_outbox_id) then
    if jsonb_typeof(coalesce(p_recipients,'null'::jsonb))<>'array' or jsonb_array_length(p_recipients) not between 1 and 100 then
      raise exception using errcode='22023',message='one to one hundred authoritative named-manager recipients are required';
    end if;
    select count(*) into v_expected from (
      select distinct input.manager_id,input.user_id from jsonb_to_recordset(p_recipients) as input(manager_id uuid,user_id uuid)
    ) candidates;
    insert into public.custodial_offline_reconciliation_delivery_recipients(
      outbox_id,manager_id,recipient_user_id,client_message_id,notification_instance_key
    )
    select p_outbox_id,c.manager_id,c.user_id,
      'offline-reconciliation:'||p_outbox_id::text||':'||c.user_id::text,
      'offline-reconciliation:'||p_outbox_id::text||':'||c.user_id::text
    from (select distinct input.manager_id,input.user_id from jsonb_to_recordset(p_recipients) as input(manager_id uuid,user_id uuid)) c
    join public.ops_manager_managers m on m.manager_id=c.manager_id and m.active=true and m.revoked_at is null and m.is_system_principal=false
    join public.msg_users u on u.id=c.user_id and coalesce(u.is_active,true)=true
     and ((v_outbox.notification_kind<>'unfinished_work_timeout' and u.ops_manager_id=m.manager_id)
       or(v_outbox.notification_kind='unfinished_work_timeout' and m.system_key='eric_custodial_manager'
        and u.custodial_claimed_account_id=m.manager_id and u.ops_manager_id is null
        and custodial_leadership_private.messaging_account_active(u.custodial_cohort_manager_id,u.custodial_claimed_account_id)));
    get diagnostics v_inserted=row_count;
    if v_inserted<>v_expected then raise exception using errcode='42501',message='notification recipients must be active named-manager Messenger identities'; end if;
    insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,delivery_recipient_id,event_type,evidence_json)
      select p_outbox_id,r.delivery_recipient_id,'recipient_declared',jsonb_build_object('manager_id',r.manager_id,'recipient_user_id',r.recipient_user_id,'client_message_id',r.client_message_id)
      from public.custodial_offline_reconciliation_delivery_recipients r where r.outbox_id=p_outbox_id;
  end if;
  with exhausted as (
    update public.custodial_offline_reconciliation_delivery_recipients r
    set state='failed',failed_at=now(),claimed_by=null,lease_token=null,claimed_at=null,lease_expires_at=null,
      last_error='recipient delivery lease expired after maximum attempts'
    where r.outbox_id=p_outbox_id and r.state='claimed' and r.lease_expires_at<=now() and r.attempts>=5
    returning r.delivery_recipient_id,r.attempts
  ) insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,delivery_recipient_id,event_type,attempt,error_text,evidence_json)
    select p_outbox_id,e.delivery_recipient_id,'recipient_lease_exhausted',e.attempts,'recipient delivery lease expired after maximum attempts',jsonb_build_object('terminal',true) from exhausted e;
  with reclaimed as (
    update public.custodial_offline_reconciliation_delivery_recipients r
    set state='retry',claimed_by=null,lease_token=null,claimed_at=null,lease_expires_at=null,next_attempt_at=now(),
      last_error=coalesce(nullif(r.last_error,''),'recipient delivery lease expired')
    where r.outbox_id=p_outbox_id and r.state='claimed' and r.lease_expires_at<=now() and r.attempts<5
    returning r.delivery_recipient_id,r.attempts
  ) insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,delivery_recipient_id,event_type,attempt,error_text,evidence_json)
    select p_outbox_id,r.delivery_recipient_id,'recipient_lease_reclaimed',r.attempts,'recipient delivery lease expired',jsonb_build_object('requeued',true) from reclaimed r;
  return query
  with candidates as (
    select r.delivery_recipient_id from public.custodial_offline_reconciliation_delivery_recipients r
    where r.outbox_id=p_outbox_id and r.state in ('pending','retry') and r.next_attempt_at<=now() and r.attempts<5
    order by r.created_at,r.delivery_recipient_id for update skip locked
  ), claimed as (
    update public.custodial_offline_reconciliation_delivery_recipients r
    set state='claimed',claimed_by=v_worker_id,lease_token=gen_random_uuid(),claimed_at=now(),lease_expires_at=least(v_outbox.lease_expires_at,now()+interval '120 seconds'),attempts=r.attempts+1
    from candidates c where r.delivery_recipient_id=c.delivery_recipient_id returning r.*
  ), evidence as (
    insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,delivery_recipient_id,event_type,attempt,worker_id,evidence_json)
    select p_outbox_id,c.delivery_recipient_id,'recipient_claimed',c.attempts,v_worker_id,jsonb_build_object('lease_token',c.lease_token,'lease_expires_at',c.lease_expires_at) from claimed c
  )
  select c.delivery_recipient_id,c.manager_id,c.recipient_user_id,c.client_message_id,c.notification_instance_key,c.attempts,c.lease_token,c.lease_expires_at from claimed c;
end
$function$
;
DO $owner$ DECLARE o name;f text;BEGIN
 SELECT pg_get_userbyid(proowner) INTO o FROM pg_proc WHERE oid='public.expire_stale_open_sessions(timestamptz)'::regprocedure;
 FOREACH f IN ARRAY ARRAY['public.custodial_unfinished_work_recipient_v1(text)','custodial_leadership_private.unfinished_evidence_immutable_v1()','custodial_leadership_private.unfinished_work_operation_v1(jsonb,text,jsonb)'] LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO %I',f,o);END LOOP;
 EXECUTE format('ALTER TABLE custodial_leadership_private.unfinished_notices_v1 OWNER TO %I',o);
 EXECUTE format('ALTER TABLE custodial_leadership_private.unfinished_clears_v1 OWNER TO %I',o);
END $owner$;
COMMIT;
