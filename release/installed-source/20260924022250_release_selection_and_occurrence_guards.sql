begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Paused restore must retain both archived and target identities. Such rows
-- are staging evidence, never an ordinary deployed selection. Only the
-- database control row can set this marker; a caller-supplied value is ignored.
alter table public.release_deployment_manifest
  add column recovery_staged boolean not null default false;

create function custodial_dr.guard_release_selection()
returns trigger language plpgsql security definer
set search_path=pg_catalog,custodial_dr as $function$
declare paused boolean;
begin
  -- The shared control-row lock prevents a paused writer from committing a
  -- staging row after a concurrent resume has already checked its population.
  select mutations_paused into paused from custodial_dr.restore_control
    where singleton=true for share;
  if not found then raise exception 'release selection requires restore control'; end if;
  new.recovery_staged:=paused;
  return new;
end $function$;
revoke all on function custodial_dr.guard_release_selection() from public,anon,authenticated,service_role;
create trigger trg_release_selection_guard
before insert or update on public.release_deployment_manifest
for each row execute function custodial_dr.guard_release_selection();
-- Restore uses replica mode. It must not bypass this authority marker.
alter table public.release_deployment_manifest enable always trigger trg_release_selection_guard;

-- Historical ambiguity is a failed gate, not permission to pick or erase a row.
-- The trigger derives the marker under the same restore-control lock.
update public.release_deployment_manifest set recovery_staged=false;
create unique index release_deployment_manifest_one_ordinary_deployed
on public.release_deployment_manifest ((true))
where status='deployed' and not recovery_staged;

create function custodial_dr.require_single_release_on_resume()
returns trigger language plpgsql security definer
set search_path=pg_catalog,custodial_dr as $function$
declare deployed_count integer;
begin
  if new.mutations_paused=false then
    select count(*) into deployed_count from public.release_deployment_manifest where status='deployed';
    if deployed_count<>1 then
      raise exception 'release reconciliation requires exactly one deployed identity, found %',deployed_count;
    end if;
    -- The updated control row is visible here. Each release guard therefore
    -- clears its staging marker; the unique index independently enforces it.
    update public.release_deployment_manifest set recovery_staged=false where recovery_staged;
  end if;
  return new;
end $function$;
revoke all on function custodial_dr.require_single_release_on_resume() from public,anon,authenticated,service_role;
create trigger trg_require_single_release_on_resume
after update of mutations_paused on custodial_dr.restore_control
for each row when (old.mutations_paused=true and new.mutations_paused=false)
execute function custodial_dr.require_single_release_on_resume();
alter table custodial_dr.restore_control enable always trigger trg_require_single_release_on_resume;

comment on column public.release_deployment_manifest.recovery_staged is
  'Database-derived paused-restore evidence only; cannot remain staged when ordinary admission resumes.';
commit;
