-- No provider permission exists until the original prepared source is current
-- again and a single immutable, SQL-clocked wire receipt is committed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;

create table public.employee_native_alert_finalizations (
 job_id uuid primary key references public.employee_native_alert_preparations(job_id),
 preparation_id uuid not null unique,
 alert_kind text not null check(alert_kind in ('EVENT','MESSAGE')),
 source_revision text not null check(source_revision~'^[0-9a-f]{64}$'),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 content_sha256 text not null check(content_sha256~'^[0-9a-f]{64}$'),
 finalized_at timestamptz not null,
 valid_until timestamptz not null check(isfinite(valid_until) and valid_until>finalized_at),
 attempt_id uuid not null unique default gen_random_uuid(),
 outcome_operation_id uuid not null unique default gen_random_uuid(),
 check(attempt_id<>outcome_operation_id),
 check(payload->>'receipt_job_id'=job_id::text and payload->>'source_revision'=source_revision
  and payload->>'reservation_at'=public.custodial_native_location_utc(finalized_at)
  and payload->>'valid_until'=public.custodial_native_location_utc(valid_until)
  and payload->>'content_sha256'=content_sha256
  and content_sha256=public.static_weekly_digest_text(public.custodial_native_location_canonical(payload-'content_sha256'))
  and octet_length(public.custodial_native_location_canonical(payload))<=3500)
);
create table public.employee_native_alert_outcomes (
 job_id uuid primary key references public.employee_native_alert_finalizations(job_id),
 operation_id uuid not null unique,
 provider_outcome text not null check(provider_outcome in
  ('provider_accepted','known_nonacceptance','delivery_outcome_unknown')),
 provider_message_id text,
 error_code text,
 recorded_at timestamptz not null,
 check((provider_outcome='provider_accepted' and length(provider_message_id) between 1 and 1000
   and error_code is null)
  or (provider_outcome<>'provider_accepted' and provider_message_id is null
   and error_code~'^[a-z][a-z0-9_]{0,99}$'))
);
create trigger trg_employee_native_alert_finalizations_immutable before update or delete
 on public.employee_native_alert_finalizations for each row
 execute function public.custodial_native_location_append_only();
alter table public.employee_native_alert_finalizations enable always trigger trg_employee_native_alert_finalizations_immutable;
alter table public.employee_native_alert_finalizations enable row level security;
alter table public.employee_native_alert_finalizations force row level security;
create trigger trg_employee_native_alert_outcomes_immutable before update or delete
 on public.employee_native_alert_outcomes for each row
 execute function public.custodial_native_location_append_only();
alter table public.employee_native_alert_outcomes enable always trigger trg_employee_native_alert_outcomes_immutable;
alter table public.employee_native_alert_outcomes enable row level security;
alter table public.employee_native_alert_outcomes force row level security;
revoke all on table public.employee_native_alert_finalizations from public,anon,authenticated,service_role,
 static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
revoke all on table public.employee_native_alert_outcomes from public,anon,authenticated,service_role,
 static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;

-- The existing Message prepare returns no projection on replay. This private
-- check therefore reads the same current thread/member/receipt/visibility
-- authority under the owning locks; a legacy prepared row alone proves none
-- of these facts and never grants native dispatch.
create function public.custodial_native_alert_message_current(p_job uuid,p_projection jsonb,p_at timestamptz)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $fn$
declare j public.operational_notification_jobs%rowtype;m public.msg_messages%rowtype;
 t public.msg_threads%rowtype;u public.msg_users%rowtype;r public.msg_receipts%rowtype;
 legacy public.employee_native_push_delivery_receipts%rowtype;
 recipient uuid;target_thread_id uuid;revision text;
