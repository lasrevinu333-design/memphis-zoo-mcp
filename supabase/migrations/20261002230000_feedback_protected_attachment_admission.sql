-- Protected historical image admission before the FIRST external send. This
-- neither reenrolls old feedback nor changes the immutable email envelope.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
set local search_path=pg_catalog,public,extensions;

alter table public.system_feedback_email_intents
  add column attachment_verification_ticket uuid,
  add column attachment_verification_state text not null default 'unverified'
    check(attachment_verification_state in ('unverified','pending','verified','blocked')),
  add column attachment_verification_claim_token uuid,
  add column attachment_verification_generation integer,
  add column attachment_verification_source_digest text
    check(attachment_verification_source_digest is null or attachment_verification_source_digest ~ '^[0-9a-f]{64}$'),
  add column attachment_verification_sha256 text
    check(attachment_verification_sha256 is null or attachment_verification_sha256 ~ '^[0-9a-f]{64}$'),
  add column attachment_verification_size integer,
  add column attachment_verification_type text,
  add column attachment_verified_at timestamptz;

-- Retain the old immutable snapshot and envelope. Only fenced verification
-- evidence joins the previously whitelisted claim/attempt state columns.
do $patch_immutable$ declare definition text; old_text text; new_text text; begin
  definition:=pg_get_functiondef('public.feedback_email_relay_immutable()'::regprocedure);
  old_text:='''next_reconcile_at'',''reconciliation_token'',''reconciliation_until''])';
  new_text:='''next_reconcile_at'',''reconciliation_token'',''reconciliation_until'','
    ||'''attachment_verification_ticket'',''attachment_verification_state'',''attachment_verification_claim_token'','
    ||'''attachment_verification_generation'',''attachment_verification_source_digest'',''attachment_verification_sha256'','
    ||'''attachment_verification_size'',''attachment_verification_type'',''attachment_verified_at''])';
  if (length(definition)-length(replace(definition,old_text,'')))<>2*length(old_text) then
    raise exception 'Unexpected predecessor Feedback immutable trigger definition';end if;
  execute replace(definition,old_text,new_text);
end $patch_immutable$;

create function public.feedback_email_attachment_source_matches(p_intent uuid)
returns boolean language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select exists(select 1 from public.system_feedback_email_intents i
   join public.system_feedback_items f on f.id=i.feedback_id
   where i.id=p_intent and f.operation_id=i.operation_id
     and f.request_fingerprint=i.request_fingerprint
     and f.metadata_json->'image_attachment' is not distinct from i.feedback_snapshot->'image_attachment'
   for share of f)
$fn$;
revoke all on function public.feedback_email_attachment_source_matches(uuid)
 from public,anon,authenticated,service_role,custodial_application_reader,
 static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;

-- Not an MCP tool. The server adapter alone receives the private metadata on
-- prepare; complete/reject accepts bounded byte-observation facts, never bytes.
create function public.custodial_feedback_relay_attachment_internal(p_principal text,p_action text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $fn$
declare
  cfg public.system_feedback_email_relay_config%rowtype;
  item public.system_feedback_email_intents%rowtype;
  image jsonb;
  expected_sha text;
  canonical_match text[];
  observed jsonb;
  ticket uuid;
  disposition text;
  allowed text[];
begin
  if p_principal !~ '^relay:[0-9a-f]{64}$' or p_args is null or jsonb_typeof(p_args)<>'object'
    or octet_length(p_args::text)>16384 or p_args->>'adapter_schema_sha256' !~ '^[0-9a-f]{64}$'
    or p_args->>'intent_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_args->>'claim_token' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_args->>'claim_generation' !~ '^[1-9][0-9]{0,8}$'
    or p_args->>'envelope_sha256' !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='Exact private attachment admission fence required';end if;
  allowed:=case p_action when 'prepare' then array['intent_id','claim_token','claim_generation','envelope_sha256','adapter_schema_sha256']
    when 'complete' then array['intent_id','claim_token','claim_generation','envelope_sha256','adapter_schema_sha256','ticket','observed']
    when 'reject' then array['intent_id','claim_token','claim_generation','envelope_sha256','adapter_schema_sha256','ticket','disposition'] end;
  if allowed is null or exists(select 1 from jsonb_object_keys(p_args) k where not k=any(allowed))
    or exists(select 1 from unnest(allowed) k where not p_args ? k or p_args->k='null'::jsonb) then
    raise exception using errcode='22023',message='Unknown or missing private attachment admission argument';end if;
  select * into strict cfg from public.system_feedback_email_relay_config where singleton for update;
  select * into strict item from public.system_feedback_email_intents where id=(p_args->>'intent_id')::uuid for update;
  if item.claim_principal is distinct from p_principal or item.claim_token::text is distinct from p_args->>'claim_token'
    or item.claim_generation<>(p_args->>'claim_generation')::integer
    or item.envelope_sha256 is distinct from p_args->>'envelope_sha256' then
    raise exception using errcode='42501',message='Stale or foreign attachment claim';end if;
  if p_action='prepare' and item.attempt_id is not null then return '{"status":"already_attempted"}'::jsonb;end if;
  if cfg.paused or cfg.transport_principal is distinct from p_principal or cfg.transport_verified_at is null
    or cfg.transport_verified_at<now()-interval '15 minutes'
    or cfg.transport_schema_sha256 is distinct from p_args->>'adapter_schema_sha256'
    or item.state<>'claimed' or item.claim_until<=now() or item.attempt_id is not null then
    raise exception using errcode='55000',message='Private attachment preparation is paused or expired';end if;
  image:=item.feedback_snapshot->'image_attachment';
  if image is null or image='null'::jsonb then
    if p_action='prepare' then return '{"status":"no_attachment"}'::jsonb;end if;
    raise exception using errcode='22023',message='No protected attachment to attest';
  end if;
  if not public.feedback_email_attachment_source_matches(item.id) then
    update public.system_feedback_email_intents set state='needs_attention',attention_reason='attachment_source_changed',
      claim_token=null,claim_until=null,attachment_verification_state='blocked' where id=item.id;
    return '{"status":"needs_attention"}'::jsonb;
  end if;
  if p_action='prepare' then
    ticket:=gen_random_uuid();
    update public.system_feedback_email_intents set attachment_verification_ticket=ticket,
      attachment_verification_state='pending',attachment_verification_claim_token=item.claim_token,
      attachment_verification_generation=item.claim_generation,
      attachment_verification_source_digest=public.static_weekly_digest_jsonb(image),
      attachment_verification_sha256=null,attachment_verification_size=null,
      attachment_verification_type=null,attachment_verified_at=null where id=item.id;
    return jsonb_build_object('status','ready','ticket',ticket,'operation_id',item.operation_id,'image',image);
  end if;
  if p_args->>'ticket' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or item.attachment_verification_ticket::text is distinct from p_args->>'ticket'
    or item.attachment_verification_state<>'pending'
    or item.attachment_verification_claim_token is distinct from item.claim_token
    or item.attachment_verification_generation is distinct from item.claim_generation
    or item.attachment_verification_source_digest is distinct from public.static_weekly_digest_jsonb(image) then
    raise exception using errcode='42501',message='Stale private attachment verification ticket';end if;
  if p_action='reject' then
    disposition:=p_args->>'disposition';
    if disposition not in ('missing','corrupt','configuration_unavailable') or disposition is null then
      raise exception using errcode='22023',message='Typed private attachment disposition required';end if;
    if disposition='configuration_unavailable' then
      update public.system_feedback_email_relay_config set paused=true,pause_reason='attachment_storage_unavailable',updated_at=now() where singleton;
      update public.system_feedback_email_intents set state='queued',claim_token=null,claim_until=null,
        attachment_verification_state='unverified',attachment_verification_ticket=null where id=item.id;
      return '{"status":"paused"}'::jsonb;
    end if;
    update public.system_feedback_email_intents set state='needs_attention',claim_token=null,claim_until=null,
      attention_reason=case when disposition='missing' then 'protected_attachment_missing' else 'protected_attachment_corrupt' end,
      attachment_verification_state='blocked' where id=item.id;
    return '{"status":"needs_attention"}'::jsonb;
  end if;
  observed:=p_args->'observed';
  if jsonb_typeof(observed)<>'object' or
    (select count(*) from jsonb_object_keys(observed))<>3 or not(observed ?& array['sha256','size','type'])
    or observed->>'sha256' !~ '^[0-9a-f]{64}$'
    or observed->>'size' !~ '^[1-9][0-9]{0,6}$'
    or (observed->>'size')::integer>5*1024*1024
    or observed->>'type' not in ('image/png','image/jpeg','image/webp','image/gif')
    or nullif(image->>'size','')::integer is distinct from (observed->>'size')::integer
    or replace(image->>'type','image/jpg','image/jpeg') is distinct from observed->>'type' then
    raise exception using errcode='22023',message='Actual attachment size and type proof required';end if;
  canonical_match:=regexp_match(coalesce(image->>'storage_path',''),
    '^feedback/'||item.operation_id::text||'/([0-9a-f]{64})\.(png|jpg|webp|gif)$');
  expected_sha:=coalesce(nullif(image->>'sha256',''),canonical_match[1]);
  if expected_sha is not null and expected_sha is distinct from observed->>'sha256' then
    raise exception using errcode='22023',message='Actual attachment digest mismatch';end if;
  if expected_sha is null and nullif(image->>'data_url','') is null and nullif(image->>'dataUrl','') is null then
    raise exception using errcode='22023',message='No immutable attachment digest source';end if;
  update public.system_feedback_email_intents set attachment_verification_state='verified',
    attachment_verification_sha256=observed->>'sha256',attachment_verification_size=(observed->>'size')::integer,
    attachment_verification_type=observed->>'type',attachment_verified_at=now() where id=item.id;
  return '{"status":"verified"}'::jsonb;
end $fn$;
revoke all on function public.custodial_feedback_relay_attachment_internal(text,text,jsonb)
 from public,anon,authenticated,service_role,custodial_application_reader,
 static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
grant execute on function public.custodial_feedback_relay_attachment_internal(text,text,jsonb) to service_role;

-- Patch only exact v2 owning slots. An unexpected predecessor fails the
-- migration rather than silently weakening the six-tool command contract.
do $patch_command$ declare definition text; old_text text; new_text text; begin
  definition:=pg_get_functiondef('public.feedback_email_relay_command(text,text,jsonb)'::regprocedure);
  old_text:='and next_claim_at<=now() and (feedback_snapshot->''image_attachment'' is null'
    ||chr(10)||'                or feedback_snapshot->''image_attachment''=''null''::jsonb)';
  new_text:='and next_claim_at<=now()';
  if strpos(definition,old_text)=0 or strpos(replace(definition,old_text,''),old_text)>0 then
    raise exception 'Unexpected predecessor Feedback claim attachment exclusion';end if;
  definition:=replace(definition,old_text,new_text);
  old_text:='''recipient'',''eoperle@memphiszoo.org'',''expected_subject''';
  new_text:='''recipient'',''eoperle@memphiszoo.org'',''protected_attachment'','
    ||'(item.feedback_snapshot->''image_attachment'' is not null and item.feedback_snapshot->''image_attachment''<>''null''::jsonb),''expected_subject''';
  if strpos(definition,old_text)=0 or strpos(replace(definition,old_text,''),old_text)>0 then
    raise exception 'Unexpected predecessor Feedback claim envelope shape';end if;
  definition:=replace(definition,old_text,new_text);
  old_text:='      else'||chr(10)||'        insert into public.system_feedback_email_attempts';
  new_text:='      elsif item.feedback_snapshot->''image_attachment'' is not null'
    ||chr(10)||'        and item.feedback_snapshot->''image_attachment''<>''null''::jsonb and ('
    ||chr(10)||'          item.attachment_verification_state<>''verified'''
    ||chr(10)||'          or item.attachment_verification_claim_token is distinct from item.claim_token'
    ||chr(10)||'          or item.attachment_verification_generation is distinct from item.claim_generation'
    ||chr(10)||'          or item.attachment_verification_source_digest is distinct from public.static_weekly_digest_jsonb(item.feedback_snapshot->''image_attachment'')'
    ||chr(10)||'          or item.attachment_verification_sha256 is null'
    ||chr(10)||'          or item.attachment_verified_at<now()-interval ''60 seconds'''
    ||chr(10)||'          or not public.feedback_email_attachment_source_matches(item.id)) then'
    ||chr(10)||'        raise exception using errcode=''55000'',message=''Protected attachment admission is missing or stale'';'
    ||chr(10)||'      else'||chr(10)||'        insert into public.system_feedback_email_attempts';
  if strpos(definition,old_text)=0 or strpos(replace(definition,old_text,''),old_text)>0 then
    raise exception 'Unexpected predecessor Feedback begin attempt boundary';end if;
  execute replace(definition,old_text,new_text);
