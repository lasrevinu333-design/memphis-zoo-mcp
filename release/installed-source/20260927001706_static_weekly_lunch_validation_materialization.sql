-- Retain every lunch validation check. Materialize three immutable JSON
-- subdocuments once per call instead of repeatedly extracting them from a
-- potentially TOAST-compressed projection inside the nested validation loops.
-- This is NOT a cross-call cache, validation receipt, or trusted session flag.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $materialize$
declare definition text;part record;needle text;
begin
 definition:=pg_get_functiondef('public.static_weekly_v8_assert_lunch_document(uuid,jsonb)'::regprocedure);
 needle:=' start_time time;end_time time;';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then
  raise exception 'lunch validation declaration changed';end if;
 definition:=replace(definition,needle,needle||E'\n projection_availability jsonb;projection_assignments jsonb;projection_work jsonb;');
 for part in select * from (values
  ('projection.projection_envelope#>''{authority,projectionAvailability}''','projection_availability',4),
  ('projection.projection_envelope->''assignments''','projection_assignments',2),
  ('projection.projection_envelope#>''{authority,overlayCompilerInput,version,assignments}''','projection_work',1)
 ) p(expression,variable,expected_count) loop
  if length(definition)-length(replace(definition,part.expression,''))<>length(part.expression)*part.expected_count then
   raise exception 'lunch validation extraction seam changed: %',part.variable;end if;
  definition:=replace(definition,part.expression,part.variable);
 end loop;
 needle:='if not found then raise exception ''lunch projection is missing''; end if;';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then
  raise exception 'lunch validation projection seam changed';end if;
 definition:=replace(definition,needle,needle||E'\n'||$assign$
 projection_availability:=projection.projection_envelope#>'{authority,projectionAvailability}';
 projection_assignments:=projection.projection_envelope->'assignments';
 projection_work:=projection.projection_envelope#>'{authority,overlayCompilerInput,version,assignments}';
$assign$);
 execute definition;
end
$materialize$;
-- CREATE OR REPLACE preserves the established narrow EXECUTE ACL. No new
-- object, grant, table, sequence, or runtime privilege is introduced.
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare definition text;affected integer;
begin
 definition:=pg_get_functiondef('public.static_weekly_v8_assert_lunch_document(uuid,jsonb)'::regprocedure);
 update public.custodial_release_authority_restore_inventory
 set definition_sql=definition,definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
 where object_kind='function' and to_regprocedure(object_identity)='public.static_weekly_v8_assert_lunch_document(uuid,jsonb)'::regprocedure;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'exact lunch assertion recovery entry missing or duplicated';end if;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