begin
 if p_job is null or p_at is null or not isfinite(p_at)
  or jsonb_typeof(p_projection) is distinct from 'object'
  or p_projection->>'schema' is distinct from 'custodial.employee-message-admission.v1' then return false;end if;
 select * into j from public.operational_notification_jobs where job_id=p_job for update;
 if j.job_id is null or j.job_type<>'employee_native_push' or j.status<>'leased'
  or j.leased_until<=p_at or j.source_id::text is distinct from p_projection->>'message_id'
  or j.job_key is distinct from p_projection->>'job_key'
  or j.lease_token::text is distinct from p_projection->>'lease_token'
  or j.payload_json is distinct from p_projection->'payload' then return false;end if;
 select * into legacy from public.employee_native_push_delivery_receipts where job_id=p_job for update;
 if legacy.job_id is null or legacy.delivery_state<>'prepared'
  or legacy.lease_token is distinct from j.lease_token
  or legacy.credential_id::text is distinct from p_projection->>'credential_id'
  or legacy.registration_id::text is distinct from p_projection->>'registration_id'
  or legacy.assignment_epoch::text is distinct from p_projection->>'assignment_epoch'
  or legacy.token_hash is distinct from p_projection->>'token_hash' then return false;end if;
 recipient:=(p_projection->>'recipient_user_id')::uuid;
 target_thread_id:=(p_projection->>'thread_id')::uuid;
 select * into t from public.msg_threads where id=target_thread_id for update;
 select * into m from public.msg_messages where id=j.source_id for share;
 select * into u from public.msg_users where id=recipient and is_active=true for share;
 if t.id is null or t.is_active is not true or t.system_key='ops_manager_shared_chat_v1'
  or m.id is null or m.thread_id is distinct from t.id or m.is_deleted is not false
  or m.sender_user_id=u.id or m.sent_at is null or m.sent_at>p_at
  or u.id is null or u.employee_id::text is distinct from p_projection->>'employee_id' then return false;end if;
 perform 1 from public.msg_thread_participants where thread_id=t.id and user_id=u.id
  and left_at is null for share;
 if not found then return false;end if;
 select * into r from public.msg_receipts where message_id=m.id and user_id=u.id for share;
 if r.message_id is null or r.acknowledged_at is not null
  or exists(select 1 from public.msg_message_deletions where message_id=m.id and user_id=u.id)
  or exists(select 1 from public.msg_thread_visibility v where v.thread_id=t.id and v.user_id=u.id
   and (v.device_identifier is null or upper(btrim(v.device_identifier))=upper(btrim(p_projection->>'device_identifier')))
   and coalesce(m.sent_at,m.created_at)<=v.hidden_before) then return false;end if;
 revision:=public.static_weekly_digest_jsonb(jsonb_build_object('message_id',m.id,'thread_id',m.thread_id,
  'sender_user_id',m.sender_user_id,'sent_at',m.sent_at,'body',m.body,
  'metadata_json',m.metadata_json,'recipient_user_id',u.id));
 if revision is distinct from p_projection->>'source_revision'
  or p_projection#>>'{payload,body}' is distinct from
   left(coalesce(nullif(regexp_replace(m.body,'[[:space:]]+',' ','g'),''),'New message'),1000)
  or p_projection#>>'{payload,title}' is distinct from p_projection#>>'{payload,data_json,sender_name}'
  or p_projection#>>'{payload,data_json,notification_key}' is distinct from 'message:'||m.id::text
  or p_projection#>>'{payload,data_json,route}' is distinct from
   'messages.html?hub=employee&thread_id='||t.id::text then return false;end if;
 return true;
exception when data_exception or invalid_text_representation then return false;
end $fn$;

