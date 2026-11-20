-- Supported authenticated connected-agent preflight. No provider call, task,
-- credential, generic SQL endpoint or production activation is created here.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;
alter table public.system_feedback_email_relay_config
  add column transport_schema_sha256 text check(transport_schema_sha256 ~ '^[0-9a-f]{64}$'),
  add column preflight_challenge_id uuid, add column preflight_challenge_nonce uuid,
  add column preflight_issued_at timestamptz, add column preflight_principal text,
  add column preflight_schema_sha256 text check(preflight_schema_sha256 ~ '^[0-9a-f]{64}$');
alter table public.system_feedback_email_intents
  add column next_reconcile_at timestamptz,
  add column reconciliation_token uuid, add column reconciliation_until timestamptz;
-- Retain saved intents/attempts/receipts; old fixture fields cannot enable v2.
update public.system_feedback_email_relay_config set paused=true,pause_reason='v2_preflight_required';
create or replace function public.feedback_email_relay_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $fn$
begin
  if tg_table_name = 'system_feedback_email_intents' and tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['state','claim_principal','claim_token','claim_generation','claim_until',
      'attempt_id','preflight_failures','next_claim_at','attention_reason','reconciliation_count','possible_duplicate','next_reconcile_at','reconciliation_token','reconciliation_until'])
       = (to_jsonb(old) - array['state','claim_principal','claim_token','claim_generation','claim_until',
      'attempt_id','preflight_failures','next_claim_at','attention_reason','reconciliation_count','possible_duplicate','next_reconcile_at','reconciliation_token','reconciliation_until']) then
      return new;
    end if;
  end if;
  raise exception using errcode='23514', message='Feedback email evidence and envelope are immutable';
