-- Complete the H03/H04 database parent, not the still-unmounted HTTP/native
-- workflow. No generic receipt writer or caller-provided target list.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.static_weekly_recurring_acceptance_proofs (
 operation_id uuid primary key references public.static_weekly_recurring_confirmations(operation_id) on delete restrict,
 publication_id uuid not null references public.static_weekly_recurring_publication_bindings(publication_id) on delete restrict,
 projection_id uuid not null references public.weekly_schedule_compiled_projections(projection_id) on delete restrict,
 accepted_revision bigint not null references public.weekly_schedule_authority_revisions(authority_revision) on delete restrict,
 decision_digest text not null check(decision_digest~'^[0-9a-f]{64}$'),
 dependency_digest text not null check(dependency_digest~'^[0-9a-f]{64}$'),
 target_manifest jsonb not null check(jsonb_typeof(target_manifest)='array' and jsonb_array_length(target_manifest)>0),
 target_manifest_digest text not null check(target_manifest_digest~'^[0-9a-f]{64}$'),
 owner_xid xid8 not null default pg_current_xact_id(),
 created_at timestamptz not null default statement_timestamp()
);
create index static_weekly_recurring_acceptance_publication on public.static_weekly_recurring_acceptance_proofs(publication_id);
create index static_weekly_recurring_acceptance_projection on public.static_weekly_recurring_acceptance_proofs(projection_id);
create index static_weekly_recurring_acceptance_revision on public.static_weekly_recurring_acceptance_proofs(accepted_revision);
alter table public.static_weekly_recurring_acceptance_proofs enable row level security;
alter table public.static_weekly_recurring_acceptance_proofs force row level security;
revoke all on table public.static_weekly_recurring_acceptance_proofs from public,anon,authenticated,service_role,
 static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
create trigger trg_recurring_acceptance_immutable before update or delete on public.static_weekly_recurring_acceptance_proofs
 for each row execute function public.static_weekly_reject_update_delete();