create function public.custodial_native_alert_finalize_at(p_job uuid,p_lease uuid,p_prepared uuid,
 p_expected jsonb,p_candidate jsonb,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare target jsonb;prep public.employee_native_alert_preparations%rowtype;
 prior public.employee_native_alert_finalizations%rowtype;j public.operational_notification_jobs%rowtype;
 c public.device_auth_credentials%rowtype;i public.event_push_instances%rowtype;
 projection jsonb;at_time timestamptz;until_time timestamptz;data jsonb;
 required_keys text[];ttl integer;row_out public.employee_native_alert_finalizations%rowtype;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_lease is null or p_prepared is null
  or jsonb_typeof(p_expected) is distinct from 'object'
  or jsonb_typeof(p_candidate) is distinct from 'object' then
  raise exception 'exact native alert finalize request required' using errcode='22023';end if;
 target:=public.custodial_native_alert_target_at(p_job,p_lease,p_test_at);
 if target->'current' is distinct from 'true'::jsonb or target->'expected' is distinct from p_expected then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_target_superseded');end if;
 select * into j from public.operational_notification_jobs where job_id=p_job for update;
 select * into prep from public.employee_native_alert_preparations where job_id=p_job for update;
 at_time:=coalesce(p_test_at,clock_timestamp());
 if prep.job_id is null or prep.preparation_id<>p_prepared or prep.lease_token<>p_lease
  or prep.expected is distinct from p_expected or prep.alert_kind is distinct from target->>'kind'
  or prep.prepared_until<=at_time or j.leased_until<=at_time then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_preparation_superseded');end if;
 select * into prior from public.employee_native_alert_finalizations where job_id=p_job for update;
 if prior.job_id is not null then
  return jsonb_build_object('current',true,'dispatch_authorized',false,
   'delivery_outcome_unknown',true,'reason','native_alert_original_finalization_no_resend');end if;
 select * into c from public.device_auth_credentials where credential_id=(p_expected->>'credential_id')::uuid for update;
 until_time:=least(prep.prepared_until,j.leased_until,c.expires_at);
 if c.credential_id is null or c.revoked_at is not null or c.expires_at<=at_time then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_credential_superseded');end if;
 if prep.alert_kind='EVENT' then
  select * into i from public.event_push_instances where instance_id=j.source_id for update;
  projection:=public.mz_employee_event_push_current_projection(p_job,p_lease,i.instance_id,c.credential_id,i.assignment_epoch);
  if projection->'current' is distinct from 'true'::jsonb then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_event_source_superseded');end if;
  projection:=projection||jsonb_build_object('notification_kind',i.notification_kind,'service_date',i.service_date::text);
  until_time:=least(until_time,(projection->>'start_instant_utc')::timestamptz);
  required_keys:=array['body','channel_id','event_id','event_revision','instance_id','kind',
   'notification_key','notification_kind','notification_type','recipient_device_uuid','route',
   'schema','service_date','source_revision','title'];
 else
  if not public.custodial_native_alert_message_current(p_job,prep.source_projection,at_time) then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_message_source_superseded');end if;
  projection:=prep.source_projection;
  required_keys:=array['body','channel_id','kind','message_id','notification_key','notification_type',
   'recipient_user_id','route','schema','source_revision','thread_id','title'];
 end if;
 if projection is distinct from prep.source_projection
  or (prep.alert_kind='EVENT' and public.static_weekly_digest_jsonb(projection) is distinct from prep.source_revision)
  or (prep.alert_kind='MESSAGE' and projection->>'source_revision' is distinct from prep.source_revision)
  or until_time<=at_time+interval '1 second' then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_source_or_window_superseded');end if;
 if (select array_agg(key order by key collate "C") from jsonb_object_keys(p_candidate) key) is distinct from required_keys
  or exists(select 1 from jsonb_each(p_candidate) e where jsonb_typeof(e.value)<>'string')
  or octet_length(p_candidate->>'title') not between 1 and 180
  or octet_length(p_candidate->>'body') not between 1 and 1000
  or p_candidate->>'source_revision' is distinct from prep.source_revision
  or p_candidate->>'kind' is distinct from (case prep.alert_kind when 'EVENT' then 'employee_event' else 'employee_message' end)
  or p_candidate->>'notification_type' is distinct from lower(prep.alert_kind)
  or p_candidate->>'channel_id' is distinct from (case prep.alert_kind when 'EVENT' then 'employee-events' else 'employee-messages' end)
  or p_candidate->>'schema' is distinct from (case prep.alert_kind when 'EVENT' then 'custodial.native-event-payload.v1'
   else 'custodial.native-message-payload.v1' end) then
  raise exception 'native alert content candidate invalid' using errcode='22023';end if;
 if prep.alert_kind='EVENT' then
  if coalesce(projection->>'employee_name','')=''
   or coalesce(projection->>'event_name','')=''
   or coalesce(projection->>'display_location','')=''
   or p_candidate->>'event_id' is distinct from projection->>'event_id'
   or p_candidate->>'instance_id' is distinct from projection->>'instance_id'
   or p_candidate->>'event_revision' is distinct from projection->>'event_revision'
   or p_candidate->>'recipient_device_uuid' is distinct from p_expected->>'device_uuid'
   or p_candidate->>'notification_kind' is distinct from projection->>'notification_kind'
   or p_candidate->>'service_date' is distinct from projection->>'service_date'
   or p_candidate->>'notification_key' is distinct from projection->>'notification_key'
   or p_candidate->>'route' is distinct from 'events.html?hub=employee&event_id='||(projection->>'event_id')
   or p_candidate->>'title' is distinct from 'Memphis Zoo event reminder'
   or position(projection->>'event_name' in p_candidate->>'body')=0
   or position(projection->>'display_location' in p_candidate->>'body')=0 then
   raise exception 'native Event content not bound to current source' using errcode='42501';end if;
 else
  if p_candidate->>'message_id' is distinct from projection->>'message_id'
   or p_candidate->>'thread_id' is distinct from projection->>'thread_id'
   or p_candidate->>'recipient_user_id' is distinct from projection->>'recipient_user_id'
   or p_candidate->>'notification_key' is distinct from 'message:'||j.source_id::text
   or p_candidate->>'route' is distinct from 'messages.html?hub=employee&thread_id='||(projection->>'thread_id')
   or p_candidate->>'title' is distinct from projection#>>'{payload,title}'
   or p_candidate->>'body' is distinct from projection#>>'{payload,body}' then
   raise exception 'native Message content not bound to current source' using errcode='42501';end if;
 end if;
 if exists(select 1 from jsonb_each_text(p_candidate) e where e.value~'[[:cntrl:]]') then
  raise exception 'native alert content contains controls' using errcode='22023';end if;
 data:=p_candidate||jsonb_build_object('generation_id',p_expected->>'generation_id',
  'principal_digest',p_expected->>'principal_digest','token_digest',p_expected->>'token_digest',
  'receipt_job_id',p_job::text,'receipt_credential_id',p_expected->>'credential_id',
  'receipt_employee_id',p_expected->>'employee_id','receipt_device_id',p_expected->>'device_id',
  'receipt_assignment_epoch',p_expected->>'assignment_epoch',
  'reservation_at',public.custodial_native_location_utc(at_time),
  'valid_until',public.custodial_native_location_utc(until_time));
 if prep.alert_kind='MESSAGE' then
  data:=data||jsonb_build_object('service_date',public.sch_service_date(at_time)::text);end if;
 data:=data||jsonb_build_object('content_sha256',
  public.static_weekly_digest_text(public.custodial_native_location_canonical(data)));
 if octet_length(public.custodial_native_location_canonical(data))>3500 then
  raise exception 'native alert closed wire too large' using errcode='22023';end if;
 insert into public.employee_native_alert_finalizations(job_id,preparation_id,alert_kind,source_revision,
  payload,content_sha256,finalized_at,valid_until)
 values(p_job,p_prepared,prep.alert_kind,prep.source_revision,data,data->>'content_sha256',at_time,until_time)
 returning * into row_out;
 ttl:=least(2419200,floor(extract(epoch from until_time-at_time))::integer);
 return jsonb_build_object('schema','custodial.native-alert-dispatch.v1','dispatch_authorized',true,
  'reservation',jsonb_build_object('current',true,'replayed',false,'delivery_outcome_unknown',false,
   'dispatch_authorized',true,'payload',data,'wire',public.custodial_native_location_canonical(data)),
  'attempt_id',row_out.attempt_id,'outcome_operation_id',row_out.outcome_operation_id,'ttl_seconds',ttl);
end $fn$;
create function public.custodial_native_alert_finalize(p_job uuid,p_lease uuid,p_prepared uuid,
 p_expected jsonb,p_candidate jsonb)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_alert_finalize_at(p_job,p_lease,p_prepared,p_expected,p_candidate,null);
$fn$;

-- A provider response and a handset observation are different facts. This
-- append-only provider receipt never upgrades an ambiguous/lost response.
create function public.custodial_native_alert_dispatch_status(p_job uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a public.employee_native_alert_finalizations%rowtype;o public.employee_native_alert_outcomes%rowtype;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null then raise exception 'exact alert job required' using errcode='22023';end if;
 perform 1 from public.operational_notification_jobs where job_id=p_job for update;
 select * into a from public.employee_native_alert_finalizations where job_id=p_job for update;
 if a.job_id is null then return jsonb_build_object('schema','custodial.native-alert-dispatch-status.v1',
  'reserved',false,'dispatch_authorized',false);end if;
 select * into o from public.employee_native_alert_outcomes where job_id=p_job;
 return jsonb_build_object('schema','custodial.native-alert-dispatch-status.v1','reserved',true,
  'dispatch_authorized',false,'job_id',a.job_id,'attempt_id',a.attempt_id,
  'outcome_operation_id',a.outcome_operation_id,'content_sha256',a.content_sha256,
  'provider_outcome',coalesce(o.provider_outcome,'prepared'),
  'provider_message_id',o.provider_message_id,'error_code',o.error_code);
end $fn$;
create function public.custodial_native_alert_record_outcome(p_job uuid,p_operation uuid,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a public.employee_native_alert_finalizations%rowtype;o public.employee_native_alert_outcomes%rowtype;
 received timestamptz;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_operation is null or jsonb_typeof(p_evidence) is distinct from 'object'
  or (select array_agg(key order by key collate "C") from jsonb_object_keys(p_evidence) key) is distinct from
   array['error_code','operation_id','outcome','provider_message_id']
  or p_evidence->>'operation_id' is distinct from p_operation::text
  or p_evidence->>'outcome' not in ('provider_accepted','known_nonacceptance','delivery_outcome_unknown') then
  raise exception 'exact native alert outcome required' using errcode='22023';end if;
 if p_evidence->>'outcome'='provider_accepted' then
  if jsonb_typeof(p_evidence->'provider_message_id') is distinct from 'string'
   or length(p_evidence->>'provider_message_id') not between 1 and 1000
   or p_evidence->>'provider_message_id'~'[[:cntrl:]]'
   or p_evidence->'error_code'<>'null'::jsonb then
   raise exception 'provider acceptance evidence invalid' using errcode='22023';end if;
 elsif p_evidence->'provider_message_id'<>'null'::jsonb
  or coalesce(p_evidence->>'error_code','') !~ '^[a-z][a-z0-9_]{0,99}$' then
  raise exception 'provider uncertainty evidence invalid' using errcode='22023';end if;
 perform 1 from public.operational_notification_jobs where job_id=p_job for update;
 select * into a from public.employee_native_alert_finalizations where job_id=p_job for update;
 if a.job_id is null or a.outcome_operation_id<>p_operation then
  raise exception 'original native alert finalization required' using errcode='42501';end if;
 select * into o from public.employee_native_alert_outcomes where job_id=p_job;
 if o.job_id is not null then
  if o.operation_id<>p_operation or o.provider_outcome<>p_evidence->>'outcome'
   or o.provider_message_id is distinct from p_evidence->>'provider_message_id'
   or o.error_code is distinct from p_evidence->>'error_code' then
   raise exception 'native alert outcome conflict' using errcode='23505';end if;
  return jsonb_build_object('schema','custodial.native-alert-outcome.v1','recorded',true,'replayed',true,
   'provider_outcome',o.provider_outcome,'provider_message_id',o.provider_message_id,'error_code',o.error_code);
 end if;
 received:=clock_timestamp();
 insert into public.employee_native_alert_outcomes(job_id,operation_id,provider_outcome,provider_message_id,error_code,recorded_at)
 values(p_job,p_operation,p_evidence->>'outcome',p_evidence->>'provider_message_id',p_evidence->>'error_code',received);
 return jsonb_build_object('schema','custodial.native-alert-outcome.v1','recorded',true,'replayed',false,
  'provider_outcome',p_evidence->>'outcome','provider_message_id',p_evidence->>'provider_message_id',
  'error_code',p_evidence->>'error_code');
end $fn$;

revoke all on function public.custodial_native_alert_message_current(uuid,jsonb,timestamptz),
 public.custodial_native_alert_finalize_at(uuid,uuid,uuid,jsonb,jsonb,timestamptz),
 public.custodial_native_alert_finalize(uuid,uuid,uuid,jsonb,jsonb),
 public.custodial_native_alert_dispatch_status(uuid),
 public.custodial_native_alert_record_outcome(uuid,uuid,jsonb)
 from public,anon,authenticated,service_role,static_weekly_control_plane,
 static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
grant execute on function public.custodial_native_alert_finalize(uuid,uuid,uuid,jsonb,jsonb),
 public.custodial_native_alert_dispatch_status(uuid),
 public.custodial_native_alert_record_outcome(uuid,uuid,jsonb) to service_role;
-- Capture only objects created in THIS transaction, before any runtime use.
-- These explicit birth identities are independent of surviving recovery rows.
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
do $alert_birth_recovery$
declare obj record;next_order integer;previous_mode text;surface text;surface_acl text;
 additions text:='';updated integer;
begin
 select tgenabled::text into previous_mode from pg_trigger
  where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   and tgname='trg_custodial_release_authority_restore_inventory_immutable';
 if previous_mode not in ('O','A') then raise exception 'Alert recovery guard unavailable';end if;
 surface:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 surface_acl:=public.custodial_release_authority_current_grant_definition('custodial_release_canary_authority_surface()');
 if (length(surface)-length(replace(surface,'  values','')))/length('  values')<>1
  or (select count(*) from public.custodial_release_authority_restore_inventory
   where object_kind='function' and to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
    and definition_sql=surface and definition_sha256=public.static_weekly_digest_text(surface))<>1 then
  raise exception 'Alert recovery surface predecessor changed';end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in with relations(identity) as (values ('public.employee_native_alert_finalizations'),('public.employee_native_alert_outcomes')),
 funcs as (select x.identity::regprocedure::oid oid from (values ('public.custodial_native_alert_message_current(uuid,jsonb,timestamptz)'),('public.custodial_native_alert_finalize_at(uuid,uuid,uuid,jsonb,jsonb,timestamptz)'),('public.custodial_native_alert_finalize(uuid,uuid,uuid,jsonb,jsonb)'),('public.custodial_native_alert_dispatch_status(uuid)'),('public.custodial_native_alert_record_outcome(uuid,uuid,jsonb)')) x(identity)),
 objects as (
  select 1000 bucket,'relation'::text kind,identity,public.custodial_release_authority_current_relation_definition(identity) definition from relations
  union all select 100000,'function',oid::regprocedure::text,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',r.identity||':'||a.attname,public.custodial_release_authority_current_column_definition(r.identity||':'||a.attname)
   from relations r join pg_attribute a on a.attrelid=r.identity::regclass and a.attnum>0 and not a.attisdropped
  union all select 300000,'column_set',identity,public.custodial_release_authority_current_column_set_definition(identity) from relations
  union all select 400000,'relation_state',identity,public.custodial_release_authority_current_relation_state_definition(identity) from relations
  union all select 500000,'constraint',r.identity||':'||c.conname,public.custodial_release_authority_current_constraint_definition(r.identity||':'||c.conname)
   from relations r join pg_constraint c on c.conrelid=r.identity::regclass
  union all select 600000,'index','public.'||quote_ident(c.relname),public.custodial_release_authority_current_index_definition('public.'||quote_ident(c.relname))
   from relations r join pg_index i on i.indrelid=r.identity::regclass join pg_class c on c.oid=i.indexrelid
   where not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)
  union all select 700000,'trigger',r.identity||'.'||quote_ident(t.tgname),
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||r.identity||'; '||pg_get_triggerdef(t.oid,true)
   ||'; alter table '||r.identity||' '||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable'
    when 'R' then 'enable replica' when 'A' then 'enable always' end||' trigger '||quote_ident(t.tgname)||';'
   from relations r join pg_trigger t on t.tgrelid=r.identity::regclass and not t.tgisinternal
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from relations
  union all select 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null or exists(select 1 from public.custodial_release_authority_restore_inventory i
   where i.object_kind=obj.kind and (i.object_identity=obj.identity or
    case when obj.kind in ('function','grant') and i.object_identity like '%(%' and obj.identity like '%(%'
     then to_regprocedure(i.object_identity)=to_regprocedure(obj.identity) else false end)) then
   raise exception 'Alert birth recovery absent definition or preexisting identity: %',obj.identity;end if;
  select n into next_order from generate_series(obj.bucket+1,
   (case when obj.bucket=1000 then 100000 else obj.bucket+100000 end)-1) n
   where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
  if next_order is null then raise exception 'Alert recovery order exhausted';end if;
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  if exists(select 1 from public.custodial_release_canary_authority_surface() s where s.object_kind=obj.kind and s.object_identity=obj.identity) then
   raise exception 'Alert birth surface already contains identity: %',obj.identity;end if;
  additions:=additions||format('    (%L,%L,%L),',obj.kind,obj.identity,'native alert birth authority')||E'\n';
 end loop;
 execute replace(surface,'  values',E'  values\n'||additions);
 if public.custodial_release_authority_current_grant_definition('custodial_release_canary_authority_surface()') is distinct from surface_acl then
  raise exception 'Alert surface ACL changed';end if;
 update public.custodial_release_authority_restore_inventory
  set definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
   definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),
   captured_at=statement_timestamp()
  where object_kind='function' and to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   and definition_sql=surface and definition_sha256=public.static_weekly_digest_text(surface);
 get diagnostics updated=row_count;
 if updated<>1 then raise exception 'Alert surface recovery identity changed';end if;
 execute 'alter table public.custodial_release_authority_restore_inventory enable '
  ||case when previous_mode='A' then 'always ' else '' end||'trigger trg_custodial_release_authority_restore_inventory_immutable';
end $alert_birth_recovery$;
commit;