end;
$fn$;
-- Private dispatcher is callable only through six exact service-role wrappers.
-- Principal comes from verified backend authInfo, never a public MCP argument.
create or replace function public.feedback_email_relay_command(p_principal text,p_verb text,p_args jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $fn$
declare
  cfg public.system_feedback_email_relay_config%rowtype;
  item public.system_feedback_email_intents%rowtype;
  attempt public.system_feedback_email_attempts%rowtype;
  previous public.system_feedback_email_relay_requests%rowtype;
  req uuid;
  arg_hash text;
  result jsonb;
  observed jsonb;
  kind text;
  allowed text[];
  receipt_id uuid;
  proof jsonb;
  proof_key text;
begin
  if p_principal is null or p_principal !~ '^relay:[0-9a-f]{64}$' then
    raise exception using errcode='42501', message='Verified relay principal required';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' or octet_length(p_args::text)>32768
     or p_args->>'contract_version' is distinct from 'custodial-feedback-relay.v2'
     or jsonb_typeof(p_args->'adapter_schema_sha256') is distinct from 'string'
     or p_args->>'adapter_schema_sha256' !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='Invalid feedback relay contract';
  end if;
  allowed := case p_verb
    when 'status' then array['contract_version']
    when 'claim' then array['contract_version','request_id']
    when 'begin' then array['contract_version','request_id','intent_id','claim_token','claim_generation','envelope_sha256']
    when 'receipt' then array['contract_version','request_id','intent_id','attempt_id','envelope_sha256','observation']
    when 'defer' then array['contract_version','request_id','intent_id','claim_token','claim_generation','reason']
    when 'control' then array['contract_version','request_id','action','reason'] end;
  allowed:=allowed||array['adapter_schema_sha256'];
  if p_verb='control' and p_args->>'action'='resume_preflight_verified' then allowed:=allowed||array['preflight']; end if;
  if allowed is null or exists(select 1 from jsonb_object_keys(p_args) k where not k=any(allowed))
     or exists(select 1 from unnest(allowed) k where not p_args ? k or p_args->k='null'::jsonb) then
    raise exception using errcode='22023', message='Missing or unknown relay arguments';
  end if;
  -- Serialize the small queue's authority transitions and idempotent requests.
  -- Row locks never span a provider call. No external exactly-once assertion.
  select * into strict cfg from public.system_feedback_email_relay_config where singleton for update;
  if p_verb='status' then
    return jsonb_build_object('contract_version','custodial-feedback-relay.v2','server_now',now(),
      'paused',cfg.paused,'pause_reason',cfg.pause_reason,'recipient','eoperle@memphiszoo.org',
      'provider','outlook','provider_account','eoperle@memphiszoo.org',
      'transport_verified',coalesce(cfg.transport_verified_at>=now()-interval '15 minutes'
        and cfg.transport_principal=p_principal and cfg.transport_account='eoperle@memphiszoo.org'
        and cfg.transport_schema_sha256=p_args->>'adapter_schema_sha256',false),
      'transport_verified_at',cfg.transport_verified_at,'adapter_schema_sha256',p_args->>'adapter_schema_sha256',
      'verified_schema_sha256',cfg.transport_schema_sha256,
      'preflight_evidence_source','authenticated_connected_agent_observation',
      'counts',(select coalesce(jsonb_object_agg(state,n),'{}'::jsonb) from
        (select state,count(*) n from public.system_feedback_email_intents group by state) s),
      'protected_attachment_pending',(select count(*) from public.system_feedback_email_intents
        where feedback_snapshot->'image_attachment' is not null and feedback_snapshot->'image_attachment'<>'null'::jsonb),
      'oldest_queued_at',(select min(captured_at) from public.system_feedback_email_intents where state='queued'),
      'last_receipt_at',(select max(recorded_at) from public.system_feedback_email_receipts),
      'recoverable',(select jsonb_build_object('intent_id',id,'attempt_id',attempt_id,
        'envelope_sha256',envelope_sha256,'claim_generation',claim_generation,'claim_until',claim_until,'next_reconcile_at',next_reconcile_at,
        'reconciliation_until',reconciliation_until,'reconciliation_count',reconciliation_count,
        'mode',case when attempt_id is null then 'send' else 'reconcile' end)
        from public.system_feedback_email_intents where claim_principal=p_principal
        and (attempt_id is not null or claim_until>now()) and state not in ('inbox_observed','needs_attention')
        order by captured_at limit 1));
  end if;
  if jsonb_typeof(p_args->'request_id')<>'string' or p_args->>'request_id' !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode='22023', message='UUID request_id required';
  end if;
  req := (p_args->>'request_id')::uuid;
  arg_hash := encode(extensions.digest(convert_to(p_args::text,'UTF8'),'sha256'),'hex');
  select * into previous from public.system_feedback_email_relay_requests where request_id=req;
  if found then
    if previous.principal<>p_principal or previous.verb<>p_verb or previous.argument_sha256<>arg_hash then
      raise exception using errcode='23505', message='Relay request_id conflict';
    end if;
    if p_verb='begin' then return previous.result || '{"may_send":false,"replayed":true}'::jsonb; end if;
    if p_verb='claim' and previous.result ? 'intent_id' then
      select * into item from public.system_feedback_email_intents where id=(previous.result->>'intent_id')::uuid;
      return previous.result || jsonb_build_object('mode',case when item.attempt_id is null then 'send' else 'reconcile' end,
        'attempt_id',item.attempt_id,'replayed',true);
    end if;
    return previous.result || '{"replayed":true}'::jsonb;
  end if;

  if p_verb='control' then
    if jsonb_typeof(p_args->'reason')<>'string' or length(p_args->>'reason') not between 1 and 300 then
      raise exception using errcode='22023', message='Bounded control reason required';
    end if;
    if p_args->>'action'='pause' then
      update public.system_feedback_email_relay_config set paused=true,pause_reason=p_args->>'reason',updated_at=now();
    elsif p_args->>'action'='prepare_preflight' then
      update public.system_feedback_email_relay_config set paused=true,pause_reason='preflight_pending',
        preflight_challenge_id=gen_random_uuid(),preflight_challenge_nonce=gen_random_uuid(),
        preflight_issued_at=now(),preflight_principal=p_principal,
        preflight_schema_sha256=p_args->>'adapter_schema_sha256',updated_at=now()
        where singleton returning * into cfg;
      result:=jsonb_build_object('ok',true,'paused',true,'challenge_id',cfg.preflight_challenge_id,
        'challenge_nonce',cfg.preflight_challenge_nonce,'issued_at',cfg.preflight_issued_at,
        'expires_at',cfg.preflight_issued_at+interval '5 minutes',
        'adapter_schema_sha256',cfg.preflight_schema_sha256,'provider_account','eoperle@memphiszoo.org');
    elsif p_args->>'action'='resume_preflight_verified' then
      proof:=p_args->'preflight';
      if jsonb_typeof(proof) is distinct from 'object'
        or exists(select 1 from jsonb_object_keys(proof) k where not k=any(array['challenge_id','challenge_nonce',
          'provider_account','profile_observed_at','profile_result_sha256','sent_folder_id','inbox_folder_id',
          'sent_read_at','sent_result_sha256','inbox_read_at','inbox_result_sha256']))
        or exists(select 1 from unnest(array['challenge_id','challenge_nonce','provider_account','profile_observed_at',
          'profile_result_sha256','sent_folder_id','inbox_folder_id','sent_read_at','sent_result_sha256',
          'inbox_read_at','inbox_result_sha256']) k where jsonb_typeof(proof->k) is distinct from 'string') then
        raise exception using errcode='22023',message='Exact typed transport preflight observation required';
      end if;
      if cfg.preflight_challenge_id is null or proof->>'challenge_id' is distinct from cfg.preflight_challenge_id::text
        or proof->>'challenge_nonce' is distinct from cfg.preflight_challenge_nonce::text
        or cfg.preflight_principal is distinct from p_principal
        or cfg.preflight_schema_sha256 is distinct from p_args->>'adapter_schema_sha256'
        or cfg.preflight_issued_at<now()-interval '5 minutes'
        or proof->>'provider_account' is distinct from 'eoperle@memphiszoo.org' then
        raise exception using errcode='55000',message='Transport preflight challenge is stale, foreign or mismatched';
      end if;
      foreach proof_key in array array['profile_result_sha256','sent_result_sha256','inbox_result_sha256'] loop
        if proof->>proof_key !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='Preflight result digest required';end if;
      end loop;
      foreach proof_key in array array['profile_observed_at','sent_read_at','inbox_read_at'] loop
        if proof->>proof_key !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
          or (proof->>proof_key)::timestamptz<cfg.preflight_issued_at
          or (proof->>proof_key)::timestamptz>now()+interval '30 seconds' then
          raise exception using errcode='22023',message='Preflight requires fresh reads after the server challenge';
        end if;
      end loop;
      if length(proof->>'sent_folder_id') not between 1 and 512 or length(proof->>'inbox_folder_id') not between 1 and 512
        or proof->>'sent_folder_id'=proof->>'inbox_folder_id' then
        raise exception using errcode='22023',message='Distinct exact Sent and Inbox folder identities required';
      end if;
      update public.system_feedback_email_relay_config set paused=false,pause_reason='',
        transport_verified_at=now(),transport_principal=p_principal,transport_account='eoperle@memphiszoo.org',
        transport_schema_sha256=p_args->>'adapter_schema_sha256',preflight_challenge_id=null,
        preflight_challenge_nonce=null,updated_at=now() where singleton;
      -- The immutable request receipt retains bounded observations, not a
      -- cryptographic Microsoft attestation, configuration proof or send result.
      result:=jsonb_build_object('ok',true,'paused',false,'preflight',proof,
        'observer_principal',p_principal,'adapter_schema_sha256',p_args->>'adapter_schema_sha256',
        'evidence_source','authenticated_connected_agent_observation','verified_until',now()+interval '15 minutes');
    else raise exception using errcode='22023', message='Unsupported relay control'; end if;
    result:=coalesce(result,jsonb_build_object('ok',true,'paused',p_args->>'action'='pause'));
  elsif p_verb='claim' then
    -- Persisted due times and fenced observation lease prevent overlapping
    -- minutely polls from burning the budget. No reconciliation permits resend.
    update public.system_feedback_email_intents set state='needs_attention',attention_reason='reconciliation_exhausted'
      where state in ('outcome_unknown','connector_accepted','sent_observed') and reconciliation_count>=5
        and reconciliation_until<=now();
    if exists(select 1 from public.system_feedback_email_intents where claim_principal=p_principal
      and state in ('outcome_unknown','connector_accepted','sent_observed') and reconciliation_until>now()) then
      result:=jsonb_build_object('ok',true,'busy',true,'reason','reconciliation_lease_active');
    else
      select * into item from public.system_feedback_email_intents where claim_principal=p_principal
        and state in ('outcome_unknown','connector_accepted','sent_observed') and reconciliation_count<5
        and coalesce(next_reconcile_at,'-infinity')<=now()
        order by captured_at,id limit 1 for update;
    end if;
    if item.id is not null then
      update public.system_feedback_email_intents set reconciliation_count=reconciliation_count+1,
        reconciliation_token=gen_random_uuid(),reconciliation_until=now()+interval '120 seconds',
        next_reconcile_at=now()+make_interval(secs=>case reconciliation_count
          when 0 then 300 when 1 then 900 when 2 then 1800 when 3 then 3600 else 120 end)
        where id=item.id returning * into item;
    elsif result is null then
      select * into item from public.system_feedback_email_intents where claim_principal=p_principal
        and state='claimed' and claim_until>now() order by captured_at,id limit 1 for update;
      if not found then
        if cfg.paused or cfg.transport_verified_at is null or cfg.transport_verified_at<now()-interval '15 minutes'
          or cfg.transport_principal is distinct from p_principal
          or cfg.transport_schema_sha256 is distinct from p_args->>'adapter_schema_sha256' then
          result:=jsonb_build_object('ok',true,'paused',true,'reason','transport_not_verified_or_paused');
        else
          select * into item from public.system_feedback_email_intents
            where attempt_id is null and (state='queued' or (state='claimed' and claim_until<=now()))
              and next_claim_at<=now() and (feedback_snapshot->'image_attachment' is null
                or feedback_snapshot->'image_attachment'='null'::jsonb)
            order by captured_at,id limit 1 for update skip locked;
          if found then
            update public.system_feedback_email_intents set state='claimed',claim_principal=p_principal,
              claim_token=gen_random_uuid(),claim_generation=claim_generation+1,claim_until=now()+interval '300 seconds'
              where id=item.id returning * into item;
          end if;
        end if;
      end if;
    end if;
    if item.id is not null and result is null then
      result:=jsonb_build_object('ok',true,'intent_id',item.id,'operation_id',item.operation_id,'feedback_id',item.feedback_id,
        'mode',case when item.attempt_id is null then 'send' else 'reconcile' end,'attempt_id',item.attempt_id,
        'request_fingerprint',item.request_fingerprint,'reconciliation_token',item.reconciliation_token,
        'reconciliation_until',item.reconciliation_until,'next_reconcile_at',item.next_reconcile_at,
        'envelope_sha256',item.envelope_sha256,'claim_token',item.claim_token,'claim_generation',item.claim_generation,
        'claim_until',item.claim_until,'provider','outlook','provider_account','eoperle@memphiszoo.org',
        'recipient','eoperle@memphiszoo.org','expected_subject',item.email_subject,'expected_text',item.email_text);
    end if;
    result:=coalesce(result,'{"ok":true,"empty":true}'::jsonb);
  else
    if jsonb_typeof(p_args->'intent_id')<>'string' or p_args->>'intent_id' !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode='22023', message='UUID intent_id required';
    end if;
    select * into strict item from public.system_feedback_email_intents where id=(p_args->>'intent_id')::uuid for update;
    if p_verb in ('begin','defer') then
      if jsonb_typeof(p_args->'claim_generation')<>'number' or p_args->>'claim_generation' !~ '^[1-9][0-9]{0,8}$'
        or jsonb_typeof(p_args->'claim_token')<>'string' then
        raise exception using errcode='22023', message='Invalid claim fence';
      end if;
      if item.claim_principal is distinct from p_principal or item.claim_token::text is distinct from p_args->>'claim_token'
         or item.claim_generation<>(p_args->>'claim_generation')::integer then
        raise exception using errcode='42501', message='Stale or foreign claim';
      end if;
    end if;
    if p_verb='begin' then
      if item.envelope_sha256 is distinct from p_args->>'envelope_sha256' then
        raise exception using errcode='22023', message='Envelope mismatch';
      end if;
      if item.attempt_id is not null then
        result:=jsonb_build_object('ok',true,'may_send',false,'attempt_id',item.attempt_id,'mode','reconcile');
      elsif cfg.paused or cfg.transport_principal is distinct from p_principal or cfg.transport_verified_at is null
        or cfg.transport_verified_at<now()-interval '15 minutes' or item.claim_until<=now() or item.state<>'claimed'
        or cfg.transport_schema_sha256 is distinct from p_args->>'adapter_schema_sha256' then
        raise exception using errcode='55000', message='Send preparation is paused or expired';
      else
        insert into public.system_feedback_email_attempts(intent_id,principal,envelope_sha256,claim_generation)
          values(item.id,p_principal,item.envelope_sha256,item.claim_generation) returning * into attempt;
        update public.system_feedback_email_intents set attempt_id=attempt.id,state='outcome_unknown',
          next_reconcile_at=now()+interval '60 seconds' where id=item.id;
        result:=jsonb_build_object('ok',true,'may_send',true,'attempt_id',attempt.id,
          'attempt_generation',1,'provider_generation',1,'envelope_sha256',item.envelope_sha256);
      end if;
    elsif p_verb='defer' then
      if item.attempt_id is not null or item.state<>'claimed' or item.claim_until<=now() then
        raise exception using errcode='55000', message='Only a current pre-begin claim can defer';
      end if;
      if p_args->>'reason' in ('missing_profile','auth_unavailable','configuration_unavailable','attachment_unavailable') then
        update public.system_feedback_email_relay_config set paused=true,pause_reason=p_args->>'reason',updated_at=now();
        update public.system_feedback_email_intents set state='queued',claim_until=null,claim_token=null where id=item.id;
      elsif p_args->>'reason'='transient_preflight' then
        update public.system_feedback_email_intents set preflight_failures=preflight_failures+1,
          state=case when preflight_failures>=2 then 'needs_attention' else 'queued' end,
          next_claim_at=now()+make_interval(secs=>case preflight_failures when 0 then 60 when 1 then 300 else 900 end),
          attention_reason=case when preflight_failures>=2 then 'preflight_retry_exhausted' else null end,
          claim_until=null,claim_token=null where id=item.id;
      else raise exception using errcode='22023', message='Unsupported preflight defer reason'; end if;
      result:=jsonb_build_object('ok',true,'intent_id',item.id,'deferred',true);
    elsif p_verb='receipt' then
      if item.attempt_id is null or item.attempt_id::text is distinct from p_args->>'attempt_id'
         or item.envelope_sha256 is distinct from p_args->>'envelope_sha256' then
        raise exception using errcode='22023', message='Exact attempt and envelope required';
      end if;
      select * into strict attempt from public.system_feedback_email_attempts where id=item.attempt_id;
      if attempt.principal<>p_principal then raise exception using errcode='42501', message='Foreign attempt receipt'; end if;
      observed:=p_args->'observation'; kind:=observed->>'kind';
      if jsonb_typeof(observed)<>'object' or octet_length(observed::text)>16384
        or exists(select 1 from jsonb_object_keys(observed) k where not k=any(array['kind','provider_account','to','cc','bcc',
          'subject','operation_id','feedback_id','request_fingerprint','full_text_matches','folder','provider_message_id',
          'internet_message_id','observed_at','result_sha256','match_count','reconciliation_token']))
        or observed->>'provider_account' is distinct from 'eoperle@memphiszoo.org'
        or observed->'to' is distinct from '["eoperle@memphiszoo.org"]'::jsonb
        or observed->'cc' is distinct from '[]'::jsonb or observed->'bcc' is distinct from '[]'::jsonb
        or observed->>'subject' is distinct from item.email_subject
        or observed->>'operation_id' is distinct from item.operation_id::text
        or observed->>'feedback_id' is distinct from item.feedback_id::text
        or observed->>'request_fingerprint' is distinct from item.request_fingerprint then
        raise exception using errcode='22023', message='Receipt does not bind the fixed envelope';
      end if;
      if kind not in ('connector_accepted','outcome_unknown','sent_observed','inbox_observed','multiple_matching_messages','reconciliation_not_found') or kind is null then
        -- P-01: no reviewed positive-nonacceptance mapping exists yet. Unknown
        -- tool errors/HTTP codes/absence must never create a retry generation.
        raise exception using errcode='22023', message='Unsupported observation; no nonacceptance proof mapping exists';
      end if;
      if kind in ('sent_observed','inbox_observed','multiple_matching_messages') and (
        observed->'full_text_matches' is distinct from 'true'::jsonb
        or jsonb_typeof(observed->'provider_message_id') is distinct from 'string'
        or length(observed->>'provider_message_id') not between 1 and 512
        or (kind<>'multiple_matching_messages' and observed->>'folder' is distinct from case when kind='sent_observed' then 'sent' else 'inbox' end)
        or (kind='multiple_matching_messages' and coalesce(observed->>'folder','') not in ('sent','inbox'))
        or jsonb_typeof(observed->'observed_at') is distinct from 'string') then
        raise exception using errcode='22023', message='Positive mailbox receipt requires exact text, folder and provider message ID';
      end if;
      if kind in ('sent_observed','inbox_observed','multiple_matching_messages') then
        if (observed->>'observed_at')::timestamptz>now()+interval '5 minutes' then
          raise exception using errcode='22023', message='Mailbox observation is in the future';
        end if;
      end if;
      if kind='multiple_matching_messages' and (jsonb_typeof(observed->'match_count') is distinct from 'number'
        or observed->>'match_count' !~ '^[0-9]{1,6}$' or (observed->>'match_count')::integer<2) then
        raise exception using errcode='22023', message='Duplicate observation requires multiple matches';
      end if;
      if kind='reconciliation_not_found' then
        if item.reconciliation_token is null or observed->>'reconciliation_token' is distinct from item.reconciliation_token::text
          or item.reconciliation_until<=now() or jsonb_typeof(observed->'observed_at') is distinct from 'string'
          or jsonb_typeof(observed->'result_sha256') is distinct from 'string'
          or observed->>'result_sha256' !~ '^[0-9a-f]{64}$'
          or (observed->>'observed_at')::timestamptz>now()+interval '30 seconds'
          or (observed->>'observed_at')::timestamptz<item.reconciliation_until-interval '120 seconds' then
          raise exception using errcode='22023',message='Current bounded reconciliation observation required';
        end if;
      end if;
      insert into public.system_feedback_email_receipts(intent_id,attempt_id,principal,observation)
        values(item.id,attempt.id,p_principal,observed) returning id into receipt_id;
      update public.system_feedback_email_intents set
        state=case when kind='inbox_observed' or state='inbox_observed' then 'inbox_observed'
          when kind='multiple_matching_messages' then 'needs_attention'
          when state='needs_attention' then state
          when kind='reconciliation_not_found' and reconciliation_count>=5 then 'needs_attention'
          when kind='sent_observed' or state='sent_observed' then 'sent_observed'
          when kind='connector_accepted' or state='connector_accepted' then 'connector_accepted'
          else 'outcome_unknown' end,
        possible_duplicate=possible_duplicate or kind='multiple_matching_messages',
        attention_reason=case when kind='multiple_matching_messages' then 'multiple_matching_messages'
          when kind='reconciliation_not_found' and reconciliation_count>=5 then 'reconciliation_exhausted' else attention_reason end,
        reconciliation_until=case when kind='reconciliation_not_found' then now() else reconciliation_until end
        where id=item.id;
      result:=jsonb_build_object('ok',true,'receipt_id',receipt_id,'intent_id',item.id,'attempt_id',attempt.id,
        'observer_principal',p_principal,'evidence_source','connected_agent_observation');
    else raise exception using errcode='22023', message='Unsupported relay command'; end if;
  end if;
  insert into public.system_feedback_email_relay_requests(request_id,principal,verb,argument_sha256,result)
    values(req,p_principal,p_verb,arg_hash,result);
  return result;
end;
$fn$;

-- Capture exact functions, columns, tables, ACL, RLS, constraints, indexes and
-- enabled triggers into the EXISTING immutable recovery authority inventory.
-- Includes the earlier capture-only relation/trigger, without changing data.
do $recovery$
declare obj record; t text; ident text; def text; bucket integer; ord integer; changed integer;
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
    raise exception 'Release recovery inventory immutability unavailable';
  end if;
  alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  for obj in select * from (
    select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and (p.proname like 'custodial_feedback_relay_%' or p.proname in
        ('feedback_email_relay_command','feedback_email_relay_immutable','capture_system_feedback_email_intent'))
    union all select 900000,'grant',p.oid::regprocedure::text,
      public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and (p.proname like 'custodial_feedback_relay_%' or p.proname in
        ('feedback_email_relay_command','feedback_email_relay_immutable','capture_system_feedback_email_intent'))
    union all select 700000,'trigger','public.system_feedback_items.capture_system_feedback_email_intent_after_insert',
      'drop trigger if exists capture_system_feedback_email_intent_after_insert on public.system_feedback_items; '
      ||pg_get_triggerdef(oid,true)||'; alter table public.system_feedback_items enable trigger capture_system_feedback_email_intent_after_insert;'
      from pg_trigger where tgrelid='public.system_feedback_items'::regclass and tgname='capture_system_feedback_email_intent_after_insert'
    union all select x.bucket,x.kind,x.identity,x.definition from
      unnest(array['public.system_feedback_email_intents','public.system_feedback_email_relay_config',
        'public.system_feedback_email_relay_requests','public.system_feedback_email_attempts','public.system_feedback_email_receipts']) rel
      cross join lateral (
        select 1000 bucket,'relation'::text kind,rel identity,public.custodial_release_authority_current_relation_definition(rel) definition
        union all select 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname)
          from pg_attribute where attrelid=rel::regclass and attnum>0 and not attisdropped
        union all select 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
        union all select 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
        union all select 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
          from pg_constraint where conrelid=rel::regclass
        union all select 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
          from pg_index i where indrelid=rel::regclass and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
        union all select 700000,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '
          ||pg_get_triggerdef(oid,true)||'; alter table '||rel||' enable trigger '||quote_ident(tgname)||';'
          from pg_trigger where tgrelid=rel::regclass and not tgisinternal
        union all select 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)
      ) x
    ) recovery_objects order by bucket,
      case when identity like '%feedback_email_relay_command(%' then 0
        when identity like '%feedback_email_relay_immutable(%' then 1 else 2 end, identity
  loop
    if obj.definition is null then raise exception 'Missing Feedback recovery definition: %',obj.identity; end if;
    update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
      definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
      where object_kind=obj.kind and object_identity=obj.identity;
    get diagnostics changed=row_count;
    if changed>1 then raise exception 'Duplicate recovery identity: %',obj.identity; end if;
    if changed=0 then
      -- Existing inventory deliberately reserves end-of-bucket orders (e.g.
      -- 99999 views and 699999 late indexes). Allocate a free order instead of
      -- using MAX+1 across those reserved dependency positions.
      select n into ord from generate_series(obj.bucket+1,
        (case when obj.bucket=1000 then 100000 else obj.bucket+100000 end)-1) n
        where not exists(select 1 from public.custodial_release_authority_restore_inventory i where i.restore_order=n)
        order by n limit 1;
      if ord is null then raise exception 'Recovery bucket exhausted for %',obj.identity; end if;
      insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
        values(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
    end if;
  end loop;
  alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end;
$recovery$;
commit;