create function public.static_weekly_v23_finalize_recurring_confirmation(p_manager uuid,p_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare p public.static_weekly_recurring_confirmations%rowtype;b public.static_weekly_recurring_publication_bindings%rowtype;
 r public.static_weekly_recurring_confirmation_receipts%rowtype;l public.weekly_schedule_lunch_documents%rowtype;
 a record;day_authority record;v_revision bigint;v_generation bigint;v_day date;v_manifest jsonb;v_receipt jsonb;v_count integer;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v3_manager_actor(p_manager);
 select * into p from public.static_weekly_recurring_confirmations where manager_id=p_manager and confirmation_key=p_key for update;
 if not found then raise exception 'recurring finalizer requires exact named-manager parent';end if;
 select * into r from public.static_weekly_recurring_confirmation_receipts where operation_id=p.operation_id;
 if found then return r.receipt_json;end if; -- immutable history before current staleness
 if p.owner_xid<>pg_current_xact_id() or p.effective_start<=public.sch_service_date(statement_timestamp()) then
  raise exception 'recurring finalizer requires this transaction and future effective Monday';end if;
 select * into b from public.static_weekly_recurring_publication_bindings where operation_id=p.operation_id;
 select generation into strict v_generation from public.static_weekly_recurring_generation where singleton;
 select current_revision into strict v_revision from public.static_weekly_schedule_control where singleton;
 if b.operation_id is null or b.owner_xid<>pg_current_xact_id() or b.recurring_generation<>v_generation
  or b.decision_digest<>public.static_weekly_digest_jsonb(b.decision_json)
  or b.dependency_digest<>public.static_weekly_digest_jsonb(b.dependency_snapshot)
  or public.static_weekly_v21_first_changed_dependency_date(b.publication_id,p.effective_start) is not null then
  raise exception using errcode='40001',message='recurring finalization dependency or decision changed';end if;
 select * into a from public.static_weekly_v6_schedule_authority_state(p.effective_start);
 if a.projection_status is distinct from 'current' or a.publication_id is distinct from b.publication_id
  or a.projection_id is null or a.projection_authority_revision is distinct from v_revision then
  raise exception 'recurring finalization requires exact current projection and revision';end if;
 if not exists(select 1 from public.weekly_schedule_command_receipts c
  join public.weekly_schedule_publications publication on publication.publication_id=b.publication_id
  where c.actor_manager_id=p_manager and c.command_type='materialize_projection'
   and c.idempotency_key='recurring:'||p_manager||':'||p_key||':projection:'||p.effective_start
   and c.response_json#>>'{data,projection_id}'=a.projection_id::text
   and (c.response_json->>'revision')::bigint=v_revision
   and c.expected_revision=publication.authority_revision
   and c.response_digest=c.response_json->>'output_digest'
   and c.response_digest=public.static_weekly_digest_jsonb(c.response_json-'output_digest')) then
  raise exception 'recurring finalization requires its exact projection child receipt';end if;
 select * into l from public.weekly_schedule_lunch_documents where projection_id=a.projection_id;
 if not found or l.accepted_by_manager_id is distinct from p_manager then
  raise exception 'recurring finalization requires its exact named-manager lunch companion';end if;
 -- The complete initial week is materialized atomically. The ongoing bounded
 -- reconciliation path must separately populate future materialized weeks.
 for v_day in select p.effective_start+offset_day from generate_series(0,6) offset_day loop
  select * into day_authority from public.static_weekly_v6_schedule_authority_state(v_day);
  if day_authority.projection_status is distinct from 'current' or day_authority.publication_id is distinct from b.publication_id
   or day_authority.projection_id is distinct from a.projection_id or day_authority.projection_authority_revision is distinct from v_revision then
   raise exception 'recurring finalization week contains a different or blocked authority';end if;
  perform public.static_weekly_v22_reconcile_recurring_application_date(v_day);
 end loop;
 select jsonb_agg(jsonb_build_object('intentId',i.intent_id,'serviceDate',i.service_date,
  'employeeId',i.employee_id,'deviceId',i.device_id,'credentialId',i.credential_id,'assignmentEpoch',i.assignment_epoch,
  'targetDigest',i.target_digest,'viewDigest',i.view_digest) order by i.service_date,i.employee_id,i.device_id nulls first,i.credential_id nulls first,i.intent_id),
  count(distinct i.service_date)::int into v_manifest,v_count
 from public.static_weekly_recurring_application_intents i
 where i.operation_id=p.operation_id and i.publication_id=b.publication_id and i.projection_id=a.projection_id
  and i.authority_revision=v_revision and i.service_date between p.effective_start and p.effective_start+6;
 if v_manifest is null or v_count<>7 then raise exception 'recurring finalization requires complete durable initial-week phone targets';end if;
 insert into public.static_weekly_recurring_acceptance_proofs(operation_id,publication_id,projection_id,accepted_revision,
  decision_digest,dependency_digest,target_manifest,target_manifest_digest)
 values(p.operation_id,b.publication_id,a.projection_id,v_revision,b.decision_digest,b.dependency_digest,v_manifest,public.static_weekly_digest_jsonb(v_manifest));
 v_receipt:=jsonb_build_object('schema','static-weekly.recurring-confirmation-receipt.v1',
  'operationId',p.operation_id,'managerId',p.manager_id,'confirmationKey',p.confirmation_key,'requestDigest',p.request_digest,
  'previewDigest',p.preview_digest,'effectiveStart',p.effective_start,'sourceId',b.source_id,'sourceDigest',b.source_digest,
  'publicationId',b.publication_id,'projectionId',a.projection_id,'authorityRevision',v_revision,'lunchDocumentIdentity',l.document_identity,
  'accepted',true,'phoneDeliveryState','PENDING','affectedPhonesUpdated',false);
 insert into public.static_weekly_recurring_confirmation_receipts(operation_id,source_id,source_digest,publication_id,
  projection_id,accepted_revision,lunch_document_identity,receipt_json,receipt_digest)
 values(p.operation_id,b.source_id,b.source_digest,b.publication_id,a.projection_id,v_revision,l.document_identity,v_receipt,
  public.static_weekly_digest_jsonb(v_receipt));
 return v_receipt;
end
$function$;
revoke all on function public.static_weekly_v23_finalize_recurring_confirmation(uuid,uuid) from public,anon,authenticated,service_role,
 static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v23_finalize_recurring_confirmation(uuid,uuid) to static_weekly_control_plane;
-- Only the existing constrained transaction owner may finish its own exact
-- reserved parent. No HTTP confirmation is mounted by this SQL migration.

do $receipt_guard$
declare definition text;seam text:='if v_parent.owner_xid<>pg_current_xact_id()';
begin
 definition:=pg_get_functiondef('public.static_weekly_v13_guard_recurring_receipt()'::regprocedure);
 if length(definition)-length(replace(definition,seam,''))<>length(seam) then raise exception 'recurring acceptance receipt seam changed';end if;
 execute replace(definition,seam,seam||E'\n'||$proof$
    or not exists(select 1 from public.static_weekly_recurring_acceptance_proofs proof
      join public.static_weekly_recurring_publication_bindings b on b.operation_id=proof.operation_id
      where proof.operation_id=new.operation_id and proof.owner_xid=pg_current_xact_id()
       and proof.publication_id=new.publication_id and proof.projection_id=new.projection_id
       and proof.accepted_revision=new.accepted_revision and proof.decision_digest=b.decision_digest
       and proof.dependency_digest=b.dependency_digest
       and proof.target_manifest_digest=public.static_weekly_digest_jsonb(proof.target_manifest))
 $proof$);
end
$receipt_guard$;

do $surface$
declare definition text;rows_sql text;seam text:='  values';
begin
 select string_agg(format('(%L,%L,%L)',kind,identity,'exact recurring schedule atomic acceptances'),E',\n' order by kind,identity)||',' into rows_sql
 from (
  select 'relation' kind,'public.'||name identity from unnest(array['static_weekly_recurring_acceptance_proofs']) name
  union all select 'function','public.'||oid::regprocedure::text from pg_proc where pronamespace='public'::regnamespace and proname like 'static_weekly_v23_%'
  union all select 'trigger','public.'||c.relname||'.'||t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
   where t.tgname='trg_recurring_acceptance_immutable'
 ) objects;
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if length(definition)-length(replace(definition,seam,''))<>length(seam) then raise exception 'atomic acceptance canary seam changed';end if;
 execute replace(definition,seam,seam||E'\n'||rows_sql);
end
$surface$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;v_order integer;
begin
 for obj in with relations(name) as (values('public.static_weekly_recurring_acceptance_proofs')),
 funcs as (select oid,'public.'||oid::regprocedure::text identity from pg_proc where pronamespace='public'::regnamespace
  and (proname like 'static_weekly_v23_%' or oid in ('public.custodial_release_canary_authority_surface()'::regprocedure,'public.static_weekly_v13_guard_recurring_receipt()'::regprocedure))),objects as (
  select 1000 bucket,'relation'::text kind,name identity,public.custodial_release_authority_current_relation_definition(name) definition from relations
  union all select 100000,'function',identity,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',r.name||':'||a.attname,public.custodial_release_authority_current_column_definition(r.name||':'||a.attname)
   from relations r join pg_attribute a on a.attrelid=r.name::regclass and a.attnum>0 and not a.attisdropped
  union all select 300000,'column_set',name,public.custodial_release_authority_current_column_set_definition(name) from relations
  union all select 400000,'relation_state',name,public.custodial_release_authority_current_relation_state_definition(name) from relations
  union all select 500000,'constraint',r.name||':'||c.conname,public.custodial_release_authority_current_constraint_definition(r.name||':'||c.conname)
   from relations r join pg_constraint c on c.conrelid=r.name::regclass
  union all select 600000,'index','public.'||quote_ident(c.relname),public.custodial_release_authority_current_index_definition('public.'||quote_ident(c.relname))
   from relations r join pg_index i on i.indrelid=r.name::regclass join pg_class c on c.oid=i.indexrelid
   where not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)
  union all select 700000,'trigger',r.name||'.'||t.tgname,
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||r.name||'; '||pg_get_triggerdef(t.oid,true)||';'
   from relations r join pg_trigger t on t.tgrelid=r.name::regclass and not t.tgisinternal
  union all select 900000,'grant',name,public.custodial_release_authority_current_grant_definition(name) from relations
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing recurring acceptance recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in ('function','grant')
    and object_identity like '%(%' and obj.identity like '%(%' then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into v_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(v_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