end $patch_command$;

-- Exact changed-object recovery binding. No existing row or evidence is
-- deleted; no grant is widened beyond the private service-role entrypoint.
do $recovery$ declare obj record;ord integer;changed integer;begin
  if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
    raise exception 'Release recovery inventory immutability unavailable';end if;
  alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  for obj in select * from (
    select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
        ('feedback_email_relay_command','feedback_email_relay_immutable','feedback_email_attachment_source_matches','custodial_feedback_relay_attachment_internal')
    union all select 900000,'grant',p.oid::regprocedure::text,
      public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
        ('feedback_email_attachment_source_matches','custodial_feedback_relay_attachment_internal')
    union all select 300000,'column_set','public.system_feedback_email_intents',
      public.custodial_release_authority_current_column_set_definition('public.system_feedback_email_intents')
    union all select 200000,'column','public.system_feedback_email_intents:'||attname,
      public.custodial_release_authority_current_column_definition('public.system_feedback_email_intents:'||attname)
      from pg_attribute where attrelid='public.system_feedback_email_intents'::regclass and attnum>0 and not attisdropped
        and (attname like 'attachment_verification_%' or attname='attachment_verified_at')
    union all select 500000,'constraint','public.system_feedback_email_intents:'||conname,
      public.custodial_release_authority_current_constraint_definition('public.system_feedback_email_intents:'||conname)
      from pg_constraint where conrelid='public.system_feedback_email_intents'::regclass and conname like 'system_feedback_email_intents_attachment_%'
    ) objects order by bucket,identity
  loop
    if obj.definition is null then raise exception 'Missing Feedback attachment recovery definition: %',obj.identity;end if;
    update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
      definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
      where object_kind=obj.kind and object_identity=obj.identity;
    get diagnostics changed=row_count;
    if changed>1 then raise exception 'Duplicate Feedback attachment recovery identity';end if;
    if changed=0 then
      select n into ord from generate_series(obj.bucket+1,obj.bucket+99999) n
      where not exists(select 1 from public.custodial_release_authority_restore_inventory i where i.restore_order=n)
      order by n limit 1;
      if ord is null then raise exception 'Feedback attachment recovery bucket exhausted';end if;
      insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
        values(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
    end if;
  end loop;
  alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;
commit;
