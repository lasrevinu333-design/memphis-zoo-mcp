-- Bounded status only. The authenticated application supplies IDs from its
-- just-persisted submission or manager-authorized list. No email send/claim,
-- credential, full envelope or activation permission is exposed by this RPC.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public, extensions;

create function public.custodial_feedback_delivery_status(p_feedback_ids uuid[])
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, extensions
as $fn$
begin
  if p_feedback_ids is null or cardinality(p_feedback_ids)>100
     or array_position(p_feedback_ids,null) is not null then
    raise exception using errcode='22023',message='Supply at most100 nonnull feedback IDs';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'feedback_id',f.id,
    'state',coalesce(i.state,'not_enrolled'),
    'evidence_state',case
      when i.id is null then 'not_enrolled'
      when proof.inbox then 'inbox_observed'
      when proof.sent then 'sent_observed'
      when proof.accepted then 'connector_accepted'
      when i.attempt_id is not null then 'outcome_unknown'
      else 'no_send_evidence' end,
    'relay_paused',coalesce(c.paused,true),
    'needs_attention',coalesce(i.state='needs_attention' or i.possible_duplicate,false),
    'possible_duplicate',coalesce(i.possible_duplicate,false),
    'protected_attachment_pending',coalesce(i.feedback_snapshot->'image_attachment'<>'null'::jsonb,false)
  ) order by f.id)
  from public.system_feedback_items f
  left join public.system_feedback_email_intents i on i.feedback_id=f.id
  left join public.system_feedback_email_relay_config c on c.singleton
  left join lateral (select
    bool_or(r.observation->>'kind'='inbox_observed') inbox,
    bool_or(r.observation->>'kind'='sent_observed') sent,
    bool_or(r.observation->>'kind'='connector_accepted') accepted
    from public.system_feedback_email_receipts r where r.intent_id=i.id) proof on true
  where f.id=any(p_feedback_ids)), '[]'::jsonb);
end;
$fn$;
revoke all on function public.custodial_feedback_delivery_status(uuid[]) from
  public,anon,authenticated,service_role,custodial_application_reader,
  static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
grant execute on function public.custodial_feedback_delivery_status(uuid[]) to service_role;

do $recovery$
declare ident text:='custodial_feedback_delivery_status(uuid[])'; kind text; definition text; bucket integer; ord integer;
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
    raise exception 'Recovery inventory immutability unavailable';
  end if;
  alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  foreach kind in array array['function','grant'] loop
    definition:=case when kind='function' then pg_get_functiondef('public.custodial_feedback_delivery_status(uuid[])'::regprocedure)
      else public.custodial_release_authority_current_grant_definition(ident) end;
    if definition is null then raise exception 'Missing Feedback status recovery definition'; end if;
    bucket:=case when kind='function' then 100000 else 900000 end;
    select n into ord from generate_series(bucket+1,bucket+99999) n
      where not exists(select 1 from public.custodial_release_authority_restore_inventory i where i.restore_order=n)
      order by n limit 1;
    if ord is null then raise exception 'Recovery bucket exhausted'; end if;
    insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
      values(ord,kind,ident,definition,public.static_weekly_digest_text(definition));
  end loop;
  alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end;
$recovery$;
commit;
